<?php
/**
 * Community settings — Phase 8, Task B.
 *
 * Same pattern as settings-chat-tips.php: nonce, load-{hook} save + redirect,
 * sanitize on save, config-seam option. Writes to
 * `fourliberty_community_config`, which the theme's fourliberty_community_
 * config() (functions.php) reads and exposes at the public /server-config
 * REST route — the same one-minute bridge poll-wp-config.mts already polls
 * for the homepage chat's mode/tip fields (netlify/lib/config.mts).
 *
 * "Community chat: open to guests / members only" is deliberately its OWN
 * field (communityMode), separate from the homepage chat's `mode` field in
 * fourliberty_chat_tips_config() — PHASE-8-BUILD-PLAN.md Decision 4/5 is
 * explicit that flipping one must never affect the other. Two fields, two
 * switches, never merged.
 *
 * Moderator emails are hashed (SHA-256) before they ever leave WordPress on
 * the public /server-config route — see fourliberty_community_config() in
 * functions.php for why: this is a politically-exposed show, and a public,
 * unauthenticated JSON endpoint is not where the moderator team's actual
 * email addresses belong, even though the addresses themselves aren't
 * secrets that unlock anything.
 *
 * The Netlify connection secret (fourliberty_community_secret option, read
 * by community-rest-routes.php's fourliberty_hub_community_secret()) lives
 * in ITS OWN option, deliberately separate from fourliberty_community_
 * config — that array is partly exposed on the public /server-config route,
 * and keeping the secret in a different option means a future careless
 * edit there can't accidentally leak it. The field below is never
 * pre-filled with the real value and an empty submit never overwrites it —
 * standard "leave blank to keep the current value" handling, the same
 * reason no plugin ever echoes a saved API key back into its own form.
 *
 * @package fourliberty-hub
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const FOURLIBERTY_HUB_COMMUNITY_OPTION = 'fourliberty_community_config';

function fourliberty_hub_register_community_menu() {
	$hook = add_submenu_page(
		'fourliberty-hub',
		__( 'Community', 'fourliberty-hub' ),
		__( 'Community', 'fourliberty-hub' ),
		'manage_options',
		'fourliberty-hub-community',
		'fourliberty_hub_render_community'
	);
	add_action( 'load-' . $hook, 'fourliberty_hub_community_maybe_save' );
	add_action( 'load-' . $hook, 'fourliberty_hub_community_maybe_sync_topics' );
}
add_action( 'admin_menu', 'fourliberty_hub_register_community_menu' );

/**
 * Handles the "Sync categories from Live Shows" button (Phase 8, Task E) —
 * its own POST key and nonce action so it never collides with the main
 * settings form on the same page. Runs on the same load-{hook} as the save
 * handler above; each checks its own $_POST key and no-ops otherwise.
 */
function fourliberty_hub_community_maybe_sync_topics() {
	if ( ! isset( $_POST['fourliberty_hub_community_sync_topics'] ) ) {
		return;
	}
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'You do not have permission to do that.', 'fourliberty-hub' ) );
	}
	check_admin_referer( 'fourliberty_hub_community_sync_topics', 'fourliberty_hub_community_sync_topics_nonce' );

	$added = function_exists( 'fourliberty_hub_sync_community_topics_from_shows' )
		? fourliberty_hub_sync_community_topics_from_shows()
		: 0;

	wp_safe_redirect( add_query_arg( 'fourliberty_topics_synced', (int) $added, wp_get_referer() ?: admin_url( 'admin.php?page=fourliberty-hub-community' ) ) );
	exit;
}

/**
 * Read-only "will emoji actually save?" check (Phase 8, Task E) — emoji are
 * just UTF-8 text, so the write/render pipeline needs no code change UNLESS
 * the database's wp_posts/wp_comments tables are on the older 3-byte utf8
 * charset, which silently drops or truncates 4-byte emoji on write. This
 * ONLY reports status; it never changes anything. A real fix would be a
 * database charset conversion — a schema change on a production database,
 * which needs a full backup and a tested rollback first (Golden Rule #4),
 * never something this screen does on its own.
 *
 * @return array{ok: bool|null, detail: string}
 */
