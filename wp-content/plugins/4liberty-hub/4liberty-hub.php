<?php
/**
 * Plugin Name: 4Liberty Hub
 * Plugin URI: https://wakeupamericashow.com
 * Description: Owner-facing admin + all custom 4Liberty Network features: live-swapper, Dark Channel, chat, tips, identity, and the shoppable product popup. Everything here is adjustable from the "4Liberty Hub" admin screen — never by editing code (Golden Rule #3).
 * Version: 0.1.0
 * Requires at least: 6.5
 * Requires PHP: 8.0
 * Author: Stonegait Pictures LLC
 * License: GPL v2 or later
 * Text Domain: fourliberty-hub
 *
 * Phase map (see BUILD-PLAN.md):
 *   Phase 1 (this): admin menu shell only, no functional settings yet.
 *   Phase 2: Live Shows + Dark Channel settings, the Netlify poller endpoint.
 *   Phase 3: Chat (Stream) + Tips (Square) + light-account settings.
 *   Phase 4: Product Push (Shopify) settings + the live popup.
 *
 * @package fourliberty-hub
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'FOURLIBERTY_HUB_VERSION', '0.1.0' );
define( 'FOURLIBERTY_HUB_PATH', plugin_dir_path( __FILE__ ) );
define( 'FOURLIBERTY_HUB_URL', plugin_dir_url( __FILE__ ) );

require_once FOURLIBERTY_HUB_PATH . 'includes/admin-menu.php';
require_once FOURLIBERTY_HUB_PATH . 'includes/settings-live-shows.php';
require_once FOURLIBERTY_HUB_PATH . 'includes/settings-dark-channel.php';
require_once FOURLIBERTY_HUB_PATH . 'includes/settings-chat-tips.php';
require_once FOURLIBERTY_HUB_PATH . 'includes/settings-product-push.php';
