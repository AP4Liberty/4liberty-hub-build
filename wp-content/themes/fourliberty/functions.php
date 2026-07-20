<?php
/**
 * 4Liberty Network theme setup.
 *
 * Keep this file thin. Global look (color/type/spacing) lives in theme.json so
 * the owner can change it from Appearance ▸ Editor without touching code.
 * This file only wires up support flags, the extra stylesheet for effects
 * theme.json can't express (ticker, chat rail, hover/motion), and pattern
 * registration.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'FOURLIBERTY_VERSION', '0.1.0' );

/**
 * Theme support.
 */
function fourliberty_setup() {
	add_theme_support( 'wp-block-styles' );
	add_theme_support( 'editor-styles' );
	add_theme_support( 'responsive-embeds' );
	add_theme_support( 'align-wide' );
	add_theme_support( 'automatic-feed-links' );
	add_theme_support( 'post-thumbnails' );
	add_theme_support(
		'html5',
		array( 'search-form', 'comment-form', 'comment-list', 'gallery', 'caption', 'style', 'script' )
	);

	add_editor_style( 'assets/css/editorial.css' );

	// Existing site had a classic "primary" menu (What is the 4Liberty Network,
	// Blog, Advertising, Support, About, Shop). Keep it registered so nav
	// content isn't orphaned even though the theme itself uses the block
	// Navigation block for the masthead nav.
	register_nav_menus(
		array(
			'primary' => __( 'Primary Navigation', 'fourliberty' ),
			'footer'  => __( 'Footer Navigation', 'fourliberty' ),
		)
	);
}
add_action( 'after_setup_theme', 'fourliberty_setup' );

/**
 * Front-end + editor assets.
 *
 * editorial.css carries everything the mockup needed that theme.json tokens
 * can't express directly: the live ticker, the chat rail, card hover motion,
 * the sticky masthead blur, the pulse animation, etc. It reads its colors
 * from the theme.json custom properties (var(--wp--preset--color--*)) so it
 * still follows whatever palette the owner sets in Appearance ▸ Editor.
 */
function fourliberty_assets() {
	// filemtime()-based versions so the enqueued URL changes on every deploy —
	// a static version string left cached CSS/JS stale in visitors' browsers
	// for up to a month (Cache-Control: max-age=2678400) after any edit.
	wp_enqueue_style(
		'fourliberty-editorial',
		get_theme_file_uri( 'assets/css/editorial.css' ),
		array(),
		filemtime( get_theme_file_path( 'assets/css/editorial.css' ) )
	);

	wp_enqueue_script(
		'fourliberty-site',
		get_theme_file_uri( 'assets/js/site.js' ),
		array(),
		filemtime( get_theme_file_path( 'assets/js/site.js' ) ),
		true
	);

	// Phase 2 live-swapper. Enqueued site-wide like fourliberty-site above —
	// it no-ops immediately if [data-fl="hero-player"] isn't on the page, so
	// there's no need for template-conditional loading.
	wp_enqueue_script(
		'fourliberty-live-state',
		get_theme_file_uri( 'assets/js/live-state.js' ),
		array(),
		filemtime( get_theme_file_path( 'assets/js/live-state.js' ) ),
		true
	);
	wp_localize_script( 'fourliberty-live-state', 'fourlibertyLiveShows', fourliberty_live_shows_config() );
	wp_localize_script(
		'fourliberty-live-state',
		'fourlibertyLiveEndpoint',
		array( 'url' => fourliberty_live_state_endpoint() )
	);

	// /shows/ page live badges — same no-op-if-absent pattern, same endpoint.
	wp_enqueue_script(
		'fourliberty-show-grid',
		get_theme_file_uri( 'assets/js/show-grid.js' ),
		array(),
		filemtime( get_theme_file_path( 'assets/js/show-grid.js' ) ),
		true
	);
	wp_localize_script(
		'fourliberty-show-grid',
		'fourlibertyLiveEndpoint',
		array( 'url' => fourliberty_live_state_endpoint() )
	);
}
add_action( 'wp_enqueue_scripts', 'fourliberty_assets' );

/**
 * The Netlify poller's public endpoint. A constant (not hardcoded in JS) so
 * it can move — e.g. behind a custom domain once Cloudflare (Phase 5) is in
 * front of the site — without a theme redeploy.
 */
function fourliberty_live_state_endpoint() {
	return defined( 'FOURLIBERTY_LIVE_STATE_ENDPOINT' )
		? FOURLIBERTY_LIVE_STATE_ENDPOINT
		: 'https://4liberty-poller.netlify.app/api/live-state';
}

/**
 * Live-show display config consumed by assets/js/live-state.js: display
 * names, hero-priority order, and the gated-broadcast (Freedom Arcade) CTA.
 *
 * This is the seam Phase 2 task E (the admin "Live Shows" panel) writes to
 * via update_option( 'fourliberty_live_shows_config', ... ) — until that
 * panel exists, the defaults below (matching the roster locked in
 * PHASE-2-BUILD-PLAN.md) are what ships. The JS never needs to change when
 * the admin panel starts overriding this.
 *
 * gatedUrl below is a placeholder (best-guess Rumble channel URL format) —
 * task E's admin field is the source of truth once it ships; confirm the
 * real URL with Austin before relying on it.
 */
function fourliberty_live_shows_config() {
	$defaults = array(
		'order' => array( 'WUA', 'WUJC', 'CULTURAMA', 'HOMESCHOOL', 'CAFECITO' ),
		'shows' => array(
			'WUA'        => array(
				'name'            => 'Wake Up America',
				'host'            => 'with Austin Petersen',
				'gatedTitleMatch' => 'Freedom Arcade',
				'gatedLabel'      => 'Subscribe on Rumble to watch live →',
				'gatedUrl'        => 'https://rumble.com/c/AP4Liberty',
			),
			'WUJC'       => array( 'name' => 'Wake Up Jefferson City' ),
			'CULTURAMA'  => array( 'name' => 'Culturama' ),
			'HOMESCHOOL' => array( 'name' => 'Homeschool Workshop' ),
			'CAFECITO'   => array( 'name' => 'Cafecito Libre' ),
		),
	);

	$stored = get_option( 'fourliberty_live_shows_config' );
	return is_array( $stored ) ? $stored : $defaults;
}

/**
 * Register the theme's block pattern category so the front-page patterns
 * (hero, newsroom grid, channel strip, newsletter, support band) group
 * together in the pattern inserter instead of scattering into "Uncategorized".
 */
function fourliberty_pattern_category() {
	register_block_pattern_category(
		'fourliberty',
		array( 'label' => __( '4Liberty Hub', 'fourliberty' ) )
	);
}
add_action( 'init', 'fourliberty_pattern_category' );

/**
 * Deliberately no widget areas, no custom logo callback beyond core support,
 * no page-builder shims — the brief is minimal plugins / no bolt-ons.
 */
add_theme_support( 'custom-logo', array(
	'height'      => 96,
	'width'       => 96,
	'flex-height' => true,
	'flex-width'  => true,
) );

/**
 * Rough reading-time estimate (whole minutes, minimum 1) for article
 * bylines. Simple word-count / average-reading-speed heuristic — no plugin
 * needed for something this small.
 */
function fourliberty_reading_time( $post_id ) {
	$word_count = str_word_count( wp_strip_all_tags( get_post_field( 'post_content', $post_id ) ) );
	return max( 1, (int) round( $word_count / 200 ) );
}
