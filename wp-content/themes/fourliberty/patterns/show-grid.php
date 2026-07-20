<?php
/**
 * Title: Show Grid — Network Shows
 * Slug: fourliberty/show-grid
 * Categories: fourliberty
 * Description: The /shows/ page content — one card per network show. Reuses
 *              the same live-poller data as the homepage hero (Phase 2):
 *              each card carries a data-fl-show="{KEY}" hook that
 *              assets/js/show-grid.js lights up with a real "LIVE now" badge
 *              when that channel is live, using the same
 *              https://4liberty-poller.netlify.app/api/live-state endpoint —
 *              no separate data source, no duplicated logic.
 *
 *              Show blurbs below are honest placeholders, not invented bios —
 *              only facts already confirmed elsewhere in this project are
 *              stated as fact (Wake Up America's weekday-morning slot, from
 *              the header ticker; Freedom Arcade's members-only gate, from
 *              PHASE-2-BUILD-PLAN.md Decision 8). The other four shows need
 *              real one-line descriptions from Austin — replace the
 *              "Watch live on the network." placeholder per show once
 *              provided, ideally via an admin field rather than editing this
 *              file directly (see the task-E note in functions.php).
 *
 * @package fourliberty
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Matches the roster + keys in fourliberty_live_shows_config() (functions.php)
 * so the live badge wiring lines up with the same channel keys the poller
 * reports. If that config's admin panel (task E) starts storing show blurbs
 * too, this array should read from get_option() the same way instead of
 * being hardcoded here.
 */
$fourliberty_shows = array(
	array(
		'key'    => 'WUA',
		'name'   => 'Wake Up America',
		'blurb'  => 'The network\'s flagship morning show, hosted by Austin Petersen.',
		'detail' => 'Weekday mornings &middot; 7&ndash;9A CT',
	),
	array(
		'key'    => 'WUJC',
		'name'   => 'Wake Up Jefferson City',
		'blurb'  => 'Watch live on the network.',
		'detail' => '',
	),
	array(
		'key'    => 'CULTURAMA',
		'name'   => 'Culturama',
		'blurb'  => 'Watch live on the network.',
		'detail' => '',
	),
	array(
		'key'    => 'HOMESCHOOL',
		'name'   => 'Homeschool Workshop',
		'blurb'  => 'Watch live on the network.',
		'detail' => '',
	),
	array(
		'key'    => 'CAFECITO',
		'name'   => 'Cafecito Libre',
		'blurb'  => 'Watch live on the network.',
		'detail' => '',
	),
	array(
		'key'    => 'FNFA',
		'name'   => 'Friday Night Freedom Arcade',
		'blurb'  => 'Members-only broadcast &mdash; subscribe on Rumble to watch.',
		'detail' => 'Friday nights &middot; Rumble subscribers only',
	),
);
?>
<!-- wp:group {"layout":{"type":"constrained","contentSize":"1000px"}} -->
<div class="wp-block-group">
	<!-- wp:html -->
	<div class="fl-showgrid">
		<?php foreach ( $fourliberty_shows as $fourliberty_show ) : ?>
		<a class="fl-showcard" href="/" data-fl-show="<?php echo esc_attr( $fourliberty_show['key'] ); ?>">
			<span class="fl-showcard__live" data-fl="show-live-badge" hidden><span class="fl-pulse"></span>Live now</span>
			<h4><?php echo esc_html( $fourliberty_show['name'] ); ?></h4>
			<p><?php echo esc_html( $fourliberty_show['blurb'] ); ?></p>
			<?php if ( $fourliberty_show['detail'] ) : ?>
			<span class="fl-showcard__detail"><?php echo wp_kses_post( $fourliberty_show['detail'] ); ?></span>
			<?php endif; ?>
			<span class="fl-showcard__cta">Watch on the network &rarr;</span>
		</a>
		<?php endforeach; ?>
	</div>
	<!-- /wp:html -->
</div>
<!-- /wp:group -->
