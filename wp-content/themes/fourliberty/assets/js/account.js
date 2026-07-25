/**
 * 4Liberty Network — light accounts (Phase 3, task D).
 *
 * Email magic-link login, no passwords (PHASE-3-BUILD-PLAN.md Decision 6).
 * Self-contained: works on any page, independent of chat.js's own timing —
 * injects its own small status/login control into the chat rail, right
 * below the header.
 *
 * The session token lives in localStorage (NOT a cookie — sidesteps
 * third-party-cookie limits between the GoDaddy-hosted site and the
 * netlify.app backend) and is exposed via window.FLHub.identity for Task F
 * to wire into chat.js's authenticated path and tips.js's saved-card path.
 *
 * The account is an optional upgrade, never a wall — chat stays open to
 * anonymous visitors regardless of anything in this file (Decision: "Path
 * A, at launch", PHASE-0-FINDINGS.md).
 */
( function () {
	'use strict';

	var AUTH_REQUEST_ENDPOINT =
		( window.fourlibertyAuthRequestEndpoint && window.fourlibertyAuthRequestEndpoint.url ) ||
		'https://4liberty-poller.netlify.app/api/auth-request';
	var AUTH_VERIFY_ENDPOINT =
		( window.fourlibertyAuthVerifyEndpoint && window.fourlibertyAuthVerifyEndpoint.url ) ||
		'https://4liberty-poller.netlify.app/api/auth-verify';
	var AUTH_CODE_ENDPOINT =
		( window.fourlibertyAuthCodeEndpoint && window.fourlibertyAuthCodeEndpoint.url ) ||
		'https://4liberty-poller.netlify.app/api/auth-code';

	var SESSION_STORAGE_KEY = 'fl-session';
	var VERIFY_PARAM = 'fl_verify';

	// Every container currently showing the login/logout control — was a
	// single `els` slot until Task D's Community composer needed a SECOND
	// place on the page to show the exact same control (see mount() below).
	var mounts = [];
	// Loaded immediately below (top-level, not inside init()) — this only
	// touches localStorage, no DOM needed, so other scripts' own
	// DOMContentLoaded handlers (chat.js) can rely on
	// window.FLHub.identity.getSession() already being correct regardless
	// of which script's listener happens to run first.
	var session = null; // { token, userId, email, displayName } | null
	var changeListeners = [];

	function loadSession() {
		try {
			var raw = window.localStorage.getItem( SESSION_STORAGE_KEY );
			return raw ? JSON.parse( raw ) : null;
		} catch ( e ) {
			return null;
		}
	}

	function saveSession( s ) {
		try {
			window.localStorage.setItem( SESSION_STORAGE_KEY, JSON.stringify( s ) );
		} catch ( e ) {
			// Private browsing / storage disabled — session just won't persist a reload.
		}
	}

	function clearSession() {
		session = null;
		try {
			window.localStorage.removeItem( SESSION_STORAGE_KEY );
		} catch ( e ) {}
	}

	session = loadSession();

	function notifyChange() {
		changeListeners.forEach( function ( cb ) {
			try {
				cb( session );
			} catch ( e ) {
				// A listener's own bug shouldn't break login/logout for everyone else.
			}
		} );
	}

	window.FLHub = window.FLHub || {};
	window.FLHub.identity = {
		getSession: function () {
			return session;
		},
		logout: function () {
			clearSession();
			render();
			notifyChange();
		},
		/**
		 * Lets chat.js (and tips.js) react when a login/logout happens AFTER
		 * their own init() already ran — the common real case: clicking a
		 * magic-link email is a fresh page load, so chat.js has already
		 * connected anonymously by the time this file's async auth-verify
		 * call resolves moments later.
		 */
		onChange: function ( callback ) {
			changeListeners.push( callback );
		},
		/**
		 * Persists a reissued token from a sliding session refresh
		 * (PHASE-8-BUILD-PLAN.md Decision 11b) — called by chat.js and
		 * tips.js whenever an authenticated response hands one back.
		 * Deliberately does NOT re-render or notify change listeners: the
		 * identity itself hasn't changed, only the token's expiry, so
		 * there's nothing for chat.js/tips.js to react to.
		 */
		updateSessionToken: function ( newToken ) {
			if ( ! session || ! newToken ) {
				return;
			}
			session.token = newToken;
			saveSession( session );
		},
		/**
		 * Renders the current login/logout control into ANY container, kept
		 * in sync automatically on every future login/logout/verify — added
		 * for Task D's Community composer, which needs the exact same login
		 * UI (link + 6-digit code, Decision 11a) in a second place on the
		 * page, not just the homepage chat rail. Safe to call more than once
		 * on the same container; each mounted container renders and updates
		 * independently thereafter.
		 */
		mount: function ( container ) {
			if ( ! container || mounts.indexOf( container ) !== -1 ) {
				return;
			}
			mounts.push( container );
			renderInto( container );
		},
	};

	function clear( el ) {
		while ( el.firstChild ) {
			el.removeChild( el.firstChild );
		}
	}

	function renderInto( container ) {
		clear( container );
		if ( session ) {
			renderLoggedIn( container );
		} else {
			renderLoggedOut( container );
		}
	}

	function render() {
		mounts.forEach( renderInto );
	}

	function renderLoggedIn( container ) {
		var row = document.createElement( 'div' );
		row.className = 'fl-account';

		var text = document.createElement( 'span' );
		text.textContent = 'Logged in as ' + session.email;

		var logoutBtn = document.createElement( 'button' );
		logoutBtn.type = 'button';
		logoutBtn.className = 'fl-account__link';
		logoutBtn.textContent = 'Log out';
		logoutBtn.addEventListener( 'click', function () {
			window.FLHub.identity.logout();
		} );

		row.appendChild( text );
		row.appendChild( document.createTextNode( ' · ' ) );
		row.appendChild( logoutBtn );
		container.appendChild( row );
	}

	function renderLoggedOut( container ) {
		var row = document.createElement( 'div' );
		row.className = 'fl-account';

		var toggle = document.createElement( 'button' );
		toggle.type = 'button';
		toggle.className = 'fl-account__link';
		toggle.textContent = 'Save your spot & enable one-tap tips — log in';

		var emailForm = document.createElement( 'form' );
		emailForm.className = 'fl-account__form';
		emailForm.hidden = true;
		var emailInput = document.createElement( 'input' );
		emailInput.type = 'email';
		emailInput.placeholder = 'you@example.com';
		emailInput.required = true;
		emailInput.autocomplete = 'email';
		var sendBtn = document.createElement( 'button' );
		sendBtn.type = 'submit';
		sendBtn.textContent = 'Send link';
		emailForm.appendChild( emailInput );
		emailForm.appendChild( sendBtn );

		// Revealed only after a successful send — the email always carries
		// BOTH a link and a 6-digit code (PHASE-8-BUILD-PLAN.md Decision
		// 11a). The code matters because tapping the link inside an email
		// app's OWN in-app browser (Gmail's, etc.) completes login in THAT
		// browser's storage, not this one — a typed code never leaves the
		// page, so it works even when the link silently doesn't.
		var codeForm = document.createElement( 'form' );
		codeForm.className = 'fl-account__form';
		codeForm.hidden = true;
		var codeInput = document.createElement( 'input' );
		codeInput.type = 'text';
		codeInput.inputMode = 'numeric';
		codeInput.autocomplete = 'one-time-code';
		codeInput.placeholder = '6-digit code';
		codeInput.maxLength = 6;
		var verifyBtn = document.createElement( 'button' );
		verifyBtn.type = 'submit';
		verifyBtn.textContent = 'Verify';
		codeForm.appendChild( codeInput );
		codeForm.appendChild( verifyBtn );

		var status = document.createElement( 'div' );
		status.className = 'fl-account__status';

		// Remembered so codeForm's submit doesn't need to ask for the email
		// a second time — set only once requestLink() confirms the send.
		var sentToEmail = '';

		toggle.addEventListener( 'click', function () {
			toggle.hidden = true;
			emailForm.hidden = false;
			emailInput.focus();
		} );

		emailForm.addEventListener( 'submit', function ( evt ) {
			evt.preventDefault();
			var email = emailInput.value.trim();
			requestLink( email, sendBtn, status, function () {
				sentToEmail = email;
				emailForm.hidden = true;
				codeForm.hidden = false;
				codeInput.focus();
			} );
		} );

		codeForm.addEventListener( 'submit', function ( evt ) {
			evt.preventDefault();
			verifyCode( sentToEmail, codeInput.value.trim(), verifyBtn, status );
		} );

		row.appendChild( toggle );
		row.appendChild( emailForm );
		row.appendChild( codeForm );
		row.appendChild( status );
		container.appendChild( row );
	}

	function requestLink( email, submitBtn, status, onSent ) {
		if ( ! email ) {
			return;
		}
		submitBtn.disabled = true;
		status.textContent = 'Sending…';

		var displayName = ( window.FLHub && window.FLHub.chat && window.FLHub.chat.getDisplayName() ) || '';

		fetch( AUTH_REQUEST_ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify( {
				email: email,
				displayName: displayName,
				// Validated server-side against an allowlist (PHASE-8-BUILD-
				// PLAN.md Decision 9) — an unrecognized path just falls back
				// to the homepage there, so this never needs validating here.
				returnPath: window.location.pathname,
			} ),
		} )
			.then( function ( res ) {
				return res.json().then( function ( data ) {
					return { ok: res.ok, data: data };
				} );
			} )
			.then( function ( result ) {
				if ( ! result.ok || ! result.data.success ) {
					status.textContent = 'That didn’t work — try again in a moment.';
					submitBtn.disabled = false;
					return;
				}
				status.textContent = '📧 Check your email — click the link, or enter the code below.';
				if ( onSent ) {
					onSent();
				}
			} )
			.catch( function () {
				status.textContent = 'That didn’t work — try again in a moment.';
				submitBtn.disabled = false;
			} );
	}

	/**
	 * The code path (PHASE-8-BUILD-PLAN.md Decision 11a) — lands on the same
	 * applyAuthSuccess() as the link path below, since /api/auth-code
	 * resolves to the exact same session-creation logic server-side.
	 */
	function verifyCode( email, code, submitBtn, status ) {
		if ( ! email || ! code ) {
			return;
		}
		submitBtn.disabled = true;
		status.textContent = 'Checking…';

		fetch( AUTH_CODE_ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify( { email: email, code: code } ),
		} )
			.then( function ( res ) {
				return res.json().then( function ( data ) {
					return { ok: res.ok, data: data };
				} );
			} )
			.then( function ( result ) {
				if ( ! result.ok || ! result.data.success ) {
					status.textContent = 'That code didn’t work — check it, or use the link in the email instead.';
					submitBtn.disabled = false;
					return;
				}
				applyAuthSuccess( result.data );
			} )
			.catch( function () {
				status.textContent = 'That code didn’t work — check it, or use the link in the email instead.';
				submitBtn.disabled = false;
			} );
	}

	/** Shared by the link path (verifyFromUrl) and the code path (verifyCode) below. */
	function applyAuthSuccess( data ) {
		session = {
			token: data.sessionToken,
			userId: data.userId,
			email: data.email,
			displayName: data.displayName,
		};
		saveSession( session );
		render();
		notifyChange();
	}

	function renderVerifying() {
		mounts.forEach( function ( container ) {
			clear( container );
			var row = document.createElement( 'div' );
			row.className = 'fl-account';
			row.textContent = 'Logging you in…';
			container.appendChild( row );
		} );
	}

	function verifyFromUrl( token ) {
		renderVerifying();

		fetch( AUTH_VERIFY_ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify( { token: token } ),
		} )
			.then( function ( res ) {
				return res.json().then( function ( data ) {
					return { ok: res.ok, data: data };
				} );
			} )
			.then( function ( result ) {
				if ( result.ok && result.data.success ) {
					applyAuthSuccess( result.data );
					return;
				}
				render();
			} )
			.catch( function () {
				render();
			} );
	}

	/**
	 * Extracts and removes fl_verify from the URL immediately (before the
	 * fetch even starts) so a refresh mid-verify — or the browser's own
	 * back/forward cache — can never resubmit the same token.
	 */
	function extractAndCleanVerifyToken() {
		var params = new URLSearchParams( window.location.search );
		var token = params.get( VERIFY_PARAM );
		if ( ! token ) {
			return null;
		}
		params.delete( VERIFY_PARAM );
		var query = params.toString();
		var cleanUrl = window.location.pathname + ( query ? '?' + query : '' ) + window.location.hash;
		window.history.replaceState( {}, '', cleanUrl );
		return token;
	}

	function init() {
		var rail = document.querySelector( '[data-fl="chat-rail"]' );
		if ( rail ) {
			var container = document.createElement( 'div' );
			container.setAttribute( 'data-fl', 'account' );
			var head = rail.querySelector( '.fl-rail__head' );
			if ( head ) {
				head.insertAdjacentElement( 'afterend', container );
			} else {
				rail.insertBefore( container, rail.firstChild );
			}
			window.FLHub.identity.mount( container );
		}

		// Runs on EVERY page, not just ones with a chat rail — completing a
		// magic-link click must work regardless of whether THIS page happens
		// to render the little login/logout row itself
		// (PHASE-8-BUILD-PLAN.md Decision 9: returnPath exists specifically
		// so a visitor can land back on a rail-less page like /community/
		// after logging in — the old rail-only early return silently broke
		// that for exactly the page it was built for).
		var token = extractAndCleanVerifyToken();
		if ( token ) {
			verifyFromUrl( token );
		}
	}

	document.addEventListener( 'DOMContentLoaded', init );
} )();
