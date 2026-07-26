/**
 * Unit tests for the pure-logic pieces of netlify/lib/community.mts.
 *
 * createWordPressPost() / createWordPressReply() touch the network (and
 * getSecret() reads Netlify.env) and are deliberately NOT unit-tested here
 * — same split as the rest of this repo. Verified by deploying and curling
 * /api/community-post / /api/community-reply directly (see
 * PHASE-8-BUILD-PLAN.md's Task C notes).
 *
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	hashEmailForModeratorCheck,
	sanitizePostBody,
	sanitizePostTitle,
	sanitizeReplyBody,
	validateGifUrl,
} from '../netlify/lib/community.mts';

describe( 'sanitizePostTitle', () => {
	it( 'accepts a normal title unchanged', () => {
		assert.equal( sanitizePostTitle( 'A totally normal title' ), 'A totally normal title' );
	} );

	it( 'trims whitespace', () => {
		assert.equal( sanitizePostTitle( '   Padded title   ' ), 'Padded title' );
	} );

	it( 'strips HTML tags (each tag becomes a space, so words on either side never fuse together)', () => {
		assert.equal( sanitizePostTitle( '<b>Bold</b> and <script>alert(1)</script>title' ), 'Bold and alert(1) title' );
	} );

	it( 'collapses ALL whitespace runs, including newlines, to a single space', () => {
		assert.equal( sanitizePostTitle( 'Line one\n\nLine   two\ttabbed' ), 'Line one Line two tabbed' );
	} );

	it( 'bounds to 200 characters', () => {
		const long = 'x'.repeat( 250 );
		const result = sanitizePostTitle( long );
		assert.equal( result?.length, 200 );
	} );

	it( 'rejects non-string input without throwing', () => {
		for ( const input of [ null, undefined, 42, {}, [], true ] ) {
			assert.equal( sanitizePostTitle( input ), null );
		}
	} );

	it( 'rejects a title that is empty or only whitespace/tags after cleaning', () => {
		for ( const bad of [ '', '   ', '<b></b>', '<script></script>   ' ] ) {
			assert.equal( sanitizePostTitle( bad ), null );
		}
	} );
} );

describe( 'sanitizePostBody / sanitizeReplyBody', () => {
	it( 'accepts normal multi-line text and PRESERVES newlines (unlike the title sanitizer)', () => {
		const input = 'First paragraph.\n\nSecond paragraph.';
		assert.equal( sanitizePostBody( input ), 'First paragraph.\n\nSecond paragraph.' );
		assert.equal( sanitizeReplyBody( input ), 'First paragraph.\n\nSecond paragraph.' );
	} );

	it( 'strips HTML tags per line (each tag becomes a space, so words never fuse together)', () => {
		assert.equal( sanitizePostBody( '<b>Bold line</b>\n<script>alert(1)</script>second line' ), 'Bold line\nalert(1) second line' );
	} );

	it( 'collapses only horizontal whitespace, one line at a time', () => {
		assert.equal( sanitizePostBody( '  Hello   world  \n  Second   line  ' ), 'Hello world\nSecond line' );
	} );

	it( 'trims leading/trailing blank lines but keeps blank lines in the middle (paragraph breaks)', () => {
		assert.equal( sanitizePostBody( '\n\n  First\n\nSecond  \n\n' ), 'First\n\nSecond' );
	} );

	it( 'rejects non-string input without throwing', () => {
		for ( const input of [ null, undefined, 42, {}, [], true ] ) {
			assert.equal( sanitizePostBody( input ), null );
			assert.equal( sanitizeReplyBody( input ), null );
		}
	} );

	it( 'rejects a body that is empty or only whitespace/tags after cleaning', () => {
		for ( const bad of [ '', '   \n\n   ', '<b></b>', '<script></script>\n\n' ] ) {
			assert.equal( sanitizePostBody( bad ), null );
			assert.equal( sanitizeReplyBody( bad ), null );
		}
	} );

	it( 'bounds post bodies to 10000 characters and reply bodies to 5000', () => {
		const long = 'x'.repeat( 12000 );
		assert.equal( sanitizePostBody( long )?.length, 10000 );
		assert.equal( sanitizeReplyBody( long )?.length, 5000 );
	} );
} );

describe( 'hashEmailForModeratorCheck', () => {
	it( 'is deterministic — the same email always hashes the same', () => {
		const a = hashEmailForModeratorCheck( 'austin@example.com' );
		const b = hashEmailForModeratorCheck( 'austin@example.com' );
		assert.equal( a, b );
	} );

	it( 'is case-insensitive, matching functions.php\'s strtolower() normalization', () => {
		const lower = hashEmailForModeratorCheck( 'austin@example.com' );
		const upper = hashEmailForModeratorCheck( 'Austin@Example.COM' );
		assert.equal( lower, upper );
	} );

	it( 'trims whitespace, matching functions.php\'s trim() normalization', () => {
		const clean = hashEmailForModeratorCheck( 'austin@example.com' );
		const padded = hashEmailForModeratorCheck( '  austin@example.com  ' );
		assert.equal( clean, padded );
	} );

	it( 'differs for different emails', () => {
		assert.notEqual( hashEmailForModeratorCheck( 'austin@example.com' ), hashEmailForModeratorCheck( 'brad@example.com' ) );
	} );

	it( 'produces a 64-character lowercase hex string (raw SHA-256, matching PHP\'s hash() default encoding)', () => {
		const result = hashEmailForModeratorCheck( 'austin@example.com' );
		assert.match( result, /^[0-9a-f]{64}$/ );
	} );

	it( 'never contains the email itself', () => {
		const result = hashEmailForModeratorCheck( 'austin@example.com' );
		assert.ok( ! result.includes( 'austin' ) );
	} );
} );

describe( 'validateGifUrl', () => {
	it( 'accepts a real Giphy .gif URL', () => {
		assert.equal( validateGifUrl( 'https://media.giphy.com/media/abc123/giphy.gif' ), 'https://media.giphy.com/media/abc123/giphy.gif' );
	} );

	it( 'accepts every host on the allowlist', () => {
		for ( const host of [ 'media.giphy.com', 'i.giphy.com', 'media.tenor.com', 'c.tenor.com' ] ) {
			assert.ok( validateGifUrl( `https://${ host }/x.gif` ) );
		}
	} );

	it( 'accepts .webp and .mp4 as well as .gif', () => {
		assert.ok( validateGifUrl( 'https://media.giphy.com/x.webp' ) );
		assert.ok( validateGifUrl( 'https://media.giphy.com/x.mp4' ) );
	} );

	it( 'is case-insensitive on host and extension', () => {
		assert.ok( validateGifUrl( 'https://MEDIA.GIPHY.COM/x.GIF' ) );
	} );

	it( 'rejects a host that merely CONTAINS an allowed host as a substring — the exact bypass this allowlist exists to stop', () => {
		assert.equal( validateGifUrl( 'https://media.giphy.com.evil.tld/x.gif' ), null );
		assert.equal( validateGifUrl( 'https://evil-media.giphy.com/x.gif' ), null );
		assert.equal( validateGifUrl( 'https://evil.tld/media.giphy.com/x.gif' ), null );
	} );

	it( 'rejects userinfo tricks (host that LOOKS allowlisted before an @)', () => {
		assert.equal( validateGifUrl( 'https://media.giphy.com@evil.tld/x.gif' ), null );
	} );

	it( 'rejects a non-allowlisted host entirely', () => {
		assert.equal( validateGifUrl( 'https://example.com/x.gif' ), null );
	} );

	it( 'rejects http (non-https)', () => {
		assert.equal( validateGifUrl( 'http://media.giphy.com/x.gif' ), null );
	} );

	it( 'rejects a disallowed or missing extension', () => {
		assert.equal( validateGifUrl( 'https://media.giphy.com/x.png' ), null );
		assert.equal( validateGifUrl( 'https://media.giphy.com/x' ), null );
		assert.equal( validateGifUrl( 'https://media.giphy.com/' ), null );
	} );

	it( 'rejects a malformed URL without throwing', () => {
		assert.equal( validateGifUrl( 'not a url' ), null );
	} );

	it( 'rejects non-string and empty input without throwing', () => {
		for ( const input of [ null, undefined, 42, {}, [], true, '', '   ' ] ) {
			assert.equal( validateGifUrl( input ), null );
		}
	} );
} );
