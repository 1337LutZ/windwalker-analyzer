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
	 * A pull every rule was asked of. 14 of 14 points, which is the case that has to print a figure too:
	 * "judged on all of it" is only readable as a contrast if the full case says so as well.
	 */
	it('prints the whole denominator on a pull it could judge in full', () => {
		const poor = fx('poor');
		const judged = scoreAnalysis(poor, resolveBands(poor.targets, 'auto')).judged!;
		expect(judged).toEqual({ measured: 14, total: 14, unmeasurable: false });

		const html = render(poor);
		expect(html).toContain(t('summary.judged', { measured: 14, total: 14 }));
		// And it is still a verdict: this pull is judged, so the grade's own sentence stands.
		expect(html).toContain(t('overall.bad'));
	});

	/**
	 * `cleave` under its own detected reading, which is the pull the reported bug came off.
	 *
	 * 10 of 13 — Tiger Palm's three points leave the reckoning because two in-band presses cannot judge
	 * the habit, and Rising Sun Kick is worth one rather than two on a pull read as multi-target. A
	 * `good` over ten thirteenths of the weight, which used to print exactly like a `good` over all of it.
	 */
	it('prints a short denominator on a pull part of which went unjudged', () => {
		const cleave = fx('cleave');
		const judged = scoreAnalysis(cleave, resolveBands(cleave.targets, 'auto')).judged!;
		expect(judged).toEqual({ measured: 10, total: 13, unmeasurable: false });

		const html = render(cleave);
		expect(html).toContain(t('summary.judged', { measured: 10, total: 13 }));
		expect(html).not.toContain(t('summary.judged', { measured: 13, total: 13 }));
	});

	/**
	 * And below `MIN_JUDGED_WEIGHT_SHARE` the sentence stops claiming anything.
	 *
	 * `poor` read as multi-target with no catchable procs: Tiger Palm's three points are outside the
	 * reading and snapshot rate's four have no denominator, which leaves 6 of 13 — under half, so
	 * `overallOf` sets `unmeasurable` and parks the grade at `ok`. The pull itself is real and only the
	 * two fields are synthetic, because no committed fixture is quiet enough to fall under the floor.
	 */
	it('refuses a verdict when too little of the weight survived', () => {
		const quiet = structuredClone(fx('poor'));
		quiet.procs.opportunities = 0;
		quiet.procs.snapshotted = 0;
		const card = scoreAnalysis(quiet, resolveBands(quiet.targets, 'multi'));
		expect(card.judged).toEqual({ measured: 6, total: 13, unmeasurable: true });
		expect(card.overall).toBe('ok');

		const html = render(quiet, 'multi');
		// The parked grade must not reach the reader as a reading of the pull.
		expect(html).not.toContain(t('overall.ok'));
		expect(html).toContain(t('overall.none'));
		expect(html).toContain(t('summary.judged', { context: 'partial', measured: 6, total: 13 }));
		// Neutral rather than amber: the panel's rule is the grade's colour, and there is no grade.
		expect(html).toContain('border-line');
		expect(html).not.toContain('border-brew');
	});
});
