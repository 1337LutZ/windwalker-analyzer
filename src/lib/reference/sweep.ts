// Turning a planned job into a measured pull — the far half of the reference harness.
//
// `scripts/build-reference-tables.mjs` owns the roster, the band arithmetic, the gates, the table
// maths and the reporting. It owns everything except one step: it cannot run `analyse()`, because
// `analyse()` is TypeScript that imports through the `~/` alias and pulls `?raw` GraphQL documents,
// and a plain `.mjs` under `node` resolves neither. That one step is this module.
//
// ------------------------------------------------------------------ the boundary is files, on purpose
//
// The two halves talk through JSON on disk rather than through an import, and the reason is not taste.
// A `.mjs` cannot import the TypeScript, and the TypeScript must not import the `.mjs`: `tsc --noEmit`
// covers `**/*`, so a `.ts` module importing a `.mjs` drags an untyped module-format seam into the type
// check for the sake of a data structure that is three fields wide. So the script writes a plan and
// reads a result, and neither side has an opinion about how the other is built:
//
//   `${REFERENCE_CACHE}/jobs.json`   { metric, specs, jobs }   written by the script, read here
//   `${REFERENCE_CACHE}/pulls.json`  SweptPull[]               written by the runner, read by the script
//
// This module reads and writes neither. It takes a plan in memory and answers pulls and failures;
// `__tests__/sweep.run.ts` — the process the script actually spawns — owns the two files, because the
// file protocol *is* the process boundary and belongs to the process. What this module does own is the
// **dataset** cache, which is not a protocol but part of the job: "fetch this pull" has to mean "fetch
// it once, ever", or a re-run of a three-spec sweep costs another few thousand API points.
//
// ------------------------------------------------------------------ two traps, both measured
//
// Earlier sweeps lost real time to two fields that read as though they exist:
//
//   - **`analysis.cpm.inContactMs` is not a field.** Reading it yields `undefined`, silently, and a
//     contact share computed from it is `NaN` — which sorts, compares and averages without complaining.
//     The contact clock is `unionMs(analysis.timeline.contactSegments)`. Union and not sum: the segments
//     can overlap, and a sum overstates a pull's contact share past 1.
//   - **Press marks live at `timeline.casts`, not `timeline.marks`.** Same object, same silent
//     `undefined`. Nothing here reads them, but the next field added to a swept pull will want them.
//
// Neither is a type error, because `Analysis`' `timeline` is optional all the way down — a fixture
// captured before a field existed arrives without it — so every read below is guarded and every
// denominator is checked. `contactShare` answering `0` for a pull with no contact segments is the
// honest reading: the gate in the script then rejects it as "barely present" rather than averaging a
// `NaN` into a published cell.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { unionMs } from '~/lib/analysis/intervals';
import { getSpec } from '~/lib/spec';
import type { Analysis, FightDataset } from '~/lib/types';
import { WclClient, WclError, fetchFightDataset } from '~/lib/wcl';
import type { ApiCredits } from '~/lib/wcl';

/** One spec as the plan records it — the script's `registeredSpecs()` output, unchanged. */
export interface PlannedSpec {
	key: string;
	/** WarcraftLogs' own class spelling, which is what made the rankings query cheap to write. */
	classKey: string;
	specName: string;
}

/**
 * One pull to measure, as the script's candidate selection named it.
 *
 * `encounterID` is a **base** id, because that is the currency the rest of the chain speaks:
 * `profile.ts` keys its `encounters` table by base id and compares with `baseEncounterID`, and the
 * script's `ENCOUNTERS` list is base ids. A fetched dataset reports the *raw* id — Iron Juggernaut
 * arrives as `51600` where the job says `1600` — so the pull below carries the job's number and never
 * the dataset's, or every cell would be filed under an id nothing looks up.
 *
 * `rank` and `totalParses` are carried rather than used. They are what `predictedRankPercent` was
 * computed from, and a prediction whose inputs were thrown away cannot be argued with after the fact.
 */
export interface SweepJob {
	spec: string;
	encounterID: number;
	code: string;
	fightID: number;
	player: string;
	/** `100 × (1 − rank/totalParses)` — checked against the dataset's own figure, never trusted over it. */
	predictedRankPercent: number;
	rank: number;
	totalParses: number;
	/** Epoch ms of the kill itself, from the rankings row. Null when the site did not say. */
	loggedAt: number | null;
}

