import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatPercentValue } from '~/lib/format';
import type { Analysis, TargetMode } from '~/lib/types';
import { readJadeWind } from '~/lib/view/jadeWind';
import { bandForMode } from '~/lib/view/targetMode';

import { Note, Prose, Section, SpellIcon, StatTile, StatTiles } from '../primitives';

/**
 * Rushing Jade Wind: how much of the pull it was spinning, and what that cost.
 *
 * It earns a heading of its own rather than a paragraph inside one of the two sections that already
 * cite it. Fists of Fury asks a boolean of it — did the wind cover this channel — and Energizing Brew
 * asks a second one — is it in the build at all, which is what excuses a press under Bloodlust.
 * Neither has a clock for the button, and the question here is a clock: an uptime, the ceiling above
 * it, and the price of closing the gap. Folding that into either would put one button's uptime under a
 * heading about another button's placement.
 *
 * ## The ceiling is 100% and that is why it is not printed as a target
 *
 * The dot lasts six seconds, the cooldown is six seconds, and the cooldown is re-armed to whatever is
 * left of the dot — so the button is spinning or ready at every instant of every pull, and "possible
 * uptime" by the cooldown is 100% of any stretch. A tile reading "53% of a possible 100%" is true and
 * says nothing. What rations the button is the bar: 40 energy every six seconds is 6.67 a second,
 * against a measured 12.3–13.5 across the committed fixtures, so covering a pull end to end takes
 * roughly half of every point of energy it produces — and every one of those points is one Jab, Tiger
 * Palm and the chi spenders do not get. So the section prints the uptime, the presses the cooldown
 * allowed, and what both ends of that range cost as a share of the pull's own measured income. The
 * argument and the numbers behind it are in `lib/view/jadeWind`.
 *
 * ## Nothing here is graded
 *
 * There is no share of the bar that is the right one to spend on the wind. The trade is against the
 * generator and the spenders and it moves with the target count from second to second; the priority
 * list's one energy test on this button is an overflow guard on the bottom rung rather than a budget,
 * so there is still no threshold in the sim to take one from — and six fixtures is exactly the sample
 * `score/thresholds.ts` argues against inventing one out of. The tiles therefore carry no grade, and
 * the only judgement in the section is the ladder's, quoted rather than recomputed.
 */
