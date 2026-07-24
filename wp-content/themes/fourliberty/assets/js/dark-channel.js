/**
 * 4Liberty Network — Dark Channel slider (Phase 2 task F, reworked 2026-07-23).
 *
 * Takes over the homepage hero slot ([data-fl="hero-player"], the same element
 * live-state.js drives) whenever no show is live, and gets out of the way the
 * instant a show goes live — same decoupled seam as before (the "fl:hero-state"
 * DOM event live-state.js dispatches; window.FLHub.liveState.setFacadeActive /
 * isLive). Nothing here imports live-state.js and vice versa.
 *
 * Austin's redesign (2026-07-23): instead of a wall-clock TV channel that
 * autoplayed videos back-to-back, the Dark Channel is now a SLIDER of
 * previews. Each playlist item is a slide the visitor can click:
 *   - YouTube / Rumble video  -> thumbnail + play button; click plays it in place.
 *   - Blog post               -> a card; click opens the post.
 *   - Image ad                -> the image; click follows its link (JP/PNG ads).
 *
 * Two admin display modes (4Liberty Hub -> Dark Channel -> "How it plays"):
 *   - "slide"  : auto-rotates to the next slide every N seconds (the timer),
 *                pausing while a clicked video is actually playing.
 *   - "static" : holds on one slide; the visitor moves with the ← → arrows.
 * Either way, clicking a video slide stops the rotation and plays it; when that
 * video ends the slider resumes. The previous wall-clock "everyone sees the
 * same thing at the same second" sync is intentionally gone — a click-to-play
 * showcase has no single shared playhead to keep in step.
 *
 * setFacadeActive() is called true ONLY while a real video is playing (so a
 * show going live mid-watch offers a banner instead of yanking the video,
 * live-state.js Decision 6); a bare rotating preview reports false, so a live
 * show takes over immediately — a preview isn't precious.
 *
 * YouTube end-of-item uses the IFrame API's ENDED state; Rumble uses its
 * `videoEnd` event (both confirmed reliable in task C), each with a wall-clock
 * duration fallback so a missed event can't strand the player on one video.
 */
