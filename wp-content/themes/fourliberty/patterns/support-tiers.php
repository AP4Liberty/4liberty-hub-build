<?php
/**
 * Title: Support Tiers — Full Donation Grid
 * Slug: fourliberty/support-tiers
 * Categories: fourliberty
 * Description: The real /support page content. GOLDEN RULE #2: every dollar
 *              amount, tier name, description, and — most importantly — every
 *              Square checkout URL below was read directly from the live
 *              /support page's rendered HTML on 2026-07-15 (via read-only DOM
 *              inspection, no buttons clicked) and must stay byte-for-byte
 *              identical. Do NOT regenerate, approximate, or "clean up" these
 *              URLs. If a tier ever needs to change, get the new square.link
 *              URL from Austin/Square directly — never guess one.
 *
 * @package fourliberty
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Verified 2026-07-15 against the live /support page. Each entry: name,
 * description, price label, the exact square.link URL, cta label, and an
 * optional badge. Kept as one array so the URLs live in exactly one place.
 */
$fourliberty_support_tiers = array(
	'core'       => array(
		'title'    => 'Core Supporters',
		'subtitle' => 'Most supporters begin here. Every dollar counts.',
		'tiers'    => array(
			array(
				'name'  => 'Don&rsquo;t Tread on AP',
				'desc'  => 'A simple way to stand with the show and keep the movement growing.',
				'price' => '$5',
				'per'   => 'per month',
				'url'   => 'https://square.link/u/fUUZQwBi?src=embed',
				'cta'   => 'Pay now',
			),
			array(
				'name'  => 'Freedom Ninja',
				'desc'  => 'Monthly support that helps keep the engine running day after day.',
				'price' => '$10',
				'per'   => 'per month',
				'url'   => 'https://square.link/u/kQfuvU6Q?src=embed',
				'cta'   => 'Pay now',
			),
			array(
				'name'  => 'Petersen&rsquo;s Patriots',
				'desc'  => 'The classic patriot tier. Built for consistency and long-term support.',
				'price' => '$17.76',
				'per'   => 'per month',
				'url'   => 'https://square.link/u/yO7ncoYU?src=embed',
				'cta'   => 'Pay now',
				'badge' => 'Most Popular',
			),
		),
	),
	'leadership' => array(
		'title'    => 'Leadership Circle',
		'subtitle' => 'For supporters who want to help stabilize payroll and accelerate growth.',
		'tiers'    => array(
			array(
				'name'  => 'Action Jackson Plan',
				'desc'  => 'A strong monthly commitment that helps keep key operations moving forward.',
				'price' => '$20',
				'per'   => 'per month',
				'url'   => 'https://square.link/u/O7yWpMTK?src=embed',
				'cta'   => 'Pay now',
				'badge' => 'Best for Growth',
			),
			array(
				'name'  => 'Grant&rsquo;s Army',
				'desc'  => 'Leadership-level support that makes expansion possible and stabilizes payroll.',
				'price' => '$50',
				'per'   => 'per month',
				'url'   => 'https://square.link/u/m84fpa8q?src=embed',
				'cta'   => 'Pay now',
			),
			array(
				'name'  => 'One-Time Donation',
				'desc'  => 'Prefer a one-time contribution? This helps fund urgent needs and projects.',
				'price' => 'Any',
				'per'   => 'one time',
				'url'   => 'https://square.link/u/2cbx1KIw?src=embed',
				'cta'   => 'Donate',
				'note'  => 'Enter any amount at checkout',
			),
		),
	),
	'founders'   => array(
		'title'    => 'Founders Circle',
		'subtitle' => 'For supporters who want to anchor the long-term infrastructure of liberty media.',
		'tiers'    => array(
			array(
				'name'  => 'Benjamin&rsquo;s Brigade',
				'desc'  => 'Foundational support for long-term expansion, production, and political infrastructure.',
				'price' => '$100',
				'per'   => 'per month',
				'url'   => 'https://square.link/u/zLkOIgMq?src=embed',
				'cta'   => 'Pay now',
			),
			array(
				'name'  => 'Give a Custom Amount',
				'desc'  => 'If you prefer, text us and we&rsquo;ll set it up with you.',
				'price' => '',
				'per'   => '',
				'url'   => 'https://square.link/u/2cbx1KIw?src=embed',
				'cta'   => 'Give a custom amount',
			),
		),
	),
);
?>
<!-- wp:group {"layout":{"type":"constrained","contentSize":"820px"}} -->
<div class="wp-block-group">
	<!-- wp:html -->
	<div class="fl-support-pills">
		<span class="fl-pill">Secure, monthly support in under 60 seconds</span>
		<span class="fl-pill">Your support funds shows, payroll stability, and growth</span>
		<span class="fl-pill">Leadership and Founder tiers accelerate expansion</span>
	</div>

	<div class="fl-benefits-box">
		<h3>Supporter Benefits</h3>
		<p>Monthly supporters receive a permanent 20% discount at 4LibertyShop.com, plus entry into periodic drawings and supporter-only perks.</p>
	</div>
	<!-- /wp:html -->

	<?php foreach ( $fourliberty_support_tiers as $fourliberty_group ) : ?>
	<!-- wp:html -->
	<div class="fl-support-group">
		<h3><?php echo esc_html( $fourliberty_group['title'] ); ?></h3>
		<p class="fl-support-group__sub"><?php echo esc_html( $fourliberty_group['subtitle'] ); ?></p>
		<div class="fl-supportgrid">
			<?php foreach ( $fourliberty_group['tiers'] as $fourliberty_tier ) : ?>
			<div class="fl-supportcard<?php echo ! empty( $fourliberty_tier['badge'] ) ? ' fl-supportcard--badged' : ''; ?>">
				<?php if ( ! empty( $fourliberty_tier['badge'] ) ) : ?>
				<span class="fl-supportcard__badge"><?php echo esc_html( $fourliberty_tier['badge'] ); ?></span>
				<?php endif; ?>
				<h4><?php echo wp_kses_post( $fourliberty_tier['name'] ); ?></h4>
				<?php if ( $fourliberty_tier['price'] ) : ?>
				<div class="fl-supportcard__price"><?php echo esc_html( $fourliberty_tier['price'] ); ?><span><?php echo esc_html( $fourliberty_tier['per'] ); ?></span></div>
				<?php endif; ?>
				<p><?php echo wp_kses_post( $fourliberty_tier['desc'] ); ?></p>
				<a class="fl-supportcard__cta" href="<?php echo esc_url( $fourliberty_tier['url'] ); ?>" target="_blank" rel="noopener">
					<?php echo esc_html( $fourliberty_tier['cta'] ); ?>
				</a>
				<span class="fl-supportcard__foot">
					<?php echo isset( $fourliberty_tier['note'] ) ? esc_html( $fourliberty_tier['note'] ) : 'Secure checkout via Square'; ?>
				</span>
			</div>
			<?php endforeach; ?>
		</div>
	</div>
	<!-- /wp:html -->
	<?php endforeach; ?>

</div>
<!-- /wp:group -->
