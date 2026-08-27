// The arithmetic of a difference, and the decision that there is not one to report.

import type { Metric } from '~/lib/score/model';

import type { Incomparable, MetricGap, Side } from './model';

/**
 * How far apart two pulls have to be on one metric before the report says either is ahead.
 *
 * **A quarter of a band, and the reasoning is the scoring model's own.** `score/model.ts` argues that
 * three grades is as fine as this data goes, because "the difference between 78% and 81% GCD
 * utilisation is fight movement, not skill". A band is the width of that argument: it is the distance
 * between two thresholds the spec was willing to draw a line at. A quarter of it is well inside the
 * noise the model already declines to grade, so calling it a tie says nothing the thresholds do not.
 *
 * **This is a judgement, not a measurement, and it is written down as one.** Nothing in the logs
 * fixes the number. What it must not be is zero, which would report a leader on every metric where
 * two players differ in the sixth decimal place and turn the tally into a coin toss, and what it must
 * not be is a whole band, which would call two pulls level across a gap the spec grades differently.
 * **Measured on the six committed Windwalker captures**, all fifteen pairings of them: 146 metric
 * pairs compare, and at a quarter of a band not one of them is called level while the two pulls hold
 * different grades. That is the property worth having, and `gap.test.ts` asserts it rather than
 * trusting this sentence. The tightest real lead it lets through is `brewStacks` on `strong` against
 * `poor`, at exactly a quarter, where both pulls are `good` and one is still half a stack ahead.
 */
export const TIE_BANDS = 0.25;

/**
 * The two values, in bands, signed so that positive means A is ahead.
 *
 * Higher is not always better, so the subtraction flips rather than the caller remembering which way
 * round a rule runs. That is the same reason `Threshold.higherIsBetter` exists instead of thresholds
 * written backwards.
 *
 * A rule whose two lines coincide has no band to divide by, and the only honest answers left are that
 * the two pulls landed on different grades or that they did not. `headroom` in the scorecard reaches
 * the same fallback for the same reason.
 */
export function bandGap(a: Metric, b: Metric): number {
	// The mean of the two, and it has to be a function of both or the answer depends on which pull the
	// reader put first. This divided by `a`'s band alone, which was the same number as `b`'s for as long
	// as a spec's thresholds were fixed across the tier. `gcdUtilisation` is anchored per encounter now,
	// so a Garrosh pull and a Malkorok pull carry different band widths, and the old divisor made
	// `compare(x, y)` and `compare(y, x)` disagree by more than a sign — 1.91 against 2.34 on the two
	// committed captures. `direction.test` asserts the mirror and is what caught it.
	//
	// A mean rather than the wider or the narrower of the two because it is the only choice that treats
	// the two pulls alike; none of the three is "the" true unit when the two sides were graded on
	// different scales, and this figure is a sort key and a leader test rather than something printed.
	const band = (Math.abs(a.good - a.ok) + Math.abs(b.good - b.ok)) / 2;
	if (band === 0) {
		if (a.grade === b.grade) return 0;
		// Ranked against the grade order rather than the raw values, which a zero-width rule cannot
		// place. `good` beats `ok` beats `bad`, and the sign says which side holds the better one.
		const rank = { bad: 0, ok: 1, good: 2 } as const;
		return rank[a.grade] > rank[b.grade] ? 1 : -1;
	}
	const raw = a.higherIsBetter ? a.value - b.value : b.value - a.value;
	return raw / band;
}

/** Who a signed gap puts ahead, or null when it is inside the tie width. */
export function leaderOf(bands: number | null): Side | null {
	if (bands === null || Math.abs(bands) < TIE_BANDS) return null;
	return bands > 0 ? 'a' : 'b';
}

/**
 * Why this pair cannot be differenced, or null when it can.
 *
 * **`exempt` is tested before `unmeasurable`, and that order is the whole of this function.** An
 * exempt metric carries both flags: `metricOf` turns a rule outside its bands into an unmeasurable
 * metric with `exempt` beside it, precisely so that the two can be told apart downstream. Testing the
 * general flag first would collapse them again and report every band exemption as a log that could
 * not answer, which is the opposite claim. The log answered fine; the question was never put.
 *
 * `missing` leads because it is about neither pull: a key one scorecard does not hold at all is a
 * capture from before the rule existed, and a reader told the shorter story would go looking for a
 * rule that is not there.
 */
function refusalOf(a: Metric | null, b: Metric | null): { why: Incomparable; side: Side | null } | null {
	if (a === null || b === null) return { why: 'missing', side: a === null ? 'a' : 'b' };
	if (a.exempt === true || b.exempt === true) {
		const both = a.exempt === true && b.exempt === true;
		return { why: 'exempt', side: both ? null : a.exempt === true ? 'a' : 'b' };
	}
	if (a.unmeasurable || b.unmeasurable) {
		const both = a.unmeasurable && b.unmeasurable;
		return { why: 'unmeasurable', side: both ? null : a.unmeasurable ? 'a' : 'b' };
	}
	return null;
}

/** One metric key, on both sides: the gap when there is one, and the reason when there is not. */
export function metricGap(key: string, a: Metric | null, b: Metric | null): MetricGap {
	const refused = refusalOf(a, b);
	if (refused !== null) {
		return { key, a, b, bands: null, leader: null, why: refused.why, whySide: refused.side };
	}
	// Both sides are non-null here, which `refusalOf` has already established; the checks are for the
	// compiler rather than for the logic.
	if (a === null || b === null) {
		return { key, a, b, bands: null, leader: null, why: 'missing', whySide: a === null ? 'a' : 'b' };
	}
	const bands = bandGap(a, b);
	return { key, a, b, bands, leader: leaderOf(bands), why: null, whySide: null };
}
