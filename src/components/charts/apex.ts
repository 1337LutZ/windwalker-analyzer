// Everything the four ApexCharts charts share: the base chart options, and the adapter that hands
// the library the tooltip card. The palette lives in `./theme`, the card itself in `./tooltip`.
//
// This file is deliberately free of JSX and of any top-level reference to `window`, so it can be
// imported by a module that Astro prerenders. ApexCharts itself is never imported here except as a
// type — `import type` is erased, and the library only ever loads from ApexChart's effect.

import type { ApexOptions } from 'apexcharts';

import { fmt } from '../format';
import type { ChartTheme } from './theme';
import { LABEL_FONT_SIZE } from './theme';
import type { TipContent } from './tooltip';
import { tooltip } from './tooltip';

// The theme and the card both used to live here, and most of the tree imports them from here.
// Re-exported rather than repointed at their new homes: which module keeps the palette is not a fact
// fifteen call sites should have had to learn.
export type { ChartTheme } from './theme';
export { LABEL_FONT_SIZE, readTheme } from './theme';
export type { TipContent, TipRow } from './tooltip';
export { tooltip } from './tooltip';

// ------------------------------------------------------------- environment

/** The breakpoint the charts change shape at, matching Tailwind's `sm`. */
export const NARROW_QUERY = '(max-width: 639px)';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * A finger rather than a mouse. Which default drag tool a chart wants is a question about the input
 * device, not the screen size: a narrow window on a laptop still has a pointer that can draw a
 * precise selection, and a large tablet still does not.
 */
export const COARSE_POINTER_QUERY = '(pointer: coarse)';

/**
 * On a phone a nine-minute pull is a smear, so the timeline and the bank open on the first stretch
 * of it and the reader pans from there. Wide screens get the whole fight.
 *
 * Two minutes rather than three: at 14px the axis labels and the track names take a wider bite out
 * of a 390px screen than the old 10px ones did, and the same window drawn into a narrower plot is
 * what turns a four-second channel back into a sliver nobody can hit.
 */
const NARROW_WINDOW_MS = 120_000;

// -------------------------------------------------------------- base options

interface BaseChartArgs {
	/** Unique per chart; also what `group` syncing addresses. */
	id: string;
	type: NonNullable<NonNullable<ApexOptions['chart']>['type']>;
	height: number;
	theme: ChartTheme;
	animate: boolean;
	/** Charts sharing a group share their x-axis zoom, pan and crosshair. */
	group?: string;
	/** Only the time-axis charts are scrubbable; a bar chart of nine rows is not. */
	scrubbable?: boolean;
	/** The pull's length. Panning and zooming are held inside `[0, durationMs]`. */
	durationMs?: number;
	/** True on a touch device, which changes which drag tool is armed by default. */
	touch?: boolean;
	/**
	 * Called with the x-window the reader is looking at, whenever it changes.
	 *
	 * Only meaningful on a `scrubbable` chart, since nothing else moves. Exists for `WindowTracks`'s
	 * `behind` overlay, which draws outside the library and would otherwise keep painting the whole
	 * pull across a plot rectangle showing twenty seconds of it.
	 */
	onView?: (min: number, max: number) => void;
}

/**
 * ApexCharts' `xaxis.min` / `xaxis.max` seed the opening view; they do not fence it in. Pan and
 * zoom-out both run past them freely, so a 4:17 pull could be dragged out to 10:00 of empty axis
 * with the whole fight squeezed into a corner — the chart looked broken and the data looked missing.
 *
 * These handlers put the fence in. `beforeZoom` rewrites an out-of-range request before it is drawn;
 * `scrolled` fires after a pan, so it has to measure the result and snap back. The snap only runs
 * when the view is genuinely outside the pull, which is what stops `zoomX` from re-triggering
 * `scrolled` into a loop.
 */
