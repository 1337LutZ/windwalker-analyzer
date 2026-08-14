import { describe, expect, it } from 'vitest';

import { WCL_CLIENT_ENDPOINT, WCL_USER_ENDPOINT, endpointFor, otherEndpoint } from '~/lib/wcl/endpoint';

import { cleanToken, decodeTokenPayload, inspectToken } from '../token';

const NOW = Date.parse('2026-08-13T20:00:00Z');
const HOUR = 3_600_000;

/** A JWT as WarcraftLogs issues one: three base64url segments, the middle one the JSON payload. */
function jwt(payload: Record<string, unknown>): string {
	const segment = (value: object): string =>
		btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	return `${segment({ typ: 'JWT', alg: 'RS256' })}.${segment(payload)}.signature-we-never-check`;
}

/** The payload shape verified against a real user token, minus the claims nothing here reads. */
const userToken = (over: Record<string, unknown> = {}): string =>
	jwt({
		aud: '01234567-89ab-7cde-8f01-23456789abcd',
		exp: (NOW + HOUR) / 1000,
		sub: '12345',
		scopes: ['view-user-profile', 'view-private-reports'],
		...over,
	});

/** Client credentials: same envelope, and the tell is that the scopes are simply not there. */
const clientToken = (over: Record<string, unknown> = {}): string =>
	jwt({
		aud: '01234567-89ab-7cde-8f01-23456789abcd',
		exp: (NOW + HOUR) / 1000,
		sub: '9',
		...over,
	});

describe('decodeTokenPayload', () => {
	it('reads the middle segment of a real-shaped token', () => {
		expect(decodeTokenPayload(userToken())).toMatchObject({
			sub: '12345',
			scopes: ['view-user-profile', 'view-private-reports'],
		});
	});

	it('decodes base64url, not base64 — the two swapped characters and the dropped padding', () => {
		// This payload encodes to a segment carrying both `-` and `_` (base64's `+` and `/`) and two
		// characters of padding that a JWT drops, which is every way the two alphabets differ.
		const payload = { a: '???~~~??' };
		expect(decodeTokenPayload(jwt(payload))).toEqual(payload);
	});

	it('returns null for anything that is not a decodable payload, rather than throwing', () => {
		for (const garbage of [
			'',
			'not-a-jwt',
			'a.b',
			'a..c',
			'a.!!!!.c',
			'a.eyJub3RKc29u.c',
			`a.${btoa('"a string"')}.c`,
			`a.${btoa('[1,2]')}.c`,
		]) {
			expect(decodeTokenPayload(garbage)).toBeNull();
		}
	});

	it('reads a token pasted with its Bearer prefix and surrounding whitespace', () => {
		expect(cleanToken(`  Bearer ${userToken()}\n`)).toBe(userToken());
		expect(decodeTokenPayload(`Bearer ${userToken()}`)).toMatchObject({
			sub: '12345',
		});
	});
});

describe('inspectToken', () => {
	it('calls a token with either user scope a user token', () => {
		expect(inspectToken(userToken(), NOW).kind).toBe('user');
		expect(inspectToken(userToken({ scopes: ['view-user-profile'] }), NOW).kind).toBe('user');
		expect(inspectToken(userToken({ scopes: ['view-private-reports'] }), NOW).kind).toBe('user');
	});

	it('calls a token without them a client-credentials token, absent or empty alike', () => {
		expect(inspectToken(clientToken(), NOW).kind).toBe('client');
		expect(inspectToken(clientToken({ scopes: [] }), NOW).kind).toBe('client');
		expect(inspectToken(clientToken({ scopes: ['view-something-else'] }), NOW).kind).toBe('client');
	});

	it('reports an expiry that has passed, and when', () => {
		const inspection = inspectToken(userToken({ exp: (NOW - 2 * HOUR) / 1000 }), NOW);
		expect(inspection.expired).toBe(true);
		expect(inspection.expiresAt?.getTime()).toBe(NOW - 2 * HOUR);
		// Still a user token: expiry is a separate fact from which endpoint it was minted for.
		expect(inspection.kind).toBe('user');
	});

	it('does not call a live or an undated token expired', () => {
		expect(inspectToken(userToken(), NOW).expired).toBe(false);
		expect(inspectToken(userToken({ exp: undefined }), NOW).expiresAt).toBeNull();
		expect(inspectToken(userToken({ exp: 'soon' }), NOW).expired).toBe(false);
	});

	it('says only "unknown" about a payload it cannot read — never that it expired', () => {
		const inspection = inspectToken('garbage.not-base64!!.stuff', NOW);
		expect(inspection).toEqual({
			kind: 'unknown',
			scopes: null,
			expiresAt: null,
			expired: false,
		});
	});
});

describe('routing', () => {
	it('sends a user token to /user and a client-credentials token to /client', () => {
		expect(endpointFor(inspectToken(userToken(), NOW).kind)).toBe(WCL_USER_ENDPOINT);
		expect(endpointFor(inspectToken(clientToken(), NOW).kind)).toBe(WCL_CLIENT_ENDPOINT);
	});

	it('sends an expired token wherever its kind says, so the failure is about expiry and not the path', () => {
		expect(endpointFor(inspectToken(userToken({ exp: (NOW - HOUR) / 1000 }), NOW).kind)).toBe(WCL_USER_ENDPOINT);
		expect(endpointFor(inspectToken(clientToken({ exp: (NOW - HOUR) / 1000 }), NOW).kind)).toBe(
			WCL_CLIENT_ENDPOINT,
		);
	});

	it('sends an undecodable token to /user rather than refusing it', () => {
		expect(endpointFor(inspectToken('this is not a token at all', NOW).kind)).toBe(WCL_USER_ENDPOINT);
	});

	it('pairs the two endpoints, so the retry is always the one not just tried', () => {
		expect(otherEndpoint(WCL_USER_ENDPOINT)).toBe(WCL_CLIENT_ENDPOINT);
		expect(otherEndpoint(WCL_CLIENT_ENDPOINT)).toBe(WCL_USER_ENDPOINT);
	});

	it('keeps both paths on the one host the CSP allows', () => {
		expect(WCL_USER_ENDPOINT).toBe('https://classic.warcraftlogs.com/api/v2/user');
		expect(WCL_CLIENT_ENDPOINT).toBe('https://classic.warcraftlogs.com/api/v2/client');
	});
});
