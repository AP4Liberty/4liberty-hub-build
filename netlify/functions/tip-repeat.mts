/**
 * tip-repeat — one-tap charge of a LOGGED-IN visitor's saved card (Task F,
 * PHASE-3-BUILD-PLAN.md item 17). No sourceId/nonce from the client at all —
 * the whole point is charging the card already on file, looked up server-
 * side from the session, never anything the client could substitute.
 *
 * Otherwise the same trust rules as tip-create.mts: server-validated amount,
 * an idempotency key, and a tip card posted to chat only after Square
 * confirms the charge, only by this server.
 *
 * CORS is the same explicit allowlist every public endpoint in this project
 * uses (see ../lib/cors.mts) — never `*`.
 */

import type { Config, Context } from '@netlify/functions';
import { getServerConfig } from '../lib/config.mts';
import { corsHeaders } from '../lib/cors.mts';
import { verifySession } from '../lib/identity.mts';
import { checkRateLimit } from '../lib/ratelimit.mts';
import { createTip, isValidIdempotencyKey, sanitizeTipMessage, validateAmountCents } from '../lib/square.mts';
import { alreadyPostedCard, postTipCard } from '../lib/stream.mts';

const CORS_OPTIONS = { methods: 'POST, OPTIONS', headers: 'content-type' };
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_SECONDS = 300; // 5 minutes — same bounds as tip-create.mts

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

	const { allowed } = await checkRateLimit( `tip-repeat:${ context.ip }`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS );
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

	const verified = typeof b.sessionToken === 'string' && b.sessionToken ? await verifySession( b.sessionToken ) : null;
	if ( ! verified ) {
		return json( { error: 'not_logged_in' }, 401, cors );
	}
	const { user, sessionToken } = verified;
	if ( ! user.squareCardId || ! user.squareCustomerId ) {
		return json( { error: 'no_saved_card' }, 400, cors );
	}

	if ( ! isValidIdempotencyKey( b.idempotencyKey ) ) {
		return json( { error: 'missing_idempotency_key' }, 400, cors );
	}

	// Same admin-configured bounds as tip-create.mts (netlify/lib/config.mts).
	const serverConfig = await getServerConfig();
	const { valid, cents } = validateAmountCents( b.amountCents, serverConfig.tipMinCents, serverConfig.tipMaxCents );
	if ( ! valid ) {
		return json( { error: 'invalid_amount' }, 400, cors );
	}

	const message = sanitizeTipMessage( b.message );

	const result = await createTip( user.squareCardId, cents, message, b.idempotencyKey, user.squareCustomerId );
	if ( ! result.success ) {
		return json( { error: result.error }, 402, cors );
	}

	// Best-effort, and only once per idempotency key — same reasoning as
	// tip-create.mts: a chat outage must never undo or block an already-
	// completed charge.
	if ( ! ( await alreadyPostedCard( b.idempotencyKey ) ) ) {
		try {
			await postTipCard( user.displayName, result.amountCents / 100, message );
		} catch ( error ) {
			console.error(
				'[tip-repeat] postTipCard failed (payment still succeeded):',
				error instanceof Error ? error.message : String( error )
			);
		}
	}

	// Slides the tipper's session too (Decision 11b) — the whole point is
	// that ANY authenticated request refreshes it, not chat alone.
	return json( { success: true, amountCents: result.amountCents, sessionToken }, 200, cors );
};

export const config: Config = {
	path: '/api/tip-repeat',
};
