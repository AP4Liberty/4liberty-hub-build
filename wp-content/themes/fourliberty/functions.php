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

	// Homepage/masthead "On Air" ticker (2026-07-23). Depends on
	// fourliberty-live-state purely for load order — it needs
	// window.fourlibertyLiveShows (localized above) to already exist, and
	// polls /api/live-state independently, same pattern as
	// fourliberty-rumble-mirror below. No-ops immediately if the ticker
	// markup (parts/header.html) isn't on the page.
	wp_enqueue_script(
		'fourliberty-ticker',
		get_theme_file_uri( 'assets/js/ticker.js' ),
		array( 'fourliberty-live-state' ),
		filemtime( get_theme_file_path( 'assets/js/ticker.js' ) ),
		true
	);
	wp_localize_script(
		'fourliberty-ticker',
		'fourlibertyLiveEndpoint',
		array( 'url' => fourliberty_live_state_endpoint() )
	);

	// Phase 2 Dark Channel playout engine. Depends on fourliberty-live-state
	// so its DOMContentLoaded listener attaches after live-state.js's does —
	// it needs window.FLHub.liveState to exist by the time it checks
	// isLive() at init. No-ops immediately if [data-fl="hero-player"] isn't
	// on the page or nothing's been programmed yet, same pattern as above.
	wp_enqueue_script(
		'fourliberty-dark-channel',
		get_theme_file_uri( 'assets/js/dark-channel.js' ),
		array( 'fourliberty-live-state' ),
		filemtime( get_theme_file_path( 'assets/js/dark-channel.js' ) ),
		true
	);
	wp_localize_script( 'fourliberty-dark-channel', 'fourlibertyDarkChannel', fourliberty_dark_channel_config() );

	// /shows/ page live badges — same no-op-if-absent pattern, same endpoint.
	// Depends on fourliberty-live-state so window.fourlibertyLiveShows (each
	// show's gatedUrl/Rumble channel, 2026-07-23) is guaranteed defined by the
	// time this reads it for the not-live card destination — an explicit
	// dependency instead of relying on incidental enqueue order.
	wp_enqueue_script(
		'fourliberty-show-grid',
		get_theme_file_uri( 'assets/js/show-grid.js' ),
		array( 'fourliberty-live-state' ),
		filemtime( get_theme_file_path( 'assets/js/show-grid.js' ) ),
		true
	);
	wp_localize_script(
		'fourliberty-show-grid',
		'fourlibertyLiveEndpoint',
		array( 'url' => fourliberty_live_state_endpoint() )
	);

	// Phase 3 Rumble chat, merged into the on-site feed (2026-07-23). Depends
	// on fourliberty-live-state so it can listen for the "fl:hero-state"
	// event that script dispatches (see live-state.js) — it never re-derives
	// which channel is hero itself. Also depends on fourliberty-chat, whose
	// appendExternalMessage() hook it hands new Rumble messages to — same
	// load-order reasoning as fourliberty-tips/fourliberty-account below.
	// Same no-op-if-absent pattern: does nothing unless [data-fl="chat-feed"]
	// is on the page.
	wp_enqueue_script(
		'fourliberty-rumble-mirror',
		get_theme_file_uri( 'assets/js/rumble-mirror.js' ),
		array( 'fourliberty-live-state', 'fourliberty-chat' ),
		filemtime( get_theme_file_path( 'assets/js/rumble-mirror.js' ) ),
		true
	);
	wp_localize_script(
		'fourliberty-rumble-mirror',
		'fourlibertyLiveEndpoint',
		array( 'url' => fourliberty_live_state_endpoint() )
	);
	wp_localize_script( 'fourliberty-rumble-mirror', 'fourlibertyChatTips', fourliberty_chat_tips_config() );

	// Phase 3 on-site chat. No-ops immediately if [data-fl="chat-rail"] isn't
	// on the page (same pattern as every other script here). Uses dynamic
	// import() internally to load the Stream Chat client from a CDN — no
	// bundler in this theme, so a classic (non-module) script that
	// import()s at runtime is the load-bearing seam, not a <script
	// type="module"> tag.
	wp_enqueue_script(
		'fourliberty-chat',
		get_theme_file_uri( 'assets/js/chat.js' ),
		array(),
		filemtime( get_theme_file_path( 'assets/js/chat.js' ) ),
		true
	);
	wp_localize_script( 'fourliberty-chat', 'fourlibertyChatTips', fourliberty_chat_tips_config() );
	wp_localize_script(
		'fourliberty-chat',
		'fourlibertyChatTokenEndpoint',
		array( 'url' => fourliberty_chat_token_endpoint() )
	);

	// Phase 3 "tip the show". No-ops immediately if [data-fl="tip-bar"]
	// isn't on the page. Depends on fourliberty-chat so it can read
	// window.FLHub.chat.getDisplayName() (reuse a name already set in
	// chat) — chat.js defines that hook unconditionally at parse time, not
	// only once connected, so the dependency only needs correct load
	// order, not a runtime race.
	wp_enqueue_script(
		'fourliberty-tips',
		get_theme_file_uri( 'assets/js/tips.js' ),
		array( 'fourliberty-chat' ),
		filemtime( get_theme_file_path( 'assets/js/tips.js' ) ),
		true
	);
	wp_localize_script( 'fourliberty-tips', 'fourlibertyChatTips', fourliberty_chat_tips_config() );
	wp_localize_script(
		'fourliberty-tips',
		'fourlibertyTipCreateEndpoint',
		array( 'url' => fourliberty_tip_create_endpoint() )
	);
	wp_localize_script(
		'fourliberty-tips',
		'fourlibertyTipRepeatEndpoint',
		array( 'url' => fourliberty_tip_repeat_endpoint() )
	);

	// Phase 3 light accounts (email magic link). No-ops immediately if
	// [data-fl="chat-rail"] isn't on the page. Depends on fourliberty-chat
	// for the same getDisplayName() hook tips.js uses — carries a visitor's
	// typed chat name forward into their account on signup.
	wp_enqueue_script(
		'fourliberty-account',
		get_theme_file_uri( 'assets/js/account.js' ),
		array( 'fourliberty-chat' ),
		filemtime( get_theme_file_path( 'assets/js/account.js' ) ),
		true
	);
	wp_localize_script(
		'fourliberty-account',
		'fourlibertyAuthRequestEndpoint',
		array( 'url' => fourliberty_auth_request_endpoint() )
	);
	wp_localize_script(
		'fourliberty-account',
		'fourlibertyAuthVerifyEndpoint',
		array( 'url' => fourliberty_auth_verify_endpoint() )
	);
	wp_localize_script(
		'fourliberty-account',
		'fourlibertyAuthCodeEndpoint',
		array( 'url' => fourliberty_auth_code_endpoint() )
	);
	wp_localize_script(
		'fourliberty-account',
		'fourlibertyAccountSettingsEndpoint',
		array( 'url' => fourliberty_account_settings_endpoint() )
	);

	// Community page composer/reply/report (Phase 8, Task D). No-ops
	// immediately unless its own markup ([data-fl="community-composer-
	// area"], [data-fl="community-reply-area"], or a [data-fl="community-
	// report"] button) is on the page. Depends on fourliberty-account for
	// window.FLHub.identity.mount()/getSession()/onChange().
	wp_enqueue_script(
		'fourliberty-community',
		get_theme_file_uri( 'assets/js/community.js' ),
		array( 'fourliberty-account' ),
		filemtime( get_theme_file_path( 'assets/js/community.js' ) ),
		true
	);
	wp_localize_script(
		'fourliberty-community',
		'fourlibertyCommunityPostEndpoint',
		array( 'url' => fourliberty_community_post_endpoint() )
	);
	wp_localize_script(
		'fourliberty-community',
		'fourlibertyCommunityReplyEndpoint',
		array( 'url' => fourliberty_community_reply_endpoint() )
	);
	wp_localize_script(
		'fourliberty-community',
		'fourlibertyCommunityReportEndpoint',
		array( 'url' => fourliberty_community_report_endpoint() )
	);

	// "The Daily Brief" newsletter signup. No-ops immediately if
	// [data-fl="newsletter-form"] isn't on the page. Independent of the
	// chat/tips/account scripts — no shared state needed.
	wp_enqueue_script(
		'fourliberty-newsletter',
		get_theme_file_uri( 'assets/js/newsletter.js' ),
		array(),
		filemtime( get_theme_file_path( 'assets/js/newsletter.js' ) ),
		true
	);
	wp_localize_script(
		'fourliberty-newsletter',
		'fourlibertyNewsletterEndpoint',
		array( 'url' => fourliberty_newsletter_subscribe_endpoint() )
	);

	// Off-air "When we're live" schedule panel (2026-07-23). Swaps the chat
	// rail for a show-schedule panel whenever nothing's live — no-ops if the
	// schedule-rail markup (patterns/hero-live.php) isn't on the page.
	// Depends on fourliberty-live-state for window.FLHub + the localized
	// window.fourlibertyLiveShows it reads, and on fourliberty-newsletter so
	// window.fourlibertyNewsletterEndpoint (its "notify me" box) is defined.
	wp_enqueue_script(
		'fourliberty-schedule-rail',
		get_theme_file_uri( 'assets/js/schedule-rail.js' ),
		array( 'fourliberty-live-state', 'fourliberty-newsletter' ),
		filemtime( get_theme_file_path( 'assets/js/schedule-rail.js' ) ),
		true
	);
}
add_action( 'wp_enqueue_scripts', 'fourliberty_assets' );

