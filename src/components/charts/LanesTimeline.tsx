import { useCallback, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApexOptions } from 'apexcharts';

import type { Analysis, AuraLane } from '~/lib/types';
import type { CounterLoad, TimelineCounter } from '~/lib/view/timelineBanks';

import { formatSeconds, formatStamp } from '~/lib/format';

import { fmt } from '../format';
import { ChartFigure } from '../primitives';
import ChartKey from './ChartKey';
import TrackLabels, { type Track } from './TrackLabels';
import type { ChartEnv } from './ApexChart';
import ApexChart from './ApexChart';
import ChartEmpty from './ChartEmpty';
import type { ChartTheme, TipContent } from './apex';
import { LABEL_FONT_SIZE, NARROW_QUERY, baseChart, baseGrid, baseTooltip, timeAxis } from './apex';
import { SpecContext } from '~/components/report/specContext';
import { ROW_ORDERS, EMPTY_ROW_ORDER, SUMMARY_LANE_KEYS, rowRank } from './timelineOrder';

/**
 * Row height, on the 4px grid shared by every chart. 36 for the two that carry an icon beside each
 * row, so a 24px icon is not squeezed; 24 for the rest.
 */
const ROW_HEIGHT = 36;
const CHROME = 92;
const LABEL_PX = 172;
const NARROW_LABEL_PX = 84;
const GRID_PADDING = { top: 0, right: 22, bottom: 0 };

/**
 * A window's colour is its kind, not a verdict: a buff is amber, a proc violet, a debuff the spec's
 * own accent, and a press the spec's accent too — it is the spec's own button.
 */
const GROUP_TONE: Record<AuraLane['group'], keyof ChartTheme> = {
	buff: 'brew',
	proc: 'rune',
	debuff: 'kick',
};
const CAST_TONE: keyof ChartTheme = 'kick';

interface Span {
	x: string;
	y: [number, number];
	fillColor: string;
	/**
	 * The hairline around this bar, which is how two bars that touch read as two.
	 *
	 * Its own fill for everything that stands alone, so nothing about those bars changes. The page's
	 * own ground for the shield's loads, which tile the pull — one load ends exactly where the next
	 * begins, because Fulmination is both the end of one and the start of the next — and thirteen of
	 * them abutting draw as the one wide bar this row used to be.
	 *
	 * A stroke rather than a slice off each bar's end, because the slice does not survive the zoom:
	 * a gutter of `minimumSpan` is a pixel across the whole pull and half a second of missing bar once
	 * the reader scrubs in, and this chart pans and zooms. A stroke is a pixel at every scale, and it
	 * moves neither end of the bar off the timestamp the log gave it.
	 */
	strokeColor: string;
	meta: TipContent;
	/** Drawn beside the bar as a data label — a counter's charge, not a plain window's nothing. */
	count?: string;
}

/** A span shorter than this is a sliver too thin to hover, so it is drawn at this width. */
const minimumSpan = (durationMs: number) => durationMs / 400;

interface Row {
	name: string;
	id: number;
	tone: keyof ChartTheme;
	windows: Array<[number, number]>;
	presses: number[];
	/**
	 * A counter's loads, when the spec draws one on this row: one entry per load it built and let go of.
	 *
	 * Handed over by `spec.timelineCounters`, cut and labelled there — the chart draws the bars and
	 * never learns what fills the counter. `CounterLoad.spent` is what decides whether the charge is
	 * written on the bar; `buildSpans` is where that happens.
	 */
	loads?: CounterLoad[];
}

/**
 * The rows as the reader expects them: the auras and the buttons in the spec's declared order, each
 * button's presses folded onto its own row and onto its aura's row where one exists — so a cast and
 * the buff it puts up are one row, and a pure button (Lava Burst) sits below the proc that feeds it.
 *
 * When the spec names a summary set, only those lanes are drawn and the presses are left out — the
 * summary is "what the pull turned on", not "what the player pressed".
 */
