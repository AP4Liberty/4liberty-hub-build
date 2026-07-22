/**
 * 4Liberty Network — Dark Channel playout engine (Phase 2, task F).
 *
 * Takes over the homepage hero slot ([data-fl="hero-player"], the same
 * element live-state.js drives) whenever no show is live. Decoupled from
 * live-state.js on purpose — neither script imports the other — via the
 * small public seam live-state.js exposes for exactly this (see the
 * "Public hooks for the Dark Channel playout engine" comment there):
 *   - listens for the "fl:hero-state" DOM event to know when to take over
 *     (dark) vs. get out of the way (live);
 *   - calls window.FLHub.liveState.setFacadeActive(bool) whenever it starts
 *     or stops actually playing something, so Decision 6 (never yank a
 *     playing hero) applies to Dark Channel viewers too.
 *
 * Decision 4 (wall-clock scheduling): position = (now - epoch) mod (total
 * playlist duration), epoch = the Unix epoch. Every visitor computes the
 * same "what item is on right now" independently — no server round trip
 * needed for that part, which is what makes two people tuning in at
 * different times see the same programming.
 *
 * Ad cadence is deliberately its OWN, per-session counter rather than baked
 * into that shared cumulative-duration schedule: ad durations aren't known
 * ahead of time (the admin only collects a video ID + label, not a
 * duration — see settings-dark-channel.php), so they can't be folded into a
 * position formula the way playlist items can. Decision 4's own wording is
 * "total PLAYLIST duration" — ads aren't part of it. Practically this means
 * the shared "what's on" schedule is exactly in sync across visitors; how
 * often any one visitor sees an ad inserted is a local, per-session count
 * (still fully admin-adjustable — "every N items" / "every M minutes" per
 * PHASE-0-FINDINGS.md — just not part of the synchronized broadcast clock).
 *
 * End-of-item detection, per PHASE-2-BUILD-PLAN.md task C's result: YouTube's
 * `ended` state (via the standard IFrame Player API) is reliable and used as
 * the primary signal; Rumble's equivalent is `videoEnd` (confirmed live
 * during the task C spike, see test/rumble-ended-spike.html) and used the
 * same way. Both also carry a wall-clock duration-timer fallback — the
 * event is the nice-to-have for tight transitions, the timer is what
 * actually guarantees the channel never gets stuck (Decision 4's whole
 * point: the schedule is clock-driven regardless of whether any single
 * player's event fires).
 *
 * Known limitation, by design, not an oversight: mid-item seeking on join
 * is only implemented for YouTube (a documented, standard `seekTo()`).
 * Rumble's embed JS API doesn't have a confirmed seek method (its dev docs
 * host, player.rumble.com, refuses connections — see task C's writeup), so
 * a Rumble item a visitor joins mid-way always starts from 0:00 for that
 * visitor. The shared schedule still advances on time regardless (this
 * visitor's Rumble item just runs a little long from their perspective) —
 * the "everyone sees the same channel" property that matters (no one stuck
 * on item 1 forever) is preserved either way.
 */
