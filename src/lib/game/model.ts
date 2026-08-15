// The game-object model: what an ability is, what an aura is, and how they relate.
//
// This exists because a combat log is a stream of bare spell ids, and almost every bug in analysing
// one comes from an id being read as the wrong thing. Flat constants — RSK_CAST, RSK_DEBUFF,
// FOF_CHANNEL, FOF_TICK — encode those relationships only in their names, so nothing stops a caller
// pairing the wrong two. Modelling them means the relationship is data the engine can follow:
//
//   ability('rising-sun-kick').applies  ->  aura('rising-sun-kick-debuff')
//   aura('tiger-power').appliedBy       ->  ability('tiger-palm')
//   registry.abilityByCastId(117418)    ->  undefined, because a tick is not a cast
//
// Nothing here is Windwalker-specific. A spec is a list of these objects; see ../spec.

/** What actually limits how often a button can be pressed. Reporting the wrong one invents faults. */
export type Gate =
	/** Held back by its own cooldown, so idle cooldown time is a real loss. */
	| 'cooldown'
	/**
	 * Held back by chi, not by time — an "N of M possible" figure would be meaningless.
	 *
	 * Only the chi *spenders*: Tiger Palm at 1 and Blackout Kick at 2. Jab, Spinning Crane Kick and
	 * Rushing Jade Wind pay 40 energy and *generate* chi, so calling them chi-gated inverts the
	 * economy — they are what fills the bar the other two empty.
	 */
	| 'chi'
	/** Held back by energy, on the same terms: a resource ceiling, not a clock. */
	| 'energy'
	/** Only correct in specific situations; judged against those conditions, never against a cooldown. */
	| 'conditional'
	/** Utility, defensives, consumables: counted, not scored. */
	| 'other';

export type AuraKind = 'buff' | 'debuff';

export interface Aura {
	key: string;
	name: string;
	/**
	 * Every spell id that logs as this aura. More than one when the id encodes what was granted:
	 * Re-Origination uses a different id per stat it converted into, and matching only one of them
	 * silently drops the rest.
	 */
	ids: number[];
	kind: AuraKind;
	/** Full duration. Needed to tell "expired unused" from "consumed early". */
	durationMs?: number;
	maxStacks?: number;
	/** How many stacks a single consumption drains, when that is less than the cap. */
	drainsPerUse?: number;
	/** id -> label, when the id itself carries meaning (which stat, which spec of a shared buff). */
	variants?: Record<number, string>;
	/**
	 * True when re-applying restarts the duration rather than extending it. WarcraftLogs emits
	 * `refreshbuff` rather than a second `applybuff`, so the apply→remove pair it reports can span
	 * several applications: the aura really was up that whole time, but a snapshot taken at the first
	 * application did not survive the second.
	 */
	refreshRestarts?: boolean;
	/** Key of the ability that applies it. Resolved by the registry. */
	appliedBy?: string;
	/** Keys of abilities that spend it. Resolved by the registry. */
	consumedBy?: string[];
}

export interface Channel {
	/**
	 * Ticks log as `cast` under their own id. Counting casts by name therefore multiplies a channel
	 * by its tick count; count the channel by its own id and measure length from the ticks.
	 */
	tickId: number;
	/** Nominal length, before haste. The real length is measured from the tick stream. */
	baseMs?: number;
}

export interface Ability {
	key: string;
	name: string;
	/**
	 * Every id that logs as a `cast` for this button. More than one when the game splits it — Jab
	 * has an id per weapon type, so hard-coding a single one drops every cast for anyone using the
	 * other weapon.
	 */
	castIds: number[];
	/** Ids that log damage for it, which are frequently not the cast id. */
	damageIds?: number[];
	onGcd: boolean;
	gate: Gate;
	cooldownMs?: number;
	/** Present when pressing it locks out every other button for a while. */
	channel?: Channel;
	/** Aura keys this ability applies. */
	/**
	 * Pressed for something other than damage.
	 *
	 * Flying Serpent Kick is the case: it is a movement button that happens to hit, so ranking it
	 * among the rotation's damage sources implies a choice about damage that nobody made. Its damage
	 * is still counted in the totals — it happened — it is just kept out of the comparison.
	 */
	utility?: boolean;
	/**
	 * Pressed off an item rather than out of the spellbook: a potion, a flask, a healthstone, an
	 * on-use trinket, a glove tinker.
	 *
	 * The simulator's own division rather than a category invented here, and it draws the line in one
	 * place both halves agree on — the press is keyed on an **item**, not on a spell. `sim/core/
	 * consumes.go` builds every flask, elixir, combat potion and conjured item as `ActionID{ItemID:
	 * …}` (`registerNonCombatPotion`, `makePotionActivationSpellInternal`, `registerConjuredCD`), and
	 * `RegisterAllOnUseCds` in `sim/common/mop/stat_bonus_cds_auto_gen.go` builds the on-use trinkets
	 * and tinkers through `shared.ActiveStatBonusEffect`, whose own comment calls it "an on-use effect
	 * on an item or an enchant".
	 *
	 * `utility` cannot carry this, in either direction. It answers "was this pressed for something
	 * other than damage", which is equally true of an interrupt, a Roll and a Healthstone — so it
	 * divides the damage rows from everything else and can never divide a consumable from a Leg Sweep.
	 * And an on-use trinket that hits is pressed *for* damage while still being an item, so the two
	 * questions are independent rather than two names for one.
	 */
	onUse?: boolean;
	applies?: string[];
	/** Aura keys this ability spends. */
	consumes?: string[];
	/** Free-text note surfaced in the UI where a number alone would mislead. */
	note?: string;
}

/** A spec's game objects, before the registry indexes them. */
export interface GameData {
	abilities: Ability[];
	auras: Aura[];
}
