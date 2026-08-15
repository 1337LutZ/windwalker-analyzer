import { useCallback } from 'react';
import type { ApexOptions } from 'apexcharts';
import { useTranslation } from 'react-i18next';

import type { Analysis, SnapshotGrade } from '~/lib/types';

import { formatGap } from '~/lib/format';

import { fmt, sec } from '../format';
import { ChartFigure } from '../primitives';
import type { ChartEnv } from './ApexChart';
import ApexChart from './ApexChart';
import ChartEmpty from './ChartEmpty';
import ChartKey from './ChartKey';
import TrackLabels, { type Track } from './TrackLabels';
import type { ChartTheme, TipContent } from './apex';
import { LABEL_FONT_SIZE, NARROW_QUERY, baseChart, baseGrid, baseTooltip, timeAxis } from './apex';

/** Charts in this group share their zoom, pan and crosshair. */
const FIGHT_GROUP = 'ww-fight';

/**
 * Ability names stay out of the locale files, deliberately.
 *
 * WarcraftLogs already returns localised ability names in `masterData`, so a second translation
 * table maintained here would be a copy that drifts from the one the API hands us — the report would
 * end up naming the same spell two different ways on the same page. Everything *about* an ability is
 * translated; the ability's own name is the game's to give.
 */
/**
 * The spell whose icon stands for each track. Ids, not names, because `SpellIcon` resolves ids —
 * and the Rune has three stat variants that share one icon, so any of them answers for the track.
 */
const TRACK_ICON = {
	proc: 139120,
	brew: 1247275,
	debuff: 107428,
	channel: 113656,
} as const;

const TRACK = {
	proc: 'Re-Origination',
	brew: 'Tigereye Brew',
	debuff: 'Rising Sun Kick',
	channel: 'Fists of Fury',
} as const;

/**
 * At the 14px floor the full track names take a third of a 390px screen away from the plot, and the
 * plot is the whole point of the chart. The shorthand below is the shorthand the report's own prose
 * uses; every tooltip and the chart's aria-label still name the mechanic in full.
 */
const TRACK_NARROW = {
	proc: 'Rune',
	brew: 'Brew',
	debuff: 'RSK',
	channel: 'FoF',
} as const;

/**
 * Width reserved for the HTML track labels, and handed to ApexCharts as `grid.padding.left` so the
 * plot starts after it. An icon plus the longest mechanic name at 14px mono needs this much; the
 * phone layout uses the shorthand names and a correspondingly narrower gutter.
 */
const LABEL_PX = 172;
const NARROW_LABEL_PX = 84;
// The right edge holds a count for the last span on each track, which sits *past* the bar — with the
// standard 8px the final proc's number was half cut off by the plot edge.
const GRID_PADDING = { top: 0, right: 22, bottom: 0 };

/**
 * Row height, on a 4px grid shared by every chart in the report.
 *
 * 36 for the two that carry an icon beside each row — the pull timeline and the Rising Sun Kick
 * debuff — which clears a 24px icon without leaving the row mostly empty. 24 for the rest, which are
 * bars and text.
 *
 * Picked as a grid rather than per chart: five charts had five heights (32, 34, 38, 46, 34), which is
 * five arbitrary numbers rather than a system, and two timelines of the same pull sitting at
 * different pitches read as two different tools.
 */
const ROW_HEIGHT = 36;
const CHROME = 92;

/**
 * A span shorter than this is a sliver too thin to hover at full zoom, so it is drawn at this width
 * and its real length is left to the tooltip. Scaled to the pull, not fixed in pixels.
 */
const minimumSpan = (durationMs: number) => durationMs / 400;

const GRADE_VERDICT: Record<SnapshotGrade, string> = {
	'last-gcd': 'held to the last global',
	late: 'held late into the proc',
	early: 'brewed early, with proc left on the clock',
	none: 'the whole proc went past',
};

interface Span {
	x: string;
	y: [number, number];
	fillColor: string;
	meta: TipContent;
	/**
	 * Drawn on the bar itself: which use of that track this is, counting from the pull.
	 *
	 * Only the three tracks that are *used* carry one — procs, brews and channels. The debuff track is
	 * a state rather than a press, so numbering its windows would count something nobody did.
	 */
	count?: string;
}

