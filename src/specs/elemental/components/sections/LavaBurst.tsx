import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock } from '~/lib/format';
import type { Analysis, ElementalAuditResult, JudgmentCause } from '~/lib/types';

import {
	CauseLegend,
	CauseTag,
	DataGrid,
	Note,
	Prose,
	Section,
	SpellIcon,
	StatTile,
	StatTiles,
	type GridRow,
} from '~/components/primitives';

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
	const { t, gradeOf, unasked } = useReportCopy(analysis);

	const faultRows = useMemo<(GridRow & { cause: JudgmentCause })[]>(() => {
		const faults = [
			// Only the surges the player actually threw away — a consumed surge needs no row, and one
			// the fight took back during an intermission was never on offer.
			// **Two states, because two of these are not the same mistake.** A surge that expired at one or two
			// enemies is a free cast the list asked for and the player did not take; one that expired inside
			// an add phase is a free cast the list never asks for, since `aoe.apl.json` carries no Lava Burst
			// rung at all, so it is listed without being faulted and the note under the table says how many.
			// `judged` is the engine's own flag, so the row, the note and the summary card are one reading.
			//
			// **The uncharged row names the add phase and never the pull walking away**, which is sound
			// rather than a simplification: a row exists only for a *wasted* surge, and `wasted` is itself
			// gated on the expiry landing inside the contact clock, so a window with nothing in range
			// throughout cannot reach this table. `lavaSurgeWaste.test.ts` holds that pairing.
			...lavaBurst.procs
				.filter((proc) => proc.wasted)
				.map((proc) => ({
					at: proc.start,
					kind: 'surge',
					fault: proc.judged !== false,
					// The engine's own tag, never re-derived here: `docs/conventions.md` puts which sentence
					// comes back with the audit and not with the component, and the same holds for whose the
					// sentence is. A proc captured before the field existed falls back to the reading the tint
					// already makes, so an older analysis draws the tag it would have drawn.
					cause: proc.cause ?? (proc.judged === false ? ('rotation' as const) : ('player' as const)),
					state: t(proc.judged === false ? 'lavaBurst.state.wastedAdds' : 'lavaBurst.state.wasted'),
				})),
			// `=== false` and not `!p.flameShock`: null is "the log named no target and the pull had no
			// hit to fall back on", which is a missing measurement rather than a missing dot.
			...lavaBurst.presses
				.filter((press) => press.flameShock === false)
				.map((press) => ({
					at: press.t,
					kind: 'nodot',
					fault: true,
					// A press made onto an undotted target is the player's whatever the enemy count was: the
					// list wants Flame Shock under every Lava Burst, at every band.
					cause: 'player' as const,
					state: t('lavaBurst.state.noDot'),
				})),
		];
		return faults
			.sort((a, b) => a.at - b.at)
			.map((fault, i) => ({
				// The kind and the index both belong in the key: two faults can share a millisecond, and
				// the two lists are independent so their stamps can collide.
				key: `${fault.kind}-${fault.at}-${i}`,
				// Kept on the row as well as drawn in the cell, so the legend below lists the tags this table
				// actually spent rather than the six that exist.
				cause: fault.cause,
				// The colour is the claim, so the row the add wave excuses does not carry one.
				...(fault.fault ? { band: 'warn' as const } : {}),
				cells: {
					at: formatClock(fault.at),
					// The tag rides in the cell rather than in a column of its own: the folded card view gives a
					// column its own row, and a one-word cause stacked above the sentence it belongs to reads as
					// two facts rather than one. `GridRow.cells` takes a node, which is what makes this free.
					state: (
						<span className="inline-flex items-baseline">
							<CauseTag cause={fault.cause} />
							<span>{fault.state}</span>
						</span>
					),
				},
			}));
	}, [lavaBurst.procs, lavaBurst.presses, t]);

	// The surges the table lists and the card does not charge: wasted, and wasted at a count the priority
	// list has no Lava Burst rung at. Counted off the procs rather than as `wasted - wastedJudged`, so an
	// analysis captured before the flag existed reads zero rather than the whole wasted count.
	const excused = lavaBurst.procs.filter((proc) => proc.wasted && proc.judged === false).length;

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
					{/* **The same pair the summary card grades, and both halves are deliberate.** The numerator is the
					    surges the player threw away and the denominator is every proc the fight handed out, which is
					    not the count the numerator was cut from: a proc that expired inside an add wave is not
					    charged, and it is still one of the free casts this pull offered. Showing the judged count
					    here instead hid the total two tiles along and made the tile and the card disagree with the
					    table, which is where this landed. The table is where a forgiven surge is accounted for, row
					    by row, with the reason it was not charged. */}
					<StatTile
						value={`${lavaBurst.wastedJudged ?? lavaBurst.wasted}`}
						suffix={`/${lavaBurst.procs.length}`}
						label={t('lavaBurst.kpi.wasted')}
						caption={unasked('lavaSurgeWaste') ? t('metric.notAsked') : undefined}
					/>
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

			{/* The vocabulary, under the table that spends it and only for the tags this pull drew. A reader
			    meets `Rotation` beside "nothing to fix" in the same glance as the row it belongs to, which is
			    what keeps a forgiven row from reading as a softer fault. */}
			<div className="mt-3.5">
				<CauseLegend causes={faultRows.map((row) => row.cause).filter((cause) => cause !== undefined)} />
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				{/* Only when the pull actually excused one, so a single-target reader never meets a sentence
				    about add phases, and never on a reading that exempted the rule outright: a note explaining
				    why the tile was not charged is nonsense beside a tile nobody asked a charge of.
				    `EarthShock.tsx` guards its own AoE note the same way. */}
				{excused > 0 && gradeOf('lavaBurst') !== 'exempt' ? (
					<Note>{t('lavaBurst.aoeNote', { count: excused, charged: lavaBurst.wastedJudged ?? 0 })}</Note>
				) : null}
				<Note>{t('lavaBurst.note')}</Note>
			</div>
		</Section>
	);
}
