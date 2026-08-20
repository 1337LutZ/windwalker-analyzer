import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import type { Analysis } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { getSpec } from '~/lib/spec';

import BrewBankTimeline from '../BrewBankTimeline';

// Every fixture below is a Windwalker pull, so the section is rendered under the Windwalker's own
// scorer and copy. Named rather than left to `SpecContext`'s default, which is the build's pinned
// `DEFAULT_SPEC` — under `PUBLIC_SPEC=elemental` that scored these monk fixtures with the Shaman's
// thresholds.
const WINDWALKER_SPEC = getSpec('windwalker')!;
const asWindwalker = (node: ReactNode): ReactElement =>
	createElement(SpecContext.Provider, { value: WINDWALKER_SPEC }, node);

initI18n();
const t = i18n.getFixedT('en', 'report');

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8'));

const render = (analysis: Analysis) =>
	renderToStaticMarkup(asWindwalker(createElement(BrewBankTimeline, { analysis })));

/**
 * The committed fixtures are captured `analyse()` output from before the engine counted stacks gained,
 * so they carry no `stacksGained` and cannot exercise the ratio. This is what those pulls will read
 * once they are re-captured — the arithmetic the bank walk asserts, applied to the fixture's own
 * numbers — rather than a figure invented for the test.
 */
const withGained = (analysis: Analysis): Analysis => ({
	...analysis,
	brew: {
		...analysis.brew,
		stacksGained: analysis.brew.totalConsumed + analysis.brew.bankAtEnd + analysis.brew.wastedAtCap,
	},
});

/** One tile's class list and markup, found by the label it carries. */
const tile = (html: string, label: string) => {
	const chunks = html.split('class="border-l-2').slice(1);
	const found = chunks.find((chunk) => chunk.includes(label));
	if (found === undefined) throw new Error(`no tile labelled ${label}`);
	return { classes: found.slice(0, found.indexOf('"')), markup: found };
};

describe('Tigereye Brew tile row', () => {
	it('shows what was spent against what was earned, and each leak on its own tile', () => {
		const analysis = withGained(fixture('strong'));
		const html = render(analysis);

		expect(html).toContain(t('brew.kpi.used'));
		expect(html).toContain(t('brew.kpi.banked'));
		expect(html).toContain(t('brew.kpi.capped'));
		// 148 of 151 spent, 3 still banked, none refused — and the two leaks are exactly the gap, which
		// is the property that lets the row be read without adding anything up wrongly.
		expect(tile(html, t('brew.kpi.used')).markup).toContain(' / 151');
		expect(analysis.brew.bankAtEnd + analysis.brew.wastedAtCap).toBe(151 - analysis.brew.totalConsumed);
	});

	/**
	 * A fixture that predates the engine field has no denominator, and a ratio out of nothing is worse
	 * than no ratio. The count still renders; the tile just declines to say what share of the pull it
	 * was, and stays uncoloured because there is nothing to colour it against.
	 */
	it('prints the count alone when the pull cannot say how many stacks were gained', () => {
		// The field is *removed* rather than the test trusting a fixture not to have it. Reaching a
		// fallback through a stale capture pins the file's age, not the behaviour — and it broke the
		// moment the fixtures were re-captured, which is exactly the signal that it was testing nothing.
		const captured = fixture('strong');
		const analysis: Analysis = { ...captured, brew: { ...captured.brew } };
		delete analysis.brew.stacksGained;
		const html = render(analysis);

		expect(html).toContain(t('brew.kpi.used'));
		// `em` is the suffix element, and no tile in this row carries one without a denominator.
		expect(html).not.toContain('<em');
		expect(tile(html, t('brew.kpi.used')).classes).toContain('border-l-line');
	});

	/**
	 * The fault that `brewCapWaste` had removed from it, and that a fresh tile is the obvious way to put
	 * back: a stack given up on purpose to hold a brew through a Re-Origination proc is not a stack the
	 * player lost. Both tiles have to forgive it, and the overcapped tile still has to *print* it.
	 */
	it('grades on the avoidable stacks while still showing every one the cap refused', () => {
		const poor = withGained(fixture('poor'));
		expect(poor.brew.wastedAtCap).toBe(10);

		const charged = render(poor);
		expect(tile(charged, t('brew.kpi.capped')).classes).toContain('border-l-miss');
		expect(tile(charged, t('brew.kpi.used')).classes).toContain('border-l-miss');

		// The same pull, with every lost stack traded for a proc the report says was worth more.
		const protectedPull: Analysis = {
			...poor,
			brew: { ...poor.brew, wastedProtecting: poor.brew.wastedAtCap },
		};
		const forgiven = render(protectedPull);
		expect(tile(forgiven, t('brew.kpi.capped')).classes).toContain('border-l-kick');
		// Still the raw ten, because the count is what happened and the grade is what was yours.
		expect(tile(forgiven, t('brew.kpi.capped')).markup).toContain('>10<');
		// And the ratio eases too, rather than charging the same ten stacks a second time.
		expect(tile(forgiven, t('brew.kpi.used')).classes).not.toContain('border-l-miss');
	});

	it('draws no tiles for a pull whose bank never moved', () => {
		const analysis = fixture('strong');
		const empty: Analysis = { ...analysis, brew: { ...analysis.brew, bankTimeline: [] } };
		const html = render(empty);

		expect(html).not.toContain(t('brew.kpi.used'));
		expect(html).toContain(t('empty.section'));
	});
});
