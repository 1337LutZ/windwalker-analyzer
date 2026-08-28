import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';

import { buildReplay, REPLAY_STEP_MS, UNITS_PER_YARD } from '../replay';

const T0 = 1_000_000;

/** A cast carrying the source's own position — `resourceActor: 1`, in map units. */
const self = (ms: number, x: number, y: number) =>
	({
		timestamp: T0 + ms,
		type: 'cast',
		sourceID: 7,
		targetID: -1,
		abilityGameID: 100780,
		resourceActor: 1,
		x: x * UNITS_PER_YARD,
		y: y * UNITS_PER_YARD,
		mapID: 560,
	}) as unknown as WclEvent;

/** A damage event carrying the *target's* position — `resourceActor: 2`, which is the usual case. */
const foe = (ms: number, targetID: number, targetInstance: number, x: number, y: number) =>
	({
		timestamp: T0 + ms,
		type: 'damage',
		sourceID: 7,
		targetID,
		targetInstance,
		abilityGameID: 100780,
		amount: 1,
		resourceActor: 2,
		x: x * UNITS_PER_YARD,
		y: y * UNITS_PER_YARD,
		mapID: 560,
	}) as unknown as WclEvent;

/**
 * The track is drawn and never scored, so what these pin is that it reports the log and not more than
 * the log: a body appears only while it is being hit, the player disappears where the stream stops
 * saying, and a pull with no resource block produces nothing rather than a plausible-looking nothing.
 */
describe('buildReplay', () => {
	it('reads the player off resourceActor 1 and the enemy off resourceActor 2', () => {
		const track = buildReplay([self(0, 100, 200), foe(0, 42, 1, 110, 200)], T0, 2000);
		expect(track?.frames[0]?.self).toEqual([100, 200]);
		expect(track?.frames[0]?.foes).toEqual([{ key: '42:1', x: 110, y: 200 }]);
	});

	it('tells two spawns of one actor id apart by targetInstance', () => {
		// The whole reason the key is a pair: WarcraftLogs gives a wave of adds one targetID, and a
		// track keyed on the id alone would draw ten bodies as one dot teleporting between them.
		const track = buildReplay([foe(0, 42, 1, 100, 100), foe(0, 42, 2, 140, 100)], T0, 1000);
		expect(track?.frames[0]?.foes.map((f) => f.key)).toEqual(['42:1', '42:2']);
	});

	it('interpolates between samples rather than snapping to the nearer one', () => {
		const track = buildReplay([self(0, 0, 0), self(4000, 40, 0)], T0, 4000);
		expect(track?.frames[2]?.self).toEqual([20, 0]);
	});

	it('reports no position once the stream has been silent longer than the stale window', () => {
		// 6s of tolerance either side, so a 30s hole leaves the middle of it blank rather than parking
		// the dot on a claim the log never made.
		const track = buildReplay([self(0, 10, 10), self(30_000, 10, 10)], T0, 30_000);
		expect(track?.frames[0]?.self).toEqual([10, 10]);
		expect(track?.frames[15]?.self).toBeNull();
		expect(track?.frames[30]?.self).toEqual([10, 10]);
	});

	it('drops an enemy from the frames either side of the hits that reveal it', () => {
		const track = buildReplay([self(0, 0, 0), foe(20_000, 42, 1, 5, 5), self(40_000, 0, 0)], T0, 40_000);
		expect(track?.frames[0]?.foes).toEqual([]);
		expect(track?.frames[20]?.foes).toEqual([{ key: '42:1', x: 5, y: 5 }]);
		expect(track?.frames[40]?.foes).toEqual([]);
	});

	it('has nothing to say about a stream with no resource block', () => {
		// The ordinary case on an old capture: every committed Windwalker dataset predates
		// `includeResources`, so an absent track is what a reader has to be able to handle.
		const bare = [{ timestamp: T0, type: 'cast', sourceID: 7, abilityGameID: 100780 }] as unknown as WclEvent[];
		expect(buildReplay(bare, T0, 5000)).toBeUndefined();
	});

	it('refuses a pull whose positions span two maps', () => {
		// Two coordinate spaces stacked on one plane draw as a teleport. Better to draw nothing.
		const moved = { ...(self(1000, 10, 10) as object), mapID: 999 } as unknown as WclEvent;
		expect(buildReplay([self(0, 10, 10), moved], T0, 2000)).toBeUndefined();
	});

	it('covers the pull at the declared step, inclusive of its last second', () => {
		const track = buildReplay([self(0, 0, 0), self(10_000, 0, 0)], T0, 10_000);
		expect(track?.stepMs).toBe(REPLAY_STEP_MS);
		expect(track?.frames).toHaveLength(11);
		expect(track?.frames.at(-1)?.ms).toBe(10_000);
	});

	it('reports the box the pull fits in, in yards', () => {
		const track = buildReplay([self(0, 100, 200), foe(0, 42, 1, 160, 180)], T0, 1000);
		expect(track?.bounds).toEqual({ minX: 100, maxX: 160, minY: 180, maxY: 200 });
	});
});