function fourliberty_hub_community_charset_status() {
	global $wpdb;
	$tables = array( $wpdb->posts, $wpdb->comments );
	// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- $wpdb->prepare() below IS used; this comment exists only because some sniffs mis-flag the IN(...) placeholder list.
	$placeholders = implode( ',', array_fill( 0, count( $tables ), '%s' ) );
	$sql          = $wpdb->prepare(
		"SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = %s AND TABLE_NAME IN ($placeholders)", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $placeholders is a fixed run of %s tokens built above, not user input.
		array_merge( array( DB_NAME ), $tables )
	);
	$rows = $wpdb->get_results( $sql );

	if ( ! is_array( $rows ) || ! $rows ) {
		return array(
			'ok'     => null,
			'detail' => __( "Couldn't check this automatically — ask your developer to check it directly.", 'fourliberty-hub' ),
		);
	}

	$bad = array();
	foreach ( $rows as $row ) {
		if ( 0 !== strpos( (string) $row->TABLE_COLLATION, 'utf8mb4' ) ) {
			$bad[] = $row->TABLE_NAME;
		}
	}

	if ( $bad ) {
		return array(
			'ok'     => false,
			'detail' => sprintf(
				/* translators: %s: comma-separated database table names */
				__( 'Emoji may get silently dropped when someone posts — %s are on an older database setting. Fixing this is a database change, and should NOT be done without a full backup and without your developer confirming it first.', 'fourliberty-hub' ),
				esc_html( implode( ', ', $bad ) )
			),
		);
	}

	return array(
		'ok'     => true,
		'detail' => __( 'Emoji are fully supported — nothing to do.', 'fourliberty-hub' ),
	);
}

/**
 * The stored config, merged with the theme's defaults — same
 * theme-delegation pattern as fourliberty_hub_chat_tips_config(). Falls back
 * to a minimal shape if the theme isn't active, so this screen never fatals.
 */
function fourliberty_hub_community_config() {
	if ( function_exists( 'fourliberty_community_config' ) ) {
		return fourliberty_community_config();
	}
	return array(
		'paused'                 => false,
		'communityMode'          => 'open',
		'postRateLimit'          => 5,
		'replyRateLimit'         => 20,
		'newAccountGateHours'    => 24,
		'moderatorEmails'        => array(),
		'reservedNames'          => array(),
		'roomName'               => 'The Lobby',
		'discordWidgetEnabled'   => false,
		'discordWidgetServerId'  => '',
		'discordWidgetChannelId' => '',
	);
}

/**
 * Discord IDs (server/channel) are always plain digit strings ("snowflakes")
 * — stripping anything else keeps a pasted URL or stray character from ever
 * reaching the embed's `server`/`channel` attributes.
 */
function fourliberty_hub_sanitize_discord_id( $raw ) {
	return preg_replace( '/[^0-9]/', '', (string) $raw );
}

/** One entry per line, trimmed, blanks dropped. Shared by both list fields below. */
function fourliberty_hub_community_parse_lines( $raw ) {
	$lines = preg_split( '/[\r\n]+/', (string) $raw );
	$out   = array();
	foreach ( $lines as $line ) {
		$line = trim( $line );
		if ( '' !== $line ) {
			$out[] = $line;
		}
	}
	return $out;
}

