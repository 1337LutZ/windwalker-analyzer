// One chart, three specs, and the claim that a shared drawing is actually shared.
//
// The Windwalker's flowchart used to live under `specs/windwalker/components/rotation`, the Elemental
// hand-rolled a column of bordered cards, and the Protection had no rotation reference at all. This
// file is the executable half of the promotion: each spec's own `FlowSlot[]` goes through the same
// component and each one has to come back a chart. **A component that renders nothing passes a type
// check** — the props are satisfied, the flow is a valid array, and an empty `<ol>` is valid HTML — so
// the assertions below are about what is in the markup rather than about whether it threw.
//
// `createElement` rather than JSX so this stays a `.ts` file and vitest's own include patterns pick it
// up — see `vitest.config.ts`, which collects only `.ts`.
//
// Nothing here needs an `Analysis` or a spec context. `FlowChart` reads the flow it is handed and the
// locale, and that is the whole of its input; the sections that wrap it are tested beside themselves.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import { flowKeys, type FlowSlot } from '~/lib/view/rotationFlow';
import { ROTATION_FLOW as ELE_FLOW, STAGE_BANDS } from '~/specs/elemental/lib/view/rotationFlow';
import { ROTATION_FLOW as PROT_FLOW } from '~/specs/protection/lib/view/rotationFlow';
import { CROSSOVER_GATES, rotationFlow } from '~/specs/windwalker/lib/view/rotationFlow';

import FlowChart from '../FlowChart';

initI18n();
const t = i18n.getFixedT('en', 'report');

const WW_FLOW = rotationFlow({ band: null, pressed: new Set<number>(), rune: null });

const WW_LEGEND = ['rotation.flow.legend.spine', 'rotation.flow.legend.gate', 'rotation.flow.legend.fork'];
const ELE_LEGEND = ['rotation.flow.legend.spine', 'rotation.flow.legend.stage', 'rotation.flow.legend.chip'];
const PROT_LEGEND = ['rotation.flow.legend.spine', 'rotation.flow.legend.chip'];

const draw = (props: {
	flow: readonly FlowSlot[];
	legend: readonly string[];
	details: boolean;
	crossings?: ReadonlyMap<string, string>;
}): string => renderToStaticMarkup(createElement(FlowChart, props));

/** React escapes an apostrophe to `&#x27;`, and half the Paladin's buttons carry one. */
const text = (markup: string): string => markup.replaceAll('&#x27;', "'").replaceAll('&quot;', '"');

/** The numbered circles down the left, which is the one mark every rung of every chart draws. */
const rungs = (markup: string): number => markup.split('animate-rung-in').length - 1;

const CHARTS = [
	{ spec: 'windwalker', flow: WW_FLOW, legend: WW_LEGEND, details: true, crossings: CROSSOVER_GATES },
	{ spec: 'elemental', flow: ELE_FLOW, legend: ELE_LEGEND, details: false, crossings: STAGE_BANDS },
	{ spec: 'protection', flow: PROT_FLOW, legend: PROT_LEGEND, details: true, crossings: undefined },
] as const;

