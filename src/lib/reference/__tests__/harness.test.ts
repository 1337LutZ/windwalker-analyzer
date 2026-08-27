// The reference harness, on the parts that decide what a grading line will say.
//
// `scripts/build-reference-tables.mjs` is a build-time script, so nothing in the app imports it and
// nothing else would notice it breaking. What it produces is `src/generated/reference.json`, which is
// where every encounter-anchored threshold comes from — so a silent fault here re-grades every report
// in the tree, and the failure would look like a scoring bug rather than a script bug.
//
// Four properties are worth a test, and they are the four a future edit is most likely to break.
//
// **The roster is discovered, not listed.** The whole "this runs for specs that do not exist yet" claim
// rests on parsing `SPECS` out of `registry.ts`, and that parse is a regex over source text — the same
// technique `build-spell-map.mjs` uses, and the same fragility. If `SpecDefinition` changes shape, this
// is the test that says so rather than the sweep silently covering two specs instead of three.
//
// **The band arithmetic is exact, not approximate.** `rankPercent = 100 × (1 − rank/totalParses)` and
// list position *is* rank. That pair is why a targeted sweep costs a fraction of a paged one, and it was
// verified at 143 of 143 across two live sweeps. It is asserted here against the observation that
// established it.
//
// **The gates reject for a stated reason.** Every one of them caught something real in the sweeps —
// seventeen off-spec ranked players, a rank-0 pull reading 94.52% off a fifth of a fight.
//
// **The output is a budget.** This script is run by agents as often as by people. One line per cell is a
// contract, and a future edit that starts printing per-pull rows should fail here rather than quietly
// cost a reader ten thousand tokens.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/** The table's shape, for the tests only — the script is `.mjs` and ships no types of its own. */
interface Cell {
	n: number;
	p50: number;
	p90: number;
}
interface Table {
	metric: string;
	specs: Record<string, { encounters: Record<string, Cell>; fallback: Cell | null; sourcePulls: number }>;
}

import {
	BANDS,
	ENCOUNTERS,
	GATES,
	METRIC,
	TARGET_N,
	cellOf,
	driftOf,
	gateOf,
	mergeTable,
	percentile,
	printTable,
	LADDER_PAGE_CAP,
	PAGE_SIZE,
	baseEncounterID,
	classicEncounterID,
	RAID_SIZE,
	rankPercentOf,
	registeredSpecs,
	rowsForBand,
	tableFrom,
} from '../../../../scripts/build-reference-tables.mjs';

/** A pull that clears every gate, so each test can spoil exactly one thing. */
const clean = (over: Record<string, unknown> = {}) => ({
	spec: 'windwalker',
	encounterID: 1595,
	code: 'abc',
	fightID: 1,
	player: 'Someone',
	value: 84.2,
	isSpec: true,
	kill: true,
	difficulty: 4,
	durationMs: 200_000,
	contactShare: 0.98,
	deaths: 0,
	...over,
});

describe('the roster, discovered rather than listed', () => {
	/**
	 * The claim the harness is sold on. `SpecDefinition` already carries WarcraftLogs' own spellings —
	 * `classKey` and `specName` are documented as exactly that — so a spec registered later is swept
	 * without an edit here.
	 */
	it('reads every registered spec out of the registry', () => {
		expect(registeredSpecs()).toEqual([
			{ key: 'windwalker', classKey: 'Monk', specName: 'Windwalker' },
			{ key: 'elemental', classKey: 'Shaman', specName: 'Elemental' },
			{ key: 'protection', classKey: 'Paladin', specName: 'Protection' },
		]);
	});

	/** A fourth spec is picked up with no change to the script — asserted rather than asserted-in-prose. */
	it('picks up a spec that does not exist yet', () => {
		const source = `${readFileSync(resolve(process.cwd(), 'src/lib/spec/registry.ts'), 'utf8')}
export const LATER: SpecDefinition[] = [
	{
		key: 'frost',
		classKey: 'Death Knight',
		classSlug: 'deathknight',
		specName: 'Frost',
	},
];`;
		expect(registeredSpecs(source).map((spec) => spec.key)).toContain('frost');
	});

	/** And a registry it cannot read is loud rather than empty — an empty sweep passes and measures nothing. */
	it('throws rather than sweeping nothing', () => {
		expect(() => registeredSpecs('export const SPECS = [];')).toThrow(/no specs found/);
	});
});

