import { describe, expect, it } from 'vitest';
import { intersect, mergeIntervals, overlapMs, unionMs, type Interval } from '../intervals';

describe('mergeIntervals', () => {
	it('sorts before merging, so log order does not matter', () => {
		const out = mergeIntervals([
			[30, 40],
			[0, 10],
			[5, 20],
		]);
		expect(out).toEqual([
			[0, 20],
			[30, 40],
		]);
	});

	it('joins intervals that only touch', () => {
		expect(
			mergeIntervals([
				[0, 10],
				[10, 20],
			]),
		).toEqual([[0, 20]]);
	});

	it('swallows a fully contained interval instead of truncating the outer one', () => {
		expect(
			mergeIntervals([
				[0, 100],
				[20, 30],
			]),
		).toEqual([[0, 100]]);
	});

	it('does not mutate its input', () => {
		const input: Interval[] = [
			[0, 10],
			[5, 20],
		];
		mergeIntervals(input);
		expect(input).toEqual([
			[0, 10],
			[5, 20],
		]);
	});
});

describe('unionMs', () => {
	it('is 0 for no intervals', () => {
		expect(unionMs([])).toBe(0);
	});

	it('counts overlapped time once — the whole reason uptime goes through it', () => {
		expect(
			unionMs([
				[0, 10000],
				[5000, 15000],
			]),
		).toBe(15000);
	});

	it('sums disjoint intervals', () => {
		expect(
			unionMs([
				[0, 1000],
				[5000, 6000],
			]),
		).toBe(2000);
	});

	it('ignores a duplicate window', () => {
		expect(
			unionMs([
				[0, 8000],
				[0, 8000],
			]),
		).toBe(8000);
	});
});

describe('overlapMs', () => {
	it('clips to the ranges at both ends', () => {
		expect(overlapMs(0, 10000, [[5000, 20000]])).toBe(5000);
		expect(overlapMs(15000, 30000, [[5000, 20000]])).toBe(5000);
	});

	it('is 0 when nothing intersects', () => {
		expect(overlapMs(0, 1000, [[5000, 6000]])).toBe(0);
	});

	it('adds up across several ranges', () => {
		expect(
			overlapMs(0, 10000, [
				[0, 1000],
				[4000, 5000],
				[9000, 20000],
			]),
		).toBe(3000);
	});
});

describe('intersect', () => {
	it('keeps only the shared time', () => {
		expect(
			intersect(
				[[0, 10000]],
				[
					[4000, 6000],
					[8000, 20000],
				],
			),
		).toEqual([
			[4000, 6000],
			[8000, 10000],
		]);
	});

	it('drops empty and touching-only overlaps', () => {
		expect(intersect([[0, 5000]], [[5000, 9000]])).toEqual([]);
	});
});
