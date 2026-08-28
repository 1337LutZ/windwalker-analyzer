// Lightning Shield's own stack walk: the counter, the ceiling, the fall-offs and the spends.
//
// The two committed pulls are raw `FightDataset`s, so `analyse` really runs and the figures below are
// the audit's own output. They are also the only place the *pre-fight inference* can be checked at all:
// neither log carries a single `applybuff` of 324, because the shield is put up before the pull and the
// fight-scoped event query returns nothing but the stack changes — which is exactly the case
// `auraLevels` was given its inference for.
//
// The synthetic pull underneath them is for the three things a real log cannot be made to show on
// demand: Fulmination leaving one charge behind, the shield genuinely coming off, and the ceiling
// stretch that must not be allowed to run across the absence in between.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import { defaultSettings } from '~/lib/settings';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse, ELEMENTAL_SETTINGS } from '../index';

const dataset = (name: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;

const fx = (name: string, overcapMs?: number): Analysis & ElementalAuditResult =>
	analyse(
		dataset(name),
		overcapMs === undefined
			? undefined
			: { ...defaultSettings(ELEMENTAL_SETTINGS), lightningShieldOvercapMs: overcapMs },
	) as Analysis & ElementalAuditResult;

/**
 * `a:qHRAFwdGzaB6MPYC` #14 — twelve Earth Shocks, every one of them taken at the ceiling.
 *
 * The shield's first event in the log is `applybuffstack stack: 2` at 2 526ms. There is no `applybuff`
 * anywhere in the pull, so a walk that only paired applies to removes would have no reading for the
 * shield at all and the section would draw an empty chart on a pull the player kept it up for.
 */
describe('a shield that was already up when the pull started', () => {
	const el = fx('phased');
	const ls = el.lightningShield;

	it('infers the charge it must have been holding at the pull', () => {
		// `stack: 2` says one landed on top of one that was already there, so the pull opens at 1 —
		// floored there rather than at 0, because the inference is only ever "at least this many".
		expect(ls.points[0]).toEqual([0, 1]);
		expect(ls.points[1]).toEqual([2526, 2]);
		expect(ls.points).toHaveLength(87);
		expect(ls.maxStacks).toBe(7);
	});

	/**
	 * Fulmination leaves one charge behind, so a spend is not the shield coming off.
	 *
	 * Twelve spends on this pull and the shield was never down for a millisecond of it — which is what
	 * `fellOff` and `downWindows` have to say, and what they would not say if a drain to one charge were
	 * read as a removal.
	 */
	it('never reads a spend as the shield falling off', () => {
		expect(el.earthShock.presses).toHaveLength(12);
		expect(ls.fellOff).toBe(0);
		expect(ls.downWindows).toEqual([]);
	});

	/** Every one of the twelve was taken at seven, which is the whole game — so nothing to list. */
	it('has no spend below the ceiling to report', () => {
		expect(el.earthShock.presses.map((p) => p.lsStacks)).toEqual(Array.from({ length: 12 }, () => 7));
		expect(ls.badSpends).toEqual([]);
	});
});

/**
 * `a:xB3kh7v9pF2AHRtq` #16 — the same inference from a fuller shield, and two spends that threw
 * Fulmination away.
 */
describe('a shield inferred from four charges, and the two shocks that wasted it', () => {
	const el = fx('unbroken');
	const ls = el.lightningShield;

	it('opens the pull at three rather than at one', () => {
		// The log's first shield event is `applybuffstack stack: 4` at 21 144ms: four charges, one of
		// which arrived then, so three were already there. Nothing about this is a default.
		expect(ls.points[0]).toEqual([0, 3]);
		expect(ls.points[1]).toEqual([21_144, 4]);
	});

	/**
	 * The 250ms guard, pinned to the millisecond that needs it.
	 *
	 * The drain Fulmination causes is stamped at 173 298 and the cast that caused it at 173 299. Read
	 * strictly backwards the press sees its own drain and every shock in the game looks like a
	 * one-charge spend; read at `t - SELF_EVENT_MS` it sees the four charges it actually spent.
	 */
	it('reads what the press saw rather than what the press did', () => {
		expect(ls.points).toContainEqual([173_298, 1]);
		expect(el.earthShock.presses.find((p) => p.t === 173_299)?.lsStacks).toBe(4);
	});

	it('names both spends and what each of them spent', () => {
		expect(ls.badSpends).toEqual([
			{ t: 173_299, stacks: 4 },
			{ t: 180_744, stacks: 2 },
		]);
		// Neither spend took the shield off: both drained to one charge, thirteen presses and no gap.
		expect(el.earthShock.presses).toHaveLength(13);
		expect(ls.fellOff).toBe(0);
	});
});

/**
 * The ceiling, and what the reader's grace does to it.
 *
 * `atCapWindows` takes the leeway off the *front* of each merged stretch and reports the tail, so a
 * stretch shorter than the grace disappears entirely rather than being reported as zero. Both halves
 * show here: on `a:qHRAFwdGzaB6MPYC` #14 a wider grace both shortens the windows and drops six of them.
 */
describe('how long the shield sat at seven', () => {
	it('echoes the grace it measured against', () => {
		// The setting's own default, and a reader's override — one of each, so the field is shown to
		// follow the setting rather than to hold a constant that happens to match it.
		expect(fx('phased').lightningShield.leewayMs).toBe(5000);
		expect(fx('phased', 1000).lightningShield.leewayMs).toBe(1000);
	});

	it('reports the tail of each stretch past the grace', () => {
		const tight = fx('phased', 1000).lightningShield;
		expect(tight.overcapWindows).toHaveLength(12);
		expect(tight.overcapMs).toBe(37_803);

		const loose = fx('phased', 5000).lightningShield;
		expect(loose.overcapWindows).toHaveLength(5);
		expect(loose.overcapMs).toBe(12_352);
	});

	it('sums to the windows it drew, on both pulls and at both graces', () => {
		for (const name of ['phased', 'unbroken']) {
			for (const grace of [1000, 5000]) {
				const ls = fx(name, grace).lightningShield;
				const drawn = ls.overcapWindows.reduce((sum, w) => sum + (w.end - w.start), 0);
				expect(drawn).toBe(ls.overcapMs);
			}
		}
	});

	/** Every stretch reported is a stretch the counter was actually at the cap for. */
	it('only charges time the counter was at the ceiling', () => {
		const ls = fx('unbroken').lightningShield;
		expect(ls.overcapWindows).not.toEqual([]);
		for (const w of ls.overcapWindows) {
			const level = ls.points.filter(([at]) => at <= w.start).at(-1)?.[1];
			expect(level).toBe(ls.maxStacks);
		}
	});
});

// ------------------------------------------------------------------ synthetic

const T0 = 700_000;
const DURATION = 60_000;
const ME = 6;
const BOSS = 11;

const LIGHTNING_SHIELD = 324;
const LIGHTNING_BOLT = 403;
const LAVA_BURST = 51_505;
const EARTH_SHOCK = 8042;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

/** A hit every five seconds, well inside the 15s gap, so the engaged clock is the whole pull. */
const contact: WclEvent[] = Array.from({ length: DURATION / 5000 + 1 }, (_, i) =>
	e(i * 5000, 'damage', LIGHTNING_BOLT, { targetID: BOSS, targetInstance: 1, amount: 1000, hitType: 1 }),
);

/** Rolling Thunder, one charge at a time: `applybuffstack` carries the level that now stands. */
const chargeTo = (from: number, to: number, at: number, step: number): WclEvent[] =>
	Array.from({ length: to - from }, (_, i) =>
		e(at + i * step, 'applybuffstack', LIGHTNING_SHIELD, { stack: from + 1 + i }),
	);

/**
 * One shield, walked through everything that can happen to it.
 *
 *   0s        applied, one charge
 *   1-6s      charged to seven
 *   20s       Earth Shock — the drain is stamped a millisecond early and leaves **one** charge
 *   21-26s    charged back to seven
 *   30s       the shield comes off entirely
 *   32s       Earth Shock with no shield at all
 *   45s       re-applied, charged only to five
 *   46s       Earth Shock, spending five — a shock that threw Fulmination away
 *   50s       one charge back
 */
const shieldEvents: WclEvent[] = [
	e(0, 'applybuff', LIGHTNING_SHIELD),
	...chargeTo(1, 7, 1000, 1000),
	e(19_999, 'removebuffstack', LIGHTNING_SHIELD, { stack: 1 }),
	e(20_000, 'cast', EARTH_SHOCK, { targetID: BOSS, targetInstance: 1 }),
	...chargeTo(1, 7, 21_000, 1000),
	e(30_000, 'removebuff', LIGHTNING_SHIELD),
	e(32_000, 'cast', EARTH_SHOCK, { targetID: BOSS, targetInstance: 1 }),
	e(45_000, 'applybuff', LIGHTNING_SHIELD),
	...chargeTo(1, 5, 45_100, 100),
	e(45_999, 'removebuffstack', LIGHTNING_SHIELD, { stack: 1 }),
	e(46_000, 'cast', EARTH_SHOCK, { targetID: BOSS, targetInstance: 1 }),
	e(50_000, 'applybuffstack', LIGHTNING_SHIELD, { stack: 2 }),
];

const synthetic: FightDataset = {
	code: 'ele-ls',
	fight: {
		id: 7,
		name: 'Iron Qon',
		encounterID: 1662,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: T0 + DURATION,
	},
	actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
	actors: [
		{ id: ME, name: 'Sparkstorm', type: 'Player' },
		{ id: BOSS, name: 'Iron Qon', type: 'NPC', subType: 'Boss' },
	],
	// A Lava Burst so `identify` accepts the pull as Elemental at all.
	events: [...contact, e(500, 'cast', LAVA_BURST, { targetID: BOSS, targetInstance: 1 }), ...shieldEvents],
	table: {
		fight: {
			id: 7,
			name: 'Iron Qon',
			encounterID: 1662,
			kill: true,
			difficulty: 4,
			size: 25,
			startTime: T0,
			endTime: T0 + DURATION,
			enemyNPCs: [{ id: BOSS, gameID: 68_078 }],
		},
		damageDone: {
			entries: [
				{
					name: 'Sparkstorm',
					id: ME,
					type: 'Shaman',
					itemLevel: 553,
					total: 13_000,
					activeTime: DURATION,
					abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 13_000 }],
				},
			],
		},
	},
};

