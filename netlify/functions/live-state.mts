/**
 * live-state — the public read endpoint the WordPress homepage fetches.
 *
 * Serves the sanitized blob written by poll-rumble. This function has NO
 * access to any Rumble URL and performs no outbound requests; the only thing
 * it can possibly disclose is the already-sanitized payload.
 *
 * Why the browser calls this directly instead of WordPress proxying it:
 * polling load is deliberately kept off the GoDaddy host, and — proven at the
 * Phase 1 cutover — GoDaddy's CDN (fronted by Sucuri) can serve stale HTML for
 * a long time. Live state rendered into the page would then show "LIVE" hours
 * after a show ended. Fetching client-side keeps the page shell infinitely
 * cacheable while the live state stays fresh.
 *
 * CORS is an explicit allowlist, never `*`.
 */

import { getStore } from '@netlify/blobs';
import type { Config, Context } from '@netlify/functions';
import type { LiveStatePayload } from '../lib/sanitize.mts';

const STORE_NAME = 'live-state';
const BLOB_KEY = 'current';

const DEFAULT_ALLOWED_ORIGINS = [
	'https://wakeupamericashow.com',
	'https://www.wakeupamericashow.com',
	'https://4libertynetwork.com',
	'https://www.4libertynetwork.com',
];

/**
 * Extra origins (staging hosts, mainly) come from an env var so a staging
 * hostname change doesn't need a code deploy — GoDaddy staging hostnames
 * change every time the staging site is recreated, which during the July 2026
 * security incident happened four times.
 */
function allowedOrigins(): string[] {
	const extra = ( Netlify.env.get( 'ALLOWED_ORIGINS' ) ?? '' )
		.split( ',' )
		.map( ( o ) => o.trim() )
		.filter( Boolean );
	return [ ...DEFAULT_ALLOWED_ORIGINS, ...extra ];
}

function corsHeaders( origin: string | null ): Record< string, string > {
	if ( origin && allowedOrigins().includes( origin ) ) {
		return {
			'access-control-allow-origin': origin,
			'access-control-allow-methods': 'GET, OPTIONS',
			vary: 'Origin',
		};
	}
	return { vary: 'Origin' };
}

export default async ( req: Request, _context: Context ) => {
	const cors = corsHeaders( req.headers.get( 'origin' ) );

	if ( req.method === 'OPTIONS' ) {
		return new Response( null, { status: 204, headers: cors } );
	}

	const empty: LiveStatePayload = { generated_at: new Date( 0 ).toISOString(), channels: [] };

	let payload: LiveStatePayload = empty;
	try {
		const store = getStore( STORE_NAME );
		payload = ( ( await store.get( BLOB_KEY, { type: 'json' } ) ) as LiveStatePayload ) ?? empty;
	} catch {
		// Blob unreadable or the poller has never run. Serving an empty
		// channel list is correct: the front-end reads that as "nothing live"
		// and falls back to the Dark Channel. Never surface an error to
		// visitors — the worst case they should ever see is the channel
		// playing, not a broken hero.
	}

	return new Response( JSON.stringify( payload ), {
		status: 200,
		headers: {
			...cors,
			'content-type': 'application/json; charset=utf-8',
			// Poller runs every 60s; 30s of shared caching absorbs traffic
			// spikes while keeping state fresh enough for a live show.
			'cache-control': 'public, max-age=30, stale-while-revalidate=60',
		},
	} );
};

export const config: Config = {
	path: '/api/live-state',
};
