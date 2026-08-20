// What the timeline deliberately does not draw, and why.
//
// A curated table rather than a reader toggle, and that is a judgement worth defending. The rows here
// are not a matter of taste — they are things nobody playing makes a decision about, so a control for
// them would be a control whose two positions are "correct" and "a taller chart". This app has just
// *lost* a setting for a weaker version of the same reason (the Touch of Karma ceiling, which the
// report turned out to be able to measure), so the bar for adding one is a reader who would genuinely
// answer it differently, and neither of these has one. If that changes, the seam is already here: the
// chart reads these two sets in one place each, and a toggle would only have to supply a different
// set — nothing else in the file would move.
//
// **One table for every spec, not one per spec.** Both entries are *item* effects — the Capacitive
// Primal Diamond and the legendary cloak — so the answer does not vary by who is wearing them, which
// is why this is not keyed by `spec.key` the way `timelineOrder.ts` is. Keying it would duplicate both
// rows and invite a future edit to one copy. It lived under `specs/windwalker/` while the chart did,
// and its wording claimed to be about Windwalkers; it was misfiled rather than wrong.
//
// What is true today and worth saying rather than implying: only the Windwalker's game model declares
// these two auras (`GEAR_PROCS` in `specs/windwalker/lib/index.ts`), so on an Elemental pull the table
// matches nothing and filters nothing. It is inert there, not overreaching, and it would start
// applying unchanged the day that spec models the same gear.
//
// **Hidden, not un-modelled.** Nothing here is removed from any spec or from the analysis. The auras
// are still measured, the counters still built, and the damage still counted — Lightning Strike is
// 4–5% of a Windwalker's output on both reference reports and keeps its place in Damage by Ability.
// It is the *row* that goes, and only from this chart.
//
// Nor is it silent: `hiddenNames` below feeds a line in the chart's caption, so a reader is told what
// was left out instead of being shown a pull that quietly contained less than it did. That is the same
// care the per-enemy lane cap already takes.

import type { AuraLane, CastMark } from '~/lib/types';

/**
 * Aura lanes the chart does not draw, by their key in the drawing spec's game model.
 *
 * Keys and not ids, because the model already owns which ids an aura logs under — Re-Origination has
 * three, and a table of ids would have to be kept in step with a list that is allowed to grow. Both
 * keys below happen to be spelled the same way in any model that declares them, since both name an
 * item rather than an ability.
 */
export const HIDDEN_AURAS: ReadonlySet<string> = new Set([
	// Capacitance — the charge counter on the **Capacitive Primal Diamond**, the legendary meta gem
	// (item 95346). Not the legendary cloak: that is Flurry of Xuen, listed separately below, and the
	// two are easy to conflate because both came out of the same legendary chain. It fires on its own
	// RPPM schedule, adds a charge per landed hit whatever the player does,
	// and empties itself at five without ever being pressed — so the row carries no decision to read
	// against the presses above it, which is the whole job of a lane here. It is also the busiest aura
	// a monk carries by a distance (5,081 events across the boss pulls of one reference report, against
	// 392 for Re-Origination), so it is a lane's worth of height out of an already tall chart in
	// exchange for a shape nobody chose.
	'capacitance',
	// Flurry of Xuen — the legendary cloak, Fen-Yu, Fury of Xuen (item 102248,
	// `sim/common/mop/cloaks_phase_4_54.go:133-136`). Same test as the gem above and the same answer: it
	// procs off landed hits on its own schedule, lasts three seconds, and throws its own strikes without
	// the player choosing anything. A row of it is a record of the cloak's luck, not of the pull.
	//
	// Its strikes are unaffected — they land under 147891, are named in `EXTRA_NAMES`, and keep their
	// place in Damage by Ability. Only the lane goes.
	'flurry-of-xuen',
]);

/**
 * Spell ids the chart does not mark, wherever a mark for one would otherwise be drawn.
 *
 * Consulted in two places, because a spell reaches this chart by two routes: the press lanes, and the
 * payoff marks on a stacking aura's row. Lightning Strike takes only the second — it logs as damage
 * and never as a cast, so it has no press lane on any reference pull — but the set is checked at both
 * so that an id added here disappears from the chart rather than from one half of it.
 */
export const HIDDEN_CASTS: ReadonlySet<number> = new Set([
	// Lightning Strike — what the meta gem above pays out when its counter fills
	// (`sim/common/mop/metagems.go:48`). Listed separately from the aura rather than folded into it, so
	// that the two compose: dropping `capacitance` above brings the charge meter back while this keeps
	// the payoff marks off it. Its damage is untouched and stays in Damage by Ability, where it is a
	// real 4–5% of the pull.
	137597,
]);

/** The lanes worth drawing, in the order they arrived. */
export function drawnLanesOf(lanes: readonly AuraLane[]): AuraLane[] {
	return lanes.filter((lane) => !HIDDEN_AURAS.has(lane.key));
}

/** The presses worth marking, in the order they arrived. */
export function drawnCastsOf(casts: readonly CastMark[]): CastMark[] {
	return casts.filter((cast) => !HIDDEN_CASTS.has(cast.id));
}

/**
 * What was left out, named, so the caption can say it.
 *
 * Names and not keys: the reader is being told which row is missing, and `capacitance` is not what the
 * row would have been labelled. Deduplicated and in the lanes' own order — a per-target aura has a
 * lane per enemy and would otherwise be named once for each of them.
 *
 * Only ever the auras. A hidden *spell* removes marks from a row that is still there, which is not a
 * row the reader can see is missing, and listing "Lightning Strike" beside the lanes would read as a
 * claim that a whole lane went — while on the reference pulls its lane is hidden anyway and naming it
 * twice would be the same absence counted twice.
 */
export function hiddenNames(lanes: readonly AuraLane[]): string[] {
	return [...new Set(lanes.filter((lane) => HIDDEN_AURAS.has(lane.key)).map((lane) => lane.name))];
}
