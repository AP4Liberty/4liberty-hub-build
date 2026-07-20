/**
 * poll-rumble — the ONLY code that ever touches a Rumble API URL.
 *
 * Runs on a schedule (every minute), fetches each configured channel
 * server-side, sanitizes by allowlist, and writes the result to Netlify Blobs.
 * The public reader (live-state.mts) serves that blob. Visitor traffic never
 * reaches this function and never reaches Rumble.
 *
 * Scheduled functions only run on PUBLISHED deploys — not deploy previews or
 * branch deploys. To exercise it locally: `netlify dev` then
 * `netlify functions:invoke poll-rumble`.
 */

import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import { discoverChannels, pendingChannelKeys } from '../lib/channels.mts';
import {
	offlineChannel,
	redact,
	sanitizeChannel,
	type LiveStatePayload,
	type SanitizedChannel,
} from '../lib/sanitize.mts';

const STORE_NAME = 'live-state';
const BLOB_KEY = 'current';
const FETCH_TIMEOUT_MS = 8000;

export default async () => {
	const env = Netlify.env.toObject();
	const channels = discoverChannels( env );
	const pending = pendingChannelKeys( env );

	if ( pending.length > 0 ) {
		// Safe to log: these are variable-name suffixes, never values.
		console.log( `[poll-rumble] awaiting values for: ${ pending.join( ', ' ) }` );
	}

	if ( channels.length === 0 ) {
		console.log( '[poll-rumble] no channels configured yet — nothing to poll.' );
		return;
	}

	const store = getStore( STORE_NAME );
	const previous = await readPrevious( store );

	// Every secret in play this run, so log lines can be scrubbed of all of
	// them regardless of which channel produced the error.
	const secrets = channels.map( ( c ) => c.url );

	// Fetch all channels concurrently — one slow channel must not delay the
	// others, and one FAILING channel must not blank the whole payload.
	const results = await Promise.all(
		channels.map( ( channel ) => pollChannel( channel.key, channel.url, secrets, previous ) )
	);

	const payload: LiveStatePayload = {
		generated_at: new Date().toISOString(),
		channels: results,
	};

	await store.setJSON( BLOB_KEY, payload );

	const liveKeys = results.filter( ( c ) => c.is_live ).map( ( c ) => c.key );
	console.log(
		`[poll-rumble] polled ${ results.length } channel(s); live: ${
			liveKeys.length > 0 ? liveKeys.join( ', ' ) : 'none'
		}`
	);
};

/**
 * Fetch and sanitize one channel.
 *
 * On any failure we fall back to that channel's LAST KNOWN GOOD state rather
 * than reporting it dark. A momentary Rumble hiccup should not knock a live
 * show off the homepage; the front-end's own staleness check
 * (`generated_at`) is what catches a genuinely stalled poller.
 */
async function pollChannel(
	key: string,
	url: string,
	secrets: string[],
	previous: Map< string, SanitizedChannel >
): Promise< SanitizedChannel > {
	try {
		const response = await fetch( url, {
			signal: AbortSignal.timeout( FETCH_TIMEOUT_MS ),
			headers: { accept: 'application/json' },
		} );

		if ( ! response.ok ) {
			throw new Error( `HTTP ${ response.status }` );
		}

		const raw = await response.json();
		return sanitizeChannel( key, raw );
	} catch ( error ) {
		// The URL IS the secret, and fetch errors habitually embed the URL in
		// their message. Never log the raw error.
		const message = redact( error instanceof Error ? error.message : String( error ), secrets );
		console.warn( `[poll-rumble] channel ${ key } failed: ${ message }` );

		return previous.get( key ) ?? offlineChannel( key );
	}
}

async function readPrevious( store: ReturnType< typeof getStore > ): Promise< Map< string, SanitizedChannel > > {
	const map = new Map< string, SanitizedChannel >();
	try {
		const previous = ( await store.get( BLOB_KEY, { type: 'json' } ) ) as LiveStatePayload | null;
		for ( const channel of previous?.channels ?? [] ) {
			if ( channel?.key ) {
				map.set( channel.key, channel );
			}
		}
	} catch {
		// First run, or the blob is unreadable. An empty map is correct.
	}
	return map;
}

export const config: Config = {
	schedule: '* * * * *',
};
