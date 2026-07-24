/**
 * Newsletter signup — "The Daily Brief" (homepage `newsletter-cta.php`
 * pattern). Subscribes an email to a dedicated Klaviyo list with real email
 * marketing consent, distinct from lib/email.mts's magic-link EVENT tracking
 * (this is a genuine list subscription, not a one-off transactional event).
 *
 * Was an honest, unwired form stub since Phase 1 — this is that follow-up,
 * now that a Klaviyo key already lives in Netlify for the magic-link flow.
 */

const KLAVIYO_SUBSCRIBE_URL = 'https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs';
const KLAVIYO_REVISION = '2026-07-15';
// "4Liberty Network — Daily Brief" — created 2026-07-23 specifically for this
// signup; keep separate from 4LibertyShop's own e-commerce lists/segments.
const DAILY_BRIEF_LIST_ID = 'YdhSt9';

/**
 * Returns true only once Klaviyo confirms the subscribe job was accepted.
 * Never logs the API key; only Klaviyo's own status/message, same rule as
 * lib/email.mts.
 */
export async function subscribeToNewsletter( email: string ): Promise< boolean > {
	// A SEPARATE key from lib/email.mts's KLAVIYO_API_KEY, deliberately —
	// that key only has events:write (enough for the magic-link event, see
	// Task H's discovery that this endpoint 403s without dedicated
	// lists/profiles/subscriptions scopes), matching this Klaviyo account's
	// own established convention of one narrowly-scoped key per integration.
	const apiKey = Netlify.env.get( 'KLAVIYO_NEWSLETTER_API_KEY' );
	if ( ! apiKey ) {
		console.error( '[newsletter] Klaviyo is not configured (missing KLAVIYO_NEWSLETTER_API_KEY).' );
		return false;
	}

	try {
		const response = await fetch( KLAVIYO_SUBSCRIBE_URL, {
			method: 'POST',
			headers: {
				authorization: `Klaviyo-API-Key ${ apiKey }`,
				revision: KLAVIYO_REVISION,
				'content-type': 'application/json',
			},
			body: JSON.stringify( {
				data: {
					type: 'profile-subscription-bulk-create-job',
					attributes: {
						profiles: {
							data: [
								{
									type: 'profile',
									attributes: {
										email,
										subscriptions: {
											email: {
												marketing: { consent: 'SUBSCRIBED' },
											},
										},
									},
								},
							],
						},
					},
					relationships: {
						list: { data: { type: 'list', id: DAILY_BRIEF_LIST_ID } },
					},
				},
			} ),
		} );

		if ( ! response.ok ) {
			console.error( '[newsletter] Klaviyo subscribe failed with status', response.status );
			return false;
		}
		return true;
	} catch ( error ) {
		console.error( '[newsletter] Klaviyo request failed:', error instanceof Error ? error.message : String( error ) );
		return false;
	}
}
