// The sim's Earth Shock rule has two branches, and the tier-16 two-piece proc picks which one applies.
//
// `Earth Shock Rules` in `ui/shaman/elemental/apls/p5.apl.json` is `OR(A, B)`. A opens with
// `NOT auraIsActive(144998)` and B opens with `auraIsActive(144998)`, so the branches are mutually
// exclusive on that one proc and a press is judged against exactly one of them:
//
//   A (proc down) — dot >= 6s, shield stacks >= 7, Ascendance >= 6s away.
//   B (proc up)   — shield stacks >= 7, `auraRemainingTime(144999) <= 4s`,
//                   dot >= 2 x `dotTickFrequency(8050)`.
//
// Only A was implemented, with the proc's window pushed as a fault reason full stop — so a shock fired
// exactly as B asks for it was reported as a shock spent early.
//
// **What the committed fixtures can and cannot show.** All three carry the two-piece debuff (144999,
// Elemental Discharge) and all three have Earth Shocks inside its windows, so the branch is exercised on
// real data — but not one of them has a shock taken in the last four seconds of a window *with the
// shield full*. `unbroken`'s press at 180 744 is the only one inside the four-second tail at all, and it
// spent two stacks, so it stays a fault on `belowFull`. `earthShockGood` therefore does not move on any
// of the three: the change is visible on real data only as that press's reason list, which is asserted
// below. The press that B actually rescues is on the synthetic pull at the bottom, and that is stated
// rather than dressed up as a real-log finding.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';

import { analyse } from '../index';
import { scoreAnalysis } from '../score';

