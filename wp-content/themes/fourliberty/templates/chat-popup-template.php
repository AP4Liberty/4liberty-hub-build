<?php
/**
 * Pop-out chat window (2026-07-23) — reached via "/?fl_chat_popup=1",
 * swapped in by fourliberty_maybe_chat_popup_template() in functions.php.
 * Opened by the "Pop out" button in the main chat rail
 * (patterns/hero-live.php: window.open( ..., 'width=380,height=600' )).
 *
 * Deliberately bare: no header, hero player, or footer — this is the exact
 * same [data-fl="chat-rail"] markup and scripts (chat.js, rumble-mirror.js,
 * account.js) the homepage already loads, not a second chat implementation
 * to keep in sync. rumble-mirror.js's "standalone mode" (see that file's own
 * header comment) is what lets it work out which show is live without the
 * hero player this page doesn't have.
 *
 * No tip bar here on purpose — this window is chat, full stop; tipping
 * stays on the main site.
 *
 * @package fourliberty
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<?php // Title comes from wp_head()'s own title-tag output — see the
	// pre_get_document_title filter in functions.php, which overrides it
	// specifically for this route rather than duplicating a <title> here. ?>
	<?php wp_head(); ?>
</head>
<body class="fl-chat-popup">
	<aside class="fl-rail" data-fl="chat-rail">
		<div class="fl-rail__head">
			<span class="fl-title"><span class="fl-pulse"></span> Live Chat</span>
			<span class="fl-rail__count" data-fl="chat-count">&nbsp;</span>
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
				<span class="fl-msg__body"><span class="fl-msg__who">4Liberty Network</span> Chat opens when a show is live &mdash; check back soon.</span>
			</div>
		</div>
	</aside>
	<?php wp_footer(); ?>
</body>
</html>
