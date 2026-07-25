/**
 * tip-create — charges a one-time "tip the show" payment via the Square Web
 * Payments SDK's nonce, then (on success) posts a highlighted tip card into
 * the on-site chat — Rumble-Rant parity on our own property, done
 * trustworthily: the card is only ever posted AFTER Square confirms the
 * charge, and only by this server (see PHASE-3-BUILD-PLAN.md Decision 4). A
 * client can never forge "X tipped $Y" — there is no client-writable path
 * to that message.
 *
 * Task F adds the save-card branch: a logged-in tipper who checks "save my
 * card" gets a Square customer + card on file linked to their identity spine
 * record, so tip-repeat.mts can charge it again with no card re-entry. An
 * anonymous or non-consenting tip is completely unchanged — straight to
 * createTip() with the raw one-time nonce, same as before Task F existed.
 *
 * CORS is the same explicit allowlist every public endpoint in this project
 * uses (see ../lib/cors.mts) — never `*`.
 */

import type { Config, Context } from '@netlify/functions';
import { getServerConfig } from '../lib/config.mts';
import { corsHeaders } from '../lib/cors.mts';
import { linkSquareCard, verifySession } from '../lib/identity.mts';
import { checkRateLimit } from '../lib/ratelimit.mts';
import {
	createOrReuseCustomer,
	createTip,
	isValidIdempotencyKey,
	saveCard,
	sanitizeTipMessage,
	validateAmountCents,
} from '../lib/square.mts';
import { alreadyPostedCard, postTipCard, sanitizeDisplayName } from '../lib/stream.mts';

const CORS_OPTIONS = { methods: 'POST, OPTIONS', headers: 'content-type' };
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_SECONDS = 300; // 5 minutes

function json( body: unknown, status: number, cors: Record< string, string > ): Response {
	return new Response( JSON.stringify( body ), {
		status,
		headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
	} );
}

export default async ( req: Request, context: Context ) => {
	const cors = corsHeaders( req.headers.get( 'origin' ), CORS_OPTIONS );

	if ( req.method === 'OPTIONS' ) {
		return new Response( null, { status: 204, headers: cors } );
	}
	if ( req.method !== 'POST' ) {
		return json( { error: 'method_not_allowed' }, 405, cors );
	}

	const { allowed } = await checkRateLimit( `tip-create:${ context.ip }`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS );
	if ( ! allowed ) {
		return json( { error: 'rate_limited' }, 429, cors );
	}

	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return json( { error: 'invalid_json' }, 400, cors );
	}
	const b = body as Record< string, unknown >;

	const sourceId = typeof b.sourceId === 'string' ? b.sourceId : '';
	if ( ! sourceId ) {
		return json( { error: 'invalid_source' }, 400, cors );
	}

	// Task G's admin-configured bounds — bridged from WordPress via the same
	// scheduled-poller shape as the Rumble live-state pipeline (see
	// netlify/lib/config.mts). Falls back to sane defaults if that cache is
	// unreachable, never blocking a tip on it.
	const serverConfig = await getServerConfig();
	const { valid, cents } = validateAmountCents( b.amountCents, serverConfig.tipMinCents, serverConfig.tipMaxCents );
	if ( ! valid ) {
		return json( { error: 'invalid_amount' }, 400, cors );
	}

	if ( ! isValidIdempotencyKey( b.idempotencyKey ) ) {
		return json( { error: 'missing_idempotency_key' }, 400, cors );
	}

	const message = sanitizeTipMessage( b.message );

	// A valid session, if present, is the source of truth for who's tipping
	// and where a saved card gets linked — never trust the client's own
	// account claim, only what verifySession() itself resolves.
	const verified = typeof b.sessionToken === 'string' && b.sessionToken ? await verifySession( b.sessionToken ) : null;
	const user = verified?.user ?? null;
	const displayName = ( user && user.displayName ) || sanitizeDisplayName( b.displayName ) || 'A supporter';

	let result;
	let cardWasSaved = false;
	if ( user && b.saveCard === true ) {
		const customerId = await createOrReuseCustomer( user.squareCustomerId, user.email, user.displayName );
		const saved = customerId ? await saveCard( customerId, sourceId, `${ b.idempotencyKey }-card` ) : null;

		if ( saved && saved.success ) {
			// The nonce is spent by saveCard() above (Square nonces are
			// single-use) — charge the SAVED CARD's id from here on, never
			// the original nonce again.
			result = await createTip( saved.cardId, cents, message, b.idempotencyKey, saved.customerId );
			if ( result.success ) {
				await linkSquareCard( user.email, saved.customerId, saved.cardId, saved.last4 );
				cardWasSaved = true;
			}
		} else {
			// Card saving is a bonus, never a blocker — the nonce is still
			// intact here (nothing consumed it), so charge normally instead
			// of failing a tip just because "save my card" didn't work.
			console.error( '[tip-create] save-card failed, charging as one-time instead' );
			result = await createTip( sourceId, cents, message, b.idempotencyKey );
		}
	} else {
		result = await createTip( sourceId, cents, message, b.idempotencyKey );
	}

	if ( ! result.success ) {
		return json( { error: result.error }, 402, cors );
	}

	// Best-effort, and only once per idempotency key. A chat outage must
	// never undo or block a successful, already-completed charge — the
	// tipper already paid and must see success regardless of whether the
	// card made it into chat.
	if ( ! ( await alreadyPostedCard( b.idempotencyKey ) ) ) {
		try {
			await postTipCard( displayName, result.amountCents / 100, message );
		} catch ( error ) {
			console.error(
				'[tip-create] postTipCard failed (payment still succeeded):',
				error instanceof Error ? error.message : String( error )
			);
		}
	}

	// Slides the tipper's session too (Decision 11b) — the whole point is
	// that ANY authenticated request refreshes it, not chat alone.
	return json(
		{
			success: true,
			amountCents: result.amountCents,
			cardWasSaved,
			...( verified ? { sessionToken: verified.sessionToken } : {} ),
		},
		200,
		cors
	);
};

export const config: Config = {
	path: '/api/tip-create',
};
