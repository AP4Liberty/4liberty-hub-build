/**
 * Stream Chat server-side wrapper — the ONLY code that ever holds
 * STREAM_API_SECRET. Mints user tokens and ensures the single hub channel
 * exists.
 *
 * See PHASE-3-BUILD-PLAN.md Decision 5 (one persistent channel for the whole
 * hub, not one per show) and Decision 3 (this file backs both the anonymous
 * path built in Task C and the authenticated path Task F adds alongside it).
 */

import { getStore } from '@netlify/blobs';
import { StreamChat } from 'stream-chat';
import type { UserRecord } from './identity.mts';

export const CHANNEL_TYPE = 'livestream';
export const CHANNEL_ID = 'hub';
const SYSTEM_USER_ID = 'system-4liberty-hub';
const POSTED_CARDS_STORE = 'tip-cards-posted';

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 30;

let client: StreamChat | null = null;

function getClient(): StreamChat {
	if ( client ) {
		return client;
	}
	const apiKey = Netlify.env.get( 'STREAM_API_KEY' );
	const apiSecret = Netlify.env.get( 'STREAM_API_SECRET' );
	if ( ! apiKey || ! apiSecret ) {
		throw new Error( 'Stream is not configured (missing STREAM_API_KEY/STREAM_API_SECRET).' );
	}
	client = StreamChat.getInstance( apiKey, apiSecret );
	return client;
}

/** Just the publishable key — safe to hand to the browser. */
export function getPublicApiKey(): string | null {
	return Netlify.env.get( 'STREAM_API_KEY' ) ?? null;
}

/**
 * A REAL check, not just "is an env var set" — upserting the system user is
 * a cheap, already-safe, idempotent call (the same one ensureHubChannel()
 * makes on every token mint), so a genuinely invalid or revoked secret
 * shows up here rather than only being discovered when a real visitor's
 * chat breaks. Used by config-status.mts for the admin panel's status line.
 */
export async function checkStreamConfigured(): Promise< boolean > {
	try {
		const c = getClient();
		await c.upsertUser( { id: SYSTEM_USER_ID, name: '4Liberty Network', role: 'admin' } );
		return true;
	} catch {
		return false;
	}
}

/**
 * A display name is the one piece of this whole flow a visitor fully
 * controls. Trim it, bound its length, and collapse internal whitespace —
 * Stream itself is the source of truth for what's ultimately rendered, but a
 * wildly long or empty name is a self-inflicted UX bug worth catching here
 * rather than a security boundary that needs more than this.
 */
export function sanitizeDisplayName( raw: unknown ): string | null {
	if ( typeof raw !== 'string' ) {
		return null;
	}
	const trimmed = raw.trim().replace( /\s+/g, ' ' );
	if ( trimmed.length < MIN_NAME_LENGTH || trimmed.length > MAX_NAME_LENGTH ) {
		return null;
	}
	return trimmed;
}

function randomGuestId(): string {
	return `guest-${ crypto.randomUUID().slice( 0, 8 ) }`;
}

/**
 * Ensures the single shared hub channel exists. Idempotent — Stream's
 * channel.create() on an already-existing channel returns its current state
 * rather than erroring, so this is safe to call on every token mint instead
 * of needing a separate one-time setup step someone could forget to run.
 */
async function ensureHubChannel( c: StreamChat ): Promise< void > {
	await c.upsertUser( { id: SYSTEM_USER_ID, name: '4Liberty Network', role: 'admin' } );
	const channel = c.channel( CHANNEL_TYPE, CHANNEL_ID, {
		created_by_id: SYSTEM_USER_ID,
		name: '4Liberty Network Hub',
	} as any );
	await channel.create();
}

export interface GuestToken {
	apiKey: string;
	userId: string;
	userName: string;
	token: string;
	channelType: string;
	channelId: string;
}

/**
 * Mints a token for an ephemeral, unauthenticated guest identity — a fresh
 * Stream user on every call, by design (PHASE-3-BUILD-PLAN.md Decision 3:
 * "no persistence"). Task F adds the authenticated counterpart alongside
 * this, keyed off a real session token instead of a typed name.
 */
