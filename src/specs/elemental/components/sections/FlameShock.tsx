import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatPercent, formatPercentValue, formatSeconds } from '~/lib/format';
import type { Analysis, ElementalAuditResult, FlameShockPress } from '~/lib/types';

import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '~/components/primitives';
import FlameShockDepth from '../charts/FlameShockDepth';
import FlameShockUptime from '../charts/FlameShockUptime';

/**
 * The uptime a reader is looking at, rather than the one the audit holds.
 *
 * `formatPercentValue` prints two decimals, so every figure from here up renders as `100%` — and a
 * sentence under a tile reading 100% must not describe a gap. A band rather than an equality test
 * because the dot's last window can close a millisecond before the engaged clock does: the `unbroken`
 * fixture is 99.99946%, which prints as 100% and had no gap in it.
 *
 * A band open at the top rather than a range, and this half is a backstop rather than a live case.
 * `c85f6d4` intersects the dot's windows with the engaged clock before dividing, so the ratio can no
 * longer exceed 100 — it used to be a union of dot windows over engaged time and reached 100.21% on a
 * real pull. Kept because the consequence of a value over 100 falling through is wording that claims a
 * gap on a pull that had none, which is the worst failure this comparison has; a `>=` cannot produce
 * it and a range could. Do not narrow it back on the grounds that the ratio is now clipped.
 */
const FULL_UPTIME_PCT = 99.995;

/**
 * How a credited early refresh is worded, and which of its two figures the sentence leads with.
 *
 * Plan §87. The gain a `snapshot` press is credited for is a total, and its largest single term is
 * Clearcasting's +20% — twice the threshold on its own, and up for 52-72% of the committed pulls. Two of
 * the three presses this report credits were made under it. So a row that said "worth the tick" beside a
 * section talking about a trinket's spellpower was telling a reader the wrong reason for a right number.
 *
 * `snapshotDeltaWithoutClearcastingPct` is that same gain with the proc divided out of whichever
 * application froze it, and it is **strictly equal** to the total when the proc is not a term — both dots
 * had it, or neither did — which is what makes the comparison below a safe way to decide whether the proc
 * is worth naming. That equality is guaranteed at the point of derivation, not approximated; see the
 * field's own doc.
 *
 * Returns the interpolation for the neutral string when there is nothing to attribute, so a press with no
 * reading at all keeps exactly the wording it had.
 */
