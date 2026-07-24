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

	var SESSION_STORAGE_KEY = 'fl-session';
	var VERIFY_PARAM = 'fl_verify';

	var els = null;
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
	};

	function clear( el ) {
		while ( el.firstChild ) {
			el.removeChild( el.firstChild );
		}
	}

	function render() {
		if ( ! els ) {
			return;
		}
		clear( els.container );
		if ( session ) {
			renderLoggedIn();
		} else {
			renderLoggedOut();
		}
	}

	function renderLoggedIn() {
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
		els.container.appendChild( row );
	}

	function renderLoggedOut() {
		var row = document.createElement( 'div' );
		row.className = 'fl-account';

		var toggle = document.createElement( 'button' );
		toggle.type = 'button';
		toggle.className = 'fl-account__link';
		toggle.textContent = 'Save your spot & enable one-tap tips — log in';

		var form = document.createElement( 'form' );
		form.className = 'fl-account__form';
		form.hidden = true;
		var input = document.createElement( 'input' );
		input.type = 'email';
		input.placeholder = 'you@example.com';
		input.required = true;
		input.autocomplete = 'email';
		var submitBtn = document.createElement( 'button' );
		submitBtn.type = 'submit';
		submitBtn.textContent = 'Send link';
		form.appendChild( input );
		form.appendChild( submitBtn );

		var status = document.createElement( 'div' );
		status.className = 'fl-account__status';

		toggle.addEventListener( 'click', function () {
			toggle.hidden = true;
			form.hidden = false;
			input.focus();
		} );

		form.addEventListener( 'submit', function ( evt ) {
			evt.preventDefault();
			requestLink( input.value.trim(), submitBtn, status );
		} );

		row.appendChild( toggle );
		row.appendChild( form );
		row.appendChild( status );
		els.container.appendChild( row );
	}

	function requestLink( email, submitBtn, status ) {
		if ( ! email ) {
			return;
		}
		submitBtn.disabled = true;
		status.textContent = 'Sending…';

		var displayName = ( window.FLHub && window.FLHub.chat && window.FLHub.chat.getDisplayName() ) || '';

		fetch( AUTH_REQUEST_ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify( { email: email, displayName: displayName } ),
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
				status.textContent = '📧 Check your email for a login link!';
			} )
			.catch( function () {
				status.textContent = 'That didn’t work — try again in a moment.';
				submitBtn.disabled = false;
			} );
	}

	function renderVerifying() {
		clear( els.container );
		var row = document.createElement( 'div' );
		row.className = 'fl-account';
		row.textContent = 'Logging you in…';
		els.container.appendChild( row );
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
					session = {
						token: result.data.sessionToken,
						userId: result.data.userId,
						email: result.data.email,
						displayName: result.data.displayName,
					};
					saveSession( session );
					render();
					notifyChange();
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
		if ( ! rail ) {
			return;
		}

		var container = document.createElement( 'div' );
		container.setAttribute( 'data-fl', 'account' );
		var head = rail.querySelector( '.fl-rail__head' );
		if ( head ) {
			head.insertAdjacentElement( 'afterend', container );
		} else {
			rail.insertBefore( container, rail.firstChild );
		}

		els = { container: container };

		var token = extractAndCleanVerifyToken();
		if ( token ) {
			verifyFromUrl( token );
		} else {
			render();
		}
	}

	document.addEventListener( 'DOMContentLoaded', init );
} )();
