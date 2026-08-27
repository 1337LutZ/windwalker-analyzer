// What has already been paid for, so it is never paid for twice.
//
// The reference sweep's cost is almost entirely per-pull: candidate selection is 42 rankings queries for
// a three-spec refresh, and everything after it is report + actors + damage table + events per pull, at
// high single-digit points each. A scheduled refresh that re-measures the same top-of-ladder pulls every
// week pays full freight, every week, for data it already has.
//
// This is the ledger that stops it. Every pull the sweep has ever resolved is recorded here by an opaque
// key — **measured, gated out, or permanently broken alike** — and the planner drops any candidate it
// already knows before a single point is spent. Steady-state cost becomes "the pulls that entered the
// ladder since last week", which is usually a handful, and a re-run minutes later costs the 42 queries
// and nothing else.
//
// ------------------------------------------------------------------ it is also the accumulating dataset
//
// The same file is what the table is built from, and that is deliberate rather than convenient. The
// grading lines are meant to be live: as more kills are logged the reference should follow them. Holding
// the evidence in one committed, append-only file means `n` grows monotonically, the growth is visible in
// a pull request, and a scheduled run that only gets a third of the way through has still advanced the
// table by a third.
//
// **The staleness this buys, stated rather than hidden.** Accumulating for ever means an old kill never
// leaves, so the reference drifts toward all-time rather than current form. That is the right default for
// a finished raid tier — a heroic Malkorok kill is as valid a year later — and the wrong one for a live
// tier where gear inflates. `--since=` prunes by sweep date when that day comes.
//
// ------------------------------------------------------------------ no names, and no report codes
//
// This repository is public. The rows below describe real players' performances, so nothing here carries
// a character name or a report code: identity survives only as a one-way key, which is all the two
// consumers need. Dedup needs to know *whether* it has seen a pull, never which one; the variance split
// needs to know which rows share a player, never who. Both work on a hash.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The committed evidence. Beside the table it produces, because they are refreshed by one command. */
export const LEDGER = resolve(ROOT, 'src/generated/reference-pulls.json');

const digest = (parts) => createHash('sha256').update(parts.join(' ')).digest('hex');

/**
 * A pull's identity, one-way.
 *
 * Sixteen hex characters — 64 bits, which is far more than a few thousand rows need to avoid a collision
 * and short enough to keep the file readable. It hashes the report code, the fight and the player
 * together, so two players in the same pull are two rows, which is what the sweep measures.
 */
export function pullKeyOf({ code, fightID, player }) {
	return digest([code, String(fightID), player]).slice(0, 16);
}

/**
 * A player's identity across reports, one-way.
 *
 * Separate from `pullKeyOf` because the variance split needs rows that share a player to *look* like they
 * share a player — the whole crossed-subset guard is counting how many encounters one person covers. A
 * per-report key would make every pull a different person and quietly turn the split back into the
 * degrees-of-freedom artefact it is written to avoid.
 */
export function playerKeyOf(player) {
	return digest(['player', player]).slice(0, 12);
}

/**
 * Which generation of `analyse()` produced a stored value.
 *
 * **Bump this whenever a change moves `gcdUtilisationPct`, and treat forgetting to as a real bug.** The
 * ledger's whole premise is that a pull measured once never needs measuring again — which is true of the
 * *pull* and false of the *metric*. When the enforced-downtime registry gained three rules, Fallen
 * Protectors' p90 moved 7.99 points; every value stored before that was suddenly a reading of a
 * different quantity, and averaging the two generations in one cell would have produced a number that
 * described neither.
 *
 * Rows carrying an older rev are excluded from the table and, because they are also excluded from the
 * known-keys set, are re-fetched by the next run. That is expensive and it is supposed to be: changing
 * what the metric means costs a re-sweep, and the alternative is a table that is quietly wrong.
 *
 * The value is a date plus what changed, because a bare integer tells the next person nothing about
 * which of their assumptions it invalidated.
 */
export const ANALYSER_REV = '2026-08-27-enforced-downtime';

/**
 * The id a cell is counted under, whichever era the row was written in.
 *
 * **Two conventions are already in the committed ledger, and normalising on read is cheaper than
 * rewriting it.** Rows seeded from the first sweeps carry WarcraftLogs' Classic id (51593); rows written
 * since carry the base id the job was planned with (1593). `tableFrom` already reduces both, so the
 * *table* was always right — but `needBy` grouped on the raw value, so one encounter counted as two
 * half-full cells and the planner kept buying for a cell already at target.
 *
 * Duplicated from `build-reference-tables.mjs` rather than imported: that module imports this one, and a
 * cycle would be a far worse problem than one repeated constant.
 */
const CLASSIC_OFFSET = 50_000;
export const cellKeyOf = (encounterID) => encounterID % CLASSIC_OFFSET;

