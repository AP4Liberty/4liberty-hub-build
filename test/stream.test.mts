/**
 * Unit tests for the pure-logic pieces of netlify/lib/stream.mts.
 *
 * mintGuestToken() / ensureHubChannel() / getPublicApiKey() all touch the
 * real Stream API and are deliberately NOT unit-tested here — same split
 * this repo already uses for poll-rumble.mts/live-state.mts (their
 * Blobs/network-touching code has no unit tests; sanitize.mts's pure logic
 * does). Those are verified by deploying and calling the real endpoint
 * (see PHASE-3-BUILD-PLAN.md's task C notes), not by mocking Stream/Blobs
 * locally.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizeDisplayName } from '../netlify/lib/stream.mts';

describe( 'sanitizeDisplayName', () => {
	it( 'accepts a normal name unchanged', () => {
		assert.equal( sanitizeDisplayName( 'Curious Voter' ), 'Curious Voter' );
	} );

	it( 'trims leading/trailing whitespace', () => {
		assert.equal( sanitizeDisplayName( '  Curious Voter  ' ), 'Curious Voter' );
	} );

	it( 'collapses internal whitespace runs to a single space', () => {
		assert.equal( sanitizeDisplayName( 'Curious    Voter' ), 'Curious Voter' );
		assert.equal( sanitizeDisplayName( 'Tab\tHere' ), 'Tab Here' );
	} );

	it( 'rejects non-string input without throwing', () => {
		for ( const input of [ null, undefined, 42, {}, [], true ] ) {
			assert.equal( sanitizeDisplayName( input ), null );
		}
	} );

	it( 'rejects empty or whitespace-only input', () => {
		assert.equal( sanitizeDisplayName( '' ), null );
		assert.equal( sanitizeDisplayName( '   ' ), null );
	} );

	it( 'rejects a single character (below the minimum)', () => {
		assert.equal( sanitizeDisplayName( 'A' ), null );
	} );

	it( 'accepts exactly the minimum length', () => {
		assert.equal( sanitizeDisplayName( 'Al' ), 'Al' );
	} );

	it( 'accepts exactly the maximum length (30 chars)', () => {
		const thirty = 'A'.repeat( 30 );
		assert.equal( sanitizeDisplayName( thirty ), thirty );
	} );

	it( 'rejects anything over the maximum length', () => {
		const tooLong = 'A'.repeat( 31 );
		assert.equal( sanitizeDisplayName( tooLong ), null );
	} );

	it( 'does not let a name that is only whitespace pad past the minimum', () => {
		// "  A  " trims to "A" (1 char) — must still be rejected, not judged
		// against its un-trimmed length.
		assert.equal( sanitizeDisplayName( '  A  ' ), null );
	} );
} );
