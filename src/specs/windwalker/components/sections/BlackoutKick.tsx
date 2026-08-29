import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatInteger, formatPercentValue, formatSeconds } from '~/lib/format';
import type { Analysis, TargetMode } from '~/lib/types';
import { readBlackoutKick, BLACKOUT_KICK_CAST_ID } from '~/specs/windwalker/lib/view/blackoutKick';
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
 * Blackout Kick: what the list wanted at the globals it took, and what those globals cost elsewhere.
 *
 * The priority section counts skips *by button* — how often Tiger Palm was passed over, across every
 * press. Turned around, the same audit answers a question nothing else asks: of the globals spent on
 * a Blackout Kick, what did the list want instead? Exhaustive, where a pair of hand-picked
 * comparisons would not be.
 *
 * **Two claims, never added together.** The table says *the list wanted another button here*; the
 * ledger says *this press cost you a kick later*. Different faults, different clocks — one press can
 * be in both or neither. The first moves with the reader's target count; the second does not, because
 * enemy count does not change whether you had two chi.
 *
 * **Nothing is graded**, and adherence was the candidate that failed. Over 52 pulls it moves by a
 * median of 22.8 points with the target-count toggle — grading the reading, not the player. The chi
 * walk it rests on scores 56.8–94.5% (median 80.0), not the 87–95% `spec/apl.ts` claims from three
 * pulls. And encounter alone explains 30.7% of the variance, with single fights spreading as wide as
 * the sample. Starvation has no target either: following the list does not produce zero.
 */
/**
 * Which sentence a forced reading gets — the same three-for-four pairing `PriorityLadder` uses, and
 * for the same reason: `aoe` and the coarse `multi` are both read at band 3, and `cleave` is not.
 *
 * The difference this section reports is the dump's energy reserve, and band 2 sits with band 1 rather
 * than with the packs: `DUMP_ENERGY` is `{ few: 35, many: 105 }` and the `many` arm starts at three
 * targets, so a cleave still spends chi off a 35-energy bar. What has changed at two is which button is
 * above the kick, which is the half the cleave sentence names.
 */
const FORCED_NOTE: Record<TargetMode, string> = {
	single: 'blackoutKick.forced_single',
	cleave: 'blackoutKick.forced_cleave',
	aoe: 'blackoutKick.forced_aoe',
	multi: 'blackoutKick.forced_aoe',
};

