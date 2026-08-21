import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApexOptions } from 'apexcharts';

import type { Analysis, ElementalAuditResult, FlameShockAudit } from '~/lib/types';

import { formatStamp } from '~/lib/format';

import { fmt, r1, sec } from '~/components/format';
import { ChartFigure } from '~/components/primitives';
import type { ChartEnv } from '~/components/charts/ApexChart';
import ApexChart from '~/components/charts/ApexChart';
import ChartEmpty from '~/components/charts/ChartEmpty';
import ChartKey from '~/components/charts/ChartKey';
import type { ChartTheme, TipContent } from '~/components/charts/apex';
import { LABEL_FONT_SIZE, baseChart, baseGrid, baseTooltip } from '~/components/charts/apex';

const ROW_HEIGHT = 24;
const CHROME = 88;

interface Bar {
	x: string;
	y: number;
	fillColor: string;
	meta: TipContent;
}

/**
 * One bar per refresh: how far into the dot's full duration the press landed.
 *
 * The dot is a snapshot, so a refresh is only wanted near its end — inside its **last tick**, where
 * the pending tick rolls over — or just before Ascendance. A press into a healthy dot is a global and
 * a snapshot both thrown away, and the band marks the stretch at the right end that separates the two.
 *
 * That window is measured per press off the log's own ticks (`FlameShockPress.tickMs`), not set by the
 * reader and not one number for the pull: `phased` grades its refreshes against 1 349ms, 1 748ms and
 * 2 275ms in the same fight, as Bloodlust and Elemental Mastery fell off. Each bar's tone is the
 * verdict against *its own* window; only the band behind them has to pick one.
 */
export function buildBars(flameShock: FlameShockAudit, theme: ChartTheme): Bar[] {
	return flameShock.presses
		.filter((p) => p.remainingMs !== null)
		.map((p, i) => {
			const label = `${String(i + 1).padStart(2, '0')} · ${fmt(p.t)}`;
			// A refresh during Ascendance is the one outright fault; an early refresh (a healthy dot
			// clipped) is the amber; the last-tick refresh and the Ascendance prep are both the accent.
			const tone: keyof ChartTheme = p.duringAscendance ? 'miss' : p.windowed || p.ascPrep ? 'kick' : 'brew';
			const elapsed = flameShock.durationMs - (p.remainingMs ?? 0);
			return {
				x: label,
				y: r1(elapsed / 1000),
				fillColor: theme[tone],
				meta: {
					title: `Refresh ${String(i + 1).padStart(2, '0')}`,
					tone,
					rows: [
						['pressed at', formatStamp(p.t)],
						['dot had run', `${sec(elapsed)}s`],
						['dot left', `${sec(p.remainingMs ?? 0)}s`],
						// This press's *own* window, which is the number its tone was decided against. The band
						// behind the bars has to pick one for the whole pull, and the docstring above defends
						// that — but it left the reader no way to see the window that actually judged the press
						// they are hovering. On `unbroken` the median is 1 726ms while the press at 83 852 rolled
						// its own 2 246ms tick, so the median is not merely imprecise here, it is the wrong
						// number for that bar.
						['last tick', `${sec(p.tickMs)}s`],
						p.duringAscendance
							? (['reason', 'refresh during Ascendance'] as [string, string])
							: p.ascPrep
								? (['reason', 'Ascendance prep'] as [string, string])
								: p.windowed
									? (['reason', 'refreshed on the last tick'] as [string, string])
									: (['reason', 'early refresh'] as [string, string]),
					],
				},
			};
		});
}

export default function FlameShockDepth({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const el = analysis as Analysis & ElementalAuditResult;
	const { flameShock } = el;
	const refreshes = flameShock.presses.filter((p) => p.remainingMs !== null).length;
	const height = refreshes * ROW_HEIGHT + CHROME;

	const build = useCallback(
		({ theme, narrow, animate }: ChartEnv): ApexOptions => ({
			chart: {
				...baseChart({ id: 'ele-flame-shock-depth', type: 'bar', height, theme, animate }),
			},
			series: [{ name: 'left', data: buildBars(flameShock, theme) }],
			plotOptions: { bar: { horizontal: true, barHeight: '62%', borderRadius: 2 } },
			dataLabels: { enabled: false },
			legend: { show: false },
			stroke: { width: 0 },
			grid: baseGrid(theme),
			annotations: {
				xaxis: [
					{
						/**
						 * One band for a window that is per press — the median, and deliberately unlabelled as such.
						 *
						 * The last tick window is the tail of the dot's duration, so the band belongs at the right
						 * end; but its width moved three times inside `phased` alone (1 349 / 1 748 / 2 275ms) and
						 * this chart has one x-axis to draw it on. `flameShock.tickMs` is the median of the
						 * windows the refreshes were actually judged against, so the band is an **average** of them
						 * and no press is graded against it — a bar's tone comes from that press's own `tickMs`. The
						 * label says "last tick" and quotes no number for exactly that reason: it used to read
						 * "refresh window 1.3s", which asserted one window for a pull that had three.
						 *
						 * Drawing it per press would mean a rectangle per row, which an Apex xaxis annotation cannot
						 * be — it spans the plot. The per-press truth is in the tone and in the tooltip's "dot left"
						 * instead. If this ever becomes a per-row band, take the number back off the median.
						 */
						x: r1((flameShock.durationMs - flameShock.tickMs) / 1000),
						x2: r1(flameShock.durationMs / 1000),
						fillColor: theme.kick,
						borderColor: 'transparent',
						opacity: 0.2,
						...(narrow
							? {}
							: {
									label: {
										text: t('flameShock.chart.band'),
										borderColor: 'transparent',
										orientation: 'horizontal',
										position: 'top',
										offsetY: -6,
										style: {
											background: theme.raised,
											color: theme.muted,
											fontFamily: theme.mono,
											fontSize: LABEL_FONT_SIZE,
										},
									},
								}),
					},
				],
			},
			xaxis: {
				type: 'numeric',
				min: 0,
				max: r1(flameShock.durationMs / 1000),
				tickAmount: narrow ? 3 : 5,
				title: {
					text: narrow ? 'seconds into the dot' : 'seconds held into the dot',
					style: {
						color: theme.muted,
						fontSize: LABEL_FONT_SIZE,
						fontFamily: theme.mono,
						fontWeight: 500,
					},
				},
				axisBorder: { show: false },
				axisTicks: { color: theme.line },
				labels: {
					style: { colors: theme.muted, fontSize: LABEL_FONT_SIZE, fontFamily: theme.mono },
					formatter: (value: string | number) => `${r1(Number(value))}s`,
				},
			},
			yaxis: {
				labels: {
					maxWidth: narrow ? 88 : 104,
					style: { colors: theme.muted, fontSize: LABEL_FONT_SIZE, fontFamily: theme.mono },
				},
			},
			tooltip: baseTooltip(theme),
		}),
		[flameShock, height, t],
	);

	if (refreshes === 0) {
		return <ChartEmpty>{t('flameShock.chart.empty')}</ChartEmpty>;
	}

	return (
		<ChartFigure
			gap="wide"
			caption={
				<>
					<ChartKey tone="kick">{t('flameShock.chart.key.windowed')}</ChartKey>
					<ChartKey tone="brew">{t('flameShock.chart.key.wasted')}</ChartKey>
				</>
			}
		>
			<ApexChart build={build} height={height} label={t('flameShock.chart.label')} />
		</ChartFigure>
	);
}
