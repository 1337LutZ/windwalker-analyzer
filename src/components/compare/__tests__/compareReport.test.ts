// The compare page rendered over the committed captures, in the node environment the rest of the
// suite runs in. `createElement` rather than JSX so this stays a `.ts` file and vitest picks it up.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { capturedAnalyses } from '~/lib/analysis/fixtures';
import { compare, type Pull } from '~/lib/compare';
import { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis } from '~/lib/types';
import { resolveBands } from '~/lib/view/targetMode';

import CompareReport from '../CompareReport';
import { SpecContext } from '../../report/specContext';

initI18n();

const spec = getSpec('windwalker')!;
const CAPTURED = new Map(
	capturedAnalyses('windwalker').map(({ name, analysis }) => [name.replace(/\.json$/, ''), analysis]),
);

function captured(name: string): Analysis {
	const analysis = CAPTURED.get(name);
	if (analysis === undefined) throw new Error(`no captured windwalker fixture ${name}`);
	return analysis;
}

function pull(name: string, choice: 'auto' | 'multi' = 'auto'): Pull {
	const analysis = captured(name);
	const view = resolveBands(analysis.targets, choice, analysis.segments);
	return { analysis, scorecard: spec.score(analysis, view), view };
}

function render(a: Pull, b: Pull): string {
	return renderToStaticMarkup(
		createElement(SpecContext.Provider, { value: spec }, createElement(CompareReport, { a, b })),
	);
}

const html = render(pull('strong'), pull('poor'));

