import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock } from '~/lib/format';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '~/components/primitives';

/**
 * Earth Shock: the Lightning Shield spender, judged against the sim's own rule — and there is more than
 * one of those.
 *
 * **Which list a press is judged against comes off the target count at that press.** At one enemy it is
 * `p5.apl.json`, whose Earth Shock rule is an **or of two branches** picked by the tier-16 two-piece. With
 * the proc down it wants Lightning Shield at the ceiling (a stack spent is a stack of Fulmination the
 * shield must rebuild), the Flame Shock dot above six seconds and Ascendance more than six seconds from
 * demanding the shared shock timer. With the proc up it wants the shield at the ceiling, the proc's debuff
 * inside its last four seconds, and the dot outliving two of its own ticks — Ascendance is not asked about
 * at all.
 *
 * At **two** enemies it is `cleave.apl.json`, which has one form and two terms: six stacks and eight
 * seconds of dot. Not a looser rule — the dot floor is *higher* — and no branch for the set to pick,
 * because that list never mentions the two-piece. Per press rather than per pull, because a pull swings:
 * four of `cleave`'s twelve shocks are at one enemy and three at two.
 *
 * A press that fails a condition of *its* list is a shock spent early; the section reports which, and the
 * reason names the list so the two thresholds cannot be read as one. Note that the table is the fault
 * ledger — a press the rule wanted has no row — so a shock taken correctly inside a two-piece window shows
 * up here by its absence rather than by a marker, the same way every other correct press does.
 */
