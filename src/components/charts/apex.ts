// Everything the four charts share: the palette, the base chart options, and the tooltip markup.
//
// This file is deliberately free of JSX and of any top-level reference to `window`, so it can be
// imported by a module that Astro prerenders. ApexCharts itself is never imported here except as a
// type — `import type` is erased, and the library only ever loads from ApexChart's effect.

import type { ApexOptions } from 'apexcharts';

import { fmt } from '../format';

// ------------------------------------------------------------------ palette

/**
 * The semantic tokens from `src/styles/global.css`, read off the document at runtime.
 *
 * Read rather than duplicated on purpose: ApexCharts writes colours into SVG presentation
 * attributes, which do not accept `var(--color-brew)`, so the values have to be resolved in JS. A
 * second copy of the hexes here is a copy that would silently drift from the stylesheet.
 */
export interface ChartTheme {
	bg: string;
	surface: string;
	raised: string;
	line: string;
	ink: string;
	ink2: string;
	muted: string;
	brew: string;
	rune: string;
	kick: string;
	miss: string;
	missSoft: string;
	track: string;
	mono: string;
	sans: string;
}

const TOKENS: Record<keyof ChartTheme, string> = {
	bg: '--color-bg',
	surface: '--color-surface',
	raised: '--color-raised',
	line: '--color-line',
	ink: '--color-ink',
	ink2: '--color-ink-2',
	muted: '--color-muted',
	brew: '--color-brew',
	rune: '--color-rune',
	kick: '--color-kick',
	miss: '--color-miss',
	missSoft: '--color-miss-soft',
	track: '--color-track',
	mono: '--font-mono',
	sans: '--font-sans',
};

export function readTheme(): ChartTheme {
	const style = getComputedStyle(document.documentElement);
	const out = {} as ChartTheme;
	for (const key of Object.keys(TOKENS) as Array<keyof ChartTheme>) {
		out[key] = style.getPropertyValue(TOKENS[key]).trim();
	}
	return out;
}

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
 * The 14px floor the rest of the page keeps to, applied inside the charts as well.
 *
 * Chart text used to sit at 10–11px. ApexCharts writes a fixed pixel size into the SVG, so it does
 * not shrink with the viewport — it was simply small. Raising it costs plot width on a phone, which
 * is what the shorter opening window below and the shortened track names in the timeline pay for.
 */
export const LABEL_FONT_SIZE = '14px';

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
export function boundsWithin(durationMs: number) {
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

	return {
		beforeZoom: (_chart: unknown, { xaxis }: { xaxis: { min: number; max: number } }) => ({
			xaxis: clamp(xaxis.min, xaxis.max),
		}),
		beforeResetZoom: () => ({ xaxis: { min: 0, max: durationMs } }),
		scrolled: (
			chart: { zoomX?: (min: number, max: number) => void },
			{ xaxis }: { xaxis: { min: number; max: number } },
		) => {
			const held = clamp(xaxis.min, xaxis.max);
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
			? ({ events: boundsWithin(args.durationMs) } as unknown as Pick<
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

export interface TipContent {
	title: string;
	tone: keyof ChartTheme;
	rows: Array<[string, string]>;
}

const escape = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Tooltip markup, built by hand because ApexCharts' own tooltip is styled from its light/dark
 * themes rather than from this app's tokens.
 */
function tip(theme: ChartTheme, content: TipContent): string {
	const rows = content.rows
		.map(
			([label, value]) =>
				`<div style="display:flex;gap:14px;justify-content:space-between"><span style="color:${theme.muted}">${escape(label)}</span><span style="color:${theme.ink};font-weight:600">${escape(value)}</span></div>`,
		)
		.join('');
	return (
		// `pointer-events:none` so the tooltip cannot become the element a hit test finds: it follows
		// the cursor closely enough to sit under it, and would then hide the mark it is describing.
		`<div style="pointer-events:none;min-width:210px;padding:10px 12px;background:${theme.surface};border:1px solid ${theme.line};` +
		`border-radius:3px;font-family:${theme.mono};font-size:${LABEL_FONT_SIZE};line-height:1.6">` +
		`<div style="margin-bottom:5px;font-weight:600;color:${theme[content.tone]}">${escape(content.title)}</div>` +
		rows +
		'</div>'
	);
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
		return meta === undefined ? '' : tip(theme, meta as TipContent);
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
