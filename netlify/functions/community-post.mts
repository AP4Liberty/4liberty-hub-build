/**
 * community-post — creates a new Community post (PHASE-8-BUILD-PLAN.md
 * Task C). Login is REQUIRED, no anonymous path — deliberately different
 * from chat-token.mts's "try session, fall through to anonymous" shape,
 * because a post is permanent, public, and indexed (Decision 4), while
 * chat is ephemeral. The browser never talks to WordPress directly; this
 * is the only thing that does (Decision 2), and it holds the identity
 * secret WordPress must never see.
 *
 * Check order mirrors the plan exactly: session → paused → banned → rate
 * limit → link gate → sanitize → forward. Cheapest/most-decisive checks
 * first, same principle as chat-token.mts's own ordering.
 *
 * CORS is the same explicit allowlist every public endpoint in this project
 * uses (see ../lib/cors.mts) — never `*`.
 */

import type { Config, Context } from '@netlify/functions';
import { getServerConfig } from '../lib/config.mts';
import { corsHeaders } from '../lib/cors.mts';
import { createWordPressPost, hashEmailForModeratorCheck, sanitizePostBody, sanitizePostTitle, validateGifUrl } from '../lib/community.mts';
import { incrementPostCount, isBanned, syncModeratorRole, verifySession } from '../lib/identity.mts';
import { checkRateLimit } from '../lib/ratelimit.mts';

const CORS_OPTIONS = { methods: 'POST, OPTIONS', headers: 'content-type' };
const RATE_LIMIT_WINDOW_SECONDS = 3600; // 1 hour — matches the admin screen's "per hour" framing exactly

// A post containing a link is HELD (status: 'pending'), never rejected, if
// the account is younger than the admin-configured gate window — Decision
// 7.4, the single highest-value automatic spam control this feature has.
// Deliberately a loose match: a false positive just costs a moderator a
// few seconds, so simple beats clever here.
const URL_RE = /https?:\/\/|www\./i;

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

	// Self-healing: reflects whatever Austin's moderator list says as of the
	// last ~1-minute poll, every time (PHASE-8-BUILD-PLAN.md Task C notes in
	// the build plan).
	const isModerator = serverConfig.communityModeratorEmailHashes.includes( hashEmailForModeratorCheck( user.email ) );
	const syncedUser = await syncModeratorRole( user, isModerator );

	const { allowed } = await checkRateLimit(
		`community-post:${ syncedUser.userId }`,
		serverConfig.communityPostRateLimit,
		RATE_LIMIT_WINDOW_SECONDS
	);
	if ( ! allowed ) {
		return json( { error: 'rate_limited' }, 429, cors );
	}

	const title = sanitizePostTitle( b.title );
	const postBody = sanitizePostBody( b.body );
	if ( ! title || ! postBody ) {
		return json( { error: 'invalid_post' }, 400, cors );
	}

	// A missing/unrecognized topic is fine — WordPress falls back to
	// "general" itself (community-rest-routes.php); this file doesn't need
	// its own copy of that validation.
	const topic = typeof b.topic === 'string' && b.topic ? b.topic : undefined;
	// A GIF URL that fails the allowlist is dropped silently, same spirit as
	// an invalid topic — the post still goes through as text-only.
	const gifUrl = validateGifUrl( b.gifUrl ) ?? undefined;

	const accountAgeHours = ( Date.now() - new Date( syncedUser.createdAt ).getTime() ) / ( 1000 * 60 * 60 );
	// A GIF is a link too — it gets the exact same new-account hold a
	// pasted URL in the title/body would (PHASE-8-TASK-E-PLAN.md Decision 2:
	// "the same gate applies to _fl_gif_url with no new logic").
	const containsLink = URL_RE.test( title ) || URL_RE.test( postBody ) || !! gifUrl;
	const status = containsLink && accountAgeHours < serverConfig.communityGateHours ? 'pending' : 'publish';

	const created = await createWordPressPost( {
		userId: syncedUser.userId,
		displayName: syncedUser.displayName,
		role: syncedUser.role,
		title,
		body: postBody,
		status,
		topic,
		gifUrl,
	} );
	if ( ! created ) {
		return json( { error: 'post_failed' }, 502, cors );
	}

	try {
		await incrementPostCount( syncedUser.email );
	} catch ( error ) {
		// Best-effort — the post already succeeded in WordPress, this is
		// just bookkeeping, same fail-safe spirit as tip-create.mts's
		// postTipCard call.
		console.error( '[community-post] incrementPostCount failed (post still succeeded):', error instanceof Error ? error.message : String( error ) );
	}

	return json( { success: true, ...created, sessionToken }, 200, cors );
};

export const config: Config = {
	path: '/api/community-post',
};
