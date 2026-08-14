// Turns one analysis into a scorecard: a grade per metric, a grade per section, one overall.
//
// Pure and total. Every metric that cannot be measured in a given pull is marked rather than
// defaulted, because a pull with no Re-Origination procs has not failed to snapshot them — and copy
// that says "0 of 0 caught, poor" about a fight that never offered the chance is worse than silence.

import type { Analysis } from '~/lib/types';

import type { Grade, Metric, Scorecard, SectionScore } from './model';
import { GRADE_ORDER, gradeOf, worst } from './model';
import type { MetricKey } from './thresholds';
import { THRESHOLDS, WEIGHTS } from './thresholds';

/** Percentage of `part` in `whole`, or null when there is nothing to take a share of. */
function share(part: number, whole: number): number | null {
	return whole > 0 ? (part / whole) * 100 : null;
}

function metric(key: MetricKey, value: number | null): Metric {
	const threshold = THRESHOLDS[key];
	// An unmeasurable metric is parked at `ok` so it neither flatters nor punishes the overall
	// verdict; `unmeasurable` is what the copy keys off to say nothing at all about it.
	return {
		key,
		...threshold,
		value: value ?? 0,
		unmeasurable: value === null,
		grade: value === null ? 'ok' : gradeOf(threshold, value),
	};
}

/**
 * Builds a section from the metrics that decide it and the ones that merely describe it.
 *
 * A section is as good as its weakest *primary* metric — several weak signals on the same
 * behaviour should not average each other into looking acceptable.
 */
function section(primary: Metric[], secondary: Metric[] = []): SectionScore {
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
function overall(metrics: Metric[]): Grade {
	const measured = metrics.filter((m) => !m.unmeasurable);
	if (measured.length === 0) return 'ok';

	let points = 0;
	let total = 0;
	for (const m of measured) {
		const weight = WEIGHTS[m.key as MetricKey] ?? 1;
		points += POINTS[m.grade] * weight;
		total += weight;
	}
	const pct = (points / total) * 100;
	return pct >= 75 ? 'good' : pct >= 45 ? 'ok' : 'bad';
}

/**
 * Grades one pull.
 *
 * Section keys match the report's section ids, so a component asks for its own verdict by the name
 * it already has.
 */
export function scoreAnalysis(analysis: Analysis): Scorecard {
	const { procs, brew, debuff, filler, cpm } = analysis;

	const gcdUtilisation = metric('gcdUtilisation', cpm.gcdSlots > 0 ? cpm.gcdUtilisationPct : null);
	// Against the procs the bank could actually have paid for, not every proc that fired. A pull opens
	// with an empty bank, so the raw count charges players for procs they were never offered.
	const snapshotRate = metric('snapshotRate', share(procs.snapshotted, procs.opportunities));
	// Averaged over caught procs only, so with none caught there is nothing to average.
	const snapshotDepth = metric('snapshotDepth', procs.snapshotted > 0 ? procs.meanDepthPct : null);
	// Only graded on a pull concentrated on one enemy. On an add fight the debuff is spread across
	// targets by design, and grading uptime against whichever enemy took the most damage marks correct
	// play as a fault — it produced uptimes as low as 0.6% across a real 25-pull sample.
	const rskUptime = metric('rskUptime', debuff.casts > 0 && debuff.singleTarget ? debuff.engagedUptimePct : null);
	const tigerPalmWaste = metric('tigerPalmWaste', share(filler.wasted, filler.casts));
	const brewStacks = metric('brewStacks', brew.uses > 0 ? brew.avgConsumed : null);
	const brewCapWaste = metric('brewCapWaste', brew.uses > 0 || brew.maxStacks > 0 ? brew.wastedAtCap : null);

	const all = [gcdUtilisation, snapshotRate, snapshotDepth, rskUptime, tigerPalmWaste, brewStacks, brewCapWaste];

	return {
		overall: overall(all),
		sections: {
			// Depth is deliberately secondary — see the note on SectionScore.
			snapshots: section([snapshotRate], [snapshotDepth]),
			brew: section([brewStacks, brewCapWaste]),
			casts: section([gcdUtilisation]),
			debuff: section([rskUptime]),
			tigerPalm: section([tigerPalmWaste]),
		},
	};
}

export { GRADE_ORDER };
