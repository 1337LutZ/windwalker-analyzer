// Half-open time ranges in fight-relative milliseconds. Every uptime, drift and overlap number in
// the analysis is one of these four operations.

export type Interval = [number, number];

/** Sort and coalesce; intervals that merely touch (`a.end === b.start`) are joined. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
	const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
	const out: Interval[] = [];
	for (const [start, end] of sorted) {
		const last = out[out.length - 1];
		if (last && start <= last[1]) last[1] = Math.max(last[1], end);
		else out.push([start, end]);
	}
	return out;
}

/** Total time covered, counting overlapped stretches once. */
export function unionMs(intervals: readonly Interval[]): number {
	return mergeIntervals(intervals).reduce((sum, [start, end]) => sum + (end - start), 0);
}

/**
 * How much of `[start, end)` falls inside `ranges`.
 *
 * The ranges are summed rather than unioned, so pass a disjoint set (merge it first if it might
 * not be) — otherwise overlapping ranges count their shared time twice.
 */
export function overlapMs(start: number, end: number, ranges: readonly Interval[]): number {
	return ranges.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(end, b) - Math.max(start, a)), 0);
}

/**
 * What `intervals` does *not* cover, from 0 to `durationMs`.
 *
 * The complement of engaged time is the fight taking the target away — an intermission — which two
 * charts now shade, so it is one operation here rather than one per chart. Merged first, because a
 * pair of overlapping segments would otherwise open a gap between them that nothing was ever absent
 * for. Slivers are left in: how short a gap has to be before it is rounding rather than a phase is a
 * question about what is being drawn, and the callers answer it.
 */
export function complementOf(intervals: ReadonlyArray<readonly [number, number]>, durationMs: number): Interval[] {
	const gaps: Interval[] = [];
	let cursor = 0;
	// Copied into mutable pairs rather than asserted: `engagedSegments` reaches this as a readonly
	// tuple from the analysis, and `mergeIntervals` builds its own pairs to coalesce into.
	for (const [start, end] of mergeIntervals(intervals.map(([a, b]): Interval => [a, b]))) {
		// Clamped, because an input interval may start past the end of the pull — `targetCounts` pads
		// its last point by a window, and a proc caught on the final global can be stamped past it. The
		// interior gap used to be pushed with the raw `start`, so the complement ran off the end of a
		// fight and the two charts that shade it drew a band wider than the timeline it sits in.
		const from = Math.min(start, durationMs);
		if (from > cursor) gaps.push([cursor, from]);
		cursor = Math.max(cursor, end);
		if (cursor >= durationMs) return gaps;
	}
	if (cursor < durationMs) gaps.push([cursor, durationMs]);
	return gaps;
}

/** Pairwise intersection of two sets of intervals; empty overlaps are dropped. */
export function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
	const out: Interval[] = [];
	for (const [aStart, aEnd] of a) {
		for (const [bStart, bEnd] of b) {
			const start = Math.max(aStart, bStart);
			const end = Math.min(aEnd, bEnd);
			if (end > start) out.push([start, end]);
		}
	}
	return out;
}
