import type { ResourceCurve, Window } from '~/lib/types';

/**
 * The stretches a bar spent at its ceiling.
 *
 * Derived here rather than read off the energy audit, because that audit answers a different and
 * narrower question — it splits capping into engaged and downtime and deliberately under-reports,
 * requiring the opening reading to have spent nothing. This is the drawing version: two adjacent
 * readings both at the ceiling means the bar was full between them, which is what a reader is
 * looking at when they scan the row.
 *
 * Its own module rather than a second export beside `ResourceTrack`: a component module has to
 * export nothing but components for React Fast Refresh to hot-swap it, and four charts import this.
 *
 * Chi and energy both go through it. Overcapped chi is the same fault as wasted energy — generation
 * that went nowhere — and drawing them the same way is what lets one glance cover both.
 */
/**
 * The ceiling in force at a given moment, for a bar whose ceiling moves.
 *
 * A closure rather than a lookup per call: the step series is walked forward with the caller's own
 * cursor, so a whole curve costs one pass rather than one scan per reading. Callers read points in
 * time order, which is the only thing this relies on — and it re-scans from the start if they do not,
 * so an out-of-order read is slow rather than wrong.
 *
 * A curve with no `ceiling` gets `max` for every moment, which is the behaviour every caller had
 * before the field existed.
 */
export function ceilingReader(curve: ResourceCurve): (t: number) => number {
	const steps = curve.ceiling;
	if (steps === undefined || steps.length === 0) return () => curve.max;
	let i = 0;
	return (t: number) => {
		if (i > 0 && (steps[i]?.[0] ?? 0) > t) i = 0;
		while (i + 1 < steps.length && (steps[i + 1]?.[0] ?? 0) <= t) i += 1;
		// Before the first step the pull is on whatever that step says: a series that opens after t=0
		// is describing a ceiling that was already in force, not one that did not exist yet.
		return steps[i]?.[1] ?? curve.max;
	};
}

export function cappedOf(curve: ResourceCurve): Window[] {
	const out: Window[] = [];
	const points = curve.points;
	const ceiling = ceilingReader(curve);
	for (let i = 1; i < points.length; i += 1) {
		const prev = points[i - 1];
		const cur = points[i];
		if (prev === undefined || cur === undefined) continue;
		// Each reading against the ceiling that was in force at *its* moment, not the pull's highest.
		// For every bar but one those are the same number; for Vengeance under a health buff they are
		// not, and comparing a raised-ceiling reading against the raised `max` would report a bar that
		// was at its limit as short of it. See `ResourceCurve.ceiling`.
		if (prev[1] < ceiling(prev[0]) || cur[1] < ceiling(cur[0])) continue;
		const last = out[out.length - 1];
		// Merged as they are found: consecutive full readings are one stretch, not one band per gap.
		if (last !== undefined && last.end === prev[0]) last.end = cur[0];
		else out.push({ start: prev[0], end: cur[0] });
	}
	return out;
}

/**
 * The stretches a bar spent empty, as the mirror of `cappedOf`.
 *
 * For a pool that being full is no fault (mana), emptiness is the fault that matters: at zero the
 * player cannot cast, and every second there is a button they wanted and could not afford. Drawn
 * where the capped shade would be, in the same red, so "out" reads as the opposite of the ceiling
 * bands every other bar carries.
 */
export function emptiedOf(curve: ResourceCurve): Window[] {
	const out: Window[] = [];
	const points = curve.points;
	for (let i = 1; i < points.length; i += 1) {
		const prev = points[i - 1];
		const cur = points[i];
		if (prev === undefined || cur === undefined) continue;
		if (prev[1] > 0 || cur[1] > 0) continue;
		const last = out[out.length - 1];
		if (last !== undefined && last.end === prev[0]) last.end = cur[0];
		else out.push({ start: prev[0], end: cur[0] });
	}
	return out;
}
