// The same two rows on a monk, which is what "generic implementation" was asked to mean.
//
// **A Windwalker had no row for either buff and no way to gain one.** Skull Banner is a warrior's raid
// cooldown and Stormlash a shaman's, so nothing in this spec presses either and no figure here reads
// either — which is exactly why they went missing rather than being noticed. The monk on
// `dataset-ironJuggernaut` was given two totems and three banners and the report drew none of them.
//
// The mechanism is `lib/analysis/raidCasters.ts` and is not tested twice: the walk's own behaviour is
// pinned in `specs/elemental/lib/__tests__/raidBuffLanes.test.ts`, against the two event shapes it has to
// serve. What is asserted here is that this spec gets it — that the rows exist, are per instance, and name
// the raid-mate who cast each one.
//
// **One raw fixture, and that is a limit rather than a choice.** The other six Windwalker fixtures are
// pre-analysed `Analysis` objects with no `events` array at all, so nothing that reads a stream can be
// asked of them — the same constraint `drawnAuras.test.ts` records.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis, AuraLane, FightDataset } from '~/lib/types';
import { analyse, registry } from '../index';

const STORMLASH_BUFF = 120_676;
const SKULL_BANNER = 114_206;

const dataset = JSON.parse(
	readFileSync(resolve(import.meta.dirname, '../../__fixtures__/dataset-ironJuggernaut.json'), 'utf8'),
) as FightDataset;

const ww: Analysis = analyse(dataset);

const rowsFor = (key: string): AuraLane[] => (ww.timeline?.lanes ?? []).filter((lane) => lane.key === key);

/** How many times the log put an id on this monk, straight off the fixture's stream. */
const appliedToPlayer = (id: number): number =>
	dataset.events.filter((e) => e.abilityGameID === id && e.type === 'applybuff' && e.targetID === dataset.actor.id)
		.length;

describe('the raid’s buffs on a monk’s timeline', () => {
	/**
	 * 120676 is the aura and 120668 is the press — the split the Elemental model measured on 7 447
	 * applications, restated here because this spec's declaration is new and a mistyped id would draw
	 * nothing while looking correct.
	 */
	it('declares Stormlash under the id the log writes', () => {
		expect(registry.aura('stormlash-totem').ids).toEqual([STORMLASH_BUFF]);
		expect(appliedToPlayer(STORMLASH_BUFF)).toBe(2);
	});

	/**
	 * Both buffs, one row per instance, counted against the stream rather than written down.
	 *
	 * Two totems from two shamans and three banners from three warriors. Every row is one instance: a
	 * single window, no `target` — that field means "enemy" and would sink a raid-mate's row into the
	 * per-enemy block at the foot of the chart — and a `source` naming who cast it.
	 */
	it('draws one row per totem and per banner the monk was given', () => {
		expect(rowsFor('stormlash-totem').map((r) => [r.source?.id, r.windows[0]?.start, r.windows[0]?.end])).toEqual([
			[4, 2823, 12_561],
			[3, 17_424, 27_106],
		]);
		expect(rowsFor('skull-banner').map((r) => [r.source?.id, r.windows[0]?.start, r.windows[0]?.end])).toEqual([
			[19, 2043, 12_559],
			[18, 13_007, 22_821],
			[26, 22_821, 33_589],
		]);
		expect(rowsFor('skull-banner')).toHaveLength(appliedToPlayer(SKULL_BANNER));

		for (const key of ['stormlash-totem', 'skull-banner']) {
			for (const row of rowsFor(key)) {
				expect(row.group, key).toBe('buff');
				expect(row.target, key).toBeUndefined();
				expect(row.windows, key).toHaveLength(1);
				expect(row.source?.name, key).toMatch(/^Player \(\d+\)$/);
			}
		}
	});

	/**
	 * The caster is the player, not the object the log credited.
	 *
	 * Both buffs are applied by a summon — the totem, the banner — so every `sourceID` on these events is
	 * a `Pet` entry, and a row labelled `Pet (63)` names nothing a reader can act on. Asserted on the
	 * stream first so the resolution has a premise rather than a coincidence.
	 */
	it('names the raid-mate rather than their totem or their banner', () => {
		const sources = new Set(
			dataset.events
				.filter(
					(e) =>
						(e.abilityGameID === STORMLASH_BUFF || e.abilityGameID === SKULL_BANNER) && e.targetID === dataset.actor.id,
				)
				.map((e) => e.sourceID),
		);
		expect([...sources].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([60, 63, 77, 80, 88]);
		for (const id of sources) expect(dataset.actors.find((a) => a.id === id)?.type).toBe('Pet');

		// Every drawn row's source is a player the actor list names, and none of them is one of the pets.
		for (const row of [...rowsFor('stormlash-totem'), ...rowsFor('skull-banner')]) {
			expect(sources.has(row.source?.id)).toBe(false);
			expect(dataset.actors.find((a) => a.id === row.source?.id)?.type).toBe('Player');
		}
	});

	/**
	 * Nothing this spec grades reads either buff, which is the honest reason they were missing — and the
	 * reason the rows are safe. `raidSourceLanes` is called once, for the timeline, and its output goes
	 * nowhere else.
	 */
	it('adds no figure, only rows', () => {
		expect(ww.timeline?.hiddenTargets ?? 0).toBe(0);
		expect((ww.timeline?.hiddenLanes ?? []).filter((l) => l.source !== undefined)).toEqual([]);
	});
});
