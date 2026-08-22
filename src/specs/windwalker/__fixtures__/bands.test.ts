// What `bands: [1]` on Tiger Palm waste actually does to the six committed pulls.
//
// Beside the fixtures because that is what it is a test of. The declaration is one line in
// `THRESHOLDS` and would pass any unit test written around the mechanism while changing nothing on a
// real pull — which is precisely the defect this project has already shipped once, a rung that
// transcribed the single-target list and applied it at every count, presenting as a control while its
// verdicts were identical at all four bands. So the assertions here are per fixture and two-sided: the
// pulls the band moves, the pulls it deliberately does not, and the grades that moved with it.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis } from '~/lib/types';
import { resolveBands } from '~/lib/view/targetMode';
import { scoreAnalysis, WEIGHTS, weightsFor } from '~/specs/windwalker/lib/score';

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `${name}.json`), 'utf8'));

const ALL = ['strong', 'mixed', 'poor', 'weave', 'cleave', 'waves'] as const;

/** The Tiger Palm metric off one pull, read the way a reader with that switch position would see it. */
function tigerPalm(name: string, choice: 'auto' | 'single' | 'multi') {
	const analysis = fixture(name);
	const card = scoreAnalysis(analysis, resolveBands(analysis.targets, choice));
	return card.sections['tigerPalm']?.metrics.find((m) => m.key === 'tigerPalmWaste');
}

const overall = (name: string, choice: 'auto' | 'single' | 'multi'): string => {
	const analysis = fixture(name);
	return scoreAnalysis(analysis, resolveBands(analysis.targets, choice)).overall;
};

describe('the Tiger Palm rule says which target counts it is honest over', () => {
	/**
	 * The exemption, on the reading that can produce it: a reader who says "read this whole pull as
	 * multi-target" is saying the single-target filler was never on the list, so the rule is not asked.
	 *
	 * Every pull in the set, because the exemption is a property of the declaration and not of any one
	 * fixture — and `poor`, which wastes 30 of 41 presses, is the one that shows this is an exemption
	 * rather than a pass: it does not come back `good`, it comes back unasked.
	 */
	it('is not asked of a pull the reader reads as multi-target', () => {
		for (const name of ALL) {
			const metric = tigerPalm(name, 'multi');
			expect(metric?.exempt, name).toBe(true);
			expect(metric?.unmeasurable, name).toBe(true);
			expect(metric?.grade, name).not.toBe('good');
		}
	});

	/**
	 * And the same pull read the way its counts read it is still graded, which is the half that keeps
	 * the exemption from being a free pass on every add fight.
	 *
	 * **A guard on the fixture population rather than a before/after**, and it cannot go red against the
	 * old behaviour — with no band declared nothing was exempt either. What it pins is the fact that
	 * makes the narrowing below necessary: all six fixtures visit band 1, the two the counts call
	 * multi-target included, so the intersection is never empty under detection and a declaration on its
	 * own would have exempted nothing on anything we hold. A fixture that stopped visiting band 1 would
	 * fail this and would be the first pull the declaration alone could speak to.
	 */
	it('is still asked of every pull the counts read for themselves', () => {
		for (const name of ALL) {
			expect(resolveBands(fixture(name).targets, 'auto').bands, name).toContain(1);
			expect(tigerPalm(name, 'auto')?.exempt, name).toBeUndefined();
		}
	});

	/**
	 * The narrowing, on the pull it decides: `cleave` pressed Tiger Palm twelve times and exactly two of
	 * them with one enemy up. Two presses cannot separate a habit from a coin toss — `MIN_GRADED_SAMPLE`
	 * — so the pull is not graded on it, where before it was graded `good` on all twelve.
	 *
	 * This is the reported bug in this spec's own shape: a rule about the single-target filler, applied
	 * to a pull that spent forty-one of its forty-eight counted windows on two enemies or more.
	 */
	it('does not judge the habit off two presses at one enemy', () => {
		const metric = tigerPalm('cleave', 'auto');
		expect(metric?.sampleSize).toBe(2);
		expect(metric?.unmeasurable).toBe(true);
		// The whole-pull press count, from the audit rather than restated, so the two sides of this are
		// not the same number: twelve presses were made and two of them were in band.
		expect(fixture('cleave').filler.casts).toBe(12);
	});

	/**
	 * The other add fight, which keeps its grade and earns it on the presses it made at one target.
	 *
	 * `waves` made seven of its twenty-two presses in band and wasted none of them — over the floor, so
	 * it is judged, and the figure moves 4.5% → 0.0% because the one wasted press was made with a pack
	 * up. A clean habit shown over seven presses is evidence; the same habit inferred from twenty-two
	 * presses mostly made where the list wanted Rushing Jade Wind was not.
	 */
	it('judges an add fight on the in-band presses it did make', () => {
		const metric = tigerPalm('waves', 'auto');
		expect(metric?.sampleSize).toBe(7);
		expect(metric?.value).toBe(0);
		expect(metric?.grade).toBe('good');
		expect(fixture('waves').filler.casts).toBe(22);
	});

	/**
	 * The two single-target pulls the report is calibrated on keep their faults, and the narrowing
	 * changes the figure rather than excusing it — 72.0% → 73.9% and 73.2% → 70.6%. Both were `bad`
	 * before and are `bad` now, which is the point: this mechanism is not a discount.
	 */
	it('leaves a single-target pull its fault', () => {
		expect(tigerPalm('mixed', 'auto')?.value).toBeCloseTo(73.9, 1);
		expect(tigerPalm('mixed', 'auto')?.grade).toBe('bad');
		expect(tigerPalm('poor', 'auto')?.value).toBeCloseTo(70.6, 1);
		expect(tigerPalm('poor', 'auto')?.grade).toBe('bad');
	});

	/**
	 * Deliberate no-change guard: `weave` is the one monk fixture that never cleaves, so every one of
	 * its eleven presses is in band and nothing about it can move. The sample is the assertion — it
	 * equals the audit's own total — because the *value* being unchanged would be true of a broken cut
	 * as well as a working one.
	 */
	it('cannot touch a pull that never left one enemy', () => {
		const metric = tigerPalm('weave', 'auto');
		expect(metric?.sampleSize).toBe(fixture('weave').filler.casts);
		expect(metric?.unmeasurable).toBe(false);
		expect(metric?.grade).toBe('ok');
	});

	/**
	 * `strong` is the pull that separates the cut from the verdict. Seven of its thirty-three presses
	 * were made with a pack up and leave the sample, and the figure is 0.0% either way because this
	 * player wasted none of them anywhere.
	 *
	 * So the sample is the live assertion and **the grade is a deliberate no-change guard** — asserting
	 * `0` before and after would be one number compared with itself.
	 */
	it('narrows the sample on a mixed pull whose habit was clean throughout', () => {
		const metric = tigerPalm('strong', 'auto');
		expect(metric?.sampleSize).toBe(26);
		expect(fixture('strong').filler.casts).toBe(33);
		// Deliberate no-change guard: nothing was wasted at any count, so no cut can move this.
		expect(metric?.grade).toBe('good');
	});
});

