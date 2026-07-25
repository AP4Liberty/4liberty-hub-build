/**
 * chat-token — mints a Stream Chat user token for the on-site hub chat.
 *
 * Two paths: anonymous/open (a typed display name, no account — Task C) and
 * authenticated (a valid session token — Task F, PHASE-3-BUILD-PLAN.md item
 * 16), tried in that order so a logged-in visitor always gets their stable,
 * persistent identity + supporter badge instead of a fresh guest each visit.
 * The gate toggle (open vs. members-only chat) is enforced here for exactly
 * that reason: a server-side check can't be bypassed from the client the
 * way a front-end-only toggle could.
 *
 * CORS is the same explicit allowlist every public endpoint in this project
 * uses (see ../lib/cors.mts) — never `*`.
 */

import type { Config, Context } from '@netlify/functions';
import { getServerConfig } from '../lib/config.mts';
import { corsHeaders } from '../lib/cors.mts';
import { isBanned, verifySession } from '../lib/identity.mts';
import { checkRateLimit } from '../lib/ratelimit.mts';
import { mintAuthenticatedToken, mintGuestToken, sanitizeDisplayName } from '../lib/stream.mts';

const CORS_OPTIONS = { methods: 'POST, OPTIONS', headers: 'content-type' };
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_SECONDS = 300; // 5 minutes — generous for a few tabs/reloads, not for a script

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

	// Admin-configured mode (Task G's settings form, Task H's gated-mode
	// dropdown), bridged from WordPress the same way as tip-create.mts's
	// amount bounds (see netlify/lib/config.mts).
	const { mode } = await getServerConfig();

	const { allowed } = await checkRateLimit( `chat-token:${ context.ip }`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS );
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

	// Tried first, regardless of mode — a logged-in visitor always gets
	// their stable identity. Falls through (not a hard error) on a missing
	// or stale/expired session token, so a visitor whose 30-day session just
	// lapsed isn't locked out of "open" chat, only "gated" chat. A BANNED
	// session is different — that's a real, recognized identity being
	// deliberately refused, so it fails hard instead of quietly falling
	// through to an anonymous mint (PHASE-8-BUILD-PLAN.md Decision 7).
	if ( typeof b.sessionToken === 'string' && b.sessionToken ) {
		const verified = await verifySession( b.sessionToken );
		if ( verified ) {
			const { user, sessionToken } = verified;
			if ( isBanned( user ) ) {
				return json( { error: 'account_banned' }, 403, cors );
			}
			try {
				const authed = await mintAuthenticatedToken( user );
				return json(
					{ ...authed, hasSavedCard: !! user.squareCardId, cardLast4: user.cardLast4, sessionToken },
					200,
					cors
				);
			} catch ( error ) {
				console.error( '[chat-token] authenticated mint failed:', error instanceof Error ? error.message : String( error ) );
				return json( { error: 'chat_unavailable' }, 503, cors );
			}
		}
	}

	if ( mode === 'gated' ) {
		// No valid session reached this point — gated chat requires one
		// (PHASE-3-BUILD-PLAN.md Decision 3). Fails closed: no anonymous
		// post-capable token is ever handed out in gated mode.
		return json( { error: 'chat_is_members_only' }, 403, cors );
	}

	const displayName = sanitizeDisplayName( b.displayName );
	if ( ! displayName ) {
		return json( { error: 'invalid_display_name' }, 400, cors );
	}

	try {
		const guest = await mintGuestToken( displayName );
		return json( { ...guest, hasSavedCard: false }, 200, cors );
	} catch ( error ) {
		console.error( '[chat-token] mint failed:', error instanceof Error ? error.message : String( error ) );
		return json( { error: 'chat_unavailable' }, 503, cors );
	}
};

export const config: Config = {
	path: '/api/chat-token',
};