describe('the band arithmetic', () => {
	/**
	 * The observation the cheap sweep rests on, from the live run that established it: a Death Knight at
	 * rank 105 of 1059 parses reads `rankPercent` 90.
	 */
	it('reproduces the site’s own percentile', () => {
		expect(rankPercentOf(105, 1059)).toBe(90);
		expect(rankPercentOf(101, 1059)).toBe(90);
	});

	it('puts the top of the ladder at 100 and the bottom at 0', () => {
		expect(rankPercentOf(1, 1000)).toBe(99);
		expect(rankPercentOf(1000, 1000)).toBe(0);
	});

	/** A ladder nobody has parsed answers 0 rather than dividing by nothing. */
	it('survives an encounter with no parses', () => {
		expect(rankPercentOf(1, 0)).toBe(0);
	});

	it('turns a band into the list positions that fall inside it', () => {
		expect(rowsForBand(1000, 50, 75)).toEqual({ from: 250, to: 500 });
		expect(rowsForBand(1000, 90, 101)).toEqual({ from: 1, to: 100 });
	});

	/** Every row a band names is inside it, which is the property the sweep's 143-of-143 hit rate is. */
	it('names only rows that really land in the band', () => {
		const total = 873;
		for (const band of BANDS as unknown as ReadonlyArray<readonly [number, number]>) {
			const [lo, hi] = band;
			const { from, to } = rowsForBand(total, lo, hi) as { from: number; to: number };
			for (const row of [from, Math.floor((from + to) / 2), to]) {
				const got = rankPercentOf(row, total) as number;
				expect(got, `row ${row} for band ${lo}-${hi}`).toBeGreaterThanOrEqual(lo - 1);
				expect(got, `row ${row} for band ${lo}-${hi}`).toBeLessThanOrEqual(hi);
			}
		}
	});

	/** The bands tile the ladder — a gap would be a slice of the population no reference ever sees. */
	it('covers the whole ladder with no gap', () => {
		const bands = BANDS as unknown as ReadonlyArray<readonly [number, number]>;
		for (let i = 1; i < bands.length; i += 1) expect(bands[i]?.[0]).toBe(bands[i - 1]?.[1]);
		expect(bands[0]?.[0]).toBe(0);
		expect(bands.at(-1)?.[1]).toBeGreaterThan(100);
	});
});

describe('the gates', () => {
	it('keeps a pull that clears everything', () => {
		expect(gateOf(clean())).toBeNull();
	});

	/** WarcraftLogs' own spec label is not trustworthy enough — seventeen ranked players were off-spec. */
	it('rejects a pull the analyser says is a different spec', () => {
		expect(gateOf(clean({ isSpec: false }))).toBe('off-spec');
	});

	/**
	 * The gate that does the real work. A rank-0 kill read 94.52% off 32.7s of contact on a 260s fight —
	 * the figure describes the part of the pull the player was engaged for, which is the part they were
	 * freshest for.
	 */
	it('rejects a pull the player was barely present for', () => {
		expect(gateOf(clean({ contactShare: 0.126 }))).toBe('barely present');
		expect(gateOf(clean({ contactShare: GATES.minContactShare }))).toBeNull();
	});

	it('rejects a fight too short for its own denominator', () => {
		expect(gateOf(clean({ durationMs: 90_000 }))).toBe('too short');
	});

	/**
	 * **A death is annotated, not a rejection**, and this is the assertion that pins the reversal. The
	 * contact clock resumes after a death rather than ending, so a resurrected player's pull is a real
	 * reading — one measured pull died at 59s of 336s and still read 94.86% contact.
	 */
	it('keeps a pull the player died in', () => {
		expect(GATES.deaths).toBe('annotate');
		expect(gateOf(clean({ deaths: 2 }))).toBeNull();
	});
});

