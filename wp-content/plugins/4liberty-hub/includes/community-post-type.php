<?php
/**
 * The `fl_community_post` custom post type — Phase 8 Task B.
 *
 * Posts live in WordPress on purpose (PHASE-8-BUILD-PLAN.md Decision 1): the
 * standard admin post list is a screen Austin already checks daily, so
 * moderation needs zero new UI beyond a couple of custom columns below.
 *
 * `show_in_rest => false` is deliberate, not an oversight — the browser
 * NEVER writes to WordPress directly (Decision 2), so leaving WordPress's
 * own default REST CRUD switched off for this post type closes off an
 * entire class of "did I forget to lock that down" bugs. The only way in is
 * community-rest-routes.php's two signature-gated routes. Reads happen via
 * plain server-side WP_Query in the theme template (Task D), which needs no
 * REST exposure at all.
 *
 * `comment_status` defaults to 'closed' on every post created here
 * (community-rest-routes.php) specifically so WordPress's OWN native public
 * comment form/endpoint (wp-comments-post.php) can never accept a reply —
 * only this plugin's signature-gated community-reply route can, via
 * wp_insert_comment() directly (which, unlike wp_new_comment(), does not
 * check comments_open()). "Native comment posting stays closed on this CPT"
 * (Decision 3) is enforced by this exact mechanism, not a convention.
 *
 * @package fourliberty-hub
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const FOURLIBERTY_COMMUNITY_POST_TYPE = 'fl_community_post';
const FOURLIBERTY_COMMUNITY_TOPIC_TAXONOMY = 'fl_community_topic';

function fourliberty_hub_register_community_post_type() {
	register_post_type(
		FOURLIBERTY_COMMUNITY_POST_TYPE,
		array(
			'labels'       => array(
				'name'          => __( 'Community Posts', 'fourliberty-hub' ),
				'singular_name' => __( 'Community Post', 'fourliberty-hub' ),
				'all_items'     => __( 'Community Posts', 'fourliberty-hub' ),
				'search_items'  => __( 'Search Community Posts', 'fourliberty-hub' ),
				'not_found'     => __( 'No community posts found.', 'fourliberty-hub' ),
			),
			'public'       => true,
			'show_ui'      => true,
			'show_in_menu' => false, // Reachable from the "4Liberty Hub" menu (admin-menu.php), not its own top-level entry.
			'show_in_rest' => false, // See file header — reads and writes both bypass the default REST API entirely.
			'has_archive'  => false, // The archive IS /community/, a real Page with a page template (Task D), not an auto-generated CPT archive.
			'rewrite'      => array( 'slug' => 'community/post' ),
			'supports'     => array( 'title', 'editor', 'comments' ),
			'menu_icon'    => 'dashicons-groups',
		)
	);
}
add_action( 'init', 'fourliberty_hub_register_community_post_type' );

/**
 * Categories for community posts (Phase 8, Task E) — one per show on the
 * network, plus fixed "General" and "Announcements" terms. Deliberately
 * FLAT (hierarchical => false, no parent/child) and `show_in_rest => false`,
 * matching the CPT's own posture (file header above) — nothing about this
 * feature is meant to be reachable through WordPress's default REST API.
 *
 * The feed itself stays ONE unified list across every category
 * (PHASE-8-TASK-E-PLAN.md Decision 1) — this taxonomy is a filter and a
 * label, never a separate room. At this audience's size, splitting into
 * per-category rooms is the single most common way a small forum dies.
 */
function fourliberty_hub_register_community_topic_taxonomy() {
	register_taxonomy(
		FOURLIBERTY_COMMUNITY_TOPIC_TAXONOMY,
		FOURLIBERTY_COMMUNITY_POST_TYPE,
		array(
			'labels'            => array(
				'name'          => __( 'Topics', 'fourliberty-hub' ),
				'singular_name' => __( 'Topic', 'fourliberty-hub' ),
			),
			'hierarchical'      => false,
			'public'            => true,
			'show_ui'           => true,
			'show_in_rest'      => false,
			'show_admin_column' => true,
			'rewrite'           => array( 'slug' => 'community/topic' ),
		)
	);
}
add_action( 'init', 'fourliberty_hub_register_community_topic_taxonomy' );

/**
 * "General" and "Announcements" always exist, independent of Live Shows —
 * not every post is about a specific show, and without a catch-all those
 * posts have nowhere correct to go. Runs on every `init` (priority 11, after
 * the taxonomy registration above at the default priority 10) — cheap,
 * idempotent `term_exists()` checks, same "safe to re-run" spirit as the
 * rest of this plugin's config-seam defaults.
 */
