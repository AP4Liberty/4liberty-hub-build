<?php
/**
 * Live Shows settings — Phase 2, task E.
 *
 * Lets Austin (non-technical) control, per Rumble channel: its display name,
 * hero-priority order (drag to reorder), whether it's included in the
 * homepage live rotation at all, and the members-only ("gated") broadcast
 * detection this channel uses (Decision 8, revised, in PHASE-2-BUILD-PLAN.md).
 *
 * This page never asks for or stores a Rumble API URL/key — those live only
 * in Netlify environment variables (the security rule PHASE-2-BUILD-PLAN.md
 * is built around). It only ever displays the *name* of the env var a
 * channel is wired to, for Austin's reference.
 *
 * Writes to the same `fourliberty_live_shows_config` option the theme's
 * `fourliberty_live_shows_config()` (functions.php) already reads — that
 * seam was built in task D specifically so this panel could start writing to
 * it without any theme change.
 *
 * @package fourliberty-hub
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const FOURLIBERTY_HUB_LIVE_SHOWS_OPTION = 'fourliberty_live_shows_config';

function fourliberty_hub_register_live_shows_menu() {
	$hook = add_submenu_page(
		'fourliberty-hub',
		__( 'Live Shows', 'fourliberty-hub' ),
		__( 'Live Shows', 'fourliberty-hub' ),
		'manage_options',
		'fourliberty-hub-live-shows',
		'fourliberty_hub_render_live_shows'
	);
	add_action( 'load-' . $hook, 'fourliberty_hub_live_shows_maybe_save' );
	add_action( 'admin_enqueue_scripts', function ( $screen_hook ) use ( $hook ) {
		if ( $screen_hook !== $hook ) {
			return;
		}
		$src = FOURLIBERTY_HUB_URL . 'assets/js/admin-live-shows.js';
		$path = FOURLIBERTY_HUB_PATH . 'assets/js/admin-live-shows.js';
		wp_enqueue_script( 'fourliberty-hub-admin-live-shows', $src, array(), file_exists( $path ) ? filemtime( $path ) : FOURLIBERTY_HUB_VERSION, true );
	} );
}
add_action( 'admin_menu', 'fourliberty_hub_register_live_shows_menu' );

/**
 * The stored config, merged with the theme's defaults — same shape the
 * theme's live-state.js consumes: { order: [key,...], shows: { key: {...} } }.
 * Falls back to a minimal empty shape if the theme (which owns the defaults)
 * isn't active for some reason, so this screen never fatals.
 */
function fourliberty_hub_live_shows_config() {
	if ( function_exists( 'fourliberty_live_shows_config' ) ) {
		return fourliberty_live_shows_config();
	}
	return array( 'order' => array(), 'shows' => array() );
}

/**
 * The Netlify poller's public endpoint — reuses the theme's constant/function
 * if available (same site, same source of truth), else the known default.
 */
function fourliberty_hub_live_state_endpoint() {
	if ( function_exists( 'fourliberty_live_state_endpoint' ) ) {
		return fourliberty_live_state_endpoint();
	}
	return 'https://4liberty-poller.netlify.app/api/live-state';
}

/**
 * Fetches the poller's public payload server-side, so this screen can
 * auto-discover channel keys (Decision 3: new shows appear here with zero
 * code changes) and show Austin a plain-language "is it working?" status.
 * Cached briefly so opening/reloading this screen doesn't hammer the
 * endpoint beyond what the poller itself already refreshes at (30s
 * Cache-Control on the endpoint itself).
 *
 * Returns array{ ok: bool, payload: array|null, error: string|null }.
 */
function fourliberty_hub_fetch_live_payload() {
	$cache_key = 'fourliberty_hub_live_payload';
	$cached    = get_transient( $cache_key );
	if ( false !== $cached ) {
		return $cached;
	}

	$response = wp_remote_get(
		fourliberty_hub_live_state_endpoint(),
		array( 'timeout' => 5 )
	);

	if ( is_wp_error( $response ) ) {
		$result = array( 'ok' => false, 'payload' => null, 'error' => $response->get_error_message() );
	} else {
		$code = wp_remote_retrieve_response_code( $response );
		$body = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( 200 !== $code || ! is_array( $body ) || ! isset( $body['channels'] ) ) {
			$result = array(
				'ok'      => false,
				'payload' => null,
				/* translators: %d: HTTP status code */
				'error'   => sprintf( __( 'Poller returned an unexpected response (HTTP %d).', 'fourliberty-hub' ), $code ),
			);
		} else {
			$result = array( 'ok' => true, 'payload' => $body, 'error' => null );
		}
	}

	set_transient( $cache_key, $result, 30 );
	return $result;
}

