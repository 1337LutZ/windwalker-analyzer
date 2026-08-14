import type { Interval } from './intervals';

/**
 * Stretches during which the player was actually hitting the target.
 *
 * Bosses go untargetable through intermissions, and a debuff that "drops" because nothing could be
 * hit is not a mistake. Derive the engaged windows from gaps in the player's own damage to that
 * target: anything longer than `gapMs` splits one window from the next. Each window ends at its
 * last hit rather than at the start of the gap, so the untargetable stretch is excluded from both
 * ends.
 */
export function engagedWindows(hitTimes: readonly number[], gapMs = 15000): Interval[] {
	const times = [...hitTimes].sort((a, b) => a - b);
	const first = times[0];
	if (first === undefined) return [];

	const out: Interval[] = [];
	let segStart = first;
	let prev = first;
	for (const t of times) {
		if (t - prev > gapMs) {
			out.push([segStart, prev]);
			segStart = t;
		}
		prev = t;
	}
	out.push([segStart, prev]);
	return out;
}
