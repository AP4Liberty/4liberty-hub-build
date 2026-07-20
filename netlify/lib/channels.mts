/**
 * Channel discovery.
 *
 * Channels are discovered at runtime from environment variables named
 * `RUMBLE_API_URL_<KEY>`. The suffix becomes the channel key:
 *
 *   RUMBLE_API_URL_WUA        → WUA         (Wake Up America)
 *   RUMBLE_API_URL_WUJC       → WUJC        (Wake Up Jefferson City)
 *   RUMBLE_API_URL_CULTURAMA  → CULTURAMA   (Culturama)
 *   RUMBLE_API_URL_HOMESCHOOL → HOMESCHOOL  (Homeschool Workshop)
 *   RUMBLE_API_URL_CAFECITO   → CAFECITO    (Cafecito Libre)
 *   RUMBLE_API_URL_FNFA       → FNFA        (Friday Night Freedom Arcade)
 *
 * Why discovery instead of a committed list: adding a show to the network
 * becomes ONE action in a UI the owner already uses (add an env var in
 * Netlify) — no code change, no deploy, no developer. The owner is
 * non-technical; see Golden Rule #3 in CLAUDE.md.
 *
 * Display names, hero priority and playback policy are NOT here — those live
 * in the WordPress "Live Shows" admin panel, keyed by the channel key above.
 * This file only answers "which channels exist and where do I fetch them".
 */

export interface DiscoveredChannel {
	key: string;
	url: string;
}

const PREFIX = 'RUMBLE_API_URL_';

/**
 * A variable counts as configured only once it holds a real URL.
 *
 * Placeholder names are created ahead of time so the owner only has to paste
 * values (never create variables); those placeholders hold a sentinel string.
 * Requiring an https:// prefix skips them, and also skips an accidentally
 * blanked variable, without needing to know the sentinel's exact wording.
 */
function isConfigured( value: unknown ): value is string {
	return typeof value === 'string' && value.trim().startsWith( 'https://' );
}

export function discoverChannels( env: Record< string, string | undefined > ): DiscoveredChannel[] {
	return Object.entries( env )
		.filter( ( [ name, value ] ) => name.startsWith( PREFIX ) && isConfigured( value ) )
		.map( ( [ name, value ] ) => ( {
			key: name.slice( PREFIX.length ),
			url: ( value as string ).trim(),
		} ) )
		.sort( ( a, b ) => a.key.localeCompare( b.key ) );
}

/** Names of variables that exist but are still holding a placeholder. */
export function pendingChannelKeys( env: Record< string, string | undefined > ): string[] {
	return Object.entries( env )
		.filter( ( [ name, value ] ) => name.startsWith( PREFIX ) && ! isConfigured( value ) )
		.map( ( [ name ] ) => name.slice( PREFIX.length ) )
		.sort();
}
