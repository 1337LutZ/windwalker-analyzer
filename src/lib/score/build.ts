/**
 * The four pieces every spec's scorecard is assembled from.
 *
 * These were written twice — once in `specs/windwalker/lib/score.ts`, once in
 * `specs/elemental/lib/score.ts` — and the two copies were identical once the comments were stripped.
 * The Elemental copy's own docstring said "for the same reason the Windwalker module does it", which
 * is the tell: a rule explained by pointing at its other copy has one home too few.
 *
 * What stays per-spec is the part that genuinely is: the `THRESHOLDS` table, the `WEIGHTS`, the
 * `MetricKey` union, and the wiring that decides which metrics make up which section. This module
 * takes the thresholds as an argument rather than importing them, which is the whole reason it can be
 * shared at all.
 */

import { gradedBands, type ScoreView, viewBands } from './bands';
import { type Grade, gradeOf, type Judged, type Metric, type MetricRule, type SectionScore, worst } from './model';

/** Percentage of `part` in `whole`, or null when there is nothing to take a share of. */
export function sharePct(part: number, whole: number): number | null {
	return whole > 0 ? (part / whole) * 100 : null;
}

/**
 * The smallest denominator a share is worth grading over: three events.
 *
 * `sharePct` alone declines only at zero, which leaves the two denominators that are worse than
 * nothing. At `whole` of 1 the only reachable values are 0 and 100, so a metric grades `good` off a
 * single press and `bad` off a single miss; at 2 they are 0, 50 and 100. Neither scale has an
 * interior, so the middle band — the one most real pulls belong in — is unreachable, and every grade
 * such a metric can produce is one event away from a different one. The Elemental `cleave` pull is the
 * case that found this: `flameShockWaste` reads `1/2` today and `0/1` once the aoe stretches leave the
 * clock, and that is a `bad`-to-`good` swing decided by one press.
 *
 * Three, not more. It is the first denominator with an interior (33% and 67% are reachable) and the
 * first where a majority is not one event, and it is the floor the rest of the app already keeps:
 * `TICK_MIN_SAMPLE` is two *intervals*, which is three ticks. Higher would be defensible on
 * statistical grounds and indefensible on practical ones — a floor of five would silence real faults
 * on short pulls, and silence is what this whole mechanism has to be sparing with.
 */
export const MIN_GRADED_SAMPLE = 3;

/**
 * A value together with the evidence behind it.
 *
 * The point of the wrapper is that the two ways a metric can have nothing to say are carried *with*
 * the number instead of remembered at the call site. A bare `number` says "grade this"; a `Measured`
 * says "grade this, over this much clock, off this many events", and `metricOf` is then the single
 * place that decides whether that is enough. Written this way round because the failure being fixed
 * was a call site that had the denominator available and did not think to check it.
 */
export interface Measured {
	value: number | null;
	/** ms of pull the value was measured over. Zero grades nothing — see `Metric.gradedMs`. */
	gradedMs?: number;
	/** Events behind the value. Below `MIN_GRADED_SAMPLE` grades nothing. */
	sampleSize?: number;
}

/** What `metricOf` will take: a plain number, an outright refusal, or a number with its evidence. */
export type MetricValue = number | null | Measured;

/**
 * A share and the denominator it came off, so the floor applies without the caller remembering it.
 *
 * The drop-in for `sharePct` on any metric whose whole is a count of events rather than a span of
 * time. `sharePct` stays as it is, for the shares whose denominator is a clock in ms — a floor of
 * three milliseconds means nothing.
 */
export function shareOf(part: number, whole: number): Measured {
	return { value: sharePct(part, whole), sampleSize: whole };
}

/**
 * A value and the length of the clock it was measured over.
 *
 * For every metric whose clock a band declaration can cut: overcap time, uptime, drift, seconds given
 * away. Passing the clock is what makes "no stretch of this pull was gradable" reach the score at all,
 * rather than arriving disguised as a perfect zero.
 */
export function gradedOver(value: number | null, gradedMs: number): Measured {
	return { value, gradedMs };
}

/**
 * One graded metric, against the spec's own rule for it.
 *
 * An unmeasurable metric is parked at `ok` so it neither flatters nor punishes the overall verdict;
 * `unmeasurable` is what the copy keys off to say nothing at all about it. A pull with no
 * Re-Origination procs has not failed to snapshot them, and copy that says "0 of 0 caught, poor"
 * about a fight that never offered the chance is worse than silence.
 *
 * **Three things can leave it with nothing to say, and all three are checked here rather than at the
 * call sites.** That is the point: the exemption is one mechanism applied to everything that declares
 * a scope, not a clause per metric.
 *
 *   - The caller had no number: `null`, as before.
 *   - The pull never entered the rule's bands, so the rule was never asked of it (`exempt`).
 *   - The evidence is too thin to grade: an empty clock, or a sample under `MIN_GRADED_SAMPLE`.
 *
 * The empty clock is the one worth spelling out. `0ms of overcap` measured over `0ms` of graded time
 * grades `good` if only the value is looked at — a free pass, and a worse answer than the honest
 * "cannot say", because it is a *reward* handed to the pulls the exemption just excused. Which is why
 * the guard is the graded length itself and never a proxy for it: "the shield was up", "the button was
 * pressed" and "stacks were seen" are all true of a pull none of whose stretches were gradable.
 */
