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
					/**
					 * Three of the six press kinds are faults; three are not.
					 *
					 * `late` (the dot dropped while the player was there), `early` (a healthy dot clipped) and a
					 * refresh under Ascendance (a global the list wanted on Lava Burst) earn the band. An
					 * `apply` is the opener and no decision at all; a `reapply` put the dot back up after the
					 * fight took the target away or after sub-second jitter, which is not a mistake either.
					 *
					 * This used to read `press.remainingMs === null`, which was all three down-states at once —
					 * so a pull with one apply, six clean refreshes and 100% uptime had its opener banded as a
					 * fault and labelled "Late refresh".
					 */
					const faulted =
						press.kind === 'late' || press.kind === 'early' || (press.duringAscendance && press.remainingMs !== null);
					return {
						key: `${press.t}-${i}`,
						band: faulted ? ('warn' as const) : undefined,
						cells: {
							at: formatClock(press.t),
							// The dot's remaining time where there was one; otherwise how long it had been down on
							// the player's own watch, which is the number the three down-states are judged on.
							remaining:
								press.remainingMs !== null
									? formatSeconds(press.remainingMs)
									: press.kind === 'apply'
										? '—'
										: formatSeconds(press.exposedMs ?? 0),
							state:
								press.remainingMs === null
									? t(`flameShock.state.${press.kind}`)
									: press.duringAscendance
										? t('flameShock.state.duringAscendance')
										: t(`flameShock.state.${press.kind}`),
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
