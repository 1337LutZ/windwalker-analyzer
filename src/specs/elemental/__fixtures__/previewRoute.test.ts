// The Elemental's route through `/preview` — the only page in this app that renders a report without a
// WarcraftLogs token, and until now the only one that could not reach an Elemental section at all.
//
// Two things had to be true for that route to exist and this file asserts both, because each was
// separately load-bearing and each failed on its own before:
//
//   1. There is an Elemental `Analysis` on the page. This spec commits raw `FightDataset`s and no
//      captured analysis, so `preview.astro` analyses one at build time rather than importing a stored
//      one — see the argument on that page. What this file pins is the consequence the argument rests
//      on: the analysed pull carries `timeline.hasteWindows`, and every *stored* analysis in the repo
//      does not carry the key at all.
//   2. `PreviewSwitcher` reads each fixture against its own spec. It used to pin `getSpec('windwalker')`
//      for every entry, and adding an Elemental pull under that pin does not merely draw the wrong
//      sections — it throws, `TypeError: Cannot read properties of undefined (reading 'snapshotted')` out
//      of `windwalker/lib/score.ts` by way of `ReportHeader`, because the summary is scored before any
//      section renders. So the fixture and the spec lookup are one change and not two.
//
// Section *ids* rather than copy: they are the anchors `SectionNav` observes, they are what a narrow
// viewport sweep has to find on the page, and they do not move when a translation does.
//
// What this cannot assert is the haste band's pixels. The band is drawn into an ApexCharts canvas in an
// effect, so there is nothing about it in server markup; the reachable claim is that the data the band
// is drawn from is on the object the island is handed, which is what case 1 checks.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import PreviewSwitcher from '~/components/PreviewSwitcher';
import { initI18n } from '~/lib/i18n/config';
import type { Analysis, FightDataset } from '~/lib/types';
import { analyse } from '../lib';

initI18n();

const raw = (name: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `${name}.json`), 'utf8')) as FightDataset;

const stored = (name: string): Analysis =>
	JSON.parse(
		readFileSync(resolve(import.meta.dirname, `../../windwalker/__fixtures__/${name}.json`), 'utf8'),
	) as Analysis;

/** Exactly what `preview.astro` does, so a change to either side shows up here. */
const phased = analyse(raw('phased'));

const html = (fixtures: Record<string, Analysis>): string =>
	renderToStaticMarkup(createElement(PreviewSwitcher, { fixtures }));

/** Sections only this spec has, by the id their heading carries. */
const ELEMENTAL_ONLY = ['flame-shock', 'lightning-shield', 'earth-shock', 'searing-totem', 'stormlash'];
/** And only the Windwalker's, which must not appear over an Elemental pull. */
const WINDWALKER_ONLY = ['bank', 'chi-brew', 'energizing', 'fof', 'tiger-palm', 'karma'];

describe('the preview page analyses an Elemental pull rather than storing one', () => {
	it('hands the chart a haste window, which no stored analysis can', () => {
		expect(phased.specName).toBe('Elemental');
		expect(phased.timeline?.hasteWindows).toEqual([{ start: 1777, end: 41_785, id: 32_182, variant: 'Heroism' }]);
	});

	/**
	 * The reason the entry is analysed and not stored, stated as a measurement: the field postdates
	 * every capture in the repo, so a stored analysis is missing the *key* — not carrying an empty
	 * array, which a reader could mistake for "no Bloodlust was cast".
	 */
	it('no stored Windwalker analysis has the key at all', () => {
		for (const name of ['strong', 'poor', 'mixed', 'cleave', 'waves', 'weave']) {
			const timeline = stored(name).timeline as object | undefined;
			expect(timeline, name).toBeDefined();
			expect('hasteWindows' in (timeline ?? {}), `${name}: timeline.hasteWindows`).toBe(false);
		}
	});
});

describe('the preview harness reads each fixture against its own spec', () => {
	it('renders the Elemental sections for an Elemental pull', () => {
		const markup = html({ phased });
		for (const id of ELEMENTAL_ONLY) expect(markup, id).toContain(`id="${id}-heading"`);
	});

	it('renders none of the Windwalker sections over that pull', () => {
		const markup = html({ phased });
		for (const id of WINDWALKER_ONLY) expect(markup, id).not.toContain(`id="${id}-heading"`);
	});

	/**
	 * The other half of the same claim, and the one that fails if the spec is ever resolved from
	 * `DEFAULT_SPEC` instead: this case says the same thing under both `PUBLIC_SPEC` pins, because
	 * which spec a fixture is has nothing to do with which spec the build serves.
	 */
	it('still reads a Windwalker pull as the Windwalker', () => {
		const markup = html({ weave: stored('weave') });
		expect(markup).toContain('id="bank-heading"');
		expect(markup).not.toContain('id="lightning-shield-heading"');
	});
});
