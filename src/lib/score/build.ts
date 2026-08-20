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

import { type Grade, gradeOf, type Metric, type SectionScore, type Threshold, worst } from './model';

/** Percentage of `part` in `whole`, or null when there is nothing to take a share of. */
export function sharePct(part: number, whole: number): number | null {
	return whole > 0 ? (part / whole) * 100 : null;
}

/**
 * One graded metric, against the spec's own threshold for it.
 *
 * An unmeasurable metric is parked at `ok` so it neither flatters nor punishes the overall verdict;
 * `unmeasurable` is what the copy keys off to say nothing at all about it. A pull with no
 * Re-Origination procs has not failed to snapshot them, and copy that says "0 of 0 caught, poor"
 * about a fight that never offered the chance is worse than silence.
 */
export function metricOf<K extends string>(
	thresholds: Readonly<Record<K, Threshold>>,
	key: K,
	value: number | null,
	context?: string,
): Metric {
	const threshold = thresholds[key];
	return {
		key,
		...threshold,
		value: value ?? 0,
		unmeasurable: value === null,
		grade: value === null ? 'ok' : gradeOf(threshold, value),
		// Omitted rather than set to undefined, so a metric with no variant carries no key at all and the
		// scorecards in the fixtures stay the shape they were captured in.
		...(context === undefined ? {} : { context }),
	};
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
 * The whole-pull verdict.
 *
 * A weighted mean rather than the worst grade: one weak metric out of seven is a thing to mention,
 * not a reason to call the pull bad, and `worst` would have called every pull in the test set bad.
 * Unmeasurable metrics drop out entirely — they do not silently count as half marks.
 */
export function overall(metrics: Metric[], weights: Readonly<Record<string, number>>): Grade {
	const measured = metrics.filter((m) => !m.unmeasurable);
	if (measured.length === 0) return 'ok';

	let points = 0;
	let total = 0;
	for (const m of measured) {
		const weight = weights[m.key] ?? 1;
		points += POINTS[m.grade] * weight;
		total += weight;
	}
	// A metric can carry weight zero — see the Windwalker's `snapshotDepth` — so a pull whose only
	// measurable metric is one of those has nothing to average and must say so rather than divide by
	// nothing.
	if (total === 0) return 'ok';
	const pct = (points / total) * 100;
	return pct >= 75 ? 'good' : pct >= 45 ? 'ok' : 'bad';
}
