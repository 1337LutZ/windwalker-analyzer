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
	/**
	 * Held back by holy power, and the same argument the chi one makes about which half of the economy
	 * a button is on.
	 *
	 * Only the *spenders*: Shield of the Righteous at a flat three, Word of Glory and Eternal Flame at
	 * a variable one. Every generator is on `cooldown` — Crusader Strike, Judgment, Avenger's Shield —
	 * because what limits those is a timer and calling them holy-power-gated inverts the loop.
	 *
	 * Neither spender is on the global for Protection, which is why this can never be the reason a
	 * generator was late: `sim/paladin/shield_of_the_righteous.go` gives its cast config no `GCD` at
	 * all, and Word of Glory takes `GCD: TernaryDuration(isProt, 0, GCDDefault)`.
	 */
	| 'holy-power'
	/** Only correct in specific situations; judged against those conditions, never against a cooldown. */
	| 'conditional'
	/** Utility, defensives, consumables: counted, not scored. */
	| 'other';

/**
 * One button's whole relationship to the enemy count, in one declaration.
 *
 * **This exists because the same question used to be answered in three unrelated shapes, with three
 * different keyings, in two files** — `AplRule.bands` keyed by rung, `SpecConfig.aplTargetCountExclude`
 * keyed by ability key, and `AplInputs.unarbitrated` keyed by raw cast id. Three statements about one
 * subject is how a rule gets declared against an ability and silently misses the reader keyed the other
 * way, and one of the three was worse than that: `aplTargetCountExclude` sat on `SpecConfig` rather than
 * on the spec definition, so `getSpec('elemental')?.aplTargetCountExclude` was always `undefined` — a
 * test written against it would have passed forever.
 *
 * **Deliberately not here: the ladder's band scope.** That belongs to a *rung*, not to a button, and one
 * button can hold several rungs at different scopes — Rushing Jade Wind is `bands: [2, 3, 4]` where it
 * opens the list and unbanded where it fills, under one ability id. Folding scope up to the ability
 * would collapse the two and delete the structure that says the wind both opens and fills.
 *
 * Every field is optional and absent means the ordinary case, so a spec declares only what is unusual
 * about a button and a new spec inherits the defaults without writing anything.
 */
export interface AbilityTargeting {
	/**
	 * `false` when this button's own damage may not be used to establish how many enemies were up.
	 *
	 * The ladder's count, not the evidence count. Without it a spell that fans out reports its own
	 * fan-out as the fight's enemy count and then recommends more of itself — "the wind hit three, so
	 * press more wind". It is **not** a claim the enemies were imaginary: the evidence series still sees
	 * them, because a spec's area damage landing on an add is proof the add was there.
	 */
	establishesCount?: false;
	/**
	 * Judge this press here rather than arbitrating it against the priority list.
	 *
	 * Names an audit on the analysis — `'sef'`, `'karma'` — for a button whose correctness is not a
	 * rotational condition and so is not a thing a filler rung can read. Storm, Earth and Fire is judged
	 * by where its clones went; Touch of Karma by the damage that was incoming. A ladder asked to
	 * arbitrate either one answers confidently and wrongly, and the rung it names moves with the band.
	 */
	judgedBy?: string;
	/**
	 * What this button gets out of extra enemies — see `MultiTargetBenefit`.
	 *
	 * Absent means `'damage'`, which is the honest default: an ability that says nothing about a
	 * hit-count trigger does not have one, and a button that hit four things for no damage hit nothing.
	 * Declaring it wrong is the failure mode to watch, in one direction only — marking a damage ability
	 * `'trigger'` puts immune units back into its fan-out and its ladder band.
	 */
	multiTargetBenefit?: MultiTargetBenefit;
	/**
	 * This button lands on the one body the player chose, so a hit from it is evidence they fought it.
	 *
	 * **The discriminator between a body a player fought and one their area damage happened to touch.**
	 * A pull's enemy list is full of things nobody chose — an immune mine a spinning kick swept, an
	 * Alliance NPC standing where a fan-out landed — and the difference decides whether an add belongs in
	 * the enemy count and whether an exclusion row is honest.
	 *
	 * Declared per ability rather than measured per hit, and that is the measured choice rather than the
	 * convenient one. Every damage event carries `isAoE`, which looks like the same signal and is not:
	 * it describes the **instant**, not the button, so Rushing Jade Wind comes back `isAoE: false` on the
	 * ticks that happened to find one body. Across four pulls and 6 192 events, `!isAoE` overcounts the
	 * ability list by 87%, and 53 of 96 spawns collect a non-AoE hit without a single aimed press —
	 * enough to flip `Living Corruption`'s "not one aimed press" reading, which is the half of that row's
	 * evidence re-measurement upheld. `isAoE` is asserted against this set in the tests, and is not an
	 * input to it.
	 *
	 * Ticks are not aimed presses even on an ability that declares this: a dot goes on ticking on an
	 * enemy the player walked away from, which is why `engagedWindows` throws them out too.
	 */
	aimed?: true;
}

