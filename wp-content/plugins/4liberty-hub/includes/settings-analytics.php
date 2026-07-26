<?php
/**
 * Analytics settings — Google Analytics Measurement ID.
 *
 * One field: the GA4 Measurement ID (looks like G-XXXXXXXXXX). The theme's
 * fourliberty_analytics_measurement_id() (functions.php) reads the option and
 * prints the standard gtag snippet on every front-end page when it's filled
 * in. Blank = no tracking at all — that's also the kill switch (same
 * "empty config turns the feature off" pattern as the Shop Ad image).
 *
 * The ID is not a secret (it's visible in any page's source on any site
 * using GA), so a plain admin option is fine here — no wp-config constant or
 * Netlify env var needed, unlike the real secrets in this project.
 *
 * @package fourliberty-hub
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const FOURLIBERTY_HUB_ANALYTICS_OPTION = 'fourliberty_analytics_config';

function fourliberty_hub_register_analytics_menu() {
	$hook = add_submenu_page(
		'fourliberty-hub',
		__( 'Analytics', 'fourliberty-hub' ),
		__( 'Analytics', 'fourliberty-hub' ),
		'manage_options',
		'fourliberty-hub-analytics',
		'fourliberty_hub_render_analytics'
	);
	add_action( 'load-' . $hook, 'fourliberty_hub_analytics_maybe_save' );
}
add_action( 'admin_menu', 'fourliberty_hub_register_analytics_menu' );

function fourliberty_hub_analytics_maybe_save() {
	if ( ! isset( $_POST['fourliberty_hub_analytics_save'] ) ) {
		return;
	}
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'You do not have permission to do that.', 'fourliberty-hub' ) );
	}
	check_admin_referer( 'fourliberty_hub_analytics_save', 'fourliberty_hub_analytics_nonce' );

	$raw = strtoupper( trim( sanitize_text_field( wp_unslash( $_POST['fourliberty_analytics_measurement_id'] ?? '' ) ) ) );

	// Blank is valid (tracking off). Otherwise require the exact GA4 shape so
	// a stray paste (a URL, the whole snippet, a UA- id from old Analytics)
	// can't be saved and silently track nothing.
	if ( '' !== $raw && ! preg_match( '/^G-[A-Z0-9]{4,16}$/', $raw ) ) {
		wp_safe_redirect( add_query_arg( 'fourliberty_analytics_error', '1', wp_get_referer() ?: admin_url( 'admin.php?page=fourliberty-hub-analytics' ) ) );
		exit;
	}

	update_option( FOURLIBERTY_HUB_ANALYTICS_OPTION, array( 'measurementId' => $raw ) );

	wp_safe_redirect( add_query_arg( 'fourliberty_saved', '1', wp_get_referer() ?: admin_url( 'admin.php?page=fourliberty-hub-analytics' ) ) );
	exit;
}

function fourliberty_hub_render_analytics() {
	$config = get_option( FOURLIBERTY_HUB_ANALYTICS_OPTION );
	$id     = is_array( $config ) ? ( $config['measurementId'] ?? '' ) : '';
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'Analytics', 'fourliberty-hub' ); ?></h1>
		<p><?php esc_html_e( 'Google Analytics for the whole site. Paste the Measurement ID from the "4Liberty Network" property at analytics.google.com. Leave it empty to turn tracking off.', 'fourliberty-hub' ); ?></p>

		<?php if ( isset( $_GET['fourliberty_saved'] ) ) : ?>
			<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Saved.', 'fourliberty-hub' ); ?></p></div>
		<?php endif; ?>
		<?php if ( isset( $_GET['fourliberty_analytics_error'] ) ) : ?>
			<div class="notice notice-error is-dismissible"><p><?php esc_html_e( 'That does not look like a Measurement ID. It starts with "G-", like G-FKJTMG3SY9. Nothing was saved.', 'fourliberty-hub' ); ?></p></div>
		<?php endif; ?>

		<form method="post">
			<?php wp_nonce_field( 'fourliberty_hub_analytics_save', 'fourliberty_hub_analytics_nonce' ); ?>

			<div style="background:#fff;border:1px solid #dcdcde;border-radius:4px;padding:16px 20px;max-width:640px;">
				<p style="margin-top:0;">
					<label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'Measurement ID', 'fourliberty-hub' ); ?></label>
					<input type="text" class="regular-text" style="max-width:280px;" name="fourliberty_analytics_measurement_id" value="<?php echo esc_attr( $id ); ?>" placeholder="G-XXXXXXXXXX" />
				</p>
				<p style="color:#646970;font-size:12px;margin-bottom:0;">
					<?php esc_html_e( 'Visits by logged-in site admins (you, Brad) are not counted, so your own browsing never skews the numbers.', 'fourliberty-hub' ); ?>
				</p>
			</div>

			<p class="submit">
				<button type="submit" name="fourliberty_hub_analytics_save" value="1" class="button button-primary"><?php esc_html_e( 'Save Analytics', 'fourliberty-hub' ); ?></button>
			</p>
		</form>
	</div>
	<?php
}
