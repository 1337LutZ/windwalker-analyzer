// Lava Burst and its two resets: the Lava Surge procs, and what makes a press free.
//
// The section answers the one question a cast count cannot — a surge that expired with no Lava Burst
// inside was a free cast thrown away — and the interesting half of that is the exception. A surge that
// runs out while the boss is submerged is the fight taking the cast back, not a cast the player threw
// away, and `a:qHRAFwdGzaB6MPYC` #14 carries exactly one of those: the pull's only unconsumed surge
// expires 14.9 seconds into the Iron Juggernaut's submerge.
//
// The synthetic pull underneath is for the other side of the same guard: an unconsumed surge that
// expired with the boss in reach, which is a real fault and has to be reported as one.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '../index';

const fx = (name: string): Analysis & ElementalAuditResult => {
	const dataset = JSON.parse(
		readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'),
	) as FightDataset;
	return analyse(dataset) as Analysis & ElementalAuditResult;
};

describe('a surge that expired while the boss was away', () => {
	const el = fx('phased');
	const { lavaBurst } = el;

	it('reads every proc the log carried', () => {
		expect(lavaBurst.procs).toHaveLength(18);
		expect(lavaBurst.presses).toHaveLength(49);
	});

	it('finds the one surge no Lava Burst was spent inside', () => {
		expect(lavaBurst.procs.filter((p) => !p.consumed)).toEqual([
			{ start: 146_591, end: 157_147, consumed: false, wasted: false },
		]);
	});

	/**
	 * The whole point of this fixture for this section.
	 *
	 * The submerge runs 142.3s to 192.5s off the player's own contact clock, and the surge expires at
	 * 157.1s — inside it, with nothing to cast at. `wasted` is `!consumed` **and** in contact, so the
	 * count is zero; without the contact half this pull would report a thrown-away free cast the player
	 * never had.
	 */
	it('does not charge the player for it', () => {
		expect(lavaBurst.wasted).toBe(0);
		const [before, after] = el.timeline?.contactSegments ?? [];
		expect(before?.[1]).toBe(142_282);
		expect(after?.[0]).toBe(192_534);
		expect(157_147).toBeGreaterThan(before?.[1] ?? 0);
		expect(157_147).toBeLessThan(after?.[0] ?? 0);
	});

	it('says which presses were free and which reset made them free', () => {
		expect(lavaBurst.presses.filter((p) => p.surge)).toHaveLength(23);
		expect(lavaBurst.presses.filter((p) => p.ascendance)).toHaveLength(23);
	});
});

describe('a pull that consumed every surge it was given', () => {
	const { lavaBurst } = fx('unbroken');

	it('has nothing to report', () => {
		expect(lavaBurst.procs).toHaveLength(20);
		expect(lavaBurst.procs.filter((p) => !p.consumed)).toEqual([]);
		expect(lavaBurst.wasted).toBe(0);
	});

	it('still counts the presses and their resets apart', () => {
		expect(lavaBurst.presses).toHaveLength(41);
		expect(lavaBurst.presses.filter((p) => p.surge)).toHaveLength(23);
		expect(lavaBurst.presses.filter((p) => p.ascendance)).toHaveLength(14);
	});
});

// ------------------------------------------------------------------ synthetic

const T0 = 400_000;
const DURATION = 120_000;
const ME = 2;
const BOSS = 12;

const LAVA_SURGE = 77_762;
const LAVA_BURST = 51_505;
const LIGHTNING_BOLT = 403;
const ASCENDANCE_CAST = 114_049;
const ASCENDANCE_BUFF = 114_050;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

const hit = (t: number): WclEvent =>
	e(t, 'damage', LIGHTNING_BOLT, { targetID: BOSS, targetInstance: 1, amount: 1000, hitType: 1 });

/**
 * Contact in two segments, with a forty-second hole in the middle.
 *
 * A hit every five seconds is well inside the 15s gap that splits one contact stretch from the next, so
 * the pull reads as `[0, 40s]` and `[80s, 120s]` — an intermission the player could not cast into.
 */
const contact: WclEvent[] = [
	...Array.from({ length: 9 }, (_, i) => hit(i * 5000)),
	...Array.from({ length: 9 }, (_, i) => hit(80_000 + i * 5000)),
];

/**
 * Three surges, one for each answer the section can give.
 *
 *   10-20s   a Lava Burst at 15s inside it — consumed
 *   25-35s   nothing inside it, and the boss in reach — wasted
 *   50-60s   nothing inside it, and the boss away — not the player's fault
 */
const surgeEvents: WclEvent[] = [
	e(10_000, 'applybuff', LAVA_SURGE),
	e(20_000, 'removebuff', LAVA_SURGE),
	e(25_000, 'applybuff', LAVA_SURGE),
	e(35_000, 'removebuff', LAVA_SURGE),
	e(50_000, 'applybuff', LAVA_SURGE),
	e(60_000, 'removebuff', LAVA_SURGE),
];

/** Ascendance, so a press inside its fifteen seconds can be told from a press inside a surge. */
const ascendanceEvents: WclEvent[] = [
	e(90_000, 'cast', ASCENDANCE_CAST),
	e(90_000, 'applybuff', ASCENDANCE_BUFF),
	e(105_000, 'removebuff', ASCENDANCE_BUFF),
];

const lavaBursts: WclEvent[] = [
	e(5000, 'cast', LAVA_BURST, { targetID: BOSS, targetInstance: 1 }),
	e(15_000, 'cast', LAVA_BURST, { targetID: BOSS, targetInstance: 1 }),
	e(95_000, 'cast', LAVA_BURST, { targetID: BOSS, targetInstance: 1 }),
];

const synthetic: FightDataset = {
	code: 'ele-lvb',
	fight: {
		id: 4,
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
	events: [...contact, ...surgeEvents, ...ascendanceEvents, ...lavaBursts],
	table: {
		fight: {
			id: 4,
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
					total: 18_000,
					activeTime: DURATION,
					abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 18_000 }],
				},
			],
		},
	},
};

const el = analyse(synthetic) as Analysis & ElementalAuditResult;

describe('the three things a surge can come to', () => {
	it('reads the pull the way it was built', () => {
		expect(el.isSpec).toBe(true);
		expect(el.timeline?.contactSegments).toEqual([
			[0, 40_000],
			[80_000, 120_000],
		]);
	});

	it('tells consumed, wasted and forgiven apart', () => {
		expect(el.lavaBurst.procs).toEqual([
			{ start: 10_000, end: 20_000, consumed: true, wasted: false },
			{ start: 25_000, end: 35_000, consumed: false, wasted: true },
			{ start: 50_000, end: 60_000, consumed: false, wasted: false },
		]);
	});

	/** One fault out of two unconsumed procs: the count is the faults, not the misses. */
	it('charges only the one the player could have taken', () => {
		expect(el.lavaBurst.wasted).toBe(1);
	});
});

describe('what made each press free', () => {
	it('names the reset behind every Lava Burst', () => {
		expect(el.lavaBurst.presses).toEqual([
			{ t: 5000, surge: false, ascendance: false },
			{ t: 15_000, surge: true, ascendance: false },
			{ t: 95_000, surge: false, ascendance: true },
		]);
	});
});
