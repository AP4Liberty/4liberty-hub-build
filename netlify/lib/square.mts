/**
 * Square server-side wrapper — the ONLY code that ever holds
 * SQUARE_ACCESS_TOKEN. Creates one-time "tip the show" payments.
 *
 * See PHASE-3-BUILD-PLAN.md Decision 7 (Square Sandbox first, flip to
 * production via SQUARE_ENVIRONMENT — no code change) and Decision 9 (PCI
 * stays SAQ A — this file only ever sees a one-time nonce from the Web
 * Payments SDK, never a raw card number; the card is tokenized inside
 * Square's own hosted iframe before it reaches us).
 *
 * Saved-card / repeat-tip charging needs a customer_id, which needs
 * somewhere to store the person -> customer mapping — that's the identity
 * spine Task D builds. Every tip today is a one-time charge; Task F adds
 * the saved-card branch alongside this file.
 */

import { SquareClient, SquareEnvironment, SquareError } from 'square';

// Fallback bounds, used only if Task G's config bridge (netlify/lib/config.mts
// + poll-wp-config.mts) is unreachable — see tip-create.mts, which is the
// caller that actually supplies the WordPress-admin-configured bounds.
const DEFAULT_MIN_TIP_CENTS = 100; // $1
const DEFAULT_MAX_TIP_CENTS = 50000; // $500
const MAX_MESSAGE_LENGTH = 200;

let client: SquareClient | null = null;

function getClient(): SquareClient {
	if ( client ) {
		return client;
	}
	const token = Netlify.env.get( 'SQUARE_ACCESS_TOKEN' );
	if ( ! token ) {
		throw new Error( 'Square is not configured (missing SQUARE_ACCESS_TOKEN).' );
	}
	const env = Netlify.env.get( 'SQUARE_ENVIRONMENT' );
	client = new SquareClient( {
		token,
		environment: env === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
	} );
	return client;
}

function getLocationId(): string {
	const id = Netlify.env.get( 'SQUARE_LOCATION_ID' );
	if ( ! id ) {
		throw new Error( 'Square is not configured (missing SQUARE_LOCATION_ID).' );
	}
	return id;
}

/**
 * A REAL check, not just "is an env var set" — fetching the location is a
 * cheap read, so an invalid/revoked access token or a wrong location ID
 * shows up here rather than only being discovered when a real tip fails.
 * Used by config-status.mts for the admin panel's status line.
 */
export async function checkSquareConfigured(): Promise< boolean > {
	try {
		const c = getClient();
		await c.locations.get( { locationId: getLocationId() } );
		return true;
	} catch {
		return false;
	}
}

export interface AmountValidation {
	valid: boolean;
	cents: number;
}

/**
 * Server-side amount validation — the client's preset/custom-amount field is
 * a UI convenience, never trusted on its own; a tampered request could send
 * any amountCents. Whole cents only, bounded to a sane tip range.
 *
 * Bounds are the WordPress-admin-configured ones (see netlify/lib/config.mts)
 * when the caller has them; the defaults here only cover the (expected to be
 * rare) case where that config bridge is unreachable.
 */
export function validateAmountCents(
	raw: unknown,
	minCents: number = DEFAULT_MIN_TIP_CENTS,
	maxCents: number = DEFAULT_MAX_TIP_CENTS
): AmountValidation {
	const cents = typeof raw === 'number' ? Math.round( raw ) : NaN;
	if ( ! Number.isFinite( cents ) || cents < minCents || cents > maxCents ) {
		return { valid: false, cents: 0 };
	}
	return { valid: true, cents };
}

/** Trims and bounds the optional tip message. Never throws on bad input. */
export function sanitizeTipMessage( raw: unknown ): string {
	if ( typeof raw !== 'string' ) {
		return '';
	}
	return raw.trim().slice( 0, MAX_MESSAGE_LENGTH );
}

