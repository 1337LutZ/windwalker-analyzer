// What a graded metric is, and what a grade means.
//
// Grades exist so the report can *say* something without a human writing a sentence per outcome.
// Every piece of prose in the report picks its wording from a grade, which means the wording is a
// function of the numbers rather than of whoever wrote the component — and a pull that goes badly
// reads differently from one that goes well without anybody hard-coding either.

/**
 * Three levels, not five.
 *
 * Two would force a pass/fail on metrics where the middle is the normal case — most pulls land in
 * it, and calling them failures would be wrong. More than three would need thresholds finer than the
 * data supports: the difference between 78% and 81% GCD utilisation is fight movement, not skill,
 * and a grading scheme that claims to tell them apart is lying.
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

export interface Metric extends Threshold {
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

export interface Scorecard {
	overall: Grade;
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
