/**
 * Best-effort dedupe so a busy thread doesn't email its author once per
 * reply (Phase 8, Task E) — community-reply.mts's only caller. Netlify
 * Blobs has no native TTL (confirmed in ratelimit.mts's header), so this
 * uses the same manual-expiry-field pattern as identity.mts's login-code
 * store: a stored timestamp, checked against a window on read, never swept.
 *
 * isWithinDedupeWindow() is split out as pure logic specifically so it can
 * be unit-tested without touching Blobs — same split as the rest of this
 * repo (see community.mts's header).
 */

import { getStore } from '@netlify/blobs';

const STORE_NAME = 'community-notify-dedupe';
const DEDUPE_WINDOW_SECONDS = 15 * 60;

/** Pure — no Blobs access, no clock reads. */
export function isWithinDedupeWindow(
	notifiedAtSeconds: number,
	nowSeconds: number,
	windowSeconds: number = DEDUPE_WINDOW_SECONDS
): boolean {
	return nowSeconds - notifiedAtSeconds < windowSeconds;
}

/**
 * `false` on any read failure or missing entry — fails open toward sending
 * one extra email rather than silently swallowing a real notification,
 * same fail-safe spirit as ratelimit.mts.
 */
export async function wasRecentlyNotified( key: string ): Promise< boolean > {
	try {
		const store = getStore( { name: STORE_NAME, consistency: 'strong' } );
		const entry = ( await store.get( key, { type: 'json' } ) ) as { notifiedAt: number } | null;
		if ( ! entry || typeof entry.notifiedAt !== 'number' ) {
			return false;
		}
		return isWithinDedupeWindow( entry.notifiedAt, Math.floor( Date.now() / 1000 ) );
	} catch {
		return false;
	}
}

export async function markNotified( key: string ): Promise< void > {
	try {
		const store = getStore( { name: STORE_NAME, consistency: 'strong' } );
		await store.setJSON( key, { notifiedAt: Math.floor( Date.now() / 1000 ) } );
	} catch {
		// Worst case: one extra notification email later — not worth failing
		// the reply itself over (same spirit as community-post.mts's
		// incrementPostCount call).
	}
}
