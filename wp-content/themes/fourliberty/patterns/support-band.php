<?php
/**
 * Title: Support Band — Homepage Teaser
 * Slug: fourliberty/support-band
 * Categories: fourliberty
 * Description: Homepage teaser for /support/ — display only (tier names +
 *              amounts, no payment links here). The actual Square hosted
 *              payment buttons live solely on the /support/ page itself
 *              (page-support template) per Golden Rule #2 — this band exists
 *              so the ask is visible on the homepage without duplicating the
 *              real checkout buttons in two places.
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
			<a class="fl-tier" href="/support/"><span class="fl-tier__amt">$5</span><span class="fl-tier__name">Don&rsquo;t Tread</span></a>
			<a class="fl-tier" href="/support/"><span class="fl-tier__amt">$10</span><span class="fl-tier__name">Freedom Ninja</span></a>
			<a class="fl-tier fl-tier--popular" href="/support/"><span class="fl-tier__amt">$17.76</span><span class="fl-tier__name">Petersen&rsquo;s Patriots</span></a>
			<a class="fl-tier" href="/support/"><span class="fl-tier__amt">$50</span><span class="fl-tier__name">Grant&rsquo;s Army</span></a>
		</div>
	</div>
	<!-- /wp:html -->
</div>
<!-- /wp:group -->