/**
 * What an ability gets out of there being more enemies in front of it.
 *
 * The distinction exists because an **immune** unit is a target for one of these and not for the other,
 * and collapsing them into a single "was this a target" answer is wrong in one direction whichever way
 * it is collapsed. The Crawler Mines on Iron Juggernaut are the case that proves it: every hit on one
 * comes back `hitType: 10` for zero damage, so
 *
 *  - anything measured for **damage** — a fan-out average, a cleave verdict, the multi-target damage
 *    share — gains exactly nothing from a mine being there, and counting it invents targets; while
 *  - Rushing Jade Wind's chi refund fires on three units **hit**, damage or no damage, and that refund
 *    is the entire reason the wind beats Jab into a pack. A player who pressed it into three mines
 *    played correctly and the report has to say so.
 *
 * So it is a property of the ability rather than of the unit or of the reader. Rushing Jade Wind is not
 * the only button in the game with a hit-count trigger, and the next spec that has one must not have to
 * rediscover this.
 */
export type MultiTargetBenefit =
	/**
	 * The benefit is the damage dealt, so only an enemy that actually took damage counts. The default,
	 * and correct for almost every ability — a button that hits four things for nothing hit nothing.
	 */
	| 'damage'
	/**
	 * The benefit is a trigger that fires on the *number of units hit*, whether or not damage landed.
	 * An immune unit still counts, because the trigger still fires.
	 */
	| 'trigger';

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
	/**
	 * True when an item puts this up on its own schedule: a trinket, a meta gem, a cloak, an enchant.
	 *
	 * **The claim is about who decides, not about which slot it came from.** These auras arrive without
	 * anybody pressing anything, so a count of them is a reading of the pull's luck and of the gear
	 * behind it, and never of how the rotation was played. That is the whole reason the flag exists: the
	 * compare page draws them apart from every graded figure, and nothing scored may read it.
	 *
	 * So a tinker the player *presses* is not one of these, and neither is a tier bonus a rotation earns
	 * by spending its own resource. Both are gear; neither fires on its own.
	 *
	 * **Declared on the window and never on the counter beside it.** Five of these trinkets log a proc
	 * window and a stacking counter inside it under separate ids, and the counter reaches ten or twenty
	 * per proc. Flagging both would report the same trinket twice, once at ten times its real rate. See
	 * the stacking-trinket block in `game/shared.ts`.
	 */
	gearProc?: true;
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

/**
 * A damage-over-time effect's tick schedule: the base numbers, and the two facts about the mechanic
 * that decide how a log may be read against them.
 *
 * This exists because a dot in this expansion is **affected by haste without being affected by
 * duration**. Haste shortens the interval between ticks and leaves the duration where it is, so what
 * moves at a haste breakpoint is the *number of ticks*. Flame Shock is ten three-second ticks over
 * thirty seconds unhasted (`sim/shaman/shocks.go`), and on the committed `phased` fixture the
 * application at 2 631 ran to 32 291 with **22** ticks 1 348ms apart. Twelve ticks the declaration
 * cannot know about.
 *
 * So everything here is the *base*, and the count a pull actually got is derived from that pull's own
 * tick stream — `lib/analysis/ticks.ts`. That is also why a talent or a glyph that adds a tick needs
 * no entry here: it arrives in the cadence, already measured.
 */
