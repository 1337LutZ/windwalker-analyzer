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
 * The dot is a snapshot, so a refresh is only wanted near its end — the keep-it-up window the reader
 * sets (`flameShockRefreshMs`) — or just before Ascendance. A press into a healthy dot is a global
 * and a snapshot both thrown away, and the band marks the window at the right end that separates the
 * two.
 */
function buildBars(flameShock: FlameShockAudit, theme: ChartTheme): Bar[] {
	return flameShock.presses
		.filter((p) => p.remainingMs !== null)
		.map((p, i) => {
			const label = `${String(i + 1).padStart(2, '0')} · ${fmt(p.t)}`;
			// A refresh during Ascendance is the one outright fault; an early refresh (a healthy dot
			// clipped) is the amber; the keep-up window and the Ascendance prep are both the accent.
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
						p.duringAscendance
							? (['reason', 'refresh during Ascendance'] as [string, string])
							: p.ascPrep
								? (['reason', 'Ascendance prep'] as [string, string])
								: p.windowed
									? (['reason', 'keep-it-up window'] as [string, string])
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
						// The keep-it-up window is the tail of the dot's full duration, drawn at the right end.
						x: r1((flameShock.durationMs - flameShock.refreshMs) / 1000),
						x2: r1(flameShock.durationMs / 1000),
						fillColor: theme.kick,
						borderColor: 'transparent',
						opacity: 0.2,
						...(narrow
							? {}
							: {
									label: {
										text: t('flameShock.chart.band', { window: sec(flameShock.refreshMs) }),
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
