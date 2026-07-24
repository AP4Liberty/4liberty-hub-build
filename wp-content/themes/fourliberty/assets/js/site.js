/**
 * 4Liberty Network — minimal front-end behavior.
 *
 * Deliberately tiny: this theme has no build step and no framework. Anything
 * bigger (live-swap polling, chat, tip UI, product popup) is wired by the
 * 4liberty-hub plugin in later phases, not stacked in here.
 */
( function () {
	'use strict';

	document.addEventListener( 'DOMContentLoaded', function () {
		var root = document.documentElement;
		root.classList.add( 'fl-js' );

		// Mobile nav toggle for the static header menu (2026-07-23). The header
		// used to use a wp:navigation block with its own overlay toggle, but
		// that block rendered the whole masthead empty on this install (see
		// parts/header.html), so the nav is now plain HTML and owns its own
		// hamburger. No-ops if the header isn't on the page.
		var toggle = document.querySelector( '[data-fl="nav-toggle"]' );
		var menu = document.querySelector( '[data-fl="nav-menu"]' );
		if ( toggle && menu ) {
			toggle.addEventListener( 'click', function () {
				var open = menu.classList.toggle( 'is-open' );
				toggle.setAttribute( 'aria-expanded', open ? 'true' : 'false' );
			} );
			// Tapping a link closes the dropdown (same-page anchors, or just so
			// it isn't left hanging open after navigating).
			menu.addEventListener( 'click', function ( e ) {
				if ( e.target.closest( 'a' ) ) {
					menu.classList.remove( 'is-open' );
					toggle.setAttribute( 'aria-expanded', 'false' );
				}
			} );
		}
	} );
} )();
