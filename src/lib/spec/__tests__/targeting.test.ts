// Which enemy the player was on: who the pull was about, whether the debuff was on the thing being
// hit, and how many enemies were being hit at once.
//
// Synthetic events rather than a fixture, for the reason `rskTargets.test.ts` gives: every committed
// fixture is a single-target pull, so the cases these exist for — a boss outdamaged by its own adds,
// a debuff spread across several enemies, a player cycling two of them — appear in none of them.

import { describe, expect, it } from 'vitest';

import { scoreAnalysis } from '~/lib/score';
import type { Actor, FightDataset, WclEvent } from '~/lib/types';

import { IGNORED_MULTI_TARGET_ACTORS, TARGET_WINDOW_MS, analyse } from '../windwalker';

const T0 = 100_000;
const DURATION = 120_000;
const END = T0 + DURATION;
const ME = 5;
const BOSS = 20;
const ADD = 21;

const RSK_CAST_ID = 107_428;
const RSK_DEBUFF_ID = 130_320;
const JAB_ID = 100_780;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

/** A landed hit that is not a Rising Sun Kick: what the contact rule reads, and what engagement reads. */
const hit = (at: number, target: number, amount: number): WclEvent =>
	e(at, 'damage', JAB_ID, { targetID: target, amount, hitType: 1 });

/** A Rising Sun Kick on `target`: the press, the hit that carries it, and the debuff it applies. */
const kick = (at: number, target: number, amount: number, until: number): WclEvent[] => [
	e(at, 'cast', RSK_CAST_ID, { targetID: target }),
	e(at, 'damage', RSK_CAST_ID, { targetID: target, amount, hitType: 2 }),
	e(at, 'applydebuff', RSK_DEBUFF_ID, { targetID: target }),
	e(until, 'removedebuff', RSK_DEBUFF_ID, { targetID: target }),
];

/** The tell that this player was Windwalker at all; without it `analyse` refuses the spec. */
const brewBank: WclEvent[] = [e(0, 'applybuff', 1_247_279), e(500, 'applybuffstack', 1_247_279, { stack: 10 })];

/**
 * `subType: 'Boss'` is how WarcraftLogs names the encounter's boss in the report's master data, and
 * the only thing here that separates it from an add — by damage the add wins comfortably.
 */
const actors = (bossIsMarked: boolean): Actor[] => [
	{ id: ME, name: 'Bigdogmo', type: 'Player' },
	{ id: BOSS, name: 'Galakras', type: 'NPC', ...(bossIsMarked ? { subType: 'Boss' } : {}) },
	{ id: ADD, name: "Kor'kron Demolisher", type: 'NPC' },
];

const datasetOf = (events: WclEvent[], bossIsMarked = true): FightDataset => ({
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
	actors: actors(bossIsMarked),
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
			enemyNPCs: [
				{ id: BOSS, gameID: 72_249 },
				{ id: ADD, gameID: 72_947 },
			],
		},
		damageDone: {
			entries: [
				{
					name: 'Bigdogmo',
					id: ME,
					type: 'Monk',
					itemLevel: 553,
					total: 660_000,
					activeTime: 110_000,
					abilities: [{ guid: RSK_CAST_ID, name: 'Rising Sun Kick', total: 300_000 }],
				},
			],
		},
	},
});

/**
 * An add pull the boss does not dominate.
 *
 * The player stays in contact with the boss throughout — a hit every ten seconds, which is what keeps
 * engaged time one unbroken segment of 110s — and spends the middle of the pull kicking an add, which
 * takes three times the damage the boss does. The debuff runs on the boss for the first 39 seconds and
 * on the add for the next 39, and the two never overlap: every moment of the pull has at most one
 * enemy carrying it, which is what makes the three candidate readings of "uptime" produce three
 * different numbers off one set of events.
 */
