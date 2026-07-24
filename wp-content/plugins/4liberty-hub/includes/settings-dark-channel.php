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
		wp_enqueue_media(); // image-ad picker (same as the Shop Ad screen)
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

	$valid_types = array( 'youtube', 'rumble', 'post', 'image' );
	$playlist    = array();
	// Counts rows dropped below so the admin notice can say so (2026-07-23) —
	// these used to vanish with zero feedback beyond a generic "Saved.",
	// which is exactly what happened to Austin's first real attempt: a
	// title with no video ID passed the (then-missing) client-side
	// validation, submitted, and silently disappeared here.
	$dropped = 0;
	foreach ( $playlist_raw as $row ) {
		$type = in_array( $row['type'] ?? '', $valid_types, true ) ? $row['type'] : 'youtube';
		$title = sanitize_text_field( $row['title'] ?? '' );
		$duration = max( 1, absint( $row['duration_seconds'] ?? 0 ) );

		if ( 'post' === $type ) {
			$post_id = absint( $row['post_id'] ?? 0 );
			if ( ! $post_id || 'publish' !== get_post_status( $post_id ) ) {
				$dropped++; // points at a since-deleted/unpublished post — can't save a broken item
				continue;
			}
			$source_id = $post_id;
			if ( ! $title ) {
				$title = get_the_title( $post_id );
			}
			$thumbnail = get_the_post_thumbnail_url( $post_id, 'large' ) ?: '';
			$url       = get_permalink( $post_id ) ?: '';
		} elseif ( 'image' === $type ) {
			// Image ad (2026-07-23) — a picture that links somewhere. Reuses
			// the existing item shape rather than new keys: `thumbnail` holds
			// the image the slider shows, `url` its click destination. No
			// video id and no per-item duration (the global slide interval
			// governs how long an ad shows); the label/title is optional,
			// purely for Austin's own reference in the list.
			$image = empty( $row['image_url'] ) ? '' : esc_url_raw( $row['image_url'] );
			if ( ! $image ) {
				$dropped++; // an image ad with no image can't render
				continue;
			}
			$source_id = '';
			$thumbnail = $image;
			$url       = empty( $row['link_url'] ) ? '' : esc_url_raw( $row['link_url'] );
		} else {
			$source_id = preg_replace( '/[^A-Za-z0-9_\-.]/', '', (string) ( $row['source_id'] ?? '' ) );
			if ( ! $source_id || ! $title ) {
				$dropped++; // no video ID or no title — can't play it or label it
				continue;
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

	// Slider display settings (2026-07-23) — 'slide' auto-rotates through the
	// items on a timer, 'static' shows one at a time with the arrows only.
	// Interval bounded to a sane 3–120s so a typo can't freeze the rotation
	// for an hour or flip slides faster than they can render.
	$display_mode   = ( 'static' === ( $_POST['fourliberty_display_mode'] ?? '' ) ) ? 'static' : 'slide';
	$slide_interval = min( 120, max( 3, absint( $_POST['fourliberty_slide_interval'] ?? 8 ) ) );
	$display        = array( 'mode' => $display_mode, 'intervalSeconds' => $slide_interval );

	update_option(
		FOURLIBERTY_HUB_DARK_CHANNEL_OPTION,
		array( 'playlist' => $playlist, 'ads' => $ads, 'adCadence' => $cadence, 'display' => $display )
	);

	$redirect_args = array( 'fourliberty_saved' => '1' );
	if ( $dropped > 0 ) {
		$redirect_args['fourliberty_dropped'] = $dropped;
	}
	wp_safe_redirect( add_query_arg( $redirect_args, wp_get_referer() ?: admin_url( 'admin.php?page=fourliberty-hub-dark-channel' ) ) );
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

	$display        = isset( $config['display'] ) && is_array( $config['display'] ) ? $config['display'] : array();
	$display_mode   = ( 'static' === ( $display['mode'] ?? '' ) ) ? 'static' : 'slide';
	$slide_interval = (int) ( $display['intervalSeconds'] ?? 8 );

	$recent_posts = get_posts( array(
		'numberposts' => 200,
		'post_status' => 'publish',
		'orderby'     => 'date',
		'order'       => 'DESC',
	) );
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'Dark Channel', 'fourliberty-hub' ); ?></h1>
		<p><?php esc_html_e( 'This plays on the homepage whenever no show is live — like a real channel, it can auto-rotate through your content like a slideshow, or hold on one slide. Add YouTube videos, Rumble videos, blog posts, or image ads below; drag to set the order. Clicking a slide plays the video, opens the blog, or follows the ad link.', 'fourliberty-hub' ); ?></p>

		<?php if ( isset( $_GET['fourliberty_saved'] ) ) : ?>
			<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Saved.', 'fourliberty-hub' ); ?></p></div>
		<?php endif; ?>
		<?php if ( ! empty( $_GET['fourliberty_dropped'] ) ) : ?>
			<div class="notice notice-warning is-dismissible">
				<p>
					<?php
					printf(
						/* translators: %d: number of playlist rows that couldn't be saved */
						esc_html( _n(
							'%d item wasn\'t saved — it was missing a title or a video ID/blog post. Check the list below and re-add it.',
							'%d items weren\'t saved — each was missing a title or a video ID/blog post. Check the list below and re-add them.',
							(int) $_GET['fourliberty_dropped'],
							'fourliberty-hub'
						) ),
						(int) $_GET['fourliberty_dropped']
					);
					?>
				</p>
			</div>
		<?php endif; ?>

		<form method="post" id="fourliberty-dark-channel-form">
			<?php wp_nonce_field( 'fourliberty_hub_dark_channel_save', 'fourliberty_hub_dark_channel_nonce' ); ?>

			<h2><?php esc_html_e( 'How it plays', 'fourliberty-hub' ); ?></h2>
			<div style="background:#fff;border:1px solid #dcdcde;border-radius:4px;padding:14px 16px;max-width:560px;margin-bottom:20px;">
				<label style="display:block;margin-bottom:10px;">
					<input type="radio" name="fourliberty_display_mode" value="slide" <?php checked( 'slide', $display_mode ); ?> />
					<strong><?php esc_html_e( 'Slide', 'fourliberty-hub' ); ?></strong>
					— <?php esc_html_e( 'auto-rotates through the items on a timer. Clicking one stops it and plays/opens that item.', 'fourliberty-hub' ); ?>
				</label>
				<label style="display:block;margin-bottom:12px;">
					<input type="radio" name="fourliberty_display_mode" value="static" <?php checked( 'static', $display_mode ); ?> />
					<strong><?php esc_html_e( 'Static', 'fourliberty-hub' ); ?></strong>
					— <?php esc_html_e( 'holds on one item at a time. Visitors move through with the arrows and click to play.', 'fourliberty-hub' ); ?>
				</label>
				<label style="display:block;">
					<?php esc_html_e( 'Seconds per slide', 'fourliberty-hub' ); ?>
					<input type="number" min="3" max="120" name="fourliberty_slide_interval" value="<?php echo esc_attr( $slide_interval ); ?>" style="width:70px;" />
					<span style="color:#646970;font-size:12px;"><?php esc_html_e( '(Slide mode only)', 'fourliberty-hub' ); ?></span>
				</label>
			</div>

			<h2><?php esc_html_e( 'Playlist', 'fourliberty-hub' ); ?></h2>
			<p style="color:#646970;max-width:700px;"><?php esc_html_e( 'Every item needs a length (hours/minutes/seconds — set whatever fits: a few seconds, a few hours, anything). The channel schedule runs off the clock, not who’s watching, so it needs to know roughly how long each item runs — same idea as a real TV network’s log. This is a safety net, not a hard cutoff: a video that\'s still playing when it naturally ends always gets to finish and hand off cleanly to the next item. For YouTube, the real length fills in automatically once you enter a video ID — you only need to type a length by hand for Rumble videos, or to run just a clip. Blog posts and image ads have no length — the slide timer controls how long they show.', 'fourliberty-hub' ); ?></p>

			<div id="fourliberty-playlist-rows">
				<?php foreach ( $playlist as $i => $item ) : ?>
					<?php echo fourliberty_hub_render_playlist_row( $item, $recent_posts, $i ); // phpcs:ignore WordPress.Security.EscapeOutput -- escaped inside the row renderer ?>
				<?php endforeach; ?>
			</div>
			<button type="button" class="button" id="fourliberty-add-playlist-item"><?php esc_html_e( '+ Add item', 'fourliberty-hub' ); ?></button>

			<template id="fourliberty-playlist-row-template">
				<?php echo fourliberty_hub_render_playlist_row( array(), $recent_posts, '__INDEX__' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
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
				<?php foreach ( $ads as $i => $ad ) : ?>
					<?php echo fourliberty_hub_render_ad_row( $ad, $i ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
				<?php endforeach; ?>
			</div>
			<button type="button" class="button" id="fourliberty-add-ad"><?php esc_html_e( '+ Add ad video', 'fourliberty-hub' ); ?></button>

			<template id="fourliberty-ad-row-template">
				<?php echo fourliberty_hub_render_ad_row( array(), '__INDEX__' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
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
 *
 * $index becomes each field's explicit array key — fourliberty_playlist[
 * $index][type], [$index][source_id], etc. (2026-07-23; previously empty
 * brackets, fourliberty_playlist[][type], which is the actual reason a
 * saved item could vanish entirely: PHP assigns EACH distinct bracket path
 * its OWN next-available index, so five same-row fields submitted as
 * fourliberty_playlist[][fieldname] land in five SEPARATE array elements —
 * 0:{type}, 1:{source_id}, 2:{title}, 3:{duration_seconds}, 4:{thumbnail} —
 * not one element with all five keys. Every one of those five then fails
 * the "has both a title and a video ID" check below and gets dropped,
 * regardless of what Austin actually filled in. A real, per-row index fixes
 * that at the source; existing rows use their array position, the
 * <template> clone source uses the '__INDEX__' placeholder
 * admin-dark-channel.js substitutes with a fresh one on each clone.
 */
function fourliberty_hub_render_playlist_row( $item, $recent_posts, $index ) {
	$type      = $item['type'] ?? 'youtube';
	$source_id = $item['source_id'] ?? '';
	$title     = $item['title'] ?? '';
	$duration  = (int) ( $item['duration_seconds'] ?? 0 );
	$thumbnail = $item['thumbnail'] ?? '';
	$url       = $item['url'] ?? '';
	$post_id   = 'post' === $type ? (int) $source_id : 0;
	// Image ads reuse thumbnail/url as image/link (see the save handler) —
	// unpack them into their own vars so the fields below stay readable.
	$image_url = 'image' === $type ? $thumbnail : '';
	$link_url  = 'image' === $type ? $url : '';
	// Which conditional field groups this type shows — kept as flags so the
	// initial server-rendered display matches what admin-dark-channel.js's
	// type-change handler toggles to (video/post/image/duration).
	$is_video    = in_array( $type, array( 'youtube', 'rumble' ), true );
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
						<select name="fourliberty_playlist[<?php echo esc_attr( $index ); ?>][type]" class="fl-hub-type-select">
							<option value="youtube" <?php selected( $type, 'youtube' ); ?>><?php esc_html_e( 'YouTube video', 'fourliberty-hub' ); ?></option>
							<option value="rumble" <?php selected( $type, 'rumble' ); ?>><?php esc_html_e( 'Rumble video', 'fourliberty-hub' ); ?></option>
							<option value="post" <?php selected( $type, 'post' ); ?>><?php esc_html_e( 'Blog post', 'fourliberty-hub' ); ?></option>
							<option value="image" <?php selected( $type, 'image' ); ?>><?php esc_html_e( 'Image ad', 'fourliberty-hub' ); ?></option>
						</select>
					</label>
					<label class="fl-hub-field-video" style="font-size:12px;<?php echo $is_video ? '' : 'display:none;'; ?>">
						<?php esc_html_e( 'Video ID or URL', 'fourliberty-hub' ); ?>
						<?php /* Deliberately no `required` here (2026-07-23, reverted same-day fix):
						   Chrome has a real edge case where a hidden required field can still
						   block submission while logging "is not focusable" to the console,
						   with zero visible sign anything happened — that's the actual cause
						   of Austin's save silently doing nothing, not this plugin's PHP/JS.
						   The server-side check below (see $dropped) already catches a missing
						   video ID with a real, visible warning notice, so client-side
						   `required` was redundant risk for no benefit — removed rather than
						   chase which hidden-field combination triggers the browser bug. */ ?>
						<input type="text" name="fourliberty_playlist[<?php echo esc_attr( $index ); ?>][source_id]" value="<?php echo esc_attr( $is_video ? $source_id : '' ); ?>" placeholder="<?php esc_attr_e( 'Paste a YouTube/Rumble link, or just the video ID', 'fourliberty-hub' ); ?>" />
					</label>
					<label class="fl-hub-field-post" style="font-size:12px;<?php echo 'post' !== $type ? 'display:none;' : ''; ?>">
						<?php esc_html_e( 'Blog post', 'fourliberty-hub' ); ?>
						<select name="fourliberty_playlist[<?php echo esc_attr( $index ); ?>][post_id]">
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
					<?php /* Image-ad fields (2026-07-23) — an uploaded image + a link it
					   opens on click. Shown only for the "Image ad" type;
					   admin-dark-channel.js wires the Choose-image button to the WP
					   media library (same as the Shop Ad screen) and toggles this
					   group with the Type dropdown. */ ?>
					<label class="fl-hub-field-image" style="font-size:12px;<?php echo 'image' === $type ? '' : 'display:none;'; ?>">
						<?php esc_html_e( 'Ad image', 'fourliberty-hub' ); ?>
						<span style="display:flex;align-items:center;gap:8px;">
							<span class="fl-hub-image-preview" style="width:80px;height:45px;border-radius:4px;border:1px solid #dcdcde;background:#f0f0f1 center/cover no-repeat;<?php echo $image_url ? 'background-image:url(' . esc_url( $image_url ) . ');' : ''; ?>"></span>
							<input type="hidden" class="fl-hub-image-url" name="fourliberty_playlist[<?php echo esc_attr( $index ); ?>][image_url]" value="<?php echo esc_attr( $image_url ); ?>" />
							<button type="button" class="button fl-hub-choose-image"><?php esc_html_e( 'Choose image', 'fourliberty-hub' ); ?></button>
						</span>
					</label>
					<label class="fl-hub-field-image" style="font-size:12px;<?php echo 'image' === $type ? '' : 'display:none;'; ?>">
						<?php esc_html_e( 'Links to', 'fourliberty-hub' ); ?>
						<input type="url" class="regular-text" style="width:220px;" name="fourliberty_playlist[<?php echo esc_attr( $index ); ?>][link_url]" value="<?php echo esc_attr( $link_url ); ?>" placeholder="https://4libertyshop.com" />
					</label>
					<div class="fl-hub-duration fl-hub-field-duration" style="font-size:12px;<?php echo $is_video ? '' : 'display:none;'; ?>">
						<?php esc_html_e( 'Duration', 'fourliberty-hub' ); ?>
						<span style="display:inline-flex;gap:3px;align-items:center;">
							<input type="number" min="0" class="fl-hub-hh" value="<?php echo esc_attr( $hh ); ?>" style="width:48px;" title="<?php esc_attr_e( 'Hours', 'fourliberty-hub' ); ?>" /><span style="color:#a7aaad;">h</span>
							<input type="number" min="0" max="59" class="fl-hub-mm" value="<?php echo esc_attr( $mm ); ?>" style="width:48px;" title="<?php esc_attr_e( 'Minutes', 'fourliberty-hub' ); ?>" /><span style="color:#a7aaad;">m</span>
							<input type="number" min="0" max="59" class="fl-hub-ss" value="<?php echo esc_attr( $ss ); ?>" style="width:48px;" title="<?php esc_attr_e( 'Seconds', 'fourliberty-hub' ); ?>" /><span style="color:#a7aaad;">s</span>
						</span>
						<input type="hidden" name="fourliberty_playlist[<?php echo esc_attr( $index ); ?>][duration_seconds]" class="fl-hub-duration-total" value="<?php echo esc_attr( $duration ); ?>" />
						<span class="fl-hub-duration__hint" style="color:#646970;margin-left:4px;"></span>
					</div>
					<button type="button" class="button-link-delete fl-hub-remove-row" style="margin-left:auto;color:#b32d2e;"><?php esc_html_e( 'Remove', 'fourliberty-hub' ); ?></button>
				</div>
				<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;max-width:640px;">
					<label style="font-size:12px;">
						<?php esc_html_e( 'Title', 'fourliberty-hub' ); ?>
						<input type="text" class="regular-text" style="width:100%;" name="fourliberty_playlist[<?php echo esc_attr( $index ); ?>][title]" value="<?php echo esc_attr( $title ); ?>" />
					</label>
					<label class="fl-hub-field-video" style="font-size:12px;<?php echo $is_video ? '' : 'display:none;'; ?>">
						<?php esc_html_e( 'Thumbnail URL (YouTube fills this in automatically — for Rumble, paste one yourself or the slide shows a plain background)', 'fourliberty-hub' ); ?>
						<input type="url" class="regular-text" style="width:100%;" name="fourliberty_playlist[<?php echo esc_attr( $index ); ?>][thumbnail]" value="<?php echo esc_attr( $is_video ? $thumbnail : '' ); ?>" />
					</label>
				</div>
			</div>
		</div>
	</div>
	<?php
	return ob_get_clean();
}

/**
 * Same explicit-index fix as fourliberty_hub_render_playlist_row() above,
 * and for the identical reason: fourliberty_ads[][source_id] +
 * fourliberty_ads[][title] used to land in two separate array elements
 * instead of one row with both fields.
 */
function fourliberty_hub_render_ad_row( $ad, $index ) {
	$source_id = $ad['source_id'] ?? '';
	$title     = $ad['title'] ?? '';
	ob_start();
	?>
	<div class="fl-hub-row" style="background:#fff;border:1px solid #dcdcde;border-radius:4px;margin-bottom:8px;padding:10px 14px;display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
		<label class="fl-hub-ad-video" style="font-size:12px;">
			<?php esc_html_e( 'YouTube video ID or URL', 'fourliberty-hub' ); ?>
			<input type="text" name="fourliberty_ads[<?php echo esc_attr( $index ); ?>][source_id]" value="<?php echo esc_attr( $source_id ); ?>" placeholder="<?php esc_attr_e( 'Paste a YouTube link, or just the video ID', 'fourliberty-hub' ); ?>" />
		</label>
		<label style="font-size:12px;flex:1;min-width:180px;">
			<?php esc_html_e( 'Label (for your reference only)', 'fourliberty-hub' ); ?>
			<input type="text" class="regular-text" style="width:100%;" name="fourliberty_ads[<?php echo esc_attr( $index ); ?>][title]" value="<?php echo esc_attr( $title ); ?>" />
		</label>
		<button type="button" class="button-link-delete fl-hub-remove-row" style="color:#b32d2e;"><?php esc_html_e( 'Remove', 'fourliberty-hub' ); ?></button>
	</div>
	<?php
	return ob_get_clean();
}
