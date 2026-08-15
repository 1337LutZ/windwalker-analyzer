import { afterEach, describe, expect, it, vi } from 'vitest';
import { WclClient, WclError } from '../client';
import { WCL_CLIENT_ENDPOINT, WCL_HOST, WCL_REPORT_BASE, WCL_USER_ENDPOINT } from '../endpoint';
import { fetchFightDataset, type FetchProgress } from '../fetchFight';

const TOKEN = 'eyJ0-not-a-real-token';

const FIGHT = {
	id: 1,
	name: 'Garrosh Hellscream',
	encounterID: 1623,
	kill: true,
	difficulty: 4,
	size: 10,
	startTime: 1000,
	endTime: 300000,
	friendlyPlayers: [7, null],
	enemyNPCs: [{ id: 20, gameID: 71865 }, null],
};

const ACTORS = [
	{
		id: 7,
		name: 'Bigdogmo',
		type: 'Player',
		subType: 'Monk',
		petOwner: null,
	},
	{ id: 8, name: 'Xuen', type: 'Pet', subType: 'Pet', petOwner: 7 },
	{ id: null, name: 'Nameless', type: 'NPC', subType: null, petOwner: null },
];

const TABLE = {
	data: {
		entries: [
			{
				name: 'Bigdogmo',
				id: 7,
				type: 'Monk',
				itemLevel: 553,
				total: 12345,
				activeTime: 250000,
				abilities: [{ guid: 100787, name: 'Tiger Palm', total: 500 }],
			},
		],
	},
};

interface Sent {
	url: string;
	query: string;
	variables: Record<string, unknown>;
	authorization: string | null;
}

/**
 * Answers each of the four documents by name.
 *
 * Matching on the operation name is deliberate: it is only in the request because the .graphql file
 * beside the client was loaded and sent, so a broken `?raw` import fails these tests rather than
 * silently shipping an empty query.
 */
function stubApi(pages: Array<{ data: unknown; nextPageTimestamp: number | null }>): Sent[] {
	const sent: Sent[] = [];
	let page = 0;

	vi.stubGlobal('fetch', async (url: string, init: { body: string; headers: Record<string, string> }) => {
		const body = JSON.parse(init.body) as {
			query: string;
			variables: Record<string, unknown>;
		};
		sent.push({
			url,
			query: body.query,
			variables: body.variables,
			authorization: init.headers['Authorization'] ?? null,
		});

		const answer = (data: unknown): Response =>
			new Response(JSON.stringify({ data }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});

		if (body.query.includes('query ReportFights')) {
			return answer({
				reportData: {
					report: {
						title: 'Raid night',
						startTime: 0,
						endTime: 900000,
						zone: { id: 14, name: 'Siege' },
						fights: [FIGHT, null],
					},
				},
			});
		}
		if (body.query.includes('query ReportActors')) {
			return answer({
				reportData: { report: { masterData: { actors: ACTORS } } },
			});
		}
		if (body.query.includes('query FightDamageTable')) {
			return answer({ reportData: { report: { table: TABLE } } });
		}
		if (body.query.includes('query FightEvents')) {
			return answer({
				reportData: {
					report: {
						events: pages[page++] ?? {
							data: [],
							nextPageTimestamp: null,
						},
					},
				},
			});
		}
		throw new Error(`unexpected query: ${body.query}`);
	});

	return sent;
}

/** A JWT with a readable payload, which is what decides the endpoint a token is tried on first. */
function jwt(payload: Record<string, unknown>): string {
	const segment = (value: object): string =>
		btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	return `${segment({ typ: 'JWT', alg: 'RS256' })}.${segment(payload)}.signature-we-never-check`;
}

const USER_TOKEN = jwt({
	sub: '12345',
	scopes: ['view-user-profile', 'view-private-reports'],
});
const CLIENT_TOKEN = jwt({ sub: '9' });

/** Records the endpoint of every request and answers each however the test says to. */
function stubEndpoints(answer: (url: string) => Response): string[] {
	const urls: string[] = [];
	vi.stubGlobal('fetch', async (url: string) => {
		urls.push(url);
		return answer(url);
	});
	return urls;
}

const reportResponse = (): Response =>
	new Response(
		JSON.stringify({
			data: {
				reportData: {
					report: {
						title: 'Raid night',
						startTime: 0,
						endTime: 900000,
						zone: null,
						fights: [],
					},
				},
			},
		}),
		{ status: 200 },
	);

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('endpoint', () => {
	it('keeps both API paths on the one Mists of Pandaria host', () => {
		// Two paths, one host: the production CSP names this host and nothing here widens it.
		expect(WCL_USER_ENDPOINT).toBe('https://classic.warcraftlogs.com/api/v2/user');
		expect(WCL_CLIENT_ENDPOINT).toBe('https://classic.warcraftlogs.com/api/v2/client');
		expect(WCL_HOST).toBe('classic.warcraftlogs.com');
		expect(WCL_REPORT_BASE).toBe('https://classic.warcraftlogs.com/reports');
	});
});

