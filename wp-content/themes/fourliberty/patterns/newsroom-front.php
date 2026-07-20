<?php
/**
 * Title: Newsroom — Lead Story + Headlines
 * Slug: fourliberty/newsroom-front
 * Categories: fourliberty
 * Description: The front page's main editorial block — a lead story (latest
 *              post) plus a headline stack of the next few. Pulls real posts
 *              via WP_Query so the homepage is a live newsroom from day one,
 *              not a static mockup. Falls back to a friendly empty state
 *              until the owner/Brad/Kolten have published content.
 *
 * @package fourliberty
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$fl_lead_query = new WP_Query(
	array(
		'post_type'              => 'post',
		'posts_per_page'         => 1,
		'ignore_sticky_posts'    => false,
		'no_found_rows'          => true,
		'update_post_meta_cache' => false,
		'update_post_term_cache' => true,
	)
);

$fl_lead_id     = $fl_lead_query->have_posts() ? $fl_lead_query->posts[0]->ID : 0;
$fl_stack_query = new WP_Query(
	array(
		'post_type'              => 'post',
		'posts_per_page'         => 4,
		'post__not_in'           => $fl_lead_id ? array( $fl_lead_id ) : array(),
		'no_found_rows'          => true,
		'update_post_meta_cache' => false,
	)
);

/**
 * Small local helper: first category name for a post, or a graceful default.
 * Kept private to this pattern (prefixed) rather than in functions.php since
 * it's only used for this front-page card styling.
 */
if ( ! function_exists( 'fourliberty_pattern_first_category' ) ) {
	function fourliberty_pattern_first_category( $post_id ) {
		$terms = get_the_category( $post_id );
		return ! empty( $terms ) ? esc_html( $terms[0]->name ) : 'News';
	}
}
?>
<!-- wp:group {"className":"fl-section","layout":{"type":"constrained","contentSize":"1200px"}} -->
<div class="wp-block-group fl-section">

	<!-- wp:html -->
	<div class="fl-section-head">
		<span class="fl-section-head__tab"></span>
		<h2>The Front Page</h2>
		<span class="fl-section-head__rule"></span>
		<a href="/blog/">All stories &rarr;</a>
	</div>
	<!-- /wp:html -->

	<?php if ( $fl_lead_id ) : ?>

	<!-- wp:columns {"style":{"spacing":{"blockGap":{"left":"24px"}}}} -->
	<div class="wp-block-columns">

		<!-- wp:column {"width":"61%"} -->
		<div class="wp-block-column" style="flex-basis:61%">
			<!-- wp:html -->
			<article class="fl-lead">
				<a href="<?php echo esc_url( get_permalink( $fl_lead_id ) ); ?>" class="fl-thumb<?php echo has_post_thumbnail( $fl_lead_id ) ? '' : ' fl-thumb--gold'; ?>" style="<?php echo has_post_thumbnail( $fl_lead_id ) ? 'background-image:url(' . esc_url( get_the_post_thumbnail_url( $fl_lead_id, 'large' ) ) . ')' : ''; ?>">
					<span class="fl-cat-tag"><?php echo fourliberty_pattern_first_category( $fl_lead_id ); ?></span>
				</a>
				<div class="fl-lead__body">
					<h3><a href="<?php echo esc_url( get_permalink( $fl_lead_id ) ); ?>"><?php echo esc_html( get_the_title( $fl_lead_id ) ); ?></a></h3>
					<p><?php echo esc_html( wp_trim_words( get_the_excerpt( $fl_lead_id ), 26 ) ); ?></p>
					<div class="fl-byline">By <b><?php echo esc_html( get_the_author_meta( 'display_name', get_post_field( 'post_author', $fl_lead_id ) ) ); ?></b> &middot; <?php echo esc_html( fourliberty_reading_time( $fl_lead_id ) ); ?> min read</div>
				</div>
			</article>
			<!-- /wp:html -->
		</div>
		<!-- /wp:column -->

		<!-- wp:column {"width":"39%"} -->
		<div class="wp-block-column" style="flex-basis:39%">
			<!-- wp:html -->
			<div class="fl-story-stack">
				<?php foreach ( $fl_stack_query->posts as $fl_post ) : ?>
				<a class="fl-story" href="<?php echo esc_url( get_permalink( $fl_post ) ); ?>">
					<span class="fl-thumb"<?php echo has_post_thumbnail( $fl_post ) ? ' style="background-image:url(' . esc_url( get_the_post_thumbnail_url( $fl_post, 'medium' ) ) . ');background-size:cover;background-position:center"' : ''; ?>></span>
					<span>
						<span class="fl-kicker"><?php echo fourliberty_pattern_first_category( $fl_post->ID ); ?></span>
						<h4><?php echo esc_html( get_the_title( $fl_post ) ); ?></h4>
					</span>
				</a>
				<?php endforeach; ?>
			</div>
			<!-- /wp:html -->
		</div>
		<!-- /wp:column -->

	</div>
	<!-- /wp:columns -->

	<?php else : ?>

	<!-- wp:html -->
	<div class="fl-lead fl-lead--empty" style="padding:28px;text-align:center;color:var(--wp--preset--color--muted)">
		No stories published yet &mdash; the front page will fill in as soon as the first post goes live.
	</div>
	<!-- /wp:html -->

	<?php endif; ?>

</div>
<!-- /wp:group -->
