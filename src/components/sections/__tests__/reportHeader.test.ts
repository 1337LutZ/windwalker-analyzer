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
import { scoreAnalysis } from '~/specs/windwalker/lib/score';
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
	 * `cleave` under its own detected reading, which is the pull the reported bug came off.
	 *
	 * 11 of 14 — Tiger Palm's three points leave the reckoning because two in-band presses cannot judge
	 * the habit, and Rising Sun Kick is worth one rather than two on a pull read as multi-target. A
	 * `good` over eleven fourteenths of the weight, which used to print exactly like a `good` over all of
	 * it.
	 */
	it('prints a short denominator on a pull part of which went unjudged', () => {
		const cleave = fx('cleave');
		const judged = scoreAnalysis(cleave, resolveBands(cleave.targets, 'auto')).judged!;
		expect(judged).toEqual({ measured: 11, total: 14, unmeasurable: false });

		const html = render(cleave);
		expect(html).toContain(t('summary.judged', { measured: 11, total: 14 }));
		expect(html).not.toContain(t('summary.judged', { measured: 14, total: 14 }));
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
 * so (3) is not even needed — with `brew` and `karma` both lettering `bad` and three metrics scoring
 * zero. A reader of that pull was told the two red sections below were not real mistakes.
 */
describe('the good headline does not deny the faults under it', () => {
	it('is printed over a pull two of whose sections it grades bad', () => {
		const strong = fx('strong');
		const card = scoreAnalysis(strong, resolveBands(strong.targets, 'auto'));
		expect(card.overall).toBe('good');
		// Judged in full, so this is the worst case the letter permits with nothing excused.
		expect(card.judged).toEqual({ measured: 15, total: 15, unmeasurable: false });
		const bad = Object.entries(card.sections)
			.filter(([, score]) => !score.unmeasurable && score.grade === 'bad')
			.map(([key]) => key)
			.sort();
		expect(bad).toEqual(['brew', 'karma']);

		// The apostrophe in "spec's" comes back HTML-escaped out of `renderToStaticMarkup`, which is why
		// the two assertions above this block could compare the raw string and this one cannot.
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
		for (const denial of ['not real mistakes', 'small refinements']) {
			expect(good, denial).not.toContain(denial);
		}
	});
});
