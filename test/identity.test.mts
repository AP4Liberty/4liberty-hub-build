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
	signMagicLinkToken,
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
