import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatPercentValue, formatSeconds } from '~/lib/format';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '~/components/primitives';
import SearingTotemUptime from '../charts/SearingTotemUptime';

/**
 * Searing Totem: the sixty-second fire-and-forget.
 *
 * One global, a minute of ticks. The sim gates it on the Fire Elemental not being out and no totem
 * already ticking, so the section is uptime against engaged time, the dot-time a re-press threw away,
 * the placements that came under the Fire Elemental, and the ones too late to matter.
 */
export default function SearingTotem({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { searingTotem } = el;
	const { t, verdict } = useReportCopy(analysis);

	const rows = useMemo<GridRow[]>(
		() =>
			[...searingTotem.presses]
				.sort((a, b) => a.t - b.t)
				.map((press, i) => {
					// A clip and an under-Fire-Elemental placement are both faults; a late placement is a
					// fault only past the ten-second line, which is how the press was flagged in the audit.
					const faulted = press.clipped || press.feOverlap || press.late;
					return {
						key: `${press.t}-${i}`,
						band: faulted ? ('warn' as const) : undefined,
						cells: {
							at: formatClock(press.t),
							remaining: press.remainingMs === null ? '—' : formatSeconds(press.remainingMs),
							state: press.feOverlap
								? t('searingTotem.state.feOverlap')
								: press.late
									? t('searingTotem.state.late')
									: press.remainingMs === null
										? t('searingTotem.state.fresh')
										: press.clipped
											? t('searingTotem.state.clip')
											: t('searingTotem.state.refresh'),
						},
					};
				}),
		[searingTotem.presses, t],
	);

	return (
		<Section id="searing-totem" title={t('searingTotem.title')}>
			<Prose>
				<span className="inline-flex items-center gap-2 align-middle">
					<SpellIcon id={3599} size="sm" />
				</span>{' '}
				{t('searingTotem.intent')}
			</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile value={formatPercentValue(searingTotem.uptimePct)} label={t('searingTotem.kpi.uptime')} />
					<StatTile value={`${searingTotem.clipped}`} label={t('searingTotem.kpi.clipped')} />
					<StatTile value={formatSeconds(searingTotem.wastedMs)} label={t('searingTotem.kpi.wasted')} />
					<StatTile value={`${searingTotem.feOverlaps}`} label={t('searingTotem.kpi.overlaps')} />
					<StatTile value={`${searingTotem.latePlacements}`} label={t('searingTotem.kpi.late')} />
				</StatTiles>
			</div>

			<div className="mt-5">
				<SearingTotemUptime analysis={analysis} />
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('searingTotem.caption')}
					columns={[
						{ key: 'at', label: t('searingTotem.columns.at'), width: '96px' },
						{ key: 'remaining', label: t('searingTotem.columns.remaining'), align: 'right', width: '110px' },
						{ key: 'state', label: t('searingTotem.columns.state') },
					]}
					rows={rows}
					empty={t('searingTotem.none')}
				/>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				<Prose>
					{verdict('searingTotem', {
						uptime: searingTotem.uptimePct,
						clipped: searingTotem.clipped,
						wasted: searingTotem.wastedMs,
					})}
				</Prose>
				<Note>{t('searingTotem.gate')}</Note>
			</div>
		</Section>
	);
}
