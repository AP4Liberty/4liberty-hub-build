/**
 * 4Liberty Network — off-air "When we're live" schedule panel (2026-07-23).
 *
 * An empty chat box when no show is live is dead space that makes the
 * homepage look inactive (Austin's call). This swaps the chat rail
 * ([data-fl="chat-rail"]) for a schedule panel ([data-fl="schedule-rail"],
 * patterns/hero-live.php) whenever nothing's live, and swaps the chat back
 * the instant a show goes live — driven entirely by the same "fl:hero-state"
 * event live-state.js dispatches and the Dark Channel + rumble mirror already
 * read. Never polls anything itself.
 *
 * The schedule content comes from window.fourlibertyLiveShows (localized on
 * live-state.js from fourliberty_live_shows_config()) — the exact same
 * name+schedule data the masthead ticker uses, editable at 4Liberty Hub →
 * Live Shows. The "get notified" box posts to the same newsletter endpoint
 * newsletter.js uses; it's a second, separate form on the page, so it carries
 * its own submit handler rather than sharing newsletter.js's single-form
 * wiring.
 *
 * Fail-safe: the chat rail is what's visible in the markup by default, so if
 * this script never runs the homepage behaves exactly as it did before this
 * panel existed. No-ops entirely if the schedule rail isn't on the page (e.g.
 * the pop-out chat window, which reuses the chat rail markup but not this).
 */
( function () {
	'use strict';

	var CONFIG = window.fourlibertyLiveShows || { order: [], shows: {} };
	var NEWSLETTER_ENDPOINT =
		( window.fourlibertyNewsletterEndpoint && window.fourlibertyNewsletterEndpoint.url ) ||
		'https://4liberty-poller.netlify.app/api/newsletter-subscribe';

	var els = null;

	function showConfig( key ) {
		return ( CONFIG.shows && CONFIG.shows[ key ] ) || { name: key };
	}

	// Same "unchecked in Live Shows = leave out of the rotation" rule the
	// hero and ticker honor; missing/unset defaults to enabled.
	function isEnabled( key ) {
		return showConfig( key ).enabled !== false;
	}

	function renderSchedule() {
		if ( ! els.list ) {
			return;
		}
		els.list.innerHTML = '';

		var keys = ( CONFIG.order || [] ).filter( isEnabled );
		if ( ! keys.length ) {
			var empty = document.createElement( 'li' );
			empty.className = 'fl-schedule-rail__item';
			empty.textContent = 'Live shows are announced here — check back soon.';
			els.list.appendChild( empty );
			return;
		}

		keys.forEach( function ( key ) {
			var cfg = showConfig( key );
			var li = document.createElement( 'li' );
			li.className = 'fl-schedule-rail__item';

			// The show's name links to its Rumble channel when one's set
			// (Live Shows admin's "Rumble channel" field, 2026-07-23 —
			// Austin's request to let an off-air visitor go watch past
			// broadcasts / subscribe). No link at all if that field's blank,
			// rather than pointing anywhere guessed.
			var name = document.createElement( cfg.gatedUrl ? 'a' : 'span' );
			name.className = 'fl-schedule-rail__name';
			name.textContent = cfg.name || key;
			if ( cfg.gatedUrl ) {
				name.href = cfg.gatedUrl;
				name.target = '_blank';
				name.rel = 'noopener';
			}
			li.appendChild( name );

			// Schedule is optional per show (Live Shows admin) — a show with no
			// schedule set still lists its name, just without a time line.
			if ( cfg.schedule ) {
				var when = document.createElement( 'span' );
				when.className = 'fl-schedule-rail__when';
				when.textContent = cfg.schedule;
				li.appendChild( when );
			}

			els.list.appendChild( li );
		} );
	}

	/**
	 * live=true  -> show chat, hide schedule (a show is on).
	 * live=false -> hide chat, show schedule (off-air).
	 * Uses the `hidden` attribute; editorial.css carries the matching
	 * `.fl-rail[hidden]/.fl-schedule-rail[hidden]` display:none rules.
	 */
	function applyLiveState( live ) {
		if ( els.chatRail ) {
			els.chatRail.hidden = ! live;
		}
		els.scheduleRail.hidden = !! live;
	}

	function setStatus( text, isError ) {
		if ( ! els.status ) {
			return;
		}
		els.status.textContent = text || '';
		els.status.classList.toggle( 'fl-schedule-rail__status--error', !! isError );
	}

	function wireNotify() {
		if ( ! els.form ) {
			return;
		}
		var input = els.form.querySelector( 'input[type="email"]' );
		var button = els.form.querySelector( 'button[type="submit"]' );

		els.form.addEventListener( 'submit', function ( evt ) {
			evt.preventDefault();
			var email = ( input.value || '' ).trim();
			if ( ! email ) {
				return;
			}

			button.disabled = true;
			setStatus( 'Signing you up…' );

			fetch( NEWSLETTER_ENDPOINT, {
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
						setStatus( 'That didn’t work — try again in a moment.', true );
						return;
					}
					input.value = '';
					setStatus( '✅ You’re on the list — we’ll let you know.' );
				} )
				.catch( function () {
					button.disabled = false;
					setStatus( 'That didn’t work — try again in a moment.', true );
				} );
		} );
	}

	function init() {
		var scheduleRail = document.querySelector( '[data-fl="schedule-rail"]' );
		if ( ! scheduleRail ) {
			return; // only present on the homepage hero
		}

		els = {
			scheduleRail: scheduleRail,
			chatRail: document.querySelector( '[data-fl="chat-rail"]' ),
			list: scheduleRail.querySelector( '[data-fl="schedule-list"]' ),
			form: scheduleRail.querySelector( '[data-fl="schedule-notify-form"]' ),
			status: scheduleRail.querySelector( '[data-fl="schedule-notify-status"]' ),
		};

		renderSchedule();
		wireNotify();

		// Apply the right rail synchronously at load, before live-state.js's
		// first poll returns, so the common off-air case shows the schedule
		// immediately instead of flashing the empty chat first. isLive() is a
		// synchronous read live-state.js exposes at parse time (starts false),
		// so "not yet known" reads as off-air here — a genuinely live show
		// then swaps to chat a moment later when the first poll confirms it.
		var initiallyLive = !! (
			window.FLHub &&
			window.FLHub.liveState &&
			window.FLHub.liveState.isLive &&
			window.FLHub.liveState.isLive()
		);
		applyLiveState( initiallyLive );

		document.addEventListener( 'fl:hero-state', function ( e ) {
			applyLiveState( !! ( e.detail && e.detail.live ) );
		} );
	}

	document.addEventListener( 'DOMContentLoaded', init );
} )();
