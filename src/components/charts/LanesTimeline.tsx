import { useCallback, useMemo } from 'react';

import { useNarrow } from '~/hooks/useNarrow';
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
import { LABEL_FONT_SIZE, baseChart, baseGrid, baseTooltip, timeAxis } from './apex';
import { useSpec } from '~/components/report/specContext';
import { rowRank } from './timelineOrder';

/**
 * Row height, on the 4px grid shared by every chart. 36 for the two that carry an icon beside each
 * row, so a 24px icon is not squeezed; 24 for the rest.
 */
const ROW_HEIGHT = 36;

/**
 * How much of a row the bar fills, as the fraction `plotOptions.bar.barHeight` is written from.
 *
 * A number rather than the `'92%'` string it used to be written as, because the refresh tick has to be
 * exactly this tall in pixels and a second spelling of the same fraction is a second thing to keep in
 * step. See `REFRESH_TICK.height`.
 */
const BAR_HEIGHT = 0.92;
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

/**
 * The tick a refresh is drawn as: two pixels of the chart's own ground, most of a lane tall.
 *
 * **A tick and not the aura's icon.** The icon was tried first and read as clutter on a summary: this
 * chart's rows are 36px of mostly bar, an icon is a second picture of the row's own label, and a dozen
 * of them down one lane are a row of thumbnails rather than a rhythm. A notch says the one thing the
 * mark is for, that the bar was bought again here, and says it at any width.
 *
 * Painted in `bg` so it reads as a gap cut into the bar rather than as something laid on top of it.
 * That is the same argument `text-bg` makes for the figures written inside a bar on the cast timeline:
 * the ground is the one colour guaranteed to contrast with every tone a bar can take.
 */
const REFRESH_TICK = {
	width: 2,
	/**
	 * Exactly the bar, and floored so it can only ever be shorter.
	 *
	 * `barHeight` is a percentage of the row and the tick is drawn in pixels, so the two have to be
	 * computed from one number or they drift the first time a row changes height: a tick a pixel taller
	 * than the bar hangs out of both ends of it and reads as a divider between rows rather than as a mark
	 * on one. `Math.floor` is which way that error is allowed to fall.
	 */
	height: Math.floor(ROW_HEIGHT * BAR_HEIGHT),
	/**
	 * Black at half strength, which is a shadow rather than a colour.
	 *
	 * The ground was tried first and it reads as a *gap*: a bar cut into two bars, which is the one thing
	 * a renewal is not. A translucent black darkens whichever tone the bar is drawn in and stays the same
	 * mark on all four of them, and needs no entry in the palette to do it — nothing else in this report
	 * spends a colour on saying "here".
	 */
	fill: 'rgba(0, 0, 0, 0.5)',
} as const;

/**
 * The renewals in a lane's applications: the ones that opened no window of their own.
 *
 * The engine hands both kinds over in one array (`AuraLane.applications`), and a window's own start is
 * what tells them apart, exactly rather than by a tolerance, because `auraWindows` stamps the window
 * from the very event this list carries. An application that opened a bar is that bar's left edge, and a
 * tick drawn on top of it marks nothing the reader cannot already see.
 *
 * Exported for its guard. It is one line of filtering and the line is the whole rule this chart draws
 * by, which is the kind of line that goes quietly wrong in a chart nothing can render in a test.
 */
export const refreshesOf = (lane: AuraLane): number[] =>
	(lane.applications ?? []).filter((at) => !lane.windows.some((w) => w.start === at));

