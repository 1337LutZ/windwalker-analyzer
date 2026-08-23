// What the headline says about how much of the pull it actually looked at.
//
// `overallOf` renormalises over the metrics it could measure and publishes the denominator it used, so
// a `good` taken over 6 of 13 points and one taken over 14 of 14 are the same letter — and until this
// file the header printed them identically. Two claims, and they fail in different ways:
//
//   1. The denominator is on the page beside the verdict, on every pull, so a partial judgement is
//      distinguishable from a full one without a reader hunting for it. Printed always rather than only
//      when it is short: an absent line cannot be told apart from a feature that was never built.
//   2. When too little of the weight survived for the grade to be a claim at all — `Judged.unmeasurable`
//      — the sentence stops being a verdict. `overallOf` parks the grade at `ok` in that case, which is
//      the honest thing for the arithmetic to do and the *dishonest* thing to print: "some parts were
//      solid and others lost damage" is a confident reading of a pull the report could barely read.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import { MIN_JUDGED_WEIGHT_SHARE, overallOf, section, type Grade, type Metric } from '~/lib/score';
import { scoreAnalysis, WEIGHTS } from '~/specs/windwalker/lib/score';
import { resolveBands } from '~/lib/view/targetMode';
import type { Analysis } from '~/lib/types';

import { ScoreViewContext } from '~/components/report/scoreViewContext';
import { SpecContext } from '~/components/report/specContext';
import { getSpec } from '~/lib/spec';

import ReportHeader from '../ReportHeader';

// Every fixture below is a Windwalker pull, so the header is rendered under the Windwalker's own scorer
// and copy. Named rather than left to `SpecContext`'s default, which is the build's pinned
// `DEFAULT_SPEC` — under `PUBLIC_SPEC=elemental` that scored these monk fixtures with the Shaman's
// thresholds.
const WINDWALKER_SPEC = getSpec('windwalker')!;

initI18n();
const t = i18n.getFixedT('en', 'report');

