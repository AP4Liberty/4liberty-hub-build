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
}
add_action( 'wp_enqueue_scripts', 'fourliberty_assets' );

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
