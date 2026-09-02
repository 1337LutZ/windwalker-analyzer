// The comparison, over the committed Windwalker captures rather than over invented objects.
//
// Six pre-analysed pulls already ship, which is what makes this cheap: `strong` against `poor` is a
// wide spread of two single-target kills, and `strong` against `cleave` crosses a reading boundary, so
// the metrics one of them was never asked have to come back as refusals rather than as numbers.

import { describe, expect, it } from 'vitest';

import { capturedAnalyses } from '~/lib/analysis/fixtures';
import { compare, ranked, TIE_BANDS, type Pull, identityFrom } from '~/lib/compare';
import { resolveBands } from '~/lib/view/targetMode';
import { getSpec } from '~/lib/spec';
import type { Analysis } from '~/lib/types';

// The registry's own entry, asserted the way every other suite in this tree asserts it: a missing
// spec is a broken registry, and the failure that follows names it either way.
const spec = getSpec('windwalker')!;
// Two spell ids can be one button — Jab has one per weapon type — and the registry is what says so.
const IDENTITY = identityFrom(spec.registry);

// Discovery hands back the file name, extension and all, and every reference below names a pull.
const CAPTURED = new Map(
	capturedAnalyses('windwalker').map(({ name, analysis }) => [name.replace(/\.json$/, ''), analysis]),
);

function captured(name: string): Analysis {
	const analysis = CAPTURED.get(name);
	if (analysis === undefined) {
		throw new Error(`no captured windwalker fixture ${name} — there are ${[...CAPTURED.keys()].join(', ')}`);
	}
	return analysis;
}

/** A pull read the way the report reads it: its own detected bands, nothing forced. */
function pull(name: string): Pull {
	const analysis = captured(name);
	const view = resolveBands(analysis.targets, 'auto', analysis.segments);
	return { analysis, scorecard: spec.score(analysis, view), view };
}

/**
 * The same pull, read at a target count the reader forced rather than the one it detected.
 *
 * The app offers this on every report, and it is the only way the committed captures reach an exempt
 * metric: every one of them touched one target at some point, so a rule scoped to a single target
 * applies to all six under their own readings. Forcing the multi-target list drops band 1 from the
 * reading, and `tigerPalmWaste` is then a rule this pull was never asked.
 */
function forcedMulti(name: string): Pull {
	const analysis = captured(name);
	const view = resolveBands(analysis.targets, 'multi', analysis.segments);
	return { analysis, scorecard: spec.score(analysis, view), view };
}

const strongVsPoor = compare(pull('strong'), pull('poor'), IDENTITY);
const strongVsCleave = compare(pull('strong'), pull('cleave'), IDENTITY);
// One side read at the count it detected, the other forced onto the multi-target list.
const acrossReadings = compare(pull('strong'), forcedMulti('cleave'), IDENTITY);

describe('framing', () => {
	it('carries the identity of each pull from its own analysis', () => {
		expect(strongVsPoor.a.player).toBe(captured('strong').player);
		expect(strongVsPoor.b.player).toBe(captured('poor').player);
		expect(strongVsPoor.a.encounter).toBe('Garrosh Hellscream');
		expect(strongVsPoor.b.encounter).toBe('Malkorok');
	});

	it('carries the judged share, so a verdict is not read as a whole-spec one', () => {
		expect(strongVsPoor.a.judged?.total).toBeGreaterThan(0);
		expect(strongVsPoor.a.judged?.measured).toBeLessThanOrEqual(strongVsPoor.a.judged?.total ?? 0);
	});
});

describe('comparability notes', () => {
	it('names two different bosses', () => {
		expect(strongVsPoor.notes.map((note) => note.kind)).toContain('encounter');
	});

	it('names a pull that ran much longer than the other', () => {
		// Garrosh at 535s against Malkorok at 255s is more than twice the length.
		expect(strongVsPoor.notes.map((note) => note.kind)).toContain('duration');
	});

	it('names a reading the two pulls do not share', () => {
		// `mixed` reached one target only; `poor` reached two. Both are single-target pulls by mode, so
		// the mode alone would have called them the same reading.
		expect(compare(pull('mixed'), pull('poor'), IDENTITY).notes.map((note) => note.kind)).toContain('bands');
		expect(acrossReadings.notes.map((note) => note.kind)).toContain('bands');
	});

	it('says nothing about a pull compared with itself', () => {
		expect(compare(pull('strong'), pull('strong'), IDENTITY).notes).toEqual([]);
	});
});

