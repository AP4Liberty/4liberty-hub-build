<?php
/**
 * Dark Channel settings — stub. Built in Phase 2.
 *
 * @package fourliberty-hub
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function fourliberty_hub_register_dark_channel_menu() {
	add_submenu_page(
		'fourliberty-hub',
		__( 'Dark Channel', 'fourliberty-hub' ),
		__( 'Dark Channel', 'fourliberty-hub' ),
		'manage_options',
		'fourliberty-hub-dark-channel',
		'fourliberty_hub_render_dark_channel'
	);
}
add_action( 'admin_menu', 'fourliberty_hub_register_dark_channel_menu' );

function fourliberty_hub_render_dark_channel() {
	fourliberty_hub_render_stub(
		__( 'Dark Channel', 'fourliberty-hub' ),
		__( 'Phase 2', 'fourliberty-hub' ),
		__( 'You\'ll drag-and-drop a playlist of YouTube links, Rumble links, and blog posts here, plus set how often ads play, for whenever no show is live.', 'fourliberty-hub' )
	);
}
