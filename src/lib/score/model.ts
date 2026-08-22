// What a graded metric is, and what a grade means.
//
// Grades exist so the report can *say* something without a human writing a sentence per outcome.
// Every piece of prose in the report picks its wording from a grade, which means the wording is a
// function of the numbers rather than of whoever wrote the component — and a pull that goes badly
// reads differently from one that goes well without anybody hard-coding either.

import type { Band } from '~/lib/spec/apl';

/**
 * Three levels, not five.
 *
 * Two would force a pass/fail on metrics where the middle is the normal case — most pulls land in
 * it, and calling them failures would be wrong. More than three would need thresholds finer than the
 * data supports: the difference between 78% and 81% GCD utilisation is fight movement, not skill,
 * and a grading scheme that claims to tell them apart is lying.
 *
 * No fourth level for "cannot say" either. That is not a worse verdict than `bad` nor a better one
 * than `good` — it is not on the scale at all, and putting it there would make the `worst` fold below
 * produce nonsense and force every `Record<Grade, …>` in the app (a tone, a colour, a piece of copy)
 * to invent an appearance for it. It travels beside the grade instead: `Metric.unmeasurable`,
 * `SectionScore.unmeasurable`, `Judged.unmeasurable`.
 */
export type Grade = 'good' | 'ok' | 'bad';

/** Ranked worst-first, so a whole-report verdict is `Math.min` over its parts. */
export const GRADE_ORDER: Grade[] = ['bad', 'ok', 'good'];

export interface Threshold {
	/** At or past this, the metric is `good`. */
	good: number;
	/** At or past this, `ok`; below it, `bad`. */
	ok: number;
	/**
	 * False when a lower number is the better one — wasted casts, seconds given away, drift.
	 * The comparison flips rather than the thresholds being written backwards, because a threshold
	 * list where some rows count up and others count down is unreadable.
	 */
	higherIsBetter: boolean;
}

/**
 * A threshold plus the conditions under which it may be applied at all.
 *
 * Split from `Threshold` rather than folded into it because a threshold is only three numbers and is
 * used for things that are not metrics — `wasteTone`'s reading aid is a `Threshold` and has no bands,
 * no sample and no grade. A rule is what a spec's `THRESHOLDS` table holds: the numbers *and* the
 * scope they are honest over.
 */
export interface MetricRule extends Threshold {
	/**
	 * The target-count bands this rule belongs to. Omitted means every band, which is most of them.
	 *
	 * The same `Band` the APL ladder gates its entries with, imported rather than re-spelled. Three
	 * things in this tree are already called a band — a target count, a chart's shaded stretch
	 * (`TrackBand`), and the good/ok/bad thresholds this file's prose calls bands — and a fourth
	 * vocabulary for the first of those would be one too many. A metric's scope is the *same question*
	 * the ladder answers per entry ("is this rung in the list at this count"), so it gets the same
	 * four values and the same `bandOf` saturation.
	 *
	 * Read like the ladder's `AplRule.bands` and for the same reason: a band gate is not a false
	 * condition. A rule outside its bands was never asked of this pull, so a pull that never entered
	 * its bands has no verdict on it — not a passing one. `metricOf` turns that into `unmeasurable`
	 * with `exempt` beside it, never into a grade.
	 *
	 * What earns a declaration: a rung only one target-count's list contains. What does not: a
	 * resource, a global, a proc window or a pre-pull press that exists identically at every count —
	 * those stay graded everywhere, however many enemies were up.
	 */
	bands?: readonly Band[];
}

