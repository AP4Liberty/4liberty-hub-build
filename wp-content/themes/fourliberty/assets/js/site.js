/**
 * 4Liberty Network — minimal front-end behavior.
 *
 * Deliberately tiny: this theme has no build step and no framework. Anything
 * bigger (live-swap polling, chat, tip UI, product popup) is wired by the
 * 4liberty-hub plugin in later phases, not stacked in here.
 */
( function () {
	'use strict';

	// Mobile nav: the block Navigation menu already ships its own overlay
	// toggle, so this only handles the hero "also live" row collapsing to a
	// horizontal scroller on very small screens — a class hook, no logic yet.
	document.addEventListener( 'DOMContentLoaded', function () {
		var root = document.documentElement;
		root.classList.add( 'fl-js' );
	} );
} )();
