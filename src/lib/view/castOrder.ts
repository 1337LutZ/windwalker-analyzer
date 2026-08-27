// The order a spec's buttons are listed in, wherever a list of them is drawn.
//
// **Four tiers, and the last is the one that matters most.** A cast table sorted by whatever order
// the event stream produced puts a flask between two rotational buttons, which is where the reader is
// looking hardest. Racials, elixirs, potions and the engineering tinker belong to no rotation, so they
// go last as a group rather than interleaving with the presses a player is being read on — the potion
// a spec files in its own table included, because the stat on it is no reason to rank it as rotation.
//
// The named leaders come first, in the order the spec declares them, because a rotation has a shape a
// player already thinks in: Jab makes chi, Tiger Palm and Blackout Kick spend it, Rising Sun Kick and
// Fists of Fury are the cooldowns it is spent on. That order is editorial and belongs to the spec, the
// way `timelineRowOrder` does — the same argument, and the same home.

import type { Ability } from '~/lib/game/model';
import { SHARED_ABILITIES } from '~/lib/game/shared';

/** Every button that belongs to no spec: the racials, the tinker, the flasks and the healthstone. */
const SHARED_KEYS: ReadonlySet<string> = new Set(SHARED_ABILITIES.map((ability) => ability.key));

/** Whether a button belongs to no spec, so it sorts after everything that does. */
export const isShared = (key: string | null): boolean => key !== null && SHARED_KEYS.has(key);

/**
 * The keys that close a list: everything belonging to no spec, plus every press that comes from an item.
 *
 * **Which registry holds a button is not what a reader is sorting by.** Virmen's Bite lives in the
 * Windwalker's own table on purpose — its stat is agility, so no other spec wants it — and that put a
 * potion above Energizing Brew, Chi Brew and Invoke Xuen. Elemental and Protection each keep their own
 * potion for the same reason and inherit the same fault. A reader scanning a cast list for the buttons
 * a pull turned on does not care whose table a potion is filed under.
 *
 * `Ability.onUse` is the line already drawn, and its docblock argues it at length: the press is keyed
 * on an **item** rather than on a spell, which is wowsims' own division and covers the flasks, the
 * elixirs, the combat potions, the conjured items and the on-use tinkers. Racials are not `onUse`, so
 * they close the list by being shared rather than by being items, which is the right reason for each.
 */
export function lastTierKeys(abilities: readonly Pick<Ability, 'key' | 'onUse'>[]): ReadonlySet<string> {
	const keys = new Set(SHARED_KEYS);
	for (const ability of abilities) if (ability.onUse === true) keys.add(ability.key);
	return keys;
}

/**
 * Where a button sits: named leaders, then the spec's own, then what the model cannot place, then the
 * buttons that close the list.
 *
 * **Four tiers, because "unmodelled" turned out to be two different things.** Roll and Spear Hand
 * Strike are monk buttons the ability table does not carry; Goblin Glider and Nitro Boosts are items
 * anyone can press. Both arrive with no key, so no lookup separates them — but ranking them with the
 * spec put a glider above Energizing Brew, and ranking them with the flasks put Roll below one.
 *
 * A tier of their own settles it without inventing a fact about either: everything the spec actually
 * models — which is every cooldown a reader is looking for, the defensives included — sorts above
 * anything the model has nothing to say about, and the racials and consumables still close the list.
 *
 * A named leader is ranked before `last` is consulted, so a spec that wants an on-use trinket among its
 * leaders says so in `castOrder` and gets it.
 */
export function castRank(key: string | null, order: readonly string[], last: ReadonlySet<string>): number {
	if (key === null) return order.length + 1;
	const named = order.indexOf(key);
	if (named !== -1) return named;
	return last.has(key) ? order.length + 2 : order.length;
}

/**
 * A comparator over anything that can name its button, stable within a tier.
 *
 * Stable rather than alphabetical inside a tier: the list arrives in an order the analysis chose, and
 * re-sorting a tier by name would throw that away for no reading anyone asked for.
 */
export function byCastOrder<T>(
	keyOf: (row: T) => string | null,
	spec: { castOrder: readonly string[]; registry: { abilities: readonly Ability[] } },
): (a: T, b: T) => number {
	// Built once per sort rather than once per comparison: a set rebuilt inside the comparator would be
	// O(abilities) on every pair, and a twenty-four row list compares far more often than it looks.
	const last = lastTierKeys(spec.registry.abilities);
	return (a, b) => castRank(keyOf(a), spec.castOrder, last) - castRank(keyOf(b), spec.castOrder, last);
}
