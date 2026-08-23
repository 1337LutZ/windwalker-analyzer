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
 * A mean that grades a distribution, a sentence that spoke for every brew in it, and a letter that
 * blamed the wrong number.
 *
 * `brewStacks` grades the *average* stacks a brew spent, `good` at 9.5 or better — so nineteen brews at
 * ten and one at half a bank average 9.53 and grade `good`, and `verdict_good_other` said "near the cap
 * every time" over the one that was nowhere near it. Unlike the sibling defects this one needed no
 * synthetic at all: `mixed` is seven brews averaging 9.7 with one spent at eight, and the chart draws
 * "8 stacks" three lines above the sentence denying it.
 *
 * **The metric question the first fix left open has since been answered, and it moved this clause off
 * the section letter.** `brewShortUses` grades the brews the priority list would have required a full
 * ten of — every brew bar a Re-Origination proc on its last global and the tail of the fight, the
 * list's own two floorless arms. That makes the letter the *worst* of three metrics, so keying the
 * sentence on it printed the wrong fault: `strong` letters `bad` off this very count and was handed
 * "averaging only 9.3 of 10 stacks", where the mean is not what went wrong and the three short brews
 * the sentence never named are.
 *
 * So the count sentence is chosen by the count, and there are two of them: `short` for brews nothing in
 * the pull asked for, and `shortExcused` for a pull whose every short brew was one of the two presses
 * the list makes. `cleave` is why the second exists — all three of its short brews are the list's own
 * play, and a sentence keyed on `lean` would have faulted them and then named their excuse in the next
 * breath.
 */
