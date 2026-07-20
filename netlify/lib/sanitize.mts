/**
 * Allowlist sanitizer — the single most security-critical file in this repo.
 *
 * The raw Rumble Live Stream API response contains the channel's broadcast
 * credentials (`server_url` = RTMP ingest, `stream_key`) plus follower and
 * subscriber PII. Anyone holding those could HIJACK THE BROADCAST, not merely
 * read its live status. None of it may ever reach the browser.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 * Build the output object FIELD BY FIELD from an explicit allowlist.
 *
 * NEVER use object spread, Object.assign, JSON round-tripping, or any other
 * "copy then delete the bad keys" approach. A denylist fails OPEN: the day
 * Rumble adds a new sensitive field, a denylist ships it straight to the
 * homepage, and nobody finds out until it's too late. An allowlist fails
 * CLOSED — an unknown field is dropped because it was never named here.
 *
 * If you are adding a field to the payload, add it explicitly below and add a
 * matching assertion in test/sanitize.test.mts. Do not "simplify" this file by
 * spreading the raw object. That would silently undo the whole protection.
 * ──────────────────────────────────────────────────────────────────────────
 */

export interface SanitizedChannel {
	key: string;
	channel: string | null;
	is_live: boolean;
	title: string | null;
	embed_id: string | null;
	watching_now: number;
	likes: number;
	scheduled_on: string | null;
}

export interface LiveStatePayload {
	generated_at: string;
	channels: SanitizedChannel[];
}

/** Coerce to a trimmed string, or null. Never returns an object. */
function str( value: unknown ): string | null {
	if ( typeof value === 'string' ) {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : null;
	}
	if ( typeof value === 'number' && Number.isFinite( value ) ) {
		return String( value );
	}
	return null;
}

/** Coerce to a non-negative integer. Never returns an object. */
function num( value: unknown ): number {
	const n = typeof value === 'number' ? value : Number( value );
	return Number.isFinite( n ) && n >= 0 ? Math.floor( n ) : 0;
}

/**
 * Choose which livestream represents the channel right now.
 *
 * A channel can carry several livestream entries (an upcoming scheduled one
 * alongside a finished one). A genuinely live entry always wins; otherwise we
 * fall back to the first, which is what drives "scheduled_on" for upcoming
 * shows.
 */
function pickLivestream( raw: any ): any {
	const streams = Array.isArray( raw?.livestreams ) ? raw.livestreams : [];
	return streams.find( ( s: any ) => s?.is_live === true ) ?? streams[ 0 ] ?? null;
}

/**
 * Build the sanitized public view of one channel.
 *
 * Note every single field is assigned individually from a coercer that can
 * only ever produce a string, number, boolean or null — so even a maliciously
 * shaped response cannot smuggle a nested object through.
 */
export function sanitizeChannel( key: string, raw: unknown ): SanitizedChannel {
	const source: any = raw ?? {};
	const stream = pickLivestream( source );

	return {
		key: String( key ),
		channel: str( source?.username ),
		is_live: stream?.is_live === true,
		title: str( stream?.title ),
		embed_id: str( stream?.id ),
		watching_now: num( stream?.watching_now ),
		likes: num( stream?.likes ),
		scheduled_on: str( stream?.scheduled_on ),
	};
}

/**
 * A channel we could not reach on this poll and have no cached state for.
 * Renders as "not live", which the front-end treats as Dark — fail safe.
 */
export function offlineChannel( key: string ): SanitizedChannel {
	return {
		key: String( key ),
		channel: null,
		is_live: false,
		title: null,
		embed_id: null,
		watching_now: 0,
		likes: 0,
		scheduled_on: null,
	};
}

/**
 * Redact secrets from anything bound for a log line.
 *
 * `fetch` failures routinely include the full request URL in the error
 * message — which for us IS the secret. Without this, one network blip would
 * write a live stream key into Netlify's function logs in plain text.
 */
export function redact( message: string, secrets: string[] ): string {
	let out = String( message );
	for ( const secret of secrets ) {
		if ( secret && secret.length > 8 ) {
			out = out.split( secret ).join( '[redacted]' );
		}
	}
	return out;
}