export function boundsWithin(durationMs: number, onView?: (min: number, max: number) => void) {
	// Keep the width the reader chose and slide it inside the fight, rather than clipping it — a pan
	// that hits the end should stop, not shrink the window under the cursor.
	const clamp = (rawMin: number, rawMax: number) => {
		const span = Math.min(Math.max(rawMax - rawMin, 1), durationMs);
		if (rawMin < 0) return { min: 0, max: span };
		if (rawMax > durationMs) return { min: durationMs - span, max: durationMs };
		return { min: rawMin, max: rawMax };
	};

	// A millisecond of slack: floating-point pan positions land fractionally off and would otherwise
	// be "corrected" on every frame.
	const outside = (a: number, b: number) => Math.abs(a - b) > 1;

	// The window the reader is actually looking at, published to whoever asked for it. Reported from
	// inside the fence rather than beside it, so an overlay is told the clamped view and never the raw
	// request — the two differ on every pan that hits an end, which is exactly when a drift would show.
	const publish = (min: number, max: number) => onView?.(min, max);

	return {
		beforeZoom: (_chart: unknown, { xaxis }: { xaxis: { min: number; max: number } }) => {
			const held = clamp(xaxis.min, xaxis.max);
			publish(held.min, held.max);
			return { xaxis: held };
		},
		beforeResetZoom: () => {
			publish(0, durationMs);
			return { xaxis: { min: 0, max: durationMs } };
		},
		// Also after the fact, because the toolbar's zoom buttons and a pinch settle without always
		// passing through `beforeZoom`, and a view reported once too often costs nothing.
		zoomed: (_chart: unknown, { xaxis }: { xaxis: { min?: number; max?: number } }) => {
			const held = clamp(xaxis.min ?? 0, xaxis.max ?? durationMs);
			publish(held.min, held.max);
		},
		scrolled: (
			chart: { zoomX?: (min: number, max: number) => void },
			{ xaxis }: { xaxis: { min: number; max: number } },
		) => {
			const held = clamp(xaxis.min, xaxis.max);
			publish(held.min, held.max);
			if (outside(held.min, xaxis.min) || outside(held.max, xaxis.max)) chart.zoomX?.(held.min, held.max);
		},
	};
}

/**
 * The point the cursor is actually on.
 *
 * ApexCharts hands the custom-tooltip callback indices it resolved along the x-axis alone, ignoring
 * which row the cursor is in. On a timeline carrying several tracks in one series that is regularly
 * a point on some other row — hovering a Re-Origination proc answered with whichever Tigereye Brew
 * window happened to be nearest on the clock. `dataPointMouseEnter` fires from the mark's own DOM
 * node, so it knows the row; this records what it saw for the tooltip to read.
 *
 * One record for the whole page is enough: only one tooltip is ever open.
 */
const cursorPoint = { seriesIndex: -1, dataPointIndex: -1 };

/**
 * Where the pointer last was down the window, which is the anchor a tooltip with no room above it is
 * flipped to. Recorded beside the point above because the same pointer move establishes both, and
 * separate from it because this one is a pixel rather than an index — a line chart resolves no mark
 * and still has a cursor.
 */
let pointerY = 0;

const forget = () => {
	cursorPoint.seriesIndex = -1;
	cursorPoint.dataPointIndex = -1;
};

/**
 * Follows the pointer across a chart and records which mark it is over, by asking the document what
 * is at that pixel.
 *
 * ApexCharts renders each mark as a `<path>` carrying its own point index in a `j` attribute, inside
 * a `<g>` carrying the series index — so a hit test answers exactly the question the tooltip needs to
 * ask, with no reliance on the library's internal resolution. `dataPointMouseEnter` looks like the
 * supported way to do this and is not: it does not fire for every pointer path across a mark, and a
 * tooltip reading the last point it *did* fire for shows a stale row.
 *
 * Nothing under the cursor leaves the pair at `-1`, which is the honest answer for a line chart —
 * there the reader is pointing at a moment rather than a mark, and the x-axis resolution is right.
 */
export function trackCursor(root: HTMLElement): () => void {
	const move = (event: PointerEvent) => {
		pointerY = event.clientY;
		// The whole stack at that pixel, not just the topmost element: ApexCharts' own tooltip follows
		// the cursor closely enough to sit over the mark it is describing, and a single-element hit test
		// finds the tooltip and reports nothing under the cursor.
		const mark = document
			.elementsFromPoint(event.clientX, event.clientY)
			.map((el) => el.closest('[j]'))
			.find((el): el is Element => el !== null);
		const series = mark?.closest('.apexcharts-series');
		const point = mark?.getAttribute('j');
		const index = series?.getAttribute('data:realIndex');
		cursorPoint.seriesIndex = index === null || index === undefined ? -1 : Number(index);
		cursorPoint.dataPointIndex = point === null || point === undefined ? -1 : Number(point);
	};

	root.addEventListener('pointermove', move);
	root.addEventListener('pointerleave', forget);
	return () => {
		root.removeEventListener('pointermove', move);
		root.removeEventListener('pointerleave', forget);
		forget();
	};
}

