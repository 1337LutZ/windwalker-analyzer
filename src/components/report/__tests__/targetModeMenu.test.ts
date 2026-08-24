// The switches a pull actually puts in front of a reader.
//
// `lib/view/__tests__/targetMode.test.ts` holds the derivation — which modes clear the floor on which
// pull — and this holds the half a derivation cannot assert about itself: that the control renders the
// list it was handed rather than a constant of its own. That is the exact regression this lane exists
// to prevent. `TARGET_MODE_CHOICES` was a module-level array mapped over in three places, and any one
// of the three could quietly go back to a fixed list while every arithmetic test above stayed green.
//
// Rendered rather than inspected, because the failure is visible only in the output: a button whose
// label is missing from the locale renders as its own key, and a pull offering a reading it never held
// renders a switch that grades nothing.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Toolbar } from '@base-ui/react/toolbar';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import type { Analysis, FightDataset } from '~/lib/types';
import { analyse as analyseElemental } from '~/specs/elemental';

import TargetModeControl, { TargetModeToolbar } from '../TargetModeControl';

initI18n();
const t = i18n.getFixedT('en', 'report');

const elemental = (name: string): Analysis =>
	analyseElemental(
		JSON.parse(
			readFileSync(resolve(import.meta.dirname, `../../../specs/elemental/__fixtures__/${name}.json`), 'utf8'),
		) as FightDataset,
	);

const captured = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../specs/windwalker/__fixtures__/${name}.json`), 'utf8'));

/** The visible text of one rendering, with the tags taken out and the entities put back. */
const text = (html: string): string =>
	html
		.replaceAll(/<[^>]*>/g, ' ')
		.replaceAll('&#x27;', "'")
		.replaceAll('&amp;', '&')
		.replaceAll(/\s+/g, ' ');

const blockHtml = (analysis: Analysis): string =>
	renderToStaticMarkup(
		createElement(TargetModeControl, {
			targets: analysis.targets,
			segments: analysis.segments,
			value: 'auto',
			onChange: () => {},
		}),
	);

/** The bar's rendering needs the toolbar it lives in: its switches are `Toolbar.Button`s. */
const barHtml = (analysis: Analysis): string =>
	renderToStaticMarkup(
		createElement(
			Toolbar.Root,
			null,
			createElement(TargetModeToolbar, {
				targets: analysis.targets,
				segments: analysis.segments,
				value: 'auto',
				onChange: () => {},
			}),
		),
	);

const block = (analysis: Analysis): string => text(blockHtml(analysis));
const bar = (analysis: Analysis): string => text(barHtml(analysis));

/** Which of the four positions a rendering drew, in the order the control offers them. */
const drawn = (html: string): string[] =>
	(['auto', 'single', 'cleave', 'aoe'] as const).filter((choice) => html.includes(t(`targets.${choice}`)));

/**
 * The same, read off the bar's own labels.
 *
 * Separate because the bar's switches are the short forms — "Mixed", "1T", "2T", "AoE" — and looking
 * for "Single target" on a row that says "1T" finds nothing whether or not the switch is there, which
 * is a comparison that passes for the wrong reason.
 */
const SHORT = { auto: 'shortAuto', single: 'shortSingle', cleave: 'shortCleave', aoe: 'shortAoe' } as const;
const drawnShort = (html: string): string[] =>
	(['auto', 'single', 'cleave', 'aoe'] as const).filter((choice) => html.includes(t(`targets.${SHORT[choice]}`)));

describe('the switches a pull offers', () => {
	/**
	 * ***The fixture named `cleave` draws no Cleave switch, which is the whole case for deriving the
	 * menu.*** It spends 15.4s of 263s in a cleave segment against 67.5s of aoe — its multi-target time
	 * is an eight-target reading, not a two-target one — so a fixed list would put a button on the page
	 * offering a letter earned over fifteen seconds. The plan's own case is the same shape from the
	 * other side: a Norushen pull with no single-target segment at all.
	 */
	it('draws only the readings the pull held for long enough', () => {
		expect(drawn(block(elemental('cleave')))).toEqual(['auto', 'single', 'aoe']);
		expect(drawn(block(elemental('addsThenBoss')))).toEqual(['auto', 'single', 'cleave', 'aoe']);
		expect(drawn(block(elemental('unbroken')))).toEqual(['auto', 'single']);
	});

	/** And the bar's own rendering takes the same list, so the two cannot come to offer different pulls. */
	it('offers the same readings on the sticky bar as above the report', () => {
		for (const name of ['cleave', 'addsThenBoss', 'unbroken', 'phased']) {
			const pull = elemental(name);
			expect(drawnShort(bar(pull)), name).toEqual(drawn(block(pull)));
		}
	});

	/**
	 * A capture from before `Analysis.segments` existed has no basis for any narrowed reading, and the
	 * control says so rather than drawing switches that would narrow the bands and leave every clock
	 * running over the whole pull. What it keeps is the detection — the sentence is this control's first
	 * job and does not depend on having anything to switch between.
	 */
	it('drops the switches, not the detection, when the whole fight is the only reading', () => {
		const pull = captured('cleave');
		expect(pull.segments).toBeUndefined();
		expect(blockHtml(pull)).not.toContain('radiogroup');
		expect(block(pull)).toContain(t('targets.onlyWhole'));
		expect(block(pull)).toContain(t('targets.detected', { context: 'multi', share: pull.targets!.multiTargetPct }));
	});

	/**
	 * The anti-vacuity half: a rendering that drew nothing would satisfy every "does not contain" above.
	 * The hint is the line only a pull with something to switch between gets.
	 */
	it('draws a real control on a pull that has readings to offer', () => {
		const pull = elemental('addsThenBoss');
		expect(blockHtml(pull)).toContain('radiogroup');
		expect(block(pull)).toContain(t('targets.hint'));
		expect(block(pull)).not.toContain(t('targets.onlyWhole'));
		// And no label renders as its own key, which is what a missing locale arm looks like on the page.
		expect(block(pull)).not.toContain('targets.');
	});
});
