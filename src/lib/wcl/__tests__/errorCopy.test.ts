// The one failure `keys.test.ts` cannot see: a message that reaches a reader as its own key path.
//
// `keys.test.ts` proves every key these modules ask for exists in `ui.json`, and its orphan hunt
// proves nothing in `ui.json` is unread. Neither says anything about *initialisation*. i18next hands
// back the key when it has no resources — it does not throw — so a transport that reached for its copy
// before `initI18n()` had run would put `errors.wcl.missing.report` in front of the person who pasted
// the token, with the whole rest of the suite green. That is the same defect `signInPanel.test.ts`
// refuses for `auth.*`, asked of the half of the copy that is thrown rather than rendered.
//
// **This file imports `../client` and nothing from `~/lib/i18n`, and it never calls `initI18n()`.**
// Both are load-bearing. The client reaches its copy through the `~/lib/i18n` barrel, whose module
// side effect is the initialisation; narrowing that import to `~/lib/i18n/config`, which only defines
// the instance, reds every assertion below. Initialising here would green them for a reason the app
// does not have.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { WclClient } from '../client';
import { WCL_HOST } from '../endpoint';

/** A JWT with a readable payload, which is what decides the endpoint a token is tried on first. */
function jwt(payload: Record<string, unknown>): string {
	const segment = (value: object): string =>
		btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	return `${segment({ typ: 'JWT', alg: 'RS256' })}.${segment(payload)}.signature-we-never-check`;
}

/** Reads private reports, so `/user`, so a missing report is simply missing. */
const USER_TOKEN = jwt({ sub: '12345', scopes: ['view-user-profile', 'view-private-reports'] });
/** No account behind it, so `/client`, which is the endpoint that adds the public-only sentence. */
const CLIENT_TOKEN = jwt({ sub: '9' });

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

/**
 * The message of the `WclError` a call raises, with the transport answering however the test says.
 *
 * The message rather than the error, because the message is the whole subject here: `client.test.ts`
 * already pins the `kind` and the status of every one of these, and repeating that would be a second
 * copy of an assertion rather than a new one.
 */
async function messageFrom(token: string, answer: () => Response, call: (client: WclClient) => Promise<unknown>) {
	vi.stubGlobal('fetch', async () => answer());
	try {
		await call(new WclClient({ token }));
	} catch (error) {
		return (error as Error).message;
	}
	throw new Error('the call resolved, so there is no message to read');
}

/** The shorthand every case below is written against: one report fetch, answered one way. */
const onReport = (answer: () => Response, token = USER_TOKEN) =>
	messageFrom(token, answer, (client) => client.fetchReport('abc123'));

