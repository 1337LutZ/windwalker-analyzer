import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatDecimal } from '~/lib/format';
import type { Analysis, JudgmentCause, TargetMode } from '~/lib/types';
import { readJadeWind } from '~/specs/windwalker/lib/view/jadeWind';
import { bandForMode } from '~/lib/view/targetMode';

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
import LogLink from '~/components/sections/LogLink';

/**
 * Rushing Jade Wind: the target fan-out and the priority-list opportunities for the button.
 *
 * It earns a heading of its own rather than a paragraph inside one of the two sections that already
 * cite it. Fists of Fury asks a boolean of it — did the wind cover this channel — and Energizing Brew
 * asks a second one (is it in the build at all), which is what excuses a press under Bloodlust.
 * Neither has a clock for the button, and the question here is how many targets the wind actually hit
 * and how often the priority list offered it. The ladder is quoted rather than recomputed so this
 * section and the priority section cannot disagree.
 */
export default function RushingJadeWind({
	analysis,
	mode,
	forcedMode,
}: {
	analysis: Analysis;
	mode?: TargetMode | null;
	forcedMode?: TargetMode | null;
}) {
	const { t } = useReportCopy(analysis);

	/**
	 * The same audit `PriorityLadder` reads, selected the same way.
	 *
	 * Not a convenience: the ladder's verdict on these presses moves enormously with the band — on
	 * `strong` one press of thirteen followed the list read at one target and nine of thirteen read at
	 * two — so a section that picked its own band would contradict the section that counts the skips.
	 * `bandForMode` is the single answer both of them ask for.
	 */
	const readingBand = bandForMode(mode ?? null);
	const forced = bandForMode(forcedMode ?? null);
	const apl = forced === null ? analysis.apl : (analysis.aplForced?.[forced] ?? analysis.apl);
	const { talent, measured, ladder } = useMemo(() => readJadeWind(analysis, apl), [analysis, apl]);
	const decisionRows = useMemo<(GridRow & { cause: JudgmentCause })[]>(
		() =>
			(ladder?.decisions ?? []).map((decision, index) => {
				let event: string;
				switch (decision.kind) {
					case 'missed':
						event = t('jadeWind.decisions.cells.missed');
						break;
					case 'press':
						switch (decision.verdict) {
							case 'followed':
								event = t('jadeWind.decisions.cells.used');
								break;
							case 'unknown':
								event = t('jadeWind.decisions.cells.unknown');
								break;
							default:
								event = t('jadeWind.decisions.cells.overused');
						}
				}

				let reason: string;
				if (decision.kind === 'missed') {
					switch (decision.reason) {
						case 'multi-target':
							reason = t('jadeWind.decisions.cells.multiTarget');
							break;
						case 'short-pull':
							reason = t('jadeWind.decisions.cells.shortPull');
							break;
						case 'energy-cap':
							reason = t('jadeWind.decisions.cells.energyCap');
							break;
						case 'haste-window':
							reason = t('jadeWind.decisions.cells.hasteWindow');
							break;
						case 'haste-window-available':
							reason = t('jadeWind.decisions.cells.hasteWindowAvailable');
							break;
						default:
							reason = t('jadeWind.decisions.cells.missedReason');
					}
				} else if (decision.verdict === 'skipped' && decision.wanted !== null) {
					reason = t(`priority.rule.${decision.wanted}`);
				} else {
					switch (decision.verdict) {
						case 'off-list':
							reason = t('jadeWind.decisions.cells.noOpportunity');
							break;
						case 'unknown':
							reason = t('jadeWind.decisions.cells.unknownReason');
							break;
						default:
							reason = t('jadeWind.decisions.cells.usedReason');
					}
				}

				/**
				 * Whose the decision is.
				 *
				 * A miss the list itself explains is the list's: two targets up, a pull too short to pay the
				 * talent back, an energy cap a second out, a haste window the brew belongs in. A miss with no
				 * such reason is the player pressing something else. A press the ladder could not read is the
				 * log, and a press made where the list never asked for one is the player again.
				 */
				const cause: JudgmentCause =
					decision.kind === 'missed'
						? decision.reason === null
							? 'player'
							: 'rotation'
						: decision.verdict === 'unknown'
							? 'log'
							: decision.verdict === 'followed'
								? 'rotation'
								: 'player';

				return {
					key: `${decision.at}-${decision.kind}-${index}`,
					cause,
					band: decision.verdict === 'followed' ? undefined : ('warn' as const),
					cells: {
						at: decision.link ? (
							<LogLink href={decision.link}>{formatClock(decision.at)}</LogLink>
						) : (
							formatClock(decision.at)
						),
						// The tag rides on the event, which is the judgment; the `why` column beside it is the
						// evidence, and a tag on both would say one thing twice.
						event: (
							<span className="inline-flex items-baseline">
								<CauseTag cause={cause} />
								<span>{event}</span>
							</span>
						),
						reason,
					},
				};
			}),
		[ladder, t],
	);

	const intro = <Prose>{t('jadeWind.intent')}</Prose>;

	if (talent.state !== 'taken') {
		return (
			<Section id="jade-wind" title={t('jadeWind.title')}>
				{intro}
				<div className="mt-5">
					<Note>{t('jadeWind.absent', { context: talent.state === 'unknown' ? 'unknown' : talent.instead })}</Note>
				</div>
			</Section>
		);
	}

	if (measured === null) {
		return (
			<Section id="jade-wind" title={t('jadeWind.title')}>
				{intro}
				<div className="mt-5">
					<Note>{t('empty.section')}</Note>
				</div>
			</Section>
		);
	}

	return (
		<Section id="jade-wind" title={t('jadeWind.title')}>
			{intro}
			<>
				<div className="mt-4.5">
					<StatTiles>
						{readingBand === 1 ? (
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
							: // `asked` rather than `opportunities`: the sentence now says what the priority list asked
								// for, and a placeholder named for our own word for it is the one place the reader-voice
								// sweep cannot see the word (see `specs/__tests__/readerVoice.test.ts`).
								t('jadeWind.opportunities', {
									used: ladder.followed,
									asked: ladder.opportunities,
								})}
						{ladder !== null && ladder.netOveruse > 0
							? ` ${t('jadeWind.overuse', { extra: ladder.netOveruse })}`
							: null}
					</Prose>

					{/* The opportunity counts come from the same ladder as the priority section. */}
					{ladder === null ? (
						<Note>{t('jadeWind.ladderMissing')}</Note>
					) : (
						<Prose>
							{t('jadeWind.ladder', {
								context: ladder.judged === 0 ? 'unjudged' : ladder.skipped === 0 ? 'all' : 'some',
								// The judged count carries the plural as well as the number: `all` and `some` both
								// read "the N presses this log could check against the priority list", and one press has
								// to say "the one press" rather than "the 1 presses".
								count: ladder.judged,
								followed: ladder.followed,
							})}{' '}
							{ladder.wanted === 0 ? t('jadeWind.wantedNone') : t('jadeWind.wanted', { count: ladder.wanted })}
						</Prose>
					)}

					{decisionRows.length === 0 ? null : (
						<DataGrid
							caption={t('jadeWind.decisions.caption')}
							minWidth="520px"
							columns={[
								{ key: 'at', label: t('jadeWind.decisions.columns.at'), width: '90px' },
								{ key: 'event', label: t('jadeWind.decisions.columns.event'), width: '190px' },
								{ key: 'reason', label: t('jadeWind.decisions.columns.reason'), card: 'wide' },
							]}
							rows={decisionRows}
						/>
					)}

					{/* Said where the verdicts are, not only at the control at the top of the page: by the
						    time a reader reaches this section the toggle is off screen, and at one target this
						    button's whole position in the list changes. */}
					{readingBand === 1 ? <Note>{t('jadeWind.singleTarget')}</Note> : null}
					<Note>{t('jadeWind.notGraded')}</Note>
				</div>

				<div className="mt-3.5">
					<CauseLegend causes={decisionRows.map((row) => row.cause)} />
				</div>
			</>
		</Section>
	);
}
