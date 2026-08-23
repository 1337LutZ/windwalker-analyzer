// Why the two Windwalker means carry no sample floor, settled with the six pulls' own numbers.
//
// `MIN_GRADED_SAMPLE` has closed three metrics now. `flameShockWaste` and `karmaEmpty` were shares
// built on the bare helper; `karmaCapShare` was a share whose ceiling was assembled out of the
// numerator's own largest term. Each time the sweep that followed asked the same question of
// `snapshotDepth` and `brewStacks` — the two graded values in this spec that are *means* rather than
// shares — and each time they were left, on the ground that a mean is not forced: the full range stays
// reachable at any denominator, so neither restates its own definition the way a one-press share does.
//
// **That disposed of the circularity charge and not the thin-sample one**, and the thin-sample one is
// what this file answers. It is a measurement, not an opinion, and it comes back negative in both
// cases — for two different reasons, and the second metric's reason is the stronger of the two.
//
// ## What the six pulls measure
//
//     metric          strong  mixed  poor  weave  cleave  waves     floor of three refuses
//     snapshotDepth       12      4     2      4       5      5     poor, and nothing else
//     brewStacks          16      7     6      5       6      9     nothing at all
//
// `poor` at two caught procs is the one committed pull either metric puts under the floor today, and
// it is a **real** capture rather than a hand edit — which is new for this section. `thinSample.test.ts`
// records that every witness it has for the snapshots is synthetic, and that is still true of
// `snapshotRate`, whose affordable-proc counts run 4 to 14. It is not true of the depth beside it.
//
// ## The two findings
//
//   1. **The floor's argument does not reach a mean.** `MIN_GRADED_SAMPLE` is three because a share
//      below three has no interior — the middle band is unreachable and every letter sits at an end of
//      the scale. Both means reach every letter off a single observation, and in both cases the letters
//      are occupied by observations the fixtures really hold rather than by hypotheticals.
//
//   2. **A floor of three would separate no pull from the instability it is supposed to prevent.** One
//      observation moves a mean of n by up to (range / n). Against a 15-point step on depth that is
//      every n below seven; against a one-stack step on brew stacks it is every n below eleven. Either
//      way that is five of the six committed pulls, and a floor of three refuses at most one of them.
//      The floors that would actually hold are seven and eleven, and each silences all but `strong`.
//
// ## What this file is not
//
// **No behaviour changes with it, so it cannot go red against the old scorer** — the same footing as
// the fixture-population guard in `__fixtures__/bands.test.ts`, and said out loud for the same reason.
// What it pins is the set of facts the decision rests on, so that a later reader who wants to add the
// floor meets the numbers rather than re-deriving them, and so that a fixture drifting out from under
// the argument fails here instead of quietly making it false.
//
// The red that does exist belongs to the road not taken, and it is recorded in the commit: routing
// either metric through a `sampleSize` breaks two suites whose arguments depend on these means staying
// measurable at two — `brewBankTimeline`'s fall-through arm, and the pull in `thinSample.test.ts` whose
// snapshots section stays measurable *because* depth is, which is what keeps `verdict()` off the
// never-arrived sentence.
//
// ## The finding that is not about samples at all
//
// `snapshotDepth` averages the procs the player caught, and which procs those are is what
// `snapshotRate` grades — so its denominator is selected by the sibling metric, and it runs backwards.
// `strong` caught 12 of 14 and grades `bad`; `poor` caught 2 of 8 and grades `good`. That inversion is
// pinned below because no sample floor removes it: it is there at twelve as plainly as at two.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { gradeOf, MIN_GRADED_SAMPLE, shareOf } from '~/lib/score';
import type { Analysis } from '~/lib/types';
import { scoreAnalysis, THRESHOLDS } from '~/specs/windwalker/lib/score';

const ALL = ['strong', 'mixed', 'poor', 'weave', 'cleave', 'waves'] as const;

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as Analysis;

const metricOn = (name: string, key: string) => {
	const card = scoreAnalysis(fixture(name));
	return Object.values(card.sections)
		.flatMap((section) => section.metrics)
		.find((m) => m.key === key);
};

/** Every depth the pull actually recorded, which is what `procs.meanDepthPct` is the mean of. */
const depthsOf = (name: string): number[] =>
	fixture(name)
		.procs.windows.map((w) => w.depthPct)
		.filter((d): d is number => d !== null);

