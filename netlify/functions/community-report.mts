/**
 * community-report — the report-button backend (PHASE-8-BUILD-PLAN.md Task
 * D). Login required, same trust model as community-post.mts/community-
 * reply.mts: session → paused → banned → rate limit → forward to
 * WordPress, which increments _fl_flags (Task B's admin-list "Reports"
 * column is where a moderator actually sees this).
 *
 * No content to sanitize and no link gate — reporting is just "flag this
 * existing thing," so this pipeline is deliberately the shortest of the
 * three community write endpoints. The rate limit is a fixed constant, not
 * an admin-configurable field like the post/reply limits — nothing in this
 * project's plan ever asked Austin to tune how fast someone can report,
 * and inventing a setting nobody asked for isn't worth the extra admin-UI
 * surface.
 *
 * CORS is the same explicit allowlist every public endpoint in this project
 * uses (see ../lib/cors.mts) — never `*`.
 */

import type { Config, Context } from '@netlify/functions';
import { getServerConfig } from '../lib/config.mts';
import { corsHeaders } from '../lib/cors.mts';
import { createWordPressReport } from '../lib/community.mts';
import { isBanned, verifySession } from '../lib/identity.mts';
import { checkRateLimit } from '../lib/ratelimit.mts';

const CORS_OPTIONS = { methods: 'POST, OPTIONS', headers: 'content-type' };
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_SECONDS = 3600;

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

	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return json( { error: 'invalid_json' }, 400, cors );
	}
	const b = body as Record< string, unknown >;

	const targetType = b.targetType === 'comment' ? 'comment' : 'post';
	const targetId = typeof b.targetId === 'number' && Number.isInteger( b.targetId ) && b.targetId > 0 ? b.targetId : null;
	if ( ! targetId ) {
		return json( { error: 'invalid_target' }, 400, cors );
	}

	const verified = typeof b.sessionToken === 'string' && b.sessionToken ? await verifySession( b.sessionToken ) : null;
	if ( ! verified ) {
		return json( { error: 'not_logged_in' }, 401, cors );
	}
	const { user, sessionToken } = verified;

	const serverConfig = await getServerConfig();
	if ( serverConfig.communityPaused ) {
		return json( { error: 'community_paused' }, 403, cors );
	}
	if ( isBanned( user ) ) {
		return json( { error: 'account_banned' }, 403, cors );
	}

	const { allowed } = await checkRateLimit( `community-report:${ user.userId }`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS );
	if ( ! allowed ) {
		return json( { error: 'rate_limited' }, 429, cors );
	}

	const reported = await createWordPressReport( targetType, targetId );
	if ( ! reported ) {
		return json( { error: 'report_failed' }, 502, cors );
	}

	return json( { success: true, sessionToken }, 200, cors );
};

export const config: Config = {
	path: '/api/community-report',
};
