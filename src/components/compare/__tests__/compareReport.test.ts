// The compare page rendered over the committed captures, in the node environment the rest of the
// suite runs in. `createElement` rather than JSX so this stays a `.ts` file and vitest picks it up.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { capturedAnalyses } from '~/lib/analysis/fixtures';
import { compare, type Pull, identityFrom } from '~/lib/compare';
import { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis } from '~/lib/types';
import { resolveBands } from '~/lib/view/targetMode';

import CompareReport from '../CompareReport';
import { SpecContext } from '../../report/specContext';

initI18n();

const spec = getSpec('windwalker')!;
// Two spell ids can be one button — Jab has one per weapon type — and the registry is what says so.
const IDENTITY = identityFrom(spec.registry);
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
	 * The legend named the second log first while every other figure named the first log first, so the
	 * chart was the one place a reader had to hold an exception.
	 *
	 * **What this no longer asserts, and why.** It used to walk every dot and require the first log's
	 * to sit left of centre, because position on the old shared rail *was* who led. The rails carry
	 * each figure's own scale now, so a mark's position is its value: the first log sits left whenever
	 * it read lower, which on a lower-is-better figure is where the better log belongs. Keeping that
	 * assertion would have pinned the wrong invariant to the right name.
	 */
	it('names the first log before the second in the chart legend', () => {
		const chart = html.slice(html.indexOf('id="compare-gaps-heading"'), html.indexOf('id="compare-damage-heading"'));
		expect(chart).not.toBe('');
		const legend = chart.match(/<figcaption[\s\S]*?<\/figcaption>/)?.[0] ?? '';
		expect(legend.indexOf(captured('strong').player)).toBeGreaterThan(-1);
		expect(legend.indexOf(captured('strong').player)).toBeLessThan(legend.indexOf(captured('poor').player));
	});

	/**
	 * Every figure is drawn on its own scale, which is what replaced an axis whose unit could not be
	 * named. Two marks per comparable figure, and the zones they stand on come from that figure's own
	 * thresholds.
	 */
	it('draws each figure on its own scale rather than one shared axis', () => {
		const chart = html.slice(html.indexOf('id="compare-gaps-heading"'), html.indexOf('id="compare-damage-heading"'));
		const comparable = compare(pull('strong'), pull('poor'), IDENTITY)
			.sections.flatMap((section) => section.metrics)
			.filter((gap) => gap.bands !== null);
		// One filled mark and one ring per comparable figure, on the scales themselves. `CompareScale`
		// spells these classes; counting its exact ones is what makes this a claim about the scale
		// rather than about any violet pixel on the page.
		const filled = chart.split('rounded-full bg-pull-a ring-2 ring-surface').length - 1;
		const ringed = chart.split('rounded-full border-2 border-pull-b bg-surface ring-2 ring-surface').length - 1;
		expect(filled).toBe(comparable.length);
		expect(ringed).toBe(comparable.length);
		// And no trace of the axis that went: no tick row, no bare scale numbers.
		expect(chart).not.toContain('leading-none text-muted');
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

describe('the gear-proc block', () => {
	/**
	 * The block draws, names its rows off the game model, and says what an absent row means.
	 *
	 * The caveat is asserted rather than taken on trust because it is load-bearing: without it an
	 * absent row is a blank beside a real reading, and a reader supplies the wrong reason for it.
	 */
	it('draws the item effects and the note that makes an absent row readable', () => {
		expect(html).toContain(`id="compare-procs-heading"`);
		expect(html).toContain('Re-Origination');
		expect(html).toContain('Capacitance');
		// The class proc that shares the timeline's `proc` group and is not luck. See `build.test.ts`.
		expect(html).not.toContain('Combo Breaker: Tiger Palm');
		expect(html).toMatch(/different gear, or the same gear that never fired/);
	});

	/**
	 * The unit is on every reading, which is what a bare number could not say.
	 *
	 * `2.1` beside a trinket reads as a proc count, and a trinket does not fire 2.1 times. It is a
	 * rate on purpose: `strong` rolled the Rune 16 times over 8:55 and `poor` 9 times over 4:15, so
	 * the count favours the longer pull (16 against 9) and the rate says `poor` was luckier (1.86 against 2.14).
	 */
	it('prints the unit on every reading', () => {
		const block = html.slice(html.indexOf('id="compare-procs-heading"'), html.indexOf('id="compare-casts-heading"'));
		expect(block).toMatch(/\d\.\d\/min/);
		// And never the counts the rate was divided from, which read as the comparison itself.
		expect(block).not.toMatch(/>16</);
	});

	/** Two pulls in different trinkets: the side with no row says so instead of reading nought. */
	it('labels the side that recorded no proc', () => {
		const across = render(pull('strong'), pull('mixed'));
		expect(across).toContain('Vicious');
		expect(across).toContain('Ferocity');
		expect(across).toContain('no proc in this log');
	});
});

describe('the contents rail', () => {
	/**
	 * The same rail the report page and the segment tool carry, in the same column.
	 *
	 * Asserted through the links rather than the markup: what a reader needs is a way to reach every
	 * block, and the failure worth catching is a section added below without an entry here, or an
	 * entry left behind pointing at a heading that no longer renders.
	 */
	it('lists every section on the page, and nothing that is not on it', () => {
		const linked = [...html.matchAll(/href="#(compare-[a-z]+)-heading"/g)].map((m) => m[1]);
		const headings = [...html.matchAll(/id="(compare-[a-z]+)-heading"/g)].map((m) => m[1]);
		expect(linked).toEqual(['compare-framing', 'compare-gaps', 'compare-damage', 'compare-procs', 'compare-casts']);
		expect([...new Set(headings)]).toEqual(linked);
	});

	/** Desktop only and genuinely not rendered below `lg`, exactly as `SectionNav` argues for it. */
	it('is a landmark that a phone never has to skip past', () => {
		expect(html).toMatch(/<nav[^>]*class="hidden lg:/);
	});
});
