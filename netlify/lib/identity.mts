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

import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';

const USERS_STORE = 'identity-users';
const NONCE_STORE = 'identity-nonces';
const LOGIN_CODE_STORE = 'identity-login-codes';

const MAGIC_LINK_TTL_SECONDS = 15 * 60; // 15 minutes
// Refreshed on every verified use (Decision 11b, PHASE-8-BUILD-PLAN.md) — an
// active member never hits this ceiling in practice. SESSION_MAX_LIFETIME_
// SECONDS below is the hard stop that matters.
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
// Absolute cap from the ORIGINAL login, even for a visitor who never stops
// using the site — a session should still eventually require a fresh login.
const SESSION_MAX_LIFETIME_SECONDS = 180 * 24 * 60 * 60; // 180 days

const MAX_EMAIL_LENGTH = 254; // RFC 5321's practical limit
// Deliberately loose — real validation is "did the email actually receive
// the link," which no regex can substitute for.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The exact set of pages that ever need a visitor returned to them after
// login — an ALLOWLIST, not a generic "starts with /" check
// (PHASE-8-BUILD-PLAN.md Decision 9). A generic check is exactly the kind of
// thing that has subtle bypasses (protocol-relative //evil.com, backslash
// tricks some browsers normalize to a forward slash, encoded variants), and
// an open redirect on a LOGIN flow is a real phishing tool, not a nuisance
// bug. Add a path here only when a real page needs someone returned to it.
const ALLOWED_RETURN_PATHS = [ '/', '/community/' ];

const LOGIN_CODE_LENGTH = 6;
// Rides the same window as the magic link it's paired with — nothing to
// track separately, it just shouldn't outlive the token it points to.
const LOGIN_CODE_TTL_SECONDS = MAGIC_LINK_TTL_SECONDS;

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
 * Validates a post-login return path by EXACT match against
 * ALLOWED_RETURN_PATHS only — no prefix matching, no trailing-slash
 * normalization, nothing clever that could hide a bypass. Never throws; a
 * missing or invalid path just means the caller falls back to its own
 * default.
 */
export function sanitizeReturnPath( raw: unknown ): string | null {
	if ( typeof raw !== 'string' ) {
		return null;
	}
	return ALLOWED_RETURN_PATHS.includes( raw ) ? raw : null;
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
	// When this session's identity was FIRST established — carried forward
	// unchanged across every slide (Decision 11b) so SESSION_MAX_LIFETIME_
	// SECONDS below is measured from the original login, not the last visit.
	iat: number;
	exp: number;
}

/**
 * `iat` is supplied by the caller rather than always "now" — a brand-new
 * session passes the current time; verifySession()'s slide passes the
 * ORIGINAL iat through unchanged, which is what keeps the 180-day cap
 * anchored to first login instead of resetting on every visit.
 */