describe('metric gaps', () => {
	it('finds real differences between a strong pull and a poor one', () => {
		const gaps = strongVsPoor.sections.flatMap((section) => section.metrics);
		expect(gaps.filter((gap) => gap.bands !== null).length).toBeGreaterThan(0);
		expect(gaps.some((gap) => gap.leader !== null)).toBe(true);
	});

	it('reports every metric as level when a pull is compared with itself', () => {
		const self = compare(pull('strong'), pull('strong'), IDENTITY);
		for (const gap of self.sections.flatMap((section) => section.metrics)) {
			if (gap.bands !== null) expect(gap.bands).toBe(0);
			expect(gap.leader).toBeNull();
		}
		expect(self.tally.a).toBe(0);
		expect(self.tally.b).toBe(0);
	});

	it('refuses rather than differences a metric one pull was never asked', () => {
		const exempt = acrossReadings.sections.flatMap((section) => section.metrics).filter((gap) => gap.why === 'exempt');
		// One side is read at a target count the other was not, so a banded rule applies to one of them
		// and not the other. Each such row must carry a reason, a side, and no number.
		expect(exempt.length).toBeGreaterThan(0);
		for (const gap of exempt) {
			expect(gap.bands).toBeNull();
			expect(gap.leader).toBeNull();
			expect(gap.whySide).toBe('b');
		}
	});

	it('never carries both a number and a reason', () => {
		for (const gap of strongVsCleave.sections.flatMap((section) => section.metrics)) {
			expect(gap.bands === null).toBe(gap.why !== null);
		}
	});
});

describe('section gaps', () => {
	it('carries the widest figure in the section, and only as a sort key', () => {
		for (const section of strongVsPoor.sections) {
			const comparable = section.metrics.filter((gap) => gap.bands !== null).map((gap) => Math.abs(gap.bands ?? 0));
			if (comparable.length === 0) {
				expect(section.bands).toBeNull();
				continue;
			}
			expect(Math.abs(section.bands ?? 0)).toBeCloseTo(Math.max(...comparable));
		}
	});

	/**
	 * The case the chart was rebuilt for, and it is the first row rather than a corner.
	 *
	 * Snapshots on `strong` against `poor` has the first pull ahead on the catch rate and behind on the
	 * depth. One signed bar could only ever have shown one of those, which is why the section is now
	 * drawn as a dot per figure rather than as a bar at its worst.
	 */
	it('holds a section whose figures lead in both directions', () => {
		const split = strongVsPoor.sections.filter((section) => {
			const leaders = new Set(section.metrics.map((gap) => gap.leader).filter((side) => side !== null));
			return leaders.size === 2;
		});
		expect(split.length).toBeGreaterThan(0);
		expect(split.map((section) => section.key)).toContain('snapshots');
	});

	it('leaves a section with nothing comparable with nothing to sort on', () => {
		for (const section of acrossReadings.sections) {
			if (section.metrics.every((gap) => gap.bands === null)) expect(section.bands).toBeNull();
		}
	});

	it('never takes its figure from a metric that was refused', () => {
		// Not asked is not a tie and not a loss, so an exempt row cannot be what puts a section up the
		// list. Every section's figure has to match some comparable metric in it.
		for (const section of acrossReadings.sections) {
			if (section.bands === null) continue;
			const comparable = section.metrics.filter((gap) => gap.bands !== null);
			expect(comparable.some((gap) => gap.bands === section.bands)).toBe(true);
		}
	});
});