/** The newsletter-subscribe Netlify function's public endpoint — same backend site. */
function fourliberty_newsletter_subscribe_endpoint() {
	return defined( 'FOURLIBERTY_NEWSLETTER_SUBSCRIBE_ENDPOINT' )
		? FOURLIBERTY_NEWSLETTER_SUBSCRIBE_ENDPOINT
		: 'https://4liberty-poller.netlify.app/api/newsletter-subscribe';
}

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
 * The chat-token Netlify function's public endpoint — same backend site as
 * the poller (see PHASE-3-BUILD-PLAN.md Decision 1: one Netlify project for
 * everything secret-touching), a different function within it.
 */
function fourliberty_chat_token_endpoint() {
	return defined( 'FOURLIBERTY_CHAT_TOKEN_ENDPOINT' )
		? FOURLIBERTY_CHAT_TOKEN_ENDPOINT
		: 'https://4liberty-poller.netlify.app/api/chat-token';
}

/** The tip-create Netlify function's public endpoint — same backend site. */
function fourliberty_tip_create_endpoint() {
	return defined( 'FOURLIBERTY_TIP_CREATE_ENDPOINT' )
		? FOURLIBERTY_TIP_CREATE_ENDPOINT
		: 'https://4liberty-poller.netlify.app/api/tip-create';
}

