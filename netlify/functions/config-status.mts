/**
 * config-status — plain-language "is everything wired up?" check for the
 * WordPress "Chat & Tips" admin panel, matching PHASE-3-BUILD-PLAN.md's
 * explicit rule: returns BOOLEANS ONLY, never a value. Even a masked or
 * partial secret must never appear in this response — the whole point of
 * keeping Stream/Square secrets in Netlify env vars only is that they never
 * travel back out, including "just to confirm it's right."
 *
 * Each check is a real, cheap API round-trip (see stream.mts/square.mts),
 * not just "is the env var set" — a typo'd or revoked secret shows up here
 * instead of only being discovered when a real visitor's chat or tip fails.
 *
 * Called server-side from WordPress via wp_remote_get() (same pattern as
 * settings-live-shows.php's poller-status check), so this doesn't sit
 * behind browser CORS the way chat-token/tip-create do — but carries the
 * same allowlist regardless, for consistency and in case that ever changes.
 */

import type { Config } from '@netlify/functions';
import { corsHeaders } from '../lib/cors.mts';
import { checkSquareConfigured } from '../lib/square.mts';
import { checkStreamConfigured } from '../lib/stream.mts';

export default async ( req: Request ) => {
	const cors = corsHeaders( req.headers.get( 'origin' ) );

	if ( req.method === 'OPTIONS' ) {
		return new Response( null, { status: 204, headers: cors } );
	}

	const [ streamOk, squareOk ] = await Promise.all( [ checkStreamConfigured(), checkSquareConfigured() ] );

	return new Response(
		JSON.stringify( { streamConfigured: streamOk, squareConfigured: squareOk } ),
		{
			status: 200,
			headers: {
				...cors,
				'content-type': 'application/json; charset=utf-8',
				'cache-control': 'no-store',
			},
		}
	);
};

export const config: Config = {
	path: '/api/config-status',
};
