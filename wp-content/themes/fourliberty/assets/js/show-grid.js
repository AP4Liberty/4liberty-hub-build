/**
 * /shows/ page — lights up "Live now" badges using the same sanitized Netlify
 * poller endpoint the homepage hero reads (see assets/js/live-state.js).
 * Deliberately simpler than the hero's state machine: no hysteresis, no
 * pinning, no gating UI — just "is this channel live right now, yes or no."
 * A fetch failure leaves every badge in its default hidden state; never shows
 * a broken page.
 */
( function () {
	'use strict';

	var ENDPOINT =
		( window.fourlibertyLiveEndpoint && window.fourlibertyLiveEndpoint.url ) ||
		'https://4liberty-poller.netlify.app/api/live-state';
	var POLL_INTERVAL_MS = 45000;

	function applyLiveState( cards, channels ) {
		var liveKeys = {};
		channels.forEach( function ( c ) {
			if ( c.is_live ) {
				liveKeys[ c.key ] = true;
			}
		} );

		cards.forEach( function ( card ) {
			var key = card.getAttribute( 'data-fl-show' );
			var badge = card.querySelector( '[data-fl="show-live-badge"]' );
			if ( ! badge ) {
				return;
			}
			var isLive = !! liveKeys[ key ];
			badge.hidden = ! isLive;
			card.classList.toggle( 'is-live', isLive );
		} );
	}

	function fetchAndApply( cards ) {
		fetch( ENDPOINT, { cache: 'no-store', mode: 'cors' } )
			.then( function ( res ) {
				if ( ! res.ok ) {
					throw new Error( 'bad status' );
				}
				return res.json();
			} )
			.then( function ( payload ) {
				if ( payload && Array.isArray( payload.channels ) ) {
					applyLiveState( cards, payload.channels );
				}
			} )
			.catch( function () {
				// Fail safe: badges stay hidden (their default state). A
				// page listing shows with no live badge is honest; a broken
				// page is not.
			} );
	}

	function init() {
		var cards = Array.prototype.slice.call( document.querySelectorAll( '[data-fl-show]' ) );
		if ( ! cards.length ) {
			return; // not on the /shows/ page
		}
		fetchAndApply( cards );
		setInterval( function () {
			if ( ! document.hidden ) {
				fetchAndApply( cards );
			}
		}, POLL_INTERVAL_MS );
	}

	document.addEventListener( 'DOMContentLoaded', init );
} )();
