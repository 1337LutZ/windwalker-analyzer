// The arithmetic behind the compare page's damage curve, kept out of the component that draws it.
//
// Split from `DpsOverlay` because a module that default-exports a React component must not also
// export a plain function: the Fast Refresh transform can only replace a module whose every export is
// a component, so `rollingDps` sitting beside the chart invalidated the module on each save and cost
// the whole page a reload. The plugin says so by name: "consistent components exports". `DpsSeries`
// could have stayed, since a TypeScript `interface` is erased before the plugin ever sees it, but the
// type and the function that returns it belong together.
//
// It sits beside `resourceCurve.ts`, which is the resource bars' half of the same split, and in
// `charts/` rather than `compare/` because two charts draw from it now: the compare page's overlay and
// the cast log's damage row.

/**
 * The trailing window a point averages over, in seconds.
 *
 * **A drawing decision, which is why it lives here and not in the analysis.** The engine publishes
 * damage per whole second and nothing smoothed, so this number can change without any figure in the
 * report moving: see `DamageAggregate.perSecond`.
 *
 * Fifteen is a trade between two failures a reader can see. Below about ten the line is a picture of
 * critical strikes: one Rising Sun Kick landing in a quiet second draws a spike nobody experienced,
 * and two pulls of identical play look different because their crits fell in different seconds. Much
 * above twenty and a phase change is smeared across the transition, which is most of what anybody
 * reads this chart for.
 */
export const WINDOW_SEC = 15;

/** A pull reduced to what this chart draws. */
export interface DpsSeries {
	points: { x: number; y: number }[];
	durationMs: number;
}

/**
 * Damage per second over the pull, as a trailing mean of the per-second series.
 *
 * **Trailing rather than centred**, because a centred window would let damage that has not happened
 * yet lift the line at a moment the player had not reached: a curve that rises *before* the burst it
 * describes. The cost is that the first seconds average over a partial window; they are divided by
 * the seconds actually elapsed rather than by the full width, so an opener reads at its real rate
 * instead of at a fifteenth of it.
 */
export function rollingDps(perSecond: readonly number[], durationMs: number): DpsSeries {
	const points: { x: number; y: number }[] = [];
	let sum = 0;
	for (let at = 0; at < perSecond.length; at += 1) {
		sum += perSecond[at] ?? 0;
		if (at >= WINDOW_SEC) sum -= perSecond[at - WINDOW_SEC] ?? 0;
		const over = Math.min(at + 1, WINDOW_SEC);
		points.push({ x: at * 1000, y: sum / over });
	}
	return { points, durationMs };
}

/**
 * A round ceiling above the tallest point, so the rules land on numbers a reader can hold.
 *
 * Shared by both charts that draw this curve. Half a power of ten is the step, which keeps the two
 * rules a short row can afford on numbers like 300k and 600k rather than on 287k and 574k.
 */
export function ceilingOf(peak: number): number {
	if (peak <= 0) return 1;
	const step = 10 ** Math.floor(Math.log10(peak));
	return Math.ceil(peak / (step / 2)) * (step / 2);
}