describe('tally', () => {
	it('accounts for every metric exactly once', () => {
		const { a, b, level, incomparable } = strongVsCleave.tally;
		const metrics = strongVsCleave.sections.reduce((count, section) => count + section.metrics.length, 0);
		expect(a + b + level + incomparable).toBe(metrics);
	});

	it('keeps what could not be compared out of the level count', () => {
		// A pair neither pull could answer has not tied. Folding the two together would report
		// agreement the logs never established.
		expect(strongVsCleave.tally.incomparable).toBeGreaterThan(0);
	});
});

describe('abilities and casts', () => {
	it('differences damage by share of the damage each player did', () => {
		const blackoutKick = strongVsPoor.abilities.find((ability) => ability.name === 'Blackout Kick');
		expect(blackoutKick).toBeDefined();
		expect(blackoutKick?.sharePoints).toBeCloseTo((blackoutKick?.a?.share ?? 0) - (blackoutKick?.b?.share ?? 0));
	});

	it('sorts both lists by how far apart the two pulls are', () => {
		const shares = strongVsPoor.abilities.map((ability) => Math.abs(ability.sharePoints));
		expect([...shares].sort((one, two) => two - one)).toEqual(shares);
		const rates = strongVsPoor.casts.map((row) => Math.abs(row.cpm));
		expect([...rates].sort((one, two) => two - one)).toEqual(rates);
	});

	it('keeps an ability only one pull pressed, with the other side left null', () => {
		const oneSided = strongVsPoor.casts.filter((row) => row.a === null || row.b === null);
		for (const row of oneSided) {
			expect(row.name).not.toBe('');
			// Nothing to agree on, so no gate is asserted.
			expect(row.gate).toBeNull();
		}
	});

	it('reports no movement at all against itself', () => {
		const self = compare(pull('strong'), pull('strong'), IDENTITY);
		for (const ability of self.abilities) expect(ability.sharePoints).toBeCloseTo(0);
		for (const row of self.casts) expect(row.cpm).toBeCloseTo(0);
	});
});

describe('order', () => {
	it('keeps the section order the scorecard itself uses', () => {
		expect(strongVsPoor.sections.map((section) => section.key)).toEqual(
			Object.keys(spec.score(captured('strong'), resolveBands(captured('strong').targets, 'auto')).sections),
		);
	});

	it('ranks a copy widest first, leaving the report order alone', () => {
		const order = strongVsPoor.sections.map((section) => section.key);
		const widths = ranked(strongVsPoor.sections).map((section) => Math.abs(section.bands ?? 0));
		expect([...widths].sort((one, two) => two - one)).toEqual(widths);
		expect(strongVsPoor.sections.map((section) => section.key)).toEqual(order);
	});
});

describe('direction', () => {
	it('negates every figure when the two sides swap', () => {
		const forward = compare(pull('strong'), pull('poor'), IDENTITY);
		const back = compare(pull('poor'), pull('strong'), IDENTITY);
		for (const [at, section] of forward.sections.entries()) {
			const mirrored = back.sections[at];
			expect(mirrored?.key).toBe(section.key);
			if (section.bands === null) expect(mirrored?.bands).toBeNull();
			else expect(mirrored?.bands).toBeCloseTo(-section.bands);
		}
		expect(back.tally.a).toBe(forward.tally.b);
		expect(back.tally.b).toBe(forward.tally.a);
		expect(back.tally.level).toBe(forward.tally.level);
		expect(back.tally.incomparable).toBe(forward.tally.incomparable);
	});

	it('keeps the tie width symmetric, so neither side is favoured by rounding', () => {
		expect(TIE_BANDS).toBeGreaterThan(0);
	});
});

