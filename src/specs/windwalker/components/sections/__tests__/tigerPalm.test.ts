// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns. The environment is node with no DOM, so this renders the section to
// static markup — which is exactly the state the modal ships in: closed, with nothing but its
// trigger in the tree.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import type { Analysis } from '~/lib/types';

import { ScoreViewContext } from '~/components/report/scoreViewContext';
import { SpecContext } from '~/components/report/specContext';
import { getSpec } from '~/lib/spec';
import { resolveBands } from '~/lib/view/targetMode';

import TigerPalm from '../TigerPalm';

// Every fixture below is a Windwalker pull, so the section is rendered under the Windwalker's own
// scorer and copy. Named rather than left to `SpecContext`'s default, which is the build's pinned
// `DEFAULT_SPEC` — under `PUBLIC_SPEC=elemental` that scored these monk fixtures with the Shaman's
// thresholds.
const WINDWALKER_SPEC = getSpec('windwalker')!;
const asWindwalker = (node: ReactNode): ReactElement =>
	createElement(SpecContext.Provider, { value: WINDWALKER_SPEC }, node);

initI18n();
const t = i18n.getFixedT('en', 'report');
// The chart's own placeholder copy is app-shell text, so it lives in the `ui` namespace.
const tUi = i18n.getFixedT('en', 'ui');

const fx = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8'));

/**
 * The reading defaults to `auto`, which is what a reader gets until they touch the switch, and is
 * resolved through `resolveBands` rather than assembled here — so the band set the section is graded at
 * is the one the page would hand it.
 */
const render = (analysis: Analysis, choice: 'auto' | 'single' | 'multi' = 'auto') =>
	renderToStaticMarkup(
		asWindwalker(
			createElement(
				ScoreViewContext.Provider,
				{ value: resolveBands(analysis.targets, choice) },
				createElement(TigerPalm, { analysis }),
			),
		),
	);

/**
 * 30 wasted presses of 41. Every branch of the section is live on this pull, which is why it is the
 * one the assertions below are written against.
 */
const poor = fx('poor');

/** Colour, count, share and label pulled back out of one card, so all four are asserted together. */
const CARD =
	/border-t-4 bg-surface (border-[a-z]+)"[\s\S]*?<b[^>]*>(\d+)<em[^>]*> · ([\d.]+%)<\/em><\/b><span[^>]*>([^<]+)<\/span>/g;

