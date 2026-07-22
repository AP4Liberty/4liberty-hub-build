/**
 * 4Liberty Network — homepage live-swapper state machine (Phase 2).
 *
 * Polls the sanitized Netlify endpoint (never a Rumble API URL — that secret
 * never reaches the browser, see PHASE-2-BUILD-PLAN.md) and drives the hero
 * player between LIVE and DARK, wired to the DOM hooks Phase 1 left in
 * patterns/hero-live.php: [data-fl="hero-player"], "hero-title", "hero-show",
 * "viewer-count", "also-live".
 *
 * Design follows the locked decisions in PHASE-2-BUILD-PLAN.md:
 *  - Decision 6: never yank a playing hero out from under a viewer. If the
 *    hero is actively playing (facade loaded) when a different/new show goes
 *    live, offer a dismissible banner instead of forcing the swap. Generalized
 *    here beyond the literal "Dark Channel" case to any already-playing hero,
 *    since the underlying reasoning (don't interrupt an engaged viewer)
 *    applies equally to live-to-live changes.
 *  - Decision 7: fail safe to DARK, never to broken. Hysteresis (2 consecutive
 *    polls) before dropping a live hero to dark; a fetch failure only forces
 *    DARK once data has been stale for STALE_MS — a single network blip must
 *    not interrupt an actively live show.
 *  - Decision 8 (revised): playback policy is per-BROADCAST, matched on the
 *    live title (e.g. "Freedom Arcade" on the WUA channel), not per-channel.
 *    A gated broadcast shows a subscribe CTA instead of an embedded player.
 *    Fail-safe direction: a missing/unreadable title is treated as NOT gated.
 */
