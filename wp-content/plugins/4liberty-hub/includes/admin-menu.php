<?php
/**
 * The "4Liberty Hub" top-level admin menu.
 *
 * Phase 1 registers the menu shell so the owner already has a stable place
 * to look, and so later phases only add settings fields here rather than
 * restructuring navigation. Every submenu is a stub until its phase lands.
 *
 * @package fourliberty-hub
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function fourliberty_hub_register_menu() {
	add_menu_page(
		__( '4Liberty Hub', 'fourliberty-hub' ),
		__( '4Liberty Hub', 'fourliberty-hub' ),
		'manage_options',
		'fourliberty-hub',
		'fourliberty_hub_render_overview',
		'dashicons-star-filled',
		58
	);

	add_submenu_page(
		'fourliberty-hub',
		__( 'Overview', 'fourliberty-hub' ),
		__( 'Overview', 'fourliberty-hub' ),
		'manage_options',
		'fourliberty-hub',
		'fourliberty_hub_render_overview'
	);
}
add_action( 'admin_menu', 'fourliberty_hub_register_menu' );

/**
 * Shared stub renderer for not-yet-built settings screens. Keeps every
 * phase's placeholder consistent and honest about what's coming.
 */
function fourliberty_hub_render_stub( $title, $phase_label, $description ) {
	?>
	<div class="wrap">
		<h1><?php echo esc_html( $title ); ?></h1>
		<div style="background:#fff;border:1px solid #dcdcde;border-left:4px solid #c99a3f;padding:16px 20px;max-width:640px;border-radius:4px;">
			<p style="font-weight:600;margin-top:0;">
				<?php
				printf(
					/* translators: %s: phase label, e.g. "Phase 2" */
					esc_html__( 'Coming in %s — not built yet.', 'fourliberty-hub' ),
					esc_html( $phase_label )
				);
				?>
			</p>
			<p><?php echo esc_html( $description ); ?></p>
		</div>
	</div>
	<?php
}

/**
 * Overview page — Phase 1 status + a plain-language map of what will live
 * where, so Austin has one screen to check regardless of which phase is
 * currently being built.
 */
function fourliberty_hub_render_overview() {
	?>
	<div class="wrap">
		<h1><?php esc_html_e( '4Liberty Hub', 'fourliberty-hub' ); ?></h1>
		<p><?php esc_html_e( 'This is the control center for everything custom on the 4Liberty Network hub. Each area below turns on as its phase of the build is completed — nothing here ever requires editing code.', 'fourliberty-hub' ); ?></p>
		<table class="widefat striped" style="max-width:760px;margin-top:16px;">
			<thead>
				<tr>
					<th><?php esc_html_e( 'Area', 'fourliberty-hub' ); ?></th>
					<th><?php esc_html_e( 'What it will control', 'fourliberty-hub' ); ?></th>
					<th><?php esc_html_e( 'Status', 'fourliberty-hub' ); ?></th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<td><?php esc_html_e( 'Live Shows', 'fourliberty-hub' ); ?></td>
					<td><?php esc_html_e( 'Which Rumble channels count as network shows, and hero priority when more than one is live.', 'fourliberty-hub' ); ?></td>
					<td><?php esc_html_e( 'Phase 2', 'fourliberty-hub' ); ?></td>
				</tr>
				<tr>
					<td><?php esc_html_e( 'Dark Channel', 'fourliberty-hub' ); ?></td>
					<td><?php esc_html_e( 'The always-on playlist (YouTube/Rumble/blog) and ad-break cadence for when no show is live.', 'fourliberty-hub' ); ?></td>
					<td><?php esc_html_e( 'Phase 2', 'fourliberty-hub' ); ?></td>
				</tr>
				<tr>
					<td><?php esc_html_e( 'Chat & Tips', 'fourliberty-hub' ); ?></td>
					<td><?php esc_html_e( 'Chat on/off, open vs. gated login, moderation, and the tip-the-show amounts.', 'fourliberty-hub' ); ?></td>
					<td><?php esc_html_e( 'Phase 3', 'fourliberty-hub' ); ?></td>
				</tr>
				<tr>
					<td><?php esc_html_e( 'Product Push', 'fourliberty-hub' ); ?></td>
					<td><?php esc_html_e( 'Search the Shopify catalog and push/clear the shoppable card during a live show.', 'fourliberty-hub' ); ?></td>
					<td><?php esc_html_e( 'Phase 4', 'fourliberty-hub' ); ?></td>
				</tr>
			</tbody>
		</table>
	</div>
	<?php
}