/**
 * The tip-repeat Netlify function's public endpoint — same backend site.
 * Task F's one-tap saved-card charge, a separate function from tip-create.
 */
function fourliberty_tip_repeat_endpoint() {
	return defined( 'FOURLIBERTY_TIP_REPEAT_ENDPOINT' )
		? FOURLIBERTY_TIP_REPEAT_ENDPOINT
		: 'https://4liberty-poller.netlify.app/api/tip-repeat';
}

/** The community-post Netlify function's public endpoint — same backend site. */
function fourliberty_community_post_endpoint() {
	return defined( 'FOURLIBERTY_COMMUNITY_POST_ENDPOINT' )
		? FOURLIBERTY_COMMUNITY_POST_ENDPOINT
		: 'https://4liberty-poller.netlify.app/api/community-post';
}

/** The community-reply Netlify function's public endpoint — same backend site. */
function fourliberty_community_reply_endpoint() {
	return defined( 'FOURLIBERTY_COMMUNITY_REPLY_ENDPOINT' )
		? FOURLIBERTY_COMMUNITY_REPLY_ENDPOINT
		: 'https://4liberty-poller.netlify.app/api/community-reply';
}

/** The community-report Netlify function's public endpoint — same backend site. */
function fourliberty_community_report_endpoint() {
	return defined( 'FOURLIBERTY_COMMUNITY_REPORT_ENDPOINT' )
		? FOURLIBERTY_COMMUNITY_REPORT_ENDPOINT
		: 'https://4liberty-poller.netlify.app/api/community-report';
}

