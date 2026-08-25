import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApexOptions } from 'apexcharts';

import { DROP_MS } from '~/lib/analysis/auras';
import { formatSeconds, formatStamp } from '~/lib/format';
import type { ResourceCurve } from '~/lib/types';

import type { ChartEnv } from './ApexChart';
import ApexChart from './ApexChart';
import type { ChartTheme, TipContent } from './apex';
import { LABEL_FONT_SIZE, baseChart, baseGrid, baseTooltip, timeAxis } from './apex';

/**
 * Row height, on a 4px grid shared by every chart in the report.
 *
 * 36 is the pitch of everything drawn against the pull clock. The pull timeline and the Rising Sun
 * Kick debuff carry a 24px icon beside each row, and 36 clears it without leaving the row mostly
 * empty; the uptime tracks carry no icon but sit under the same pull and keep the same pitch anyway,
 * because two timelines of one pull drawn at two pitches read as two different tools. 24 is for rows
 * that are text rather than a clock lane — `SpiritLanes`, whose rows are enemy names.
 *
 * Picked as a grid rather than per chart: five charts had five heights (32, 34, 38, 46, 34), which is
 * five arbitrary numbers rather than a system.
 */
const ROW_HEIGHT = 36;
/**
 * Everything in the chart's height that is not a row: the clock axis and the margins around it.
 *
 * 92, matching the pull timeline exactly, and that is the point rather than a coincidence. ApexCharts
 * is given a total height and divides whatever is left after its own chrome among the categories — so
 * this number is a *claim* about how much chrome there will be, and an over-estimate does not add
 * padding, it fattens every row. Reserving 96 against 92 of real chrome spread the surplus across
 * three rows and drew them at 37.3px, next to a pull timeline drawing 36 from the same declared grid.
 *
 * Every chart built from this component runs the same `timeAxis`, no legend, no title and zero
 * vertical grid padding, so their chrome is the same and the number has to be. Changing this without
 * changing the pull timeline puts two timelines of one pull at two pitches again — which is the whole
 * reason the pair now lives in one file instead of being copied into each chart that wanted a track.
 */
const CHROME = 92;

/**
 * A gap of a second or two is a real drop but too thin to hover, so a span that size is drawn at
 * least this wide and its true length is left to the tooltip.
 */
const minimumSpan = (durationMs: number) => durationMs / 400;

/** One rangeBar datum: an ApexCharts point with the tooltip's content carried alongside it. */
interface Span {
	x: string;
	y: [number, number];
	fillColor: string;
	meta: TipContent;
}

/** One row of the chart: a set of windows on the pull clock, and what they mean. */
export interface Track {
	/**
	 * The row's y-axis label, and the title of every tooltip it raises.
	 *
	 * Resolved copy, passed in rather than looked up here: this component holds no sentences, and the
	 * rows are not always copy at all — the Stormlash chart names a row after a shaman in the log.
	 */
	label: string;
	/**
	 * Palette token the row's bars are painted with — named for what the row means, never for a colour.
	 *
	 * A row that draws time the section's denominator *dropped* — an intermission, a slot something
	 * else was holding — takes `EXEMPT` from `./tones` rather than a token of its own choosing. Three
	 * charts drew such a row and two of them disagreed about which grey it was; the note beside
	 * `EXEMPT` is why there is now one answer.
	 */
	tone: keyof ChartTheme;
	windows: ReadonlyArray<readonly [number, number]>;
	/**
	 * The tooltip's second row: what a span of *this* row is. "held for", "without it for", "out for".
	 *
	 * Per row rather than one wording for the chart, because the reader is being told two different
	 * things by two bars of the same length — one is coverage they earned and one is time they lost.
	 */
	lengthLabel: string;
	/**
	 * Whether every span of this row is widened to `minimumSpan`, or only those at or above `DROP_MS`.
	 *
	 * Defaults to widening everything, and `false` does **not** mean "never widen" — it means "widen
	 * only what is long enough to be a real gap". That qualifier is load-bearing on any track that
	 * fragments. These tracks follow every enemy the player touched rather than one boss, so they do:
	 * measured on the reference pulls, a Spoils of Pandaria kill draws 224 spans on the Rising Sun Kick
	 * down track with a median length of 0.1s, and a Garrosh kill 75 with a median of 0.1s. Widening
	 * every one of those to the floor paints about 206 seconds of red on a track whose real total is
	 * 120 — a picture contradicting the tile directly above it. Below a second is refresh jitter by the
	 * same constant the drop list uses, and jitter drawn as a visible bar is a fault the pull did not
	 * have. Left at true width it is a fraction of a pixel, which is what it deserves.
	 *
	 * It is a per-row choice and not a property of this component because the two halves pull opposite
	 * ways, and which way a given row goes is a fact about the data behind it:
	 *
	 * - A **fault** row (`miss`) must be gated wherever it fragments. Overstating a fault is the worst
	 *   thing this chart can do, because the fault is the finding.
	 * - A **coverage** row must not be gated where its windows are whole auras. A genuine sub-second
	 *   window — a dot on an add that died, a totem re-laid at once — is real coverage, and leaving it
	 *   sub-pixel hides it, which is the opposite of what the gate is for. The Elemental copies gated
	 *   their up rows and made exactly that coverage vanish.
	 * - A **counted** row must not be gated at all, gated or not: if the tiles above count each span
	 *   individually, a span drawn too small to see contradicts a number the reader can read.
	 */
	widen?: boolean;
}

