<?php
/**
 * The ONLY way anything ever gets written into fl_community_post or its
 * replies — two signature-gated REST routes (PHASE-8-BUILD-PLAN.md
 * Decision 2). The browser never calls these directly; only Netlify's
 * community-post.mts / community-reply.mts do, AFTER already verifying the
 * visitor's session, checking bans, checking rate limits, and stripping
 * HTML. Nothing here trusts the caller beyond the signature check — every
 * field is still validated, because "already checked upstream" and "cannot
 * be bypassed" are different guarantees, and this file only has the second
 * one.
 *
 * Auth is a custom X-FL-Signature header — an HMAC-SHA256 of the raw
 * request body, keyed by a shared secret — NOT a WordPress Application
 * Password. GoDaddy/Sucuri's edge has a confirmed habit of stripping
 * Authorization headers on this site; a custom header sidesteps that fight
 * entirely.
 *
 * The secret itself: fourliberty_hub_community_secret() below checks a
 * wp-config.php constant FIRST (the stronger option, survives a database
 * compromise) and falls back to a WordPress option set from the Community
 * admin screen (settings-community.php) — added after discovering, in a
 * real session with Austin, that this specific GoDaddy account has no
 * accessible file manager, only SFTP, which is a real technical barrier for
 * a non-technical, disabled owner. Requiring a file edit for this one
 * secret would have broken Golden Rule #3 (owner-adjustable from a plain
 * admin screen, never code) for the one thing in this entire feature that
 * needed it. The blast radius of this SPECIFIC secret leaking is small
 * enough to accept that tradeoff — unlike IDENTITY_JWT_SECRET (which can
 * forge ANY member's session), this one can only create posts/replies
 * under an identity the caller already asserts, and anyone with database
 * access to leak it already has far worse options available to them.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const FOURLIBERTY_COMMUNITY_MAX_DISPLAY_NAME = 30;
const FOURLIBERTY_COMMUNITY_MAX_TITLE        = 200;
const FOURLIBERTY_COMMUNITY_MAX_POST_BODY    = 10000;
const FOURLIBERTY_COMMUNITY_MAX_REPLY_BODY   = 5000;
const FOURLIBERTY_COMMUNITY_MAX_USER_ID      = 100;
const FOURLIBERTY_COMMUNITY_ROLES            = array( 'member', 'moderator', 'admin' );

/**
 * The wp-config.php constant wins if it's ever set (stronger — survives a
 * database compromise); otherwise falls back to the option
 * settings-community.php's admin screen writes. Same "constant overrides a
 * default" shape already used throughout this theme for endpoint URLs
 * (e.g. fourliberty_auth_request_endpoint() in functions.php).
 */
function fourliberty_hub_community_secret() {
	if ( defined( 'FOURLIBERTY_COMMUNITY_SECRET' ) && FOURLIBERTY_COMMUNITY_SECRET ) {
		return FOURLIBERTY_COMMUNITY_SECRET;
	}
	$stored = get_option( 'fourliberty_community_secret' );
	return is_string( $stored ) ? $stored : '';
}

/**
 * hash_equals() specifically, never ===  — a non-constant-time compare here
 * would reopen exactly the timing-attack class this whole HMAC scheme
 * exists to close. Reads the RAW body (get_body(), not get_json_params())
 * because the signature was computed over raw bytes on the Netlify side;
 * anything that re-serializes the parsed JSON risks a byte-for-byte
 * mismatch from key ordering or whitespace alone.
 */
function fourliberty_hub_verify_community_signature( WP_REST_Request $request ) {
	$secret = fourliberty_hub_community_secret();
	if ( ! $secret ) {
		return new WP_Error( 'community_not_configured', __( 'Community write access is not configured.', 'fourliberty-hub' ), array( 'status' => 503 ) );
	}
	$signature = $request->get_header( 'x-fl-signature' );
	if ( ! $signature ) {
		return new WP_Error( 'missing_signature', __( 'Missing signature.', 'fourliberty-hub' ), array( 'status' => 401 ) );
	}
	$expected = hash_hmac( 'sha256', $request->get_body(), $secret );
	if ( ! hash_equals( $expected, $signature ) ) {
		return new WP_Error( 'bad_signature', __( 'Invalid signature.', 'fourliberty-hub' ), array( 'status' => 401 ) );
	}
	return true;
}

