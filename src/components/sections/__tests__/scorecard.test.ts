// The summary grid: which sections it draws, in what order, and what it refuses to draw.
//
// The grid replaced a three-card "key improvements" short list, and the three claims below are the ones
// that replacement rests on. None is expressible as a type and each has already been got wrong once:
//
//   - **Order.** The list is sorted by how far each section sits from `good`, in bands. It was sorted by
//     distance past `ok` first, which returns zero for every section that is not failing — so most of
//     the grid was in `Object.entries` order and the promise that the top is where to start was false.
//   - **What is not drawn.** A section nothing could be measured in has nothing to say. Mana is the case
//     it is for: both of its rules are `null` unless the pool actually went starved or strained, so a
//     card reading `not measured` twice is the report telling a reader who never ran low that it has
//     nothing to tell them, in a slot an ordered grid cannot spare.
//   - **A metric whose fault never happened.** A rule counting a mistake, with `good` at none and none of
//     them, draws no row — the scale would be a full green band with the mark pinned to the left edge.
//
// Rendered rather than inspected, because two of the three are decisions about markup and the third is
// an order a reader sees rather than an array anything exports.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis, FightDataset } from '~/lib/types';
import { resolveBands } from '~/lib/view/targetMode';

import { ScoreViewContext } from '~/components/report/scoreViewContext';
import { SpecContext } from '~/components/report/specContext';
import Scorecard from '~/components/sections/Scorecard';
import { analyse } from '~/specs/elemental/lib';
import { analyse as windwalker } from '~/specs/windwalker/lib';

const ELEMENTAL = getSpec('elemental')!;
initI18n();
const t = i18n.getFixedT('en', 'report');

const fixture = (name: string): Analysis =>
	analyse(
		JSON.parse(
			readFileSync(resolve(import.meta.dirname, `../../../specs/elemental/__fixtures__/${name}.json`), 'utf8'),
		) as FightDataset,
	);

/**
 * The reading the report is on, which `useReportCopy` needs and cannot default.
 *
 * `'auto'` — the pull's own detection, the reading nobody forced — because every claim below is about
 * what the grid does with a scorecard rather than about which scorecard it was handed.
 */
const wrap = (analysis: Analysis, node: ReactNode) =>
	createElement(
		SpecContext.Provider,
		{ value: ELEMENTAL },
		createElement(ScoreViewContext.Provider, { value: resolveBands(analysis.targets, 'auto') }, node),
	);

const html = (analysis: Analysis): string =>
	renderToStaticMarkup(wrap(analysis, createElement(Scorecard, { analysis })));

/** The same render for the other spec, which owns the potion and Tiger Palm rules. */
function wwHtml(name: string): string {
	const analysis = windwalker(
		JSON.parse(
			readFileSync(resolve(import.meta.dirname, `../../../specs/windwalker/__fixtures__/${name}.json`), 'utf8'),
		) as FightDataset,
	);
	return renderToStaticMarkup(
		createElement(
			SpecContext.Provider,
			{ value: getSpec('windwalker')! },
			createElement(
				ScoreViewContext.Provider,
				{ value: resolveBands(analysis.targets, 'auto') },
				createElement(Scorecard, { analysis }),
			),
		),
	);
}

