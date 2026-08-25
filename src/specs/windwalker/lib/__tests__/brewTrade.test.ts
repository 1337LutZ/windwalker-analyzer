// Brewing early against holding for the last global, priced both ways.
//
// The decision this covers appears in none of the three committed fixtures: on all of them the bank
// had room during every proc, so holding cost nothing and every early brew was simply early. A
// fixture cannot test a case it does not contain, so the events are built here — the same approach
// `analysis/__tests__/gear.test.ts` takes for an unenchanted slot no raider in the sample was
// missing, and `spec/__tests__/brews.test.ts` takes for a Fortifying Brew nobody overlapped.
//
// The stack gains below are faster than a real chi rotation produces. That is deliberate and does
// not weaken the tests: what is being pinned is which side of the break-even the engine lands on,
// and the only way to put a pull on the protected side is to give it a bank filling faster than the
// tail it is protecting is worth.

import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import { scoreAnalysis } from '~/specs/windwalker/lib/score';
import type { FightDataset } from '~/lib/types';

import { analyse } from '../index';

const T0 = 100000;
const DURATION = 120000;
const ME = 5;
const BOSS = 20;

/** The Rune of Re-Origination's Mastery conversion — one of the three ids the proc arrives under. */
const RE_ORIGINATION_MASTERY = 139120;
const BANK = 1247279;
const BREW = 1247275;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

/** One hit on the boss, so the pull has a primary target to measure concentration against. */
const hit = e(500, 'damage', 1, { targetID: BOSS, amount: 10000, hitType: 1 });

/** A ten-second Re-Origination proc. */
const proc = (t: number): WclEvent[] => [
	e(t, 'applybuff', RE_ORIGINATION_MASTERY),
	e(t + 10000, 'removebuff', RE_ORIGINATION_MASTERY),
];

/**
 * One brew: the bank drain that pays for it, and the fifteen-second buff it opens.
 *
 * The drain is stamped a millisecond before the buff, which is what a real log does and what the
 * drain-to-window pairing is built around.
 */
const brew = (t: number, leaving: number): WclEvent[] => [
	e(t, 'removebuffstack', BANK, { stack: leaving }),
	e(t + 1, 'applybuff', BREW),
	e(t + 15000, 'removebuff', BREW),
];

/** The bank climbing one stack at a time, one point per second from `t`. */
const gains = (t: number, from: number, count: number): WclEvent[] =>
	Array.from({ length: count }, (_, i) => e(t + i * 1000, 'applybuffstack', BANK, { stack: from + i + 1 }));

const dataset = (events: WclEvent[], combatantInfo: Record<string, unknown> = {}): FightDataset => ({
	code: 'abc123',
	fight: {
		id: 7,
		name: 'Garrosh Hellscream',
		encounterID: 1623,
		kill: true,
		difficulty: 4,
		size: 10,
		startTime: T0,
		endTime: T0 + DURATION,
	},
	actor: { id: ME, name: 'Bigdogmo', type: 'Player' },
	actors: [{ id: ME, name: 'Bigdogmo', type: 'Player' }],
	events: [
		hit,
		{
			timestamp: T0,
			type: 'combatantinfo',
			sourceID: ME,
			gear: [],
			...combatantInfo,
		} as unknown as WclEvent,
		...events,
	],
	table: {
		fight: {
			id: 7,
			name: 'Garrosh Hellscream',
			encounterID: 1623,
			kill: true,
			difficulty: 4,
			size: 10,
			startTime: T0,
			endTime: T0 + DURATION,
			enemyNPCs: [{ id: BOSS, gameID: 71865 }],
		},
		damageDone: {
			entries: [{ name: 'Bigdogmo', id: ME, type: 'Monk', total: 10000, activeTime: DURATION }],
		},
	},
});

