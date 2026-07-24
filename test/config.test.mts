/**
 * Unit tests for the pure-logic pieces of netlify/lib/config.mts.
 *
 * getServerConfig() touches Netlify Blobs and is deliberately NOT
 * unit-tested here — same split as the rest of this repo. Verified by
 * deploying and confirming poll-wp-config.mts + a real WordPress fetch
 * populate the cache correctly (see PHASE-3-BUILD-PLAN.md's task G notes).
 *
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeServerConfig } from '../netlify/lib/config.mts';

describe( 'normalizeServerConfig', () => {
	it( 'passes through a well-formed config', () => {
		const result = normalizeServerConfig( { mode: 'gated', tipMinCents: 200, tipMaxCents: 10000 } );
		assert.deepEqual( result, { mode: 'gated', tipMinCents: 200, tipMaxCents: 10000 } );
	} );

	it( 'defaults to open/100/50000 for missing input, never throwing', () => {
		for ( const input of [ null, undefined, {}, [], 'garbage', 42 ] ) {
			const result = normalizeServerConfig( input );
			assert.deepEqual( result, { mode: 'open', tipMinCents: 100, tipMaxCents: 50000 } );
		}
	} );

	it( 'rejects any mode value other than the literal string "gated"', () => {
		for ( const bad of [ 'GATED', 'Open', 'closed', 1, true, null ] ) {
			assert.equal( normalizeServerConfig( { mode: bad } ).mode, 'open' );
		}
		assert.equal( normalizeServerConfig( { mode: 'gated' } ).mode, 'gated' );
	} );

	it( 'falls back to the default for a non-positive or non-numeric tip bound', () => {
		for ( const bad of [ 0, -100, 'abc', null, undefined, NaN, Infinity ] ) {
			assert.equal( normalizeServerConfig( { tipMinCents: bad } ).tipMinCents, 100 );
			assert.equal( normalizeServerConfig( { tipMaxCents: bad } ).tipMaxCents, 50000 );
		}
	} );

	it( 'rounds a fractional cent value rather than rejecting it', () => {
		assert.equal( normalizeServerConfig( { tipMinCents: 150.6 } ).tipMinCents, 151 );
	} );

	it( 'never lets a nested object or array through for any field', () => {
		const result = normalizeServerConfig( {
			mode: { evil: true },
			tipMinCents: [ 1, 2, 3 ],
			tipMaxCents: { amount: 999999 },
		} );
		assert.equal( typeof result.mode, 'string' );
		assert.equal( typeof result.tipMinCents, 'number' );
		assert.equal( typeof result.tipMaxCents, 'number' );
	} );
} );
