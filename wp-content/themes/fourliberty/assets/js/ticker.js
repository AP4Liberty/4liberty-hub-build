/**
 * 4Liberty Network — homepage/masthead "On Air" ticker (2026-07-23).
 *
 * Replaces the Phase 1 static line (parts/header.html originally hardcoded
 * "Wake Up America airs weekday mornings") with a real rotation through every
 * enabled show's name + schedule, sourced from the same
 * fourliberty_live_shows_config() the homepage hero and /shows/ page already
 * read (localized as window.fourlibertyLiveShows) — schedules are editable at
 * 4Liberty Hub → Live Shows, same screen as show names.
 *
 * The "On Air" tag only lights up when something in that roster is actually
 * live right now, per the same /api/live-state payload live-state.js reads —
 * never a static claim. Independent poller, same pattern as
 * assets/js/rumble-mirror.js and assets/js/show-grid.js: this endpoint is
 * cheap and shared-cached specifically so multiple readers don't need to
 * coordinate.
 */
( function () {
	'use strict';

	var ENDPOINT =
		( window.fourlibertyLiveEndpoint && window.fourlibertyLiveEndpoint.url ) ||
		'https://4liberty-poller.netlify.app/api/live-state';

	var POLL_INTERVAL_MS = 45000; // matches live-state.js's cadence
	var SLIDE_INTERVAL_MS = 4500;

	var CONFIG = window.fourlibertyLiveShows || { order: [], shows: {} };

	var els = null;
	var slideTimer = null;
	var liveKeys = {}; // channel key -> true, from the most recent poll

	function showConfig( key ) {
		return ( CONFIG.shows && CONFIG.shows[ key ] ) || { name: key };
	}

	function isEnabled( key ) {
		return showConfig( key ).enabled !== false;
	}

	function enabledShows() {
		return ( CONFIG.order || [] ).filter( isEnabled );
	}

	function renderSlide( key ) {
		if ( ! els || ! els.feed ) {
			return;
		}
		var cfg = showConfig( key );
		els.feed.innerHTML = '';

		var name = document.createElement( 'b' );
		name.textContent = cfg.name || key;
		els.feed.appendChild( name );

		if ( liveKeys[ key ] ) {
			els.feed.appendChild( document.createTextNode( ' is live right now.' ) );
		} else if ( cfg.schedule ) {
			els.feed.appendChild( document.createTextNode( ' — ' + cfg.schedule ) );
		}
	}

	/**
	 * Whether to show the red "On Air" tag — true the instant ANY enabled
	 * show is live, independent of which slide the rotation happens to be
	 * showing at that moment (those are deliberately decoupled: the tag
	 * answers "is the network live right now", the feed just cycles through
	 * the whole roster).
	 */
	function updateLiveTag() {
		if ( ! els || ! els.liveTag ) {
			return;
		}
		var anyLive = Object.keys( liveKeys ).length > 0;
		els.liveTag.hidden = ! anyLive;
	}

	function startRotation( keys ) {
		if ( slideTimer ) {
			clearInterval( slideTimer );
			slideTimer = null;
		}
		if ( ! keys.length ) {
			if ( els && els.feed ) {
				els.feed.textContent = '4Liberty Network — stay tuned.';
			}
			return;
		}

		var index = 0;
		renderSlide( keys[ index ] );
		if ( keys.length > 1 ) {
			slideTimer = setInterval( function () {
				index = ( index + 1 ) % keys.length;
				renderSlide( keys[ index ] );
			}, SLIDE_INTERVAL_MS );
		}
	}

	function fetchState() {
		fetch( ENDPOINT, { cache: 'no-store', mode: 'cors' } )
			.then( function ( res ) {
				if ( ! res.ok ) {
					throw new Error( 'bad status ' + res.status );
				}
				return res.json();
			} )
			.then( function ( payload ) {
				if ( ! payload || ! Array.isArray( payload.channels ) ) {
					return;
				}
				var fresh = {};
				payload.channels.forEach( function ( c ) {
					if ( c.is_live && isEnabled( c.key ) ) {
						fresh[ c.key ] = true;
					}
				} );
				liveKeys = fresh;
				updateLiveTag();
			} )
			.catch( function () {
				// A fetch hiccup just means the "On Air" tag keeps its last-known
				// state until the next poll — never flips to a guess.
			} );
	}

	function tick() {
		if ( ! document.hidden ) {
			fetchState();
		}
		setTimeout( tick, POLL_INTERVAL_MS );
	}

	function init() {
		var row = document.querySelector( '.fl-ticker__row' );
		var feed = document.querySelector( '[data-fl="ticker-feed"]' );
		if ( ! row || ! feed ) {
			return;
		}

		els = {
			row: row,
			feed: feed,
			liveTag: row.querySelector( '[data-fl="ticker-live-tag"]' ),
		};

		startRotation( enabledShows() );
		fetchState();
		setTimeout( tick, POLL_INTERVAL_MS );
		document.addEventListener( 'visibilitychange', function () {
			if ( document.visibilityState === 'visible' ) {
				fetchState();
			}
		} );
	}

	document.addEventListener( 'DOMContentLoaded', init );
} )();
