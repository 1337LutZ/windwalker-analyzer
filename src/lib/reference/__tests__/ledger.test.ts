// The ledger, on the two things that make an automated refresh safe to leave running.
//
// **It must not spend.** The planner's job is to drop every candidate already answered before a point is
// bought, and a regression there is invisible: the sweep still works, the table still builds, and the
// only symptom is a bill. Nothing else in the tree would notice, so the assertions are here.
//
// **It must not name anybody.** The ledger is committed to a public repository and describes real
// players' pulls. Character names and report codes survive only as one-way keys, and a future edit that
// carries a name through — for debugging, for a nicer log line — is the kind of change that looks
// harmless in review. So the shape is asserted rather than trusted.

import { describe, expect, it } from 'vitest';

import { BANDS } from '../../../../scripts/build-reference-tables.mjs';
import {
	ANALYSER_REV,
	BAND_CAP,
	BAND_EDGES,
	BAND_GROWTH,
	BAND_START,
	bandOf,
	bucketsOf,
	cellKeyOf,
	grownCapacity,
	knownKeys,
	measuredPulls,
	mergeLedger,
	needBy,
	planJobs,
	playerKeyOf,
	pullKeyOf,
	retire,
	rowFrom,
	stalePulls,
	wantsOf,
} from '../../../../scripts/reference-ledger.mjs';

/**
 * A candidate, in the shape the planner reads.
 *
 * `predictedRankPercent` and `loggedAt` are carried by default because buckets are per band and eviction
 * is by kill date — a job missing either lands in the bottom band with no age, which is a different
 * bucket from the one the fixtures below intend to fill.
 */
const job = (over: Record<string, unknown> = {}) => ({
	spec: 'windwalker',
	encounterID: 1595,
	code: 'AbcDef123',
	fightID: 7,
	player: 'Someone',
	predictedRankPercent: 99,
	loggedAt: 1_760_000_000_000,
	...over,
});

const pull = (over: Record<string, unknown> = {}) => ({
	...job(),
	encounterName: 'Immerseus',
	value: 80,
	rankPercent: 99,
	isSpec: true,
	kill: true,
	difficulty: 4,
	durationMs: 300_000,
	contactShare: 0.95,
	deaths: 0,
	...over,
});

const ledgerOf = (rows: ReturnType<typeof rowFrom>[]) => ({ builtAt: null, pulls: rows });

describe('what a row carries', () => {
	/** The privacy assertion, and it is deliberately blunt: the name must not appear anywhere in the row. */
	it('carries no character name and no report code', () => {
		const row = rowFrom(pull({ player: 'Thøth', code: 'LDkYypRT8a4XGM6v' }));
		const serialised = JSON.stringify(row);
		expect(serialised).not.toContain('Thøth');
		expect(serialised).not.toContain('LDkYypRT8a4XGM6v');
		expect(row).not.toHaveProperty('player');
		expect(row).not.toHaveProperty('code');
		expect(row).not.toHaveProperty('fightID');
	});

	/** Dedup depends on this being stable across runs, and across machines. */
	it('gives one pull one key, whoever asks', () => {
		expect(pullKeyOf(job())).toBe(pullKeyOf(job()));
		expect(pullKeyOf(job())).not.toBe(pullKeyOf(job({ fightID: 8 })));
	});

	/**
	 * **The player key is stable across reports, and that is a requirement rather than a nicety.** The
	 * variance split counts how many encounters one person covers; a key that changed per report would
	 * make every pull a different person and turn the split back into the degrees-of-freedom artefact the
	 * analysis harness exists to avoid.
	 */
	it('gives one player one key across different reports', () => {
		expect(playerKeyOf('Thøth')).toBe(playerKeyOf('Thøth'));
		expect(playerKeyOf('Thøth')).not.toBe(playerKeyOf('Someone'));
	});
});

