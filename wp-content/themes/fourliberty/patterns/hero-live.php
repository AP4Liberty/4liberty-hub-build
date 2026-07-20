<?php
/**
 * Title: Hero — Live Show
 * Slug: fourliberty/hero-live
 * Categories: fourliberty
 * Description: The homepage's live/dark hero player, "also live" row, and the
 *              chat + tip rail. Phase 1 ships this as an honest static stub —
 *              Phase 2 (live-swapper) replaces the player state and "also
 *              live" row with real Rumble data from the Netlify poller; Phase
 *              3 replaces the chat feed and tip buttons with the real Stream
 *              + Square wiring. The markup/classes are already shaped for
 *              that so later phases only swap data, not structure.
 *
 * @package fourliberty
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<!-- wp:group {"className":"fl-hero","layout":{"type":"constrained","contentSize":"1200px"}} -->
<div class="wp-block-group fl-hero">

	<!-- wp:columns {"className":"fl-hero-grid","style":{"spacing":{"blockGap":{"left":"22px"}}}} -->
	<div class="wp-block-columns fl-hero-grid">

		<!-- wp:column {"width":"70%"} -->
		<div class="wp-block-column" style="flex-basis:70%">

			<!-- wp:html -->
			<div class="fl-player" data-fl="hero-player">
				<div class="fl-player__scrim"></div>
				<span class="fl-badge-live"><span class="fl-pulse"></span>Live</span>
				<span class="fl-viewers"><span data-fl="viewer-count">&mdash;</span> watching</span>
				<button class="fl-play" type="button" aria-label="Play the live show">
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>
				</button>
				<div class="fl-player-meta">
					<div class="fl-player-meta__show" data-fl="hero-show">Wake Up America &middot; with Austin Petersen</div>
					<h2 data-fl="hero-title">Check back for today&rsquo;s live show</h2>
					<div class="fl-player-meta__host">Streaming live on Rumble &mdash; join the conversation below.</div>
				</div>
			</div>
			<!-- /wp:html -->

			<!-- wp:html -->
			<div class="fl-also-live" data-fl="also-live">
				<!-- Phase 2 populates 0-2 "also live" tiles here from the poller. -->
			</div>
			<!-- /wp:html -->

		</div>
		<!-- /wp:column -->

		<!-- wp:column {"width":"30%"} -->
		<div class="wp-block-column" style="flex-basis:30%">

			<!-- wp:html -->
			<aside class="fl-rail" data-fl="chat-rail">
				<div class="fl-rail__head">
					<span class="fl-title"><span class="fl-pulse"></span> Live Chat</span>
					<span class="fl-rail__count" data-fl="chat-count">&nbsp;</span>
				</div>
				<div class="fl-chat" data-fl="chat-feed">
					<div class="fl-msg">
						<span class="fl-msg__av"></span>
						<span class="fl-msg__body"><span class="fl-msg__who">4Liberty Network</span> Chat opens when a show is live &mdash; check back soon.</span>
					</div>
				</div>
				<div class="fl-tipbar" data-fl="tip-bar">
					<div class="fl-tipbar__label">&#128176; Tip the show</div>
					<div class="fl-tipchips">
						<button type="button" data-amount="5">$5</button>
						<button type="button" class="fl-tipchips__hot" data-amount="17.76">$17.76</button>
						<button type="button" data-amount="50">$50</button>
						<button type="button" data-amount="custom">Custom</button>
					</div>
				</div>
			</aside>
			<!-- /wp:html -->

		</div>
		<!-- /wp:column -->

	</div>
	<!-- /wp:columns -->

</div>
<!-- /wp:group -->
