// The Flame Shock dot walk, and the bug the Elemental audit inherited by being written from the
// Windwalker's.
//
// It cannot be checked against the reference pull: `rpM9JRABYcvPFbjL` f16 carries 390 debuff events
// for the whole fight and one for the shaman being audited, so `flameShock.uptimePct` reads zero
// there whatever the walk does. A synthetic pull is the only thing that can hold this fixed.
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '../index';

const T0 = 500_000;
const DURATION = 120_000;
const ME = 9;
/** One actor id, two spawns — the shape WarcraftLogs gives every add in a pack. */
const ADD = 40;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

const FLAME_SHOCK = 8050;
const LAVA_BURST = 51_505;
const LIGHTNING_BOLT = 403;

/** Contact every five seconds so the engaged clock is the whole pull. */
const contact: WclEvent[] = Array.from({ length: DURATION / 5000 + 1 }, (_, i) =>
	e(i * 5000, 'damage', LIGHTNING_BOLT, { targetID: ADD, targetInstance: 1, amount: 1000, hitType: 1 }),
);

/**
 * Two spawns of one add, each carrying the dot for a stretch, interleaved in time.
 *
 * Instance 1 holds it 0-30s and 60-90s; instance 2 holds it 20-50s. Bucketed per spawn that is 80s of
 * coverage on the enemy — 0-50s and 60-90s once merged. Bucketed by `targetID` alone the two streams
 * interleave: instance 2's apply at 20s arrives while instance 1's window is already open and is
 * dropped, and its remove at 50s closes instance 1's window instead. Measured against the old walk
 * rather than assumed: it reported `[{0, 30000}, {60000, 90000}]`, 60s and 50% uptime, against the
 * 80s and 66.7% the enemy actually carried — 20 seconds of coverage discarded on a two-spawn pull.
 */
const dotEvents: WclEvent[] = [
	e(1000, 'cast', FLAME_SHOCK, { targetID: ADD, targetInstance: 1 }),
	e(0, 'applydebuff', FLAME_SHOCK, { targetID: ADD, targetInstance: 1 }),
	e(30_000, 'removedebuff', FLAME_SHOCK, { targetID: ADD, targetInstance: 1 }),
	e(20_000, 'applydebuff', FLAME_SHOCK, { targetID: ADD, targetInstance: 2 }),
	e(50_000, 'removedebuff', FLAME_SHOCK, { targetID: ADD, targetInstance: 2 }),
	e(60_000, 'applydebuff', FLAME_SHOCK, { targetID: ADD, targetInstance: 1 }),
	e(90_000, 'removedebuff', FLAME_SHOCK, { targetID: ADD, targetInstance: 1 }),
];

const dataset: FightDataset = {
	code: 'ele999',
	fight: {
		id: 1,
		name: 'Iron Qon',
		encounterID: 1662,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: T0 + DURATION,
	},
	actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
	// The add is declared, and it has to be: `contact` — the clock the uptime share is measured against
	// — is built from hits on ids the actor list calls an NPC, so a pull that never declares its enemy
	// has an empty contact clock and any share of it is zero whatever the dot did. It was absent while
	// the share was measured against the primary target's `engaged` clock, which needs no actor list.
	actors: [
		{ id: ME, name: 'Sparkstorm', type: 'Player' },
		{ id: ADD, name: 'Quilen Guardian', type: 'NPC' },
	],
	// A Lava Burst so `identify` accepts the pull as Elemental at all.
	events: [...contact, ...dotEvents, e(2000, 'cast', LAVA_BURST, { targetID: ADD, targetInstance: 1 })],
	table: {
		fight: {
			id: 1,
			name: 'Iron Qon',
			encounterID: 1662,
			kill: true,
			difficulty: 4,
			size: 25,
			startTime: T0,
			endTime: T0 + DURATION,
			enemyNPCs: [{ id: ADD, gameID: 68_078 }],
		},
		damageDone: {
			entries: [
				{
					name: 'Sparkstorm',
					id: ME,
					type: 'Shaman',
					itemLevel: 553,
					total: 25_000,
					activeTime: DURATION,
					abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 25_000 }],
				},
			],
		},
	},
};

const el = analyse(dataset) as Analysis & ElementalAuditResult;

describe('the Flame Shock dot across two spawns of one add', () => {
	it('is read as Elemental at all', () => {
		expect(el.isSpec).toBe(true);
	});

	/**
	 * The regression. Bucketing by `targetID` alone drops instance 2's window and reports 60s; keyed by
	 * spawn the walk sees both streams and reports the 80s the enemy actually carried it.
	 */
	it('keeps the coverage a second spawn contributed', () => {
		expect(el.flameShock.windows).toEqual([
			{ start: 0, end: 50_000 },
			{ start: 60_000, end: 90_000 },
		]);
		expect(el.flameShock.uptimeMs).toBe(80_000);
	});

	/**
	 * And the share is **not** that 80s over the pull, which is the other half of the same split.
	 *
	 * This pinned 66.7% — the enemy's whole union of 80s against a 120s clock — while the share was
	 * `intersect(fsDot.merged, engaged) / engagedMs`, a union across every spawn of the id. It is now the
	 * dot on the spawn the player was demonstrably hitting, over the contact clock, and on this pull the
	 * player never once hit instance 2: every landed hit in the stream is on instance 1. So instance 2's
	 * 20–50s window is coverage on an enemy that was not in front of them, and 60s of the 80s is what
	 * the share can see — 50.0% of a 120 000ms contact clock.
	 *
	 * Which makes this pull a guard on the swap rather than a casualty of it. 66.7% and 50.0% are the
	 * union reading and the per-spawn reading of one event stream, and no clamp or rounding can make
	 * them agree: revert the numerator to `fsDot.merged` and this fails by 16.7 points.
	 *
	 * `windows` and `uptimeMs` above are untouched at 80s, deliberately — the lane is labelled with the
	 * enemy's name and that enemy did carry the dot for 80 seconds.
	 */
	it('measures the share over the spawn the player was actually hitting', () => {
		expect(el.timeline?.contactSegments).toEqual([[0, 120_000]]);
		expect(el.flameShock.scoredMs).toBe(120_000);
		expect(el.flameShock.uptimePct).toBeCloseTo((60_000 / 120_000) * 100, 6);
	});
});