/**
 * The parse bands a cell is bucketed by, as `[lo, hi)` percentile pairs.
 *
 * Mirrors `BANDS` in `build-reference-tables.mjs`, which owns the row arithmetic that turns these into
 * ladder positions. Restated rather than imported because that module imports this one, and a cycle
 * would be worse than a duplicated pair of numbers — `harness.test.ts` asserts the two agree.
 *
 * **Buckets are per band, not per cell, and that is what keeps the window honest.** A cell-wide window
 * would let a run that happened to fetch ten top-band pulls evict every low-band pull it had, turning a
 * ladder-spread reference into a top-parse one without anybody choosing that.
 */
export const BAND_EDGES = [
	[0, 50],
	[50, 75],
	[75, 90],
	[90, 101],
];

/** Which bucket a parse belongs to. Unranked pulls fall in the bottom band rather than a fifth one. */
export function bandOf(rankPercent) {
	const pct = rankPercent ?? 0;
	const found = BAND_EDGES.find(([lo, hi]) => pct >= lo && pct < hi);
	return found === undefined ? '0-50' : `${found[0]}-${found[1] > 100 ? 100 : found[1]}`;
}

/**
 * How many pulls a band's bucket holds, and why the number grows.
 *
 * A fixed window keeps the reference current but never gets more precise: `p90` off forty pulls carries
 * the same sampling error next year as it does today. So capacity rises a little each refresh, to a cap —
 * newer parses still evict older ones, but the sample the estimate is drawn from widens, and the interval
 * around `good` genuinely narrows instead of merely staying put.
 *
 * The cap exists because the return diminishes fast and the cost does not: each extra slot is a pull
 * bought on every cell, on every refresh, for ever.
 */
export const BAND_START = 10;
export const BAND_GROWTH = 2;
export const BAND_CAP = 25;

export const grownCapacity = (current) => Math.min(BAND_CAP, (current ?? BAND_START) + BAND_GROWTH);

/** An empty ledger, in the shape a fresh checkout would find. */
export const EMPTY = { builtAt: null, bandCapacity: BAND_START, pulls: [] };

export function readLedger(path = LEDGER) {
	if (!existsSync(path)) return EMPTY;
	const parsed = JSON.parse(readFileSync(path, 'utf8'));
	return {
		builtAt: parsed.builtAt ?? null,
		bandCapacity: parsed.bandCapacity ?? BAND_START,
		pulls: parsed.pulls ?? [],
	};
}

export function writeLedger(ledger, path = LEDGER) {
	writeFileSync(path, `${JSON.stringify(ledger, null, '\t')}\n`);
}

/**
 * One swept pull, stripped of everything that names anybody.
 *
 * `outcome` is what the row is *for*: `measured` rows build the table, and the rest exist only to stop
 * the planner buying them again. A pull that was off-spec last week is off-spec this week, and finding
 * that out costs the same points as measuring a good one.
 */
export function rowFrom(pull, outcome = 'measured', rev = ANALYSER_REV) {
	return {
		key: pullKeyOf(pull),
		rev,
		playerKey: playerKeyOf(pull.player),
		spec: pull.spec,
		encounterID: pull.encounterID,
		encounterName: pull.encounterName,
		value: pull.value,
		rankPercent: pull.rankPercent ?? null,
		/** Which bucket this pull occupies. Stored rather than derived so a band edge change is visible. */
		band: bandOf(pull.rankPercent),
		/** Epoch ms of the kill. The sliding window retires the oldest, never the least recently fetched. */
		loggedAt: pull.loggedAt ?? null,
		isSpec: pull.isSpec,
		kill: pull.kill,
		difficulty: pull.difficulty,
		durationMs: pull.durationMs,
		contactShare: pull.contactShare,
		deaths: pull.deaths,
		outcome,
	};
}

/**
 * Everything the ledger has an answer for, as keys.
 *
 * The planner's whole optimisation is one `has()` against this. Failures are in it too — a report that
 * is archived, private or malformed is archived, private and malformed next week as well, and retrying
 * it on every scheduled run is a standing bill for a known answer. `--retry-failed` is the escape.
 */
export function knownKeys(ledger, { retryFailed = false } = {}) {
	return new Set(
		ledger.pulls
			.filter((row) => row.rev === ANALYSER_REV)
			.filter((row) => !(retryFailed && row.outcome === 'failed'))
			.map((row) => row.key),
	);
}

/**
 * The buckets a ledger holds, keyed `spec:cell:band`, each sorted oldest first.
 *
 * Only measured rows: a retired or gated row still blocks re-buying but is not evidence.
 */