describe('the table', () => {
	const specs = [{ key: 'windwalker', classKey: 'Monk', specName: 'Windwalker' }];

	it('anchors on the distribution rather than the mean', () => {
		expect(cellOf([60, 62, 64, 66, 68, 70, 72, 90])).toEqual({ n: 8, p50: 67, p90: 77.4 });
	});

	it('answers null for a percentile of nothing', () => {
		expect(percentile([], 0.5)).toBeNull();
	});

	it('builds one cell per encounter, and a spec-wide fallback', () => {
		const table: Table = tableFrom(
			[
				clean({ encounterID: 1595, value: 88 }),
				clean({ encounterID: 1595, value: 90 }),
				clean({ encounterID: 1602, value: 61 }),
			],
			specs,
		);
		expect(table.specs['windwalker']?.encounters['1595']?.n).toBe(2);
		expect(table.specs['windwalker']?.encounters['1602']?.n).toBe(1);
		expect(table.specs['windwalker']?.fallback?.n).toBe(3);
		expect(table.metric).toBe(METRIC);
	});

	/** A gated pull informs nothing — it is not quietly averaged into the cell it came from. */
	it('leaves a gated pull out of every cell', () => {
		const table: Table = tableFrom([clean({ value: 88 }), clean({ value: 40, isSpec: false })], specs);
		expect(table.specs['windwalker']?.encounters['1595']).toMatchObject({ n: 1, p50: 88, p90: 88 });
	});

	it('covers all fourteen Siege encounters', () => {
		expect(ENCOUNTERS).toHaveLength(14);
		expect(new Set(ENCOUNTERS).size).toBe(14);
	});
});

describe('drift, which is what `--check` reports', () => {
	const specs = [{ key: 'windwalker', classKey: 'Monk', specName: 'Windwalker' }];
	const fresh = tableFrom([clean({ value: 88 })], specs);

	/** Nothing to say when nothing moved — the same contract `build-spell-map.mjs --check` has. */
	it('says nothing about a current table', () => {
		expect(driftOf(fresh, fresh)).toEqual([]);
	});

	it('names the cell that moved, and both its numbers', () => {
		const stale = tableFrom([clean({ value: 70 })], specs);
		expect(driftOf(stale, fresh)).toEqual(['windwalker 1595 p50 70->88 p90 70->88']);
	});

	it('names a cell the committed table has never seen', () => {
		expect(driftOf({ specs: {} }, fresh)).toEqual(['windwalker 1595 new n=1']);
	});
});