/** 'member' unless the caller sent one of the other two known roles. */
function fourliberty_hub_community_sanitize_role( $raw ) {
	return in_array( $raw, FOURLIBERTY_COMMUNITY_ROLES, true ) ? $raw : 'member';
}

/** 'publish' unless the caller explicitly asked for the link-gate hold. */
function fourliberty_hub_community_sanitize_status( $raw ) {
	return ( 'pending' === $raw ) ? 'pending' : 'publish';
}

function fourliberty_hub_community_create_post( WP_REST_Request $request ) {
	$body = $request->get_json_params();
	if ( ! is_array( $body ) ) {
		return new WP_Error( 'invalid_json', __( 'Invalid request body.', 'fourliberty-hub' ), array( 'status' => 400 ) );
	}

	$user_id      = isset( $body['userId'] ) ? sanitize_text_field( (string) $body['userId'] ) : '';
	$display_name = isset( $body['displayName'] ) ? sanitize_text_field( (string) $body['displayName'] ) : '';
	// sanitize_text_field() strips ALL tags — belt and suspenders alongside
	// whatever Netlify already stripped (PHASE-8-BUILD-PLAN.md: "strip on
	// write AND escape on render — both, not either"). Title uses the same
	// tag-stripping field function; body uses the textarea variant so
	// newlines survive.
	$title        = isset( $body['title'] ) ? sanitize_text_field( (string) $body['title'] ) : '';
	$content      = isset( $body['body'] ) ? sanitize_textarea_field( (string) $body['body'] ) : '';
	$role         = fourliberty_hub_community_sanitize_role( $body['role'] ?? null );
	$status       = fourliberty_hub_community_sanitize_status( $body['status'] ?? null );

	// An unrecognized or missing topic always falls back to "general" — never
	// rejected outright, since a category is a filing detail, not something
	// worth failing the whole post over (PHASE-8-TASK-E-PLAN.md Decision 1).
	$topic_slug = isset( $body['topic'] ) ? sanitize_title( (string) $body['topic'] ) : '';
	if ( '' === $topic_slug || ! term_exists( $topic_slug, FOURLIBERTY_COMMUNITY_TOPIC_TAXONOMY ) ) {
		$topic_slug = 'general';
	}

	// Re-validated here even though Netlify already checked — belt and
	// suspenders, same posture as the text sanitizers above (this file's
	// header: "already checked upstream" and "cannot be bypassed" are
	// different guarantees). Silently empty on anything invalid, never an error.
	$gif_url = isset( $body['gifUrl'] ) ? fourliberty_hub_validate_gif_url( $body['gifUrl'] ) : '';

	if ( '' === $user_id || strlen( $user_id ) > FOURLIBERTY_COMMUNITY_MAX_USER_ID ) {
		return new WP_Error( 'invalid_user_id', __( 'Missing or invalid userId.', 'fourliberty-hub' ), array( 'status' => 400 ) );
	}
	if ( '' === $display_name || mb_strlen( $display_name ) > FOURLIBERTY_COMMUNITY_MAX_DISPLAY_NAME ) {
		return new WP_Error( 'invalid_display_name', __( 'Missing or invalid displayName.', 'fourliberty-hub' ), array( 'status' => 400 ) );
	}
	if ( '' === $title || mb_strlen( $title ) > FOURLIBERTY_COMMUNITY_MAX_TITLE ) {
		return new WP_Error( 'invalid_title', __( 'Missing or invalid title.', 'fourliberty-hub' ), array( 'status' => 400 ) );
	}
	if ( '' === $content || mb_strlen( $content ) > FOURLIBERTY_COMMUNITY_MAX_POST_BODY ) {
		return new WP_Error( 'invalid_body', __( 'Missing or invalid body.', 'fourliberty-hub' ), array( 'status' => 400 ) );
	}

	$post_id = wp_insert_post(
		array(
			'post_type'      => FOURLIBERTY_COMMUNITY_POST_TYPE,
			'post_title'     => $title,
			'post_content'   => $content,
			'post_status'    => $status,
			// Closed at the WordPress level on purpose — see
			// community-post-type.php's file header. Replies only ever
			// arrive through fourliberty_hub_community_create_reply() below,
			// which calls wp_insert_comment() directly and is unaffected by
			// this setting.
			'comment_status' => 'closed',
		),
		true
	);
	if ( is_wp_error( $post_id ) || ! $post_id ) {
		return new WP_Error( 'insert_failed', __( 'Could not create the post.', 'fourliberty-hub' ), array( 'status' => 500 ) );
	}

	update_post_meta( $post_id, '_fl_user_id', $user_id );
	update_post_meta( $post_id, '_fl_display_name', $display_name );
	update_post_meta( $post_id, '_fl_role', $role );
	update_post_meta( $post_id, '_fl_flags', 0 );
	if ( $gif_url ) {
		update_post_meta( $post_id, '_fl_gif_url', $gif_url );
	}

	wp_set_object_terms( $post_id, $topic_slug, FOURLIBERTY_COMMUNITY_TOPIC_TAXONOMY );

	return new WP_REST_Response(
		array(
			'success' => true,
			'postId'  => $post_id,
			'status'  => $status,
			'url'     => get_permalink( $post_id ),
		),
		201
	);
}

