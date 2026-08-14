import { afterEach, describe, expect, it, vi } from 'vitest';

import { looksLikeClientID, requireClientID } from '../config';
import { forgetClientID, readClientID, rememberClientID } from '../storage';

/**
 * A node test environment has no `localStorage`, which is deliberate — nothing in `lib/` may assume
 * a browser. The four functions under test are the exception by definition, so the API they use gets
 * stubbed rather than the whole environment swapped for a DOM.
 */
function stubStorage(): Map<string, string> {
	const store = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, value),
		removeItem: (key: string) => void store.delete(key),
	});
	return store;
}

afterEach(() => vi.unstubAllGlobals());

describe('looksLikeClientID', () => {
	it('accepts the UUID WarcraftLogs issues', () => {
		expect(looksLikeClientID('01234567-89ab-7cde-8f01-23456789abcd')).toBe(true);
	});

	it('accepts it with surrounding whitespace, which is what a paste carries', () => {
		expect(looksLikeClientID('  01234567-89ab-7cde-8f01-23456789abcd\n')).toBe(true);
	});

	it('accepts uppercase, which is the same id', () => {
		expect(looksLikeClientID('01234567-89AB-7CDE-8F01-23456789ABCD')).toBe(true);
	});

	/**
	 * The mistake the check exists for. The registration page shows the id and the secret together,
	 * and a secret saved here would be a credential this app must never hold.
	 */
	it('refuses a client secret, which is long and has no dashes', () => {
		expect(looksLikeClientID('mR8kZq2vTn6yXw4bLc9dFj1sHg5pAe3uQi7oNzYtVrKmBx0')).toBe(false);
	});

	it('refuses empty, partial and malformed ids', () => {
		expect(looksLikeClientID('')).toBe(false);
		expect(looksLikeClientID('01234567')).toBe(false);
		expect(looksLikeClientID('01234567-89ab-7cde-8f01')).toBe(false);
		expect(looksLikeClientID('01234567-89ab-7cde-8f01-23456789abcd-extra')).toBe(false);
		expect(looksLikeClientID('zzzzzzzz-c814-70f9-a50e-6ed2c5f4b9ec')).toBe(false);
	});
});

describe('client id storage', () => {
	it('round-trips an id', () => {
		stubStorage();
		expect(readClientID()).toBeNull();
		rememberClientID('01234567-89ab-7cde-8f01-23456789abcd');
		expect(readClientID()).toBe('01234567-89ab-7cde-8f01-23456789abcd');
	});

	it('trims on the way in and on the way out', () => {
		const store = stubStorage();
		rememberClientID('  01234567-89ab-7cde-8f01-23456789abcd  ');
		expect(store.get('wcl.clientId')).toBe('01234567-89ab-7cde-8f01-23456789abcd');
		store.set('wcl.clientId', '  01234567-89ab-7cde-8f01-23456789abcd  ');
		expect(readClientID()).toBe('01234567-89ab-7cde-8f01-23456789abcd');
	});

	/** A blank entry is not a configured client — it must not light up the sign-in button. */
	it('reads a whitespace-only entry as no id at all', () => {
		const store = stubStorage();
		store.set('wcl.clientId', '   ');
		expect(readClientID()).toBeNull();
	});

	it('forgets it', () => {
		stubStorage();
		rememberClientID('01234567-89ab-7cde-8f01-23456789abcd');
		forgetClientID();
		expect(readClientID()).toBeNull();
	});

	/**
	 * The id is configuration, not the session, so it has to survive signing out. `clear()` is not
	 * called here — this asserts it does not reach the client id, which is the point of the split
	 * between `localStorage` and `sessionStorage`.
	 */
	it('lives under its own key, which sign-out does not touch', () => {
		const store = stubStorage();
		rememberClientID('01234567-89ab-7cde-8f01-23456789abcd');
		expect([...store.keys()]).toEqual(['wcl.clientId']);
	});
});

describe('requireClientID', () => {
	it('returns the stored id', () => {
		stubStorage();
		rememberClientID('01234567-89ab-7cde-8f01-23456789abcd');
		expect(requireClientID()).toBe('01234567-89ab-7cde-8f01-23456789abcd');
	});

	it('throws with somewhere to go when none is set', () => {
		stubStorage();
		expect(() => requireClientID()).toThrow(/warcraftlogs\.com\/api\/clients/);
	});
});
