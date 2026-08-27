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
 * Where a button sits: its place among the named leaders, then the spec's own, then everything else.
 *
 * **The shared table decides the last tier, and an unmodelled id is not in it.** `SHARED_ABILITIES`
 * is the whole of what belongs to no spec — four racials, the tinker, the flasks, the healthstone —
 * so a button that is *not* on it and that this class pressed is that class's own, whether or not the
 * ability table happens to carry it. Roll, Tiger's Lust and Spear Hand Strike are all unmodelled and
 * all monk buttons; ranking them by the model's silence put them below a flask.
 *
 * So: named, then everything else the spec owns including what the model does not name, then the
 * shared table. A key the spec does not name and the shared table does not hold sits in the middle
 * tier — `rushing-jade-wind`, `expel-harm` — and so does `null`.
 */
export function castRank(key: string | null, order: readonly string[]): number {
	const named = key === null ? -1 : order.indexOf(key);
	if (named !== -1) return named;
	return isShared(key) ? order.length + 1 : order.length;
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