describe('gear procs', () => {
	/**
	 * The block exists to hold the luck apart from the play, so the first thing to pin is that it is
	 * exactly the gear and nothing else.
	 *
	 * Combo Breaker is the row that makes this a real test rather than a tautology. It is drawn in the
	 * same `proc` group as the trinkets on the timeline, because it is not a press either. But it is
	 * the monk's own passive, it fires off their own presses, and a table calling it luck would be
	 * telling a reader that a chunk of their rotation happened to them. Focus of Xuen is the second:
	 * gear, and a tier bonus a rotation earns by spending its own brew stacks. Neither is a roll.
	 */
	it('takes the item effects and leaves the class procs alone', () => {
		const keys = strongVsPoor.procs.map((proc) => proc.key);
		expect(keys).toContain('re-origination');
		expect(keys).toContain('capacitance');
		expect(keys).toContain('flurry-of-xuen');
		expect(keys).toContain('dancing-steel');
		expect(keys).not.toContain('combo-breaker-tiger-palm');
		expect(keys).not.toContain('combo-breaker-blackout-kick');
		expect(keys).not.toContain('focus-of-xuen');
	});

	/**
	 * A rate and nothing else, on the rule the two lists above this one already follow.
	 *
	 * `strong` rolled the Rune 16 times over 8:55 and `poor` 9 times over 4:15, which is 1.86 a minute
	 * against 2.14: nearly twice the count on the pull that was slightly unluckier per minute. A raw
	 * count would have answered a question about how long the boss lived.
	 */
	it('publishes a rate and never a raw count', () => {
		for (const proc of strongVsPoor.procs) {
			if (proc.a !== null) expect(proc.a).toBeGreaterThan(0);
			if (proc.b !== null) expect(proc.b).toBeGreaterThan(0);
			expect(proc.rate).toBeCloseTo((proc.a ?? 0) - (proc.b ?? 0));
			expect(Object.keys(proc)).not.toContain('aCount');
		}
		const rune = strongVsPoor.procs.find((proc) => proc.key === 're-origination');
		expect(rune?.a).toBeCloseTo(1.86, 2);
		expect(rune?.b).toBeCloseTo(2.14, 2);
	});

	/**
	 * Two pulls in different trinkets, which the committed captures happen to provide.
	 *
	 * `strong` wears Haromm's Talisman and `mixed` wears Sigil of Rampage, so each side carries a proc
	 * the other has no row for at all. That absence is marked rather than left as a nought, because a
	 * bare `0.0` beside a real reading reads as bad luck and this one is a different item.
	 */
	it('marks the side with no row rather than reading it as a nought', () => {
		const across = compare(pull('strong'), pull('mixed'), IDENTITY);
		const vicious = across.procs.find((proc) => proc.key === 'vicious');
		const ferocity = across.procs.find((proc) => proc.key === 'ferocity');

		expect(vicious?.absent).toBe('b');
		expect(vicious?.b).toBeNull();
		expect(ferocity?.absent).toBe('a');
		expect(ferocity?.a).toBeNull();
		// And a proc both wore is not marked at all.
		expect(across.procs.find((proc) => proc.key === 're-origination')?.absent).toBeNull();
	});

	/** Widest gap first, the way the cast and damage lists are ranked, and for the same reason. */
	it('ranks the rows by how far apart the two pulls fell', () => {
		const gaps = strongVsPoor.procs.map((proc) => Math.abs(proc.rate));
		expect([...gaps].sort((one, two) => two - one)).toEqual(gaps);
	});

	/**
	 * And none of it reaches a verdict.
	 *
	 * The whole argument for drawing this block is that a proc rate is not a decision, so a run of it
	 * must not move the tally, the sections or the headline. Compared against the same pair with the
	 * procs read: identical scoring either way.
	 */
	it('stays out of the scoring entirely', () => {
		expect(strongVsPoor.procs.length).toBeGreaterThan(0);
		const metrics = strongVsPoor.sections.flatMap((section) => section.metrics.map((gap) => gap.key));
		for (const proc of strongVsPoor.procs) expect(metrics).not.toContain(proc.key);
		expect(
			strongVsPoor.tally.a + strongVsPoor.tally.b + strongVsPoor.tally.level + strongVsPoor.tally.incomparable,
		).toBe(metrics.length);
	});

	it('negates every rate when the two sides swap', () => {
		const back = compare(pull('poor'), pull('strong'), IDENTITY);
		for (const proc of strongVsPoor.procs) {
			const mirrored = back.procs.find((row) => row.key === proc.key);
			expect(mirrored?.rate).toBeCloseTo(-proc.rate);
			expect(mirrored?.a).toBe(proc.b);
			expect(mirrored?.b).toBe(proc.a);
		}
	});
});