describe('what the planner refuses to buy', () => {
	/** The headline: a candidate already in the ledger is never fetched again. */
	it('drops a candidate it has already measured', () => {
		const ledger = ledgerOf([rowFrom(pull())]);
		const planned = planJobs(ledger, [job(), job({ fightID: 8 })], { capacity: 40 });
		expect(planned.jobs).toHaveLength(1);
		expect(planned.jobs[0]?.fightID).toBe(8);
		expect(planned.skippedKnown).toBe(1);
	});

	/**
	 * A gated pull cost exactly what a good one cost. Remembering only the good ones would re-buy every
	 * off-spec ranked player, every week, for ever — and the sweeps found seventeen of those.
	 */
	it('drops a candidate it has already found to be off-spec', () => {
		const ledger = ledgerOf([rowFrom(pull({ isSpec: false }), 'gated')]);
		expect(planJobs(ledger, [job()], { capacity: 40 }).jobs).toHaveLength(0);
	});

	/** And a report that could not be read is just as expensive to re-discover. */
	it('drops a candidate that has already failed, unless asked to retry', () => {
		const ledger = ledgerOf([rowFrom(pull(), 'failed')]);
		expect(planJobs(ledger, [job()], { capacity: 40 }).jobs).toHaveLength(0);
		expect(planJobs(ledger, [job()], { capacity: 40, retryFailed: true }).jobs).toHaveLength(1);
	});

	/**
	 * A full bucket refuses a parse older than everything in it — an extra pull there is a pure cost, and
	 * the decision is made from the ranking row before anything is fetched.
	 */
	it('drops a candidate older than a full bucket', () => {
		const full = Array.from({ length: 4 }, (_, i) => rowFrom(pull({ fightID: i, loggedAt: 100 + i })));
		const planned = planJobs(ledgerOf(full), [job({ fightID: 99, loggedAt: 1 })], { capacity: 4 });
		expect(planned.jobs).toHaveLength(0);
		expect(planned.skippedFull).toBe(1);
	});

	/**
	 * **Order is the optimisation that matters when a run is cut short.** A budget-limited sweep gets
	 * through a prefix of the list, so the thinnest cell has to be at the front — otherwise weeks of
	 * partial runs top up cells that were already fine.
	 */
	it('buys the thinnest bucket first', () => {
		const ledger = ledgerOf([
			rowFrom(pull({ encounterID: 1595, loggedAt: 1 })),
			rowFrom(pull({ encounterID: 1595, fightID: 2, loggedAt: 2 })),
		]);
		const planned = planJobs(ledger, [job({ encounterID: 1595, fightID: 9 }), job({ encounterID: 1600, fightID: 9 })], {
			capacity: 40,
		});
		expect(planned.jobs[0]?.encounterID).toBe(1600);
	});

	/** The hard credit cap, and it reports what it put off rather than dropping it silently. */
	it('stops at the limit and says how many it deferred', () => {
		const jobs = Array.from({ length: 10 }, (_, i) => job({ fightID: i }));
		const planned = planJobs(ledgerOf([]), jobs, { capacity: 40, limit: 3 });
		expect(planned.jobs).toHaveLength(3);
		expect(planned.deferred).toBe(7);
	});

	/**
	 * ***Two id conventions live in the committed ledger, and counting them apart over-buys.***
	 *
	 * Rows seeded from the first sweeps carry WarcraftLogs' Classic id (51593); rows written since carry
	 * the base id the job was planned with (1593). `tableFrom` reduces both, so the table was always
	 * right — but the planner grouped on the raw value, so one encounter counted as two half-full cells
	 * and it kept buying pulls for a cell that had already reached the target.
	 */
	it('counts both id conventions as one cell', () => {
		expect(cellKeyOf(51593)).toBe(cellKeyOf(1593));
		const mixed = [rowFrom(pull({ encounterID: 51593 })), rowFrom(pull({ encounterID: 1593, fightID: 2 }))];
		expect(needBy(ledgerOf(mixed), 40)(job({ encounterID: 1593 }))).toBe(38);
		expect(needBy(ledgerOf(mixed), 40)(job({ encounterID: 51593 }))).toBe(38);
	});

	it('counts what a cell still needs', () => {
		const ledger = ledgerOf([rowFrom(pull()), rowFrom(pull({ fightID: 2 }))]);
		expect(needBy(ledger, 40)(job())).toBe(38);
		expect(needBy(ledger, 40)(job({ encounterID: 9999 }))).toBe(40);
	});
});

describe('a value measured by an older analyser', () => {
	const stale = { ...rowFrom(pull()), rev: '2020-01-01-something-else' };

	/** It must not reach the table: two generations averaged in one cell describe neither. */
	it('is excluded from the table', () => {
		expect(measuredPulls(ledgerOf([stale]))).toHaveLength(0);
		expect(stalePulls(ledgerOf([stale]))).toHaveLength(1);
	});

	/** And it must not count as known, or it would never be corrected. */
	it('is bought again rather than trusted', () => {
		expect(knownKeys(ledgerOf([stale]))).not.toContain(stale.key);
		expect(planJobs(ledgerOf([stale]), [job()], { capacity: 40 }).jobs).toHaveLength(1);
	});

	/** A row from the current analyser is the opposite of all that. */
	it('is kept when it is current', () => {
		const fresh = rowFrom(pull());
		expect(fresh.rev).toBe(ANALYSER_REV);
		expect(measuredPulls(ledgerOf([fresh]))).toHaveLength(1);
	});
});

