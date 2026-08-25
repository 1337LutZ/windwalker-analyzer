// A bar whose ceiling moves, and the two readers that have to agree about where it was.
//
// Every resource in this tree but one has a ceiling that is a single number for the whole pull, and
// both `cappedOf` and `ResourceTrack` were written against that. Vengeance is the exception — its
// limit is the tank's maximum health, which a Rallying Cry raises for as long as it holds — so
// `ResourceCurve.ceiling` carries the limit over time beside the scalar that scales the axis.
//
// What is asserted here is the part a fixture cannot show: that the fallback is exact (a curve
// without the field behaves precisely as it did before it existed), and that a reading taken under a
// raised ceiling is measured against *that* ceiling rather than the pull's highest — which is the
// inversion the whole change exists to remove.

import { describe, expect, it } from 'vitest';

import { cappedOf, ceilingReader } from '../capped';
import type { ResourceCurve } from '~/lib/types';

/** Resting at 100, raised to 150 between 20s and 40s, resting again after. */
const MOVING: ResourceCurve = {
	max: 150,
	points: [
		[0, 100],
		[10_000, 100],
		[25_000, 100],
		[30_000, 150],
		[35_000, 150],
		[50_000, 100],
	],
	ceiling: [
		[0, 100],
		[20_000, 150],
		[40_001, 100],
	],
};

describe('ceilingReader', () => {
	/** No series means the scalar, at every moment — the behaviour every existing curve relies on. */
	it('answers with the scalar for a curve that carries no series', () => {
		const read = ceilingReader({ max: 4, points: [] });
		expect([read(0), read(10_000), read(-1)]).toEqual([4, 4, 4]);
	});

	/** An empty series is the same statement as no series, and must not read as a ceiling of nothing. */
	it('treats an empty series as no series', () => {
		const read = ceilingReader({ max: 4, points: [], ceiling: [] });
		expect(read(5_000)).toBe(4);
	});

	it('holds each level until the next step', () => {
		const read = ceilingReader(MOVING);
		expect(read(0)).toBe(100);
		expect(read(19_999)).toBe(100);
		expect(read(20_000)).toBe(150);
		expect(read(40_000)).toBe(150);
		expect(read(40_001)).toBe(100);
		expect(read(999_999)).toBe(100);
	});

	/**
	 * The cursor is an optimisation and must not become a correctness claim.
	 *
	 * It walks forward because callers read a curve in time order, and it rewinds when one does not —
	 * so an out-of-order read costs a rescan rather than returning the wrong ceiling.
	 */
	it('rewinds rather than answering wrongly when read out of order', () => {
		const read = ceilingReader(MOVING);
		expect(read(45_000)).toBe(100);
		expect(read(25_000)).toBe(150);
		expect(read(5_000)).toBe(100);
	});
});

describe('cappedOf with a moving ceiling', () => {
	/**
	 * The inversion this change exists to remove.
	 *
	 * The two readings at 150 are the bar at its limit, and its limit at that moment was 150. Measured
	 * against `max` alone they would also register — but the readings at 100 *before* the buff landed
	 * are the bar at its limit too, and against a `max` of 150 those vanish entirely. A tank whose
	 * ceiling rose to meet them would read as having fallen away from it.
	 */
	it('measures each reading against the ceiling in force at its own moment', () => {
		expect(cappedOf(MOVING)).toEqual([
			// The stretch a scalar `max` of 150 loses entirely: the bar held 100 against a ceiling of 100,
			// which is a bar at its limit, and measured against the pull's *highest* ceiling it reads as a
			// third short of it. This row is the whole reason the series exists.
			{ start: 0, end: 10_000 },
			// The pair at 10s/25s straddles the raise — the later reading is under a ceiling of 150 with
			// only 100 on the bar — so the stretch ends rather than running through the buff.
			{ start: 30_000, end: 50_000 },
		]);
	});

	/**
	 * The stretch that closes the pull is one row and not two, and that is `cappedOf`'s existing rule
	 * rather than anything new: two adjacent readings both at the ceiling means the bar was at the
	 * ceiling between them. Here the ceiling drops at 40s to meet a bar that had already fallen to it,
	 * so 35s (150 of 150) and 50s (100 of 100) are both full and merge. The same coarseness the fixed
	 * case has always had, applied to a limit that moves.
	 */

	/** And the same curve with the series removed is the old behaviour, unchanged. */
	it('falls back to the scalar when no series is carried', () => {
		const { ceiling: _dropped, ...fixed } = MOVING;
		expect(cappedOf(fixed)).toEqual([{ start: 30_000, end: 35_000 }]);
	});
});
