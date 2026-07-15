<?php
/**
 * Product Push settings — stub. Built in Phase 4.
 *
 * @package fourliberty-hub
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function fourliberty_hub_register_product_push_menu() {
	add_submenu_page(
		'fourliberty-hub',
		__( 'Product Push', 'fourliberty-hub' ),
		__( 'Product Push', 'fourliberty-hub' ),
		'manage_options',
		'fourliberty-hub-product-push',
		'fourliberty_hub_render_product_push'
	);
}
add_action( 'admin_menu', 'fourliberty_hub_register_product_push_menu' );

function fourliberty_hub_render_product_push() {
	fourliberty_hub_render_stub(
		__( 'Product Push', 'fourliberty-hub' ),
		__( 'Phase 4', 'fourliberty-hub' ),
		__( 'You\'ll search the Shopify catalog and click a product to push it live as a shoppable card during a show.', 'fourliberty-hub' )
	);
}
