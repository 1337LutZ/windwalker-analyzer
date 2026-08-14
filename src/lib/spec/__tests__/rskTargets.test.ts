// The Rising Sun Kick debuff, drawn once per enemy that carried it.
//
// Synthetic events rather than a fixture, for the reason the gear suite gives: every committed
// fixture is a single-target pull, so the case this exists for — a debuff spread across adds — does
// not appear in any of them at all.
//
// The load-bearing assertion is the one that says the graded number did not move. `debuff.uptimePct`
// and `debuff.engagedUptimePct` are measured against the primary target on purpose, because grading a
// debuff that the fight asks you to spread produced uptimes as low as 0.6% on real add pulls. The
// lanes below are drawing only, and the test that strips every add from the log and gets the same
// debuff numbers back is what proves it.

import { describe, expect, it } from 'vitest';

import type { Actor, FightDataset, WclEvent } from '~/lib/types';

import { RSK_TARGET_LANES, analyse } from '../windwalker';

const T0 = 100_000;
const END = T0 + 120_000;
const ME = 5;
const BOSS = 20;
const ADD_A = 21;
const ADD_B = 22;
/** In the log and not in the report's actor list, which is the case that must not invent a name. */
const NAMELESS = 23;

const RSK_DEBUFF_ID = 130_320;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

/** A Rising Sun Kick landing on `target`, with the debuff it applies and the hit that carries it. */
const kick = (at: number, target: number, amount: number, until: number): WclEvent[] => [
	e(at, 'cast', 107_428, { targetID: target }),
	e(at, 'damage', 107_428, { targetID: target, amount, hitType: 2 }),
	e(at, 'applydebuff', RSK_DEBUFF_ID, { targetID: target }),
	e(until, 'removedebuff', RSK_DEBUFF_ID, { targetID: target }),
];

const actors: Actor[] = [
	{ id: ME, name: 'Bigdogmo', type: 'Player' },
	{ id: BOSS, name: 'Galakras', type: 'NPC' },
	{ id: ADD_A, name: "Kor'kron Demolisher", type: 'NPC' },
	{ id: ADD_B, name: "Kor'kron Ironblade", type: 'NPC' },
];

const datasetOf = (events: WclEvent[], enemies: number[]): FightDataset => ({
	code: 'abc123',
	fight: {
		id: 7,
		name: 'Galakras',
		encounterID: 1620,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: END,
	},
	actor: { id: ME, name: 'Bigdogmo', type: 'Player' },
	actors,
	events,
	table: {
		fight: {
			id: 7,
			name: 'Galakras',
			encounterID: 1620,
			kill: true,
			difficulty: 4,
			size: 25,
			startTime: T0,
			endTime: END,
			enemyNPCs: enemies.map((id) => ({ id, gameID: 70_000 + id })),
		},
		damageDone: {
			entries: [
				{
					name: 'Bigdogmo',
					id: ME,
					type: 'Monk',
					itemLevel: 553,
					total: 1_000_000,
					activeTime: 110_000,
					abilities: [{ guid: 107_428, name: 'Rising Sun Kick', total: 1_000_000 }],
				},
			],
		},
	},
});

/** The tell that this player was Windwalker at all; without it `analyse` refuses the spec. */
const brewBank: WclEvent[] = [e(0, 'applybuff', 1_247_279), e(500, 'applybuffstack', 1_247_279, { stack: 10 })];

/**
 * An add pull: the boss takes most of the damage, three adds take the rest, and the debuff runs on
 * all four. The boss is kicked twice with the second application starting where the first ended, so
 * its lane also has to come back as one bar rather than two.
 */
const addFight: WclEvent[] = [
	...brewBank,
	...kick(1000, BOSS, 200_000, 16_000),
	...kick(16_000, BOSS, 200_000, 30_000),
	// Damage on the primary spread across the pull, which is what `engagedWindows` reads to decide the
	// boss was there to be hit — the denominator of the graded figure.
	e(45_000, 'damage', 100_780, { targetID: BOSS, amount: 1000, hitType: 1 }),
	e(70_000, 'damage', 100_780, { targetID: BOSS, amount: 1000, hitType: 1 }),
	e(95_000, 'damage', 100_780, { targetID: BOSS, amount: 1000, hitType: 1 }),
	...kick(35_000, ADD_B, 300_000, 45_000),
	...kick(40_000, ADD_A, 150_000, 50_000),
	// Never removed: the add died holding it, and `auraWindows` closes the window at the pull's end.
	e(60_000, 'cast', 107_428, { targetID: NAMELESS }),
	e(60_000, 'damage', 107_428, { targetID: NAMELESS, amount: 20_000, hitType: 2 }),
	e(60_000, 'applydebuff', RSK_DEBUFF_ID, { targetID: NAMELESS }),
];

const analysis = analyse(datasetOf(addFight, [BOSS, ADD_A, ADD_B, NAMELESS]));
const debuffLanes = analysis.timeline?.lanes.filter((l) => l.group === 'debuff') ?? [];

