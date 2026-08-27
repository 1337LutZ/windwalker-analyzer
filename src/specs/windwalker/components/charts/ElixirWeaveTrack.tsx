import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApexOptions } from 'apexcharts';

import { formatSeconds } from '~/lib/format';
import type { WeaveSummary } from '~/lib/types';

import { fmt, r1, sec } from '~/components/format';
import { ChartFigure } from '~/components/primitives';
import type { ChartEnv } from '~/components/charts/ApexChart';
import ApexChart from '~/components/charts/ApexChart';
import ChartEmpty from '~/components/charts/ChartEmpty';
import ChartKey from '~/components/charts/ChartKey';
import type { ChartTheme, TipContent } from '~/components/charts/apex';
import { LABEL_FONT_SIZE, baseChart, baseGrid, baseTooltip } from '~/components/charts/apex';

/**
 * One row per brew, drawn the way the snapshot chart draws one row per Rune proc.
 *
 * **The two charts are the same picture read from opposite ends, so they are drawn the same way.** On
 * Snapshots a Rune proc is the span, the brew is the mark inside it and the shaded band at the right
 * is the last second the brew could land in. Here the brew is the span, the two elixir presses are the
 * marks, and the shaded band at the right is the last second the elixir should come back in. A reader
 * who has learned to read one has learned to read the other, and the leeway they are both drawn
 * against is a number that reader sets.
 *
 * Stacked, for the reason `SnapshotDepth` is: a bar that has to *start* somewhere other than zero
 * needs a spacer under it, and stacking is what ApexCharts gives instead of a floating bar. The lead-in
 * carries the brew's own colour at low opacity rather than being invisible, so the part of the brew
 * spent on Monk's Elixir still reads as brew.
 */
const ROW_HEIGHT = 24;
const CHROME = 88;

interface Bar {
	x: string;
	y: number;
	fillColor: string;
	meta: TipContent;
}

/**
 * `04 · 2:10`, the moment the brew went up, and the index padded so ten does not shunt the column.
 *
 * `fmt` — the clock — rather than `formatStamp`, which carries milliseconds. `SnapshotDepth` measured
 * this gutter and sized it for exactly this form: "`01 · 12:30` is the longest row label there is: ten
 * characters of mono at 14px". `formatStamp` adds four more, so on a pull past ten minutes the label
 * overran `maxWidth` and ApexCharts truncated it with an ellipsis — which reads as a number that lost
 * its digits rather than as a label that did not fit.
 */
const rowLabel = (start: number, at: number) => `${String(at + 1).padStart(2, '0')} · ${fmt(start)}`;

/**
 * The stretch before the swap, which is brew the monk spent holding mastery they could no longer use.
 *
 * Zero-width on a clean weave, because the swap lands within a millisecond of the brew. It is drawn at
 * all for the rows where it is not: an elixir pressed eight seconds into the brew wasted eight seconds
 * of the window, and a bar that started at the swap would show that as a short weave rather than as a
 * late one.
 */
function leadBars(weave: WeaveSummary, theme: ChartTheme): Bar[] {
	return weave.brews.map((brew, at) => {
		const lead = brew.offAt !== null && !brew.early ? Math.max(0, brew.offAt) : 0;
		return {
			x: rowLabel(brew.start, at),
			y: r1(lead / 1000),
			fillColor: `${theme.brew}44`,
			meta: { title: rowLabel(brew.start, at), tone: 'brew', rows: [['on Monk’s Elixir', `${sec(lead)}s`]] },
		};
	});
}

/**
 * The weave itself, and the colour is the whole reading.
 *
 * `kick` for a weave that closed inside the leeway, `brew` for one that did not — the same pair
 * Snapshots uses for "on the last global" against "early", and for the same distinction.
 *
 * **`brew` carries two outcomes and the key says so.** A close that came back too soon and one that
 * never came back inside the brew at all are both "the elixir was not where it should have been when
 * this brew ended", and both draw the same colour. Naming the key for only the first would have a
 * reader hunting the chart for a second colour that is not on it. `miss` is a
 * brew nobody weaved off, drawn full width because the whole brew is what went by, and it is the same
 * tone Snapshots gives "never snapshotted": the two charts sit on one page and a reader should not have
 * to learn two colours for "this chance went past untouched".
 *
 * That leaves the dilution needing its own, and it gets `missSoft` rather than the violet Snapshots
 * uses for an unholdable proc. Violet means "the Rune did what you asked" one section up; spending it
 * on a fault here would have one colour carrying opposite readings on the same screen. `missSoft` is
 * already the softer miss over there and is a softer miss here.
 */