describe('WclClient', () => {
	it('accepts a token pasted with its Bearer prefix', () => {
		expect(() => new WclClient({ token: `Bearer ${TOKEN}` })).not.toThrow();
	});

	it('refuses an empty token instead of asking WarcraftLogs about it', () => {
		expect(() => new WclClient({ token: '   ' })).toThrow(WclError);
	});

	it('keeps the token out of everything but the Authorization header', async () => {
		const sent = stubApi([]);
		const client = new WclClient({ token: TOKEN });
		await client.fetchReport('abc123');

		const request = sent[0];
		expect(request?.url).toBe(WCL_USER_ENDPOINT);
		expect(request?.authorization).toBe(`Bearer ${TOKEN}`);
		expect(request?.url).not.toContain(TOKEN);
		expect(JSON.stringify(request?.variables)).not.toContain(TOKEN);
		// A serialised client must not carry it either — it is a private field for that reason.
		expect(JSON.stringify(client)).not.toContain(TOKEN);
	});

	it('sends the named operation from the .graphql file', async () => {
		const sent = stubApi([]);
		await new WclClient({ token: TOKEN }).fetchReport('abc123');
		expect(sent[0]?.query).toContain('query ReportFights($code: String!)');
	});

	it('calls a rejected token an auth failure, whichever way it is rejected', async () => {
		vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }));
		await expect(new WclClient({ token: TOKEN }).fetchReport('abc123')).rejects.toMatchObject({
			kind: 'auth',
			status: 401,
		});

		vi.stubGlobal('fetch', async () => new Response('{}', { status: 403 }));
		await expect(new WclClient({ token: TOKEN }).fetchReport('abc123')).rejects.toMatchObject({ kind: 'auth' });

		// WCL also answers 200 with an errors array for an expired token.
		vi.stubGlobal(
			'fetch',
			async () =>
				new Response(
					JSON.stringify({
						errors: [{ message: 'Unauthenticated.' }],
					}),
					{ status: 200 },
				),
		);
		await expect(new WclClient({ token: TOKEN }).fetchReport('abc123')).rejects.toMatchObject({ kind: 'auth' });
	});

	it('distinguishes a report that is not there from a token that is not allowed', async () => {
		vi.stubGlobal(
			'fetch',
			async () => new Response(JSON.stringify({ data: { reportData: { report: null } } }), { status: 200 }),
		);
		await expect(new WclClient({ token: TOKEN }).fetchReport('nope')).rejects.toMatchObject({ kind: 'missing' });
	});

	it('separates a rate limit and a server failure from both', async () => {
		vi.stubGlobal('fetch', async () => new Response('{}', { status: 429 }));
		await expect(new WclClient({ token: TOKEN }).fetchReport('abc123')).rejects.toMatchObject({
			kind: 'rate-limit',
		});

		vi.stubGlobal('fetch', async () => new Response('{}', { status: 503 }));
		await expect(new WclClient({ token: TOKEN }).fetchReport('abc123')).rejects.toMatchObject({ kind: 'server' });
	});

	it('routes each kind of token to the endpoint its scopes say it can use', () => {
		expect(new WclClient({ token: USER_TOKEN }).endpoint).toBe(WCL_USER_ENDPOINT);
		expect(new WclClient({ token: CLIENT_TOKEN }).endpoint).toBe(WCL_CLIENT_ENDPOINT);
		// A token whose payload will not decode is not refused: it is sent to /user to fail for real.
		expect(new WclClient({ token: TOKEN }).endpoint).toBe(WCL_USER_ENDPOINT);
	});

	it('retries once on the other endpoint when the chosen one rejects the token, and stays there', async () => {
		// Scope names can change, so the decode's answer has to be survivable: this token routes to
		// /client and WarcraftLogs disagrees.
		const urls = stubEndpoints((url) =>
			url === WCL_CLIENT_ENDPOINT ? new Response('{}', { status: 401 }) : reportResponse(),
		);

		const client = new WclClient({ token: CLIENT_TOKEN });
		await expect(client.fetchReport('abc123')).resolves.toMatchObject({
			title: 'Raid night',
		});
		expect(urls).toEqual([WCL_CLIENT_ENDPOINT, WCL_USER_ENDPOINT]);

		// The fallback sticks, so the wasted request is paid once per client and not once per query.
		await client.fetchReport('abc123');
		expect(urls).toEqual([WCL_CLIENT_ENDPOINT, WCL_USER_ENDPOINT, WCL_USER_ENDPOINT]);
		expect(client.endpoint).toBe(WCL_USER_ENDPOINT);
	});

	it('surfaces the original failure, once, when both endpoints refuse', async () => {
		const urls = stubEndpoints(() => new Response('{}', { status: 401 }));

		await expect(new WclClient({ token: USER_TOKEN }).fetchReport('abc123')).rejects.toMatchObject({
			kind: 'auth',
			status: 401,
		});
		expect(urls).toEqual([WCL_USER_ENDPOINT, WCL_CLIENT_ENDPOINT]);
	});

	it('does not retry a failure that is not about the token', async () => {
		const urls = stubEndpoints(() => new Response('{}', { status: 503 }));

		await expect(new WclClient({ token: USER_TOKEN }).fetchReport('abc123')).rejects.toMatchObject({
			kind: 'server',
		});
		expect(urls).toEqual([WCL_USER_ENDPOINT]);
	});
});

