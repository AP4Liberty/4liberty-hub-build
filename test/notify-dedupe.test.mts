/**
 * Unit tests for the pure-logic half of netlify/lib/notify-dedupe.mts.
 *
 * wasRecentlyNotified() / markNotified() touch Netlify Blobs and are
 * deliberately NOT unit-tested here — same split as the rest of this repo
 * (see community.test.mts's header).
 *
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isWithinDedupeWindow } from '../netlify/lib/notify-dedupe.mts';

describe( 'isWithinDedupeWindow', () => {
	it( 'is true immediately after being notified', () => {
		assert.equal( isWithinDedupeWindow( 1000, 1000, 900 ), true );
	} );

	it( 'is true just before the window closes', () => {
		assert.equal( isWithinDedupeWindow( 1000, 1000 + 899, 900 ), true );
	} );

	it( 'is false exactly at the window boundary', () => {
		assert.equal( isWithinDedupeWindow( 1000, 1000 + 900, 900 ), false );
	} );

	it( 'is false well after the window', () => {
		assert.equal( isWithinDedupeWindow( 1000, 1000 + 3600, 900 ), false );
	} );

	it( 'defaults to a 15-minute window when none is passed', () => {
		assert.equal( isWithinDedupeWindow( 1000, 1000 + 60 ), true );
		assert.equal( isWithinDedupeWindow( 1000, 1000 + 15 * 60 ), false );
	} );
} );
