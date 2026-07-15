<?php
/**
 * Chat & Tips settings — stub. Built in Phase 3.
 *
 * @package fourliberty-hub
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function fourliberty_hub_register_chat_tips_menu() {
	add_submenu_page(
		'fourliberty-hub',
		__( 'Chat & Tips', 'fourliberty-hub' ),
		__( 'Chat & Tips', 'fourliberty-hub' ),
		'manage_options',
		'fourliberty-hub-chat-tips',
		'fourliberty_hub_render_chat_tips'
	);
}
add_action( 'admin_menu', 'fourliberty_hub_register_chat_tips_menu' );

function fourliberty_hub_render_chat_tips() {
	fourliberty_hub_render_stub(
		__( 'Chat & Tips', 'fourliberty-hub' ),
		__( 'Phase 3', 'fourliberty-hub' ),
		__( 'You\'ll turn chat on/off, flip between open and gated login, moderate, and set the tip-the-show amounts here.', 'fourliberty-hub' )
	);
}