function buildRows(
	analysis: Analysis,
	counters: readonly TimelineCounter[],
	rowOrder: readonly string[],
	summaryKeys: readonly string[] | null,
): Row[] {
	const lanes = analysis.timeline?.lanes ?? [];
	const casts = analysis.timeline?.casts ?? [];
	const byName = new Map<string, Row>();

	for (const lane of lanes) {
		if (summaryKeys !== null && !summaryKeys.includes(lane.key)) continue;
		const tone = GROUP_TONE[lane.group];
		const row = byName.get(lane.name) ?? { name: lane.name, id: lane.id, tone, windows: [], presses: [] };
		row.windows.push(...lane.windows.map((w): [number, number] => [w.start, w.end]));
		byName.set(lane.name, row);
	}
	if (summaryKeys === null) {
		for (const mark of casts) {
			const row = byName.get(mark.name) ?? { name: mark.name, id: mark.id, tone: CAST_TONE, windows: [], presses: [] };
			row.presses.push(mark.t);
			byName.set(mark.name, row);
		}
	}

	// The spec's own counters, each as a row of loads — the Elemental's Lightning Shield today. One bar
	// per load rather than one per stack gain, because what a reader wants is what the spend threw away
	// and not the fillers that built it; `counterLoads` carries the evidence for where a load ends.
	//
	// `set` rather than a merge, exactly as before: a counter row is its own drawing, so a lane or a
	// press row of the same name is replaced rather than drawn over. Map insertion order is preserved
	// for a key that was already present, so replacing one does not move it.
	for (const counter of counters) {
		byName.set(counter.name, {
			name: counter.name,
			id: counter.id,
			tone: counter.tone,
			windows: [],
			presses: [],
			loads: counter.loads,
		});
	}

	// The declared order leads; rows nobody named keep the order the engine produced.
	return [...byName.values()].sort((a, b) => {
		const diff = rowRank([a.name], rowOrder) - rowRank([b.name], rowOrder);
		return diff !== 0 ? diff : (a.windows[0]?.[0] ?? a.presses[0] ?? 0) - (b.windows[0]?.[0] ?? b.presses[0] ?? 0);
	});
}

function buildSpans(rows: readonly Row[], durationMs: number, theme: ChartTheme): Span[] {
	const floor = minimumSpan(durationMs);
	const spans: Span[] = [];
	for (const row of rows) {
		for (const [start, end] of row.windows) {
			spans.push({
				x: row.name,
				y: [start, Math.max(end, start + floor)],
				fillColor: theme[row.tone],
				strokeColor: theme[row.tone],
				meta: {
					title: row.name,
					tone: row.tone,
					rows: [
						['from', formatStamp(start)],
						['to', formatStamp(end)],
						['up for', formatSeconds(end - start)],
					],
				},
			});
		}
		for (const t of row.presses) {
			spans.push({
				x: row.name,
				y: [t, t + floor],
				fillColor: theme[row.tone],
				strokeColor: theme[row.tone],
				meta: {
					title: row.name,
					tone: row.tone,
					rows: [['pressed at', formatStamp(t)]],
				},
			});
		}
		for (const load of row.loads ?? []) {
			spans.push({
				x: row.name,
				y: [load.start, Math.max(load.end, load.start + floor)],
				fillColor: theme[row.tone],
				strokeColor: theme.bg,
				// Only a load that ended in a spend carries a figure, because the figure *is* the spend —
				// the same number the Lightning Shield section writes over each fall in its own chart, and
				// the same one its bad-spend table lists.
				...(load.spent ? { count: `${load.held}` } : {}),
				meta: {
					title: row.name,
					tone: row.tone,
					rows: [
						['from', formatStamp(load.start)],
						['to', formatStamp(load.end)],
						['stacks', `${load.held}`],
					],
				},
			});
		}
	}
	return spans;
}