export interface SweepPlan {
	/** Which figure `value` is. The key into `METRIC_READERS`. */
	metric: string;
	/**
	 * The specs the script swept, for the record.
	 *
	 * Not read by the sweep: a job names its spec, and the engine for that spec is reached through the
	 * registry (see `runSweep`). Kept in the shape because the plan is a written artefact and a reader
	 * opening `jobs.json` a month later needs to know what it covered.
	 */
	specs: PlannedSpec[];
	jobs: SweepJob[];
}

/**
 * One measured pull, in exactly the shape `gateOf` and `tableFrom` in the script expect.
 *
 * Everything the gates test is here, including the two facts they do not reject on. `deaths` is
 * **annotated, not excluded** — the contact clock resumes after a resurrection, so a pull that died is
 * still a reading, and `contactShare` is the gate that catches the pull that was not. `rankPercent` and
 * `predictedRankPercent` sit side by side so the band arithmetic can be checked rather than believed:
 * the two agreed to ±1 on all 59 pulls of the sweep that established the method, and a prediction with
 * nothing beside it is a claim nobody can re-check.
 */
export interface SweptPull {
	spec: string;
	encounterID: number;
	code: string;
	fightID: number;
	player: string;
	/** WarcraftLogs' own name for the fight. The table is joined to a report by this, not by id. */
	encounterName: string;
	/** Epoch ms of the kill, for the sliding window. Null when the ranking row carried none. */
	loggedAt: number | null;
	/** WarcraftLogs' own parse percentile for this pull. Null when the site has none — never a nought. */
	rankPercent: number | null;
	predictedRankPercent: number;
	value: number;
	isSpec: boolean;
	kill: boolean;
	difficulty: number;
	durationMs: number;
	/** `unionMs(contactSegments) / durationMs`, in 0–1. Zero when there is no clock to divide. */
	contactShare: number;
	deaths: number;
	gcdSlots: number;
}

/** A job that produced no pull, and what stopped it. Collected rather than thrown — see `runSweep`. */
export interface SweepFailure {
	job: SweepJob;
	reason: string;
}

/**
 * What a long run reports, and to a callback rather than to stdout.
 *
 * The script spawns the runner with stdout ignored and stderr inherited, and its own output is a strict
 * one-line-per-cell budget. A module that printed a line per job would either be swallowed or would
 * blow that budget, so this module prints nothing at all and lets its caller decide.
 */
export interface SweepProgress {
	/** 1-based, and counted for every job — including the ones that failed. */
	done: number;
	total: number;
	job: SweepJob;
	/** `cached` is the free case: the dataset was already on disk and no API point was spent. */
	outcome: 'cached' | 'fetched' | 'failed';
	reason?: string;
}

/**
 * How long a run may take and how much of the hourly budget it may spend.
 *
 * **A sweep that cannot finish is the normal case, not the failure case.** A full three-spec refresh
 * plans on the order of 1,700 jobs at high single-digit points each — well past an hourly allowance —
 * so any honest scheduling of this has to stop partway and pick up later. Two things make that safe:
 * the dataset cache means a fetched pull is never paid for twice, and the evidence file accumulates,
 * so a run that measures a third of the plan has advanced the table by a third rather than wasted.
 *
 * Which is why the budget is a stopping rule rather than a failure. A run that hits it returns what it
 * has, says why it stopped, and the next one resumes.
 */
export interface SweepBudget {
	/** Epoch ms after which no new job is started. A CI job's own wall-clock limit, minus the tail. */
	stopAt?: number;
	/**
	 * Points to leave unspent.
	 *
	 * Not zero, and not a rounding habit. A single pull costs several points across four documents, and
	 * a sweep that spends down to the last point tears one pull in half — the events arrive, the damage
	 * table 429s, and the dataset is written to cache in a state `analyse()` will throw on. The reserve
	 * is what keeps the cache honest.
	 */
	reserve?: number;
	/** Longest the run will sit waiting for the hourly window to roll over rather than stopping. */
	maxWaitMs?: number;
}

/** Why a run ended, which the caller needs in order to know whether to schedule another. */
export type SweepStop = 'complete' | 'time' | 'points';

export interface SweepResult {
	pulls: SweptPull[];
	failures: SweepFailure[];
	/** `complete` means the plan ran out, not that everything in it succeeded — read `failures` too. */
	stopped: SweepStop;
	/** Jobs never attempted, because the run stopped first. Zero when `stopped` is `complete`. */
	remaining: number;
	/** The last reading WarcraftLogs sent, or null if nothing was ever fetched. */
	credits: ApiCredits | null;
	/** Total time spent parked on the hourly reset. Reported so a schedule can be sized against it. */
	waitedMs: number;
}

