import { describe, expect, it } from 'vitest';

import { intervalsAtLeast, overlapPoints, targetCounts } from '../targets';

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

	/**
	 * The one that survived longest, because nothing here was asking it.
	 *
	 * WarcraftLogs gives one actor id to an NPC *type*, so every Kor'kron Ironblade standing on a monk
	 * arrives as the same `target` and they are told apart only by `targetInstance`. Counting on the id
	 * alone therefore counts enemy *kinds* and calls all ten of them one enemy — measured on the
	 * Galakras kill in `a:6MhZgjyAknFWrYfK`, 13 ids against the 45 spawns the player actually hit.
	 * Everything reading this series inherited the smaller number: the multi-target share, the detected
	 * mode, and the band the priority ladder judges every press at.
	 */
	it('counts two live copies of one NPC as two enemies, not one', () => {
		expect(
			targetCounts(
				[
					{ t: 0, target: 1, instance: 1 },
					{ t: 1000, target: 1, instance: 2 },
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

	/** The other half of it: one spawn hit twice is one enemy, however many copies share its id. */
	it('does not count one spawn twice because a sibling shares its id', () => {
		expect(
			targetCounts(
				[
					{ t: 0, target: 1, instance: 3 },
					{ t: 1000, target: 1, instance: 3 },
				],
				WINDOW,
			),
		).toEqual([
			[0, 1],
			[6000, 0],
		]);
	});

	/**
	 * A caller with no instance to give — an old report, or the Storm, Earth and Fire audit, which wants
	 * the actor id its per-target lanes are labelled with — gets one bucket per id, exactly as before
	 * the field existed. Checked against real logs: no target in the reference reports ever mixes an
	 * absent instance with a numbered one, so the two forms never describe the same spawn.
	 */
	it('buckets a hit with no instance on its id alone', () => {
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

/**
 * The Stormlash overlap, and the two cases the hand-written boundary sweep it replaced got wrong.
 *
 * Measured against the old sweep rather than assumed: it handled the plain cases correctly, and got
 * exactly two things wrong. An overlap still running when the pull ended was emitted with the
 * window's own expiry — `{5000, 30000}` on a 20 000 ms pull — and two windows sharing one instant
 * produced a zero-length overlap the section then drew as a band. `intervalsAtLeast` clamps the tail;
 * `overlapPoints` drops the empty window.
 */
describe('overlapPoints', () => {
	const overlaps = (windows: Array<[number, number]>, endMs: number) =>
		intervalsAtLeast(overlapPoints(windows), 2, endMs);

	it('counts the running depth of overlapping windows', () => {
		expect(
			overlapPoints([
				[0, 10],
				[5, 15],
			]),
		).toEqual([
			[0, 1],
			[5, 2],
			[10, 1],
			[15, 0],
		]);
	});

	it('finds the stretch two windows shared', () => {
		expect(
			overlaps(
				[
					[0, 10_000],
					[6000, 16_000],
				],
				20_000,
			),
		).toEqual([[6000, 10_000]]);
	});

	/** Not a case the old sweep got wrong — kept so a rewrite cannot break what already worked. */
	it('closes an overlap when both windows end on the same instant', () => {
		expect(
			overlaps(
				[
					[0, 10_000],
					[4000, 10_000],
				],
				20_000,
			),
		).toEqual([[4000, 10_000]]);
	});

	/** Defect one: the old sweep returned `{5000, 30000}` here, longer than the 20s pull. */
	it('clamps an overlap still open at the end of the pull', () => {
		expect(
			overlaps(
				[
					[0, 30_000],
					[5000, 30_000],
				],
				20_000,
			),
		).toEqual([[5000, 20_000]]);
	});

	it('does not read two windows that merely touch as overlapping', () => {
		expect(
			overlaps(
				[
					[0, 10_000],
					[10_000, 20_000],
				],
				20_000,
			),
		).toEqual([]);
	});

	it('reports nothing for a lone window, and nothing for none', () => {
		expect(overlaps([[0, 10_000]], 20_000)).toEqual([]);
		expect(overlaps([], 20_000)).toEqual([]);
	});

	/** Defect two: the old sweep emitted `{5000, 5000}`, a band with no width. */
	it('drops a zero-length window rather than counting it as an opening', () => {
		expect(
			overlaps(
				[
					[5000, 5000],
					[0, 10_000],
				],
				20_000,
			),
		).toEqual([]);
	});

	it('holds one point per instant when several edges land together', () => {
		// Three totems opening at once must read as a depth of three, never as a dip through one and two.
		expect(
			overlapPoints([
				[0, 10],
				[0, 10],
				[0, 10],
			]),
		).toEqual([
			[0, 3],
			[10, 0],
		]);
	});
});
