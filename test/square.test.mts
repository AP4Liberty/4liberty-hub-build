/**
 * Unit tests for the pure-logic pieces of netlify/lib/square.mts.
 *
 * createTip() touches the real Square API and is deliberately NOT
 * unit-tested here — same split this repo already uses (see
 * test/stream.test.mts's header). Verified by deploying and calling the
 * real endpoint / a real Node script exercising a real Sandbox charge, not
 * by mocking Square locally.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isValidIdempotencyKey, sanitizeTipMessage, validateAmountCents } from '../netlify/lib/square.mts';

describe( 'validateAmountCents', () => {
	it( 'accepts an amount within bounds', () => {
		const result = validateAmountCents( 1776 );
		assert.equal( result.valid, true );
		assert.equal( result.cents, 1776 );
	} );

	it( 'accepts the minimum ($1 = 100 cents)', () => {
		assert.equal( validateAmountCents( 100 ).valid, true );
	} );

	it( 'accepts the maximum ($500 = 50000 cents)', () => {
		assert.equal( validateAmountCents( 50000 ).valid, true );
	} );

	it( 'rejects below the minimum', () => {
		assert.equal( validateAmountCents( 99 ).valid, false );
		assert.equal( validateAmountCents( 0 ).valid, false );
		assert.equal( validateAmountCents( -500 ).valid, false );
	} );

	it( 'rejects above the maximum', () => {
		assert.equal( validateAmountCents( 50001 ).valid, false );
		assert.equal( validateAmountCents( 1000000 ).valid, false );
	} );

	it( 'rounds a fractional-cent amount rather than rejecting it', () => {
		// A client shouldn't be able to send fractional cents, but rounding
		// (not throwing) keeps this a UX guard, not a crash surface.
		assert.equal( validateAmountCents( 1776.4 ).cents, 1776 );
		assert.equal( validateAmountCents( 1776.6 ).cents, 1777 );
	} );

	it( 'rejects non-numeric and non-finite input without throwing', () => {
		for ( const input of [ null, undefined, 'abc', {}, [], true, NaN, Infinity, -Infinity ] ) {
			const result = validateAmountCents( input );
			assert.equal( result.valid, false );
			assert.equal( result.cents, 0 );
		}
	} );
} );

describe( 'sanitizeTipMessage', () => {
	it( 'trims whitespace', () => {
		assert.equal( sanitizeTipMessage( '  Keep it up!  ' ), 'Keep it up!' );
	} );

	it( 'returns an empty string for non-string input, never throwing', () => {
		for ( const input of [ null, undefined, 42, {}, [] ] ) {
			assert.equal( sanitizeTipMessage( input ), '' );
		}
	} );

	it( 'bounds an overly long message to 200 characters', () => {
		const long = 'x'.repeat( 500 );
		assert.equal( sanitizeTipMessage( long ).length, 200 );
	} );

	it( 'leaves a normal-length message untouched', () => {
		assert.equal( sanitizeTipMessage( 'Great show today!' ), 'Great show today!' );
	} );
} );

describe( 'isValidIdempotencyKey', () => {
	it( 'accepts a real UUID', () => {
		assert.equal( isValidIdempotencyKey( '7b0f3ec5-086a-4871-8f13-3c81b3875218' ), true );
	} );

	it( 'rejects too-short strings', () => {
		assert.equal( isValidIdempotencyKey( 'short' ), false );
	} );

	it( 'rejects an absurdly long string', () => {
		assert.equal( isValidIdempotencyKey( 'x'.repeat( 200 ) ), false );
	} );

	it( 'rejects non-string input without throwing', () => {
		for ( const input of [ null, undefined, 12345, {}, [] ] ) {
			assert.equal( isValidIdempotencyKey( input ), false );
		}
	} );
} );
