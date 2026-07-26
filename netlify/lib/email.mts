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
const MAGIC_LINK_EVENT_METRIC_NAME = 'Requested Magic Link';
// Phase 8, Task E — the reply-notification event. A separate Klaviyo Flow,
// same account, same "this file only tracks the event; the email itself is
// owned entirely in Klaviyo's UI" posture as the magic-link event below.
const COMMUNITY_REPLY_EVENT_METRIC_NAME = 'Community Reply Received';

/**
 * Shared by every function in this file that tracks a Klaviyo event —
 * sendMagicLinkEmail() and sendCommunityReplyNotification() were
 * byte-for-byte identical apart from the metric name and properties, so
 * this is the one place that actually calls Klaviyo's API. Returns true
 * only if Klaviyo confirmed the event was accepted.
 */
async function postKlaviyoEvent( email: string, metricName: string, properties: Record< string, string > ): Promise< boolean > {
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
						metric: { data: { type: 'metric', attributes: { name: metricName } } },
						profile: { data: { type: 'profile', attributes: { email } } },
						properties,
						time: new Date().toISOString(),
					},
				},
			} ),
		} );

		if ( ! response.ok ) {
			console.error( `[email] Klaviyo event "${ metricName }" failed with status`, response.status );
			return false;
		}
		return true;
	} catch ( error ) {
		console.error( `[email] Klaviyo event "${ metricName }" request failed:`, error instanceof Error ? error.message : String( error ) );
		return false;
	}
}

/**
 * Returns true only if Klaviyo confirmed the event was accepted. A false
 * result means "the email almost certainly did not send" — the caller
 * (auth-request.mts) still tells the visitor to check their email either
 * way (Decision 8's fail-safe spirit: never expose that the ESP is down),
 * but logs this for real troubleshooting.
 *
 * `loginCode` rides along as a second event property (`login_code`) purely
 * so the Klaviyo Flow's email template can print it — this file still has
 * no opinion on the email's copy/design (that stays entirely in Klaviyo's
 * UI, Golden Rule #3). Added PHASE-8-BUILD-PLAN.md Decision 11a: a typed
 * code alongside the link, so a visitor never has to leave the page they're
 * on to finish logging in.
 */
export async function sendMagicLinkEmail( email: string, magicLinkUrl: string, loginCode: string ): Promise< boolean > {
	return postKlaviyoEvent( email, MAGIC_LINK_EVENT_METRIC_NAME, { magic_link_url: magicLinkUrl, login_code: loginCode } );
}

/**
 * The reply-notification event (Phase 8, Task E) — fired by
 * community-reply.mts as a best-effort step AFTER a reply is already saved,
 * never something that can fail the reply itself. Same "this file has no
 * opinion on the email's design" posture as sendMagicLinkEmail(): Austin
 * builds the actual Klaviyo Flow (trigger + template) in his own account,
 * this only tracks the event with enough properties for that template to
 * print a useful email.
 */
export async function sendCommunityReplyNotification(
	email: string,
	postTitle: string,
	postUrl: string,
	replierName: string,
	replySnippet: string
): Promise< boolean > {
	return postKlaviyoEvent( email, COMMUNITY_REPLY_EVENT_METRIC_NAME, {
		post_title: postTitle,
		post_url: postUrl,
		replier_name: replierName,
		reply_snippet: replySnippet,
	} );
}
