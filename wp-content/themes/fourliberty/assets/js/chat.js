/**
 * 4Liberty Network — on-site hub chat (Phase 3, tasks C/F/H).
 *
 * Mounts a custom UI on Stream Chat into the rail hooks Phase 1 left in
 * patterns/hero-live.php: [data-fl="chat-rail"], "chat-count", "chat-feed".
 * The composer and "chatting as X — change" control are injected here, not
 * present in the Phase 1 markup — same pattern live-state.js already uses
 * for its gated CTA / "just went live" banner.
 *
 * One persistent channel for the whole network (PHASE-3-BUILD-PLAN.md
 * Decision 5) — chat is available whenever the page is open, live or dark,
 * unlike the Phase-1-era stub copy it replaces ("opens when a show is
 * live"). Anonymous (Task C) and authenticated, persistent (Task F) both
 * share this same flow via window.FLHub.chat/identity. Task H adds gated
 * mode (admin-toggled): an anonymous visitor sees a "log in to join"
 * message instead of the name field, enforced server-side in
 * chat-token.mts — this file's CONFIG.mode check is a UX nicety on top of
 * that, never the actual gate.
 *
 * Every value that comes from another visitor (name, message text, avatar
 * URL) is inserted via textContent/DOM properties, never innerHTML — chat
 * content is the least trustworthy input in this whole project (see
 * assets/js/rumble-mirror.js for the same rule applied to Rumble's chat).
 *
 * No build step in this theme — the Stream Chat client (an ESM-only package
 * as of v9) is loaded via a runtime dynamic import() from jsDelivr's +esm
 * endpoint rather than a bundled dependency.
 */
