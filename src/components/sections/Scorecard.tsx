import { useMemo } from 'react';

import type { Metric, SectionScore } from '~/lib/score/model';
import { GRADE_ORDER } from '~/lib/score/model';
import type { Analysis } from '~/lib/types';

import { useReportCopy } from '~/hooks/useReportCopy';

import { jumpToHeading } from '../jump';
import { useSpec } from '../report/specContext';
import { SPEC_TAKEAWAYS } from '../report/specSections';
import BandScale from '../score/BandScale';

/**
 * How much a section stands to gain, which is what the grid is ordered by.
 *
 * **"Biggest improvement" and not "worst letter".** Ranking on the grade alone leaves every red
 * section tied and says nothing about which of them is nearly fine, so the sort falls back to the same
 * question `Takeaways` asks of a single metric: how far past its threshold does the number sit, as a
 * share of the band it missed. That is the one quantity comparable across metrics whose units are not
 * — a share, a count of potions and a clock in seconds have no common scale, and "missed the ok line
 * by 1.4 bands" is the same statement about all three.
 *
 * A section takes the worst of its metrics rather than their mean, for the reason its own grade does:
 * a section is as good as its weakest part, and averaging would let one flawless number hide the one
 * a reader opened the section for.
 */
function headroom(score: SectionScore): number {
	const graded = score.metrics.filter((metric) => !metric.unmeasurable);
	if (graded.length === 0) return 0;
	return Math.max(
		...graded.map((metric) => {
			const band = Math.abs(metric.good - metric.ok);
			if (band === 0) return metric.grade === 'good' ? 0 : 1;
			const missedBy = metric.higherIsBetter ? metric.ok - metric.value : metric.value - metric.ok;
			return Math.max(0, missedBy / band);
		}),
	);
}

type T = ReturnType<typeof useReportCopy>['t'];

/** The number as the reader reads it, in the unit its rule declares. */
function reading(metric: Metric, t: T): string {
	if (metric.unit === 'percent') return t('summary.scorecard.value', { context: 'percent', value: metric.value });
	if (metric.unit === 'seconds') return t('summary.scorecard.value', { context: 'seconds', value: metric.value });
	if (metric.unit === 'stacks') return t('summary.scorecard.value', { context: 'stacks', value: metric.value });
	return t('summary.scorecard.value', { context: 'count', value: metric.value });
}

/** Where the rule's lines sit, in the same unit — the sentence under the scale. */
function target(metric: Metric, t: T): string {
	return t('summary.scorecard.target', {
		context: metric.higherIsBetter ? 'atLeast' : 'atMost',
		value: metric.unit === 'seconds' ? metric.good / 1000 : metric.good,
		unit: metric.unit,
	});
}

/**
 * Every graded section at once, with the bands each number was held to and where this pull landed.
 *
 * **What this adds to a report that already states its grades.** A letter is the *result* of a
 * comparison and the sections below argue it at length, but between the two there was nothing showing
 * the comparison itself. A reader was told "bad" and told the target, and had to hold both in their
 * head to work out whether they missed by a hair or by triple the band — which is exactly the
 * difference between a section worth opening and one worth a glance. `BandScale` draws that, and the
 * grid puts twenty-odd of them where the reader can compare them before choosing where to start.
 *
 * **Ordered by how much each section stands to gain**, worst first, so the reading order is the fixing
 * order. See `headroom`: it is `Takeaways`' own ranking question asked of a section rather than of one
 * metric, which is what keeps the two blocks agreeing about what matters instead of offering a reader
 * two different opinions in the same screen.
 *
 * **Every card is a link to the section that argues it.** The whole card and not a button inside it —
 * a card whose only job is to summarise a section is a link to that section, and a small "jump" target
 * inside a large clickable-looking box is the shape that teaches a reader the rest of the card is
 * dead. A section the spec has no anchor for renders as a plain card rather than a link that goes
 * nowhere; `SPEC_TAKEAWAYS` carries which those are and why.
 *
 * **The section's grade is the card's left border and is nowhere in words.** That is `Takeaways`'
 * treatment and the reason is its: three filled cards read as an error state, and most of these are
 * amber. It also keeps this block out of a vocabulary the report does not have — every graded section
 * below states its verdict as a *sentence*, and there is no copy anywhere that writes the letter on its
 * own. A chip reading "bad" would have been the first, invented here, for a card that already says the
 * number and draws where it fell.
 *
 * **Unmeasurable metrics get a sentence, not a scale.** A scale with no mark on it is a picture of a
 * rule nobody was held to, and drawing one would put an empty track beside four real ones and invite
 * the reader to read it as a zero.
 */
