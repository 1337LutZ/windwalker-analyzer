// The three splits, measured on the pulls they were written for and pinned against the pulls they
// must stay silent on.
//
// **Only one of the six shapes has a committed raw fixture, and it is a negative one.** The Galakras
// dataset is a monk who never left the courtyard, which is the case the tower rule most has to get
// right — see the trap below. The positives are built by hand, because a fixture that carried one
// would be a second megabyte of somebody's log committed to prove a set of four game ids, and the
// numbers those ids were chosen on are in `splitGroups.ts` beside them, measured through the app's
// own fetch on the reports it names.

import { describe, expect, it } from 'vitest';

import { rawFixture, rawFixtures } from '~/lib/analysis/fixtures';
import type { WclEvent } from '~/lib/events';
import type { FightDataset } from '~/lib/types';

import { AWAY_RUN_MS, AWAY_SHARE, detectSplitGroup, PAIR_SHARE } from '../splitGroups';

const GALAKRAS = 51_622;
const DARK_SHAMAN = 51_606;
const BLACKFUSE = 51_601;

/** Galakras. */
const KRUGRUK = 72_357;
const DAGRYN = 72_356;
/** The two that sound like tower bosses and are fought in the courtyard. */
const KORGRA = 72_456;
const THRANOK = 72_355;
/** Kor'kron Dark Shaman. */
const HAROMM = 71_859;
const KARDRIS = 71_858;
/** Siegecrafter Blackfuse. */
const MISSILE_TURRET = 71_606;
const BOSS = 71_504;

const PLAYER = 1;
const PET = 2;

/** One landed hit. The rules read four fields and this writes exactly those. */
const hit = (targetID: number, timestamp: number, amount: number, sourceID = PLAYER): WclEvent =>
	({ type: 'damage', timestamp, sourceID, targetID, amount }) as WclEvent;

/** A run of hits a second apart, so a window has a length rather than a point. */
function run(targetID: number, from: number, to: number, amount: number, sourceID = PLAYER): WclEvent[] {
	const out: WclEvent[] = [];
	for (let at = from; at <= to; at += 1000) out.push(hit(targetID, at, amount, sourceID));
	return out;
}

/**
 * A hand-built pull, in game ids.
 *
 * The report's local actor numbers are the game ids themselves here, which no real log does and
 * nothing under test can tell — every rule resolves through `enemyNPCs` and then compares `targetID`s,
 * so the identity mapping exercises the resolution without a second table to keep in step.
 */
function pull(encounterID: number, gameIDs: readonly number[], events: readonly WclEvent[]) {
	return {
		encounterID,
		enemyNPCs: gameIDs.map((gameID) => ({ id: gameID, gameID })),
		events,
		mine: (sourceID: number | undefined) => sourceID === PLAYER || sourceID === PET,
		fightStartMs: 0,
		nameOf: (id: number) => `NPC ${id}`,
	};
}

/** The same call against a committed dataset, with the engine's own pet rule. */
function onFixture(dataset: FightDataset) {
	const pets = new Set((dataset.actors ?? []).filter((a) => a.petOwner === dataset.actor.id).map((a) => a.id));
	const names = new Map((dataset.actors ?? []).map((a) => [a.id, a.name]));
	return detectSplitGroup({
		encounterID: dataset.fight.encounterID,
		enemyNPCs: dataset.table.fight.enemyNPCs,
		events: dataset.events,
		mine: (sourceID) => sourceID !== undefined && (sourceID === dataset.actor.id || pets.has(sourceID)),
		fightStartMs: dataset.fight.startTime,
		nameOf: (id) => names.get(id) ?? null,
	});
}

