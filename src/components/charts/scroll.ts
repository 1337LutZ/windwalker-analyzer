import { useCallback, useRef, useState } from 'react';

// Panning and zooming a pull, shared by every chart that draws one on a scrollable clock.
//
// Extracted rather than copied: two timelines that disagree about how far a drag moves, or about
// what the widest zoom shows, read as two different tools on one page.

/**
 * Zoom, in pixels per second of pull.
 *
 * The bottom of the ladder fits a nine-minute fight into about 1600px — an overview to pan across —
 * and the top gives one global 48px, which is more than an icon needs. The default is one icon per
 * global: below that presses overlap into a smear, which is the reason this scrolls at all.
 */
export const ZOOM_LADDER = [3, 6, 12, 24, 48] as const;
export const DEFAULT_ZOOM = 3;

/**
 * The zoom that shows a fixed slice of the pull in the width available, clamped to the ladder.
 *
 * For a chart whose useful default is "about a minute on screen" rather than "the whole pull": a
 * nine-minute fight squeezed into one screen turns a run at the energy cap into a smudge, and the
 * widest rung is a worse starting point than a readable minute. Falls back to the rung that fits the
 * whole pull when the pull is shorter than the slice asked for, so a two-minute kill never opens
 * scrolled.
 */
export function zoomForSlice(durationMs: number, sliceMs: number, widthPx: number): number {
	const wanted = widthPx / (Math.min(sliceMs, Math.max(1, durationMs)) / 1000);
	// The last rung at or below what was asked for, so the slice on screen is never *narrower* than
	// requested — overshooting hides data the caller said it wanted visible.
	let best = 0;
	for (let i = 0; i < ZOOM_LADDER.length; i += 1) {
		const step = ZOOM_LADDER[i];
		if (step !== undefined && step <= wanted) best = i;
	}
	return best;
}

/**
 * Drag the pull sideways, the way a map pans.
 *
 * The scroller already scrolls — with a wheel, a trackpad, a scrollbar and the arrow keys — but on a
 * four-minute fight at the top of the zoom ladder the track is several thousand pixels wide, and
 * grabbing it is how anyone actually expects to move around something that long.
 *
 * Pointer events rather than mouse events, so a touch drag and a pen work without a second
 * implementation, and `setPointerCapture` so a drag that leaves the element still tracks instead of
 * sticking. `pointerdown` is deliberately not prevented: preventing it would kill the click that
 * opens a tooltip and the focus that makes the keyboard scrolling work.
 */
export function useDragScroll() {
	const ref = useRef<HTMLDivElement>(null);
	const from = useRef<{ x: number; scroll: number } | null>(null);
	const [dragging, setDragging] = useState(false);

	const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		// Primary button only: a right-click is a context menu and a middle-click is a paste on Linux.
		if (event.button !== 0 || ref.current === null) return;
		from.current = { x: event.clientX, scroll: ref.current.scrollLeft };
		setDragging(true);
		ref.current.setPointerCapture(event.pointerId);
	}, []);

	const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		const start = from.current;
		if (start === null || ref.current === null) return;
		// Follow the pointer exactly: the content moves with the hand rather than at some multiple of
		// it, which is the difference between dragging a thing and operating a control.
		ref.current.scrollLeft = start.scroll - (event.clientX - start.x);
	}, []);

	const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		from.current = null;
		setDragging(false);
		if (ref.current?.hasPointerCapture(event.pointerId) === true) ref.current.releasePointerCapture(event.pointerId);
	}, []);

	return { ref, dragging, onPointerDown, onPointerMove, onPointerUp };
}

/**
 * Gridlines and axis labels are spaced at least this far apart.
 *
 * Comfortably more than a `8:55` label needs at 14px, and that slack is the point: the step is picked
 * per zoom level, so a tighter floor buys a denser grid at the cost of a label — and a hundred more
 * nodes — every few seconds of a nine-minute pull.
 */
const MIN_TICK_PX = 140;

const TICK_STEPS_MS = [5000, 10000, 15000, 30000, 60000, 120000, 300000];

export const tickStepMs = (pxPerSec: number): number =>
	TICK_STEPS_MS.find((step) => (step / 1000) * pxPerSec >= MIN_TICK_PX) ?? 300_000;