export interface SweepOptions {
	plan: SweepPlan;
	/** `REFERENCE_CACHE` — datasets are cached under `datasets/` inside it. */
	cacheDir: string;
	/** Only needed for a job whose dataset is not cached; a fully cached re-run needs no token at all. */
	token?: string;
	onProgress?: (progress: SweepProgress) => void;
	budget?: SweepBudget;
	/** Injected so the tests can exercise an exhausted budget without actually sleeping through one. */
	sleep?: (ms: number) => Promise<void>;
	/** Injected for the same reason: a test needs a clock it can move. */
	now?: () => number;
	/**
	 * How many pulls are fetched at once.
	 *
	 * **Latency, not throughput — the point budget is unchanged.** One pull is four sequential documents
	 * against an API answering in a few hundred milliseconds, so a sequential sweep spends most of its
	 * wall clock waiting rather than spending. Three at a time cuts that without buying anything extra:
	 * the hourly allowance is per account, so parallelism cannot raise it and sharding across jobs would
	 * only exhaust it faster.
	 *
	 * Three rather than ten because the budget checks and the 429 backoff are shared state, and a wide
	 * pool turns one rate-limit reply into a burst of them.
	 */
	concurrency?: number;
}

/**
 * Points left unspent by default.
 *
 * Twenty, which is a few pulls' worth. One pull spends across four documents — report, actors, damage
 * table, events — and the failure this prevents is the torn one: events arrive, the next document 429s,
 * and a half-built dataset is written to the cache where `analyse()` will throw on it every run after.
 */
const DEFAULT_RESERVE = 20;

/**
 * Longest the run will sit waiting for the hourly window rather than stopping, by default.
 *
 * A little over an hour, so a run that arrives just after a reset can wait out one full window. Longer
 * would be waiting for a *second* window, which is a scheduling decision rather than a pause — the next
 * scheduled run is the better way to buy another hour, and it does not hold a CI job open to do it.
 */
const DEFAULT_MAX_WAIT_MS = 65 * 60 * 1000;

/** Pulls fetched at once by default. See `SweepOptions.concurrency` for why it is small. */
const DEFAULT_CONCURRENCY = 3;

/**
 * What `value` reads, by the name the plan's `metric` carries.
 *
 * One entry today, and adding a second is one line — which is the whole reason the metric travels in
 * the plan as a string instead of being wired in here. A metric this table does not know is a thrown
 * error rather than a silent `undefined`: a column of `null` values would still build a table, and the
 * cells would look like a distribution.
 */
export const METRIC_READERS: Record<string, (analysis: Analysis) => number> = {
	gcdUtilisationPct: (analysis) => analysis.cpm.gcdUtilisationPct,
};

/**
 * Where one job's fetched dataset lives.
 *
 * Keyed by the three things that identify a pull for one player, because that is exactly what one fetch
 * buys — two jobs for two players on the same kill are two datasets, and two jobs for the same player on
 * the same kill are one.
 *
 * Both halves are percent-encoded. The player name is the one that has actually bitten: earlier sweeps
 * hit `Ünkchërñ` and friends, and a raw UTF-8 name is a filename whose bytes depend on the filesystem's
 * normalisation — the same name can be written and then not found. Report codes are alphanumeric except
 * for the `a:` prefix on an anonymous report, which is legal on POSIX and not on Windows; encoding it
 * costs nothing and removes the question.
 */
export function datasetPathFor(cacheDir: string, job: Pick<SweepJob, 'code' | 'fightID' | 'player'>): string {
	const name = `${encodeURIComponent(job.code)}_${job.fightID}_${encodeURIComponent(job.player)}.json`;
	return resolve(cacheDir, 'datasets', name);
}

/**
 * The measured pull, from the job that asked for it and the two things the fetch produced.
 *
 * Pure, and separated from the fetch for exactly that reason: this is where every field the gates read
 * is decided, and it is the half worth testing against a hand-built analysis rather than against a
 * report somebody has to fetch. See the module header for the two fields that are not where they look
 * like they are.
 *
 * `rankPercent` comes off the **dataset** and never off `job.predictedRankPercent`. Copying the
 * prediction into the measured field would make the comparison the pair exists for tautological, and it
 * would do so silently — the numbers agree to ±1 in practice, so nothing downstream would ever look wrong.
 */