function weaveBars(weave: WeaveSummary, theme: ChartTheme): Bar[] {
	return weave.brews.map((brew, at) => {
		const length = brew.end - brew.start;
		const label = rowLabel(brew.start, at);

		if (brew.early) {
			// Drawn full width in the miss tone, because the brew was diluted for its whole life: the
			// elixir came off before `OnGain` read the mastery, so every second of this bar is a brew
			// carrying less than it could have.
			return {
				x: label,
				y: r1(length / 1000),
				fillColor: theme.missSoft,
				meta: {
					title: label,
					tone: 'missSoft',
					rows: [
						['swapped', `${sec(Math.abs(brew.offAt ?? 0))}s before the brew`],
						['cost', 'the brew froze diluted mastery'],
					],
				},
			};
		}

		if (brew.offAt === null) {
			return {
				x: label,
				y: r1(length / 1000),
				fillColor: theme.miss,
				meta: {
					title: label,
					tone: 'miss',
					rows: [[brew.truncated === true ? 'fight ended' : 'no weave', `${sec(length)}s of brew`]],
				},
			};
		}

		const back = brew.backAt ?? length;
		return {
			x: label,
			y: r1((back - brew.offAt) / 1000),
			fillColor: brew.returnedOnTime ? theme.kick : theme.brew,
			meta: {
				title: label,
				tone: brew.returnedOnTime ? 'kick' : 'brew',
				rows: [
					['swapped onto', brew.offStat ?? 'another elixir'],
					['weaved for', `${sec(back - brew.offAt)}s`],
					brew.backAt === null
						? ['came back', 'not before the brew ended']
						: ['came back', `${sec(length - brew.backAt)}s before the brew ended`],
				],
			},
		};
	});
}

export default function ElixirWeaveTrack({ weave }: { weave: WeaveSummary }) {
	const { t } = useTranslation('report');
	const height = weave.brews.length * ROW_HEIGHT + CHROME;
	// Every row is drawn on the longest brew's scale, so a truncated one reads short rather than being
	// stretched to match — the fight ending underneath it is the fact that row is making.
	const longestMs = weave.brews.reduce((most, brew) => Math.max(most, brew.end - brew.start), 0);

	const build = useCallback(
		({ theme, narrow, animate }: ChartEnv): ApexOptions => ({
			chart: {
				...baseChart({ id: 'ww-elixir-weave', type: 'bar', height, theme, animate }),
				stacked: true,
			},
			series: [
				{ name: 'held', data: leadBars(weave, theme) },
				{ name: 'weaved', data: weaveBars(weave, theme) },
			],
			plotOptions: { bar: { horizontal: true, barHeight: '62%', borderRadius: 2 } },
			dataLabels: { enabled: false },
			legend: { show: false },
			stroke: { width: 0 },
			grid: baseGrid(theme),
			annotations: {
				// The band, and the label is spread in only where there is room — passing `label: undefined`
				// throws inside ApexCharts' own mount, which is the trap `SnapshotDepth` documents.
				xaxis: [
					{
						x: r1((longestMs - weave.returnLeewayMs) / 1000),
						x2: r1(longestMs / 1000),
						fillColor: theme.kick,
						borderColor: 'transparent',
						opacity: 0.2,
						...(narrow
							? {}
							: {
									label: {
										// Names the setting and carries the value in use, so the chart and the note
										// under the section spell the same window the same way.
										text: `weave leeway ${formatSeconds(weave.returnLeewayMs)}`,
										// Anchored at its right edge for `SnapshotDepth`'s measured reason: ApexCharts
										// draws this label at the band's left edge with no clip path, so a centred one
										// hangs off the end of the plot.
										textAnchor: 'end',
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
				max: r1(longestMs / 1000),
				tickAmount: narrow ? 3 : 5,
				title: {
					text: narrow ? 'seconds into the brew' : 'seconds into the brew',
					style: { color: theme.muted, fontSize: LABEL_FONT_SIZE, fontFamily: theme.mono, fontWeight: 500 },
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
		[weave, height, longestMs],
	);

	const options = useMemo(() => build, [build]);

	if (weave.brews.length === 0) return <ChartEmpty>{t('weave.chartEmpty')}</ChartEmpty>;

	return (
		<ChartFigure
			gap="wide"
			caption={
				<>
					<ChartKey tone="kick">{t('weave.key.onTime')}</ChartKey>
					<ChartKey tone="brew">{t('weave.key.early')}</ChartKey>
					<ChartKey tone="miss">{t('weave.key.missed')}</ChartKey>
					{/* Only when the pull has one. A key for an outcome nobody hit sends a reader hunting the
					    chart for a colour that is not on it — the rule the Snapshots keys already follow. */}
					{weave.early > 0 ? <ChartKey tone="missSoft">{t('weave.key.diluted')}</ChartKey> : null}
				</>
			}
		>
			<ApexChart build={options} height={height} label={t('weave.chartLabel')} />
		</ChartFigure>
	);
}