const fx = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../specs/windwalker/__fixtures__/${name}.json`), 'utf8'));

/**
 * Rendered through the same two providers `Report.tsx` wraps the page in, and the reading is the one
 * `resolveBands` produces from the reader's own switch — so the numbers asserted below are the numbers a
 * reader gets, not ones assembled here.
 */
const under = (analysis: Analysis, choice: 'auto' | 'single' | 'multi'): ReactElement => {
	const node: ReactNode = createElement(ReportHeader, { analysis });
	return createElement(
		SpecContext.Provider,
		{ value: WINDWALKER_SPEC },
		createElement(ScoreViewContext.Provider, { value: resolveBands(analysis.targets, choice) }, node),
	);
};

const render = (analysis: Analysis, choice: 'auto' | 'single' | 'multi' = 'auto') =>
	renderToStaticMarkup(under(analysis, choice));

describe('the headline says how much of the pull it judged', () => {
	/**
	 * A pull every rule was asked of. 15 of 15 points, which is the case that has to print a figure too:
	 * "judged on all of it" is only readable as a contrast if the full case says so as well.
	 */
	it('prints the whole denominator on a pull it could judge in full', () => {
		const poor = fx('poor');
		const judged = scoreAnalysis(poor, resolveBands(poor.targets, 'auto')).judged!;
		expect(judged).toEqual({ measured: 15, total: 15, unmeasurable: false });

		const html = render(poor);
		expect(html).toContain(t('summary.judged', { measured: 15, total: 15 }));
		// And it is still a verdict: this pull is judged, so the grade's own sentence stands.
		expect(html).toContain(t('overall.bad'));
	});

	/**
	 * `weave` under its own detected reading: a `good` over fourteen fifteenths of the weight, which
	 * without this sentence prints exactly like a `good` over all of it.
	 *
	 * 14 of 15 — `brewShortUses` is worth one point and cannot be read, because the priority list asked
	 * this pull for two brews and `MIN_GRADED_SAMPLE` is three.
	 *
	 * **`cleave` stood here and can no longer answer, which is a change of mechanism and not of number.**
	 * It was the pull the reported bug came off, at 11 of 14: Tiger Palm's *three* points left the
	 * reckoning because only two of its twelve presses were made at one enemy, and two presses cannot
	 * separate a habit from a coin toss. The 2026-08-24 re-capture added `targets.aplCounts`, the series
	 * the ladder asks its band question of, and under it four of those presses are in band rather than
	 * two — over the floor, so the metric is graded and the pull is 14 of 14. No committed fixture now
	 * loses points to the band narrowing; `weave` loses one to the bare sample floor instead. The band's
	 * own arithmetic is unaffected and is still pinned in `windwalker/__fixtures__/bands.test.ts`.
	 */
	it('prints a short denominator on a pull part of which went unjudged', () => {
		const weave = fx('weave');
		const judged = scoreAnalysis(weave, resolveBands(weave.targets, 'auto')).judged!;
		expect(judged).toEqual({ measured: 14, total: 15, unmeasurable: false });

		const html = render(weave);
		expect(html).toContain(t('summary.judged', { measured: 14, total: 15 }));
		expect(html).not.toContain(t('summary.judged', { measured: 15, total: 15 }));
	});

	/**
	 * And below `MIN_JUDGED_WEIGHT_SHARE` the sentence stops claiming anything.
	 *
	 * `poor` read as multi-target with no catchable procs and no brews spent: Tiger Palm's three points
	 * are outside the reading, snapshot rate's four have no denominator and the brew section's three have
	 * nothing to read, which leaves 4 of 14 — under half, so `overallOf` sets `unmeasurable` and parks the
	 * grade at `ok`. The pull itself is real and only those fields are synthetic, because no committed
	 * fixture is quiet enough to fall under the floor.
	 *
	 * **The brews had to be emptied here, and the reason is worth stating.** With only the two proc fields
	 * blanked this pull now measures 7 of 14 — exactly half, which `MIN_JUDGED_WEIGHT_SHARE` reads as
	 * enough — so the synthetic stopped exercising the refusal it was written for the moment a third
	 * graded metric joined the brew section. Emptying the bank as well is the same synthetic taken one
	 * step further in the direction it already went, rather than a number nudged to keep a test green:
	 * "no brews spent" is what `brew.uses = 0` was always claiming, and the use list is what actually
	 * says it.
	 */
	it('refuses a verdict when too little of the weight survived', () => {
		const quiet = structuredClone(fx('poor'));
		quiet.procs.opportunities = 0;
		quiet.procs.snapshotted = 0;
		quiet.brew.uses = 0;
		quiet.brew.maxStacks = 0;
		quiet.brew.useList = [];
		const card = scoreAnalysis(quiet, resolveBands(quiet.targets, 'multi'));
		expect(card.judged).toEqual({ measured: 4, total: 14, unmeasurable: true });
		expect(card.overall).toBe('ok');

		const html = render(quiet, 'multi');
		// The parked grade must not reach the reader as a reading of the pull.
		expect(html).not.toContain(t('overall.ok'));
		expect(html).toContain(t('overall.none'));
		expect(html).toContain(t('summary.judged', { context: 'partial', measured: 4, total: 14 }));
		// Neutral rather than amber: the panel's rule is the grade's colour, and there is no grade.
		expect(html).toContain('border-line');
		expect(html).not.toContain('border-brew');
	});
});

/**
 * What a `good` headline is actually allowed to contain — and what it used to deny.
 *
 * `overall.good` said "The notes below are small refinements, not real mistakes", which is an absolute
 * claim about copy the letter never covered. Three things make it false, and none of them is
 * hypothetical:
 *
 *   1. The letter is a **weighted mean**, so 75% of the points is enough. A quarter of the measured
 *      weight can be scoring zero.
 *   2. A section's own letter is the *worst* of its metrics, not their mean, so a whole section can
 *      letter `bad` under a `good` headline.
 *   3. The mean is taken over the weight that survived, which `MIN_JUDGED_WEIGHT_SHARE` only requires
 *      to be half — so the sentence can be a claim about copy from sections it never read.
 *
 * `strong` is the proof and it is committed: `good` over **15 of 15** points — nothing unread at all,
 * so (3) is not even needed — with `brew` lettering `bad` and two metrics scoring zero. A reader of
 * that pull was told the red section below was not a real mistake.
 *
 * It used to be two sections and three zeroes, and the third zero going is a fix rather than a drift:
 * `karma` lettered `bad` because `karmaEmpty` was a share with no sample floor, and `strong` took two
 * Touch of Karma presses and left one of them on a quiet stretch — a `bad` off a denominator of two.
 * The metric goes through `shareOf` now and is refused on that pull, which leaves `karma` at `ok`. The
 * headline itself does not move: that metric carries weight nought, so it was never in the mean, and
 * the 15 of 15 below is the same 15 it always was. One red section under a `good` headline is all this
 * argument ever needed.
 */
describe('the good headline does not deny the faults under it', () => {
	it('is printed over a pull one of whose sections it grades bad', () => {
		const strong = fx('strong');
		const card = scoreAnalysis(strong, resolveBands(strong.targets, 'auto'));
		expect(card.overall).toBe('good');
		// Judged in full, so nothing here is excused — the letter is drawn over every point the spec
		// offered. It is not the *worst* case, which is measured in the block at the foot of this file.
		expect(card.judged).toEqual({ measured: 15, total: 15, unmeasurable: false });
		const bad = Object.entries(card.sections)
			.filter(([, score]) => !score.unmeasurable && score.grade === 'bad')
			.map(([key]) => key)
			.sort();
		expect(bad).toEqual(['brew']);

		// Any apostrophe in the sentence comes back HTML-escaped out of `renderToStaticMarkup`, which is
		// why the two assertions above this block could compare the raw string and this one cannot. The
		// escape is a no-op on today's wording and is kept so a rewrite that reintroduces one still passes.
		const html = render(strong);
		expect(html).toContain(t('overall.good').replaceAll("'", '&#x27;'));
		expect(html).not.toContain(t('overall.ok'));
	});

	/**
	 * The property rather than the phrasing: all four sentences hand the reader the same next move, and
	 * the `good` one was the only one that did not — because it was telling them there was nothing to
	 * go and look at.
	 */
	it('sends the reader down the page on every grade, the good one included', () => {
		for (const grade of ['good', 'ok', 'bad', 'none']) {
			expect(t(`overall.${grade}`), grade).toContain('Read down the page');
		}
	});

	/** And the claim itself, named, so it cannot come back in a rewrite. */
	it('claims nothing about notes the letter did not cover', () => {
		const good = t('overall.good');
		for (const denial of ['not real mistakes', 'small refinements', "close to the spec's ceiling"]) {
			expect(good, denial).not.toContain(denial);
		}
	});

	/**
	 * Where the qualification has to sit, which is the half the sentence used to get wrong.
	 *
	 * The opening clause was "You played this pull close to the spec's ceiling", and it was defended
	 * twice on the grounds that the qualification arrives anyway — `summary.judged` prints the
	 * denominator directly beneath, and the second clause already said "a strong average can still hold
	 * a habit". Both are true and neither reaches the reader in time. A reader who stops at the first
	 * full stop has been told they played at the ceiling and nothing else, and the measured worst case
	 * below says that reader may have played 75% of the points the report could measure, on half the
	 * weight the spec offered, with three of seven sections lettering red underneath.
	 *
	 * So the property is **ordering**, not vocabulary: the letter has to be owned as an average before
	 * the reader is sent anywhere. Asserted as an ordering rather than as a phrase for the reason the
	 * `Read down the page` test above gives — the next rewrite should be free to reword both clauses and
	 * still be held to the same thing.
	 */
	it('owns the letter as an average before it sends the reader anywhere', () => {
		const good = t('overall.good');
		expect(good).toContain('average');
		expect(good.indexOf('average')).toBeLessThan(good.indexOf('Read down the page'));
	});

	/**
	 * And that the concession is about the page, not only about the number.
	 *
	 * "A strong average can still hold a habit" concedes a *habit* — one metric, somewhere. What the
	 * arithmetic actually permits is whole sections lettering `bad`, which is a different size of
	 * admission and the one `strong` demonstrates. Kept as a hedge rather than a warning: `can`, because
	 * a genuinely clean pull is under this letter too and should not be told it has faults it does not.
	 */
	it('admits that whole parts of the page can be red under it', () => {
		const good = t('overall.good');
		expect(good).toMatch(/whole parts of the page can be red/);
		expect(good).not.toMatch(/whole parts of the page are red/);
	});
});

/**
 * What a `good` letter actually permits, taken off the engine rather than off a fixture.
 *
 * The block above proves the shape on one committed pull. This one establishes the bound, because the
 * sentence has to be true at the bound and `strong` is not it: `strong` letters `good` at 76.7% of its
 * points with two sections red, and the arithmetic allows worse on all three axes at once.
 *
 * Measured on the Windwalker's own weights — `snapshotRate` 4, `tigerPalmWaste` 3, `gcdUtilisation` and
 * `rskUptime` 2, four more at 1, and `snapshotDepth` plus the two Karma metrics at 0, for 15 offered:
 *
 *   - **75% of the points it measured** is the floor, and it is reachable: 10.5 of 14. Nothing below it
 *     letters `good`, and the next step the weights can express — 10 of 14, 71.4% — does not.
 *   - **Half the weight the spec offered** is the floor on how much was read, straight off
 *     `MIN_JUDGED_WEIGHT_SHARE`. On these weights the least reachable is 8 of 15.
 *   - **Three of seven sections** can letter `bad` under it, and the cheapest two cost the headline
 *     almost nothing: Karma's two metrics carry weight 0, so that section can be red for *free*.
 *
 * All three at once is the sentence's real audience. Everything here is a no-change guard — it passes
 * against the old copy too, because it is a test of the arithmetic the copy has to survive.
 */
describe('the worst case a good letter permits', () => {
	const OFFERED = Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0);

	/** A metric carrying the three fields `overallOf` reads off it, and honest values for the rest. */
	const at = (key: string, grade: Grade | null): Metric => ({
		key,
		good: 1,
		ok: 0,
		higherIsBetter: true,
		value: 0,
		grade: grade ?? 'ok',
		unmeasurable: grade === null,
	});

	const letterOver = (states: Record<string, Grade | null>) =>
		overallOf(
			Object.entries(states).map(([key, grade]) => at(key, grade)),
			WEIGHTS,
		);

	/** Every metric `good` except the ones named, so a case states only what it is about. */
	const allBut = (states: Record<string, Grade | null>): Record<string, Grade | null> => ({
		...Object.fromEntries(Object.keys(WEIGHTS).map((key) => [key, 'good' as Grade])),
		...states,
	});

	it('offers fifteen points on the base weights', () => {
		expect(OFFERED).toBe(15);
	});

	it('still letters good on three quarters of the points it measured, and not below', () => {
		// 10.5 of 14: `snapshotRate` half-marked at weight 4, `brewStacks` half-marked, `brewCapWaste`
		// scoring zero, and `brewShortUses` dropping out of the denominator entirely.
		const floor = letterOver(
			allBut({ snapshotRate: 'ok', brewStacks: 'ok', brewCapWaste: 'bad', brewShortUses: null }),
		);
		expect(floor.judged).toEqual({ measured: 14, total: 15, unmeasurable: false });
		expect(floor.grade).toBe('good');

		// One weight-1 metric down from there is 10 of 14 — 71.4%, the nearest step these weights can
		// express below the line — and the letter goes.
		const under = letterOver(
			allBut({
				snapshotRate: 'ok',
				brewStacks: 'ok',
				brewCapWaste: 'bad',
				brewShortUses: null,
				potionsUsed: 'ok',
			}),
		);
		expect(under.judged).toEqual({ measured: 14, total: 15, unmeasurable: false });
		expect(under.grade).toBe('ok');
	});

	it('still letters good on half the weight the spec offered, and not below', () => {
		expect(MIN_JUDGED_WEIGHT_SHARE).toBe(0.5);
		const unread: Record<string, Grade | null> = {
			snapshotRate: null,
			brewStacks: null,
			brewCapWaste: null,
			brewShortUses: null,
		};
		// 8 of 15 — 53.3%, the least these weights can leave standing and still be over half.
		const half = letterOver(allBut(unread));
		expect(half.judged).toEqual({ measured: 8, total: 15, unmeasurable: false });
		expect(half.grade).toBe('good');

		// 7 of 15 is 46.7%, and the letter is withdrawn rather than lowered: `unmeasurable`, which is
		// what makes the header print `overall.none` instead of any of the three grades.
		const tooLittle = letterOver(allBut({ ...unread, potionsUsed: null }));
		expect(tooLittle.judged).toEqual({ measured: 7, total: 15, unmeasurable: true });
	});

	it('lets a section letter bad for nothing at all', () => {
		// Karma's two metrics are weight 0 — graded in their own section and deliberately kept out of the
		// headline — so a red Karma costs the average not one point of the fifteen.
		expect(WEIGHTS.karmaEmpty).toBe(0);
		expect(WEIGHTS.karmaCapShare).toBe(0);
		expect(section([at('karmaEmpty', 'bad'), at('karmaCapShare', 'good')]).grade).toBe('bad');

		const withRedKarma = letterOver(allBut({ karmaEmpty: 'bad' }));
		expect(withRedKarma.judged).toEqual({ measured: 15, total: 15, unmeasurable: false });
		expect(withRedKarma.grade).toBe('good');

		// And the brew section's worst-of-three fold puts a second red section on the page for one point,
		// which with Karma and a skipped potion is the three the block's note names.
		expect(section([at('brewStacks', 'good'), at('brewCapWaste', 'good'), at('brewShortUses', 'bad')]).grade).toBe(
			'bad',
		);
		const three = letterOver(allBut({ karmaEmpty: 'bad', brewShortUses: 'bad', potionsUsed: 'bad' }));
		expect(three.judged).toEqual({ measured: 15, total: 15, unmeasurable: false });
		expect(three.grade).toBe('good');
	});
});