export interface Metric extends MetricRule {
	/** Stable id — also the i18n key stem for this metric's wording. */
	key: string;
	/** The measured number, in the unit the threshold is written in. */
	value: number;
	grade: Grade;
	/**
	 * Null when the pull cannot answer it — no procs to snapshot, no brews spent, no Tiger Palm cast.
	 * A missing metric is not a failing one, and the difference has to survive into the copy.
	 */
	unmeasurable: boolean;
	/**
	 * Which variant of this metric's wording the pull calls for, as an i18next context.
	 *
	 * For the metrics whose number is the same on two pulls that need different advice. `potionsUsed`
	 * is the case it exists for: one of two potions is one fault when the pre-pull one was skipped and
	 * a different one when the in-combat one was, the value cannot tell them apart, and "drink the
	 * other one" is not advice. Absent on every metric whose number says everything, which is most of
	 * them, and absent on any scorecard built before it existed — so it is passed straight to `t()`,
	 * where `undefined` selects the base key.
	 */
	context?: string;
	/**
	 * How much of the pull this value was actually measured over, in ms, for a metric graded on a clock
	 * some of whose stretches its bands can cut.
	 *
	 * **This is the field that keeps an exemption from becoming a free pass.** A metric whose clock can
	 * be emptied has to publish the clock it graded, because `0ms of overcap` over `0ms` of graded time
	 * is indistinguishable from a flawless pull if only the value is looked at — and the flawless
	 * reading is the one a threshold will pick. `maxStacks > 0`, `casts > 0` and every other proxy for
	 * "was the thing present" answer a different question: the shield was up and counting all pull, and
	 * still nothing about its spending was judged.
	 *
	 * Absent on the metrics whose clock nothing can cut, and absent on every scorecard captured before
	 * the field existed.
	 */
	gradedMs?: number;
	/** The denominator behind a count or share value — see `MIN_GRADED_SAMPLE`. Absent when it has none. */
	sampleSize?: number;
	/**
	 * True when this pull is outside the rule's bands, so it was not judged rather than judged well.
	 *
	 * Distinct from the plain `unmeasurable` beside it, which says the log could not answer. This says
	 * the question was not asked: an add wave is not a pull that failed to multi-dot. Omitted rather
	 * than `false`, so a metric nothing exempted carries no field at all.
	 */
	exempt?: true;
}

/**
 * One report section's verdict: its own grade, and the metrics behind it.
 *
 * The grade comes from `primary` alone. Secondary metrics are still measured and still shown — they
 * are what the copy uses to add a clause — but they do not move the verdict, because some of them
 * are conditional in ways that would invert it. Snapshot depth is the standing example: it averages
 * only the procs that were caught, so a player who catches two of nine can outscore one who catches
 * twelve of sixteen. It describes technique; the catch rate describes whether the spec was played.
 */
export interface SectionScore {
	grade: Grade;
	/** Everything measured for this section, primary first, for display. */
	metrics: Metric[];
	/** The subset the grade came from. */
	primary: Metric[];
	/** True when nothing in the section could be measured, so it should say so rather than grade. */
	unmeasurable: boolean;
}

/**
 * How much of what the spec cares about the headline was actually able to look at.
 *
 * `overall()` renormalises over the metrics it could measure, which is right — an unmeasurable metric
 * should not count as half marks — but it means a `good` can be a `good` over half the spec. The two
 * numbers travel with the verdict so the report can say *judged on 7 of 22 points* rather than
 * present a minority reading as a whole-pull one.
 */
export interface Judged {
	/** Summed weight of the metrics that could be judged. */
	measured: number;
	/** Summed weight of every metric offered, judged or not. */
	total: number;
	/**
	 * True when too little of that weight survived for the grade to be a claim about the pull.
	 *
	 * The generalisation of the old `no measurable metric at all → 'ok'` clause: that was this
	 * condition at exactly zero, which was never the only place it can bite. See
	 * `MIN_JUDGED_WEIGHT_SHARE`.
	 */
	unmeasurable: boolean;
}

export interface Scorecard {
	overall: Grade;
	/**
	 * The denominator `overall` was taken over.
	 *
	 * Optional because a scorecard captured before it existed has none, and because a caller that only
	 * wants the letter should not have to thread it. A reader shown a headline without it is being
	 * asked to assume it was 22 of 22.
	 */
	judged?: Judged;
	sections: Record<string, SectionScore>;
}

export function gradeOf({ good, ok, higherIsBetter }: Threshold, value: number): Grade {
	if (higherIsBetter) return value >= good ? 'good' : value >= ok ? 'ok' : 'bad';
	return value <= good ? 'good' : value <= ok ? 'ok' : 'bad';
}

/** The worst grade present, or `good` for an empty list. A section is as good as its weakest part. */
export function worst(grades: Grade[]): Grade {
	return grades.reduce<Grade>((low, g) => (GRADE_ORDER.indexOf(g) < GRADE_ORDER.indexOf(low) ? g : low), 'good');
}
