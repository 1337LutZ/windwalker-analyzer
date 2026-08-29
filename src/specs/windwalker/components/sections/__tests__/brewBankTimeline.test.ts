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
		expect(tile(forgiven, t('brew.kpi.capped')).classes).toContain('border-l-good');
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
		expect(html).not.toContain('averaging 9.7 of 10 stacks, near the cap every time');
		expect(html).not.toContain('near the cap every time');
		expect(html).toContain(t('brew.verdict', { context: 'short', count: 7, avg: mixed.brew.avgConsumed, short: 1 }));
		expect(html).toContain('7 brews spent, averaging 9.7 of 10 stacks.');
		expect(html).toContain('1 went out under ten with nothing asking for it');
		expect(html).toContain('Hold until the bank reads ten');
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
		// `good` at 9 puts the mean of 9.25 on the right side of the line, which sharpens this test rather
		// than weakening it: the section is `bad` while its mean metric is `good`, so the letter can only
		// be coming from the short brews.
		expect(card.sections['brew']?.metrics.find((m) => m.key === 'brewStacks')?.grade).toBe('good');
		expect(short(strong)?.value).toBe(3);

		const html = render(strong);
		// The sentence the letter used to select, verbatim.
		expect(html).not.toContain(t('brew.verdict', { context: 'bad', count: 16, avg: strong.brew.avgConsumed }));
		expect(html).not.toContain('averaging only');
		expect(html).toContain('3 went out under ten with nothing asking for it');
		// Three of sixteen, not three of the five that went out under ten: `lean` counts the list's own
		// presses and this number does not.
		expect(strong.brew.uses - strong.brew.fullUses).toBe(5);
		expect(html).toContain('16 brews spent, averaging 9.3 of 10 stacks.');
	});

	/**
	 * The inversion, and the reason `shortExcused` is a fourth sentence rather than a wording tweak.
	 * `cleave` has the worst mean in the set at 8.5 and not one brew to answer for: two of its three
	 * short brews caught a proc on its last global and the third was the tail dump. A clause keyed on
	 * `lean` would have said "3 went out under ten" and then named that excuse.
	 */
	it('says the short brews were the right press when every one of them was', () => {
		const cleave = fixture('cleave');
		expect(cleave.brew.uses - cleave.brew.fullUses).toBe(3);
		expect(short(cleave)?.value).toBe(0);

		const html = render(cleave);
		expect(html).toContain(
			t('brew.verdict', { context: 'shortExcused', count: 6, avg: cleave.brew.avgConsumed, lean: 3 }),
		);
		expect(html).toContain('3 went out under ten');
		expect(html).toContain('Both are worth more than the stacks');
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
		expect(html).not.toContain('Both are worth more than the stacks');
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
		expect(html).toContain('7 brews spent, averaging 10 of 10 stacks, near the cap every time.');
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
	 * The mean sentence, on the pull whose letter is not about the mean at all.
	 *
	 * `lean === 0` and a `bad` cap: every brew spent a full ten — so `brewStacks` grades `good` and the
	 * mean is exactly ten by arithmetic — while the bank sat at twenty and `brewCapWaste` grades `bad`.
	 * The section letter is the worst of the three, so it letters `bad`, and asking that letter for a
	 * sentence about the mean printed "**averaging only 10 of 10 stacks**". "Only" about a perfect mean,
	 * with the fault it was reaching for named on the very next line by the cap clause.
	 *
	 * `poor` is the pull with the cap waste — ten stacks refused, `brewCapWaste` `bad` — and `allFull`
	 * is the same rewrite the "near the cap" case above uses, because no committed fixture spends ten
	 * every time. Both halves are asserted, so this cannot pass by the cap quietly grading something
	 * else.
	 */
	it('does not say only about a mean of ten because the bank overflowed', () => {
		const full = allFull(fixture('poor'));
		const card = WINDWALKER_SPEC.score(full);
		expect(full.brew.avgConsumed).toBe(10);
		expect(card.sections['brew']?.metrics.find((m) => m.key === 'brewStacks')?.grade).toBe('good');
		expect(card.sections['brew']?.metrics.find((m) => m.key === 'brewCapWaste')?.grade).toBe('bad');
		expect(card.sections['brew']?.grade).toBe('bad');

		const html = render(full);
		// The sentence the letter used to select here, verbatim.
		expect(html).not.toContain(t('brew.verdict', { context: 'bad', count: full.brew.uses, avg: 10 }));
		expect(html).not.toContain('averaging only 10 of 10 stacks');
		expect(html).not.toContain('averaging only');
		// The mean's own sentence instead — and the cap fault is still on the page, in the clause whose
		// number it actually is.
		expect(html).toContain('6 brews spent, averaging 10 of 10 stacks, near the cap every time.');
		expect(html).toContain(t('brew.cap', { context: 'bad', count: 10 }));
	});

	/**
	 * The same fault one step milder, and the reason the fix is the mean's grade rather than a word
	 * removed from one sentence: an `ok` letter off the cap put "The gap is stacks you earned but never
	 * spent" over a mean with no gap in it.
	 */
	it('does not name a gap in a mean that has none', () => {
		const full = allFull(fixture('mixed'));
		// Three stacks and not four, since the metric became a share: `mixed` earned 74, so four is 5.41%
		// and lands `bad` against the 5% line while three is 4.05% and keeps the `ok` this case is about.
		const capped: Analysis = { ...full, brew: { ...full.brew, wastedAtCap: 3, maxStacks: 20 } };
		const card = WINDWALKER_SPEC.score(capped);
		expect(card.sections['brew']?.metrics.find((m) => m.key === 'brewCapWaste')?.grade).toBe('ok');
		expect(card.sections['brew']?.grade).toBe('ok');

		const html = render(capped);
		expect(html).not.toContain(t('brew.verdict', { context: 'ok', count: capped.brew.uses, avg: 10 }));
		expect(html).not.toContain('The gap is stacks you earned but never spent');
		expect(html).toContain('7 brews spent, averaging 10 of 10 stacks, near the cap every time.');
	});

	/**
	 * The other narrow path into these two sentences, kept: the count of short brews cannot be read, so
	 * the mean is all there is to report and its own grade is what reports it. `weave` is that pull and
	 * the sentence it gets is unchanged — what changed is that a `bad` cap can no longer reach in and
	 * pick a different one.
	 *
	 * `bad` needs a mean under 8.5, which no committed pull has on this path, so the synthetic drops
	 * `weave`'s mean and asserts the sentence follows the mean rather than the letter.
	 */
	it('lets the mean pick its own sentence where the short count cannot be read', () => {
		const weave = fixture('weave');
		expect(short(weave)?.unmeasurable).toBe(true);
		expect(render(weave)).toContain(t('brew.verdict', { context: 'ok', count: 5, avg: weave.brew.avgConsumed })); // no-change guard

		const poorMean: Analysis = { ...weave, brew: { ...weave.brew, avgConsumed: 7.2 } };
		const card = WINDWALKER_SPEC.score(poorMean);
		expect(card.sections['brew']?.metrics.find((m) => m.key === 'brewStacks')?.grade).toBe('bad');
		const html = render(poorMean);
		expect(html).toContain(t('brew.verdict', { context: 'bad', count: 5, avg: 7.2 }));
		expect(html).toContain('averaging only 7.2 of 10 stacks');
	});

	/**
	 * And "near the cap every time" cannot be claimed on that path, where a brew is known to have gone
	 * out under ten and only the count of the unexcused ones is unreadable. Two brews, one full and one
	 * at nine, is a mean of 9.5 — which `brewStacks` grades `good` — with `lean` of one.
	 */
	it('does not claim every brew was at the cap when the short count is merely unreadable', () => {
		const weave = fixture('weave');
		const twoBrews: Analysis = {
			...weave,
			brew: {
				...weave.brew,
				uses: 2,
				fullUses: 1,
				avgConsumed: 9.5,
				useList: [
					{ ...weave.brew.useList[0]!, consumed: 10 },
					{ ...weave.brew.useList[1]!, consumed: 9 },
				],
			},
		};
		const card = WINDWALKER_SPEC.score(twoBrews);
		expect(short(twoBrews)?.unmeasurable).toBe(true);
		expect(twoBrews.brew.uses - twoBrews.brew.fullUses).toBe(1);
		expect(card.sections['brew']?.metrics.find((m) => m.key === 'brewStacks')?.grade).toBe('good');

		const html = render(twoBrews);
		expect(html).not.toContain('near the cap every time');
		expect(html).toContain(t('brew.verdict', { context: 'ok', count: 2, avg: 9.5 }));
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

/**
 * The three sentences a pull with one brew could be shown, which were one sentence.
 *
 * `brew.verdict_good_one`, `verdict_ok_one` and `verdict_bad_one` shipped byte-identical:
 * *"{{count}} brew spent, averaging {{avg, decimal}} of 10 stacks."* three times over. The plural arms
 * differentiate — *"near the cap every time"*, *"The gap is stacks you earned but never spent"*,
 * *"averaging only"* — and the singulars did not, so at one brew the letter was invisible in the copy.
 * Rendered, before this change, a pull whose one brew spent five stacks read:
 *
 * > 1 brew spent, averaging 5 of 10 stacks. Nothing was lost to the stack cap. 6 stacks were still
 * > banked when the boss died.
 *
 * — a `bad` section telling the reader nothing at all went wrong, and the same words a `good` one got.
 *
 * **Two arms and not three, and the second half of this file is the argument.** Every sentence above is
 * chosen by the number it is about, and at one brew there is only one number available to choose with.
 * `brewShortUses` — the count that knows the two presses the priority list takes under ten on purpose —
 * draws its sample from the brews the list *required* ten of, which is at most one here, and
 * `MIN_GRADED_SAMPLE` refuses a sample of one. The first case below measures that at five different
 * stack counts rather than asserting it once: the refusal is total, so no single-brew pull can ever be
 * told whether its short brew was a Re-Origination press, a tail dump, or a mistake.
 *
 * What is left to split `ok` from `bad` is `brewStacks`' own line, and over a sample of one it separates
 * nine stacks from eight. One stack, and it decides whether the reader is told they wasted something.
 * So the two collapse into `verdict_oneShort`, which names the shortfall, names both readings of it, and
 * claims neither — the register `faulted === null` already asks for on the plural path.
 *
 * `verdict_good_one` is untouched and stays its own arm: it is reached only on `lean === 0`, where the
 * brew took the full ten and no excuse is needed to say so.
 *
 * **Every pull here is synthetic.** No committed Windwalker fixture spends fewer than three brews — see
 * `thinMean.test.ts`, which asserts that emptily — so `mixed` has its brew fields replaced with a single
 * use. The rest of the analysis is the fixture's, which is why the cap and bank clauses below are real.
 */
describe('a pull with one brew', () => {
	const mixed = fixture('mixed');

	const shortUses = (analysis: Analysis) =>
		WINDWALKER_SPEC.score(analysis).sections['brew']?.metrics.find((m) => m.key === 'brewShortUses');

	/** `mixed` with exactly one brew, which spent `consumed` of the ten a full brew takes. */
	const oneBrew = (consumed: number): Analysis => ({
		...mixed,
		brew: {
			...mixed.brew,
			uses: 1,
			fullUses: consumed >= 10 ? 1 : 0,
			avgConsumed: consumed,
			totalConsumed: consumed,
			useList: [{ ...mixed.brew.useList[0]!, consumed }],
		},
	});

	/**
	 * The premise the collapse rests on, measured across the whole reachable range rather than at one
	 * point. If a single-brew pull could ever read `brewShortUses`, the two sentences would have a real
	 * difference to carry and this arm would be hiding it.
	 */
	it.each([10, 9, 8, 7, 5])('cannot read the short-brew count at all with %i stacks spent', (consumed) => {
		const metric = shortUses(oneBrew(consumed));
		expect(metric?.unmeasurable).toBe(true);
		expect(metric?.sampleSize).toBe(1);
	});

	/** And that the letter really does move across that range, so the sentence had three to tell apart. */
	it('is graded good, ok and bad at ten, nine and eight stacks', () => {
		const gradeAt = (consumed: number) =>
			WINDWALKER_SPEC.score(oneBrew(consumed)).sections['brew']?.metrics.find((m) => m.key === 'brewStacks')?.grade;
		// Nine is `good` since the line moved, and eight is the `ok` the band still reaches at a sample of
		// one. Three letters, which is what this test is for.
		expect([gradeAt(10), gradeAt(9), gradeAt(8), gradeAt(5)]).toEqual(['good', 'good', 'ok', 'bad']);
	});

	/**
	 * The `bad` one, which is the reader this change is for. The old string is quoted whole: it is what
	 * the page said, and it says nothing.
	 */
	it('tells a five-stack brew it was short, where it used to tell it nothing', () => {
		const html = render(oneBrew(5));
		expect(html).not.toContain('1 brew spent, averaging 5 of 10 stacks. Nothing was lost to the stack cap.');
		expect(html).toContain(t('brew.verdict', { context: 'oneShort', count: 1, avg: 5 }));
		expect(html).toContain('one press cannot tell you which');
	});

	/** The `ok` one gets the same sentence, which is the collapse itself and not a fall-through. */
	it('says the same thing at nine stacks, because the same thing is all that can be said', () => {
		const nine = render(oneBrew(9));
		expect(nine).toContain(t('brew.verdict', { context: 'oneShort', count: 1, avg: 9 }));
		// The two arms that used to split these differ now only in the number, which is the point.
		expect(nine.replace('9 of 10', '5 of 10')).toContain(t('brew.verdict', { context: 'oneShort', count: 1, avg: 5 }));
	});

	/** Neither of the retired arms can be resolved any more, so neither can come back by fall-through. */
	it('leaves no singular ok or bad arm behind', () => {
		expect(i18n.exists('brew.verdict_ok_one', { ns: 'report' })).toBe(false);
		expect(i18n.exists('brew.verdict_bad_one', { ns: 'report' })).toBe(false);
	});

	/** A full single brew keeps its own arm, and keeps its own words. */
	it('still praises the one brew that took the full ten', () => {
		const html = render(oneBrew(10));
		expect(html).toContain('1 brew spent, averaging 10 of 10 stacks.');
		expect(html).not.toContain('not enough to tell which this was');
	});
});