const stacksOf = (name: string): number[] => fixture(name).brew.useList.map((u) => u.consumed);

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('the sample behind each Windwalker mean', () => {
	/**
	 * The premise every judgement below rests on, written out rather than described.
	 *
	 * `procs.snapshotted` is `snapshotDepth`'s denominator and `brew.uses` is `brewStacks`'. Both are
	 * asserted against the depths and the use list they are supposed to count, so a fixture whose
	 * summary drifts from its own rows fails here rather than making the argument quietly false.
	 */
	it('is two on one committed pull and five or more on every other', () => {
		const depth: Record<string, number> = {};
		const stacks: Record<string, number> = {};
		for (const name of ALL) {
			const analysis = fixture(name);
			expect(depthsOf(name).length, `${name} depths against snapshotted`).toBe(analysis.procs.snapshotted);
			expect(stacksOf(name).length, `${name} use list against uses`).toBe(analysis.brew.uses);
			depth[name] = analysis.procs.snapshotted;
			stacks[name] = analysis.brew.uses;
		}
		expect(depth).toEqual({ strong: 12, mixed: 4, poor: 2, weave: 4, cleave: 5, waves: 5 });
		expect(stacks).toEqual({ strong: 16, mixed: 7, poor: 6, weave: 5, cleave: 6, waves: 9 });
	});

	/**
	 * Which pulls a floor of three would refuse, and it is the whole case against declaring one.
	 *
	 * Exactly one on depth and none at all on brew stacks. A declaration that fires on a sixth of the
	 * committed set and on none of it respectively is the shape this project has shipped twice and named
	 * both times — the band-1 transcription in `__fixtures__/bands.test.ts`, whose verdicts were
	 * identical at all four target counts, and Entry 13's opener allowance in `shortBrews`, which would
	 * have fired on nothing because every first brew we hold lands after the window closes.
	 */
	it('puts one pull under a floor of three, and no pull at all on the brew mean', () => {
		expect(MIN_GRADED_SAMPLE).toBe(3);
		expect(ALL.filter((name) => fixture(name).procs.snapshotted < MIN_GRADED_SAMPLE)).toEqual(['poor']);
		expect(ALL.filter((name) => fixture(name).brew.uses < MIN_GRADED_SAMPLE)).toEqual([]);
	});

	/**
	 * And that one pull is graded today, off two procs, which is the fact worth stating plainly.
	 *
	 * A sample under three is not hypothetical on this metric — `poor` is at it, in a committed capture,
	 * and it is the pull the argument has to be good enough for.
	 */
	it('grades `poor`s depth off those two procs today', () => {
		const depth = metricOn('poor', 'snapshotDepth');
		expect(depth?.unmeasurable).toBe(false);
		expect(depth?.value).toBeCloseTo(86.13, 2);
		expect(depth?.grade).toBe('good');
		expect(depthsOf('poor')).toHaveLength(2);
	});
});

describe('a mean reaches every letter off one observation, which is what a share cannot do', () => {
	/**
	 * `MIN_GRADED_SAMPLE`'s own argument, applied to these two rules and coming back inapplicable.
	 *
	 * The floor exists because a share below three has no interior: at a denominator of one the only
	 * reachable values are nought and a hundred, at two they are nought, fifty and a hundred, so the
	 * middle band cannot be reached at all and every letter such a rule awards sits at an end of its own
	 * scale. Asserted here against `shareOf` rather than restated, so the contrast is measured.
	 */
	it('leaves a share of one or two with no interior to grade', () => {
		expect([shareOf(0, 1).value, shareOf(1, 1).value]).toEqual([0, 100]);
		expect([shareOf(0, 2).value, shareOf(1, 2).value, shareOf(2, 2).value]).toEqual([0, 50, 100]);
	});

	/**
	 * Depth at a sample of one, using a depth the fixtures really recorded rather than a number chosen
	 * to make the point. `poor`'s second catch is the interior value: on its own it grades `ok`, the
	 * band a one-press share can never land in.
	 */
	it('grades a single caught proc anywhere on the depth scale', () => {
		const [deepest, shallower] = depthsOf('poor').sort((a, b) => b - a) as [number, number];
		expect(shallower).toBeCloseTo(75.18, 2);
		expect(gradeOf(THRESHOLDS.snapshotDepth, shallower)).toBe('ok');
		expect(gradeOf(THRESHOLDS.snapshotDepth, deepest)).toBe('good');
		// And the bad end, off a real early press one pull over.
		expect(gradeOf(THRESHOLDS.snapshotDepth, Math.min(...depthsOf('strong')))).toBe('bad');
	});

	/**
	 * The same at a sample of one brew, and cleaner: stacks are integers, so the reachable set at one
	 * observation is enumerable and `strong` alone spent brews at all three letters.
	 */
	it('grades a single brew anywhere on the stack scale', () => {
		const letters = [...new Set(stacksOf('strong'))]
			.sort((a, b) => b - a)
			.map((n) => [n, gradeOf(THRESHOLDS.brewStacks, n)]);
		expect(letters).toEqual([
			[10, 'good'],
			[9, 'ok'],
			[8, 'bad'],
			[5, 'bad'],
		]);
	});
});

