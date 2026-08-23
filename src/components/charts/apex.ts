// Everything the four charts share: the palette, the base chart options, and the tooltip markup.
//
// This file is deliberately free of JSX and of any top-level reference to `window`, so it can be
// imported by a module that Astro prerenders. ApexCharts itself is never imported here except as a
// type — `import type` is erased, and the library only ever loads from ApexChart's effect.

import type { ApexOptions } from 'apexcharts';

import { TIP_TITLE } from './tones';
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
	lust: string;
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
	// Here for one caller: the cast timeline tints a Bloodlust band's tooltip title with the colour the
	// band itself is drawn in, which is the pairing rule `charts/tones.ts` exists to enforce.
	lust: '--color-lust',
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
			? ({ events: boundsWithin(args.durationMs) } as unknown as Pick<NonNullable<ApexOptions['chart']>, 'events'>)
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
 * One line of a tooltip: a label, its value, and optionally an icon drawn before the value.
 *
 * The third slot exists for the rows whose value is a *spell* — the cast timeline names the press
 * that spent a buff, and a reader recognises a spell by its art before they read its name, exactly as
 * they do on the chart itself. It stays a URL rather than a spell id because this module knows about
 * drawing and not about the game, and it stays optional because every other row on every other chart
 * is a number or a clock and has no art to carry.
 */
export type TipRow = [label: string, value: string, iconUrl?: string];

/**
 * The widest a tooltip card may draw, and therefore the point at which a long value stops making the
 * card wider and starts wrapping inside it.
 *
 * Every value on these charts is a number or a clock and fits in the 210px floor below — except the
 * verdicts, which are sentences. `channelled through Energizing Brew with no Rushing Jade Wind
 * covering it` measured the Fists of Fury card at 648px against a 210–330px family, because
 * ApexCharts' own `.apexcharts-tooltip` is `white-space: nowrap` and a card with a floor and no
 * ceiling simply grows to whatever it is handed. Wrapping rather than truncating, because the
 * sentence is the explanation — a reader who cannot finish it has lost the row.
 *
 * The viewport term is the same rule the cast timeline's tip node already keeps (`max-w-[calc(100vw
 * -28px)]`), stated once here for both: a card that has to shrink is one being read on a phone, and
 * the 28px is the two gutters that timeline's placement leaves. Written as one `min()` rather than as
 * a second mechanism on top of that one.
 */
const TIP_MAX_WIDTH = 'min(380px, calc(100vw - 28px))';

export interface TipContent {
	title: string;
	tone: keyof ChartTheme;
	rows: TipRow[];
}

const escape = (value: string): string =>
	// The quotes matter now that one of these lands in an attribute rather than in text.
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The icon that leads a row's value, or nothing at all.
 *
 * Sized to the line rather than to the chart's marks: this sits beside a run of text, so it is the
 * cap height of the font next to it and not the 24px a press is drawn at.
 *
 * It carries no `vertical-align` and no `margin`, because it is a flex item — see the row below. It
 * used to carry both, and both were dead: Tailwind's preflight sets `img { display: block }`, which
 * put the icon on a line of its own and dropped the ability name underneath it. `vertical-align` does
 * nothing to a block box, so the row that was meant to read "icon, then name" read as two lines with
 * nothing tying them together. Making the value a flex line is what fixes that, and inside one the
 * icon's own `display` no longer matters — every flex item is blockified anyway.
 *
 * `flex:none` so the icon is never the thing that gives way when the row is wider than the tooltip:
 * a squeezed spell icon is unrecognisable, which is the entire reason the row carries art at all.
 */
const tipIcon = (url: string | undefined, theme: ChartTheme): string =>
	url === undefined
		? ''
		: `<img src="${escape(url)}" alt="" width="14" height="14" style="flex:none;width:14px;height:14px;` +
			`border-radius:2px;border:1px solid ${theme.line}">`;

/**
 * Which theme colour a title tinted for `tone` is actually drawn in.
 *
 * Almost always the tone itself. The exceptions are the two *grounds* — see `TIP_TITLE` in `tones.ts`
 * for the contrast numbers and for why each substitute is the semantically right colour and not just
 * a legible one. The fallback is the tone, so a `TipContent` naming a theme key that is not a mark
 * tone at all keeps its current behaviour.
 */
const titleTone = (tone: keyof ChartTheme): keyof ChartTheme =>
	(TIP_TITLE as Partial<Record<keyof ChartTheme, keyof ChartTheme>>)[tone] ?? tone;

/**
 * Tooltip markup, built by hand because ApexCharts' own tooltip is styled from its light/dark
 * themes rather than from this app's tokens.
 *
 * Exported because the cast timeline is not an ApexCharts chart and still has to raise a tooltip:
 * it feeds this the same `TipContent` and writes the string into one shared node. Two tooltip
 * designs on one page is exactly what a second implementation there would have produced.
 */
export function tip(theme: ChartTheme, content: TipContent): string {
	// The value is a flex line of its own, not a run of inline content, and that is the fix for a whole
	// *kind* of row rather than for the one caller that hit it. A value made of parts — an icon and the
	// name of the press it stands for — is one thing the reader is meant to read as one thing, and flex
	// items on a line cannot be split across two of them. Written for every row rather than only for the
	// rows that carry art today, because the next row to carry it should not have to rediscover this.
	// The label never wraps and the value does. Both are flex items on a row that is now allowed to be
	// narrower than its content, and without this the two share the shortfall in proportion — which
	// breaks "brewed at" across two lines to buy four characters for a sentence that needs forty.
	const rows = content.rows
		.map(
			([label, value, icon]) =>
				`<div style="display:flex;gap:14px;justify-content:space-between"><span style="white-space:nowrap;color:${theme.muted}">${escape(label)}</span>` +
				`<span style="display:flex;align-items:center;gap:6px;color:${theme.ink};font-weight:600">${tipIcon(icon, theme)}${escape(value)}</span></div>`,
		)
		.join('');
	return (
		// `pointer-events:none` so the tooltip cannot become the element a hit test finds: it follows
		// the cursor closely enough to sit under it, and would then hide the mark it is describing.
		//
		// `white-space:normal` is not the default it looks like: on the ApexCharts charts this card is
		// written into `.apexcharts-tooltip`, which the library styles `nowrap`, and a ceiling with
		// nothing allowed to wrap under it is a box the sentence simply runs out of.
		`<div style="pointer-events:none;min-width:210px;max-width:${TIP_MAX_WIDTH};white-space:normal;padding:10px 12px;background:${theme.surface};border:1px solid ${theme.line};` +
		`border-radius:3px;font-family:${theme.mono};font-size:${LABEL_FONT_SIZE};line-height:1.6">` +
		`<div style="margin-bottom:5px;font-weight:600;color:${theme[titleTone(content.tone)]}">${escape(content.title)}</div>` +
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
