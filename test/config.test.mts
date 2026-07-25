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

const DEFAULT_SHAPE = {
	mode: 'open',
	tipMinCents: 100,
	tipMaxCents: 50000,
	communityPaused: false,
	communityMode: 'open',
	communityPostRateLimit: 5,
	communityReplyRateLimit: 20,
	communityGateHours: 24,
	communityModeratorEmailHashes: [],
	communityReservedNames: [],
	communityRoomName: 'The Lobby',
};

describe( 'normalizeServerConfig', () => {
	it( 'passes through a well-formed config, including the Phase 8 community fields', () => {
		const result = normalizeServerConfig( {
			mode: 'gated',
			tipMinCents: 200,
			tipMaxCents: 10000,
			communityPaused: true,
			communityMode: 'gated',
			communityPostRateLimit: 3,
			communityReplyRateLimit: 15,
			communityGateHours: 48,
			communityModeratorEmailHashes: [ 'abc123', 'def456' ],
			communityReservedNames: [ 'Austin Petersen' ],
			communityRoomName: 'Main Hall',
		} );
		assert.deepEqual( result, {
			mode: 'gated',
			tipMinCents: 200,
			tipMaxCents: 10000,
			communityPaused: true,
			communityMode: 'gated',
			communityPostRateLimit: 3,
			communityReplyRateLimit: 15,
			communityGateHours: 48,
			communityModeratorEmailHashes: [ 'abc123', 'def456' ],
			communityReservedNames: [ 'Austin Petersen' ],
			communityRoomName: 'Main Hall',
		} );
	} );

	it( 'defaults every field for missing input, never throwing', () => {
		for ( const input of [ null, undefined, {}, [], 'garbage', 42 ] ) {
			assert.deepEqual( normalizeServerConfig( input ), DEFAULT_SHAPE );
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

	// PHASE-8-BUILD-PLAN.md Decision 4/5: the community's own mode must
	// never be confused with the homepage's `mode` — a regression here would
	// mean flipping one switch silently flips the other.
	it( 'keeps communityMode and mode completely independent', () => {
		const result = normalizeServerConfig( { mode: 'gated', communityMode: 'open' } );
		assert.equal( result.mode, 'gated' );
		assert.equal( result.communityMode, 'open' );

		const inverted = normalizeServerConfig( { mode: 'open', communityMode: 'gated' } );
		assert.equal( inverted.mode, 'open' );
		assert.equal( inverted.communityMode, 'gated' );
	} );

	it( 'rejects any communityMode value other than the literal string "gated"', () => {
		for ( const bad of [ 'GATED', 'Open', 'closed', 1, true, null ] ) {
			assert.equal( normalizeServerConfig( { communityMode: bad } ).communityMode, 'open' );
		}
	} );

	it( 'coerces communityPaused to a real boolean, defaulting false on anything else', () => {
		assert.equal( normalizeServerConfig( { communityPaused: true } ).communityPaused, true );
		assert.equal( normalizeServerConfig( { communityPaused: false } ).communityPaused, false );
		for ( const bad of [ 'true', 1, 0, null, undefined, {} ] ) {
			assert.equal( normalizeServerConfig( { communityPaused: bad } ).communityPaused, false );
		}
	} );

	it( 'falls back to the default for a non-positive or non-numeric rate limit or gate window', () => {
		for ( const bad of [ 0, -5, 'abc', null, undefined, NaN, Infinity ] ) {
			assert.equal( normalizeServerConfig( { communityPostRateLimit: bad } ).communityPostRateLimit, 5 );
			assert.equal( normalizeServerConfig( { communityReplyRateLimit: bad } ).communityReplyRateLimit, 20 );
			assert.equal( normalizeServerConfig( { communityGateHours: bad } ).communityGateHours, 24 );
		}
	} );

	it( 'coerces non-array moderator hashes / reserved names to an empty array', () => {
		for ( const bad of [ 'not-an-array', 42, null, undefined, {} ] ) {
			assert.deepEqual( normalizeServerConfig( { communityModeratorEmailHashes: bad } ).communityModeratorEmailHashes, [] );
			assert.deepEqual( normalizeServerConfig( { communityReservedNames: bad } ).communityReservedNames, [] );
		}
	} );

	it( 'drops non-string entries from moderator hashes / reserved names rather than rejecting the whole list', () => {
		const result = normalizeServerConfig( {
			communityModeratorEmailHashes: [ 'abc123', 42, null, 'def456' ],
			communityReservedNames: [ 'Austin Petersen', 99, {} ],
		} );
		assert.deepEqual( result.communityModeratorEmailHashes, [ 'abc123', 'def456' ] );
		assert.deepEqual( result.communityReservedNames, [ 'Austin Petersen' ] );
	} );

	it( 'falls back to "The Lobby" for a missing or non-string room name', () => {
		for ( const bad of [ '', 42, null, undefined, {}, [] ] ) {
			assert.equal( normalizeServerConfig( { communityRoomName: bad } ).communityRoomName, 'The Lobby' );
		}
		assert.equal( normalizeServerConfig( { communityRoomName: 'Main Hall' } ).communityRoomName, 'Main Hall' );
	} );
} );
