import { useContext, useMemo } from 'react';

import { jumpToHeading } from '../jump';
import { TargetModeContext } from '../report/targetModeContext';
import { useReportCopy } from '~/hooks/useReportCopy';
import { GRADE_ORDER, type Metric } from '~/lib/score';
import { weightsFor, type MetricKey } from '~/lib/score/thresholds';
import type { Analysis } from '~/lib/types';

import { Note } from '../primitives';
import { secondaryButtonClass } from '../primitives/controls';

/**
 * Where each graded section actually lives on the page.
 *
 * The scorecard names its sections for the thing they measure; the page names them for the id a
 * reader jumps to. The two lists were never going to be the same — `tigerPalm` is `#tiger-palm`,
 * `brew` is `#bank` — and a card that cannot take you to the section arguing its case is a card that
 * has to be taken on trust.
 */
const SECTION_ANCHOR: Record<string, string> = {
	snapshots: 'snapshots',
	brew: 'bank',
	casts: 'cpm',
	debuff: 'debuff',
	tigerPalm: 'tiger-palm',
	energizingBrew: 'energizing',
	// The one card whose section is not a section. Nothing on the page argues the potion count in prose
	// — the evidence is the potion's own row on the timeline, including the bar that starts at the pull
	// because the buff did — so that is where the reader is sent.
	potions: 'timeline',
};

/** How many cards is a summary rather than a second report. */
const CARDS = 3;

interface MetricTakeaway {
	kind: 'metric';
	metric: Metric;
	section: string;
	weight: number;
}

interface AdviceTakeaway {
	kind: 'advice';
	key: 'energizingBrewRjw';
	section: 'energizingBrew';
}

type Takeaway = MetricTakeaway | AdviceTakeaway;

/**
 * How far past its threshold a metric sits, as a share of the band it missed.
 *
 * Ranking on the raw value cannot work — 78% GCD utilisation and 30 wasted Tiger Palms are not
 * comparable numbers — and ranking on grade alone leaves every red metric tied. This asks the one
 * question that is comparable across all of them: *by how much*, in units of the gap between passing
 * and failing. A metric that missed `ok` by a hair outranks nothing; one that missed it by triple
 * outranks everything.
 */
function shortfall(metric: Metric): number {
	const band = Math.abs(metric.good - metric.ok);
	if (band === 0) return 0;
	const missedBy = metric.higherIsBetter ? metric.ok - metric.value : metric.value - metric.ok;
	return missedBy / band;
}

/**
 * The three things worth fixing first, drawn from every metric the report grades.
 *
 * The report is long, and a reader who has just been handed a verdict wants to know what to do about
 * it before they read fifteen sections arguing the case. This is that, and it is deliberately
 * derived rather than written: the cards are whichever metrics actually scored worst on *this* pull,
 * so the summary cannot drift out of agreement with the sections below it the way a hand-written
 * list of common mistakes would.
 *
 * Ranked by grade first, then by the weight the scoring model already assigns, then by how far past
 * the threshold the number sits. Weight is what stops a metric the model barely counts from leading
 * a summary — snapshot depth carries zero weight because it is inverted in practice, and a card
 * telling someone to fix it would be advice to catch fewer procs.
 *
 * **The weights are the reading's, not the base set**, and that is the same map `overall` is averaged
 * over rather than a second one. It used to read `WEIGHTS` directly, which made the summary the one
 * part of the report blind to how the pull was being read — and blind in the direction that hurts,
 * because the two metrics `MULTI_TARGET_WEIGHTS` discounts are discounted for a reason the summary
 * repeats verbatim. `tigerPalmWaste` drops to a third on an add fight because at full weight it
 * "hands every add fight three points of credit for a habit it never had the chance to show"; a card
 * telling that player to stop overwriting Tiger Power is exactly that credit spent as advice. The
 * headline and the short list under it now rank on one set of weights, which is what stops them
 * disagreeing about what mattered on the pull.
 *
 * Nothing unmeasurable appears. A pull with no procs to snapshot has not failed to snapshot them,
 * and "cannot say" is not a takeaway.
 */