function fourliberty_hub_community_create_reply( WP_REST_Request $request ) {
	$body = $request->get_json_params();
	if ( ! is_array( $body ) ) {
		return new WP_Error( 'invalid_json', __( 'Invalid request body.', 'fourliberty-hub' ), array( 'status' => 400 ) );
	}

	$post_id      = isset( $body['postId'] ) ? absint( $body['postId'] ) : 0;
	$user_id      = isset( $body['userId'] ) ? sanitize_text_field( (string) $body['userId'] ) : '';
	$display_name = isset( $body['displayName'] ) ? sanitize_text_field( (string) $body['displayName'] ) : '';
	$content      = isset( $body['body'] ) ? sanitize_textarea_field( (string) $body['body'] ) : '';
	$role         = fourliberty_hub_community_sanitize_role( $body['role'] ?? null );
	$status       = fourliberty_hub_community_sanitize_status( $body['status'] ?? null );
	$gif_url      = isset( $body['gifUrl'] ) ? fourliberty_hub_validate_gif_url( $body['gifUrl'] ) : '';

	if ( '' === $user_id || strlen( $user_id ) > FOURLIBERTY_COMMUNITY_MAX_USER_ID ) {
		return new WP_Error( 'invalid_user_id', __( 'Missing or invalid userId.', 'fourliberty-hub' ), array( 'status' => 400 ) );
	}
	if ( '' === $display_name || mb_strlen( $display_name ) > FOURLIBERTY_COMMUNITY_MAX_DISPLAY_NAME ) {
		return new WP_Error( 'invalid_display_name', __( 'Missing or invalid displayName.', 'fourliberty-hub' ), array( 'status' => 400 ) );
	}
	if ( '' === $content || mb_strlen( $content ) > FOURLIBERTY_COMMUNITY_MAX_REPLY_BODY ) {
		return new WP_Error( 'invalid_body', __( 'Missing or invalid body.', 'fourliberty-hub' ), array( 'status' => 400 ) );
	}

	// Must reference a REAL, non-trashed community post — never trust an
	// arbitrary postId enough to attach a comment to someone else's content.
	$post = get_post( $post_id );
	if ( ! $post || FOURLIBERTY_COMMUNITY_POST_TYPE !== $post->post_type || ! in_array( $post->post_status, array( 'publish', 'pending' ), true ) ) {
		return new WP_Error( 'invalid_post', __( 'That post does not exist.', 'fourliberty-hub' ), array( 'status' => 404 ) );
	}

	// wp_insert_comment() directly, NOT wp_new_comment() — the latter checks
	// comments_open() (closed on every community post, on purpose) and
	// fires the public comment-notification pipeline meant for ordinary
	// blog comments, neither of which applies here.
	$comment_id = wp_insert_comment(
		array(
			'comment_post_ID' => $post_id,
			'comment_content' => $content,
			'comment_author'  => $display_name,
			'comment_type'    => 'comment',
			'comment_approved' => ( 'pending' === $status ) ? 0 : 1,
		)
	);
	if ( ! $comment_id ) {
		return new WP_Error( 'insert_failed', __( 'Could not create the reply.', 'fourliberty-hub' ), array( 'status' => 500 ) );
	}

	update_comment_meta( $comment_id, '_fl_user_id', $user_id );
	update_comment_meta( $comment_id, '_fl_display_name', $display_name );
	update_comment_meta( $comment_id, '_fl_role', $role );
	if ( $gif_url ) {
		update_comment_meta( $comment_id, '_fl_gif_url', $gif_url );
	}

	return new WP_REST_Response(
		array(
			'success'          => true,
			'commentId'        => $comment_id,
			'status'           => $status,
			// The three fields below are for Netlify's best-effort "notify
			// the original post author" step (community-reply.mts) — $post
			// is already loaded above for validation, so this is free. Never
			// the REPLIER's own info; WordPress still never learns anyone's
			// email either way (PHASE-8-BUILD-PLAN.md's identity-secret
			// boundary) — only the opaque _fl_user_id, which Netlify resolves
			// back to an email via its OWN userId index, not WordPress's.
			'postAuthorUserId' => (string) get_post_meta( $post_id, '_fl_user_id', true ),
			'postTitle'        => $post->post_title,
			'postUrl'          => get_permalink( $post_id ),
		),
		201
	);
}

