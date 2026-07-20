<?php
/**
 * Title: 4Liberty Channel — Always Something On
 * Slug: fourliberty/channel-strip
 * Categories: fourliberty
 * Description: Stub for the Phase 2 "Dark Channel" — the always-on multi-
 *              source playlist (YouTube/Rumble/blog posts) with adjustable
 *              ad breaks that plays when no show is live. Phase 1 ships the
 *              visual shell only; the admin-configured playlist, the playout
 *              engine (auto-advance + ad cadence), and real thumbnails are
 *              wired by the 4liberty-hub plugin in Phase 2.
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
	<div class="fl-channel" data-fl="dark-channel">
		<div class="fl-channel__top">
			<span class="fl-channel__badge">4Liberty Channel</span>
			<h2>Always Something On</h2>
			<span class="fl-channel__now">Configured in 4Liberty Hub &rsaquo; Dark Channel (coming in Phase 2)</span>
		</div>
		<div class="fl-vids" data-fl="channel-playlist">
			<div class="fl-vid fl-vid--on"><span class="fl-vid__dur">&ndash;:&ndash;&ndash;</span><span class="fl-vid__label">Playlist not yet configured</span></div>
			<div class="fl-vid"><span class="fl-vid__label">&nbsp;</span></div>
			<div class="fl-vid"><span class="fl-vid__label">&nbsp;</span></div>
			<div class="fl-vid"><span class="fl-vid__label">&nbsp;</span></div>
			<div class="fl-vid"><span class="fl-vid__label">&nbsp;</span></div>
		</div>
	</div>
	<!-- /wp:html -->
</div>
<!-- /wp:group -->
