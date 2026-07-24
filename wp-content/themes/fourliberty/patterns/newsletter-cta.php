<?php
/**
 * Title: Newsletter — The Daily Brief
 * Slug: fourliberty/newsletter-cta
 * Categories: fourliberty
 * Description: Email capture band. Wired to Klaviyo (Task: newsletter
 *              follow-up, 2026-07-23) — assets/js/newsletter.js submits to
 *              netlify/functions/newsletter-subscribe.mts, which subscribes
 *              the email to the "4Liberty Network — Daily Brief" Klaviyo
 *              list. No server-rendered fallback: every other form in this
 *              theme (chat, tips, login) is JS-only too.
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
			<form class="fl-newsletter-form" data-fl="newsletter-form">
				<label for="fl-newsletter-email" class="screen-reader-text">Email address</label>
				<input type="email" id="fl-newsletter-email" name="email" placeholder="you@email.com" required>
				<button type="submit">Join Free</button>
			</form>
			<div class="fl-newsletter__status" data-fl="newsletter-status"></div>
		</div>
	</div>
	<!-- /wp:html -->
</div>
<!-- /wp:group -->