function fourliberty_hub_community_maybe_save() {
	if ( ! isset( $_POST['fourliberty_hub_community_save'] ) ) {
		return;
	}
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'You do not have permission to do that.', 'fourliberty-hub' ) );
	}
	check_admin_referer( 'fourliberty_hub_community_save', 'fourliberty_hub_community_nonce' );

	$post_rate  = isset( $_POST['fourliberty_community_post_rate'] ) ? absint( wp_unslash( $_POST['fourliberty_community_post_rate'] ) ) : 5;
	$reply_rate = isset( $_POST['fourliberty_community_reply_rate'] ) ? absint( wp_unslash( $_POST['fourliberty_community_reply_rate'] ) ) : 20;
	$gate_hours = isset( $_POST['fourliberty_community_gate_hours'] ) ? absint( wp_unslash( $_POST['fourliberty_community_gate_hours'] ) ) : 24;

	$emails_raw = isset( $_POST['fourliberty_community_moderator_emails'] ) ? wp_unslash( $_POST['fourliberty_community_moderator_emails'] ) : '';
	$emails     = array();
	foreach ( fourliberty_hub_community_parse_lines( $emails_raw ) as $line ) {
		$email = sanitize_email( $line );
		if ( $email && is_email( $email ) ) {
			$emails[] = strtolower( $email );
		}
	}

	$names_raw = isset( $_POST['fourliberty_community_reserved_names'] ) ? wp_unslash( $_POST['fourliberty_community_reserved_names'] ) : '';
	$names     = array();
	foreach ( fourliberty_hub_community_parse_lines( $names_raw ) as $line ) {
		$names[] = sanitize_text_field( $line );
	}

	$room_name = isset( $_POST['fourliberty_community_room_name'] ) ? sanitize_text_field( wp_unslash( $_POST['fourliberty_community_room_name'] ) ) : '';

	$discord_widget_enabled = ! empty( $_POST['fourliberty_community_discord_widget_enabled'] );
	$discord_server_id      = isset( $_POST['fourliberty_community_discord_server_id'] ) ? fourliberty_hub_sanitize_discord_id( wp_unslash( $_POST['fourliberty_community_discord_server_id'] ) ) : '';
	$discord_channel_id     = isset( $_POST['fourliberty_community_discord_channel_id'] ) ? fourliberty_hub_sanitize_discord_id( wp_unslash( $_POST['fourliberty_community_discord_channel_id'] ) ) : '';

	// Own option, own rule: a BLANK submit never touches the stored secret
	// — the field is never pre-filled with the real value (see this file's
	// header), so "I didn't type anything here" must mean "leave it alone,"
	// never "clear it."
	$secret_input = isset( $_POST['fourliberty_community_secret'] ) ? trim( wp_unslash( $_POST['fourliberty_community_secret'] ) ) : '';
	if ( '' !== $secret_input ) {
		update_option( 'fourliberty_community_secret', $secret_input );
	}

	$config = array(
		'paused'                 => ! empty( $_POST['fourliberty_community_paused'] ),
		'communityMode'          => ( isset( $_POST['fourliberty_community_mode'] ) && 'gated' === $_POST['fourliberty_community_mode'] )
			? 'gated'
			: 'open',
		'postRateLimit'          => $post_rate > 0 ? $post_rate : 5,
		'replyRateLimit'         => $reply_rate > 0 ? $reply_rate : 20,
		'newAccountGateHours'    => $gate_hours > 0 ? $gate_hours : 24,
		'moderatorEmails'        => $emails,
		'reservedNames'          => $names,
		'roomName'               => '' !== $room_name ? $room_name : 'The Lobby',
		'discordWidgetEnabled'   => $discord_widget_enabled,
		'discordWidgetServerId'  => $discord_server_id,
		'discordWidgetChannelId' => $discord_channel_id,
	);

	update_option( FOURLIBERTY_HUB_COMMUNITY_OPTION, $config );

	wp_safe_redirect( add_query_arg( 'fourliberty_saved', '1', wp_get_referer() ?: admin_url( 'admin.php?page=fourliberty-hub-community' ) ) );
	exit;
}