describe('the raid size, which is a query argument', () => {
	const raw = readFileSync(resolve(import.meta.dirname, '../../../../scripts/build-reference-tables.mjs'), 'utf8');
	/**
	 * Comments stripped before matching, because the file *documents* the bug it no longer has.
	 *
	 * The docstring beside `RAID_SIZE` quotes the old filter verbatim so the next reader knows what went
	 * wrong. A source assertion that did not strip comments would read that explanation as the defect and
	 * fail for ever — which is the exact way this kind of test gets deleted instead of fixed.
	 */
	const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

	/**
	 * ***The regression test for the bug that made every sweep return nothing.***
	 *
	 * `size` is not a field on a ranking entry. The filter used to read `entry.size < GATES.minRaidSize`,
	 * which evaluated `undefined ?? 0` to `0` for every candidate and discarded all 4,200 of them in
	 * silence — a clean run against a live API that ended in `no candidates found`. Asserted against the
	 * source because the failure had no observable symptom short of a live sweep.
	 */
	it('filters raid size in the query, never on the entry', () => {
		expect(source, 'the rankings query must carry a size argument').toMatch(/characterRankings\([^)]*size:/);
		expect(source, 'entry.size is always undefined — filter server-side').not.toMatch(/entry\.size/);
	});

	/**
	 * ***The era bug, and it is the one that cost the most to find.***
	 *
	 * `worldData.encounter(id: 1602)` and `encounter(id: 51602)` both answer "Immerseus" with a hundred
	 * rankings. The first is the **original 2014 Siege of Orgrimmar**; the second is **MoP Classic**. A
	 * sweep querying base ids fetched real August-2014 kills, analysed them cleanly, and gated every one
	 * as off-spec — correctly, because a 2014 log carries Tigereye Brew's original aura 125195 while this
	 * analyser knows the Classic id 1247279. Nothing in the output said it was reading a twelve-year-old
	 * raid.
	 *
	 * A cell is keyed on the base id and the API is asked for the Classic one. Both directions pinned,
	 * because a check that compared encounter *names* cleared this and it stayed broken.
	 */
	it('asks WarcraftLogs for the Classic encounter, not the 2014 one', () => {
		expect(classicEncounterID(1602)).toBe(51602);
		expect(baseEncounterID(classicEncounterID(1602))).toBe(1602);
		// Already-offset ids pass through, so a caller holding a fight's own id is not sent to 101602.
		expect(classicEncounterID(51602)).toBe(51602);
		expect(source, 'every rankings call goes through the offset').not.toMatch(/RANKINGS,\s*\{\s*\n\s*encounterID,/);
	});

	/** Twenty-five man heroic is what the reference describes; ten-man returns a different roster. */
	it('asks for the size the reference is about', () => {
		expect(RAID_SIZE).toBe(25);
	});

	/**
	 * `count` reads 100 on every page, so the depth the bands are cut against comes from the page cap
	 * rather than from a field. Pinned so a future edit does not quietly reintroduce `count` as a total.
	 */
	it('cuts bands against the reachable ladder, not a page count', () => {
		expect(LADDER_PAGE_CAP * PAGE_SIZE).toBe(2000);
		expect(source, 'count is the page size, never the population').not.toMatch(/payload\?\.count/);
	});
});

describe('the output budget', () => {
	/**
	 * **One line per cell, whatever the sample size**, plus a header. Asserted rather than trusted,
	 * because this script is read by agents and a per-pull print is a five-figure token bill that no
	 * type and no lint rule would catch.
	 */
	it('prints one line per cell however many pulls are behind it', () => {
		const specs = [{ key: 'windwalker', classKey: 'Monk', specName: 'Windwalker' }];
		const many = Array.from({ length: 400 }, (_, i) => clean({ value: 60 + (i % 30) }));
		const lines: string[] = [];
		const log = console.log;
		console.log = (line: string) => lines.push(line);
		try {
			printTable(tableFrom(many, specs), specs);
		} finally {
			console.log = log;
		}
		// One encounter in the fixture, so: a header and a single row, from four hundred pulls.
		expect(lines).toHaveLength(2);
		expect(lines[1]).toContain('windwalker');
	});

	/** A cell under the target says so on its own line rather than in a separate report. */
	it('marks a thin cell inline', () => {
		const specs = [{ key: 'windwalker', classKey: 'Monk', specName: 'Windwalker' }];
		const lines: string[] = [];
		const log = console.log;
		console.log = (line: string) => lines.push(line);
		try {
			printTable(tableFrom([clean()], specs), specs);
		} finally {
			console.log = log;
		}
		expect(TARGET_N).toBeGreaterThan(1);
		expect(lines[1]).toContain('thin');
	});
});

describe('a refresh of one spec', () => {
	const specs = [{ key: 'windwalker', classKey: 'Monk', specName: 'Windwalker' }];

	/**
	 * ***The bug this pins deleted two specs and looked like a success.*** A `--spec=` run built its
	 * table from the filtered roster and wrote the whole file, so refreshing one spec shipped a
	 * `reference.json` holding only that spec — and every other spec's grading lines silently fell back
	 * to their spec-wide distribution on every report. A one-spec refresh is the common case, so the
	 * partial path has to be the safe one.
	 */
	it('keeps the specs it did not sweep', () => {
		const committed: Table = tableFrom(
			[clean({ spec: 'windwalker', value: 84 }), clean({ spec: 'protection', encounterID: 1602, value: 70 })],
			[...specs, { key: 'protection', classKey: 'Paladin', specName: 'Protection' }],
		);
		const fresh: Table = tableFrom([clean({ spec: 'windwalker', value: 90 })], specs);
		const merged: Table = mergeTable(committed, fresh);

		expect(Object.keys(merged.specs).sort()).toEqual(['protection', 'windwalker']);
		expect(merged.specs['protection']?.encounters['1602']?.p50).toBe(70);
		expect(merged.specs['windwalker']?.encounters['1595']?.p50).toBe(90);
	});

	/** And a first run, with nothing committed, is not a special case. */
	it('writes a fresh table when none exists', () => {
		const fresh: Table = tableFrom([clean({ value: 84 })], specs);
		expect(mergeTable({ specs: {} }, fresh).specs['windwalker']?.sourcePulls).toBe(1);
	});
});
