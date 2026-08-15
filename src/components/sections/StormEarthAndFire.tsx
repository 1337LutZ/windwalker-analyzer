import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatCompact, formatPercentValue, formatSeconds } from '~/lib/format';
import { wasteTone } from '~/lib/score/waste';
import type { Analysis } from '~/lib/types';

import SpiritLanes from '../charts/SpiritLanes';
import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '../primitives';

/**
 * Storm, Earth and Fire: up to two spirits that mirror the monk onto other enemies.
 *
 * The section answers two questions and refuses to grade either, which is the whole reason it reads
 * the way it does.
 *
 * **Was it worth pressing?** The rule is the reader's — a second enemy under the monk's hands for
 * longer than ten seconds — and `lib/spec/windwalker` says where that number comes from. It decides
 * whether this section says anything at all rather than what verdict it hands down.
 *
 * **Were the presses spent well?** A spirit copies the monk onto *its* target, so the one way to
 * waste the cooldown after it goes out is to stand on an enemy a spirit is already handling. That is
 * measured from the spirits' own swings, never assumed, and when it cannot be measured the section
 * says so instead of printing a zero — `overlapMs` is null in that case, and "you never doubled up"
 * would be an invented compliment exactly as a fabricated fault is an invented accusation.
 *
 * Whether the section appears at all is decided in `Report`, by the `when` predicate beside its entry
 * in the section list, and deliberately not by returning null from here: the contents list is built
 * from that same list, so a component that silently rendered nothing would leave the nav pointing at
 * a heading that never existed. What this file owns is what to *say* once it has been asked.
 */
