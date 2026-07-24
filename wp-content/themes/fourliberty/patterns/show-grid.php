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
 *              Show blurbs are condensed from real copy Austin provided
 *              (2026-07-22) for WUJC/Culturama/Homeschool Workshop/Cafecito
 *              Libre, plus facts already confirmed elsewhere in this project
 *              for Wake Up America (weekday-morning slot, from the header
 *              ticker) and Freedom Arcade (members-only gate, from
 *              PHASE-2-BUILD-PLAN.md Decision 8) — none invented.
 *
 * @package fourliberty
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Matches the roster + keys in fourliberty_live_shows_config() (functions.php)
 * so the live badge wiring lines up with the same channel keys the poller
 * reports. Blurbs stay hardcoded here (the admin panel doesn't store those),
 * but `detail` (the schedule line) is overridden below from that same config
 * wherever Austin has set one via 4Liberty Hub → Live Shows — the "Schedule"
 * field added 2026-07-23 alongside the homepage ticker, so an owner-edited
 * airtime shows up here too instead of only in the ticker.
 */
$fourliberty_live_shows = fourliberty_live_shows_config();
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
		'blurb'  => 'Brad Boeckmann&rsquo;s live local talk show covering the people, issues, and events shaping Missouri&rsquo;s capital.',
		'detail' => 'Tuesdays &amp; Thursdays &middot; 6&ndash;7A CT',
	),
	array(
		'key'    => 'CULTURAMA',
		'name'   => 'Culturama',
		'blurb'  => 'Daniella Pentsak on culture, politics, and technology &mdash; sharp analysis with a 1950s-inspired, forward-looking take on liberty.',
		'detail' => '',
	),
	array(
		'key'    => 'HOMESCHOOL',
		'name'   => 'Homeschool Workshop',
		'blurb'  => 'Aerospace engineer and homeschool dad of five Brian Peotter on raising free-range kids and navigating homeschooling.',
		'detail' => '',
	),
	array(
		'key'    => 'CAFECITO',
		'name'   => 'Cafecito Libre',
		'blurb'  => 'Bilingual conversation connecting American and Latin American audiences around freedom, entrepreneurship, and the future of the West.',
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
		<?php foreach ( $fourliberty_shows as $fourliberty_show ) :
			$fourliberty_configured_schedule = $fourliberty_live_shows['shows'][ $fourliberty_show['key'] ]['schedule'] ?? '';
			$fourliberty_detail = $fourliberty_configured_schedule ? esc_html( $fourliberty_configured_schedule ) : $fourliberty_show['detail'];
			?>
		<a class="fl-showcard" href="/" data-fl-show="<?php echo esc_attr( $fourliberty_show['key'] ); ?>">
			<span class="fl-showcard__live" data-fl="show-live-badge" hidden><span class="fl-pulse"></span>Live now</span>
			<h4><?php echo esc_html( $fourliberty_show['name'] ); ?></h4>
			<p><?php echo esc_html( $fourliberty_show['blurb'] ); ?></p>
			<?php if ( $fourliberty_detail ) : ?>
			<span class="fl-showcard__detail"><?php echo wp_kses_post( $fourliberty_detail ); ?></span>
			<?php endif; ?>
			<span class="fl-showcard__cta">Watch on the network &rarr;</span>
		</a>
		<?php endforeach; ?>
	</div>
	<!-- /wp:html -->
</div>
<!-- /wp:group -->
