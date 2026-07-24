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

	/**
	 * Cover-image picker (2026-07-24) — same wp.media flow as the Shop Ad and
	 * Dark Channel image-ad pickers. Delegated on the whole document (rows
	 * here are server-rendered, never cloned, but delegation is still the
	 * simplest way to cover every row without wiring each one individually).
	 */
	function wireCoverImagePicker() {
		document.addEventListener( 'click', function ( e ) {
			var chooseBtn = e.target.closest( '.fl-hub-choose-cover' );
			var removeBtn = e.target.closest( '.fl-hub-remove-cover' );
			if ( ! chooseBtn && ! removeBtn ) {
				return;
			}
			e.preventDefault();
			var row = ( chooseBtn || removeBtn ).closest( '.fl-hub-row' );
			if ( ! row ) {
				return;
			}
			var input = row.querySelector( '.fl-hub-cover-url' );
			var preview = row.querySelector( '.fl-hub-cover-preview' );
			var removeLink = row.querySelector( '.fl-hub-remove-cover' );

			function setCover( url ) {
				if ( input ) {
					input.value = url || '';
				}
				if ( preview ) {
					preview.style.backgroundImage = url ? 'url(' + url + ')' : '';
				}
				if ( removeLink ) {
					removeLink.style.display = url ? '' : 'none';
				}
			}

			if ( removeBtn ) {
				setCover( '' );
				return;
			}
			if ( ! window.wp || ! wp.media ) {
				return;
			}
			var frame = wp.media( {
				title: 'Choose a cover image',
				button: { text: 'Use this image' },
				multiple: false,
			} );
			frame.on( 'select', function () {
				var attachment = frame.state().get( 'selection' ).first().toJSON();
				var url = ( attachment.sizes && attachment.sizes.large ) ? attachment.sizes.large.url : attachment.url;
				setCover( url );
			} );
			frame.open();
		} );
	}

	function init() {
		var container = document.getElementById( 'fourliberty-live-shows-rows' );
		if ( ! container ) {
			return;
		}

		wireCoverImagePicker();

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