describe('Galakras — the tower squads', () => {
	/**
	 * The trap, on the pull that would have sprung it.
	 *
	 * `sections.json` is a Windwalker who spent the whole pull in the courtyard, and 11.4% of their
	 * damage went into **Korgra the Snake** (5.74%) and **High Enforcer Thranok** (5.65%) — two named
	 * elites that read like tower bosses and are wave leaders. A rule built on the four named elites
	 * rather than the two real captains fires here, on a player who never climbed anything. Their damage
	 * to Lieutenant Krugruk and Master Cannoneer Dagryn on the same pull is exactly zero.
	 */
	it('stays silent on a courtyard pull that killed both wave leaders', () => {
		const dataset = rawFixture('windwalker', 'sections.json');
		expect(dataset.fight.encounterID).toBe(GALAKRAS);

		const npcs = new Map((dataset.table.fight.enemyNPCs ?? []).map((npc) => [npc.gameID, npc.id]));
		const landed = (gameID: number) =>
			dataset.events.filter((e) => e.type === 'damage' && e.tick !== true && e.targetID === npcs.get(gameID)).length;
		expect([landed(KORGRA), landed(THRANOK)]).toEqual([161, 127]);
		expect([landed(KRUGRUK), landed(DAGRYN)]).toEqual([0, 0]);

		expect(onFixture(dataset)).toBeNull();
	});

	it('reports one run per tower, at the captain each of them holds', () => {
		const found = detectSplitGroup(
			pull(
				GALAKRAS,
				[KRUGRUK, DAGRYN, KORGRA],
				[
					...run(KORGRA, 0, 60_000, 1000),
					...run(KRUGRUK, 160_000, 178_000, 100),
					...run(DAGRYN, 310_000, 335_000, 100),
				],
			),
		);
		expect(found?.kind).toBe('towerRuns');
		expect(found?.windows).toEqual([
			[160_000, 178_000],
			[310_000, 335_000],
		]);
		expect(found?.awayMs).toBe(43_000);
		// Two runs out of a seven-minute pull are barely 1% of the damage in it, which is why the towers
		// are decided on the clock and not on `AWAY_SHARE`. This is the arithmetic that would refuse them.
		expect(found?.share).toBeLessThan(AWAY_SHARE);
	});

	it('refuses a tag too short to have been a climb', () => {
		const brief = detectSplitGroup(
			pull(
				GALAKRAS,
				[KRUGRUK, KORGRA],
				[...run(KORGRA, 0, 60_000, 1000), hit(KRUGRUK, 100_000, 100), hit(KRUGRUK, 103_000, 100)],
			),
		);
		expect(brief).toBeNull();
		// And the same two hits, held for one second past the floor, are a run.
		const held = detectSplitGroup(
			pull(
				GALAKRAS,
				[KRUGRUK, KORGRA],
				[...run(KORGRA, 0, 60_000, 1000), hit(KRUGRUK, 100_000, 100), hit(KRUGRUK, 100_000 + AWAY_RUN_MS, 100)],
			),
		);
		expect(held?.kind).toBe('towerRuns');
		expect(held?.awayMs).toBe(AWAY_RUN_MS);
	});

	/**
	 * The one committed pull a rule here fires on, and it fires for a reason that can be checked by hand.
	 *
	 * `protection/galakras.json` is a Paladin who spent the pull tanking the gate and went up **one**
	 * tower: 28 hits into Master Cannoneer Dagryn between 4:40 and 4:51, and nothing on the other captain
	 * but a single stray at 2:16 — four minutes away from the run and in the wrong tower. That stray is
	 * what the zero-length filter is for, and this is the pull it was measured on: without it the report
	 * would tell a player who climbed once that they climbed twice.
	 */
	it('reports the one run a committed Galakras tank actually made', () => {
		const found = onFixture(rawFixture('protection', 'galakras.json'));
		expect(found?.kind).toBe('towerRuns');
		expect(found?.windows.length).toBe(1);
		expect(Math.round((found?.awayMs ?? 0) / 1000)).toBe(11);
	});
});

