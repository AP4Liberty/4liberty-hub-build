/**
 * Live Shows admin screen (Phase 2, task E) — vanilla drag-to-reorder.
 *
 * No sortable library: this is one small list on one admin screen, and the
 * rest of the build (theme + plugin) is deliberately dependency-free JS.
 * Native HTML5 drag-and-drop events move the row in the DOM; on every drop
 * the hidden #fourliberty_order input is rewritten from the current DOM
 * order, which is what actually gets saved.
 */
( function () {
	'use strict';

	function syncOrderInput( container ) {
		var order = Array.prototype.slice
			.call( container.querySelectorAll( '.fl-hub-row' ) )
			.map( function ( row ) {
				return row.getAttribute( 'data-key' );
			} );
		var input = document.getElementById( 'fourliberty_order' );
		if ( input ) {
			input.value = order.join( ',' );
		}
	}

	function init() {
		var container = document.getElementById( 'fourliberty-live-shows-rows' );
		if ( ! container ) {
			return;
		}

		var dragging = null;

		container.addEventListener( 'dragstart', function ( e ) {
			var row = e.target.closest( '.fl-hub-row' );
			if ( ! row ) {
				return;
			}
			dragging = row;
			row.style.opacity = '0.4';
			e.dataTransfer.effectAllowed = 'move';
		} );

		container.addEventListener( 'dragend', function () {
			if ( dragging ) {
				dragging.style.opacity = '';
			}
			dragging = null;
			syncOrderInput( container );
		} );

		container.addEventListener( 'dragover', function ( e ) {
			e.preventDefault();
			var overRow = e.target.closest( '.fl-hub-row' );
			if ( ! overRow || overRow === dragging || ! dragging ) {
				return;
			}
			var rect = overRow.getBoundingClientRect();
			var after = e.clientY - rect.top > rect.height / 2;
			container.insertBefore( dragging, after ? overRow.nextSibling : overRow );
		} );
	}

	document.addEventListener( 'DOMContentLoaded', init );
} )();