describe('the Tigereye Brew sentence names the fault its own metric found', () => {
	const mixed = fixture('mixed');

	/** Every brew full, so `verdict_good_other`'s absolute claim is the one thing it can be. */
	const allFull = (analysis: Analysis): Analysis => ({
		...analysis,
		brew: {
			...analysis.brew,
			fullUses: analysis.brew.uses,
			avgConsumed: 10,
			useList: analysis.brew.useList.map((use) => ({ ...use, consumed: 10 })),
		},
	});

	const short = (analysis: Analysis) =>
		WINDWALKER_SPEC.score(analysis).sections['brew']?.metrics.find((m) => m.key === 'brewShortUses');

	/** The premise, so nothing below is vacuous — and it is no longer a `good` section. */
	it('is a pull the mean passes and one brew does not', () => {
		const card = WINDWALKER_SPEC.score(mixed);
		expect(card.sections['brew']?.metrics.find((m) => m.key === 'brewStacks')?.grade).toBe('good');
		expect(mixed.brew.avgConsumed).toBeGreaterThan(9.5);
		// And the section letter now comes off the short brew instead, which is exactly why the sentence
		// below cannot be selected by that letter.
		expect(card.sections['brew']?.grade).toBe('ok');
		expect(mixed.brew.uses).toBe(7);
		expect(mixed.brew.fullUses).toBe(6);
		expect(Math.min(...mixed.brew.useList.map((u) => u.consumed))).toBe(8);
		expect(short(mixed)?.value).toBe(1);
	});

	it('does not tell a reader every brew was near the cap when one was not', () => {
		const html = render(mixed);
		// The sentence the original code printed here, verbatim.
		expect(html).not.toContain('averaging 9.7 of 10 stacks — near the cap every time');
		expect(html).not.toContain('near the cap every time');
		expect(html).toContain(t('brew.verdict', { context: 'short', count: 7, avg: mixed.brew.avgConsumed, short: 1 }));
		expect(html).toContain('7 brews spent, averaging 9.7 of 10 stacks.');
		expect(html).toContain('1 of them went out with the bank under ten and nothing in this pull asking for it');
		expect(html).toContain('Hold the brew until the bank reads ten');
		// The clauses after it are unchanged and still have their antecedents.
		expect(html).toContain(t('brew.cap', { context: 'good', count: 0 }));
		expect(html).toContain(t('brew.bankLeft', { count: mixed.brew.bankAtEnd }));
	});

	/**
	 * The pull the section letter would have mis-blamed. `strong` letters `bad`, and it letters `bad`
	 * *because* three brews went short — so `verdict_bad_other`'s "averaging only 9.3 of 10 stacks" put
	 * the fault on a mean that `brewStacks` itself grades `ok`, and never mentioned the three.
	 */
	it('blames the short brews rather than the mean on the pull the letter would have', () => {
		const strong = fixture('strong');
		const card = WINDWALKER_SPEC.score(strong);
		expect(card.sections['brew']?.grade).toBe('bad');
		expect(card.sections['brew']?.metrics.find((m) => m.key === 'brewStacks')?.grade).toBe('ok');
		expect(short(strong)?.value).toBe(3);

		const html = render(strong);
		// The sentence the letter used to select, verbatim.
		expect(html).not.toContain(t('brew.verdict', { context: 'bad', count: 16, avg: strong.brew.avgConsumed }));
		expect(html).not.toContain('averaging only');
		expect(html).toContain('3 of them went out with the bank under ten and nothing in this pull asking for it');
		// Three of sixteen, not three of the five that went out under ten: `lean` counts the list's own
		// presses and this number does not.
		expect(strong.brew.uses - strong.brew.fullUses).toBe(5);
		expect(html).toContain('16 brews spent, averaging 9.3 of 10 stacks.');
	});

	/**
	 * The inversion, and the reason `shortExcused` is a fourth sentence rather than a wording tweak.
	 * `cleave` has the worst mean in the set at 8.5 and not one brew to answer for: two of its three
	 * short brews caught a proc on its last global and the third was the tail dump. A clause keyed on
	 * `lean` would have said "3 of them went out with the bank under ten" and then named that excuse.
	 */
	it('says the short brews were the right press when every one of them was', () => {
		const cleave = fixture('cleave');
		expect(cleave.brew.uses - cleave.brew.fullUses).toBe(3);
		expect(short(cleave)?.value).toBe(0);

		const html = render(cleave);
		expect(html).toContain(
			t('brew.verdict', { context: 'shortExcused', count: 6, avg: cleave.brew.avgConsumed, lean: 3 }),
		);
		expect(html).toContain('3 of them went out with the bank under ten');
		expect(html).toContain('so those presses were the right ones');
		expect(html).not.toContain('nothing in this pull asking for it');
	});

	/**
	 * The trap in the published shape, and the pull that walks into it. `metricOf` returns
	 * `value: graded ?? 0`, so a metric too thin to grade reports a **zero it never measured** — `weave`
	 * keeps two brews after the exceptions take the rest, under `MIN_GRADED_SAMPLE`, and publishes
	 * `value: 0` beside `unmeasurable: true`. Read as a count, that zero congratulates a pull whose two
	 * short brews the report cannot see either way. So neither the praise nor the fault, and the graded
	 * sentence instead — the only one of the three that claims nothing about them.
	 */
	it('claims nothing either way about the pull whose sample is too small to grade', () => {
		const weave = fixture('weave');
		expect(short(weave)?.unmeasurable).toBe(true);
		// The zero the component must not read. Pinned, because it is the whole reason for the guard.
		expect(short(weave)?.value).toBe(0);
		expect(weave.brew.uses - weave.brew.fullUses).toBe(2);

		const html = render(weave);
		expect(html).not.toContain('so those presses were the right ones');
		expect(html).not.toContain('nothing in this pull asking for it');
		expect(html).toContain(t('brew.verdict', { context: 'ok', count: 5, avg: weave.brew.avgConsumed }));
	});

	/**
	 * The pull that earns the absolute claim keeps it — and now nothing else can reach it. No committed
	 * fixture spends ten every time, so this is `mixed` with its use list rewritten to the pull that
	 * would: the claim is gated on every brew being full rather than on a grade, and stacks are integers
	 * with a drain of exactly ten, so that is the only state in which "near the cap every time" is true.
	 */
	it('still says near the cap every time when every brew was at the cap', () => {
		const full = allFull(mixed);
		expect(short(full)?.value).toBe(0);
		const html = render(full);
		expect(html).toContain(t('brew.verdict', { context: 'good', count: 7, avg: 10 }));
		expect(html).toContain('7 brews spent, averaging 10 of 10 stacks — near the cap every time.');
		expect(html).not.toContain('went out with the bank under ten');
	});

	/**
	 * Why the two new sentences carry no `_one`, asserted rather than assumed — a plural form i18next
	 * cannot find renders the dotted key in the middle of the paragraph.
	 *
	 * Both are only selected when the count can be read at all, which takes `MIN_GRADED_SAMPLE` brews
	 * left after the exceptions. So `count` is at least three whenever either is chosen, and a one-brew
	 * pull falls through to the graded sentence instead. The synthetic is the case that would have
	 * needed a singular: one brew, spent short, landing on the plural-free path.
	 */
	it('never asks for a singular form of the two new sentences', () => {
		const one: Analysis = {
			...mixed,
			brew: { ...mixed.brew, uses: 1, fullUses: 0, avgConsumed: 8, useList: [mixed.brew.useList[0]!] },
		};
		expect(short(one)?.unmeasurable).toBe(true);
		const html = render(one);
		// No dotted key anywhere, which is what a missing plural renders as.
		expect(html).not.toContain('brew.verdict');
		expect(html).not.toContain('nothing in this pull asking for it');
		expect(html).not.toContain('were the right ones');
	});

	/**
	 * One *full* brew is the case the plural split already handled and it stays untouched: with a single
	 * brew the mean *is* that brew, so a full one means the mean is ten.
	 */
	it('leaves the single-brew sentence alone', () => {
		const one: Analysis = {
			...mixed,
			brew: { ...mixed.brew, uses: 1, fullUses: 1, avgConsumed: 10 },
		};
		expect(render(one)).toContain(t('brew.verdict', { context: 'good', count: 1, avg: 10 })); // no-change guard
		expect(render(one)).toContain('1 brew spent, averaging 10 of 10 stacks.');
	});
});
