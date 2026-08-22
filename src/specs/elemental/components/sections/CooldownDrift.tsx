import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatSecondsValue } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import { DataGrid, Prose, Section, StatTile, StatTiles, type GridRow } from '~/components/primitives';

import { heldCooldowns } from './gates';

/**
 * The cooldowns nothing else in the report judges, and how long each stood ready.
 *
 * It stays a table of its own rather than folding into one of the two sections above, because it is
 * not about a button: it is the leftover ledger, one row per cooldown-gated press the placement
 * sections do not cover — Unleash Elements, Elemental Blast for a player who took it, and whatever
 * else a future list puts on a timer. Attaching it to Ascendance or Elemental Mastery would file those
 * rows under a heading naming a button they have nothing to do with.
 *
 * It needs no talent gate of its own even though Elemental Blast is a talent
 * (`ui/core/talents/trees/shaman.json:159-165`, tier six): a row exists only where the log recorded
 * the button being cast, and a cast is positive evidence of the talent. The gate it does need is
 * emptiness — see `hasHeldCooldowns`.
 */
export default function CooldownDrift({ analysis }: { analysis: Analysis }) {
	const { t } = useReportCopy(analysis);
	const held = heldCooldowns(analysis);

	const rows = useMemo<GridRow[]>(
		() =>
			held.map((row) => ({
				key: `${row.id}`,
				cells: {
					name: row.name,
					casts: row.casts,
					lost: row.lostCasts,
					drift: formatSecondsValue(row.driftSec),
				},
			})),
		[held],
	);

	return (
		<Section id="cooldown-drift" title={t('cooldownDrift.title')}>
			<Prose>{t('cooldownDrift.intent')}</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile
						value={`${held.reduce((sum, row) => sum + row.lostCasts, 0)}`}
						label={t('cooldownDrift.kpi.lost')}
					/>
				</StatTiles>
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('cooldownDrift.caption')}
					columns={[
						{ key: 'name', label: t('cooldownDrift.columns.button') },
						{ key: 'casts', label: t('cooldownDrift.columns.casts'), align: 'right', width: '96px' },
						{ key: 'lost', label: t('cooldownDrift.columns.lost'), align: 'right', width: '96px' },
						{ key: 'drift', label: t('cooldownDrift.columns.drift'), align: 'right', width: '110px' },
					]}
					rows={rows}
					empty={t('cooldownDrift.none')}
				/>
			</div>
		</Section>
	);
}
