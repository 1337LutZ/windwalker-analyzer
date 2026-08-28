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
	// The stretches three or more enemies were up, straight off the array the audit's own `gradedSpans` is
	// the complement of — the same one `SearingTotemUptime` shades. Read here only to decide whether the
	// note below has a band to explain.
	const exemptWindows = el.lightningShield.exemptWindows;
	const { t, gradeOf, unasked, verdict } = useReportCopy(analysis);

	/**
	 * Which question the verdict below is answering — because on one reading it is not the totem's uptime.
	 *
	 * The section is graded on two metrics and only one of them has a scope: `searingTotemUptime` is
	 * `bands: [1, 2]`, because `aoe.apl.json` has no fire-totem rung, while `searingTotemOverlaps` is asked
	 * at every enemy count (a totem laid under the elemental buys nothing however many enemies are up —
	 * that ruling is written out at the metric). So on a reading of three or more enemies the uptime is
	 * unasked, the overlap count is not, and `section()` reads the letter off the overlap count alone.
	 *
	 * **The letter is kept and narrowed rather than withheld, and this is the argument.** Zero overlaps is a
	 * true finding about the pull at every enemy count, and printing nothing would tell a reader the totem
	 * went unread when half of it did not — the same indistinguishability the header's *judged on N of M
	 * points* line is printed on every pull to avoid. What was wrong was never the letter but the sentence
	 * under it: every un-narrowed arm opens on the uptime percentage, so a `good` earned by an empty overlap
	 * ledger was being read out as a claim about a percentage nothing had measured. So the wording switches
	 * with the scope, leads with what was not measured, and says which figure the letter is about.
	 *
	 * Only over the three real grades. With the totem never cast the overlap count is unmeasurable too and
	 * `gradeOf` already answers `none`, which is the honest "never pressed" sentence and needs no variant.
	 *
	 * **That last clause has stopped being true, and `neverPressed` is what replaces it.** The uptime now
	 * grades a pull that never laid a totem `bad` off its own nought per cent — the slot was the player's
	 * for 226.9s of `addsThenBoss` and stood empty, which is the worst reading of this section and not a
	 * question the report declines. So the letter is a real one there, and every arm it can select opens
	 * on a press ledger that is empty: the un-narrowed family reads out a clip count of nought as though
	 * nought clips were a habit worth crediting, three lines under the table's own *"No presses to list."*
	 * The plain sentence is reached by name off the ledger instead, the same call `LightningShield.tsx`
	 * makes off its curve and for the same reason — one reading of the log, not a second one.
	 */
	const neverPressed = searingTotem.presses.length === 0;
	const grade = gradeOf('searingTotem');
	const uptimeUnasked = unasked('searingTotemUptime');
	const narrowed = !neverPressed && uptimeUnasked && grade !== 'none' && grade !== 'exempt';

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
					{/* The tile keeps its number and gains the caption, rather than printing a dash: the figure is a
					    real measurement of the pull and dropping it would lose information a reader can use. What it
					    is not is a figure anything was measured against on this reading, and the caption is where
					    that is said — beside the number, not in a note below the table. */}
					<StatTile
						value={formatPercentValue(searingTotem.uptimePct)}
						label={t('searingTotem.kpi.uptime')}
						caption={uptimeUnasked ? t('metric.notAsked') : undefined}
					/>
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
					{neverPressed
						? /*
							 * No totem was ever laid, and the graded arms cannot say that.
							 *
							 * Reached by name rather than through `verdict()`, because `verdict()` picks its arm off a
							 * letter and this pull now has one: the uptime grades `bad` at nought per cent over a clock
							 * the audit ruled gradable, so `gradeOf` answers `bad` and the `bad` arms are three
							 * sentences about clipped presses on a pull with no presses in it. `verdict_bad_zero` is
							 * the one it would land on — *"and no press landed over a live totem"* — which is a credit
							 * for a habit nobody had the chance to break, printed over *"No presses to list."*
							 *
							 * Gated on the press ledger and not on the window list, because the ledger is the array the
							 * table below draws from: whatever puts "No presses to list." on the page is what puts this
							 * sentence on it, and the two cannot come apart.
							 */
							t('searingTotem.verdict', { context: 'none' })
						: narrowed
							? t('searingTotem.verdict', {
									context: `${grade}_noUptime`,
									uptime: searingTotem.uptimePct,
									overlaps: searingTotem.feOverlaps,
								})
							: /*
								 * `count` is the clipped-press figure, so the sentence agrees with it at every value it
								 * can take — *"1 presses clipped"* and *"0 presses clipped, throwing away 0s"* were both
								 * reachable, and the second one on two committed pulls.
								 *
								 * Only the un-narrowed route needs it. Clipping is not one of this section's two graded
								 * metrics, so the letter above the sentence says nothing about how many presses clipped
								 * — `phased` grades `ok` on uptime alone with nothing clipped at all — which is exactly
								 * why the figure has to carry its own agreement rather than borrow it from the grade. The
								 * narrowed route names the overlap count instead and no arm of it prints this one.
								 *
								 * **All three letters, and `good` was the one that had to be talked into it.** It is the
								 * same fact as the paragraph above read the other way round: the one sentence stored under
								 * `good` asserted that no press landed over a live totem, which `cleave` disproves at 88.5%
								 * uptime, no overlap and one clip. So the clean claim moved to the arm the count can only be
								 * nought on, and the other two report the clip and say plainly it is not part of what was
								 * measured. The alternative was to grade the clip — a new rule, a weight and four fixtures
								 * re-measured to fix a sentence; the argument is in the suite beside this component.
								 */
								verdict('searingTotem', {
									uptime: searingTotem.uptimePct,
									clipped: searingTotem.clipped,
									count: searingTotem.clipped,
									wasted: searingTotem.wastedMs,
								})}
				</Prose>
				{/* What the grey band on the graph above means, on the pulls that have one. Same gate and same
				    argument as `lightningShield.aoeNote` — see the note in the Flame Shock section. */}
				{/* The one instruction the exempt sentence used to end on, said as a note instead.

				    It shipped as the tail of nine graded sentences — three arms each of the two narrowed
				    families and the three `verdict_exempt` arms — which put seventeen words of page navigation
				    after the reader's own figure in every one of them. One key now, and the verdict ends on the
				    pull. Still said per section rather than left to the control: by the time a reader is here the
				    toggle is off screen, which is the argument `PriorityLadder` and `Rotation` both make. */}
				{narrowed ? <Note>{t('targets.switchReading')}</Note> : null}
				{exemptWindows.length === 0 ? null : <Note>{t('searingTotem.aoeNote')}</Note>}
				<Note>{t('searingTotem.gate')}</Note>
			</div>
		</Section>
	);
}