export default function RushingJadeWind({ analysis, mode }: { analysis: Analysis; mode?: TargetMode | null }) {
	const { t } = useReportCopy(analysis);

	/**
	 * The same audit `PriorityLadder` reads, selected the same way.
	 *
	 * Not a convenience: the ladder's verdict on these presses moves enormously with the band — on
	 * `strong` one press of thirteen followed the list read at one target and nine of thirteen read at
	 * two — so a section that picked its own band would contradict the section that counts the skips.
	 * `bandForMode` is the single answer both of them ask for.
	 */
	const forced = bandForMode(mode ?? null);
	const apl = forced === null ? analysis.apl : (analysis.aplForced?.[forced] ?? analysis.apl);
	const { talent, measured, ladder } = useMemo(() => readJadeWind(analysis, apl), [analysis, apl]);

	return (
		<Section id="jade-wind" title={t('jadeWind.title')}>
			<Prose>{t('jadeWind.intent')}</Prose>

			{/* A pull that never had the button is not a pull with 0% uptime, and the two must not render
			    as the same thing. `not-taken` is positive evidence — a button that cannot share a bar with
			    this one was pressed — and `unknown` is the honest answer when the log shows neither, which
			    is indistinguishable from a talent taken and forgotten. Neither gets a number. */}
			{talent.state !== 'taken' ? (
				<div className="mt-5">
					<Note>{t('jadeWind.absent', { context: talent.state === 'unknown' ? 'unknown' : talent.instead })}</Note>
				</div>
			) : measured === null ? (
				// The button was pressed but this analysis carries no aura timeline to measure it from —
				// captured before the timeline existed. A heading with a caveat, not a zero.
				<div className="mt-5">
					<Note>{t('empty.section')}</Note>
				</div>
			) : (
				<>
					<div className="mt-4.5">
						<StatTiles>
							{/* Contact time, like every other fraction this report grades a choice by — and the
							    numerator is that same set of segments intersected with the buff's windows, so the
							    two cannot describe different fights. */}
							<StatTile value={formatPercentValue(measured.uptimePct)} label={t('jadeWind.kpi.uptime')} />
							{/* `presses / what the cooldown had room for`, both counted inside contact. The same
							    shape as Rising Sun Kick's cast tile and floored for the same reason — but
							    deliberately ungraded, because unlike a kick on an eight-second cooldown this
							    denominator is not a target. Closing it is what the sentence below prices. */}
							<StatTile
								value={`${measured.presses}`}
								suffix={` / ${measured.possiblePresses}`}
								label={t('jadeWind.kpi.presses')}
							/>
							{/* The figure the ceiling actually turns on. A dash rather than a zero when the pull
							    carried too few resource readings to measure a regen rate: an unmeasured price is
							    not a free one. */}
							<StatTile
								value={measured.spentSharePct === null ? '—' : formatPercentValue(measured.spentSharePct)}
								label={t('jadeWind.kpi.energy')}
							/>
						</StatTiles>
					</div>

					<div className="mt-5 flex flex-col gap-3.5">
						<Prose>
							<span className="inline-flex items-center gap-2 align-middle">
								<SpellIcon id={116847} size="sm" />
							</span>{' '}
							{t('jadeWind.summary', {
								uptime: measured.uptimePct,
								presses: measured.presses,
								possible: measured.possiblePresses,
							})}{' '}
							{t('jadeWind.ceiling')}
						</Prose>

						{/* The elaboration the section exists for: what the ceiling would have cost, in the
						    currency that is actually scarce, computed from this pull's own measured regen. */}
						<Prose>
							{measured.ceilingSharePct === null || measured.spentSharePct === null || measured.incomeEnergy === null
								? t('jadeWind.priceUnmeasured')
								: t('jadeWind.price', {
										possible: measured.possiblePresses,
										ceilingEnergy: measured.ceilingEnergy,
										income: measured.incomeEnergy,
										ceilingShare: measured.ceilingSharePct,
										presses: measured.presses,
										spentEnergy: measured.spentEnergy,
										spentShare: measured.spentSharePct,
									})}
						</Prose>

						{/* The only judgement in the section, and it is the ladder's. Both directions of it: the
						    presses the list did not want, and the globals it wanted the wind at. Recomputing
						    either here would be a second opinion free to disagree with the section that lists
						    them by button. */}
						{ladder === null ? (
							<Note>{t('jadeWind.ladderMissing')}</Note>
						) : (
							<Prose>
								{t('jadeWind.ladder', {
									context: ladder.judged === 0 ? 'unjudged' : ladder.skipped === 0 ? 'all' : 'some',
									// The judged count carries the plural as well as the number: `all` and `some` both
									// read "the N presses the list could judge", and one press has to say "the one
									// press" rather than "the 1 presses".
									count: ladder.judged,
									followed: ladder.followed,
								})}{' '}
								{ladder.wanted === 0 ? t('jadeWind.wantedNone') : t('jadeWind.wanted', { count: ladder.wanted })}
							</Prose>
						)}

						{/* Said where the verdicts are, not only at the control at the top of the page: by the
						    time a reader reaches this section the toggle is off screen, and at one target this
						    button's whole position in the list changes. */}
						{forced === 1 ? <Note>{t('jadeWind.singleTarget')}</Note> : null}
						{measured.incomeEnergy === null ? null : <Note>{t('jadeWind.regenCaveat')}</Note>}
						<Note>{t('jadeWind.notGraded')}</Note>
					</div>
				</>
			)}
		</Section>
	);
}
