/**
 * Security regression tests for the allowlist sanitizer.
 *
 * These are NOT optional and must never be weakened to make a change pass.
 * A regression here means a live RTMP stream key reaches the public homepage,
 * and anyone who reads it can take over the broadcast.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { discoverChannels, pendingChannelKeys } from '../netlify/lib/channels.mts';
import { offlineChannel, redact, sanitizeChannel } from '../netlify/lib/sanitize.mts';

const STREAM_KEY = 'sk_live_THIS_WOULD_LET_SOMEONE_HIJACK_THE_BROADCAST';
const SERVER_URL = 'rtmp://ingest.rumble.com/live';

/** A realistic response shape, per the Phase 0 spike (PHASE-0-FINDINGS.md). */
function rawResponse( overrides: Record< string, unknown > = {} ) {
	return {
		now: 1751800000,
		username: 'AP4Liberty',
		num_followers: 12000,
		livestreams: [
			{
				id: '7a4r64',
				title: 'Trump vs. the Commie Caucus',
				is_live: true,
				scheduled_on: '2026-07-06T12:00:00+00:00',
				watching_now: 66,
				likes: 33,
				dislikes: 2,
				// ── The dangerous fields ──
				server_url: SERVER_URL,
				stream_key: STREAM_KEY,
				chat: {
					recent_messages: [
						{
							username: 'MurTech',
							profile_pic_url: 'https://example.com/murtech.jpg',
							badges: [ 'verified' ],
							text: 'hello',
							created_on: '2026-07-06T11:51:00+00:00',
						},
					],
					recent_rants: [
						{
							username: 'Whale',
							profile_pic_url: 'https://example.com/whale.jpg',
							badges: [ 'whale-yellow' ],
							text: 'nice show',
							created_on: '2026-07-06T11:52:00+00:00',
							amount_dollars: 50,
							// ── Fields the front-end never needs — must not survive ──
							amount_cents: 5000,
							expires_on: '2026-07-07T00:00:00+00:00',
						},
					],
				},
			},
		],
		// ── PII ──
		recent_followers: [ { username: 'follower_one' } ],
		recent_subscribers: [ { username: 'sub_one', email: 'sub@example.com' } ],
		recent_gifted_subs: [ { username: 'gifter' } ],
		...overrides,
	};
}

/** Recursively collect every key and every string value in an object. */
function walk( value: unknown, keys: string[] = [], values: string[] = [] ) {
	if ( typeof value === 'string' ) {
		values.push( value );
	} else if ( Array.isArray( value ) ) {
		for ( const item of value ) walk( item, keys, values );
	} else if ( value && typeof value === 'object' ) {
		for ( const [ k, v ] of Object.entries( value ) ) {
			keys.push( k );
			walk( v, keys, values );
		}
	}
	return { keys, values };
}

/** The core assertion: nothing sensitive survived, by key OR by value. */
function assertNoSecrets( output: unknown ) {
	const { keys, values } = walk( output );

	const forbiddenKeys = [
		'stream_key',
		'server_url',
		// NOTE: 'chat' itself is no longer forbidden — Phase 3 adds it as a
		// legitimate, allowlist-sanitized field. What must never survive is
		// the RAW nested shape (below) or anything within it that isn't on
		// the per-message allowlist in sanitize.mts.
		'recent_messages',
		'recent_rants',
		'recent_followers',
		'recent_subscribers',
		'recent_gifted_subs',
		'amount_cents',
		'expires_on',
		'email',
	];
	for ( const forbidden of forbiddenKeys ) {
		assert.ok( ! keys.includes( forbidden ), `sanitized output must not contain key "${ forbidden }"` );
	}

	const forbiddenValues = [ STREAM_KEY, SERVER_URL, 'sub@example.com' ];
	for ( const forbidden of forbiddenValues ) {
		for ( const value of values ) {
			assert.ok(
				! value.includes( forbidden ),
				`sanitized output must not contain the value "${ forbidden }"`
			);
		}
	}
}