/** The section headings the grid drew, in the order it drew them. */
const cards = (markup: string): string[] =>
	[...markup.matchAll(/uppercase text-ink-2">([^<]+)</g)].map((match) => match[1]!);

describe('the scorecard grid', () => {
	it('leads with the section furthest from good, and ends with the ones already there', () => {
		// `cleave` is the pull with something wrong in three different places, so it is the one that can
		// show an order at all. The shield is the largest miss on it by a distance — 42.2s at the ceiling
		// against a rule whose `ok` band ends at 5s — and `casts` is 89.2% against an 80% target.
		const drawn = cards(html(fixture('cleave')));
		expect(drawn[0]).toBe('Lightning Shield');
		expect(drawn.at(-1)).toBe('Casts per minute');
		// Non-vacuity: an order over one card is not an order.
		expect(drawn.length).toBeGreaterThan(4);
	});

	/**
	 * Mana is the case the rule was written for, and the fixtures give it both directions.
	 *
	 * Both of its rules are `null` unless the pool actually went starved or strained, so on a pull where
	 * nobody ran low the card would read `not measured` twice — the report telling a reader who never had
	 * the problem that it has nothing to tell them, in a slot an ordered grid cannot spare.
	 *
	 * **`addsThenBoss` is the pull that did run low**, and its card is drawn. That is the half that makes
	 * this a rule rather than a way of hiding a section: the same filter, the same section, opposite
	 * answers, decided by the pull.
	 */
	it('draws no card for a section nothing could be measured in, and draws it when something was', () => {
		for (const name of ['cleave', 'phased', 'unbroken']) {
			const markup = html(fixture(name));
			expect(cards(markup), name).not.toContain(t('mana.title'));
			// And the grid did draw — otherwise the assertion above passes on an empty render, which is the
			// failure this whole family of guards keeps being written against.
			expect(cards(markup).length, name).toBeGreaterThan(3);
		}
		expect(cards(html(fixture('addsThenBoss')))).toContain(t('mana.title'));
	});

	it('draws no row for a rule whose fault never happened', () => {
		// `searingTotemOverlaps` is `good: 0` and the pull laid no totem under the elemental, so the row
		// would read `0` under a full green band. Its section is still drawn, off its other metric.
		const markup = html(fixture('phased'));
		expect(cards(markup)).toContain(t('searingTotem.title'));
		expect(markup).not.toContain(t('summary.takeaways.metric.searingTotemOverlaps.label'));
		// The sibling row that *is* a reading stays, so the filter is not simply hiding the section.
		expect(markup).toContain(t('summary.takeaways.metric.searingTotemUptime.label'));
	});

	/**
	 * The raw key this shipped, and the trap behind it.
	 *
	 * `potions` is the one section with no heading of its own — its evidence is the potion's row on the
	 * timeline — so the card falls back to its single metric's label. That fallback was written as
	 * `t(key, { defaultValue })`, which does nothing here: `i18n/config.ts` sets a
	 * `parseMissingKeyHandler` so a missing key renders as itself, and i18next gives that handler
	 * precedence *over* `defaultValue`. The card read `potions.title` on screen.
	 *
	 * Asserted over every heading rather than that one, because the next section without a title will not
	 * announce itself either.
	 */
	it('never prints a key where a section heading belongs', () => {
		for (const name of ['cleave', 'phased', 'unbroken', 'addsThenBoss']) {
			for (const heading of cards(html(fixture(name)))) {
				expect(heading, `${name}: ${heading}`).not.toMatch(/^[a-z][A-Za-z]*\./);
			}
		}
	});

	/**
	 * A share over a countable sample is the count, which is what the rest of the report calls it.
	 *
	 * `earthShockGood` on `cleave` is 57.14%, which is four good presses out of seven judged. A reader
	 * counts presses; the card was the one place on the page saying that fact as a percentage, with a
	 * percentage target under it restating the denominator it had just printed.
	 */
	it('reads a sampled share as its count, and drops the target line under it', () => {
		const markup = html(fixture('cleave'));
		// That card and no other: `85%` is also Flame Shock's second-target line and Searing Totem's, so a
		// sweep of the whole render would pass while the shocks kept theirs.
		const card = markup.slice(markup.indexOf('#earth-shock-heading'));
		const shocks = card.slice(0, card.indexOf('</a>'));
		expect(shocks).toContain('4/7');
		expect(shocks).not.toContain('57.14%');
		expect(shocks).not.toContain('target');
		// The unsampled metric beside it keeps both, so this is a rule about samples rather than about
		// percentages: Flame Shock's uptime is a share of a clock and has no count to fall back to.
		expect(markup).toContain('83.9%');
		expect(markup).toContain('target 95% or better');
	});

	/**
	 * A waste rule reads its faults over its presses, and the **label** is what makes that legible.
	 *
	 * `tigerPalmWaste` on a pull of eighteen presses with six wasted printed "6/18" under the label "Stop
	 * overwriting Tiger Power", and a bare `n/m` under an imperative reads as a score — six out of eighteen
	 * looks like a bad grade rather than like six presses too many. Presses-made over presses-needed was
	 * tried as the fix and is the wrong one: it asks the reader to subtract before they know what they are
	 * looking at. The number was never the problem. The label now carries the noun — "Casts that wasted
	 * Tiger Power" — and the figure is left to count.
	 *
	 * `sections` is four wasted of thirteen, so the two numbers are distinct from each other and from the
	 * denominator of any other row on the card.
	 */
	it('reads a waste rule as its faults over its presses, under a label that says so', () => {
		const markup = wwHtml('sections');
		expect(markup).toContain('4/13');
		expect(markup).toContain(t('summary.takeaways.metric.tigerPalmWaste.label'));
		// The label has to name what is being counted, or the figure beside it is ambiguous again. Asserted
		// as the property rather than as the string, so a reworded label still has to carry the noun.
		expect(t('summary.takeaways.metric.tigerPalmWaste.label')).toMatch(/wasted/i);
		// And it is no longer phrased as the instruction that made `4/13` read as a score.
		expect(t('summary.takeaways.metric.tigerPalmWaste.label')).not.toMatch(/^Stop /);
	});

	/**
	 * A target nobody can beat is not written as one they can.
	 *
	 * Two potions is every potion a pull allows, and the card said "target 2 or more" — an instruction to
	 * drink a third. A rule declaring a `ceiling` its `good` line already sits on reads as a count over
	 * that lid and drops the line entirely; a share, which carries its own lid in the unit, keeps the
	 * line and loses only the invitation.
	 */
	it('names a ceiling instead of inviting the reader past it', () => {
		const potions = wwHtml('sections');
		expect(potions).toContain('2/2');
		expect(potions).not.toContain('target 2 or more');
		// `phased` covers the haste share at 100%, which is the same defect in the other unit.
		const haste = html(fixture('phased'));
		expect(haste).toContain('target 100%<');
		expect(haste).not.toContain('target 100% or better');
		// The pre-pull summon is one of one, and the pull that skipped it reads zero of one rather than a
		// bare `0` — so the lid is drawn whether or not it was reached.
		expect(haste).toContain('1/1');
		expect(html(fixture('addsThenBoss'))).toContain('0/1');
	});

	it('prints a sentence and no figure for a metric whose value is not a reading', () => {
		// The potion metric is the Windwalker's; the Elemental's case is the shield on a pull that never
		// wore it, and `neverUpShield.test.ts` owns that render. What is asserted here is the other half:
		// on a pull where the value *is* a reading, the number and its scale are both drawn.
		const markup = html(fixture('cleave'));
		expect(markup).toContain(t('summary.takeaways.metric.flameShockUptime.label'));
		expect(markup).toContain('83.9%');
		expect(markup).toContain('target 95% or better');
	});
});
