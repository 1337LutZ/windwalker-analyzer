// The process `scripts/build-reference-tables.mjs` spawns, and the guard that keeps it out of everybody
// else's way.
//
// The sweep needs `analyse()`, which means TypeScript, the `~/` alias and `?raw` GraphQL documents —
// and `vitest.config.ts` is the only place in this repo where all three already resolve. So the fetch
// runs under vitest. That is a constraint rather than a preference, and it comes with a hazard: the
// suite's `include` is `src/**/__tests__/**/*.ts`, so this file is collected by every `npm test` any
// contributor or CI job ever runs.
//
// **`REFERENCE_SWEEP` is what stops that from being a thousand network requests on somebody's laptop.**
// The one test that reaches WarcraftLogs is `it.skipIf`-ed on the variable's absence, so an ordinary run
// pays it exactly one skipped test and no socket. The file is committed rather than written and deleted
// for the same reason: `include` is `src/**`, and a temporary file under it is a file the next run might
// collect halfway through being written.
//
// A guard that is only asserted in prose is a guard that breaks quietly, so the tests below do two
// things at once. They cover the pure half of `../sweep` — the cache path, the field derivation, the
// failure collection — and every one of them runs with `globalThis.fetch` replaced by a counter that
// refuses, and asserts the count is nought. The claim "an ordinary `npm test` makes no network call
// from here" is therefore checked by the ordinary `npm test` itself.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Analysis, FightDataset } from '~/lib/types';
import { METRIC_READERS, datasetPathFor, pullFrom, runSweep, type SweepJob, type SweepPlan } from '../sweep';

/** Set by the script, and by nothing else. Its absence is what skips the sweep. */
const SWEEPING = (process.env['REFERENCE_SWEEP'] ?? '') !== '';
const CACHE = process.env['REFERENCE_CACHE'] ?? resolve(process.cwd(), '.reference-cache');

/**
 * How often the run says it is alive, in jobs.
 *
 * A full three-spec refresh is on the order of a thousand fetches over several hours, and a process
 * that prints nothing for that long is indistinguishable from one that has hung. This goes to **stderr**
 * — the script runs the runner with stdout ignored and stderr inherited, and its own stdout is a strict
 * one-line-per-cell budget that a per-job line would blow by three orders of magnitude.
 */
const HEARTBEAT_EVERY = 50;

/**
 * The committed Iron Juggernaut pull, standing in for a warm cache.
 *
 * A raw `FightDataset` rather than a captured `Analysis`, which is the only kind `analyse()` can be run
 * over — see `windwalker/__fixtures__/capture.test.ts` on the difference. Reached by path rather than by
 * import because it is a *file* here: the point is that `runSweep` finds it on disk where its own cache
 * key says it should be.
 */
const FIXTURE = '../../../specs/windwalker/__fixtures__/dataset-ironJuggernaut.json';

// --------------------------------------------------------------- the sweep itself, off by default

describe('the sweep', () => {
	/**
	 * Measures every job the script planned, and writes the detail the script reads back.
	 *
	 * Skipped unless `REFERENCE_SWEEP` is set — see the file header. The plan is the script's, and its
	 * absence is a loud failure rather than an empty run: a sweep that measured nothing would write an
	 * empty `pulls.json`, and the table built from it would silently drop every cell in the tree.
	 */
	it.skipIf(!SWEEPING)('measures every job the script planned', { timeout: 6 * 60 * 60 * 1000 }, async () => {
		const planPath = resolve(CACHE, 'jobs.json');
		if (!existsSync(planPath)) {
			throw new Error(
				`no plan at ${planPath} — it is written by scripts/build-reference-tables.mjs, which spawns this`,
			);
		}
		const plan = JSON.parse(readFileSync(planPath, 'utf8')) as SweepPlan;

		let fetched = 0;
		const result = await runSweep({
			plan,
			cacheDir: CACHE,
			token: process.env['WCL_TOKEN'] ?? '',
			onProgress: ({ done, total, outcome }) => {
				if (outcome === 'fetched') fetched += 1;
				if (done % HEARTBEAT_EVERY === 0 || done === total) {
					process.stderr.write(`sweep ${done}/${total} · ${fetched} fetched\n`);
				}
			},
		});

		writeFileSync(resolve(CACHE, 'pulls.json'), JSON.stringify(result.pulls));
		// The failures are the only record of what a multi-hour run could not reach, and they are not in
		// `pulls.json` by construction — a job that produced no pull produced no row. To disk rather than
		// to the terminal, which is the same rule every other piece of per-pull detail here follows.
		writeFileSync(resolve(CACHE, 'failures.json'), JSON.stringify(result.failures));
		process.stderr.write(`sweep done · ${result.pulls.length} pulls · ${result.failures.length} failed\n`);

		// A run where *everything* failed is not a thin sweep, it is a broken one — a dead token, a
		// renamed field, an API that stopped answering — and it must fail the script rather than quietly
		// rewriting `reference.json` from nothing.
		expect(result.pulls.length, 'pulls measured').toBeGreaterThan(0);
	});
});

