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
	'Avenger’s Shield',
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
	'Light’s Hammer',
	'Holy Prism',
];

/**
 * Every lane, which is what `null` means here.
 *
 * The other two specs curate this because their timelines are long enough to need it. A Protection
 * pull draws a dozen rows, and choosing eight of them would hide a button a reader came to look for.
 */
export const SUMMARY_LANE_KEYS: readonly string[] | null = null;