export interface Dot {
	/** Base duration, before haste — and haste does not move it, which is the whole point. */
	durationMs: number;
	/** Base interval between ticks, before haste: the sim's own tick period. */
	tickMs: number;
	/**
	 * Base tick count.
	 *
	 * Redundant with `durationMs / tickMs` deliberately. `createRegistry` refuses a declaration where
	 * the three disagree, so a mistyped period cannot pass unnoticed as a dot with a different shape —
	 * the same reason the registry refuses two objects claiming one spell id.
	 */
	ticks: number;
	/**
	 * True when haste shortens the tick *interval* and leaves the duration alone, so the tick count is
	 * what moves — the mechanic described above.
	 *
	 * False would mean the other kind: haste shortens the duration and the tick count is fixed. Nothing
	 * in this app declares one, and the distinction is not cosmetic — backing a tick count out of a
	 * measured cadence is only valid for the first kind, so `tickWindowAt` refuses the second rather
	 * than reporting a count the dot never had.
	 */
	hastedTicks: boolean;
	/**
	 * True when reapplying the dot inside its **last tick window** rolls the pending tick over instead
	 * of losing it — which is what makes the last tick window the thing a player aims at, and the basis
	 * this report scores a refresh on.
	 *
	 * Measured, not assumed: on the `phased` fixture the refresh at 59 530 landed with a tick pending at
	 * 60 368; that tick fired, and the dot then ran a further seventeen periods to 90 171 — eighteen
	 * ticks out of a seventeen-tick application. The pending tick survived the reapplication.
	 *
	 * **False for Warlock, which is the only exception in this expansion.** A Warlock dot is judged on
	 * what it snapshotted rather than on where in its tick schedule the refresh landed, so scoring one
	 * on its tick window answers a question nobody asked and a miss reads as a fault. It is recorded
	 * here, on the model, rather than inside a spec's audit because there is no Warlock spec in this
	 * repository yet — and the next person to add one must not have to rediscover it. The rule is
	 * enforced rather than commented: `inLastTickWindow` throws for a dot that does not roll over.
	 */
	rollsOver: boolean;
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
	/**
	 * The base cast time, before haste — from the sim's `BaseCastTime`/`CastTime`, not from a log.
	 *
	 * Absent on an instant press, which is most of them. Present so the engine can price a cast-time
	 * spell's occupancy at its cast length rather than at a global: a Lightning Bolt takes 2.5s and a
	 * Shock takes none, and counting both as one GCD invents a number neither of them is.
	 */
	castTimeMs?: number;
	onGcd: boolean;
	gate: Gate;
	/**
	 * Everything this button's relationship to *how many enemies there are* — one block, one keying.
	 *
	 * See `AbilityTargeting`. Absent means every default: it establishes the count, it is arbitrated on
	 * the ladder, and its benefit is damage.
	 */
	targeting?: AbilityTargeting;
	cooldownMs?: number;
	/**
	 * Another ability whose cooldown this one shares, by key.
	 *
	 * Pressing either starts the same timer, so neither is ever available on its own schedule and a
	 * drift figure taken per button reports the same idle seconds twice. Protection's two builders are
	 * the case: Crusader Strike and Hammer of the Righteous both sit on `paladin.BuilderCooldown()`.
	 *
	 * Declared on both halves rather than on one, so a reader arriving at either finds it — and the
	 * registry can check that the two agree instead of taking one file's word for it.
	 */
	sharesCooldownWith?: string;
	/**
	 * What a character has to *be* to have this button at all, when that is not "any of them".
	 *
	 * Absent on nearly everything, which is the honest default: a class ability belongs to the class,
	 * and the spec that declares it is that claim already.
	 *
	 * It exists for the compare page, where an absent row has to say which of four things it is —
	 * did not take it, cannot have it, had it and never pressed it, or the log cannot say. A talent
	 * needs no declaration, because two logs' own talent lists settle it between them: an id in one
	 * list and not the other was not taken. A racial has no such list to be missing from, so without
	 * this a Draenei's Gift of the Naaru reads as a button the orc beside them declined to press.
	 */
	gatedBy?: 'race' | 'profession';
	/**
	 * Ids the log emits a `cast` under that are **not** a second press of this button.
	 *
	 * A combat log is not a list of decisions, and treating every `cast` as one over-counts. Three
	 * shapes produce this and all three are real: the cleave half of a press logging its own cast
	 * (Hammer of the Righteous under 88263, five of each on a reference pull, one press apiece), an
	 * auto-attack logging a cast (id 1, 116 of them on one pull — more cast events than any button on
	 * the bar), and a spell the game splits in two.
	 *
	 * Declared rather than left unmodelled, which is the point: an id nobody named is an id that
	 * happens not to be counted, and an id named here is one the model has *decided* is not a press.
	 */
	echoCastIds?: readonly number[];
	/**
	 * The aura key whose application stands in for this button's press, when the log emits no cast.
	 *
	 * Rare and specific. Execution Sentence is the case it was written for: traced through a whole
	 * pull, 114916 shows up as thirty ticks of damage and three debuff applications, and there is no
	 * `cast` event under any id at all. Until that was found every press of it was missing from the
	 * global count and the ladder's talent gate stayed shut for a player demonstrably using it.
	 *
	 * The aura is a worse clock than a cast and the difference is worth knowing: an application is the
	 * moment the debuff *landed*, which for a press with travel time is not the moment the button went
	 * out. It is used where the alternative is not counting the press at all.
	 */
	pressSeenAsAura?: string;
	/**
	 * True when haste shortens this cooldown, so `cooldownMs` is the value at no haste rather than the
	 * value on any real pull.
	 *
	 * Absent on every Windwalker and Elemental button, and that is the honest default rather than an
	 * oversight: an energy or mana cooldown does not read haste at all. Protection Paladin is the spec
	 * this exists for — Sanctity of Battle (25956) turns melee haste into cooldown reduction on every
	 * generator and on Shield of the Righteous, so on a geared pull the base numbers here are a third
	 * too long and every drift figure built on them would invent lost casts.
	 *
	 * Nothing reads this on its own. A spec that declares it also declares `cooldownAt` on its
	 * `SpecConfig`, which is what turns the flag into a number at the moment of a press — see
	 * `cooldownDrift`, where the *when* matters: the game arms a cooldown when the button goes out, so
	 * a press made inside Bloodlust stamps a shorter one than the press before it.
	 */
	hasteScaled?: boolean;
	/** Present when pressing it locks out every other button for a while. */
	channel?: Channel;
	/**
	 * Present when the press leaves a dot behind. Alongside `channel` because it answers the same kind
	 * of question — how the press unfolds over time rather than what it hits.
	 */
	dot?: Dot;
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