/**
 * The report-button backend (Task D) — same signature-gated trust model as
 * the two routes above, just incrementing a flag count instead of creating
 * content. No new validation surface: a real post/comment must already
 * exist, and the count is a plain integer nobody but a moderator ever
 * reads (the _fl_flags admin-list column added in Task B).
 */
function fourliberty_hub_community_report( WP_REST_Request $request ) {
	$body = $request->get_json_params();
	if ( ! is_array( $body ) ) {
		return new WP_Error( 'invalid_json', __( 'Invalid request body.', 'fourliberty-hub' ), array( 'status' => 400 ) );
	}

	$target_type = ( isset( $body['targetType'] ) && 'comment' === $body['targetType'] ) ? 'comment' : 'post';
	$target_id   = isset( $body['targetId'] ) ? absint( $body['targetId'] ) : 0;
	if ( ! $target_id ) {
		return new WP_Error( 'invalid_target', __( 'Missing or invalid targetId.', 'fourliberty-hub' ), array( 'status' => 400 ) );
	}

	if ( 'comment' === $target_type ) {
		if ( ! get_comment( $target_id ) ) {
			return new WP_Error( 'invalid_target', __( 'That reply does not exist.', 'fourliberty-hub' ), array( 'status' => 404 ) );
		}
		update_comment_meta( $target_id, '_fl_flags', (int) get_comment_meta( $target_id, '_fl_flags', true ) + 1 );
	} else {
		$post = get_post( $target_id );
		if ( ! $post || FOURLIBERTY_COMMUNITY_POST_TYPE !== $post->post_type ) {
			return new WP_Error( 'invalid_target', __( 'That post does not exist.', 'fourliberty-hub' ), array( 'status' => 404 ) );
		}
		update_post_meta( $target_id, '_fl_flags', (int) get_post_meta( $target_id, '_fl_flags', true ) + 1 );
	}

	return new WP_REST_Response( array( 'success' => true ), 200 );
}

function fourliberty_hub_register_community_rest_routes() {
	register_rest_route(
		'fourliberty/v1',
		'/community-post',
		array(
			'methods'             => 'POST',
			'permission_callback' => 'fourliberty_hub_verify_community_signature',
			'callback'            => 'fourliberty_hub_community_create_post',
		)
	);
	register_rest_route(
		'fourliberty/v1',
		'/community-reply',
		array(
			'methods'             => 'POST',
			'permission_callback' => 'fourliberty_hub_verify_community_signature',
			'callback'            => 'fourliberty_hub_community_create_reply',
		)
	);
	register_rest_route(
		'fourliberty/v1',
		'/community-report',
		array(
			'methods'             => 'POST',
			'permission_callback' => 'fourliberty_hub_verify_community_signature',
			'callback'            => 'fourliberty_hub_community_report',
		)
	);
}
add_action( 'rest_api_init', 'fourliberty_hub_register_community_rest_routes' );