export default function EarthShock({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { earthShock } = el;
	const { t, gradeOf, unasked, verdict } = useReportCopy(analysis);

	/**
	 * The pull pressed the shock, and too few of the presses fell where a list has an opinion to read a
	 * share off them. A fourth sentence, and not new wording under an existing one.
	 *
	 * `earthShockGood` is a share over the presses made at one or two enemies, and `shareOf` hands that
	 * share its denominator as a sample size, which the scorer refuses under its own floor of three. So a
	 * pull with one or two of them has no letter, `gradeOf` answers `none`, and the sentence a reader got
	 * was the one for a pull that never pressed the button at all — printed over a table of the presses
	 * they made. The same shape as the exempt fix one floor down, with a different cause: there the rules
	 * were never asked of the pull, here they were asked and the answer is too thin to say out loud.
	 *
	 * **Two facts, so two sentences, and a reader acts on them differently.** "You never pressed this"
	 * asks for the button; "you pressed it, and there is not enough of it to score" asks for the table to
	 * be read a row at a time. Folding the second into the first is what the Windwalker's Tiger Palm did
	 * — its own `verdict_none` is the too-few sentence, so that section can no longer say the plain thing
	 * — and the cost of the fourth arm here is one key.
	 *
	 * Gated on the presses rather than on the floor itself, so the number three lives in one place. The
	 * only ways this metric arrives without a value are the exemption, which `verdict()` routes to its own
	 * arm before this is read, and a sample under the floor — and a sample under the floor with presses on
	 * the page is exactly this case. Nought presses at one or two enemies is in it too: a pull whose every
	 * shock went out at three or more still pressed the button, and the reading it is being scored at is
	 * the one thing that decides whether that is an exemption or a thin sample.
	 */
	const tooFew = gradeOf('earthShock') === 'none' && earthShock.presses.length > 0;

	const rows = useMemo<GridRow[]>(
		() =>
			[...earthShock.presses]
				// The table is the bad-shock ledger, not the log: a shock the rule wanted needs no row, and
				// the reasons below are why the rest went out.
				//
				// `=== false` and not `!press.good`, because `good` is nullable: a press at three or more
				// enemies has no list to be judged by and reads null, and truthiness would put it in this
				// ledger with an empty reasons cell — a row accusing a player of nothing in particular.
				.filter((press) => press.good === false)
				.sort((a, b) => a.t - b.t)
				.map((press, i) => ({
					key: `${press.t}-${i}`,
					band: 'warn' as const,
					cells: {
						at: formatClock(press.t),
						stacks: press.lsStacks === null ? '—' : `${press.lsStacks}`,
						state: press.reasons.map((reason) => t(`earthShock.state.${reason}`)).join(', '),
					},
				})),
		[earthShock.presses, t],
	);

	return (
		<Section id="earth-shock" title={t('earthShock.title')}>
			<Prose>
				<span className="inline-flex items-center gap-2 align-middle">
					<SpellIcon id={8042} size="sm" />
				</span>{' '}
				{t('earthShock.intent')}
			</Prose>

			{/* The three cases, one per line, because they were one paragraph.
			    `earthShock.intent` carried a hundred and fifty-six words holding a rule with three arms —
			    one enemy, one enemy under a tier-16 proc, two enemies — each with its own charge count and
			    its own dot floor, run together as prose. `docs/conventions.md`'s third density rule is that
			    a rule with cases is a table and not a paragraph; three lines is the table this section has
			    room for, and it is the only shape a reader can check a single press against. */}
			<div className="mt-4.5 flex flex-col gap-2">
				<Note>{t('earthShock.rule.single')}</Note>
				<Note>{t('earthShock.rule.tier')}</Note>
				<Note>{t('earthShock.rule.multi')}</Note>
			</div>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile
						value={`${earthShock.good}`}
						suffix={`/${earthShock.judged}`}
						label={t('earthShock.kpi.good')}
						caption={unasked('earthShockGood') ? t('metric.notAsked') : undefined}
					/>
					<StatTile value={`${earthShock.belowFull}`} label={t('earthShock.kpi.belowFull')} />
				</StatTiles>
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('earthShock.caption')}
					columns={[
						{ key: 'at', label: t('earthShock.columns.at'), width: '96px' },
						{ key: 'stacks', label: t('earthShock.columns.stacks'), align: 'right', width: '110px' },
						{ key: 'state', label: t('earthShock.columns.state') },
					]}
					rows={rows}
					empty={t('earthShock.none')}
				/>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				{/* `presses` is only read by `verdict_exempt`, which is the sentence for a reading where no list
				    has an Earth Shock rule at all: `judged` is the count at one and two enemies, so on that
				    reading it is the wrong number to name and the total is the right one. Without it the
				    fallback was `verdict_none` — "Earth Shock was never cast in this pull" — printed over a
				    table of shocks.

				    The thin arm names the same total for the same reason, beside the count of presses a list
				    had an opinion about, so a reader can see which of the two numbers the refusal is about.
				    Its own name is spelled out at the call rather than assembled, because `useReportCopy`
				    picks its arm off the grade and this one is not a grade. */}
				<Prose>
					{tooFew
						? t('earthShock.verdict', {
								context: 'tooFew',
								counted: earthShock.judged,
								presses: earthShock.presses.length,
							})
						: verdict('earthShock', {
								good: earthShock.good,
								casts: earthShock.judged,
								presses: earthShock.presses.length,
							})}
				</Prose>
				{/*
				 * The presses this section is *not* judging, said out loud on the pulls that have any.
				 *
				 * A reader who counts twelve shocks on the timeline and reads "4 of 7" here has been given a
				 * fraction they cannot reconstruct, and the missing five are the interesting part: the aoe
				 * list has no Earth Shock at all, so nothing asked the shield to be spent or held while
				 * three or more enemies were up.
				 */}
				{earthShock.presses.length > earthShock.judged ? (
					<Note>{t('earthShock.aoeUnjudged', { count: earthShock.presses.length - earthShock.judged })}</Note>
				) : null}
				{/* The one instruction the exempt sentence used to end on, said as a note instead.

				    It shipped as the tail of nine graded sentences — three arms each of the two narrowed
				    families and the three `verdict_exempt` arms — which put seventeen words of page navigation
				    after the reader's own figure in every one of them. One key now, and the verdict ends on the
				    pull. Still said per section rather than left to the control: by the time a reader is here the
				    toggle is off screen, which is the argument `PriorityLadder` and `Rotation` both make. */}
				{gradeOf('earthShock') === 'exempt' ? <Note>{t('targets.switchReading')}</Note> : null}
				<Note>{t('earthShock.fulmination')}</Note>
			</div>
		</Section>
	);
}