describe('fetchFightDataset', () => {
	const page = (rows: unknown[], next: number | null) => ({
		data: rows,
		nextPageTimestamp: next,
	});

	it('follows nextPageTimestamp to exhaustion and reports progress on the way', async () => {
		const sent = stubApi([
			page(
				[
					{
						timestamp: 1000,
						type: 'cast',
						abilityGameID: 100787,
						sourceID: 7,
					},
				],
				150000,
			),
			page(
				[
					{
						timestamp: 150000,
						type: 'damage',
						abilityGameID: 100787,
						sourceID: 7,
						amount: 42,
					},
				],
				280000,
			),
			page(
				[
					{
						timestamp: 280000,
						type: 'removebuff',
						abilityGameID: 125359,
						targetID: 7,
					},
				],
				null,
			),
		]);

		const progress: FetchProgress[] = [];
		const dataset = await fetchFightDataset(new WclClient({ token: TOKEN }), {
			code: 'abc123',
			fightID: 1,
			playerName: 'bigdogmo',
			onProgress: (p) => progress.push(p),
		});

		// Treating the first page as the whole fight is how a nine-minute pull becomes 90 seconds.
		expect(dataset.events).toHaveLength(3);
		const eventCalls = sent.filter((s) => s.query.includes('query FightEvents'));
		expect(eventCalls).toHaveLength(3);
		expect(eventCalls.map((c) => c.variables['startTime'])).toEqual([1000, 150000, 280000]);
		expect(progress.map((p) => p.phase)).toEqual(['report', 'table', 'events', 'events', 'events', 'done']);
	});

	// A cursor that will not advance cannot be walked, and what is in hand is a *prefix* of the pull —
	// so this refuses for the same reason the page cap does. Returning the pages already fetched
	// printed CPM, uptime and lost casts for a fight that stopped early, with nothing recording that
	// it had.
	it('refuses rather than analysing a prefix when the cursor stops moving', async () => {
		const sent = stubApi([page([{ timestamp: 1000, type: 'cast', abilityGameID: 100787 }], 1000)]);

		await expect(
			fetchFightDataset(new WclClient({ token: TOKEN }), {
				code: 'abc123',
				fightID: 1,
				playerName: 'Bigdogmo',
			}),
		).rejects.toThrow(/stopped advancing/);

		// And it stops asking, which is the other half of the guard: it must not page forever.
		expect(sent.filter((s) => s.query.includes('query FightEvents'))).toHaveLength(1);
	});

	it('parses the JSON event blob instead of trusting it', async () => {
		stubApi([
			page(
				[
					{ timestamp: 1000, type: 'cast', abilityGameID: 100787 },
					{ type: 'cast', abilityGameID: 100787 }, // no timestamp: cannot be placed on the timeline
					{ timestamp: 2000 }, // no type: cannot be narrowed
					'not an event',
					null,
				],
				null,
			),
		]);

		const dataset = await fetchFightDataset(new WclClient({ token: TOKEN }), {
			code: 'abc123',
			fightID: 1,
			playerName: 'Bigdogmo',
		});
		expect(dataset.events).toEqual([{ timestamp: 1000, type: 'cast', abilityGameID: 100787 }]);
	});

	it('resolves the player, their pets and the fight the analysis needs', async () => {
		stubApi([page([], null)]);
		const dataset = await fetchFightDataset(new WclClient({ token: TOKEN }), {
			code: 'abc123',
			fightID: 1,
			playerName: 'BIGDOGMO',
		});

		expect(dataset.actor).toMatchObject({ id: 7, name: 'Bigdogmo' });
		expect(dataset.fight).toMatchObject({
			id: 1,
			encounterID: 1623,
			kill: true,
		});
		// The API's nulls are resolved here so nothing downstream has to check for them.
		expect(dataset.fight.friendlyPlayers).toEqual([7]);
		expect(dataset.table.fight.enemyNPCs).toEqual([{ id: 20, gameID: 71865 }]);
		expect(dataset.actors.map((a) => a.name)).toEqual(['Bigdogmo', 'Xuen']);
		expect(dataset.table.damageDone.entries[0]).toMatchObject({
			activeTime: 250000,
			itemLevel: 553,
		});
	});

	it('names the players in the report when the one asked for is not in it', async () => {
		stubApi([page([], null)]);
		await expect(
			fetchFightDataset(new WclClient({ token: TOKEN }), {
				code: 'abc123',
				fightID: 1,
				playerName: 'Bigdogma',
			}),
		).rejects.toMatchObject({ kind: 'missing' });
	});
});