( function () {
	'use strict';

	var TOKEN_ENDPOINT =
		( window.fourlibertyChatTokenEndpoint && window.fourlibertyChatTokenEndpoint.url ) ||
		'https://4liberty-poller.netlify.app/api/chat-token';

	var CONFIG =
		window.fourlibertyChatTips || { chatEnabled: true, mode: 'open', tipPresets: [ 5, 17.76, 50 ] };

	var STREAM_SDK_URL = 'https://cdn.jsdelivr.net/npm/stream-chat@9.50.2/+esm';
	var NAME_STORAGE_KEY = 'fl-chat-display-name';
	var REACTION_EMOJIS = [ '🔥', '👏', '😂', '❤️', '🎉' ];
	// Marks a message as a floating reaction burst rather than a real chat
	// line — text is still set (to the emoji) so nothing renders blank if
	// this field is ever missed by an older client.
	var REACTION_FIELD = 'fl_reaction_burst';
	var MAX_MESSAGE_LENGTH = 500;
	var NEAR_BOTTOM_PX = 60;
	// Only the most recent history renders on connect (2026-07-23) — this
	// channel has real history stretching back through this project's own
	// development/QA testing, which otherwise every visitor sees in full on
	// first connect. New messages arriving live are never capped, only the
	// initial history load.
	var MAX_HISTORY_MESSAGES = 40;

	var els = null;
	var client = null;
	var channel = null;
	var connecting = false;
	var currentDisplayName = null;
	var currentHasSavedCard = false;
	var currentCardLast4 = null;

	// Lets assets/js/tips.js reuse whatever name a visitor is already
	// chatting under, so they don't have to type it twice, and check
	// whether the logged-in identity already has a saved card (for the
	// one-tap repeat button). All return sensible empty/false values if
	// chat isn't connected yet — tips.js falls back to its own name field.
	//
	// appendExternalMessage() is the same hook for assets/js/rumble-mirror.js
	// (Task: merged chat, 2026-07-23) — it needs to land Rumble's read-only
	// messages in this same feed rather than a separate box, without knowing
	// anything about Stream Chat internals. Defined unconditionally here (not
	// inside init()) so it exists as soon as this file parses, same reasoning
	// as the hooks above; it closes over `els`, which init() fills in once
	// the rail exists, so calls before that are simply safe no-ops.
	window.FLHub = window.FLHub || {};
	window.FLHub.chat = {
		getDisplayName: function () {
			return currentDisplayName;
		},
		hasSavedCard: function () {
			return currentHasSavedCard;
		},
		cardLast4: function () {
			return currentCardLast4;
		},
		appendExternalMessage: function ( rowEl ) {
			if ( els && els.feed && rowEl ) {
				appendRow( rowEl );
			}
		},
	};

	function loadSavedName() {
		try {
			return window.localStorage.getItem( NAME_STORAGE_KEY );
		} catch ( e ) {
			return null;
		}
	}

	function saveName( name ) {
		try {
			window.localStorage.setItem( NAME_STORAGE_KEY, name );
		} catch ( e ) {
			// Private browsing / storage disabled — just won't be remembered next visit.
		}
	}

	function clearFeed() {
		if ( els.feed ) {
			els.feed.innerHTML = '';
		}
	}

	function renderNotice( text ) {
		clearFeed();
		var row = document.createElement( 'div' );
		row.className = 'fl-msg';
		var body = document.createElement( 'span' );
		body.className = 'fl-msg__body';
		body.textContent = text;
		row.appendChild( body );
		els.feed.appendChild( row );
	}

	/**
	 * autofocus defaults on for the deliberate "change name" click in
	 * renderComposer() below, where jumping the keyboard/scroll to a freshly
	 * revealed input is expected. connectForCurrentIdentity() explicitly
	 * turns it off for the automatic page-load path — autofocusing there
	 * made mobile browsers scroll the whole page down to bring the input
	 * into view, shoving the live player (and its play button) off-screen
	 * before a visitor ever saw it (found 2026-07-23 from a real "play button
	 * does nothing" report that was actually "the button scrolled away").
	 */
	function renderNamePrompt( prefill, autofocus ) {
		clearFeed();
		var wrap = document.createElement( 'div' );
		wrap.className = 'fl-chat-prompt';

		var label = document.createElement( 'p' );
		label.className = 'fl-chat-prompt__label';
		label.textContent = 'Pick a name to join the chat.';

		var form = document.createElement( 'form' );
		form.className = 'fl-chat-prompt__form';

		var input = document.createElement( 'input' );
		input.type = 'text';
		input.maxLength = 30;
		input.placeholder = 'Your name';
		input.autocomplete = 'off';
		input.value = prefill || '';
		input.required = true;

		var button = document.createElement( 'button' );
		button.type = 'submit';
		button.textContent = 'Join chat';

		form.appendChild( input );
		form.appendChild( button );
		wrap.appendChild( label );
		wrap.appendChild( form );
		els.feed.appendChild( wrap );

		form.addEventListener( 'submit', function ( evt ) {
			evt.preventDefault();
			var name = input.value.trim();
			if ( ! name ) {
				return;
			}
			button.disabled = true;
			connect( { displayName: name } ).catch( function () {
				button.disabled = false;
			} );
		} );

		if ( autofocus ) {
			input.focus();
		}
	}

	/**
	 * Neither badge has a real signal to key off yet — 'admin'/'moderator'
	 * roles need manual Stream-dashboard setup (task 11), and 'supporter'
	 * needs the identity spine (Task F). Reusing the existing .fl-tag--mod /
	 * .fl-tag--patron classes from the Phase 1 stub means nothing here needs
	 * to change once either signal exists — it'll just start rendering.
	 */
	function knownBadge( user ) {
		if ( ! user ) {
			return null;
		}
		if ( user.role === 'admin' || user.role === 'moderator' ) {
			return { label: 'MOD', cls: 'fl-tag--mod' };
		}
		if ( user.supporter ) {
			return { label: 'SUPPORTER', cls: 'fl-tag--patron' };
		}
		return null;
	}

	function messageRow( msg ) {
		var row = document.createElement( 'div' );
		row.className = 'fl-msg fl-msg--enter';

		var av = document.createElement( 'span' );
		av.className = 'fl-msg__av';
		if ( msg.user && msg.user.image ) {
			var img = document.createElement( 'img' );
			img.src = msg.user.image;
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
		who.textContent = ( msg.user && ( msg.user.name || msg.user.id ) ) || 'Someone';
		body.appendChild( who );

		var badge = knownBadge( msg.user );
		if ( badge ) {
			body.appendChild( document.createTextNode( ' ' ) );
			var tag = document.createElement( 'span' );
			tag.className = 'fl-tag ' + badge.cls;
			tag.textContent = badge.label;
			body.appendChild( tag );
		}

		body.appendChild( document.createTextNode( ' ' + ( msg.text || '' ) ) );

		row.appendChild( av );
		row.appendChild( body );
		return row;
	}

	function reactionBurstEl( emoji ) {
		var el = document.createElement( 'span' );
		el.className = 'fl-reaction-burst';
		el.textContent = emoji;
		el.style.left = 10 + Math.random() * 70 + '%';
		el.addEventListener( 'animationend', function () {
			el.remove();
		} );
		return el;
	}

	// Shared by Stream messages and Rumble's externally-sourced ones (see
	// window.FLHub.chat.appendExternalMessage above) — the "smart autoscroll"
	// rule (don't yank someone back down who scrolled up to read history)
	// applies equally to either source.
	function appendRow( rowEl ) {
		var wasNearBottom = els.feed.scrollHeight - els.feed.scrollTop - els.feed.clientHeight < NEAR_BOTTOM_PX;
		els.feed.appendChild( rowEl );
		if ( wasNearBottom ) {
			els.feed.scrollTop = els.feed.scrollHeight;
		}
	}

	function appendMessage( msg ) {
		if ( ! els.feed ) {
			return;
		}
		if ( msg[ REACTION_FIELD ] ) {
			if ( els.reactionLayer ) {
				els.reactionLayer.appendChild( reactionBurstEl( msg[ REACTION_FIELD ] ) );
			}
			return;
		}
		appendRow( messageRow( msg ) );
	}

	function renderHistory( messages ) {
		clearFeed();
		var real = ( messages || [] )
			.filter( function ( m ) {
				return ! m[ REACTION_FIELD ];
			} )
			.slice( -MAX_HISTORY_MESSAGES );

		if ( ! real.length ) {
			var empty = document.createElement( 'div' );
			empty.className = 'fl-msg';
			var body = document.createElement( 'span' );
			body.className = 'fl-msg__body';
			body.textContent = 'No messages yet — say hello!';
			empty.appendChild( body );
			els.feed.appendChild( empty );
		} else {
			real.forEach( function ( m ) {
				els.feed.appendChild( messageRow( m ) );
			} );
		}
		els.feed.scrollTop = els.feed.scrollHeight;
	}

	function updateCount() {
		if ( ! els.count || ! channel ) {
			return;
		}
		var n = ( channel.state && channel.state.watcher_count ) || 0;
		els.count.textContent = n === 1 ? '1 watching' : n + ' watching';
	}

	function renderComposer( displayName, isAuthenticated ) {
		if ( els.composer ) {
			els.composer.remove();
		}

		var wrap = document.createElement( 'div' );
		wrap.className = 'fl-composer';
		wrap.setAttribute( 'data-fl', 'chat-composer' );

		var identity = document.createElement( 'div' );
		identity.className = 'fl-composer__identity';
		identity.appendChild( document.createTextNode( 'Chatting as ' ) );
		var strong = document.createElement( 'strong' );
		strong.textContent = displayName;
		identity.appendChild( strong );
		identity.appendChild( document.createTextNode( ' · ' ) );
		var change = document.createElement( 'button' );
		change.type = 'button';
		change.className = 'fl-composer__change';
		// A logged-in identity isn't a typed name to "change" — the
		// equivalent action is logging out, which identity.onChange()
		// picks up and reconnects us anonymously.
		change.textContent = isAuthenticated ? 'log out' : 'change';
		change.addEventListener( 'click', function () {
			if ( isAuthenticated && window.FLHub.identity ) {
				window.FLHub.identity.logout();
				return;
			}
			disconnect();
			wrap.remove();
			els.composer = null;
			renderNamePrompt( displayName, true );
		} );
		identity.appendChild( change );

		var reactions = document.createElement( 'div' );
		reactions.className = 'fl-composer__reactions';
		REACTION_EMOJIS.forEach( function ( emoji ) {
			var btn = document.createElement( 'button' );
			btn.type = 'button';
			btn.setAttribute( 'aria-label', 'Send ' + emoji + ' reaction' );
			btn.textContent = emoji;
			btn.addEventListener( 'click', function () {
				if ( channel ) {
					var payload = {};
					payload.text = emoji;
					payload[ REACTION_FIELD ] = emoji;
					channel.sendMessage( payload ).catch( function () {} );
				}
			} );
			reactions.appendChild( btn );
		} );

		var form = document.createElement( 'form' );
		form.className = 'fl-composer__form';
		var input = document.createElement( 'input' );
		input.type = 'text';
		input.maxLength = MAX_MESSAGE_LENGTH;
		input.placeholder = 'Say something…';
		input.autocomplete = 'off';
		var sendBtn = document.createElement( 'button' );
		sendBtn.type = 'submit';
		sendBtn.textContent = 'Send';
		form.appendChild( input );
		form.appendChild( sendBtn );

		form.addEventListener( 'submit', function ( evt ) {
			evt.preventDefault();
			var text = input.value.trim();
			if ( ! text || ! channel ) {
				return;
			}
			input.value = '';
			channel.sendMessage( { text: text } ).catch( function () {
				input.value = text; // let them retry rather than silently losing the message
			} );
		} );

		wrap.appendChild( identity );
		wrap.appendChild( reactions );
		wrap.appendChild( form );

		els.chatRail.insertBefore( wrap, els.tipBar || null );
		els.composer = wrap;
	}

	function wireChannelEvents() {
		channel.on( 'message.new', function ( event ) {
			appendMessage( event.message );
		} );
		channel.on( 'user.watching.start', updateCount );
		channel.on( 'user.watching.stop', updateCount );
	}

	function disconnect() {
		if ( client ) {
			client.disconnectUser().catch( function () {} );
		}
		client = null;
		channel = null;
		currentDisplayName = null;
		currentHasSavedCard = false;
		currentCardLast4 = null;
	}

	function loadStreamSdk() {
		return import( STREAM_SDK_URL ).then( function ( mod ) {
			return mod.StreamChat;
		} );
	}

	/**
	 * opts: { session: {token, displayName, ...} } for the authenticated
	 * path (Task F), or { displayName: string } for the anonymous one
	 * (Task C, unchanged). Exactly one is set by any given caller.
	 */
	function connect( opts ) {
		if ( connecting ) {
			return Promise.resolve();
		}
		connecting = true;
		renderNotice( 'Connecting…' );

		var session = opts.session || null;
		var requestBody = session
			? { sessionToken: session.token, displayName: session.displayName }
			: { displayName: opts.displayName };

		return fetch( TOKEN_ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify( requestBody ),
		} )
			.then( function ( res ) {
				if ( res.status === 403 ) {
					return res.json().then( function ( body ) {
						var err = new Error( 'members_only' );
						err.membersOnly = !! ( body && body.error === 'chat_is_members_only' );
						throw err;
					} );
				}
				if ( ! res.ok ) {
					throw new Error( 'token endpoint returned ' + res.status );
				}
				return res.json();
			} )
			.then( function ( data ) {
				return loadStreamSdk()
					.then( function ( StreamChat ) {
						client = StreamChat.getInstance( data.apiKey );
						return client.connectUser( { id: data.userId, name: data.userName }, data.token ).then(
							function () {
								channel = client.channel( data.channelType, data.channelId );
								return channel.watch();
							}
						);
					} )
					.then( function () {
						return data;
					} );
			} )
			.then( function ( data ) {
				currentDisplayName = data.userName;
				currentHasSavedCard = !! data.hasSavedCard;
				currentCardLast4 = data.cardLast4 || null;
				if ( ! session ) {
					// Only the anonymous path persists a "remember my typed
					// name" shortcut — a logged-in identity is already
					// persisted by account.js's own session storage.
					saveName( currentDisplayName );
				}
				wireChannelEvents();
				renderHistory( channel.state.messages );
				renderComposer( currentDisplayName, !! session );
				updateCount();
				connecting = false;
			} )
			.catch( function ( error ) {
				connecting = false;
				renderNotice(
					error && error.membersOnly
						? 'This chat is for logged-in members — log in above to join.'
						: 'Chat’s taking a break — check back soon.'
				);
				throw error;
			} );
	}

	/**
	 * "Pop out" button (2026-07-23) — only present in the main page's rail
	 * markup (patterns/hero-live.php), never in templates/
	 * chat-popup-template.php itself, so there's nothing to guard against a
	 * popup-inside-a-popup here. A named target means clicking it twice
	 * re-focuses the same window instead of spawning duplicates.
	 */
	function wirePopoutButton( rail ) {
		var btn = rail.querySelector( '[data-fl="chat-popout"]' );
		if ( ! btn ) {
			return;
		}
		btn.addEventListener( 'click', function () {
			window.open(
				'/?fl_chat_popup=1',
				'flChatPopup',
				'width=380,height=640,resizable=yes,scrollbars=yes'
			);
		} );
	}

	function init() {
		var rail = document.querySelector( '[data-fl="chat-rail"]' );
		if ( ! rail || ! CONFIG.chatEnabled ) {
			return;
		}

		els = {
			chatRail: rail,
			count: rail.querySelector( '[data-fl="chat-count"]' ),
			feed: rail.querySelector( '[data-fl="chat-feed"]' ),
			tipBar: rail.querySelector( '[data-fl="tip-bar"]' ),
			composer: null,
			reactionLayer: null,
		};

		wirePopoutButton( rail );

		if ( ! els.feed ) {
			return;
		}

		// Floating reaction bursts render above everything in the rail, not
		// inside the scrolling feed — they shouldn't scroll away with history.
		els.reactionLayer = document.createElement( 'div' );
		els.reactionLayer.className = 'fl-reaction-layer';
		if ( ! els.chatRail.style.position ) {
			els.chatRail.style.position = 'relative';
		}
		els.chatRail.appendChild( els.reactionLayer );

		if ( window.FLHub && window.FLHub.identity ) {
			window.FLHub.identity.onChange( handleIdentityChange );
		}
		connectForCurrentIdentity();
	}

	/**
	 * The one place that decides "who are we connecting as right now" —
	 * used both by init() (first load) and handleIdentityChange() (a
	 * login/logout happening after chat is already up). A logged-in
	 * session always wins; otherwise fall back to Task C's anonymous flow —
	 * unless gated mode (Task H) means that flow is pointless, in which case
	 * skip straight to the "log in to join" message rather than showing a
	 * name field that can only ever fail server-side.
	 */
	function connectForCurrentIdentity() {
		var session = window.FLHub && window.FLHub.identity && window.FLHub.identity.getSession();
		if ( session ) {
			connect( { session: session } ).catch( function () {} );
			return;
		}
		if ( CONFIG.mode === 'gated' ) {
			renderNotice( 'This chat is for logged-in members — log in above to join.' );
			return;
		}
		var saved = loadSavedName();
		if ( saved ) {
			connect( { displayName: saved } ).catch( function () {} );
		} else {
			renderNamePrompt( '', false );
		}
	}

	/**
	 * Fires after account.js completes a login or logout. Handles the
	 * common real case head-on: clicking a magic-link email is a fresh
	 * page load, so this file's init() has usually already connected
	 * anonymously by the time the async auth-verify call resolves moments
	 * later — without this, a visitor's first login would silently NOT
	 * upgrade their chat identity until they manually reloaded.
	 */
	function handleIdentityChange() {
		disconnect();
		if ( els.composer ) {
			els.composer.remove();
			els.composer = null;
		}
		connectForCurrentIdentity();
	}

	document.addEventListener( 'DOMContentLoaded', init );
} )();
