import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import type { Analysis } from '~/lib/types';

import { SnapshotDepth } from '../charts';
import { Note, Pill, Prose, Section } from '../primitives';

/**
 * How far into each Re-Origination proc the brew was held before it went out.
 *
 * None of the wording lives here. `intent` states what the section measures and never changes;
 * `verdict` is chosen by this pull's catch rate, and every clause after it is rendered only when the
 * pull has the thing it describes — a pull with no back-to-back roll is never told what one is, and a
 * pull that gave nothing away is never told that the rest is time on the table.
 */
export default function SnapshotTable({ analysis }: { analysis: Analysis }) {
	const { procs } = analysis;
	const { t, card, verdict } = useReportCopy(analysis);

	const statMix = useMemo(() => Object.entries(procs.statMix).sort((a, b) => b[1] - a[1]), [procs.statMix]);

	// The trinket either fired or it did not. Scoring an empty section against a ten-paragraph
	// explanation of what should have happened reads as a fault; it is not one.
	if (procs.windows.length === 0) {
		return (
			<Section id="snapshots" title={t('snapshots.title')}>
				<Note>{t('snapshots.verdict', { context: 'none' })}</Note>
			</Section>
		);
	}

	const score = card.sections.snapshots;
	// Both grades are read off their own metric rather than off the section. The section's grade is
	// the catch rate's alone — depth is deliberately secondary — so asking the section for the depth
	// wording would describe the technique with the discipline's verdict.
	const rate = score?.metrics.find((m) => m.key === 'snapshotRate');
	const depth = score?.metrics.find((m) => m.key === 'snapshotDepth');

	// The rate comes from the metric that produced the grade, so the number in the sentence and the
	// sentence chosen for it cannot drift apart.
	const summary = [
		// `opportunities`, not `procs`: a proc that arrived with the bank below the rotation's floor was
		// never a chance, and counting it would tell the reader they missed something unbuyable.
		verdict('snapshots', { caught: procs.snapshotted, total: procs.opportunities, rate: rate?.value ?? 0 }),
		// Said out loud rather than quietly dropped — the reader can see the proc on the chart, so a
		// denominator smaller than the proc count has to explain itself.
		procs.unaffordable > 0 ? t('snapshots.unaffordable', { count: procs.unaffordable }) : null,
		procs.lastGcd > 0 ? t('snapshots.lastGcd', { count: procs.lastGcd }) : t('snapshots.lastGcdNone'),
		procs.backToBack > 0 ? t('snapshots.b2b', { count: procs.backToBack }) : null,
		procs.secondsGivenAway > 0 ? t('snapshots.givenAway', { seconds: procs.secondsGivenAway }) : null,
		// Worth saying out loud: a miss by a fraction reads as the same failure as never trying, and it
		// is not. The seconds are only shown for a single one — with several, the count is the point.
		procs.narrowlyMissed > 0
			? t('snapshots.narrowlyMissed', {
					count: procs.narrowlyMissed,
					ms: procs.windows.find((w) => w.snapshotAt === null && w.missedByMs !== null)?.missedByMs ?? 0,
				})
			: null,
	]
		.filter(Boolean)
		.join(' ');

	return (
		<Section id="snapshots" title={t('snapshots.title')}>
			<div className="flex flex-col gap-3.5">
				<Prose>{t('snapshots.intent')}</Prose>
				{/* The stat names are the log's own word for what the Rune returned, so those pills carry no
				    copy of their own; the back-to-back tallies beside them do. */}
				<p className="m-0">
					{statMix.map(([stat, count]) => (
						<Pill key={stat}>
							{count} &times; {stat}
						</Pill>
					))}
					{procs.backToBack > 0 ? (
						<>
							<Pill>{t('snapshots.pill.b2b', { count: procs.backToBack })}</Pill>
							{/* "Same-stat" only says something when the pull had more than one stat to be the same
							    as. On a sheet where the Rune fed Mastery every time, every roll is a same-stat
							    roll by definition, and the pill reads as a finding rather than as arithmetic. */}
							{procs.backToBackWasted > 0 && statMix.length > 1 ? (
								<Pill>{t('snapshots.pill.sameStat', { count: procs.backToBackWasted })}</Pill>
							) : null}
							<Pill>{t('snapshots.pill.devalued', { seconds: procs.devaluedSec })}</Pill>
						</>
					) : null}
				</p>
				{/* One stat across a whole pull is not a mistake, but it is a fact about the sheet rather
				    than about the play — and it is the only thing on this chart the reader changes outside
				    the fight, so it is worth saying once. */}
				{statMix.length === 1 && statMix[0] !== undefined ? (
					<Note>{t('snapshots.oneStat', { stat: statMix[0][0] })}</Note>
				) : null}
			</div>

			<div className="mt-5">
				<SnapshotDepth analysis={analysis} />
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				<Prose>{summary}</Prose>
				{depth && !depth.unmeasurable ? (
					<Prose>{t('snapshots.depth', { context: depth.grade, depth: procs.meanDepthPct })}</Prose>
				) : null}
				{/* Depth averages the procs that were caught, so when the catch rate itself grades badly the
				    average is describing a handful of moments rather than the pull. The caveat is keyed off
				    that grade rather than off a count, so the line it draws is the one in `thresholds`. */}
				{depth && !depth.unmeasurable && rate?.grade === 'bad' ? <Note>{t('snapshots.depthCaveat')}</Note> : null}
			</div>
		</Section>
	);
}
