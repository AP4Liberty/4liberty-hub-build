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
