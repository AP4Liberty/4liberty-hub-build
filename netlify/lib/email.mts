/**
 * Klaviyo integration — sends the magic-link login email.
 *
 * This only TRACKS AN EVENT ("Requested Magic Link") with the link as a
 * custom property; the actual email copy/design/send logic lives in a
 * Klaviyo Flow Austin sets up in his own Klaviyo account, triggered by that
 * event. This file has no knowledge of what the email looks like — that's
 * owned entirely in Klaviyo's UI, matching Golden Rule #3 (owner can change
 * the email anytime with no code edit).
 *
 * Decided 2026-07-22: Klaviyo (already in the stack) over a dedicated ESP.
 */

const KLAVIYO_API_URL = 'https://a.klaviyo.com/api/events';
// Klaviyo's API is date-versioned. If magic-link emails ever start silently
// failing, check whether this revision has been retired before anything else.
const KLAVIYO_REVISION = '2026-07-15';
const EVENT_METRIC_NAME = 'Requested Magic Link';

/**
 * Returns true only if Klaviyo confirmed the event was accepted. A false
 * result means "the email almost certainly did not send" — the caller
 * (auth-request.mts) still tells the visitor to check their email either
 * way (Decision 8's fail-safe spirit: never expose that the ESP is down),
 * but logs this for real troubleshooting.
 */
export async function sendMagicLinkEmail( email: string, magicLinkUrl: string ): Promise< boolean > {
	const apiKey = Netlify.env.get( 'KLAVIYO_API_KEY' );
	if ( ! apiKey ) {
		console.error( '[email] Klaviyo is not configured (missing KLAVIYO_API_KEY).' );
		return false;
	}

	try {
		const response = await fetch( KLAVIYO_API_URL, {
			method: 'POST',
			headers: {
				authorization: `Klaviyo-API-Key ${ apiKey }`,
				revision: KLAVIYO_REVISION,
				'content-type': 'application/json',
			},
			body: JSON.stringify( {
				data: {
					type: 'event',
					attributes: {
						metric: { data: { type: 'metric', attributes: { name: EVENT_METRIC_NAME } } },
						profile: { data: { type: 'profile', attributes: { email } } },
						properties: { magic_link_url: magicLinkUrl },
						time: new Date().toISOString(),
					},
				},
			} ),
		} );

		if ( ! response.ok ) {
			console.error( '[email] Klaviyo event tracking failed with status', response.status );
			return false;
		}
		return true;
	} catch ( error ) {
		console.error( '[email] Klaviyo request failed:', error instanceof Error ? error.message : String( error ) );
		return false;
	}
}
