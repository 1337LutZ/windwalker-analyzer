import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatInteger, formatPercentValue, formatSeconds } from '~/lib/format';
import type { Analysis, TargetMode } from '~/lib/types';
import { readBlackoutKick, BLACKOUT_KICK_CAST_ID } from '~/lib/view/blackoutKick';
import { bandForMode } from '~/lib/view/targetMode';

import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '../primitives';
import LogLink from './LogLink';

/**
 * Blackout Kick: what the list wanted at the globals it took, and what those globals cost elsewhere.
 *
 * It is the last press in the rotation to get a heading of its own, and the two halves below are why
 * it needed one rather than a paragraph inside the priority section. That section counts skips *by
 * button* — how often Tiger Palm was passed over, across every press — which is a fact about Tiger
 * Palm. Turned around, the same audit answers a question about this button that nothing else asks: of
 * the globals you spent on a Blackout Kick, what did the list want instead? Every skipped press lands
 * in exactly one row of that table, so it is exhaustive where a pair of hand-picked comparisons would
 * not be.
 *
 * ## Two claims, and they are never added together
 *
 * The table above says *the list wanted another button at this global*. The ledger below says *this
 * press cost you a kick later*. They are different faults with different clocks, and one press can be
 * in both or neither. The first is the ladder's verdict and moves with the reader's target count; the
 * second is arithmetic on the chi bar and moves with nothing, because how many enemies were in front
 * of the player does not change whether they had two chi.
 *
 * ## Nothing is graded, and the reasons were measured rather than assumed
 *
 * The obvious candidate was adherence — the share of judged presses the list agreed with. Swept over
 * 52 Windwalker pulls in the three anonymous reports it fails three separate ways, and the first is
 * fatal on its own:
 *
 * - **It moves with a control the reader sets.** Read at one target the sample runs 4.2–64.7% with a
 *   median of 38.9; read at three it runs 0.0–40.6% with a median of 10.0. Per pull the gap has a
 *   median of 22.8 points and reaches 64.7. A grade that changes by twenty points on a toggle is
 *   grading the reading, not the player — and unlike `MULTI_TARGET_WEIGHTS`, which reweights a metric
 *   that keeps its value, this is the value itself changing.
 * - **The bar underneath it is thinner than the ladder's own note claims.** `spec/apl.ts` cites
 *   87–95% off three reference pulls; over 52 the walk scores 56.8–94.5% with a median of 80.0. The
 *   verdict on a Blackout Kick turns on whether the rules above it were *affordable*, which is exactly
 *   what a reconstructed chi bar is least sure of.
 * - **The sample has no line in it.** Encounter alone explains 30.7% of the variance, and within a
 *   single fight the pulls spread as widely as the sample does — Malkorok 15/35/44/56, Immerseus
 *   4/20/39. That is the `rskUptime` finding again: a band cut here would bake the fight into the
 *   grade.
 *
 * The starvation half has no threshold either, and the reason is sharper. Zero would be the target if
 * following the priority list produced zero — but it does not. Of 175 charged presses across those 52
 * pulls, 43 are presses the ladder judged `followed`: the sim's dump rule guards with an *energy*
 * reserve and the failure is a *chi* one, so a press can satisfy the condition and still starve the
 * kick. There is no rule in the sim to take a number from, and a quartile band from 52 mixed pulls is
 * what `score/thresholds.ts` refuses on every page. So this section reports thoroughly and grades
 * nothing, exactly as Rushing Jade Wind does.
 */
export default function BlackoutKick({ analysis, mode }: { analysis: Analysis; mode?: TargetMode | null }) {
	const { t } = useReportCopy(analysis);

	/**
	 * The same audit `PriorityLadder` reads, selected the same way — `bandForMode` is the single answer
	 * both ask for. A section picking its own band would print one verdict on presses the section below
	 * it prints another verdict on.
	 *
	 * Only the *ladder* half of the reading uses it. The starved kicks are computed off the chi bar in
	 * the engine and are the same at every band, which the note beside them says out loud.
	 */
	const forced = bandForMode(mode ?? null);
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
					at: <LogLink href={row.link}>{formatClock(row.at)}</LogLink>,
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
				</div>
			)}

			<div className="mt-4 flex flex-col gap-2.5">
				{/* Said here as well as at the control, because by this point in the page the toggle is off
				    screen — and immediately followed by the half of the section it does *not* touch, which
				    is the one thing a reader would otherwise assume it did. */}
				{forced === null ? null : (
					<>
						<Note>{t(forced === 1 ? 'blackoutKick.forced_single' : 'blackoutKick.forced_multi')}</Note>
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