export function metricOf<K extends string>(
	rules: Readonly<Record<K, MetricRule>>,
	key: K,
	value: MetricValue,
	context?: string,
	view?: ScoreView,
): Metric {
	const rule = rules[key];
	const measured: Measured = typeof value === 'number' || value === null ? { value } : value;
	const exempt = rule.bands !== undefined && gradedBands(rule, viewBands(view)).length === 0;
	const thin =
		(measured.gradedMs !== undefined && measured.gradedMs <= 0) ||
		(measured.sampleSize !== undefined && measured.sampleSize < MIN_GRADED_SAMPLE);
	const graded = exempt || thin ? null : measured.value;
	return {
		key,
		...rule,
		value: graded ?? 0,
		unmeasurable: graded === null,
		grade: graded === null ? 'ok' : gradeOf(rule, graded),
		// Omitted rather than set to undefined, so a metric with nothing to declare carries no key at all
		// and the scorecards in the fixtures stay the shape they were captured in.
		...(context === undefined ? {} : { context }),
		...(measured.gradedMs === undefined ? {} : { gradedMs: measured.gradedMs }),
		...(measured.sampleSize === undefined ? {} : { sampleSize: measured.sampleSize }),
		...(exempt ? { exempt: true as const } : {}),
	};
}

/**
 * A spec's rule table and one pull's band view, bound once so no call site can forget either.
 *
 * Both specs already hand-write the first half of this (`const metric = (key, value, context) =>
 * metricOf(THRESHOLDS, key, value, context)`), and the view is the half that would be easy to leave
 * off exactly one metric — which is the failure mode this whole mechanism is replacing. One binding
 * per scoring call, and every metric built from it is inside the exemption.
 */
export function grader<K extends string>(rules: Readonly<Record<K, MetricRule>>, view?: ScoreView) {
	return (key: K, value: MetricValue, context?: string): Metric => metricOf(rules, key, value, context, view);
}

/**
 * Builds a section from the metrics that decide it and the ones that merely describe it.
 *
 * A section is as good as its weakest *primary* metric — several weak signals on the same behaviour
 * should not average each other into looking acceptable.
 */
export function section(primary: Metric[], secondary: Metric[] = []): SectionScore {
	const metrics = [...primary, ...secondary];
	const decided = primary.filter((m) => !m.unmeasurable);
	return {
		metrics,
		primary,
		unmeasurable: metrics.every((m) => m.unmeasurable),
		grade: decided.length === 0 ? 'ok' : worst(decided.map((m) => m.grade)),
	};
}

const POINTS: Record<Grade, number> = { good: 1, ok: 0.5, bad: 0 };

/**
 * The share of the offered weight that has to survive for a headline to be a headline: half.
 *
 * `overall()` renormalises over the metrics it could measure, which is the right arithmetic and has a
 * consequence the report has to admit to: the grade is over the surviving weight, not over the spec.
 * A wholly band-3+ Elemental pull leaves 7 of 22 points judgeable, and the survivors are the weight-1
 * habit metrics — nothing the spec is actually about. A letter over that is a claim about a third of
 * the rotation wearing the clothes of a claim about the pull.
 *
 * Half is the line because the argument for it is the only one that does not need a distribution to
 * justify: past it the verdict is drawn from a minority of what the spec weighs, and a minority
 * reading should not be printed as a whole-pull one. The three committed Elemental fixtures measure 15
 * of 22, 13 of 22 and 13 of 22 — 68%, 59% and 59% — so every real pull we hold keeps its grade, and the
 * hypothetical the mechanism exists for (32%) loses it. A floor at 40% would have caught nothing; one
 * at 70% would refuse to grade `cleave`, which is the pull the whole exercise started from.
 *
 * Read `>=`: exactly half is enough. A tie should judge rather than refuse, the same way the grade
 * bands are inclusive at their edges.
 */
export const MIN_JUDGED_WEIGHT_SHARE = 0.5;

/**
 * The whole-pull verdict, and the denominator it was taken over.
 *
 * A weighted mean rather than the worst grade: one weak metric out of seven is a thing to mention,
 * not a reason to call the pull bad, and `worst` would have called every pull in the test set bad.
 * Unmeasurable metrics drop out entirely — they do not silently count as half marks.
 *
 * `judged` is what makes that dropping-out visible. Without it a `good` over 7 of 22 points and a
 * `good` over 22 of 22 print identically, and the report is silently confident about a pull it barely
 * looked at. Below `MIN_JUDGED_WEIGHT_SHARE` it stops printing a grade at all: `unmeasurable` is set
 * and the grade parks at `ok`, which is exactly what the old `nothing measurable at all → 'ok'` clause
 * did — that clause was this rule at zero, and zero was never the only place it bites.
 */
export function overallOf(
	metrics: Metric[],
	weights: Readonly<Record<string, number>>,
): {
	grade: Grade;
	judged: Judged;
} {
	let points = 0;
	let measured = 0;
	let total = 0;
	for (const m of metrics) {
		const weight = weights[m.key] ?? 1;
		total += weight;
		if (m.unmeasurable) continue;
		measured += weight;
		points += POINTS[m.grade] * weight;
	}
	// A metric can carry weight zero — see the Windwalker's `snapshotDepth` — so a pull whose only
	// measurable metric is one of those has nothing to average and must say so rather than divide by
	// nothing. `total` of zero is the same case seen from the other side, and both are the degenerate
	// end of the share test below rather than special cases of their own.
	const share = total > 0 ? measured / total : 0;
	if (measured === 0 || share < MIN_JUDGED_WEIGHT_SHARE) {
		return { grade: 'ok', judged: { measured, total, unmeasurable: true } };
	}
	const pct = (points / measured) * 100;
	return {
		grade: pct >= 75 ? 'good' : pct >= 45 ? 'ok' : 'bad',
		judged: { measured, total, unmeasurable: false },
	};
}

/** The verdict alone, for a caller that has nowhere to put the denominator. */
export function overall(metrics: Metric[], weights: Readonly<Record<string, number>>): Grade {
	return overallOf(metrics, weights).grade;
}
