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

/**
 * One resource bar as it stood at the instant of an event, *before* the event spent anything.
 *
 * WarcraftLogs only attaches these when the events query passes `includeResources: true` — see
 * fightEvents.graphql. They are the only way to reconstruct a resource curve from a MoP log: the
 * `resourcechange` stream carries a couple of dozen events on a five-minute pull and no passive
 * regen at all, while these arrive around three times a second.
 */
export interface ClassResource {
	/**
	 * The bar's level at this event, before `cost` is taken off it. Reading it as post-spend puts
	 * every cast a full ability cost too high and turns spending into capping.
	 */
	amount: number;
	/** The ceiling, as the game had it at that moment — so a talent that widens the bar is free. */
	max: number;
	/** WoW's power type. Energy is 3 and chi is 12 — see `POWER_TYPE` in ~/lib/analysis/energy. */
	type: number;
	/** What this event spent from this bar. Present on every energy cast; absent means it spent none. */
	cost?: number;
}

/**
 * The half of an event that says whose bars these were.
 *
 * Mixed into the event types that actually carry it rather than into `EventBase`, for the same
 * reason `amount` is not on `EventBase`: a field declared on every event is a field that reads as
 * `undefined` on the ones that never had it, and `undefined` is what this codebase's bugs are made
 * of. Aura events, deaths and `combatantinfo` carry no resources at all.
 */
export interface ResourceSampled {
	/** Report actor id the bars belong to — not always the source, on a pull with pets in it. */
	resourceActor?: number;
	classResources?: ClassResource[];
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
export type CastEvent = EventBase & ResourceSampled & { type: 'cast' };

/** The start of a cast with a cast time. The `cast` event follows when it completes. */
export type BeginCastEvent = EventBase & { type: 'begincast' };

export type DamageEvent = EventBase &
	ResourceSampled & {
		type: 'damage';
		/** Damage dealt, including overkill — summing these runs a few percent above WCL's own total. */
		amount?: number;
		/**
		 * True on periodic damage: a damage-over-time tick rather than a hit that was landed.
		 *
		 * The distinction decides whether a stretch of a fight counts as engaged. A DoT keeps ticking on
		 * a boss nobody can reach, so treating a tick as evidence of contact bridges a real intermission —
		 * measured on one pull, three Blackout Kick ticks arriving while the player was incapacitated cut
		 * a 17.8s gap to 13.9s and hid it under the 15s threshold entirely.
		 */
		tick?: boolean;
		/** 1 = hit, 2 = crit; the miss, dodge and parry outcomes are the codes above it. */
		hitType?: number;
		mitigated?: number;
		/** What the hit would have been before armour and absorbs. */
		unmitigatedAmount?: number;
		absorbed?: number;
	};

export type HealEvent = EventBase &
	ResourceSampled & {
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
 * An *explicit* resource gain or spend — a Chi Brew, an Energizing Brew tick, a talent refund.
 *
 * These are not the energy curve and never were. MoP logs one of these only when something other
 * than passive regen moves a bar, which on a five-minute Windwalker pull is around twenty events,
 * all of them Energizing Brew ticks. The curve comes from `classResources` on ordinary casts,
 * damage and heals — see `ClassResource` above — which is a different field, arriving three times a
 * second, and only when the query asks for it.
 *
 * These stay modelled because `waste` is a fact nothing else carries: it is the part of a *gain*
 * that hit a full bar, which is overcapping measured by WarcraftLogs itself rather than derived.
 */
export type ResourceChangeEvent = EventBase &
	ResourceSampled & {
		type: 'resourcechange';
		resourceChange?: number;
		/** Which resource moved: energy, chi, mana … The same power-type numbers `ClassResource` uses. */
		resourceChangeType?: number;
		/** The bar's ceiling for `resourceChangeType`, so `waste` can be read against something. */
		maxResourceAmount?: number;
		/**
		 * The second bar a single event moved, when it moved two — a spender that pays energy and
		 * returns chi logs one event, not two. Which bar it refers to is not stated separately, so this
		 * is only ever safe to read alongside `classResources`, which names every bar it carries.
		 */
		otherResourceChange?: number;
		/** The part of the gain that overflowed a full bar. */
		waste?: number;
	};

/**
 * One equipped item, as `combatantinfo` reports it.
 *
 * Everything past `id` is optional because an empty slot is still an entry: it arrives as `id: 0`
 * with nothing else, so an off-hand nobody filled and a tabard nobody wore both appear in the array.
 */
export interface GearPiece {
	id: number;
	itemLevel?: number;
	/** WoW's rarity scale: 4 is epic, 5 legendary. Used for the colour beside the icon. */
	quality?: number;
	/** The icon file name, e.g. `inv_helmet_plate_raidwarrior.jpg` — the same source as spell icons. */
	icon?: string;
	gems?: GearPiece[];
	/** Enchant id, absent when the slot carries none. */
	permanentEnchant?: number;
	onUseEnchant?: number;
	setID?: number;
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
	| ApplyBuffStackEvent
	| RemoveBuffStackEvent
	| ApplyDebuffStackEvent
	| RemoveDebuffStackEvent;
/** Everything that moves an aura: the buff and debuff halves are the same bookkeeping. */
export type AuraEvent = AuraApplyEvent | AuraRefreshEvent | AuraRemoveEvent | StackChangeEvent;
