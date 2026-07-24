<?php
/**
 * Chat & Tips settings — Phase 3, task G.
 *
 * Lets Austin control chat on/off, tip presets + the allowed amount range,
 * the hide-bots default, moderation notes, and the Square publishable
 * fields — all from wp-admin, no code edits. Same pattern as
 * settings-live-shows.php: nonce, load-{hook} save + redirect, sanitize on
 * save, config-seam option.
 *
 * Two fields here (tip min/max) are also enforced SERVER-SIDE on Netlify —
 * bridged via a public WordPress REST route (functions.php's
 * fourliberty_register_rest_routes()) that netlify/functions/poll-wp-
 * config.mts polls every minute into netlify/lib/config.mts. Everything
 * else here is read directly by the browser via wp_localize_script and
 * takes effect the next page load, no bridge needed.
 *
 * "Mode" (open/gated) is a real dropdown here (Task H) — held back until now
 * because gating chat before Task D/F's accounts existed would have locked
 * everyone out with no way to log in. The bridge (and chat-token.mts's
 * enforcement) already read whatever mode is configured; this just exposes
 * the choice.
 *
 * Square's Application ID / Location ID / environment are editable here for
 * the BROWSER's use (Web Payments SDK), but Netlify's backend
 * (tip-create.mts) holds its OWN separate copies as env vars — see the
 * warning rendered near those fields. These rarely change and are
 * deliberately NOT auto-synced (that's real infrastructure for a rare,
 * supervised event); update both places together, a Task H go-live checklist
 * item.
 *
 * Writes to the same `fourliberty_chat_tips_config` option
 * fourliberty_chat_tips_config() (functions.php) already reads.
 *
 * @package fourliberty-hub
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const FOURLIBERTY_HUB_CHAT_TIPS_OPTION = 'fourliberty_chat_tips_config';

function fourliberty_hub_register_chat_tips_menu() {
	$hook = add_submenu_page(
		'fourliberty-hub',
		__( 'Chat & Tips', 'fourliberty-hub' ),
		__( 'Chat & Tips', 'fourliberty-hub' ),
		'manage_options',
		'fourliberty-hub-chat-tips',
		'fourliberty_hub_render_chat_tips'
	);
	add_action( 'load-' . $hook, 'fourliberty_hub_chat_tips_maybe_save' );
}
add_action( 'admin_menu', 'fourliberty_hub_register_chat_tips_menu' );

/**
 * The stored config, merged with the theme's defaults — same
 * theme-delegation pattern as fourliberty_hub_live_shows_config(). Falls
 * back to a minimal shape if the theme isn't active, so this screen never
 * fatals.
 */
function fourliberty_hub_chat_tips_config() {
	if ( function_exists( 'fourliberty_chat_tips_config' ) ) {
		return fourliberty_chat_tips_config();
	}
	return array(
		'chatEnabled'         => true,
		'mode'                => 'open',
		'tipPresets'          => array( 5, 17.76, 50 ),
		'tipMinDollars'       => 1,
		'tipMaxDollars'       => 500,
		'hideBotDefault'      => true,
		'moderationNotes'     => '',
		'squareApplicationId' => '',
		'squareLocationId'    => '',
		'squareEnvironment'   => 'sandbox',
	);
}

/** The config-status Netlify endpoint, same theme-delegation pattern. */
function fourliberty_hub_config_status_endpoint() {
	if ( function_exists( 'fourliberty_config_status_endpoint' ) ) {
		return fourliberty_config_status_endpoint();
	}
	return 'https://4liberty-poller.netlify.app/api/config-status';
}

/**
 * Fetches Netlify's real Stream/Square status server-side — booleans only,
 * never a value (matches PHASE-3-BUILD-PLAN.md's rule for this endpoint).
 * Same transient-caching pattern as settings-live-shows.php's poller-status
 * check, so reloading this screen doesn't hammer the endpoint.
 *
 * Returns array{ ok: bool, streamConfigured: bool|null, squareConfigured: bool|null, error: string|null }.
 */
