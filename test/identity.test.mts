/**
 * Unit tests for the pure-logic pieces of netlify/lib/identity.mts — the
 * most security-critical file in Phase 3 (it mints the tokens everything
 * else trusts).
 *
 * verifyMagicLinkAndCreateSession() / verifySession() touch Netlify Blobs
 * and are deliberately NOT unit-tested here — same split as the rest of
 * this repo (see test/stream.test.mts's header). Verified by deploying and
 * exercising the real auth-request -> email -> auth-verify round trip.
 *
 * A fake `Netlify` global is provided below, BEFORE any test invokes a
 * function that reads it — safe because identity.mts only reads
 * Netlify.env lazily, inside function bodies, never at module load time.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import {
	deriveUserId,
	sanitizeEmail,
	sanitizeReturnPath,
	signMagicLinkToken,
	verifyLoginCode,
	verifyMagicLinkTokenSignature,
} from '../netlify/lib/identity.mts';

const TEST_SECRET = 'test-secret-do-not-use-in-prod';

/** Hand-builds a token the same way identity.mts's private sign() does, so
 * tests can construct payloads sign() itself would never produce (wrong
 * purpose, expired, non-object). */
function buildToken( payload: unknown, secret: string = TEST_SECRET ): string {
	const body = Buffer.from( JSON.stringify( payload ), 'utf8' ).toString( 'base64url' );
	const sig = createHmac( 'sha256', secret ).update( body ).digest( 'base64url' );
	return `${ body }.${ sig }`;
}

( globalThis as any ).Netlify = {
	env: {
		get: ( key: string ) => ( key === 'IDENTITY_JWT_SECRET' ? 'test-secret-do-not-use-in-prod' : undefined ),
	},
};

describe( 'sanitizeEmail', () => {
	it( 'accepts a normal address and lowercases it', () => {
		assert.equal( sanitizeEmail( 'Someone@Example.COM' ), 'someone@example.com' );
	} );

	it( 'trims whitespace', () => {
		assert.equal( sanitizeEmail( '  someone@example.com  ' ), 'someone@example.com' );
	} );

	it( 'rejects non-string input without throwing', () => {
		for ( const input of [ null, undefined, 42, {}, [], true ] ) {
			assert.equal( sanitizeEmail( input ), null );
		}
	} );

	it( 'rejects strings with no @ or no domain dot', () => {
		for ( const bad of [ '', 'notanemail', 'missing-at.com', 'a@b', '@example.com', 'a@.com' ] ) {
			assert.equal( sanitizeEmail( bad ), null );
		}
	} );

	it( 'rejects an absurdly long address', () => {
		const long = 'a'.repeat( 250 ) + '@example.com';
		assert.equal( sanitizeEmail( long ), null );
	} );
} );

describe( 'deriveUserId', () => {
	it( 'is deterministic — the same email always derives the same id', () => {
		const a = deriveUserId( 'someone@example.com' );
		const b = deriveUserId( 'someone@example.com' );
		assert.equal( a, b );
	} );

	it( 'differs for different emails', () => {
		assert.notEqual( deriveUserId( 'alice@example.com' ), deriveUserId( 'bob@example.com' ) );
	} );

	it( 'never contains the email itself (non-reversible id)', () => {
		const id = deriveUserId( 'someone@example.com' );
		assert.ok( ! id.includes( 'someone' ) );
		assert.ok( ! id.includes( 'example' ) );
	} );

	it( 'is safe to use as a Stream user id (prefixed, url-safe characters only)', () => {
		const id = deriveUserId( 'someone@example.com' );
		assert.match( id, /^user-[A-Za-z0-9_-]+$/ );
	} );
} );

describe( 'sanitizeReturnPath', () => {
	it( 'accepts the exact allowlisted paths', () => {
		assert.equal( sanitizeReturnPath( '/' ), '/' );
		assert.equal( sanitizeReturnPath( '/community/' ), '/community/' );
	} );

	it( 'rejects non-string input without throwing', () => {
		for ( const input of [ null, undefined, 42, {}, [], true ] ) {
			assert.equal( sanitizeReturnPath( input ), null );
		}
	} );

	it( 'rejects a path not on the allowlist, even a plausible-looking one', () => {
		for ( const bad of [ '/blog/', '/support', '/community', '//community/' ] ) {
			assert.equal( sanitizeReturnPath( bad ), null );
		}
	} );

	// The whole point of an EXACT-match allowlist (Decision 9) is that none
	// of these need their own special-case rejection logic — they just fail
	// to equal any allowlisted string, the same as any other bad input.
	it( 'rejects open-redirect probes', () => {
		for ( const bad of [
			'//evil.com',
			'///evil.com',
			'https://evil.com',
			'http://evil.com/',
			'/\\evil.com',
			'/\\/evil.com',
			'/%2f%2fevil.com',
			'/%5cevil.com',
			'/community/../../evil.com',
			'/community/%2e%2e/evil.com',
			' /',
			'/ ',
			'/community/ ',
		] ) {
			assert.equal( sanitizeReturnPath( bad ), null );
		}
	} );
} );

