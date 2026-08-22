import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatSeconds } from '~/lib/format';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { DataGrid, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '~/components/primitives';

/**
 * Ascendance, on its own, and shown on every pull because it is on every bar.
 *
 * **Not a talent.** It is absent from the sim's shaman talent tree
 * (`ui/core/talents/trees/shaman.json`, eighteen entries and none of them 114049) and registered
 * unconditionally in `sim/shaman/shaman.go:245` — `shaman.registerAscendanceSpell()` inside
 * `Initialize()`, with no talent check. So this section takes no gate: a shaman who never pressed it
 * had it available, and the empty table is a finding rather than a maybe. Getting that backwards
 * would hide the pull's biggest cooldown behind a talent nobody has to take.
 *
 * It used to share one heading with Elemental Mastery and the held-cooldown ledger, which put a table
 * for a talent the player had not taken directly under this one — see `ElementalMastery`.
 */
export default function Ascendance({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { ascendance } = el;
	const { t } = useReportCopy(analysis);

	const rows = useMemo<GridRow[]>(
		() =>
			[...ascendance.presses]
				.sort((a, b) => a.t - b.t)
				.map((press, i) => ({
					key: `${press.t}-${i}`,
					cells: {
						at: formatClock(press.t),
						dotLeft: press.fsRemainingMs === null ? '—' : formatSeconds(press.fsRemainingMs),
						state: press.opener
							? t('ascendance.state.opener')
							: press.twoPiece
								? t('ascendance.state.twoPiece')
								: t('ascendance.state.plain'),
					},
				})),
		[ascendance.presses, t],
	);

	return (
		<Section id="ascendance" title={t('ascendance.title')}>
			<Prose>
				<span className="inline-flex items-center gap-2 align-middle">
					<SpellIcon id={114049} size="sm" />
				</span>{' '}
				{t('ascendance.intent')}
			</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile value={`${ascendance.presses.length}`} label={t('ascendance.kpi.presses')} />
				</StatTiles>
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('ascendance.caption')}
					columns={[
						{ key: 'at', label: t('ascendance.columns.at'), width: '96px' },
						{ key: 'dotLeft', label: t('ascendance.columns.dotLeft'), align: 'right', width: '110px' },
						{ key: 'state', label: t('ascendance.columns.state') },
					]}
					rows={rows}
					empty={t('ascendance.none')}
				/>
			</div>
		</Section>
	);
}
