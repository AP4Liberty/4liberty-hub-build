/**
 * Identity spine — Netlify Blobs, not WordPress users (PHASE-3-BUILD-PLAN.md
 * Decision 2). Hand-rolled signed tokens (HMAC-SHA256 over a JSON payload),
 * not a JWT library: we control both signer and verifier, so there's no
 * need for JWT's algorithm negotiation — the exact surface responsible for
 * most real-world JWT vulnerabilities (alg:none, algorithm confusion). Every
 * payload carries a `purpose` field so a magic-link token can never be
 * replayed as a session token or vice versa.
 *
 * Sessions live in localStorage on the browser side (not a cookie —
 * sidesteps third-party-cookie limits between the GoDaddy-hosted site and
 * the netlify.app backend), sent back as a bearer token. A stolen session
 * token can read/post chat as that person but cannot charge their saved
 * card on its own (Task F's tip-repeat still needs the Square customer
 * lookup on top) — an acceptable risk for a community chat identity.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';

const USERS_STORE = 'identity-users';
const NONCE_STORE = 'identity-nonces';

const MAGIC_LINK_TTL_SECONDS = 15 * 60; // 15 minutes
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

const MAX_EMAIL_LENGTH = 254; // RFC 5321's practical limit
// Deliberately loose — real validation is "did the email actually receive
// the link," which no regex can substitute for.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getSecret(): string {
	const secret = Netlify.env.get( 'IDENTITY_JWT_SECRET' );
	if ( ! secret ) {
		throw new Error( 'Identity is not configured (missing IDENTITY_JWT_SECRET).' );
	}
	return secret;
}

/** Trims, lowercases, and loosely validates. Never throws on bad input. */
export function sanitizeEmail( raw: unknown ): string | null {
	if ( typeof raw !== 'string' ) {
		return null;
	}
	const trimmed = raw.trim().toLowerCase();
	if ( trimmed.length === 0 || trimmed.length > MAX_EMAIL_LENGTH || ! EMAIL_RE.test( trimmed ) ) {
		return null;
	}
	return trimmed;
}

/**
 * A stable, non-reversible id derived from the email — safe to expose as a
 * Stream user id (visible to other chat participants via message.user.id)
 * without leaking the actual address. Deterministic, so repeat logins from
 * the same email always resolve to the same identity.
 */
export function deriveUserId( email: string ): string {
	return 'user-' + createHmac( 'sha256', getSecret() ).update( email ).digest( 'base64url' ).slice( 0, 20 );
}

function sign( payload: Record< string, unknown > ): string {
	const body = Buffer.from( JSON.stringify( payload ), 'utf8' ).toString( 'base64url' );
	const sig = createHmac( 'sha256', getSecret() ).update( body ).digest( 'base64url' );
	return `${ body }.${ sig }`;
}

/** Verifies signature, expiry, and purpose. Returns null on any failure — never throws. */
function verify< T extends { exp: number; purpose: string } >( token: unknown, expectedPurpose: string ): T | null {
	if ( typeof token !== 'string' ) {
		return null;
	}
	const parts = token.split( '.' );
	if ( parts.length !== 2 ) {
		return null;
	}
	const [ body, sig ] = parts;

	let expectedSig: string;
	try {
		expectedSig = createHmac( 'sha256', getSecret() ).update( body ).digest( 'base64url' );
	} catch {
		return null;
	}

	const sigBuf = Buffer.from( sig );
	const expectedBuf = Buffer.from( expectedSig );
	// timingSafeEqual throws on mismatched lengths, not just "returns false" —
	// the length check guards that, and is not itself a timing leak (token
	// length isn't a secret the way the signature bytes are).
	if ( sigBuf.length !== expectedBuf.length || ! timingSafeEqual( sigBuf, expectedBuf ) ) {
		return null;
	}

	let payload: unknown;
	try {
		payload = JSON.parse( Buffer.from( body, 'base64url' ).toString( 'utf8' ) );
	} catch {
		return null;
	}

	if ( ! payload || typeof payload !== 'object' ) {
		return null;
	}
	const p = payload as Record< string, unknown >;
	if ( p.purpose !== expectedPurpose ) {
		return null;
	}
	if ( typeof p.exp !== 'number' || p.exp < Date.now() / 1000 ) {
		return null;
	}

	return payload as T;
}

export interface MagicLinkPayload {
	purpose: 'magic-link';
	email: string;
	displayName: string;
	jti: string;
	exp: number;
}

export function signMagicLinkToken( email: string, displayName: string ): string {
	return sign( {
		purpose: 'magic-link',
		email,
		displayName,
		jti: randomUUID(),
		exp: Math.floor( Date.now() / 1000 ) + MAGIC_LINK_TTL_SECONDS,
	} );
}

interface SessionPayload {
	purpose: 'session';
	userId: string;
	email: string;
	exp: number;
}

function signSessionToken( userId: string, email: string ): string {
	return sign( {
		purpose: 'session',
		userId,
		email,
		exp: Math.floor( Date.now() / 1000 ) + SESSION_TTL_SECONDS,
	} );
}

