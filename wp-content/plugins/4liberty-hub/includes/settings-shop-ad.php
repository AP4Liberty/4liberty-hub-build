<?php
/**
 * Shop Ad settings — homepage advertisement block.
 *
 * Lets Austin swap the image/link of the ad block that sits below the video
 * player on the homepage (in the gap left over because the chat rail next to
 * it runs taller — his own framing, 2026-07-23: "everything to look more
 * flush"). Points at 4libertyshop.com by default but is fully replaceable —
 * any image, any link — so it isn't locked to the shop if priorities change.
 *
 * Writes to `fourliberty_shop_ad_config`, the option the theme's
 * `fourliberty_shop_ad_config()` (functions.php) reads. Blank image = nothing
 * renders at all (patterns/hero-live.php), so there's no "broken ad" state —
 * just leave it empty to turn the block off.
 *
 * @package fourliberty-hub
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const FOURLIBERTY_HUB_SHOP_AD_OPTION = 'fourliberty_shop_ad_config';

function fourliberty_hub_register_shop_ad_menu() {
	$hook = add_submenu_page(
		'fourliberty-hub',
		__( 'Shop Ad', 'fourliberty-hub' ),
		__( 'Shop Ad', 'fourliberty-hub' ),
		'manage_options',
		'fourliberty-hub-shop-ad',
		'fourliberty_hub_render_shop_ad'
	);
	add_action( 'load-' . $hook, 'fourliberty_hub_shop_ad_maybe_save' );
	add_action( 'admin_enqueue_scripts', function ( $screen_hook ) use ( $hook ) {
		if ( $screen_hook !== $hook ) {
			return;
		}
		wp_enqueue_media(); // powers the "Choose image" button's picker modal
		$src  = FOURLIBERTY_HUB_URL . 'assets/js/admin-shop-ad.js';
		$path = FOURLIBERTY_HUB_PATH . 'assets/js/admin-shop-ad.js';
		wp_enqueue_script( 'fourliberty-hub-admin-shop-ad', $src, array(), file_exists( $path ) ? filemtime( $path ) : FOURLIBERTY_HUB_VERSION, true );
	} );
}
add_action( 'admin_menu', 'fourliberty_hub_register_shop_ad_menu' );

function fourliberty_hub_shop_ad_config() {
	if ( function_exists( 'fourliberty_shop_ad_config' ) ) {
		return fourliberty_shop_ad_config();
	}
	return array( 'imageUrl' => '', 'linkUrl' => 'https://4libertyshop.com', 'altText' => '' );
}

function fourliberty_hub_shop_ad_maybe_save() {
	if ( ! isset( $_POST['fourliberty_hub_shop_ad_save'] ) ) {
		return;
	}
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'You do not have permission to do that.', 'fourliberty-hub' ) );
	}
	check_admin_referer( 'fourliberty_hub_shop_ad_save', 'fourliberty_hub_shop_ad_nonce' );

	$image_url = empty( $_POST['fourliberty_shop_ad_image_url'] ) ? '' : esc_url_raw( wp_unslash( $_POST['fourliberty_shop_ad_image_url'] ) );
	$link_url  = empty( $_POST['fourliberty_shop_ad_link_url'] ) ? '' : esc_url_raw( wp_unslash( $_POST['fourliberty_shop_ad_link_url'] ) );
	$alt_text  = sanitize_text_field( wp_unslash( $_POST['fourliberty_shop_ad_alt_text'] ?? '' ) );

	update_option(
		FOURLIBERTY_HUB_SHOP_AD_OPTION,
		array( 'imageUrl' => $image_url, 'linkUrl' => $link_url, 'altText' => $alt_text )
	);

	wp_safe_redirect( add_query_arg( 'fourliberty_saved', '1', wp_get_referer() ?: admin_url( 'admin.php?page=fourliberty-hub-shop-ad' ) ) );
	exit;
}

function fourliberty_hub_render_shop_ad() {
	$config    = fourliberty_hub_shop_ad_config();
	$image_url = $config['imageUrl'] ?? '';
	$link_url  = $config['linkUrl'] ?? 'https://4libertyshop.com';
	$alt_text  = $config['altText'] ?? '';
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'Shop Ad', 'fourliberty-hub' ); ?></h1>
		<p><?php esc_html_e( 'The ad block on the homepage, below the video player. Swap the image or link any time — leave the image empty to hide the block entirely.', 'fourliberty-hub' ); ?></p>

		<?php if ( isset( $_GET['fourliberty_saved'] ) ) : ?>
			<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Saved.', 'fourliberty-hub' ); ?></p></div>
		<?php endif; ?>

		<form method="post" id="fourliberty-shop-ad-form">
			<?php wp_nonce_field( 'fourliberty_hub_shop_ad_save', 'fourliberty_hub_shop_ad_nonce' ); ?>

			<div style="background:#fff;border:1px solid #dcdcde;border-radius:4px;padding:16px 20px;max-width:640px;">
				<p style="font-size:12px;font-weight:600;margin-top:0;"><?php esc_html_e( 'Image (shown at 16:9 — any size or shape works, it gets cropped to fit)', 'fourliberty-hub' ); ?></p>

				<div id="fourliberty-shop-ad-preview" style="width:100%;max-width:400px;aspect-ratio:16/9;border-radius:8px;overflow:hidden;border:1px solid #dcdcde;background:#f0f0f1 center/cover no-repeat;<?php echo $image_url ? 'background-image:url(' . esc_url( $image_url ) . ');' : ''; ?>margin-bottom:10px;"></div>

				<input type="hidden" id="fourliberty_shop_ad_image_url" name="fourliberty_shop_ad_image_url" value="<?php echo esc_attr( $image_url ); ?>" />
				<button type="button" class="button" id="fourliberty-shop-ad-choose-image"><?php esc_html_e( 'Choose image', 'fourliberty-hub' ); ?></button>
				<button type="button" class="button-link-delete" id="fourliberty-shop-ad-remove-image" style="margin-left:10px;<?php echo $image_url ? '' : 'display:none;'; ?>"><?php esc_html_e( 'Remove image', 'fourliberty-hub' ); ?></button>

				<p style="margin-top:20px;">
					<label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'Where it links to', 'fourliberty-hub' ); ?></label>
					<input type="url" class="regular-text" style="width:100%;max-width:400px;" name="fourliberty_shop_ad_link_url" value="<?php echo esc_attr( $link_url ); ?>" placeholder="https://4libertyshop.com" />
				</p>

				<p style="margin-top:16px;">
					<label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'Description (for screen readers — not shown visually)', 'fourliberty-hub' ); ?></label>
					<input type="text" class="regular-text" style="width:100%;max-width:400px;" name="fourliberty_shop_ad_alt_text" value="<?php echo esc_attr( $alt_text ); ?>" placeholder="<?php esc_attr_e( 'e.g. Shop 4Liberty Network merch', 'fourliberty-hub' ); ?>" />
				</p>
			</div>

			<p class="submit">
				<button type="submit" name="fourliberty_hub_shop_ad_save" value="1" class="button button-primary"><?php esc_html_e( 'Save Shop Ad', 'fourliberty-hub' ); ?></button>
			</p>
		</form>
	</div>
	<?php
}
