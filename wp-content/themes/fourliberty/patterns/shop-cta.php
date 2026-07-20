<?php
/**
 * Title: Shop CTA — Link Out to 4LibertyShop
 * Slug: fourliberty/shop-cta
 * Categories: fourliberty
 * Description: The /shop page content. Per BUILD-BRIEF.md, "Shop" has always
 *              been a link-out to the existing Shopify store, not a catalog
 *              rebuilt in WordPress — the in-stream shoppable product popup
 *              (Phase 4) is the separate feature that touches the Shopify
 *              catalog directly. This is a simple, prominent CTA page — no
 *              missing information, safe to ship as-is.
 *
 * @package fourliberty
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<!-- wp:group {"layout":{"type":"constrained","contentSize":"820px"}} -->
<div class="wp-block-group">
	<!-- wp:html -->
	<div class="fl-shop-band">
		<div class="fl-shop-band__copy">
			<span class="fl-eyebrow">Merch &amp; Founding Flavors Coffee</span>
			<h2>Gear up with the network.</h2>
			<p>Shirts, hats, and Founding Flavors coffee &mdash; every order supports the shows you watch. Monthly supporters get a permanent 20% discount at checkout.</p>
		</div>
		<a class="fl-shop-band__cta" href="https://4libertyshop.com" target="_blank" rel="noopener">
			Shop 4LibertyShop.com &rarr;
		</a>
	</div>
	<!-- /wp:html -->
</div>
<!-- /wp:group -->
