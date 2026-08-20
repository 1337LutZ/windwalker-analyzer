// The Windwalker's own counter on the cast log — the Tigereye Brew bank — and what each brew spent.
//
// A view module, not an engine audit: everything here is arithmetic over things `analyse()` already
// published, so nothing can disagree with the Tigereye Brew section it borrows from.
//
// It lives here because the chart no longer does. `CastTimeline` is shared by both specs, and until
// this module existed it reached the bank by casting an `Analysis` to a shape with an optional `brew`
// on it and imported `TEB_CAP` from this spec's engine to scale the row — one spec's ceiling compiled
// into a chart that reads as though it takes any pull.

import type { Analysis } from '~/lib/types';
import type { TimelineBank, TimelineNotes } from '~/lib/view/timelineBanks';
import { TEB_CAP } from '~/specs/windwalker/lib';

/**
 * The lane the brew's spend figures belong to, by its key in this spec's game model.
 *
 * A key and not an id, for the reason the hidden table gives: the model already owns which ids an
 * aura logs under, and a table of ids would have to be kept in step with a list allowed to grow.
 */
const TIGEREYE_BREW_LANE = 'tigereye-brew';

/**
 * The Tigereye Brew bank, as a third resource lane.
 *
 * It behaves like one and is spent like one — it fills from procs, holds twenty, and a brew empties
 * ten of it — so it is read the same way and drawn the same way. The engine already tracks it for the
 * bank chart, so this is the same numbers on a different clock rather than a second count.
 *
 * `TEB_CAP` rather than the pull's observed peak: a bank that never reached twenty still had twenty to
 * reach, and scaling to the peak would draw a half-full bank as a full one. The cap travels with the
 * bank rather than being imported by the chart, which is the point of the seam — the shared chart has
 * no business knowing this spec's number.
 *
 * Drawn in the proc colour and underlined in the brew's, which is the pairing the chart has always
 * had: the row is named for the button and coloured for what fills it.
 *
 * No bank at all on a pull that banked nothing. `bankTimeline` is empty on a report captured before
 * the engine tracked it, and an empty curve would draw a flat row claiming a bank nobody measured.
 * The optional chain guards a field the type promises is there, and it is not for this spec's own
 * reports: a section rendered without a provider reads `SpecContext`'s fallback (see `specContext.ts`),
 * so the deployment default's member can be handed an analysis another spec produced.
 */
export function timelineBanks(analysis: Analysis): TimelineBank[] {
	const banked = analysis.brew?.bankTimeline ?? [];
	if (banked.length === 0) return [];
	return [
		{
			key: 'brew',
			section: 'bank',
			// Copied rather than handed over: `ResourceCurve.points` is a mutable array and this one
			// belongs to the audit.
			curve: { max: TEB_CAP, points: banked.map(([t, n]): [number, number] => [t, n]) },
			tone: 'rune',
			underline: 'brew',
			// Twenty banked stacks is a proc that had nowhere to go, which is the whole argument of the
			// Tigereye Brew section — so the stretches spent there are shaded like any other loss.
			ceilingIsWaste: true,
			// Both directions are worth a number here. A brew is pressed a handful of times in a pull, so
			// the row is nowhere near busy enough for the labels to crowd each other out.
			labelSpendsOnly: false,
		},
	];
}

/**
 * What each brew window spent, for the lane that draws those windows.
 *
 * The lane draws the window; this is what makes it worth looking at. A brew that went out on eight
 * stacks and one that went out on ten are the same bar otherwise.
 *
 * Summed per window rather than assigned, because one window can hold more than one press — a brew
 * used again inside its own duration refreshes the aura and spends a second time, and the bar has to
 * say what the whole window cost.
 */
export function timelineNotes(analysis: Analysis): TimelineNotes {
	const spent = new Map<number, number>();
	for (const use of analysis.brew?.useList ?? []) {
		// A use the engine could not pair with a window has no bar to label — see the audit's own note
		// on why a press can end up without one.
		if (use.window === null) continue;
		spent.set(use.window.start, (spent.get(use.window.start) ?? 0) + use.consumed);
	}
	return new Map([[TIGEREYE_BREW_LANE, spent]]);
}
