import { complementOf, intersect, mergeIntervals, type Interval } from '~/lib/analysis/intervals';

/**
 * Splitting the time a section's denominator dropped into the reasons it dropped it — one reason per
 * second, never two.
 *
 * Every chart in the report that shades an exempt stretch draws it in one tone (`EXEMPT` in `./tones`)
 * and names it with one label per *cause*, because the causes are different facts about the pull: the
 * fight taking the target away is nothing the player did, the Fire Elemental holding the one Fire
 * totem slot is the player's own cooldown, and an AoE phase is the player acting correctly against a
 * different priority list. None is a fault and all are uncounted, so they share the colour; only the
 * reasons differ, so they keep their names.
 *
 * **The causes overlap, and that is what this module is for.** An AoE stretch can sit inside an
 * intermission, or straddle its edge. Step 57a already found that two translucent washes stack darker
 * than either — the fix chosen there was one band per stretch rather than lowering the alpha — so a
 * second of pull time must end up on exactly one row. `SearingTotemUptime` worked that out by hand for
 * its two causes; a third cause across four charts would be four more hand-rolled intersections, and
 * the last time a shared idea was drawn three ways it took `exemptTrack.test.ts` to notice.
 */

/** One reason a stretch is out of a denominator: what to call it, and when it applied. */
export interface ExemptCause {
	/** Resolved copy — the row's label and its entry in the key. No sentences live in this module. */
	label: string;
	windows: ReadonlyArray<readonly [number, number]>;
}

/** The same cause with its windows reduced to the seconds no stronger cause had already claimed. */
export interface ExemptRow extends ExemptCause {
	windows: Interval[];
}

/**
 * The causes with every second assigned to exactly one of them, **strongest claim first**.
 *
 * Precedence is the argument order, and it is not the drawing order — a chart may draw the rows in
 * whatever order reads best and still want the intermission to win the overlap. The intermission is
 * the stronger claim than an AoE phase, because "you could not act at all" outranks "you were acting
 * against a different list": a reader who sees AoE grey over a submerge would conclude the list
 * excused them when in fact there was nothing there to press at.
 *
 * Every row is also clipped to `[0, durationMs]`, since a target-count series is padded past the end
 * of the pull (`targetCounts` pads its last point by a window) and a band wider than the timeline it
 * sits in is the bug `complementOf` already carries a note about.
 *
 * What comes back is the same set the causes covered between them, partitioned — so the union of the
 * rows is the union of the inputs, and the assertion `exemptTrack.test.ts` makes about a row being
 * *the array the denominator dropped* survives the split.
 */
export function exemptRows(causes: readonly ExemptCause[], durationMs: number): ExemptRow[] {
	const claimed: Interval[] = [];
	return causes.map(({ label, windows }) => {
		// `complementOf` is bounded by the pull, so it does the clipping too — except on the first cause,
		// where there is nothing claimed yet and the whole pull is free.
		const free: Interval[] = claimed.length === 0 ? [[0, durationMs]] : complementOf(claimed, durationMs);
		const mine = mergeIntervals(intersect(mergeIntervals(windows.map(([a, b]): Interval => [a, b])), free));
		claimed.push(...mine);
		return { label, windows: mine };
	});
}