describe( 'signMagicLinkToken / verifyMagicLinkTokenSignature — round trip', () => {
	it( 'a freshly signed token verifies successfully', () => {
		const token = signMagicLinkToken( 'someone@example.com', 'Curious Voter' );
		const payload = verifyMagicLinkTokenSignature( token );
		assert.ok( payload );
		assert.equal( payload.email, 'someone@example.com' );
		assert.equal( payload.displayName, 'Curious Voter' );
		assert.equal( payload.purpose, 'magic-link' );
	} );

	it( 'two tokens for the same email get different jti (nonce) values', () => {
		const a = verifyMagicLinkTokenSignature( signMagicLinkToken( 'someone@example.com', 'Name' ) );
		const b = verifyMagicLinkTokenSignature( signMagicLinkToken( 'someone@example.com', 'Name' ) );
		assert.ok( a && b );
		assert.notEqual( a.jti, b.jti );
	} );
} );

describe( 'verifyMagicLinkTokenSignature — tampering and malformed input', () => {
	it( 'rejects a token with a flipped payload character (breaks the signature)', () => {
		const token = signMagicLinkToken( 'someone@example.com', 'Name' );
		const [ body, sig ] = token.split( '.' );
		const tamperedBody = body.slice( 0, -1 ) + ( body.slice( -1 ) === 'A' ? 'B' : 'A' );
		assert.equal( verifyMagicLinkTokenSignature( `${ tamperedBody }.${ sig }` ), null );
	} );

	it( 'rejects a token with a tampered signature', () => {
		const token = signMagicLinkToken( 'someone@example.com', 'Name' );
		const [ body ] = token.split( '.' );
		assert.equal( verifyMagicLinkTokenSignature( `${ body }.not-the-real-signature` ), null );
	} );

	it( 'rejects a token signed for a different purpose', () => {
		// Simulates what a session token would look like if someone tried to
		// replay it as a magic-link token — must be rejected by purpose alone.
		const token = buildToken( {
			purpose: 'session',
			userId: 'user-x',
			email: 'someone@example.com',
			exp: Math.floor( Date.now() / 1000 ) + 3600,
		} );
		assert.equal( verifyMagicLinkTokenSignature( token ), null );
	} );

	it( 'rejects an expired token', () => {
		const token = buildToken( {
			purpose: 'magic-link',
			email: 'someone@example.com',
			displayName: 'Name',
			jti: 'abc',
			exp: Math.floor( Date.now() / 1000 ) - 60, // expired one minute ago
		} );
		assert.equal( verifyMagicLinkTokenSignature( token ), null );
	} );

	it( 'rejects malformed tokens without throwing', () => {
		for ( const bad of [ null, undefined, 42, {}, [], '', 'no-dot-here', 'a.b.c', '..', 'a.', '.a' ] ) {
			assert.equal( verifyMagicLinkTokenSignature( bad ), null );
		}
	} );

	it( 'rejects a token whose payload is not valid base64url JSON', () => {
		assert.equal( verifyMagicLinkTokenSignature( 'not-valid-base64!!!.alsonotvalid!!!' ), null );
	} );

	it( 'rejects a well-formed but non-object JSON payload', () => {
		const body = Buffer.from( '"just a string"', 'utf8' ).toString( 'base64url' );
		const sig = createHmac( 'sha256', TEST_SECRET ).update( body ).digest( 'base64url' );
		assert.equal( verifyMagicLinkTokenSignature( `${ body }.${ sig }` ), null );
	} );

	it( 'FAILS CLOSED against a forged token signed with a different secret', () => {
		const token = buildToken(
			{
				purpose: 'magic-link',
				email: 'attacker-controlled@example.com',
				displayName: 'Name',
				jti: 'forged',
				exp: Math.floor( Date.now() / 1000 ) + 3600,
			},
			'a-completely-wrong-secret'
		);
		assert.equal( verifyMagicLinkTokenSignature( token ), null );
	} );
} );

// verifyLoginCode() (PHASE-8-BUILD-PLAN.md Decision 11a) only reaches Netlify
// Blobs AFTER its email/code shape guard clause passes — every case below
// stays on the guard-clause side, so these run with no store access at all,
// same split as the rest of this file. The "code found in the store and
// resolves to a real session" path is Blobs-touching and is exercised by
// deploying and curling /api/auth-code instead, matching how
// verifyMagicLinkAndCreateSession() itself is tested.
describe( 'verifyLoginCode — malformed input never reaches storage', () => {
	it( 'rejects a bad email before ever looking at the code', async () => {
		for ( const badEmail of [ 'not-an-email', '', null, undefined, 42 ] ) {
			assert.equal( await verifyLoginCode( badEmail, '123456' ), null );
		}
	} );

	it( 'rejects anything that is not exactly 6 digits', async () => {
		// NOTE: every case here must stay malformed even after the internal
		// trim() — e.g. '  123456  ' would trim down to a VALID shape and
		// reach getStore(), so it deliberately isn't in this list.
		for ( const badCode of [
			'12345', // too short
			'1234567', // too long
			'abcdef', // not digits
			'12345a', // mixed
			'123 456', // internal whitespace — doesn't trim away
			'', // empty
			null,
			undefined,
			123456, // a number, not a string
		] ) {
			assert.equal( await verifyLoginCode( 'someone@example.com', badCode ), null );
		}
	} );
} );