/**
 * A client-generated idempotency key, passed through unchanged to Square.
 * Square rejects a reused key paired with different payment details, so a
 * malicious or buggy client can't replay one tip's key to smuggle a
 * different charge — reuse only succeeds for a genuine retry of the exact
 * same attempt, which is the whole point.
 */
export function isValidIdempotencyKey( raw: unknown ): raw is string {
	return typeof raw === 'string' && raw.length >= 8 && raw.length <= 128;
}

export interface CreateTipResult {
	success: true;
	paymentId: string;
	amountCents: number;
}

export interface CreateTipError {
	success: false;
	error: string;
}

/**
 * Charges a tip via a Web Payments SDK nonce OR a previously-saved card's id
 * (`sourceId` accepts either — they're the same kind of Square payment
 * source). Never logs the nonce/card id or the access token — only Square's
 * own error statusCode/message, which don't carry either.
 *
 * `customerId` is optional and only ever passed by tip-repeat.mts (charging
 * a saved card) — Square recommends pairing a stored card's id with its
 * owning customer id on the charge itself for its fraud checks.
 */
export async function createTip(
	sourceId: string,
	amountCents: number,
	note: string,
	idempotencyKey: string,
	customerId?: string
): Promise< CreateTipResult | CreateTipError > {
	const c = getClient();
	try {
		const response = await c.payments.create( {
			sourceId,
			idempotencyKey,
			amountMoney: { amount: BigInt( amountCents ), currency: 'USD' },
			locationId: getLocationId(),
			note: note || undefined,
			autocomplete: true,
			customerId: customerId || undefined,
		} );

		const payment = response.payment;
		if ( ! payment || ! payment.id ) {
			return { success: false, error: 'no_payment_returned' };
		}

		return { success: true, paymentId: payment.id, amountCents };
	} catch ( error ) {
		if ( error instanceof SquareError ) {
			console.error( '[square] payment failed:', error.statusCode, error.message );
		} else {
			console.error( '[square] payment failed:', error instanceof Error ? error.message : String( error ) );
		}
		return { success: false, error: 'payment_failed' };
	}
}

/**
 * Reuses the identity spine's existing Square customer if this account
 * already has one (from a PRIOR save-card tip), otherwise creates a fresh
 * one. Only ever reached on a save-card-CONSENTED, logged-in tip — a plain
 * one-time tip never touches the Customers API.
 */
export async function createOrReuseCustomer(
	existingCustomerId: string | null,
	email: string,
	displayName: string
): Promise< string | null > {
	if ( existingCustomerId ) {
		return existingCustomerId;
	}
	const c = getClient();
	try {
		const response = await c.customers.create( { emailAddress: email, givenName: displayName || undefined } );
		return response.customer?.id ?? null;
	} catch ( error ) {
		console.error( '[square] customer create failed:', error instanceof Error ? error.message : String( error ) );
		return null;
	}
}

export interface SaveCardResult {
	success: true;
	customerId: string;
	cardId: string;
	last4: string;
}

export interface SaveCardError {
	success: false;
	error: string;
}

/**
 * Saves a card on file for a customer FROM the same nonce the visitor is
 * about to be charged with. Card creation consumes the nonce (Square nonces
 * are single-use) — the caller must charge using the RETURNED card's id
 * afterward, never the original nonce again.
 */
export async function saveCard(
	customerId: string,
	sourceId: string,
	idempotencyKey: string
): Promise< SaveCardResult | SaveCardError > {
	const c = getClient();
	try {
		const response = await c.cards.create( {
			idempotencyKey,
			sourceId,
			card: { customerId },
		} );
		const card = response.card;
		if ( ! card || ! card.id ) {
			return { success: false, error: 'no_card_returned' };
		}
		return { success: true, customerId, cardId: card.id, last4: card.last4 ?? '????' };
	} catch ( error ) {
		if ( error instanceof SquareError ) {
			console.error( '[square] card save failed:', error.statusCode, error.message );
		} else {
			console.error( '[square] card save failed:', error instanceof Error ? error.message : String( error ) );
		}
		return { success: false, error: 'card_save_failed' };
	}
}