const addFight: WclEvent[] = [
	...brewBank,
	...Array.from({ length: 12 }, (_, i) => hit(i * 10_000, BOSS, 5000)),
	...kick(1000, BOSS, 100_000, 40_000),
	...kick(41_000, ADD, 200_000, 80_000),
	hit(45_000, ADD, 100_000),
	hit(55_000, ADD, 100_000),
	hit(65_000, ADD, 100_000),
].sort((a, b) => a.timestamp - b.timestamp);

const analysis = analyse(datasetOf(addFight));

/**
 * The clock the section measures against, unbroken: hits every 10s against a 15s gap threshold.
 *
 * On this pull the boss is in contact for the whole of it, so the two clocks coincide and it is also
 * `engagedMs`. The suite at the bottom of this file is the one that pulls them apart.
 */
const ENGAGED_MS = 110_000;
/** The debuff on the enemy being hit: 39s on the boss less the first second, plus 19s of add contact. */
const CONTACT_MS = 39_000 + 19_000;
/** What the old measurement returned: the boss's own window, and nothing the player did to the add. */
const PRIMARY_ONLY_MS = 39_000;
/** The reading this deliberately is not: the debuff up on any enemy, whether or not it was being hit. */
const ANY_ENEMY_MS = 39_000 + 39_000;

describe('the enemy a pull is about', () => {
	/**
	 * The fix this file exists for. The add took 500k of the player's damage and the boss 160k, so
	 * ranking by damage picks the add — and every number scoped to the primary target then describes an
	 * add, on a fight whose whole point is that adds are not the boss.
	 */
	it('is the boss the report names, not the enemy that took the most damage', () => {
		expect(analysis.primaryTarget.id).toBe(BOSS);
		expect(analysis.primaryTarget.gameID).toBe(72_249);
	});

	/** With no boss named — trash, or master data that gave no subtype — the damage is all there is. */
	it('falls back to the biggest damage taker when the report names no boss', () => {
		expect(analyse(datasetOf(addFight, false)).primaryTarget.id).toBe(ADD);
	});

	/** The share is the boss's now, so it can only fall: the old figure was the largest on the pull. */
	it('measures the damage share against the boss', () => {
		expect(analysis.debuff.primaryDamageShare).toBeCloseTo((160_000 / 660_000) * 100, 1);
		expect(analysis.debuff.singleTarget).toBe(false);
	});
});

