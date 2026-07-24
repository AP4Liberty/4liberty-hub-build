/**
 * Shop Ad admin screen — wires the "Choose image" button to WordPress's
 * built-in media library modal (wp.media, loaded via wp_enqueue_media() in
 * settings-shop-ad.php) so Austin picks an image the same way he already
 * does for a featured image or the Site Logo — no URLs to find or paste.
 */
( function () {
	'use strict';

	function init() {
		var chooseBtn = document.getElementById( 'fourliberty-shop-ad-choose-image' );
		var removeBtn = document.getElementById( 'fourliberty-shop-ad-remove-image' );
		var urlInput = document.getElementById( 'fourliberty_shop_ad_image_url' );
		var preview = document.getElementById( 'fourliberty-shop-ad-preview' );
		if ( ! chooseBtn || ! urlInput || ! preview || ! window.wp || ! wp.media ) {
			return;
		}

		var frame = null;

		function setImage( url ) {
			urlInput.value = url || '';
			preview.style.backgroundImage = url ? 'url(' + url + ')' : '';
			if ( removeBtn ) {
				removeBtn.style.display = url ? '' : 'none';
			}
		}

		chooseBtn.addEventListener( 'click', function () {
			if ( ! frame ) {
				frame = wp.media( {
					title: 'Choose an ad image',
					button: { text: 'Use this image' },
					multiple: false,
				} );
				frame.on( 'select', function () {
					var attachment = frame.state().get( 'selection' ).first().toJSON();
					var url = ( attachment.sizes && attachment.sizes.large ) ? attachment.sizes.large.url : attachment.url;
					setImage( url );
				} );
			}
			frame.open();
		} );

		if ( removeBtn ) {
			removeBtn.addEventListener( 'click', function () {
				setImage( '' );
			} );
		}
	}

	document.addEventListener( 'DOMContentLoaded', init );
} )();
