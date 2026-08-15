import { useCallback, useMemo } from 'react';
import type { ApexOptions } from 'apexcharts';
import { useTranslation } from 'react-i18next';

import { complementOf, intersect, type Interval } from '~/lib/analysis/intervals';
import { DROP_MS } from '~/lib/spec/windwalker';
import type { Analysis } from '~/lib/types';

import { fmt, sec } from '../format';
import { ChartFigure } from '../primitives';
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
 * A gap of a second or two is a real drop but too thin to hover, so a span that size is drawn at
 * least this wide and its true length is left to the tooltip.
 *
 * Only spans at or above `DROP_MS` are widened, and that qualifier is now load-bearing. The tracks
 * follow every enemy the player touched rather than one boss, so they fragment: measured on the
 * reference pulls, a Spoils of Pandaria kill draws 224 spans on the middle track with a median length
 * of 0.1s, and a Garrosh kill 75 with a median of 0.1s. Widening every one of those to the floor would
 * paint about 206 seconds of red on a track whose real total is 120 — a picture contradicting the tile
 * directly above it. Below a second is refresh jitter by the same constant the drop list uses, and
 * jitter drawn as a visible bar is a fault the pull did not have. Left at true width it is a fraction
 * of a pixel, which is what it deserves.
 */
const minimumSpan = (durationMs: number) => durationMs / 400;

interface Span {
	x: string;
	y: [number, number];
	fillColor: string;
	meta: TipContent;
}

/**
 * Rising Sun Kick's debuff across the pull: where it was up, where it was not, and where there was
 * nothing to put it on.
 *
 * Three tracks rather than one, because the third is what makes the second fair. A gap while nothing
 * could be hit is not a drop the player caused, and a single up/down bar cannot tell the two apart —
 * it would show a phase transition as the same red as a missed global.
 *
 * All three are the measurement the tiles above print, and that is the whole point of them: the up
 * track *is* `contactUpSegments`, whose union is the uptime figure, the middle track is what is left
 * of contact time, whose union is the seconds-lost figure, and the third is the complement of contact.
 * They partition the pull with nothing left over. It used to draw the primary target's own windows
 * instead, under tiles that had moved to every enemy — and its third track then called 380 seconds of
 * a 434-second Galakras pull "out of reach" while the player spent 317 of them fighting adds, which is
 * not a scoping quibble but a false sentence about a pull.
 *
 * The primary target's window model has not gone anywhere: it is still what the pull timeline draws,
 * a lane per enemy with that enemy's name on it, which is where one enemy's windows are worth seeing.
 */
export default function DebuffTimeline({ analysis, target }: { analysis: Analysis; target: string }) {
	const { t } = useTranslation('report');
	const { debuff } = analysis;

	/**
	 * The three tracks as intervals, and which measurement they came from.
	 *
	 * `scoped` is false only on the committed fixtures, which are `analyse()` output from before the
	 * contact-scoped arrays existed. There the chart falls back to the primary target's window model —
	 * which is what those pulls' tiles were measured on too, so the section stays internally consistent
	 * — and the copy switches with it rather than describing the wrong thing in the right words. Both
	 * halves of the fallback go away when the fixtures are re-captured.
	 */
	const tracks = useMemo(() => {
		const up = debuff.contactUpSegments;
		const contact = debuff.contactSegments;
		if (up === undefined || contact === undefined) {
			return {
				scoped: false,
				up: debuff.windows.map(({ start, end }): Interval => [start, end]),
				down: debuff.drops.map(({ at, seconds }): Interval => [at, at + seconds * 1000]),
				away: gapsBetween(debuff.engagedSegments, analysis.durationMs),
			};
		}
		return {
			scoped: true,
			up,
			// Contact time that the up track does not cover. Derived rather than carried so it cannot
			// disagree with the array it is the complement of.
			down: intersect([...contact], complementOf([...up], analysis.durationMs)),
			away: gapsBetween(contact, analysis.durationMs),
		};
	}, [
		debuff.contactUpSegments,
		debuff.contactSegments,
		debuff.windows,
		debuff.drops,
		debuff.engagedSegments,
		analysis.durationMs,
	]);
	const totalOf = (windows: readonly Interval[]) => windows.reduce((ms, [start, end]) => ms + (end - start), 0);

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
				y: [start, end - start >= DROP_MS ? Math.max(end, start + floor) : end],
				fillColor: theme[tone] as string,
				meta,
			});

			const spans: Span[] = [
				...tracks.up.map(([start, end]) =>
					span(rows.up, start, end, 'kick', {
						title: rows.up,
						tone: 'kick',
						rows: [
							['from', fmt(start)],
							['held for', `${sec(end - start)}s`],
						],
					}),
				),
				...tracks.down.map(([start, end]) =>
					span(rows.dropped, start, end, 'miss', {
						title: rows.dropped,
						tone: 'miss',
						rows: [
							['from', fmt(start)],
							['without it for', `${sec(end - start)}s`],
						],
					}),
				),
				...tracks.away.map(([start, end]) =>
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
		[analysis.durationMs, tracks, t],
	);

	// Gated on the tracks rather than on `debuff.windows`, which is the primary target's. A player who
	// spent a wave fight kicking adds and never touched the boss has an empty window model and a full
	// chart, and this used to answer them with "Rising Sun Kick was never cast in this pull".
	if (tracks.up.length === 0 && tracks.down.length === 0) {
		return <ChartEmpty>{t('debuff.verdict', { context: 'none' })}</ChartEmpty>;
	}

	// The three durations the chart itself draws, read off the arrays it draws them from. On a scoped
	// pull the first two are the two tiles above, which is the claim the caption makes.
	const context = tracks.scoped ? undefined : 'primary';
	return (
		<ChartFigure
			gap="wide"
			caption={
				<>
					<ChartKey tone="kick">{t('debuff.track.up')}</ChartKey>
					<ChartKey tone="miss">{t('debuff.track.dropped')}</ChartKey>
				</>
			}
			note={t('debuff.chartCaption', { context, target })}
		>
			<ApexChart
				build={build}
				height={3 * ROW_HEIGHT + CHROME}
				label={t('debuff.chartLabel', {
					context,
					target,
					up: totalOf(tracks.up),
					down: totalOf(tracks.down),
					away: totalOf(tracks.away),
					drops: tracks.down.length,
				})}
			/>
		</ChartFigure>
	);
}

/**
 * The stretches *not* covered by `segments`, which is where there was nothing to fight.
 *
 * The complement itself is `complementOf` in the interval primitives — the cast timeline shades the
 * same stretches, and two hand-rolled complements would eventually disagree about a boundary. What
 * stays here is the filter: a sliver either side of a segment boundary is rounding, not a phase, and
 * a second's worth of it is a bar too thin to hover on a chart drawn at this width.
 */
function gapsBetween(segments: ReadonlyArray<readonly [number, number]>, durationMs: number): Array<[number, number]> {
	return complementOf([...segments], durationMs).filter(([start, end]) => end - start > 1000);
}
