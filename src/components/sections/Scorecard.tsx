import { useMemo } from 'react';

import type { Grade, Metric, SectionScore } from '~/lib/score/model';
import { GRADE_ORDER } from '~/lib/score/model';
import type { Analysis } from '~/lib/types';

import i18n from '~/lib/i18n/config';

import { useReportCopy } from '~/hooks/useReportCopy';

import { gradeClass } from '../primitives/grade';

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

/**
 * The card's own ground, washed in its verdict.
 *
 * A stripe down one edge is what `Takeaways` used and it was right for three cards; across twenty it is
 * a column of near-identical boxes with a coloured pixel each. The wash is the same tone at a strength
 * that reads as ground rather than as a mark — `bg-surface` mixed with about a tenth of the verdict —
 * so the grid sorts itself into three visible bands before a word is read, which is what an ordered
 * summary is for.
 *
 * A tenth and not more: the card carries a metric label, a number, a scale and a target, and every one
 * of them is text on this ground. Past about 15% the amber and the rose start competing with the marks
 * on the scales they sit behind, which are the same three hues.
 *
 * **The text on it is `ink-2` and not `muted`, and the reason is not a contrast failure.** Measured on
 * all three tints, `muted` clears 6.6:1 — comfortably past AA. What was actually hard to read was 12px
 * of it: the target line under each scale is `text-xs`, and small type on a tinted ground loses more
 * than the ratio predicts. `ink-2` reads 12.3:1 there, and the hierarchy that `muted` was carrying moves
 * to size and to the value's own mono weight, which is where it survives being small.
 */
/**
 * The card's ground, tinted by its grade.
 *
 * **Mixed into `--color-tint-base` rather than into the surface**, which is what makes it read the same
 * on both specs. The surface carries `--spec-primary`, so one percentage over it landed faint on the
 * Windwalker — whose ground is already green, swallowing a green `good` — and loud on the Elemental's
 * blue-black. That is a hue disagreement rather than a strength one, and no single percentage fixes it.
 *
 * **14% over the neutral base**, which puts the three at ΔE 9–11 from the ground and well apart from
 * each other. 10% over the old surface measured ΔE 5–7 and read as a shade rather than as a colour;
 * 22% was past what a full card should carry. Measured in oklab, not picked by eye.
 */
const TINT: Record<Grade, string> = {
	good: 'bg-[color-mix(in_oklch,var(--color-good)_14%,var(--color-tint-base))]',
	ok: 'bg-[color-mix(in_oklch,var(--color-brew)_14%,var(--color-tint-base))]',
	bad: 'bg-[color-mix(in_oklch,var(--color-miss)_14%,var(--color-tint-base))]',
};

type T = ReturnType<typeof useReportCopy>['t'];

/**
 * One key if the locale has it, a fallback if it does not — and **not** `t(key, { defaultValue })`.
 *
 * `config.ts` sets `parseMissingKeyHandler` so a missing key renders as itself: loud in development,
 * harmless in production. i18next gives that handler precedence *over* `defaultValue`, so the obvious
 * spelling of a fallback silently does nothing and the reader gets the raw key. That is not theoretical
 * — this grid shipped `potions.title` on screen, because `potions` is the one section with no heading of
 * its own and the chain that was meant to catch it was written with `defaultValue`.
 *
 * **The `t()` calls stay written out at the call sites rather than moving in here**, and that is not
 * repetition for its own sake: `i18n/__tests__/keys.test.ts` finds a computed key by reading the
 * template literal inside a `t(...)` in the source. A key assembled behind a helper is a key that guard
 * cannot see, and it went straight to "copy nothing reads" for six families the moment it was tried.
 */
const has = (key: string): boolean => i18n.exists(key);

/**
 * A share taken over countable events is read as the count, not as the share.
 *
 * `earthShockGood` on `cleave` is 57.14%, which is four good presses out of the seven that were judged.
 * A reader counts presses, not percentages of them, and every other place this figure appears — the
 * section's own copy, its ledger of why each press was not good — counts them. The percentage was the
 * card restating a count in the one form nothing else on the page uses.
 *
 * **Keyed on `part`, which is why that field exists.** `sampleSize` alone would have caught
 * `karmaCapShare` too, and that metric is a share of the absorb ceiling carrying a *cast* count as its
 * sample — the numerator would have been a number of nothing. Only `shareOf` publishes both halves, and
 * only a metric with both is two counts of one thing. See `Metric.part`.
 */
const sampled = (metric: Metric): boolean => metric.part !== undefined && metric.sampleSize !== undefined;

/**
 * A rule whose `good` line is also the best the pull could have done — see `MetricRule.ceiling`.
 *
 * A count against its lid is read as the count over that lid, which is the same `n/n` shape a share
 * takes and says the same thing: two potions out of the two there were. A share already carries its own
 * lid in the unit, so it keeps its percentage and only its target line changes.
 */
const capped = (metric: Metric): boolean => metric.ceiling !== undefined && metric.good >= metric.ceiling;