/**
 * Turns a channel key discovered from the poller (env var suffix, e.g. "WUA")
 * into a readable default display name when nothing's configured yet, e.g.
 * "HOMESCHOOL" -> "Homeschool". Only used to seed the form for a brand-new
 * channel Austin hasn't named yet — never overrides a saved name.
 */
function fourliberty_hub_guess_show_name( $key ) {
	return ucwords( strtolower( str_replace( '_', ' ', $key ) ) );
}

/**
 * Handles the settings form POST. Runs on load-{hook} (before any HTML is
 * output) so it can redirect after saving — avoids a resubmission prompt on
 * refresh, standard WP admin pattern.
 */
function fourliberty_hub_live_shows_maybe_save() {
	if ( ! isset( $_POST['fourliberty_hub_live_shows_save'] ) ) {
		return;
	}
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'You do not have permission to do that.', 'fourliberty-hub' ) );
	}
	check_admin_referer( 'fourliberty_hub_live_shows_save', 'fourliberty_hub_live_shows_nonce' );

	$order_raw   = isset( $_POST['fourliberty_order'] ) ? wp_unslash( $_POST['fourliberty_order'] ) : '';
	$order_keys  = array_filter( array_map( 'fourliberty_hub_sanitize_channel_key', explode( ',', $order_raw ) ) );
	$submitted   = isset( $_POST['fourliberty_shows'] ) && is_array( $_POST['fourliberty_shows'] ) ? wp_unslash( $_POST['fourliberty_shows'] ) : array();

	$shows = array();
	foreach ( $order_keys as $key ) {
		if ( ! isset( $submitted[ $key ] ) || ! is_array( $submitted[ $key ] ) ) {
			continue;
		}
		$row = $submitted[ $key ];
		$shows[ $key ] = array(
			'name'            => sanitize_text_field( $row['name'] ?? $key ),
			'host'            => sanitize_text_field( $row['host'] ?? '' ),
			'enabled'         => ! empty( $row['enabled'] ),
			'gatedTitleMatch' => sanitize_text_field( $row['gatedTitleMatch'] ?? '' ),
			'gatedLabel'      => sanitize_text_field( $row['gatedLabel'] ?? '' ),
			'gatedUrl'        => empty( $row['gatedUrl'] ) ? '' : esc_url_raw( $row['gatedUrl'] ),
		);
	}

	update_option(
		FOURLIBERTY_HUB_LIVE_SHOWS_OPTION,
		array(
			'order' => array_values( $order_keys ),
			'shows' => $shows,
		)
	);

	wp_safe_redirect( add_query_arg( 'fourliberty_saved', '1', wp_get_referer() ?: admin_url( 'admin.php?page=fourliberty-hub-live-shows' ) ) );
	exit;
}

function fourliberty_hub_sanitize_channel_key( $key ) {
	$key = strtoupper( trim( $key ) );
	return preg_replace( '/[^A-Z0-9_]/', '', $key );
}

/**
 * Plain-language "is the poller working?" line for a non-technical owner —
 * exact wording pattern from PHASE-2-BUILD-PLAN.md task 14. The 5-minute
 * warning threshold matches the front-end's own STALE_MS in live-state.js,
 * so this screen and the homepage agree on what "stale" means.
 */
function fourliberty_hub_render_poller_status( $fetch ) {
	if ( ! $fetch['ok'] ) {
		printf(
			'<p style="color:#b32d2e;font-weight:600;">⚠️ %s</p>',
			esc_html__( "Couldn't reach the poller just now — the homepage will keep showing its last known state.", 'fourliberty-hub' )
		);
		return;
	}

	$generated_at = isset( $fetch['payload']['generated_at'] ) ? strtotime( $fetch['payload']['generated_at'] ) : false;
	if ( ! $generated_at ) {
		printf( '<p style="color:#b32d2e;font-weight:600;">⚠️ %s</p>', esc_html__( 'Poller response was missing a timestamp.', 'fourliberty-hub' ) );
		return;
	}

	$age_seconds = max( 0, time() - $generated_at );
	$stale       = $age_seconds > 5 * MINUTE_IN_SECONDS;

	if ( $age_seconds < 90 ) {
		/* translators: %d: seconds */
		$when = sprintf( _n( '%d second ago', '%d seconds ago', $age_seconds, 'fourliberty-hub' ), $age_seconds );
	} else {
		/* translators: %s: e.g. "2 minutes" */
		$when = sprintf( __( '%s ago', 'fourliberty-hub' ), human_time_diff( $generated_at, time() ) );
	}

	if ( $stale ) {
		printf(
			'<p style="color:#b32d2e;font-weight:600;">⚠️ %s</p>',
			sprintf(
				/* translators: %s: relative time, e.g. "12 minutes ago" */
				esc_html__( "Haven't heard from the poller in a while — last checked %s.", 'fourliberty-hub' ),
				esc_html( $when )
			)
		);
	} else {
		printf(
			'<p style="color:#1a7a30;font-weight:600;">✅ %s</p>',
			sprintf(
				/* translators: %s: relative time, e.g. "40 seconds ago" */
				esc_html__( 'Poller last checked: %s', 'fourliberty-hub' ),
				esc_html( $when )
			)
		);
	}
}