describe('the weight the band replaced', () => {
	/**
	 * The whole-pull discount is gone, and its replacement is the band. A pull read as multi-target now
	 * either grades Tiger Palm at full weight on the presses that were in band, or is not asked at all —
	 * never graded at a third of the weight over presses the list never wanted.
	 */
	it('no longer discounts Tiger Palm across the whole pull', () => {
		const multi = weightsFor(resolveBands(fixture('cleave').targets, 'multi'));
		expect(multi.tigerPalmWaste).toBe(WEIGHTS.tigerPalmWaste);
		// Rising Sun Kick's discount stays: it is a claim about how much a one-target number is worth
		// when the job is spreading, which no band expresses. Measured and rejected — see `rskUptime`.
		expect(multi.rskUptime).toBe(1);
		expect(WEIGHTS.rskUptime).toBe(2);
	});

	/**
	 * What that costs, on the two pulls where it changes the headline. Both are the same correction seen
	 * from its two ends, and both were the discount's own argument being applied to the wrong stretch.
	 *
	 * `waves` read as it was fought: its clean in-band habit used to count for one point of eleven and
	 * now counts for three of thirteen, which carries the pull from 72.7% to 76.9% and over the line.
	 *
	 * `cleave` forced single: three points used to be handed over for a `good` taken off twelve presses,
	 * two of which the rule was about. Now the rule cannot say, and the pull is graded on what is left.
	 */
	it('moves the two headlines the discount was propping up', () => {
		expect(overall('waves', 'auto')).toBe('good');
		expect(overall('cleave', 'single')).toBe('ok');
		// And nothing else in the set moves: these two are the whole of it.
		expect(ALL.map((name) => overall(name, 'auto'))).toEqual(['good', 'ok', 'bad', 'good', 'good', 'good']);
	});
});

describe('the scorecard says how much of itself it judged', () => {
	/**
	 * `judged` reaches the card now, which is what stops an exemption reading as a whole-pull verdict.
	 * A pull whose Tiger Palm rule was not asked is a `good` over ten of thirteen points, and the report
	 * can say so rather than presenting it as thirteen of thirteen.
	 */
	it('publishes the denominator the headline was taken over', () => {
		expect(scoreAnalysis(fixture('strong'), resolveBands(fixture('strong').targets, 'auto')).judged).toEqual({
			measured: 14,
			total: 14,
			unmeasurable: false,
		});
		expect(scoreAnalysis(fixture('strong'), resolveBands(fixture('strong').targets, 'multi')).judged).toEqual({
			measured: 10,
			total: 13,
			unmeasurable: false,
		});
	});
});
