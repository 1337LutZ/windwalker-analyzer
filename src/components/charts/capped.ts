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
export function cappedOf(curve: ResourceCurve): Window[] {
	const out: Window[] = [];
	const points = curve.points;
	for (let i = 1; i < points.length; i += 1) {
		const prev = points[i - 1];
		const cur = points[i];
		if (prev === undefined || cur === undefined) continue;
		if (prev[1] < curve.max || cur[1] < curve.max) continue;
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
