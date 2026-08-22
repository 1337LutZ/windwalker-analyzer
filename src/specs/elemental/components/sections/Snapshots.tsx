import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock } from '~/lib/format';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '~/components/primitives';

/**
 * Snapshots: the proc-window Flame Shock refreshes the sim's priority-7 rule wants.
 *
 * When one of the three triggers (the UVLS buff, the UVLS counter at ten, or Black Blood of
 * Y'Shaarj at ten) overlaps an intellect proc, the list wants Flame Shock reapplied inside it so the
 * snapshot freezes the proc's spellpower. A window the dot was up through with no refresh inside is
 * a missed snapshot; the section counts them and the refresh that each window did or did not get.
 */
export default function Snapshots({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { snapshots } = el;
	const { t, unasked, verdict } = useReportCopy(analysis);

	const rows = useMemo<GridRow[]>(
		() =>
			[...snapshots.windows]
				.sort((a, b) => a.start - b.start)
				.map((window, i) => ({
					key: `${window.start}-${i}`,
					cells: {
						at: `${formatClock(window.start)}–${formatClock(window.end)}`,
						source: t(`flameShockSnapshots.source.${window.source}`),
					},
				})),
		[snapshots.windows, t],
	);

	return (
		<Section id="snapshots" title={t('flameShockSnapshots.title')}>
			<Prose>
				<span className="inline-flex items-center gap-2 align-middle">
					<SpellIcon id={8050} size="sm" />
				</span>{' '}
				{t('flameShockSnapshots.intent')}
			</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile
						value={`${snapshots.refreshed}`}
						suffix={`/${snapshots.refreshed + snapshots.missed}`}
						label={
							unasked('flameShockSnapshots')
								? `${t('flameShockSnapshots.kpi.refreshed')} — ${t('metric.notAsked')}`
								: t('flameShockSnapshots.kpi.refreshed')
						}
					/>
					<StatTile value={`${snapshots.missed}`} label={t('flameShockSnapshots.kpi.missed')} />
				</StatTiles>
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('flameShockSnapshots.caption')}
					columns={[
						{ key: 'at', label: t('flameShockSnapshots.columns.window'), width: '200px' },
						{ key: 'source', label: t('flameShockSnapshots.columns.source') },
					]}
					rows={rows}
					empty={t('flameShockSnapshots.none')}
				/>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				<Prose>
					{verdict('flameShockSnapshots', {
						caught: snapshots.refreshed,
						offered: snapshots.refreshed + snapshots.missed,
					})}
				</Prose>
				<Note>{t('flameShockSnapshots.measurable')}</Note>
			</div>
		</Section>
	);
}
