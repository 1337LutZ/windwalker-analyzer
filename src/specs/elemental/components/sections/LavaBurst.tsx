import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock } from '~/lib/format';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '~/components/primitives';

/**
 * Lava Burst and its two resets.
 *
 * Lava Surge makes one Lava Burst free, and Ascendance resets the cooldown — the ladder's `readyWhen`
 * is exactly those two. The section is about the one free cast that is invisible in a cast count: a
 * surge that expired with no Lava Burst inside was a free cast thrown away.
 */
export default function LavaBurst({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { lavaBurst } = el;
	const { t } = useReportCopy(analysis);

	const procRows = useMemo<GridRow[]>(
		() =>
			[...lavaBurst.procs]
				// Only the surges the player actually threw away — a consumed surge needs no row, and one
				// the fight took back during an intermission was never on offer.
				.filter((proc) => proc.wasted)
				.sort((a, b) => a.start - b.start)
				.map((proc, i) => ({
					key: `${proc.start}-${i}`,
					band: 'warn' as const,
					cells: {
						at: formatClock(proc.start),
						state: t('lavaBurst.state.wasted'),
					},
				})),
		[lavaBurst.procs, t],
	);

	const pressRows = useMemo<GridRow[]>(
		() =>
			[...lavaBurst.presses]
				.sort((a, b) => a.t - b.t)
				.map((press, i) => ({
					key: `${press.t}-${i}`,
					cells: {
						at: formatClock(press.t),
						state: press.surge
							? t('lavaBurst.state.surge')
							: press.ascendance
								? t('lavaBurst.state.ascendance')
								: t('lavaBurst.state.cooldown'),
					},
				})),
		[lavaBurst.presses, t],
	);

	return (
		<Section id="lava-burst" title={t('lavaBurst.title')}>
			<Prose>
				<span className="inline-flex items-center gap-2 align-middle">
					<SpellIcon id={51505} size="sm" />
				</span>{' '}
				{t('lavaBurst.intent')}
			</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile value={`${lavaBurst.presses.length}`} label={t('lavaBurst.kpi.casts')} />
					<StatTile value={`${lavaBurst.procs.length}`} label={t('lavaBurst.kpi.procs')} />
					<StatTile value={`${lavaBurst.wasted}`} label={t('lavaBurst.kpi.wasted')} />
				</StatTiles>
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('lavaBurst.procCaption')}
					columns={[
						{ key: 'at', label: t('lavaBurst.columns.at'), width: '96px' },
						{ key: 'state', label: t('lavaBurst.columns.state') },
					]}
					rows={procRows}
					empty={t('lavaBurst.none')}
				/>
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('lavaBurst.pressCaption')}
					columns={[
						{ key: 'at', label: t('lavaBurst.columns.at'), width: '96px' },
						{ key: 'state', label: t('lavaBurst.columns.state') },
					]}
					rows={pressRows}
					empty={t('lavaBurst.noPresses')}
				/>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				<Note>{t('lavaBurst.note')}</Note>
			</div>
		</Section>
	);
}
