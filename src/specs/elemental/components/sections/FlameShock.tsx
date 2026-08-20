import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatPercentValue, formatSeconds } from '~/lib/format';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '~/components/primitives';
import FlameShockDepth from '../charts/FlameShockDepth';
import FlameShockUptime from '../charts/FlameShockUptime';

/**
 * Flame Shock: the dot the whole rotation is written around.
 *
 * A thirty-second snapshot dot with no cooldown and no cast time. Its remaining time gates Lava
 * Burst, its refresh timing is what the snapshot section grades, and every proc-window reapplies it
 * to freeze the converted stats. A dropped Flame Shock is not one global but a cascade, so the
 * section is uptime first and the timing of every refresh second.
 */
export default function FlameShock({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { flameShock } = el;
	const { t, verdict } = useReportCopy(analysis);

	const rows = useMemo<GridRow[]>(
		() =>
			[...flameShock.presses]
				.sort((a, b) => a.t - b.t)
				.map((press, i) => {
					// The three red timings — late (the dot dropped), during Ascendance, and early (a healthy
					// dot clipped) — all get the fault band; the two good ones stay plain.
					const faulted = press.remainingMs === null || press.duringAscendance || (!press.windowed && !press.ascPrep);
					return {
						key: `${press.t}-${i}`,
						band: faulted ? ('warn' as const) : undefined,
						cells: {
							at: formatClock(press.t),
							remaining: press.remainingMs === null ? t('flameShock.state.late') : formatSeconds(press.remainingMs),
							state:
								press.remainingMs === null
									? t('flameShock.state.late')
									: press.duringAscendance
										? t('flameShock.state.duringAscendance')
										: press.ascPrep
											? t('flameShock.state.ascPrep')
											: press.windowed
												? t('flameShock.state.windowed')
												: t('flameShock.state.early'),
						},
					};
				}),
		[flameShock.presses, t],
	);

	return (
		<Section id="flame-shock" title={t('flameShock.title')}>
			<Prose>
				<span className="inline-flex items-center gap-2 align-middle">
					<SpellIcon id={8050} size="sm" />
				</span>{' '}
				{t('flameShock.intent')}
			</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile value={formatPercentValue(flameShock.uptimePct)} label={t('flameShock.kpi.uptime')} />
					<StatTile value={`${flameShock.applies}`} label={t('flameShock.kpi.applies')} />
					<StatTile value={`${flameShock.refreshes}`} label={t('flameShock.kpi.refreshes')} />
					<StatTile value={`${flameShock.windowed}`} label={t('flameShock.kpi.windowed')} />
					{/* The cleave rule's own tile, present only when the pull actually had a second target. */}
					{flameShock.multiTargetMs > 0 ? (
						<StatTile value={formatPercentValue(flameShock.multiDotUptimePct)} label={t('flameShock.kpi.multiDot')} />
					) : null}
				</StatTiles>
			</div>

			<div className="mt-5">
				<FlameShockUptime analysis={analysis} />
			</div>

			<div className="mt-5">
				<FlameShockDepth analysis={analysis} />
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('flameShock.caption')}
					columns={[
						{ key: 'at', label: t('flameShock.columns.at'), width: '96px' },
						{ key: 'remaining', label: t('flameShock.columns.remaining'), align: 'right', width: '110px' },
						{ key: 'state', label: t('flameShock.columns.state') },
					]}
					rows={rows}
					empty={t('flameShock.none')}
				/>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				<Prose>
					{verdict('flameShock', {
						uptime: flameShock.uptimePct,
						casts: flameShock.applies + flameShock.refreshes,
						wasted: flameShock.refreshes - flameShock.windowed - flameShock.ascPrep,
					})}
				</Prose>
				<Note>{t('flameShock.snapshotNote')}</Note>
			</div>
		</Section>
	);
}