/**
 * A set of labelled tracks laid on the pull clock: where something was up, where it was not, and
 * where the question did not apply.
 *
 * This is the shape four charts were each writing out for themselves — the Rising Sun Kick debuff,
 * Flame Shock and Searing Totem uptime, and the raid's Stormlash totems — down to the same eight
 * option keys, the same 92, and the same span floor. What differed between them was only ever the
 * rows, so the rows are the argument.
 *
 * **Tracks partition, they do not overlap.** Every caller draws rows that between them account for
 * the whole pull with nothing left over and nothing counted twice, and every row is a measurement
 * some tile above the chart also prints. That is what makes the picture checkable against the number:
 * a track whose union is not a figure the section states is a picture the reader cannot verify.
 *
 * **No sliver filter here, deliberately.** `DebuffTimeline` discards sub-second gaps when it derives
 * its "nothing to hit" row, and the Elemental charts discard nothing when they derive theirs. Both
 * are right, and the difference is not this component's to settle: a sliver either side of a
 * `contactSegments` boundary is the sampling rather than a phase, whereas a sliver between two aura
 * windows is a real, if brief, drop. Filtering here would mean drawing less than the array it was
 * handed, on a chart whose entire claim is that its rows *are* the arrays the tiles were measured on
 * — so a row would quietly stop adding up to the number above it. Widening is how a sliver is kept
 * from overstating itself; removing it is a decision about what the data means, and that belongs
 * where the windows are derived.
 */
export default function WindowTracks({
	tracks,
	chartId,
	durationMs,
	label,
	behind,
}: {
	/**
	 * The rows, top to bottom. Empty ones are dropped — see `drawn`.
	 *
	 * **Memoise this.** It is a dependency of the draw, so an array rebuilt on every parent render
	 * destroys and re-renders the ApexCharts instance on every parent render.
	 */
	tracks: readonly Track[];
	/** The ApexCharts instance id. Distinct per chart, since the library keys its registry on it. */
	chartId: string;
	durationMs: number;
	/** Describes the finished picture for a reader who cannot see it. */
	label: string;
	/**
	 * A curve drawn *behind* the rows, on the same time axis and inside the same plot area.
	 *
	 * **Why this is an overlay and not a second chart.** ApexCharts cannot mix a time-series line into a
	 * horizontal `rangeBar`: the bars run along x, so the y-axis is the row *labels* — a categorical
	 * scale with no room for a number. Stacking a second chart above gets the alignment right and
	 * answers a different question, because the reader has to carry their eye between two plots to ask
	 * which window sat under which part of the curve.
	 *
	 * So the curve is its own SVG, positioned over the library's plot rectangle. The rectangle is
	 * **measured rather than assumed** — ApexCharts sizes its left gutter from the widest y-axis label,
	 * which changes with the rows, the breakpoint and the font — by reading `.apexcharts-grid`'s own box
	 * after render and again whenever the element resizes. Guessing it from `grid.padding` would line up
	 * on one chart and drift on the next.
	 */
	behind?: { curve: ResourceCurve; label: string; stroke: string; fill: string };
}) {
	/**
	 * Only the rows that have something in them.
	 *
	 * ApexCharts derives its categories from the data, so a track with no windows produces no row —
	 * and reserving height for it is the over-estimate `CHROME` warns about, spread across the rows
	 * that did draw. A pull with nothing to say on one track then draws its other two at 54px instead
	 * of 36, beside a pull timeline at 36.
	 *
	 * Dropping the row rather than drawing an empty one is also the honest picture: a labelled lane
	 * with nothing in it invites the reader to look for the bar they cannot find.
	 */
	const drawn = useMemo(() => tracks.filter((track) => track.windows.length > 0), [tracks]);
	const height = drawn.length * ROW_HEIGHT + CHROME;

	const build = useCallback(
		({ theme, narrow, animate, touch }: ChartEnv): ApexOptions => {
			const floor = minimumSpan(durationMs);
			const spans = drawn.flatMap(({ label: row, tone, windows, lengthLabel, widen = true }) =>
				windows.map(([start, end]): Span => ({
					x: row,
					y: [start, widen || end - start >= DROP_MS ? Math.max(end, start + floor) : end],
					fillColor: theme[tone] as string,
					meta: {
						title: row,
						tone,
						rows: [
							['from', formatStamp(start)],
							[lengthLabel, formatSeconds(end - start)],
						],
					},
				})),
			);

			return {
				chart: {
					...baseChart({
						id: chartId,
						type: 'rangeBar',
						height,
						theme,
						animate,
						scrubbable: true,
						durationMs,
						touch,
					}),
				},
				// One series for every row: the tracks are one measurement split by state, not several
				// measurements to compare, and the series name is never read — the legend is off and the
				// tooltip is rendered from `meta` rather than from the series.
				series: [{ name: 'tracks', data: spans }],
				// Bars fill their row: it is the lane, and one floating inside it reads as something
				// smaller than the lane it belongs to.
				plotOptions: { bar: { horizontal: true, barHeight: '92%', borderRadius: 2, rangeBarGroupRows: false } },
				dataLabels: { enabled: false },
				legend: { show: false },
				stroke: { width: 0 },
				grid: baseGrid(theme),
				xaxis: timeAxis(theme, durationMs, narrow),
				yaxis: {
					labels: {
						maxWidth: narrow ? 96 : 150,
						style: { colors: theme.ink2, fontSize: LABEL_FONT_SIZE, fontFamily: theme.mono },
					},
				},
				tooltip: baseTooltip(theme),
			};
		},
		[chartId, durationMs, drawn, height],
	);

	if (behind === undefined) return <ApexChart build={build} height={height} label={label} />;
	return (
		<Overlaid behind={behind} durationMs={durationMs}>
			<ApexChart build={build} height={height} label={label} />
		</Overlaid>
	);
}