interface Row {
	name: string;
	id: number;
	tone: keyof ChartTheme;
	windows: Array<[number, number]>;
	presses: number[];
	/**
	 * When the aura was renewed inside a window it already had, drawn as a tick on the bar.
	 *
	 * A window closes on a remove and swallows every refresh inside it, so a long bar hides the presses
	 * that paid for it — see `AuraLane.applications`. These are what put them back on the page.
	 *
	 * **The applications that opened a window are left out here, and only here.** A bar's left edge is
	 * already that event, drawn at full height and impossible to miss, so a tick on top of it marks
	 * nothing the reader cannot see: on the summary it doubled every bar's start with a notch. What is
	 * invisible without a mark is the refresh *inside* a bar, which is the whole reason the field exists.
	 * The cast timeline keeps both, because a merged row there is read against its presses.
	 */
	refreshes: number[];
	/**
	 * A counter's loads, when the spec draws one on this row: one entry per load it built and let go of.
	 *
	 * Handed over by `spec.timelineCounters`, cut and labelled there — the chart draws the bars and
	 * never learns what fills the counter. `CounterLoad.spent` is what decides whether the charge is
	 * written on the bar; `buildSpans` is where that happens.
	 */
	loads?: CounterLoad[];
	/**
	 * Stretches that are a fault in themselves, drawn over the loads in the fault tone.
	 *
	 * Separate from `loads` because neither of the two is a property of one load: overcapping happens
	 * inside a load and an absence happens between two.
	 */
	faultWindows?: Array<readonly [number, number]>;
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
	rowNames: readonly string[] | null,
): Row[] {
	const lanes = analysis.timeline?.lanes ?? [];
	const casts = analysis.timeline?.casts ?? [];
	const byName = new Map<string, Row>();

	/**
	 * The spec's own row list, applied to lanes and presses alike — which is why it is written in row
	 * names rather than in the two identifiers underneath them.
	 *
	 * A row here is a lane, a press stream, or both merged under one name, and the two halves are keyed
	 * differently: an `AuraLane` carries an ability key and a `CastMark` carries a name and an id. So a
	 * spec curating Grand Crusader on a Paladin's pull — a proc lane *and* a press row under one name —
	 * would need two entries in two vocabularies to say one thing. It says it once, in the currency the
	 * rows are grouped and ordered in.
	 *
	 * **`summaryKeys` is the other cut and they are not alternatives.** That one keeps a named handful of
	 * lanes and drops every press with them; this one keeps rows of both kinds. A spec whose summary is
	 * five auras takes the first, a spec whose summary is a curated mix of buffs and buttons takes the
	 * second, and a spec may take both — the lane allowlist runs first below, so a key that survives it
	 * can still fall outside the row list.
	 *
	 * `null` is every row, which is what a spec that curates nothing says.
	 */
	const drawn = (name: string): boolean => rowNames === null || rowNames.includes(name);

	for (const lane of lanes) {
		if (summaryKeys !== null && !summaryKeys.includes(lane.key)) continue;
		if (!drawn(lane.name)) continue;
		const tone = GROUP_TONE[lane.group];
		const row = byName.get(lane.name) ?? {
			name: lane.name,
			id: lane.id,
			tone,
			windows: [],
			presses: [],
			refreshes: [],
		};
		row.windows.push(...lane.windows.map((w): [number, number] => [w.start, w.end]));
		row.refreshes.push(...refreshesOf(lane));
		byName.set(lane.name, row);
	}
	if (summaryKeys === null) {
		for (const mark of casts) {
			if (!drawn(mark.name)) continue;
			const row = byName.get(mark.name) ?? {
				name: mark.name,
				id: mark.id,
				tone: CAST_TONE,
				windows: [],
				presses: [],
				refreshes: [],
			};
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
			// A counter row draws one bar per load and already shows every spend, so a tick per stack gain
			// would be a second mark for a thing the row is made of.
			refreshes: [],
			loads: counter.loads,
			faultWindows: counter.faultWindows,
		});
	}

	// The declared order leads; rows nobody named keep the order the engine produced.
	//
	// **The row list wins over `rowOrder` where a spec supplies one**, because supplying a sequence of rows
	// is supplying their sequence. `rowOrder` still ranks the cast log, where every row is drawn and the
	// question is which family sits above which; here the reader named the rows and the order is theirs.
	const rank = rowNames ?? rowOrder;
	return [...byName.values()].sort((a, b) => {
		const diff = rowRank([a.name], rank) - rowRank([b.name], rank);
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
			// A load that ended under the ceiling is the fault the row exists to show, so it is drawn in the
			// fault tone rather than the row's own. Same argument as the resource track washing its stretches
			// at the cap: the reader is looking for where charge was thrown away, and a bar in the row's
			// colour asks them to compare heights to find it.
			//
			// `belowCap` is the spec's answer, not this chart's — it knows no ceilings — and it covers a spend
			// below full and a shield lost below full alike. The tooltip is what separates them, because they
			// are different mistakes with the same cost and a reader can only act on the distinction.
			const wasted = load.belowCap === true;
			spans.push({
				x: row.name,
				y: [load.start, Math.max(load.end, load.start + floor)],
				fillColor: wasted ? theme.miss : theme[row.tone],
				strokeColor: theme.bg,
				// Only a load that ended in a spend carries a figure, because the figure *is* the spend —
				// the same number the Lightning Shield section writes over each fall in its own chart, and
				// the same one its bad-spend table lists.
				...(load.spent ? { count: `${load.held}` } : {}),
				meta: {
					title: row.name,
					tone: wasted ? 'miss' : row.tone,
					rows: [
						['from', formatStamp(load.start)],
						['to', formatStamp(load.end)],
						['stacks', `${load.held}`],
						...(wasted
							? ([[load.spent ? 'spent below full' : 'lost below full', `${load.held}`]] as Array<[string, string]>)
							: []),
					],
				},
			});
		}
		// **After the loads, and the order is the drawing.** These overlap the loads they describe — an
		// overcap stretch sits inside one — and a later span in the same series paints over an earlier one,
		// which is what puts the red on the part of the load that was at the ceiling rather than beside it.
		for (const [start, end] of row.faultWindows ?? []) {
			spans.push({
				x: row.name,
				y: [start, Math.max(end, start + floor)],
				fillColor: theme.miss,
				strokeColor: theme.bg,
				meta: {
					title: row.name,
					tone: 'miss',
					rows: [
						['from', formatStamp(start)],
						['to', formatStamp(end)],
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
	const spec = useSpec();
	const rowOrder = spec.timelineRowOrder;
	const summaryKeys = spec.summaryLaneKeys;
	const rowNames = spec.summaryRowNames;
	// Memoised on its own, not read inline: a spec that has a counter builds a fresh array per call, and
	// a fresh array here would give `rows` — and so `build`, and so the ApexCharts instance — a new
	// identity on every render, tearing the chart down and redrawing it each time.
	const counters = useMemo(() => spec.timelineCounters(analysis), [spec, analysis]);
	const rows = useMemo(
		() => buildRows(analysis, counters, rowOrder, summaryKeys, rowNames),
		[analysis, counters, rowOrder, summaryKeys, rowNames],
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
				plotOptions: {
					bar: { horizontal: true, barHeight: `${BAR_HEIGHT * 100}%`, borderRadius: 2, rangeBarGroupRows: false },
				},
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
				/**
				 * A tick on the bar wherever the aura was renewed.
				 *
				 * **What this is for.** A bar says the aura was up; it cannot say how many presses kept it
				 * there, because `auraWindows` closes a window on a remove and discards every refresh inside
				 * it. Elemental Discharge on `B79VQfyxk8an312v` fight 43 is 47 seconds of unbroken bar for a
				 * buff that runs fourteen, and a reader looking for the renewals had nothing to look at.
				 *
				 * **Renewals only, which is what separates this chart from the cast log.** An application that
				 * opened a window is the bar's own left edge, drawn full height already; a tick there marks
				 * nothing new. `Row.refreshes` is where that cut is made and why.
				 *
				 * **A notch rather than the aura's art.** The icon shipped first and read as clutter here: this
				 * is the summary, its label column already names and pictures the row, and a dozen thumbnails
				 * down a lane are not a rhythm. The tick is a translucent black the bar's own height, so it
				 * darkens whichever tone the bar carries instead of cutting it in two.
				 *
				 * **Off on a narrow chart, and stated rather than silent.** A phone draws the whole pull into
				 * 390px, where a busy row's ticks land on top of each other and hatch the bar solid, for the same
				 * reason `dataLabels` is gated on `narrow` twenty lines above. The windows still draw; it is
				 * the marks that wait for room.
				 */
				annotations: narrow
					? {}
					: {
							/**
							 * **A stated cast, and it is the axis rather than the annotation that forces it.**
							 * `PointAnnotations.y` is typed `number | null`, which is right for a numeric axis and
							 * wrong for this one: these bars are a category axis — the row's name is its
							 * coordinate — and ApexCharts resolves a category annotation by that string at
							 * runtime. A numeric `y` here would be read as a value on an axis that has none.
							 */
							points: rows.flatMap((row) =>
								row.refreshes.map((t) => ({
									x: t,
									y: row.name,
									// The tick is the mark, so the default dot underneath it would be a second one.
									marker: { size: 0 },
									/**
									 * Drawn as SVG rather than as an `image` or a `marker`, because neither can be this
									 * shape. A marker is a dot or a square sized by one number, and an `image` would mean
									 * encoding a two-pixel rectangle as a data URI to get a rectangle. `customSVG` is
									 * documented as deprecated in favour of those two and still supported; it is the only
									 * one of the three that draws a line.
									 *
									 * Centred on the moment and on the bar by the rect's own offsets: the tick straddles the
									 * timestamp the log gave rather than starting after it, since a mark two pixels wide has
									 * no meaningful left edge to align, and it sits inside the bar's own height rather than
									 * across the row. Square corners, because a two-pixel mark with rounded ends is a mark
									 * with no ends.
									 */
									customSVG: {
										SVG: `<rect x="${-REFRESH_TICK.width / 2}" y="${-REFRESH_TICK.height / 2}" width="${REFRESH_TICK.width}" height="${REFRESH_TICK.height}" fill="${REFRESH_TICK.fill}" />`,
									},
								})),
							) as unknown as ApexOptions['annotations'] extends { points?: infer P } ? P : never,
						},
				tooltip: baseTooltip(theme),
			};
		},
		[rows, analysis.durationMs, height],
	);

	if (rows.length === 0) {
		return <ChartEmpty>{t('timeline.lanes.empty')}</ChartEmpty>;
	}

	const narrow = useNarrow();
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
