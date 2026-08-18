import { beforeEach, describe, expect, it } from 'vitest';

import { rememberAuthorization, takeAuthorization } from '../storage';

/**
 * A shared link has to survive the sign-in.
 *
 * `redirect_uri` is matched byte for byte by WarcraftLogs — `config.redirectUri` explains at length
 * why a mismatch is worth avoiding — so the report, fight and player a visitor arrived with cannot
 * travel in the URL. They go where the verifier goes: into session storage, before the tab navigates
 * to the consent screen and there is no JavaScript left to remember anything.
 */
describe('the selection carried across a sign-in', () => {
	// A local stub rather than jsdom: `vitest.config` picks the node environment on purpose, so that a
	// stray `window` reference fails here instead of passing quietly and breaking in a browser. Only
	// the four methods `storage.ts` touches are provided, so anything else it grew would fail loudly.
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

	it('comes back with the verifier', () => {
		rememberAuthorization({ verifier: 'v', state: 's', search: '?report=abc&fight=30&player=Someone' });
		expect(takeAuthorization()).toEqual({
			verifier: 'v',
			state: 's',
			search: '?report=abc&fight=30&player=Someone',
		});
	});

	it('is absent rather than empty when there was nothing to carry', () => {
		rememberAuthorization({ verifier: 'v', state: 's', search: '' });
		expect(takeAuthorization()).toEqual({ verifier: 'v', state: 's' });
	});

	it('is consumed with the verifier, so a second callback cannot replay it', () => {
		rememberAuthorization({ verifier: 'v', state: 's', search: '?report=abc' });
		takeAuthorization();
		expect(takeAuthorization()).toBeNull();
		expect(sessionStorage.getItem('wcl.pkce.return')).toBeNull();
	});

	it('does not resurrect a sign-in whose verifier is gone', () => {
		rememberAuthorization({ verifier: 'v', state: 's', search: '?report=abc' });
		sessionStorage.removeItem('wcl.pkce.verifier');
		expect(takeAuthorization()).toBeNull();
	});
});