( function () {
	'use strict';

	var CONFIG =
		window.fourlibertyDarkChannel && Array.isArray( window.fourlibertyDarkChannel.playlist )
			? window.fourlibertyDarkChannel
			: { playlist: [], ads: [], adCadence: { mode: 'every_n_items', n: 4 } };

	var AD_FALLBACK_MAX_MS = 3 * 60 * 1000; // safety backstop if an ad's own 'ended' event never fires
	var END_BUFFER_MS = 800; // small cushion so the duration-timer fires just after a well-behaved 'ended' event, not before

	var els = null;
	var state = {
		active: false, // true once Dark Channel owns the hero slot (i.e., currently DARK)
		playing: false, // true once a real player is loaded & actively playing (drives setFacadeActive)
		endTimer: null,
		endHandled: false, // debounce: event + timer racing must only advance once
		itemsSinceAd: 0,
		lastAdAt: 0,
		adIndex: 0,
		currentIsAd: false,
		ytPlayer: null,
		rumblePlayer: null, // the Rumble embed-JS "api" object for the current item, if any
		muted: true,
	};

	function totalPlaylistSeconds() {
		return CONFIG.playlist.reduce( function ( sum, item ) {
			return sum + ( Number( item.duration_seconds ) || 0 );
		}, 0 );
	}

	/**
	 * Decision 4's formula. Walks the playlist's cumulative durations to
	 * find which item wall-clock "now" falls inside, and how far into that
	 * item we are. Recomputed fresh every time we need it — never cached
	 * across a wait — so drift (buffering, a backgrounded tab, an ad that
	 * ran long) self-corrects instead of accumulating.
	 */
	function currentScheduleItem() {
		var total = totalPlaylistSeconds();
		if ( ! CONFIG.playlist.length || total <= 0 ) {
			return null;
		}
		var position = ( Math.floor( Date.now() / 1000 ) ) % total;
		var cursor = 0;
		for ( var i = 0; i < CONFIG.playlist.length; i++ ) {
			var duration = Number( CONFIG.playlist[ i ].duration_seconds ) || 0;
			if ( position < cursor + duration ) {
				return { item: CONFIG.playlist[ i ], index: i, offsetSeconds: position - cursor };
			}
			cursor += duration;
		}
		return { item: CONFIG.playlist[ 0 ], index: 0, offsetSeconds: 0 }; // rounding fallback
	}

	function adCadenceDue() {
		if ( ! CONFIG.ads || ! CONFIG.ads.length ) {
			return false;
		}
		var cadence = CONFIG.adCadence || {};
		if ( cadence.mode === 'every_m_minutes' ) {
			var minutes = Number( cadence.m ) || 0;
			return minutes > 0 && Date.now() - state.lastAdAt >= minutes * 60 * 1000;
		}
		var n = Number( cadence.n ) || 0;
		return n > 0 && state.itemsSinceAd >= n;
	}

	function nextAd() {
		var ad = CONFIG.ads[ state.adIndex % CONFIG.ads.length ];
		state.adIndex++;
		return ad;
	}

	/* ---------- YouTube IFrame API (shared loader) ---------- */

	var ytApiPromise = null;
	function ensureYouTubeApi() {
		if ( ytApiPromise ) {
			return ytApiPromise;
		}
		ytApiPromise = new Promise( function ( resolve ) {
			if ( window.YT && window.YT.Player ) {
				resolve();
				return;
			}
			var previous = window.onYouTubeIframeAPIReady;
			window.onYouTubeIframeAPIReady = function () {
				if ( typeof previous === 'function' ) {
					previous();
				}
				resolve();
			};
			var tag = document.createElement( 'script' );
			tag.src = 'https://www.youtube.com/iframe_api';
			document.head.appendChild( tag );
		} );
		return ytApiPromise;
	}

	/* ---------- Facade / DOM ---------- */

	function buildFacade() {
		if ( els.facade ) {
			return;
		}
		var facade = document.createElement( 'div' );
		facade.className = 'fl-dark-channel';
		facade.setAttribute( 'data-fl', 'dark-channel' );

		var stage = document.createElement( 'div' );
		stage.className = 'fl-dark-channel__stage';
		stage.setAttribute( 'data-fl', 'dark-channel-stage' );

		var poster = document.createElement( 'div' );
		poster.className = 'fl-dark-channel__poster';

		var playBtn = document.createElement( 'button' );
		playBtn.type = 'button';
		playBtn.className = 'fl-play fl-dark-channel__play';
		playBtn.setAttribute( 'aria-label', 'Play the network channel' );
		playBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>';
		playBtn.addEventListener( 'click', startPlayback );

		var muteBtn = document.createElement( 'button' );
		muteBtn.type = 'button';
		muteBtn.className = 'fl-dark-channel__mute';
		muteBtn.setAttribute( 'aria-label', 'Unmute' );
		muteBtn.hidden = true;
		muteBtn.textContent = '🔇 Tap to unmute';
		muteBtn.addEventListener( 'click', toggleMute );

		var meta = document.createElement( 'div' );
		meta.className = 'fl-dark-channel__meta';
		var badge = document.createElement( 'div' );
		badge.className = 'fl-dark-channel__badge';
		badge.textContent = 'On Now · 4Liberty Network';
		var title = document.createElement( 'h2' );
		title.className = 'fl-dark-channel__title';

		meta.appendChild( badge );
		meta.appendChild( title );

		stage.appendChild( poster );
		stage.appendChild( playBtn );
		facade.appendChild( stage );
		facade.appendChild( muteBtn );
		facade.appendChild( meta );

		els.player.appendChild( facade );

		els.facade = facade;
		els.poster = poster;
		els.playBtn = playBtn;
		els.muteBtn = muteBtn;
		els.title = title;
		els.stage = stage;
	}

	function renderCurrentLabel() {
		var sched = currentScheduleItem();
		if ( ! sched || ! els.title ) {
			return;
		}
		els.title.textContent = sched.item.title || 'The 4Liberty Network';
		if ( els.poster ) {
			var thumb = sched.item.thumbnail;
			if ( ! thumb && sched.item.type === 'youtube' && sched.item.source_id ) {
				thumb = 'https://img.youtube.com/vi/' + encodeURIComponent( sched.item.source_id ) + '/hqdefault.jpg';
			}
			els.poster.style.backgroundImage = thumb ? 'url(' + thumb + ')' : '';
		}
	}

	/* ---------- Lifecycle: activate (go dark) / deactivate (go live) ---------- */

	function activate() {
		if ( state.active || ! CONFIG.playlist.length ) {
			return; // idempotent; also a no-op with an empty playlist (Decision 7 — nothing broken, just no facade)
		}
		state.active = true;
		els.player.classList.add( 'is-dark-channel' );
		buildFacade();
		renderCurrentLabel();
		// Keep the visible "now playing" label current even before anyone
		// presses play, and across item boundaries while idle.
		clearInterval( state.labelInterval );
		state.labelInterval = setInterval( renderCurrentLabel, 15000 );
	}

	function deactivate() {
		clearInterval( state.labelInterval );
		teardownPlayer();
		if ( els.facade ) {
			els.facade.parentNode.removeChild( els.facade );
			els.facade = null;
		}
		els.player.classList.remove( 'is-dark-channel' );
		state.active = false;
		state.playing = false;
		setFacadeActive( false );
	}

	function onHeroStateChange( e ) {
		if ( e.detail && e.detail.live ) {
			deactivate();
		} else {
			activate();
		}
	}

	function setFacadeActive( active ) {
		state.playing = !! active;
		if ( els.facade ) {
			els.facade.classList.toggle( 'is-playing', state.playing );
		}
		if ( window.FLHub && window.FLHub.liveState && window.FLHub.liveState.setFacadeActive ) {
			window.FLHub.liveState.setFacadeActive( active );
		}
	}

	/* ---------- Playback ---------- */

	function startPlayback() {
		if ( ! state.active ) {
			return;
		}
		// Inline style, not the `hidden` attribute — editorial.css's own
		// `.fl-play { display: grid }` rule is an author-stylesheet class
		// selector of equal specificity to the UA `[hidden]` rule, so it can
		// win the cascade and leave the button visible; an inline style
		// can't lose that fight. Belt-and-suspenders with the CSS-driven
		// `.is-playing` hide that follows shortly via setFacadeActive().
		els.playBtn.style.display = 'none';
		playScheduled();
	}

	function playScheduled() {
		var sched = currentScheduleItem();
		if ( ! sched ) {
			return;
		}
		loadItem( sched.item, sched.offsetSeconds, false );
	}

	function teardownPlayer() {
		clearTimeout( state.endTimer );
		state.endTimer = null;
		if ( state.ytPlayer ) {
			try {
				state.ytPlayer.destroy();
			} catch ( err ) {
				/* player was already gone (e.g. tab teardown mid-load) — nothing to clean up */
			}
			state.ytPlayer = null;
		}
		if ( state.rumblePlayer ) {
			state.rumblePlayer = null; // the iframe itself is removed with els.stage's children below
		}
		if ( els.stage ) {
			var mount = els.stage.querySelector( '[data-fl="dark-channel-mount"]' );
			if ( mount ) {
				mount.parentNode.removeChild( mount );
			}
		}
		setFacadeActive( false );
	}

	function loadItem( item, offsetSeconds, isAd ) {
		teardownPlayer();
		state.endHandled = false;
		state.currentIsAd = !! isAd;
		if ( els.muteBtn ) {
			els.muteBtn.hidden = true;
		}
		renderCurrentLabel();
		if ( els.title && isAd ) {
			els.title.textContent = item.title || 'Advertisement';
		}

		if ( item.type === 'youtube' ) {
			loadYouTube( item, offsetSeconds, isAd );
		} else if ( item.type === 'rumble' ) {
			loadRumble( item, offsetSeconds );
		} else {
			renderSlide( item, offsetSeconds );
		}
	}

	function mountEl() {
		var mount = document.createElement( 'div' );
		mount.className = 'fl-dark-channel__frame';
		mount.setAttribute( 'data-fl', 'dark-channel-mount' );
		els.stage.appendChild( mount );
		return mount;
	}

	function loadYouTube( item, offsetSeconds, isAd ) {
		var mount = mountEl();
		var inner = document.createElement( 'div' );
		mount.appendChild( inner );

		ensureYouTubeApi().then( function () {
			if ( ! mount.isConnected ) {
				return; // item changed again before the API finished loading
			}
			state.ytPlayer = new window.YT.Player( inner, {
				videoId: item.source_id,
				playerVars: { autoplay: 1, mute: 1, playsinline: 1, rel: 0, start: Math.max( 0, Math.floor( offsetSeconds || 0 ) ) },
				events: {
					onReady: function ( e ) {
						e.target.mute();
						state.muted = true;
						e.target.playVideo();
						setFacadeActive( true );
						var fallbackSeconds = isAd
							? AD_FALLBACK_MAX_MS / 1000
							: Math.max( 1, ( Number( item.duration_seconds ) || 0 ) - ( offsetSeconds || 0 ) );
						scheduleEndFallback( fallbackSeconds );
					},
					onStateChange: function ( e ) {
						if ( e.data === window.YT.PlayerState.ENDED ) {
							handleEnded();
						}
					},
				},
			} );
		} );
	}

	function loadRumble( item, offsetSeconds ) {
		var mount = mountEl();
		var innerId = 'fl-dc-rumble-' + Date.now();
		var inner = document.createElement( 'div' );
		inner.id = innerId;
		mount.appendChild( inner );

		var videoId = item.source_id;
		// Rumble's own embed-JS loader (see test/rumble-ended-spike.html for
		// the confirmed-working source of this exact snippet).
		/* eslint-disable */
		!function(r,u,m,b,l,e){r._Rumble=b,r[b]||(r[b]=function(){(r[b]._=r[b]._||[]).push(arguments);if(r[b]._.length==1){l=u.createElement(m),e=u.getElementsByTagName(m)[0],l.async=1,l.src="https://rumble.com/embedJS/"+videoId+(arguments[1].video?'.'+arguments[1].video:'')+"/?url="+encodeURIComponent(location.href)+"&args="+encodeURIComponent(JSON.stringify([].slice.apply(arguments))),e.parentNode.insertBefore(l,e)}})}(window, document, "script", "Rumble");
		/* eslint-enable */

		window.Rumble( 'play', {
			video: videoId,
			div: innerId,
			rel: 0,
			api: function ( api ) {
				if ( ! mount.isConnected ) {
					return; // item changed again before Rumble's script finished loading
				}
				state.rumblePlayer = api;
				setFacadeActive( true );
				// No confirmed seek API (see file header) — always starts at
				// 0:00 regardless of offsetSeconds; the fallback timer below
				// still tracks the SCHEDULED remaining time, not the full
				// item length, so the shared channel clock stays honest.
				var fallbackSeconds = Math.max( 1, ( Number( item.duration_seconds ) || 0 ) - ( offsetSeconds || 0 ) );
				scheduleEndFallback( fallbackSeconds );
				api.on( 'videoEnd', handleEnded );
			},
		} );
	}

	function renderSlide( item, offsetSeconds ) {
		var mount = mountEl();
		mount.classList.add( 'fl-dark-channel__slide' );

		var thumb = item.thumbnail;
		var card = document.createElement( 'a' );
		card.className = 'fl-dark-channel__slide-card';
		card.href = item.url || '#';
		if ( thumb ) {
			var img = document.createElement( 'img' );
			img.src = thumb;
			img.alt = '';
			card.appendChild( img );
		}
		var h3 = document.createElement( 'h3' );
		h3.textContent = item.title || 'From the blog';
		var cta = document.createElement( 'span' );
		cta.className = 'fl-dark-channel__slide-cta';
		cta.textContent = 'Read on the site →';
		card.appendChild( h3 );
		card.appendChild( cta );
		mount.appendChild( card );

		setFacadeActive( true ); // "playing" in the sense of Decision 6 — don't yank a slide either
		var remaining = Math.max( 1, ( Number( item.duration_seconds ) || 0 ) - ( offsetSeconds || 0 ) );
		scheduleEndFallback( remaining );
	}

	function scheduleEndFallback( seconds ) {
		clearTimeout( state.endTimer );
		state.endTimer = setTimeout( handleEnded, seconds * 1000 + END_BUFFER_MS );
	}

	function handleEnded() {
		if ( state.endHandled ) {
			return; // event + timer can both fire close together — only advance once
		}
		state.endHandled = true;
		clearTimeout( state.endTimer );

		if ( state.currentIsAd ) {
			state.itemsSinceAd = 0;
			state.lastAdAt = Date.now();
			playScheduled(); // resume the shared schedule fresh — time didn't stop for the ad
			return;
		}

		state.itemsSinceAd++;
		if ( adCadenceDue() ) {
			var ad = nextAd();
			// Ads are always YouTube-hosted (PHASE-0-FINDINGS.md) and the
			// admin only collects {source_id, title} for them — force the
			// type explicitly rather than relying on that shape, so a
			// missing `type` field can never silently fall through to the
			// blog-slide renderer.
			loadItem( { type: 'youtube', source_id: ad.source_id, title: ad.title }, 0, true );
			return;
		}
		playScheduled();
	}

	function toggleMute() {
		state.muted = ! state.muted;
		if ( state.ytPlayer ) {
			if ( state.muted ) {
				state.ytPlayer.mute();
			} else {
				state.ytPlayer.unMute();
			}
		}
		// Rumble's embed JS API has no confirmed mute/unMute method (same
		// docs-host gap noted throughout this file) — the mute button still
		// updates its own label so the control isn't silently broken, but
		// only YouTube items actually change volume today.
		if ( els.muteBtn ) {
			els.muteBtn.textContent = state.muted ? '🔇 Tap to unmute' : '🔊 Mute';
		}
	}

	// Reveal the unmute control once something is actually playing — no
	// point showing it over the static poster.
	function showMuteControlWhenPlaying() {
		if ( els.muteBtn && state.playing ) {
			els.muteBtn.hidden = false;
		}
	}

	function init() {
		var player = document.querySelector( '[data-fl="hero-player"]' );
		if ( ! player || ! CONFIG.playlist.length ) {
			return; // no hero pattern on this page, or nothing programmed yet — nothing to do (Decision 7: safe, not broken)
		}
		els = { player: player };

		document.addEventListener( 'fl:hero-state', onHeroStateChange );
		setInterval( showMuteControlWhenPlaying, 1000 );

		var alreadyLive =
			window.FLHub && window.FLHub.liveState && window.FLHub.liveState.isLive && window.FLHub.liveState.isLive();
		if ( ! alreadyLive ) {
			activate();
		}
	}

	document.addEventListener( 'DOMContentLoaded', init );
} )();
