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

	/**
	 * Lets Austin paste a full YouTube/Rumble URL instead of hunting for the
	 * bare video ID (2026-07-23, his own request after re-adding a video by
	 * hand) — rewrites the field to just the ID the moment it's recognized,
	 * so what actually gets saved is always visible rather than a guess
	 * about what got parsed out of a pasted link. Leaves the value alone if
	 * it doesn't match a known URL shape — it might already be a bare ID,
	 * or a format this doesn't recognize yet, and guessing wrong would be
	 * worse than a no-op.
	 */
	function extractVideoId( raw, type ) {
		var value = ( raw || '' ).trim();
		if ( ! value ) {
			return value;
		}
		if ( type === 'rumble' ) {
			// rumble.com/v7d4g0e-some-title.html -> "v7d4g0e" — the "v"
			// prefix is part of Rumble's own id, not something to strip.
			var rumbleMatch = value.match( /rumble\.com\/([a-z0-9]+)-/i );
			return rumbleMatch ? rumbleMatch[ 1 ] : value;
		}
		// YouTube's various URL shapes; a bare ID (or an unrecognized
		// format) falls through unchanged.
		var patterns = [
			/[?&]v=([a-zA-Z0-9_-]{11})/, // youtube.com/watch?v=ID
			/youtu\.be\/([a-zA-Z0-9_-]{11})/, // youtu.be/ID
			/\/embed\/([a-zA-Z0-9_-]{11})/, // youtube.com/embed/ID
			/\/shorts\/([a-zA-Z0-9_-]{11})/, // youtube.com/shorts/ID
		];
		for ( var i = 0; i < patterns.length; i++ ) {
			var m = value.match( patterns[ i ] );
			if ( m ) {
				return m[ 1 ];
			}
		}
		return value;
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

	// Real value is set in init(), once the actual existing-row count is
	// known; this is just a safe pre-init default. Then incremented per
	// clone — only needs to be unique within this one form submission,
	// never persisted or compared across sessions. Ordinary small integers
	// picking up right after the existing saved rows (2026-07-23) — a prior
	// version seeded this from Date.now(), a 13-digit number, on the theory
	// that it just needed to be "big enough" to never collide. Changed
	// after Austin's save kept silently not going through with no visible
	// error even with a fully valid, filled-in row: this site runs a
	// security firewall (Sucuri, installed after last year's compromise),
	// and unusually large array-like keys in submitted form data are
	// exactly the kind of thing generic WAF rules flag as a potential PHP
	// array/hash-collision attack. Never confirmed as the actual cause, but
	// it's a real risk this form never needed to take on — any unique
	// integer works equally well functionally.
	var nextNewRowIndex = 0;

	/**
	 * The <template> markup carries the literal string '__INDEX__' in place
	 * of a real array index (see settings-dark-channel.php's
	 * fourliberty_hub_render_playlist_row()/_ad_row()) — every field in one
	 * row needs to share the SAME index so PHP groups them into one array
	 * element instead of scattering type/source_id/title/etc. into separate
	 * ones (the actual reason a saved item could vanish entirely, fixed
	 * 2026-07-23). Substituting a fresh index per clone here is what keeps
	 * that guarantee for rows added after page load, same as the ones PHP
	 * already rendered with a real index.
	 */
	function assignRowIndex( fragment ) {
		var index = nextNewRowIndex++;
		fragment.querySelectorAll( '[name]' ).forEach( function ( el ) {
			el.name = el.name.replace( '__INDEX__', index );
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
			assignRowIndex( clone );
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
			return;
		}

		// Image-ad picker (2026-07-23) — same WP media-library flow as the
		// Shop Ad screen. Delegated so it covers rows added after page load.
		var chooseBtn = e.target.closest( '.fl-hub-choose-image' );
		if ( chooseBtn ) {
			e.preventDefault();
			var imageRow = chooseBtn.closest( '.fl-hub-row' );
			if ( ! imageRow || ! window.wp || ! wp.media ) {
				return;
			}
			var frame = wp.media( {
				title: 'Choose an ad image',
				button: { text: 'Use this image' },
				multiple: false,
			} );
			frame.on( 'select', function () {
				var attachment = frame.state().get( 'selection' ).first().toJSON();
				var url = ( attachment.sizes && attachment.sizes.large ) ? attachment.sizes.large.url : attachment.url;
				var input = imageRow.querySelector( '.fl-hub-image-url' );
				var preview = imageRow.querySelector( '.fl-hub-image-preview' );
				if ( input ) {
					input.value = url;
				}
				if ( preview ) {
					preview.style.backgroundImage = 'url(' + url + ')';
				}
			} );
			frame.open();
		}
	} );

	// Show/hide every element matching `selector` within a row.
	function toggleGroup( row, selector, show ) {
		row.querySelectorAll( selector ).forEach( function ( el ) {
			el.style.display = show ? '' : 'none';
		} );
	}

	document.addEventListener( 'change', function ( e ) {
		if ( e.target.classList.contains( 'fl-hub-type-select' ) ) {
			var row = e.target.closest( '.fl-hub-row' );
			if ( ! row ) {
				return;
			}
			// Four types now (2026-07-23): youtube/rumble show the video + a
			// play length; post shows the blog picker; image shows the ad
			// image + link. Only real videos have a duration to detect.
			var type = e.target.value;
			var isVideo = type === 'youtube' || type === 'rumble';
			row.setAttribute( 'data-type', type );
			toggleGroup( row, '.fl-hub-field-video', isVideo );
			toggleGroup( row, '.fl-hub-field-post', type === 'post' );
			toggleGroup( row, '.fl-hub-field-image', type === 'image' );
			toggleGroup( row, '.fl-hub-field-duration', isVideo );
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
			// Substring match, not an exact name= (2026-07-23): each row's
			// fields now carry a real per-row index (fourliberty_playlist[
			// 0][title], not the old empty-bracket [][title] every row used
			// to share the literal same attribute value for) — see
			// settings-dark-channel.php's render functions and
			// assignRowIndex() above for why. An exact-match selector here
			// would silently never find anything post-fix.
			var titleInput = postRow.querySelector( 'input[name*="[title]"]' );
			var chosen = e.target.selectedOptions[ 0 ];
			if ( titleInput && ! titleInput.value && chosen && chosen.dataset.title ) {
				titleInput.value = chosen.dataset.title;
			}
			return;
		}

		// Entering/changing a video ID: first clean up a pasted full URL down
		// to the bare ID (extractVideoId() above), then — YouTube only —
		// auto-detect the real length, same as before. Only fills duration
		// in if h/m/s are still all zero, so it never overwrites a length
		// Austin already set on purpose (e.g. to run just a clip). Same
		// substring-match fix as the title selector above — this one
		// matters more: it's what triggers YouTube's auto-duration-detect,
		// which was silently never firing at all post-index-fix until now.
		if ( e.target.matches( '.fl-hub-field-video input[name*="[source_id]"]' ) ) {
			var videoRow = e.target.closest( '.fl-hub-row' );
			if ( ! videoRow ) {
				return;
			}
			var rowType = videoRow.getAttribute( 'data-type' );
			var cleaned = extractVideoId( e.target.value, rowType );
			if ( cleaned !== e.target.value ) {
				e.target.value = cleaned; // pasted a full URL — show the id we actually kept
			}
			if ( cleaned && rowType === 'youtube' ) {
				detectYouTubeDuration( cleaned, videoRow, videoRow.querySelector( '.fl-hub-duration__hint' ) );
			}
			return;
		}

		// Same URL-paste convenience for an ad's video ID — ads are always
		// YouTube-hosted (no Type dropdown to read here), and there's no
		// duration to auto-detect for them (the admin only collects
		// {source_id, title} for ads — see settings-dark-channel.php).
		if ( e.target.matches( '.fl-hub-ad-video input[name*="[source_id]"]' ) ) {
			var cleanedAdId = extractVideoId( e.target.value, 'youtube' );
			if ( cleanedAdId !== e.target.value ) {
				e.target.value = cleanedAdId;
			}
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
		var adRows = document.getElementById( 'fourliberty-ads-rows' );
		// However many rows PHP already rendered (real, small, sequential
		// indices — 0, 1, 2, …), start handing out fresh ones right after,
		// so a newly-added row can never collide with an existing one.
		var existingRowCount =
			( playlistRows ? playlistRows.querySelectorAll( '.fl-hub-row' ).length : 0 ) +
			( adRows ? adRows.querySelectorAll( '.fl-hub-row' ).length : 0 );
		nextNewRowIndex = existingRowCount;

		if ( playlistRows ) {
			wireDragReorder( playlistRows );
			playlistRows.querySelectorAll( '.fl-hub-row' ).forEach( syncDuration );
		}
		wireAddButton( 'fourliberty-add-playlist-item', 'fourliberty-playlist-row-template', 'fourliberty-playlist-rows' );
		wireAddButton( 'fourliberty-add-ad', 'fourliberty-ad-row-template', 'fourliberty-ads-rows' );
	}

	document.addEventListener( 'DOMContentLoaded', init );
} )();