const load = (name: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;

const analysed = (name: string): Analysis & ElementalAuditResult =>
	analyse(load(name)) as Analysis & ElementalAuditResult;

/** `earthShockGood` as the report grades it, in percent. */
const goodPct = (el: Analysis & ElementalAuditResult): number | null => {
	const metric = scoreAnalysis(el).sections['earthShock']?.metrics.find((m) => m.key === 'earthShockGood');
	if (metric === undefined) throw new Error('earthShockGood is not on the scorecard');
	return metric.value;
};

describe('the branch on the committed pulls', () => {
	const unbroken = analysed('unbroken');

	/**
	 * The window this rests on, read out of the fixture's own events rather than out of the audit.
	 *
	 * `unbroken` puts 144999 on the boss five times. The last window opens with `applydebuff` at 148 301
	 * and closes with `removedebuff` at 184 398 — the fight ends at 184 448, so that close is the boss
	 * dying rather than the proc expiring, and the press below is inside the tail for that reason and not
	 * because the player read the debuff. Which is exactly why nothing is credited on it.
	 */
	it('has one Earth Shock inside the last four seconds of a two-piece window, and no more', () => {
		const raw = load('unbroken');
		const t0 = raw.fight.startTime;
		const debuff = raw.events
			.filter((e: WclEvent) => e.abilityGameID === 144_999 && (e.type === 'applydebuff' || e.type === 'removedebuff'))
			.map((e: WclEvent) => [e.type, e.timestamp - t0]);
		expect(debuff).toContainEqual(['applydebuff', 148_301]);
		expect(debuff).toContainEqual(['removedebuff', 184_398]);
		expect(unbroken.durationMs).toBe(184_448);

		const inTail = unbroken.earthShock.presses.filter((p) => p.twoPiece && 184_398 - p.t <= 4000);
		expect(inTail.map((p) => p.t)).toEqual([180_744]);
	});

	/**
	 * The press's reason list, which is the whole of the real-data change.
	 *
	 * It used to read `belowFull, fsLow, ascReady, twoPiece` — four faults, three of them conditions of
	 * the branch that does not apply to it. The proc was up, so B is the branch: B does not ask about
	 * Ascendance at all, its dot floor is two tick periods rather than six seconds (the dot had 3 655ms
	 * against a measured cadence of about 1 730), and the proc's own window is a reason only outside its
	 * last four seconds. What is left is the one thing that was actually wrong — the shock spent two
	 * stacks of a seven-stack shield.
	 */
	it('faults that press on the shield alone, not on three conditions of the other branch', () => {
		const press = unbroken.earthShock.presses.find((p) => p.t === 180_744);
		expect(press?.lsStacks).toBe(2);
		expect(press?.fsRemainingMs).toBe(3655);
		expect(press?.twoPiece).toBe(true);
		expect(press?.reasons).toEqual(['belowFull']);
		expect(press?.good).toBe(false);
	});

	/**
	 * And the graded figure does not move on any of the three, which is the honest report of this change.
	 *
	 * Every other in-window press sits 9 to 26 seconds from its window's end, so `twoPiece` is still the
	 * right fault for all of them. The branch can only ever excuse a press — it drops one of A's
	 * conditions and loosens another — so a figure that had moved could only have moved up.
	 */
	it('moves earthShockGood on none of the three pulls', () => {
		expect(goodPct(unbroken)).toBeCloseTo(38.4615, 3);
		expect(goodPct(analysed('cleave'))).toBeCloseTo(41.6667, 3);
		expect(goodPct(analysed('phased'))).toBeCloseTo(41.6667, 3);
	});
});

// ------------------------------------------------------------------ synthetic
//
// The pull no real log in this repository holds: a shock taken in the last four seconds of a two-piece
// window with the shield at its ceiling, which is the press branch B exists to allow.
//
// The shield is charged to seven and left there — no drain is emitted — so every press below sees the
// same seven charges and `belowFull` cannot confound the branch under test. Ascendance goes down at 1s
// so its 180s clock keeps `ascReady` off every press: without a cast the button reads as never pressed,
// which the audit scores as "ready now" and would push onto all of them.

const T0 = 900_000;
const DURATION = 60_000;
const ME = 5;
const BOSS = 12;

const LIGHTNING_SHIELD = 324;
const LIGHTNING_BOLT = 403;
const FLAME_SHOCK = 8050;
const EARTH_SHOCK = 8042;
const ASCENDANCE = 114_049;
const LAVA_BURST = 51_505;
/** Elemental Discharge — the debuff the tier-16 two-piece proc leaves, and the id a log actually writes. */
const T16_2PC = 144_999;
/** The cadence the ticks below are emitted at, so `2 x tickMs` is 3 000ms and can be aimed at. */
const TICK_MS = 1500;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

const onBoss = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent =>
	e(t, type, id, { targetID: BOSS, targetInstance: 1, ...extra });

/** A hit every two seconds, so the engaged clock is the whole pull with no forgiven gap in it. */
const contact: WclEvent[] = Array.from({ length: DURATION / 2000 + 1 }, (_, i) =>
	onBoss(i * 2000, 'damage', LIGHTNING_BOLT, { amount: 1000, hitType: 1 }),
);

/** Seven charges by 6s, and nothing takes them away again. */
const shield: WclEvent[] = [
	e(0, 'applybuff', LIGHTNING_SHIELD),
	...Array.from({ length: 6 }, (_, i) => e(1000 + i * 1000, 'applybuffstack', LIGHTNING_SHIELD, { stack: 2 + i })),
];

/**
 * The dot up from the bell to 45s, ticking every 1 500ms — then down for the rest of the pull.
 *
 * The tail matters: the press at 53s lands with the dot off the target, which is what makes `fsTail`
 * reachable while the proc's own four-second condition is satisfied.
 */
const dot: WclEvent[] = [
	onBoss(0, 'applydebuff', FLAME_SHOCK),
	...Array.from({ length: 45_000 / TICK_MS - 1 }, (_, i) =>
		onBoss((i + 1) * TICK_MS, 'damage', FLAME_SHOCK, { tick: true, amount: 1000, unmitigatedAmount: 900, hitType: 1 }),
	),
	onBoss(45_000, 'removedebuff', FLAME_SHOCK),
];

/** Two proc windows: a fourteen-second one while the dot is up, and a six-second one after it drops. */
const twoPiece: WclEvent[] = [
	onBoss(10_000, 'applydebuff', T16_2PC),
	onBoss(24_000, 'removedebuff', T16_2PC),
	onBoss(50_000, 'applydebuff', T16_2PC),
	onBoss(56_000, 'removedebuff', T16_2PC),
];

/**
 * Four shocks, one per case.
 *
 *   14s  proc up with 10s left on it — too soon, `twoPiece`.
 *   21s  proc up with 3s left, shield full, dot 24s — **the press branch B allows**.
 *   30s  proc down, dot 15s, Ascendance far away — branch A, and good.
 *   53s  proc up with 3s left, but the dot is off the target — `fsTail`.
 */
const presses: WclEvent[] = [
	e(1000, 'cast', ASCENDANCE),
	// One Lava Burst so the pull is recognised as Elemental at all — the spec test looks for the rotation
	// and a stream of Lightning Bolts alone is not one.
	onBoss(3000, 'cast', LAVA_BURST),
	onBoss(14_000, 'cast', EARTH_SHOCK),
	onBoss(21_000, 'cast', EARTH_SHOCK),
	onBoss(30_000, 'cast', EARTH_SHOCK),
	onBoss(53_000, 'cast', EARTH_SHOCK),
];

const fight = {
	id: 1,
	name: 'Iron Qon',
	encounterID: 1662,
	kill: true,
	difficulty: 4,
	size: 25,
	startTime: T0,
	endTime: T0 + DURATION,
};

const dataset: FightDataset = {
	code: 'ele997',
	fight,
	actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
	actors: [{ id: ME, name: 'Sparkstorm', type: 'Player' }],
	events: [...contact, ...shield, ...dot, ...twoPiece, ...presses],
	table: {
		fight: { ...fight, enemyNPCs: [{ id: BOSS, gameID: 68_078 }] },
		damageDone: {
			entries: [
				{
					name: 'Sparkstorm',
					id: ME,
					type: 'Shaman',
					itemLevel: 553,
					total: 31_000,
					activeTime: DURATION,
					abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 31_000 }],
				},
			],
		},
	},
};

