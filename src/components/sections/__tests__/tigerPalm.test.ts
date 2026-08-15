// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns. The environment is node with no DOM, so this renders the section to
// static markup — which is exactly the state the modal ships in: closed, with nothing but its
// trigger in the tree.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import type { Analysis } from '~/lib/types';

import TigerPalm from '../TigerPalm';

initI18n();
const t = i18n.getFixedT('en', 'report');
// The chart's own placeholder copy is app-shell text, so it lives in the `ui` namespace.
const tUi = i18n.getFixedT('en', 'ui');

const fx = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../lib/__fixtures__/${name}.json`), 'utf8'));

const render = (analysis: Analysis) => renderToStaticMarkup(createElement(TigerPalm, { analysis }));

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
		expect(cards).toEqual([
			{ edge: 'border-rune', count: '9', share: '21.95%', label: t('tigerPalm.key.proc') },
			{ edge: 'border-kick', count: '2', share: '4.88%', label: t('tigerPalm.key.apply') },
			{ edge: 'border-kick', count: '0', share: '0%', label: t('tigerPalm.key.refresh') },
			{ edge: 'border-miss', count: '30', share: '73.17%', label: t('tigerPalm.key.wasted') },
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
		expect(html).toContain(t('tigerPalm.verdict', { context: 'none' }));
	});
});
