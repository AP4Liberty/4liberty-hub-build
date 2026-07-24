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

export interface SanitizedChatMessage {
	username: string | null;
	profile_pic_url: string | null;
	badges: string[];
	text: string | null;
	created_on: string | null;
	is_rant: boolean;
	amount_dollars: number;
}

export interface SanitizedChannel {
	key: string;
	channel: string | null;
	is_live: boolean;
	title: string | null;
	embed_id: string | null;
	watching_now: number;
	likes: number;
	scheduled_on: string | null;
	chat: SanitizedChatMessage[];
}

export interface LiveStatePayload {
	generated_at: string;
	channels: SanitizedChannel[];
}

/**
 * Chat is capped at the most recent N messages after merging and sorting —
 * the raw API already defaults to ~50 (PHASE-0-FINDINGS.md); this cap just
 * guards the blob size if that default ever changes upstream.
 */
const MAX_CHAT_MESSAGES = 50;

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
 * Coerce to an array of trimmed strings. Every item goes through str(), so a
 * badge smuggled in as an object (rather than the plain string Rumble badges
 * actually are) is dropped instead of passed through.
 */
function strArray( value: unknown ): string[] {
	if ( ! Array.isArray( value ) ) {
		return [];
	}
	const out: string[] = [];
	for ( const item of value ) {
		const s = str( item );
		if ( s !== null ) {
			out.push( s );
		}
	}
	return out;
}

/** Parses to a unix-ms timestamp, or 0 (sorts first) if unparseable. */
function toTimestamp( value: string | null ): number {
	if ( ! value ) {
		return 0;
	}
	const t = Date.parse( value );
	return Number.isFinite( t ) ? t : 0;
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
 * Build one sanitized chat message field-by-field from an explicit allowlist
 * — the same rule as sanitizeChannel() below, and just as security-critical:
 * a chat message is visitor-supplied text riding through a third-party API,
 * making it the LEAST trustworthy input in this whole pipeline.
 *
 * `isRant` is not read from the raw message — it is asserted by the caller
 * based on which Rumble array (recent_messages vs recent_rants) the item came
 * from. Otherwise a normal chat message could set its own `is_rant: true` and
 * `amount_dollars: 999` and have that rendered as a real paid rant.
 */
function sanitizeChatMessage( raw: unknown, isRant: boolean ): SanitizedChatMessage {
	const m: any = raw ?? {};
	return {
		username: str( m?.username ),
		profile_pic_url: str( m?.profile_pic_url ),
		badges: strArray( m?.badges ),
		text: str( m?.text ),
		created_on: str( m?.created_on ),
		is_rant: isRant,
		amount_dollars: isRant ? num( m?.amount_dollars ) : 0,
	};
}

/**
 * Merge recent_messages + recent_rants into one chronological feed, sanitize
 * every item through the allowlist above, and cap the length. `amount_cents`
 * and `expires_on` (present on raw rants per PHASE-0-FINDINGS.md) are
 * deliberately left out of the allowlist — the front-end only ever needs
 * amount_dollars, and every extra field carried is one more thing to audit.
 */
function pickChatMessages( stream: any ): SanitizedChatMessage[] {
	const messages = Array.isArray( stream?.chat?.recent_messages ) ? stream.chat.recent_messages : [];
	const rants = Array.isArray( stream?.chat?.recent_rants ) ? stream.chat.recent_rants : [];

	const combined = [
		...messages.map( ( m: unknown ) => sanitizeChatMessage( m, false ) ),
		...rants.map( ( m: unknown ) => sanitizeChatMessage( m, true ) ),
	];

	combined.sort( ( a, b ) => toTimestamp( a.created_on ) - toTimestamp( b.created_on ) );

	return combined.slice( -MAX_CHAT_MESSAGES );
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
		chat: pickChatMessages( stream ),
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
		chat: [],
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
