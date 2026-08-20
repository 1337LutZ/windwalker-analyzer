import { mergeIntervals } from './intervals';
import type { Window } from '~/lib/types';

/**
 * Derivations over a stacking counter — the questions every such mechanic asks.
 *
 * Tigereye Brew and Lightning Shield are one mechanic in two costumes: a counter that accumulates to a
 * cap, is spent whole by a press, wastes generation while sitting at the ceiling, and can be lost
 * unspent. Both specs asked those questions and both wrote their own answers.
 *
 * **These are deliberately not `cappedOf` / `emptiedOf` in `components/charts/capped.ts`, and the
 * difference is not stylistic.** Those walk *pairs of adjacent readings* and need both ends of a pair at
 * the ceiling, which is the right conservative reading for a bar the log only *samples*: energy and mana
 * arrive a few readings a second and what happened between two of them is unknown. A counter is not
 * sampled — it moves on events, and a level holds until the next one. On such a series the pair walk
 * misses nearly everything, because the reading *after* a counter sits at its cap is the spend that
 * emptied it: one reading at the cap, never two. Folding the two semantics together would quietly move
 * every energy and chi figure in the Windwalker report, which is why there are two functions and this
 * paragraph.
 */

/**
 * One stretch a counter held a level for.
 *
 * Stretches rather than a `[t, level]` point series, and that is load-bearing. A counter aura's series
 * has *gaps* — the shield falls off, nothing holds a level, and the next entry begins some seconds later
 * — so a walk that inferred each stretch's end from the next entry's start would silently run a 3-second
 * window at the ceiling across a 40-second absence. That was a real bug in the first draft of this file.
 *
 * `AuraLevel` from `./auras` already has this shape, which is why the Elemental passes its levels
 * straight in. A gapless `[t, level]` series — `trackStackBank`'s timeline, where zero is a reading
 * rather than an absence — would need converting first, and nothing needs that yet.
 */
export interface CounterStretch {
	start: number;
	end: number;
	level: number;
}

/**
 * A gapless `[t, level]` series as stretches, each running to the next entry and the last to `durationMs`.
 *
 * For a counter that always holds *some* level — a bank or a charge counter, where zero is a reading
 * rather than an absence. Do **not** use it on an aura's levels: those have gaps, and this would paper
 * over them by running a stretch across the absence.
 *
 * The series must already record one entry per *change* (as `trackStackBank` and the Chi Brew walk both
 * do), or a level that holds across several identical entries comes back as several stretches. They
 * merge in `counterWindows` anyway, so the result is the same — it is just more work.
 */
export function stretchesFromPoints(
	points: ReadonlyArray<readonly [number, number]>,
	durationMs: number,
): CounterStretch[] {
	const out: CounterStretch[] = [];
	for (let i = 0; i < points.length; i += 1) {
		const point = points[i];
		if (point === undefined) continue;
		const end = Math.min(points[i + 1]?.[0] ?? durationMs, durationMs);
		if (end > point[0]) out.push({ start: point[0], end, level: point[1] });
	}
	return out;
}

/**
 * The stretches whose level satisfied `holds`, merged, optionally forgiving a grace at the start of each.
 *
 * `leewayMs` comes off the *front* of every merged stretch and the tail is what gets reported, because
 * the question a reader is asking is "how long was it stuck there after I had a fair chance to spend
 * it". A counter that touches its ceiling for half a second between two presses is not a mistake anyone
 * could have avoided; one that sits there for nine seconds is.
 *
 * Merged before the grace is applied, not after: two adjacent qualifying stretches are one stretch the
 * player sat through, and charging each its own grace would forgive twice over.
 */
export function counterWindows(
	stretches: readonly CounterStretch[],
	holds: (level: number) => boolean,
	leewayMs = 0,
): Window[] {
	const raw = stretches.filter((s) => holds(s.level) && s.end > s.start).map((s): [number, number] => [s.start, s.end]);

	return mergeIntervals(raw).flatMap(([start, end]) => {
		const over = end - start - leewayMs;
		return over > 0 ? [{ start: end - over, end }] : [];
	});
}

/** The stretches a counter sat at or above its cap — generation with nowhere to go. */
export function atCapWindows(stretches: readonly CounterStretch[], cap: number, leewayMs = 0): Window[] {
	return counterWindows(stretches, (level) => level >= cap, leewayMs);
}
