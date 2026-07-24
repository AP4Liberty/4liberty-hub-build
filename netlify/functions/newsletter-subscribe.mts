/**
 * newsletter-subscribe — "The Daily Brief" signup on the homepage. Subscribes
 * an email to the dedicated Klaviyo list (see ../lib/newsletter.mts).
 *
 * Rate-limited by IP only — unlike auth-request.mts, a repeat subscribe for
 * the same email is harmless/idempotent on Klaviyo's side (no repeat email
 * gets sent the way a repeat login-link would), so no per-email limit is
 * needed; the IP limit alone is enough to blunt scripted abuse.
 *
 * CORS is the same explicit allowlist every public endpoint in this project
 * uses (see ../lib/cors.mts) — never `*`.
 */

import type { Config, Context } from '@netlify/functions';
import { corsHeaders } from '../lib/cors.mts';
import { sanitizeEmail } from '../lib/identity.mts';
import { subscribeToNewsletter } from '../lib/newsletter.mts';
import { checkRateLimit } from '../lib/ratelimit.mts';

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

	const { allowed } = await checkRateLimit( `newsletter-subscribe:${ context.ip }`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS );
	if ( ! allowed ) {
		return json( { error: 'rate_limited' }, 429, cors );
	}

	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return json( { error: 'invalid_json' }, 400, cors );
	}

	const email = sanitizeEmail( ( body as Record< string, unknown > )?.email );
	if ( ! email ) {
		return json( { error: 'invalid_email' }, 400, cors );
	}

	const subscribed = await subscribeToNewsletter( email );
	if ( ! subscribed ) {
		return json( { error: 'subscribe_failed' }, 502, cors );
	}

	return json( { success: true }, 200, cors );
};

export const config: Config = {
	path: '/api/newsletter-subscribe',
};
