/**
 * Minimal fixed-window rate limiter backed by Netlify Blobs, shared by any
 * endpoint that mints something with a real cost attached — a Stream user
 * counts toward the 1,000 MAU free-tier quota, so an unthrottled chat-token
 * endpoint would let a script burn through a month's quota in seconds by
 * requesting a fresh guest identity on every call.
 *
 * A fixed window (not a sliding window/leaky bucket) is enough to blunt a
 * scripted burst — this is an abuse deterrent, not a hard security boundary.
 *
 * Known gap: old window buckets are never swept. Netlify Blobs has no
 * built-in TTL (confirmed against their docs), so this store grows slowly
 * and unboundedly over time. Acceptable at this project's scale; flagged
 * here rather than silently ignored.
 *
 * Uses `consistency: 'strong'` deliberately — confirmed by direct testing
 * that Netlify Blobs' DEFAULT ('eventual') read can lag up to 60 seconds
 * behind a write, even within the same function invocation. A rate limiter
 * reading eventually-consistent data doesn't just have a narrow race window
 * (which would be an acceptable, documentable tradeoff); it can miss an
 * entire minute of requests, which defeats the point of a 5-15 minute
 * window entirely. Strong consistency is slower per Netlify's own docs, but
 * this is called at most once or twice per request, never a hot path.
 */

import { getStore } from '@netlify/blobs';

const STORE_NAME = 'rate-limit';

export interface RateLimitResult {
	allowed: boolean;
}

/**
 * `key` should already be scoped by the caller (e.g. `chat-token:<ip>`) so
 * different endpoints sharing this store never collide on the same bucket.
 */
export async function checkRateLimit(
	key: string,
	max: number,
	windowSeconds: number
): Promise< RateLimitResult > {
	const store = getStore( { name: STORE_NAME, consistency: 'strong' } );
	const windowMs = windowSeconds * 1000;
	const bucketKey = `${ key }:${ Math.floor( Date.now() / windowMs ) }`;

	let count = 0;
	try {
		count = ( ( await store.get( bucketKey, { type: 'json' } ) ) as number | null ) ?? 0;
	} catch {
		count = 0; // first request in this window, or the store hiccuped — fail open on reads
	}

	if ( count >= max ) {
		return { allowed: false };
	}

	try {
		await store.setJSON( bucketKey, count + 1 );
	} catch {
		// A write failure still lets this request through — a rate limiter
		// that fails CLOSED on its own storage errors would turn a Blobs
		// hiccup into an outage for every visitor. Worst case here is a
		// temporarily leaky limit, not a broken feature (same fail-safe
		// spirit as Phase 2's Decision 7).
	}

	return { allowed: true };
}
