// The cast timeline the report draws: every press on one clock, with the aura rows underneath.
//
// Synthetic events rather than a fixture, for the reason the gear suite gives: the cases that matter
// here — one button logged under two ids, a channel's ticks, an aura that never went up — are things
// a real pull either buries among four hundred other events or does not contain at all.

import { describe, expect, it } from 'vitest';

import type { FightDataset, WclEvent } from '~/lib/types';

import { analyse } from '../windwalker';

const T0 = 100_000;
const END = T0 + 120_000;
const ME = 5;
const BOSS = 20;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

const events: WclEvent[] = [
	// The Tigereye Brew bank, which is the only tell that this player was Windwalker at all.
	e(0, 'applybuff', 1247279),
	e(1000, 'applybuffstack', 1247279, { stack: 10 }),

	// Rising Sun Kick, applied twice with the second application starting where the first ended: the
	// debuff row must show that as one continuous bar, not two.
	e(1000, 'cast', 107428, { targetID: BOSS }),
	e(1000, 'applydebuff', 130320, { targetID: BOSS }),
	e(16000, 'removedebuff', 130320, { targetID: BOSS }),
	e(16000, 'applydebuff', 130320, { targetID: BOSS }),
	e(30000, 'removedebuff', 130320, { targetID: BOSS }),
	e(1000, 'damage', 107428, { targetID: BOSS, amount: 50_000, hitType: 2 }),

	// Jab, once under each of two weapon ids. One button, and the icon has to be Jab's.
	e(5000, 'cast', 115687, { targetID: BOSS }),
	e(6500, 'cast', 115695, { targetID: BOSS }),

	// Tiger Palm, and the buff it puts up.
	e(8000, 'cast', 100787, { targetID: BOSS }),
	e(8001, 'applybuff', 125359),
	e(28000, 'removebuff', 125359),

	// Fists of Fury: one press, four ticks that also log as casts under the tick's own id.
	e(10000, 'cast', 113656, { targetID: BOSS }),
	e(10000, 'cast', 117418, { targetID: BOSS }),
	e(11000, 'cast', 117418, { targetID: BOSS }),
	e(12000, 'cast', 117418, { targetID: BOSS }),
	e(13000, 'cast', 117418, { targetID: BOSS }),

	// A Re-Origination proc, and the off-GCD brew spent inside it.
	e(20000, 'applybuff', 139120),
	e(29999, 'removebuffstack', 1247279, { stack: 0 }),
	e(30000, 'cast', 1247275),
	e(30000, 'applybuff', 1247275),
	e(30000, 'removebuff', 139120),
	e(45000, 'removebuff', 1247275),
];

const dataset: FightDataset = {
	code: 'abc123',
	fight: {
		id: 7,
		name: 'Garrosh Hellscream',
		encounterID: 1623,
		kill: true,
		difficulty: 4,
		size: 10,
		startTime: T0,
		endTime: END,
	},
	actor: { id: ME, name: 'Bigdogmo', type: 'Player' },
	actors: [{ id: ME, name: 'Bigdogmo', type: 'Player' }],
	events,
	table: {
		fight: {
			id: 7,
			name: 'Garrosh Hellscream',
			encounterID: 1623,
			kill: true,
			difficulty: 4,
			size: 10,
			startTime: T0,
			endTime: END,
			enemyNPCs: [{ id: BOSS, gameID: 71_865 }],
		},
		damageDone: {
			entries: [
				{
					name: 'Bigdogmo',
					id: ME,
					type: 'Monk',
					itemLevel: 553,
					total: 50_000,
					activeTime: 100_000,
					abilities: [{ guid: 107428, name: 'Rising Sun Kick', total: 50_000 }],
				},
			],
		},
	},
};

const analysis = analyse(dataset);
const timeline = analysis.timeline;
const laneOf = (key: string) => timeline?.lanes.find((l) => l.key === key);

