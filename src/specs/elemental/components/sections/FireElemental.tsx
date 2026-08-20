import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock } from '~/lib/format';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '~/components/primitives';

/**
 * Fire Elemental: the five-minute summon.
 *
 * The p5 list presses it prepull when Heroism is going up on the pull, synced with Ascendance, or in
 * the pull's last minute — and nowhere else. The section is about whether it went out at all and
 * whether each press was one of those three windows.
 */
export default function FireElemental({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { fireElemental } = el;
	const { t } = useReportCopy(analysis);

	const rows = useMemo<GridRow[]>(
		() =>
			[...fireElemental.presses]
				.sort((a, b) => a.t - b.t)
				.map((press, i) => ({
					key: `${press.t}-${i}`,
					band: press.reason === null ? ('warn' as const) : undefined,
					cells: {
						at: formatClock(press.t),
						state: press.reason === null ? t('fireElemental.state.plain') : t(`fireElemental.state.${press.reason}`),
					},
				})),
		[fireElemental.presses, t],
	);

	return (
		<Section id="fire-elemental" title={t('fireElemental.title')}>
			<Prose>
				<span className="inline-flex items-center gap-2 align-middle">
					<SpellIcon id={2894} size="sm" />
				</span>{' '}
				{t('fireElemental.intent')}
			</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile value={`${fireElemental.presses.length}`} label={t('fireElemental.kpi.used')} />
					<StatTile
						value={`${fireElemental.presses.filter((p) => p.reason !== null).length}`}
						label={t('fireElemental.kpi.inWindow')}
					/>
				</StatTiles>
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('fireElemental.caption')}
					columns={[
						{ key: 'at', label: t('fireElemental.columns.at'), width: '96px' },
						{ key: 'state', label: t('fireElemental.columns.state') },
					]}
					rows={rows}
					empty={t('fireElemental.none')}
				/>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				<Note>{fireElemental.prepull ? t('fireElemental.prepullYes') : t('fireElemental.prepullNo')}</Note>
			</div>
		</Section>
	);
}