/**
 * A rule whose `good` line is the best the pull could have done, in either direction.
 *
 * The lid is one way and is declared, because nothing in a threshold says whether a `good` of 2 is a bar
 * or a ceiling — see `MetricRule.ceiling`. The floor is the other way and needs no declaration at all,
 * because it is arithmetic: every lower-is-better rule here counts a fault, in seconds, presses or share
 * of a clock, and none of those goes below nothing. So a `good` of zero on such a rule is already the
 * best reading that exists, and "target 0s or less" asks for a duration there is no such thing as.
 *
 * Kept separate from `counted` on purpose. This decides how the target line is *worded*; `counted`
 * decides whether the figure is drawn as one count over another, and that one really does need the
 * declared lid — it is the denominator.
 */
const atBest = (metric: Metric): boolean => capped(metric) || (!metric.higherIsBetter && metric.good === 0);

/** Metrics read as one count over another, and which therefore need no target line under them. */
const counted = (metric: Metric): boolean => sampled(metric) || (capped(metric) && metric.unit === 'count');

/** The number as the reader reads it, in the unit its rule declares. */
function reading(metric: Metric, t: T): string {
	if (sampled(metric)) {
		// Always the numerator over the sample, whichever direction the rule runs. A waste rule reads "6/18"
		// and its label says what the six are, which is the pairing that makes the number legible: the label
		// carries the noun and the figure carries the count. Showing presses-made over presses-needed was
		// tried instead and asks the reader to subtract before they know what they are looking at.
		return t('summary.scorecard.value', { context: 'sample', part: metric.part, total: metric.sampleSize });
	}
	if (counted(metric)) {
		return t('summary.scorecard.value', { context: 'sample', part: metric.value, total: metric.ceiling });
	}
	if (metric.unit === 'percent') return t('summary.scorecard.value', { context: 'percent', value: metric.value });
	if (metric.unit === 'seconds') return t('summary.scorecard.value', { context: 'seconds', value: metric.value });
	if (metric.unit === 'stacks') return t('summary.scorecard.value', { context: 'stacks', value: metric.value });
	return t('summary.scorecard.value', { context: 'count', value: metric.value });
}

/**
 * Where the rule's line sits, in the metric's own unit — the sentence under the scale.
 *
 * **The unit is part of the context and not a separate placeholder**, which is the fix for a line that
 * read "target 0% or less" under a figure in seconds. Both arms formatted their number as a percentage
 * whatever the rule measured, because the unit was passed in and never used: Lightning Shield's overcap
 * is a clock, and the card said its ceiling was a share. i18next takes one context, so the direction and
 * the unit are composed into it — which also means an arm exists only for a combination some rule
 * actually has, and `keys.test.ts` says so if one stops being used.
 *
 * A duration goes over in milliseconds, because `duration` is `formatSeconds` and that divides. The
 * value above it is formatted the same way off the same number, so the two cannot disagree about scale.
 */
