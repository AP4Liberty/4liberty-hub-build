<?php
/**
 * Dark Channel settings — Phase 2, task F.
 *
 * Lets Austin (non-technical) build the always-on playlist that plays when
 * no show is live: drag-and-drop YouTube/Rumble/blog-post items, a
 * YouTube-hosted ad list, and how often ads play. Stored as a single WP
 * option holding a JSON-ish array (via update_option) — leaner than a
 * custom post type and matches "keep the build lean" (PHASE-0-FINDINGS.md).
 *
 * Writes to `fourliberty_dark_channel_config`, the option
 * fourliberty_dark_channel_config() (theme functions.php) already reads —
 * same seam pattern task E used for Live Shows.
 *
 * Every playlist item needs an explicit duration in seconds because the
 * playout engine schedules by wall clock (Decision 4 in
 * PHASE-2-BUILD-PLAN.md: position = (now - epoch) mod (total duration)) —
 * there's no reliable way to fetch a YouTube/Rumble video's duration
 * server-side without an API key this project doesn't have, so this screen
 * just asks Austin for it directly, with an inline explanation of why.
 *
 * @package fourliberty-hub
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const FOURLIBERTY_HUB_DARK_CHANNEL_OPTION = 'fourliberty_dark_channel_config';

function fourliberty_hub_register_dark_channel_menu() {
	$hook = add_submenu_page(
		'fourliberty-hub',
		__( 'Dark Channel', 'fourliberty-hub' ),
		__( 'Dark Channel', 'fourliberty-hub' ),
		'manage_options',
		'fourliberty-hub-dark-channel',
		'fourliberty_hub_render_dark_channel'
	);
	add_action( 'load-' . $hook, 'fourliberty_hub_dark_channel_maybe_save' );
	add_action( 'admin_enqueue_scripts', function ( $screen_hook ) use ( $hook ) {
		if ( $screen_hook !== $hook ) {
			return;
		}
		$src  = FOURLIBERTY_HUB_URL . 'assets/js/admin-dark-channel.js';
		$path = FOURLIBERTY_HUB_PATH . 'assets/js/admin-dark-channel.js';
		wp_enqueue_script( 'fourliberty-hub-admin-dark-channel', $src, array(), file_exists( $path ) ? filemtime( $path ) : FOURLIBERTY_HUB_VERSION, true );
	} );
}
add_action( 'admin_menu', 'fourliberty_hub_register_dark_channel_menu' );

function fourliberty_hub_dark_channel_config() {
	if ( function_exists( 'fourliberty_dark_channel_config' ) ) {
		return fourliberty_dark_channel_config();
	}
	return array( 'playlist' => array(), 'ads' => array(), 'adCadence' => array( 'mode' => 'every_n_items', 'n' => 4, 'm' => 20 ) );
}

/**
 * Handles the settings form POST on load-{hook}, before any HTML output, so
 * it can redirect after saving (avoids a resubmission prompt on refresh).
 */
