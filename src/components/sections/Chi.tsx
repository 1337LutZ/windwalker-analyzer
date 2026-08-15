import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatInteger } from '~/lib/format';
import { wasteTone } from '~/lib/score/waste';
import type { Analysis } from '~/lib/types';

import ResourceChart from '../charts/ResourceChart';
import { DataGrid, Note, Prose, Section, StatTile, StatTiles, type GridRow } from '../primitives';

/**
 * The chi bar over the pull, and every point of it that went nowhere.
 *
 * The companion to the energy section, and deliberately not a copy of it. Energy is a pool that
 * refills on a clock, so its fault is a *duration* — seconds spent at the ceiling with the tap still
 * running — and it has to be split into engaged and downtime before it can be judged, because a bar
 * filling behind an untargetable boss is the fight's doing. Chi is none of that. It arrives in whole
 * points from a button that was pressed, so its fault is a *count*: a press that returned two into a
 * bar with room for one threw one away, and it did so whether or not there was a boss in front of
 * you. There is nothing to split.
 *
 * That is also why the bar is drawn as steps rather than as a line. Chi is an integer holding four,
 * or five with Ascension, and sloping between two readings would draw a value the resource cannot
 * hold — a diagonal through 2.5 chi is not a quantity anyone had. A step holds its value until the
 * next reading says otherwise, which is what actually happened.
 *
 * Nothing here is graded, for the same reason `lib/score` grades no energy section: the priority list
 * contains no number of wasted chi that is acceptable. It spends chi when it has something worth
 * spending it on and pools it when it does not. What the section can do honestly is show the bar,
 * count the overflow, and say where each point went.
 */
export default function Chi({ analysis }: { analysis: Analysis }) {
	const { t } = useReportCopy(analysis);
	const chi = analysis.resources?.chi;

	const overflow = useMemo(() => chi?.wasted ?? [], [chi]);
	const total = useMemo(() => overflow.reduce((sum, w) => sum + w.wasted, 0), [overflow]);

	const rows = useMemo<GridRow[]>(
		() =>
			// Worst first: a press that threw away two points is a different mistake from one that
			// threw away one, and a reader scanning this table is looking for the expensive ones.
			[...overflow]
				.sort((a, b) => b.wasted - a.wasted || a.t - b.t)
				.map((w, i) => ({
					key: `${w.t}-${i}`,
					band: 'warn' as const,
					cells: {
						at: <span className="tabular font-mono">{formatClock(w.t)}</span>,
						wasted: <b className="font-semibold text-miss">{formatInteger(w.wasted)}</b>,
					},
				})),
		[overflow],
	);

	// A report captured before the events query asked for resources carries no curve at all —
	// `undefined`, not an empty one — and the heading still has to render, because `SectionNav` lists
	// every section unconditionally and a link with no heading behind it is a jump to nowhere.
	if (chi === undefined || chi.points.length === 0) {
		return (
			<Section id="chi" title={t('chi.title')}>
				<Prose>{t('chi.intent')}</Prose>
				<div className="mt-5">
					<Note>{t('chi.none')}</Note>
				</div>
			</Section>
		);
	}

	return (
		<Section id="chi" title={t('chi.title')}>
			<Prose>{t('chi.intent')}</Prose>

			<div className="mt-4.5">
				{/* Three views of one accounting, worst first. The press count and the bar's ceiling were here
				    before and are gone: the ceiling is drawn on the chart below, and how *many* presses
				    overflowed matters far less than how much chi they threw away — two presses losing one
				    each is a smaller fault than one press losing two. */}
				<StatTiles>
					{/* Waste leads, and carries the only colour on the row. `gained` excludes the overflow by
					    construction — the walk clamps each gain at the ceiling — so the share is measured
					    against everything the pull generated, overflow included, which is the denominator a
					    reader means by "how much did I throw away". */}
					<StatTile
						value={formatInteger(total)}
						label={t('chi.kpi.wasted')}
						grade={wasteTone(total, (chi.gained ?? 0) + total)}
					/>
					<StatTile value={formatInteger(chi.spent ?? 0)} label={t('chi.kpi.spent')} />
					<StatTile value={formatInteger(chi.gained ?? 0)} label={t('chi.kpi.gained')} />
				</StatTiles>
			</div>

			{/* The same component the timeline draws chi with, at the same scale and in the same amber,
			    so the row up there and the chart down here are recognisably one bar rather than two
			    readings of it. It marks each overflow itself, which is why no band is passed — only the
			    line of the key that says what those marks are, and only when the pull has any. */}
			<div className="mt-5">
				<ResourceChart
					curve={chi}
					durationMs={analysis.durationMs}
					mode="steps"
					tone="brew"
					legend={t('chi.key.bar')}
					wastedLegend={t('chi.key.wasted')}
					label={t('chi.chartLabel', { max: chi.max, wasted: total })}
				/>
			</div>

			<div className="mt-5">
				{total === 0 ? (
					<Prose>{t('chi.clean')}</Prose>
				) : (
					<>
						<Prose>{t('chi.summary', { wasted: total, moments: overflow.length })}</Prose>
						<div className="mt-5">
							<DataGrid
								caption={t('chi.tableCaption')}
								minWidth="360px"
								columns={[
									{ key: 'at', label: t('chi.columns.at'), width: '120px' },
									{ key: 'wasted', label: t('chi.columns.wasted'), align: 'right' },
								]}
								rows={rows}
								empty={t('chi.noRows')}
							/>
						</div>
					</>
				)}
			</div>

			{/* The same caveat the energy section carries, and for the same reason: the bar is read from
			    whatever events happened to report it, so a point gained and spent between two readings is
			    invisible here. The count is a floor, not a total. */}
			<div className="mt-4">
				<Note>{t('chi.resolution')}</Note>
			</div>
		</Section>
	);
}
