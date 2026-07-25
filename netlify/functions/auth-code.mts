/**
 * auth-code — completes login via the 6-digit code sent alongside the magic
 * link (PHASE-8-BUILD-PLAN.md Decision 11a). Exists because tapping the
 * link inside an email app's OWN in-app browser (Gmail's, etc.) completes
 * login in THAT browser's localStorage, not the one the visitor typed their
 * email into — the #1 real-world magic-link failure mode. A typed code
 * never leaves the page.
 *
 * Six digits is a million guesses — brute-forceable in a way a signed token
 * is not — so this is rate-limited by BOTH IP and email, tighter than
 * auth-verify.mts's link-based path. See ../lib/identity.mts's
 * verifyLoginCode() for the burn-on-first-lookup mechanics; this file only
 * owns the rate limiting and the HTTP shape.
 *
 * CORS is the same explicit allowlist every public endpoint in this project
 * uses (see ../lib/cors.mts) — never `*`.
 */

import type { Config, Context } from '@netlify/functions';
import { corsHeaders } from '../lib/cors.mts';
import { sanitizeEmail, verifyLoginCode } from '../lib/identity.mts';
import { checkRateLimit } from '../lib/ratelimit.mts';

const CORS_OPTIONS = { methods: 'POST, OPTIONS', headers: 'content-type' };
const IP_RATE_LIMIT_MAX = 20;
const IP_RATE_LIMIT_WINDOW_SECONDS = 900; // 15 minutes
// Matches PHASE-8-BUILD-PLAN.md's "cap attempts per email (5)".
const EMAIL_RATE_LIMIT_MAX = 5;
const EMAIL_RATE_LIMIT_WINDOW_SECONDS = 900;

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

	const ipLimit = await checkRateLimit( `auth-code:ip:${ context.ip }`, IP_RATE_LIMIT_MAX, IP_RATE_LIMIT_WINDOW_SECONDS );
	if ( ! ipLimit.allowed ) {
		return json( { error: 'rate_limited' }, 429, cors );
	}

	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return json( { error: 'invalid_json' }, 400, cors );
	}
	const b = body as Record< string, unknown >;

	// Sanitized (and rejected early on bad shape) BEFORE the email-scoped
	// limit, same order as auth-request.mts — a malformed email never gets
	// its own rate-limit bucket, only a genuinely well-formed target does.
	const email = sanitizeEmail( b.email );
	if ( ! email ) {
		return json( { error: 'invalid_or_expired_code' }, 401, cors );
	}

	const emailLimit = await checkRateLimit( `auth-code:email:${ email }`, EMAIL_RATE_LIMIT_MAX, EMAIL_RATE_LIMIT_WINDOW_SECONDS );
	if ( ! emailLimit.allowed ) {
		return json( { error: 'rate_limited' }, 429, cors );
	}

	const result = await verifyLoginCode( email, b.code );
	if ( ! result ) {
		return json( { error: 'invalid_or_expired_code' }, 401, cors );
	}

	return json( { success: true, ...result }, 200, cors );
};

export const config: Config = {
	path: '/api/auth-code',
};