( function () {
	'use strict';

	var ENDPOINT =
		( window.fourlibertyLiveEndpoint && window.fourlibertyLiveEndpoint.url ) ||
		'https://4liberty-poller.netlify.app/api/live-state';

	var POLL_INTERVAL_MS = 45000; // inside PHASE-0's confirmed 30-60s cadence
	var STALE_MS = 5 * 60 * 1000; // matches the data contract's staleness note
	var HYSTERESIS_MISSES_REQUIRED = 2;
	var DEFAULT_GATED_LABEL = 'Subscribe on Rumble to watch live →';

	// Falls back to these defaults until the Phase 2 task-E admin panel writes
	// real values via wp_localize_script — see fourliberty_live_shows_config()
	// in functions.php. The JS never needs to change when that panel ships.
	var DEFAULT_CONFIG = {
		order: [ 'WUA', 'WUJC', 'CULTURAMA', 'HOMESCHOOL', 'CAFECITO' ],
		shows: {
			WUA: {
				name: 'Wake Up America',
				host: 'with Austin Petersen',
				gatedTitleMatch: 'Freedom Arcade',
				gatedLabel: DEFAULT_GATED_LABEL,
				gatedUrl: 'https://rumble.com/c/AP4Liberty',
			},
			WUJC: { name: 'Wake Up Jefferson City' },
			CULTURAMA: { name: 'Culturama' },
			HOMESCHOOL: { name: 'Homeschool Workshop' },
			CAFECITO: { name: 'Cafecito Libre' },
		},
	};

	var CONFIG =
		window.fourlibertyLiveShows && window.fourlibertyLiveShows.shows
			? window.fourlibertyLiveShows
			: DEFAULT_CONFIG;

	var els = null;
	var defaultCopy = { show: '', title: '', host: '' };
	var pollTimer = null;

	var state = {
		heroKey: null, // currently displayed channel key, or null = dark
		heroLive: false,
		heroGated: false,
		heroFacadeActive: false, // true once a player is actually loaded/playing
		currentEmbedId: null,
		pinnedKey: null, // manual pick via "also live" click; sticky until offline
		missStreak: 0, // consecutive polls where the hero reported not-live
		lastGoodFetch: 0,
		dismissedBannerForKey: null,
		channels: [],
	};

	// Public hooks for the Dark Channel playout engine (task F,
	// assets/js/dark-channel.js) to plug into, so the two features can stay
	// decoupled (neither script needs to know the other exists):
	//  - setFacadeActive(): Dark Channel calls this when it starts/stops
	//    actually playing a programmed item, so a show going live mid-watch
	//    triggers the banner (Decision 6) instead of yanking the video.
	//  - isLive(): a synchronous read of the current hero state, for Dark
	//    Channel's own init (before its first "fl:hero-state" event arrives).
	// The "fl:hero-state" DOM event (dispatched below, only on an actual
	// dark<->live transition, never on a same-state poll) is Dark Channel's
	// cue to take over the hero slot when dark, and get out of the way the
	// instant a show goes live.
	window.FLHub = window.FLHub || {};
	window.FLHub.liveState = {
		setFacadeActive: function ( active ) {
			state.heroFacadeActive = !! active;
		},
		isLive: function () {
			return state.heroLive;
		},
	};

	function dispatchHeroStateChange() {
		document.dispatchEvent(
			new CustomEvent( 'fl:hero-state', { detail: { live: state.heroLive, key: state.heroKey } } )
		);
	}

	function orderIndex( key ) {
		var i = CONFIG.order ? CONFIG.order.indexOf( key ) : -1;
		return i === -1 ? 999 : i;
	}

	function showConfig( key ) {
		return ( CONFIG.shows && CONFIG.shows[ key ] ) || { name: key };
	}

	/**
	 * Task E's admin panel can turn a channel off ("included in homepage
	 * rotation" unchecked) without deleting its config — it just stops
	 * counting as live here. Missing/unset defaults to enabled so existing
	 * configs (and the hardcoded DEFAULT_CONFIG above) keep working as-is.
	 */
	function isEnabled( key ) {
		return showConfig( key ).enabled !== false;
	}

	function findChannel( key ) {
		for ( var i = 0; i < state.channels.length; i++ ) {
			if ( state.channels[ i ].key === key ) {
				return state.channels[ i ];
			}
		}
		return null;
	}

	/**
	 * A broadcast is gated when its live title contains the show's configured
	 * phrase (default "Freedom Arcade" on the WUA channel). Fail-safe: a
	 * missing/unreadable title is NOT gated — a wrongly-embedded player is
	 * recoverable, wrongly hiding a free show behind a paywall costs live
	 * audience mid-broadcast (Decision 8, revised).
	 */
	function matchesGate( channel ) {
		var cfg = showConfig( channel.key );
		if ( ! cfg.gatedTitleMatch || ! channel.title ) {
			return false;
		}
		return (
			channel.title.toLowerCase().indexOf( String( cfg.gatedTitleMatch ).toLowerCase() ) !== -1
		);
	}

	/**
	 * Chooses which live channel leads the hero. Respects a manual pin (from
	 * an "also live" click) as long as it's still live. Otherwise prefers a
	 * non-gated broadcast over a gated one — a paywalled show is still shown
	 * if it's the only thing live, just via the gated CTA (Decision 8).
	 */
	function pickHero( live ) {
		if ( state.pinnedKey ) {
			var pinned = null;
			for ( var i = 0; i < live.length; i++ ) {
				if ( live[ i ].key === state.pinnedKey ) {
					pinned = live[ i ];
					break;
				}
			}
			if ( pinned ) {
				return pinned.key;
			}
			state.pinnedKey = null; // pin expired — that show went offline
		}

		if ( ! live.length ) {
			return null;
		}

		var nonGated = live.filter( function ( c ) {
			return ! matchesGate( c );
		} );
		var pool = ( nonGated.length ? nonGated : live ).slice();
		pool.sort( function ( a, b ) {
			return orderIndex( a.key ) - orderIndex( b.key );
		} );
		return pool[ 0 ].key;
	}

	function loadPlayer( embedId ) {
		resetPlayerIfAny();
		var iframe = document.createElement( 'iframe' );
		iframe.className = 'fl-player__frame';
		iframe.src = 'https://rumble.com/embed/' + encodeURIComponent( embedId ) + '/?autoplay=2';
		iframe.setAttribute( 'allow', 'autoplay; fullscreen' );
		iframe.setAttribute( 'allowfullscreen', '' );
		iframe.setAttribute( 'data-fl-embed', '1' );
		iframe.loading = 'lazy';
		els.player.appendChild( iframe );
		els.player.classList.add( 'is-playing' );
		state.heroFacadeActive = true;
	}

	function resetPlayerIfAny() {
		var iframe = els.player.querySelector( 'iframe[data-fl-embed]' );
		if ( iframe ) {
			iframe.parentNode.removeChild( iframe );
		}
		els.player.classList.remove( 'is-playing' );
		state.heroFacadeActive = false;
	}

	function ensureGatedCta( cfg ) {
		var existing = els.player.querySelector( '[data-fl="gated-cta"]' );
		var link;
		if ( existing ) {
			link = existing.querySelector( 'a' );
			link.href = cfg.gatedUrl || '#';
			link.textContent = cfg.gatedLabel || DEFAULT_GATED_LABEL;
			return;
		}
		var wrap = document.createElement( 'div' );
		wrap.className = 'fl-gated-cta';
		wrap.setAttribute( 'data-fl', 'gated-cta' );

		var label = document.createElement( 'div' );
		label.className = 'fl-gated-cta__label';
		label.textContent = 'Members-only broadcast';

		link = document.createElement( 'a' );
		link.className = 'fl-gated-cta__btn';
		link.href = cfg.gatedUrl || '#';
		link.target = '_blank';
		link.rel = 'noopener';
		link.textContent = cfg.gatedLabel || DEFAULT_GATED_LABEL;

		wrap.appendChild( label );
		wrap.appendChild( link );
		els.player.appendChild( wrap );
	}

	function removeGatedCta() {
		var existing = els.player.querySelector( '[data-fl="gated-cta"]' );
		if ( existing ) {
			existing.parentNode.removeChild( existing );
		}
	}

	function removeBanner() {
		var existing = document.querySelector( '[data-fl="live-banner"]' );
		if ( existing ) {
			existing.parentNode.removeChild( existing );
		}
	}

	/**
	 * Decision 6: don't force-swap a playing hero. Show a dismissible banner
	 * offering the new live show instead. Suppressed after being dismissed
	 * once for the same channel key (won't nag every poll), but a *different*
	 * show going live afterward gets its own banner.
	 */
	function showGoLiveBanner( channel ) {
		if ( state.dismissedBannerForKey === channel.key ) {
			return;
		}
		removeBanner();

		var cfg = showConfig( channel.key );

		var el = document.createElement( 'div' );
		el.className = 'fl-live-banner';
		el.setAttribute( 'data-fl', 'live-banner' );

		var dot = document.createElement( 'span' );
		dot.className = 'fl-pulse fl-live-banner__dot';

		var text = document.createElement( 'span' );
		text.className = 'fl-live-banner__text';
		text.textContent = cfg.name + ' just went live';

		var watchBtn = document.createElement( 'button' );
		watchBtn.type = 'button';
		watchBtn.className = 'fl-live-banner__watch';
		watchBtn.textContent = 'Watch now';
		watchBtn.addEventListener( 'click', function () {
			selectHero( channel.key );
		} );

		var dismissBtn = document.createElement( 'button' );
		dismissBtn.type = 'button';
		dismissBtn.className = 'fl-live-banner__dismiss';
		dismissBtn.setAttribute( 'aria-label', 'Dismiss' );
		dismissBtn.textContent = '×';
		dismissBtn.addEventListener( 'click', function () {
			state.dismissedBannerForKey = channel.key;
			removeBanner();
		} );

		el.appendChild( dot );
		el.appendChild( text );
		el.appendChild( watchBtn );
		el.appendChild( dismissBtn );

		els.player.parentNode.insertBefore( el, els.player );
	}

	function applyHero( channel, opts ) {
		opts = opts || {};
		var cfg = showConfig( channel.key );
		var gated = matchesGate( channel );

		state.heroKey = channel.key;
		state.heroLive = true;
		state.heroGated = gated;
		state.currentEmbedId = channel.embed_id;
		state.missStreak = 0;

		if ( els.heroShow ) {
			els.heroShow.textContent = cfg.name + ( cfg.host ? ' · ' + cfg.host : '' );
		}
		if ( els.heroTitle ) {
			els.heroTitle.textContent = channel.title || cfg.name + ' is live now';
		}
		if ( els.viewerCount ) {
			els.viewerCount.textContent =
				typeof channel.watching_now === 'number' ? channel.watching_now.toLocaleString() : '—';
		}

		els.player.classList.add( 'is-live' );
		els.player.classList.toggle( 'is-gated', gated );

		if ( gated ) {
			removeGatedCta(); // in case the CTA copy changed, rebuild fresh
			ensureGatedCta( cfg );
			resetPlayerIfAny(); // a gated broadcast never embeds — no player path
		} else {
			removeGatedCta();
		}

		if ( ! opts.silent ) {
			removeBanner();
			dispatchHeroStateChange();
		}
	}

	function goDark() {
		var wasLive = state.heroLive;

		state.heroKey = null;
		state.heroLive = false;
		state.heroGated = false;
		state.currentEmbedId = null;
		state.missStreak = 0;

		resetPlayerIfAny();
		removeGatedCta();
		removeBanner();
		els.player.classList.remove( 'is-live', 'is-gated' );

		if ( els.heroShow ) {
			els.heroShow.textContent = defaultCopy.show;
		}
		if ( els.heroTitle ) {
			els.heroTitle.textContent = defaultCopy.title;
		}
		var hostEl = els.player.querySelector( '.fl-player-meta__host' );
		if ( hostEl ) {
			hostEl.textContent = defaultCopy.host;
		}

		// Dispatch even on the very first (already-dark) load, not just real
		// live->dark transitions — Dark Channel's own activate() is written
		// to be idempotent, and this guarantees it always gets at least one
		// event to react to instead of depending on a synchronous isLive()
		// read racing its own init.
		if ( wasLive || ! state.lastGoodFetch ) {
			dispatchHeroStateChange();
		}
	}

	/**
	 * Shared by the "also live" tile click and the banner's "Watch now"
	 * button — pins the choice, applies it, and if a video was already
	 * playing (and the new pick isn't gated), swaps the iframe immediately
	 * since the visitor explicitly asked for this show.
	 */
	function selectHero( key ) {
		var channel = findChannel( key );
		if ( ! channel || ! channel.is_live ) {
			return;
		}
		state.pinnedKey = key;
		var wasPlaying = state.heroFacadeActive;
		applyHero( channel, {} );
		if ( wasPlaying && ! state.heroGated ) {
			loadPlayer( channel.embed_id );
		}
	}

	function renderAlsoLive( live, heroKey ) {
		if ( ! els.alsoLive ) {
			return;
		}
		els.alsoLive.innerHTML = '';

		var others = live
			.filter( function ( c ) {
				return c.key !== heroKey;
			} )
			.sort( function ( a, b ) {
				return orderIndex( a.key ) - orderIndex( b.key );
			} )
			.slice( 0, 2 );

		others.forEach( function ( c ) {
			var cfg = showConfig( c.key );
			var gated = matchesGate( c );
			var tile = document.createElement( gated ? 'a' : 'button' );
			tile.className = 'fl-mini-live';

			if ( gated ) {
				tile.href = cfg.gatedUrl || '#';
				tile.target = '_blank';
				tile.rel = 'noopener';
			} else {
				tile.type = 'button';
				tile.addEventListener( 'click', function () {
					selectHero( c.key );
				} );
			}

			var thumb = document.createElement( 'span' );
			thumb.className = 'fl-mini-live__thumb';

			var textWrap = document.createElement( 'span' );
			var title = document.createElement( 'span' );
			title.className = 'fl-mini-live__title';
			title.textContent = cfg.name;
			var sub = document.createElement( 'span' );
			sub.className = 'fl-mini-live__sub';
			sub.textContent = gated ? 'Members only' : 'Live now';

			textWrap.appendChild( title );
			textWrap.appendChild( sub );
			tile.appendChild( thumb );
			tile.appendChild( textWrap );
			els.alsoLive.appendChild( tile );
		} );
	}

	function processPayload( payload ) {
		state.lastGoodFetch = Date.now();
		state.channels = payload.channels || [];

		var live = state.channels.filter( function ( c ) {
			return c.is_live && isEnabled( c.key );
		} );
		var nextKey = pickHero( live );

		if ( nextKey === state.heroKey ) {
			if ( nextKey ) {
				applyHero( findChannel( nextKey ), { silent: true } );
			}
			renderAlsoLive( live, nextKey );
			return;
		}

		if ( nextKey === null ) {
			// Hero wants to go dark. Hysteresis: don't drop a live show off
			// the homepage from one flaky poll (Decision 7).
			state.missStreak++;
			if ( state.missStreak < HYSTERESIS_MISSES_REQUIRED ) {
				renderAlsoLive( live, state.heroKey );
				return;
			}
			goDark();
			renderAlsoLive( live, null );
			return;
		}

		// A different (or first) channel should lead.
		var channel = findChannel( nextKey );
		if ( state.heroFacadeActive ) {
			showGoLiveBanner( channel ); // never yank — offer instead (Decision 6)
		} else {
			applyHero( channel, {} );
		}
		renderAlsoLive( live, nextKey );
	}

	/**
	 * A single failed/stale poll must not interrupt an actively live show —
	 * only force DARK once we've had no good data for STALE_MS, or on the
	 * very first load (nothing to protect yet).
	 */
	function handleUnavailable() {
		var noGoodDataYet = ! state.lastGoodFetch;
		var longSilence = state.lastGoodFetch && Date.now() - state.lastGoodFetch > STALE_MS;
		if ( ( noGoodDataYet || longSilence ) && state.heroKey !== null ) {
			goDark();
			renderAlsoLive( [], null );
		} else if ( noGoodDataYet ) {
			goDark(); // first load, nothing to show yet — fail safe to dark
		}
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
					throw new Error( 'malformed payload' );
				}
				var age = Date.now() - Date.parse( payload.generated_at || 0 );
				if ( ! isFinite( age ) || age > STALE_MS ) {
					handleUnavailable();
					return;
				}
				processPayload( payload );
			} )
			.catch( function () {
				handleUnavailable();
			} );
	}

	function tick() {
		if ( ! document.hidden ) {
			fetchState();
		}
		pollTimer = setTimeout( tick, POLL_INTERVAL_MS );
	}

	function start() {
		fetchState();
		pollTimer = setTimeout( tick, POLL_INTERVAL_MS );
		document.addEventListener( 'visibilitychange', function () {
			if ( document.visibilityState === 'visible' ) {
				fetchState();
			}
		} );
	}

	function wirePlayButton() {
		if ( ! els.playBtn ) {
			return;
		}
		els.playBtn.addEventListener( 'click', function () {
			if ( ! state.heroLive || state.heroGated || ! state.currentEmbedId ) {
				return;
			}
			loadPlayer( state.currentEmbedId );
		} );
	}

	function init() {
		var player = document.querySelector( '[data-fl="hero-player"]' );
		if ( ! player ) {
			return; // hero pattern isn't on this page
		}

		els = {
			player: player,
			playBtn: player.querySelector( '.fl-play' ),
			viewerCount: player.querySelector( '[data-fl="viewer-count"]' ),
			heroShow: player.querySelector( '[data-fl="hero-show"]' ),
			heroTitle: player.querySelector( '[data-fl="hero-title"]' ),
			alsoLive: document.querySelector( '[data-fl="also-live"]' ),
		};

		var hostEl = player.querySelector( '.fl-player-meta__host' );
		defaultCopy = {
			show: els.heroShow ? els.heroShow.textContent : '',
			title: els.heroTitle ? els.heroTitle.textContent : '',
			host: hostEl ? hostEl.textContent : '',
		};

		wirePlayButton();
		start();
	}

	document.addEventListener( 'DOMContentLoaded', init );
} )();
