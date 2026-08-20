// The Flame Shock verdict, which is two sentences about the same number and must not read as one.
//
// The section's grade is the worse of two metrics — the dot's uptime and the share of refreshes that
// bought nothing — so a pull that never let the dot off the target can still be graded `bad` on its
// refreshes alone. The graded sentences used to be written as though only uptime could put them
// there, and the `bad` one asserted "the dot spent much of the pull down": a magnitude the number
// beside it contradicted, in a direction ("down") a reader parses as *you failed to apply it*.
//
// Both halves are pinned here: the wording a pull with a gap gets, and the wording a pull with no gap
// gets, at each grade the second metric can produce.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';

import FlameShock from '../FlameShock';

const ELEMENTAL_SPEC = getSpec('elemental')!;

initI18n();
const t = i18n.getFixedT('en', 'report');

type El = Analysis & ElementalAuditResult;

/**
 * `a:xB3kh7v9pF2AHRtq` #16 — the unbroken pull: one apply, six refreshes, and a dot that is never off
 * the target. Analysed once; each case below overrides the two fields the verdict reads.
 *
 * Two of those six refreshes landed in the dot's last tick window and four did not, so the pull's own
 * `windowed` is 2 and its refresh share grades `bad`. That is the right reading of the log and it is not
 * what most of these cases are about — they are about which *sentence* each grade produces — so the
 * cases that need a clean refresh ledger say so with `PERFECT_KEEPUP` rather than leaning on the
 * fixture's own number. It used to be 6, back when a 3 000ms setting decided it.
 */
const unbroken: El = analyse(
	JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../__fixtures__/unbroken.json'), 'utf8')) as FightDataset,
) as El;

const withFlameShock = (over: Partial<El['flameShock']>): El => ({
	...unbroken,
	flameShock: { ...unbroken.flameShock, ...over },
});

const render = (analysis: Analysis) =>
	renderToStaticMarkup(
		createElement(SpecContext.Provider, { value: ELEMENTAL_SPEC }, createElement(FlameShock, { analysis })),
	);

const CASTS = unbroken.flameShock.applies + unbroken.flameShock.refreshes;
/** Every refresh in its tick window: the ledger a `good` refresh share needs. */
const PERFECT_KEEPUP = { windowed: unbroken.flameShock.refreshes };

describe('Flame Shock verdict', () => {
	it('never tells a reader the dot was down without saying what that is a share of', () => {
		// The claim the copy is not allowed to make: a magnitude no number on the page supports, in the
		// one word a reader reads as "you never applied it".
		expect(t('flameShock.verdict', { context: 'bad', uptime: 82.4, casts: 9, wasted: 4 })).not.toContain(
			'much of the pull down',
		);
	});

	/** A real gap: 82.4% uptime, every refresh wasted, so the grade is `bad` on both metrics. */
	it('says which way the uptime figure runs on a pull with a gap', () => {
		const html = render(withFlameShock({ uptimePct: 82.4, windowed: 0 }));
		expect(html).toContain(
			t('flameShock.verdict', {
				context: 'bad',
				uptime: 82.4,
				casts: CASTS,
				wasted: unbroken.flameShock.refreshes,
			}),
		);
		expect(html).toContain('82.4% uptime');
		expect(html).toContain('off the target for the rest of the time you had something to hit');
	});

	/** The pull as it really was: 99.99946% uptime, no wasted refresh. */
	it('says the dot was up the whole time rather than reporting a share of one', () => {
		expect(unbroken.flameShock.uptimePct).toBeGreaterThan(99.995);
		const html = render(withFlameShock(PERFECT_KEEPUP));
		expect(html).toContain(t('flameShock.verdict', { context: 'good_full', casts: CASTS }));
		expect(html).not.toContain('uptime across');
	});

	/**
	 * The pull the reader complained about: nothing wrong with the keep-up, everything wrong with the
	 * refreshes, and a sentence that read as a complaint about the flawless half.
	 */
	it('does not describe a gap on a graded-bad pull that never had one', () => {
		const html = render(withFlameShock({ windowed: 0 }));
		expect(html).toContain(
			t('flameShock.verdict', { context: 'bad_full', casts: CASTS, wasted: unbroken.flameShock.refreshes }),
		);
		expect(html).toContain('The grade is about the refreshes, not the uptime');
		expect(html).not.toContain('off the target for the rest');
		expect(html).not.toContain('much of the pull down');
	});

	/**
	 * The middle grade exists too: one refresh in six outside the window is a 16.7% share, which lands
	 * between the two bands. It is also the singular, which reads without a plural form because the
	 * count is "N of the refreshes" rather than a bare "N refreshes".
	 */
	it('has its own wording for a middling refresh share on a perfect keep-up', () => {
		const html = render(withFlameShock({ windowed: 5 }));
		expect(html).toContain(t('flameShock.verdict', { context: 'ok_full', casts: CASTS, wasted: 1 }));
		expect(html).toContain('1 of the refreshes went out with it still healthy');
	});

	/**
	 * The band, against the figure the page prints rather than against 100 exactly.
	 *
	 * 99.995 and up renders as `100%` at the two decimals `formatPercentValue` uses, so that is where
	 * the sentence has to change: below it the page shows a gap and the prose has to account for one.
	 */
	it('changes wording where the printed figure changes', () => {
		expect(render(withFlameShock({ ...PERFECT_KEEPUP, uptimePct: 99.994 }))).toContain('99.99% uptime');
		expect(render(withFlameShock({ ...PERFECT_KEEPUP, uptimePct: 99.995 }))).toContain(
			t('flameShock.verdict', { context: 'good_full', casts: CASTS }),
		);
		// A value over 100 was reachable when the numerator was a union of dot windows and the
		// denominator the engaged clock; 100.21% came off a real pull. `c85f6d4` intersects the two before
		// dividing, so the ratio cannot exceed 100 any more and this case is a backstop rather than a live
		// reading. Kept, and kept asserted, because the branch it guards is the one whose failure prints a
		// gap on a pull that never had one — the `unbroken` case above (99.99946%, printing as 100%) is
		// what makes the band necessary, and this is what stops a value past it falling out of the band.
		expect(render(withFlameShock({ ...PERFECT_KEEPUP, uptimePct: 100.21 }))).toContain(
			t('flameShock.verdict', { context: 'good_full', casts: CASTS }),
		);
	});

	it('still says nothing was cast rather than claiming a perfect pull', () => {
		const never = withFlameShock({ windows: [], uptimePct: 0, applies: 0, refreshes: 0, presses: [] });
		expect(render(never)).toContain(t('flameShock.verdict', { context: 'none' }));
	});
});

/**
 * The derived tick count reaches the page.
 *
 * It is the deliverable of measuring the cadence rather than trusting the spell: haste shortens the
 * interval and leaves the duration alone, so the *count* is what moves, and this pull's dot ran
 * seventeen ticks against the ten Flame Shock declares. Nothing else in the report tells a reader that,
 * and without it the tile beside it is ambiguous — "in the last tick" is a different number of seconds
 * on every pull.
 */
describe('the tick count', () => {
	it('is rendered, and is the measured count rather than the declared one', () => {
		expect(unbroken.flameShock.ticks).toBe(17);
		expect(unbroken.flameShock.durationMs / 3000).toBe(10);
		expect(render(unbroken)).toContain(t('flameShock.kpi.ticks'));
	});
});
