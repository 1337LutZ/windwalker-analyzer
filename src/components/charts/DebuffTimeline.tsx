import { useCallback } from 'react';
import type { ApexOptions } from 'apexcharts';
import { useTranslation } from 'react-i18next';

import { complementOf } from '~/lib/analysis/intervals';
import type { Analysis } from '~/lib/types';

import { fmt, sec } from '../format';
import type { ChartEnv } from './ApexChart';
import ApexChart from './ApexChart';
import ChartEmpty from './ChartEmpty';
import ChartKey from './ChartKey';
import type { ChartTheme, TipContent } from './apex';
import { LABEL_FONT_SIZE, baseChart, baseGrid, baseTooltip, timeAxis } from './apex';

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
/**
 * Everything in the chart's height that is not a row: the clock axis and the margins around it.
 *
 * 92, matching the pull timeline exactly, and that is the point rather than a coincidence. ApexCharts
 * is given a total height and divides whatever is left after its own chrome among the categories — so
 * this number is a *claim* about how much chrome there will be, and an over-estimate does not add
 * padding, it fattens every row. Reserving 96 against 92 of real chrome spread the surplus across
 * three rows and drew them at 37.3px, next to a pull timeline drawing 36 from the same declared grid.
 *
 * Both charts run the same `timeAxis`, no legend, no title and zero vertical grid padding, so their
 * chrome is the same and the number has to be. Changing one without the other puts two timelines of
 * one pull at two pitches again.
 */
const CHROME = 92;

/**
 * A gap of a second or two is a real drop but too thin to hover, so every span is drawn at least
 * this wide and its true length is left to the tooltip.
 */
const minimumSpan = (durationMs: number) => durationMs / 400;

interface Span {
	x: string;
	y: [number, number];
	fillColor: string;
	meta: TipContent;
}

/**
 * Rising Sun Kick's debuff across the pull: where it was up, where it fell off, and where the fight
 * would not let it be up at all.
 *
 * Three tracks rather than one, because the third is what makes the second fair. A gap during an
 * intermission is not a drop the player caused, and a single up/down bar cannot tell the two apart —
 * it would show a phase transition as the same red as a missed global. Uptime is measured against
 * engaged time for exactly this reason, and the chart has to agree with the number.
 *
 * All three tracks are the *primary target's*, and that is a legitimate thing to draw — one enemy's
 * windows are a picture, thirty enemies' are a smear. What it is not is the measurement the tiles
 * above print, which follows whichever enemy the player was hitting. So the chart says whose windows
 * these are, in its caption and in its label, and quotes only figures read off its own tracks:
 * borrowing the tile's uptime to describe this drawing is how the section came to hold two numbers
 * that were never about the same enemy.
 */
export default function DebuffTimeline({ analysis, target }: { analysis: Analysis; target: string }) {
	const { t } = useTranslation('report');
	const { debuff } = analysis;
	// Summed here rather than carried as a field: it is the total of the array this chart draws, and a
	// second copy in the analysis output is a number that goes stale the moment the list is filtered.
	const droppedSec = debuff.drops.reduce((total, drop) => total + drop.seconds, 0);

	const build = useCallback(
		({ theme, narrow, animate, touch }: ChartEnv): ApexOptions => {
			const rows = {
				up: t('debuff.track.up'),
				dropped: t('debuff.track.dropped'),
				away: t('debuff.track.away'),
			};
			const floor = minimumSpan(analysis.durationMs);
			const span = (x: string, start: number, end: number, tone: keyof ChartTheme, meta: TipContent): Span => ({
				x,
				y: [start, Math.max(end, start + floor)],
				fillColor: theme[tone] as string,
				meta,
			});

			const spans: Span[] = [
				...debuff.windows.map((w) =>
					span(rows.up, w.start, w.end, 'kick', {
						title: rows.up,
						tone: 'kick',
						rows: [
							['from', fmt(w.start)],
							['held for', `${sec(w.end - w.start)}s`],
						],
					}),
				),
				...debuff.drops.map((d) =>
					span(rows.dropped, d.at, d.at + d.seconds * 1000, 'miss', {
						title: rows.dropped,
						tone: 'miss',
						rows: [
							['at', fmt(d.at)],
							['off the target for', `${d.seconds}s`],
						],
					}),
				),
				// The complement of engaged time: the stretches the fight took away.
				...gapsBetween(debuff.engagedSegments, analysis.durationMs).map(([start, end]) =>
					span(rows.away, start, end, 'muted', {
						title: rows.away,
						tone: 'muted',
						rows: [
							['from', fmt(start)],
							['for', `${sec(end - start)}s`],
						],
					}),
				),
			];

			return {
				chart: {
					...baseChart({
						id: 'ww-debuff',
						type: 'rangeBar',
						height: 3 * ROW_HEIGHT + CHROME,
						theme,
						animate,
						scrubbable: true,
						durationMs: analysis.durationMs,
						touch,
					}),
				},
				series: [{ name: 'debuff', data: spans }],
				// Bars fill their row: it is the lane, and one floating inside it reads as something
				// smaller than the lane it belongs to.
				plotOptions: { bar: { horizontal: true, barHeight: '92%', borderRadius: 2, rangeBarGroupRows: false } },
				dataLabels: { enabled: false },
				legend: { show: false },
				stroke: { width: 0 },
				grid: baseGrid(theme),
				xaxis: timeAxis(theme, analysis.durationMs, narrow),
				yaxis: {
					labels: {
						maxWidth: narrow ? 96 : 150,
						style: { colors: theme.ink2, fontSize: LABEL_FONT_SIZE, fontFamily: theme.mono },
					},
				},
				tooltip: baseTooltip(theme),
			};
		},
		[analysis.durationMs, debuff.windows, debuff.drops, debuff.engagedSegments, t],
	);

	if (debuff.windows.length === 0) {
		return <ChartEmpty>{t('debuff.verdict', { context: 'none' })}</ChartEmpty>;
	}

	return (
		<figure className="m-0 flex flex-col gap-3.5">
			<ApexChart
				build={build}
				height={3 * ROW_HEIGHT + CHROME}
				label={t('debuff.chartLabel', {
					target,
					drops: debuff.drops.length,
					lost: droppedSec,
				})}
			/>
			<figcaption className="flex flex-col gap-2 text-sm text-muted">
				<span className="flex flex-wrap gap-x-4 gap-y-2">
					<ChartKey tone="kick">{t('debuff.track.up')}</ChartKey>
					<ChartKey tone="miss">{t('debuff.track.dropped')}</ChartKey>
				</span>
				<span>{t('debuff.chartCaption', { target })}</span>
			</figcaption>
		</figure>
	);
}

/**
 * The stretches *not* covered by `segments`, which is where the fight was out of reach.
 *
 * The complement itself is `complementOf` in the interval primitives — the cast timeline shades the
 * same stretches, and two hand-rolled complements would eventually disagree about a boundary. What
 * stays here is the filter: a sliver either side of a segment boundary is rounding, not a phase, and
 * a second's worth of it is a bar too thin to hover on a chart drawn at this width.
 */
function gapsBetween(segments: ReadonlyArray<readonly [number, number]>, durationMs: number): Array<[number, number]> {
	return complementOf([...segments], durationMs).filter(([start, end]) => end - start > 1000);
}
