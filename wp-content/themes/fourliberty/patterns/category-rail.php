<?php
/**
 * Title: Category Rail — Politics & Liberty
 * Slug: fourliberty/category-rail
 * Categories: fourliberty
 * Description: A 4-up card row pulling from the "politics" category (falls
 *              back to recent posts generally if that category doesn't exist
 *              yet or is empty, so the section is never blank while content
 *              is still being categorized).
 *
 * @package fourliberty
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$fl_cat        = get_category_by_slug( 'politics' );
$fl_card_query = new WP_Query(
	array(
		'post_type'              => 'post',
		'posts_per_page'         => 4,
		'category_name'          => $fl_cat ? 'politics' : '',
		'no_found_rows'          => true,
		'update_post_meta_cache' => false,
	)
);

// Category exists but has nothing in it yet — fall back to recent posts.
if ( ! $fl_card_query->have_posts() ) {
	$fl_card_query = new WP_Query(
		array(
			'post_type'              => 'post',
			'posts_per_page'         => 4,
			'no_found_rows'          => true,
			'update_post_meta_cache' => false,
		)
	);
}
?>
<!-- wp:group {"className":"fl-section","layout":{"type":"constrained"}} -->
<div class="wp-block-group fl-section">

	<!-- wp:html -->
	<div class="fl-section-head">
		<span class="fl-section-head__tab"></span>
		<h2>Politics &amp; Liberty</h2>
		<span class="fl-section-head__rule"></span>
		<a href="/category/politics/">More &rarr;</a>
	</div>
	<!-- /wp:html -->

	<?php if ( $fl_card_query->have_posts() ) : ?>
	<!-- wp:html -->
	<div class="fl-cardrow">
		<?php foreach ( $fl_card_query->posts as $fl_post ) : ?>
		<a class="fl-card" href="<?php echo esc_url( get_permalink( $fl_post ) ); ?>">
			<span class="fl-thumb<?php echo has_post_thumbnail( $fl_post ) ? '' : ' fl-thumb--gold'; ?>"<?php echo has_post_thumbnail( $fl_post ) ? ' style="background-image:url(' . esc_url( get_the_post_thumbnail_url( $fl_post, 'medium_large' ) ) . ');background-size:cover;background-position:center"' : ''; ?>>
				<span class="fl-cat-tag"><?php echo fourliberty_pattern_first_category( $fl_post->ID ); ?></span>
			</span>
			<span class="fl-card__body">
				<h4><?php echo esc_html( get_the_title( $fl_post ) ); ?></h4>
			</span>
		</a>
		<?php endforeach; ?>
	</div>
	<!-- /wp:html -->
	<?php endif; ?>

</div>
<!-- /wp:group -->