export function pullFrom(
	job: SweepJob,
	dataset: Pick<FightDataset, 'rankPercent' | 'fight'>,
	analysis: Analysis,
	metric: string,
): SweptPull {
	const read = METRIC_READERS[metric];
	if (read === undefined) {
		throw new Error(`no reader for metric "${metric}" — add one to METRIC_READERS in lib/reference/sweep.ts`);
	}
	const contactMs = unionMs(analysis.timeline?.contactSegments ?? []);
	return {
		spec: job.spec,
		encounterID: job.encounterID,
		/**
		 * The fight's own name, straight from the dataset.
		 *
		 * Carried because the reference table is joined to a report *by name* — `analysis.encounter` is a
		 * string and carries no id — so a pull that arrives nameless produces a cell named after its own
		 * id, which matches nothing and quietly grades that encounter against the spec-wide curve.
		 */
		encounterName: dataset.fight.name,
		/** Carried from the ranking row: the sliding window retires by when a pull happened. */
		loggedAt: job.loggedAt,
		code: job.code,
		fightID: job.fightID,
		player: job.player,
		rankPercent: dataset.rankPercent ?? null,
		predictedRankPercent: job.predictedRankPercent,
		value: read(analysis),
		isSpec: analysis.isSpec,
		kill: analysis.kill,
		difficulty: analysis.difficulty,
		durationMs: analysis.durationMs,
		contactShare: analysis.durationMs > 0 ? contactMs / analysis.durationMs : 0,
		deaths: analysis.timeline?.deaths?.length ?? 0,
		gcdSlots: analysis.cpm.gcdSlots,
	};
}

/**
 * Every job in the plan, measured — and every job that could not be, collected.
 *
 * **A failing job does not end the run**, which is the one behaviour a long sweep lives or dies by. A
 * three-spec refresh is on the order of a thousand fetches over several hours; a private report, a
 * player who transferred, a log WarcraftLogs is still processing or a single network blip anywhere in
 * that is enough to throw, and aborting would discard every pull measured before it. So each job is its
 * own try, and what comes back is both lists. The script decides what to do with them — today it builds
 * the table from the pulls and prints a count and one example of the rest.
 *
 * **The engine is reached through the registry, not through a path.** `getSpec(job.spec).analyse` is
 * what makes the script's "this runs for specs that do not exist yet" claim true on this side of the
 * boundary too: the script discovers the roster by reading `SPECS` out of `registry.ts`, and a job it
 * plans for a spec registered next year resolves here with no edit. A `switch` over spec keys, or an
 * import per `src/specs/<spec>/lib/index.ts`, would be a second roster to forget to update — and it
 * would put a spec's name inside `src/lib/`, which is the one thing shared code here may not do.
 *
 * **The client is built on first miss.** A re-run over a warm cache therefore needs no token, spends no
 * point and opens no socket — which is not just an economy, it is what makes the always-on tests in
 * `__tests__/sweep.run.ts` able to exercise this function at all. A cache miss with no token is a
 * collected failure rather than a thrown one, for the reason above.
 */