describe( 'sanitizeChannel — secrets', () => {
	it( 'strips broadcast credentials and PII from a live response', () => {
		assertNoSecrets( sanitizeChannel( 'WUA', rawResponse() ) );
	} );

	it( 'strips them from a dark response too', () => {
		const raw = rawResponse();
		raw.livestreams[ 0 ].is_live = false;
		assertNoSecrets( sanitizeChannel( 'WUA', raw ) );
	} );

	it( 'FAILS CLOSED on a sensitive field Rumble has not invented yet', () => {
		// The whole reason this is an allowlist and not a denylist. A field
		// nobody has ever heard of must be dropped simply because it was
		// never explicitly named in sanitize.mts.
		const raw = rawResponse();
		( raw.livestreams[ 0 ] as any ).backup_stream_key = STREAM_KEY;
		( raw.livestreams[ 0 ] as any ).srt_ingest_passphrase = STREAM_KEY;
		( raw as any ).account_recovery_email = 'sub@example.com';

		const output = sanitizeChannel( 'WUA', raw );

		assertNoSecrets( output );
		const { keys } = walk( output );
		assert.ok( ! keys.includes( 'backup_stream_key' ) );
		assert.ok( ! keys.includes( 'srt_ingest_passphrase' ) );
		assert.ok( ! keys.includes( 'account_recovery_email' ) );
	} );

	it( 'emits exactly the agreed field set and nothing more', () => {
		// Locks the payload shape. If you add a field, add it here too —
		// deliberately, having thought about whether it is safe to publish.
		const output = sanitizeChannel( 'WUA', rawResponse() );
		assert.deepEqual( Object.keys( output ).sort(), [
			'channel',
			'chat',
			'embed_id',
			'is_live',
			'key',
			'likes',
			'scheduled_on',
			'title',
			'watching_now',
		] );
	} );

	it( 'never lets a nested object through, even from a hostile response', () => {
		const raw = rawResponse();
		// Every scalar field replaced with an object carrying a secret.
		( raw.livestreams[ 0 ] as any ).title = { evil: STREAM_KEY };
		( raw.livestreams[ 0 ] as any ).id = { evil: STREAM_KEY };
		( raw as any ).username = { evil: STREAM_KEY };
		( raw.livestreams[ 0 ] as any ).watching_now = { evil: STREAM_KEY };

		const output = sanitizeChannel( 'WUA', raw );

		assertNoSecrets( output );
		assert.equal( output.title, null );
		assert.equal( output.embed_id, null );
		assert.equal( output.channel, null );
		assert.equal( output.watching_now, 0 );
	} );
} );

describe( 'sanitizeChannel — behaviour', () => {
	it( 'reads a live channel correctly', () => {
		const output = sanitizeChannel( 'WUA', rawResponse() );
		assert.equal( output.key, 'WUA' );
		assert.equal( output.channel, 'AP4Liberty' );
		assert.equal( output.is_live, true );
		assert.equal( output.title, 'Trump vs. the Commie Caucus' );
		assert.equal( output.embed_id, '7a4r64' );
		assert.equal( output.watching_now, 66 );
		assert.equal( output.likes, 33 );
	} );

	it( 'reports is_live false when dark', () => {
		const raw = rawResponse();
		raw.livestreams[ 0 ].is_live = false;
		assert.equal( sanitizeChannel( 'WUA', raw ).is_live, false );
	} );

	it( 'treats a missing is_live as not live (never truthy-coerced)', () => {
		const raw = rawResponse();
		delete ( raw.livestreams[ 0 ] as any ).is_live;
		assert.equal( sanitizeChannel( 'WUA', raw ).is_live, false );

		const stringy = rawResponse();
		( stringy.livestreams[ 0 ] as any ).is_live = 'false';
		assert.equal( sanitizeChannel( 'WUA', stringy ).is_live, false );
	} );

	it( 'prefers the genuinely live stream when several are listed', () => {
		const raw = rawResponse();
		raw.livestreams = [
			{ id: 'upcoming', title: 'Next week', is_live: false, watching_now: 0, likes: 0 },
			{ id: 'onair', title: 'On air now', is_live: true, watching_now: 12, likes: 3 },
		] as any;

		const output = sanitizeChannel( 'WUA', raw );
		assert.equal( output.embed_id, 'onair' );
		assert.equal( output.is_live, true );
	} );

	it( 'survives malformed input without throwing', () => {
		for ( const input of [ null, undefined, {}, [], '', 0, { livestreams: null }, { livestreams: [] } ] ) {
			const output = sanitizeChannel( 'WUA', input );
			assert.equal( output.is_live, false );
			assert.equal( output.key, 'WUA' );
			assert.deepEqual( output.chat, [] );
			assertNoSecrets( output );
		}
	} );

	it( 'offlineChannel is shaped identically and is never live', () => {
		const offline = offlineChannel( 'FNFA' );
		assert.equal( offline.is_live, false );
		assert.deepEqual( offline.chat, [] );
		assert.deepEqual(
			Object.keys( offline ).sort(),
			Object.keys( sanitizeChannel( 'FNFA', rawResponse() ) ).sort()
		);
	} );
} );

