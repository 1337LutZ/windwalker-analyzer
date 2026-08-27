// The order a spec's buttons are listed in, wherever a list of them is drawn.
//
// **Three tiers, and the third is the one that matters most.** A cast table sorted by whatever order
// the event stream produced puts a flask between two rotational buttons, which is where the reader is
// looking hardest. Racials, elixirs and the engineering tinker belong to no spec and to no rotation,
// so they go last as a group rather than interleaving with the presses a player is being read on.
//
// The named leaders come first, in the order the spec declares them, because a rotation has a shape a
// player already thinks in: Jab makes chi, Tiger Palm and Blackout Kick spend it, Rising Sun Kick and
// Fists of Fury are the cooldowns it is spent on. That order is editorial and belongs to the spec, the
// way `timelineRowOrder` does — the same argument, and the same home.

import { SHARED_ABILITIES } from '~/lib/game/shared';

/** Every button that belongs to no spec: the racials, the tinker, the flasks and the healthstone. */
const SHARED_KEYS: ReadonlySet<string> = new Set(SHARED_ABILITIES.map((ability) => ability.key));

/** Whether a button belongs to no spec, so it sorts after everything that does. */
export const isShared = (key: string | null): boolean => key !== null && SHARED_KEYS.has(key);

/**
 * Where a button sits: named leaders, then the spec's own, then what the model cannot place, then the
 * buttons that belong to no spec at all.
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
 * `SHARED_ABILITIES` is the whole of what belongs to no spec, so it is the only thing that puts a
 * button in the last tier. A key that is neither named nor shared is one of that spec's own.
 */
export function castRank(key: string | null, order: readonly string[]): number {
	if (key === null) return order.length + 1;
	const named = order.indexOf(key);
	if (named !== -1) return named;
	return isShared(key) ? order.length + 2 : order.length;
}

/**
 * A comparator over anything that can name its button, stable within a tier.
 *
 * Stable rather than alphabetical inside a tier: the list arrives in an order the analysis chose, and
 * re-sorting a tier by name would throw that away for no reading anyone asked for.
 */
export function byCastOrder<T>(keyOf: (row: T) => string | null, order: readonly string[]): (a: T, b: T) => number {
	return (a, b) => castRank(keyOf(a), order) - castRank(keyOf(b), order);
}