export interface UserRecord {
	userId: string;
	email: string;
	displayName: string;
	streamUserId: string;
	squareCustomerId: string | null;
	// The ACTUAL chargeable token for a one-tap repeat tip — cardLast4 is
	// display-only. Both are set together by linkSquareCard() below.
	squareCardId: string | null;
	cardLast4: string | null;
	supporter: boolean;
	createdAt: string;
}

// consistency: 'strong' throughout this file — confirmed by direct testing
// that Netlify Blobs' default ('eventual') read can lag up to 60 seconds
// behind a write, even within the same invocation. For the one-time-use
// nonce check specifically, eventual consistency wouldn't just be a narrow
// race — it would leave a used magic link genuinely REPLAYABLE for up to a
// full minute, defeating the entire point of the check.

async function getUser( email: string ): Promise< UserRecord | null > {
	try {
		const store = getStore( { name: USERS_STORE, consistency: 'strong' } );
		return ( ( await store.get( email, { type: 'json' } ) ) as UserRecord | null ) ?? null;
	} catch {
		return null;
	}
}

async function saveUser( user: UserRecord ): Promise< void > {
	const store = getStore( { name: USERS_STORE, consistency: 'strong' } );
	await store.setJSON( user.email, user );
}

/**
 * The cryptographic half of magic-link verification — signature, expiry,
 * and purpose, with NO Blobs access. Split out from
 * verifyMagicLinkAndCreateSession() specifically so this security-critical
 * logic can be unit-tested directly (see test/identity.test.mts), matching
 * this repo's established split: pure logic gets unit tests, Blobs/network-
 * touching code gets deployed-and-curl-tested instead.
 */
export function verifyMagicLinkTokenSignature( token: unknown ): MagicLinkPayload | null {
	return verify< MagicLinkPayload >( token, 'magic-link' );
}

/**
 * Verifies a magic-link token is genuine, unexpired, and unused, then
 * upserts the user record and mints a session token. `null` on any failure
 * (bad signature, expired, wrong purpose, or already-used).
 *
 * The one-time-use check is BEST-EFFORT even with strong consistency (see
 * this file's header) — get-then-set has no atomic "only if absent"
 * primitive in this Blobs SDK, so two verify calls landing at the EXACT
 * same instant could still both read "not yet used" before either write
 * completes. The realistic attack (an intercepted link reused some time
 * later) is fully covered; only genuine simultaneity is not — and even
 * then, both uses are for the legitimate account, not a different one.
 */
export async function verifyMagicLinkAndCreateSession(
	token: unknown
): Promise< { userId: string; email: string; displayName: string; sessionToken: string } | null > {
	const payload = verifyMagicLinkTokenSignature( token );
	if ( ! payload ) {
		return null;
	}

	const nonceStore = getStore( { name: NONCE_STORE, consistency: 'strong' } );
	const nonceKey = `ml:${ payload.jti }`;
	try {
		const used = await nonceStore.get( nonceKey );
		if ( used ) {
			return null;
		}
	} catch {
		// Fail open on a read hiccup — see the caveat above.
	}
	try {
		await nonceStore.set( nonceKey, '1' );
	} catch {
		// If the write fails, the link remains usable again — acceptable,
		// see the caveat above.
	}

	const userId = deriveUserId( payload.email );
	const existing = await getUser( payload.email );
	const user: UserRecord = existing ?? {
		userId,
		email: payload.email,
		displayName: payload.displayName || payload.email.split( '@' )[ 0 ],
		streamUserId: userId,
		squareCustomerId: null,
		squareCardId: null,
		cardLast4: null,
		supporter: false,
		createdAt: new Date().toISOString(),
	};
	// A returning visitor's freshly-typed display name updates the record —
	// the account should reflect what they're calling themselves NOW, not
	// whatever they typed the first time they signed up.
	if ( payload.displayName ) {
		user.displayName = payload.displayName;
	}
	await saveUser( user );

	return {
		userId: user.userId,
		email: user.email,
		displayName: user.displayName,
		sessionToken: signSessionToken( user.userId, user.email ),
	};
}

/**
 * Verifies a session token and looks up the current user record. Used by
 * Task F to back the authenticated chat-token and tip-repeat paths. `null`
 * on any failure (bad/expired token, or the user record has since vanished).
 */
export async function verifySession( token: unknown ): Promise< UserRecord | null > {
	const payload = verify< SessionPayload >( token, 'session' );
	if ( ! payload ) {
		return null;
	}
	return getUser( payload.email );
}

/**
 * Records a successfully-saved Square card on the identity spine, called
 * once by tip-create.mts right after Square confirms the card was saved.
 * Marks the user a `supporter` — saving a card only happens after a real
 * completed tip (see tip-create.mts), so this is never set on its own.
 * Silently does nothing if the user has since vanished (shouldn't happen —
 * the caller only reaches this after verifySession() already found them).
 */
export async function linkSquareCard(
	email: string,
	squareCustomerId: string,
	squareCardId: string,
	cardLast4: string
): Promise< void > {
	const user = await getUser( email );
	if ( ! user ) {
		return;
	}
	user.squareCustomerId = squareCustomerId;
	user.squareCardId = squareCardId;
	user.cardLast4 = cardLast4;
	user.supporter = true;
	await saveUser( user );
}