export function bucketsOf(ledger) {
	const buckets = new Map();
	for (const row of measuredPulls(ledger)) {
		const key = `${row.spec}:${cellKeyOf(row.encounterID)}:${row.band ?? bandOf(row.rankPercent)}`;
		if (!buckets.has(key)) buckets.set(key, []);
		buckets.get(key).push(row);
	}
	// Nulls first: a row with no log date predates the field, so it is the oldest thing in the bucket and
	// the first thing a growing window should replace.
	for (const rows of buckets.values()) {
		rows.sort((a, b) => (a.loggedAt ?? -Infinity) - (b.loggedAt ?? -Infinity));
	}
	return buckets;
}

/**
 * Retire whatever a bucket no longer has room for, oldest kill first.
 *
 * **Retired rather than deleted, and the difference is the whole point.** A deleted row leaves the
 * planner's known-keys set, so the next run buys the same pull again, evicts something to make room, and
 * pays for that cycle every week for ever. A retired row stays in the ledger as a tombstone: it is not
 * evidence, and it is not for sale.
 */
export function retire(ledger, capacity) {
	const doomed = new Set();
	for (const rows of bucketsOf(ledger).values()) {
		if (rows.length <= capacity) continue;
		for (const row of rows.slice(0, rows.length - capacity)) doomed.add(row.key);
	}
	if (doomed.size === 0) return { ledger, retired: 0 };
	return {
		ledger: {
			...ledger,
			pulls: ledger.pulls.map((row) => (doomed.has(row.key) ? { ...row, outcome: 'retired' } : row)),
		},
		retired: doomed.size,
	};
}

/** The rows the table is built from: measured by the current analyser, and nothing else. */
export function measuredPulls(ledger) {
	return ledger.pulls.filter((row) => row.outcome === 'measured' && row.rev === ANALYSER_REV);
}

/** Rows the current analyser would read differently, waiting to be re-measured. */
export function stalePulls(ledger) {
	return ledger.pulls.filter((row) => row.rev !== ANALYSER_REV);
}

/**
 * Fold a run's results into the ledger, newest wins on a repeat key.
 *
 * A repeat should not happen — the planner drops known keys before fetching — but a re-measure is the
 * right resolution if one does: the later reading came from the later code, and a metric whose
 * definition has changed should not have two generations of it averaged together in one cell.
 */
export function mergeLedger(ledger, rows) {
	const byKey = new Map(ledger.pulls.map((row) => [row.key, row]));
	for (const row of rows) byKey.set(row.key, row);
	return { ...ledger, pulls: [...byKey.values()] };
}

/**
 * Whether a candidate is worth buying, given what its bucket already holds.
 *
 * Three answers, and the third is the one that stops a sliding window costing money for ever:
 *
 * - the bucket has room, so buy it;
 * - the bucket is full and this parse is **newer** than its oldest, so buy it and let that one retire;
 * - the bucket is full and this parse is **older** than everything in it, so do not buy it at all.
 *
 * That last case is decided *before* a point is spent, because the ranking row carries the kill's date.
 * Without it a full bucket would re-buy the same ladder positions every week and evict at random.
 */
export function wantsOf(ledger, capacity) {
	const buckets = bucketsOf(ledger);
	return (job) => {
		const band = bandOf(job.predictedRankPercent ?? job.rankPercent);
		const bucket = buckets.get(`${job.spec}:${cellKeyOf(job.encounterID)}:${band}`) ?? [];
		if (bucket.length < capacity) return { want: true, room: capacity - bucket.length };
		const oldest = bucket[0]?.loggedAt ?? -Infinity;
		const mine = job.loggedAt ?? -Infinity;
		return { want: mine > oldest, room: 0 };
	};
}

/**
 * How far each cell is from a full set of buckets, so a run short on points spends where it matters.
 *
 * **Order is a credit optimisation, not tidiness.** A budget-limited run gets through some prefix of the
 * list and stops; sorted by need, that prefix lifted the thinnest buckets rather than adding a
 * twenty-sixth pull to one that was already full.
 */
export function needBy(ledger, capacity = BAND_START) {
	const buckets = bucketsOf(ledger);
	return (job) => {
		const band = bandOf(job.predictedRankPercent ?? job.rankPercent);
		const bucket = buckets.get(`${job.spec}:${cellKeyOf(job.encounterID)}:${band}`) ?? [];
		return capacity - bucket.length;
	};
}

export function planJobs(ledger, jobs, { capacity = BAND_START, limit = Infinity, retryFailed = false } = {}) {
	const known = knownKeys(ledger, { retryFailed });
	const wants = wantsOf(ledger, capacity);
	const need = needBy(ledger, capacity);
	const fresh = jobs.filter((job) => !known.has(pullKeyOf(job)));
	const wanted = fresh.filter((job) => wants(job).want);
	wanted.sort((a, b) => need(b) - need(a));
	return {
		jobs: wanted.slice(0, limit),
		skippedKnown: jobs.length - fresh.length,
		skippedFull: fresh.length - wanted.length,
		deferred: Math.max(0, wanted.length - limit),
	};
}
