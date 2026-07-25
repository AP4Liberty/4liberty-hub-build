/**
 * auth-request — the first half of the magic-link login (PHASE-3-BUILD-PLAN.md
 * Decision 6). Mints a short-lived, signed magic-link token and emails it via
 * Klaviyo (see ../lib/email.mts). Never reveals whether an email already has
 * an account — the response is the same shape either way.
 *
 * Rate-limited by BOTH IP and email: by IP to blunt a scripted flood, and by
 * email specifically so this endpoint can't be used to spam a victim's own
 * inbox with repeated login links (Decision 6's explicit requirement).
 *
 * CORS is the same explicit allowlist every public endpoint in this project
 * uses (see ../lib/cors.mts) — never `*`.
 */

import type { Config, Context } from '@netlify/functions';
import { corsHeaders } from '../lib/cors.mts';
import { sendMagicLinkEmail } from '../lib/email.mts';
import { createLoginCode, sanitizeEmail, sanitizeReturnPath, signMagicLinkToken } from '../lib/identity.mts';
import { checkRateLimit } from '../lib/ratelimit.mts';
import { sanitizeDisplayName } from '../lib/stream.mts';

const CORS_OPTIONS = { methods: 'POST, OPTIONS', headers: 'content-type' };
const IP_RATE_LIMIT_MAX = 10;
const IP_RATE_LIMIT_WINDOW_SECONDS = 900; // 15 minutes
const EMAIL_RATE_LIMIT_MAX = 3;
const EMAIL_RATE_LIMIT_WINDOW_SECONDS = 900;

// Where a visitor lands after clicking the magic link. Defaults to the
// homepage; a caller can request a different (allowlisted — see
// sanitizeReturnPath in ../lib/identity.mts) destination via returnPath, so
// e.g. someone who tried to post from /community/ before logging in comes
// back to /community/ instead of the homepage (PHASE-8-BUILD-PLAN.md
// Decision 9). Validated with an EXACT-match allowlist, not a generic
// "starts with /" check — an open redirect on a login flow is a real
// phishing tool, not just a nuisance bug.
const SITE_ORIGIN = 'https://4libertynetwork.com';
const DEFAULT_RETURN_PATH = '/';
const VERIFY_PARAM = 'fl_verify';

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

	const ipLimit = await checkRateLimit( `auth-request:ip:${ context.ip }`, IP_RATE_LIMIT_MAX, IP_RATE_LIMIT_WINDOW_SECONDS );
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

	const email = sanitizeEmail( b.email );
	if ( ! email ) {
		return json( { error: 'invalid_email' }, 400, cors );
	}

	const emailLimit = await checkRateLimit( `auth-request:email:${ email }`, EMAIL_RATE_LIMIT_MAX, EMAIL_RATE_LIMIT_WINDOW_SECONDS );
	if ( ! emailLimit.allowed ) {
		// Deliberately the SAME shape as a normal rate limit — don't let a
		// different response reveal "this specific email is being targeted."
		return json( { error: 'rate_limited' }, 429, cors );
	}

	// Carries the visitor's already-typed anonymous chat name forward, per
	// PHASE-3-BUILD-PLAN.md's "the account is an optional upgrade" flow —
	// empty is fine, verifyMagicLinkAndCreateSession() falls back sensibly.
	const displayName = sanitizeDisplayName( b.displayName ) || '';
	const returnPath = sanitizeReturnPath( b.returnPath ) ?? DEFAULT_RETURN_PATH;

	const token = signMagicLinkToken( email, displayName );
	const magicLinkUrl = `${ SITE_ORIGIN }${ returnPath }?${ VERIFY_PARAM }=${ encodeURIComponent( token ) }`;

	// The code is just an alternate way to redeem the SAME token (see
	// createLoginCode()'s own doc comment) — generated even though most
	// visitors will just click the link, since the email always offers both
	// (PHASE-8-BUILD-PLAN.md Decision 11a).
	const loginCode = await createLoginCode( email, token );

	const sent = await sendMagicLinkEmail( email, magicLinkUrl, loginCode );
	if ( ! sent ) {
		// Honest, unlike a failed chat/tip attempt — silently claiming success
		// on a login's one and only delivery mechanism would strand a visitor
		// waiting for an email that will never come, with no way to know why.
		// This doesn't leak whether the email HAS an account (Klaviyo's event
		// API accepts any well-formed address, so failure here is a Klaviyo/
		// config problem, not an "unknown user" signal).
		return json( { error: 'email_failed' }, 502, cors );
	}

	return json( { success: true }, 200, cors );
};

export const config: Config = {
	path: '/api/auth-request',
};