describe('brewing early against holding', () => {
	/**
	 * The case the report used to have no correct answer for.
	 *
	 * The bank is full when the proc lands. Brewing four seconds in gives up six seconds of tail on a
	 * ten-stack brew — sixty stack-seconds. Holding would have pushed five gains past the cap, and a
	 * stack is one stack amplifying a later brew for its whole fifteen seconds, so the wait costs
	 * seventy-five. Holding is the more expensive move, so the early brew is not a mistake.
	 */
	it('does not fault an early brew that a full bank paid for', () => {
		const a = analyse(
			dataset([
				e(0, 'applybuff', BANK),
				e(1000, 'applybuffstack', BANK, { stack: 20 }),
				...proc(30000),
				...brew(34000, 10),
				...gains(35000, 10, 5),
			]),
		);

		const w = a.procs.windows[0];
		expect(w?.grade).toBe('early');
		expect(w?.remainingMs).toBe(6000);
		expect(w?.snapshotStacks).toBe(10);
		expect(w?.earlyCostStackSec).toBe(60);
		expect(w?.holdStacksLost).toBe(5);
		expect(w?.holdCostStackSec).toBe(75);
		expect(w?.protectedBrew).toBe(true);
		expect(a.procs.protectedEarly).toBe(1);
		// Still counted as early — the measurement does not move, only the verdict on it.
		expect(a.procs.early).toBe(1);
		// And so it is not on the list of things that went wrong.
		expect(a.misses.some((m) => m.kind.startsWith('Snapshot too early'))).toBe(false);
	});

	/**
	 * The other direction, and the one that must keep working: with room in the bank, nothing was
	 * being protected and an early brew is exactly what it looks like.
	 */
	it('still faults an early brew at a bank with room', () => {
		const a = analyse(
			dataset([
				e(0, 'applybuff', BANK),
				e(1000, 'applybuffstack', BANK, { stack: 8 }),
				...proc(30000),
				...brew(34000, 0),
				...gains(35000, 0, 2),
			]),
		);

		const w = a.procs.windows[0];
		expect(w?.grade).toBe('early');
		expect(w?.snapshotStacks).toBe(8);
		expect(w?.earlyCostStackSec).toBe(48);
		// Two gains onto a bank of eight fit with room to spare, so waiting would have cost nothing.
		expect(w?.holdStacksLost).toBe(0);
		expect(w?.holdCostStackSec).toBe(0);
		expect(w?.protectedBrew).toBe(false);
		expect(a.procs.protectedEarly).toBe(0);
		expect(a.misses.some((m) => m.kind.startsWith('Snapshot too early'))).toBe(true);
	});

	/** A brew held to the last global gave nothing up, so there is no trade to price and none is claimed. */
	it('prices nothing on a brew that was held to the last global', () => {
		const a = analyse(
			dataset([
				e(0, 'applybuff', BANK),
				e(1000, 'applybuffstack', BANK, { stack: 20 }),
				...proc(30000),
				...brew(39800, 10),
			]),
		);

		expect(a.procs.windows[0]?.grade).toBe('last-gcd');
		expect(a.procs.windows[0]?.protectedBrew).toBe(false);
	});

	/** A proc nobody brewed on had no decision in it, so both costs are absent rather than zero. */
	it('leaves both costs null on a proc no brew was spent on', () => {
		const a = analyse(
			dataset([e(0, 'applybuff', BANK), e(1000, 'applybuffstack', BANK, { stack: 20 }), ...proc(30000)]),
		);

		expect(a.procs.windows[0]?.grade).toBe('none');
		expect(a.procs.windows[0]?.earlyCostStackSec).toBeNull();
		expect(a.procs.windows[0]?.holdCostStackSec).toBeNull();
	});
});

describe('stacks lost at the cap while holding', () => {
	/**
	 * The mirror image of the test above. Here the player *did* hold, and the bank capped while they
	 * waited. Brewing at that instant would have given up eight seconds of a ten-stack brew — eighty
	 * stack-seconds against the fifteen the stack was worth — so the stack was correctly spent, and
	 * charging for it is what used to leave a full bank with no move the report called right.
	 */
	it('forgives a stack lost while holding a brew for a proc', () => {
		const a = analyse(
			dataset([
				e(0, 'applybuff', BANK),
				e(1000, 'applybuffstack', BANK, { stack: 20 }),
				...proc(30000),
				e(32000, 'refreshbuff', BANK),
				...brew(39800, 10),
			]),
		);

		expect(a.brew.wastedAtCap).toBe(1);
		expect(a.brew.wastedProtecting).toBe(1);
		// Nothing avoidable is left, so the metric grades clean while the total is still reported.
		const cap = scoreAnalysis(a).sections.brew?.metrics.find((m) => m.key === 'brewCapWaste');
		expect(cap?.value).toBe(0);
		expect(cap?.grade).toBe('good');
	});

	/** A bank simply left full is untouched by any of this: no proc was running, so nothing was bought. */
	it('still charges a stack lost with no proc running', () => {
		const a = analyse(
			dataset([e(0, 'applybuff', BANK), e(1000, 'applybuffstack', BANK, { stack: 20 }), e(60000, 'refreshbuff', BANK)]),
		);

		expect(a.brew.wastedAtCap).toBe(1);
		expect(a.brew.wastedProtecting).toBe(0);
		// One stack of the 21 this synthetic bank earned, as a share: the metric grades the leak against
		// `stacksGained` rather than counting stacks. The count itself is asserted above it.
		expect(scoreAnalysis(a).sections.brew?.metrics.find((m) => m.key === 'brewCapWaste')?.value).toBeCloseTo(4.762, 3);
	});
});

/**
 * Mastery, which decides what either side of the trade is worth *in damage* and nothing else.
 *
 * `sim/monk/windwalker/tigereye_brew.go:52` reads `0.05 + ww.getMasteryPercent()` once when the buff
 * goes up, and `sim/monk/windwalker/windwalker.go:88` makes that `(8 + rating / 600) * 0.002`.
 */
describe('per-stack damage from mastery', () => {
	const pull = (info: Record<string, unknown>) =>
		analyse(dataset([e(0, 'applybuff', BANK), e(1000, 'applybuffstack', BANK, { stack: 20 })], info));

	it('reads the rating through the simulator conversion', () => {
		// 7200 rating is 12 mastery points, so (8 + 12) * 0.002 = 0.04 on top of the flat 0.05.
		expect(pull({ mastery: 7200 }).brew.damagePerStack).toBeCloseTo(0.09, 10);
	});

	/**
	 * The answer on every Mists Classic report checked. `mastery` comes back as `0` beside believable
	 * crit and haste ratings, and a plausible substitute would be a number from this codebase rather
	 * than from the pull — so the report says it cannot say.
	 */
	it('cannot say when the log reported no rating', () => {
		expect(pull({ mastery: 0 }).brew.damagePerStack).toBeNull();
		expect(pull({}).brew.damagePerStack).toBeNull();
	});
});
