// The aura that was already running when the pull started, on the pulls that actually contain one.
//
// `auraWindows`' three rungs are unit-tested beside it in `auras.test.ts`. This file is the other
// half: the shared haste lanes in `analyseCore` are the call sites that opt into the inference, and a
// flag passed at a call site is invisible to a unit test of the function it is passed to. The
// Windwalker's Iron Juggernaut fixture is the pull that proves it — its Time Warp was pressed before
// the pull, so the whole of it inside the fight is one `removebuff`, and the lane drew nothing at all.
//
// Both fixtures are raw `FightDataset`s from anonymous (`a:`) reports, so `analyse` really runs.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isCombatantInfo } from '~/lib/events';
import type { FightDataset } from '~/lib/types';
import { analyse as analyseElemental } from '~/specs/elemental/lib';
import { analyse as analyseWindwalker } from '~/specs/windwalker/lib';

const load = (path: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, path), 'utf8')) as FightDataset;

const WW = '../../../specs/windwalker/__fixtures__/dataset-ironJuggernaut.json';

/** Every id the shared `bloodlust` aura covers — the raid's haste cooldown, whichever class brought it. */
const HASTE_IDS = new Set([2825, 32182, 80353, 90355, 146555]);

describe('a haste cooldown pressed before the pull', () => {
	const dataset = load(WW);
	const t0 = dataset.fight.startTime;
	const ww = analyseWindwalker(dataset);

	/**
	 * The premise, read off the raw stream rather than taken on trust.
	 *
	 * A fight-scoped event query returns only what happened inside the fight, so a buff applied before
	 * the pull leaves nothing behind but its own removal. If this ever stops being true of the fixture
	 * the assertion below stops meaning anything, so it is asserted rather than described.
	 */
	it('leaves exactly one event in the fight, and it is the removal', () => {
		const haste = dataset.events.filter((e) => HASTE_IDS.has((e as { abilityGameID?: number }).abilityGameID ?? -1));
		expect(haste.map((e) => [e.type, e.timestamp - t0])).toEqual([['removebuff', 39_971]]);
	});

	/**
	 * And `combatantinfo` cannot save it, which is why the removal has to be enough.
	 *
	 * The pull's aura list names twenty-one auras and Time Warp is not one of them, on a pull where the
	 * removal proves it was up. That is the same hole `raidBuffs.ts` records for the monk's own Legacy of
	 * the Emperor: the list proves presence and never absence. It is the reason the weakest rung is not a
	 * substitute for this one, and the reason the haste lane asks for the removal rule and not for the
	 * `combatantinfo` rule.
	 */
	it('is absent from the pull snapshot that would otherwise have caught it', () => {
		const info = dataset.events.find((e) => isCombatantInfo(e) && e.sourceID === ww.actorID);
		const auras = (info !== undefined && isCombatantInfo(info) ? info.auras : undefined) ?? [];
		expect(auras).toHaveLength(21);
		expect(auras.some((aura) => HASTE_IDS.has(aura.ability ?? -1))).toBe(false);
	});

	/**
	 * The window, opening at the pull and marked as inferred.
	 *
	 * Before the lane opted in this was `[]` — forty seconds of raid haste, on a 190-second pull, that
	 * every reader of this analysis was blind to: the timeline drew no band, the Energizing Brew pairing
	 * had no cooldown to pair with, and a pull that had one read as a pull that did not.
	 *
	 * `preexisting` is the honest part. The start is the pull rather than an event, so a caller counting
	 * how many times the cooldown went up, or asking when it was pressed, can tell that this window
	 * answers neither.
	 */
	it('draws the window from the pull, and says that is where it came from', () => {
		expect(ww.timeline?.hasteWindows).toEqual([
			{ start: 0, end: 39_971, preexisting: true, id: 80_353, variant: 'Time Warp' },
		]);
	});

	/**
	 * The other side of the inference: a pull whose cooldown *was* logged is untouched by it.
	 *
	 * All three Elemental fixtures carry an ordinary `applybuff`, so the leading-orphan rule never fires
	 * and none of their bands moved. Asserted because an inference that also rewrote the witnessed case
	 * would be the more expensive bug of the two, and the three pulls between them cover three different
	 * ids of the same shared aura.
	 */
	it.each([
		['phased', 1777, 41_785, 32_182, 'Heroism'],
		['unbroken', 785, 40_790, 2825, 'Bloodlust'],
		['cleave', 941, 40_947, 80_353, 'Time Warp'],
	])('leaves %s alone, where the apply was logged', (name, start, end, id, variant) => {
		const el = analyseElemental(load(`../../../specs/elemental/__fixtures__/${name}.json`));
		expect(el.timeline?.hasteWindows).toEqual([{ start, end, id, variant }]);
	});
});
