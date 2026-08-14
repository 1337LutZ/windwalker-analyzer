import { useCallback } from 'react';
import type { ApexOptions } from 'apexcharts';
import { useTranslation } from 'react-i18next';

import type { Analysis, FillerAudit } from '~/lib/types';

import { fmt, sec } from '../format';
import type { ChartEnv } from './ApexChart';
import ApexChart from './ApexChart';
import ChartEmpty from './ChartEmpty';
import ChartKey from './ChartKey';
import type { ChartTheme, TipContent } from './apex';
import { LABEL_FONT_SIZE, baseChart, baseGrid, baseTooltip, timeAxis } from './apex';

type Reason = FillerAudit['castList'][number]['reason'];

/**
 * One row per outcome, always all four.
 *
 * An empty row is information here: a pull with nothing on the wasted track says so at a glance, and
 * hiding it — the way the pull timeline hides tracks with no data — would turn the best possible
 * result into a missing row that reads as a rendering fault.
 */
const ROWS: Reason[] = ['proc', 'apply', 'refresh', 'wasted'];

/** Colour is the verdict, and it matches the summary cards above the chart exactly. */
const TONE: Record<Reason, keyof ChartTheme> = {
	proc: 'rune',
	apply: 'kick',
	refresh: 'kick',
	wasted: 'miss',
};

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
const ROW_HEIGHT = 24;
/**
 * Everything in the chart's height that is not a row: the clock axis and the margins around it.
 *
 * 92, the same as the other two timelines, and that is the point rather than a coincidence.
 * ApexCharts is given a total height and divides whatever is left after its own chrome among the
 * categories — so this number is a *claim* about how much chrome there will be, and an over-estimate
 * does not add padding, it fattens every row. Reserving 96 against 92 of real chrome drew 25.3px rows
 * from a grid that says 24.
 *
 * All three timelines run the same `timeAxis`, no legend, no title and zero vertical grid padding, so
 * their chrome is the same and the number has to be.
 */
const CHROME = 92;

/**
 * A cast is an instant, not a span, so every mark is drawn at this width and the axis carries the
 * timing. Scaled to the pull so it stays hoverable at any fight length.
 */
const markWidth = (durationMs: number) => durationMs / 260;

/**
 * Every Tiger Palm on one clock, split by what the global bought.
 *
 * This replaces a strip of squares and a modal table. Neither could answer the question the section
 * is actually about — Tiger Palm is a *timing* button, and whether the waste is spread evenly or
 * clustered into a few frantic stretches is the difference between a habit and a phase the fight
 * forced. Forty rows of timestamps cannot show that; four tracks against a clock show it instantly.
 */
export default function TigerPalmTimeline({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const { filler } = analysis;
	const height = ROWS.length * ROW_HEIGHT + CHROME;

	const build = useCallback(
		({ theme, narrow, animate, touch }: ChartEnv): ApexOptions => {
			const label: Record<Reason, string> = {
				proc: t('tigerPalm.key.proc'),
				apply: t('tigerPalm.key.apply'),
				refresh: t('tigerPalm.key.refresh'),
				wasted: t('tigerPalm.key.wasted'),
			};
			const floor = markWidth(analysis.durationMs);

			return {
				chart: {
					...baseChart({
						id: 'ww-tiger-palm',
						type: 'rangeBar',
						height,
						theme,
						animate,
						scrubbable: true,
						durationMs: analysis.durationMs,
						touch,
					}),
				},
				series: [
					{
						name: 'presses',
						data: filler.castList.map((cast) => {
							const meta: TipContent = {
								title: label[cast.reason],
								tone: TONE[cast.reason],
								rows: [
									['at', fmt(cast.t)],
									// The number that decides the verdict: a press with a lot of buff left
									// clipped a healthy Tiger Power.
									['tiger power left', cast.buffLeftMs > 0 ? `${sec(cast.buffLeftMs)}s` : 'not up'],
								],
							};
							return {
								x: label[cast.reason],
								y: [cast.t, cast.t + floor],
								fillColor: theme[TONE[cast.reason]],
								meta,
							};
						}),
					},
				],
				// Bars fill their row: it is the lane, and one floating inside it reads as something
				// smaller than the lane it belongs to.
				plotOptions: { bar: { horizontal: true, barHeight: '92%', borderRadius: 2, rangeBarGroupRows: false } },
				dataLabels: { enabled: false },
				legend: { show: false },
				stroke: { width: 0 },
				grid: baseGrid(theme),
				xaxis: timeAxis(theme, analysis.durationMs, narrow),
				yaxis: {
					// Plain SVG labels here, unlike the pull timeline: every row is the same ability, so an
					// icon beside each would repeat one picture four times and say nothing.
					labels: {
						maxWidth: narrow ? 96 : 150,
						style: { colors: theme.ink2, fontSize: LABEL_FONT_SIZE, fontFamily: theme.mono },
					},
				},
				tooltip: baseTooltip(theme),
			};
		},
		[analysis.durationMs, filler.castList, height, t],
	);

	if (filler.castList.length === 0) {
		return <ChartEmpty>{t('tigerPalm.verdict', { context: 'none' })}</ChartEmpty>;
	}

	return (
		<figure className="m-0 flex flex-col gap-3.5">
			<ApexChart
				build={build}
				height={height}
				label={t('tigerPalm.split', {
					casts: filler.casts,
					onProc: filler.onProc,
					applied: filler.applied,
					refresh: filler.refresh,
					wasted: filler.wasted,
				})}
			/>
			<figcaption className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted">
				<ChartKey tone="rune">{t('tigerPalm.key.proc')}</ChartKey>
				<ChartKey tone="kick">{t('tigerPalm.key.apply')}</ChartKey>
				<ChartKey tone="miss">{t('tigerPalm.key.wasted')}</ChartKey>
			</figcaption>
		</figure>
	);
}
