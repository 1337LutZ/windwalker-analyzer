import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatSeconds, formatSecondsValue } from '~/lib/format';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '~/components/primitives';

/**
 * The cooldowns, each judged against the rule the list actually presses it on — never a bare clock.
 *
 * Ascendance is the opener or the tier-16 two-piece window, Elemental Mastery is synced with
 * Ascendance; the two summons keep their own sections. Only Unleash Elements and Elemental Blast are
 * plain "press when ready", and those two keep the drift table.
 */

/** The buttons whose verdict is a placement, not a cooldown — they come out of the drift table. */
const PLACEMENT_IDS = new Set([114049, 16166, 2894]);

export default function Cooldowns({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { ascendance, elementalMastery } = el;
	const { t } = useReportCopy(analysis);

	const ascRows = useMemo<GridRow[]>(
		() =>
			[...ascendance.presses]
				.sort((a, b) => a.t - b.t)
				.map((press, i) => ({
					key: `${press.t}-${i}`,
					cells: {
						at: formatClock(press.t),
						dotLeft: press.fsRemainingMs === null ? '—' : formatSeconds(press.fsRemainingMs),
						state: press.opener
							? t('cooldowns.state.opener')
							: press.twoPiece
								? t('cooldowns.state.twoPiece')
								: t('cooldowns.state.plain'),
					},
				})),
		[ascendance.presses, t],
	);

	const emRows = useMemo<GridRow[]>(
		() =>
			[...elementalMastery.presses]
				.sort((a, b) => a.t - b.t)
				.map((press, i) => ({
					key: `${press.t}-${i}`,
					cells: {
						at: formatClock(press.t),
						state: press.reason === null ? t('cooldowns.state.plain') : t(`cooldowns.state.${press.reason}`),
					},
				})),
		[elementalMastery.presses, t],
	);

	const driftRows = useMemo<GridRow[]>(
		() =>
			[...analysis.lostCasts]
				.filter((row) => row.cooldownSec > 0 && !PLACEMENT_IDS.has(row.id))
				.sort((a, b) => b.driftSec - a.driftSec)
				.map((row) => ({
					key: `${row.id}`,
					cells: {
						name: row.name,
						casts: row.casts,
						lost: row.lostCasts,
						drift: formatSecondsValue(row.driftSec),
					},
				})),
		[analysis.lostCasts],
	);

	return (
		<Section id="cooldowns" title={t('cooldowns.title')}>
			<Prose>
				<span className="inline-flex items-center gap-2 align-middle">
					<SpellIcon id={114049} size="sm" />
				</span>{' '}
				{t('cooldowns.intent')}
			</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile value={`${ascendance.presses.length}`} label={t('cooldowns.kpi.ascendance')} />
					<StatTile
						value={`${analysis.lostCasts.filter((r) => !PLACEMENT_IDS.has(r.id)).reduce((s, r) => s + r.lostCasts, 0)}`}
						label={t('cooldowns.kpi.lost')}
					/>
				</StatTiles>
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('cooldowns.ascCaption')}
					columns={[
						{ key: 'at', label: t('cooldowns.columns.at'), width: '96px' },
						{ key: 'dotLeft', label: t('cooldowns.columns.dotLeft'), align: 'right', width: '110px' },
						{ key: 'state', label: t('cooldowns.columns.state') },
					]}
					rows={ascRows}
					empty={t('cooldowns.ascNone')}
				/>
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('cooldowns.emCaption')}
					columns={[
						{ key: 'at', label: t('cooldowns.columns.at'), width: '96px' },
						{ key: 'state', label: t('cooldowns.columns.state') },
					]}
					rows={emRows}
					empty={t('cooldowns.emNone')}
				/>
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('cooldowns.driftCaption')}
					columns={[
						{ key: 'name', label: t('cooldowns.columns.button') },
						{ key: 'casts', label: t('cooldowns.columns.casts'), align: 'right', width: '96px' },
						{ key: 'lost', label: t('cooldowns.columns.lost'), align: 'right', width: '96px' },
						{ key: 'drift', label: t('cooldowns.columns.drift'), align: 'right', width: '110px' },
					]}
					rows={driftRows}
					empty={t('cooldowns.driftNone')}
				/>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				<Note>{t('cooldowns.pe')}</Note>
			</div>
		</Section>
	);
}