export default function Scorecard({ analysis }: { analysis: Analysis }) {
	// Read the same way `Takeaways` and every graded section read it: the spec and the reading are
	// context rather than props, so neither arrives through a signature.
	const { t, card } = useReportCopy(analysis);
	const spec = useSpec();

	const ordered = useMemo(() => {
		return Object.entries(card.sections)
			.filter(([, score]) => score.metrics.length > 0)
			.sort(([, a], [, b]) => GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade) || headroom(b) - headroom(a));
	}, [card]);

	if (ordered.length === 0) return null;

	const anchors = SPEC_TAKEAWAYS[spec.key]?.anchors ?? {};

	return (
		<div className="flex flex-col gap-3.5">
			<h3 className="m-0 font-mono text-sm font-semibold tracking-[0.14em] uppercase text-muted">
				{t('summary.scorecard.title')}
			</h3>
			<ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
				{ordered.map(([section, score]) => {
					const anchor = anchors[section];
					// The grade, as the one thing on the card that is not a number — see the docblock.
					const edge =
						score.grade === 'good'
							? 'border-l-2 border-l-kick'
							: score.grade === 'ok'
								? 'border-l-2 border-l-brew'
								: 'border-l-2 border-l-miss';
					const body = (
						<>
							{/* The section's own heading where the page has one. `potions` has no section of its own —
							    its evidence is the potion's row on the timeline — so it falls back to its single
							    metric's label rather than to a key invented for one card. */}
							<span className="font-mono text-sm font-medium tracking-[0.1em] uppercase text-ink-2">
								{t(`${section}.title`, {
									defaultValue: t(`summary.takeaways.metric.${score.metrics[0]?.key ?? ''}.label`, {
										defaultValue: section,
									}),
								})}
							</span>
							<span className="flex flex-col gap-2.5">
								{score.metrics.map((metric) => (
									<span key={metric.key} className="flex flex-col gap-1">
										<span className="flex items-baseline justify-between gap-2">
											<span className="text-sm text-muted">
												{t(`summary.takeaways.metric.${metric.key}.label`, { defaultValue: metric.key })}
											</span>
											<span className="tabular font-mono text-sm text-ink">
												{metric.unmeasurable ? t('summary.scorecard.unmeasured') : reading(metric, t)}
											</span>
										</span>
										{metric.unmeasurable ? null : (
											<>
												<BandScale metric={metric} />
												<span className="font-mono text-xs text-muted">{target(metric, t)}</span>
											</>
										)}
									</span>
								))}
							</span>
						</>
					);

					return (
						<li key={section} className="contents">
							{anchor === undefined ? (
								<div className={`flex flex-col gap-3 rounded-sm border border-line ${edge} bg-surface p-3.5`}>
									{body}
								</div>
							) : (
								<a
									href={`#${anchor}-heading`}
									onClick={(event) => jumpToHeading(`${anchor}-heading`, event)}
									className={`flex flex-col gap-3 rounded-sm border border-line ${edge} bg-surface p-3.5 no-underline transition-colors hover:border-muted hover:bg-raised`}
								>
									{body}
								</a>
							)}
						</li>
					);
				})}
			</ul>
		</div>
	);
}
