import { useCallback, useMemo } from 'react';
import type { ApexOptions } from 'apexcharts';

import { useTranslation } from 'react-i18next';

import type { Analysis } from '~/lib/types';

import { fmt } from '../format';
import type { ChartEnv } from './ApexChart';
import ApexChart from './ApexChart';
import ChartEmpty from './ChartEmpty';
import ChartKey from './ChartKey';
import { LABEL_FONT_SIZE, baseChart, baseGrid, baseTooltip, timeAxis } from './apex';
import { FIGHT_GROUP } from './FightTimeline';

/** Tigereye Brew banks to twenty and spends ten, so the axis is the cap and not the observed peak. */
const CAP = 20;

/** Room for five 14px stack labels down the side without them touching each other. */
const HEIGHT = 240;

/**
 * The bank counter over the pull as a stepline: a stack is held from the moment it is gained until
 * something moves it, which is a step, not a slope. Every press is marked where it drained the bank.
 *
 * It shares `chart.group` with the timeline above it, so the two zoom, pan and crosshair together —
 * the whole point of the pair is reading a spend against what was happening at that moment.
 */
export default function BrewBank({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const points = analysis.brew.bankTimeline;
	const last = points[points.length - 1];

	/**
	 * Stretches where the bank sat at the twenty-stack cap.
	 *
	 * Every stack generated inside one of these is a stack that never existed, so this is the one
	 * fault on this chart that the line itself cannot show — a bank pinned at the ceiling looks like a
	 * full bank, which reads as success. The band is what makes the loss visible, and it is the
	 * picture behind the `wastedAtCap` figure the section quotes.
	 */
	const cappedSpans = useMemo(() => {
		const spans: Array<[number, number]> = [];
		let openedAt: number | null = null;
		for (const [at, stacks] of points) {
			if (stacks >= CAP && openedAt === null) openedAt = at;
			else if (stacks < CAP && openedAt !== null) {
				spans.push([openedAt, at]);
				openedAt = null;
			}
		}
		// Still at cap when the log stops: the band runs to the end of the pull rather than vanishing.
		if (openedAt !== null) spans.push([openedAt, analysis.durationMs]);
		return spans;
	}, [points, analysis.durationMs]);

	const build = useCallback(
		({ theme, narrow, animate, touch }: ChartEnv): ApexOptions => ({
			chart: {
				...baseChart({
					id: 'ww-brew-bank',
					group: FIGHT_GROUP,
					type: 'area',
					height: HEIGHT,
					theme,
					animate,
					scrubbable: true,
					touch,
					durationMs: analysis.durationMs,
				}),
			},
			series: [
				{
					name: 'Bank',
					data: [
						...points,
						// The bank does not reset when the log stops emitting: carry the last level to the
						// end of the fight, or the area stops short of the axis.
						...(last === undefined || last[0] >= analysis.durationMs
							? []
							: ([[analysis.durationMs, last[1]]] as Array<[number, number]>)),
					].map(([t, stacks]) => ({
						x: t,
						y: stacks,
						meta: {
							title: 'Tigereye Brew bank',
							tone: 'brew' as const,
							rows: [
								['at', fmt(t)],
								['stacks banked', `${stacks}`],
							] as Array<[string, string]>,
						},
					})),
				},
			],
			colors: [theme.brew],
			stroke: { curve: 'stepline', width: 1.5, lineCap: 'square' },
			fill: { type: 'solid', opacity: 0.18 },
			markers: { size: 0 },
			dataLabels: { enabled: false },
			legend: { show: false },
			grid: baseGrid(theme),
			xaxis: timeAxis(theme, analysis.durationMs, narrow),
			yaxis: {
				min: 0,
				max: CAP,
				tickAmount: 4,
				labels: {
					style: {
						colors: theme.muted,
						fontSize: LABEL_FONT_SIZE,
						fontFamily: theme.mono,
					},
					formatter: (value: number) => `${Math.round(value)}`,
				},
			},
			// One line per press, drawn where the bank drained. The number is what that press actually
			// burned, and is only worth printing when it was less than a full ten-stack brew.
			annotations: {
				xaxis: [
					// Bands first so the per-press lines draw over them rather than under.
					...cappedSpans.map(([from, to]) => ({
						x: from,
						x2: to,
						fillColor: theme.miss,
						borderColor: 'transparent',
						opacity: 0.22,
					})),
					...analysis.brew.useList.map((use) => {
						const line = {
							x: use.t,
							borderColor: theme.brew,
							borderWidth: 1,
							strokeDashArray: 0,
							opacity: 0.65,
						};
						// The key is omitted rather than set to `undefined`. ApexCharts reads `label.text` without
						// checking that `label` exists, so an explicit `undefined` throws inside its own mount and
						// the chart never appears — the box just says "Drawing chart" forever.
						if (use.consumed >= 10 || narrow) return line;
						return {
							...line,
							label: {
								text: `${use.consumed}`,
								borderColor: 'transparent',
								orientation: 'horizontal',
								position: 'top',
								offsetY: -4,
								style: {
									background: theme.raised,
									color: theme.brew,
									fontFamily: theme.mono,
									fontSize: LABEL_FONT_SIZE,
									fontWeight: 600,
								},
							},
						};
					}),
				],
			},
			tooltip: baseTooltip(theme),
		}),
		[analysis, points, last, cappedSpans],
	);

	if (points.length === 0) {
		return <ChartEmpty>{t('brew.noChart')}</ChartEmpty>;
	}

	const cappedMs = cappedSpans.reduce((total, [from, to]) => total + (to - from), 0);

	return (
		<figure className="m-0 flex flex-col gap-3.5">
			<ApexChart
				build={build}
				height={HEIGHT}
				label={t('brew.chartLabel', {
					duration: analysis.durationMs,
					peak: analysis.brew.maxStacks,
					cap: CAP,
					uses: analysis.brew.uses,
					avg: analysis.brew.avgConsumed,
					capped: cappedMs / 1000,
				})}
			/>
			<figcaption className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted">
				<ChartKey tone="brew">{t('brew.key.bank')}</ChartKey>
				{/* Only when there is a band to explain: a legend entry for something not on the chart
				    sends the reader hunting for a fault that is not there. */}
				{cappedSpans.length > 0 ? <ChartKey tone="miss">{t('brew.key.capped')}</ChartKey> : null}
			</figcaption>
		</figure>
	);
}