describe('the graded debuff uptime', () => {
	it('asks whether the enemy being hit carried the debuff', () => {
		expect(analysis.debuff.engagedMs).toBe(ENGAGED_MS);
		expect(analysis.debuff.contactMs).toBe(ENGAGED_MS);
		expect(analysis.debuff.engagedUptimePct).toBeCloseTo((CONTACT_MS / ENGAGED_MS) * 100, 6);
	});

	/**
	 * And the tile printed beside it, which is that same figure's remainder rather than a second
	 * reading of anything: engaged time whose enemy was not carrying the debuff.
	 *
	 * It used to be the primary target's dropped windows, which on this pull is **nought** — the boss's
	 * one window has no gap after it — against the 52 seconds the player spent hitting an enemy without
	 * the debuff on it. That is the contradiction: a tile reading zero next to an uptime of 52.7%.
	 */
	it('reports the time lost as that figure’s exact complement', () => {
		expect(analysis.debuff.secondsLost).toBeCloseTo((ENGAGED_MS - CONTACT_MS) / 1000, 1);
		expect(analysis.debuff.engagedUptimePct + (analysis.debuff.secondsLost * 100_000) / ENGAGED_MS).toBeCloseTo(100, 1);
	});

	/**
	 * The number is neither of the two readings it was chosen over, and the gap is not a rounding one:
	 * 35.5% for the primary target alone, 70.9% for the debuff up on anything at all, 52.7% for the
	 * enemy actually being hit. Asserted as an ordering rather than three constants so this keeps
	 * failing if the middle definition is ever quietly swapped for one of the others.
	 */
	it('is neither the primary target alone nor the debuff on any enemy', () => {
		expect(analysis.debuff.engagedUptimePct).toBeGreaterThan((PRIMARY_ONLY_MS / ENGAGED_MS) * 100);
		expect(analysis.debuff.engagedUptimePct).toBeLessThan((ANY_ENEMY_MS / ENGAGED_MS) * 100);
	});

	/** The window model is untouched: `debuff.windows` is still the primary's, and still what is drawn. */
	it('leaves the primary target’s windows exactly as they were', () => {
		expect(analysis.debuff.windows).toEqual([{ start: 1000, end: 40_000 }]);
		expect(analysis.debuff.uptimeMs).toBe(PRIMARY_ONLY_MS);
	});

	/**
	 * The drops stayed behind, so the ledger row that lists one has to say whose gap it was.
	 *
	 * Three kicks on the boss and two gaps between them, which is the smallest shape that produces a row
	 * at all: with one gap the drop list treats it as the intermission and leaves it out. The row names
	 * the boss because the tile beside it counts every enemy the player touched, and a reader with only
	 * `RSK dropped` in front of them has no way to tell the two apart.
	 */
	it('names the enemy a ledger drop row is about', () => {
		const dropFight = [
			...brewBank,
			...Array.from({ length: 12 }, (_, i) => hit(i * 10_000, BOSS, 5000)),
			...kick(1000, BOSS, 100_000, 20_000),
			...kick(30_000, BOSS, 100_000, 40_000),
			...kick(70_000, BOSS, 100_000, 90_000),
		].sort((a, b) => a.timestamp - b.timestamp);

		expect(analyse(datasetOf(dropFight)).misses.map((m) => m.kind)).toContain('RSK dropped (Galakras)');
	});

	/**
	 * The consequence in `score.ts`: a spread pull used to be left ungraded, because the only number
	 * available described one enemy the player had left. This one describes the pull, so it is graded.
	 */
	it('is graded on a pull the damage was spread across', () => {
		expect(scoreAnalysis(analysis).sections['debuff']?.unmeasurable).toBe(false);
	});
});

/**
 * The denominator, on a pull where the two clocks are not the same length.
 *
 * The boss is hit for the first 50 seconds and add waves fill the next 60, which is the shape of every
 * add fight in the tier and of none of the committed fixtures. The debuff runs 39 seconds on the boss
 * and 39 on the add, and the player is in contact throughout: the gaps between hits are ten seconds
 * against a fifteen-second threshold, so contact is one unbroken window and engagement is not.
 *
 * What this pins is that the numerator and the denominator come from the same clock. Measured the old
 * way — the boss's 50 seconds, and only the debuff that fell inside them — this pull reads 78.0%, a
 * number about the first quarter of a fight, printed as though it were about the fight. It is 70.9%.
 */
