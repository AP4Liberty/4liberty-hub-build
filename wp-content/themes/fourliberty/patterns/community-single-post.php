<?php
/**
 * Title: Community Single Post
 * Slug: fourliberty/community-single-post
 * Categories: fourliberty
 * Description: The individual post + replies view (PHASE-8-BUILD-PLAN.md
 *              Task D) — hand-rolled comment loop, same reasoning as
 *              community-feed.php's post loop: comment_author already
 *              holds the real display name (set at creation in
 *              community-rest-routes.php), but the MOD badge needs comment
 *              meta no native block can read. The reply form posts through
 *              Netlify (community-reply.mts), never WordPress's native
 *              comment form — "native comment posting stays closed on this
 *              CPT" (Decision 3), enforced separately by
 *              comment_status:'closed' at creation
 *              (community-post-type.php) so this is belt-and-suspenders,
 *              not the only thing stopping it.
 *
 * Uses get_queried_object() rather than the_post()/get_the_ID()-style Loop
 * tags — a hand-rolled PHP pattern inserted via wp:pattern isn't guaranteed
 * the same ambient "current post" Loop context a native wp:post-title block
 * gets for free, so this resolves the post explicitly instead of assuming.
 *
 * @package fourliberty
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$fl_post = get_queried_object();
if ( ! ( $fl_post instanceof WP_Post ) ) {
	return;
}

$fl_post_id     = $fl_post->ID;
$fl_name        = get_post_meta( $fl_post_id, '_fl_display_name', true );
$fl_name        = $fl_name ? $fl_name : 'A member';
$fl_role        = get_post_meta( $fl_post_id, '_fl_role', true );
$fl_gif         = fourliberty_community_safe_gif_url( get_post_meta( $fl_post_id, '_fl_gif_url', true ) );
$fl_topic_terms = get_the_terms( $fl_post, 'fl_community_topic' );
$fl_topic_term  = ( is_array( $fl_topic_terms ) && ! empty( $fl_topic_terms ) ) ? $fl_topic_terms[0] : null;

$fl_replies = get_comments(
	array(
		'post_id' => $fl_post_id,
		'status'  => 'approve',
		'order'   => 'ASC',
	)
);
$fl_reply_count = count( $fl_replies );
?>
<!-- wp:group {"layout":{"type":"constrained","contentSize":"720px"}} -->
<div class="wp-block-group">

	<!-- wp:html -->
	<article class="fl-community-post fl-community-post--single">
		<h1 class="fl-community-post__title"><?php echo esc_html( $fl_post->post_title ); ?></h1>
		<div class="fl-community-post__meta">
			<span class="fl-community-post__author"><?php echo esc_html( $fl_name ); ?></span>
			<?php if ( 'moderator' === $fl_role ) : ?><span class="fl-badge fl-badge--mod">MOD</span><?php endif; ?>
			<?php if ( $fl_topic_term ) : ?><span class="fl-community-post__topic"><?php echo esc_html( $fl_topic_term->name ); ?></span><?php endif; ?>
			<span class="fl-community-post__date"><?php echo esc_html( get_the_date( 'M j, Y', $fl_post ) ); ?></span>
		</div>
		<div class="fl-community-post__body"><?php echo wpautop( esc_html( $fl_post->post_content ) ); // phpcs:ignore -- wpautop() only adds structural p/br tags around content already HTML-escaped above. ?></div>
		<?php if ( $fl_gif ) : ?>
		<div class="fl-community-gif"><img src="<?php echo esc_url( $fl_gif ); ?>" alt="" loading="lazy" /></div>
		<?php endif; ?>
		<button type="button" class="fl-community-report" data-fl="community-report" data-fl-target-type="post" data-fl-target-id="<?php echo esc_attr( $fl_post_id ); ?>">Report</button>
	</article>
	<!-- /wp:html -->

	<!-- wp:html -->
	<div class="fl-community-replies">
		<h2 class="fl-community-replies__title"><?php echo (int) $fl_reply_count; ?> <?php echo 1 === $fl_reply_count ? 'reply' : 'replies'; ?></h2>
		<?php if ( $fl_replies ) : ?>
			<?php foreach ( $fl_replies as $fl_comment ) :
				$fl_reply_role = get_comment_meta( $fl_comment->comment_ID, '_fl_role', true );
				$fl_reply_gif  = fourliberty_community_safe_gif_url( get_comment_meta( $fl_comment->comment_ID, '_fl_gif_url', true ) );
				?>
			<div class="fl-community-reply">
				<div class="fl-community-reply__meta">
					<span class="fl-community-reply__author"><?php echo esc_html( $fl_comment->comment_author ); ?></span>
					<?php if ( 'moderator' === $fl_reply_role ) : ?><span class="fl-badge fl-badge--mod">MOD</span><?php endif; ?>
					<span class="fl-community-reply__date"><?php echo esc_html( mysql2date( 'M j', $fl_comment->comment_date ) ); ?></span>
				</div>
				<p class="fl-community-reply__body"><?php echo nl2br( esc_html( $fl_comment->comment_content ) ); // phpcs:ignore -- nl2br() only adds <br> tags around content already HTML-escaped above. ?></p>
				<?php if ( $fl_reply_gif ) : ?>
				<div class="fl-community-gif"><img src="<?php echo esc_url( $fl_reply_gif ); ?>" alt="" loading="lazy" /></div>
				<?php endif; ?>
				<button type="button" class="fl-community-report" data-fl="community-report" data-fl-target-type="comment" data-fl-target-id="<?php echo esc_attr( $fl_comment->comment_ID ); ?>">Report</button>
			</div>
			<?php endforeach; ?>
		<?php else : ?>
			<p class="fl-community-replies__empty">No replies yet.</p>
		<?php endif; ?>
	</div>
	<!-- /wp:html -->

	<!-- wp:html -->
	<div class="fl-community-composer" data-fl="community-reply-area" data-fl-post-id="<?php echo esc_attr( $fl_post_id ); ?>">
		<div data-fl="community-login-prompt"></div>
		<form class="fl-community-composer__form" data-fl="community-reply-form" hidden>
			<textarea name="body" rows="3" placeholder="Write a reply&#8230;" maxlength="5000" required></textarea>
			<div class="fl-community-composer__extras">
				<input type="url" name="gifUrl" class="fl-community-composer__gif" placeholder="Paste a Giphy or Tenor link (optional)" />
			</div>
			<div class="fl-community-composer__row">
				<span class="fl-community-composer__status" data-fl="community-reply-status"></span>
				<button type="submit" class="fl-community-composer__submit">Reply</button>
			</div>
		</form>
	</div>
	<!-- /wp:html -->

</div>
<!-- /wp:group -->
