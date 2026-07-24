/**
 * 4Liberty Network — "tip the show" (Phase 3, tasks E + F).
 *
 * Wires the tip chips Phase 1 left in patterns/hero-live.php
 * ([data-fl="tip-bar"], .fl-tipchips button[data-amount]) to the Square Web
 * Payments SDK: an inline card field (no redirect, no page reload). Amounts
 * shown here are a UI convenience only — the real bound is enforced
 * server-side in netlify/lib/square.mts, per PHASE-3-BUILD-PLAN.md's "never
 * trust the client" money-path rule.
 *
 * Task F: a logged-in visitor (window.FLHub.identity) sees an extra "save my
 * card" consent checkbox on a normal tip, and — once a card is on file — a
 * one-tap repeat button that skips the card field and Square SDK entirely,
 * hitting tip-repeat.mts instead of tip-create.mts. Anonymous tipping is
 * completely unchanged from Task E.
 *
 * PCI stays SAQ A: the card number is tokenized inside Square's own hosted
 * iframe (card.attach()) — this file only ever sees a one-time nonce
 * (the tokenize() result), never a raw card number.
 */
( function () {
	'use strict';

	var CONFIG =
		window.fourlibertyChatTips || {
			chatEnabled: true,
			mode: 'open',
			tipPresets: [ 5, 17.76, 50 ],
			squareApplicationId: '',
			squareLocationId: '',
			squareEnvironment: 'sandbox',
		};

	var TIP_ENDPOINT =
		( window.fourlibertyTipCreateEndpoint && window.fourlibertyTipCreateEndpoint.url ) ||
		'https://4liberty-poller.netlify.app/api/tip-create';

	var TIP_REPEAT_ENDPOINT =
		( window.fourlibertyTipRepeatEndpoint && window.fourlibertyTipRepeatEndpoint.url ) ||
		'https://4liberty-poller.netlify.app/api/tip-repeat';

	// Square's own documented rule: same URL with the "sandbox." subdomain
	// dropped for production. Driven by the same config flag the Netlify
	// backend's SQUARE_ENVIRONMENT uses, so both sides agree on which mode
	// is live.
	var SQUARE_SDK_URL =
		CONFIG.squareEnvironment === 'production'
			? 'https://web.squarecdn.com/v1/square.js'
			: 'https://sandbox.web.squarecdn.com/v1/square.js';

	var MIN_DOLLARS = 1;
	var MAX_DOLLARS = 500;

	var els = null;
	var card = null;
	var cardReady = null; // promise, resolves once Square's hosted card field is attached
	var currentAmountDollars = 0;
	var submitting = false;

	function loadSquareSdk() {
		if ( window.Square ) {
			return Promise.resolve( window.Square );
		}
		return new Promise( function ( resolve, reject ) {
			var script = document.createElement( 'script' );
			script.src = SQUARE_SDK_URL;
			script.onload = function () {
				resolve( window.Square );
			};
			script.onerror = function () {
				reject( new Error( 'Square SDK failed to load' ) );
			};
			document.head.appendChild( script );
		} );
	}

	/** Lazily initializes payments/card ONCE and reuses it across panel opens. */
	function ensureCard() {
		if ( cardReady ) {
			return cardReady;
		}
		cardReady = loadSquareSdk()
			.then( function ( Square ) {
				return Square.payments( CONFIG.squareApplicationId, CONFIG.squareLocationId );
			} )
			.then( function ( payments ) {
				return payments.card();
			} )
			.then( function ( c ) {
				card = c;
				return card.attach( els.cardContainer );
			} );
		return cardReady;
	}

	function setStatus( text, isError ) {
		if ( ! els.status ) {
			return;
		}
		els.status.textContent = text || '';
		els.status.classList.toggle( 'fl-tip-panel__status--error', !! isError );
	}

	function setAmount( dollars ) {
		currentAmountDollars = dollars;
		var hasAmount = isFinite( dollars ) && dollars > 0;
		els.amountLabel.textContent = hasAmount ? 'Tipping $' + dollars.toFixed( 2 ) : 'Enter a custom amount';
		els.submitBtn.textContent = hasAmount ? 'Tip $' + dollars.toFixed( 2 ) + ' now' : 'Tip now';
		if ( els.oneTapBtn ) {
			var last4 = ( window.FLHub && window.FLHub.chat && window.FLHub.chat.cardLast4() ) || '····';
			els.oneTapBtn.textContent =
				'⚡ Tip ' + ( hasAmount ? '$' + dollars.toFixed( 2 ) + ' ' : '' ) + 'now — card ending in ' + last4;
		}
	}

	function openPanel( amount ) {
		els.panel.hidden = false;
		setStatus( '' );

		// Both are Task F additions — an anonymous visitor sees neither row.
		var session = window.FLHub && window.FLHub.identity && window.FLHub.identity.getSession();
		var hasSavedCard = !! ( session && window.FLHub.chat && window.FLHub.chat.hasSavedCard() );
		els.saveCardRow.hidden = ! session;
		els.oneTapRow.hidden = ! hasSavedCard;
		if ( ! session ) {
			els.saveCardCheckbox.checked = false;
		}

		if ( amount === 'custom' ) {
			els.customRow.hidden = false;
			els.customInput.value = '';
			els.customInput.focus();
			setAmount( 0 );
		} else {
			els.customRow.hidden = true;
			setAmount( amount );
		}

		if ( ! els.nameInput.value ) {
			var chatName = window.FLHub && window.FLHub.chat && window.FLHub.chat.getDisplayName();
			if ( chatName ) {
				els.nameInput.value = chatName;
			}
		}

		ensureCard().catch( function () {
			setStatus( 'Tipping’s temporarily unavailable — try again in a bit.', true );
		} );
	}

	function closePanel() {
		els.panel.hidden = true;
		setStatus( '' );
	}

	function submitTip() {
		if ( submitting || ! card ) {
			return;
		}

		var dollars = currentAmountDollars;
		if ( ! isFinite( dollars ) || dollars < MIN_DOLLARS || dollars > MAX_DOLLARS ) {
			setStatus( 'Enter an amount between $' + MIN_DOLLARS + ' and $' + MAX_DOLLARS + '.', true );
			return;
		}

		submitting = true;
		els.submitBtn.disabled = true;
		setStatus( 'Processing…' );

		var session = window.FLHub && window.FLHub.identity && window.FLHub.identity.getSession();

		card
			.tokenize()
			.then( function ( result ) {
				if ( result.status !== 'OK' ) {
					throw new Error( 'tokenize_failed' );
				}
				var payload = {
					sourceId: result.token,
					amountCents: Math.round( dollars * 100 ),
					message: els.messageInput.value,
					displayName: els.nameInput.value,
					// Fresh per submission — a new tokenize() call always
					// produces a new one-time nonce, so this is genuinely a
					// new payment attempt, never a replay of a prior one.
					idempotencyKey: crypto.randomUUID(),
				};
				// Only meaningful when logged in — tip-create.mts ignores
				// saveCard entirely without a valid sessionToken alongside it.
				if ( session && els.saveCardCheckbox.checked ) {
					payload.sessionToken = session.token;
					payload.saveCard = true;
				}
				return fetch( TIP_ENDPOINT, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify( payload ),
				} );
			} )
			.then( function ( res ) {
				return res.json().then( function ( data ) {
					return { ok: res.ok, data: data };
				} );
			} )
			.then( function ( result ) {
				submitting = false;
				els.submitBtn.disabled = false;
				if ( ! result.ok || ! result.data.success ) {
					setStatus( 'That didn’t go through — check your card details and try again.', true );
					return;
				}
				setStatus( '🎉 Thank you for the tip!' );
				els.messageInput.value = '';
				setTimeout( closePanel, 2500 );
			} )
			.catch( function () {
				submitting = false;
				els.submitBtn.disabled = false;
				setStatus( 'That didn’t go through — check your card details and try again.', true );
			} );
	}

	/**
	 * The one-tap path (Task F): charges the saved card via tip-repeat.mts —
	 * no card field, no Square SDK involvement at all, since there's no new
	 * card to tokenize.
	 */
	function submitOneTapTip() {
		if ( submitting ) {
			return;
		}
		var session = window.FLHub && window.FLHub.identity && window.FLHub.identity.getSession();
		if ( ! session ) {
			return;
		}

		var dollars = currentAmountDollars;
		if ( ! isFinite( dollars ) || dollars < MIN_DOLLARS || dollars > MAX_DOLLARS ) {
			setStatus( 'Enter an amount between $' + MIN_DOLLARS + ' and $' + MAX_DOLLARS + '.', true );
			return;
		}

		submitting = true;
		els.oneTapBtn.disabled = true;
		setStatus( 'Processing…' );

		fetch( TIP_REPEAT_ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify( {
				sessionToken: session.token,
				amountCents: Math.round( dollars * 100 ),
				message: els.messageInput.value,
				idempotencyKey: crypto.randomUUID(),
			} ),
		} )
			.then( function ( res ) {
				return res.json().then( function ( data ) {
					return { ok: res.ok, data: data };
				} );
			} )
			.then( function ( result ) {
				submitting = false;
				els.oneTapBtn.disabled = false;
				if ( ! result.ok || ! result.data.success ) {
					setStatus( 'That didn’t go through — try the card field below instead.', true );
					return;
				}
				setStatus( '🎉 Thank you for the tip!' );
				els.messageInput.value = '';
				setTimeout( closePanel, 2500 );
			} )
			.catch( function () {
				submitting = false;
				els.oneTapBtn.disabled = false;
				setStatus( 'That didn’t go through — try the card field below instead.', true );
			} );
	}

	function buildPanel() {
		var panel = document.createElement( 'div' );
		panel.className = 'fl-tip-panel';
		panel.setAttribute( 'data-fl', 'tip-panel' );
		panel.hidden = true;

		var amountLabel = document.createElement( 'div' );
		amountLabel.className = 'fl-tip-panel__amount';

		// Only shown when logged in with a saved card (Task F) — a fast path
		// that skips the card field/Square SDK entirely, hitting
		// tip-repeat.mts instead of tip-create.mts.
		var oneTapRow = document.createElement( 'div' );
		oneTapRow.className = 'fl-tip-panel__onetap';
		oneTapRow.hidden = true;
		var oneTapBtn = document.createElement( 'button' );
		oneTapBtn.type = 'button';
		oneTapBtn.className = 'fl-tip-panel__onetap-btn';
		var oneTapOr = document.createElement( 'div' );
		oneTapOr.className = 'fl-tip-panel__onetap-or';
		oneTapOr.textContent = 'or use a different card below';
		oneTapRow.appendChild( oneTapBtn );
		oneTapRow.appendChild( oneTapOr );

		var customRow = document.createElement( 'div' );
		customRow.className = 'fl-tip-panel__custom';
		customRow.hidden = true;
		var customPrefix = document.createElement( 'span' );
		customPrefix.textContent = '$';
		var customInput = document.createElement( 'input' );
		customInput.type = 'number';
		customInput.min = String( MIN_DOLLARS );
		customInput.max = String( MAX_DOLLARS );
		customInput.step = '0.01';
		customInput.placeholder = 'Amount';
		customRow.appendChild( customPrefix );
		customRow.appendChild( customInput );

		var cardContainer = document.createElement( 'div' );
		cardContainer.className = 'fl-tip-panel__card';

		var messageInput = document.createElement( 'input' );
		messageInput.type = 'text';
		messageInput.maxLength = 200;
		messageInput.placeholder = 'Add a message (optional)';
		messageInput.autocomplete = 'off';

		var nameInput = document.createElement( 'input' );
		nameInput.type = 'text';
		nameInput.maxLength = 30;
		nameInput.placeholder = 'Your name (optional)';
		nameInput.autocomplete = 'off';

		// Only shown when logged in (Task F) — anonymous tips have no
		// account to attach a saved card to. Square's own required
		// authorization language for storing a card on file.
		var saveCardRow = document.createElement( 'label' );
		saveCardRow.className = 'fl-tip-panel__save-card';
		saveCardRow.hidden = true;
		var saveCardCheckbox = document.createElement( 'input' );
		saveCardCheckbox.type = 'checkbox';
		var saveCardText = document.createElement( 'span' );
		saveCardText.textContent =
			'Save this card for one-tap tips next time. I authorize 4Liberty Network to keep my payment ' +
			'information on file and charge it for future tips I initiate.';
		saveCardRow.appendChild( saveCardCheckbox );
		saveCardRow.appendChild( saveCardText );

		var actions = document.createElement( 'div' );
		actions.className = 'fl-tip-panel__actions';
		var submitBtn = document.createElement( 'button' );
		submitBtn.type = 'button';
		submitBtn.className = 'fl-tip-panel__submit';
		var cancelBtn = document.createElement( 'button' );
		cancelBtn.type = 'button';
		cancelBtn.className = 'fl-tip-panel__cancel';
		cancelBtn.textContent = 'Cancel';
		actions.appendChild( submitBtn );
		actions.appendChild( cancelBtn );

		var status = document.createElement( 'div' );
		status.className = 'fl-tip-panel__status';

		var disclaimer = document.createElement( 'div' );
		disclaimer.className = 'fl-tip-panel__disclaimer';
		disclaimer.textContent = 'Tips support the show directly and are not tax-deductible.';

		panel.appendChild( amountLabel );
		panel.appendChild( oneTapRow );
		panel.appendChild( customRow );
		panel.appendChild( cardContainer );
		panel.appendChild( messageInput );
		panel.appendChild( nameInput );
		panel.appendChild( saveCardRow );
		panel.appendChild( actions );
		panel.appendChild( status );
		panel.appendChild( disclaimer );

		customInput.addEventListener( 'input', function () {
			var typed = parseFloat( customInput.value );
			setAmount( isFinite( typed ) ? typed : 0 );
		} );
		submitBtn.addEventListener( 'click', submitTip );
		cancelBtn.addEventListener( 'click', closePanel );
		oneTapBtn.addEventListener( 'click', submitOneTapTip );

		els.tipBar.appendChild( panel );

		els.panel = panel;
		els.oneTapRow = oneTapRow;
		els.oneTapBtn = oneTapBtn;
		els.saveCardRow = saveCardRow;
		els.saveCardCheckbox = saveCardCheckbox;
		els.amountLabel = amountLabel;
		els.customRow = customRow;
		els.customInput = customInput;
		els.cardContainer = cardContainer;
		els.messageInput = messageInput;
		els.nameInput = nameInput;
		els.submitBtn = submitBtn;
		els.status = status;
	}

	function formatDollars( amount ) {
		return amount % 1 === 0 ? '$' + amount : '$' + amount.toFixed( 2 );
	}

	/**
	 * hero-live.php ships 3 hardcoded chip buttons as an honest static stub
	 * (same Phase 1 pattern as the rest of that file — shape the markup,
	 * later phases swap data not structure). Rebuilding them from
	 * CONFIG.tipPresets here is what actually makes Task G's admin-editable
	 * presets take effect — without this, editing the admin field would
	 * change nothing a visitor ever sees.
	 */
	function rebuildChips() {
		var container = els.tipBar.querySelector( '.fl-tipchips' );
		if ( ! container ) {
			return;
		}
		container.innerHTML = '';

		var presets = CONFIG.tipPresets || [];
		var hotIndex = Math.floor( presets.length / 2 );

		presets.forEach( function ( amount, index ) {
			var btn = document.createElement( 'button' );
			btn.type = 'button';
			btn.setAttribute( 'data-amount', String( amount ) );
			if ( index === hotIndex ) {
				btn.className = 'fl-tipchips__hot';
			}
			btn.textContent = formatDollars( amount );
			container.appendChild( btn );
		} );

		var customBtn = document.createElement( 'button' );
		customBtn.type = 'button';
		customBtn.setAttribute( 'data-amount', 'custom' );
		customBtn.textContent = 'Custom';
		container.appendChild( customBtn );
	}

	function wireChips() {
		var chips = els.tipBar.querySelectorAll( '.fl-tipchips button[data-amount]' );
		chips.forEach( function ( chip ) {
			chip.addEventListener( 'click', function () {
				var raw = chip.getAttribute( 'data-amount' );
				openPanel( raw === 'custom' ? 'custom' : parseFloat( raw ) );
			} );
		} );
	}

	function init() {
		var tipBar = document.querySelector( '[data-fl="tip-bar"]' );
		if ( ! tipBar || ! CONFIG.squareApplicationId || ! CONFIG.squareLocationId ) {
			return;
		}

		els = { tipBar: tipBar };
		rebuildChips();
		buildPanel();
		wireChips();
	}

	document.addEventListener( 'DOMContentLoaded', init );
} )();