function fourliberty_hub_fetch_config_status() {
	$cache_key = 'fourliberty_hub_config_status';
	$cached    = get_transient( $cache_key );
	if ( false !== $cached ) {
		return $cached;
	}

	$response = wp_remote_get(
		fourliberty_hub_config_status_endpoint(),
		array( 'timeout' => 5 )
	);

	if ( is_wp_error( $response ) ) {
		$result = array(
			'ok'               => false,
			'streamConfigured' => null,
			'squareConfigured' => null,
			'error'            => $response->get_error_message(),
		);
	} else {
		$code = wp_remote_retrieve_response_code( $response );
		$body = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( 200 !== $code || ! is_array( $body ) ) {
			$result = array(
				'ok'               => false,
				'streamConfigured' => null,
				'squareConfigured' => null,
				/* translators: %d: HTTP status code */
				'error'            => sprintf( __( 'Status check returned an unexpected response (HTTP %d).', 'fourliberty-hub' ), $code ),
			);
		} else {
			$result = array(
				'ok'               => true,
				'streamConfigured' => ! empty( $body['streamConfigured'] ),
				'squareConfigured' => ! empty( $body['squareConfigured'] ),
				'error'            => null,
			);
		}
	}

	set_transient( $cache_key, $result, 30 );
	return $result;
}

/**
 * Handles the settings form POST. Runs on load-{hook} (before any HTML is
 * output) so it can redirect after saving.
 */
function fourliberty_hub_chat_tips_maybe_save() {
	if ( ! isset( $_POST['fourliberty_hub_chat_tips_save'] ) ) {
		return;
	}
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'You do not have permission to do that.', 'fourliberty-hub' ) );
	}
	check_admin_referer( 'fourliberty_hub_chat_tips_save', 'fourliberty_hub_chat_tips_nonce' );

	$presets_raw = isset( $_POST['fourliberty_tip_presets'] ) ? wp_unslash( $_POST['fourliberty_tip_presets'] ) : array();
	$presets     = array();
	if ( is_array( $presets_raw ) ) {
		foreach ( $presets_raw as $preset ) {
			$val = floatval( $preset );
			if ( $val > 0 ) {
				$presets[] = $val;
			}
		}
	}
	if ( empty( $presets ) ) {
		$presets = array( 5, 17.76, 50 );
	}

	$min = isset( $_POST['fourliberty_tip_min'] ) ? floatval( wp_unslash( $_POST['fourliberty_tip_min'] ) ) : 1;
	$max = isset( $_POST['fourliberty_tip_max'] ) ? floatval( wp_unslash( $_POST['fourliberty_tip_max'] ) ) : 500;
	if ( $min <= 0 ) {
		$min = 1;
	}
	if ( $max <= $min ) {
		$max = $min + 1;
	}

	$config = array(
		'chatEnabled'         => ! empty( $_POST['fourliberty_chat_enabled'] ),
		'mode'                => ( isset( $_POST['fourliberty_chat_mode'] ) && 'gated' === $_POST['fourliberty_chat_mode'] )
			? 'gated'
			: 'open',
		'tipPresets'          => $presets,
		'tipMinDollars'       => $min,
		'tipMaxDollars'       => $max,
		'hideBotDefault'      => ! empty( $_POST['fourliberty_hide_bot_default'] ),
		'moderationNotes'     => isset( $_POST['fourliberty_moderation_notes'] )
			? sanitize_textarea_field( wp_unslash( $_POST['fourliberty_moderation_notes'] ) )
			: '',
		'squareApplicationId' => isset( $_POST['fourliberty_square_app_id'] )
			? sanitize_text_field( wp_unslash( $_POST['fourliberty_square_app_id'] ) )
			: '',
		'squareLocationId'    => isset( $_POST['fourliberty_square_location_id'] )
			? sanitize_text_field( wp_unslash( $_POST['fourliberty_square_location_id'] ) )
			: '',
		'squareEnvironment'   => ( isset( $_POST['fourliberty_square_environment'] ) && 'production' === $_POST['fourliberty_square_environment'] )
			? 'production'
			: 'sandbox',
	);

	update_option( FOURLIBERTY_HUB_CHAT_TIPS_OPTION, $config );

	wp_safe_redirect( add_query_arg( 'fourliberty_saved', '1', wp_get_referer() ?: admin_url( 'admin.php?page=fourliberty-hub-chat-tips' ) ) );
	exit;
}