/** The account-settings Netlify function's public endpoint — same backend site. */
function fourliberty_account_settings_endpoint() {
	return defined( 'FOURLIBERTY_ACCOUNT_SETTINGS_ENDPOINT' )
		? FOURLIBERTY_ACCOUNT_SETTINGS_ENDPOINT
		: 'https://4liberty-poller.netlify.app/api/account-settings';
}

/**
 * Re-validates a stored GIF URL at RENDER time, not just on write — belt-
 * and-suspenders alongside community-rest-routes.php's write-time check
 * (PHASE-8-TASK-E-PLAN.md Decision 2: "both, not either"). Falls back to
 * empty if the plugin isn't active, same defensive habit as this file's
 * other bridges to plugin-owned logic (e.g. fourliberty_hub_live_shows_
 * config() callers elsewhere in this file).
 */
function fourliberty_community_safe_gif_url( $raw ) {
	if ( ! $raw || ! function_exists( 'fourliberty_hub_validate_gif_url' ) ) {
		return '';
	}
	return fourliberty_hub_validate_gif_url( $raw );
}

/** The config-status Netlify function's public endpoint — same backend site. */
function fourliberty_config_status_endpoint() {
	return defined( 'FOURLIBERTY_CONFIG_STATUS_ENDPOINT' )
		? FOURLIBERTY_CONFIG_STATUS_ENDPOINT
		: 'https://4liberty-poller.netlify.app/api/config-status';
}

/** The auth-request Netlify function's public endpoint — same backend site. */
function fourliberty_auth_request_endpoint() {
	return defined( 'FOURLIBERTY_AUTH_REQUEST_ENDPOINT' )
		? FOURLIBERTY_AUTH_REQUEST_ENDPOINT
		: 'https://4liberty-poller.netlify.app/api/auth-request';
}

/** The auth-verify Netlify function's public endpoint — same backend site. */
function fourliberty_auth_verify_endpoint() {
	return defined( 'FOURLIBERTY_AUTH_VERIFY_ENDPOINT' )
		? FOURLIBERTY_AUTH_VERIFY_ENDPOINT
		: 'https://4liberty-poller.netlify.app/api/auth-verify';
}

/**
 * The auth-code Netlify function's public endpoint — same backend site.
 * Completes login via the 6-digit code sent alongside the magic link
 * (PHASE-8-BUILD-PLAN.md Decision 11a), same pattern as the other two.
 */
function fourliberty_auth_code_endpoint() {
	return defined( 'FOURLIBERTY_AUTH_CODE_ENDPOINT' )
		? FOURLIBERTY_AUTH_CODE_ENDPOINT
		: 'https://4liberty-poller.netlify.app/api/auth-code';
}

