<?php
/**
 * Title: Community Feed
 * Slug: fourliberty/community-feed
 * Categories: fourliberty
 * Description: The /community/ page's post list (PHASE-8-BUILD-PLAN.md Task
 *              D) — hand-rolled WP_Query, same convention as
 *              category-rail.php and newsroom-front.php: fl_community_post's
 *              real poster (_fl_display_name/_fl_role meta) has no native
 *              block equivalent to post_author, so this can't be a plain
 *              Query Loop block. The composer posts through Netlify
 *              (community-post.mts), never straight to WordPress (Decision
 *              2) — assets/js/community.js owns that; this file only reads.
 *
 * @package fourliberty
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// WordPress reserves `page` for pagination WITHIN a single Post/Page's own
// content (<!--nextpage-->) and `paged` for pagination of a query loop —
// this is a SEPARATE query WordPress didn't run itself, so on a static Page
// it can surface either depending on how the rewrite resolved. Checking
// both is the standard, robust way to paginate a custom loop on a Page.
$fl_paged = get_query_var( 'paged' ) ? (int) get_query_var( 'paged' ) : ( get_query_var( 'page' ) ? (int) get_query_var( 'page' ) : 1 );

$fl_community_query = new WP_Query(
	array(
		'post_type'      => 'fl_community_post',
		'post_status'    => 'publish',
		'posts_per_page' => 15,
		'paged'          => $fl_paged,
		'orderby'        => 'date',
		'order'          => 'DESC',
	)
);
?>
<!-- wp:group {"layout":{"type":"constrained","contentSize":"820px"}} -->
<div class="wp-block-group">

	<!-- wp:html -->
	<div class="fl-community-composer" data-fl="community-composer-area">
		<div data-fl="community-login-prompt"></div>
		<form class="fl-community-composer__form" data-fl="community-composer-form" hidden>
			<input type="text" name="title" placeholder="Give it a title" maxlength="200" required />
			<textarea name="body" rows="4" placeholder="What&#8217;s on your mind?" maxlength="10000" required></textarea>
			<div class="fl-community-composer__row">
				<span class="fl-community-composer__status" data-fl="community-composer-status"></span>
				<button type="submit" class="fl-community-composer__submit">Post</button>
			</div>
		</form>
	</div>
	<!-- /wp:html -->

	<?php if ( $fl_community_query->have_posts() ) : ?>

	<!-- wp:html -->
	<div class="fl-community-feed">
		<?php foreach ( $fl_community_query->posts as $fl_post ) :
			$fl_name = get_post_meta( $fl_post->ID, '_fl_display_name', true );
			$fl_name = $fl_name ? $fl_name : 'A member';
			$fl_role = get_post_meta( $fl_post->ID, '_fl_role', true );
			?>
		<article class="fl-community-post">
			<h3 class="fl-community-post__title"><a href="<?php echo esc_url( get_permalink( $fl_post ) ); ?>"><?php echo esc_html( get_the_title( $fl_post ) ); ?></a></h3>
			<div class="fl-community-post__meta">
				<span class="fl-community-post__author"><?php echo esc_html( $fl_name ); ?></span>
				<?php if ( 'moderator' === $fl_role ) : ?><span class="fl-badge fl-badge--mod">MOD</span><?php endif; ?>
				<span class="fl-community-post__date"><?php echo esc_html( get_the_date( 'M j', $fl_post ) ); ?></span>
			</div>
			<p class="fl-community-post__excerpt"><?php echo esc_html( wp_trim_words( $fl_post->post_content, 40 ) ); ?></p>
			<a class="fl-community-post__link" href="<?php echo esc_url( get_permalink( $fl_post ) ); ?>">Read &amp; reply &rarr;</a>
		</article>
		<?php endforeach; ?>
	</div>
	<!-- /wp:html -->

		<?php if ( $fl_community_query->max_num_pages > 1 ) : ?>
	<!-- wp:html -->
	<div class="fl-pagination">
		<?php
		echo paginate_links( // phpcs:ignore -- paginate_links() output is already escaped internally.
			array(
				'base'      => trailingslashit( get_permalink() ) . '%_%',
				'format'    => 'page/%#%/',
				'total'     => $fl_community_query->max_num_pages,
				'current'   => $fl_paged,
				'prev_text' => '&larr; Newer',
				'next_text' => 'Older &rarr;',
			)
		);
		?>
	</div>
	<!-- /wp:html -->
		<?php endif; ?>

	<?php else : ?>

	<!-- wp:paragraph {"textColor":"muted"} -->
	<p class="has-muted-color has-text-color">No posts yet &mdash; be the first.</p>
	<!-- /wp:paragraph -->

	<?php endif; wp_reset_postdata(); ?>

</div>
<!-- /wp:group -->
