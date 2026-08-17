import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatDecimal } from '~/lib/format';
import type { Analysis, TargetMode } from '~/lib/types';
import { readJadeWind } from '~/lib/view/jadeWind';
import { bandForMode } from '~/lib/view/targetMode';

import { Note, Prose, Section, SpellIcon, StatTile, StatTiles } from '../primitives';

/**
 * Rushing Jade Wind: the target fan-out and the priority-list opportunities for the button.
 *
 * It earns a heading of its own rather than a paragraph inside one of the two sections that already
 * cite it. Fists of Fury asks a boolean of it — did the wind cover this channel — and Energizing Brew
 * asks a second one — is it in the build at all, which is what excuses a press under Bloodlust.
 * Neither has a clock for the button, and the question here is how many targets the wind actually hit
 * and how often the priority list offered it. The ladder is quoted rather than recomputed so this
 * section and the priority section cannot disagree.
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
							{forced === 1 ? (
								<StatTile value={t('jadeWind.choice.value')} label={t('jadeWind.choice.label')} grade="bad" />
							) : null}
							<StatTile
								value={measured.averageTargetsHit === null ? '—' : formatDecimal(measured.averageTargetsHit)}
								label={t('jadeWind.kpi.targets')}
							/>
							<StatTile
								value={ladder === null ? '—' : `${measured.presses}`}
								suffix={ladder === null ? undefined : ` / ${ladder.opportunities}`}
								label={t('jadeWind.kpi.opportunities')}
								grade={ladder?.choiceGrade ?? null}
							/>
						</StatTiles>
					</div>

					<div className="mt-5 flex flex-col gap-3.5">
						<Prose>
							<span className="inline-flex items-center gap-2 align-middle">
								<SpellIcon id={116847} size="sm" />
							</span>{' '}
							{measured.averageTargetsHit === null
								? t('jadeWind.summaryNoTargets', { presses: measured.presses })
								: t('jadeWind.summary', {
										targets: formatDecimal(measured.averageTargetsHit),
										presses: measured.presses,
									})}{' '}
							{ladder === null
								? null
								: t('jadeWind.opportunities', {
										used: ladder.followed,
										opportunities: ladder.opportunities,
									})}
						</Prose>

						{/* The opportunity counts come from the same ladder as the priority section. */}
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
						<Note>{t('jadeWind.notGraded')}</Note>
					</div>
				</>
			)}
		</Section>
	);
}
