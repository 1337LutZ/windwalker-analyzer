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
 * **Distance to `good`, in bands** — not distance past `ok`, which is what this measured first and why
 * it needed replacing. Measuring the miss against `ok` returns zero for every metric that is not
 * failing, so on `cleave` five of the eight sections scored 0.00 and the grid's order below the red ones
 * was whatever `Object.entries` happened to yield. A summary whose whole job is "start here" cannot
 * leave two thirds of itself unsorted.
 *
 * Against `good` the number is continuous across all three grades: a failing section reads above 1, a
 * section that cleared `ok` but not `good` reads somewhere inside it, and a section already at `good`
 * reads 0. That also makes the grade term in the sort redundant rather than load-bearing — a `bad`
 * section is further from `good` than an `ok` one by construction — so what a reader sees is one ranking
 * rather than a ranking inside a grouping.
 *
 * Normalised by the band width because the units are not comparable: a share, a count of potions and a
 * clock in seconds have no common scale, and "1.4 bands short" is the same statement about all three.
 *
 * A section takes the worst of its metrics rather than their mean, for the reason its own grade does: a
 * section is as good as its weakest part, and averaging would let one flawless number hide the one a
 * reader opened the section for. Unmeasurable metrics are skipped — a number nobody was held to cannot
 * be a number worth improving — and a section with nothing left scores 0 and sorts to the end.
 */
function headroom(score: SectionScore): number {
	const graded = score.metrics.filter((metric) => !metric.unmeasurable);
	if (graded.length === 0) return 0;
	return Math.max(
		...graded.map((metric) => {
			const band = Math.abs(metric.good - metric.ok);
			// A rule whose two lines coincide has no band to normalise by, so the only honest answers are
			// "there is something to gain here" and "there is not".
			if (band === 0) return metric.grade === 'good' ? 0 : 1;
			const shortOf = metric.higherIsBetter ? metric.good - metric.value : metric.value - metric.good;
			return Math.max(0, shortOf / band);
		}),
	);
}

/**
 * A metric whose fault simply never happened, and which therefore has nothing to draw.
 *
 * `lightningShieldFellOff` at 0, `searingTotemOverlaps` at 0, `brewCapWaste` at 0%: a rule counting a
 * mistake, whose `good` line is "none of them", with none of them. The scale would be a full-width green
 * band with the mark pinned to the left edge, under a row reading `0s` — three pieces of furniture
 * saying one thing, and the one thing is that there is nothing here.
 *
 * **Only where `good` is zero**, which is what makes the reading unambiguous. A metric at 0 whose good
 * line is 2 — `potionsUsed` on a pull with no potions — is a *fault*, and hiding it would delete the
 * worst row on the card. The test is not "the value is zero", it is "the thing this counts did not
 * occur at all", and only a zero-target rule can say that.
 *
 * The section's grade still counts it, and so does `headroom`. This hides a row, not a number.
 */
const silent = (metric: Metric): boolean =>
	!metric.unmeasurable && !metric.higherIsBetter && metric.good === 0 && metric.value === 0;

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
 * **Ordered by how much each section stands to gain**, so the reading order is the fixing order and the
 * card at the top is where to start. See `headroom` for what that measures and why it is distance to
 * `good` rather than distance past `ok`.
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
 * **A metric carrying a `context` prints its sentence and no figure**, which is the one place this grid
 * may not show a number. `Metric.context` exists for the few metrics whose value is the same on two
 * pulls that need different readings, and on one of them the value is not a reading at all:
 * `lightningShieldFellOff` on a pull where the shield was never worn carries a mark standing for "never
 * up", not a count of drops. Printing it would fabricate a fault — a summary reading "keep the shield
 * up: 2" about a pull whose own section says the shield was never on. The scale goes with the number for
 * the same reason: there is nothing to place on it.
 *
 * **A metric whose fault never happened is not drawn at all** — see `silent`. It is still graded, still
 * counted by `headroom`, and still the reason its section is green; what it is not is three pieces of
 * furniture saying "nothing here".
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
					// Rows worth drawing. A card can lose all of them — a section whose every rule counts a fault
					// none of which happened — and says so in a sentence rather than rendering an empty column.
					const shown = score.metrics.filter((metric) => !silent(metric));
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
								{shown.length === 0 ? <span className="text-sm text-muted">{t('summary.scorecard.clean')}</span> : null}
								{shown.map((metric) => (
									<span key={metric.key} className="flex flex-col gap-1">
										<span className="flex items-baseline justify-between gap-2">
											<span className="text-sm text-muted">
												{t(`summary.takeaways.metric.${metric.key}.label`, { defaultValue: metric.key })}
											</span>
											<span className="tabular font-mono text-sm text-ink">
												{metric.unmeasurable
													? t('summary.scorecard.unmeasured')
													: metric.context === undefined
														? reading(metric, t)
														: null}
											</span>
										</span>
										{metric.unmeasurable ? null : metric.context === undefined ? (
											<>
												<BandScale metric={metric} />
												<span className="font-mono text-xs text-muted">{target(metric, t)}</span>
											</>
										) : (
											// The number is not a reading of the thing this rule counts — see the docblock.
											<span className="text-sm text-ink-2">
												{t('summary.scorecard.state', { context: metric.context })}
											</span>
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
