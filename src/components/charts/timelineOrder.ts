/**
 * The two helpers that read a spec's declared timeline row order.
 *
 * The orders themselves live with the specs that own them, on `SpecDefinition`, and no longer in a table
 * here keyed by `spec.key`. That table carried nineteen Windwalker and fourteen Elemental ability names
 * inside `components/charts/` with no cast and no import, so the convention grep could not see it and a
 * third spec meant editing a shared file — the rule `SpecDefinition` exists to hold.
 *
 * Shared between the full cast log and the summary timeline, so the two charts lift the same rows in the
 * same order and a row cannot drift between them.
 */

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
