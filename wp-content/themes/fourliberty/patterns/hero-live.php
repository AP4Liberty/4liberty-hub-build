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
 *              Phase 3 also merges Rumble's read-only chat into the same
 *              feed as the real chat (2026-07-23) — assets/js/rumble-mirror.js
 *              hands each new Rumble message to chat.js's
 *              appendExternalMessage() hook, tagged "via Rumble", keyed to
 *              whichever channel live-state.js currently has as hero (via the
 *              "fl:hero-state" event), never from a Rumble API URL directly.
 *              The "Hide Rumble bot messages" toggle and "Join on Rumble"
 *              link live in the rail subhead just above the feed.
 *
 *              The rail head's "pop out" button (2026-07-23) opens
 *              templates/chat-popup-template.php in its own small window —
 *              same chat, same scripts, just without the hero player/tip
 *              bar around it.
 *
 *              An optional ad block (2026-07-23) sits below "also live" —
 *              the rail next to it runs taller than the video, and this
 *              fills the resulting gap. Config-driven (includes/
 *              settings-shop-ad.php in the plugin); renders nothing if no
 *              image is saved.
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

			<?php
			/**
			 * Homepage ad block (2026-07-23, Austin's request) — the chat
			 * rail next to this column runs taller than the video, leaving a
			 * visible gap before "The Front Page" section; this fills it.
			 * Config-driven (includes/settings-shop-ad.php) so the image and
			 * link are swappable without touching code; no image saved yet =
			 * render nothing; same "safe, not broken" default as Dark
			 * Channel's empty-playlist case.
			 */
			$fl_shop_ad = function_exists( 'fourliberty_shop_ad_config' ) ? fourliberty_shop_ad_config() : array();
			if ( ! empty( $fl_shop_ad['imageUrl'] ) ) :
				?>
				<!-- wp:html -->
				<a class="fl-shop-ad" data-fl="shop-ad" href="<?php echo esc_url( $fl_shop_ad['linkUrl'] ?: 'https://4libertyshop.com' ); ?>" target="_blank" rel="noopener sponsored">
					<img src="<?php echo esc_url( $fl_shop_ad['imageUrl'] ); ?>" alt="<?php echo esc_attr( $fl_shop_ad['altText'] ?: 'Shop 4Liberty Network' ); ?>" loading="lazy" />
				</a>
				<!-- /wp:html -->
				<?php
			endif;
			?>

		</div>
		<!-- /wp:column -->

		<!-- wp:column {"width":"30%"} -->
		<div class="wp-block-column" style="flex-basis:30%">

			<!-- wp:html -->
			<aside class="fl-rail" data-fl="chat-rail">
				<div class="fl-rail__head">
					<span class="fl-title"><span class="fl-pulse"></span> Live Chat</span>
					<span class="fl-rail__count" data-fl="chat-count">&nbsp;</span>
					<button type="button" class="fl-rail__popout" data-fl="chat-popout" title="Pop out chat" aria-label="Pop out chat into its own window">&#8599;</button>
				</div>
				<div class="fl-rail__subhead">
					<label class="fl-rumble-mirror__hide-bots">
						<input type="checkbox" data-fl="rumble-hide-bots" /> Hide Rumble bot messages
					</label>
					<a class="fl-rumble-mirror__join" data-fl="rumble-join-link" href="#" target="_blank" rel="noopener" hidden>Join on Rumble &rarr;</a>
				</div>
				<div class="fl-chat" data-fl="chat-feed">
					<div class="fl-msg">
						<span class="fl-msg__av"></span>
						<span class="fl-msg__body"><span class="fl-msg__who">4Liberty Network</span> Chat opens when a show is live &mdash; check back soon. Rumble&rsquo;s live chat shows up here too, tagged &ldquo;via Rumble.&rdquo;</span>
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

			<!-- wp:html -->
			<?php
			/**
			 * Off-air schedule panel (2026-07-23) — an empty chat box when no
			 * show is live is dead real estate that makes the site look
			 * inactive (Austin's call). assets/js/schedule-rail.js swaps THIS in
			 * for the chat rail above whenever nothing's live (same
			 * "fl:hero-state" event the Dark Channel + rumble mirror read), and
			 * swaps the chat back the instant a show goes live. Starts hidden;
			 * the swap decision is made in JS off the live state, so the safe
			 * fallback if that script never runs is the chat rail, exactly as
			 * before this panel existed. The schedule list is filled from the
			 * same Live Shows schedules the ticker uses (window.fourlibertyLiveShows).
			 */
			?>
			<aside class="fl-schedule-rail" data-fl="schedule-rail" hidden>
				<div class="fl-rail__head">
					<span class="fl-title">When we&rsquo;re live</span>
				</div>
				<div class="fl-schedule-rail__body">
					<p class="fl-schedule-rail__intro">You&rsquo;re watching the 4Liberty replay channel. Here&rsquo;s when the live shows are on:</p>
					<ul class="fl-schedule-rail__list" data-fl="schedule-list">
						<!-- assets/js/schedule-rail.js fills this from the Live Shows schedules -->
					</ul>
					<div class="fl-schedule-rail__notify">
						<label class="fl-schedule-rail__notify-label" for="fl-schedule-notify-email">Get an email when a show goes live</label>
						<form class="fl-schedule-rail__form" data-fl="schedule-notify-form">
							<input id="fl-schedule-notify-email" type="email" placeholder="you@email.com" required />
							<button type="submit">Notify me</button>
						</form>
						<p class="fl-schedule-rail__status" data-fl="schedule-notify-status" role="status" aria-live="polite"></p>
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