describe( 'sanitizeChannel — chat', () => {
	it( 'merges recent_messages and recent_rants into one sorted feed', () => {
		const output = sanitizeChannel( 'WUA', rawResponse() );
		assert.equal( output.chat.length, 2 );
		assert.equal( output.chat[ 0 ].username, 'MurTech' );
		assert.equal( output.chat[ 0 ].is_rant, false );
		assert.equal( output.chat[ 0 ].amount_dollars, 0 );
		assert.equal( output.chat[ 1 ].username, 'Whale' );
		assert.equal( output.chat[ 1 ].is_rant, true );
		assert.equal( output.chat[ 1 ].amount_dollars, 50 );
	} );

	it( 'locks the per-message field set', () => {
		const output = sanitizeChannel( 'WUA', rawResponse() );
		assert.deepEqual( Object.keys( output.chat[ 0 ] ).sort(), [
			'amount_dollars',
			'badges',
			'created_on',
			'is_rant',
			'profile_pic_url',
			'text',
			'username',
		] );
	} );

	it( 'never lets amount_cents or expires_on survive from a raw rant', () => {
		assertNoSecrets( sanitizeChannel( 'WUA', rawResponse() ) );
	} );

	it( 'derives is_rant from the source array, never from the message itself', () => {
		// A plain chat message claiming its own rant status and dollar amount
		// must not work — is_rant/amount_dollars come from which ARRAY the
		// item was found in, never from a field on the message itself.
		const raw = rawResponse();
		( raw.livestreams[ 0 ] as any ).chat.recent_messages = [
			{ username: 'Faker', text: 'not a real rant', is_rant: true, amount_dollars: 999 },
		];
		( raw.livestreams[ 0 ] as any ).chat.recent_rants = [];

		const output = sanitizeChannel( 'WUA', raw );
		assert.equal( output.chat.length, 1 );
		assert.equal( output.chat[ 0 ].is_rant, false );
		assert.equal( output.chat[ 0 ].amount_dollars, 0 );
	} );

	it( 'FAILS CLOSED on a sensitive field invented on a single message', () => {
		const raw = rawResponse();
		( raw.livestreams[ 0 ] as any ).chat.recent_messages = [
			{
				username: 'MurTech',
				text: 'hello',
				ip_address: '10.0.0.1',
				internal_user_id: 84213,
				device_fingerprint: 'abc123',
			},
		];
		( raw.livestreams[ 0 ] as any ).chat.recent_rants = [];

		const output = sanitizeChannel( 'WUA', raw );
		assertNoSecrets( output );
		const { keys } = walk( output );
		assert.ok( ! keys.includes( 'ip_address' ) );
		assert.ok( ! keys.includes( 'internal_user_id' ) );
		assert.ok( ! keys.includes( 'device_fingerprint' ) );
	} );

	it( 'never lets a nested object through in a chat message field', () => {
		const raw = rawResponse();
		( raw.livestreams[ 0 ] as any ).chat.recent_messages = [
			{
				username: { evil: STREAM_KEY },
				profile_pic_url: { evil: STREAM_KEY },
				text: { evil: STREAM_KEY },
				badges: [ { evil: STREAM_KEY }, 'verified' ],
			},
		];
		( raw.livestreams[ 0 ] as any ).chat.recent_rants = [];

		const output = sanitizeChannel( 'WUA', raw );
		assertNoSecrets( output );
		assert.equal( output.chat[ 0 ].username, null );
		assert.equal( output.chat[ 0 ].profile_pic_url, null );
		assert.equal( output.chat[ 0 ].text, null );
		assert.deepEqual( output.chat[ 0 ].badges, [ 'verified' ] );
	} );

	it( 'defaults badges to an empty array, never null or undefined', () => {
		const raw = rawResponse();
		( raw.livestreams[ 0 ] as any ).chat.recent_messages = [ { username: 'NoBadges', text: 'hi' } ];
		( raw.livestreams[ 0 ] as any ).chat.recent_rants = [];

		const output = sanitizeChannel( 'WUA', raw );
		assert.deepEqual( output.chat[ 0 ].badges, [] );
	} );

	it( 'caps chat length and keeps the most recent messages', () => {
		const raw = rawResponse();
		const many = [];
		for ( let i = 0; i < 60; i++ ) {
			many.push( {
				username: 'user' + i,
				text: 'message ' + i,
				created_on: new Date( 2026, 0, 1, 0, 0, i ).toISOString(),
			} );
		}
		( raw.livestreams[ 0 ] as any ).chat.recent_messages = many;
		( raw.livestreams[ 0 ] as any ).chat.recent_rants = [];

		const output = sanitizeChannel( 'WUA', raw );
		assert.equal( output.chat.length, 50 );
		assert.equal( output.chat[ 0 ].username, 'user10' );
		assert.equal( output.chat[ output.chat.length - 1 ].username, 'user59' );
	} );

	it( 'handles a channel with no chat data at all', () => {
		const raw = rawResponse();
		delete ( raw.livestreams[ 0 ] as any ).chat;
		const output = sanitizeChannel( 'WUA', raw );
		assert.deepEqual( output.chat, [] );
	} );
} );