describe('the shared rotation chart draws every spec', () => {
	it.each(CHARTS)('$spec gets a chart rather than an empty list', (chart) => {
		const markup = draw(chart);
		// The list itself, named by the caption every chart shares.
		expect(markup).toContain(t('rotation.flow.caption'));
		// One `<li>` per rung, and the flow is not empty in the first place — an empty flow would satisfy
		// every other assertion in this block by having nothing to disagree with.
		expect(chart.flow.length).toBeGreaterThan(10);
		expect(rungs(markup)).toBe(chart.flow.length);
		// And every button on it, by name. This is the assertion that fails on a chart that drew its
		// boxes and left the copy behind.
		for (const key of flowKeys(chart.flow)) {
			expect(text(markup), `${chart.spec}: ${key}`).toContain(t(`rotation.entry.${key}.name`));
		}
	});

	it.each(CHARTS)('$spec prints the legend it asked for, and no other', (chart) => {
		const markup = text(draw(chart));
		for (const line of chart.legend) expect(markup, line).toContain(t(line));
		// The lines it did *not* ask for stay off the page. A legend naming a mark this chart never draws
		// sends a reader looking for a dashed box that is not there, which is why the prop exists.
		const unused = [...WW_LEGEND, ...ELE_LEGEND, ...PROT_LEGEND].filter((line) => !chart.legend.includes(line));
		for (const line of new Set(unused)) expect(markup, line).not.toContain(t(line));
	});

	/**
	 * The one prop that changes the shape of a rung rather than its words.
	 *
	 * `details` is false for the Elemental, whose rules are one line each with nothing behind them, so
	 * that chart has no disclosure buttons and no control to open them all. The other two carry a
	 * paragraph per rung and every box is pressable. Asserted through `aria-expanded` because that is
	 * the attribute a screen reader is promised, and it is the one an empty panel would still carry.
	 */
	it.each(CHARTS)('$spec discloses a paragraph per rung only where its copy has one', (chart) => {
		const markup = draw(chart);
		const buttons = markup.split('aria-expanded').length - 1;
		expect(buttons).toBe(chart.details ? flowKeys(chart.flow).length : 0);
		expect(markup.includes(t('rotation.flow.expand'))).toBe(chart.details);
		if (!chart.details) return;
		for (const key of flowKeys(chart.flow)) {
			expect(text(markup), `${chart.spec}: ${key}`).toContain(t(`rotation.entry.${key}.why`));
		}
	});

	/**
	 * No chart renders a key at a reader, which is the failure i18next is built to be quiet about.
	 *
	 * A missing key comes back as the key itself, so `rotation.entry.judgment.name` would render as
	 * those words and every other assertion here would still pass. The three legends and the two band
	 * maps carry copy keys as props, which is the house pattern and also the route by which a typo
	 * reaches the page silently — the literal never sits inside a `t(...)`, so `keys.test.ts` cannot
	 * check it exists. This is where that is checked.
	 */
	it.each(CHARTS)('$spec renders copy rather than the keys it was handed', (chart) => {
		expect(draw(chart)).not.toContain('rotation.');
	});
});

describe('the marks each chart draws', () => {
	/** The Windwalker's four crossovers, across the line, and its three forks inside dashed boxes. */
	it('draws the Windwalker’s bands and forks', () => {
		const markup = text(draw({ flow: WW_FLOW, legend: WW_LEGEND, details: true, crossings: CROSSOVER_GATES }));
		for (const [, copy] of CROSSOVER_GATES) expect(markup).toContain(t(copy));
		expect(markup.split('border-dashed').length - 1).toBe(WW_FLOW.filter((slot) => 'fork' in slot).length);
		expect(WW_FLOW.filter((slot) => 'fork' in slot).length).toBeGreaterThan(0);
	});

	/** The Elemental's three stages, which is the structure the column of cards had and the chart keeps. */
	it('draws the Elemental’s three stages as bands and nothing as a fork', () => {
		const markup = text(draw({ flow: ELE_FLOW, legend: ELE_LEGEND, details: false, crossings: STAGE_BANDS }));
		expect(STAGE_BANDS.size).toBe(3);
		for (const [, copy] of STAGE_BANDS) expect(markup).toContain(t(copy));
		expect(markup).not.toContain('border-dashed');
	});

	/**
	 * The Protection's chips, which are the only thing on that chart a rung can carry.
	 *
	 * No band and no fork: its list is one order with no crossover in it, and the counts and talents it
	 * does gate on are facts about a single button rather than boundaries the line passes through.
	 */
	it('draws the Protection’s chips and neither of the other two marks', () => {
		const markup = text(draw({ flow: PROT_FLOW, legend: PROT_LEGEND, details: true }));
		const gated = PROT_FLOW.flatMap((slot) => ('fork' in slot ? slot.branches : [slot.entry])).filter((e) => e.gated);
		expect(gated.length).toBeGreaterThan(5);
		for (const entry of gated) expect(markup, entry.key).toContain(t(`rotation.gate.${entry.key}`));
		expect(markup).not.toContain('border-dashed');
	});
});
