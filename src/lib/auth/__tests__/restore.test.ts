// Staying signed in across a refresh, and refusing to pretend to be when the token is dead.
//
// The reported bug was "I have to press sign in again every time I refresh". Half of it was not a
// persistence bug at all — `sessionStorage` survives a reload and the token was still there — and the
// other half was this: an *expired* token was restored and announced as a live session, so the reader
// was told they were signed in and then bounced by the first query. These pin both halves, because
// only one of them is obvious from reading the code.
//
// A local storage stub rather than jsdom, as `returnTo.test.ts` and `stripCallbackParams.test.ts` do:
// `vitest.config` picks the node environment on purpose, so a stray `window` reference fails here
// instead of passing quietly and breaking in a browser.

import { beforeEach, describe, expect, it } from 'vitest';

import { restoreSession } from '../restore';
import {
	clear,
	clearSilentRetry,
	forgetToken,
	markSilentRetry,
	rememberAuthorization,
	rememberToken,
	silentRetryUsed,
	takeAuthorization,
} from '../storage';

const NOW = Date.parse('2026-08-20T12:00:00Z');
const HOUR = 3_600_000;

/** A JWT as WarcraftLogs issues one. The signature is never checked, so it need not be one. */
function jwt(payload: Record<string, unknown>): string {
	const segment = (value: object): string =>
		btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	return `${segment({ typ: 'JWT', alg: 'RS256' })}.${segment(payload)}.signature-we-never-check`;
}

/** Expiring `hours` from `NOW` — negative for a token that is already past it. */
const tokenExpiring = (hours: number): string =>
	jwt({
		aud: '01234567-89ab-7cde-8f01-23456789abcd',
		sub: '12345',
		scopes: ['view-user-profile', 'view-private-reports'],
		exp: (NOW + hours * HOUR) / 1000,
	});

beforeEach(() => {
	const values = new Map<string, string>();
	Object.defineProperty(globalThis, 'sessionStorage', {
		configurable: true,
		value: {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => void values.set(key, value),
			removeItem: (key: string) => void values.delete(key),
			clear: () => values.clear(),
		},
	});
});

describe('restoreSession', () => {
	it('brings a live session back, which is what a refresh is', () => {
		// The whole of the fix for "I have to sign in again every time": what `rememberToken` wrote
		// before the reload is what a mount after it gets back.
		const live = tokenExpiring(1);
		rememberToken({ token: live, source: 'oauth' });

		expect(restoreSession(NOW)).toEqual({
			session: { token: live, source: 'oauth' },
			reason: null,
			expiredSource: null,
		});
	});

	it('brings a pasted token back as a pasted token, so the page still says which it is', () => {
		const live = tokenExpiring(1);
		rememberToken({ token: live, source: 'manual' });

		expect(restoreSession(NOW).session).toEqual({ token: live, source: 'manual' });
	});

	it('has nothing to restore on a first visit, and does not call that an expiry', () => {
		expect(restoreSession(NOW)).toEqual({ session: null, reason: 'none', expiredSource: null });
	});

	it('refuses a token that is past its own exp instead of announcing a session', () => {
		// The bug this file exists for. Before the fix the stored token came straight back and the page
		// said "Signed in"; the reader found out otherwise from a 401 on their first query.
		rememberToken({ token: tokenExpiring(-2), source: 'oauth' });

		expect(restoreSession(NOW)).toEqual({ session: null, reason: 'expired', expiredSource: 'oauth' });
	});

	it('says a pasted token was the thing that expired, so it is not silently replaced', () => {
		// `SessionProvider` renews an expired sign-in automatically and must never do that to a pasted
		// token — the reader chose to bring their own credential. This field is how it can tell.
		rememberToken({ token: tokenExpiring(-2), source: 'manual' });

		expect(restoreSession(NOW)).toEqual({ session: null, reason: 'expired', expiredSource: 'manual' });
	});

	it('expires on the exact second, matching the API it is guessing about', () => {
		rememberToken({ token: tokenExpiring(0), source: 'oauth' });
		expect(restoreSession(NOW).reason).toBe('expired');

		// And one millisecond earlier it is still good, so the boundary is pinned from both sides
		// rather than only from the side that happens to pass.
		expect(restoreSession(NOW - 1).reason).toBeNull();
	});

	it('keeps a token it cannot read, because unreadable is not expired', () => {
		// `token.ts` is explicit that nothing it decodes is a security control: WarcraftLogs is the only
		// authority on a token, so a payload this app cannot parse must be handed to the API and allowed
		// to fail there. Refusing it here would sign someone out over our own inability to read.
		rememberToken({ token: 'not-a-jwt-at-all', source: 'oauth' });

		expect(restoreSession(NOW)).toEqual({
			session: { token: 'not-a-jwt-at-all', source: 'oauth' },
			reason: null,
			expiredSource: null,
		});
	});

	it('keeps a token that carries no exp at all', () => {
		const undated = jwt({ sub: '12345', scopes: ['view-user-profile'] });
		rememberToken({ token: undated, source: 'oauth' });

		expect(restoreSession(NOW).session).toEqual({ token: undated, source: 'oauth' });
	});
});

describe('forgetToken', () => {
	it('drops the token and leaves a sign-in in flight standing', () => {
		// The distinction from `clear()`, and the reason both exist. A token found dead is dropped while
		// a sign-in may be the very next thing to happen — and that sign-in's verifier has to survive,
		// or the callback it is about to receive cannot be validated.
		rememberToken({ token: tokenExpiring(-2), source: 'oauth' });
		rememberAuthorization({ verifier: 'v', state: 's' });

		forgetToken();

		expect(restoreSession(NOW)).toEqual({ session: null, reason: 'none', expiredSource: null });
		expect(takeAuthorization()).toEqual({ verifier: 'v', state: 's' });
	});
});

describe('the one automatic re-authorize per tab', () => {
	it('is unspent until it is spent', () => {
		expect(silentRetryUsed()).toBe(false);
		markSilentRetry();
		expect(silentRetryUsed()).toBe(true);
	});

	it('is handed back by a sign-in that worked, so a later expiry is renewed as quietly', () => {
		markSilentRetry();
		clearSilentRetry();
		expect(silentRetryUsed()).toBe(false);
	});

	it('is dropped by signing out, which has to leave nothing behind', () => {
		rememberToken({ token: tokenExpiring(1), source: 'oauth' });
		markSilentRetry();

		clear();

		expect(silentRetryUsed()).toBe(false);
		expect(restoreSession(NOW).session).toBeNull();
	});
});