export async function runSweep(options: SweepOptions): Promise<SweepResult> {
	const { plan, cacheDir, token, onProgress, budget } = options;
	const now = options.now ?? (() => Date.now());
	const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
	const stopAt = budget?.stopAt ?? Infinity;
	const reserve = budget?.reserve ?? DEFAULT_RESERVE;
	const maxWaitMs = budget?.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
	mkdirSync(resolve(cacheDir, 'datasets'), { recursive: true });

	let client: WclClient | undefined;
	const pulls: SweptPull[] = [];
	const failures: SweepFailure[] = [];
	let done = 0;
	// A holder rather than a bare `let`: the only writer is the client's `onCredits` callback, and
	// TypeScript narrows a `let` initialised to null down to `never` at every read before it.
	const seen: { credits: ApiCredits | null } = { credits: null };
	let waitedMs = 0;
	let stopped: SweepStop = 'complete';

	/**
	 * Park until the hourly window rolls over, or refuse to.
	 *
	 * Returns false when waiting would outlast either cap, and that is the signal to stop the run
	 * rather than to fail the job — the jobs behind it are still perfectly good work for next time.
	 */
	let waiting: Promise<boolean> | null = null;
	const waitForReset = async (): Promise<boolean> => {
		// One wait, shared. Without this every worker sleeps through the same window and `waitedMs`
		// reports three hours where one was spent.
		if (waiting !== null) return waiting;
		waiting = doWait().finally(() => {
			waiting = null;
		});
		return waiting;
	};
	const doWait = async (): Promise<boolean> => {
		if (seen.credits === null) return false;
		// A second past the reported reset, because the boundary is the server's and the clocks differ.
		const need = seen.credits.resetAt - now() + 1_000;
		if (need <= 0) return true;
		if (need > maxWaitMs || now() + need >= stopAt) return false;
		await sleep(need);
		waitedMs += need;
		return true;
	};

	const total = plan.jobs.length;
	const queue = [...plan.jobs];

	const runOne = async (job: SweepJob): Promise<'done' | 'requeue' | 'stop'> => {
		const path = datasetPathFor(cacheDir, job);
		const cached = existsSync(path);

		// The two stopping rules, checked before any point is spent. A cached job costs nothing and is
		// allowed through both — finishing the analysis of what is already on disk is free.
		if (!cached) {
			if (now() >= stopAt) {
				stopped = 'time';
				return 'stop';
			}
			if (seen.credits !== null && seen.credits.limit - seen.credits.spent <= reserve) {
				if (!(await waitForReset())) {
					stopped = 'points';
					return 'stop';
				}
			}
		}

		done += 1;
		try {
			let dataset: FightDataset;
			if (cached) {
				// A cast rather than a check, exactly as the committed fixtures are read: this file was
				// written by the branch below, so its shape is this tree's own output rather than input
				// from anywhere. A file that is not one fails in `analyse()` and is collected as a failure.
				dataset = JSON.parse(readFileSync(path, 'utf8')) as FightDataset;
			} else {
				if (client === undefined) {
					if (token === undefined || token === '') {
						throw new Error('no cached dataset, and no token to fetch one — load it with: set -a; . ./.env; set +a');
					}
					// Free: every document in `lib/wcl` carries `rateLimitData`, so the run learns its own
					// budget from work it was doing anyway rather than polling for it.
					client = new WclClient({ token, onCredits: (reading) => (seen.credits = reading) });
				}
				dataset = await fetchFightDataset(client, {
					code: job.code,
					fightID: job.fightID,
					playerName: job.player,
				});
				// Written before the analysis runs, so a pull whose *analysis* throws is still never fetched
				// twice. The points are spent the moment the events arrive; failing after that and paying
				// again on the next run is the one way this cache can be worse than useless.
				writeFileSync(path, JSON.stringify(dataset));
			}

			const spec = getSpec(job.spec);
			if (spec === undefined) throw new Error(`no registered spec named "${job.spec}"`);
			pulls.push(pullFrom(job, dataset, spec.analyse(dataset), plan.metric));
			onProgress?.({ done, total, job, outcome: cached ? 'cached' : 'fetched' });
		} catch (error) {
			// **A 429 is not a failed job, it is a full bucket.** Recording it as a failure would burn the
			// job for this run and, worse, make a rate-limited sweep look like 1,700 broken reports. Wait
			// out the window and try the same job again; if waiting is not allowed, stop the run and leave
			// the job for the next one.
			if (error instanceof WclError && error.kind === 'rate-limit') {
				done -= 1;
				if (await waitForReset()) return 'requeue';
				stopped = 'points';
				return 'stop';
			}
			const reason = error instanceof Error ? error.message : String(error);
			failures.push({ job, reason });
			onProgress?.({ done, total, job, outcome: 'failed', reason });
		}
		return 'done';
	};

	// A pool rather than a loop. Workers share the queue, the credit reading and the backoff, so the
	// stopping rules stay global: the first worker to run the budget out stops the run for all of them,
	// and the jobs still in the queue are untouched work for the next one.
	const worker = async (): Promise<void> => {
		for (;;) {
			if (stopped !== 'complete') return;
			const job = queue.shift();
			if (job === undefined) return;
			const outcome = await runOne(job);
			if (outcome === 'requeue') {
				queue.unshift(job);
				continue;
			}
			if (outcome === 'stop') {
				queue.unshift(job);
				return;
			}
		}
	};

	const width = Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, plan.jobs.length));
	await Promise.all(Array.from({ length: width }, () => worker()));

	return { pulls, failures, stopped, remaining: total - done, credits: seen.credits, waitedMs };
}
