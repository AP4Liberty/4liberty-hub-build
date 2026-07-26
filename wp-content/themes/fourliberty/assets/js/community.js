/**
 * Community page composer/reply/report logic (PHASE-8-BUILD-PLAN.md Task
 * D). Posting/replying/reporting all require login — reading never does
 * (Decision 4) — enforced here only for UX (show/hide the right form); the
 * REAL enforcement is server-side in community-post.mts/community-
 * reply.mts/community-report.mts, which this file has no way to bypass no
 * matter what it does client-side.
 *
 * Reuses window.FLHub.identity.mount() (account.js) for the login prompt —
 * the exact same email + 6-digit-code UI as the homepage chat rail, not a
 * second login implementation to keep in sync.
 *
 * No-ops immediately wherever its markup isn't on the page, same pattern as
 * every other script in this theme.
 */
( function () {
	'use strict';

	var POST_ENDPOINT =
		( window.fourlibertyCommunityPostEndpoint && window.fourlibertyCommunityPostEndpoint.url ) ||
		'https://4liberty-poller.netlify.app/api/community-post';
	var REPLY_ENDPOINT =
		( window.fourlibertyCommunityReplyEndpoint && window.fourlibertyCommunityReplyEndpoint.url ) ||
		'https://4liberty-poller.netlify.app/api/community-reply';
	var REPORT_ENDPOINT =
		( window.fourlibertyCommunityReportEndpoint && window.fourlibertyCommunityReportEndpoint.url ) ||
		'https://4liberty-poller.netlify.app/api/community-report';

	function session() {
		return window.FLHub && window.FLHub.identity && window.FLHub.identity.getSession();
	}

	/**
	 * A reissued session token rides back on every authenticated response
	 * (PHASE-8-BUILD-PLAN.md Decision 11b) — persisting it here is what
	 * makes posting/replying/reporting slide the session's expiry the same
	 * way chat and tips already do.
	 */
	function absorbSessionToken( data ) {
		if ( data && data.sessionToken && window.FLHub && window.FLHub.identity ) {
			window.FLHub.identity.updateSessionToken( data.sessionToken );
		}
	}

	function setStatus( statusEl, text, isError ) {
		if ( ! statusEl ) {
			return;
		}
		statusEl.textContent = text || '';
		statusEl.classList.toggle( 'fl-community-composer__status--error', !! isError );
	}

	/**
	 * Wires ONE composer-style area: mounts the shared login prompt into its
	 * [data-fl="community-login-prompt"] child, and shows/hides the given
	 * form based on login state — shared by both the top-of-feed composer
	 * and the single-post reply form, which are structurally identical.
	 */
	function wireComposerArea( area, form ) {
		var loginPrompt = area.querySelector( '[data-fl="community-login-prompt"]' );
		if ( loginPrompt && window.FLHub && window.FLHub.identity ) {
			window.FLHub.identity.mount( loginPrompt );
		}

		function sync() {
			var s = session();
			form.hidden = ! s;
			if ( loginPrompt ) {
				loginPrompt.hidden = !! s;
			}
		}

		sync();
		if ( window.FLHub && window.FLHub.identity ) {
			window.FLHub.identity.onChange( sync );
		}
	}

	function friendlyError( errorCode ) {
		switch ( errorCode ) {
			case 'rate_limited':
				return 'Slow down a little — try again shortly.';
			case 'community_paused':
				return 'Posting is paused right now.';
			case 'account_banned':
				return 'This account can’t post.';
			default:
				return 'That didn’t work — try again in a moment.';
		}
	}

	function wireComposer() {
		var area = document.querySelector( '[data-fl="community-composer-area"]' );
		var form = document.querySelector( '[data-fl="community-composer-form"]' );
		if ( ! area || ! form ) {
			return;
		}
		wireComposerArea( area, form );

		var statusEl = form.querySelector( '[data-fl="community-composer-status"]' );
		var submitBtn = form.querySelector( 'button[type="submit"]' );

		form.addEventListener( 'submit', function ( evt ) {
			evt.preventDefault();
			var s = session();
			var title = form.elements.title.value.trim();
			var body = form.elements.body.value.trim();
			// Both optional (Phase 8, Task E) — a missing/invalid topic falls
			// back to "General" server-side; a missing/invalid GIF link is
			// just dropped, the post still goes through as text-only.
			var topic = form.elements.topic ? form.elements.topic.value : '';
			var gifUrl = form.elements.gifUrl ? form.elements.gifUrl.value.trim() : '';
			if ( ! s || ! title || ! body ) {
				return;
			}

			submitBtn.disabled = true;
			setStatus( statusEl, 'Posting…', false );

			var payload = { sessionToken: s.token, title: title, body: body };
			if ( topic ) {
				payload.topic = topic;
			}
			if ( gifUrl ) {
				payload.gifUrl = gifUrl;
			}

			fetch( POST_ENDPOINT, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify( payload ),
			} )
				.then( function ( res ) {
					return res.json().then( function ( data ) {
						return { ok: res.ok, data: data };
					} );
				} )
				.then( function ( result ) {
					absorbSessionToken( result.data );
					if ( ! result.ok || ! result.data.success ) {
						submitBtn.disabled = false;
						setStatus( statusEl, friendlyError( result.data && result.data.error ), true );
						return;
					}
					setStatus(
						statusEl,
						'pending' === result.data.status ? 'Posted — held for a quick check since your link is new.' : 'Posted!',
						false
					);
					window.location.href = result.data.url;
				} )
				.catch( function () {
					submitBtn.disabled = false;
					setStatus( statusEl, friendlyError( null ), true );
				} );
		} );
	}

	function wireReplyForm() {
		var area = document.querySelector( '[data-fl="community-reply-area"]' );
		var form = document.querySelector( '[data-fl="community-reply-form"]' );
		if ( ! area || ! form ) {
			return;
		}
		wireComposerArea( area, form );

		var postId = parseInt( area.getAttribute( 'data-fl-post-id' ), 10 );
		var statusEl = form.querySelector( '[data-fl="community-reply-status"]' );
		var submitBtn = form.querySelector( 'button[type="submit"]' );

		form.addEventListener( 'submit', function ( evt ) {
			evt.preventDefault();
			var s = session();
			var body = form.elements.body.value.trim();
			var gifUrl = form.elements.gifUrl ? form.elements.gifUrl.value.trim() : '';
			if ( ! s || ! postId || ! body ) {
				return;
			}

			submitBtn.disabled = true;
			setStatus( statusEl, 'Posting…', false );

			var payload = { sessionToken: s.token, postId: postId, body: body };
			if ( gifUrl ) {
				payload.gifUrl = gifUrl;
			}

			fetch( REPLY_ENDPOINT, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify( payload ),
			} )
				.then( function ( res ) {
					return res.json().then( function ( data ) {
						return { ok: res.ok, data: data };
					} );
				} )
				.then( function ( result ) {
					absorbSessionToken( result.data );
					if ( ! result.ok || ! result.data.success ) {
						submitBtn.disabled = false;
						setStatus( statusEl, friendlyError( result.data && result.data.error ), true );
						return;
					}
					// Simplest correct behavior — a full reload guarantees the
					// new reply (or its "held for review" state) renders
					// exactly as the server sees it, no client-side guessing.
					window.location.reload();
				} )
				.catch( function () {
					submitBtn.disabled = false;
					setStatus( statusEl, friendlyError( null ), true );
				} );
		} );
	}

	function wireOneReportButton( btn ) {
		btn.addEventListener( 'click', function () {
			var s = session();
			if ( ! s ) {
				window.alert( 'Log in to report something.' );
				return;
			}
			if ( btn.disabled ) {
				return;
			}
			btn.disabled = true;
			var targetType = btn.getAttribute( 'data-fl-target-type' );
			var targetId = parseInt( btn.getAttribute( 'data-fl-target-id' ), 10 );

			fetch( REPORT_ENDPOINT, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify( { sessionToken: s.token, targetType: targetType, targetId: targetId } ),
			} )
				.then( function ( res ) {
					return res.json().then( function ( data ) {
						return { ok: res.ok, data: data };
					} );
				} )
				.then( function ( result ) {
					absorbSessionToken( result.data );
					if ( result.ok && result.data && result.data.success ) {
						btn.textContent = 'Reported';
					} else {
						btn.disabled = false;
					}
				} )
				.catch( function () {
					btn.disabled = false;
				} );
		} );
	}

	function wireReportButtons() {
		var buttons = document.querySelectorAll( '[data-fl="community-report"]' );
		buttons.forEach( wireOneReportButton );
	}

	function init() {
		wireComposer();
		wireReplyForm();
		wireReportButtons();
	}

	document.addEventListener( 'DOMContentLoaded', init );
} )();
