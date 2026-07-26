/**
 * account-settings — lets a logged-in member change their own
 * notification preference (Phase 8, Task E). Deliberately narrow: the only
 * field this accepts today is notifyOnReply, not a general profile-update
 * endpoint — build exactly what's needed, same scope discipline as the
 * rest of this project's endpoints.
 *
 * Same shape as community-post.mts: require a valid session, rate-limit,
 * validate, forward — nothing here trusts the client beyond "does this
 * session token verify."
 *
 * CORS is the same explicit allowlist every public endpoint in this project
 * uses (see ../lib/cors.mts) — never `*`.
 */

import type { Config, Context } from '@netlify/functions';
import { corsHeaders } from '../lib/cors.mts';
import { updateNotifyOnReply, verifySession } from '../lib/identity.mts';
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

	const { allowed } = await checkRateLimit( `account-settings:${ context.ip }`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS );
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
	if ( typeof b.notifyOnReply !== 'boolean' ) {
		return json( { error: 'invalid_notify_on_reply' }, 400, cors );
	}

	await updateNotifyOnReply( verified.user.email, b.notifyOnReply );

	return json( { success: true, notifyOnReply: b.notifyOnReply, sessionToken: verified.sessionToken }, 200, cors );
};

export const config: Config = {
	path: '/api/account-settings',
};
