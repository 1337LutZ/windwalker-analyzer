// The combat-log event stream — the one WarcraftLogs shape that is hand-written, on purpose.
//
// Every other API type in this project is generated from the vendored schema, but `Report.events`
// is declared there as `[JSON]`: the schema says nothing at all about what an event contains, so
// codegen can only produce `unknown`. This file is the missing half of that contract, and it is
// where this codebase's bugs have lived — an `amount` read off an event that carries none, a
// `stack` read off a cast, a spell id read from `abilityGameID` on a payload that nests it under
// `ability.guid`.
//
// So the union discriminates on `type`, and each variant declares only the fields that event really
// carries. Reading `stack` off a cast then stops compiling instead of quietly yielding `undefined`,
// which reads as a zero and prints as a confident wrong number in the report.
//
// Narrow with the helpers in ./guards, never with a bare `e.type === 'damage'`: the catch-all
// variant at the bottom has `type: string`, so a raw comparison cannot exclude it and the field
// still comes out `unknown`.

/** Fields every event carries, whatever its type. */
export interface EventBase {
	/**
	 * Report-relative ms, not epoch and not fight-relative: `fight.startTime` still has to come off
	 * before any of it means anything to a reader.
	 */
	timestamp: number;
	/** Report actor id of whoever caused the event. Absent on a few report-level events. */
	sourceID?: number;
	targetID?: number;
	/**
	 * The spell id, on the v2 event stream. Never read this directly — `abilityIdOf` also accepts
	 * the older nested shape, and a `undefined === 130320` comparison answers "no" for a whole fight
	 * without anything failing.
	 */
	abilityGameID?: number;
	/** The older payload shape for the same number, still returned by some queries. */
	ability?: { guid?: number; name?: string };
	/** The fight this event belongs to, when the query spanned more than one. */
	fight?: number;
}

/** An aura event that carries nothing beyond the base fields. */
type Aura<T extends string> = EventBase & { type: T };

/**
 * A stack event. `stack` is the count that *remains* after the change, not the size of the change,
 * so a drain has to be read as `before - stack`.
 */
type Stacked<T extends string> = EventBase & { type: T; stack: number };

/**
 * A button press. Channel ticks also log as `cast`, under the tick's own id rather than the
 * channel's — counting casts without excluding them turned 12 Fists of Fury channels into 71 casts.
 */
export type CastEvent = EventBase & { type: 'cast' };

/** The start of a cast with a cast time. The `cast` event follows when it completes. */
export type BeginCastEvent = EventBase & { type: 'begincast' };

export type DamageEvent = EventBase & {
	type: 'damage';
	/** Damage dealt, including overkill — summing these runs a few percent above WCL's own total. */
	amount?: number;
	/** 1 = hit, 2 = crit; the miss, dodge and parry outcomes are the codes above it. */
	hitType?: number;
	mitigated?: number;
	/** What the hit would have been before armour and absorbs. */
	unmitigatedAmount?: number;
	absorbed?: number;
};

export type HealEvent = EventBase & {
	type: 'heal';
	amount?: number;
	overheal?: number;
	absorbed?: number;
	hitType?: number;
};

/** A shield eating damage. `sourceID` owns the shield; `attackerID` dealt the blow. */
export type AbsorbedEvent = EventBase & {
	type: 'absorbed';
	amount?: number;
	attackerID?: number;
	/** The damaging ability that was absorbed — `abilityGameID` is the shield itself. */
	extraAbilityGameID?: number;
};

export type ApplyBuffEvent = Aura<'applybuff'>;
/**
 * Re-applying an aura that is already up. WarcraftLogs emits no second `applybuff` for it, so one
 * apply→remove pair can span several applications of the same buff.
 */
export type RefreshBuffEvent = Aura<'refreshbuff'>;
export type RemoveBuffEvent = Aura<'removebuff'>;
export type ApplyDebuffEvent = Aura<'applydebuff'>;
export type RefreshDebuffEvent = Aura<'refreshdebuff'>;
export type RemoveDebuffEvent = Aura<'removedebuff'>;

export type ApplyBuffStackEvent = Stacked<'applybuffstack'>;
export type RemoveBuffStackEvent = Stacked<'removebuffstack'>;
export type ApplyDebuffStackEvent = Stacked<'applydebuffstack'>;
export type RemoveDebuffStackEvent = Stacked<'removedebuffstack'>;

/** An aura dispelled or broken early. `extraAbilityGameID` is what broke it. */
export type AuraBrokenEvent = EventBase & {
	type: 'aurabroken';
	extraAbilityGameID?: number;
};

/**
 * A resource gain or spend.
 *
 * WarcraftLogs emits only a handful of these per fight — nowhere near one per tick — so they cannot
 * be used to reconstruct an energy curve, and any metric that needs one is not answerable from a
 * log.
 */
export type ResourceChangeEvent = EventBase & {
	type: 'resourcechange';
	resourceChange?: number;
	/** Which resource moved: energy, chi, mana … */
	resourceChangeType?: number;
	/** The part of the gain that overflowed a full bar. */
	waste?: number;
};

export interface GearPiece {
	id: number;
	itemLevel?: number;
}

export interface Talent {
	id: number;
	icon?: string;
}

/** One player's state at the pull. */
export type CombatantInfoEvent = EventBase & {
	type: 'combatantinfo';
	/**
	 * TRAP: on Classic reports this is 0 for every player, and `talentTree` comes back empty. It
	 * cannot identify a spec, so anything that needs to know what someone was playing has to infer
	 * it from what they cast — a spec-only ability is the only reliable tell.
	 */
	specID?: number;
	talentTree?: string;
	gear?: GearPiece[];
	talents?: Talent[];
};

export type DeathEvent = EventBase & {
	type: 'death';
	killerID?: number;
	killingAbilityGameID?: number;
};

/**
 * Anything not modelled above.
 *
 * WarcraftLogs emits dozens of event types and adds more without warning, and a fight's event
 * stream has to survive all of them: an unmodelled type lands here with its own fields readable as
 * `unknown` rather than being dropped or throwing. The cost is that `type` is `string` here, which
 * is why narrowing goes through ./guards.
 */
export interface UnmodelledEvent extends EventBase {
	type: string;
	[key: string]: unknown;
}

export type WclEvent =
	| CastEvent
	| BeginCastEvent
	| DamageEvent
	| HealEvent
	| AbsorbedEvent
	| ApplyBuffEvent
	| RefreshBuffEvent
	| RemoveBuffEvent
	| ApplyBuffStackEvent
	| RemoveBuffStackEvent
	| ApplyDebuffEvent
	| RefreshDebuffEvent
	| RemoveDebuffEvent
	| ApplyDebuffStackEvent
	| RemoveDebuffStackEvent
	| AuraBrokenEvent
	| ResourceChangeEvent
	| CombatantInfoEvent
	| DeathEvent
	| UnmodelledEvent;

export type AuraApplyEvent = ApplyBuffEvent | ApplyDebuffEvent;
export type AuraRefreshEvent = RefreshBuffEvent | RefreshDebuffEvent;
export type AuraRemoveEvent = RemoveBuffEvent | RemoveDebuffEvent;
export type StackChangeEvent =
	ApplyBuffStackEvent | RemoveBuffStackEvent | ApplyDebuffStackEvent | RemoveDebuffStackEvent;
/** Everything that moves an aura: the buff and debuff halves are the same bookkeeping. */
export type AuraEvent = AuraApplyEvent | AuraRefreshEvent | AuraRemoveEvent | StackChangeEvent;