const span = (
	x: string,
	start: number,
	end: number,
	floor: number,
	fillColor: string,
	meta: TipContent,
	count?: string,
): Span => ({
	x,
	y: [start, Math.max(end, start + floor)],
	fillColor,
	meta,
	count,
});

const when = (start: number, end: number): [string, string] => ['when', `${fmt(start)} → ${fmt(end)}`];

function buildSpans(analysis: Analysis, theme: ChartTheme, narrow: boolean): Span[] {
	const track = narrow ? TRACK_NARROW : TRACK;
	const floor = minimumSpan(analysis.durationMs);
	const spans: Span[] = [];

	// Re-Origination: the colour is the verdict on the snapshot, not the track — a brew held late is
	// Rising Sun Kick's teal, an early one is the Rune's violet, a proc never caught is red. The
	// legend under the chart is what makes that readable; teal and violet do not announce themselves.
	analysis.procs.windows.forEach((w, i) => {
		const tone: keyof ChartTheme = w.grade === 'none' ? 'miss' : w.grade === 'early' ? 'rune' : 'kick';
		const rows: Array<[string, string]> = [
			when(w.start, w.end),
			['stat gained', w.stat],
			['proc length', `${sec(w.lengthMs)}s`],
		];
		if (w.snapshotAt === null) {
			// A brew that went out a fraction after the proc expired is not "no brew". Saying so here
			// contradicted the snapshot chart, which draws that proc in its own colour, and told the
			// reader they ignored a proc they had actually read.
			if (w.missedByMs !== null) {
				rows.push(['brew', `${formatGap(w.missedByMs)} after it expired`]);
			} else {
				rows.push(['brew', w.redundant ? 'none — the same stat was already held' : 'none']);
			}
		} else {
			rows.push(['brewed at', `${fmt(w.snapshotAt)} · ${sec(w.snapshotAt - w.start)}s in`]);
			rows.push(['proc left', `${sec(w.remainingMs ?? 0)}s`]);
			if (w.snapshotStacks !== null) rows.push(['stacks spent', `${w.snapshotStacks}/10`]);
		}
		// The near-miss verdict belongs only to a proc that was *never* snapshotted — the same guard the
		// engine's own `narrowlyMissed` counter uses. `missedByMs` is set independently of `snapshotAt`,
		// and Tigereye Brew has no cooldown, so a proc caught mid-window and followed by a second brew
		// just after it expired carries both: the tooltip printed "brewed at 2:31 · 8.4s in" and then
		// called it "brewed too late" in the same breath.
		const nearMiss = w.snapshotAt === null && w.missedByMs !== null;
		rows.push(['verdict', nearMiss ? 'read, but brewed too late' : GRADE_VERDICT[w.grade]]);
		spans.push(
			span(
				track.proc,
				w.start,
				w.end,
				floor,
				theme[tone],
				{ title: `Proc ${String(i + 1).padStart(2, '0')} · ${w.stat}`, tone, rows },
				`${i + 1}`,
			),
		);
	});

	// Tigereye Brew: one span per window, because re-casting inside a running brew extends that
	// window rather than opening a new one. What each press actually burned goes in the tooltip.
	// Numbered by press rather than by window: a re-cast inside a running brew extends the window
	// instead of opening a new one, so counting windows would report six presses as five.
	let pressed = 0;
	for (const w of analysis.brew.windows) {
		const uses = analysis.brew.useList.filter(
			(u) => u.window !== null && u.window.start === w.start && u.window.end === w.end,
		);
		const consumed = uses.reduce((total, u) => total + u.consumed, 0);
		const first = pressed + 1;
		pressed += uses.length;
		spans.push(
			span(
				track.brew,
				w.start,
				w.end,
				floor,
				theme.brew,
				{
					title: 'Tigereye Brew',
					tone: 'brew',
					rows: [
						when(w.start, w.end),
						['held for', `${sec(w.end - w.start)}s`],
						['presses', `${uses.length}`],
						['stacks spent', `${consumed}`],
					],
				},
				uses.length > 1 ? `${first}-${pressed}` : `${pressed}`,
			),
		);
	}

	// The debuff track carries both halves of the story: where it was up, and where it fell off.
	for (const w of analysis.debuff.windows) {
		spans.push(
			span(track.debuff, w.start, w.end, floor, theme.kick, {
				title: 'Rising Sun Kick debuff',
				tone: 'kick',
				rows: [when(w.start, w.end), ['up for', `${sec(w.end - w.start)}s`]],
			}),
		);
	}
	for (const drop of analysis.debuff.drops) {
		spans.push(
			span(track.debuff, drop.at, drop.at + drop.seconds * 1000, floor, theme.miss, {
				title: 'Rising Sun Kick dropped',
				tone: 'miss',
				rows: [
					['at', fmt(drop.at)],
					['off the target for', `${drop.seconds}s`],
				],
			}),
		);
	}

	// Fists of Fury locks out every other button, so a channel is worth seeing against the rest.
	analysis.channel.castList.forEach((c, i) => {
		const faulted = c.faults.length > 0;
		const tone: keyof ChartTheme = faulted ? 'miss' : 'rune';
		spans.push(
			span(
				track.channel,
				c.t,
				c.t + c.channelMs,
				floor,
				theme[tone],
				{
					title: 'Fists of Fury',
					tone,
					rows: [
						['at', fmt(c.t)],
						['channelled', `${sec(c.channelMs)}s`],
						['brew running', c.brewUp ? 'yes' : 'no'],
						['rune left', c.procRemainingMs === null ? '—' : `${sec(c.procRemainingMs)}s`],
						['verdict', faulted ? c.faults.join('; ') : 'ok'],
					],
				},
				`${i + 1}`,
			),
		);
	});

	return spans;
}