/**
 * Chat & Tips config consumed by assets/js/chat.js, tips.js, and
 * rumble-mirror.js. This is the seam Phase 3 task G's admin panel ("Chat &
 * Tips" settings, includes/settings-chat-tips.php) writes to via
 * update_option( 'fourliberty_chat_tips_config', ... ) — same pattern as
 * fourliberty_live_shows_config() below.
 *
 * `mode` and the tip bounds are enforced SERVER-SIDE on Netlify (a
 * front-end-only toggle could be bypassed from the browser) — see
 * fourliberty_register_rest_routes() below, which exposes exactly these two
 * fields at a public REST route netlify/functions/poll-wp-config.mts polls
 * every minute, and netlify/lib/config.mts, which is what chat-token.mts and
 * tip-create.mts actually read. Everything else here is browser-only and
 * takes effect the next page load — no bridge needed.
 *
 * squareApplicationId/squareLocationId/squareEnvironment are all
 * PUBLISHABLE (safe in the browser by design — see PHASE-3-BUILD-PLAN.md's
 * publishable-vs-secret split). The actual money-moving secret
 * (SQUARE_ACCESS_TOKEN) lives only in Netlify, never here. Defaults below
 * are the real Sandbox app Task A created ("4Liberty Hub"), the same
 * pattern fourliberty_live_shows_config() uses for the real Rumble roster.
 */
function fourliberty_chat_tips_config() {
	$defaults = array(
		'chatEnabled'         => true,
		'mode'                => 'open',
		'tipPresets'          => array( 5, 17.76, 50 ),
		'tipMinDollars'       => 1,
		'tipMaxDollars'       => 500,
		'hideBotDefault'      => true,
		'moderationNotes'     => '',
		'squareApplicationId' => 'sandbox-sq0idb-i1ElCdQZdIJIwzLoN5HREA',
		'squareLocationId'    => 'LNTAXJD5J1AZD',
		'squareEnvironment'   => 'sandbox',
	);

	$stored = get_option( 'fourliberty_chat_tips_config' );
	return is_array( $stored ) ? wp_parse_args( $stored, $defaults ) : $defaults;
}

/**
 * Community config consumed by the /server-config bridge below — the
 * theme-side source of truth settings-community.php's admin screen writes
 * to, same delegation pattern as fourliberty_chat_tips_config().
 *
 * @package fourliberty-hub
 */
function fourliberty_community_config() {
	$defaults = array(
		'paused'                  => false,
		'communityMode'           => 'open',
		'postRateLimit'           => 5,
		'replyRateLimit'          => 20,
		'newAccountGateHours'     => 24,
		'moderatorEmails'         => array(),
		'reservedNames'           => array(),
		'roomName'                => 'The Lobby',
		// The WidgetBot Discord embed at the top of /community/ (Phase 8,
		// Task F) — purely a display setting, never security-enforced, so
		// unlike communityMode/moderatorEmails above it does NOT need the
		// /server-config bridge to Netlify; the theme reads it directly,
		// same-request, server-side.
		'discordWidgetEnabled'    => false,
		'discordWidgetServerId'   => '',
		'discordWidgetChannelId'  => '',
		// Phase 9 (Discourse trial) — same non-security, display-only
		// reasoning as the Discord fields above. 'forumUrl' blank always
		// forces 'builtin' behavior in community-feed.php, regardless of
		// what 'forumMode' says, so a half-configured trial never renders a
		// dead-end promo card.
		'forumMode'               => 'builtin',
		'forumUrl'                => '',
	);

	$stored = get_option( 'fourliberty_community_config' );
	return is_array( $stored ) ? wp_parse_args( $stored, $defaults ) : $defaults;
}

/**
 * Public, read-only REST route exposing the fields Netlify must enforce
 * server-side, both for the homepage chat/tips AND (as of Phase 8) the
 * Community page — deliberately not the whole config either way. Nothing
 * returned here is sensitive, matching the same "public by design"
 * precedent as the Netlify poller's own /api/live-state.
 * netlify/functions/poll-wp-config.mts polls this every minute;
 * chat-token.mts / tip-create.mts / the community write endpoints never
 * call it directly.
 *
 * Moderator emails are hashed (SHA-256, lowercased first) before they leave
 * this route — this show is a politically-exposed target, and a public,
 * unauthenticated JSON endpoint broadcasting the moderator team's actual
 * email addresses is an avoidable harassment/social-engineering surface.
 * The addresses aren't secrets that unlock anything, so a keyless hash is
 * enough: it defeats cold enumeration ("who are all the moderators") while
 * still letting Netlify check "does THIS already-known, already-logged-in
 * email match" by hashing it the same way. The community* fields are all
 * prefixed on purpose — PHASE-8-BUILD-PLAN.md Decision 4/5 is explicit that
 * the Community chat's mode must never be confused with the homepage
 * chat's own `mode` field above.
 */