/**
 * Analysed at an explicit 1.5s grace rather than at whatever the setting currently defaults to.
 *
 * The two stretches below are 14s and 4s, and the second is the one the block exists for — that a
 * stretch's end is read from the counter rather than inferred from the next entry. At the 5s default
 * the 4s stretch is shorter than the grace and forgiven whole, so the claim becomes invisible and the
 * test would pass while measuring nothing. A synthetic fixture built around a duration should name the
 * duration it was built around; `overcapClock.test.ts` is where the default itself is pinned.
 */
const el = analyse(synthetic, {
	...defaultSettings(ELEMENTAL_SETTINGS),
	lightningShieldOvercapMs: 1500,
}) as Analysis & ElementalAuditResult;
const ls = el.lightningShield;

describe('what Fulmination leaves behind', () => {
	it('drains to one charge, not to none', () => {
		expect(ls.points).toContainEqual([19_999, 1]);
		expect(ls.points).toContainEqual([45_999, 1]);
	});

	it('does not count either drain as the shield coming off', () => {
		// The one fall-off on this pull is the `removebuff` at 30s, and nothing else.
		expect(ls.fellOff).toBe(1);
		expect(ls.downWindows).toEqual([{ start: 30_000, end: 45_000 }]);
	});

	it('reads the charge the press spent rather than the charge it left', () => {
		expect(el.earthShock.presses.map((p) => [p.t, p.lsStacks])).toEqual([
			[20_000, 7],
			[32_000, null],
			[46_000, 5],
		]);
	});

	/**
	 * A shock pressed with no shield at all is not a spend below the ceiling — it is a reading the log
	 * cannot give, and `null` is that answer rather than a zero that would sort as the worst spend of
	 * the pull.
	 */
	it('lists only the spend that really was below the ceiling', () => {
		expect(ls.badSpends).toEqual([{ t: 46_000, stacks: 5 }]);
		expect(el.earthShock.belowFull).toBe(1);
	});
});

