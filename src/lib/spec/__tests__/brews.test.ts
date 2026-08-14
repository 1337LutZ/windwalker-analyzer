// The two brew questions the engine gained, both against synthetic events rather than a fixture.
//
// Neither behaviour appears in a committed fixture at all: none of the three captured pulls presses
// Energizing Brew under a haste cooldown *and* has Rushing Jade Wind in the build, and none of them
// overlaps a Touch of Karma with a Fortifying Brew. A fixture cannot test a case it does not
// contain, so the events are built here — the same approach `analysis/__tests__/gear.test.ts` takes
// for an unenchanted slot no raider in the sample was ever missing.

import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import type { FightDataset } from '~/lib/types';

import { analyse } from '../windwalker';

const T0 = 100000;
const DURATION = 120000;
const ME = 5;
const BOSS = 20;
/** Someone else's actor id, so an external Bloodlust is not mistaken for a self-buff. */
const SHAMAN = 9;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

/**
 * The minimum that makes a pull readable: a Tigereye Brew bank, which is what `analyse` recognises
 * the spec by, and one hit on the boss so there is a primary target to measure concentration against.
 */
const baseline: WclEvent[] = [
	e(0, 'applybuff', 1247279),
	e(1000, 'applybuffstack', 1247279, { stack: 10 }),
	e(1000, 'damage', 1, { targetID: BOSS, amount: 10000, hitType: 1 }),
];