// --------------------------------------------------------------- everything below runs on every `npm test`

/**
 * Runs `run` with `fetch` replaced by a counter that refuses, and asserts nothing reached it.
 *
 * The guard this whole file exists for, turned into an assertion. `globalThis.fetch` is swapped by hand
 * rather than through `vi.spyOn` so that the restore is unconditional: a test that left a throwing
 * `fetch` behind would fail files it never touched, in an order-dependent way.
 */
async function withoutNetwork<T>(run: () => Promise<T>): Promise<T> {
	const real = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = (() => {
		calls += 1;
		throw new Error('the sweep reached the network');
	}) as unknown as typeof fetch;
	try {
		const answer = await run();
		expect(calls, 'network requests made').toBe(0);
		return answer;
	} finally {
		globalThis.fetch = real;
	}
}

/** A scratch cache, removed however the test ends. */
async function inTempCache<T>(run: (cacheDir: string) => Promise<T>): Promise<T> {
	const cacheDir = mkdtempSync(join(tmpdir(), 'reference-sweep-'));
	try {
		return await run(cacheDir);
	} finally {
		rmSync(cacheDir, { recursive: true, force: true });
	}
}

const job = (over: Partial<SweepJob> = {}): SweepJob => ({
	spec: 'windwalker',
	encounterID: 1600,
	code: 'a:6MhZgjyAknFWrYfK',
	fightID: 12,
	player: 'Player (17)',
	predictedRankPercent: 74,
	rank: 104,
	totalParses: 400,
	...over,
});

const planOf = (jobs: SweepJob[]): SweepPlan => ({ metric: 'gcdUtilisationPct', specs: [], jobs });

describe('the dataset cache path', () => {
	/** One file per (report, fight, player) — which is exactly what one fetch buys. */
	it('names a file for the pull it holds', () => {
		expect(datasetPathFor('/cache', { code: 'ABCdef', fightID: 12, player: 'Someone' })).toBe(
			'/cache/datasets/ABCdef_12_Someone.json',
		);
	});

	/**
	 * The trap that cost an earlier sweep. A raw UTF-8 name is a filename whose bytes depend on the
	 * filesystem's normalisation, so the same player can be written and then not found — which reads as
	 * a cache that never hits and costs the points again.
	 */
	it('percent-encodes a name the filesystem would otherwise have to normalise', () => {
		expect(datasetPathFor('/cache', { code: 'a:XY', fightID: 3, player: 'Ünkchërñ' })).toBe(
			'/cache/datasets/a%3AXY_3_%C3%9Cnkch%C3%ABr%C3%B1.json',
		);
	});

	/** Two players on the same kill are two datasets; the same player twice is one. */
	it('separates two players on one pull', () => {
		const one = datasetPathFor('/cache', { code: 'ABC', fightID: 4, player: 'A' });
		const two = datasetPathFor('/cache', { code: 'ABC', fightID: 4, player: 'B' });
		expect(one).not.toBe(two);
		expect(datasetPathFor('/cache', { code: 'ABC', fightID: 4, player: 'A' })).toBe(one);
	});
});