/** Every message this file collects, so the two whole-corpus assertions at the foot can read them. */
const seen: string[] = [];
const said = async (message: Promise<string> | string): Promise<string> => {
	const text = await message;
	seen.push(text);
	return text;
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('every WclError message arrives as English, not as its key', () => {
	it('refuses an empty token before asking WarcraftLogs about it', () => {
		let message = '';
		try {
			new WclClient({ token: '   ' });
		} catch (error) {
			message = (error as Error).message;
		}
		seen.push(message);
		expect(message).toBe('No WarcraftLogs API token was given.');
	});

	it('says which of the two refusals a rejected token got, and carries the reason when there is one', async () => {
		expect(await said(onReport(() => json({}, 401)))).toContain('WarcraftLogs rejected the token (401)');
		expect(await said(onReport(() => json({}, 403)))).toContain('a client-credentials token reads public logs only');
		// WarcraftLogs also answers 200 with an `errors` array for an expired token, and that arm is the
		// one that interpolates: the reason it gave has to survive into the sentence.
		expect(await said(onReport(() => json({ errors: [{ message: 'Unauthenticated.' }] })))).toContain(
			'WarcraftLogs rejected the token: Unauthenticated.',
		);
	});

	it('names the budget when the request was rate-limited', async () => {
		expect(await said(onReport(() => json({}, 429)))).toContain('hourly point budget is spent');
	});

	it('separates a request that timed out from one that never left the machine', async () => {
		// The two arms of a single `catch`, which is why they are two keys. One string covering both is
		// how the timeout sentence ends up describing a content blocker.
		vi.useFakeTimers();
		vi.stubGlobal(
			'fetch',
			(_url: string, init: { signal: AbortSignal }) =>
				new Promise<Response>((_, reject) => {
					init.signal.addEventListener('abort', () => reject(new Error('aborted')));
				}),
		);
		const timedOut = new WclClient({ token: USER_TOKEN }).fetchReport('abc123').then(
			() => 'the call resolved, so there is no message to read',
			(error: Error) => error.message,
		);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(await said(timedOut)).toBe(
			'WarcraftLogs did not answer within 60 seconds. Check your connection and try again.',
		);
		vi.useRealTimers();

		vi.stubGlobal('fetch', () => Promise.reject(new Error('getaddrinfo ENOTFOUND')));
		let unreachable = '';
		await new WclClient({ token: USER_TOKEN }).fetchReport('abc123').catch((error: Error) => {
			unreachable = error.message;
		});
		seen.push(unreachable);
		expect(unreachable).toContain('whether a content blocker is stopping the request');
	});

	it('reads the status back off a failure of WarcraftLogs own, and does not reassure anyone about it', async () => {
		const message = await said(onReport(() => json({}, 503)));
		expect(message).toBe('WarcraftLogs returned HTTP 503. Try again shortly.');
		// The clause this phase deleted. It answered a worry the reader had not raised, in a register
		// nothing else in the report speaks.
		expect(message).not.toContain('Nothing is wrong on your side');

		expect(await said(onReport(() => new Response('<html>maintenance</html>', { status: 200 })))).toBe(
			'WarcraftLogs returned a response that was not JSON.',
		);
	});

	it('passes on the query rejection it was given, and says so plainly when it was given none', async () => {
		expect(await said(onReport(() => json({ errors: [{ message: 'Cannot query field "foo"' }] })))).toBe(
			'WarcraftLogs rejected the query: Cannot query field "foo".',
		);
		expect(await said(onReport(() => json({ errors: [{}] })))).toBe(
			'WarcraftLogs rejected the query: no reason given.',
		);
		expect(await said(onReport(() => json({})))).toBe('WarcraftLogs returned an empty response.');
	});

	it('names the report, the fight and the host in everything it could not find', async () => {
		expect(
			await said(
				messageFrom(
					USER_TOKEN,
					() => json({ data: {} }),
					(client) => client.fetchRateLimit(),
				),
			),
		).toContain('hourly point budget for this token');

		const missing = await said(onReport(() => json({ data: { reportData: { report: null } } })));
		expect(missing).toContain('No report "abc123" on ');
		expect(missing).toContain(WCL_HOST);
		// The public-only sentence is the endpoint's, not the report's, and on `/user` it is wrong: a
		// signed-in token can read private logs, so "the log may not be public" would send the reader to
		// change a setting that was never the problem.
		expect(missing).not.toContain('may not be public');

		const publicOnly = await said(onReport(() => json({ data: { reportData: { report: null } } }), CLIENT_TOKEN));
		expect(publicOnly).toContain('No report "abc123" on ');
		expect(publicOnly).toContain('If the code is right, the log may not be public.');

		expect(
			await said(
				messageFrom(
					USER_TOKEN,
					() => json({ data: { reportData: { report: { masterData: { actors: null } } } } }),
					(client) => client.fetchActors('abc123'),
				),
			),
		).toBe('Report "abc123" has no actor list, so nothing in it can be named.');

		expect(
			await said(
				messageFrom(
					USER_TOKEN,
					() => json({ data: { reportData: { report: { playerDetails: null } } } }),
					(client) => client.fetchPlayerDetails('abc123', 7),
				),
			),
		).toBe(
			'WarcraftLogs returned no player list for fight 7 of report "abc123", so nothing in it can be matched to a spec.',
		);

		expect(
			await said(
				messageFrom(
					USER_TOKEN,
					() => json({ data: { reportData: { report: { events: null } } } }),
					(client) => client.fetchEventPage({ code: 'abc123', fightID: 7, sourceID: 3, startTime: 0, endTime: 1 }),
				),
			),
		).toContain('Report "abc123" returned no event stream for fight 7.');
	});

	it('emitted no key path and no unfilled placeholder in any of them', () => {
		// The whole point of the file, asserted once over everything it collected rather than at each
		// case. A raw key is what a reader sees when i18next has no resources; a surviving `{{code}}` is
		// what they see when the call site spells an interpolation differently from the string.
		expect(seen.length).toBeGreaterThan(15);
		expect(seen.filter((message) => /\berrors\.[a-zA-Z]/.test(message))).toEqual([]);
		expect(seen.filter((message) => message.includes('{{'))).toEqual([]);
	});
});

/**
 * The rest of the leaves, including the sign-in flow's, which needs a `window` this suite has not got.
 *
 * `src/lib/auth/callback.ts` reads the address bar and `exchange.ts` reads `localStorage`, so neither
 * can be driven under `environment: 'node'` the way the client above can. Their keys are read out of
 * their own source instead and resolved against the instance the *client* initialised — which is the
 * claim that matters, because every one of these modules reaches for the same one.
 *
 * **The readers are discovered, not listed.** This was `['wcl/client.ts', 'auth/callback.ts',
 * 'auth/exchange.ts']`, and it stopped being the whole set the moment `auth/config.ts` moved its own
 * message into the locale — a file asking for a key that nothing checked resolves. A three-name list
 * cannot grow, and a check that cannot grow cannot fail; the same shape this repository has now been
 * bitten by in a dozen fixture grids. So the sweep walks `src/lib` for anything that calls
 * `t('errors.…')` and the count is pinned, which is what makes a fifth reader arrive loudly.
 *
 * The import is dynamic and inside the test on purpose: it has to happen after `../client`, and an
 * import sorter has no way to know that.
 */
describe('every key the transport and the sign-in flow ask for resolves', () => {
	const LIB = resolve(import.meta.dirname, '../..');
	const KEY = /\bt\('(errors\.[\w.]+)'/g;

	/** Every `.ts` under `src/lib` that asks the locale for an error string, found rather than named. */
	const readers = (): string[] => {
		const out: string[] = [];
		const walk = (dir: string): void => {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				const full = join(dir, entry.name);
				if (entry.isDirectory()) {
					if (entry.name !== '__tests__') walk(full);
				} else if (entry.name.endsWith('.ts') && KEY.test(readFileSync(full, 'utf8'))) {
					out.push(relative(LIB, full));
				}
				KEY.lastIndex = 0;
			}
		};
		walk(LIB);
		return out.sort();
	};

	it('resolves all of them, and finds every file that asks', async () => {
		const { default: i18n } = await import('~/lib/i18n/config');
		const found = readers();

		// Pinned so a new reader has to be seen here rather than joining a sweep nobody re-reads.
		expect(found).toEqual(['auth/callback.ts', 'auth/config.ts', 'auth/exchange.ts', 'wcl/client.ts']);

		for (const reader of found) {
			const source = readFileSync(join(LIB, reader), 'utf8');
			const keys = [...source.matchAll(KEY)].map((match) => match[1]!);
			expect(keys.length, `no keys read out of ${reader}`).toBeGreaterThan(0);

			const unresolved = keys.filter((key) => i18n.t(key, { ns: 'ui' }) === key);
			expect(unresolved, `${reader} asks for copy that does not resolve:\n${unresolved.join('\n')}`).toEqual([]);
		}
	});
});