/** How close to the edge of the window a tooltip may come before it is pulled back inside. */
const TIP_EDGE_PX = 8;

/**
 * How far below the pointer a flipped tooltip lands. The rows these charts draw are 36px tall and the
 * pointer is usually somewhere near the middle of one, so this clears the mark being described rather
 * than lying across it.
 */
const TIP_FLIP_PX = 20;

/**
 * Holds a chart's tooltip inside the window: flipped below the pointer when there is no room above
 * it, and pulled back from either side edge when the plot it is placed inside runs past one.
 *
 * ApexCharts already flips a horizontal bar's tooltip — see `placeHorizontalSharedTooltip` — but it
 * flips *within the plot box*, and these timelines are four 36px rows. A 232px card has no room above
 * or below inside 144px of grid, so the library keeps its first answer and writes a negative `top`.
 * Measured on the pull timeline with the hovered row scrolled to the top of the window: the proc
 * card landed at y = -199, i.e. 199px of it above the window, and every card on every row was cut off
 * the same way. Nothing in the library's options reaches this: `tooltip.fixed` pins the card to a
 * corner of the *chart*, which is off-screen in exactly the case that needs fixing.
 *
 * So the library's answer is corrected rather than replaced, and three things keep that from becoming
 * a fight over the same property on every mouse move:
 *
 *  - it runs from a `MutationObserver` on the tooltip's `style`, so it is a reaction to a placement
 *    rather than a second placement racing it, and it does no work when the pointer moves without
 *    moving the card;
 *  - it reads the position out of the inline style — the value ApexCharts just asked for — and never
 *    out of the rendered box, so it cannot read back its own correction and correct it again;
 *  - it writes `transform`, which the library neither reads nor sets, so `left` and `top` stay the
 *    library's to own.
 *
 * `takeRecords` closes the last of it: our own write queues a record, and dropping it is what keeps
 * one correction from calling itself back.
 */
export function keepTooltipInView(root: HTMLElement): () => void {
	const card = root.querySelector<HTMLElement>('.apexcharts-tooltip');
	if (card === null) return () => {};

	const place = () => {
		// The chart canvas, which is what `left` and `top` are measured from.
		const canvas = card.offsetParent;
		const left = Number.parseFloat(card.style.left);
		const top = Number.parseFloat(card.style.top);
		// Before the first placement there is nothing to correct, and nothing to read.
		if (canvas === null || Number.isNaN(left) || Number.isNaN(top)) return;

		const origin = canvas.getBoundingClientRect();
		const width = card.offsetWidth;
		const height = card.offsetHeight;
		const wantX = origin.left + left;
		const wantY = origin.top + top;

		let y = wantY;
		if (y < TIP_EDGE_PX) {
			const below = pointerY + TIP_FLIP_PX;
			// Below the pointer when the card fits there, and hard against the top of the window when it
			// fits in neither place — a card taller than the window is clipped at one end whatever we do,
			// and clipped at the bottom is the end whose first line the reader still gets.
			y = below + height <= window.innerHeight - TIP_EDGE_PX ? below : TIP_EDGE_PX;
		} else if (y + height > window.innerHeight - TIP_EDGE_PX) {
			y = Math.max(TIP_EDGE_PX, window.innerHeight - TIP_EDGE_PX - height);
		}

		// The left edge is applied second so that a card still wider than the window sits flush with the
		// side the reading starts on.
		let x = wantX;
		if (x + width > window.innerWidth - TIP_EDGE_PX) x = window.innerWidth - TIP_EDGE_PX - width;
		if (x < TIP_EDGE_PX) x = TIP_EDGE_PX;

		const shift = x === wantX && y === wantY ? '' : `translate(${x - wantX}px, ${y - wantY}px)`;
		if (card.style.transform !== shift) card.style.transform = shift;
	};

	const watch = new MutationObserver(() => {
		place();
		watch.takeRecords();
	});
	watch.observe(card, { attributeFilter: ['style'] });
	return () => watch.disconnect();
}

