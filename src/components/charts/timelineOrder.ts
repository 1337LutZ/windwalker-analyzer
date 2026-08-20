/**
 * The declared row order for each spec's timeline, and the two helpers that read it.
 *
 * Shared between the full cast log and the summary timeline, so the two charts lift the same rows in
 * the same order and a row cannot drift between them.
 */

const WINDWALKER_ROW_ORDER: readonly string[] = [
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

/** The Elemental's own order: the shock, the raid cooldown, the off-GCD cooldowns, the dot, the
 * fire-and-forget totem, the two-piece, the summons, the filler, the proc and the button it frees.
 * Lightning Shield is not a row — it is a counter, drawn above the rows like the Tigereye Brew bank. */
const ELEMENTAL_ROW_ORDER: readonly string[] = [
	'Melee',
	'Earth Shock',
	'Stormlash Totem',
	'Ascendance',
	'Lightning Shield',
	'Elemental Mastery',
	'Flame Shock',
	'Searing Totem',
	'Elemental Discharge',
	'Fire Elemental',
	'Earth Elemental',
	'Lightning Bolt',
	'Lava Surge',
	'Lava Burst',
];

/** The declared row order per spec key; a spec without one keeps the order the engine produced. */
export const ROW_ORDERS: Readonly<Record<string, readonly string[]>> = {
	windwalker: WINDWALKER_ROW_ORDER,
	elemental: ELEMENTAL_ROW_ORDER,
};

/**
 * The lane keys the summary timeline ("the pull, end to end") shows, by spec key.
 *
 * The summary is not the cast log: it is the handful of rows the pull actually turned on — the
 * cooldowns, the dot, and the procs that gated the rotation — so a spec names the lanes that belong
 * there and everything else is left out, presses included. A spec without an entry shows everything,
 * which is the honest reading for one that has not yet decided what its own "at a glance" is. The
 * Elemental's own counter, Lightning Shield, is not a lane and is drawn beside it by the section.
 */
export const SUMMARY_LANE_KEYS: Readonly<Record<string, readonly string[]>> = {
	elemental: ['ascendance', 'stormlash-totem', 'flame-shock', 'searing-totem', 't16-2pc-debuff'],
};

/** A stable empty order, so `ROW_ORDERS[spec.key] ?? EMPTY_ROW_ORDER` never hands a memo a fresh array. */
export const EMPTY_ROW_ORDER: readonly string[] = [];

/** Where a row sits in the declared order — the earliest entry any of its names answers to. */
export const rowRank = (names: readonly string[], rowOrder: readonly string[]): number => {
	let best = rowOrder.length;
	for (const name of names) {
		const at = rowOrder.indexOf(name);
		if (at !== -1 && at < best) best = at;
	}
	return best;
};

/** Whether the declared order names this row at all — everything else keeps the order it had. */
export const led = (names: readonly string[], rowOrder: readonly string[]): boolean =>
	rowRank(names, rowOrder) < rowOrder.length;