function fourliberty_hub_render_live_shows() {
	$config       = fourliberty_hub_live_shows_config();
	$saved_order  = isset( $config['order'] ) && is_array( $config['order'] ) ? $config['order'] : array();
	$saved_shows  = isset( $config['shows'] ) && is_array( $config['shows'] ) ? $config['shows'] : array();

	$fetch    = fourliberty_hub_fetch_live_payload();
	$channels = $fetch['ok'] ? $fetch['payload']['channels'] : array();

	// Union: saved order first (preserves Austin's chosen priority), then any
	// channel the poller reports that isn't configured yet (Decision 3 —
	// a new RUMBLE_API_URL_* env var shows up here with zero code changes).
	$discovered_keys = array_map( function ( $c ) { return $c['key']; }, $channels );
	$all_keys        = array_values( array_unique( array_merge( $saved_order, $discovered_keys ) ) );

	$channels_by_key = array();
	foreach ( $channels as $c ) {
		$channels_by_key[ $c['key'] ] = $c;
	}
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'Live Shows', 'fourliberty-hub' ); ?></h1>
		<p><?php esc_html_e( 'Every Rumble channel wired up in Netlify shows up here automatically. Drag to set which show takes over the homepage first if more than one is live at once. Turn a channel off here to leave it out of the homepage rotation entirely (it stays configured — nothing is deleted).', 'fourliberty-hub' ); ?></p>

		<?php if ( isset( $_GET['fourliberty_saved'] ) ) : ?>
			<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Saved.', 'fourliberty-hub' ); ?></p></div>
		<?php endif; ?>

		<div style="background:#fff;border:1px solid #dcdcde;padding:12px 16px;max-width:560px;margin-bottom:20px;border-radius:4px;">
			<?php fourliberty_hub_render_poller_status( $fetch ); ?>
			<?php if ( ! $fetch['ok'] ) : ?>
				<p style="margin-bottom:0;color:#646970;"><?php echo esc_html( $fetch['error'] ); ?></p>
			<?php endif; ?>
		</div>

		<?php if ( ! $all_keys ) : ?>
			<p style="color:#646970;"><?php esc_html_e( 'No channels found yet — add a RUMBLE_API_URL_* environment variable in Netlify and it will appear here within about a minute.', 'fourliberty-hub' ); ?></p>
			<?php return; ?>
		<?php endif; ?>

		<form method="post" id="fourliberty-live-shows-form">
			<?php wp_nonce_field( 'fourliberty_hub_live_shows_save', 'fourliberty_hub_live_shows_nonce' ); ?>
			<input type="hidden" name="fourliberty_order" id="fourliberty_order" value="<?php echo esc_attr( implode( ',', $all_keys ) ); ?>" />

			<div id="fourliberty-live-shows-rows">
				<?php foreach ( $all_keys as $key ) :
					$saved      = isset( $saved_shows[ $key ] ) ? $saved_shows[ $key ] : array();
					$is_new     = ! isset( $saved_shows[ $key ] );
					$name       = $saved['name'] ?? fourliberty_hub_guess_show_name( $key );
					$host       = $saved['host'] ?? '';
					$enabled    = ! isset( $saved['enabled'] ) || $saved['enabled']; // default on for new/unset
					$gate_match = $saved['gatedTitleMatch'] ?? '';
					$gate_label = $saved['gatedLabel'] ?? 'Subscribe on Rumble to watch live →';
					$gate_url   = $saved['gatedUrl'] ?? '';
					$live_info  = isset( $channels_by_key[ $key ] ) ? $channels_by_key[ $key ] : null;
					?>
					<div class="fl-hub-row" draggable="true" data-key="<?php echo esc_attr( $key ); ?>" style="background:#fff;border:1px solid #dcdcde;border-radius:4px;margin-bottom:10px;padding:14px 16px;">
						<div style="display:flex;align-items:flex-start;gap:12px;">
							<span class="dashicons dashicons-move fl-hub-drag-handle" title="<?php esc_attr_e( 'Drag to reorder', 'fourliberty-hub' ); ?>" style="cursor:grab;color:#a7aaad;margin-top:6px;"></span>

							<div style="flex:1;min-width:0;">
								<div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:10px;">
									<strong style="font-size:14px;">
										<?php echo esc_html( $key ); ?>
										<?php if ( $live_info && $live_info['is_live'] ) : ?>
											<span style="color:#b32d2e;font-weight:700;">&nbsp;● <?php esc_html_e( 'LIVE now', 'fourliberty-hub' ); ?></span>
										<?php endif; ?>
										<?php if ( $is_new ) : ?>
											<span style="background:#e6ba57;color:#3a2c00;border-radius:3px;padding:1px 6px;font-size:11px;margin-left:6px;"><?php esc_html_e( 'NEW', 'fourliberty-hub' ); ?></span>
										<?php endif; ?>
									</strong>
									<span style="color:#646970;font-size:12px;">
										<?php
										if ( $live_info && ! empty( $live_info['channel'] ) ) {
											printf(
												/* translators: %s: Rumble channel handle */
												esc_html__( 'Rumble channel: %s', 'fourliberty-hub' ),
												esc_html( $live_info['channel'] )
											);
										}
										?>
										&middot; <?php printf( esc_html__( 'Netlify env var: %s', 'fourliberty-hub' ), '<code>RUMBLE_API_URL_' . esc_html( $key ) . '</code>' ); ?>
									</span>
									<label style="margin-left:auto;display:flex;align-items:center;gap:6px;font-weight:600;">
										<input type="checkbox" name="fourliberty_shows[<?php echo esc_attr( $key ); ?>][enabled]" value="1" <?php checked( $enabled ); ?> />
										<?php esc_html_e( 'Included in homepage rotation', 'fourliberty-hub' ); ?>
									</label>
								</div>

								<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;max-width:760px;">
									<label style="font-size:12px;color:#3c434a;">
										<?php esc_html_e( 'Display name', 'fourliberty-hub' ); ?>
										<input type="text" class="regular-text" style="width:100%;" name="fourliberty_shows[<?php echo esc_attr( $key ); ?>][name]" value="<?php echo esc_attr( $name ); ?>" required />
									</label>
									<label style="font-size:12px;color:#3c434a;">
										<?php esc_html_e( 'Host / subtitle (optional)', 'fourliberty-hub' ); ?>
										<input type="text" class="regular-text" style="width:100%;" name="fourliberty_shows[<?php echo esc_attr( $key ); ?>][host]" value="<?php echo esc_attr( $host ); ?>" placeholder="<?php esc_attr_e( 'e.g. with Austin Petersen', 'fourliberty-hub' ); ?>" />
									</label>
									<label style="font-size:12px;color:#3c434a;grid-column:1 / -1;">
										<?php esc_html_e( 'Members-only when the live title contains', 'fourliberty-hub' ); ?>
										<input type="text" class="regular-text" style="width:100%;" name="fourliberty_shows[<?php echo esc_attr( $key ); ?>][gatedTitleMatch]" value="<?php echo esc_attr( $gate_match ); ?>" placeholder="<?php esc_attr_e( 'Leave blank = never gated', 'fourliberty-hub' ); ?>" />
									</label>
									<label style="font-size:12px;color:#3c434a;">
										<?php esc_html_e( 'Subscribe CTA label', 'fourliberty-hub' ); ?>
										<input type="text" class="regular-text" style="width:100%;" name="fourliberty_shows[<?php echo esc_attr( $key ); ?>][gatedLabel]" value="<?php echo esc_attr( $gate_label ); ?>" />
									</label>
									<label style="font-size:12px;color:#3c434a;">
										<?php esc_html_e( 'Subscribe CTA link', 'fourliberty-hub' ); ?>
										<input type="url" class="regular-text" style="width:100%;" name="fourliberty_shows[<?php echo esc_attr( $key ); ?>][gatedUrl]" value="<?php echo esc_attr( $gate_url ); ?>" placeholder="https://rumble.com/c/..." />
									</label>
								</div>
							</div>
						</div>
					</div>
				<?php endforeach; ?>
			</div>

			<p class="submit">
				<button type="submit" name="fourliberty_hub_live_shows_save" value="1" class="button button-primary"><?php esc_html_e( 'Save Live Shows', 'fourliberty-hub' ); ?></button>
			</p>
		</form>
	</div>
	<?php
}