describe('Tiger Palm summary cards', () => {
	/**
	 * The colours are the section's vocabulary — a proc is `rune` wherever it appears, in the cards,
	 * in the strip and in the detail table. Asserting the card as a whole is what makes swapping two
	 * of them fail: three cards with three right counts under two swapped colours is otherwise a
	 * passing render.
	 */
	it('gives each outcome its count, its share of the presses and its established colour', () => {
		const cards = [...render(poor).matchAll(CARD)].map((m) => ({
			edge: m[1],
			count: m[2],
			share: m[3],
			label: m[4],
		}));

		expect(poor.filler.casts).toBe(41);
		// Four cards, not three: putting Tiger Power up is its own outcome. This pull re-applied a
		// lapsed buff twice and refreshed a running one never, which the old three-card split reported
		// as "2 refreshes" — the same conflation that had a 20-second buff being "refreshed" seven
		// seconds into a fight.
		// Shares are printed to two decimals: at one, 9 of 41 and 2 of 41 rounded to `22%` and `4.9%`,
		// and figures a hair apart elsewhere in the report printed identical.
		// Worst first: the wasted presses are the only outcome a reader can act on, so they lead rather
		// than sitting behind three numbers that were fine.
		expect(cards).toEqual([
			{ edge: 'border-miss', count: '30', share: '73.17%', label: t('tigerPalm.key.wasted') },
			{ edge: 'border-kick', count: '2', share: '4.88%', label: t('tigerPalm.key.apply') },
			{ edge: 'border-kick', count: '0', share: '0%', label: t('tigerPalm.key.refresh') },
			{ edge: 'border-rune', count: '9', share: '21.95%', label: t('tigerPalm.key.proc') },
		]);
	});

	/** The graded sentence is what the section is for, and the cards do not replace it. */
	it('still carries the graded verdict and the uptime', () => {
		const html = render(poor);
		expect(html).toContain(t('tigerPalm.verdict', { context: 'bad', ...poor.filler }));
		expect(html).toContain(t('tigerPalm.uptime', { uptime: poor.filler.buffUptimePct }));
	});

	/**
	 * The timeline replaced a strip of squares and a modal table. It is an ApexCharts island, so the
	 * prerendered HTML holds its sized box and its legend and nothing else — the marks arrive after
	 * hydration, and so does the description.
	 *
	 * This used to assert the chart's `aria-label` server-side. It no longer appears there, and that
	 * is deliberate rather than a regression: `ApexChart` now applies `role="img"` and its label only
	 * once the chart has actually drawn, so an undrawn box does not announce a picture that is not
	 * there yet. What the server still owes the reader is the sized box, the legend, and — the point
	 * of the whole rewrite — no cast list inlined into every report's HTML.
	 */
	it('renders the press timeline rather than a strip or a modal', () => {
		const html = render(poor);
		// The placeholder that holds the space until the marks arrive.
		expect(html).toContain(tUi('chart.drawing'));
		// The strip is gone.
		expect(html).not.toMatch(/h-\[15px\]/);
		// So is the modal.
		expect(html).not.toContain('tigerPalm.detail');
	});

	/** All four outcomes are in the key, including the one this pull never did. */
	it('names every outcome in the legend', () => {
		const html = render(poor);
		for (const key of ['proc', 'apply', 'wasted'] as const) {
			expect(html, key).toContain(t(`tigerPalm.key.${key}`));
		}
	});

	/** A pull with no Tiger Palm has nothing to plot and must say so rather than draw an empty chart. */
	it('says nothing was pressed rather than drawing an empty chart', () => {
		const empty: Analysis = { ...poor, filler: { ...poor.filler, casts: 0, castList: [] } };
		const html = render(empty);
		expect(html).toContain(t('tigerPalm.unpressed'));
	});

	/**
	 * A pull the single-target habit could not be read off is told how many presses were readable.
	 *
	 * `cleave` presses Tiger Palm twelve times and exactly two of them with one enemy up, which is under
	 * the sample floor — so there is no grade. It used to print "Tiger Palm was never pressed in this
	 * pull" under four cards totalling twelve presses and a timeline of all twelve; `f832015` dropped that
	 * clause, which stopped the falsehood and left a silence where the reason is owed. The numbers in the
	 * sentence are the sample and the press count, so it cannot disagree with the cards above it.
	 */
	it('says how few of the presses the single-target habit could be read off', () => {
		const cleave = fx('cleave');
		const html = render(cleave);
		expect(cleave.filler.casts).toBe(12);
		expect(html).toContain(t('tigerPalm.verdict', { context: 'none', sample: 2, casts: 12 }));
		// The sentence this replaced, which stopped being true the moment a press count stopped being the
		// only way to have no grade.
		expect(html).not.toContain(t('tigerPalm.unpressed'));
		// And it is a clause on the section rather than a replacement for it: the twelve presses are still
		// drawn, still counted, and the uptime beside it is still true.
		expect(html).toContain(t('tigerPalm.key.wasted'));
		expect(html).toContain(t('tigerPalm.uptime', { uptime: cleave.filler.buffUptimePct }));
	});

	/**
	 * And a pull read as multi-target gets a different sentence, because "too few presses to tell" would
	 * be a falsehood there.
	 *
	 * Tiger Palm is the one Windwalker rule only one target count's list contains, so a reader forcing the
	 * multi-target reading has said this pull is not about the single-target filler at all. `strong` under
	 * that reading has **26** in-band presses and still no grade — so the two ways to have no grade cannot
	 * share a sentence.
	 */
	it('says the single-target habit is not the question when the pull is read as multi-target', () => {
		const strong = fx('strong');
		const html = render(strong, 'multi');
		expect(html).toContain(t('tigerPalm.verdict', { context: 'exempt', casts: strong.filler.casts }));
		expect(html).not.toContain(t('tigerPalm.verdict', { context: 'none', sample: 26, casts: 33 }));
		// Not a raw key, which is what a context arm with no copy behind it renders as.
		expect(html).not.toContain('tigerPalm.verdict');
	});
});

