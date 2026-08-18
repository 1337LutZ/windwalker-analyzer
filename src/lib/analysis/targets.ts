// How many enemies were being hit, moment by moment.
//
// Every other read of "how many targets was this" in the report is a whole-pull average — the share
// of damage that landed on one enemy — and an average cannot say that a five-minute pull was one
// target for four minutes and six adds for one. These two functions are the per-moment answer, and
// they know nothing about which spec is asking: a hit is a time and an enemy.

import type { Interval } from './intervals';

/** One landed hit: when it landed, and on whom. */
export interface TargetHit {
	t: number;
	target: number;
	/**
	 * Which *copy* of that actor, when the log says.
	 *
	 * WarcraftLogs gives one actor id to an NPC *type*, so every Kor'kron Ironblade stood in front of a
	 * monk on Galakras arrives as the same `target` and they are told apart only by this. Counting on
	 * `target` alone therefore does not count enemies, it counts enemy *kinds*: on the Galakras kill in
	 * `a:6MhZgjyAknFWrYfK` that is 13 against the 45 spawns the player actually landed a hit on, and
	 * every read of "how many things am I fighting" downstream inherited the smaller number.
	 *
	 * Optional because not every caller has one to give — a report old enough not to carry the field,
	 * and the Storm, Earth and Fire audit's `contactHits`, which asks *which* enemy an actor stood on
	 * and wants the id its per-target lanes are labelled with. A hit with no instance buckets as
	 * itself, which is exactly what this did before the field existed.
	 */
	instance?: number;
}

/** One enemy spawn, as a map key: the actor id plus which copy of it this is. */
const spawnOf = (hit: TargetHit): string => `${hit.target}:${hit.instance ?? '-'}`;

/**
 * A step in the count series: from `t` until the next point, this many distinct enemies were being
 * damaged.
 *
 * The same `[t, value]` pair the resource curves carry, because the ladder in `lib/spec/apl.ts` reads
 * those with one binary search (`valueAt`) and a second series in a second shape would need a second
 * reader that could disagree with it.
 */
export type TargetCountPoint = [t: number, count: number];

/**
 * Distinct enemies damaged in the trailing `windowMs`, sampled at every moment the answer changes.
 *
 * A trailing window rather than an instant, because an instant is always one: a monk hits one enemy
 * per swing and per global, so "how many targets is this" asked at a millisecond answers one however
 * many enemies are stood in front of them. The window is what turns a sequence of single hits back
 * into the fact that three enemies were being cycled.
 *
 * Points are emitted only where the count changes, and both edges of the window are sampled — every
 * hit, and every moment a hit ages out — so a count that decays to zero says so at the millisecond it
 * does rather than at the next hit, whenever that is.
 */
export function targetCounts(hits: readonly TargetHit[], windowMs: number): TargetCountPoint[] {
	const sorted = [...hits].sort((a, b) => a.t - b.t);
	if (sorted.length === 0) return [];

	// Every moment the answer can change: a hit entering the window, or the oldest one leaving it.
	const moments = [...new Set(sorted.flatMap((h) => [h.t, h.t + windowMs]))].sort((a, b) => a - b);

	// Counted rather than a set of keys: the same enemy hit twice inside one window is one target, and
	// the second hit must not remove it when the first ages out.
	//
	// Keyed by spawn and not by actor id — see `TargetHit.instance`. This is the map the whole count
	// hangs off, so keying it on the id alone was not a rounding error: it collapsed every add of one
	// kind into a single enemy, and the band the priority ladder judges each press at is read off here.
	const live = new Map<string, number>();
	let entered = 0;
	let left = 0;
	const out: TargetCountPoint[] = [];

	for (const t of moments) {
		while (entered < sorted.length) {
			const hit = sorted[entered];
			if (hit === undefined || hit.t > t) break;
			const spawn = spawnOf(hit);
			live.set(spawn, (live.get(spawn) ?? 0) + 1);
			entered++;
		}
		while (left < entered) {
			const hit = sorted[left];
			// Half-open on the old side: a hit exactly `windowMs` back has stopped counting, which is what
			// makes the series fall to zero at the end of a pull rather than one hit short of it.
			if (hit === undefined || hit.t > t - windowMs) break;
			const spawn = spawnOf(hit);
			const seen = (live.get(spawn) ?? 0) - 1;
			if (seen > 0) live.set(spawn, seen);
			else live.delete(spawn);
			left++;
		}
		const count = live.size;
		if (out[out.length - 1]?.[1] !== count) out.push([t, count]);
	}
	return out;
}

/**
 * A reader for the count at a moment, as a step function.
 *
 * The last point at or before `t`, never an interpolation — the series *is* a step function, and a
 * value between two points is a count nobody was ever fighting. Binary search rather than a scan
 * because the priority ladder asks this once per press, and the same shape as `valueAt` in
 * `spec/apl.ts` for the resource curves.
 *
 * Zero before the first point, which is correct rather than a fallback: the series opens at the first
 * landed hit, and before it the player was fighting nothing.
 */
export function countAt(points: readonly TargetCountPoint[]): (t: number) => number {
	return (t) => {
		let lo = 0;
		let hi = points.length - 1;
		let found = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			const point = points[mid];
			if (point === undefined) break;
			if (point[0] <= t) {
				found = mid;
				lo = mid + 1;
			} else hi = mid - 1;
		}
		return points[found]?.[1] ?? 0;
	};
}

/**
 * The stretches where the count was at least `min`, closed at `endMs`.
 *
 * The series is a step function, so a stretch runs from the point that reached the count to the next
 * point that did not — and the last one runs to the end of the pull, which is the caller's number
 * rather than this function's guess.
 */
export function intervalsAtLeast(points: readonly TargetCountPoint[], min: number, endMs: number): Interval[] {
	const out: Interval[] = [];
	let open: number | null = null;
	for (const [t, count] of points) {
		if (count >= min && open === null) open = t;
		else if (count < min && open !== null) {
			// Clamped to the pull, not just the still-open stretch. `targetCounts` closes the series with
			// a `[lastHit + windowMs, 0]` point, which is up to a window past the end of the fight — so a
			// stretch closed by that point used to be emitted unclamped, and `contactMs` came out longer
			// than the pull it was measured over.
			const close = Math.min(t, endMs);
			if (close > open) out.push([open, close]);
			open = null;
		}
	}
	if (open !== null && endMs > open) out.push([open, endMs]);
	return out;
}
