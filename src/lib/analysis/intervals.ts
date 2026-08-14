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