/**
 * The `good` sentence printed its own counter-example one clause earlier.
 *
 * `verdict_good` reads "…{{wasted}} wasted. Every press bought something." — and the two halves of that
 * are counted over different sets. `{{wasted}}` is `filler.wasted`, every press in the pull, while
 * `tigerPalmWaste` grades the share of presses made with one enemy up only (`tigerPalmShare`). So a pull
 * whose waste all happened above one enemy grades `good` on a numerator of zero and printed the absolute
 * claim over a ledger that contradicts it.
 *
 * **Live on `waves`, no synthetic needed**: 22 presses, one wasted, seven of them made in band 1 and none
 * of those wasted — a flat 0% share, `good`, and the sentence "1 wasted. Every press bought something."
 * in one breath, with the red `Wasted · 1` card directly above it.
 *
 * **No quantifier over the presses is safe**, which is the trap `flameShock.verdict_goodSome` was written
 * around: "almost every press bought something" would be false in the other direction, because the graded
 * numerator can be zero while the pull-wide ledger holds twelve. So the fourth sentence claims something
 * about the *grade* and names the count, and the clean pull keeps its absolute claim byte for byte.
 */
describe('a good Tiger Palm verdict claims only what the ledger can support', () => {
	const waves = fx('waves');

	/** The premise, so nothing below is vacuous. */
	it('is a good pull with a wasted press in it', () => {
		const card = getSpec('windwalker')!.score(waves, resolveBands(waves.targets, 'auto'));
		const waste = card.sections['tigerPalm']?.metrics.find((m) => m.key === 'tigerPalmWaste');
		expect(waste?.value).toBe(0);
		expect(waste?.grade).toBe('good');
		expect(waste?.unmeasurable).toBe(false);
		expect(waste?.sampleSize).toBe(7);
		expect(card.sections['tigerPalm']?.grade).toBe('good');
		expect(waves.filler.casts).toBe(22);
		expect(waves.filler.wasted).toBe(1);
	});

	it('does not tell a reader every press bought something when one did not', () => {
		const html = render(waves);
		// The sentence the old code printed here, verbatim.
		expect(html).not.toContain('1 wasted. Every press bought something.');
		expect(html).not.toContain('Every press bought something');
		expect(html).toContain(t('tigerPalm.verdict', { context: 'goodSome', ...waves.filler }));
		// The four counts still lead, then the grade's own tone, then the count and what to do about it.
		expect(html).toContain(
			'22 presses: 9 on a Combo Breaker proc, 9 putting Tiger Power up, 3 refreshing it, 1 wasted.',
		);
		expect(html).toContain('Tiger Palm is not what is holding this pull back');
		expect(html).toContain('1 of those presses still bought nothing');
		expect(html).toContain('a global that belonged to Jab or Blackout Kick');
		// And the clause beside it, which never depended on the grade, still reads.
		expect(html).toContain(t('tigerPalm.uptime', { uptime: waves.filler.buffUptimePct }));
	});

	/**
	 * The pull that earns the absolute claim keeps it, which is the half a hedge would have cost. `strong`
	 * is that pull for real — 33 presses, none wasted, graded `good` — so this is a no-change guard rather
	 * than a hand-written ledger.
	 */
	it('still says every press bought something when every press did', () => {
		const strong = fx('strong');
		expect(strong.filler.wasted).toBe(0);
		const html = render(strong);
		expect(html).toContain(t('tigerPalm.verdict', { context: 'good', ...strong.filler }));
		expect(html).toContain('Every press bought something.'); // no-change guard
		expect(html).not.toContain('is not what is holding this pull back');
	});

	/** The other three arms are chosen on the grade alone and the pull-wide count must not reach them. */
	it('leaves the ok and bad sentences to the grade', () => {
		const poorPull = fx('poor');
		expect(poorPull.filler.wasted).toBe(30);
		expect(render(poorPull)).toContain(t('tigerPalm.verdict', { context: 'bad', ...poorPull.filler })); // no-change guard
		const weave = fx('weave');
		expect(weave.filler.wasted).toBe(2);
		expect(render(weave)).toContain(t('tigerPalm.verdict', { context: 'ok', ...weave.filler })); // no-change guard
	});
});