/**
 * The auras and the buttons on one clock, in the spec's declared order — the distilled "what was up,
 * and what was pressed" that the graded sections argue from.
 */
export default function LanesTimeline({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const spec = useContext(SpecContext);
	const rowOrder = ROW_ORDERS[spec.key] ?? EMPTY_ROW_ORDER;
	const summaryKeys = SUMMARY_LANE_KEYS[spec.key] ?? null;
	// Memoised on its own, not read inline: a spec that has a counter builds a fresh array per call, and
	// a fresh array here would give `rows` — and so `build`, and so the ApexCharts instance — a new
	// identity on every render, tearing the chart down and redrawing it each time.
	const counters = useMemo(() => spec.timelineCounters(analysis), [spec, analysis]);
	const rows = useMemo(
		() => buildRows(analysis, counters, rowOrder, summaryKeys),
		[analysis, counters, rowOrder, summaryKeys],
	);
	const height = rows.length * ROW_HEIGHT + CHROME;

	const build = useCallback(
		({ theme, narrow, animate, touch }: ChartEnv): ApexOptions => {
			const spans = buildSpans(rows, analysis.durationMs, theme);
			// Read by index in the data-label formatter, whose `opts` ApexCharts types too loosely to
			// reach the point through — the counter's charge, and nothing on the plain window rows.
			const counts = spans.map((s) => s.count ?? '');
			return {
				chart: {
					...baseChart({
						id: 'lanes-timeline',
						type: 'rangeBar',
						height,
						theme,
						animate,
						scrubbable: true,
						touch,
						durationMs: analysis.durationMs,
					}),
				},
				series: [{ name: 'spans', data: spans }],
				plotOptions: { bar: { horizontal: true, barHeight: '92%', borderRadius: 2, rangeBarGroupRows: false } },
				dataLabels: {
					enabled: !narrow,
					formatter: (_value, opts) => counts[(opts as unknown as { dataPointIndex: number }).dataPointIndex] ?? '',
					textAnchor: 'start',
					offsetX: 5,
					style: { colors: [theme.ink], fontFamily: theme.mono, fontSize: LABEL_FONT_SIZE, fontWeight: 600 },
				},
				legend: { show: false },
				// One pixel, and what it is for is on `Span.strokeColor`: every bar is outlined in its own
				// fill and is therefore unchanged, and the shield's loads are outlined in the ground so a
				// run of them reads as a run. Width has to be set here — ApexCharts skips a data point's
				// `strokeColor` entirely while the series stroke is zero.
				stroke: { width: 1 },
				grid: { ...baseGrid(theme), padding: { ...GRID_PADDING, left: narrow ? NARROW_LABEL_PX : LABEL_PX } },
				xaxis: timeAxis(theme, analysis.durationMs, narrow),
				yaxis: { labels: { show: false } },
				tooltip: baseTooltip(theme),
			};
		},
		[rows, analysis.durationMs, height],
	);

	if (rows.length === 0) {
		return <ChartEmpty>{t('timeline.lanes.empty')}</ChartEmpty>;
	}

	const narrow = typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches;
	const tracks: Track[] = rows.map((row) => ({ iconId: row.id, label: row.name }));

	return (
		<ChartFigure
			gap="wide"
			caption={
				<>
					<ChartKey tone="kick">{t('timeline.lanes.key.press')}</ChartKey>
					<ChartKey tone="brew">{t('timeline.lanes.key.buff')}</ChartKey>
					<ChartKey tone="rune">{t('timeline.lanes.key.proc')}</ChartKey>
				</>
			}
		>
			<div className="relative">
				<TrackLabels tracks={tracks} width={narrow ? NARROW_LABEL_PX : LABEL_PX} />
				<ApexChart
					build={build}
					height={height}
					label={`Timeline of the ${fmt(analysis.durationMs)} pull, ${rows.length} rows`}
				/>
			</div>
		</ChartFigure>
	);
}
