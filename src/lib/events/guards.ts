// Narrowing helpers for the event union, plus the one defensive read every caller needs.
//
// These exist because the union carries a catch-all variant: `e.type === 'damage'` cannot exclude
// it, so a bare comparison leaves `amount` typed `unknown`. A type predicate can, so every read of
// a type-specific field goes through one of these.

import type {
	AuraApplyEvent,
	AuraEvent,
	AuraRefreshEvent,
	AuraRemoveEvent,
	BeginCastEvent,
	CastEvent,
	CombatantInfoEvent,
	DamageEvent,
	DeathEvent,
	HealEvent,
	ResourceChangeEvent,
	StackChangeEvent,
	WclEvent,
} from './model';

const AURA_APPLY: ReadonlySet<string> = new Set(['applybuff', 'applydebuff']);
const AURA_REFRESH: ReadonlySet<string> = new Set(['refreshbuff', 'refreshdebuff']);
const AURA_REMOVE: ReadonlySet<string> = new Set(['removebuff', 'removedebuff']);
const STACK_CHANGE: ReadonlySet<string> = new Set([
	'applybuffstack',
	'removebuffstack',
	'applydebuffstack',
	'removedebuffstack',
]);

/**
 * The spell id an event belongs to.
 *
 * WarcraftLogs returns `abilityGameID` on the v2 event stream, but the older payload nests the same
 * number under `ability.guid`; accepting both means nothing downstream has to care which one it was
 * handed. Returns null for the events that carry no ability at all (`combatantinfo`, most deaths)
 * rather than a zero, which would compare equal to nothing and silently match nothing.
 */
export function abilityIdOf(e: WclEvent): number | null {
	if (typeof e.abilityGameID === 'number') return e.abilityGameID;
	return typeof e.ability?.guid === 'number' ? e.ability.guid : null;
}

export function isCast(e: WclEvent): e is CastEvent {
	return e.type === 'cast';
}

export function isBeginCast(e: WclEvent): e is BeginCastEvent {
	return e.type === 'begincast';
}

export function isDamage(e: WclEvent): e is DamageEvent {
	return e.type === 'damage';
}

export function isHeal(e: WclEvent): e is HealEvent {
	return e.type === 'heal';
}

export function isAuraApply(e: WclEvent): e is AuraApplyEvent {
	return AURA_APPLY.has(e.type);
}

/** A re-application of a running aura. It opens no new window — see `auraWindows`. */
export function isAuraRefresh(e: WclEvent): e is AuraRefreshEvent {
	return AURA_REFRESH.has(e.type);
}

export function isAuraRemove(e: WclEvent): e is AuraRemoveEvent {
	return AURA_REMOVE.has(e.type);
}

/** Any of the four stack events. `stack` is what remains, so a drain is `before - stack`. */
export function isStackChange(e: WclEvent): e is StackChangeEvent {
	return STACK_CHANGE.has(e.type);
}

/** Every event that moves an aura, buff or debuff, including the stack ones. */
export function isAuraEvent(e: WclEvent): e is AuraEvent {
	return isAuraApply(e) || isAuraRefresh(e) || isAuraRemove(e) || isStackChange(e);
}

export function isCombatantInfo(e: WclEvent): e is CombatantInfoEvent {
	return e.type === 'combatantinfo';
}

export function isDeath(e: WclEvent): e is DeathEvent {
	return e.type === 'death';
}

export function isResourceChange(e: WclEvent): e is ResourceChangeEvent {
	return e.type === 'resourcechange';
}
