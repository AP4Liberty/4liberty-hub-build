<?php
/**
 * Live Shows settings — stub. Built in Phase 2 alongside the Netlify poller.
 *
 * @package fourliberty-hub
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function fourliberty_hub_register_live_shows_menu() {
	add_submenu_page(
		'fourliberty-hub',
		__( 'Live Shows', 'fourliberty-hub' ),
		__( 'Live Shows', 'fourliberty-hub' ),
		'manage_options',
		'fourliberty-hub-live-shows',
		'fourliberty_hub_render_live_shows'
	);
}
add_action( 'admin_menu', 'fourliberty_hub_register_live_shows_menu' );

function fourliberty_hub_render_live_shows() {
	fourliberty_hub_render_stub(
		__( 'Live Shows', 'fourliberty-hub' ),
		__( 'Phase 2', 'fourliberty-hub' ),
		__( 'You\'ll list each network Rumble channel here and drag to set hero priority for when more than one show is live at once.', 'fourliberty-hub' )
	);
}
