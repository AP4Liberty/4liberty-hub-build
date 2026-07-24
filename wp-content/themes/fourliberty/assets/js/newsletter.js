/**
 * 4Liberty Network — "The Daily Brief" newsletter signup.
 *
 * Wires the email-capture form in patterns/newsletter-cta.php
 * ([data-fl="newsletter-form"]) to netlify/functions/newsletter-subscribe.mts,
 * which subscribes the email to a dedicated Klaviyo list. Was an honest,
 * unwired form stub since Phase 1 (see that pattern file's own history) —
 * this is that follow-up, now that a Klaviyo key already lives in Netlify
 * for the magic-link login flow.
 *
 * Same shape as every other form in this theme (chat, tips, login): no
 * server-rendered fallback, JS-only submit via fetch.
 */
( function () {
	'use strict';

	var ENDPOINT =
		( window.fourlibertyNewsletterEndpoint && window.fourlibertyNewsletterEndpoint.url ) ||
		'https://4liberty-poller.netlify.app/api/newsletter-subscribe';

	function setStatus( el, text, isError ) {
		el.textContent = text || '';
		el.classList.toggle( 'fl-newsletter__status--error', !! isError );
	}

	function init() {
		var form = document.querySelector( '[data-fl="newsletter-form"]' );
		var status = document.querySelector( '[data-fl="newsletter-status"]' );
		if ( ! form || ! status ) {
			return;
		}

		var input = form.querySelector( 'input[type="email"]' );
		var button = form.querySelector( 'button[type="submit"]' );

		form.addEventListener( 'submit', function ( evt ) {
			evt.preventDefault();
			var email = input.value.trim();
			if ( ! email ) {
				return;
			}

			button.disabled = true;
			setStatus( status, 'Joining…' );

			fetch( ENDPOINT, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify( { email: email } ),
			} )
				.then( function ( res ) {
					return res.json().then( function ( data ) {
						return { ok: res.ok, data: data };
					} );
				} )
				.then( function ( result ) {
					button.disabled = false;
					if ( ! result.ok || ! result.data.success ) {
						setStatus( status, 'That didn’t work — try again in a moment.', true );
						return;
					}
					input.value = '';
					setStatus( status, '✅ You’re in — welcome to the movement.' );
				} )
				.catch( function () {
					button.disabled = false;
					setStatus( status, 'That didn’t work — try again in a moment.', true );
				} );
		} );
	}

	document.addEventListener( 'DOMContentLoaded', init );
} )();