function fourliberty_register_rest_routes() {
	register_rest_route(
		'fourliberty/v1',
		'/server-config',
		array(
			'methods'             => 'GET',
			'permission_callback' => '__return_true',
			'callback'            => function () {
				$config    = fourliberty_chat_tips_config();
				$community = fourliberty_community_config();

				$moderator_hashes = array_map(
					function ( $email ) {
						return hash( 'sha256', strtolower( trim( $email ) ) );
					},
					(array) $community['moderatorEmails']
				);

				$response = new WP_REST_Response(
					array(
						'mode'                           => ( 'gated' === $config['mode'] ) ? 'gated' : 'open',
						'tipMinCents'                    => (int) round( floatval( $config['tipMinDollars'] ) * 100 ),
						'tipMaxCents'                    => (int) round( floatval( $config['tipMaxDollars'] ) * 100 ),
						'communityPaused'                => ! empty( $community['paused'] ),
						'communityMode'                  => ( 'gated' === $community['communityMode'] ) ? 'gated' : 'open',
						'communityPostRateLimit'         => (int) $community['postRateLimit'],
						'communityReplyRateLimit'        => (int) $community['replyRateLimit'],
						'communityGateHours'             => (int) $community['newAccountGateHours'],
						'communityModeratorEmailHashes'  => $moderator_hashes,
						'communityReservedNames'         => array_values( (array) $community['reservedNames'] ),
						'communityRoomName'               => (string) $community['roomName'],
					)
				);
				// Discovered during Task H: GoDaddy's own gateway cache was
				// observed serving a stale response for this exact route (a
				// mode flip took much longer than the "about a minute" the
				// settings screen promises). Asks the gateway not to cache a
				// route whose whole point is reflecting the LATEST admin
				// setting — may not be fully honored by every gateway, but
				// costs nothing to set correctly.
				$response->header( 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0' );
				return $response;
			},
		)
	);
}
add_action( 'rest_api_init', 'fourliberty_register_rest_routes' );

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
				'schedule'        => 'Weekday mornings · 7–9A CT',
				'gatedTitleMatch' => 'Freedom Arcade',
				'gatedLabel'      => 'Subscribe on Rumble to watch live →',
				'gatedUrl'        => 'https://rumble.com/c/AP4Liberty',
			),
			'WUJC'       => array( 'name' => 'Wake Up Jefferson City', 'schedule' => 'Tuesdays & Thursdays · 6–7A CT' ),
			'CULTURAMA'  => array( 'name' => 'Culturama' ),
			'HOMESCHOOL' => array( 'name' => 'Homeschool Workshop' ),
			'CAFECITO'   => array( 'name' => 'Cafecito Libre' ),
		),
	);

	$stored = get_option( 'fourliberty_live_shows_config' );
	return is_array( $stored ) ? $stored : $defaults;
}

/**
 * Dark Channel playlist/ads/cadence config consumed by
 * assets/js/dark-channel.js. This is the seam Phase 2 task F's admin panel
 * (includes/settings-dark-channel.php) writes to via
 * update_option( 'fourliberty_dark_channel_config', ... ) — same pattern as
 * fourliberty_live_shows_config() above. Defaults to an empty playlist:
 * dark-channel.js treats that as "nothing programmed yet" and stays out of
 * the way entirely (Decision 7 — no facade is safer than a broken one),
 * leaving the homepage exactly as it was before this phase until Austin
 * builds a playlist.
 */
