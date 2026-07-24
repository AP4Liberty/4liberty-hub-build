/**
 * /shows/ page — lights up "Live now" badges using the same sanitized Netlify
 * poller endpoint the homepage hero reads (see assets/js/live-state.js).
 * Deliberately simpler than the hero's state machine: no hysteresis, no
 * gating UI — just "is this channel live right now, yes or no." A fetch
 * failure leaves every badge in its default hidden state; never shows a
 * broken page.
 *
 * Every card's href was a hardcoded "/" regardless of which show it was
 * (Austin flagged this 2026-07-23 — clicking a show never actually took you
 * to that show). A live card links to "/?watch={KEY}", which live-state.js
 * reads on load and pins as hero if that channel is genuinely live — the one
 * case this matters is two shows live at once, where the default priority
 * order would otherwise pick the wrong one.
 *
 * A NOT-live card (2026-07-23, second pass — the plain "/" fallback was still
 * a dead end) now links to that show's Rumble channel instead, same
 * window.fourlibertyLiveShows config (gatedUrl field) the schedule panel
 * uses — so you can still go watch past broadcasts / subscribe. Only falls
 * back to "/" if that show has no channel link configured at all.
 */
( function () {
	'use strict';

	var ENDPOINT =
		( window.fourlibertyLiveEndpoint && window.fourlibertyLiveEndpoint.url ) ||
		'https://4liberty-poller.netlify.app/api/live-state';
	var POLL_INTERVAL_MS = 45000;
	var SHOWS_CONFIG = window.fourlibertyLiveShows || { shows: {} };

	function rumbleChannelUrl( key ) {
		var cfg = SHOWS_CONFIG.shows && SHOWS_CONFIG.shows[ key ];
		return ( cfg && cfg.gatedUrl ) || '';
	}

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
			if ( isLive ) {
				card.href = '/?watch=' + encodeURIComponent( key );
				card.removeAttribute( 'target' );
				card.removeAttribute( 'rel' );
			} else {
				var channelUrl = rumbleChannelUrl( key );
				card.href = channelUrl || '/';
				// Only the Rumble-channel destination is external — same
				// target/rel convention as every other off-site link on this
				// theme (schedule panel, Shop Ad, header Shop link).
				if ( channelUrl ) {
					card.target = '_blank';
					card.rel = 'noopener';
				} else {
					card.removeAttribute( 'target' );
					card.removeAttribute( 'rel' );
				}
			}
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
