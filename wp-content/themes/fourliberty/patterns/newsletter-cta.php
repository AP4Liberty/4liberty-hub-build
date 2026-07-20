<?php
/**
 * Title: Newsletter — The Daily Brief
 * Slug: fourliberty/newsletter-cta
 * Categories: fourliberty
 * Description: Email capture band. Ships as a plain form stub in Phase 1 —
 *              wiring it to Klaviyo (already in the owner's stack) is a
 *              small follow-up once an API key/list ID is available, not a
 *              blocker for the rest of Phase 1.
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
	<div class="fl-newsletter">
		<div class="fl-newsletter__row">
			<div class="fl-newsletter__copy">
				<span class="fl-eyebrow">The Daily Brief</span>
				<h2>Get the movement in your inbox.</h2>
				<p>The stories, shows, and fights that matter &mdash; every morning, before the mainstream wakes up.</p>
			</div>
			<!-- TODO (post-Phase-1): point this form at Klaviyo once the list ID
			     / API key is available. Left as a plain, honest form for now
			     rather than faking a submit handler. -->
			<form class="fl-newsletter-form" action="/newsletter-subscribe/" method="post">
				<label for="fl-newsletter-email" class="screen-reader-text">Email address</label>
				<input type="email" id="fl-newsletter-email" name="email" placeholder="you@email.com" required>
				<button type="submit">Join Free</button>
			</form>
		</div>
	</div>
	<!-- /wp:html -->
</div>
<!-- /wp:group -->
