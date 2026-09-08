// The arithmetic behind the compare page's damage curve.
//
// `DpsOverlay` draws the picture; this module is what it draws, and the split is not only tidiness:
// a module that default-exports a React component may not also export a plain function, or Fast
// Refresh cannot replace it and every save reloads the page. So the maths lives apart from the
// component, and this is where it is checked.
//
// The claims worth pinning are the two the window makes: that it looks backwards and never forwards,
// and that the opening seconds are divided by the time that has actually elapsed.

import { describe, expect, it } from 'vitest';

import { rollingDps, WINDOW_SEC } from '../dpsCurve';

/** The window the curve averages over, read from the module so the two cannot drift. */
const WINDOW = WINDOW_SEC;

describe('the rolling damage curve', () => {
	/**
	 * Trailing, never centred.
	 *
	 * A centred window would let damage that has not happened yet lift the line at a moment the player
	 * had not reached: a curve rising *before* the burst it describes. The shape of that bug is a peak
	 * that arrives early, so the assertion is about where the maximum sits: all the damage lands in the
	 * first second, so the first point must be the largest and nothing may exceed it later.
	 */
	it('never lets damage lift the line before it happened', () => {
		const spike = [1000, ...Array<number>(30).fill(0)];
		const { points } = rollingDps(spike, 31_000);

		expect(points[0]?.y).toBe(1000);
		expect(Math.max(...points.map((p) => p.y))).toBe(1000);
		// And it decays from there rather than rising into the window.
		for (let at = 1; at < points.length; at += 1) {
			expect(points[at]!.y, `point ${at}`).toBeLessThanOrEqual(points[at - 1]!.y);
		}
		// It leaves entirely once the window has passed over it.
		expect(points[WINDOW]?.y).toBe(0);
	});

	/**
	 * The opening seconds divide by the time actually elapsed, not by the full window.
	 *
	 * The alternative reads an opener at a fifteenth of its real rate and draws every pull as starting
	 * from nothing, which is a ramp no player performed. One second into a pull that dealt 1000 damage
	 * in that second, the answer is 1000 damage per second.
	 */
	it('reads the opener at its real rate rather than a fifteenth of it', () => {
		const { points } = rollingDps([1000, 1000, 1000], 3000);
		expect(points[0]?.y).toBe(1000);
		expect(points[1]?.y).toBe(1000);
		expect(points[2]?.y).toBe(1000);
	});

	/** A constant series is a flat line at that constant, once the window has filled and before. */
	it('integrates a flat series back to its own rate', () => {
		const flat = Array<number>(60).fill(250);
		const { points } = rollingDps(flat, 60_000);
		expect(points.every((p) => p.y === 250)).toBe(true);
	});

	/**
	 * One point per second of the series, stamped in milliseconds so the axis and the segment lane
	 * under it share a scale.
	 */
	it('stamps a point per second, in milliseconds', () => {
		const { points, durationMs } = rollingDps([1, 2, 3, 4], 4000);
		expect(points.map((p) => p.x)).toEqual([0, 1000, 2000, 3000]);
		expect(durationMs).toBe(4000);
	});

	/** An empty pull draws nothing rather than a point at the origin. */
	it('draws nothing for a series with no seconds in it', () => {
		expect(rollingDps([], 0).points).toEqual([]);
	});
});
