/**
 * The one binary search a step series needs: the last entry at or before an instant.
 *
 * Every series in this codebase that answers "what was it at time t" is a step function sampled at
 * irregular instants — the target count, a resource curve, a cooldown's presses — and reading one
 * means finding the last sample whose stamp is at or before `t`. That search was hand-rolled four
 * separate times, character for character, in `spec/apl.ts`, `analysis/targets.ts` and twice in the
 * spec audits. One of those copies was written in the same change that deleted another.
 *
 * `levelAt` in `./auras` is deliberately **not** built on this. It compares `start < at` rather than
 * `<= t` and then checks the stretch's `end`, because an aura that expired before `t` has no level at
 * `t` — a different question with a different answer, and folding it in here would quietly change it.
 */

/**
 * Index of the last entry whose key is `<= t`, or `-1` when every key is later.
 *
 * `keyAt` rather than an array of keys so a caller can search tuples, objects or bare numbers without
 * building a projection first. It is called O(log n) times, so the indirection costs nothing.
 */
export function lastIndexAtOrBefore(length: number, keyAt: (index: number) => number, t: number): number {
	let lo = 0;
	let hi = length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (keyAt(mid) <= t) {
			found = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return found;
}

/** The value of a `[stamp, value]` step series at `t`; null before the first stamp. */
export function valueAtOrBefore(points: ReadonlyArray<readonly [number, number]>, t: number): number | null {
	const at = lastIndexAtOrBefore(points.length, (i) => points[i]?.[0] ?? Infinity, t);
	return at === -1 ? null : (points[at]?.[1] ?? null);
}

/** The last stamp at or before `t` in a sorted list of instants; null when none is. */
export function stampAtOrBefore(stamps: readonly number[], t: number): number | null {
	const at = lastIndexAtOrBefore(stamps.length, (i) => stamps[i] ?? Infinity, t);
	return at === -1 ? null : (stamps[at] ?? null);
}
