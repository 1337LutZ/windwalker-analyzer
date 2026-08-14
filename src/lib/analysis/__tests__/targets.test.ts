import { describe, expect, it } from 'vitest';

import { intervalsAtLeast, targetCounts } from '../targets';

/**
 * The per-moment target count, pinned at the shapes that decide whether a pull reads as an add fight.
 *
 * The window is the whole design, so both of its edges are asserted: a hit entering it, and a hit
 * ageing out of it. A count that only ever rose would call every pull that ever saw two enemies a
 * multi-target pull for the rest of its length.
 */
describe('targetCounts', () => {
	const WINDOW = 5000;

	it('counts a second enemy from the moment it is hit and drops it when the first ages out', () => {
		expect(
			targetCounts(
				[
					{ t: 0, target: 1 },
					{ t: 1000, target: 2 },
				],
				WINDOW,
			),
		).toEqual([
			[0, 1],
			[1000, 2],
			[5000, 1],
			[6000, 0],
		]);
	});

	/** Two hits on one enemy are one target, and the later hit keeps it counted after the first expires. */
	it('does not count the same enemy twice', () => {
		expect(
			targetCounts(
				[
					{ t: 0, target: 1 },
					{ t: 1000, target: 1 },
				],
				WINDOW,
			),
		).toEqual([
			[0, 1],
			[6000, 0],
		]);
	});

	it('emits a point only where the answer changes', () => {
		const points = targetCounts(
			Array.from({ length: 6 }, (_, i) => ({ t: i * 500, target: 1 })),
			WINDOW,
		);
		expect(points).toEqual([
			[0, 1],
			[7500, 0],
		]);
	});

	it('has nothing to say about a pull with no hits', () => {
		expect(targetCounts([], WINDOW)).toEqual([]);
	});

	it('does not care what order the hits arrive in', () => {
		const shuffled = targetCounts(
			[
				{ t: 1000, target: 2 },
				{ t: 0, target: 1 },
			],
			WINDOW,
		);
		expect(shuffled).toEqual([
			[0, 1],
			[1000, 2],
			[5000, 1],
			[6000, 0],
		]);
	});
});

describe('intervalsAtLeast', () => {
	it('runs each stretch from the point that reached the count to the one that did not', () => {
		expect(
			intervalsAtLeast(
				[
					[0, 1],
					[1000, 2],
					[5000, 1],
					[6000, 0],
				],
				2,
				10_000,
			),
		).toEqual([[1000, 5000]]);
	});

	/** A count still up when the series ends runs to the end of the pull, which is the caller's number. */
	it('closes an open stretch at the end of the pull', () => {
		expect(
			intervalsAtLeast(
				[
					[0, 1],
					[4000, 3],
				],
				2,
				12_000,
			),
		).toEqual([[4000, 12_000]]);
	});

	it('finds nothing in a series that never reached the count', () => {
		expect(intervalsAtLeast([[0, 1]], 2, 10_000)).toEqual([]);
	});
});