describe('folding a run in', () => {
	it('adds new rows and replaces a repeated key with the newer reading', () => {
		const before = ledgerOf([rowFrom(pull({ value: 70 }))]);
		const after = mergeLedger(before, [rowFrom(pull({ value: 85 })), rowFrom(pull({ fightID: 2 }))]);
		expect(after.pulls).toHaveLength(2);
		expect(after.pulls.find((row: { key: string; value: number }) => row.key === pullKeyOf(job()))?.value).toBe(85);
	});
});

describe('the sliding window', () => {
	const at = (loggedAt: number, over: Record<string, unknown> = {}) =>
		rowFrom(pull({ loggedAt, fightID: loggedAt, rankPercent: 99, ...over }));

	/** Band edges are restated in two files to avoid an import cycle; they must not drift apart. */
	it('bands agree with the row arithmetic', () => {
		expect(BAND_EDGES).toEqual(BANDS);
	});

	it('puts a parse in the band its percentile falls in', () => {
		expect(bandOf(99)).toBe('90-100');
		expect(bandOf(90)).toBe('90-100');
		expect(bandOf(89)).toBe('75-90');
		expect(bandOf(0)).toBe('0-50');
		// An unranked pull is bottom-band rather than a fifth bucket nothing else knows about.
		expect(bandOf(null)).toBe('0-50');
	});

	/**
	 * **Buckets are per band, and that is what stops the window quietly becoming a top-parse reference.**
	 * A cell-wide window would let one run's ten top-band pulls evict every low-band pull it held.
	 */
	it('buckets by band, not by cell', () => {
		const ledger = ledgerOf([at(1, { rankPercent: 99 }), at(2, { rankPercent: 20 })]);
		expect([...bucketsOf(ledger).keys()].sort()).toEqual(['windwalker:1595:0-50', 'windwalker:1595:90-100']);
	});

	/** Oldest first, and a row with no log date is older than any row that has one. */
	it('orders a bucket oldest kill first', () => {
		const ledger = ledgerOf([at(300), at(100), rowFrom(pull({ fightID: 9, rankPercent: 99, loggedAt: null }))]);
		const bucket = bucketsOf(ledger).get('windwalker:1595:90-100');
		expect(bucket?.map((row: { loggedAt: number | null }) => row.loggedAt)).toEqual([null, 100, 300]);
	});

	/**
	 * ***Retired, not deleted.*** A deleted row leaves the known-keys set, so the next run buys the same
	 * pull again, evicts something to make room, and pays for that cycle every week for ever.
	 */
	it('retires the oldest past capacity, and keeps it unbuyable', () => {
		const ledger = ledgerOf([at(100), at(200), at(300)]);
		const { ledger: after, retired } = retire(ledger, 2);
		expect(retired).toBe(1);
		expect(measuredPulls(after).map((row: { loggedAt: number }) => row.loggedAt)).toEqual([200, 300]);
		expect(knownKeys(after).size, 'a retired pull must never be bought again').toBe(3);
	});

	it('retires nothing when the bucket has room', () => {
		expect(retire(ledgerOf([at(100), at(200)]), 10).retired).toBe(0);
	});

	/** The three answers the planner gives before a point is spent. */
	it('buys into a bucket with room', () => {
		expect(wantsOf(ledgerOf([at(100)]), 10)(job({ predictedRankPercent: 99, loggedAt: 50 })).want).toBe(true);
	});

	it('buys a newer parse into a full bucket', () => {
		const full = [at(100), at(200)];
		expect(wantsOf(ledgerOf(full), 2)(job({ predictedRankPercent: 99, loggedAt: 300 })).want).toBe(true);
	});

	/**
	 * The one that stops a sliding window costing money for ever: a full bucket refuses a parse older
	 * than everything in it, decided from the ranking row before anything is fetched.
	 */
	it('refuses a parse older than everything in a full bucket', () => {
		const full = [at(100), at(200)];
		expect(wantsOf(ledgerOf(full), 2)(job({ predictedRankPercent: 99, loggedAt: 50 })).want).toBe(false);
		expect(
			planJobs(ledgerOf(full), [job({ predictedRankPercent: 99, loggedAt: 50, fightID: 77 })], { capacity: 2 }).jobs,
		).toHaveLength(0);
	});

	/** Capacity rises each refresh so the estimate tightens, and stops rising so the cost does not. */
	it('grows capacity to a cap', () => {
		expect(grownCapacity(BAND_START)).toBe(BAND_START + BAND_GROWTH);
		expect(grownCapacity(BAND_CAP)).toBe(BAND_CAP);
		expect(grownCapacity(undefined)).toBe(BAND_START + BAND_GROWTH);
	});
});