const dataset = (events: WclEvent[]): FightDataset => ({
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
	events: [...baseline, ...events],
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

/** One Energizing Brew: the press, and the six-second buff the sim gives it. */
const energizingBrew = (t: number): WclEvent[] => [
	e(t, 'applybuff', 115288),
	e(t, 'cast', 115288, { targetID: -1 }),
	e(t + 6000, 'removebuff', 115288),
];

/** The raid's haste cooldown, cast by someone else onto the player — which is how a log carries it. */
const timeWarp = (start: number, end: number): WclEvent[] => [
	e(start, 'applybuff', 80353, { sourceID: SHAMAN }),
	e(end, 'removebuff', 80353, { sourceID: SHAMAN }),
];

/** One Fists of Fury channel and its four ticks, which is what the channel length is measured from. */
const fistsOfFury = (t: number): WclEvent[] => [
	e(t, 'cast', 113656, { targetID: BOSS }),
	...[0, 1000, 2000, 3000].map((offset) => e(t + offset, 'cast', 117418, { targetID: BOSS })),
];

/** The press, the twenty-second buff it applies, and the id split between the two. */
const fortifyingBrew = (t: number): WclEvent[] => [
	e(t, 'cast', 115203, { targetID: -1 }),
	e(t, 'applybuff', 120954),
	e(t + 20000, 'removebuff', 120954),
];

/** A Touch of Karma that redirected something, so the use is not read as a press into a quiet stretch. */
const touchOfKarma = (t: number): WclEvent[] => [
	e(t, 'cast', 122470, { targetID: BOSS }),
	e(t + 3000, 'damage', 124280, { targetID: BOSS, amount: 50000, hitType: 1 }),
];

describe('Energizing Brew', () => {
	it('reports uptime and the uses the cooldown allowed', () => {
		const a = analyse(dataset([...energizingBrew(10000), ...energizingBrew(80000)]));

		expect(a.energizing?.casts).toBe(2);
		// Two minutes on a one-minute cooldown: the opener plus two recharges.
		expect(a.energizing?.available).toBe(3);
		expect(a.energizing?.uptimeMs).toBe(12000);
		expect(a.energizing?.uptimePct).toBeCloseTo(10, 5);
		expect(a.energizing?.uses[0]?.lengthMs).toBe(6000);
		// The energy half of the APL condition is unreadable, and the audit has to keep saying so.
		expect(a.energizing?.energyCheckable).toBe(false);
	});

	/**
	 * The priority list's condition, and the only half of it a log can answer:
	 * `Bloodlust inactive OR (Rushing Jade Wind known AND numberTargets >= 2)`. With no Rushing Jade
	 * Wind pressed anywhere in the pull the exception is simply not available, so the press is one the
	 * APL would not have made.
	 */
	it('faults a press under a haste cooldown when Rushing Jade Wind is not in the build', () => {
		const a = analyse(dataset([...timeWarp(5000, 45000), ...energizingBrew(10000)]));

		expect(a.energizing?.duringHaste).toBe(1);
		expect(a.energizing?.faulted).toBe(1);
		expect(a.energizing?.rushingJadeWind).toBe(false);
		expect(a.energizing?.uses[0]?.haste).toBe('Time Warp');
		expect(a.energizing?.uses[0]?.faults[0]).toContain('Time Warp');
		expect(a.misses.some((m) => m.kind === 'Energizing Brew held through')).toBe(true);
	});

	/** The exception in full: Rushing Jade Wind in the build and the damage spread across enemies. */
	it('allows a press under a haste cooldown when both halves of the exception hold', () => {
		const a = analyse(
			dataset([
				...timeWarp(5000, 45000),
				...energizingBrew(10000),
				e(2000, 'cast', 116847),
				// An even split, so the pull reads as multi-target rather than as one enemy plus strays.
				e(3000, 'damage', 148187, { targetID: BOSS, amount: 20000, hitType: 1 }),
				e(3000, 'damage', 148187, { targetID: 21, amount: 20000, hitType: 1 }),
			]),
		);

		expect(a.debuff.singleTarget).toBe(false);
		expect(a.energizing?.rushingJadeWind).toBe(true);
		expect(a.energizing?.duringHaste).toBe(1);
		expect(a.energizing?.faulted).toBe(0);
	});

	/** Half the exception is not the exception: on one target the APL holds the brew regardless. */
	it('still faults it on a single target even with Rushing Jade Wind in the build', () => {
		const a = analyse(dataset([...timeWarp(5000, 45000), ...energizingBrew(10000), e(2000, 'cast', 116847)]));

		expect(a.debuff.singleTarget).toBe(true);
		expect(a.energizing?.rushingJadeWind).toBe(true);
		expect(a.energizing?.faulted).toBe(1);
		expect(a.energizing?.uses[0]?.faults[0]).toContain('more than one');
	});

	it('says nothing about a press with no haste cooldown running', () => {
		const a = analyse(dataset([...timeWarp(60000, 90000), ...energizingBrew(10000)]));

		expect(a.energizing?.uses[0]?.haste).toBeNull();
		expect(a.energizing?.faulted).toBe(0);
	});

	/**
	 * The two sections must not be able to disagree: the channel audit already faults a Fists of Fury
	 * channelled through Energizing Brew with no Rushing Jade Wind covering it, and this counts the
	 * same channels from the other side. Counting them twice in the miss ledger would be the bug.
	 */
	it('counts the channels inside it exactly as the channel audit does', () => {
		const a = analyse(dataset([...energizingBrew(10000), ...fistsOfFury(11000)]));

		expect(a.channel.castList[0]?.energizingBrew).toBe(true);
		expect(a.energizing?.channelsInside).toBe(1);
		expect(a.energizing?.channelsCovered).toBe(0);
		expect(a.energizing?.uses[0]?.channels).toBe(1);
		expect(a.misses.filter((m) => m.at === 11000)).toHaveLength(1);
	});
});

/**
 * Touch of Karma with Fortifying Brew.
 *
 * The overlap is detected and nothing more is claimed about it. Fortifying Brew raises maximum health
 * a fifth and cuts damage taken a fifth (`sim/monk/fortifying_brew.go`), so it lifts the ceiling on
 * the redirect and slows what fills it at the same time — and Touch of Karma is not in the simulator
 * at all, so nothing there can settle which of the two wins. See the engine for the full reasoning.
 */
describe('Touch of Karma with Fortifying Brew', () => {
	it('flags a use that ran under Fortifying Brew', () => {
		const a = analyse(dataset([...fortifyingBrew(20000), ...touchOfKarma(22000)]));

		expect(a.karma.casts).toBe(1);
		expect(a.karma.withFortifyingBrew).toBe(1);
		expect(a.karma.uses[0]?.fortifyingBrew).toBe(true);
	});

	it('leaves a use with no Fortifying Brew anywhere near it alone', () => {
		const a = analyse(dataset([...fortifyingBrew(20000), ...touchOfKarma(80000)]));

		expect(a.karma.withFortifyingBrew).toBe(0);
		expect(a.karma.uses[0]?.fortifyingBrew).toBe(false);
	});

	/**
	 * The overlap is measured against the redirect's real ten seconds, never against `KARMA_WINDOW_MS`.
	 * That window is 20s on purpose — redirect ticks run past the advertised duration and every tick
	 * has to find an owner — but a Fortifying Brew pressed fifteen seconds after the Karma overlapped
	 * nothing, and reusing the attribution window here would call it a pairing.
	 */
	it('does not count a Fortifying Brew that went up after the redirect finished', () => {
		const a = analyse(dataset([...touchOfKarma(20000), ...fortifyingBrew(35000)]));

		expect(a.karma.withFortifyingBrew).toBe(0);
		expect(a.karma.uses[0]?.fortifyingBrew).toBe(false);
	});
});