describe('a floor of three would leave the pulls it permits exactly as thin', () => {
	/**
	 * The arithmetic first: one observation moves a mean of n by up to the scale's range over n, and a
	 * letter moves when that clears the rule's step. Depth steps 15 points on a 0-100 scale, so the
	 * letter is one proc away from a different one below seven; brew stacks step one on a scale of ten,
	 * so it is one brew away below eleven. Both are five of the six pulls, and a floor of three sits
	 * well underneath either.
	 */
	it('needs seven procs and eleven brews to be stable, not three', () => {
		const depthStep = THRESHOLDS.snapshotDepth.good - THRESHOLDS.snapshotDepth.ok;
		const stackStep = THRESHOLDS.brewStacks.good - THRESHOLDS.brewStacks.ok;
		expect([depthStep, stackStep]).toEqual([15, 1]);

		const stableAt = (range: number, step: number) => {
			for (let n = 1; n < 100; n += 1) if (range / n < step) return n;
			return Number.NaN;
		};
		expect(stableAt(100, depthStep)).toBe(7);
		expect(stableAt(10, stackStep)).toBe(11);

		expect(ALL.filter((name) => fixture(name).procs.snapshotted >= 7)).toEqual(['strong']);
		expect(ALL.filter((name) => fixture(name).brew.uses >= 11)).toEqual(['strong']);
	});

	/**
	 * And the arithmetic on a pull the floor would wave through, with a real observation rather than the
	 * bound. `waves` caught five procs — clear of three — and averages 64.42%, `bad` by a whisker. Give
	 * it `strong`'s deepest real catch in place of its own shallowest and it reads `ok`. One proc, above
	 * the floor, still decides the letter.
	 */
	it('still lets one real proc move `waves` across a band at five', () => {
		const waves = depthsOf('waves');
		expect(waves).toHaveLength(5);
		expect(gradeOf(THRESHOLDS.snapshotDepth, mean(waves))).toBe('bad');

		const swapped = waves.toSorted((a, b) => a - b).with(0, Math.max(...depthsOf('strong')));
		expect(gradeOf(THRESHOLDS.snapshotDepth, mean(swapped))).toBe('ok');
	});

	/**
	 * The brew mean's version, on the smallest committed sample there is. `weave` spent five brews at
	 * 8, 10, 10, 10, 8 for a mean of 9.2 and `ok`; one of those eights spent full reads 9.6 and `good`.
	 * Five is the floor's own comfortable side, and the letter still turns on a single brew.
	 */
	it('still lets one real brew move `weave` across a band at five', () => {
		const weave = stacksOf('weave');
		expect(weave.toSorted((a, b) => a - b)).toEqual([8, 8, 10, 10, 10]);
		expect(gradeOf(THRESHOLDS.brewStacks, mean(weave))).toBe('ok');
		expect(gradeOf(THRESHOLDS.brewStacks, mean(weave.toSorted((a, b) => a - b).with(0, 10)))).toBe('good');
	});
});

describe('what is actually wrong with the depth mean, which no floor removes', () => {
	/**
	 * The inversion, pinned so the next sweep finds it rather than re-deriving it.
	 *
	 * Depth averages only the procs that were caught, and the catch is what `snapshotRate` grades — so
	 * the denominator is chosen by the player's performance on the metric beside it, and the choosing
	 * runs backwards. A pull that catches the awkward procs as well as the easy ones drags its own mean
	 * down; a pull that catches two and misses six keeps whichever two it managed.
	 *
	 * `snapshots.depthCaveat` already tells the reader this in so many words — "catching two procs and
	 * timing both perfectly scored better than catching twelve" — and these are the two pulls it means.
	 * The disclaimer is why the letter is kept out of every verdict (weight nought, and secondary in
	 * `section()`); the one place it still reaches a reader is the `RoRo snapshots` tile, which `poor`
	 * shows in the good colour over `1/9` and `strong` in the bad one over `6/16`.
	 *
	 * A sample floor is no answer to any of that: the effect is present at twelve procs as plainly as at
	 * two, and refusing `poor` alone would hide the clearer half of the evidence for it.
	 */
	it('praises the pull that missed six of eight and faults the pull that caught twelve of fourteen', () => {
		const poor = fixture('poor');
		const strong = fixture('strong');
		expect([poor.procs.snapshotted, poor.procs.opportunities]).toEqual([2, 8]);
		expect([strong.procs.snapshotted, strong.procs.opportunities]).toEqual([12, 14]);

		expect(metricOn('poor', 'snapshotRate')?.grade).toBe('bad');
		expect(metricOn('poor', 'snapshotDepth')?.grade).toBe('good');
		expect(metricOn('strong', 'snapshotRate')?.grade).toBe('good');
		expect(metricOn('strong', 'snapshotDepth')?.grade).toBe('bad');

		// The tile that carries it: its number is the last-global count, its colour is this mean's letter.
		expect([poor.procs.lastGcd, poor.procs.procs]).toEqual([1, 9]);
		expect([strong.procs.lastGcd, strong.procs.procs]).toEqual([6, 16]);
	});
});
