/**
 * 4Liberty Network — Rumble chat, merged into the on-site feed (Phase 3, task
 * B; merged into one feed 2026-07-23 per Austin's request to stop showing
 * two separate chat boxes).
 *
 * Still reads whichever channel assets/js/live-state.js currently has as
 * hero, via the "fl:hero-state" event it dispatches, and still polls the
 * same sanitized Netlify endpoint independently (cheap, shared-cached,
 * exactly as before) — UNLESS there's no [data-fl="hero-player"] on this
 * page at all (the pop-out chat window, 2026-07-23, templates/
 * chat-popup-template.php), in which case live-state.js's whole hero
 * machine never runs and never dispatches that event. Standalone mode below
 * covers that: this file works out the current hero key itself from the
 * same poll data, using the same priority order + "included in homepage
 * rotation" config live-state.js's pickHero() reads — just without any of
 * that machine's player-specific concerns (hysteresis, banners, gating).
 *
 * The difference is where messages land: instead of a
 * separate read-only accordion, each new Rumble message is handed to
 * window.FLHub.chat.appendExternalMessage() (assets/js/chat.js) and rendered
 * inline in the same feed as the real chat, tagged "via Rumble" so it's
 * clear which is which. Never touches a Rumble API URL — chat only ever
 * arrives already allowlist-sanitized in the /api/live-state payload (see
 * netlify/lib/sanitize.mts). Every dynamic value is inserted via
 * textContent/DOM properties, never innerHTML — Rumble chat text is
 * third-party, visitor-authored content and must be treated as untrusted.
 */