function fourliberty_hub_ensure_default_community_topics() {
	$defaults = array(
		'general'       => __( 'General', 'fourliberty-hub' ),
		'announcements' => __( 'Announcements', 'fourliberty-hub' ),
	);
	foreach ( $defaults as $slug => $name ) {
		if ( ! term_exists( $slug, FOURLIBERTY_COMMUNITY_TOPIC_TAXONOMY ) ) {
			wp_insert_term( $name, FOURLIBERTY_COMMUNITY_TOPIC_TAXONOMY, array( 'slug' => $slug ) );
		}
	}
}
add_action( 'init', 'fourliberty_hub_ensure_default_community_topics', 11 );

/**
 * Adds a category for any show in Live Shows that doesn't have one yet —
 * triggered by the "Sync categories from Live Shows" button on the Community
 * admin screen (settings-community.php), never automatic. Deliberately
 * ADD-ONLY: a show getting renamed in Live Shows must never rename or
 * orphan a category posts are already filed under, so this only ever
 * inserts a term that's missing, and never touches one that already exists
 * (PHASE-8-TASK-E-PLAN.md Decision 1). Austin can rename or remove a
 * category by hand from Posts → Community Posts → Topics if he ever needs
 * to — that native WordPress screen is the escape hatch this deliberately
 * doesn't try to replace.
 *
 * Keyed by the show's stable config KEY (e.g. "WUA"), lowercased into the
 * term slug — not the show's display NAME, which is the one thing Austin is
 * expected to actually change over time. Returns how many were added, so
 * the admin screen can show a plain-language "added 2" / "nothing new".
 */
function fourliberty_hub_sync_community_topics_from_shows() {
	if ( ! function_exists( 'fourliberty_hub_live_shows_config' ) ) {
		return 0;
	}
	$config = fourliberty_hub_live_shows_config();
	$shows  = isset( $config['shows'] ) && is_array( $config['shows'] ) ? $config['shows'] : array();

	$added = 0;
	foreach ( $shows as $key => $show ) {
		$slug = sanitize_title( strtolower( $key ) );
		if ( '' === $slug || term_exists( $slug, FOURLIBERTY_COMMUNITY_TOPIC_TAXONOMY ) ) {
			continue;
		}
		$name   = ! empty( $show['name'] ) ? $show['name'] : ucwords( strtolower( str_replace( '_', ' ', $key ) ) );
		$result = wp_insert_term( $name, FOURLIBERTY_COMMUNITY_TOPIC_TAXONOMY, array( 'slug' => $slug ) );
		if ( ! is_wp_error( $result ) ) {
			++$added;
		}
	}
	return $added;
}

/**
 * The full topic list in a predictable, owner-legible order: General,
 * Announcements, then every show in the SAME order Austin already set on
 * the Live Shows screen, then anything else (e.g. a category added by hand
 * via the native Topics admin screen) alphabetically. Shared by the
 * composer's category picker, the feed's filter chips, and the single-post
 * topic badge — one function, so all three can never drift out of sync with
 * each other.
 *
 * @return WP_Term[]
 */
function fourliberty_hub_get_community_topics() {
	$all_terms = get_terms(
		array(
			'taxonomy'   => FOURLIBERTY_COMMUNITY_TOPIC_TAXONOMY,
			'hide_empty' => false,
		)
	);
	if ( is_wp_error( $all_terms ) || ! is_array( $all_terms ) ) {
		return array();
	}

	$by_slug = array();
	foreach ( $all_terms as $term ) {
		$by_slug[ $term->slug ] = $term;
	}

	$ordered = array();
	foreach ( array( 'general', 'announcements' ) as $fixed_slug ) {
		if ( isset( $by_slug[ $fixed_slug ] ) ) {
			$ordered[] = $by_slug[ $fixed_slug ];
			unset( $by_slug[ $fixed_slug ] );
		}
	}

	if ( function_exists( 'fourliberty_hub_live_shows_config' ) ) {
		$shows_config = fourliberty_hub_live_shows_config();
		$show_order   = isset( $shows_config['order'] ) && is_array( $shows_config['order'] ) ? $shows_config['order'] : array();
		foreach ( $show_order as $key ) {
			$slug = sanitize_title( strtolower( $key ) );
			if ( isset( $by_slug[ $slug ] ) ) {
				$ordered[] = $by_slug[ $slug ];
				unset( $by_slug[ $slug ] );
			}
		}
	}

	$remaining = array_values( $by_slug );
	usort(
		$remaining,
		function ( $a, $b ) {
			return strcasecmp( $a->name, $b->name );
		}
	);

	return array_merge( $ordered, $remaining );
}

