/**
 * The Community page's WordPress client — the ONLY code that ever holds
 * FOURLIBERTY_COMMUNITY_SECRET, and the ONLY place that calls WordPress's
 * signature-gated community-post / community-reply routes
 * (PHASE-8-BUILD-PLAN.md Decision 2). Also owns the plain-text sanitizers
 * for post/reply content, and the moderator-email hash check.
 */

import { createHash, createHmac } from 'node:crypto';

const WP_BASE_URL = 'https://4libertynetwork.com/wp-json/fourliberty/v1';
const FETCH_TIMEOUT_MS = 8000;

const MAX_TITLE_LENGTH = 200;
const MAX_POST_BODY_LENGTH = 10000;
const MAX_REPLY_BODY_LENGTH = 5000;

function getSecret(): string {
	const secret = Netlify.env.get( 'FOURLIBERTY_COMMUNITY_SECRET' );
	if ( ! secret ) {
		throw new Error( 'Community write access is not configured (missing FOURLIBERTY_COMMUNITY_SECRET).' );
	}
	return secret;
}

/**
 * hex digest — MUST match PHP's hash_hmac('sha256', $body, $secret) DEFAULT
 * encoding on the WordPress side (community-rest-routes.php's
 * fourliberty_hub_verify_community_signature()). NOT base64url, which is
 * what this codebase's OTHER signing (identity.mts's sign()) uses — mixing
 * the two up would silently fail every signature check.
 */
function signBody( rawBody: string ): string {
	return createHmac( 'sha256', getSecret() ).update( rawBody ).digest( 'hex' );
}

/**
 * Matches functions.php's hash('sha256', strtolower(trim($email))) exactly
 * — same algorithm, same normalization order, so a visitor's already-known,
 * already-logged-in email hashes to the same value WordPress published on
 * the public /server-config route (see that file's header for why raw
 * addresses are never exposed there).
 */
export function hashEmailForModeratorCheck( email: string ): string {
	return createHash( 'sha256' ).update( email.trim().toLowerCase() ).digest( 'hex' );
}

interface WordPressResult< T > {
	ok: boolean;
	body: T | null;
}

async function postToWordPress< T >( path: string, payload: unknown ): Promise< WordPressResult< T > > {
	const rawBody = JSON.stringify( payload );
	let signature: string;
	try {
		signature = signBody( rawBody );
	} catch ( error ) {
		console.error( '[community] cannot sign request:', error instanceof Error ? error.message : String( error ) );
		return { ok: false, body: null };
	}

	try {
		const response = await fetch( `${ WP_BASE_URL }${ path }`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-fl-signature': signature,
			},
			body: rawBody,
			signal: AbortSignal.timeout( FETCH_TIMEOUT_MS ),
		} );
		const body = ( await response.json().catch( () => null ) ) as T | null;
		return { ok: response.ok, body };
	} catch ( error ) {
		console.error( `[community] WordPress request to ${ path } failed:`, error instanceof Error ? error.message : String( error ) );
		return { ok: false, body: null };
	}
}

export interface CreatePostResult {
	success: true;
	postId: number;
	status: 'publish' | 'pending';
	url: string;
}

export async function createWordPressPost( args: {
	userId: string;
	displayName: string;
	role: string;
	title: string;
	body: string;
	status: 'publish' | 'pending';
} ): Promise< CreatePostResult | null > {
	const result = await postToWordPress< CreatePostResult >( '/community-post', args );
	return result.ok && result.body ? result.body : null;
}

export interface CreateReplyResult {
	success: true;
	commentId: number;
	status: 'publish' | 'pending';
}

export async function createWordPressReply( args: {
	postId: number;
	userId: string;
	displayName: string;
	role: string;
	body: string;
	status: 'publish' | 'pending';
} ): Promise< CreateReplyResult | null > {
	const result = await postToWordPress< CreateReplyResult >( '/community-reply', args );
	return result.ok && result.body ? result.body : null;
}

/** The report-button backend (Task D) — a plain boolean, nothing to parse from the response body. */
export async function createWordPressReport( targetType: 'post' | 'comment', targetId: number ): Promise< boolean > {
	const result = await postToWordPress< { success: true } >( '/community-report', { targetType, targetId } );
	return result.ok && !! result.body;
}

/**
 * Plain text only — no HTML, ever (PHASE-8-BUILD-PLAN.md: "strip on write
 * AND escape on render — both, not either"). This regex strip is a FIRST,
 * defense-in-depth layer, not the actual XSS boundary: WordPress's own
 * sanitize_text_field()/sanitize_textarea_field() strip again on arrival
 * (community-rest-routes.php), and the render template (Task D) escapes
 * with esc_html() regardless of what survives either strip — THAT escape is
 * the real backstop, which is why a simple regex is enough here rather than
 * a full HTML parser.
 */
function stripTags( raw: string ): string {
	return raw.replace( /<[^>]*>/g, ' ' );
}

/** Single-line: collapses ALL whitespace runs (including newlines) to one space. */
export function sanitizePostTitle( raw: unknown ): string | null {
	if ( typeof raw !== 'string' ) {
		return null;
	}
	const clean = stripTags( raw ).replace( /\s+/g, ' ' ).trim().slice( 0, MAX_TITLE_LENGTH );
	return clean.length > 0 ? clean : null;
}

/**
 * Multi-line: a post/reply body is more than one line, so only horizontal
 * whitespace is collapsed — newlines survive, unlike sanitizePostTitle()'s
 * single-line collapse.
 */
function sanitizeMultilineText( raw: unknown, maxLength: number ): string | null {
	if ( typeof raw !== 'string' ) {
		return null;
	}
	const clean = stripTags( raw )
		.split( '\n' )
		.map( ( line ) => line.replace( /[ \t]+/g, ' ' ).trim() )
		.join( '\n' )
		.trim()
		.slice( 0, maxLength );
	return clean.length > 0 ? clean : null;
}

export function sanitizePostBody( raw: unknown ): string | null {
	return sanitizeMultilineText( raw, MAX_POST_BODY_LENGTH );
}

export function sanitizeReplyBody( raw: unknown ): string | null {
	return sanitizeMultilineText( raw, MAX_REPLY_BODY_LENGTH );
}