describe('the Rising Sun Kick debuff lanes', () => {
	it('draws one lane per enemy that carried the debuff', () => {
		expect(debuffLanes).toHaveLength(4);
		expect(debuffLanes.map((l) => l.target?.id)).toEqual([BOSS, ADD_B, ADD_A, NAMELESS]);
	});

	/**
	 * Primary first, then by the damage the enemy took from this player — the same currency
	 * `primaryTargetID` and `primaryDamageShare` are measured in, so the lane order cannot disagree with
	 * the "which enemy was this pull about" answer the debuff section prints.
	 */
	it('puts the primary target first and orders the rest by the damage they took', () => {
		expect(debuffLanes[0]?.target?.primary).toBe(true);
		expect(debuffLanes.slice(1).map((l) => l.target?.primary)).toEqual([false, false, false]);
		expect(debuffLanes.map((l) => l.target?.name)).toEqual([
			'Galakras',
			"Kor'kron Ironblade",
			"Kor'kron Demolisher",
			null,
		]);
	});

	/** A lane the report cannot name is left unnamed. Any name here would be a different enemy's. */
	it('never invents a name for an enemy the actor list does not answer for', () => {
		expect(debuffLanes.find((l) => l.target?.id === NAMELESS)?.target?.name).toBeNull();
	});

	/**
	 * The same merge the primary lane has always had, applied per enemy: two applications that abut
	 * would otherwise draw one continuous debuff as two bars, and a reader counting bars would report a
	 * drop the fight never had.
	 */
	it('merges each enemy’s applications into continuous bars', () => {
		expect(debuffLanes[0]?.windows).toEqual([{ start: 1000, end: 30_000 }]);
		expect(debuffLanes[1]?.windows).toEqual([{ start: 35_000, end: 45_000 }]);
	});

	/** A window still open when the pull ends is closed at the end rather than dropped. */
	it('closes a debuff the add died holding at the end of the pull', () => {
		expect(debuffLanes[3]?.windows).toEqual([{ start: 60_000, end: 120_000 }]);
	});

	/** The lanes share the aura's key and differ only by target, so the chart keys on both. */
	it('keeps the aura’s own key on every lane', () => {
		expect(new Set(debuffLanes.map((l) => l.key))).toEqual(new Set(['rising-sun-kick-debuff']));
	});
});

describe('the graded debuff uptime', () => {
	/**
	 * The whole point of the change: the lanes gained the adds and the metric did not.
	 *
	 * Checked by stripping every event that touches anything but the boss and re-analysing. If a single
	 * add had leaked into the scoped windows, the two runs would disagree — and `engagedUptimePct` is
	 * what `score.ts` grades.
	 */
	it('measures exactly what it measured before the adds were drawn', () => {
		const bossOnly = addFight.filter((ev) => ev.targetID === ME || ev.targetID === BOSS);
		const scoped = analyse(datasetOf(bossOnly, [BOSS]));

		expect(analysis.debuff.windows).toEqual(scoped.debuff.windows);
		expect(analysis.debuff.uptimeMs).toBe(scoped.debuff.uptimeMs);
		expect(analysis.debuff.uptimePct).toBe(scoped.debuff.uptimePct);
		expect(analysis.debuff.engagedMs).toBe(scoped.debuff.engagedMs);
		expect(analysis.debuff.engagedUptimePct).toBe(scoped.debuff.engagedUptimePct);
		expect(analysis.debuff.drops).toEqual(scoped.debuff.drops);
	});

	/** The lane the reader compares the number against is the array the number was measured from. */
	it('is the primary lane, exactly', () => {
		expect(debuffLanes[0]?.windows).toBe(analysis.debuff.windows);
	});

	/**
	 * Unchanged behaviour, asserted here because the lanes now make the spread visible: a pull this
	 * scattered still declines to grade, so `score.ts` reads `null` rather than a red 30%.
	 */
	it('still declines to grade a pull the damage was spread across', () => {
		expect(analysis.debuff.singleTarget).toBe(false);
		expect(analysis.debuff.primaryDamageShare).toBeLessThan(66);
	});
});

describe('the lane cap', () => {
	/** Thirty adds must not draw thirty lanes, and what was left out has to be countable. */
	const swarm = analyse(
		datasetOf(
			[
				...brewBank,
				...kick(1000, BOSS, 500_000, 30_000),
				// Nine adds, each taking less than the one before, so the drawn set is the top of the order.
				...Array.from({ length: 9 }, (_, i) => kick(31_000 + i * 1000, 30 + i, 9000 - i * 100, 40_000)).flat(),
			],
			[BOSS, ...Array.from({ length: 9 }, (_, i) => 30 + i)],
		),
	);
	const lanes = swarm.timeline?.lanes.filter((l) => l.group === 'debuff') ?? [];

	it('draws no more than the cap', () => {
		expect(lanes).toHaveLength(RSK_TARGET_LANES);
		expect(lanes[0]?.target?.id).toBe(BOSS);
	});

	it('keeps the enemies that took the most damage', () => {
		expect(lanes.slice(1).map((l) => l.target?.id)).toEqual([30, 31, 32, 33, 34]);
	});

	/** Counted rather than truncated in silence: the chart says so in its own copy. */
	it('counts what it left out', () => {
		expect(swarm.timeline?.hiddenTargets).toBe(4);
	});

	it('hides nothing on a pull inside the cap', () => {
		expect(analysis.timeline?.hiddenTargets).toBe(0);
	});
});
