<?php
/**
 * Title: Support Band — Homepage Teaser
 * Slug: fourliberty/support-band
 * Categories: fourliberty
 * Description: Homepage teaser for /support/. Each tier links straight to
 *              its Square checkout (Austin's explicit call, 2026-07-26 — a
 *              plain "/support/" link made visitors click through a second
 *              page to start a $5/mo, which he wants gone). The four URLs
 *              below are copy-pasted verbatim from patterns/support-tiers.php
 *              — the same Golden-Rule-#2-verified links already live on
 *              /support/ for the matching dollar amount, never re-typed or
 *              guessed. If a tier's URL ever changes on /support/, mirror the
 *              change here too.
 *
 * @package fourliberty
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<!-- wp:group {"className":"fl-section","layout":{"type":"constrained","contentSize":"1200px"}} -->
<div class="wp-block-group fl-section">
	<!-- wp:html -->
	<div class="fl-support-band">
		<div class="fl-support-band__copy">
			<span class="fl-eyebrow fl-eyebrow--red">Stand With Liberty</span>
			<h2>Become a modern patron of liberty.</h2>
			<p>Monthly supporters get a permanent 20% shop discount, supporter-only perks, and keep the network independent.</p>
		</div>
		<div class="fl-tiers">
			<a class="fl-tier" href="https://square.link/u/fUUZQwBi?src=embed" target="_blank" rel="noopener"><span class="fl-tier__amt">$5</span><span class="fl-tier__name">Don&rsquo;t Tread</span></a>
			<a class="fl-tier" href="https://square.link/u/kQfuvU6Q?src=embed" target="_blank" rel="noopener"><span class="fl-tier__amt">$10</span><span class="fl-tier__name">Freedom Ninja</span></a>
			<a class="fl-tier fl-tier--popular" href="https://square.link/u/yO7ncoYU?src=embed" target="_blank" rel="noopener"><span class="fl-tier__amt">$17.76</span><span class="fl-tier__name">Petersen&rsquo;s Patriots</span></a>
			<a class="fl-tier" href="https://square.link/u/m84fpa8q?src=embed" target="_blank" rel="noopener"><span class="fl-tier__amt">$50</span><span class="fl-tier__name">Grant&rsquo;s Army</span></a>
		</div>
	</div>
	<!-- /wp:html -->
</div>
<!-- /wp:group -->
