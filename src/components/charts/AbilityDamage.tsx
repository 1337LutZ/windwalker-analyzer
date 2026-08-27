import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useNarrow } from '~/hooks/useNarrow';
import type { ApexOptions } from 'apexcharts';

import type { Analysis } from '~/lib/types';
import { byCastOrder } from '~/lib/view/castOrder';

import { useSpec } from '../report/specContext';

import { n, r1 } from '../format';
import type { ChartEnv } from './ApexChart';
import ApexChart from './ApexChart';
import ChartEmpty from './ChartEmpty';
import TrackLabels, { type Track } from './TrackLabels';
import { baseChart, baseGrid, baseTooltip, LABEL_FONT_SIZE } from './apex';

/**
 * Row height, on a 4px grid shared by every chart in the report.
 *
 * 48 for the two that carry an icon beside each row — the pull timeline and the Rising Sun Kick
 * debuff — because a 24px icon in a 34px row leaves no air, and because those two are read against
 * each other. 24 for the rest, which are bars and text.
 *
 * Picked as a grid rather than per chart: five charts had five heights (32, 34, 38, 46, 34), which is
 * five arbitrary numbers rather than a system, and two timelines of the same pull sitting at
 * different pitches read as two different tools.
 */
const ROW_HEIGHT = 24;
const CHROME = 56;

/** Beyond this the tail is single-percent rows, and the chart stops being a comparison. */
const ROWS = 9;

/**
 * Headroom for the labels, which sit just past the end of each bar.
 *
 * They used to sit *inside* the bar, which meant a bar shorter than its own label had to go
 * unlabelled — and the rows that lost their number were the small ones, exactly where a reader
 * cannot estimate the value off the axis. Drawing them outside means every row is readable, at the
 * cost of reserving a little space past the longest bar for the text to land in.
 */
const LABEL_HEADROOM_PCT = 4;

/**
 * Width reserved for the row labels, handed to ApexCharts as `grid.padding.left` so the plot starts
 * after it. Same numbers the y-axis labels used before the icons arrived — `Rising Sun Kick` is the
 * longest name the rotation produces — plus the icon and its gap.
 */
const LABEL_PX = 172;
const NARROW_LABEL_PX = 118;
const GRID_PADDING = { top: 0, right: 8, bottom: 0 };

/**
 * Damage share per pressed ability.
 *
 * Passive and gear damage — autoattacks, trinket and enchant procs, external buffs — is left out:
 * no button produced it, so ranking it against buttons would flatter or damn the rotation for
 * something outside it. The report lists those separately underneath.
 */