export async function mintGuestToken( displayName: string ): Promise< GuestToken > {
	const c = getClient();
	const userId = randomGuestId();

	await Promise.all( [ c.upsertUser( { id: userId, name: displayName, role: 'user' } ), ensureHubChannel( c ) ] );

	return {
		apiKey: getPublicApiKey() as string,
		userId,
		userName: displayName,
		token: c.createToken( userId ),
		channelType: CHANNEL_TYPE,
		channelId: CHANNEL_ID,
	};
}

/**
 * Mints a token for a logged-in visitor's STABLE identity — the opposite of
 * mintGuestToken's "fresh user every call": reusing user.streamUserId means
 * the same account always shows up as the same Stream user (persistent chat
 * identity, PHASE-3-BUILD-PLAN.md Task F item 16), and other viewers'
 * clients see whatever this upsert sets on it, including just now.
 *
 * `supporter` is a plain custom field Stream stores alongside its known
 * user schema — chat.js's knownBadge() already reads message.user.supporter
 * on every rendered message, so setting it here is the entire "supporter
 * badge" feature; nothing on the client needed to change to light it up.
 */
export async function mintAuthenticatedToken( user: UserRecord ): Promise< GuestToken > {
	const c = getClient();
	const userId = user.streamUserId;

	await Promise.all( [
		c.upsertUser( { id: userId, name: user.displayName, role: 'user', supporter: user.supporter } as any ),
		ensureHubChannel( c ),
	] );

	return {
		apiKey: getPublicApiKey() as string,
		userId,
		userName: user.displayName,
		token: c.createToken( userId ),
		channelType: CHANNEL_TYPE,
		channelId: CHANNEL_ID,
	};
}

/**
 * Have we already posted a tip card for this idempotency key? Shared by
 * tip-create.mts and tip-repeat.mts so a retried request (client-side retry
 * after a network blip, or an impatient double-click/double-tap) can't post
 * the same "X tipped $Y" card into chat twice — cosmetic, not financial
 * (Square's own idempotency key already prevents double-CHARGING), but
 * worth the small check.
 *
 * Uses `consistency: 'strong'` — direct testing during Task D found Netlify
 * Blobs' DEFAULT ('eventual') read can lag up to 60 seconds behind a write,
 * even within the same invocation. BEST-EFFORT even so, since get-then-set
 * still has no atomic "only if absent" primitive in this Blobs SDK — but the
 * remaining gap is genuine simultaneity, not "anything less than a minute
 * apart."
 */
export async function alreadyPostedCard( idempotencyKey: string ): Promise< boolean > {
	const store = getStore( { name: POSTED_CARDS_STORE, consistency: 'strong' } );
	try {
		const seen = await store.get( idempotencyKey );
		if ( seen ) {
			return true;
		}
	} catch {
		// Fail open — prefer a rare duplicate card over silently dropping a
		// legitimate tip's card.
	}
	try {
		await store.set( idempotencyKey, '1' );
	} catch {
		// Nothing to do — worst case a genuine retry double-posts the card.
	}
	return false;
}

/**
 * Posts a highlighted "tip the show" card into the shared hub channel, sent
 * AS the system user via server-side credentials — never as the tipper (an
 * anonymous tipper may not even be connected to chat at all). Only ever
 * called from tip-create.mts, and only after Square has confirmed a real
 * charge (PHASE-3-BUILD-PLAN.md Decision 4) — there is no client-writable
 * path that produces this message, so a visitor can never forge "X tipped
 * $Y" in chat.
 *
 * `fl_tip`/`fl_tip_amount` are custom fields (same pattern as chat.js's
 * fl_reaction_burst marker) a future admin/moderation view could use to
 * distinguish tip cards from ordinary messages; nothing reads them yet.
 *
 * `user_id` on a server-authenticated sendMessage attributes the message to
 * that user without connecting as them — a long-documented Stream server-
 * side capability. It's not reflected in this SDK's TypeScript Message type
 * (an SDK type-completeness gap, not a missing feature), hence the cast.
 */
export async function postTipCard( name: string, amountDollars: number, message: string ): Promise< void > {
	const c = getClient();
	await ensureHubChannel( c );
	const channel = c.channel( CHANNEL_TYPE, CHANNEL_ID );
	const amountLabel = amountDollars.toFixed( 2 );
	await channel.sendMessage( {
		text: `💰 ${ name } tipped $${ amountLabel }${ message ? `: ${ message }` : '' }`,
		user_id: SYSTEM_USER_ID,
		fl_tip: true,
		fl_tip_amount: amountDollars,
		fl_tip_name: name,
	} as any );
}