describe( 'redact', () => {
	it( 'scrubs a secret URL out of a fetch error message', () => {
		const url = 'https://rumble.com/-livestream-api/get-data?key=SUPERSECRETVALUE12345';
		const message = `request to ${ url } failed, reason: ECONNRESET`;
		const output = redact( message, [ url ] );

		assert.ok( ! output.includes( 'SUPERSECRETVALUE12345' ) );
		assert.ok( output.includes( '[redacted]' ) );
		assert.ok( output.includes( 'ECONNRESET' ) );
	} );

	it( 'scrubs every configured channel secret, not just the failing one', () => {
		const a = 'https://rumble.com/api?key=AAAAAAAAAAAAAAAA';
		const b = 'https://rumble.com/api?key=BBBBBBBBBBBBBBBB';
		const output = redact( `${ a } and ${ b } both failed`, [ a, b ] );
		assert.ok( ! output.includes( 'AAAAAAAAAAAAAAAA' ) );
		assert.ok( ! output.includes( 'BBBBBBBBBBBBBBBB' ) );
	} );
} );

describe( 'discoverChannels', () => {
	const env = {
		RUMBLE_API_URL_WUA: 'https://rumble.com/api?key=aaa',
		RUMBLE_API_URL_CAFECITO: 'https://rumble.com/api?key=bbb',
		RUMBLE_API_URL_FNFA: 'PASTE_VALUE_IN_NETLIFY_UI',
		RUMBLE_API_URL_EMPTY: '',
		UNRELATED_VAR: 'https://example.com',
	};

	it( 'discovers only fully configured channels', () => {
		assert.deepEqual( discoverChannels( env ).map( ( c ) => c.key ), [ 'CAFECITO', 'WUA' ] );
	} );

	it( 'ignores placeholders and blanks rather than fetching them', () => {
		const keys = discoverChannels( env ).map( ( c ) => c.key );
		assert.ok( ! keys.includes( 'FNFA' ) );
		assert.ok( ! keys.includes( 'EMPTY' ) );
	} );

	it( 'ignores env vars that are not channels', () => {
		assert.ok( ! discoverChannels( env ).some( ( c ) => c.url === 'https://example.com' ) );
	} );

	it( 'reports which channels are still awaiting a pasted value', () => {
		assert.deepEqual( pendingChannelKeys( env ), [ 'EMPTY', 'FNFA' ] );
	} );
} );
