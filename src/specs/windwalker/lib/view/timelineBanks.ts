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
import type { TimelineBank, TimelineCounter, TimelineNotes } from '~/lib/view/timelineBanks';
import { TEB_CAP } from '~/specs/windwalker/lib';

/**
 * The lane the brew's spend figures belong to, by its key in this spec's game model.
 *
 * A key and not an id, for the reason the hidden table gives: the model already owns which ids an
 * aura logs under, and a table of ids would have to be kept in step with a list allowed to grow.
 */
const TIGEREYE_BREW_LANE = 'tigereye-brew';

/**
 * A stable nothing, for the same reason the Elemental's `NO_NOTES` is one: nothing here allocates per
 * call, so a caller that does not memoise the answer cannot be punished for it with a chart that
 * rebuilds every bar on every render.
 */
const NO_COUNTERS: TimelineCounter[] = [];

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
 * No bank at all on a pull that banked nothing — an empty curve would draw a flat row claiming a bank
 * nobody measured. **What reaches that return is the cross-spec pull below and not a stale capture**,
 * the mirror of the correction the Elemental's copy of this file carries. This used to say `bankTimeline`
 * "is empty on a report captured before the engine tracked it": the field is declared non-optional on
 * `BrewSummary` and all six committed captures in `__fixtures__` carry a populated one — 98 to 312
 * points — so no fixture is that case, and a capture predating the field would arrive with the key
 * *absent* rather than empty, which the `?? []` covers on the way in.
 *
 * The optional chain guards a field the type promises is there, and what is wrong is the promise — not
 * the context, which is where this used to point. There is no fallback spec any more: `specContext.ts`
 * defaults to `null`, `useSpec` throws rather than guessing, and `Report` keeps the wrong-spec refusal
 * *inside* the provider, so no render path reaches this function without a spec named for the pull.
 * `ReportFlow` derives the analysis from the same spec it provides, so the app pairs the two correctly.
 *
 * The reason that survives is the type. `Analysis` is `AnalysisCore & SpecAuditResult`
 * (`lib/types.ts:1950`) and `SpecAuditResult` is *the Windwalker's* audit shape, so every analysis is
 * typed as carrying `brew` and only a Windwalker pull ever writes one — an Elemental analysis has no
 * such key at runtime. This file is one half of a definition the chart swaps by context, and
 * `components/charts/__tests__/lanesTimeline.test.ts` hands it an analysis carrying the *other* spec's
 * field and not this one, on purpose. `?.` is what makes that a row this spec declines to draw instead
 * of a throw.
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
 * No counter row on this spec's summary timeline — and not because the brew is not one.
 *
 * The bank *is* the same mechanic as the Elemental's shield: it accumulates from procs, holds twenty,
 * and a brew spends ten of it. It could be handed over here as loads, and `counterLoads` would cut its
 * `bankTimeline` the same way it cuts the shield's charge. What stops it is the drawing, not the type:
 * the Windwalker's summary timeline names no lanes, so it draws every lane and every press the pull had
 * — a Tigereye Brew row is already on it, with the stacks each brew spent written into its own bars by
 * `timelineNotes`. A second Lightning-Shield-style row of loads beside it would say the same thing
 * twice and disagree about which bar a spend belongs to.
 *
 * So: empty, deliberately, and the seam is not the reason the brew is not drawn this way.
 */
export function timelineCounters(): TimelineCounter[] {
	return NO_COUNTERS;
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

/**
 * The declared row order for this spec's timeline.
 *
 * Lives with the spec rather than in the shared chart, and reaches it through `SpecDefinition`. It used
 * to sit in `components/charts/timelineOrder.ts` in a table keyed by `spec.key` — no cast and no import,
 * so the convention grep was blind to it, and a third spec meant editing a shared file. That is the rule
 * `SpecDefinition` exists to hold.
 *
 * Shared between the full cast log and the summary timeline, so the two charts lift the same rows in the
 * same order and a row cannot drift between them.
 */
export const TIMELINE_ROW_ORDER: readonly string[] = [
	'Melee',
	'Re-Origination',
	'Tigereye Brew',
	'Energizing Brew',
	'Chi Brew',
	'Jab',
	'Focus of Xuen',
	'Rising Sun Kick',
	'Combo Breaker: Tiger Palm',
	'Tiger Palm',
	'Combo Breaker: Blackout Kick',
	'Blackout Kick',
	'Rushing Jade Wind',
	'Fists of Fury',
	'Touch of Karma',
	'Chi Wave',
	'Zen Sphere',
	'Chi Burst',
	'Expel Harm',
];

/**
 * This spec names no summary lanes, so the summary timeline shows everything it is given.
 *
 * The honest reading for a spec that has not decided what its own "at a glance" is, and the same answer
 * the old `SUMMARY_LANE_KEYS` table gave by having no entry for it.
 */
export const SUMMARY_LANE_KEYS: readonly string[] | null = null;

/**
 * Nothing hidden: this spec's summary timeline draws every row it is handed.
 *
 * The Protection Paladin is the spec this seam was written for and its own list carries the argument.
 * Empty here is a decision rather than a default — a monk's melee row is as uninformative as a
 * paladin's, and the case for taking it off has not been made against this chart the way it was made
 * against that one. See `specs/protection/lib/view/timelineBanks.ts`.
 */
export const SUMMARY_HIDDEN_ROWS: readonly string[] = [];