describe('the clock the section is measured against', () => {
	const BOSS_MS = 50_000;
	const CONTACT_ALL_MS = 110_000;
	/** 39s of debuff on the boss while the boss is what is being hit, and 39s on the add likewise. */
	const COVERED_MS = 39_000 + 39_000;

	const waves = [
		...brewBank,
		// The boss, then nothing but adds: six hits apiece, ten seconds apart, which keeps contact whole
		// and lets engagement end with the last blow the boss took.
		...Array.from({ length: 6 }, (_, i) => hit(i * 10_000, BOSS, 5000)),
		...Array.from({ length: 6 }, (_, i) => hit(60_000 + i * 10_000, ADD, 5000)),
		...kick(1000, BOSS, 100_000, 40_000),
		...kick(61_000, ADD, 100_000, 100_000),
	].sort((a, b) => a.timestamp - b.timestamp);
	const spread = analyse(datasetOf(waves));

	it('keeps the boss’s clock and the player’s clock apart', () => {
		expect(spread.debuff.engagedMs).toBe(BOSS_MS);
		expect(spread.debuff.contactMs).toBe(CONTACT_ALL_MS);
	});

	/** The add's 39 seconds count, and they are measured against a denominator that contains them. */
	it('measures the debuff on the enemy being hit against the time anything was', () => {
		expect(spread.debuff.engagedUptimePct).toBeCloseTo((COVERED_MS / CONTACT_ALL_MS) * 100, 6);
		expect(spread.debuff.engagedUptimePct).toBeLessThan(78);
	});

	/** And the complement still holds, against the clock that is now the denominator. */
	it('reports the time lost as the complement of contact time', () => {
		expect(spread.debuff.secondsLost).toBeCloseTo((CONTACT_ALL_MS - COVERED_MS) / 1000, 1);
		expect(spread.debuff.engagedUptimePct + (spread.debuff.secondsLost * 100_000) / CONTACT_ALL_MS).toBeCloseTo(100, 1);
	});

	/**
	 * The cast ceiling reads the same clock. Against the boss's it was `2 / 6` on this pull — a ceiling
	 * built out of the quarter of the fight the boss was present for, which no number of casts could
	 * ever fill. Chi Brew's ceiling moves for the same reason and is checked with it.
	 */
	it('builds the cast ceiling out of the same clock', () => {
		expect(Math.floor((spread.debuff.contactMs ?? 0) / 8000)).toBe(13);
		expect(Math.floor(spread.debuff.engagedMs / 8000)).toBe(6);
	});
});

/**
 * The windows the figure is read from, and the two ways they used to be built wrong.
 *
 * Both were found by diffing this engine against an independently written script on the Galakras kill
 * in `a:6MhZgjyAknFWrYfK`, where they cost 17.4 and 42.3 seconds of coverage — together taking that
 * pull from 61.8% to 80.6%, against the other implementation's 80.7%. Neither shows up on a
 * single-target pull, which is every committed fixture, so they are pinned here on synthetic events.
 *
 * The player is on the boss throughout, so contact is one unbroken 110-second window and the boss
 * never carries the debuff. Every millisecond of coverage below therefore comes from the add.
 */
describe('the debuff windows the figure is read from', () => {
	const CONTACT_MS = 110_000;
	const bossContact = Array.from({ length: 12 }, (_, i) => hit(i * 10_000, BOSS, 5000));
	/** A hit on one *spawn*: the same actor id every time, told apart only by the instance. */
	const spawnHit = (at: number, instance: number): WclEvent =>
		e(at, 'damage', JAB_ID, { targetID: ADD, targetInstance: instance, amount: 5000, hitType: 1 });
	const debuff = (at: number, type: string, instance: number): WclEvent =>
		e(at, type, RSK_DEBUFF_ID, { targetID: ADD, targetInstance: instance });

	/**
	 * WarcraftLogs gives one actor id to an NPC type, so two Kor'kron Ironblades are one `targetID` and
	 * two instances. Keyed by the id alone their event streams interleave: the second apply is swallowed
	 * because a window is already open, and the first remove closes it — so the second spawn's debuff
	 * never existed, and the player hitting it between 36s and 40s was credited with nothing.
	 */
	it('keeps two spawns of one enemy apart', () => {
		const spawns = [
			...brewBank,
			...bossContact,
			debuff(20_000, 'applydebuff', 1),
			debuff(25_000, 'applydebuff', 2),
			debuff(35_000, 'removedebuff', 1),
			debuff(40_000, 'removedebuff', 2),
			// Inside spawn 2's window and outside spawn 1's, which is the whole of what is being asserted.
			spawnHit(36_000, 2),
			spawnHit(38_000, 2),
		].sort((a, b) => a.timestamp - b.timestamp);

		// 36s→38s and 38s→40s, where the second hit's ownership ends at the boss hit at 40s.
		expect(analyse(datasetOf(spawns)).debuff.engagedUptimePct).toBeCloseTo((4000 / CONTACT_MS) * 100, 6);
	});

	/**
	 * A refresh with nothing open is proof the debuff was up and the apply never reached this stream —
	 * WarcraftLogs emits it constantly for a debuff re-applied to an enemy that already has it. Thrown
	 * away, as it used to be, the add here carried the debuff for ten seconds and the report said none.
	 * The window opens at the refresh rather than back-dated, so this under-states rather than invents.
	 */
	it('opens a window on a refresh that has no apply in front of it', () => {
		const orphan = [
			...brewBank,
			...bossContact,
			debuff(50_000, 'refreshdebuff', 1),
			debuff(60_000, 'removedebuff', 1),
			spawnHit(52_000, 1),
			spawnHit(54_000, 1),
		].sort((a, b) => a.timestamp - b.timestamp);

		// 52s→54s, then 54s→60s where the boss hit at 60s takes ownership back.
		expect(analyse(datasetOf(orphan)).debuff.engagedUptimePct).toBeCloseTo((8000 / CONTACT_MS) * 100, 6);
	});
});

