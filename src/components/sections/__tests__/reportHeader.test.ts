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
import { hasSolidSection, MIN_JUDGED_WEIGHT_SHARE, overallOf, section, type Grade, type Metric } from '~/lib/score';
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
	 * A pull every rule its capture can answer was asked of. 15 of 17.5 points, and the two and a half
	 * missing ones are rules the capture predates: `weaveRate` at two, `undefined` rather than nought
	 * because every committed analysis is older than that audit, and `karmaInBrew` at a half, for the
	 * same reason. Both drop out of the numerator while their weight stays in the denominator.
	 *
	 * **This case used to read 15 of 15 and was the "judged on all of it" contrast.** It cannot be that
	 * any more without a re-capture, and the contrast below still works because it turns on the gap
	 * between the two numbers rather than on the denominator being whole.
	 */
	it('prints the whole denominator on a pull it could judge in full', () => {
		const poor = fx('poor');
		const judged = scoreAnalysis(poor, resolveBands(poor.targets, 'auto')).judged!;
		expect(judged).toMatchObject({ measured: 15, total: 17.5, unmeasurable: false });

		// The line counts checks and not weight: `judged.checks` is the pair a reader is shown, because a
		// ratio under "scored" read as a mark out of the weight. See `Judged.checks`.
		const html = render(poor);
		expect(html).toContain(t('summary.judged', { measured: judged.checks!.measured, total: judged.checks!.total }));
		// And it is still a verdict: this pull is judged, so the grade's own sentence stands.
		expect(html).toContain(t('overall.bad'));
	});

	/**
	 * `weave` under its own detected reading: a `good` over fourteen of the seventeen and a half points
	 * the spec offers, which without this sentence prints exactly like a `good` over all of it.
	 *
	 * 14 of 17.5: `brewShortUses` is worth one point and cannot be read, because the priority list asked
	 * this pull for two brews and `MIN_GRADED_SAMPLE` is three; two more are `weaveRate` and a half is
	 * `karmaInBrew`, both of which this capture predates. The fixture's name is a coincidence of the elixir weave it does contain —
	 * it is a captured `Analysis`, so the new audit is absent from it like every other.
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
		expect(judged).toMatchObject({ measured: 14, total: 17.5, unmeasurable: false });

		const html = render(weave);
		expect(html).toContain(t('summary.judged', { measured: judged.checks!.measured, total: judged.checks!.total }));
		expect(html).not.toContain(t('summary.judged', { measured: judged.checks!.total, total: judged.checks!.total }));
	});

	/**
	 * And below `MIN_JUDGED_WEIGHT_SHARE` the sentence stops claiming anything.
	 *
	 * `poor` read as multi-target with no catchable procs and no brews spent: Tiger Palm's three points
	 * are outside the reading, snapshot rate's four have no denominator and the brew section's three have
	 * nothing to read, which leaves 4 of 16 — under half, so `overallOf` sets `unmeasurable` and parks the
	 * grade at `ok`. The pull itself is real and only those fields are synthetic, because no committed
	 * fixture is quiet enough to fall under the floor.
	 *
	 * **The brews had to be emptied here, and the reason is worth stating even though it has since
	 * stopped biting.** With only the two proc fields blanked this pull measured 7 of 14 — exactly half,
	 * which `MIN_JUDGED_WEIGHT_SHARE` reads as enough — so the synthetic stopped exercising the refusal
	 * it was written for the moment a third graded metric joined the brew section. Emptying the bank as
	 * well is the same synthetic taken one step further in the direction it already went: "no brews
	 * spent" is what `brew.uses = 0` was always claiming, and the use list is what actually says it.
	 *
	 * `weaveRate` has since widened the denominator by two, so 7 of 16 would fall under the floor on its
	 * own and the emptied bank is no longer load-bearing. It stays because the synthetic is more
	 * coherent with it than without, and because a guard that depends on the denominator staying at a
	 * particular width is the thing this paragraph exists to warn about.
	 */
	it('refuses a verdict when too little of the weight survived', () => {
		const quiet = structuredClone(fx('poor'));
		quiet.procs.opportunities = 0;
		quiet.procs.snapshotted = 0;
		quiet.brew.uses = 0;
		quiet.brew.maxStacks = 0;
		quiet.brew.useList = [];
		// And the stacks it earned, which is what `brewCapWaste` reads since it became a share of them. A
		// pull with no brews, no bank and no use list cannot have earned any, so leaving this set was the
		// synthetic contradicting itself rather than the metric refusing to go quiet.
		quiet.brew.stacksGained = 0;
		const card = scoreAnalysis(quiet, resolveBands(quiet.targets, 'multi'));
		expect(card.judged).toMatchObject({ measured: 4, total: 16.5, unmeasurable: true });
		expect(card.overall).toBe('ok');

		const html = render(quiet, 'multi');
		// The parked grade must not reach the reader as a reading of the pull.
		expect(html).not.toContain(t('overall.ok'));
		expect(html).toContain(t('overall.none'));
		expect(html).toContain(
			t('summary.judged', {
				context: 'partial',
				measured: card.judged!.checks!.measured,
				total: card.judged!.checks!.total,
			}),
		);
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
 * `cleave` is the proof and it is committed: `good` over **14 of 16** points, with `casts` and `debuff`
 * both lettering `bad`. A reader of that pull was told the two red sections below were not real
 * mistakes.
 *
 * The two unread points are `weaveRate`, which every committed capture predates, and (3) is still not
 * what carries the argument: 14 of 16 is 87.5% of the offered weight, comfortably past
 * `MIN_JUDGED_WEIGHT_SHARE`, so the red sections under the `good` letter are (1) and (2) alone.
 *
 * ---
 *
 * **`strong` stood here until `gcdUtilisation` was anchored per encounter, and it can no longer answer
 * — the witness moved because a letter moved, not because a number was inconvenient.** That pull fills
 * 82.83% of its globals on Garrosh. Against the old fixed pair, `good 85 / ok 75` on every fight in the
 * tier, that was `ok`; against Garrosh's own reference row — p90 86.01, p50 83.82, over the nine kills
 * the table holds for that fight — it is `bad`, because 82.83 sits a point *below* the median Garrosh
 * pull. The `casts` section goes red with it, the weighted mean falls from 76.7% to 73.33%, and the
 * headline follows: `strong` letters `ok` now. That is the intended reading rather than a regression —
 * "strong everywhere" was the old claim about this fixture and "slightly below a typical Garrosh pull"
 * is the measured one — but it does mean the pull can no longer carry a test about what a `good`
 * headline permits.
 *
 * `cleave` is the better witness for it in any case: it letters `good` at **exactly the 75.00% floor**
 * of the weight it could read, with *two* of seven sections red rather than one. Its own
 * `casts` moved the same way — 77.75% against Dark Shaman's p90/p50 of 85.78/80.64 — which is what put
 * the second red section under the headline.
 *
 * The retired witness's own history is kept, because it is the same argument made once already:
 * `strong` used to show two red sections and three zeroes, and the third zero going was a fix rather
 * than a drift. `karma` lettered `bad` because `karmaEmpty` was a share with no sample floor, and
 * `strong` took two Touch of Karma presses and left one of them on a quiet stretch — a `bad` off a
 * denominator of two. The metric goes through `shareOf` now and is refused on that pull, which left
 * `karma` at `ok` and the headline where it stood, because that metric carries weight nought and was
 * never in the mean. One red section under a `good` headline is all this argument ever needed, and
 * `cleave` brings two.
 */
describe('the good headline does not deny the faults under it', () => {
	it('is printed over a pull one of whose sections it grades bad', () => {
		const cleave = fx('cleave');
		const card = scoreAnalysis(cleave, resolveBands(cleave.targets, 'auto'));
		expect(card.overall).toBe('good');
		// Nothing here is excused by a thin denominator: 14 of 16.5 is 84.8% of the weight the spec
		// offered, and the two and a half it could not read are the weave rule and the Karma placement
		// rule, both of which this capture predates. It is not the *worst* case, which is measured in the
		// block at the foot of this file.
		expect(card.judged).toMatchObject({ measured: 14, total: 16.5, unmeasurable: false });
		const bad = Object.entries(card.sections)
			.filter(([, score]) => !score.unmeasurable && score.grade === 'bad')
			.map(([key]) => key)
			.sort();
		expect(bad).toEqual(['casts', 'debuff']);

		// Any apostrophe in the sentence comes back HTML-escaped out of `renderToStaticMarkup`, which is
		// why the two assertions above this block could compare the raw string and this one cannot. The
		// escape is a no-op on today's wording and is kept so a rewrite that reintroduces one still passes.
		const html = render(cleave);
		expect(html).toContain(t('overall.good').replaceAll("'", '&#x27;'));
		expect(html).not.toContain(t('overall.ok'));
	});

	/**
	 * The property rather than the phrasing: all four sentences hand the reader the same next move, and
	 * the `good` one was the only one that did not — because it was telling them there was nothing to
	 * go and look at.
	 */
	it('sends the reader down the page on every grade, the good one included', () => {
		// The word rather than the sentence, and the word is the whole property: every arm has to point
		// at the cards under it. The wording moved once already — all four used to open the same clause
		// with "Read down the page", which reads as instruction rather than as a report — and the next
		// rewrite should be free to move it again without this guard having an opinion about phrasing.
		for (const grade of ['good', 'ok', 'bad', 'none']) {
			expect(t(`overall.${grade}`), grade).toContain('below');
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
	 * `below` test above gives — the next rewrite should be free to reword both clauses and
	 * still be held to the same thing.
	 */
	it('owns the letter as an average before it sends the reader anywhere', () => {
		const good = t('overall.good');
		expect(good).toContain('average');
		expect(good.indexOf('average')).toBeLessThan(good.indexOf('below'));
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
		expect(good).toMatch(/whole parts of this page can be red/);
		expect(good).not.toMatch(/whole parts of the page are red/);
	});
});

/**
 * What a `good` letter actually permits, taken off the engine rather than off a fixture.
 *
 * The block above proves the shape on one committed pull. This one establishes the bound, because the
 * sentence has to be true at the bound and `cleave` is not it: `cleave` letters `good` at 75.00% of its
 * points with two sections red and nothing unread, and the arithmetic allows worse on the other two
 * axes at the same time. (`strong` stood in that sentence at 76.7% until the globals lines were
 * anchored per encounter; it letters `ok` at 73.33% now — see the block above.)
 *
 * Measured on the Windwalker's own weights — `snapshotRate` 4, `tigerPalmWaste` 3, `gcdUtilisation`,
 * `rskUptime` and `weaveRate` 2, four more at 1, `karmaInBrew` at a half, and `snapshotDepth`, the
 * other two Karma metrics and the two weave faults at 0, for 17.5 offered:
 *
 *   - **75% of the points it measured** is the floor, and it is reachable: 12 of 16. Nothing below it
 *     letters `good`, and the next step the weights can express — 11.5 of 16, 71.9% — does not.
 *   - **Half the weight the spec offered** is the floor on how much was read, straight off
 *     `MIN_JUDGED_WEIGHT_SHARE`. On these weights the least reachable is 9 of 17.5, 51.4%.
 *   - **Three of seven sections** can letter `bad` under it, and the cheapest two cost the headline
 *     almost nothing: Karma's section letter is decided by its two *primary* metrics, and both carry
 *     weight 0, so that section can be red for *free*. Its third rule is weighted and cannot turn the
 *     section red, which is the pair of decisions `score.ts` argues separately.
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
		unit: 'count',
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

	it('offers seventeen and a half points on the base weights', () => {
		expect(OFFERED).toBe(17.5);
	});

	it('still letters good on three quarters of the points it measured, and not below', () => {
		// 12 of 16: `snapshotRate` half-marked at weight 4, `brewStacks` and `potionsUsed` half-marked,
		// `brewCapWaste` scoring zero, and two weight-1 rules dropping out of the denominator entirely:
		// `brewShortUses` on a pull with no brew to read, `karmaInBrew` on one that never pressed the
		// button, which is the ordinary shape of both.
		const floor = letterOver(
			allBut({
				snapshotRate: 'ok',
				brewStacks: 'ok',
				brewCapWaste: 'bad',
				brewShortUses: null,
				karmaInBrew: null,
				potionsUsed: 'ok',
			}),
		);
		expect(floor.judged).toMatchObject({ measured: 16, total: 17.5, unmeasurable: false });
		expect(floor.grade).toBe('good');

		// Half a point down from there is 11.5 of 16 — 71.9%, the nearest step these weights can express
		// below the line — and the letter goes.
		const under = letterOver(
			allBut({
				snapshotRate: 'ok',
				brewStacks: 'ok',
				brewCapWaste: 'bad',
				brewShortUses: null,
				karmaInBrew: null,
				potionsUsed: 'bad',
			}),
		);
		expect(under.judged).toMatchObject({ measured: 16, total: 17.5, unmeasurable: false });
		expect(under.grade).toBe('ok');
	});

	it('still letters good on half the weight the spec offered, and not below', () => {
		expect(MIN_JUDGED_WEIGHT_SHARE).toBe(0.5);
		const unread: Record<string, Grade | null> = {
			snapshotRate: null,
			tigerPalmWaste: null,
			brewStacks: null,
			karmaInBrew: null,
		};
		// 9 of 17.5, 51.4%: the least these weights can leave standing and still clear the half. The
		// half-point rule is in the unread set because that is what makes 9 reachable at all.
		const half = letterOver(allBut(unread));
		expect(half.judged).toMatchObject({ measured: 9, total: 17.5, unmeasurable: false });
		expect(half.grade).toBe('good');

		// 8 of 17.5 is 45.7%, and the letter is withdrawn rather than lowered: `unmeasurable`, which is
		// what makes the header print `overall.none` instead of any of the three grades.
		const tooLittle = letterOver(allBut({ ...unread, brewCapWaste: null }));
		expect(tooLittle.judged).toMatchObject({ measured: 8, total: 17.5, unmeasurable: true });
	});

	it('lets a section letter bad for nothing at all', () => {
		// Karma's two *primary* metrics are weight 0, graded in their own section and deliberately kept
		// out of the headline, so a red Karma costs the average not one point of the seventeen and a
		// half. The two
		// weave faults are zero-weighted on the same argument and would do the same.
		//
		// `karmaInBrew` is the third rule in that section and is weighted, which does not disturb this:
		// it sits in the secondary slot, so it cannot letter the section at all. The two decisions are
		// separate and `score.ts` argues them separately: what turns a section red, and what the
		// headline is a mean over.
		expect(WEIGHTS.karmaEmpty).toBe(0);
		expect(WEIGHTS.karmaCapShare).toBe(0);
		expect(section([at('karmaEmpty', 'bad'), at('karmaCapShare', 'good')], [at('karmaInBrew', 'good')]).grade).toBe(
			'bad',
		);
		expect(section([at('karmaEmpty', 'good'), at('karmaCapShare', 'good')], [at('karmaInBrew', 'bad')]).grade).toBe(
			'good',
		);

		const withRedKarma = letterOver(allBut({ karmaEmpty: 'bad' }));
		expect(withRedKarma.judged).toMatchObject({ measured: 17.5, total: 17.5, unmeasurable: false });
		expect(withRedKarma.grade).toBe('good');

		// And the brew section's worst-of-three fold puts a second red section on the page for one point,
		// which with Karma and a skipped potion is the three the block's note names.
		expect(section([at('brewStacks', 'good'), at('brewCapWaste', 'good'), at('brewShortUses', 'bad')]).grade).toBe(
			'bad',
		);
		const three = letterOver(allBut({ karmaEmpty: 'bad', brewShortUses: 'bad', potionsUsed: 'bad' }));
		expect(three.judged).toMatchObject({ measured: 17.5, total: 17.5, unmeasurable: false });
		expect(three.grade).toBe('good');
	});
});

/**
 * The two things beside the name that come from WarcraftLogs rather than from this report.
 *
 * Both exist for the same reason: everything else on the page is this tool's reading, and a reader
 * has to be able to get back to the source of it and to the site's own number for the pull.
 */
describe('the headline carries the log’s own figures', () => {
	const withParse = (percent: number | null | undefined): Analysis => ({ ...fx('strong'), rankPercent: percent });

	it('links to the pull and the player it analysed, in a new tab', () => {
		const html = render(fx('strong'));
		const analysis = fx('strong');

		// The three things the analysis was built from, all in the fragment — a link to the report alone
		// lands the reader on somebody else's pull.
		expect(html).toContain(`#fight=${analysis.fightID}`);
		expect(html).toContain(`source=${analysis.actorID}`);
		expect(html).toContain(`/reports/${analysis.code}`);
		expect(html).toContain('target="_blank"');
		// The report is held in memory, so navigating away costs the whole fetch again.
		expect(html).toContain('rel="noopener noreferrer"');
	});

	/**
	 * The bands are WarcraftLogs' own, boundaries included — see `--color-parse-*` in `global.css` for
	 * why they are not translated into this report's palette. Pinned at both edges of each band,
	 * because an off-by-one here paints a 95 purple and reads as a worse pull than it was.
	 */
	it('paints the parse in the site’s own band', () => {
		for (const [percent, tone, ink] of [
			[0, 'common', 'black'],
			[24, 'common', 'black'],
			[25, 'uncommon', 'black'],
			[49, 'uncommon', 'black'],
			[50, 'rare', 'black'],
			[74, 'rare', 'black'],
			[75, 'epic', 'white'],
			[94, 'epic', 'white'],
			[95, 'legendary', 'black'],
			[98, 'legendary', 'black'],
			[99, 'astounding', 'black'],
			[100, 'artifact', 'black'],
		] as const) {
			const html = render(withParse(percent));
			expect(html, `${percent}`).toContain(`bg-parse-${tone}`);
			expect(html, `${percent}`).toContain(`>${percent}<`);
			// The ink travels with the band and is measured rather than chosen — see `PARSE_BANDS`. The
			// epic violet is the one band white wins on, and an ink applied uniformly puts either it or
			// five of the other six under 4.5:1.
			expect(html, `${percent} ink`).toContain(`text-${ink}`);
		}
	});

	/**
	 * And no tag at all where there is no ranking, which is not the same as a ranking of nought.
	 *
	 * A wipe, an unranked difficulty, a private log, a report still being processed, an analysis
	 * captured before the field existed. `0 parse` over any of those states a bottom-percentile pull
	 * the site never claimed.
	 */
	it('draws nothing rather than a nought when the site has no ranking', () => {
		// The band class is the tag's own tell: the number alone could be anything on the page, and the
		// word "parse" is no longer in it — the tag is the percentile and nothing else.
		for (const value of [null, undefined]) {
			expect(render(withParse(value))).not.toContain('bg-parse-');
		}
		expect(render(withParse(0))).toContain('bg-parse-common');
		expect(render(withParse(0))).toContain('>0<');
	});
});

/**
 * The middle arm claims a spread, and a weighted mean cannot see one.
 *
 * `overall.ok` reads *some parts were solid and others lost damage*, which is a claim about how the
 * cards are distributed. `overallOf` is an average, and an average cannot tell that pull from one that
 * was uniformly mediocre or from one that was mostly bad and floated over the 45 line by a handful of
 * weight-one rules. `x3cryW6DCFHhYq1t` fight 20 is the second kind: 45.24%, no section graded `good`,
 * nothing at weight two or three graded `good`, and its four `good` points were two zero-fault rules
 * the card hides, one banner overlap belonging to a warrior, and a single 1.8s overcap. The header
 * called that a mix.
 *
 * So the arm is split on `hasSolidSection`, and these two cases are the split.
 */
describe('the middle headline only claims a mix when there was one', () => {
	/** The three fields the distribution test reads, and honest values for the rest. */
	const metric = (grade: Grade): Metric => ({
		key: 'stand-in',
		good: 1,
		ok: 0,
		higherIsBetter: true,
		unit: 'count',
		value: 0,
		grade,
		unmeasurable: false,
	});

	/** A card with a `good` section keeps the sentence that says so. */
	it('says some parts were solid when a section actually graded good', () => {
		expect(
			hasSolidSection({
				overall: 'ok',
				sections: { a: section([metric('good')]), b: section([metric('bad')]) },
			}),
		).toBe(true);
	});

	/**
	 * And a card whose every section is `ok` or `bad` takes the flat arm. This is the shape the fix is
	 * for: nothing to point at as solid, so the sentence stops pointing.
	 */
	it('takes the flat wording when nothing graded good', () => {
		expect(
			hasSolidSection({
				overall: 'ok',
				sections: { a: section([metric('ok')]), b: section([metric('bad')]) },
			}),
		).toBe(false);
	});

	/**
	 * An unmeasurable section is not a solid one. Without this, a pull whose only `good`-looking card is
	 * a rule nobody could read would take the mixed sentence off the back of a section the reader is told
	 * elsewhere was never judged.
	 */
	it('does not count a section nothing could measure', () => {
		expect(
			hasSolidSection({
				overall: 'ok',
				sections: { a: section([{ ...metric('good'), unmeasurable: true }]) },
			}),
		).toBe(false);
	});

	/** The two sentences are different copy, so the split is visible to a reader and not only to a test. */
	it('has a sentence of its own that claims no spread', () => {
		expect(t('overall.okFlat')).not.toBe('overall.okFlat');
		expect(t('overall.okFlat')).not.toContain('solid and others');
		expect(t('overall.ok')).toContain('solid');
	});
});
