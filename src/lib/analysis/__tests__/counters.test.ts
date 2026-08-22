// The counter derivations, and the one thing about them that is easy to get subtly wrong: where the
// grace comes off.
//
// `counterWindows` forgives a leeway at the *front* of each merged stretch, which is right for a pull
// graded on one clock and wrong the moment the clock has boundaries in it. A mixed encounter — General
// Nazgrim, boss then adds then boss then adds — is graded against the single-target list only where
// that list applied, and a stretch at the ceiling that began during the adds and ran on into the boss
// phase must arrive at the boundary with its grace *unspent*: the player has just swapped targets, and
// that is a fresh press's worth of chance to spend the counter.
//
// The tests below pin that difference numerically rather than describing it, because the two readings
// agree on the total time and differ only in how much of it is forgiven — which is exactly the kind of
// error that survives a review of the totals.
import { describe, expect, it } from 'vitest';

import { atCapWindows, atCapWindowsIn, counterWindows, counterWindowsIn, stretchesFromPoints } from '../counters';
import type { CounterStretch } from '../counters';
import { intersect, unionMs } from '../intervals';

const iv = (windows: ReadonlyArray<{ start: number; end: number }>): Array<[number, number]> =>
	windows.map((w) => [w.start, w.end]);

/** 1.5s, the Elemental audit's own Lightning Shield leeway — one global's worth of grace. */
const LEEWAY = 1500;

