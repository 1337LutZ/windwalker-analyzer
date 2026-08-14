// What an access token says about itself.
//
// A WarcraftLogs token is a JWT, and its middle segment is a base64url-encoded JSON payload that any
// holder can read. It is read here for exactly two reasons: to guess which of the two API paths the
// token will work on, and to say "this expired at 14:02" instead of letting the first query come
// back as a bare 401.
//
// **Nothing here is a security control.** The signature is never checked and never could be — there
// is no key in a static site to check it with. The API is the only authority on whether a token is
// good, so every answer below is a courtesy that the caller must be able to be wrong about: an
// undecodable payload routes to `/user` and lets a real error come back rather than refusing on our
// own guess, and `WclClient` retries on the other path when the guess turns out wrong.

/**
 * Which family of token this is, and therefore which API path it can use.
 *
 * `unknown` is not a failure — it is a payload we could not read, which is routed like a user token
 * because that is the path that reaches more data.
 */
export type TokenKind = 'user' | 'client' | 'unknown';

/**
 * Either scope is proof of an account behind the token, and so of `/api/v2/user`.
 *
 * Verified against a real user token, whose payload carries
 * `scopes: ["view-user-profile", "view-private-reports"]`. A client-credentials token has neither.
 */
const USER_SCOPES = ['view-user-profile', 'view-private-reports'];

export interface TokenInspection {
	kind: TokenKind;
	/** The `scopes` claim, or null when the payload would not decode. Never null for a decoded one. */
	scopes: string[] | null;
	/** `exp` as a date, or null when the payload would not decode or carried no `exp`. */
	expiresAt: Date | null;
	/** True only for a decoded `exp` that is in the past. An unreadable token is never called expired. */
	expired: boolean;
}

/**
 * People paste the whole `Bearer eyJ0…` line out of the docs about as often as they paste the token,
 * and a trailing newline comes with any copy from a terminal.
 */
export function cleanToken(raw: string): string {
	return raw.trim().replace(/^Bearer\s+/i, '');
}

/**
 * The JWT's payload, or null if there is not one to be had.
 *
 * Null covers every way this can fail — no dots, an empty segment, invalid base64, JSON that is not
 * an object — because the caller does the same thing for all of them: carry on without it.
 */
export function decodeTokenPayload(token: string): Record<string, unknown> | null {
	const segment = cleanToken(token).split('.')[1];
	if (segment === undefined || segment === '') return null;

	try {
		// base64url → base64: the two swapped characters back, and the padding a JWT drops restored,
		// because `atob` counts in whole four-character groups.
		const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
		const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
		const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
		const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/** Everything the payload will admit to, with `now` injectable so expiry is testable. */
export function inspectToken(token: string, now: number = Date.now()): TokenInspection {
	const payload = decodeTokenPayload(token);
	if (payload === null)
		return {
			kind: 'unknown',
			scopes: null,
			expiresAt: null,
			expired: false,
		};

	const claimed = payload['scopes'];
	const scopes = Array.isArray(claimed) ? claimed.filter((scope): scope is string => typeof scope === 'string') : [];
	const exp = payload['exp'];
	// `exp` is seconds since the epoch, as every JWT's is, not the milliseconds Date takes.
	const expiresAt = typeof exp === 'number' && Number.isFinite(exp) ? new Date(exp * 1000) : null;

	return {
		// A readable payload without either user scope is a client-credentials token, which is not an
		// error: it reads public logs perfectly well, just nothing private.
		kind: scopes.some((scope) => USER_SCOPES.includes(scope)) ? 'user' : 'client',
		scopes,
		expiresAt,
		expired: expiresAt !== null && expiresAt.getTime() <= now,
	};
}