function signSessionToken( userId: string, email: string, iat: number ): string {
	const now = Math.floor( Date.now() / 1000 );
	return sign( {
		purpose: 'session',
		userId,
		email,
		iat,
		exp: Math.min( now + SESSION_TTL_SECONDS, iat + SESSION_MAX_LIFETIME_SECONDS ),
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
	// Added Phase 8 (Task A) — defaulted for pre-existing records by
	// normalizeUser() below, never assumed present on a raw read.
	role: 'member' | 'moderator' | 'admin';
	banned: boolean;
	// null = permanent (once banned, checked by isBanned() below). Only
	// meaningful when banned is true.
	bannedUntil: string | null;
	postCount: number;
	createdAt: string;
}

/**
 * A permanent ban has `bannedUntil: null`; a timed one expires on its own —
 * checked here so every caller doesn't need to remember the null-means-
 * forever convention. Used by chat-token.mts (Task A); Task C's community
 * write endpoints will call this too (PHASE-8-BUILD-PLAN.md Decision 7).
 */
export function isBanned( user: UserRecord ): boolean {
	if ( ! user.banned ) {
		return false;
	}
	return ! user.bannedUntil || new Date( user.bannedUntil ).getTime() > Date.now();
}

/**
 * Defaults the fields added after some records already existed
 * (role/banned/bannedUntil/postCount, PHASE-8-BUILD-PLAN.md Task A) — every
 * read goes through getUser() below, so an old record is defaulted on load
 * instead of needing a one-time migration. Every OTHER field has been part
 * of the schema since Phase 3 and every write path has always set it.
 */
function normalizeUser( user: UserRecord ): UserRecord {
	return {
		...user,
		role: user.role ?? 'member',
		banned: user.banned ?? false,
		bannedUntil: user.bannedUntil ?? null,
		postCount: user.postCount ?? 0,
	};
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
		const raw = ( ( await store.get( email, { type: 'json' } ) ) as UserRecord | null ) ?? null;
		return raw ? normalizeUser( raw ) : null;
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
		role: 'member',
		banned: false,
		bannedUntil: null,
		postCount: 0,
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
		sessionToken: signSessionToken( user.userId, user.email, Math.floor( Date.now() / 1000 ) ),
	};
}

const loginCodeKey = ( email: string, code: string ): string => `${ email }:${ code }`;

/** Cryptographically random, zero-padded to LOGIN_CODE_LENGTH digits. */
function randomLoginCode(): string {
	return String( randomInt( 0, 10 ** LOGIN_CODE_LENGTH ) ).padStart( LOGIN_CODE_LENGTH, '0' );
}

/**
 * Pairs a 6-digit code with an already-minted magic-link token, so a
 * visitor can complete login by typing the code instead of clicking the
 * link — the fix for the #1 real-world magic-link failure mode: tapping the
 * link inside an email app's OWN in-app browser (Gmail's, etc.) completes
 * the login in THAT browser's localStorage, not the one the visitor typed
 * their email into, so they land back on the site still logged out. A typed
 * code never leaves the page (PHASE-8-BUILD-PLAN.md Decision 11a).
 *
 * The code is just an alternate lookup key for the SAME token — not a
 * separate secret with its own trust path — so verifyLoginCode() below can
 * hand off to the exact same verifyMagicLinkAndCreateSession() the link
 * itself uses. One verification path, two ways to reach it.
 */
export async function createLoginCode( email: string, magicLinkToken: string ): Promise< string > {
	const code = randomLoginCode();
	const store = getStore( { name: LOGIN_CODE_STORE, consistency: 'strong' } );
	await store.setJSON( loginCodeKey( email, code ), {
		token: magicLinkToken,
		exp: Math.floor( Date.now() / 1000 ) + LOGIN_CODE_TTL_SECONDS,
	} );
	return code;
}

/**
 * Resolves a typed 6-digit code back to its magic-link token and completes
 * login exactly as verifyMagicLinkAndCreateSession() would from the link
 * itself. `null` on any failure (unknown/expired code, malformed input, or
 * a since-invalid underlying token) — the CALLER (auth-code.mts) is
 * responsible for rate-limiting attempts; this function only resolves one
 * lookup and never throws.
 *
 * Six digits is a million guesses — brute-forceable in a way a signed token
 * is not — which is why this is rate-limited at the endpoint layer far
 * tighter than the link path.
 *
 * Burns the code on the FIRST lookup that finds it, valid or not — BEST-
 * EFFORT get-then-delete, same caveat as this file's nonce store (see the
 * header): only genuine simultaneity slips through, not "guessed some time
 * later."
 */
export async function verifyLoginCode(
	rawEmail: unknown,
	rawCode: unknown
): Promise< { userId: string; email: string; displayName: string; sessionToken: string } | null > {
	const email = sanitizeEmail( rawEmail );
	const code = typeof rawCode === 'string' ? rawCode.trim() : '';
	if ( ! email || ! /^\d{6}$/.test( code ) ) {
		return null;
	}

	const store = getStore( { name: LOGIN_CODE_STORE, consistency: 'strong' } );
	const key = loginCodeKey( email, code );

	let entry: { token: string; exp: number } | null = null;
	try {
		entry = ( ( await store.get( key, { type: 'json' } ) ) as { token: string; exp: number } | null ) ?? null;
	} catch {
		return null;
	}
	if ( entry ) {
		try {
			await store.delete( key );
		} catch {
			// Worst case a second guess within the same instant also succeeds
			// — see this function's header on Blobs' lack of an atomic primitive.
		}
	}
	if ( ! entry || entry.exp < Math.floor( Date.now() / 1000 ) ) {
		return null;
	}

	return verifyMagicLinkAndCreateSession( entry.token );
}

export interface VerifiedSession {
	user: UserRecord;
	/**
	 * A reissued token with a slid expiry (Decision 11b, PHASE-8-BUILD-
	 * PLAN.md) — callers should send this back to the client to replace its
	 * stored copy. The OLD token the client presented keeps working until
	 * its own (now-stale) exp either way, so a caller that forgets this
	 * doesn't break anything, it just doesn't slide.
	 */
	sessionToken: string;
}

/**
 * Verifies a session token, looks up the current user record, and slides
 * the session's expiry. Used by chat-token.mts and the tip endpoints. `null`
 * on any failure (bad/expired token, or the user record has since vanished).
 */
export async function verifySession( token: unknown ): Promise< VerifiedSession | null > {
	const payload = verify< SessionPayload >( token, 'session' );
	if ( ! payload ) {
		return null;
	}
	const user = await getUser( payload.email );
	if ( ! user ) {
		return null;
	}
	const iat = typeof payload.iat === 'number' ? payload.iat : Math.floor( Date.now() / 1000 );
	return { user, sessionToken: signSessionToken( payload.userId, payload.email, iat ) };
}

/**
 * Syncs an already-loaded identity record's role to match the WordPress-
 * configured moderator list (PHASE-8-BUILD-PLAN.md Task C) — mutates
 * `user.role` in place and persists it ONLY if it changed, self-healing on
 * every call rather than needing a one-time migration: if Austin adds or
 * removes someone from the moderator list, the change takes effect the
 * next time that person's session is verified, on the same ~1-minute
 * cadence as every other WordPress-sourced setting. Takes the caller's
 * already-fetched UserRecord rather than an email, to avoid a redundant
 * Blobs read right after verifySession() already loaded it. Never demotes
 * a stored 'admin' role (unused today, but reserved) — only toggles
 * between 'member' and 'moderator'.
 */
export async function syncModeratorRole( user: UserRecord, isModerator: boolean ): Promise< UserRecord > {
	if ( 'admin' === user.role ) {
		return user;
	}
	const desiredRole = isModerator ? 'moderator' : 'member';
	if ( user.role !== desiredRole ) {
		user.role = desiredRole;
		await saveUser( user );
	}
	return user;
}

/**
 * Best-effort counter of top-level community posts (not replies — this is
 * `postCount`, replies get their own field if that's ever needed). Called
 * by community-post.mts right after WordPress confirms a post was created.
 * Silently does nothing if the user has since vanished — the caller only
 * reaches this after verifySession() already found them, so this
 * shouldn't happen in practice.
 */
export async function incrementPostCount( email: string ): Promise< void > {
	const user = await getUser( email );
	if ( ! user ) {
		return;
	}
	user.postCount += 1;
	await saveUser( user );
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