function target(metric: Metric, t: T): string {
	const unit =
		metric.unit === 'percent'
			? 'Percent'
			: metric.unit === 'seconds'
				? 'Seconds'
				: metric.unit === 'stacks'
					? 'Stacks'
					: 'Count';
	// A lid is not a bar, and neither is a floor. "100% or better" asks for more of a share than exists
	// and "0s or less" for a duration that does not, so a rule sitting on the best reading there is names
	// the number and stops — the reader is being told where the line is, not invited past it.
	const direction = atBest(metric) ? 'exact' : metric.higherIsBetter ? 'atLeast' : 'atMost';
	return t('summary.scorecard.target', { context: `${direction}${unit}`, value: metric.good });
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
 * **A row's label has to suit the shape of its figure**, which is a rule about the locale rather than
 * about this file, and it is written here because this is the only thing that reads those labels. A
 * percentage sits happily under an instruction — "Keep the dot up", 83.9% — because the number is
 * plainly a share of the thing being asked for. A **count** does not: "Stop overwriting Tiger Power"
 * over "6/18" reads as a score, and six out of eighteen looks like a bad grade rather than like six
 * presses too many. So every row whose figure is a count or a duration takes a noun that names what is
 * being counted — "Wasted refreshes", "Shield drops", "Time at full charge" — and the figure is left to
 * do the counting. Getting this wrong is invisible to every type in the tree and reads as a wrong
 * number. The rule, its two failure modes and the thirteen worked corrections are at
 * `docs/labels-and-figures.md`, which is tracked for the reason that file's own header gives: the skill
 * directory it was written in is ignored, and a citation a clone cannot open is a rule nobody can check.
 *
 * **A share over countable events reads as the count, and drops its target line** — see `sampled`. The
 * rest of the report counts `earthShockGood`'s presses and so does this; a percentage target under a
 * count would be the card changing units mid-row to restate the denominator it just printed.
 *
 * **A section nothing could be measured in is not drawn at all** — see the filter. The grid is an
 * ordered list whose promise is that the top of it is where to start, and a card reading `not measured`
 * twice takes a slot without earning one.
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

	/**
	 * The raid's haste cooldown, by the name this pull's raid actually used.
	 *
	 * `fireElementalHasteUptime` asks whether the summon covered *that* window, and the card called it
	 * "the haste cooldown" — a category, where the reader is looking at a fight in which somebody pressed
	 * Bloodlust or Heroism or Time Warp. The audit already knows which: `AuraWindow.variant` carries the
	 * spelling off the aura's own id, which is how `CastTimeline`'s legend names it.
	 *
	 * The first window and not all of them, because the metric grades one window — the one the summon
	 * could have covered. Falls back to the category when a pull has none, which is also every pull where
	 * the metric is unmeasurable and the label is drawn beside the words "not measured" rather than a
	 * figure. Handed to every label's `t()`, not just this one: an unused interpolation costs nothing and
	 * a second dynamic label should not need this plumbing built again.
	 */
	const cooldown = analysis.timeline?.hasteWindows?.[0]?.variant ?? t('fireElemental.hasteFallback');

	const ordered = useMemo(() => {
		return (
			Object.entries(card.sections)
				.filter(([, score]) => score.metrics.length > 0)
				// A section nothing could be measured in has nothing to say, so it is not drawn. **Mana is the
				// case this is for and it is exact rather than approximate**: both of its rules are `null` unless
				// the pool actually went starved or strained, so "every metric unmeasurable" *is* "the player
				// never ran low". A card reading `not measured` twice under a heading is worse than no card —
				// it takes a slot in an ordered grid whose whole promise is that the top of it is where to start.
				//
				// The coverage is not lost with the card: the headline above the grid already says how many of
				// the spec's points were judged, which is where a reader learns that something went unasked.
				.filter(([, score]) => !score.metrics.every((metric) => metric.unmeasurable))
				.sort(
					([, a], [, b]) => GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade) || headroom(b) - headroom(a),
				)
		);
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
					// The grade, as the one thing on the card that is not a number — see the docblock. The stripe
					// comes from `GRADE`, which is where every verdict colour on the page comes from; the wash is
					// the same tone at a strength a card can carry behind text.
					const edge = `border-l-2 ${gradeClass('edge', score.grade)} ${TINT[score.grade]}`;
					const body = (
						<>
							{/* The section's own heading where the page has one, and every section now has one. The
							    fallback stays because it is what `potions` needed before it was given a title: that
							    section has no heading on the page — its evidence is the potion's row on the timeline —
							    and a card borrowing its single metric's label read *"Potions drunk"* twice, once as
							    the heading and once as the row under it. */}
							<span className="font-mono text-sm font-medium tracking-[0.1em] uppercase text-ink-2">
								{has(`${section}.title`)
									? t(`${section}.title`)
									: has(`summary.takeaways.metric.${score.metrics[0]?.key ?? ''}.label`)
										? t(`summary.takeaways.metric.${score.metrics[0]?.key ?? ''}.label`)
										: section}
							</span>
							<span className="flex flex-col gap-2.5">
								{shown.length === 0 ? <span className="text-sm text-muted">{t('summary.scorecard.clean')}</span> : null}
								{shown.map((metric) => (
									<span key={metric.key} className="flex flex-col gap-1">
										<span className="flex items-baseline justify-between gap-2">
											<span className="text-sm text-ink-2">
												{has(`summary.takeaways.metric.${metric.key}.label`)
													? t(`summary.takeaways.metric.${metric.key}.label`, { cooldown })
													: metric.key}
											</span>
											<span className="tabular font-mono text-sm text-ink">
												{metric.unmeasurable
													? sampled(metric)
														? reading(metric, t)
														: t('summary.scorecard.unmeasured')
													: metric.context === undefined
														? reading(metric, t)
														: null}
											</span>
										</span>
										{/* **A refused count is still a count, and withholding it was a defect.** `metricOf` parks
										    the *value* of a metric it will not grade, but `part` and `sampleSize` survive on the
										    metric and are true whatever the sample size. Flame Shock's wasted refreshes is the
										    case: at one wasted of two judged the rule declines — the reachable values are 0, 50
										    and 100, and one press would carry the section — so the card printed "not measured"
										    while the section three screens down said "1 of the refreshes threw away a tick". Two
										    surfaces, one pull, no number joining them. The count now prints with the reason
										    under it, which is the rule `8e011ac` set for the section copy and this never took:
										    an unmeasured figure is not a deleted one. The scale and the target line stay off,
										    because those are the parts that would be claiming a grade. */}
										{metric.unmeasurable ? (
											sampled(metric) ? (
												<span className="font-mono text-xs text-ink-2">{t('summary.scorecard.tooThin')}</span>
											) : null
										) : metric.context === undefined ? (
											<>
												<BandScale metric={metric} />
												{/* The denominator already frames the number, so a percentage target under a count
												    would be the card changing units mid-row to say the same thing again. */}
												{counted(metric) ? null : (
													<span className="font-mono text-xs text-ink-2">{target(metric, t)}</span>
												)}
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
								<div className={`flex flex-col gap-3 rounded-sm border border-line ${edge} p-3.5`}>{body}</div>
							) : (
								<a
									href={`#${anchor}-heading`}
									onClick={(event) => jumpToHeading(`${anchor}-heading`, event)}
									className={`flex flex-col gap-3 rounded-sm border border-line ${edge} p-3.5 no-underline transition-colors hover:border-muted`}
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
