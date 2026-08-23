import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MIN_GRADED_SAMPLE } from '~/lib/score';
import { scoreAnalysis, THRESHOLDS } from '~/specs/windwalker/lib/score';
import { WEIGHTS } from '~/specs/windwalker/lib/score';
import type { Analysis } from '~/lib/types';

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'));

/**
 * Touch of Karma redirects damage on a one-second tick, and the ticks run from about 2.8s after the
 * press through to 11.8s — past the ten seconds the tooltip advertises. A flat ten-second window
 * dropped the last two ticks and under-reported a use by a fifth, which also invented a wasted press
 * on a pull that had none.
 */
/**
 * A pull whose Karma never demonstrated its ceiling: no use drained, so no pool can be stated.
 *
 * The presses and what they returned are untouched — only the measurement of the cap is removed,
 * which is exactly the shape of a real pull where every use was cut short by the fight ending or by
 * nothing more arriving to absorb.
 */
const unmeasured = (name: string): Analysis => {
	const captured = fixture(name);
	return {
		...captured,
		karma: {
			...captured.karma,
			capPerUse: null,
			uses: captured.karma.uses.map((use) => ({ ...use, exhausted: false, capPct: null })),
		},
	};
};

describe('Touch of Karma', () => {
	for (const name of ['strong', 'mixed', 'poor']) {
		it(`attributes every redirect tick on the ${name} pull`, () => {
			const analysis = fixture(name);
			const row = analysis.damage.abilities.find((a) => a.id === 124280);
			const attributed = analysis.karma.uses.reduce((sum, use) => sum + use.reflected, 0);

			expect(row, 'no redirect damage in this fixture').toBeDefined();
			// Every point of redirect damage belongs to exactly one press: none lost to a short window,
			// none counted twice by two overlapping ones.
			expect(attributed).toBe(row?.total);
			expect(analysis.karma.reflected).toBe(row?.total);
			expect(analysis.karma.uses).toHaveLength(analysis.karma.casts);
		});
	}

	it('counts the uses the cooldown allowed, not just the ones taken', () => {
		const strong = fixture('strong');
		// A 535s pull on a 90s cooldown: the opener plus five recharges.
		expect(strong.karma.available).toBe(6);
		expect(strong.karma.casts).toBe(2);
	});

	/** The judgement this section can actually support: a press into a quiet stretch returns nothing. */
	it('shows a press that returned nothing as exactly that', () => {
		const empty = fixture('strong').karma.uses.filter((use) => use.reflected === 0);
		expect(empty).toHaveLength(1);
		expect(empty[0]?.hits).toBe(0);
	});

	/**
	 * The ceiling is measured from a use that drained its pool, and claimed nowhere else.
	 *
	 * These fixtures are captured `analyse()` output from before the absorb was measured, so they
	 * carry no `absorbed` and no `exhausted` and read here as the pull that could not answer it —
	 * which is exactly the case worth pinning. **They need re-capturing.** The live numbers, and the
	 * before-and-after on the same three pulls, are in `~/specs/windwalker/__fixtures__/karmacap.test.ts`.
	 */
	it('claims no ceiling on a pull where no use drained its pool', () => {
		// Built rather than borrowed. Every reference pull now drains a pool on at least one use, which
		// re-capturing revealed — so a test that reached this branch through a fixture was pinning how
		// old the capture was, not what the engine does.
		const karma = unmeasured('poor').karma;
		expect(karma.capPerUse).toBeNull();
		expect(karma.uses.every((use) => use.capPct === null)).toBe(true);
	});

	/**
	 * "Cannot say" has to reach the scorecard as *unmeasurable*, not as zero.
	 *
	 * A pull that never demonstrated its ceiling has not failed to fill it, and a metric defaulting to
	 * 0% would grade every such pull as the worst possible use of the cooldown — the fabricated fault
	 * this section exists to refuse. The presses are gradable either way, so the section still speaks;
	 * only the share of the ceiling goes quiet.
	 */
	it('grades what it can and stays silent on what it cannot', () => {
		const karma = scoreAnalysis(unmeasured('poor')).sections.karma;
		const capShare = karma?.metrics.find((m) => m.key === 'karmaCapShare');
		const empty = karma?.metrics.find((m) => m.key === 'karmaEmpty');

		expect(capShare?.unmeasurable).toBe(true);
		expect(empty?.unmeasurable).toBe(false);
		expect(karma?.unmeasurable).toBe(false);
	});

	/**
	 * A press that returned nothing is a fault; a charge held through a quiet phase is not.
	 *
	 * So the empty share is taken over the presses *taken*, never over the presses the cooldown
	 * allowed — `poor` took three of a possible three and `waves` one of a possible five, and neither
	 * denominator is the cooldown's.
	 */
	it('faults the presses taken, not the charges left on the cooldown', () => {
		const empty = (analysis: Analysis) =>
			scoreAnalysis(analysis).sections.karma?.metrics.find((m) => m.key === 'karmaEmpty');

		const poor = fixture('poor');
		expect(poor.karma.available).toBe(3);
		expect(empty(poor)?.sampleSize).toBe(3);
		expect(empty(poor)?.value).toBe(0);
		expect(empty(poor)?.grade).toBe('good');

		// The charges left on the cooldown are not in the denominator, which is what this pull shows: one
		// press of a possible five, and the sample the metric publishes is the one press.
		const waves = fixture('waves');
		expect(waves.karma.available).toBe(5);
		expect(empty(waves)?.sampleSize).toBe(1);
	});

	/**
	 * And a share of the presses taken is only worth grading over three of them.
	 *
	 * `karmaEmpty` was built with `sharePct`, which declines only at a denominator of nought, so it was
	 * the one share in the spec with no sample floor under it. At two presses the reachable values are
	 * nought, fifty and a hundred, and `strong` sat on the fifty: two presses, one of them into a quiet
	 * stretch, graded `bad` and printed as a habit. A ninety-second cooldown makes that the ordinary
	 * shape rather than the exceptional one — four of the six committed pulls press it once or twice.
	 *
	 * The press count is untouched by this and stays on the page; what is withdrawn is the share.
	 */
	it('declines to read a habit off one or two presses', () => {
		const empty = (name: string) =>
			scoreAnalysis(fixture(name)).sections.karma?.metrics.find((m) => m.key === 'karmaEmpty');

		expect(MIN_GRADED_SAMPLE).toBe(3);
		for (const name of ['strong', 'cleave', 'waves', 'weave']) {
			const karma = fixture(name).karma;
			expect(karma.casts, `${name} clears the floor, so it does not belong here`).toBeLessThan(MIN_GRADED_SAMPLE);
			expect(empty(name)?.unmeasurable, name).toBe(true);
		}
		// `strong` is the one that was reading `bad`: one empty press of the two it took.
		expect(fixture('strong').karma.uses.filter((use) => use.reflected === 0)).toHaveLength(1);
	});

	/**
	 * And the other share in this section, which was wrong in a different way: not thin, **forced**.
	 *
	 * `karmaCapShare` divides what the presses absorbed by what they could have absorbed, and the second
	 * of those is `capPerUse × casts`, where `capPerUse` is the *largest absorb on the pull*. So the
	 * denominator is built out of the numerator's own biggest term. No press can exceed it, at least one
	 * press equals it, and the share is therefore bounded below by one over the presses taken — however
	 * badly the pull went.
	 *
	 * At one press that bound is the whole scale: the pool was measured off the only press there is, so
	 * the share is that press over itself and reads a hundred with nothing the player could have done to
	 * move it. At two, the worse half of the scale simply is not there.
	 */
	it('cannot read below one over the presses taken', () => {
		for (const name of ['weave', 'strong', 'mixed', 'poor']) {
			const karma = fixture(name).karma;
			expect(karma.capPerUse, `${name} demonstrated no pool, so it witnesses nothing here`).not.toBeNull();
			// The bound is arithmetic and not a tendency: the ceiling per press *is* one of the absorbs
			// being summed over it, so the fraction cannot fall under one over the press count.
			expect(karma.capPerUse).toBe(Math.max(...karma.uses.map((use) => use.absorbed ?? 0)));
			const share = (karma.absorbed ?? 0) / ((karma.capPerUse ?? 1) * karma.casts);
			expect(share, name).toBeGreaterThanOrEqual(1 / karma.casts);
		}

		// One press, and it drained its pool — which is the only way a pool is ever stated. Numerator and
		// denominator are the same measurement, so the figure is a definition rather than a reading.
		const weave = fixture('weave').karma;
		expect(weave.casts).toBe(1);
		expect(weave.absorbed).toBe(weave.capPerUse);

		// Two presses, and as badly as two presses can go: the second absorbed nothing whatsoever. The
		// arithmetic still reads exactly a half, which is this rule's `ok`.
		const strong = fixture('strong').karma;
		expect(strong.casts).toBe(2);
		expect(strong.uses.filter((use) => use.absorbed === 0)).toHaveLength(1);
		expect((strong.absorbed ?? 0) / ((strong.capPerUse ?? 1) * strong.casts)).toBe(0.5);
	});

	/**
	 * Three presses, and it is this metric's own steps that say three rather than `MIN_GRADED_SAMPLE`.
	 *
	 * The lowest value the share can reach over n presses is 100/n, so the lowest step of the rule is out
	 * of reach until 100/n drops under it. At two presses the bottom of the scale is 50 — an `ok` — so a
	 * pull cannot be marked down here however it pressed. At three it is 33.3, which is under the line.
	 * Three is the first press count at which every letter this rule can award is reachable at all.
	 *
	 * Asserted against the steps rather than stated, because the coincidence with `MIN_GRADED_SAMPLE` is
	 * a coincidence: move `ok` to 30 and the derivation would want four presses, and this fails rather
	 * than quietly keeping three.
	 */
	it('takes its floor from its own steps and not from the sample rule', () => {
		expect(THRESHOLDS.karmaCapShare.good).toBe(75);
		expect(THRESHOLDS.karmaCapShare.ok).toBe(40);
		expect(100 / (MIN_GRADED_SAMPLE - 1)).toBeGreaterThanOrEqual(THRESHOLDS.karmaCapShare.ok);
		expect(100 / MIN_GRADED_SAMPLE).toBeLessThan(THRESHOLDS.karmaCapShare.ok);
	});

	/** The refusal itself, on all six committed pulls. */
	it('refuses the ceiling share under three presses and grades it at three', () => {
		const capShare = (name: string) =>
			scoreAnalysis(fixture(name)).sections.karma?.metrics.find((m) => m.key === 'karmaCapShare');

		// The two that were being handed a letter off a figure they could not have moved: `weave` read a
		// hundred over its one press and took `good` for it, `strong` a forced half and `ok`.
		expect(capShare('weave')?.grade, 'weave').toBe('ok');
		expect(capShare('strong')?.grade, 'strong').toBe('ok');
		expect(capShare('weave')?.value, 'weave').toBe(0);

		// `cleave` and `waves` demonstrated no pool and were unmeasurable already.
		for (const name of ['cleave', 'strong', 'waves', 'weave']) {
			expect(capShare(name)?.unmeasurable, name).toBe(true);
			// The press count travels with the value, which is what lets the floor apply at all.
			expect(capShare(name)?.sampleSize, name).toBe(fixture(name).karma.casts);
		}

		// And the two with three presses keep the readings they had, to the digit.
		for (const [name, value, grade] of [
			['mixed', 64.377_645_591_937_55, 'ok'],
			['poor', 95.805_283_130_563_8, 'good'],
		] as const) {
			expect(capShare(name)?.unmeasurable, name).toBe(false);
			expect(capShare(name)?.value, name).toBeCloseTo(value, 8);
			expect(capShare(name)?.grade, name).toBe(grade);
		}
	});

	/** Measured, shown, and deliberately not counted: the encounter decides what a press can be worth. */
	it('does not let the section move the whole-pull verdict', () => {
		expect(WEIGHTS.karmaEmpty).toBe(0);
		expect(WEIGHTS.karmaCapShare).toBe(0);
	});
});