( function () {
	'use strict';

	var ENDPOINT =
		( window.fourlibertyLiveEndpoint && window.fourlibertyLiveEndpoint.url ) ||
		'https://4liberty-poller.netlify.app/api/live-state';

	var POLL_INTERVAL_MS = 45000; // matches live-state.js's cadence
	var HIDE_BOTS_STORAGE_KEY = 'fl-rumble-hide-bots';

	// Keeps the merged feed from growing without bound over a long show
	// (Austin's "bizarrely long module" report, 2026-07-23) — once this many
	// Rumble-sourced rows are showing, the oldest are dropped as new ones
	// arrive. The on-site chat's own messages are never touched by this.
	var MAX_RUMBLE_ROWS = 40;

	// Rumble's own emote shorthand (e.g. ":r+usa:", ":r+dancingbanana:")
	// arrives as literal text in the API — with no confirmed emote image CDN
	// to render it as a graphic (see messageEl() below), showing the raw code
	// just reads as garbled noise. Stripped rather than left in.
	var EMOTE_CODE_RE = /:r\+[a-z0-9_]+:/gi;

	// Rumble's own system account, per PHASE-0-FINDINGS.md ("the feed includes
	// Rumble's own TheRumbleBot posting membership promos"). Matched
	// case-insensitively; add more here if Rumble ever introduces other
	// system accounts — this is the one place that list lives.
	var BOT_USERNAMES = [ 'therumblebot' ];

	var KNOWN_BADGES = {
		verified: { label: 'Verified', cls: 'fl-tag--rumble-verified' },
		recurring_subscription: { label: 'Subscriber', cls: 'fl-tag--rumble-sub' },
		'whale-yellow': { label: 'Whale', cls: 'fl-tag--rumble-whale' },
	};

	// Admin-configurable default (Task G's "Chat & Tips" panel), falling back
	// to on if the config global isn't present. A visitor's own choice
	// (loadHideBotsPreference(), localStorage) always overrides this.
	var HIDE_BOTS_ADMIN_DEFAULT =
		! window.fourlibertyChatTips || window.fourlibertyChatTips.hideBotDefault !== false;

	var HIDE_BOTS_CLASS = 'fl-hide-rumble-bots';

	// Same roster live-state.js reads (order + per-show "enabled") — only
	// consulted in standalone mode (see computeHeroKeyLocally() below).
	var CONFIG = window.fourlibertyLiveShows || { order: [], shows: {} };

	var els = null;
	var pollTimer = null;
	var standalone = false; // true when there's no hero-player to take cues from
	var state = {
		channelsByKey: {},
		currentKey: null, // set from the "fl:hero-state" event; null = dark
		hideBots: HIDE_BOTS_ADMIN_DEFAULT,
		// created_on (ms) of the newest Rumble message already appended to the
		// merged feed. Reset to 0 whenever the hero key changes so that
		// channel's current backlog shows as a fresh batch instead of nothing.
		lastAppendedAt: 0,
	};

	function isBotUsername( username ) {
		return typeof username === 'string' && BOT_USERNAMES.indexOf( username.toLowerCase() ) !== -1;
	}

	function parseTimestamp( iso ) {
		var t = iso ? Date.parse( iso ) : NaN;
		return isFinite( t ) ? t : 0;
	}

	function cleanText( text ) {
		return ( text || '' ).replace( EMOTE_CODE_RE, '' ).replace( /\s+/g, ' ' ).trim();
	}

	function showEnabled( key ) {
		var cfg = CONFIG.shows && CONFIG.shows[ key ];
		return ! cfg || cfg.enabled !== false;
	}

	/**
	 * Standalone-mode only (see file header) — same priority order live-
	 * state.js's pickHero() uses, first enabled channel that's actually
	 * live wins. No pinning, no hysteresis: those exist there to protect an
	 * already-*playing* viewer from being yanked mid-video, which has no
	 * equivalent concept in a chat-only window.
	 */
	function computeHeroKeyLocally() {
		var order = CONFIG.order || [];
		for ( var i = 0; i < order.length; i++ ) {
			var key = order[ i ];
			var channel = state.channelsByKey[ key ];
			if ( channel && channel.is_live && showEnabled( key ) ) {
				return key;
			}
		}
		return null;
	}

	/**
	 * Shared by the real "fl:hero-state" event handler and standalone mode's
	 * own poll-driven key computation — same key-change reaction either way.
	 */
	function applyHeroKey( newKey ) {
		if ( newKey !== state.currentKey ) {
			clearRumbleRows(); // that show's over (or a different one took over) — its chat goes with it
			state.lastAppendedAt = 0; // fresh channel (or dark->live) — show its current backlog
			state.currentKey = newKey;
		}
		updateJoinLink();
		appendNewMessages();
	}

	function loadHideBotsPreference() {
		try {
			var stored = window.localStorage.getItem( HIDE_BOTS_STORAGE_KEY );
			if ( stored !== null ) {
				state.hideBots = stored === '1';
			}
		} catch ( e ) {
			// Private browsing / storage disabled — the in-memory default holds.
		}
	}

	function saveHideBotsPreference() {
		try {
			window.localStorage.setItem( HIDE_BOTS_STORAGE_KEY, state.hideBots ? '1' : '0' );
		} catch ( e ) {
			// Nothing to do — the preference just won't persist this session.
		}
	}

	function applyHideBotsClass() {
		if ( els && els.feed ) {
			els.feed.classList.toggle( HIDE_BOTS_CLASS, state.hideBots );
		}
	}

	function badgeEl( badge ) {
		var known = KNOWN_BADGES[ badge ];
		var span = document.createElement( 'span' );
		span.className = 'fl-tag ' + ( known ? known.cls : 'fl-tag--rumble-verified' );
		span.textContent = known ? known.label : badge;
		return span;
	}

	function messageEl( msg ) {
		var isBot = isBotUsername( msg.username );

		var row = document.createElement( 'div' );
		row.className = 'fl-msg' + ( msg.is_rant ? ' fl-msg--rant' : '' ) + ( isBot ? ' fl-msg--bot' : '' );
		row.setAttribute( 'data-fl-source', 'rumble' );
		if ( msg.created_on ) {
			row.title = msg.created_on;
		}

		var av = document.createElement( 'span' );
		av.className = 'fl-msg__av';
		if ( msg.profile_pic_url ) {
			var img = document.createElement( 'img' );
			img.src = msg.profile_pic_url;
			img.alt = '';
			img.loading = 'lazy';
			img.addEventListener( 'error', function () {
				img.remove();
			} );
			av.appendChild( img );
		}

		var body = document.createElement( 'span' );
		body.className = 'fl-msg__body';

		var who = document.createElement( 'span' );
		who.className = 'fl-msg__who';
		who.textContent = msg.username || 'Rumble viewer';
		body.appendChild( who );

		if ( isBot ) {
			body.appendChild( document.createTextNode( ' ' ) );
			var botTag = document.createElement( 'span' );
			botTag.className = 'fl-tag';
			botTag.textContent = 'BOT';
			body.appendChild( botTag );
		}

		( msg.badges || [] ).forEach( function ( badge ) {
			body.appendChild( document.createTextNode( ' ' ) );
			body.appendChild( badgeEl( badge ) );
		} );

		if ( msg.is_rant ) {
			body.appendChild( document.createTextNode( ' ' ) );
			var amount = document.createElement( 'span' );
			amount.className = 'fl-msg__amount';
			amount.textContent = 'rants $' + msg.amount_dollars;
			body.appendChild( amount );
		}

		// Rendered via textContent, so real Unicode/emoji display correctly.
		// Rumble's own emote codes (e.g. ":r+usa:") are stripped by
		// cleanText() before this ever runs — no confirmed emote image CDN
		// to render them as graphics, and the raw code is just noise.
		body.appendChild( document.createTextNode( ' ' + cleanText( msg.text ) ) );

		var source = document.createElement( 'span' );
		source.className = 'fl-tag fl-tag--rumble-source';
		source.textContent = 'via Rumble';
		body.appendChild( document.createTextNode( ' ' ) );
		body.appendChild( source );

		row.appendChild( av );
		row.appendChild( body );
		return row;
	}

	/**
	 * Drops the oldest Rumble-sourced rows once there are more than
	 * MAX_RUMBLE_ROWS showing — keeps the feed at "the most recent real
	 * comments from Rumble" (Austin's own framing) instead of accumulating
	 * an entire show's chat. Only ever touches rows tagged
	 * data-fl-source="rumble"; the on-site chat's own history is untouched.
	 */
	function pruneOldRumbleRows() {
		if ( ! els || ! els.feed ) {
			return;
		}
		var rows = els.feed.querySelectorAll( '[data-fl-source="rumble"]' );
		var excess = rows.length - MAX_RUMBLE_ROWS;
		for ( var i = 0; i < excess; i++ ) {
			rows[ i ].remove();
		}
	}

	/**
	 * Clears every Rumble-sourced row from the feed — called whenever the
	 * hero key changes (a show ending, or a different show taking over).
	 * Old chat from a broadcast that's over is noise, not history worth
	 * keeping (Austin: "it should clear out after every show is over").
	 */
	function clearRumbleRows() {
		if ( ! els || ! els.feed ) {
			return;
		}
		var rows = els.feed.querySelectorAll( '[data-fl-source="rumble"]' );
		for ( var i = 0; i < rows.length; i++ ) {
			rows[ i ].remove();
		}
	}

	/**
	 * Hands every Rumble message newer than state.lastAppendedAt to chat.js,
	 * oldest first (sanitize.mts's pickChatMessages() already sorts
	 * ascending, so no re-sort needed here). A no-op if chat.js's feed isn't
	 * ready yet or nothing's new — safe to call from both the poll and a
	 * hero-state change. Messages that are pure Rumble emote shorthand
	 * (cleanText() strips it all, leaving nothing) are skipped rather than
	 * shown as an empty line — a rant still shows even with no text, since
	 * the dollar amount alone is meaningful.
	 */
	function appendNewMessages() {
		if ( ! window.FLHub || ! window.FLHub.chat || ! state.currentKey ) {
			return;
		}
		var channel = state.channelsByKey[ state.currentKey ];
		if ( ! channel || ! channel.is_live ) {
			return;
		}

		var fresh = ( channel.chat || [] ).filter( function ( m ) {
			return parseTimestamp( m.created_on ) > state.lastAppendedAt;
		} );
		if ( ! fresh.length ) {
			return;
		}

		fresh.forEach( function ( msg ) {
			var ts = parseTimestamp( msg.created_on );
			if ( ts > state.lastAppendedAt ) {
				state.lastAppendedAt = ts;
			}
			if ( ! msg.is_rant && ! cleanText( msg.text ) ) {
				return;
			}
			window.FLHub.chat.appendExternalMessage( messageEl( msg ) );
		} );

		pruneOldRumbleRows();
	}

	function updateJoinLink() {
		if ( ! els.joinLink ) {
			return;
		}
		var channel = state.currentKey ? state.channelsByKey[ state.currentKey ] : null;
		if ( channel && channel.is_live && channel.channel ) {
			// Best-guess Rumble channel URL format — same unverified pattern
			// already flagged elsewhere (fourliberty_live_shows_config()'s WUA
			// gatedUrl in functions.php). Confirm the real format before
			// leaning on this further.
			els.joinLink.href = 'https://rumble.com/c/' + encodeURIComponent( channel.channel );
			els.joinLink.hidden = false;
		} else {
			els.joinLink.hidden = true;
		}
	}

	function onHeroStateChange( evt ) {
		applyHeroKey( evt.detail && evt.detail.live ? evt.detail.key : null );
	}

	function fetchState() {
		fetch( ENDPOINT, { cache: 'no-store', mode: 'cors' } )
			.then( function ( res ) {
				if ( ! res.ok ) {
					throw new Error( 'bad status ' + res.status );
				}
				return res.json();
			} )
			.then( function ( payload ) {
				if ( ! payload || ! Array.isArray( payload.channels ) ) {
					return;
				}
				var byKey = {};
				payload.channels.forEach( function ( c ) {
					byKey[ c.key ] = c;
				} );
				state.channelsByKey = byKey;
				if ( standalone ) {
					applyHeroKey( computeHeroKeyLocally() );
				} else {
					updateJoinLink();
					appendNewMessages();
				}
			} )
			.catch( function () {
				// A fetch hiccup just means no new Rumble messages this round —
				// same fail-safe spirit as live-state.js's own handleUnavailable().
			} );
	}

	function tick() {
		if ( ! document.hidden ) {
			fetchState();
		}
		pollTimer = setTimeout( tick, POLL_INTERVAL_MS );
	}

	function wireHideBotsToggle() {
		if ( ! els.hideBots ) {
			return;
		}
		els.hideBots.checked = state.hideBots;
		applyHideBotsClass();
		els.hideBots.addEventListener( 'change', function () {
			state.hideBots = els.hideBots.checked;
			saveHideBotsPreference();
			applyHideBotsClass();
		} );
	}

	function init() {
		var feed = document.querySelector( '[data-fl="chat-feed"]' );
		if ( ! feed ) {
			return; // the chat rail isn't on this page
		}

		els = {
			feed: feed,
			joinLink: document.querySelector( '[data-fl="rumble-join-link"]' ),
			hideBots: document.querySelector( '[data-fl="rumble-hide-bots"]' ),
		};
		standalone = ! document.querySelector( '[data-fl="hero-player"]' );

		loadHideBotsPreference();
		wireHideBotsToggle();

		if ( ! standalone ) {
			document.addEventListener( 'fl:hero-state', onHeroStateChange );
		}

		fetchState();
		pollTimer = setTimeout( tick, POLL_INTERVAL_MS );
		document.addEventListener( 'visibilitychange', function () {
			if ( document.visibilityState === 'visible' ) {
				fetchState();
			}
		} );
	}

	document.addEventListener( 'DOMContentLoaded', init );
} )();
