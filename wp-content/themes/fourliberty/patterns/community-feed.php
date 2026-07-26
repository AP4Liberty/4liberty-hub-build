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

// Categories (Phase 8, Task E) — a FILTER on the one unified feed, never a
// separate room (PHASE-8-TASK-E-PLAN.md Decision 1). ?topic= is validated
// against real, existing terms only; anything else is ignored rather than
// erroring, so a stale/bad link just falls back to "All".
$fl_all_topics  = function_exists( 'fourliberty_hub_get_community_topics' ) ? fourliberty_hub_get_community_topics() : array();
$fl_topic_slugs = wp_list_pluck( $fl_all_topics, 'slug' );
$fl_topic_slug  = isset( $_GET['topic'] ) ? sanitize_title( wp_unslash( $_GET['topic'] ) ) : '';
if ( ! in_array( $fl_topic_slug, $fl_topic_slugs, true ) ) {
	$fl_topic_slug = '';
}

// Loaded here (rather than down by the Discord section, its previous home)
// because the forum-mode check right below needs it first.
$fl_community_cfg = fourliberty_community_config();

// Phase 9 (Discourse trial) — a display-only mode switch, same non-bridged
// pattern as the Discord widget fields just below. forumUrl blank forces
// 'builtin' even if 'forumMode' says otherwise, so a half-configured trial
// (mode flipped before the URL is saved) never renders a dead-end promo
// card with nowhere to send people.
$fl_forum_mode = isset( $fl_community_cfg['forumMode'] ) ? $fl_community_cfg['forumMode'] : 'builtin';
$fl_forum_url  = isset( $fl_community_cfg['forumUrl'] ) ? $fl_community_cfg['forumUrl'] : '';
if ( '' === $fl_forum_url ) {
	$fl_forum_mode = 'builtin';
}
$fl_show_forum_promo = ( 'builtin' !== $fl_forum_mode );
$fl_show_builtin     = ( 'forum' !== $fl_forum_mode );

// The custom-post-type query only needs to run when the built-in feed is
// actually going to render — 'forum' mode has no use for it.
$fl_community_query = null;
if ( $fl_show_builtin ) {
	$fl_query_args = array(
		'post_type'      => 'fl_community_post',
		'post_status'    => 'publish',
		'posts_per_page' => 15,
		'paged'          => $fl_paged,
		'orderby'        => 'date',
		'order'          => 'DESC',
	);
	if ( $fl_topic_slug ) {
		$fl_query_args['tax_query'] = array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query -- a single, already-validated exact-slug filter on a small custom post type; not a candidate for the usual tax_query performance concerns.
			array(
				'taxonomy' => 'fl_community_topic',
				'field'    => 'slug',
				'terms'    => $fl_topic_slug,
			),
		);
	}
	$fl_community_query = new WP_Query( $fl_query_args );
}

// Discord embed (Phase 8, Task F) — a display setting only, so read
// directly, same-request, no /server-config bridge needed (contrast with
// communityMode/moderatorEmails, which DO need that bridge because they're
// security-enforced). Only the server ID is required — confirmed directly
// against WidgetBot's own dashboard-generated snippet for Austin's actual
// server, which omits `channel` entirely and still works (it defaults to
// the server's main channel; visitors can switch channels inside the
// widget itself). Requiring a channel ID too would have been one more
// "find this ID in Discord" step than the feature actually needs.
$fl_discord_enabled = ! empty( $fl_community_cfg['discordWidgetEnabled'] )
	&& ! empty( $fl_community_cfg['discordWidgetServerId'] );
