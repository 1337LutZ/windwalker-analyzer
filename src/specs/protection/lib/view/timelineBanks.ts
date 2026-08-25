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
 * Every lane **and every press**, which is what `null` means here — and the estimate under it was wrong.
 *
 * This used to say "a Protection pull draws a dozen rows, and choosing eight of them would hide a button
 * a reader came to look for". That was written before the chart had ever been drawn for this spec: the
 * audit published `lanes: []` and there was no section registered to render them. Measured now, the five
 * committed captures draw **22, 23, 24, 24 and 23** rows — about double the guess.
 *
 * The conclusion survives the correction, but only because of what the alternative does. Setting this to
 * a list does two things and the second is not what a longer chart needs: it keeps the named lanes, and
 * it drops **the press rows entirely** — see `buildRows`, where `summaryKeys === null` is the condition
 * on the whole cast loop. That is right for the Elemental, whose "at a glance" is five auras and no
 * buttons. It is wrong here, where the rows a reader came for are Judgment, Crusader Strike, Avenger's
 * Shield and Consecration, and where the rows that want removing are five particular ones rather than
 * every press on the pull.
 *
 * So the curation is a **denylist beside this rather than an allowlist here**: see
 * `SUMMARY_HIDDEN_ROWS`, which takes off five rows and leaves the other eighteen alone.
 */
export const SUMMARY_LANE_KEYS: readonly string[] | null = null;

/**
 * The rows this spec's summary timeline leaves out, by the name the chart draws them under.
 *
 * **By name and not by key, because half of these are not lanes.** A row on this chart is a lane, a press
 * stream, or both merged — `buildRows` groups on `Row.name` and a `CastMark` carries a name and an id and
 * no ability key at all. `TIMELINE_ROW_ORDER` above is written in the same currency for the same reason,
 * so the two lists a reader compares are in one vocabulary. Grand Crusader is the case that needs it:
 * it is a proc lane *and* a press row under one name, and one entry takes both.
 *
 * All five were read off the drawn chart rather than guessed, and each is out for its own reason.
 *
 *   - **Melee** — 111 to 313 marks per pull, more than any other row and by a wide margin. An
 *     auto-attack is not a press and not a decision; the row is a solid band of ticks that says the
 *     player was in range, which every other row on the chart already says.
 *   - **Weakened Blows** — the per-enemy debuff lanes the audit builds. They belong on the cast log,
 *     where the chart groups them per enemy behind its own picker and a reader is asking which body
 *     carried what; **they are not removed there and must not be.** Here they merge into one row by
 *     name, and what that row shows is a debuff the builders apply as a side effect. Nobody chose it.
 *   - **Grand Crusader** — 6 to 22 procs per pull. The question it answers is whether the Avenger's
 *     Shield under it was pressed, and that is a press-granularity question the cast log is for. At this
 *     grain it is a row of confetti.
 *   - **Synapse Springs** and **Hand of Reckoning** — a glove enchant and a taunt, 1 to 8 and 0 to 18
 *     presses. Neither is rotational. `Hand of Reckoning` is absent from `fallenProtectors.json`
 *     altogether, which is why the count below differs by one on that pull.
 *
 * **What it costs: 22/23/24/24/23 rows become 18/18/19/19/18.** Everything else stays, presses included,
 * which is the whole reason this is a list of five names rather than a switch on `SUMMARY_LANE_KEYS`.
 */
export const SUMMARY_HIDDEN_ROWS: readonly string[] = [
	'Melee',
	'Weakened Blows',
	'Grand Crusader',
	'Synapse Springs',
	'Hand of Reckoning',
];