function fourliberty_hub_render_community() {
	$config                = fourliberty_hub_community_config();
	$secret_from_constant  = defined( 'FOURLIBERTY_COMMUNITY_SECRET' ) && FOURLIBERTY_COMMUNITY_SECRET;
	$secret_from_option    = (bool) get_option( 'fourliberty_community_secret' );
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'Community', 'fourliberty-hub' ); ?></h1>

		<?php if ( isset( $_GET['fourliberty_saved'] ) ) : ?>
			<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Saved.', 'fourliberty-hub' ); ?></p></div>
		<?php endif; ?>

		<?php if ( isset( $_GET['fourliberty_topics_synced'] ) ) : ?>
			<?php $fl_synced_count = (int) $_GET['fourliberty_topics_synced']; ?>
			<div class="notice notice-success is-dismissible"><p>
				<?php
				if ( $fl_synced_count > 0 ) {
					printf(
						/* translators: %d: number of categories added */
						esc_html(
							_n(
								'Added %d new category from Live Shows.',
								'Added %d new categories from Live Shows.',
								$fl_synced_count,
								'fourliberty-hub'
							)
						),
						$fl_synced_count
					);
				} else {
					esc_html_e( 'No new categories to add — everything is already in sync.', 'fourliberty-hub' );
				}
				?>
			</p></div>
		<?php endif; ?>

		<div style="background:#fff;border:1px solid #dcdcde;border-left:4px solid #c99a3f;padding:12px 16px;max-width:640px;margin-bottom:20px;border-radius:4px;">
			<p style="margin:0;"><?php esc_html_e( 'Posts and replies show up in the normal Posts list on this site — look for "Community Posts" in the left menu to read, trash, or edit anything.', 'fourliberty-hub' ); ?></p>
		</div>

		<h2 class="title"><?php esc_html_e( 'Categories', 'fourliberty-hub' ); ?></h2>
		<div style="background:#fff;border:1px solid #dcdcde;padding:12px 16px;max-width:640px;margin-bottom:20px;border-radius:4px;">
			<p><?php esc_html_e( 'Every show in Live Shows gets its own category people can post under, plus "General" and "Announcements." The Community page still shows everything together in one feed by default — categories are just a filter, so a small audience never gets split across empty rooms.', 'fourliberty-hub' ); ?></p>
			<p style="color:#646970;"><?php esc_html_e( 'Renaming a show later does NOT rename its category. Add, rename, or remove a category by hand anytime from Posts → Community Posts → Topics.', 'fourliberty-hub' ); ?></p>
			<form method="post" style="margin:0;">
				<?php wp_nonce_field( 'fourliberty_hub_community_sync_topics', 'fourliberty_hub_community_sync_topics_nonce' ); ?>
				<button type="submit" name="fourliberty_hub_community_sync_topics" value="1" class="button"><?php esc_html_e( 'Sync categories from Live Shows', 'fourliberty-hub' ); ?></button>
			</form>
		</div>

		<h2 class="title"><?php esc_html_e( 'Emoji support', 'fourliberty-hub' ); ?></h2>
		<?php
		$fl_charset = fourliberty_hub_community_charset_status();
		$fl_color   = true === $fl_charset['ok'] ? '#1a7a30' : ( false === $fl_charset['ok'] ? '#b32d2e' : '#646970' );
		$fl_icon    = true === $fl_charset['ok'] ? '✅' : ( false === $fl_charset['ok'] ? '⚠️' : 'ℹ️' );
		?>
		<div style="background:#fff;border:1px solid #dcdcde;border-left:4px solid <?php echo esc_attr( $fl_color ); ?>;padding:12px 16px;max-width:640px;margin-bottom:20px;border-radius:4px;">
			<p style="margin:0;font-weight:600;color:<?php echo esc_attr( $fl_color ); ?>;"><?php echo esc_html( $fl_icon ); ?> <?php echo esc_html( $fl_charset['detail'] ); ?></p>
		</div>

		<form method="post">
			<?php wp_nonce_field( 'fourliberty_hub_community_save', 'fourliberty_hub_community_nonce' ); ?>

			<h2 class="title"><?php esc_html_e( 'Emergency controls', 'fourliberty-hub' ); ?></h2>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><?php esc_html_e( 'Pause the community', 'fourliberty-hub' ); ?></th>
					<td>
						<label>
							<input type="checkbox" name="fourliberty_community_paused" value="1" <?php checked( ! empty( $config['paused'] ) ); ?> />
							<?php esc_html_e( 'On — the whole Community page becomes read-only. Nobody can post, reply, or chat. People can still read it.', 'fourliberty-hub' ); ?>
						</label>
						<p class="description"><?php esc_html_e( 'Use this if things get out of hand and you need it to stop right now.', 'fourliberty-hub' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="fourliberty_community_mode"><?php esc_html_e( 'Community chat', 'fourliberty-hub' ); ?></label></th>
					<td>
						<select id="fourliberty_community_mode" name="fourliberty_community_mode">
							<option value="open" <?php selected( 'open', $config['communityMode'] ); ?>><?php esc_html_e( 'Open — anyone can join and chat with just a name', 'fourliberty-hub' ); ?></option>
							<option value="gated" <?php selected( 'gated', $config['communityMode'] ); ?>><?php esc_html_e( 'Members-only — must log in to chat', 'fourliberty-hub' ); ?></option>
						</select>
						<p class="description"><?php esc_html_e( 'This is the Community page\'s OWN chat room, separate from the chat on your homepage — changing this never affects your homepage chat.', 'fourliberty-hub' ); ?></p>
					</td>
				</tr>
			</table>

			<h2 class="title"><?php esc_html_e( 'Spam controls', 'fourliberty-hub' ); ?></h2>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="fourliberty_community_post_rate"><?php esc_html_e( 'Posts per hour, per person', 'fourliberty-hub' ); ?></label></th>
					<td><input type="number" min="1" id="fourliberty_community_post_rate" name="fourliberty_community_post_rate" value="<?php echo esc_attr( $config['postRateLimit'] ); ?>" style="width:90px;" /></td>
				</tr>
				<tr>
					<th scope="row"><label for="fourliberty_community_reply_rate"><?php esc_html_e( 'Replies per hour, per person', 'fourliberty-hub' ); ?></label></th>
					<td><input type="number" min="1" id="fourliberty_community_reply_rate" name="fourliberty_community_reply_rate" value="<?php echo esc_attr( $config['replyRateLimit'] ); ?>" style="width:90px;" /></td>
				</tr>
				<tr>
					<th scope="row"><label for="fourliberty_community_gate_hours"><?php esc_html_e( 'New-account link hold (hours)', 'fourliberty-hub' ); ?></label></th>
					<td>
						<input type="number" min="1" id="fourliberty_community_gate_hours" name="fourliberty_community_gate_hours" value="<?php echo esc_attr( $config['newAccountGateHours'] ); ?>" style="width:90px;" />
						<p class="description"><?php esc_html_e( 'If someone posts a link within this many hours of their FIRST login, that one post waits for a moderator to approve it. Everything else posts right away.', 'fourliberty-hub' ); ?></p>
					</td>
				</tr>
			</table>

			<h2 class="title"><?php esc_html_e( 'Moderators', 'fourliberty-hub' ); ?></h2>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="fourliberty_community_moderator_emails"><?php esc_html_e( 'Moderator emails', 'fourliberty-hub' ); ?></label></th>
					<td>
						<textarea id="fourliberty_community_moderator_emails" name="fourliberty_community_moderator_emails" rows="4" class="large-text" placeholder="one@email.com&#10;two@email.com"><?php echo esc_textarea( implode( "\n", (array) $config['moderatorEmails'] ) ); ?></textarea>
						<p class="description"><?php esc_html_e( 'One email per line. Must match the email someone logs into the site with. Moderators can delete or hide posts and replies, and get moderator tools in chat.', 'fourliberty-hub' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="fourliberty_community_reserved_names"><?php esc_html_e( 'Reserved names', 'fourliberty-hub' ); ?></label></th>
					<td>
						<textarea id="fourliberty_community_reserved_names" name="fourliberty_community_reserved_names" rows="3" class="large-text" placeholder="Austin Petersen"><?php echo esc_textarea( implode( "\n", (array) $config['reservedNames'] ) ); ?></textarea>
						<p class="description"><?php esc_html_e( 'One name per line. Nobody else can use these as their display name — stops someone from pretending to be a host.', 'fourliberty-hub' ); ?></p>
					</td>
				</tr>
			</table>

			<h2 class="title"><?php esc_html_e( 'Chat room', 'fourliberty-hub' ); ?></h2>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="fourliberty_community_room_name"><?php esc_html_e( 'Room name', 'fourliberty-hub' ); ?></label></th>
					<td><input type="text" id="fourliberty_community_room_name" name="fourliberty_community_room_name" value="<?php echo esc_attr( $config['roomName'] ); ?>" class="regular-text" /></td>
				</tr>
			</table>

			<h2 class="title"><?php esc_html_e( 'Discord embed', 'fourliberty-hub' ); ?></h2>
			<div style="background:#fff;border:1px solid #dcdcde;padding:12px 16px;max-width:640px;margin-bottom:16px;border-radius:4px;">
				<p><?php esc_html_e( 'Shows a live view of your Discord chat at the top of the Community page, above the forum posts — so the page never looks empty even before many posts exist. This does not replace the forum; it just sits above it.', 'fourliberty-hub' ); ?></p>
				<p style="margin-bottom:0;"><strong><?php esc_html_e( 'Before this will work:', 'fourliberty-hub' ); ?></strong></p>
				<ol style="margin-top:4px;">
					<li><?php echo wp_kses_post( __( 'Go to <a href="https://widgetbot.io" target="_blank" rel="noopener">widgetbot.io</a> and add their bot to your Discord server (it walks you through it).', 'fourliberty-hub' ) ); ?></li>
					<li><?php esc_html_e( 'Sign in to your WidgetBot dashboard and open your server — the Server ID is shown right there under "Guild Information." Paste it below.', 'fourliberty-hub' ); ?></li>
				</ol>
				<p style="margin-bottom:0;color:#646970;"><?php esc_html_e( 'The Channel ID field below is optional — leave it blank and it shows your server\'s main channel by default.', 'fourliberty-hub' ); ?></p>
			</div>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><?php esc_html_e( 'Show Discord embed', 'fourliberty-hub' ); ?></th>
					<td>
						<label>
							<input type="checkbox" name="fourliberty_community_discord_widget_enabled" value="1" <?php checked( ! empty( $config['discordWidgetEnabled'] ) ); ?> />
							<?php esc_html_e( 'On — show it at the top of the Community page', 'fourliberty-hub' ); ?>
						</label>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="fourliberty_community_discord_server_id"><?php esc_html_e( 'Discord Server ID', 'fourliberty-hub' ); ?></label></th>
					<td><input type="text" inputmode="numeric" id="fourliberty_community_discord_server_id" name="fourliberty_community_discord_server_id" value="<?php echo esc_attr( $config['discordWidgetServerId'] ); ?>" class="regular-text" placeholder="e.g. 299881420891881473" /></td>
				</tr>
				<tr>
					<th scope="row"><label for="fourliberty_community_discord_channel_id"><?php esc_html_e( 'Discord Channel ID (optional)', 'fourliberty-hub' ); ?></label></th>
					<td><input type="text" inputmode="numeric" id="fourliberty_community_discord_channel_id" name="fourliberty_community_discord_channel_id" value="<?php echo esc_attr( $config['discordWidgetChannelId'] ); ?>" class="regular-text" placeholder="e.g. 355719584830980096" /></td>
				</tr>
			</table>

			<h2 class="title"><?php esc_html_e( 'Netlify connection', 'fourliberty-hub' ); ?></h2>
			<div style="background:#fff;border:1px solid #dcdcde;border-left:4px solid #c99a3f;padding:12px 16px;max-width:640px;margin-bottom:16px;border-radius:4px;">
				<?php if ( $secret_from_constant ) : ?>
					<p style="margin:0;color:#1a7a30;font-weight:600;">✅ <?php esc_html_e( 'Connected — a value saved in your site\'s code is being used. You don\'t need to fill in the box below.', 'fourliberty-hub' ); ?></p>
				<?php elseif ( $secret_from_option ) : ?>
					<p style="margin:0;color:#1a7a30;font-weight:600;">✅ <?php esc_html_e( 'Connected — a value is saved. Only paste a new one below if you need to change it.', 'fourliberty-hub' ); ?></p>
				<?php else : ?>
					<p style="margin:0;color:#b32d2e;font-weight:600;">⚠️ <?php esc_html_e( 'Not connected yet — paste the value below and save.', 'fourliberty-hub' ); ?></p>
				<?php endif; ?>
			</div>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="fourliberty_community_secret"><?php esc_html_e( 'Connection value', 'fourliberty-hub' ); ?></label></th>
					<td>
						<input type="password" id="fourliberty_community_secret" name="fourliberty_community_secret" value="" class="regular-text" autocomplete="off" />
						<p class="description"><?php esc_html_e( 'This box is always empty for safety — it never shows what\'s already saved. Leaving it empty and saving will NOT erase a value that\'s already connected.', 'fourliberty-hub' ); ?></p>
					</td>
				</tr>
			</table>

			<p class="submit">
				<button type="submit" name="fourliberty_hub_community_save" value="1" class="button button-primary"><?php esc_html_e( 'Save Community settings', 'fourliberty-hub' ); ?></button>
			</p>
		</form>
	</div>
	<?php
}