function fourliberty_hub_dark_channel_maybe_save() {
	if ( ! isset( $_POST['fourliberty_hub_dark_channel_save'] ) ) {
		return;
	}
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'You do not have permission to do that.', 'fourliberty-hub' ) );
	}
	check_admin_referer( 'fourliberty_hub_dark_channel_save', 'fourliberty_hub_dark_channel_nonce' );

	// Numeric-indexed arrays (fourliberty_playlist[], fourliberty_ads[]) —
	// no separate "order" field needed: browsers submit form fields in DOM
	// order, and dragging a row in admin-dark-channel.js physically moves
	// the DOM node, so submission order already IS the saved order.
	$playlist_raw = isset( $_POST['fourliberty_playlist'] ) && is_array( $_POST['fourliberty_playlist'] ) ? wp_unslash( $_POST['fourliberty_playlist'] ) : array();
	$ads_raw      = isset( $_POST['fourliberty_ads'] ) && is_array( $_POST['fourliberty_ads'] ) ? wp_unslash( $_POST['fourliberty_ads'] ) : array();

	$valid_types = array( 'youtube', 'rumble', 'post' );
	$playlist    = array();
	foreach ( $playlist_raw as $row ) {
		$type = in_array( $row['type'] ?? '', $valid_types, true ) ? $row['type'] : 'youtube';
		$title = sanitize_text_field( $row['title'] ?? '' );
		$duration = max( 1, absint( $row['duration_seconds'] ?? 0 ) );

		if ( 'post' === $type ) {
			$post_id = absint( $row['post_id'] ?? 0 );
			if ( ! $post_id || 'publish' !== get_post_status( $post_id ) ) {
				continue; // skip rows pointing at a since-deleted/unpublished post rather than saving a broken item
			}
			$source_id = $post_id;
			if ( ! $title ) {
				$title = get_the_title( $post_id );
			}
			$thumbnail = get_the_post_thumbnail_url( $post_id, 'large' ) ?: '';
			$url       = get_permalink( $post_id ) ?: '';
		} else {
			$source_id = preg_replace( '/[^A-Za-z0-9_\-.]/', '', (string) ( $row['source_id'] ?? '' ) );
			if ( ! $source_id || ! $title ) {
				continue; // an item with no video ID or no title can't play or can't be labeled — skip rather than save junk
			}
			$thumbnail = empty( $row['thumbnail'] ) ? '' : esc_url_raw( $row['thumbnail'] );
			$url       = '';
		}

		$playlist[] = array(
			'type'             => $type,
			'source_id'        => $source_id,
			'title'            => $title,
			'duration_seconds' => $duration,
			'thumbnail'        => $thumbnail,
			'url'              => $url,
		);
	}

	$ads = array();
	foreach ( $ads_raw as $row ) {
		$source_id = preg_replace( '/[^A-Za-z0-9_\-.]/', '', (string) ( $row['source_id'] ?? '' ) );
		if ( ! $source_id ) {
			continue;
		}
		$ads[] = array(
			'source_id' => $source_id,
			'title'     => sanitize_text_field( $row['title'] ?? '' ),
		);
	}

	$cadence_mode = ( 'every_m_minutes' === ( $_POST['fourliberty_cadence_mode'] ?? '' ) ) ? 'every_m_minutes' : 'every_n_items';
	$cadence      = array(
		'mode' => $cadence_mode,
		'n'    => max( 1, absint( $_POST['fourliberty_cadence_n'] ?? 4 ) ),
		'm'    => max( 1, absint( $_POST['fourliberty_cadence_m'] ?? 20 ) ),
	);

	update_option(
		FOURLIBERTY_HUB_DARK_CHANNEL_OPTION,
		array( 'playlist' => $playlist, 'ads' => $ads, 'adCadence' => $cadence )
	);

	wp_safe_redirect( add_query_arg( 'fourliberty_saved', '1', wp_get_referer() ?: admin_url( 'admin.php?page=fourliberty-hub-dark-channel' ) ) );
	exit;
}