/**
 * The pull on one clock: every Re-Origination proc, every brew window, the Rising Sun Kick debuff
 * and every Fists of Fury channel on their own track, so the lining-up reads directly.
 *
 * One series carrying every track, with the row coming from each point's `x`.
 *
 * Splitting the tracks into one series each looks tidier and is measurably worse: ApexCharts
 * reserves a sub-slot per series inside *every* category band, so a four-track chart draws each row
 * as four 7px strips with three of them empty, and the same span answers with different tooltips
 * depending on whether the cursor is in the top or bottom half of its row. One series means one
 * slot per category and one full-height bar per span.
 *
 * The tooltip's correctness does not come from the series layout at all — see `metaTooltip`, which
 * resolves the point from the mark the cursor entered rather than from the x-axis.
 */
export default function FightTimeline({ analysis }: { analysis: Analysis }) {
	// `useTranslation`, not `useReportCopy`: a chart draws what it is handed and holds no verdict.
	const { t } = useTranslation('report');
	const rows = rowsIn(analysis);
	const height = rows * ROW_HEIGHT + CHROME;

	const build = useCallback(
		({ theme, narrow, animate, touch }: ChartEnv): ApexOptions => {
			const spans = buildSpans(analysis, theme, narrow);
			// Read by index in the data-label formatter, whose `opts` ApexCharts types too loosely to
			// reach the point through. The order is the series' own, so the index is the point's.
			const counts = spans.map((s) => s.count ?? '');

			return {
				chart: {
					...baseChart({
						id: 'ww-timeline',
						group: FIGHT_GROUP,
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
					bar: {
						horizontal: true,
						// `barHeight` is the share of its row a bar fills, and it is deliberately near the whole of it:
						// the row is the lane, so a bar floating inside one reads as a smaller thing than the lane it
						// belongs to. The few percent left over is what keeps two adjacent rows from touching.
						barHeight: '92%',
						borderRadius: 2,
						// `false`, deliberately. With `true` ApexCharts splits the points sharing a category
						// into sub-rows inside the band, so one track becomes several thin strips stacked on
						// top of each other — which is why the same span answered with two different
						// tooltips depending on whether the cursor was in the top or bottom half of its row.
						// Each track already has its own category, so there is nothing here that needs
						// grouping.
						rangeBarGroupRows: false,
						// `top` on a horizontal bar means the far end, so the count sits just past the span
						// rather than on it.
						//
						// Centred was the obvious choice and does not work: ApexCharts drops any label wider
						// than the bar under it, so the two narrowest Fists of Fury channels — 6px and 9px,
						// measured — lost their numbers while their neighbours kept theirs, and a count that
						// skips from 3 to 5 reads as two channels the analysis failed to find. Past the end
						// there is always room.
						dataLabels: { position: 'top', hideOverflowingLabels: false },
					},
				},
				// The running count on each span, so "how many by here" reads off the chart rather than out
				// of a tooltip one span at a time. Off on a phone, where the gaps between spans are too
				// narrow to hold a digit without it landing on its neighbour.
				dataLabels: {
					enabled: !narrow,
					formatter: (_value, opts) => counts[(opts as unknown as { dataPointIndex: number }).dataPointIndex] ?? '',
					textAnchor: 'start',
					offsetX: 5,
					// Body ink: back-to-back spans leave no gap, so a count lands on the neighbouring bar as
					// often as on the page ground, and it has to stay legible on both.
					style: {
						colors: [theme.ink],
						fontFamily: theme.mono,
						fontSize: LABEL_FONT_SIZE,
						fontWeight: 600,
					},
				},
				legend: { show: false },
				stroke: { width: 0 },
				grid: { ...baseGrid(theme), padding: { ...GRID_PADDING, left: narrow ? NARROW_LABEL_PX : LABEL_PX } },
				xaxis: timeAxis(theme, analysis.durationMs, narrow),
				// The track labels are drawn as HTML beside the chart rather than as SVG axis text, because an
				// icon cannot live inside an SVG <text> node. ApexCharts still reserves the column through
				// `grid.padding.left`, and `TrackLabels` measures the plot area to line up with it.
				yaxis: { labels: { show: false } },
				tooltip: baseTooltip(theme),
			};
		},
		[analysis, height],
	);

	if (rows === 0) {
		return <ChartEmpty>{t('timeline.empty')}</ChartEmpty>;
	}

	// Only the tracks that actually drew a row, in the order the chart stacks them — an empty track
	// draws nothing, so labelling it would shift every label below it onto the wrong row.
	const narrow = typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches;
	const names = narrow ? TRACK_NARROW : TRACK;
	const tracks: Track[] = (
		[
			['proc', analysis.procs.windows.length],
			['brew', analysis.brew.windows.length],
			['debuff', analysis.debuff.windows.length + analysis.debuff.drops.length],
			['channel', analysis.channel.castList.length],
		] as const
	)
		.filter(([, count]) => count > 0)
		.map(([key]) => ({ iconId: TRACK_ICON[key], label: names[key] }));

	return (
		<ChartFigure
			gap="wide"
			// Colour is the verdict, not the track — the row labels already say which mechanic it is.
			caption={
				<>
					<ChartKey tone="brew">{t('timeline.key.brew')}</ChartKey>
					<ChartKey tone="kick">{t('timeline.key.kick')}</ChartKey>
					<ChartKey tone="rune">{t('timeline.key.rune')}</ChartKey>
					<ChartKey tone="miss">{t('timeline.key.miss')}</ChartKey>
				</>
			}
		>
			<div className="relative">
				<TrackLabels tracks={tracks} width={narrow ? NARROW_LABEL_PX : LABEL_PX} />
				<ApexChart
					build={build}
					height={height}
					label={`Timeline of the ${fmt(analysis.durationMs)} pull: ${analysis.procs.procs} Re-Origination procs, ${analysis.brew.windows.length} Tigereye Brew windows, ${analysis.debuff.windows.length} Rising Sun Kick debuff windows with ${analysis.debuff.drops.length} drops, and ${analysis.channel.casts} Fists of Fury channels`}
				/>
			</div>
		</ChartFigure>
	);
}

/** A track with nothing on it draws no row, so the height follows what the pull actually has. */
function rowsIn(analysis: Analysis): number {
	return [
		analysis.procs.windows.length,
		analysis.brew.windows.length,
		analysis.debuff.windows.length + analysis.debuff.drops.length,
		analysis.channel.castList.length,
	].filter((count) => count > 0).length;
}
