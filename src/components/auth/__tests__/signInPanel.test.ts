// The sign-in step's three renderings, asserted for the first time.
//
// `src/components/auth/` had no tests at all when its 561 words of copy moved into `ui.json`, which
// made that move the one change in the tone-of-voice migration with nothing behind it: no assertion
// to update, and none to notice a key that stopped resolving. A missing key does not throw — i18next
// hands back the key path — so `auth.public.title` rendering as the literal text `auth.public.title`
// is a defect the whole rest of the suite would sit through.
//
// `keys.test.ts` proves every key this file asks for exists. What it cannot prove is that the branch
// asking for it is reachable, or that the pair of keys around a `<strong>` still form one sentence.
// That is what these three renders are for.
//
// `.ts` and not `.tsx`, following `specs/elemental/__fixtures__/previewRoute.test.ts`: the suite runs
// under `environment: 'node'` with no jsdom, so components are rendered to an HTML string through
// `createElement` rather than JSX.

import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import SignInPanel from '~/components/auth/SignInPanel';
import { SessionContext, type Session } from '~/lib/auth';
import { initI18n } from '~/lib/i18n/config';

initI18n();

/** A signed-out session with nothing wrong, which every case below varies from. */
const BASE: Session = {
	token: null,
	source: null,
	status: 'signed-out',
	error: null,
	errorIsExpiry: false,
	clientID: null,
	saveClientID: () => {},
	forgetClientID: () => {},
	signIn: () => {},
	signInWithToken: () => {},
	signOut: () => {},
};

/**
 * A client-credentials token, which is what `publicOnly` is read off.
 *
 * Built here rather than imported: `inspectToken` reads the payload, and a token with no `sub` is
 * what tells it the token carries no account. Nothing in it is a credential — the signature is the
 * literal word.
 */
const b64 = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const PUBLIC_TOKEN = `${b64({ alg: 'RS256' })}.${b64({ exp: 4_102_444_800 })}.signature`;

const html = (session: Partial<Session>): string =>
	renderToStaticMarkup(
		createElement(
			QueryClientProvider,
			{ client: new QueryClient() },
			createElement(SessionContext, { value: { ...BASE, ...session } }, createElement(SignInPanel) as ReactNode),
		),
	);

describe('the sign-in panel says the same things it did before its copy moved', () => {
	it('asks a signed-out reader to sign in, and offers the pasted-token road', () => {
		const markup = html({});
		expect(markup).toContain('Sign in with your WarcraftLogs account');
		expect(markup).toContain('Sign in with WarcraftLogs');
		expect(markup).toContain('First, register your own API client');
		expect(markup).toContain('Advanced: use your own access token');
		expect(markup).toContain('What happens when you sign in?');
	});

	it('heads an expiry and a refused attempt differently, from one pair of keys', () => {
		expect(html({ error: 'gone', errorIsExpiry: true })).toContain('Your session had expired');
		expect(html({ error: 'gone', errorIsExpiry: false })).toContain('That sign-in did not finish');
		// The same pair, read from the signed-in branch as well — the duplication this phase collapsed.
		const signedIn = { token: PUBLIC_TOKEN, source: 'manual' as const, status: 'signed-in' as const };
		expect(html({ ...signedIn, error: 'gone', errorIsExpiry: true })).toContain('Your session had expired');
	});

	it('warns a public-only token, with the emphasis still inside the sentence', () => {
		const markup = html({ token: PUBLIC_TOKEN, source: 'manual', status: 'signed-in' });
		expect(markup).toContain('Using your token');
		expect(markup).toContain('This token reads public logs only');
		// The two keys either side of the `<strong>`, read back as one sentence. A split that loses its
		// spacing or its punctuation passes every key check and reads as two fragments on the page.
		expect(markup).toContain(
			'It comes back as <strong class="font-semibold text-ink">not found</strong>, exactly as a mistyped code does.',
		);
	});

	it('renders no raw key path in any of the three', () => {
		for (const session of [{}, { error: 'gone' }, { token: PUBLIC_TOKEN, status: 'signed-in' as const }]) {
			expect(html(session)).not.toMatch(/\bauth\.[a-z]+\.[a-zA-Z]+\b/);
		}
	});
});
