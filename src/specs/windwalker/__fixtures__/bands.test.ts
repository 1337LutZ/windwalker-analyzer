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
	 * The narrowing, on the pull it cuts deepest: `cleave` pressed Tiger Palm twelve times and four of
	 * them with one enemy up. Two thirds of the presses leave the sample — the sharpest cut in the set —
	 * and this is the reported bug in this spec's own shape: a rule about the single-target filler,
	 * applied to a pull that spent most of its counted windows on two enemies or more.
	 *
	 * ---
	 *
	 * **This test asserted the opposite until 2026-08-24, and the claim it made is now true of nothing
	 * we hold.** It read `sampleSize` 2 and `unmeasurable` true: only two of the twelve presses were in
	 * band, two cannot separate a habit from a coin toss, so the pull went ungraded. That was the
	 * flagship example of `bands: [1]` — the case where narrowing does not merely move a figure but
	 * withdraws the verdict.
	 *
	 * The re-capture added `targets.aplCounts`, and `tigerPalmShare` asks its band question of that
	 * series in preference to `targets.counts`. The two disagree on this pull at exactly two presses,
	 * t=108684 and t=126524, which the display series counts as two enemies and the APL series as one.
	 * So the in-band sample is 4 rather than 2, `MIN_GRADED_SAMPLE` is 3, and the pull is graded.
	 *
	 * **State the consequence rather than paper over it: no committed fixture exercises the sample floor
	 * at band 1 any more.** The six in-band samples are 28, 25, 35, 4, 11 and 9, and the floor is 3. The
	 * narrowing itself is still exercised — four of the six pulls lose presses to it, this one two thirds
	 * of them — but the interaction between the narrowing and the floor is now uncovered by any real
	 * pull, and a synthetic would only be this docstring restated as code. A seventh capture that spends
	 * most of a pull on adds would restore it; nothing else will.
	 */
	it('narrows the habit to the presses made at one enemy', () => {
		const metric = tigerPalm('cleave', 'auto');
		expect(metric?.sampleSize).toBe(4);
		expect(metric?.unmeasurable).toBe(false);
		// The whole-pull press count, from the audit rather than restated, so the two sides of this are
		// not the same number: twelve presses were made and four of them were in band.
		expect(fixture('cleave').filler.casts).toBe(12);
	});

	/**
	 * The other add fight, which keeps its grade and earns it on the presses it made at one target.
	 *
	 * `waves` made nine of its twenty-two presses in band and wasted none of them — over the floor, so
	 * it is judged, and the figure moves 4.5% → 0.0% because the one wasted press was made with a pack
	 * up. A clean habit shown over nine presses is evidence; the same habit inferred from twenty-two
	 * presses mostly made where the list wanted Rushing Jade Wind was not.
	 */
	it('judges an add fight on the in-band presses it did make', () => {
		const metric = tigerPalm('waves', 'auto');
		expect(metric?.sampleSize).toBe(9);
		expect(metric?.value).toBe(0);
		expect(metric?.grade).toBe('good');
		expect(fixture('waves').filler.casts).toBe(22);
	});

	/**
	 * The two single-target pulls the report is calibrated on keep their faults. Both were `bad` before
	 * the band existed and are `bad` under it, which is the point: this mechanism is not a discount.
	 *
	 * The narrowing reaches them differently now, and `mixed` is the sharper statement of the two. Under
	 * `aplCounts` that pull never leaves band 1 at all — `resolveBands` answers `[1]` for it — so all
	 * twenty-five presses are in band and the figure is 72.0% whether the band is applied or not. `poor`
	 * visits bands 1 and 2, keeps thirty-five of its forty-one presses, and reads 71.4% in band against
	 * 73.2% over the whole pull.
	 *
	 * So on this pair the band now excuses one pull nothing whatsoever and the other 1.8 points, and
	 * neither is let off its grade. Before the 2026-08-24 re-capture these read 73.9% and 70.6%, off a
	 * `targets.counts` series that put `mixed` at up to four enemies.
	 */
	it('leaves a single-target pull its fault', () => {
		expect(resolveBands(fixture('mixed').targets, 'auto').bands).toEqual([1]);
		expect(tigerPalm('mixed', 'auto')?.value).toBeCloseTo(72.0, 1);
		expect(tigerPalm('mixed', 'auto')?.grade).toBe('bad');
		expect(tigerPalm('poor', 'auto')?.value).toBeCloseTo(71.4, 1);
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
	 * `strong` is the pull that separates the cut from the verdict. Five of its thirty-three presses
	 * were made with a pack up and leave the sample, and the figure is 0.0% either way because this
	 * player wasted none of them anywhere.
	 *
	 * So the sample is the live assertion and **the grade is a deliberate no-change guard** — asserting
	 * `0` before and after would be one number compared with itself.
	 */
	it('narrows the sample on a mixed pull whose habit was clean throughout', () => {
		const metric = tigerPalm('strong', 'auto');
		expect(metric?.sampleSize).toBe(28);
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
	 * What that costs. This test was written as "the band moves two headlines", and **both halves of that
	 * have since been taken back, by two unrelated mechanisms and on two different dates.** Neither
	 * retraction touches the band's own arithmetic, which is asserted above and is worth exactly what it
	 * always was; what moved underneath it was, in one case a denominator, and in the other the series
	 * the band reads. Recorded rather than quietly re-lettered.
	 *
	 * `waves` read as it was fought: its clean in-band habit counts for three points of thirteen where
	 * the discount gave it one of eleven, which carried the pull 72.7% → 76.9% and over the line. Then
	 * `brewShortUses` landed — two of the seven brews the priority list would have required ten of went
	 * out short, graded `bad` — so the pull reads 10.0 points of 14 rather than 10.0 of 13, which is
	 * 71.4% and back under the line.
	 *
	 * `cleave` forced single: three points used to be handed over for a `good` taken off twelve presses,
	 * only two of which the rule was about, and the docstring here read "now the rule cannot say". It can
	 * say again. The 2026-08-24 re-capture added `targets.aplCounts`, which puts four of those presses in
	 * band rather than two — over `MIN_GRADED_SAMPLE` — so the metric is graded, the three points are
	 * back in the reckoning, and the pull is `good` on this reading as it is on `auto`.
	 *
	 * So the honest state of the claim is that the band moves **no** headline in the committed set. That
	 * is not the band failing: it is one pull losing its exemption to a wider series and another being
	 * re-lettered by a metric that did not exist when this was written. The grid below is the guard that
	 * still earns its place, and it is unchanged by the re-capture — six pulls, same six letters.
	 */
	it('moves no headline in the committed set, and says why for each', () => {
		// `cleave` forced single: `good` since the APL series took its Tiger Palm sample over the floor.
		expect(overall('cleave', 'single')).toBe('good');
		// `waves` is the one the brew metric took back — the band's contribution to it is unchanged.
		expect(overall('waves', 'auto')).toBe('ok');
		// And nothing in the set moves under the reader's own default, before or after the re-capture.
		expect(ALL.map((name) => overall(name, 'auto'))).toEqual(['good', 'ok', 'bad', 'good', 'good', 'ok']);
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
			measured: 15,
			total: 15,
			unmeasurable: false,
		});
		expect(scoreAnalysis(fixture('strong'), resolveBands(fixture('strong').targets, 'multi')).judged).toEqual({
			measured: 11,
			total: 14,
			unmeasurable: false,
		});
	});

	/**
	 * And the headline `strong` read as multi-target loses, which is the other pull `brewShortUses` moves.
	 *
	 * Three of the nine brews the list would have required ten of went out short — one of them at five
	 * stacks with no proc running at all — so the metric grades `bad`, and on this reading the pull is
	 * 8.0 points of 11 rather than 8.0 of 10: 72.7% against 80.0%. The `auto` reading of the same pull
	 * keeps its `good` with 1.67 points of margin, down from 7.14.
	 */
	it('moves the strong pull read as multi-target', () => {
		expect(overall('strong', 'multi')).toBe('ok');
		expect(overall('strong', 'auto')).toBe('good'); // no-change guard
	});
});
