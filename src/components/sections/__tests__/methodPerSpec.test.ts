// The three method notes, rendered under both specs, because two of them were facts about one spec.
//
// `Method` is shared and its notes were not. Every Elemental report ended on two Windwalker sentences:
//
//   - `method.energy` — "Energy is read from the classResources snapshot …" An Elemental has no energy
//     bar at all. Its pool is mana, and `ELEMENTAL_SPEC.resources` in `specs/elemental/lib/index.ts`
//     declares that one and no other.
//   - `method.spec` — "… confirmed by a Tigereye Brew cast." No shaman ever makes one. What actually
//     identifies this spec is a Lava Burst press, which `identify` in the same file reads.
//
// Both were unconditional — three `Note`s in a row, no branch above them — so this was on the page of
// every Elemental report ever rendered, and the prerendered preview shipped it into `dist/`.
//
// The mechanism is the one already in the repo rather than a new one: an i18next context off
// `spec.key`, which is how `app.intro_windwalker` / `app.intro_elemental` and every sentence in
// `RaidBuffs` already choose their spec's wording. `SpecDefinition` stays the only seam.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { initI18n } from '~/lib/i18n/config';
import { getSpec, type SpecDefinition } from '~/lib/spec';
import type { Analysis, FightDataset } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { analyse as analyseElemental } from '~/specs/elemental/lib';

import Method from '../Method';

initI18n();

const WINDWALKER = getSpec('windwalker')!;
const ELEMENTAL = getSpec('elemental')!;

const read = (dir: string, name: string): unknown =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../specs/${dir}/__fixtures__/${name}.json`), 'utf8'));

/** The Windwalker fixtures are captured analyses; the Elemental ones are datasets, so they are run. */
const windwalkerPull = (name: string): Analysis => read('windwalker', name) as Analysis;
const elementalPull = (name: string): Analysis => analyseElemental(read('elemental', name) as FightDataset);

const render = (spec: SpecDefinition, analysis: Analysis): string =>
	renderToStaticMarkup(createElement(SpecContext.Provider, { value: spec }, createElement(Method, { analysis })));

/** The rendered notes, entity-decoded far enough to compare against the copy an author reads. */
const notesOf = (html: string): string[] =>
	[...html.matchAll(/<p class="m-0 max-w-\[70ch\][^"]*">([\s\S]*?)<\/p>/g)].map((match) =>
		match[1]!.replaceAll('&#x27;', "'").replaceAll('&amp;', '&'),
	);

const BREW_CAST = 'confirmed by a Tigereye Brew cast';
const ENERGY_BAR = 'Energy is read from the classResources snapshot';

describe('the method notes belong to the spec that is being read', () => {
	/**
	 * The premise: four notes under both specs, so neither case below is passing on a section that
	 * rendered nothing. The shared one is asserted identical, because it is the control — a fix that
	 * split the whole section per spec would pass the two cases below and fail this.
	 *
	 * **Four and not three since the reference block landed.** The fourth is `ReferenceNote`, and it is
	 * shared in the same sense the engaged note is: one component, keyed by the registry's spec key,
	 * saying either what the sweep measured for this spec or that no sweep has covered it yet. It is
	 * counted here rather than excluded, because a note that silently stopped rendering is exactly the
	 * failure this count exists to catch.
	 */
	it('renders four notes under either spec, one of them shared', () => {
		const ww = notesOf(render(WINDWALKER, windwalkerPull('strong')));
		const el = notesOf(render(ELEMENTAL, elementalPull('addsThenBoss')));
		expect(ww).toHaveLength(4);
		expect(el).toHaveLength(4);
		expect(el[0]).toBe(ww[0]);
		expect(el[0]).toContain('measured against engaged time');
	});

	/**
	 * The defect, both halves of it, in the words the reader was shown.
	 *
	 * Asserted as an absence *and* as a presence: an absence alone would pass a change that emptied the
	 * section, and the two replacements are the point — an Elemental is told about the bar it has and the
	 * press that actually identifies it.
	 */
	it('tells an Elemental reader about mana and Lava Burst, not energy and Tigereye Brew', () => {
		const el = notesOf(render(ELEMENTAL, elementalPull('addsThenBoss')));
		expect(el.join('\n')).not.toContain(BREW_CAST);
		expect(el.join('\n')).not.toContain(ENERGY_BAR);
		expect(el[1]).toContain('Mana is read from the classResources snapshot');
		expect(el[2]).toContain('confirmed by a Lava Burst cast');
		// Nothing may pass by printing a dotted key at the reader — the failure a context has when the
		// arm behind it is missing.
		expect(el.join('\n')).not.toMatch(/\bmethod\./);
	});

	/**
	 * The Windwalker keeps both sentences unchanged, which is what makes this a routing change rather
	 * than a rewrite. Every committed Windwalker capture, so a fixture arriving is read rather than skipped.
	 */
	it('leaves the Windwalker notes exactly as they were', () => {
		for (const name of ['strong', 'mixed', 'poor', 'weave']) {
			const ww = notesOf(render(WINDWALKER, windwalkerPull(name)));
			expect(ww[1], name).toContain(ENERGY_BAR);
			expect(ww[1], name).toContain('It is used for time at the cap and nothing else.');
			expect(ww[2], name).toContain(BREW_CAST);
		}
	});
});