/**
 * The curve, laid into the chart's own plot rectangle.
 *
 * Behind the bars in paint order and inert to the pointer, so the tooltip, the scrub and the keyboard
 * path all still belong to the chart. It draws nothing until the rectangle has been measured, which is
 * the honest state: an overlay at the wrong offset is worse than one that arrives a frame late.
 */
function Overlaid({
	behind,
	durationMs,
	children,
}: {
	behind: { curve: ResourceCurve; label: string; stroke: string; fill: string };
	durationMs: number;
	children: React.ReactNode;
}) {
	const host = useRef<HTMLDivElement>(null);
	const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

	useEffect(() => {
		const element = host.current;
		if (element === null) return;

		const measure = () => {
			const grid = element.querySelector('.apexcharts-grid');
			if (grid === null) return false;
			const outer = element.getBoundingClientRect();
			const inner = grid.getBoundingClientRect();
			if (inner.width <= 0) return false;
			setBox({
				left: inner.left - outer.left,
				top: inner.top - outer.top,
				width: inner.width,
				height: inner.height,
			});
			return true;
		};

		// The chart imports ApexCharts lazily and draws on a later tick, so the grid does not exist yet on
		// the first pass. Poll briefly rather than racing it, then stop: a chart that never drew is a
		// chart with nothing to align to.
		let tries = 0;
		const timer = window.setInterval(() => {
			tries += 1;
			if (measure() || tries > 40) window.clearInterval(timer);
		}, 50);

		const observer = new ResizeObserver(() => measure());
		observer.observe(element);
		return () => {
			window.clearInterval(timer);
			observer.disconnect();
		};
	}, []);

	const path = useMemo(() => {
		if (box === null) return '';
		const span = Math.max(1, durationMs);
		const max = Math.max(1, behind.curve.max);
		const x = (t: number) => (t / span) * box.width;
		const y = (v: number) => box.height - (v / max) * box.height;
		return behind.curve.points
			.map(([t, v], i) => `${i === 0 ? 'M' : 'L'}${x(t).toFixed(1)} ${y(v).toFixed(1)}`)
			.join('');
	}, [behind.curve, box, durationMs]);

	return (
		<div ref={host} className="relative">
			{box === null || path === '' ? null : (
				<svg
					className="pointer-events-none absolute"
					style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
					viewBox={`0 0 ${box.width} ${box.height}`}
					preserveAspectRatio="none"
					aria-hidden="true"
				>
					<path d={`${path}L${box.width.toFixed(1)} ${box.height}L0 ${box.height}Z`} fill={behind.fill} stroke="none" />
					<path d={path} fill="none" stroke={behind.stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
				</svg>
			)}
			{children}
		</div>
	);
}