describe('what a swept pull reads off an analysis', () => {
	/**
	 * A hand-built analysis, shaped like the fields `pullFrom` actually touches.
	 *
	 * The contact segments **overlap on purpose**: 0–100s, 90–150s and 160–190s union to 180s, and sum
	 * to 190s. A pull whose share came out at 0.95 rather than 0.9 would be one that summed, which is the
	 * failure `unionMs` is here to prevent — and on a real pull it can push the share past 1.
	 */
	const analysisLike = (over: Record<string, unknown> = {}): Analysis =>
		({
			isSpec: true,
			kill: true,
			difficulty: 4,
			durationMs: 200_000,
			cpm: { gcdUtilisationPct: 84.21, gcdSlots: 133 },
			timeline: {
				contactSegments: [
					[0, 100_000],
					[90_000, 150_000],
					[160_000, 190_000],
				],
				deaths: [{ t: 59_000 }, { t: 140_000 }],
				casts: [],
			},
			...over,
		}) as unknown as Analysis;

	const dataset = (rankPercent?: number | null): Pick<FightDataset, 'rankPercent'> => ({ rankPercent });

	it('carries every field the script gates on', () => {
		expect(pullFrom(job(), dataset(73), analysisLike(), 'gcdUtilisationPct')).toEqual({
			spec: 'windwalker',
			encounterID: 1600,
			code: 'a:6MhZgjyAknFWrYfK',
			fightID: 12,
			player: 'Player (17)',
			rankPercent: 73,
			predictedRankPercent: 74,
			value: 84.21,
			isSpec: true,
			kill: true,
			difficulty: 4,
			durationMs: 200_000,
			contactShare: 0.9,
			deaths: 2,
			gcdSlots: 133,
		});
	});

	/** Union, not sum — see the fixture's comment. */
	it('counts overlapping contact once', () => {
		expect(pullFrom(job(), dataset(73), analysisLike(), 'gcdUtilisationPct').contactShare).toBe(0.9);
	});

	/**
	 * The measurement and the prediction are two different numbers, and this is the assertion that keeps
	 * them that way. They agree to ±1 in practice, so a copy would never look wrong from downstream.
	 */
	it('takes rankPercent off the dataset rather than off the prediction', () => {
		const pull = pullFrom(job({ predictedRankPercent: 90 }), dataset(12), analysisLike(), 'gcdUtilisationPct');
		expect([pull.rankPercent, pull.predictedRankPercent]).toEqual([12, 90]);
	});

	/** A pull WarcraftLogs has no ranking for is null, never a nought — a nought is a bottom parse. */
	it('answers null for a pull with no parse', () => {
		expect(pullFrom(job(), dataset(null), analysisLike(), 'gcdUtilisationPct').rankPercent).toBeNull();
		expect(pullFrom(job(), dataset(), analysisLike(), 'gcdUtilisationPct').rankPercent).toBeNull();
	});

	/**
	 * **The `NaN` this module's header is about.** `cpm.inContactMs` does not exist, and neither does a
	 * `timeline` on an analysis captured before the field did; both read as `undefined`, and a share
	 * computed from one sorts and averages without ever complaining. Zero is the honest answer, and the
	 * script's contact gate then rejects the pull as "barely present".
	 */
	it('answers zero rather than NaN when there is no contact clock', () => {
		expect(pullFrom(job(), dataset(73), analysisLike({ timeline: undefined }), 'gcdUtilisationPct').contactShare).toBe(
			0,
		);
		expect(pullFrom(job(), dataset(73), analysisLike({ durationMs: 0 }), 'gcdUtilisationPct').contactShare).toBe(0);
	});

	/** Deaths are annotated rather than excluded — the count travels, and the script does not gate on it. */
	it('counts the player’s deaths without rejecting the pull', () => {
		expect(pullFrom(job(), dataset(73), analysisLike(), 'gcdUtilisationPct').deaths).toBe(2);
		expect(pullFrom(job(), dataset(73), analysisLike({ timeline: { casts: [] } }), 'gcdUtilisationPct').deaths).toBe(0);
	});

	/**
	 * A metric nobody wrote a reader for is loud. A column of `undefined` would still build a table, and
	 * the cells would look exactly like a distribution.
	 */
	it('refuses a metric it has no reader for', () => {
		expect(() => pullFrom(job(), dataset(73), analysisLike(), 'dps')).toThrow(/METRIC_READERS/);
		expect(Object.keys(METRIC_READERS)).toEqual(['gcdUtilisationPct']);
	});
});