/**
 * GIF host allowlist (Phase 8, Task E) — a GIF is stored as its OWN meta
 * field, never inside the plain-text post/reply body (see this file's
 * header on the strip-on-write-AND-escape-on-render posture; this doesn't
 * loosen that anywhere). Checked here at WRITE time
 * (community-rest-routes.php) and AGAIN at RENDER time
 * (fourliberty_community_safe_gif_url() in the theme's functions.php) —
 * both, not either, same posture as the text sanitizers.
 *
 * Exact hostname match only, never a substring/`str_contains()` check —
 * that's what stops `media.giphy.com.evil.tld` from passing.
 */
const FOURLIBERTY_COMMUNITY_GIF_HOSTS = array( 'media.giphy.com', 'i.giphy.com', 'media.tenor.com', 'c.tenor.com' );
const FOURLIBERTY_COMMUNITY_GIF_EXTENSIONS = array( 'gif', 'webp', 'mp4' );

/**
 * Returns the URL unchanged if it's `https:`, on the allowlist above, and
 * ends in an allowed extension — otherwise an empty string. Never throws;
 * a bad/missing URL just means "no GIF on this post," not an error.
 */
function fourliberty_hub_validate_gif_url( $raw ) {
	if ( ! is_string( $raw ) || '' === trim( $raw ) ) {
		return '';
	}
	$parts = wp_parse_url( trim( $raw ) );
	if ( ! is_array( $parts ) || empty( $parts['scheme'] ) || 'https' !== $parts['scheme'] ) {
		return '';
	}
	if ( empty( $parts['host'] ) || ! in_array( strtolower( $parts['host'] ), FOURLIBERTY_COMMUNITY_GIF_HOSTS, true ) ) {
		return '';
	}
	$path = isset( $parts['path'] ) ? $parts['path'] : '';
	$ext  = strtolower( pathinfo( $path, PATHINFO_EXTENSION ) );
	if ( ! in_array( $ext, FOURLIBERTY_COMMUNITY_GIF_EXTENSIONS, true ) ) {
		return '';
	}
	return esc_url_raw( trim( $raw ) );
}

/**
 * Registered with show_in_rest => false for the same reason as the post
 * type itself — nothing here is meant to be reachable through WordPress's
 * default REST API. Values are set ONLY by community-rest-routes.php's
 * signature-verified callbacks; there is no editor UI for these fields.
 */
function fourliberty_hub_register_community_post_meta() {
	$fields = array(
		'_fl_user_id'      => 'string',
		'_fl_display_name' => 'string',
		'_fl_role'         => 'string',
		'_fl_flags'        => 'integer',
		'_fl_gif_url'      => 'string',
	);
	foreach ( $fields as $key => $type ) {
		register_post_meta(
			FOURLIBERTY_COMMUNITY_POST_TYPE,
			$key,
			array(
				'type'          => $type,
				'single'        => true,
				'show_in_rest'  => false,
				'auth_callback' => '__return_false',
			)
		);
	}
}
add_action( 'init', 'fourliberty_hub_register_community_post_meta' );

/**
 * Custom admin-list columns showing who actually posted — the meta fields
 * above aren't visible any other way, and "who posted this" is the first
 * thing moderation needs (PHASE-8-BUILD-PLAN.md Decision 1).
 */
function fourliberty_hub_community_post_columns( $columns ) {
	$new = array();
	foreach ( $columns as $key => $label ) {
		$new[ $key ] = $label;
		if ( 'title' === $key ) {
			$new['fl_display_name'] = __( 'Posted by', 'fourliberty-hub' );
			$new['fl_role']         = __( 'Role', 'fourliberty-hub' );
			$new['fl_flags']        = __( 'Reports', 'fourliberty-hub' );
		}
	}
	return $new;
}
add_filter( 'manage_' . FOURLIBERTY_COMMUNITY_POST_TYPE . '_posts_columns', 'fourliberty_hub_community_post_columns' );

function fourliberty_hub_community_post_column_content( $column, $post_id ) {
	switch ( $column ) {
		case 'fl_display_name':
			echo esc_html( get_post_meta( $post_id, '_fl_display_name', true ) ?: '—' );
			break;
		case 'fl_role':
			$role = get_post_meta( $post_id, '_fl_role', true ) ?: 'member';
			echo esc_html( ucfirst( $role ) );
			break;
		case 'fl_flags':
			$flags = (int) get_post_meta( $post_id, '_fl_flags', true );
			if ( $flags > 0 ) {
				printf( '<strong style="color:#b32d2e;">%d</strong>', (int) $flags );
			} else {
				echo '0';
			}
			break;
	}
}
add_action( 'manage_' . FOURLIBERTY_COMMUNITY_POST_TYPE . '_posts_custom_column', 'fourliberty_hub_community_post_column_content', 10, 2 );
