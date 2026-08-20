import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock } from '~/lib/format';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { DataGrid, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '~/components/primitives';

/**
 * Earth Elemental: the end-of-fight summon.
 *
 * The p5 list presses it almost entirely in end-of-fight terms (`remainingTime <= 62s`), so the
 * section is about whether it went out at all and whether each press was the list's own window — a
 * press with a minute and a half left is a summon the pull's last stretch never got.
 */
export default function EarthElemental({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { earthElemental } = el;
	const { t } = useReportCopy(analysis);

	const rows = useMemo<GridRow[]>(
		() =>
			[...earthElemental.presses]
				.sort((a, b) => a.t - b.t)
				.map((press, i) => ({
					key: `${press.t}-${i}`,
					band: press.nearEnd ? undefined : ('warn' as const),
					cells: {
						at: formatClock(press.t),
						state: press.nearEnd ? t('earthElemental.state.nearEnd') : t('earthElemental.state.early'),
					},
				})),
		[earthElemental.presses, t],
	);

	return (
		<Section id="earth-elemental" title={t('earthElemental.title')}>
			<Prose>
				<span className="inline-flex items-center gap-2 align-middle">
					<SpellIcon id={2062} size="sm" />
				</span>{' '}
				{t('earthElemental.intent')}
			</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile value={`${earthElemental.presses.length}`} label={t('earthElemental.kpi.used')} />
					<StatTile
						value={`${earthElemental.presses.filter((p) => p.nearEnd).length}`}
						label={t('earthElemental.kpi.nearEnd')}
					/>
				</StatTiles>
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('earthElemental.caption')}
					columns={[
						{ key: 'at', label: t('earthElemental.columns.at'), width: '96px' },
						{ key: 'state', label: t('earthElemental.columns.state') },
					]}
					rows={rows}
					empty={t('earthElemental.none')}
				/>
			</div>
		</Section>
	);
}