function fourliberty_hub_render_status_line( $label, $ok ) {
	if ( null === $ok ) {
		printf( '<p style="margin:4px 0;color:#646970;">%s — %s</p>', esc_html( $label ), esc_html__( "couldn't check", 'fourliberty-hub' ) );
		return;
	}
	if ( $ok ) {
		printf( '<p style="margin:4px 0;color:#1a7a30;font-weight:600;">✅ %s configured</p>', esc_html( $label ) );
	} else {
		printf( '<p style="margin:4px 0;color:#b32d2e;font-weight:600;">⚠️ %s not reachable — check the Netlify env vars</p>', esc_html( $label ) );
	}
}

function fourliberty_hub_render_chat_tips() {
	$config = fourliberty_hub_chat_tips_config();
	$status = fourliberty_hub_fetch_config_status();
	$presets = array_values( (array) $config['tipPresets'] );
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'Chat & Tips', 'fourliberty-hub' ); ?></h1>

		<?php if ( isset( $_GET['fourliberty_saved'] ) ) : ?>
			<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Saved.', 'fourliberty-hub' ); ?></p></div>
		<?php endif; ?>

		<div style="background:#fff;border:1px solid #dcdcde;padding:12px 16px;max-width:640px;margin-bottom:20px;border-radius:4px;">
			<p style="margin:0 0 8px;font-weight:600;"><?php esc_html_e( 'Backend status', 'fourliberty-hub' ); ?></p>
			<?php if ( ! $status['ok'] ) : ?>
				<p style="color:#b32d2e;font-weight:600;">⚠️ <?php esc_html_e( "Couldn't reach the status check just now.", 'fourliberty-hub' ); ?></p>
				<p style="margin-bottom:0;color:#646970;"><?php echo esc_html( $status['error'] ); ?></p>
			<?php else : ?>
				<?php
				fourliberty_hub_render_status_line( __( 'Chat (Stream)', 'fourliberty-hub' ), $status['streamConfigured'] );
				fourliberty_hub_render_status_line( __( 'Tips (Square)', 'fourliberty-hub' ), $status['squareConfigured'] );
				?>
			<?php endif; ?>
		</div>

		<form method="post">
			<?php wp_nonce_field( 'fourliberty_hub_chat_tips_save', 'fourliberty_hub_chat_tips_nonce' ); ?>

			<h2 class="title"><?php esc_html_e( 'Chat', 'fourliberty-hub' ); ?></h2>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><?php esc_html_e( 'Chat', 'fourliberty-hub' ); ?></th>
					<td>
						<label>
							<input type="checkbox" name="fourliberty_chat_enabled" value="1" <?php checked( ! empty( $config['chatEnabled'] ) ); ?> />
							<?php esc_html_e( 'On — the on-site chat rail is shown', 'fourliberty-hub' ); ?>
						</label>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="fourliberty_chat_mode"><?php esc_html_e( 'Mode', 'fourliberty-hub' ); ?></label></th>
					<td>
						<select id="fourliberty_chat_mode" name="fourliberty_chat_mode">
							<option value="open" <?php selected( 'open', $config['mode'] ); ?>><?php esc_html_e( 'Open — anyone can join and chat with just a name', 'fourliberty-hub' ); ?></option>
							<option value="gated" <?php selected( 'gated', $config['mode'] ); ?>><?php esc_html_e( 'Members-only — must log in (free account) to chat', 'fourliberty-hub' ); ?></option>
						</select>
						<p class="description"><?php esc_html_e( 'The free log-in from Task D/F, not the paid support tiers on /support. Anonymous visitors will see a "log in to join" message instead of a name field.', 'fourliberty-hub' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Hide bot messages by default', 'fourliberty-hub' ); ?></th>
					<td>
						<label>
							<input type="checkbox" name="fourliberty_hide_bot_default" value="1" <?php checked( ! empty( $config['hideBotDefault'] ) ); ?> />
							<?php esc_html_e( 'On — a visitor can still turn this off themselves in the Rumble chat mirror', 'fourliberty-hub' ); ?>
						</label>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="fourliberty_moderation_notes"><?php esc_html_e( 'Moderation notes', 'fourliberty-hub' ); ?></label></th>
					<td>
						<textarea id="fourliberty_moderation_notes" name="fourliberty_moderation_notes" rows="3" class="large-text"><?php echo esc_textarea( $config['moderationNotes'] ); ?></textarea>
						<p class="description"><?php esc_html_e( 'For your own reference only — never shown to visitors. E.g. a link to the Stream moderation dashboard, house rules for mods.', 'fourliberty-hub' ); ?></p>
					</td>
				</tr>
			</table>

			<h2 class="title"><?php esc_html_e( 'Tips', 'fourliberty-hub' ); ?></h2>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><?php esc_html_e( 'Preset amounts', 'fourliberty-hub' ); ?></th>
					<td>
						<?php for ( $i = 0; $i < 3; $i++ ) :
							$val = isset( $presets[ $i ] ) ? $presets[ $i ] : '';
							?>
							$<input type="number" step="0.01" min="0.01" name="fourliberty_tip_presets[]" value="<?php echo esc_attr( $val ); ?>" style="width:90px;margin-right:14px;" />
						<?php endfor; ?>
						<p class="description"><?php esc_html_e( 'The three quick-tip buttons under the player. Takes effect on the next page load.', 'fourliberty-hub' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Allowed range', 'fourliberty-hub' ); ?></th>
					<td>
						$<input type="number" step="0.01" min="0.01" name="fourliberty_tip_min" value="<?php echo esc_attr( $config['tipMinDollars'] ); ?>" style="width:90px;" />
						<?php esc_html_e( 'to', 'fourliberty-hub' ); ?>
						$<input type="number" step="0.01" min="0.01" name="fourliberty_tip_max" value="<?php echo esc_attr( $config['tipMaxDollars'] ); ?>" style="width:90px;" />
						<p class="description"><?php esc_html_e( 'The Custom amount field only accepts tips in this range — enforced on the server, not just the button labels. Takes about a minute to apply everywhere after saving.', 'fourliberty-hub' ); ?></p>
					</td>
				</tr>
			</table>

			<h2 class="title"><?php esc_html_e( 'Square connection', 'fourliberty-hub' ); ?></h2>
			<div style="background:#fff;border:1px solid #dcdcde;border-left:4px solid #c99a3f;padding:12px 16px;max-width:640px;margin-bottom:16px;border-radius:4px;">
				<p style="margin:0;"><?php esc_html_e( 'These three fields tell the tip button which Square app to use — but Netlify holds its own separate copies for the actual charge. Changing these here does NOT change Netlify. Only change these as part of a deliberate, supervised switch (e.g. Task H\'s go-live), updating both places together — otherwise tips will start failing.', 'fourliberty-hub' ); ?></p>
			</div>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="fourliberty_square_environment"><?php esc_html_e( 'Square mode', 'fourliberty-hub' ); ?></label></th>
					<td>
						<select id="fourliberty_square_environment" name="fourliberty_square_environment">
							<option value="sandbox" <?php selected( 'sandbox', $config['squareEnvironment'] ); ?>><?php esc_html_e( 'Sandbox (test mode — no real charges)', 'fourliberty-hub' ); ?></option>
							<option value="production" <?php selected( 'production', $config['squareEnvironment'] ); ?>><?php esc_html_e( 'Live (real payments)', 'fourliberty-hub' ); ?></option>
						</select>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="fourliberty_square_app_id"><?php esc_html_e( 'Square Application ID', 'fourliberty-hub' ); ?></label></th>
					<td><input type="text" id="fourliberty_square_app_id" name="fourliberty_square_app_id" value="<?php echo esc_attr( $config['squareApplicationId'] ); ?>" class="regular-text" /></td>
				</tr>
				<tr>
					<th scope="row"><label for="fourliberty_square_location_id"><?php esc_html_e( 'Square Location ID', 'fourliberty-hub' ); ?></label></th>
					<td><input type="text" id="fourliberty_square_location_id" name="fourliberty_square_location_id" value="<?php echo esc_attr( $config['squareLocationId'] ); ?>" class="regular-text" /></td>
				</tr>
			</table>
			<p class="description" style="max-width:640px;"><?php esc_html_e( 'The Application ID and Location ID are safe to show here — they identify your Square app, not a password. The actual payment-processing key stays only in Netlify and is never shown anywhere, including here.', 'fourliberty-hub' ); ?></p>

			<p class="submit">
				<button type="submit" name="fourliberty_hub_chat_tips_save" value="1" class="button button-primary"><?php esc_html_e( 'Save Chat & Tips', 'fourliberty-hub' ); ?></button>
			</p>
		</form>
	</div>
	<?php
}