describe('the ceiling across a stretch the shield was absent for', () => {
	/**
	 * Two stretches at seven — 6s to 19.999s and 26s to 30s — with the shield absent from 30s to 45s.
	 *
	 * The second is the one that matters. `atCapWindows` is handed the *stretches* rather than a point
	 * series precisely so it cannot infer a stretch's end from the next entry's start: the next entry
	 * after the ceiling at 26s is the re-application at 45s, so that inference would run the ceiling
	 * across the fifteen seconds the player had no shield to overcap and report 17.5s instead of 2.5s.
	 */
	it('closes each stretch where the counter actually left the ceiling', () => {
		expect(ls.overcapWindows).toEqual([
			{ start: 7500, end: 19_999 },
			{ start: 27_500, end: 30_000 },
		]);
		expect(ls.overcapMs).toBe(12_499 + 2500);
	});

	/** A stretch shorter than the grace is forgiven whole, rather than reported as a sliver. */
	it('forgives a stretch the grace covers entirely', () => {
		const loose = analyse(synthetic, {
			...defaultSettings(ELEMENTAL_SETTINGS),
			lightningShieldOvercapMs: 5000,
		}) as Analysis & ElementalAuditResult;
		// 13 999ms and 4 000ms at the ceiling: the first keeps 8 999ms, the second disappears.
		expect(loose.lightningShield.overcapWindows).toEqual([{ start: 11_000, end: 19_999 }]);
		expect(loose.lightningShield.overcapMs).toBe(8999);
	});
});
