/**
 * Dark Channel admin screen (Phase 2, task F) — vanilla add/remove/reorder,
 * plus a friendlier hours/minutes/seconds duration entry with YouTube
 * auto-detect (added after Austin's first pass: a raw "duration in seconds"
 * field made "let this play for a few hours" annoying to type, and there
 * was no way to just say "play the whole thing" without guessing a number).
 *
 * Same "no library" approach as admin-live-shows.js. Two differences from
 * that screen: rows here are numeric-indexed (fourliberty_playlist[],
 * fourliberty_ads[]), so drag-reorder just needs to move the DOM node —
 * browsers submit form fields in document order, so there's no separate
 * hidden "order" input to keep in sync. And rows can be added/removed, via
 * cloning the <template> each list keeps for exactly that purpose.
 */
( function () {
	'use strict';

	/* ---------- Duration: h/m/s fields <-> the one hidden seconds field ---------- */

	function syncDuration( row ) {
		var hh = row.querySelector( '.fl-hub-hh' );
		var mm = row.querySelector( '.fl-hub-mm' );
		var ss = row.querySelector( '.fl-hub-ss' );
		var total = row.querySelector( '.fl-hub-duration-total' );
		if ( ! hh || ! mm || ! ss || ! total ) {
			return;
		}
		var seconds =
			( Math.max( 0, parseInt( hh.value, 10 ) || 0 ) * 3600 ) +
			( Math.max( 0, Math.min( 59, parseInt( mm.value, 10 ) || 0 ) ) * 60 ) +
			Math.max( 0, Math.min( 59, parseInt( ss.value, 10 ) || 0 ) );
		total.value = seconds;
	}

	function durationIsUnset( row ) {
		var hh = row.querySelector( '.fl-hub-hh' );
		var mm = row.querySelector( '.fl-hub-mm' );
		var ss = row.querySelector( '.fl-hub-ss' );
		return ( ! hh || ! parseInt( hh.value, 10 ) ) && ( ! mm || ! parseInt( mm.value, 10 ) ) && ( ! ss || ! parseInt( ss.value, 10 ) );
	}

	function setDurationSeconds( row, seconds ) {
		var hh = row.querySelector( '.fl-hub-hh' );
		var mm = row.querySelector( '.fl-hub-mm' );
		var ss = row.querySelector( '.fl-hub-ss' );
		seconds = Math.max( 0, Math.round( seconds ) );
		if ( hh ) {
			hh.value = Math.floor( seconds / 3600 );
		}
		if ( mm ) {
			mm.value = Math.floor( ( seconds % 3600 ) / 60 );
		}
		if ( ss ) {
			ss.value = seconds % 60;
		}
		syncDuration( row );
	}

	function formatHms( seconds ) {
		var h = Math.floor( seconds / 3600 );
		var m = Math.floor( ( seconds % 3600 ) / 60 );
		var s = Math.floor( seconds % 60 );
		var parts = [];
		if ( h ) {
			parts.push( h + 'h' );
		}
		if ( m || h ) {
			parts.push( m + 'm' );
		}
		parts.push( s + 's' );
		return parts.join( ' ' );
	}

	/* ---------- YouTube auto-detect (no API key needed — same IFrame API
	   the front-end playout engine uses, just to read getDuration()) ---------- */

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

	/**
	 * Loads a video ID in a hidden, muted player just long enough to read its
	 * real length, then tears it down. Never blocks or errors visibly — an
	 * invalid/private video ID just means auto-detect silently does nothing
	 * and Austin can still type a length by hand.
	 */
	function detectYouTubeDuration( videoId, row, hintEl ) {
		if ( hintEl ) {
			hintEl.textContent = 'Detecting length…';
		}
		ensureYouTubeApi().then( function () {
			var mount = document.createElement( 'div' );
			mount.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;left:-9999px;';
			document.body.appendChild( mount );
			var cleaned = false;
			var cleanup = function ( player ) {
				if ( cleaned ) {
					return;
				}
				cleaned = true;
				try {
					player && player.destroy();
				} catch ( err ) {
					/* nothing to clean up */
				}
				if ( mount.parentNode ) {
					mount.parentNode.removeChild( mount );
				}
			};
			var safetyTimeout = setTimeout( function () {
				if ( hintEl && ! cleaned ) {
					hintEl.textContent = '';
				}
				cleanup( player );
			}, 8000 );
			var player = new window.YT.Player( mount, {
				videoId: videoId,
				playerVars: { autoplay: 0, mute: 1 },
				events: {
					onReady: function ( e ) {
						clearTimeout( safetyTimeout );
						var duration = e.target.getDuration();
						if ( duration > 0 ) {
							if ( durationIsUnset( row ) ) {
								setDurationSeconds( row, duration );
							}
							if ( hintEl ) {
								hintEl.textContent = 'Detected: ' + formatHms( duration );
							}
						} else if ( hintEl ) {
							hintEl.textContent = '';
						}
						cleanup( e.target );
					},
					onError: function () {
						clearTimeout( safetyTimeout );
						if ( hintEl ) {
							hintEl.textContent = '';
						}
						cleanup( player );
					},
				},
			} );
		} );
	}

	function wireDragReorder( container ) {
		var dragging = null;

		container.addEventListener( 'dragstart', function ( e ) {
			var row = e.target.closest( '.fl-hub-row' );
			if ( ! row ) {
				return;
			}
			dragging = row;
			row.style.opacity = '0.4';
			e.dataTransfer.effectAllowed = 'move';
		} );

		container.addEventListener( 'dragend', function () {
			if ( dragging ) {
				dragging.style.opacity = '';
			}
			dragging = null;
		} );

		container.addEventListener( 'dragover', function ( e ) {
			e.preventDefault();
			var overRow = e.target.closest( '.fl-hub-row' );
			if ( ! overRow || overRow === dragging || ! dragging ) {
				return;
			}
			var rect = overRow.getBoundingClientRect();
			var after = e.clientY - rect.top > rect.height / 2;
			container.insertBefore( dragging, after ? overRow.nextSibling : overRow );
		} );
	}

	function wireAddButton( buttonId, templateId, containerId ) {
		var button = document.getElementById( buttonId );
		var template = document.getElementById( templateId );
		var container = document.getElementById( containerId );
		if ( ! button || ! template || ! container ) {
			return;
		}
		button.addEventListener( 'click', function () {
			var clone = template.content.cloneNode( true );
			container.appendChild( clone );
		} );
	}

	// Event delegation on the document so it covers rows added later by the
	// "+ Add" buttons without needing to re-wire listeners per row.
	document.addEventListener( 'click', function ( e ) {
		if ( e.target.closest( '.fl-hub-remove-row' ) ) {
			var row = e.target.closest( '.fl-hub-row' );
			if ( row ) {
				row.parentNode.removeChild( row );
			}
		}
	} );

	document.addEventListener( 'change', function ( e ) {
		if ( e.target.classList.contains( 'fl-hub-type-select' ) ) {
			var row = e.target.closest( '.fl-hub-row' );
			if ( ! row ) {
				return;
			}
			var isPost = e.target.value === 'post';
			row.setAttribute( 'data-type', e.target.value );
			row.querySelectorAll( '.fl-hub-field-video' ).forEach( function ( el ) {
				el.style.display = isPost ? 'none' : '';
			} );
			row.querySelectorAll( '.fl-hub-field-post' ).forEach( function ( el ) {
				el.style.display = isPost ? '' : 'none';
			} );
			// Switching a row's type invalidates any auto-detected length.
			var hint = row.querySelector( '.fl-hub-duration__hint' );
			if ( hint ) {
				hint.textContent = '';
			}
			return;
		}

		// Picking a blog post auto-fills the Title field (only if it's still
		// empty, so it never overwrites something Austin already typed).
		if ( e.target.matches( '.fl-hub-field-post select' ) ) {
			var postRow = e.target.closest( '.fl-hub-row' );
			if ( ! postRow ) {
				return;
			}
			var titleInput = postRow.querySelector( 'input[name="fourliberty_playlist[][title]"]' );
			var chosen = e.target.selectedOptions[ 0 ];
			if ( titleInput && ! titleInput.value && chosen && chosen.dataset.title ) {
				titleInput.value = chosen.dataset.title;
			}
			return;
		}

		// Entering/changing a YouTube video ID auto-detects the real length —
		// only fills it in if h/m/s are still all zero, so it never overwrites
		// a length Austin already set on purpose (e.g. to run just a clip).
		if ( e.target.matches( '.fl-hub-field-video input[name="fourliberty_playlist[][source_id]"]' ) ) {
			var videoRow = e.target.closest( '.fl-hub-row' );
			var videoId = e.target.value.trim();
			if ( ! videoRow || ! videoId || videoRow.getAttribute( 'data-type' ) !== 'youtube' ) {
				return;
			}
			detectYouTubeDuration( videoId, videoRow, videoRow.querySelector( '.fl-hub-duration__hint' ) );
		}
	} );

	document.addEventListener( 'input', function ( e ) {
		if ( e.target.matches( '.fl-hub-hh, .fl-hub-mm, .fl-hub-ss' ) ) {
			var row = e.target.closest( '.fl-hub-row' );
			if ( row ) {
				syncDuration( row );
			}
		}
	} );

	function init() {
		var playlistRows = document.getElementById( 'fourliberty-playlist-rows' );
		if ( playlistRows ) {
			wireDragReorder( playlistRows );
			playlistRows.querySelectorAll( '.fl-hub-row' ).forEach( syncDuration );
		}
		wireAddButton( 'fourliberty-add-playlist-item', 'fourliberty-playlist-row-template', 'fourliberty-playlist-rows' );
		wireAddButton( 'fourliberty-add-ad', 'fourliberty-ad-row-template', 'fourliberty-ads-rows' );
	}

	document.addEventListener( 'DOMContentLoaded', init );
} )();
