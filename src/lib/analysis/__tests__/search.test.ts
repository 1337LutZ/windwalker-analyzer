// The one binary search four call sites used to write out longhand. Pinned here because the three
// wrappers around it differ only in what they return, and a fault in the shared loop would move the
// target count, every resource curve and the Ascendance cooldown at once.
import { describe, expect, it } from 'vitest';

import { lastIndexAtOrBefore, stampAtOrBefore, valueAtOrBefore } from '../search';

const idx = (keys: readonly number[], t: number) => lastIndexAtOrBefore(keys.length, (i) => keys[i]!, t);

describe('lastIndexAtOrBefore', () => {
	it('answers -1 when every key is later than the instant', () => {
		expect(idx([10, 20, 30], 9)).toBe(-1);
	});

	it('answers -1 for an empty series rather than throwing', () => {
		expect(idx([], 100)).toBe(-1);
	});

	/** At-or-before, not before: a reading stamped exactly at `t` is the reading that held at `t`. */
	it('includes a key landing exactly on the instant', () => {
		expect(idx([10, 20, 30], 20)).toBe(1);
	});

	it('takes the last of several keys sharing the instant', () => {
		expect(idx([10, 20, 20, 20, 30], 20)).toBe(3);
	});

	it('answers the final key past the end of the series', () => {
		expect(idx([10, 20, 30], 10_000)).toBe(2);
	});

	it('agrees with a linear scan across the whole range', () => {
		const keys = [0, 3, 3, 7, 11, 11, 11, 40, 41];
		for (let t = -2; t <= 45; t += 1) {
			let expected = -1;
			for (let i = 0; i < keys.length; i += 1) if (keys[i]! <= t) expected = i;
			expect(idx(keys, t), `t=${t}`).toBe(expected);
		}
	});
});

describe('valueAtOrBefore', () => {
	const points: Array<[number, number]> = [
		[0, 6],
		[4190, 7],
		[19_971, 1],
	];

	it('reads the step that held at the instant', () => {
		expect(valueAtOrBefore(points, 0)).toBe(6);
		expect(valueAtOrBefore(points, 4189)).toBe(6);
		expect(valueAtOrBefore(points, 4190)).toBe(7);
		expect(valueAtOrBefore(points, 100_000)).toBe(1);
	});

	/**
	 * Null, not zero. "Never sampled" and "sampled at zero" are different facts about a resource bar,
	 * and `countAt` is the caller that turns the first into a zero — because nothing counted yet really
	 * is a count of nothing.
	 */
	it('answers null before the first reading', () => {
		expect(valueAtOrBefore(points, -1)).toBeNull();
		expect(valueAtOrBefore([], 5)).toBeNull();
	});

	it('carries a genuine zero through rather than reporting it as absent', () => {
		expect(valueAtOrBefore([[10, 0]], 20)).toBe(0);
	});
});

describe('stampAtOrBefore', () => {
	it('finds the last press at or before the instant', () => {
		expect(stampAtOrBefore([1000, 181_000], 180_999)).toBe(1000);
		expect(stampAtOrBefore([1000, 181_000], 181_000)).toBe(181_000);
	});

	it('answers null when nothing has been pressed yet', () => {
		expect(stampAtOrBefore([1000], 999)).toBeNull();
		expect(stampAtOrBefore([], 999)).toBeNull();
	});
});