describe('a sweep over jobs it cannot finish', () => {
	/**
	 * **Two failures rather than one**, which is the whole assertion: a run that aborted at the first
	 * problem would report one and discard the rest of the plan. A three-spec refresh is hours of
	 * fetching, and a private report or a transferred character anywhere in it is enough to throw.
	 */
	it('collects every failure and keeps going', async () => {
		const result = await inTempCache(async (cacheDir) =>
			withoutNetwork(async () =>
				runSweep({ plan: planOf([job({ code: 'first' }), job({ code: 'second' })]), cacheDir }),
			),
		);
		expect(result.pulls).toEqual([]);
		expect(result.failures.map((failure) => failure.job.code)).toEqual(['first', 'second']);
	});

	/** And says what stopped each one, in a sentence somebody can act on. */
	it('says why, and names the token as the fix', async () => {
		const result = await inTempCache(async (cacheDir) =>
			withoutNetwork(async () => runSweep({ plan: planOf([job()]), cacheDir })),
		);
		expect(result.failures[0]?.reason).toMatch(/no cached dataset.*token/);
	});

	/** A job naming a spec the registry has never heard of fails as itself, not as the whole run. */
	it('fails a job for a spec nobody registered', async () => {
		const fixture = resolve(import.meta.dirname, FIXTURE);
		const result = await inTempCache(async (cacheDir) =>
			withoutNetwork(async () => {
				const only = job({ spec: 'shadowpriest' });
				mkdirSync(resolve(cacheDir, 'datasets'), { recursive: true });
				copyFileSync(fixture, datasetPathFor(cacheDir, only));
				return runSweep({ plan: planOf([only]), cacheDir });
			}),
		);
		expect(result.failures[0]?.reason).toMatch(/no registered spec/);
	});
});

describe('a sweep over a cache that is already warm', () => {
	/**
	 * **The claim the whole cache exists for**: a re-run costs no API point, opens no socket and needs no
	 * token at all. Measured here end to end — a real dataset, today's engine, and a `fetch` that would
	 * have thrown.
	 */
	it('measures a cached pull without spending a point', async () => {
		const fixture = resolve(import.meta.dirname, FIXTURE);
		const outcomes: string[] = [];
		const result = await inTempCache(async (cacheDir) =>
			withoutNetwork(async () => {
				const only = job();
				mkdirSync(resolve(cacheDir, 'datasets'), { recursive: true });
				copyFileSync(fixture, datasetPathFor(cacheDir, only));
				return runSweep({
					plan: planOf([only]),
					cacheDir,
					onProgress: ({ outcome }) => outcomes.push(outcome),
				});
			}),
		);

		expect(result.failures).toEqual([]);
		expect(outcomes).toEqual(['cached']);

		const pull = result.pulls[0];
		expect(pull?.isSpec).toBe(true);
		expect(pull?.kill).toBe(true);
		expect(pull?.difficulty).toBe(4);
		expect(pull?.value).toBeGreaterThan(0);
		expect(pull?.gcdSlots).toBeGreaterThan(0);
		expect(pull?.contactShare).toBeGreaterThan(0.5);
		expect(pull?.contactShare).toBeLessThanOrEqual(1);
		// The fixture predates `rankPercent`, so it is absent rather than nought — the case the null is for.
		expect(pull?.rankPercent).toBeNull();
	});

	/**
	 * **The base id wins.** The job says 1600 and the dataset says 51600; `profile.ts` keys its reference
	 * table by base id, so a cell filed under the raw one is a cell nothing ever looks up.
	 */
	it('files the pull under the job’s base encounter id, not the dataset’s raw one', async () => {
		const fixture = resolve(import.meta.dirname, FIXTURE);
		const result = await inTempCache(async (cacheDir) =>
			withoutNetwork(async () => {
				const only = job({ encounterID: 1600 });
				mkdirSync(resolve(cacheDir, 'datasets'), { recursive: true });
				copyFileSync(fixture, datasetPathFor(cacheDir, only));
				return runSweep({ plan: planOf([only]), cacheDir });
			}),
		);
		expect(result.pulls[0]?.encounterID).toBe(1600);
	});
});
