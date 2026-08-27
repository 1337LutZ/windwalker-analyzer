// Folding the rows a log keys by spell id into the buttons a player actually pressed.
//
// **A spell id is not an identity, and the compare page is where that stops being harmless.** One
// button logs under several ids — Jab has one per weapon type, `115693` dual-wielding and `115695` on
// a staff — and a report about one player never notices, because one player carries one weapon and so
// produces one of them. Put two players side by side and the same button becomes two rows, each
// reading "not pressed" on the side that used the other id. Two players who both pressed Jab all pull
// were shown as two players who each never pressed it.
//
// `Ability.key` is the identity the game model already carries, and `Registry.abilityByCastId` /
// `abilityByDamageId` are how an id reaches it. Nothing here knows that, though: the caller supplies
// the mapping, so this file stays as spec-free as the rest of `lib/compare`.

/** A row the log keys by spell id. Both damage rows and cast rows are this shape. */
export interface ById {
	id: number;
	name: string;
}

/**
 * How a spell id reaches the button that owns it.
 *
 * Two lookups rather than one, because a log keys a press and its damage differently and often not by
 * the same number: Rushing Jade Wind casts under `116847` and damages under `148187`. A single
 * mapping would have to guess which kind of id it was handed.
 *
 * Either may answer null, which means "no button in the model owns this id" — an unmodelled spell, a
 * trinket proc, a tick. Those keep their own id as their identity and are never folded into anything.
 */
export interface AbilityIdentity {
	cast(id: number): string | null;
	damage(id: number): string | null;
	/**
	 * The button an id belongs to, whichever kind of id it is, for the two things a key cannot answer:
	 * every id it logs a cast under, and whether a character has to be something to have it at all.
	 */
	ability(id: number): { castIds: readonly number[]; gatedBy?: 'race' | 'profession' } | null;
}

/**
 * The mapping, taken from the game model that already holds it.
 *
 * Built by the caller and passed in rather than reached for here, so `lib/compare` keeps knowing
 * nothing about any spec. A `Registry` is not a spec — it is the ability table a spec is assembled
 * from — but the *choice* of which registry is, and that choice belongs to whoever holds the
 * `SpecDefinition`.
 */
export function identityFrom(registry: {
	abilityByCastId(id: number): { key: string; castIds: number[]; gatedBy?: 'race' | 'profession' } | undefined;
	abilityByDamageId(id: number): { key: string; castIds: number[]; gatedBy?: 'race' | 'profession' } | undefined;
}): AbilityIdentity {
	const of = (id: number) => registry.abilityByCastId(id) ?? registry.abilityByDamageId(id);
	return {
		cast: (id) => registry.abilityByCastId(id)?.key ?? null,
		damage: (id) => registry.abilityByDamageId(id)?.key ?? null,
		ability: (id) => {
			const found = of(id);
			return found === undefined ? null : { castIds: found.castIds, gatedBy: found.gatedBy };
		},
	};
}

/**
 * Fold rows sharing an identity into one, in the order their first member appeared.
 *
 * `fold` is handed the row built so far and the next one to absorb, and returns the combination. It is
 * the caller's because the arithmetic is: a damage row sums totals and re-derives its averages, a cast
 * row sums presses and re-derives its rate, and a helper that tried to do both would have to know
 * which it was holding.
 *
 * **Order is preserved from the input**, which matters because the caller has already sorted by
 * something meaningful and a merge that reordered would throw that away. A folded row sits where its
 * first member sat.
 *
 * A row whose identity is null is never folded, and never folds anything into itself. Two unmodelled
 * ids are two unmodelled ids: the model has no basis for saying they are one button, and inventing one
 * is how a page comes to add two unrelated numbers together.
 */
export function mergeRows<T extends ById>(
	rows: readonly T[],
	identify: (row: T) => string | null,
	fold: (into: T, next: T) => T,
): T[] {
	const out: T[] = [];
	const at = new Map<string, number>();
	for (const row of rows) {
		const key = identify(row);
		if (key === null) {
			out.push(row);
			continue;
		}
		const seen = at.get(key);
		if (seen === undefined) {
			at.set(key, out.length);
			out.push(row);
			continue;
		}
		out[seen] = fold(out[seen]!, row);
	}
	return out;
}

/**
 * The identity function for one join, resolved over every row that will take part in it.
 *
 * **A two-pass answer, because a one-pass one splits a button down the middle.** Rising Sun Kick
 * damages under `107428`, which the ability table carries, and under `130320`, which it does not. Key
 * the first by its button and the second by its name and they are two rows with one name — which is
 * the bug the name fallback was added to fix, reappearing on the other side of it.
 *
 * So the names a *modelled* row uses are collected first, and an unmodelled row joins the button that
 * shares its name. Only a row whose name no modelled row claims falls back to standing alone.
 *
 * Built over both lists at once by the caller, so a button the table carries on one side is still
 * recognised on the other.
 */
export function identityIn<T extends ById>(
	rows: readonly T[],
	lookup: (id: number) => string | null,
): (row: T) => string {
	const byName = new Map<string, string>();
	for (const row of rows) {
		const key = lookup(row.id);
		if (key !== null) byName.set(row.name.toLowerCase(), key);
	}
	return (row) => lookup(row.id) ?? byName.get(row.name.toLowerCase()) ?? `name:${row.name.toLowerCase()}`;
}
