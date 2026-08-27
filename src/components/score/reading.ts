// How a graded number is written out, and where its rule's line is said to sit.
//
// Lifted out of `Scorecard` when the compare page needed to print the same figures. Two pages showing
// one metric must show it identically — a share read as `6/18` on one and as `33.3%` on the other is
// two reports disagreeing about what was measured — and the only way to guarantee that is one
// function. The keys stay written out as literals here, because `i18n/__tests__/keys.test.ts` finds a
// key by reading the source for quoted key paths, and a key assembled behind a helper is a key that
// guard cannot see.

import type { Metric } from '~/lib/score/model';

/** Whatever the caller's `t` is. Both callers hold one; neither should have to name its type. */
export type Translate = (key: string, values?: Record<string, unknown>) => string;

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
export const sampled = (metric: Metric): boolean => metric.part !== undefined && metric.sampleSize !== undefined;

/**
 * A rule whose `good` line is also the best the pull could have done — see `MetricRule.ceiling`.
 *
 * A count against its lid is read as the count over that lid, which is the same `n/n` shape a share
 * takes and says the same thing: two potions out of the two there were. A share already carries its own
 * lid in the unit, so it keeps its percentage and only its target line changes.
 */
export const capped = (metric: Metric): boolean => metric.ceiling !== undefined && metric.good >= metric.ceiling;

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
export const atBest = (metric: Metric): boolean => capped(metric) || (!metric.higherIsBetter && metric.good === 0);

/** Metrics read as one count over another, and which therefore need no target line under them. */
export const counted = (metric: Metric): boolean => sampled(metric) || (capped(metric) && metric.unit === 'count');

/** The number as the reader reads it, in the unit its rule declares. */
export function reading(metric: Metric, t: Translate): string {
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
export function target(metric: Metric, t: Translate): string {
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
