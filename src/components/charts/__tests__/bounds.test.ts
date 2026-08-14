import { describe, expect, it } from 'vitest';

import { boundsWithin } from '../apex';

/**
 * A 4:17 pull could be dragged out to 10:00 of empty axis, with the fight squeezed into a corner.
 * `xaxis.min` / `xaxis.max` only seed the opening view; ApexCharts pans and zooms straight past them,
 * so these handlers are the fence.
 */
const PULL = 257_000;
const events = boundsWithin(PULL);
const zoom = (min: number, max: number) => events.beforeZoom(null, { xaxis: { min, max } }).xaxis;

describe('chart bounds', () => {
	it('leaves a view inside the pull alone', () => {
		expect(zoom(10_000, 60_000)).toEqual({ min: 10_000, max: 60_000 });
	});

	it('refuses to open past the end of the fight', () => {
		expect(zoom(500_000, 700_000)).toEqual({ min: PULL - 200_000, max: PULL });
	});

	it('refuses to open before the pull started', () => {
		expect(zoom(-200_000, -50_000)).toEqual({ min: 0, max: 150_000 });
	});

	/** Zooming all the way out lands on the whole fight and no more. */
	it('clamps a huge zoom-out to exactly the pull', () => {
		expect(zoom(-1e9, 1e9)).toEqual({ min: 0, max: PULL });
	});

	/**
	 * A pan that runs into the end should stop, not shrink the window under the reader's cursor — so
	 * the width they chose is preserved and slid inside the fight.
	 */
	it('keeps the chosen window width when it hits an edge', () => {
		const held = zoom(PULL - 10_000, PULL + 40_000);
		expect(held.max - held.min).toBe(50_000);
		expect(held.max).toBe(PULL);
	});

	it('resets to the whole pull', () => {
		expect(events.beforeResetZoom().xaxis).toEqual({ min: 0, max: PULL });
	});

	it('snaps a pan back only when it left the pull', () => {
		const calls: Array<[number, number]> = [];
		const chart = { zoomX: (min: number, max: number) => calls.push([min, max]) };

		events.scrolled(chart, { xaxis: { min: 10_000, max: 60_000 } });
		expect(calls, 'a view inside the pull must not be corrected').toEqual([]);

		events.scrolled(chart, { xaxis: { min: PULL, max: PULL + 100_000 } });
		expect(calls).toHaveLength(1);
		expect(calls[0]?.[1]).toBe(PULL);
	});

	/** Correcting on sub-millisecond float drift would re-enter `scrolled` on every frame. */
	it('ignores floating-point drift rather than looping', () => {
		const calls: number[] = [];
		events.scrolled({ zoomX: () => calls.push(1) }, { xaxis: { min: -0.4, max: PULL + 0.4 } });
		expect(calls).toEqual([]);
	});
});