describe('Kor’kron Dark Shaman — the two bosses pulled apart', () => {
	it('names the boss a split group held', () => {
		const found = detectSplitGroup(
			pull(DARK_SHAMAN, [HAROMM, KARDRIS], [...run(HAROMM, 0, 200_000, 1000), hit(KARDRIS, 1000, 900)]),
		);
		expect(found?.kind).toBe('splitPair');
		expect(found?.name).toBe(`NPC ${HAROMM}`);
		expect(found?.share).toBeGreaterThan(PAIR_SHARE);
		// A whole-pull fact, not an excursion: there is no stretch of it to point at.
		expect([found?.windows, found?.awayMs]).toEqual([[], 0]);
	});

	/**
	 * The regression this rule was rewritten for.
	 *
	 * Storm, Earth and Fire places two spirits that carry the monk's damage onto other targets, and on a
	 * stacked pull that is exactly where they go — the second boss. Reading only the player's own hits
	 * therefore makes every stacked pull look split: measured through the app's own fetch, the four
	 * committed anonymous Dark Shaman kills put 75–93% of the *monk's own* damage on one boss, and this
	 * rule fires at 90%. With the spirits counted the same four read 50.3–62.0%.
	 */
	it('counts the spirits, so a stacked pull is a cleave and not a split', () => {
		const events = [...run(HAROMM, 0, 200_000, 1000), ...run(KARDRIS, 0, 200_000, 1000, PET)];
		expect(detectSplitGroup(pull(DARK_SHAMAN, [HAROMM, KARDRIS], events))).toBeNull();
		// Same events, same rule, with the pets no longer the player's: the defect, reproduced.
		expect(
			detectSplitGroup({ ...pull(DARK_SHAMAN, [HAROMM, KARDRIS], events), mine: (id) => id === PLAYER })?.kind,
		).toBe('splitPair');
	});
});

describe('Siegecrafter Blackfuse — the belt team', () => {
	it('reports the trips and the share the boss never saw', () => {
		const found = detectSplitGroup(
			pull(
				BLACKFUSE,
				[MISSILE_TURRET, BOSS],
				[
					...run(MISSILE_TURRET, 12_000, 22_000, 1000),
					...run(MISSILE_TURRET, 74_000, 84_000, 1000),
					hit(BOSS, 30_000, 500),
				],
			),
		);
		expect(found?.kind).toBe('belt');
		expect(found?.windows.length).toBe(2);
		expect(found?.share).toBeGreaterThan(0.97);
	});

	it('refuses one weapon cleaved in passing by a player on the boss', () => {
		expect(
			detectSplitGroup(
				pull(
					BLACKFUSE,
					[MISSILE_TURRET, BOSS],
					[...run(BOSS, 0, 200_000, 1000), ...run(MISSILE_TURRET, 30_000, 40_000, 100)],
				),
			),
		).toBeNull();
	});
});

describe('every other pull', () => {
	/**
	 * Eleven of the fourteen Siege encounters have no rule, and nothing else in the game does either.
	 *
	 * Swept rather than listed, so a fixture committed later is covered by the fact of being added — the
	 * argument `analysis/fixtures.ts` makes for discovering its own input. The Galakras dataset is the
	 * one raw fixture a rule even looks at, and the block above pins what it answers.
	 */
	it('finds exactly one split across every committed raw dataset', () => {
		const fixtures = [...rawFixtures('windwalker'), ...rawFixtures('protection'), ...rawFixtures('elemental')];
		expect(fixtures.length).toBeGreaterThan(4);
		expect(fixtures.filter((fixture) => onFixture(fixture.dataset) !== null).map((f) => f.name)).toEqual([
			'galakras.json',
		]);
	});

	it('answers null rather than throwing on a pull with no encounter and no enemies', () => {
		expect(detectSplitGroup(pull(GALAKRAS, [], [])) === null).toBe(true);
		expect(
			detectSplitGroup({
				...pull(GALAKRAS, [KRUGRUK], run(KRUGRUK, 0, 60_000, 100)),
				encounterID: undefined,
			}),
		).toBeNull();
	});
});