function snapshotWording(press: FlameShockPress): Record<string, string> {
	const gain = press.snapshotDeltaPct;
	const own = press.snapshotDeltaWithoutClearcastingPct;
	// Only the credited kind, rather than every press that happens to carry a reading. A `windowed`
	// refresh needs no snapshot excuse and is not counted under one (see the ladder's ordering in
	// `lib/index.ts`), so re-wording its row on a figure it was not judged on would say the excuse was
	// used. Passing nothing keeps every other kind on the string it already had, with no lookup that
	// depends on a missing-context fallback.
	if (press.kind !== 'snapshot' || gain === null || own === null) return {};
	if (own === gain) return { gain: formatPercent(gain) };
	return {
		gain: formatPercent(gain),
		own: formatPercent(own),
		// `froze` where this dot carries the proc and the one it replaced did not; `gaveUp` the other way
		// round, which is the case that matters most — `unbroken`'s refresh at 2:20 is 32.7% stronger while
		// *losing* the proc, so it is 59.2% stronger on everything else. A press like that is the clearest
		// evidence the figure is not an artefact of the proc, and it deserves its own sentence.
		context: press.snapshotClearcasting ? 'froze' : 'gaveUp',
	};
}

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
	// The stretches three or more enemies were up, straight off the array the audit's own `gradedSpans` is
	// the complement of — the same one `FlameShockUptime` shades. Read here only to decide whether the
	// note below has a band to explain.
	const aoeWindows = el.lightningShield.aoeWindows;
	const { t, gradeOf, unasked } = useReportCopy(analysis);
	/**
	 * A tile whose number nothing on this reading was measured against says so in its own label rather
	 * than in a note under the table — see the same two lines in `SearingTotem.tsx`. The number stays.
	 *
	 * **`emptyClock` is the second way a figure goes unmeasured, and `unasked` cannot see it.** `exempt` is
	 * set in `metricOf` when the *reading* declares no band the rule covers; an empty graded clock is the
	 * other branch there (`thin`) and leaves `unmeasurable` true with no `exempt` flag, so a metric whose
	 * every gradable second fell inside an add wave arrives here looking graded. Both are "nothing measured
	 * this" as far as a caption is concerned, and the caption is the same sentence for both.
	 */
	const tile = (key: string, metric: string, emptyClock = false) =>
		unasked(metric) || emptyClock ? `${t(key)} — ${t('metric.notAsked')}` : t(key);

	const rows = useMemo<GridRow[]>(
		() =>
			[...flameShock.presses]
				.sort((a, b) => a.t - b.t)
				.map((press, i) => {
					/**
					 * Three of the seven press kinds are faults; four are not.
					 *
					 * `late` (the dot dropped while the player was there), `early` (a tick thrown away — the
					 * dot still owed two or more and one of them was clipped off) and a refresh under
					 * Ascendance (a global the list wanted on Lava Burst) earn the band. An
					 * `apply` is the opener and no decision at all; a `reapply` put the dot back up after the
					 * fight took the target away or after sub-second jitter, which is not a mistake either; and
					 * a `snapshot` refresh clipped the dot on purpose, for a new application worth more than
					 * 10% more per second, which is the list's own reason to press early.
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
							// The figure the verdict on this row was actually made on, and the reason the column
							// exists: `dot left` is measured against the dot's *declared* duration and so runs
							// half a tick long, which is the whole width of the rule. A refresh the log carried
							// too few ticks to count reads `—` and was graded on `dot left` after all. A press
							// onto a dot that was already down is not graded on a count at all.
							ticksLeft: press.remainingMs === null || press.ticksLeft === null ? '—' : `${press.ticksLeft}`,
							state:
								press.remainingMs === null
									? t(`flameShock.state.${press.kind}`)
									: press.duringAscendance
										? t('flameShock.state.duringAscendance')
										: t(`flameShock.state.${press.kind}`, snapshotWording(press)),
						},
					};
				}),
		[flameShock.presses, t],
	);

	/**
	 * Which wording the grade is said in — never which grade it is.
	 *
	 * The grade is still `lib/score`'s, from the uptime and the wasted-refresh share together, which
	 * means a pull that never let the dot off the target can still be graded on its refreshes alone.
	 * The graded sentences are written around an uptime figure with a gap in it, so on that pull they
	 * read as a complaint about a flawless keep-up; the `_full` variants say what happened instead.
	 * A pull with no dot window at all has nothing to claim and keeps `verdict_none`.
	 */
	const grade = gradeOf('flameShock');
	const fullUptime = flameShock.windows.length > 0 && flameShock.uptimePct >= FULL_UPTIME_PCT;
	// `exempt` is excluded alongside `none`, and it has to be: the `_full` variants exist to re-word a
	// *graded* sentence written around a gap, and there is no `verdict_exempt_full` — i18next resolves a
	// missing context to the bare `flameShock.verdict`, which no section has, and renders the key itself at
	// the reader. `unbroken` read as multi-target is exactly that pull: 100% uptime and every rule unasked,
	// so it printed the literal text `flameShock.verdict` where its verdict belongs.
	const context = fullUptime && grade !== 'none' && grade !== 'exempt' ? `${grade}_full` : grade;

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
					<StatTile
						value={formatPercentValue(flameShock.uptimePct)}
						label={tile('flameShock.kpi.uptime', 'flameShockUptime')}
					/>
					<StatTile value={`${flameShock.applies}`} label={t('flameShock.kpi.applies')} />
					<StatTile value={`${flameShock.refreshes}`} label={t('flameShock.kpi.refreshes')} />
					<StatTile value={`${flameShock.windowed}`} label={t('flameShock.kpi.windowed')} />
					{/* The cleave rule's own tile, present whenever the pull actually had a second enemy to dot.

					    **Gated on the core's untrimmed clock and no longer on the rule's own.** Since `9397af8`
					    `flameShock.multiTargetMs` is the *graded* length — band 2 alone, cut at both ends — so it
					    is zero on a pull whose every two-target second fell inside an add wave, and this gate
					    deleted the tile on exactly the pulls the caption was written for. `targets.multiTargetMs`
					    is the mode share's own numerator, untrimmed by design, and it answers the question the
					    gate is actually asking: was there ever a second enemy here at all.

					    An unmeasured figure is not a deleted one — the rule `8e011ac` set for the totem and the
					    shield tiles — but nor is it a zero. `multiDotUptimePct` is `0` when its clock is empty
					    because `0 / 0` has to be something, and printing "0%" would accuse the reader of never
					    dotting a second target the report never looked for. So the tile keeps its place, says in
					    its label that nothing measured it, and shows a dash where the figure would be. */}
					{(el.targets?.multiTargetMs ?? 0) > 0 ? (
						<StatTile
							value={flameShock.multiTargetMs > 0 ? formatPercentValue(flameShock.multiDotUptimePct) : '—'}
							label={tile('flameShock.kpi.multiDot', 'flameShockMultiDot', flameShock.multiTargetMs === 0)}
						/>
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
						{ key: 'ticksLeft', label: t('flameShock.columns.ticksLeft'), align: 'right', width: '86px' },
						{ key: 'state', label: t('flameShock.columns.state') },
					]}
					rows={rows}
					empty={t('flameShock.none')}
				/>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				<Prose>
					{t('flameShock.verdict', {
						context,
						uptime: flameShock.uptimePct,
						casts: flameShock.applies + flameShock.refreshes,
						// The same subtraction `score.ts` makes for `flameShockWaste`, and it has to stay the same
						// one: the sentence and the grade underneath it are about the identical set of presses.
						wasted: flameShock.refreshes - flameShock.windowed - flameShock.ascPrep - flameShock.snapshotGain,
					})}
				</Prose>
				{/* What the grey band on the uptime graph means, on the pulls that have one.

				    The same gate and the same argument as `lightningShield.aoeNote`: the key names the band
				    and a key cannot carry a reason, so without this the graph shades a stretch and the tile
				    prints a percentage with no text anywhere saying the second was measured over the
				    complement of the first. Gated on the band rather than printed always, because a note on
				    every pull tells a reader nothing about this one — and it is the only place the
				    two-target case is stated, which is the half a reader who takes the grey to mean "adds
				    were forgiven" is owed. */}
				{aoeWindows.length === 0 ? null : <Note>{t('flameShock.aoeNote')}</Note>}
				{/* The second dot's own clock, and the only place it is stated — because it is the one figure in
				    this section with no band on the graph above.

				    `flameShock.multiTargetMs` is band 2 *alone*: the ceiling the grey band shades **and** a floor
				    at one enemy, since a pull with one enemy has no second target to dot. Neither existing chart
				    may shade that floor — band 1 is fully counted for the primary dot and for the totem, so a grey
				    band there would say the opposite of the truth about the row it sat under — and the second dot
				    can have no chart of its own, because the secondary target's dot is published as a scalar and
				    never as an array, so there would be no up row to draw. A reader comparing this tile against
				    the graph therefore sees the ceiling shaded and nothing for the floor, and this is where that
				    is answered. The arithmetic behind it is asserted without a picture, in `exemptTrack.test.ts`
				    beside the two clocks that have one.

				    Gated with the tile rather than on the add waves: the floor exists on every pull the tile
				    appears on, including one that never exceeded two enemies and so has no grey band at all. */}
				{(el.targets?.multiTargetMs ?? 0) > 0 ? <Note>{t('flameShock.multiDotNote')}</Note> : null}
				<Note>{t('flameShock.snapshotNote')}</Note>
			</div>
		</Section>
	);
}