function fourliberty_dark_channel_config() {
	$defaults = array(
		'playlist'  => array(),
		'ads'       => array(),
		'adCadence' => array( 'mode' => 'every_n_items', 'n' => 4, 'm' => 20 ),
		'display'   => array( 'mode' => 'slide', 'intervalSeconds' => 8 ),
	);

	$stored = get_option( 'fourliberty_dark_channel_config' );
	if ( ! is_array( $stored ) ) {
		return $defaults;
	}
	// Older saved configs predate the slider (2026-07-23) and have no
	// `display` key — fill it so dark-channel.js always has a mode/interval.
	if ( ! isset( $stored['display'] ) || ! is_array( $stored['display'] ) ) {
		$stored['display'] = $defaults['display'];
	}
	return $stored;
}

/**
 * Homepage ad block config (patterns/hero-live.php), written by
 * includes/settings-shop-ad.php — same seam pattern as the two config
 * functions above. Defaults to no image, which the pattern treats as "don't
 * render the block at all" rather than showing a broken/empty ad.
 */
function fourliberty_shop_ad_config() {
	$defaults = array(
		'imageUrl' => '',
		'linkUrl'  => 'https://4libertyshop.com',
		'altText'  => '',
	);

	$stored = get_option( 'fourliberty_shop_ad_config' );
	return is_array( $stored ) ? $stored : $defaults;
}

/**
 * Google Analytics measurement ID, written by the plugin's
 * includes/settings-analytics.php — same seam pattern as the config
 * functions above. Empty string = tracking off entirely.
 */
function fourliberty_analytics_measurement_id() {
	$stored = get_option( 'fourliberty_analytics_config' );
	$id     = is_array( $stored ) ? ( $stored['measurementId'] ?? '' ) : '';
	return preg_match( '/^G-[A-Z0-9]{4,16}$/', $id ) ? $id : '';
}

/**
 * The standard GA4 gtag snippet, printed early in <head> on every front-end
 * page when a measurement ID is configured. Logged-in admins are excluded so
 * Austin/Brad's own browsing never skews a ~50-daily-visitor dataset.
 */
function fourliberty_analytics_head() {
	$id = fourliberty_analytics_measurement_id();
	if ( '' === $id || current_user_can( 'manage_options' ) ) {
		return;
	}
	?>
	<script async src="https://www.googletagmanager.com/gtag/js?id=<?php echo esc_attr( $id ); ?>"></script>
	<script>
	window.dataLayer = window.dataLayer || [];
	function gtag(){dataLayer.push(arguments);}
	gtag('js', new Date());
	gtag('config', '<?php echo esc_js( $id ); ?>');
	</script>
	<?php
}
add_action( 'wp_head', 'fourliberty_analytics_head', 4 );

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

/**
 * Pop-out chat window (2026-07-23) — opened via window.open() from the
 * "Pop out" button in the main chat rail (patterns/hero-live.php), same
 * idea as YouTube/Twitch's own pop-out chat: a small separate window a
 * visitor can move to a second monitor or keep beside the show elsewhere.
 *
 * Reached as "/?fl_chat_popup=1" — a query var rather than a rewrite rule +
 * custom page, deliberately: no rewrite-rule flush to coordinate with a
 * theme reupload (Austin doesn't manage a hosting console for that), and it
 * works on any existing URL immediately, no new WordPress page for him to
 * create. template_include swaps in a bare template (no header, hero
 * player, or footer) for any request carrying it; wp_head()/wp_footer()
 * still fire normally in that template, so fourliberty_assets() enqueues
 * the same chat.js / rumble-mirror.js / account.js the homepage uses — the
 * exact same chat, not a second implementation to keep in sync. Every other
 * enqueued script no-ops on this page the same way it already does anywhere
 * its own markup hook is absent (see e.g. tips.js's [data-fl="tip-bar"]
 * check) — nothing here is popup-specific except the template.
 */
