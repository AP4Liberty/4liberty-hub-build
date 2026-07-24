/**
 * Shared reader for the owner-facing settings that are enforced SERVER-SIDE
 * on Netlify but set in WordPress admin (Task G's "Chat & Tips" panel) — a
 * front-end-only toggle could be bypassed from the browser, so these two
 * specific fields need a real bridge between the two hosts.
 *
 * Everything else in fourliberty_chat_tips_config() (tip presets, the
 * Square publishable keys, the hide-bots default) is read directly by the
 * BROWSER via wp_localize_script and needs no bridge at all — WordPress
 * serves the current value on every page load already. Only the fields
 * Netlify itself must enforce live here.
 *
 * Same shape as the Phase 2 live-state pipeline: a scheduled poller
 * (poll-wp-config.mts) fetches a PUBLIC, non-sensitive WordPress REST route
 * every minute and caches the result in Blobs; this file just reads that
 * cache. Decoupling the read from a live WordPress round-trip means a slow
 * or down GoDaddy host never blocks chat-token.mts / tip-create.mts, the
 * same reasoning that kept Rumble polling off the hot path in Phase 2.
 *
 * No new secret needed — the WordPress endpoint intentionally returns
 * nothing sensitive (same "public by design" precedent as /api/live-state),
 * so there's nothing here for a leaked env var to protect.
 */

import { getStore } from '@netlify/blobs';

const STORE_NAME = 'wp-config';
const BLOB_KEY = 'current';

export interface ServerConfig {
	mode: 'open' | 'gated';
	tipMinCents: number;
	tipMaxCents: number;
}

const DEFAULTS: ServerConfig = {
	mode: 'open',
	tipMinCents: 100,
	tipMaxCents: 50000,
};

function coerceMode( value: unknown ): 'open' | 'gated' {
	return value === 'gated' ? 'gated' : 'open';
}

function coerceCents( value: unknown, fallback: number ): number {
	const n = typeof value === 'number' ? Math.round( value ) : NaN;
	return Number.isFinite( n ) && n > 0 ? n : fallback;
}

/** Builds a valid ServerConfig from whatever shape the blob holds, never throwing. */
export function normalizeServerConfig( raw: unknown ): ServerConfig {
	const r = ( raw ?? {} ) as Record< string, unknown >;
	return {
		mode: coerceMode( r.mode ),
		tipMinCents: coerceCents( r.tipMinCents, DEFAULTS.tipMinCents ),
		tipMaxCents: coerceCents( r.tipMaxCents, DEFAULTS.tipMaxCents ),
	};
}

/**
 * Reads the cached config. Falls back to safe defaults — never throws, and
 * never fails closed in a way that breaks the feature: a stale/missing
 * cache means "open chat, default tip bounds," not an outage.
 */
export async function getServerConfig(): Promise< ServerConfig > {
	try {
		const store = getStore( STORE_NAME );
		const raw = await store.get( BLOB_KEY, { type: 'json' } );
		if ( raw ) {
			return normalizeServerConfig( raw );
		}
	} catch {
		// Blob unreadable or the poller has never run — defaults are correct.
	}
	return { ...DEFAULTS };
}