export function baseChart(args: BaseChartArgs): NonNullable<ApexOptions['chart']> {
	const { theme } = args;
	return {
		id: args.id,
		group: args.group,
		type: args.type,
		height: args.height,
		background: 'transparent',
		foreColor: theme.muted,
		fontFamily: theme.sans,
		parentHeightOffset: 0,
		animations: { enabled: args.animate },
		// `pan` rather than `zoom` as the default drag tool: on a touch screen a drag that selects a
		// zoom region fights the reader's instinct to scrub, and a tap still raises the tooltip.
		toolbar: args.scrubbable
			? {
					show: true,
					autoSelected: 'pan',
					tools: {
						download: false,
						selection: false,
						zoom: false,
						zoomin: true,
						zoomout: true,
						pan: true,
						reset: true,
					},
				}
			: { show: false },
		zoom: args.scrubbable
			? {
					enabled: true,
					type: 'x',
					allowMouseWheelZoom: false,
					pinch: true,
				}
			: { enabled: false },
		// Cast because the shipped typings understate the runtime contract: they declare `beforeZoom`
		// as returning `boolean | void`, while ApexCharts documents and honours a returned
		// `{ xaxis: { min, max } }` as the corrected range. Without that return there is no way to
		// refuse a zoom, only to observe one.
		...(args.scrubbable && args.durationMs
			? ({ events: boundsWithin(args.durationMs, args.onView) } as unknown as Pick<
					NonNullable<ApexOptions['chart']>,
					'events'
				>)
			: {}),
	};
}

export function baseGrid(theme: ChartTheme): ApexOptions['grid'] {
	return {
		borderColor: theme.line,
		strokeDashArray: 0,
		xaxis: { lines: { show: true } },
		yaxis: { lines: { show: false } },
		padding: { top: 0, right: 8, bottom: 0, left: 4 },
	};
}

/** The fight clock axis, shared by the timeline and the bank so `group` sync lines them up. */
export function timeAxis(theme: ChartTheme, durationMs: number, narrow: boolean): ApexOptions['xaxis'] {
	return {
		type: 'numeric',
		min: 0,
		max: narrow ? Math.min(durationMs, NARROW_WINDOW_MS) : durationMs,
		tickAmount: narrow ? 3 : 8,
		axisBorder: { show: false },
		axisTicks: { color: theme.line },
		crosshairs: {
			show: true,
			stroke: { color: theme.muted, width: 1, dashArray: 3 },
		},
		tooltip: { enabled: false },
		labels: {
			style: {
				colors: theme.muted,
				fontSize: LABEL_FONT_SIZE,
				fontFamily: theme.mono,
			},
			formatter: (value: string | number) => fmt(Number(value)),
		},
	};
}

// ------------------------------------------------------------------ tooltip

/**
 * ApexCharts types its tooltip callback argument as `{}`, so the fields it actually passes have to
 * be named here before they can be read.
 */
interface TooltipContext {
	seriesIndex: number;
	dataPointIndex: number;
	w: { config: { series: Array<{ data: Array<{ meta?: unknown }> }> } };
}

/**
 * Reads the `meta` a data point was built with, which is where every tooltip's content lives.
 *
 * The indices passed as arguments are not trustworthy on a multi-row range bar: ApexCharts resolves
 * them from the x-axis, so on the pull timeline — four stacked tracks sharing one clock — hovering a
 * Rising Sun Kick span answered with whatever proc sat at the same moment. `cursorPoint` is set from
 * a hit test at the cursor and knows the row, so it is asked first; the arguments remain the
 * fallback for charts where the cursor is over no mark at all — a line chart, where nearest-on-the-
 * clock is the right answer and returning nothing would show as no tooltip.
 */
function metaTooltip(theme: ChartTheme): NonNullable<ApexOptions['tooltip']>['custom'] {
	return (opts) => {
		const ctx = opts as TooltipContext;
		const at = (s: number, i: number) => ctx.w.config.series[s]?.data[i]?.meta;
		const meta = at(cursorPoint.seriesIndex, cursorPoint.dataPointIndex) ?? at(ctx.seriesIndex, ctx.dataPointIndex);
		return meta === undefined ? '' : tooltip(theme, meta as TipContent);
	};
}

/**
 * Tooltip chrome common to every chart.
 *
 * `intersect` stays `false`. `true` sounds like the fix for a tooltip that answers with the wrong
 * mark — make the cursor hit the mark — but ApexCharts then refuses to open the tooltip at all
 * unless the pointer is inside its own hit box, which on a two-pixel range bar is most of the time
 * nowhere. Measured: with `true` the pull timeline showed no tooltip anywhere.
 *
 * Which point answers is fixed in `metaTooltip` instead, by reading what the library captured under
 * the cursor rather than what it resolved from the x-axis.
 */
export function baseTooltip(theme: ChartTheme, intersect = false): ApexOptions['tooltip'] {
	return {
		enabled: true,
		shared: false,
		intersect,
		custom: metaTooltip(theme),
	};
}