describe('the per-moment target count', () => {
	it('ignores encounter-specific non-tank actors in the APL target count', () => {
		const base = datasetOf(addFight);
		const rule = IGNORED_MULTI_TARGET_ACTORS.find((candidate) => candidate.encounterID === 51601)!;
		const siege = {
			...base,
			fight: {
				...base.fight,
				encounterID: rule.encounterID,
				enemyNPCs: [
					{ id: BOSS, gameID: 71504 },
					{ id: ADD, gameID: rule.gameID },
				],
			},
			table: {
				...base.table,
				fight: {
					...base.table.fight,
					encounterID: rule.encounterID,
					enemyNPCs: [
						{ id: BOSS, gameID: 71504 },
						{ id: ADD, gameID: rule.gameID },
					],
				},
			},
		};

		expect(analyse(siege).targets?.counts.max).toBe(1);
	});

	it('carries the counts as a step series, in the shape the resource curves use', () => {
		expect(analysis.targets?.windowMs).toBe(TARGET_WINDOW_MS);
		expect(analysis.targets?.counts.max).toBe(2);
		expect(analysis.targets?.counts.points[0]).toEqual([0, 1]);
	});

	/**
	 * One enemy at a time is not a multi-target pull, however many enemies the pull contains. The
	 * player here is on the boss or on the add and almost never on both inside one window — four
	 * seconds of it, the overlap where a kick on the add followed a hit on the boss.
	 *
	 * The share is against contact time rather than against engaged time, which is the boss's clock. On
	 * this pull that is 76s of the 120s: the hits are ten seconds apart and the window is five, so the
	 * count falls to zero between them. That is the same behaviour that keeps an intermission out of the
	 * denominator, at the coarse spacing a synthetic pull is written with.
	 */
	it('reads a pull fought one enemy at a time as single target', () => {
		expect(analysis.targets?.multiTargetMs).toBe(4000);
		expect(analysis.targets?.multiTargetPct).toBeCloseTo((4000 / 76_000) * 100, 1);
		expect(analysis.targets?.detected).toBe('single');
	});

	/** And the opposite pull: two enemies cycled throughout, which is what the multi-target list is for. */
	it('reads a pull spent cycling two enemies as multi-target', () => {
		const cycling = [
			...brewBank,
			...kick(1000, BOSS, 100_000, 40_000),
			...Array.from({ length: 25 }, (_, i) => hit(i * 4000, BOSS, 5000)),
			...Array.from({ length: 25 }, (_, i) => hit(2000 + i * 4000, ADD, 5000)),
		].sort((a, b) => a.timestamp - b.timestamp);
		const spread = analyse(datasetOf(cycling));

		expect(spread.targets?.counts.max).toBe(2);
		expect(spread.targets?.detected).toBe('multi');
		expect(spread.targets?.multiTargetPct).toBeGreaterThan(90);
	});
});