describe('the cast timeline', () => {
	it('is emitted at all', () => {
		expect(timeline).toBeDefined();
	});

	/** A timeline is read left to right; a stream in per-ability order would draw the same marks and
	 * be useless to anything that walks it. */
	it('lists every press in time order', () => {
		const times = timeline?.casts.map((c) => c.t) ?? [];
		expect(times).toEqual([...times].sort((a, b) => a - b));
		expect(times).toEqual([1000, 5000, 6500, 8000, 10000, 30000]);
	});

	/**
	 * The whole reason a mark carries an id rather than a name: it is what resolves the icon. Jab logs
	 * a different id per weapon type and those ids carry the *weapon's* icon, so taking whichever the
	 * log used first would draw a monk's Jabs as axes or swords depending on what they equipped.
	 */
	it("draws both of Jab's weapon ids as Jab", () => {
		const jabs = timeline?.casts.filter((c) => c.name === 'Jab') ?? [];
		expect(jabs).toHaveLength(2);
		expect(jabs.map((c) => c.id)).toEqual([100780, 100780]);
	});

	/** A tick is not a press. Four of them would put three Fists of Fury on the lane that never were. */
	it('does not mistake a channel tick for a cast', () => {
		expect(timeline?.casts.filter((c) => c.id === 117418)).toEqual([]);
		expect(timeline?.casts.filter((c) => c.name === 'Fists of Fury')).toHaveLength(1);
	});

	/**
	 * An off-GCD press drawn at the weight of a global claims a global was spent. The brew is the case
	 * that matters — it goes out mid-rotation and costs nothing.
	 */
	it('says which presses cost a global', () => {
		expect(timeline?.casts.find((c) => c.name === 'Tigereye Brew')?.onGcd).toBe(false);
		expect(timeline?.casts.find((c) => c.name === 'Tiger Palm')?.onGcd).toBe(true);
	});

	/** The lane list is the report's own windows, so it cannot show a different pull to the sections. */
	it('agrees with the metrics it is drawn from', () => {
		expect(laneOf('tigereye-brew')?.windows).toEqual(analysis.brew.windows);
		expect(laneOf('re-origination')?.windows.map((w) => [w.start, w.end])).toEqual(
			analysis.procs.windows.map((w) => [w.start, w.end]),
		);
		expect(laneOf('rising-sun-kick-debuff')?.windows).toEqual(analysis.debuff.windows);
	});

	/**
	 * Rising Sun Kick is re-applied long before it falls off, so the raw apply→remove pairs would draw
	 * one continuous debuff as a row of abutting pieces — and a reader counting bars would report drops
	 * the fight never had.
	 */
	it('merges the debuff windows rather than drawing one bar per application', () => {
		expect(laneOf('rising-sun-kick-debuff')?.windows).toEqual([{ start: 1000, end: 30000 }]);
	});

	it('groups each lane so a whole category can be turned off', () => {
		expect(laneOf('re-origination')?.group).toBe('proc');
		expect(laneOf('tigereye-brew')?.group).toBe('buff');
		expect(laneOf('tiger-power')?.group).toBe('buff');
		expect(laneOf('rising-sun-kick-debuff')?.group).toBe('debuff');
	});

	/** An unlit row costs a line of height and a label, and says only that the aura exists. */
	it('drops the lanes with nothing on them', () => {
		const keys = timeline?.lanes.map((l) => l.key) ?? [];
		expect(keys).toContain('tiger-power');
		expect(keys).not.toContain('energizing-brew');
		expect(keys).not.toContain('rushing-jade-wind');
		expect(keys).not.toContain('combo-breaker-tiger-palm');
	});

	/** Every lane names itself and carries an id, because the row is drawn as an icon plus a name. */
	it('carries a name and a spell id per lane', () => {
		for (const lane of timeline?.lanes ?? []) {
			expect(lane.name.length, lane.key).toBeGreaterThan(0);
			expect(lane.id, lane.key).toBeGreaterThan(0);
		}
	});

	/** A pull with no events at all still has to produce a timeline rather than a missing field. */
	it('comes back empty rather than absent for a silent pull', () => {
		const quiet = analyse({ ...dataset, events: [] });
		expect(quiet.timeline).toEqual({ casts: [], lanes: [] });
	});
});