describe('counterWindowsIn', () => {
	/**
	 * The whole point, stated as arithmetic.
	 *
	 * One stretch at the ceiling from 0 to 10s, cut by an AoE phase from 4s to 8s. The single-target
	 * segments are `[0, 4000]` and `[8000, 10000]`, and the shield sat at seven throughout.
	 *
	 * - **Segmented (right):** the first segment is 4 000ms long and forgives 1 500 of it, leaving
	 *   `[1500, 4000]`. The second is 2 000ms long, forgives 1 500 of it *again* — the swap back to the
	 *   boss is a fresh chance to press Earth Shock — leaving `[9500, 10000]`. Total 3 000ms.
	 * - **Subtract-afterwards (wrong):** the grace comes off once at 0, giving `[1500, 10000]`, and
	 *   clipping that to the segments leaves `[1500, 4000]` and `[8000, 10000]`. Total 4 500ms, and the
	 *   player is faulted from the first millisecond of single-target play at 8s.
	 *
	 * The gap is exactly one leeway per boundary crossed, which is why it is asserted as that and not
	 * as a magic number.
	 */
	it('grants the leeway again on the far side of a boundary, rather than charging grace already spent', () => {
		const stretches: CounterStretch[] = [{ start: 0, end: 10_000, level: 7 }];
		const singleTarget: Array<[number, number]> = [
			[0, 4000],
			[8000, 10_000],
		];

		const segmented = atCapWindowsIn(stretches, singleTarget, 7, LEEWAY);
		expect(iv(segmented)).toEqual([
			[1500, 4000],
			[9500, 10_000],
		]);

		// The reading Amendment 4 rejects, computed here so the difference is visible rather than
		// asserted from memory: the same stretch, graded over the pull and clipped afterwards.
		const subtracted = intersect(iv(atCapWindows(stretches, 7, LEEWAY)), singleTarget);
		expect(subtracted).toEqual([
			[1500, 4000],
			[8000, 10_000],
		]);

		// Same stretches, same segments, same total single-target time — and one press of grace apart.
		expect(unionMs(subtracted) - unionMs(iv(segmented))).toBe(LEEWAY);
		// And the fault the wrong reading opens starts on the boundary itself, which is the tell.
		expect(subtracted.some(([start]) => start === 8000)).toBe(true);
		expect(iv(segmented).some(([start]) => start === 8000)).toBe(false);
	});

	/**
	 * Three boundaries, one per swap back to the boss — the Nazgrim shape the amendment names. The
	 * error the segmented form avoids scales with the boundary count, so this is the same assertion
	 * with the multiplier made explicit.
	 */
	it('costs one leeway per swap back, so a four-phase pull is not charged four presses of grace', () => {
		const stretches: CounterStretch[] = [{ start: 0, end: 40_000, level: 7 }];
		const singleTarget: Array<[number, number]> = [
			[0, 10_000],
			[15_000, 25_000],
			[30_000, 40_000],
		];

		const segmented = atCapWindowsIn(stretches, singleTarget, 7, LEEWAY);
		const subtracted = intersect(iv(atCapWindows(stretches, 7, LEEWAY)), singleTarget);

		expect(unionMs(iv(segmented))).toBe(30_000 - 3 * LEEWAY);
		expect(unionMs(subtracted) - unionMs(iv(segmented))).toBe(2 * LEEWAY);
	});

	/**
	 * The compatibility property, and the reason `counterWindows` is left exactly as it was: handed the
	 * whole pull as one segment, the segmented form must be the unsegmented one. Anything else would
	 * mean every pull with no regime swap in it quietly moved.
	 */
	it('is the unsegmented reading when the pull is one segment', () => {
		const stretches: CounterStretch[] = [
			{ start: 0, end: 4000, level: 7 },
			{ start: 9000, end: 20_000, level: 7 },
			{ start: 20_000, end: 26_000, level: 3 },
		];
		expect(atCapWindowsIn(stretches, [[0, 30_000]], 7, LEEWAY)).toEqual(atCapWindows(stretches, 7, LEEWAY));
		expect(counterWindowsIn(stretches, [[0, 30_000]], (level) => level >= 3, LEEWAY)).toEqual(
			counterWindows(stretches, (level) => level >= 3, LEEWAY),
		);
	});

	/** No single-target time at all is no graded window at all — never a free zero over a full pull. */
	it('grades nothing when no segment survives', () => {
		const stretches: CounterStretch[] = [{ start: 0, end: 30_000, level: 7 }];
		expect(atCapWindowsIn(stretches, [], 7, LEEWAY)).toEqual([]);
	});

	/**
	 * A segment shorter than the grace is entirely forgiven, and that is the intended reading rather
	 * than a rounding artefact: a two-target burst between two add waves is not a stretch anybody
	 * could have spent a counter in.
	 */
	it('forgives a segment no longer than the leeway', () => {
		const stretches: CounterStretch[] = [{ start: 0, end: 10_000, level: 7 }];
		expect(atCapWindowsIn(stretches, [[4000, 5000]], 7, LEEWAY)).toEqual([]);
		expect(atCapWindowsIn(stretches, [[4000, 5500]], 7, LEEWAY)).toEqual([]);
		expect(atCapWindowsIn(stretches, [[4000, 5600]], 7, LEEWAY)).toEqual([{ start: 5500, end: 5600 }]);
	});

	/**
	 * Segments arriving unsorted or overlapping are merged first, so a caller may hand over whatever
	 * its regime walk produced — and, importantly, two overlapping segments do not each charge their
	 * own grace over the same second.
	 */
	it('merges the segments before grading them', () => {
		const stretches: CounterStretch[] = [{ start: 0, end: 10_000, level: 7 }];
		const scrambled: Array<[number, number]> = [
			[5000, 10_000],
			[0, 6000],
		];
		expect(atCapWindowsIn(stretches, scrambled, 7, LEEWAY)).toEqual(
			atCapWindowsIn(stretches, [[0, 10_000]], 7, LEEWAY),
		);
	});

	/**
	 * The gap rule survives segmentation. `counterWindows` is handed *stretches* rather than a point
	 * series precisely so an aura's absence is not run through as time at the ceiling, and cutting the
	 * series into segments must not reintroduce that: the shield being down from 4s to 9s is not a
	 * stretch at seven, whichever side of a regime boundary it falls on.
	 */
	it('does not run a stretch across a gap in the level series', () => {
		const stretches: CounterStretch[] = [
			{ start: 0, end: 4000, level: 7 },
			{ start: 9000, end: 12_000, level: 7 },
		];
		expect(iv(atCapWindowsIn(stretches, [[0, 12_000]], 7, 0))).toEqual([
			[0, 4000],
			[9000, 12_000],
		]);
	});

	/** And it composes with `stretchesFromPoints` for the gapless series that has one. */
	it('takes a point series through stretchesFromPoints unchanged', () => {
		const points: Array<[number, number]> = [
			[0, 2],
			[3000, 0],
			[6000, 2],
		];
		const stretches = stretchesFromPoints(points, 12_000);
		expect(iv(atCapWindowsIn(stretches, [[0, 12_000]], 2, 0))).toEqual([
			[0, 3000],
			[6000, 12_000],
		]);
		expect(iv(atCapWindowsIn(stretches, [[0, 3000]], 2, 0))).toEqual([[0, 3000]]);
	});
});
