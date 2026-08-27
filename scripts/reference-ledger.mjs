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

/** An empty ledger, in the shape a fresh checkout would find. */
export const EMPTY = { builtAt: null, pulls: [] };

export function readLedger(path = LEDGER) {
	if (!existsSync(path)) return EMPTY;
	const parsed = JSON.parse(readFileSync(path, 'utf8'));
	return { builtAt: parsed.builtAt ?? null, pulls: parsed.pulls ?? [] };
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
 * How far each cell is from the target, so a run short on points spends them where they matter.
 *
 * **Order is a credit optimisation, not a tidiness one.** A budget-limited run gets through some prefix
 * of the job list and stops; if that prefix is sorted by need, the run lifted the three cells sitting at
 * n=2 instead of adding a forty-first pull to a cell that was already fine. Over a few weeks this is the
 * difference between a table that fills out and one that fills out lopsidedly.
 */
export function needBy(ledger, targetN = Infinity) {
	const counts = new Map();
	for (const row of measuredPulls(ledger)) {
		const key = `${row.spec}:${cellKeyOf(row.encounterID)}`;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return (job) => targetN - (counts.get(`${job.spec}:${cellKeyOf(job.encounterID)}`) ?? 0);
}

/**
 * The jobs actually worth buying, in the order to buy them.
 *
 * Three filters, cheapest first: drop what the ledger already answers, drop cells that have reached the
 * target, then sort the rest by how badly their cell needs a pull. `limit` is the hard credit cap — the
 * caller's "spend no more than this many pulls' worth today".
 */
export function planJobs(ledger, jobs, { targetN = Infinity, limit = Infinity, retryFailed = false } = {}) {
	const known = knownKeys(ledger, { retryFailed });
	const need = needBy(ledger, targetN);
	const fresh = jobs.filter((job) => !known.has(pullKeyOf(job)));
	const wanted = fresh.filter((job) => need(job) > 0);
	wanted.sort((a, b) => need(b) - need(a));
	return {
		jobs: wanted.slice(0, limit),
		skippedKnown: jobs.length - fresh.length,
		skippedFull: fresh.length - wanted.length,
		deferred: Math.max(0, wanted.length - limit),
	};
}