export default function Takeaways({ analysis }: { analysis: Analysis }) {
	const { t, card } = useReportCopy(analysis);
	// Read the same way every graded section reads it, and for the same reason `useReportCopy` does:
	// the reading is context rather than a prop, so this arrives without a signature having to carry it.
	const mode = useContext(TargetModeContext);

	const takeaways = useMemo<Takeaway[]>(() => {
		const weights = weightsFor(mode);
		const all: MetricTakeaway[] = [];
		for (const [section, score] of Object.entries(card.sections)) {
			for (const metric of score.metrics) {
				if (metric.unmeasurable || metric.grade === 'good') continue;
				const weight = weights[metric.key as MetricKey] ?? 0;
				// A metric the model does not count cannot lead the summary either. Zero weight is a
				// statement that the number should not move a verdict, and a card is a verdict.
				if (weight === 0) continue;
				all.push({ kind: 'metric', metric, section, weight });
			}
		}
		const metricTakeaways = all
			.sort(
				(a, b) =>
					GRADE_ORDER.indexOf(a.metric.grade) - GRADE_ORDER.indexOf(b.metric.grade) ||
					b.weight - a.weight ||
					shortfall(b.metric) - shortfall(a.metric),
			)
			.slice(0, CARDS);
		const energizing = analysis.energizing;
		const energizingAdvice =
			energizing?.rushingJadeWind === true && energizing.hasteWindows.length > 0 && energizing.hasteRjwUses === 0
				? [{ kind: 'advice' as const, key: 'energizingBrewRjw' as const, section: 'energizingBrew' as const }]
				: [];
		return [...energizingAdvice, ...metricTakeaways].slice(0, CARDS);
	}, [analysis.energizing, card, mode]);

	if (takeaways.length === 0) {
		return (
			<div className="flex flex-col gap-3.5">
				<h3 className="m-0 font-mono text-sm font-semibold tracking-[0.14em] uppercase text-muted">
					{t('summary.takeaways.title', { context: card.overall })}
				</h3>
				<Note>{t('summary.takeaways.clean')}</Note>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3.5">
			<h3 className="m-0 font-mono text-sm font-semibold tracking-[0.14em] uppercase text-muted">
				{t('summary.takeaways.title', { context: card.overall })}
			</h3>
			<ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-3">
				{takeaways.map((takeaway) => {
					const section = takeaway.section;
					const anchor = SECTION_ANCHOR[section];
					return (
						<li
							key={takeaway.kind === 'metric' ? takeaway.metric.key : takeaway.key}
							// Bordered on the side by the grade rather than filled with it: three filled cards at
							// the top of the report read as an error state, and two of these are usually amber.
							className={`flex flex-col gap-2 rounded-sm border border-line ${
								takeaway.kind === 'metric' && takeaway.metric.grade === 'bad'
									? 'border-l-2 border-l-miss'
									: 'border-l-2 border-l-brew'
							} bg-surface p-3.5`}
						>
							<span className="font-mono text-sm font-medium tracking-[0.1em] uppercase text-muted">
								{takeaway.kind === 'metric'
									? t(`summary.takeaways.metric.${takeaway.metric.key}.label`)
									: t('summary.takeaways.metric.energizingBrewRjw.label')}
							</span>
							<span className="text-sm text-ink-2">
								{takeaway.kind === 'metric'
									? t(`summary.takeaways.metric.${takeaway.metric.key}.fix`, {
											value: takeaway.metric.value,
											target: takeaway.metric.good,
											// The metric's own wording variant, for the few whose number is the same on two pulls
											// that need different advice. `undefined` on almost all of them, which selects the base
											// key — see `Metric.context`.
											context: takeaway.metric.context,
										})
									: t('summary.takeaways.metric.energizingBrewRjw.fix')}
							</span>
							{anchor === undefined ? null : (
								<a
									href={`#${anchor}-heading`}
									onClick={(event) => jumpToHeading(`${anchor}-heading`, event)}
									className={`mt-auto self-start ${secondaryButtonClass}`}
								>
									{t('summary.takeaways.jump')}
								</a>
							)}
						</li>
					);
				})}
			</ul>
		</div>
	);
}
