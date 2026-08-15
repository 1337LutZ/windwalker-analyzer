import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ResourceCurve } from '~/lib/types';

import ResourceTrack from '../ResourceTrack';

/** Every y in the rendered path. The track's viewBox runs 0 (top) to 72 (bottom). */
function heights(curve: ResourceCurve, smooth: boolean): number[] {
	const html = renderToStaticMarkup(
		createElement(ResourceTrack, {
			curve,
			durationMs: 10_000,
			stroke: 'var(--color-kick)',
			fill: 'none',
			label: 'test',
			smooth,
		}),
	);
	const path = /<path d="(M[^"]*)" fill="none"/.exec(html)?.[1] ?? '';
	// Coordinates come in x-then-y pairs; the odd ones are the heights.
	return [...path.matchAll(/-?\d+\.\d+/g)].map((m) => Number(m[0])).filter((_, i) => i % 2 === 1);
}

/**
 * A smoothed line is allowed to round a corner. It is not allowed to draw a value nobody had.
 *
 * That is the whole reason the curve is monotone cubic rather than an ordinary spline: this bar has a
 * hard ceiling and a hard floor, and a spline that overshoots on a sharp turn would put the line
 * above full energy. Every other number in this report is refused when it cannot be supported, and a
 * chart is not exempt.
 */
describe('the smoothed resource line', () => {
	const spiky: ResourceCurve = {
		max: 100,
		// A refill to full, an instant spend, a refill again: the shape that makes a naive spline bulge.
		points: [
			[0, 20],
			[1000, 100],
			[2000, 40],
			[3000, 100],
			[4000, 30],
		],
	};

	it('never rises above the top of the bar or falls below its floor', () => {
		for (const y of heights(spiky, true)) {
			expect(y).toBeGreaterThanOrEqual(0);
			expect(y).toBeLessThanOrEqual(72);
		}
	});

	it('stays within the readings it was given', () => {
		// 100 of 100 is y=0 and 20 of 100 is y=57.6, so nothing may sit outside that band on this curve.
		const ys = heights(spiky, true);
		expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
		expect(Math.max(...ys)).toBeLessThanOrEqual(57.6 + 0.01);
	});

	it('passes through every reading rather than near it', () => {
		// A smoothed path is still an account of the data: each sample has to be on the line. The curve
		// commands end at their reading, so every reading appears as a coordinate.
		const straight = heights(spiky, false);
		const curved = heights(spiky, true);
		for (const y of straight) expect(curved.some((c) => Math.abs(c - y) < 0.01)).toBe(true);
	});

	it('is opt-in, and leaves the straight line alone', () => {
		const html = renderToStaticMarkup(
			createElement(ResourceTrack, {
				curve: spiky,
				durationMs: 10_000,
				stroke: 'var(--color-kick)',
				fill: 'none',
				label: 'test',
			}),
		);
		// No cubic commands at all when smoothing was not asked for.
		expect(/<path d="M[^"]*C/.test(html)).toBe(false);
	});
});
