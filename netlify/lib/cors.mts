/**
 * Shared CORS allowlist for every public Netlify endpoint in this project.
 * Extracted from live-state.mts (Phase 2) so Phase 3's new endpoints
 * (chat-token, and later tip-create/auth-request) share one allowlist
 * instead of each re-declaring it — see PHASE-3-BUILD-PLAN.md Decision 1.
 *
 * Never `*`. Extra origins (staging hosts, mainly) come from an env var so a
 * staging hostname change doesn't need a code deploy — GoDaddy staging
 * hostnames change every time the staging site is recreated, which during
 * the July 2026 security incident happened four times.
 */

const DEFAULT_ALLOWED_ORIGINS = [
	'https://wakeupamericashow.com',
	'https://www.wakeupamericashow.com',
	'https://4libertynetwork.com',
	'https://www.4libertynetwork.com',
];

function allowedOrigins(): string[] {
	const extra = ( Netlify.env.get( 'ALLOWED_ORIGINS' ) ?? '' )
		.split( ',' )
		.map( ( o ) => o.trim() )
		.filter( Boolean );
	return [ ...DEFAULT_ALLOWED_ORIGINS, ...extra ];
}

export interface CorsOptions {
	/** Access-Control-Allow-Methods. Defaults to a read-only GET endpoint. */
	methods?: string;
	/** Access-Control-Allow-Headers — set this when the endpoint reads a request body. */
	headers?: string;
}

export function corsHeaders( origin: string | null, options: CorsOptions = {} ): Record< string, string > {
	if ( ! origin || ! allowedOrigins().includes( origin ) ) {
		return { vary: 'Origin' };
	}

	const out: Record< string, string > = {
		'access-control-allow-origin': origin,
		'access-control-allow-methods': options.methods ?? 'GET, OPTIONS',
		vary: 'Origin',
	};
	if ( options.headers ) {
		out[ 'access-control-allow-headers' ] = options.headers;
	}
	return out;
}
