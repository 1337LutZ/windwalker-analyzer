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
 *
 * **One table, and it is the ledger of what went wrong — not the log.** A per-press table used to sit
 * under this one, naming every Lava Burst and which of the two resets paid for it. Nothing in it was
 * ever a fault: a Lava Burst press is wanted at essentially every point in the priority list, so the
 * table asked a reader to scan a column in which every row was fine. The same argument Earth Shock's
 * table already carries ("the bad-shock ledger, not the log"), and the count survives as a tile.
 *
 * **A press with no Flame Shock on its target is a fault, so it joins that ledger rather than bringing
 * the press list back.** Flame Shock is Lava Burst's ×1.5, and the audit reads it at the instant the
 * cast **completed** — not at the commit the row's own `t` is, and not at the impact either. The
 * docblock on `LavaBurstPress.flameShock` carries the argument for all three instants; what matters
 * here is that a press committed onto a dot with less than a cast time left is in this table, because
 * the game had already decided against it by the time the cast landed. Both kinds of row are "something
 * the player gave away", so they interleave in one time-ordered ledger instead of asking a reader to
 * cross-reference two tables.
 */
export default function LavaBurst({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { lavaBurst } = el;
	const { t } = useReportCopy(analysis);

	const faultRows = useMemo<GridRow[]>(() => {
		const faults = [
			// Only the surges the player actually threw away — a consumed surge needs no row, and one
			// the fight took back during an intermission was never on offer.
			...lavaBurst.procs
				.filter((proc) => proc.wasted)
				.map((proc) => ({ at: proc.start, kind: 'surge', state: t('lavaBurst.state.wasted') })),
			// `=== false` and not `!p.flameShock`: null is "the log named no target and the pull had no
			// hit to fall back on", which is a missing measurement rather than a missing dot.
			...lavaBurst.presses
				.filter((press) => press.flameShock === false)
				.map((press) => ({ at: press.t, kind: 'nodot', state: t('lavaBurst.state.noDot') })),
		];
		return faults
			.sort((a, b) => a.at - b.at)
			.map((fault, i) => ({
				// The kind and the index both belong in the key: two faults can share a millisecond, and
				// the two lists are independent so their stamps can collide.
				key: `${fault.kind}-${fault.at}-${i}`,
				band: 'warn' as const,
				cells: {
					at: formatClock(fault.at),
					state: fault.state,
				},
			}));
	}, [lavaBurst.procs, lavaBurst.presses, t]);

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
					caption={t('lavaBurst.caption')}
					columns={[
						{ key: 'at', label: t('lavaBurst.columns.at'), width: '96px' },
						{ key: 'state', label: t('lavaBurst.columns.state') },
					]}
					rows={faultRows}
					empty={t('lavaBurst.none')}
				/>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				<Note>{t('lavaBurst.note')}</Note>
			</div>
		</Section>
	);
}