?>
<!-- wp:group {"layout":{"type":"constrained","contentSize":"820px"}} -->
<div class="wp-block-group">

	<?php if ( $fl_show_forum_promo ) : ?>
	<!-- wp:html -->
	<div class="fl-forum-promo">
		<div class="fl-forum-promo__label">THE FORUM</div>
		<h2 class="fl-forum-promo__title">Join the conversation</h2>
		<p class="fl-forum-promo__body">Threaded discussion, search, and email digests so you never miss a thread.</p>
		<?php
		// target="_blank" is Austin's explicit call (2026-07-27), reversing the
		// original plan's "plain link" note: the forum is a separate hostname,
		// and he wants 4libertynetwork.com to stay open behind it rather than
		// being navigated away from. rel="noopener" is mandatory with _blank.
		?>
		<a class="fl-forum-promo__cta" href="<?php echo esc_url( $fl_forum_url ); ?>" target="_blank" rel="noopener">Open the Forum &rarr;</a>
	</div>

	<?php
	// Live topic list, served by Discourse's own /embed/topics and framed here
	// so the actual conversation shows up ON this domain instead of the page
	// being a single button. Requires TWO things on the Discourse side, both
	// already configured: 4libertynetwork.com added as an embeddable host
	// (which is what puts this origin in Discourse's frame-ancestors CSP —
	// the forum refuses framing otherwise), and the `embed_topics_list` site
	// setting turned on, without which this endpoint 400s no matter what
	// params you pass. Discourse renders it with its own embed stylesheet, so
	// it inherits the forum's colors, not this theme's.
	?>
	<div class="fl-forum-topics">
		<div class="fl-forum-topics__label">LATEST FROM THE FORUM</div>
		<iframe
			class="fl-forum-topics__frame"
			src="<?php echo esc_url( trailingslashit( $fl_forum_url ) . 'embed/topics?per_page=8' ); ?>"
			title="Latest forum topics"
			loading="lazy"
			referrerpolicy="origin"
		></iframe>
	</div>
	<!-- /wp:html -->
	<?php endif; ?>

	<?php if ( $fl_discord_enabled ) : ?>
	<!-- wp:html -->
	<div class="fl-community-discord">
		<div class="fl-community-discord__label">Live from Discord</div>
		<widgetbot
			server="<?php echo esc_attr( $fl_community_cfg['discordWidgetServerId'] ); ?>"
			<?php if ( ! empty( $fl_community_cfg['discordWidgetChannelId'] ) ) : ?>
			channel="<?php echo esc_attr( $fl_community_cfg['discordWidgetChannelId'] ); ?>"
			<?php endif; ?>
			width="100%"
			height="420"
		></widgetbot>
	</div>
	<script src="https://cdn.jsdelivr.net/npm/@widgetbot/html-embed"></script>
	<!-- /wp:html -->
	<?php endif; ?>

	<?php if ( $fl_show_builtin ) : ?>

	<!-- wp:html -->
	<div class="fl-community-composer" data-fl="community-composer-area">
		<div data-fl="community-login-prompt"></div>
		<form class="fl-community-composer__form" data-fl="community-composer-form" hidden>
			<input type="text" name="title" placeholder="Give it a title" maxlength="200" required />
			<textarea name="body" rows="4" placeholder="What&#8217;s on your mind?" maxlength="10000" required></textarea>
			<div class="fl-community-composer__extras">
				<?php if ( $fl_all_topics ) : ?>
				<select name="topic" class="fl-community-composer__topic">
					<?php foreach ( $fl_all_topics as $fl_topic_option ) : ?>
					<option value="<?php echo esc_attr( $fl_topic_option->slug ); ?>" <?php selected( 'general', $fl_topic_option->slug ); ?>><?php echo esc_html( $fl_topic_option->name ); ?></option>
					<?php endforeach; ?>
				</select>
				<?php endif; ?>
				<input type="url" name="gifUrl" class="fl-community-composer__gif" placeholder="Paste a Giphy or Tenor link (optional)" />
			</div>
			<div class="fl-community-composer__row">
				<span class="fl-community-composer__status" data-fl="community-composer-status"></span>
				<button type="submit" class="fl-community-composer__submit">Post</button>
			</div>
		</form>
	</div>
	<!-- /wp:html -->

	<?php if ( $fl_all_topics ) : ?>
	<!-- wp:html -->
	<div class="fl-community-topic-chips">
		<a href="<?php echo esc_url( remove_query_arg( array( 'topic', 'paged' ) ) ); ?>" class="fl-community-topic-chip<?php echo '' === $fl_topic_slug ? ' is-active' : ''; ?>">All</a>
		<?php foreach ( $fl_all_topics as $fl_topic_chip ) : ?>
		<a href="<?php echo esc_url( add_query_arg( 'topic', $fl_topic_chip->slug, remove_query_arg( 'paged' ) ) ); ?>" class="fl-community-topic-chip<?php echo $fl_topic_slug === $fl_topic_chip->slug ? ' is-active' : ''; ?>"><?php echo esc_html( $fl_topic_chip->name ); ?></a>
		<?php endforeach; ?>
	</div>
	<!-- /wp:html -->
	<?php endif; ?>

	<?php if ( $fl_community_query && $fl_community_query->have_posts() ) : ?>

	<!-- wp:html -->
	<div class="fl-community-feed">
		<?php foreach ( $fl_community_query->posts as $fl_post ) :
			$fl_name        = get_post_meta( $fl_post->ID, '_fl_display_name', true );
			$fl_name        = $fl_name ? $fl_name : 'A member';
			$fl_role        = get_post_meta( $fl_post->ID, '_fl_role', true );
			$fl_gif         = fourliberty_community_safe_gif_url( get_post_meta( $fl_post->ID, '_fl_gif_url', true ) );
			$fl_topic_terms = get_the_terms( $fl_post, 'fl_community_topic' );
			$fl_topic_term  = ( is_array( $fl_topic_terms ) && ! empty( $fl_topic_terms ) ) ? $fl_topic_terms[0] : null;
			?>
		<article class="fl-community-post">
			<h3 class="fl-community-post__title"><a href="<?php echo esc_url( get_permalink( $fl_post ) ); ?>"><?php echo esc_html( get_the_title( $fl_post ) ); ?></a></h3>
			<div class="fl-community-post__meta">
				<span class="fl-community-post__author"><?php echo esc_html( $fl_name ); ?></span>
				<?php if ( 'moderator' === $fl_role ) : ?><span class="fl-badge fl-badge--mod">MOD</span><?php endif; ?>
				<?php if ( $fl_topic_term ) : ?><span class="fl-community-post__topic"><?php echo esc_html( $fl_topic_term->name ); ?></span><?php endif; ?>
				<span class="fl-community-post__date"><?php echo esc_html( get_the_date( 'M j', $fl_post ) ); ?></span>
			</div>
			<p class="fl-community-post__excerpt"><?php echo esc_html( wp_trim_words( $fl_post->post_content, 40 ) ); ?></p>
			<?php if ( $fl_gif ) : ?>
			<div class="fl-community-gif"><img src="<?php echo esc_url( $fl_gif ); ?>" alt="" loading="lazy" /></div>
			<?php endif; ?>
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

	<?php endif; // $fl_show_builtin ?>

</div>
<!-- /wp:group -->
