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

/**
 * A mean that grades a distribution, and a sentence that spoke for every brew in it.
 *
 * `brewStacks` grades the *average* stacks a brew spent, `good` at 9.5 or better — so nineteen brews at
 * ten and one at half a bank average 9.53 and grade `good`, and `verdict_good_other` said "near the cap
 * every time" over the one that was nowhere near it. Unlike the sibling defects this one needs no
 * synthetic at all: `mixed` is seven brews averaging 9.7 with one spent at eight, and the chart draws
 * "8 stacks" three lines above the sentence denying it.
 *
 * The fix is the shape `flameShock.verdict_goodSome` set: the absolute claim is kept byte for byte for the
 * pull that earns it, and a fourth sentence names how many brews went out short. The count comes off
 * `fullUses`, which the audit already publishes as the brews that spent the whole ten.
 *
 * **The metric question this leaves open is recorded in the report, not answered here.** A mean with no
 * floor beside it cannot separate these two pulls, and no wording can fix that: `poor` averages exactly
 * 9.5 with a brew at seven and `brewStacks` calls it `good`. That is an argument for a worst-brew term in
 * the rule, which is a scoring change and not a copy one.
 */
describe('a good Tigereye Brew verdict claims only what the mean can support', () => {
	const mixed = fixture('mixed');

	/** The premise, so nothing below is vacuous. */
	it('is a good pull with a brew spent under ten in it', () => {
		const card = getSpec('windwalker')!.score(mixed);
		expect(card.sections['brew']?.grade).toBe('good');
		expect(mixed.brew.uses).toBe(7);
		expect(mixed.brew.fullUses).toBe(6);
		expect(Math.min(...mixed.brew.useList.map((u) => u.consumed))).toBe(8);
		expect(mixed.brew.avgConsumed).toBeGreaterThan(9.5);
	});

	it('does not tell a reader every brew was near the cap when one was not', () => {
		const html = render(mixed);
		// The sentence the old code printed here, verbatim.
		expect(html).not.toContain('averaging 9.7 of 10 stacks — near the cap every time');
		expect(html).not.toContain('near the cap every time');
		expect(html).toContain(t('brew.verdict', { context: 'goodSome', count: 7, avg: mixed.brew.avgConsumed, lean: 1 }));
		expect(html).toContain('7 brews spent, averaging 9.7 of 10 stacks.');
		expect(html).toContain('1 of them went out with the bank under ten');
		expect(html).toContain('wait for the tenth stack');
		// The clauses after it are unchanged and still have their antecedents.
		expect(html).toContain(t('brew.cap', { context: 'good', count: 0 }));
		expect(html).toContain(t('brew.bankLeft', { count: mixed.brew.bankAtEnd }));
	});

	/**
	 * The pull that earns the absolute claim keeps it. No committed fixture spends ten every time — the
	 * six run from three of six full to eleven of sixteen — so this is `mixed` with the two figures the
	 * sentence and the arm are chosen on rewritten to the pull that would earn it.
	 */
	it('still says near the cap every time when every brew was at the cap', () => {
		const full: Analysis = { ...mixed, brew: { ...mixed.brew, fullUses: mixed.brew.uses, avgConsumed: 10 } };
		const html = render(full);
		expect(html).toContain(t('brew.verdict', { context: 'good', count: 7, avg: 10 }));
		expect(html).toContain('7 brews spent, averaging 10 of 10 stacks — near the cap every time.');
		expect(html).not.toContain('went out with the bank under ten');
	});

	/**
	 * One brew is the case the plural split already handled and it stays untouched: with a single brew the
	 * mean *is* that brew, and stacks are integers, so a `good` grade means it spent ten. That is why
	 * `verdict_good_one` never made the claim its plural sibling did, and why `goodSome` has no `_one`.
	 */
	it('leaves the single-brew sentence alone', () => {
		const one: Analysis = {
			...mixed,
			brew: { ...mixed.brew, uses: 1, fullUses: 1, avgConsumed: 10 },
		};
		expect(render(one)).toContain(t('brew.verdict', { context: 'good', count: 1, avg: 10 })); // no-change guard
		expect(render(one)).toContain('1 brew spent, averaging 10 of 10 stacks.');
	});

	/**
	 * And the other grades are still chosen by the grade. `poor` is the pull that makes the metric
	 * argument: `brewStacks` grades its 9.5 mean `good` over a brew that spent seven, and only the cap
	 * metric beside it pulls the section down to `bad`.
	 */
	it('leaves the ok and bad sentences to the grade', () => {
		const poor = fixture('poor');
		const card = getSpec('windwalker')!.score(poor);
		expect(card.sections['brew']?.metrics.find((m) => m.key === 'brewStacks')?.grade).toBe('good');
		expect(card.sections['brew']?.grade).toBe('bad');
		expect(render(poor)).toContain(t('brew.verdict', { context: 'bad', count: 6, avg: poor.brew.avgConsumed })); // no-change guard
		const strong = fixture('strong');
		expect(render(strong)).toContain(t('brew.verdict', { context: 'ok', count: 16, avg: strong.brew.avgConsumed })); // no-change guard
	});
});