( function () {
	'use strict';

	var CONFIG =
		window.fourlibertyDarkChannel && Array.isArray( window.fourlibertyDarkChannel.playlist )
			? window.fourlibertyDarkChannel
			: { playlist: [], display: { mode: 'slide', intervalSeconds: 8 } };

	var DISPLAY = ( CONFIG.display && typeof CONFIG.display === 'object' ) ? CONFIG.display : {};
	var SLIDE_MODE = DISPLAY.mode !== 'static'; // default to sliding
	var SLIDE_MS = Math.max( 3, Number( DISPLAY.intervalSeconds ) || 8 ) * 1000;
	var END_BUFFER_MS = 800;

	// Admin durations are a safety net, not a hard cut — a real video that's
	// still playing when the timer fires would otherwise get yanked just
	// because the admin estimate (or an un-readable Rumble length) ran short.
	// YouTube/Rumble's own end events almost always win first; this only holds
	// the transition together if an event never fires.
	function withGrace( seconds ) {
		return seconds + Math.min( 300, Math.max( 15, seconds * 0.25 ) );
	}

	var els = null;
	var state = {
		active: false, // Dark Channel owns the hero slot (i.e. currently DARK)
		index: 0, // which slide is showing
		playingVideo: false, // a real video is loaded and playing in place
		slideTimer: null,
		endTimer: null,
		endHandled: false,
		ytPlayer: null,
		muted: true,
	};

	function playlist() {
		return CONFIG.playlist;
	}
	function currentItem() {
		return CONFIG.playlist[ state.index ] || null;
	}
	function isVideo( item ) {
		return item && ( item.type === 'youtube' || item.type === 'rumble' );
	}

	function thumbFor( item ) {
		if ( ! item ) {
			return '';
		}
		if ( item.thumbnail ) {
			return item.thumbnail;
		}
		if ( item.type === 'youtube' && item.source_id ) {
			return 'https://img.youtube.com/vi/' + encodeURIComponent( item.source_id ) + '/hqdefault.jpg';
		}
		return '';
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

		var badge = document.createElement( 'div' );
		badge.className = 'fl-dark-channel__badge';
		badge.textContent = 'On Now · 4Liberty Network';

		// Prev/next — always present but only useful with 2+ slides.
		var prevBtn = document.createElement( 'button' );
		prevBtn.type = 'button';
		prevBtn.className = 'fl-dark-channel__nav fl-dark-channel__nav--prev';
		prevBtn.setAttribute( 'aria-label', 'Previous item' );
		prevBtn.hidden = playlist().length < 2;
		prevBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"></path></svg>';
		prevBtn.addEventListener( 'click', function () {
			skip( -1 );
		} );

		var nextBtn = document.createElement( 'button' );
		nextBtn.type = 'button';
		nextBtn.className = 'fl-dark-channel__nav fl-dark-channel__nav--next';
		nextBtn.setAttribute( 'aria-label', 'Next item' );
		nextBtn.hidden = playlist().length < 2;
		nextBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"></path></svg>';
		nextBtn.addEventListener( 'click', function () {
			skip( 1 );
		} );

		var muteBtn = document.createElement( 'button' );
		muteBtn.type = 'button';
		muteBtn.className = 'fl-dark-channel__mute';
		muteBtn.setAttribute( 'aria-label', 'Unmute' );
		muteBtn.hidden = true;
		muteBtn.textContent = '🔇 Tap to unmute';
		muteBtn.addEventListener( 'click', toggleMute );

		facade.appendChild( stage );
		facade.appendChild( badge );
		facade.appendChild( prevBtn );
		facade.appendChild( nextBtn );
		facade.appendChild( muteBtn );
		els.player.appendChild( facade );

		els.facade = facade;
		els.stage = stage;
		els.badge = badge;
		els.prevBtn = prevBtn;
		els.nextBtn = nextBtn;
		els.muteBtn = muteBtn;
	}

	/* ---------- Slide rendering (previews) ---------- */

	/**
	 * Renders the current item as a clickable PREVIEW — never an autoplaying
	 * video. Video previews are a button (click => play in place); blog and
	 * image previews are plain links (the browser handles the click). The
	 * enter animation ("fl-dark-channel__slide--enter", cleared on the next
	 * frame) gives the "slides in from the right" motion Austin asked for.
	 */
	function renderSlide() {
		teardownPlayer();
		els.facade.classList.remove( 'is-playing' );
		if ( els.muteBtn ) {
			els.muteBtn.hidden = true;
		}
		var item = currentItem();
		els.stage.innerHTML = '';
		if ( ! item ) {
			return;
		}

		var slide;
		if ( isVideo( item ) ) {
			slide = document.createElement( 'button' );
			slide.type = 'button';
			slide.className = 'fl-dark-channel__slide fl-dark-channel__slide--video';
			slide.addEventListener( 'click', function () {
				playCurrentVideo();
			} );

			// Rumble has no confirmed auto-thumbnail source (unlike YouTube's
			// img.youtube.com), so a Rumble item Austin hasn't manually given a
			// Thumbnail URL has nothing to show here — a branded gradient
			// (matching the live player's own idle background) reads as
			// intentional instead of looking like a broken/missing image.
			var thumb = thumbFor( item );
			if ( thumb ) {
				slide.style.backgroundImage = 'url(' + thumb + ')';
			} else {
				slide.classList.add( 'fl-dark-channel__slide--no-thumb' );
			}
			var play = document.createElement( 'span' );
			play.className = 'fl-dark-channel__slide-play';
			play.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>';
			slide.appendChild( play );

			if ( item.title ) {
				var vtitle = document.createElement( 'span' );
				vtitle.className = 'fl-dark-channel__slide-title';
				vtitle.textContent = item.title;
				slide.appendChild( vtitle );
			}
		} else if ( item.type === 'image' ) {
			// Image ad — the picture is the whole slide; its link opens on click.
			slide = document.createElement( item.url ? 'a' : 'div' );
			slide.className = 'fl-dark-channel__slide fl-dark-channel__slide--image';
			if ( item.url ) {
				slide.href = item.url;
				slide.target = '_blank';
				slide.rel = 'noopener sponsored';
			}
			var img = document.createElement( 'img' );
			img.src = item.thumbnail || '';
			img.alt = item.title || 'Advertisement';
			slide.appendChild( img );
		} else {
			// Blog post — a readable card that opens the post.
			slide = document.createElement( 'a' );
			slide.className = 'fl-dark-channel__slide fl-dark-channel__slide--post';
			slide.href = item.url || '#';
			slide.target = '_blank';
			slide.rel = 'noopener';
			if ( item.thumbnail ) {
				var pimg = document.createElement( 'img' );
				pimg.src = item.thumbnail;
				pimg.alt = '';
				slide.appendChild( pimg );
			}
			var h3 = document.createElement( 'span' );
			h3.className = 'fl-dark-channel__slide-heading';
			h3.textContent = item.title || 'From the blog';
			var cta = document.createElement( 'span' );
			cta.className = 'fl-dark-channel__slide-cta';
			cta.textContent = 'Read on the site →';
			slide.appendChild( h3 );
			slide.appendChild( cta );
		}

		slide.classList.add( 'fl-dark-channel__slide--enter' );
		els.stage.appendChild( slide );
		// Clear the enter offset on the next frame so the transition plays.
		requestAnimationFrame( function () {
			requestAnimationFrame( function () {
				slide.classList.remove( 'fl-dark-channel__slide--enter' );
			} );
		} );
	}

	/* ---------- Rotation ---------- */

	function startRotation() {
		stopRotation();
		if ( ! SLIDE_MODE || playlist().length < 2 ) {
			return;
		}
		state.slideTimer = setTimeout( function tick() {
			if ( ! state.playingVideo ) {
				advance( 1 );
			}
			state.slideTimer = setTimeout( tick, SLIDE_MS );
		}, SLIDE_MS );
	}

	function stopRotation() {
		clearTimeout( state.slideTimer );
		state.slideTimer = null;
	}

	function advance( dir ) {
		var n = playlist().length;
		if ( ! n ) {
			return;
		}
		state.index = ( state.index + dir + n ) % n;
		renderSlide();
	}

	// Manual arrow click — move, and (in slide mode) restart the timer so the
	// visitor gets a full interval to look at what they navigated to.
	function skip( dir ) {
		advance( dir );
		if ( SLIDE_MODE ) {
			startRotation();
		}
	}

	/* ---------- Play a clicked video in place ---------- */

	function playCurrentVideo() {
		var item = currentItem();
		if ( ! isVideo( item ) ) {
			return;
		}
		stopRotation();
		state.playingVideo = true;
		state.endHandled = false;
		els.facade.classList.add( 'is-playing' );
		els.stage.innerHTML = '';
		var mount = document.createElement( 'div' );
		mount.className = 'fl-dark-channel__frame';
		mount.setAttribute( 'data-fl', 'dark-channel-mount' );
		els.stage.appendChild( mount );

		if ( item.type === 'youtube' ) {
			loadYouTube( item, mount );
		} else {
			loadRumble( item, mount );
		}
	}

	function loadYouTube( item, mount ) {
		var inner = document.createElement( 'div' );
		mount.appendChild( inner );
		ensureYouTubeApi().then( function () {
			if ( ! mount.isConnected ) {
				return; // slide changed again before the API finished loading
			}
			state.ytPlayer = new window.YT.Player( inner, {
				videoId: item.source_id,
				playerVars: { autoplay: 1, mute: 1, playsinline: 1, rel: 0 },
				events: {
					onReady: function ( e ) {
						e.target.mute();
						state.muted = true;
						e.target.playVideo();
						setFacadeActive( true );
						if ( els.muteBtn ) {
							els.muteBtn.hidden = false;
						}
						var real = e.target.getDuration();
						var base = real > 0 ? real : ( Number( item.duration_seconds ) || 0 );
						if ( base > 0 ) {
							scheduleEndFallback( withGrace( base ) );
						}
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

	/**
	 * Rumble's own public slugs always carry a leading "v" (rumble.com/
	 * v7d4g0e-title.html), but item.source_id doesn't reliably have it:
	 * admin-dark-channel.js's extractVideoId() preserves the "v" when Austin
	 * pastes a full URL, but passes a bare typed ID through completely
	 * unchanged (no "v" to preserve). Normalizing here means either input
	 * works, instead of silently depending on which one Austin used.
	 */
	function rumbleEmbedSlug( id ) {
		var raw = String( id || '' );
		return /^v/i.test( raw ) ? raw : 'v' + raw;
	}

	/**
	 * Plain iframe embed (2026-07-23) — replaced Rumble's window.Rumble()
	 * JS-API loader, which never reliably played a video here (root cause:
	 * that API's `video` param disagreed with the "v"-prefixed slugs
	 * extractVideoId() produces from a pasted URL — the very input path
	 * Austin's most likely to use). This is the exact embed pattern
	 * live-state.js's loadPlayer() already uses successfully for live Rumble
	 * streams, so it's proven, not a guess. Trade-off: an iframe gives no
	 * JS access to a "video ended" event, so end-of-item detection here
	 * leans entirely on the admin-entered duration + withGrace()'s buffer —
	 * same fallback path YouTube already has as backup, just load-bearing
	 * here instead of secondary. A Rumble item with no duration set simply
	 * won't auto-advance on its own; the visitor can still move on with the
	 * arrows.
	 */
	function loadRumble( item, mount ) {
		var iframe = document.createElement( 'iframe' );
		iframe.className = 'fl-dark-channel__rumble-frame';
		iframe.src = 'https://rumble.com/embed/' + encodeURIComponent( rumbleEmbedSlug( item.source_id ) ) + '/?autoplay=2';
		iframe.setAttribute( 'allow', 'autoplay; fullscreen' );
		iframe.setAttribute( 'allowfullscreen', '' );
		iframe.loading = 'lazy';
		mount.appendChild( iframe );

		setFacadeActive( true );
		if ( els.muteBtn ) {
			els.muteBtn.hidden = true; // no confirmed mute/unMute on a bare Rumble iframe — don't offer a control that can't work
		}
		var base = Number( item.duration_seconds ) || 0;
		if ( base > 0 ) {
			scheduleEndFallback( withGrace( base ) );
		}
	}

	function scheduleEndFallback( seconds ) {
		clearTimeout( state.endTimer );
		state.endTimer = setTimeout( handleEnded, seconds * 1000 + END_BUFFER_MS );
	}

	// A played video finished (event or fallback) — return to the slider and,
	// in slide mode, move on to the next item and resume rotating.
	function handleEnded() {
		if ( state.endHandled ) {
			return;
		}
		state.endHandled = true;
		clearTimeout( state.endTimer );
		state.playingVideo = false;
		setFacadeActive( false );
		if ( SLIDE_MODE ) {
			advance( 1 );
			startRotation();
		} else {
			renderSlide(); // back to this item's preview
		}
	}

	function teardownPlayer() {
		clearTimeout( state.endTimer );
		state.endTimer = null;
		if ( state.ytPlayer ) {
			try {
				state.ytPlayer.destroy();
			} catch ( err ) {
				/* already gone */
			}
			state.ytPlayer = null;
		}
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
		if ( els.muteBtn ) {
			els.muteBtn.textContent = state.muted ? '🔇 Tap to unmute' : '🔊 Mute';
		}
	}

	/* ---------- Lifecycle: activate (dark) / deactivate (live) ---------- */

	function setFacadeActive( active ) {
		if ( window.FLHub && window.FLHub.liveState && window.FLHub.liveState.setFacadeActive ) {
			window.FLHub.liveState.setFacadeActive( active );
		}
	}

	function activate() {
		if ( state.active || ! playlist().length ) {
			return;
		}
		state.active = true;
		state.index = 0;
		els.player.classList.add( 'is-dark-channel' );
		buildFacade();
		renderSlide();
		startRotation();
	}

	function deactivate() {
		stopRotation();
		teardownPlayer();
		if ( els.facade ) {
			els.facade.parentNode.removeChild( els.facade );
			els.facade = null;
		}
		els.player.classList.remove( 'is-dark-channel' );
		state.active = false;
		state.playingVideo = false;
		setFacadeActive( false );
	}

	function onHeroStateChange( e ) {
		if ( e.detail && e.detail.live ) {
			deactivate();
		} else {
			activate();
		}
	}

	function init() {
		var player = document.querySelector( '[data-fl="hero-player"]' );
		if ( ! player || ! playlist().length ) {
			return; // no hero on this page, or nothing programmed yet (Decision 7: safe, not broken)
		}
		els = { player: player };

		document.addEventListener( 'fl:hero-state', onHeroStateChange );

		var alreadyLive =
			window.FLHub && window.FLHub.liveState && window.FLHub.liveState.isLive && window.FLHub.liveState.isLive();
		if ( ! alreadyLive ) {
			activate();
		}
	}

	document.addEventListener( 'DOMContentLoaded', init );
} )();