describe('the compare page', () => {
	it('renders without a missing key on screen', () => {
		// A missing key is not a crash: i18next hands back the key itself, so the failure mode is
		// `compare.gaps.axis` rendered at a reader. Both namespaces are checked by their own stems.
		expect(html).not.toMatch(/compare\.[a-z]+\./i);
		expect(html).not.toMatch(/summary\.takeaways/i);
	});

	it('names both players, and names them in a fixed order', () => {
		const a = html.indexOf(captured('strong').player);
		const b = html.indexOf(captured('poor').player);
		expect(a).toBeGreaterThan(-1);
		expect(b).toBeGreaterThan(-1);
		// The first pull is named first, everywhere. Every figure below depends on that order holding.
		expect(a).toBeLessThan(b);
	});

	it('marks the two pulls by shape as well as by colour', () => {
		// Colour alone is not an identity channel. The first pull is filled and the second is a ring, and
		// a reader in greyscale or under full colour blindness reads the page off those two shapes.
		expect(html).toContain('bg-pull-a');
		expect(html).toContain('border-pull-b');
	});

	it('draws both marks, many times over', () => {
		// Two marks per scale, and the connector between them. The two counts are not asserted equal:
		// an ability one pull never pressed draws one mark and no second, which is the whole point of
		// that row.
		expect(html.split('bg-pull-a').length - 1).toBeGreaterThan(20);
		expect(html.split('border-pull-b').length - 1).toBeGreaterThan(20);
	});

	it('says what makes the two pulls hard to compare', () => {
		// Garrosh against Malkorok, at more than twice the length. Neither is hidden, and neither stops
		// the comparison being drawn.
		expect(html).toContain('Garrosh Hellscream');
		expect(html).toContain('Malkorok');
	});

	/**
	 * Real figures rather than a render hash, so a failure names what moved.
	 *
	 * Both come off `strong` and both are the shared formatter's own output. `12/14` is the one worth
	 * having: `snapshotRate` is 85.7%, and it prints as a count because it is a share over countable
	 * events — the rule `Scorecard` argues at length and this page gets for nothing by calling the same
	 * function. A compare page that grew its own formatter would print `85.7%` here and this would say so.
	 */
	it('prints both readings as text, in the format the report itself uses', () => {
		expect(html).toContain('12/14');
		expect(html).toContain('82.83%');
	});

	it('says a rule was not asked rather than drawing a gap for it', () => {
		// One side read at the target counts it was fought at, the other forced onto the multi-target
		// list, so `tigerPalmWaste` applies to one and not the other.
		const across = render(pull('strong'), pull('cleave', 'multi'));
		expect(across).toContain('Not asked of');
	});

	/**
	 * Two anonymous reports both numbering their monk `Player (10)`, which is the case the fixtures
	 * happen to contain and the rendered page found before any test did.
	 *
	 * Without the report code beside them every label on the page reads identically for both sides: the
	 * legend says one name twice, the two tally tiles are indistinguishable, and a refusal naming a
	 * player names neither of them.
	 */
	it('separates two pulls whose players are called the same thing', () => {
		// `poor` and `mixed` are one player's two pulls out of one report, so neither the name nor the
		// code tells them apart and the label has to fall through to the fight.
		const one = captured('poor');
		const two = captured('mixed');
		expect(one.player).toBe(two.player);
		expect(one.code).toBe(two.code);
		const collided = render(pull('poor'), pull('mixed'));
		expect(collided).toContain(`pull ${one.fightID}`);
		expect(collided).toContain(`pull ${two.fightID}`);
	});

	it('leaves the names alone when they already differ', () => {
		// `strong` is Player (17) and `poor` is Player (10), so nothing needs disambiguating and the
		// labels stay short.
		expect(html).not.toContain(captured('strong').code);
	});

	/**
	 * The ranked chart's captions name a figure and then that figure's own readings.
	 *
	 * They used to name a figure and then the *distance* between the two logs, in the axis's abstract
	 * unit — "Health reflected 1.6" — which reads as the value of health reflected and is not. The size
	 * is on screen twice already, as the dot's distance from the rule and as the axis; this line is the
	 * only place the actual numbers appear before the detail further down.
	 */
	it('captions the ranked chart with each log’s own reading, not the distance between them', () => {
		// `12/14` and `2/8` are the two procs-caught readings on this pair, in the count form the shared
		// formatter produces. Both belong to the widest figure in the Snapshots row.
		expect(html).toContain('12/14');
		expect(html).toContain('2/8');
		// And the chart carries no bare one-decimal distance beside a figure's name.
		expect(html).not.toMatch(/Procs caught<\/span><span[^>]*>\s*2\.4/);
	});

	/**
	 * One order for the two logs, everywhere on the page.
	 *
	 * The ranked chart used to read the other way round: its legend named the second log first and its
	 * axis put the first log on the right, because that is where the sign of `bands` sends it. Every
	 * other figure names the first log first, so the chart was the one place a reader had to hold an
	 * exception.
	 */
	it('puts the first log first in the ranked chart, legend and axis alike', () => {
		const chart = html.slice(html.indexOf('compare-gaps-heading'), html.indexOf('compare-metrics-heading'));
		expect(chart).not.toBe('');

		// The legend names them in the page's order.
		const legend = chart.match(/<figcaption[\s\S]*?<\/figcaption>/)?.[0] ?? '';
		expect(legend.indexOf(captured('strong').player)).toBeGreaterThan(-1);
		expect(legend.indexOf(captured('strong').player)).toBeLessThan(legend.indexOf(captured('poor').player));

		// And every dot sits on its own log's side of the rule: the first log left of centre, the second
		// right of it. A tied dot is neutral and lands on the rule itself, so both bounds are inclusive.
		const dots = [...chart.matchAll(/class="([^"]*?(?:bg-pull-a|border-pull-b)[^"]*?)"[^>]*?style="left:([\d.]+)%"/g)];
		expect(dots.length).toBeGreaterThan(4);
		for (const [, cls, left] of dots) {
			const atPercent = Number(left);
			if (cls?.includes('bg-pull-a')) expect(atPercent).toBeLessThanOrEqual(50);
			else expect(atPercent).toBeGreaterThanOrEqual(50);
		}
	});

	/**
	 * Every comparable figure gets a row, and every row names both logs.
	 *
	 * The chart used to draw a dot per figure and name only the widest one either way, so a section
	 * holding three lost one and a section the two logs tied on lost all of them — Potions drew a dot
	 * and said nothing at all about it. A dot with no reading beside it is a position on an axis and
	 * nothing else.
	 */
	it('lists every comparable figure, with both logs on each', () => {
		const chart = html.slice(html.indexOf('compare-gaps-heading'), html.indexOf('compare-metrics-heading'));
		const comparable = compare(pull('strong'), pull('poor'))
			.sections.flatMap((section) => section.metrics)
			.filter((gap) => gap.bands !== null);
		expect(comparable.length).toBeGreaterThan(8);

		// One swatch per log per figure, plus the pair in the legend. Counting the first log's swatch and
		// the second's separately catches a row that names one of them and not the other.
		const swatches = (mark: string) => chart.split(`size-2.5 shrink-0 rounded-full ${mark}`).length - 1;
		expect(swatches('bg-pull-a')).toBe(comparable.length + 1);
		expect(swatches('border-2 border-pull-b')).toBe(comparable.length + 1);

		// The two the old shape dropped: a section's third figure, and a figure the logs tied on.
		expect(chart).toContain('Stacks per brew');
		expect(chart).toContain('Potions used');
	});

	it('refuses to compare timelines, and says so', () => {
		expect(html).toContain('do not line up second for second');
	});

	it('renders a pull against itself, with nothing refused and nothing to say', () => {
		// The degenerate case has to draw rather than divide by nothing: every gap is zero, every mark
		// sits on its opposite, and no row is exempt. What the tally reads is `build.test.ts`'s business.
		const self = render(pull('strong'), pull('strong'));
		expect(self).not.toContain('Not asked of');
		expect(self).not.toMatch(/compare\.[a-z]+\./i);
		expect(self).toContain('12/14');
	});
});