export default function StormEarthAndFire({ analysis }: { analysis: Analysis }) {
	const { sef } = analysis;
	const { t } = useReportCopy(analysis);

	const rows = useMemo<GridRow[]>(
		() =>
			(sef?.uses ?? []).map((use, i) => ({
				key: `${use.t}-${i}`,
				cells: {
					// A spirit placed before the pull has no clock inside it. Printing 0:00 would say it was
					// sent at the pull, which is a different claim from "it was already out"; the row says the
					// latter in words instead of stamping a time the log never gave.
					at: use.prePull === true ? t('sef.prePull.at') : formatClock(use.t),
					// The enemy the press aimed at. The log names it by id and the report's actor list is the
					// only thing that can turn that into a name; an id it does not answer for is left unnamed
					// rather than labelled with a neighbouring add's name.
					//
					// Three states, and the middle one is why this is not a plain name. A pre-pull placement's
					// press is outside the fight window, so its enemy is read from the spirit's own first
					// swings instead — which is evidence of where it *stood* rather than where it was *sent*,
					// a weaker claim in a column headed "sent to", so the cell says which one it is. A spirit
					// that never swung leaves nothing to read at all and says so.
					target:
						use.deduced === true
							? t('sef.prePull.deduced', { target: use.name ?? t('sef.unnamedTarget') })
							: use.prePull === true
								? t('sef.prePull.unknown')
								: (use.name ?? t('sef.unnamedTarget')),
				},
			})),
		[sef?.uses, t],
	);

	/**
	 * The per-enemy uptimes, beside the lanes that show when each one was held.
	 *
	 * The chart says *when* and this says *how much*, which is the split the rest of the report already
	 * uses — a picture cannot be read to a tenth of a second and a number cannot show a gap. Both are
	 * built from `sef.targets`, so they are two readings of one array rather than two measurements.
	 */
	const targetRows = useMemo<GridRow[]>(
		() =>
			(sef?.targets ?? []).map((target) => ({
				key: `${target.id}`,
				cells: {
					enemy: target.name ?? t('sef.lanes.unnamed', { id: target.id }),
					held: formatSeconds(target.heldMs),
					share: formatPercentValue(target.heldPct),
					// Replaces the enemy's engaged span, which said nothing the position of the row did not.
					// This is the only part of that span worth a column: the stretch it *collided* with a
					// spirit, which is the one thing on this grid the player can act on next pull.
					doubled: formatSeconds(target.overlapMs ?? 0),
				},
			})),
		[sef?.targets, t],
	);

	// The committed fixtures were captured before this field existed, so it is `undefined` there rather
	// than `null` — a truthiness guard is the only one that catches both. `Report` already declines to
	// render this section at all in that case; the guard is what makes the component readable on its
	// own rather than a second opinion about when it should appear.
	if (!sef) {
		return (
			<Section id="sef" title={t('sef.title')}>
				<Note>{t('empty.section')}</Note>
			</Section>
		);
	}

	const used = sef.casts > 0;
	const hasDamage = sef.cloneDamage > 0;

	return (
		<Section id="sef" title={t('sef.title')}>
			<Prose>{t('sef.intent')}</Prose>

			{used ? (
				<>
					<div className="mt-4.5">
						<StatTiles>
							<StatTile value={`${sef.casts}`} label={t('sef.kpi.casts')} />
							<StatTile value={formatPercentValue(sef.uptimePct)} label={t('sef.kpi.uptime')} />
							{hasDamage ? <StatTile value={formatCompact(sef.cloneDamage)} label={t('sef.kpi.damage')} /> : null}
							{/* The one figure here a colour can defend, and it is still only a reading aid.
							    `wasteTone`, like the chi and energy overcap tiles, and against the same kind of
							    denominator: the share of the player's own measured contact time that was spent on
							    an enemy a spirit already had. What makes it defensible where placement count and
							    per-target time are not is that the reference point is not invented — the sim
							    refuses to copy a spell onto the owner's own target at all, so zero is the
							    mechanic's own answer rather than a threshold somebody picked.
							    It is deliberately not a `Metric` and does not reach the scorecard; the paragraph
							    below still says so, and the reason is unchanged — a hard zero would fault the
							    seconds after a player's target dies and they roll onto one a spirit is holding.
							    Null stays ungraded and unprinted: a pull that could not be measured has not
							    earned a green tile. */}
							{sef.overlapMs === null ? null : (
								<StatTile
									value={formatSeconds(sef.overlapMs)}
									label={t('sef.kpi.overlap')}
									grade={wasteTone(sef.overlapMs, sef.measuredMs)}
								/>
							)}
						</StatTiles>
					</div>

					<div className="mt-5">
						<DataGrid
							caption={t('sef.caption')}
							columns={[
								{ key: 'at', label: t('sef.columns.at'), width: '96px' },
								{ key: 'target', label: t('sef.columns.target') },
							]}
							rows={rows}
							empty={t('sef.none')}
						/>
					</div>

					{/* Where the spirits actually went. Three states again, and the middle one matters for the
					    same reason it does above: a pull whose spirits left no actor behind cannot be asked
					    where they stood, and rows of empty lanes would answer "nowhere" on its behalf. The
					    third state — nothing survived the short-lived rule — is left to the chart's own empty
					    copy, because that is a fact about the pull's adds rather than about the spirits. */}
					<div className="mt-6 flex flex-col gap-3.5">
						<h3 className="m-0 font-mono text-sm text-ink-2">{t('sef.lanes.title')}</h3>
						{/* No standfirst here, deliberately. How these bars are derived — the spirits' own
						    single-target swings, never the press's target, and never area damage — is reasoning
						    about the measurement rather than something a reader of the chart needs, so it lives
						    in `SpiritLanes` and in the engine beside the code that does it. The one sentence
						    that survived is the caption under the chart, because a blank row genuinely does
						    read as missing data until someone says it is not. */}
						{sef.targetsResolved === false ? (
							<Note>{t('sef.lanes.unresolved')}</Note>
						) : (
							<>
								<SpiritLanes targets={sef.targets ?? []} durationMs={analysis.durationMs} />

								<DataGrid
									caption={t('sef.lanes.gridCaption')}
									columns={[
										{ key: 'enemy', label: t('sef.lanes.columns.enemy') },
										{ key: 'held', label: t('sef.lanes.columns.held'), align: 'right', width: '112px' },
										{ key: 'share', label: t('sef.lanes.columns.share'), align: 'right', width: '112px' },
										{ key: 'doubled', label: t('sef.lanes.columns.doubled'), align: 'right', width: '112px' },
									]}
									rows={targetRows}
									empty={t('sef.lanes.empty')}
								/>

								{/* Said out loud, both of them. A lane set that quietly dropped rows would be a
								    chart claiming to show every enemy while showing some of them. */}
								{(sef.shortLivedTargets ?? 0) > 0 ? (
									<Note>
										{t('sef.lanes.shortLived', {
											count: sef.shortLivedTargets ?? 0,
											rule: sef.secondTargetMs,
										})}
									</Note>
								) : null}
								{(sef.hiddenTargets ?? 0) > 0 ? (
									<Note>{t('sef.lanes.hidden', { count: sef.hiddenTargets ?? 0 })}</Note>
								) : null}
							</>
						)}
					</div>
				</>
			) : null}

			<div className="mt-5 flex flex-col gap-3.5">
				<Prose>
					<span className="inline-flex items-center gap-2 align-middle">
						<SpellIcon id={137639} size="sm" />
					</span>{' '}
					{used
						? t('sef.summary', { count: sef.casts, uptime: sef.uptimePct })
						: t('sef.skipped', { justified: sef.justifiedMs, longest: sef.longestSecondTargetMs })}{' '}
					{/* Only sayable at all because the aura is followed as a stack level: a second spirit arrives
					    as a stack event carrying no second apply, so the apply→remove reading this section used
					    to take could not distinguish one spirit from two. Zero is a measurement here, not an
					    absence, but a sentence saying "for 0s" is noise — so it is printed only when it happened. */}
					{used && (sef.doubledMs ?? 0) > 0 ? t('sef.lanes.doubled', { doubled: sef.doubledMs ?? 0 }) : null}
				</Prose>

				{/* Said in its own sentence rather than folded into the count. A spirit placed before the pull
				    is the difference between the number above and the presses in the cast table, and a reader
				    who spots that gap deserves the reason for it rather than having to assume one of the two
				    is wrong. It is also emphatically not a fault — it is how the opener is played. */}
				{used && (sef.prePlaced ?? 0) > 0 ? <Note>{t('sef.prePlaced', { count: sef.prePlaced ?? 0 })}</Note> : null}

				{/* What the uptime figure is a share of, said on the page because a reader cannot be expected
				    to guess it — and because the natural guess is wrong twice over. It is a fraction of the
				    whole pull, not of the time a spirit was worth having, so a fight with long single-target
				    stretches reads low and *should*; and it counts "at least one spirit", so it cannot tell one
				    from two. A "time at the optimal spirit count" figure was measured against the sim's own
				    rule and refused — see the note beside `sefDoubleMs` in `lib/spec/windwalker`. */}
				{used ? <Note>{t('sef.uptimeMeans')}</Note> : null}

				{used && hasDamage ? (
					<Prose>{t('sef.damage', { damage: sef.cloneDamage, share: sef.cloneSharePct })}</Prose>
				) : null}

				{/* Three states, and the middle one is the point of the section. Null is not zero: a pull whose
				    spirits left no actor to follow cannot be asked the question, and saying nothing went wrong
				    there would be a claim the log never made. */}
				{used ? (
					sef.overlapMs === null ? (
						<Note>{t('sef.overlapUnknown')}</Note>
					) : sef.overlapMs === 0 ? (
						<Prose>{t('sef.overlapNone')}</Prose>
					) : (
						<Prose>
							{t('sef.overlap', {
								overlap: sef.overlapMs,
								measured: sef.measuredMs,
								share: sef.overlapPct ?? 0,
							})}{' '}
							{t('sef.overlapWorst', {
								target: sef.overlaps[0]?.name ?? t('sef.unnamedTarget'),
								ms: sef.overlaps[0]?.ms ?? 0,
							})}
						</Prose>
					)
				) : null}

				{used ? (
					<Prose>
						{sef.justified
							? t('sef.justified', { justified: sef.justifiedMs, rule: sef.secondTargetMs })
							: t('sef.unjustified', { longest: sef.longestSecondTargetMs, rule: sef.secondTargetMs })}
					</Prose>
				) : null}

				{/* Said once, plainly: there is no grade here and no threshold behind one. */}
				<Note>{t('sef.notGraded')}</Note>
			</div>
		</Section>
	);
}