describe('a shock taken in the tail of a two-piece window', () => {
	const el = analyse(dataset) as Analysis & ElementalAuditResult;

	it('sets the pull up the way the branch needs it', () => {
		expect(el.isSpec).toBe(true);
		expect(el.earthShock.presses.map((p) => p.t)).toEqual([14_000, 21_000, 30_000, 53_000]);
		// Seven charges under every press, so nothing below can be explained by the shield.
		expect(el.earthShock.presses.map((p) => p.lsStacks)).toEqual([7, 7, 7, 7]);
		expect(el.earthShock.presses.map((p) => p.twoPiece)).toEqual([true, true, false, true]);
	});

	/**
	 * The press the change exists for: proc up, 3 000ms left on it, shield full, dot 24s.
	 *
	 * Under the old rule this read `twoPiece` and was charged against `earthShockGood` — a shock fired
	 * exactly as the list's second branch asks for it, reported as a shock spent early.
	 */
	it('is the press the list asked for, and carries no reason', () => {
		const press = el.earthShock.presses.find((p) => p.t === 21_000);
		expect(press?.fsRemainingMs).toBe(24_000);
		expect(press?.reasons).toEqual([]);
		expect(press?.good).toBe(true);
	});

	/** Ten seconds from the window's end is still too soon, which is the half of the rule that stands. */
	it('still faults a shock taken too early in the same window', () => {
		const press = el.earthShock.presses.find((p) => p.t === 14_000);
		expect(press?.reasons).toEqual(['twoPiece']);
		expect(press?.good).toBe(false);
	});

	/** The other branch is untouched: proc down, dot up, Ascendance held. */
	it('leaves a press outside every window on the first branch', () => {
		const press = el.earthShock.presses.find((p) => p.t === 30_000);
		expect(press?.twoPiece).toBe(false);
		expect(press?.fsRemainingMs).toBe(15_000);
		expect(press?.reasons).toEqual([]);
	});

	/**
	 * The branch's own dot floor, which is two of the press's *measured* tick periods and not six seconds.
	 *
	 * The dot is emitted at 1 500ms, so the floor is 3 000ms — a number `ES_FS_MIN_MS` could not produce.
	 * This press has nothing on the target at all, so it fails the floor and reports `fsTail` rather than
	 * `fsLow`: the row has to say which test it failed, because the two are 3 000ms apart.
	 */
	it('names the two-tick floor rather than the six-second one', () => {
		const press = el.earthShock.presses.find((p) => p.t === 53_000);
		const tickMs = el.flameShock.presses.length > 0 ? el.flameShock.tickMs : TICK_MS;
		expect(tickMs).toBeCloseTo(TICK_MS, 0);
		expect(press?.fsRemainingMs).toBe(0);
		expect(press?.reasons).toEqual(['fsTail']);
	});

	/** Two of the four, and the two that pass are one from each branch. */
	it('grades two of the four good', () => {
		expect(el.earthShock.good).toBe(2);
		expect(goodPct(el)).toBeCloseTo(50, 3);
	});
});
