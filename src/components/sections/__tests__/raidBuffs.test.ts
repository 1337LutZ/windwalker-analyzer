// The section rendered under both specs, because "which rows" and "whose wording" are the two things
// it got wrong and neither is visible from the engine's side.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SpecContext } from '~/components/report/specContext';
import { readRaidBuffs } from '~/lib/analysis/raidBuffs';
import type { WclEvent } from '~/lib/events';
import { initI18n } from '~/lib/i18n/config';
import { getSpec, type SpecDefinition } from '~/lib/spec';
import type { Analysis, FightDataset } from '~/lib/types';
import { analyse as analyseElemental } from '~/specs/elemental/lib';

import RaidBuffs from '../RaidBuffs';

initI18n();

const WINDWALKER = getSpec('windwalker')!;
const ELEMENTAL = getSpec('elemental')!;

const under = (spec: SpecDefinition, node: ReactNode): ReactElement =>
	createElement(SpecContext.Provider, { value: spec }, node);

const read = (dir: string, name: string): unknown =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../specs/${dir}/__fixtures__/${name}.json`), 'utf8'));

/** The Windwalker fixtures are captured analyses; the Elemental ones are datasets, so they are run. */
const windwalkerPull = (name: string): Analysis => read('windwalker', name) as Analysis;
const elementalPull = (name: string): Analysis => analyseElemental(read('elemental', name) as FightDataset);

const T0 = 0;
const END = 300_000;
const ME = 10;

/**
 * A measured pull to render, built from events rather than from a fixture's captured summary.
 *
 * The Elemental fixtures were captured before this section read raid buffs at all, so they carry no
 * summary to draw; and the point of most cases below is a row a spec draws that no fixture has. Each
 * spec's own fixture supplies everything the section is *not* about — `useReportCopy` scores the whole
 * analysis, so a hand-built stub of the buffs alone cannot render.
 */
function render(spec: SpecDefinition, base: Analysis, events: WclEvent[]): string {
	const analysis: Analysis = { ...base, raidBuffs: readRaidBuffs(events, ME, T0, END) };
	return renderToStaticMarkup(under(spec, createElement(RaidBuffs, { analysis })));
}

const apply = (t: number, id: number, source: number): WclEvent => ({
	timestamp: T0 + t,
	type: 'applybuff',
	abilityGameID: id,
	sourceID: source,
	targetID: ME,
});

/** Burning Wrath: the shaman's own +10% spell power, and the row this section did not have. */
const BURNING_WRATH = 77747;
/** Horn of Winter: the +10% attack power an Elemental Shaman cannot spend. */
const HORN_OF_WINTER = 57330;

describe('the raid buff section draws each spec its own rows', () => {
	/**
	 * The finding that started this: the section reports gaps, so a row for an effect the spec cannot
	 * use is a fault the reader cannot fix. An Elemental Shaman's spells scale from spell power, and
	 * their pets inherit spell power rather than attack power, so the attack-power row was dead twice
	 * over — and there was no spell power row at all.
	 */
	it('gives the Elemental spell power and not attack power', () => {
		const html = render(ELEMENTAL, elementalPull('unbroken'), [
			apply(0, BURNING_WRATH, 4),
			apply(0, HORN_OF_WINTER, 5),
		]);
		expect(html).toContain('+10% spell power');
		expect(html).not.toContain('+10% attack power');
		// And it names the stat a caster is actually paid in.
		expect(html).toContain('+5% Intellect');
		expect(html).not.toContain('+5% Agility');
	});

	/**
	 * The other direction, and the free correctness check on the whole change: the Windwalker keeps all
	 * six of the rows it had. Any movement here is a bug rather than a finding.
	 */
	it('leaves the Windwalker the six rows it had', () => {
		const html = render(WINDWALKER, windwalkerPull('strong'), [
			apply(0, BURNING_WRATH, 4),
			apply(0, HORN_OF_WINTER, 5),
		]);
		expect(html).toContain('+10% attack power');
		expect(html).not.toContain('+10% spell power');
		expect(html).toContain('+5% Agility');
		for (const name of ['+10% melee haste', '+5% spell haste', '+5% critical strike', '+3000 mastery'])
			expect(html).toContain(name);
	});

	/**
	 * The same claim taken against real data.
	 *
	 * **What this used to compare, and why it stopped meaning anything.** It read
	 * `WINDWALKER.raidBuffEffects.map(key)` against `analysis.raidBuffs.rows.map(key)` and required them
	 * equal, and took the pill count off `stored.rows.filter(selfProvided)`. Both worked only because the
	 * captures then committed were *already narrowed to the monk* — six rows, in declaration order, with
	 * `selfProvided` set. The 2026-08-24 re-capture stores what `readRaidBuffs` actually returns, which
	 * that function's own docblock describes: spec-neutral, one row per group in `EFFECTS` (seven here,
	 * `spellPower` among them), with `selfProvided` filled mechanically `false` because "can this spec
	 * cast it" is not a question the event stream can answer. So the old equality was comparing the
	 * declaration against a copy of itself that the capture happened to be carrying, and the pill count
	 * now reads zero off a field that is `false` by construction.
	 *
	 * What is actually true, and is what the section rests on: the stored summary is the *superset* the
	 * declaration selects from, and `selfProvided` is the declaration's answer rather than the capture's.
	 */
	it('draws a captured Windwalker pull unchanged', () => {
		const analysis = windwalkerPull('strong');
		const stored = analysis.raidBuffs!;
		const html = renderToStaticMarkup(under(WINDWALKER, createElement(RaidBuffs, { analysis })));

		// Fixture against declaration: every row the Monk draws is one the spec-neutral pass supplied, and
		// the pass supplies more than the Monk draws.
		const storedKeys = stored.rows.map((r) => r.key);
		for (const { key } of WINDWALKER.raidBuffEffects) expect(storedKeys, key).toContain(key);
		expect(storedKeys).toContain('spellPower');
		expect(WINDWALKER.raidBuffEffects.map((e) => e.key)).not.toContain('spellPower');
		// Two `Yours to fix` pills per row that carries one, since the grid draws a card and a table row —
		// counted off the declaration, which is the only side that knows what a Monk supplies.
		expect(WINDWALKER.raidBuffEffects.filter((e) => e.selfProvided)).toHaveLength(2);
		expect(html.match(/Yours to fix/g)).toHaveLength(4);
		expect(html).not.toContain('+10% spell power');
	});

	/**
	 * `selfProvided` inverts almost completely between the two specs, and it is the field that reads as
	 * an accusation: wrong, it turns "the raid did not have this" into "you failed to press this". The
	 * shaman brings Burning Wrath themselves — `Shaman.AddRaidBuffs`, sim/shaman/shaman.go:230-231 — so
	 * a late one is theirs, where the same lateness in the all-stats row is somebody else's roster.
	 */
	it("calls a late buff the shaman's own only where the shaman supplies it", () => {
		const mine = render(ELEMENTAL, elementalPull('unbroken'), [apply(60_000, BURNING_WRATH, ME)]);
		expect(mine).toContain('Yours to fix');
		expect(mine).toContain('you can fix alone');

		// Blessing of Kings is nobody's press on this spec, so a gap in it carries no pill and no prose.
		const theirs = render(ELEMENTAL, elementalPull('unbroken'), [apply(60_000, 20_217, 4)]);
		expect(theirs).not.toContain('you can fix alone');
	});

	/**
	 * The live user complaint. `report.json` said "Windwalker" three times inside a rendered Elemental
	 * report — the intent, the table caption and the excluded-buffs note — and one of them was inverted
	 * rather than merely mislabelled: it told a caster that spell power adds no damage.
	 */
	it('never says Windwalker inside an Elemental report', () => {
		const html = render(ELEMENTAL, elementalPull('unbroken'), [apply(0, BURNING_WRATH, 4)]);
		expect(html).not.toContain('Windwalker');
		expect(html).toContain('Elemental Shaman');
	});

	it('never says Elemental Shaman inside a Windwalker report', () => {
		const html = render(WINDWALKER, windwalkerPull('strong'), [apply(0, HORN_OF_WINTER, 5)]);
		expect(html).not.toContain('Elemental Shaman');
		expect(html).toContain('Windwalker');
	});

	/**
	 * The +5% magic damage taken debuff is the third missing row, and it is missing on purpose: it is a
	 * debuff on the boss, the fetch is scoped to the player, and `readRaidBuffs` filters on
	 * `targetID === actorID`, so this section can never see it. The Elemental note says so by name
	 * instead of leaving the absence to be noticed.
	 */
	it('tells an Elemental reader where the magic-damage debuff went', () => {
		const html = render(ELEMENTAL, elementalPull('unbroken'), [apply(0, BURNING_WRATH, 4)]);
		expect(html).toContain('Curse of the Elements');
		expect(html).not.toContain('weakened armour');
	});
});
