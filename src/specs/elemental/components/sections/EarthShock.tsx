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
	const { t, verdict } = useReportCopy(analysis);

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

			<div className="mt-4.5">
				<StatTiles>
					<StatTile value={`${earthShock.good}`} suffix={`/${earthShock.judged}`} label={t('earthShock.kpi.good')} />
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
				<Prose>{verdict('earthShock', { good: earthShock.good, casts: earthShock.judged })}</Prose>
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
				<Note>{t('earthShock.fulmination')}</Note>
			</div>
		</Section>
	);
}