function fourliberty_maybe_chat_popup_template( $template ) {
	if ( ! isset( $_GET['fl_chat_popup'] ) ) {
		return $template;
	}
	$custom = get_theme_file_path( 'templates/chat-popup-template.php' );
	return file_exists( $custom ) ? $custom : $template;
}
add_filter( 'template_include', 'fourliberty_maybe_chat_popup_template' );

// The admin toolbar doesn't fit a narrow 380px popup — Austin (logged in as
// himself) would be the first to see it look broken there.
add_filter(
	'show_admin_bar',
	function ( $show ) {
		return isset( $_GET['fl_chat_popup'] ) ? false : $show;
	}
);

// This block theme gets a core title-tag <title> from wp_head() whether or
// not the template asks for one — chat-popup-template.php doesn't call
// wp_title()/output its own, it overrides THIS so there's exactly one
// <title>, not "Live Chat — 4Liberty Network" and the site's normal one both
// present (found 2026-07-23 checking the popup's actual served HTML).
add_filter(
	'pre_get_document_title',
	function ( $title ) {
		return isset( $_GET['fl_chat_popup'] ) ? __( 'Live Chat — 4Liberty Network', 'fourliberty' ) : $title;
	}
);

/**
 * Swap WordPress's comments for Discourse's on articles that have actually
 * been published to the forum (Phase 9).
 *
 * WHY A FILTER AND NOT A TEMPLATE EDIT: the WP Discourse plugin replaces
 * comments by hooking `comments_template`, which CLASSIC themes call and
 * BLOCK themes never do — so with this theme its comment setting silently
 * does nothing (confirmed live 2026-07-27: the plugin's assets loaded but
 * no Discourse comment markup rendered). The plugin ships a
 * `wp-discourse/comments` block for exactly this case, but dropping it into
 * templates/single.html unconditionally would strip the normal comment
 * section off every OLD post that was never published to the forum,
 * including the real comments already on them.
 *
 * WHY NOT A PHP PATTERN: patterns in /patterns/ are read and their PHP
 * evaluated when patterns are REGISTERED (on `init`), before the main loop
 * sets up the post — so get_the_ID() there is not reliable. `render_block`
 * runs during actual output, where it is.
 *
 * `discourse_permalink` is the meta the plugin writes only on a successful
 * publish (verified against a real published post), so it is the honest
 * signal for "this article has a forum thread." Anything without it keeps
 * WordPress's own comments, untouched.
 *
 * Fails SAFE in every direction: not a post, no id, no meta, block not
 * registered, or the block rendering empty (e.g. the plugin is deactivated)
 * all fall through to the original WordPress comments markup.
 */
function fourliberty_swap_in_discourse_comments( $block_content, $block ) {
	if ( ! isset( $block['blockName'] ) || 'core/comments' !== $block['blockName'] ) {
		return $block_content;
	}
	if ( is_admin() || ! is_singular( 'post' ) ) {
		return $block_content;
	}

	$post_id = get_the_ID();
	if ( ! $post_id ) {
		return $block_content;
	}

	$permalink = get_post_meta( $post_id, 'discourse_permalink', true );
	if ( empty( $permalink ) ) {
		return $block_content;
	}

	if ( ! class_exists( 'WP_Block_Type_Registry' )
		|| ! WP_Block_Type_Registry::get_instance()->is_registered( 'wp-discourse/comments' ) ) {
		return $block_content;
	}

	$rendered = do_blocks( '<!-- wp:wp-discourse/comments /-->' );

	// An empty/whitespace-only render means the block produced nothing useful
	// — keep the WordPress comments rather than leaving a bare heading and no
	// way for anyone to reply.
	return ( '' !== trim( wp_strip_all_tags( $rendered ) ) ) ? $rendered : $block_content;
}
add_filter( 'render_block', 'fourliberty_swap_in_discourse_comments', 10, 2 );
