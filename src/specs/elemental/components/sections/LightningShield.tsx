import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatSeconds } from '~/lib/format';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '~/components/primitives';
import ResourceChart, { type TrackBand } from '~/components/charts/ResourceChart';
import { resourceCurveFromPoints } from '~/components/charts/resourceCurve';
import { exemptRows } from '~/components/charts/exempt';
import { EXEMPT } from '~/components/charts/tones';

/**
 * Lightning Shield: the counter every Earth Shock is spent from.
 *
 * The shield is not a dot and not a clock — it is a seven-charge counter that builds on Rolling
 * Thunder and is spent whole by Earth Shock's Fulmination. The chart draws the counter itself, on
 * the same stepped scale the Tigereye Brew bank uses, and shades its two faults in red: sitting at
 * the ceiling so long the Rolling Thunder has nowhere to put its charge, and coming all the way off.
 * The table lists only the bad spends — a shock taken below the ceiling — because a spend at seven is
 * the whole game and needs no row.
 */
export default function LightningShield({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { lightningShield } = el;
	const { t, gradeOf, unasked, verdict } = useReportCopy(analysis);

	/**
	 * Which of the shield's two faults the verdict below is answering for — because on one reading it is
	 * only one of them.
	 *
	 * `lightningShieldOvercap` is `bands: [1, 2]` (nothing in the multi-target order spends the charges, so
	 * sitting at seven is the only state available) and `lightningShieldFellOff` has no scope at all, for
	 * the reason the metric spells out: Rolling Thunder returns mana per charge and only while the buff is
	 * up, so keeping it up pays at every enemy count. On a reading of three or more enemies the overcap is
	 * unasked, the drop count is not, and the letter comes off the drop count alone.
	 *
	 * **Kept and narrowed rather than withheld** — the argument is in `SearingTotem.tsx`, which is in the
	 * same state for the same reason. Here the old sentence was worse than a mislead: `verdict_good` says
	 * "The shield never sat at seven past the leeway", which is a positive claim about a duration nothing
	 * had measured, and on `phased` that duration is not zero.
	 */
	const grade = gradeOf('lightningShield');
	const overcapUnasked = unasked('lightningShieldOvercap');
	const narrowed = overcapUnasked && grade !== 'none' && grade !== 'exempt';

	/**
	 * The stretches left out of the overcap figure, as the chart's exempt row.
	 *
	 * Straight off `lightningShield.aoeWindows`, which is the array the audit's own denominator dropped —
	 * not a second derivation of "when was it AoE". That identity is the rule `exemptTrack.test.ts` was
	 * written to enforce, after three charts each guessed at the same idea differently.
	 */
	const aoeBand = useMemo(
		() =>
			exemptRows(
				[
					{
						label: t('lightningShield.key.aoe'),
						windows: el.lightningShield.aoeWindows.map((w): [number, number] => [w.start, w.end]),
					},
				],
				analysis.durationMs,
			)[0]?.windows ?? [],
		[el.lightningShield.aoeWindows, analysis.durationMs, t],
	);

	const curve = useMemo(
		() => resourceCurveFromPoints(lightningShield.points, lightningShield.maxStacks),
		[lightningShield.points, lightningShield.maxStacks],
	);

	const badRows = useMemo<GridRow[]>(
		() =>
			[...lightningShield.badSpends]
				.sort((a, b) => a.t - b.t)
				.map((spend, i) => ({
					key: `${spend.t}-${i}`,
					band: 'warn' as const,
					cells: {
						at: formatClock(spend.t),
						stacks: spend.stacks === null ? '—' : `${spend.stacks}`,
					},
				})),
		[lightningShield.badSpends],
	);

	return (
		<Section id="lightning-shield" title={t('lightningShield.title')}>
			<Prose>
				<span className="inline-flex items-center gap-2 align-middle">
					<SpellIcon id={324} size="sm" />
				</span>{' '}
				{t('lightningShield.intent')}
			</Prose>

			<div className="mt-4.5">
				<StatTiles>
					{/* The number stays and the label says what it is — see the same tile in `SearingTotem.tsx`. */}
					<StatTile
						value={formatSeconds(lightningShield.overcapMs)}
						label={t('lightningShield.kpi.overcap')}
						caption={overcapUnasked ? t('metric.notAsked') : undefined}
					/>
					<StatTile value={`${lightningShield.fellOff}`} label={t('lightningShield.kpi.fellOff')} />
					<StatTile value={`${lightningShield.badSpends.length}`} label={t('lightningShield.kpi.badSpends')} />
				</StatTiles>
			</div>

			<div className="mt-5">
				{curve === null ? (
					<Note>{t('lightningShield.none')}</Note>
				) : (
					<ResourceChart
						curve={curve}
						durationMs={analysis.durationMs}
						mode="steps"
						tone="kick"
						legend={t('lightningShield.key.shield')}
						bands={[
							// Widest claim first, so the red paints on top of the ground it is measured against.
							// Through `exemptRows` even though there is only one cause here: the day this chart also
							// shades an intermission, the overlap is resolved by the same precedence every other
							// exempt row uses rather than two washes stacking darker than either.
							...(aoeBand.length === 0
								? []
								: ([
										{
											tone: EXEMPT,
											windows: aoeBand.map(([start, end]) => ({ start, end })),
											legend: t('lightningShield.key.aoe'),
										},
									] satisfies TrackBand[])),
							{
								// The three faults share one colour and now one key entry: fell off, overcapped,
								// or spent below the ceiling are all "the shield went wrong" in the same red.
								tone: 'miss',
								windows: [
									...lightningShield.downWindows,
									...lightningShield.overcapWindows,
									...lightningShield.badSpends.map((spend) => ({
										start: spend.t,
										end: spend.t,
										text: spend.stacks === null ? undefined : `${spend.stacks}`,
									})),
								],
								legend: t('lightningShield.key.fault'),
							},
						]}
						label={t('lightningShield.chart')}
						labelDecreases
					/>
				)}
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('lightningShield.caption')}
					columns={[
						{ key: 'at', label: t('lightningShield.columns.at'), width: '96px' },
						{ key: 'stacks', label: t('lightningShield.columns.stacks'), align: 'right', width: '110px' },
					]}
					rows={badRows}
					empty={t('lightningShield.noBadSpends')}
				/>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				<Prose>
					{curve === null
						? /*
							 * The shield was never up, and until this branch the section said the opposite of that
							 * twice over in one sentence.
							 *
							 * `maxStacks` is the registry's cap and not a reading — `lightningShieldCap` is
							 * `LIGHTNING_SHIELD.maxStacks ?? 0`, seven on every pull including one where the buff never
							 * landed — and `fellOff` counts the stretches the shield was *down*, which on such a pull is
							 * the one stretch that is the whole fight. So the overcap grades a clean nought over a
							 * ceiling nobody sat at, the drop count grades one, and the pull came out `ok` reading *"The
							 * shield sat at seven for 0s past the leeway, and came all the way off once."* — printed
							 * over the chart's own *"No charges to draw."* Neither clause is true of a buff that was
							 * never applied, and the two halves of the section contradicted each other on one screen.
							 * Measured by stripping every Lightning Shield event out of `phased` and re-analysing;
							 * `__tests__/neverUpShield.test.ts` builds that pull.
							 *
							 * The plain arm is the sentence for exactly this state and was stored all along — it was
							 * unreachable, because `verdict()` picks its arm off a grade and this section can never be
							 * handed the nothing-measured one: `section()` is unmeasurable only when every primary is,
							 * and `lightningShieldFellOff` is a bare count that is never refused. So it is reached by
							 * name, the same call `EarthShock`, `Snapshots` and `TouchOfKarma` make where a state their
							 * letter cannot express needed a sentence of its own.
							 *
							 * Gated on the curve rather than on a second reading of the audit, so the sentence and the
							 * chart cannot come apart: `curve === null` is the same condition that prints "No charges to
							 * draw." fifty lines above.
							 *
							 * **The grade is left where it is, and that is a report rather than a decision.**
							 * `lightningShieldFellOff` reading one on a pull that never wore the buff is a fault in the
							 * metric rather than in the copy, and moving it moves a published letter.
							 */
							t('lightningShield.verdict', { context: 'none' })
						: narrowed
							? t('lightningShield.verdict', {
									context: `${grade}_noOvercap`,
									overcap: lightningShield.overcapMs,
									fellOff: lightningShield.fellOff,
								})
							: /*
								 * `count` is the drop count, so the sentence agrees with it. *"came all the way off 1
								 * times"* is what `cleave` printed and *"0 times"* what the other three did, and both
								 * arms of the un-narrowed pair could be handed either: this section's letter is the worse
								 * of two metrics, so an overcap on its own is enough to reach `bad` with the shield never
								 * once off you.
								 *
								 * The narrowed route needs nothing, and the reason is worth having written down. There
								 * the overcap is out of scope and the letter comes off the drop count alone, whose
								 * thresholds make `good` no drops, `ok` exactly one and `bad` two or more — so its three
								 * arms already say "never came off", "came off once" and a plural, each of them the only
								 * count that arm can be given.
								 */
								verdict('lightningShield', {
									overcap: lightningShield.overcapMs,
									fellOff: lightningShield.fellOff,
									count: lightningShield.fellOff,
								})}
				</Prose>
				{/* What the grey band means, on the pulls that have one.

				    The key names the band — "AoE — not graded" — which is what keeps it from reading as the
				    same thing as an intermission on another chart. What a key cannot carry is the *reason*,
				    and the reason is most of what a reader needs here: the AoE list has no Earth Shock in it,
				    so sitting at seven was the only state available and those seconds left the overcap
				    figure. Without the sentence the tile prints a duration with grey stretches beside it and
				    no way to tell which of the two the number is over — the same complaint the Earth Shock
				    section answers by counting its unjudged presses out loud.

				    Gated on the band rather than printed always, for the reason that section gives: a note on
				    every pull tells a reader nothing about this one. It is also the only place the two-target
				    case is stated, which matters more than the rest of it — the band covers three or more
				    enemies, and a reader who takes it to cover every add is owed that sentence. */}
				{/* The one instruction the exempt sentence used to end on, said as a note instead.

				    It shipped as the tail of nine graded sentences — three arms each of the two narrowed
				    families and the three `verdict_exempt` arms — which put seventeen words of page navigation
				    after the reader's own figure in every one of them. One key now, and the verdict ends on the
				    pull. Still said per section rather than left to the control: by the time a reader is here the
				    toggle is off screen, which is the argument `PriorityLadder` and `Rotation` both make. */}
				{narrowed ? <Note>{t('targets.switchReading')}</Note> : null}
				{aoeBand.length === 0 ? null : <Note>{t('lightningShield.aoeNote')}</Note>}
				<Note>{t('lightningShield.leeway', { leeway: formatSeconds(lightningShield.leewayMs) })}</Note>
			</div>
		</Section>
	);
}