export default function BlackoutKick({ analysis, forcedMode }: { analysis: Analysis; forcedMode?: TargetMode | null }) {
	const { t } = useReportCopy(analysis);

	/**
	 * The same audit `PriorityLadder` reads, selected the same way — `bandForMode` is the single answer
	 * both ask for. A section picking its own band would print one verdict on presses the section below
	 * it prints another verdict on.
	 *
	 * Only the *ladder* half of the reading uses it. The starved kicks are computed off the chi bar in
	 * the engine and are the same at every band, which the note beside them says out loud.
	 */
	const forced = bandForMode(forcedMode ?? null);
	const apl = forced === null ? analysis.apl : (analysis.aplForced?.[forced] ?? analysis.apl);
	const { casts, procs, ladder, starve } = useMemo(() => readBlackoutKick(analysis, apl), [analysis, apl]);

	const wantedRows = useMemo<GridRow[]>(
		() =>
			(ladder?.wantedInstead ?? []).map((row) => ({
				key: row.key,
				band: 'warn' as const,
				cells: {
					button: (
						<span className="flex items-center gap-2">
							{/* Every row of this table is one press the ladder wanted and did not get, so the tag is the
							    same on all of them and is drawn anyway: a reader who has just met `Rotation` on a
							    forgiven row two sections up needs the same column to answer here, and a column that
							    goes blank when the answer is uniform reads as a column that stopped working. */}
							<CauseTag cause="player" />
							<SpellIcon id={row.id} size="sm" />
							{/* The priority section's own labels, not a second set: a reader sent from a row here to
							    the reference has to meet the same words. */}
							<span>{t(`priority.rule.${row.key}`)}</span>
						</span>
					),
					count: <b className="font-semibold text-ink-2">{formatInteger(row.count)}</b>,
				},
			})),
		[ladder, t],
	);

	const starveRows = useMemo<GridRow[]>(
		() =>
			(starve?.charged ?? []).map((row) => ({
				key: `${row.at}`,
				band: 'warn' as const,
				cells: {
					// The tag leads the row, in the column the reader's eye starts in. Every row here is a global
					// spent waiting on chi, so the answer is the same on all of them and is still worth drawing:
					// the column answers "whose was this" wherever a reader looks, or it answers nowhere.
					at: (
						<span className="inline-flex items-baseline">
							<CauseTag cause="player" />
							<LogLink href={row.link}>{formatClock(row.at)}</LogLink>
						</span>
					),
					waited: <b className="font-semibold text-ink-2">{formatSeconds(row.ms)}</b>,
					// The evidence the row rests on, printed rather than summarised — and the number the
					// tier-bonus caveat below turns on.
					bar: <span className="text-ink-2">{formatInteger(row.chi)}</span>,
					press: <span className="text-ink-2">{formatClock(row.pressAt)}</span>,
					debuff: (
						<span className={row.debuffDown ? 'text-miss' : 'text-ink-2'}>
							{row.debuffDown ? t('blackoutKick.cells.dropped') : t('blackoutKick.cells.held')}
						</span>
					),
				},
			})),
		[starve, t],
	);

	// A monk who never pressed it. Vanishingly rare and still not a zero: there is no adherence to
	// print and nothing to charge, and saying so is the honest answer rather than a row of dashes.
	if (casts === 0) {
		return (
			<Section id="blackout-kick" title={t('blackoutKick.title')}>
				<Prose>{t('blackoutKick.intent')}</Prose>
				<div className="mt-5">
					<Note>{t('blackoutKick.none')}</Note>
				</div>
			</Section>
		);
	}

	const followed = ladder === null ? 0 : ladder.free + ladder.dump;
	// Which of the three split sentences the counts allow. Null when the list agreed with none of the
	// presses, where a sentence about how they divide would be describing an empty set.
	const split =
		ladder === null || followed === 0
			? null
			: ladder.free > 0 && ladder.dump > 0
				? 'both'
				: ladder.free > 0
					? 'free'
					: 'dump';

	return (
		<Section id="blackout-kick" title={t('blackoutKick.title')}>
			<Prose>{t('blackoutKick.intent')}</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile value={formatInteger(casts)} label={t('blackoutKick.kpi.casts')} />
					{/* Ungraded, and a dash rather than a zero when the ladder judged nothing: a pull whose
					    presses all sat under an unreadable rule has no adherence, which is not the same as an
					    adherence of none. */}
					<StatTile
						value={ladder === null || ladder.judged === 0 ? '—' : formatPercentValue((followed / ladder.judged) * 100)}
						label={t('blackoutKick.kpi.followed')}
					/>
					{/* The seconds this button is answerable for, not the whole drift — the rest of the drift is
					    not its doing and the section must not imply it is. */}
					<StatTile
						value={starve === null ? '—' : formatSeconds(starve.chargedMs)}
						label={t('blackoutKick.kpi.starved')}
					/>
				</StatTiles>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				{ladder === null ? (
					<Note>{t('blackoutKick.ladderMissing')}</Note>
				) : (
					<Prose>
						<span className="inline-flex items-center gap-2 align-middle">
							<SpellIcon id={BLACKOUT_KICK_CAST_ID} size="sm" />
						</span>{' '}
						{t('blackoutKick.ladder', {
							context: ladder.judged === 0 ? 'unjudged' : ladder.skipped === 0 ? 'all' : 'some',
							// The count carries the plural as well as the number, so one press reads "the one
							// press" rather than "the 1 presses".
							count: ladder.judged,
							followed,
						})}{' '}
						{split === null ? null : t('blackoutKick.split', { context: split, free: ladder.free, dump: ladder.dump })}
					</Prose>
				)}

				{/* The proc row the Tiger Palm section prints beside its twin, read from the same array. Its
				    own sentence rather than a number folded into the one above, because a free kick is not a
				    decision about chi at all — it costs none. */}
				{procs === null ? null : (
					<Prose>
						{procs.procs === 0
							? t('blackoutKick.procsNone')
							: procs.wasted > 0
								? t('blackoutKick.procsWasted', { count: procs.procs, wasted: procs.wasted })
								: t('blackoutKick.procs', { count: procs.procs })}
					</Prose>
				)}
			</div>

			{ladder === null || ladder.judged === 0 ? null : wantedRows.length === 0 ? (
				<div className="mt-5">
					<Prose>{t('blackoutKick.wantedNone')}</Prose>
				</div>
			) : (
				<div className="mt-5">
					<DataGrid
						caption={t('blackoutKick.wantedCaption')}
						minWidth="420px"
						columns={[
							{ key: 'button', label: t('blackoutKick.columns.button') },
							{ key: 'count', label: t('blackoutKick.columns.count'), align: 'right', width: '140px' },
						]}
						rows={wantedRows}
						empty={t('blackoutKick.wantedNone')}
					/>
					<div className="mt-3.5">
						<CauseLegend causes={['player']} />
					</div>
				</div>
			)}

			<div className="mt-5 flex flex-col gap-3.5">
				{starve === null ? (
					<Note>{t('blackoutKick.starveMissing')}</Note>
				) : starve.driftMs === 0 ? (
					<Prose>{t('blackoutKick.starveClean')}</Prose>
				) : starve.charged.length === 0 ? (
					<>
						<Prose>
							{t('blackoutKick.starveSummary', { drift: starve.driftMs / 1000, starved: starve.starvedMs / 1000 })}
						</Prose>
						<Prose>{t('blackoutKick.starveNone')}</Prose>
					</>
				) : (
					<>
						<Prose>
							{t('blackoutKick.starveSummary', { drift: starve.driftMs / 1000, starved: starve.starvedMs / 1000 })}{' '}
							{t('blackoutKick.starveCharged', {
								count: starve.charged.length,
								seconds: starve.chargedMs / 1000,
							})}{' '}
							{/* Only once the waits add up to a whole cooldown. Floored, so a pull that lost four
							    seconds is not told it lost half a kick — the unit this report loses casts in is a
							    whole one. */}
							{starve.chargedKicks === 0 ? null : t('blackoutKick.starveKicks', { count: starve.chargedKicks })}
						</Prose>
						<Prose>
							{starve.debuffDrops === 0
								? t('blackoutKick.starveDebuffNone')
								: t('blackoutKick.starveDebuff', { count: starve.debuffDrops })}{' '}
							{/* The finding that stops this reading as "you broke the list": a quarter of these
							    presses are presses the list wanted. Shown only when this pull has one. */}
							{starve.followedList === 0 ? null : t('blackoutKick.starveFollowed', { count: starve.followedList })}
						</Prose>
					</>
				)}
			</div>

			{starveRows.length === 0 ? null : (
				<div className="mt-5">
					<DataGrid
						caption={t('blackoutKick.starveCaption')}
						minWidth="560px"
						columns={[
							{ key: 'at', label: t('blackoutKick.starveColumns.at'), width: '110px' },
							{ key: 'waited', label: t('blackoutKick.starveColumns.waited'), align: 'right', width: '90px' },
							{ key: 'bar', label: t('blackoutKick.starveColumns.bar'), align: 'right', width: '90px' },
							{ key: 'press', label: t('blackoutKick.starveColumns.press'), align: 'right', width: '100px' },
							{ key: 'debuff', label: t('blackoutKick.starveColumns.debuff'), align: 'right', width: '100px' },
						]}
						rows={starveRows}
						empty={t('blackoutKick.starveNone')}
					/>
					<div className="mt-3.5">
						<CauseLegend causes={['player']} />
					</div>
				</div>
			)}

			<div className="mt-4 flex flex-col gap-2.5">
				{/* Said here as well as at the control, because by this point in the page the toggle is off
				    screen — and immediately followed by the half of the section it does *not* touch, which
				    is the one thing a reader would otherwise assume it did. */}
				{forcedMode === null || forcedMode === undefined ? null : (
					<>
						<Note>{t(FORCED_NOTE[forcedMode])}</Note>
						<Note>{t('blackoutKick.starveUnbanded')}</Note>
					</>
				)}
				{starve === null || starve.chiAccuracyPct === null ? null : (
					<Note>{t('blackoutKick.reconstructed', { accuracy: starve.chiAccuracyPct })}</Note>
				)}
				{starveRows.length === 0 ? null : <Note>{t('blackoutKick.tierCaveat')}</Note>}
				<Note>{t('blackoutKick.notGraded')}</Note>
			</div>
		</Section>
	);
}
