import { useCallback, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApexOptions } from 'apexcharts';

import type { Analysis, AuraLane } from '~/lib/types';

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
	/** A counter's charge-level steps, each labelled with the level it held. */
	stacks?: Array<{ start: number; end: number; count: number }>;
}

/**
 * The rows as the reader expects them: the auras and the buttons in the spec's declared order, each
 * button's presses folded onto its own row and onto its aura's row where one exists — so a cast and
 * the buff it puts up are one row, and a pure button (Lava Burst) sits below the proc that feeds it.
 *
 * When the spec names a summary set, only those lanes are drawn and the presses are left out — the
 * summary is "what the pull turned on", not "what the player pressed".
 */
function buildRows(analysis: Analysis, rowOrder: readonly string[], summaryKeys: readonly string[] | null): Row[] {
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

	// The Lightning Shield counter, drawn as one bar per spend cycle rather than one per stack gain: a
	// cycle runs from the shield emptying (a spend, or the pull's first stacks) to the next spend, and
	// the label is the peak the shield reached before that spend — "1-4 → spend" is one bar labelled 4,
	// "1-7 → spend" one labelled 7. The gains inside a cycle are noise; the peak and the empty are what
	// a reader wants.
	const shield = (analysis as Analysis & { lightningShield?: { points: Array<[number, number]> } }).lightningShield;
	if (shield !== undefined && shield.points.length > 0) {
		const stacks: NonNullable<Row['stacks']> = [];
		let rangeStart: number | null = null;
		let peak = 0;
		for (const [t, level] of shield.points) {
			if (rangeStart === null) {
				if (level > 0) {
					rangeStart = t;
					peak = level;
				}
				continue;
			}
			if (level === 0) {
				stacks.push({ start: rangeStart, end: t, count: peak });
				rangeStart = null;
				peak = 0;
			} else {
				peak = Math.max(peak, level);
			}
		}
		if (rangeStart !== null) stacks.push({ start: rangeStart, end: analysis.durationMs, count: peak });
		byName.set('Lightning Shield', {
			name: 'Lightning Shield',
			id: 324,
			tone: 'kick',
			windows: [],
			presses: [],
			stacks,
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
				meta: {
					title: row.name,
					tone: row.tone,
					rows: [['pressed at', formatStamp(t)]],
				},
			});
		}
		for (const step of row.stacks ?? []) {
			spans.push({
				x: row.name,
				y: [step.start, Math.max(step.end, step.start + floor)],
				fillColor: theme[row.tone],
				count: `${step.count}`,
				meta: {
					title: row.name,
					tone: row.tone,
					rows: [
						['from', formatStamp(step.start)],
						['to', formatStamp(step.end)],
						['stacks', `${step.count}`],
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
	const rows = useMemo(() => buildRows(analysis, rowOrder, summaryKeys), [analysis, rowOrder, summaryKeys]);
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
				stroke: { width: 0 },
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