function fourliberty_hub_render_dark_channel() {
	$config   = fourliberty_hub_dark_channel_config();
	$playlist = isset( $config['playlist'] ) && is_array( $config['playlist'] ) ? $config['playlist'] : array();
	$ads      = isset( $config['ads'] ) && is_array( $config['ads'] ) ? $config['ads'] : array();
	$cadence  = isset( $config['adCadence'] ) && is_array( $config['adCadence'] ) ? $config['adCadence'] : array();
	$mode     = ( 'every_m_minutes' === ( $cadence['mode'] ?? '' ) ) ? 'every_m_minutes' : 'every_n_items';
	$n        = $cadence['n'] ?? 4;
	$m        = $cadence['m'] ?? 20;

	$recent_posts = get_posts( array(
		'numberposts' => 200,
		'post_status' => 'publish',
		'orderby'     => 'date',
		'order'       => 'DESC',
	) );
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'Dark Channel', 'fourliberty-hub' ); ?></h1>
		<p><?php esc_html_e( 'This plays on the homepage whenever no show is live — like a real channel, everyone tuning in at the same moment sees the same thing. Add YouTube videos, Rumble videos, or blog posts below; drag to set the order.', 'fourliberty-hub' ); ?></p>

		<?php if ( isset( $_GET['fourliberty_saved'] ) ) : ?>
			<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Saved.', 'fourliberty-hub' ); ?></p></div>
		<?php endif; ?>

		<form method="post" id="fourliberty-dark-channel-form">
			<?php wp_nonce_field( 'fourliberty_hub_dark_channel_save', 'fourliberty_hub_dark_channel_nonce' ); ?>

			<h2><?php esc_html_e( 'Playlist', 'fourliberty-hub' ); ?></h2>
			<p style="color:#646970;max-width:700px;"><?php esc_html_e( 'Every item needs a length (hours/minutes/seconds — set whatever fits: a few seconds, a few hours, anything). The channel schedule runs off the clock, not who’s watching, so it needs to know roughly how long each item runs — same idea as a real TV network’s log. This is a safety net, not a hard cutoff: a video that\'s still playing when it naturally ends always gets to finish and hand off cleanly to the next item. For YouTube, the real length fills in automatically once you enter a video ID — you only need to type a length by hand for Rumble videos and blog posts, or if you want to run just a clip instead of the whole thing.', 'fourliberty-hub' ); ?></p>

			<div id="fourliberty-playlist-rows">
				<?php foreach ( $playlist as $i => $item ) : ?>
					<?php echo fourliberty_hub_render_playlist_row( $item, $recent_posts ); // phpcs:ignore WordPress.Security.EscapeOutput -- escaped inside the row renderer ?>
				<?php endforeach; ?>
			</div>
			<button type="button" class="button" id="fourliberty-add-playlist-item"><?php esc_html_e( '+ Add item', 'fourliberty-hub' ); ?></button>

			<template id="fourliberty-playlist-row-template">
				<?php echo fourliberty_hub_render_playlist_row( array(), $recent_posts ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
			</template>

			<h2 style="margin-top:32px;"><?php esc_html_e( 'Ad breaks', 'fourliberty-hub' ); ?></h2>
			<p style="color:#646970;max-width:700px;"><?php esc_html_e( 'Ads are always YouTube-hosted. Pick how often they play, then list the videos to rotate through.', 'fourliberty-hub' ); ?></p>

			<div style="background:#fff;border:1px solid #dcdcde;border-radius:4px;padding:14px 16px;max-width:520px;margin-bottom:16px;">
				<label style="display:block;margin-bottom:8px;">
					<input type="radio" name="fourliberty_cadence_mode" value="every_n_items" <?php checked( 'every_n_items', $mode ); ?> />
					<?php esc_html_e( 'Every', 'fourliberty-hub' ); ?>
					<input type="number" min="1" name="fourliberty_cadence_n" value="<?php echo esc_attr( $n ); ?>" style="width:64px;" />
					<?php esc_html_e( 'items', 'fourliberty-hub' ); ?>
				</label>
				<label style="display:block;">
					<input type="radio" name="fourliberty_cadence_mode" value="every_m_minutes" <?php checked( 'every_m_minutes', $mode ); ?> />
					<?php esc_html_e( 'Every', 'fourliberty-hub' ); ?>
					<input type="number" min="1" name="fourliberty_cadence_m" value="<?php echo esc_attr( $m ); ?>" style="width:64px;" />
					<?php esc_html_e( 'minutes', 'fourliberty-hub' ); ?>
				</label>
			</div>

			<div id="fourliberty-ads-rows">
				<?php foreach ( $ads as $ad ) : ?>
					<?php echo fourliberty_hub_render_ad_row( $ad ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
				<?php endforeach; ?>
			</div>
			<button type="button" class="button" id="fourliberty-add-ad"><?php esc_html_e( '+ Add ad video', 'fourliberty-hub' ); ?></button>

			<template id="fourliberty-ad-row-template">
				<?php echo fourliberty_hub_render_ad_row( array() ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
			</template>

			<p class="submit" style="margin-top:24px;">
				<button type="submit" name="fourliberty_hub_dark_channel_save" value="1" class="button button-primary"><?php esc_html_e( 'Save Dark Channel', 'fourliberty-hub' ); ?></button>
			</p>
		</form>
	</div>
	<?php
}

/**
 * Renders one playlist-item row. Used both for existing saved items and (as
 * an empty item inside a <template>) as the clone source for "+ Add item" —
 * admin-dark-channel.js clones the template and shows/hides the Video ID vs.
 * Blog post field based on the Type dropdown.
 */
function fourliberty_hub_render_playlist_row( $item, $recent_posts ) {
	$type      = $item['type'] ?? 'youtube';
	$source_id = $item['source_id'] ?? '';
	$title     = $item['title'] ?? '';
	$duration  = (int) ( $item['duration_seconds'] ?? 0 );
	$thumbnail = $item['thumbnail'] ?? '';
	$post_id   = 'post' === $type ? (int) $source_id : 0;
	$hh        = (int) floor( $duration / 3600 );
	$mm        = (int) floor( ( $duration % 3600 ) / 60 );
	$ss        = $duration % 60;
	ob_start();
	?>
	<div class="fl-hub-row" draggable="true" data-type="<?php echo esc_attr( $type ); ?>" style="background:#fff;border:1px solid #dcdcde;border-radius:4px;margin-bottom:10px;padding:14px 16px;">
		<div style="display:flex;align-items:flex-start;gap:12px;">
			<span class="dashicons dashicons-move fl-hub-drag-handle" title="<?php esc_attr_e( 'Drag to reorder', 'fourliberty-hub' ); ?>" style="cursor:grab;color:#a7aaad;margin-top:6px;"></span>
			<div style="flex:1;min-width:0;">
				<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px;align-items:center;">
					<label style="font-size:12px;">
						<?php esc_html_e( 'Type', 'fourliberty-hub' ); ?>
						<select name="fourliberty_playlist[][type]" class="fl-hub-type-select">
							<option value="youtube" <?php selected( $type, 'youtube' ); ?>><?php esc_html_e( 'YouTube video', 'fourliberty-hub' ); ?></option>
							<option value="rumble" <?php selected( $type, 'rumble' ); ?>><?php esc_html_e( 'Rumble video', 'fourliberty-hub' ); ?></option>
							<option value="post" <?php selected( $type, 'post' ); ?>><?php esc_html_e( 'Blog post', 'fourliberty-hub' ); ?></option>
						</select>
					</label>
					<label class="fl-hub-field-video" style="font-size:12px;<?php echo 'post' === $type ? 'display:none;' : ''; ?>">
						<?php esc_html_e( 'Video ID', 'fourliberty-hub' ); ?>
						<input type="text" name="fourliberty_playlist[][source_id]" value="<?php echo esc_attr( 'post' === $type ? '' : $source_id ); ?>" placeholder="<?php esc_attr_e( 'e.g. dQw4w9WgXcQ', 'fourliberty-hub' ); ?>" />
					</label>
					<label class="fl-hub-field-post" style="font-size:12px;<?php echo 'post' !== $type ? 'display:none;' : ''; ?>">
						<?php esc_html_e( 'Blog post', 'fourliberty-hub' ); ?>
						<select name="fourliberty_playlist[][post_id]">
							<option value=""><?php esc_html_e( '— choose —', 'fourliberty-hub' ); ?></option>
							<?php foreach ( $recent_posts as $p ) : ?>
								<option
									value="<?php echo esc_attr( $p->ID ); ?>"
									<?php selected( $post_id, $p->ID ); ?>
									data-title="<?php echo esc_attr( get_the_title( $p ) ); ?>"
								><?php echo esc_html( get_the_title( $p ) ); ?></option>
							<?php endforeach; ?>
						</select>
					</label>
					<div class="fl-hub-duration" style="font-size:12px;">
						<?php esc_html_e( 'Duration', 'fourliberty-hub' ); ?>
						<span style="display:inline-flex;gap:3px;align-items:center;">
							<input type="number" min="0" class="fl-hub-hh" value="<?php echo esc_attr( $hh ); ?>" style="width:48px;" title="<?php esc_attr_e( 'Hours', 'fourliberty-hub' ); ?>" /><span style="color:#a7aaad;">h</span>
							<input type="number" min="0" max="59" class="fl-hub-mm" value="<?php echo esc_attr( $mm ); ?>" style="width:48px;" title="<?php esc_attr_e( 'Minutes', 'fourliberty-hub' ); ?>" /><span style="color:#a7aaad;">m</span>
							<input type="number" min="0" max="59" class="fl-hub-ss" value="<?php echo esc_attr( $ss ); ?>" style="width:48px;" title="<?php esc_attr_e( 'Seconds', 'fourliberty-hub' ); ?>" /><span style="color:#a7aaad;">s</span>
						</span>
						<input type="hidden" name="fourliberty_playlist[][duration_seconds]" class="fl-hub-duration-total" value="<?php echo esc_attr( $duration ); ?>" />
						<span class="fl-hub-duration__hint" style="color:#646970;margin-left:4px;"></span>
					</div>
					<button type="button" class="button-link-delete fl-hub-remove-row" style="margin-left:auto;color:#b32d2e;"><?php esc_html_e( 'Remove', 'fourliberty-hub' ); ?></button>
				</div>
				<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;max-width:640px;">
					<label style="font-size:12px;">
						<?php esc_html_e( 'Title', 'fourliberty-hub' ); ?>
						<input type="text" class="regular-text" style="width:100%;" name="fourliberty_playlist[][title]" value="<?php echo esc_attr( $title ); ?>" required />
					</label>
					<label class="fl-hub-field-video" style="font-size:12px;<?php echo 'post' === $type ? 'display:none;' : ''; ?>">
						<?php esc_html_e( 'Thumbnail URL (optional — YouTube fills this in automatically)', 'fourliberty-hub' ); ?>
						<input type="url" class="regular-text" style="width:100%;" name="fourliberty_playlist[][thumbnail]" value="<?php echo esc_attr( $thumbnail ); ?>" />
					</label>
				</div>
			</div>
		</div>
	</div>
	<?php
	return ob_get_clean();
}

function fourliberty_hub_render_ad_row( $ad ) {
	$source_id = $ad['source_id'] ?? '';
	$title     = $ad['title'] ?? '';
	ob_start();
	?>
	<div class="fl-hub-row" style="background:#fff;border:1px solid #dcdcde;border-radius:4px;margin-bottom:8px;padding:10px 14px;display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
		<label style="font-size:12px;">
			<?php esc_html_e( 'YouTube video ID', 'fourliberty-hub' ); ?>
			<input type="text" name="fourliberty_ads[][source_id]" value="<?php echo esc_attr( $source_id ); ?>" placeholder="<?php esc_attr_e( 'e.g. dQw4w9WgXcQ', 'fourliberty-hub' ); ?>" />
		</label>
		<label style="font-size:12px;flex:1;min-width:180px;">
			<?php esc_html_e( 'Label (for your reference only)', 'fourliberty-hub' ); ?>
			<input type="text" class="regular-text" style="width:100%;" name="fourliberty_ads[][title]" value="<?php echo esc_attr( $title ); ?>" />
		</label>
		<button type="button" class="button-link-delete fl-hub-remove-row" style="color:#b32d2e;"><?php esc_html_e( 'Remove', 'fourliberty-hub' ); ?></button>
	</div>
	<?php
	return ob_get_clean();
}
