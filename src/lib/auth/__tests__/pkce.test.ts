import { describe, expect, it } from 'vitest';

import { challengeFor, createState, createVerifier } from '../pkce';

const RFC_ALPHABET = /^[A-Za-z0-9\-._~]+$/;

describe('createVerifier', () => {
	it('stays inside the length and alphabet RFC 7636 allows', () => {
		const verifier = createVerifier();
		expect(verifier.length).toBeGreaterThanOrEqual(43);
		expect(verifier.length).toBeLessThanOrEqual(128);
		expect(verifier).toMatch(RFC_ALPHABET);
	});

	it('does not repeat itself', () => {
		expect(new Set(Array.from({ length: 50 }, createVerifier)).size).toBe(50);
	});

	// The rejection sampling that keeps the alphabet uniform is the one place this could silently
	// return a short string, so the length is checked at a size that forces several redraws.
	it('fills the whole length even though bytes are discarded', () => {
		for (let i = 0; i < 20; i++) expect(createVerifier()).toHaveLength(64);
	});
});

describe('createState', () => {
	it('is random and inside the same alphabet', () => {
		expect(createState()).toMatch(RFC_ALPHABET);
		expect(createState()).not.toBe(createState());
	});
});

describe('challengeFor', () => {
	// RFC 7636 appendix B, so this proves the base64url transform as well as the digest: a wrong
	// padding or a missed `+`/`/` swap changes the answer.
	it('matches the RFC 7636 test vector', async () => {
		expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
			'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
		);
	});

	it('emits base64url only — no padding, no + or /', () => {
		return expect(challengeFor(createVerifier())).resolves.toMatch(/^[A-Za-z0-9\-_]{43}$/);
	});
});