export default function AbilityDamage({ analysis }: { analysis: Analysis }) {
	// For the ability table behind the cast order — the same registry the rest of the report reads.
	const spec = useSpec();
	// `useTranslation`, not `useReportCopy`: a chart draws what it is handed and asks for no verdict.
	const { t } = useTranslation('report');
	// The rotation's own order, the same one the cast table and the compare page use, so a reader moving
	// between the two is not re-learning where a button sits. See `lib/view/castOrder`.
	const abilities = useMemo(
		() =>
			analysis.damage.abilities
				.filter((a) => !a.passive && !a.utility && a.total > 0)
				// Cut to the biggest rows *first*, then order them. The cap is about which buttons are worth
				// drawing, and taking the top of a rotation-ordered list would drop whichever ones happen to
				// sit late in the rotation rather than the ones that did the least.
				.slice(0, ROWS)
				.sort(byCastOrder((a) => spec.registry.abilityByDamageId(a.id)?.key ?? null, spec)),
		[analysis.damage.abilities, spec],
	);
	const height = abilities.length * ROW_HEIGHT + CHROME;

	const build = useCallback(
		({ theme, narrow, animate }: ChartEnv): ApexOptions => ({
			chart: {
				...baseChart({
					id: 'ww-ability-damage',
					type: 'bar',
					height,
					theme,
					animate,
				}),
			},
			series: [
				{
					name: 'share',
					data: abilities.map((a) => ({
						x: a.name,
						y: r1(a.share),
						meta: {
							title: a.name,
							tone: 'kick' as const,
							rows: [
								['share', `${r1(a.share)}%`],
								['damage', n(a.total)],
								['hits', `${a.hits}`],
								['crit', `${r1(a.critPct)}%`],
								['average hit', n(a.avgHit)],
							] as Array<[string, string]>,
						},
					})),
				},
			],
			colors: [theme.kick],
			plotOptions: {
				// `position: 'top'` on a horizontal bar means the far end of the bar, which is where the
				// label is anchored from.
				bar: { horizontal: true, barHeight: '64%', borderRadius: 2, dataLabels: { position: 'top' } },
			},
			// Just past the end of each bar, so the chart reads without a hover and every row keeps its
			// number however short its bar. On a phone there is no room for them beside the bars at all.
			dataLabels: {
				enabled: !narrow,
				textAnchor: 'start',
				// A row is only here because it did damage, so rounding it to a flat `0%` reads as a bug
				// rather than as a small number.
				formatter: (value: string | number) => (Number(value) < 0.1 ? '<0.1%' : `${r1(Number(value))}%`),
				offsetX: 8,
				// Outside the bar the label is on the page ground, not on the fill, so it takes body ink
				// rather than the background colour it used when it sat inside.
				style: {
					colors: [theme.ink2],
					fontFamily: theme.mono,
					fontSize: LABEL_FONT_SIZE,
					fontWeight: 600,
				},
			},
			legend: { show: false },
			stroke: { width: 0 },
			grid: { ...baseGrid(theme), padding: { ...GRID_PADDING, left: narrow ? NARROW_LABEL_PX : LABEL_PX } },
			xaxis: {
				type: 'numeric',
				min: 0,
				// Room past the longest bar for its label to sit in; without it the top row's number is
				// clipped by the plot edge.
				// The largest share rather than the first row's: the rows are in rotation order now, and the
				// biggest bar is wherever the rotation happens to put it.
				max: Math.ceil(Math.max(0, ...abilities.map((a) => a.share)) + LABEL_HEADROOM_PCT),
				// Two labels fewer on a phone: at 14px, five `100%` ticks collide well before the bars do.
				tickAmount: narrow ? 2 : 5,
				axisBorder: { show: false },
				axisTicks: { color: theme.line },
				labels: {
					style: {
						colors: theme.muted,
						fontSize: LABEL_FONT_SIZE,
						fontFamily: theme.mono,
					},
					formatter: (value: string | number) => `${Math.round(Number(value))}%`,
				},
			},
			// Drawn as HTML beside the chart rather than as SVG axis text, because an icon cannot live
			// inside an SVG `<text>` node — the same treatment, and the same component, as the pull
			// timeline's tracks. ApexCharts still reserves the column through `grid.padding.left`.
			yaxis: { labels: { show: false } },
			tooltip: baseTooltip(theme),
		}),
		[abilities, height],
	);

	if (abilities.length === 0) {
		return <ChartEmpty>{t('damage.chartEmpty')}</ChartEmpty>;
	}

	// Matched to `build`'s own `narrow`, which ApexCharts is handed at draw time: the label column and
	// the padding the chart reserves for it have to agree, or the labels sit over the plot.
	const narrow = useNarrow();
	const tracks: Track[] = abilities.map((a) => ({ iconId: a.id, label: a.name }));

	return (
		<div className="relative">
			<TrackLabels tracks={tracks} width={narrow ? NARROW_LABEL_PX : LABEL_PX} />
			<ApexChart
				build={build}
				height={height}
				label={`Damage share by ability: ${abilities.map((a) => `${a.name} ${r1(a.share)} percent`).join(', ')}`}
			/>
		</div>
	);
}
