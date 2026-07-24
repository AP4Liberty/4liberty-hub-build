/**
 * poll-wp-config — fetches the server-enforced Chat & Tips settings from a
 * PUBLIC WordPress REST route and caches them in Blobs, on the same
 * scheduled-writer / cached-reader shape as poll-rumble.mts (Phase 2).
 *
 * Why not have chat-token.mts / tip-create.mts fetch WordPress directly on
 * every request: that would couple Netlify's hot path to GoDaddy's uptime
 * and response time — exactly what Phase 2 avoided for Rumble polling.
 * Fetching on a schedule means a slow or down WordPress host never blocks a
 * chat connection or a tip; the last-known-good config keeps serving.
 *
 * The WordPress endpoint is intentionally public (no auth, nothing
 * sensitive returned) — see functions.php's fourliberty_register_rest_routes
 * — so there's no secret for this poller to hold at all.
 */

import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import { normalizeServerConfig } from '../lib/config.mts';

const STORE_NAME = 'wp-config';
const BLOB_KEY = 'current';
const FETCH_TIMEOUT_MS = 8000;

const WP_CONFIG_URL = 'https://4libertynetwork.com/wp-json/fourliberty/v1/server-config';

export default async () => {
	try {
		const response = await fetch( WP_CONFIG_URL, {
			signal: AbortSignal.timeout( FETCH_TIMEOUT_MS ),
			headers: { accept: 'application/json' },
		} );

		if ( ! response.ok ) {
			throw new Error( `HTTP ${ response.status }` );
		}

		const raw = await response.json();
		const config = normalizeServerConfig( raw );

		const store = getStore( STORE_NAME );
		await store.setJSON( BLOB_KEY, config );

		console.log( `[poll-wp-config] updated: mode=${ config.mode }, tip $${ config.tipMinCents / 100 }-$${ config.tipMaxCents / 100 }` );
	} catch ( error ) {
		// Last-known-good stays in place — a WordPress hiccup must not
		// suddenly lock chat to a stale mode or block tips. Safe to log in
		// full: this endpoint holds no secret.
		console.warn( '[poll-wp-config] fetch failed, keeping last-known config:', error instanceof Error ? error.message : String( error ) );
	}
};

export const config: Config = {
	schedule: '* * * * *',
};
