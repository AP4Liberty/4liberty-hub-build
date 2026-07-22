/**
 * Dark Channel admin screen (Phase 2, task F) — vanilla add/remove/reorder.
 *
 * Same "no library" approach as admin-live-shows.js. Two differences from
 * that screen: rows here are numeric-indexed (fourliberty_playlist[],
 * fourliberty_ads[]), so drag-reorder just needs to move the DOM node —
 * browsers submit form fields in document order, so there's no separate
 * hidden "order" input to keep in sync. And rows can be added/removed, via
 * cloning the <template> each list keeps for exactly that purpose.
 */
( function () {
	'use strict';

	function wireDragReorder( container ) {
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

	function wireAddButton( buttonId, templateId, containerId ) {
		var button = document.getElementById( buttonId );
		var template = document.getElementById( templateId );
		var container = document.getElementById( containerId );
		if ( ! button || ! template || ! container ) {
			return;
		}
		button.addEventListener( 'click', function () {
			var clone = template.content.cloneNode( true );
			container.appendChild( clone );
		} );
	}

	// Event delegation on the document so it covers rows added later by the
	// "+ Add" buttons without needing to re-wire listeners per row.
	document.addEventListener( 'click', function ( e ) {
		if ( e.target.closest( '.fl-hub-remove-row' ) ) {
			var row = e.target.closest( '.fl-hub-row' );
			if ( row ) {
				row.parentNode.removeChild( row );
			}
		}
	} );

	document.addEventListener( 'change', function ( e ) {
		if ( e.target.classList.contains( 'fl-hub-type-select' ) ) {
			var row = e.target.closest( '.fl-hub-row' );
			if ( ! row ) {
				return;
			}
			var isPost = e.target.value === 'post';
			row.setAttribute( 'data-type', e.target.value );
			row.querySelectorAll( '.fl-hub-field-video' ).forEach( function ( el ) {
				el.style.display = isPost ? 'none' : '';
			} );
			row.querySelectorAll( '.fl-hub-field-post' ).forEach( function ( el ) {
				el.style.display = isPost ? '' : 'none';
			} );
			return;
		}

		// Picking a blog post auto-fills the Title field (only if it's still
		// empty, so it never overwrites something Austin already typed).
		if ( e.target.matches( '.fl-hub-field-post select' ) ) {
			var postRow = e.target.closest( '.fl-hub-row' );
			if ( ! postRow ) {
				return;
			}
			var titleInput = postRow.querySelector( 'input[name="fourliberty_playlist[][title]"]' );
			var chosen = e.target.selectedOptions[ 0 ];
			if ( titleInput && ! titleInput.value && chosen && chosen.dataset.title ) {
				titleInput.value = chosen.dataset.title;
			}
		}
	} );

	function init() {
		var playlistRows = document.getElementById( 'fourliberty-playlist-rows' );
		if ( playlistRows ) {
			wireDragReorder( playlistRows );
		}
		wireAddButton( 'fourliberty-add-playlist-item', 'fourliberty-playlist-row-template', 'fourliberty-playlist-rows' );
		wireAddButton( 'fourliberty-add-ad', 'fourliberty-ad-row-template', 'fourliberty-ads-rows' );
	}

	document.addEventListener( 'DOMContentLoaded', init );
} )();
