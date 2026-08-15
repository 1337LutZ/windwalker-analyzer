import { useCallback } from 'react';
import type { ApexOptions } from 'apexcharts';
import { useTranslation } from 'react-i18next';

import type { SefTargetLane } from '~/lib/types';

import { fmt, sec } from '../format';
import { ChartFigure } from '../primitives';
import type { ChartEnv } from './ApexChart';
import ApexChart from './ApexChart';
import ChartEmpty from './ChartEmpty';
import ChartKey from './ChartKey';
import type { TipContent } from './apex';
import { LABEL_FONT_SIZE, baseChart, baseGrid, baseTooltip, timeAxis } from './apex';

/**
 * 24, not the 36 the pull timeline and the debuff chart use: those two carry a spell icon beside every
 * row and this one carries an enemy's name. See the note on the same constant in `DebuffTimeline`,
 * which owns the grid both numbers come from.
 */
const ROW_HEIGHT = 24;
/** Everything that is not a row — the clock axis and its margins. Must match the charts it sits near. */
const CHROME = 92;

/** A gap of a second is a real stretch but too thin to hover, so a span is never drawn narrower. */
const minimumSpan = (durationMs: number) => durationMs / 400;

interface Span {
	x: string;
	y: [number, number];
	fillColor: string;
	meta?: TipContent;
}

/**
 * One lane per enemy of this pull, showing when a Storm, Earth and Fire spirit was standing on it.
 *
 * **Why this chart exists.** The section above it can say how long a spirit was out and how much the
 * spirits hit for, and neither answers the question a reader of an add fight actually has: *which*
 * enemies the spirits were on, and whether they were spread or stacked. A single "a spirit was out"
 * bar cannot say — two spirits on two bosses and one spirit shuttling between them draw the same bar.
 *
 * **Where the bars come from, and where they deliberately do not.** They are the spirits' own
 * single-target swings, segmented the way the debuff's contact figure is: each swing owns the time
 * until that spirit's next swing. They are emphatically *not* the press's `targetID`. A spirit placed
 * before the pull has no press inside the fight at all, and on the reference pull the spirit that held
 * one boss for 232 of 245 seconds was exactly that — while the only press in the same stretch named a
 * different enemy, where the other spirit had gone. Keyed to the press, four minutes of spirit time
 * would have been drawn on the wrong boss or not drawn at all.
 *
 * **An empty lane is drawn, not dropped.** That is the opposite of the rule the debuff lanes follow,
 * and on purpose: there, an empty row said only that an add existed, while here it answers the
 * reader's question outright — that enemy was up in front of you and no spirit was ever put on it.
 *
 * Holds no verdict, and takes `useTranslation` rather than `useReportCopy` for that reason: it draws
 * what it is handed. What is *kept out* of it — enemies barely engaged, enemies past the lane cap —
 * is decided in the engine and said in words by the section, never silently by this file.
 */
export default function SpiritLanes({
	targets,
	durationMs,
}: {
	targets: readonly SefTargetLane[];
	durationMs: number;
}) {
	const { t } = useTranslation('report');

	const build = useCallback(
		({ theme, narrow, animate, touch }: ChartEnv): ApexOptions => {
			// An id the actor list could not name is labelled by its id rather than by a neighbour's name,
			// and rather than by a bare "unnamed enemy" — two of those would collapse into one row here,
			// because on this chart the label *is* the lane's identity in a way it is not in a list.
			const rowOf = (target: SefTargetLane): string => target.name ?? t('sef.lanes.unnamed', { id: target.id });
			const floor = minimumSpan(durationMs);
			const spans: Span[] = [
				// Every lane is claimed first, in engine order, and that is what fixes both the row set and the
				// order it is drawn in: ApexCharts builds its categories from the data it is given, so a lane
				// with no window would otherwise vanish and take its answer — "nothing was ever sent here" —
				// with it. Zero-length and transparent, so it reserves the row and marks nothing.
				...targets.map((target): Span => ({ x: rowOf(target), y: [0, 0], fillColor: 'transparent' })),
				...targets.flatMap((target) =>
					target.windows.map((w): Span => ({
						x: rowOf(target),
						y: [w.start, Math.max(w.end, w.start + floor)],
						fillColor: theme.brew,
						meta: {
							title: rowOf(target),
							tone: 'brew',
							rows: [
								['from', fmt(w.start)],
								['held for', `${sec(w.end - w.start)}s`],
							],
						},
					})),
				),
			];

			return {
				chart: {
					...baseChart({
						id: 'ww-sef-lanes',
						type: 'rangeBar',
						height: targets.length * ROW_HEIGHT + CHROME,
						theme,
						animate,
						scrubbable: true,
						durationMs,
						touch,
					}),
				},
				series: [{ name: 'spirits', data: spans }],
				plotOptions: { bar: { horizontal: true, barHeight: '92%', borderRadius: 2, rangeBarGroupRows: false } },
				dataLabels: { enabled: false },
				legend: { show: false },
				stroke: { width: 0 },
				grid: baseGrid(theme),
				xaxis: timeAxis(theme, durationMs, narrow),
				yaxis: {
					labels: {
						maxWidth: narrow ? 96 : 150,
						style: { colors: theme.ink2, fontSize: LABEL_FONT_SIZE, fontFamily: theme.mono },
					},
				},
				tooltip: baseTooltip(theme),
			};
		},
		[durationMs, targets, t],
	);

	if (targets.length === 0) return <ChartEmpty>{t('sef.lanes.empty')}</ChartEmpty>;

	return (
		<ChartFigure
			gap="wide"
			caption={
				<>
					<span className="flex flex-wrap gap-x-4 gap-y-2">
						<ChartKey tone="brew">{t('sef.lanes.key')}</ChartKey>
					</span>
					<span>{t('sef.lanes.caption')}</span>
				</>
			}
		>
			<ApexChart
				build={build}
				height={targets.length * ROW_HEIGHT + CHROME}
				// `lanes`, not `count`: `count` is i18next's plural trigger and would send this key looking for
				// `chartLabel_one`/`_other` variants that have no reason to exist.
				label={t('sef.lanes.chartLabel', { lanes: targets.length })}
			/>
		</ChartFigure>
	);
}
