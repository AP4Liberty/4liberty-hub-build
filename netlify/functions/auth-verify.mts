/**
 * auth-verify — the second half of the magic-link login. Exchanges a
 * magic-link token (from the emailed link) for a session token, creating
 * the user's identity record on first login (PHASE-3-BUILD-PLAN.md
 * Decision 6). See ../lib/identity.mts for the token/session mechanics and
 * the one-time-use nonce (documented best-effort caveat).
 *
 * Rate-limited by IP — a valid signature is computationally infeasible to
 * brute-force, but this still bounds how much a garbage-token flood can
 * cost in Blobs reads.
 *
 * CORS is the same explicit allowlist every public endpoint in this project
 * uses (see ../lib/cors.mts) — never `*`.
 */

import type { Config, Context } from '@netlify/functions';
import { corsHeaders } from '../lib/cors.mts';
import { verifyMagicLinkAndCreateSession } from '../lib/identity.mts';
import { checkRateLimit } from '../lib/ratelimit.mts';

const CORS_OPTIONS = { methods: 'POST, OPTIONS', headers: 'content-type' };
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_SECONDS = 300;

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

	const { allowed } = await checkRateLimit( `auth-verify:${ context.ip }`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS );
	if ( ! allowed ) {
		return json( { error: 'rate_limited' }, 429, cors );
	}

	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return json( { error: 'invalid_json' }, 400, cors );
	}

	const result = await verifyMagicLinkAndCreateSession( ( body as Record< string, unknown > )?.token );
	if ( ! result ) {
		return json( { error: 'invalid_or_expired_link' }, 401, cors );
	}

	return json( { success: true, ...result }, 200, cors );
};

export const config: Config = {
	path: '/api/auth-verify',
};
