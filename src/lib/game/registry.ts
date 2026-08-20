import type { Ability, Aura, GameData } from './model';

/**
 * Indexes a spec's abilities and auras and resolves the links between them.
 *
 * The lookups matter as much as the data. A log is a stream of ids, and the question being asked is
 * always "what is this id, and what does it belong to" — `abilityByCastId` deliberately returns
 * nothing for a channel's tick id, because a tick is not a press, and treating it as one turned 12
 * Fists of Fury channels into 71 casts the first time this was written without a model.
 *
 * Construction validates: an id claimed by two abilities, or a relationship pointing at an aura that
 * does not exist, throws here rather than producing a silently wrong number later.
 */
export interface Registry {
	abilities: Ability[];
	auras: Aura[];
	ability(key: string): Ability;
	aura(key: string): Aura;
	/** The ability a `cast` event belongs to. Undefined for tick ids and anything unmodelled. */
	abilityByCastId(id: number): Ability | undefined;
	/** The ability a `damage` event belongs to, which is often not the cast id. */
	abilityByDamageId(id: number): Ability | undefined;
	auraById(id: number): Aura | undefined;
	/** The variant label an aura id encodes, e.g. which stat a proc converted into. */
	variantOf(id: number): string | undefined;
	/** Auras this ability applies, resolved. */
	appliedBy(abilityKey: string): Aura[];
	/** Auras this ability spends, resolved. */
	consumedBy(abilityKey: string): Aura[];
	/** Every id that should be treated as a press, for GCD accounting. */
	castIds(): Set<number>;
	/** True when the id is a channel tick — logged as a cast, but not one. */
	isChannelTick(id: number): boolean;
}

export function createRegistry(data: GameData): Registry {
	const abilityByKey = new Map<string, Ability>();
	const auraByKey = new Map<string, Aura>();
	const byCastId = new Map<number, Ability>();
	const byDamageId = new Map<number, Ability>();
	const auraIds = new Map<number, Aura>();
	const tickIds = new Set<number>();

	const claim = <T>(map: Map<number, T>, id: number, value: T, what: string) => {
		const existing = map.get(id);
		if (existing && existing !== value) {
			throw new Error(`spell id ${id} is claimed as a ${what} by two different objects`);
		}
		map.set(id, value);
	};

	for (const ability of data.abilities) {
		if (abilityByKey.has(ability.key)) throw new Error(`duplicate ability key: ${ability.key}`);
		abilityByKey.set(ability.key, ability);
		for (const id of ability.castIds) claim(byCastId, id, ability, 'cast');
		for (const id of ability.damageIds ?? []) claim(byDamageId, id, ability, 'damage source');
		if (ability.channel) tickIds.add(ability.channel.tickId);
	}

	for (const aura of data.auras) {
		if (auraByKey.has(aura.key)) throw new Error(`duplicate aura key: ${aura.key}`);
		auraByKey.set(aura.key, aura);
		for (const id of aura.ids) claim(auraIds, id, aura, 'aura');
	}

	// Relationships are declared by key, so a typo would otherwise fail silently as "no aura".
	for (const ability of data.abilities) {
		for (const key of [...(ability.applies ?? []), ...(ability.consumes ?? [])]) {
			if (!auraByKey.has(key)) {
				throw new Error(`ability "${ability.key}" references unknown aura "${key}"`);
			}
		}
	}
	for (const aura of data.auras) {
		for (const key of [aura.appliedBy, ...(aura.consumedBy ?? [])]) {
			if (key !== undefined && !abilityByKey.has(key)) {
				throw new Error(`aura "${aura.key}" references unknown ability "${key}"`);
			}
		}
	}

	// A dot's three numbers have to agree, because two of them are derivable from the third and a
	// mistyped period would otherwise pass as a dot with a different shape — see `Dot.ticks`.
	for (const ability of data.abilities) {
		const dot = ability.dot;
		if (dot === undefined) continue;
		if (dot.ticks < 1 || dot.tickMs < 1 || dot.ticks * dot.tickMs !== dot.durationMs) {
			throw new Error(
				`ability "${ability.key}" declares a dot of ${dot.ticks} × ${dot.tickMs}ms, which is not its ${dot.durationMs}ms duration`,
			);
		}
	}

	// A channel tick that is also registered as a cast id would defeat the whole point of modelling
	// the channel, so refuse it outright.
	for (const id of tickIds) {
		const owner = byCastId.get(id);
		if (owner) {
			throw new Error(`spell id ${id} is a channel tick but is also registered as a cast id on "${owner.key}"`);
		}
	}

	const need = <T>(map: Map<string, T>, key: string, what: string): T => {
		const found = map.get(key);
		if (!found) throw new Error(`unknown ${what}: ${key}`);
		return found;
	};

	return {
		abilities: data.abilities,
		auras: data.auras,
		ability: (key) => need(abilityByKey, key, 'ability'),
		aura: (key) => need(auraByKey, key, 'aura'),
		abilityByCastId: (id) => byCastId.get(id),
		abilityByDamageId: (id) => byDamageId.get(id),
		auraById: (id) => auraIds.get(id),
		variantOf: (id) => auraIds.get(id)?.variants?.[id],
		appliedBy: (key) => (need(abilityByKey, key, 'ability').applies ?? []).map((k) => need(auraByKey, k, 'aura')),
		consumedBy: (key) => (need(abilityByKey, key, 'ability').consumes ?? []).map((k) => need(auraByKey, k, 'aura')),
		castIds: () => new Set(byCastId.keys()),
		isChannelTick: (id) => tickIds.has(id),
	};
}
