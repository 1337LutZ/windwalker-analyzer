// What this spec draws above and among the rows of a timeline, and in what order.
//
// Three of the four hooks answer empty, and that is a real answer rather than a stub. A bank is a
// resource curve drawn above the lanes and a counter is a stacking thing drawn among them; Protection
// has neither yet. Its holy power is a five-point bar the generic resource section already draws, and
// nothing in the rotation stacks the way Tigereye Brew or Lightning Shield does.
//
// The row order is not empty, because it is the one of the four that costs nothing to be right about:
// a reader scanning a Paladin's timeline wants the generators together, in ladder order, with the
// spenders under them.

import type { Analysis } from '~/lib/types';
import type { TimelineBank, TimelineCounter, TimelineNotes } from '~/lib/view/timelineBanks';

/** No bank. Holy power is drawn by the generic resource section, off `resources.holyPower`. */
export function timelineBanks(_analysis: Analysis): TimelineBank[] {
	return [];
}

/** No counter row. Nothing in this rotation stacks the way the other two specs' counters do. */
export function timelineCounters(_analysis: Analysis): TimelineCounter[] {
	return [];
}

/** No lane carries a figure written into its bars. */
export function timelineNotes(): TimelineNotes {
	return new Map();
}

/**
 * The order the timeline lifts this spec's rows into, by ability name.
 *
 * The ladder's own order for the generators, because that is the order a reader is checking them
 * against — the priority list is the thing every other section argues from. The spenders follow,
 * since neither costs a global and neither can be the reason a generator was late. The cooldowns
 * come last: they are pressed a handful of times and a row that fires three times does not want to
 * sit above one that fires forty.
 */
export const TIMELINE_ROW_ORDER: readonly string[] = [
	"Avenger's Shield",
	'Judgment',
	'Holy Wrath',
	'Consecration',
	'Hammer of Wrath',
	'Hammer of the Righteous',
	'Crusader Strike',
	'Shield of the Righteous',
	'Word of Glory',
	'Eternal Flame',
	'Sacred Shield',
	'Avenging Wrath',
	'Holy Avenger',
	'Execution Sentence',
	"Light's Hammer",
	'Holy Prism',
];

/**
 * No lane allowlist. The cut this spec makes is by row *name*, one declaration below.
 *
 * `SUMMARY_LANE_KEYS` names lanes and drops **every press row with them** — the condition in `buildRows`
 * is on the whole cast loop — which would leave a Paladin's chart with its auras and none of Judgment,
 * Crusader Strike or Avenger's Shield. That is the Elemental's answer and it is the wrong one here, where
 * half the rows a reader came for are buttons.
 */
export const SUMMARY_LANE_KEYS: readonly string[] | null = null;

/**
 * The rows this spec's summary timeline draws, in the order it draws them — and `null` for a spec that
 * draws every row it has.
 *
 * **A name allowlist, which is a third thing from the two cuts that were here before it.**
 * `SUMMARY_LANE_KEYS` keeps named *lanes* and drops every press with them, which is right for a spec
 * whose "at a glance" is five auras and no buttons. The denylist this replaces kept everything and named
 * what to remove, which held while the list of unwanted rows was shorter than the list of wanted ones.
 * On a Paladin it stopped being: the reader's own list is sixteen rows against the thirty this chart had
 * grown to, and a denylist of fourteen names would have to be re-argued every time an aura was declared.
 *
 * So the currency stays row *names* — a row here is a lane, a press stream, or both merged under one
 * name, and only a name can say one thing about all three — and the direction flips. Two consequences
 * worth stating because they are the reasons this is not simply a shorter list:
 *
 *   - **A row that is not named is not drawn, including one nobody has thought about yet.** That is the
 *     property the denylist could not have. Declaring an aura no longer changes this chart.
 *   - **This list is also the order.** `TIMELINE_ROW_ORDER` still ranks the cast log, where every row is
 *     drawn and the generators want to sit together; here the reader named a sequence and it is the one
 *     they get. See `buildRows`, which ranks against this list when a spec supplies one.
 *
 * Righteous Fury sits at the bottom on the reader's own instruction: it is the tanking stance, up for
 * the whole pull, and a bar that never changes is a legend rather than a measurement.
 */
export const SUMMARY_ROW_NAMES: readonly string[] | null = [
	'Judgment',
	'Holy Wrath',
	'Consecration',
	'Hammer of the Righteous',
	'Crusader Strike',
	'Shield of the Righteous',
	'Sacred Shield',
	'Avenging Wrath',
	'Holy Avenger',
	"Avenger's Shield",
	'Bastion of Glory',
	"Light's Hammer",
	'Divine Protection',
	'Devotion Aura',
	'Ardent Defender',
	'Righteous Fury',
];

/**
 * The order the cast lists put this spec's buttons in — see `lib/view/castOrder`.
 *
 * The rotation's own shape: the two builders first, then the three buttons that come off cooldown to
 * be spent on, then Shield of the Righteous as what the holy power they generate is spent on.
 *
 * Editorial, like the other two, and deliberately short: everything else the spec owns still sorts
 * ahead of the racials and the consumables without being named here.
 */
export const CAST_ORDER: readonly string[] = [
	'crusader-strike',
	'hammer-of-the-righteous',
	'judgment',
	'avengers-shield',
	'consecration',
	'shield-of-the-righteous',
];
