/**
 * community-reply — creates a reply on an existing Community post
 * (PHASE-8-BUILD-PLAN.md Task C). Same trust model and check ordering as
 * community-post.mts (see that file's header) — login required, no
 * anonymous path. Uses its OWN admin-configured rate limit
 * (communityReplyRateLimit, not communityPostRateLimit) and its own link
 * gate, but the SAME gate-hours window and the same moderator-role sync.
 *
 * postId is validated against WordPress itself (community-rest-routes.php
 * rejects anything that isn't a real, non-trashed community post) — this
 * file only checks it's a plausible positive integer before spending a
 * round trip on it.
 *
 * CORS is the same explicit allowlist every public endpoint in this project
 * uses (see ../lib/cors.mts) — never `*`.
 */

import type { Config, Context } from '@netlify/functions';
import { getServerConfig } from '../lib/config.mts';
import { corsHeaders } from '../lib/cors.mts';
import { createWordPressReply, hashEmailForModeratorCheck, sanitizeReplyBody, validateGifUrl } from '../lib/community.mts';
import { getUserByUserId, isBanned, syncModeratorRole, verifySession } from '../lib/identity.mts';
import { sendCommunityReplyNotification } from '../lib/email.mts';
import { markNotified, wasRecentlyNotified } from '../lib/notify-dedupe.mts';
import { checkRateLimit } from '../lib/ratelimit.mts';

const CORS_OPTIONS = { methods: 'POST, OPTIONS', headers: 'content-type' };
const RATE_LIMIT_WINDOW_SECONDS = 3600;
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

	const postId = typeof b.postId === 'number' && Number.isInteger( b.postId ) && b.postId > 0 ? b.postId : null;
	if ( ! postId ) {
		return json( { error: 'invalid_post_id' }, 400, cors );
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

	const isModerator = serverConfig.communityModeratorEmailHashes.includes( hashEmailForModeratorCheck( user.email ) );
	const syncedUser = await syncModeratorRole( user, isModerator );

	const { allowed } = await checkRateLimit(
		`community-reply:${ syncedUser.userId }`,
		serverConfig.communityReplyRateLimit,
		RATE_LIMIT_WINDOW_SECONDS
	);
	if ( ! allowed ) {
		return json( { error: 'rate_limited' }, 429, cors );
	}

	const replyBody = sanitizeReplyBody( b.body );
	if ( ! replyBody ) {
		return json( { error: 'invalid_reply' }, 400, cors );
	}

	// A GIF that fails the allowlist is dropped silently — the reply still
	// goes through as text-only, same as an invalid one on community-post.mts.
	const gifUrl = validateGifUrl( b.gifUrl ) ?? undefined;

	const accountAgeHours = ( Date.now() - new Date( syncedUser.createdAt ).getTime() ) / ( 1000 * 60 * 60 );
	// A GIF is a link too — same new-account hold a pasted URL gets
	// (PHASE-8-TASK-E-PLAN.md Decision 2).
	const containsLink = URL_RE.test( replyBody ) || !! gifUrl;
	const status = containsLink && accountAgeHours < serverConfig.communityGateHours ? 'pending' : 'publish';

	const created = await createWordPressReply( {
		postId,
		userId: syncedUser.userId,
		displayName: syncedUser.displayName,
		role: syncedUser.role,
		body: replyBody,
		status,
		gifUrl,
	} );
	if ( ! created ) {
		return json( { error: 'reply_failed' }, 502, cors );
	}

	// Best-effort "someone replied to your post" email (Phase 8, Task E) —
	// never blocks or fails the reply itself, same fail-safe spirit as
	// community-post.mts's incrementPostCount call. Skipped entirely for a
	// HELD reply (status 'pending') — the post author shouldn't be notified
	// about something not yet visible to them either.
	if ( created.postAuthorUserId && created.postAuthorUserId !== syncedUser.userId && 'publish' === created.status ) {
		try {
			const author = await getUserByUserId( created.postAuthorUserId );
			if ( author && false !== author.notifyOnReply ) {
				const dedupeKey = `${ author.userId }:${ postId }`;
				const recent = await wasRecentlyNotified( dedupeKey );
				if ( ! recent ) {
					await sendCommunityReplyNotification(
						author.email,
						created.postTitle,
						created.postUrl,
						syncedUser.displayName,
						replyBody.slice( 0, 140 )
					);
					await markNotified( dedupeKey );
				}
			}
		} catch ( error ) {
			console.error( '[community-reply] notification best-effort failed:', error instanceof Error ? error.message : String( error ) );
		}
	}

	return json( { success: true, ...created, sessionToken }, 200, cors );
};

export const config: Config = {
	path: '/api/community-reply',
};
