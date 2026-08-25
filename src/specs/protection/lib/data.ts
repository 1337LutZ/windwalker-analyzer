// Which spell id means what, for Mists of Pandaria Protection Paladin.
//
// Every id and every duration below is read off wowsims-mop rather than out of memory, and the
// comment on each one names the file it came from. That is the whole reason this file is worth
// reading: a combat log is a stream of bare ids, and an id copied from a wiki that the sim disagrees
// with produces a report that argues against the rotation it claims to measure.
//
// Where the log and the sim can disagree, the log wins and the comment says so — the sim gives a dot
// its parent's ActionID far more often than the game does.

import type { Ability, Aura, GameData } from '~/lib/game/model';
import { createRegistry } from '~/lib/game/registry';
import { SHARED_ABILITIES, SHARED_AURAS } from '~/lib/game/shared';

import { GCD_FLOOR_MS, cooldownMsFor } from '~/lib/analysis/haste';

/**
 * The global at the pull's own haste, in ms — the floor rather than the value.
 *
 * `GCD_MS` is the number a global cannot go below: `sanctity_of_battle.go` caps its own reduction at
 * 0.5s, so from 50% haste upwards every player has the same 1.0s global. It is still the right
 * constant for a floor comparison and the wrong one for arithmetic about a pull, which is why the
 * measurement asks `HasteCurve.gcdMsAt(t)` instead — see `haste.ts`, where the whole model lives.
 *
 * Shield of the Righteous is why the floor matters: its own cooldown lands on 1000ms at 50% haste, so
 * a geared pull is limited by the global and by nothing else.
 */
export const GCD_MS = GCD_FLOOR_MS;

/**
 * A cooldown as a press at a given haste stamps it.
 *
 * The haste comes in rather than being read from a constant here, because it is a property of the
 * pull and of the moment inside it: Sanctity of Battle multiplies these cooldowns by `1 / meleeHaste`
 * (`sim/paladin/sanctity_of_battle.go`), and Bloodlust moves that term for forty seconds. Callers
 * hold a `HasteCurve` and ask it for the value at the press.
 */
export function effectiveCooldownMs(ability: Ability, haste: number): number {
	const base = ability.cooldownMs ?? 0;
	return ability.hasteScaled === true ? cooldownMsFor(base, haste) : base;
}

/**
 * What Shield of the Righteous costs, from `sim/paladin/protection/shield_of_the_righteous.go`.
 *
 * Fixed at 3 whatever the bar holds — `HolyPower.Spend(sim, 3, actionID)`, gated by
 * `HolyPower.CanSpend(3)`. Word of Glory is the variable spender, not this one, which is why holding
 * holy power past 3 can only ever be for a Word of Glory.
 */
export const SOTR_COST = 3;

/**
 * The holy power bar's ceiling, and the power type it is reported under.
 *
 * Both confirmed against a real MoP Classic report rather than assumed. Holy power is **not** in
 * `classResources` — a Protection Paladin's samples there carry mana and nothing else, so the trick
 * that rebuilt a Windwalker's energy curve finds no bar here at all. What the log does carry is every
 * *change* to it, as `resourcechange` events:
 *
 *   { type: 'resourcechange', abilityGameID: 35395, resourceChange: 3,
 *     resourceChangeType: 9, maxResourceAmount: 5, waste: 0 }
 *
 * Which is better than a sampled bar for the one question worth asking. `resourceChangeType: 9` names
 * the resource, `resourceChange` is what arrived, `maxResourceAmount` is the cap, and `waste` is what
 * did not fit — measured by the game rather than inferred here. The 3 above is a Crusader Strike
 * inside Holy Avenger.
 */
export const HOLY_POWER_MAX = 5;

/** `resourceChangeType` for holy power, as the events above report it. */
export const HOLY_POWER_TYPE = 9;

/**
 * How long Holy Avenger runs, from `registerHolyAvenger` in `sim/paladin/talents.go`.
 *
 * 18 seconds, in which every generator gives 3 holy power instead of 1 and deals 30% more damage.
 * Load-bearing for the ladder: inside this window a generator fills the bar on its own, so a
 * spender skipped here caps the bar in one press rather than three.
 */
export const HOLY_AVENGER_MS = 18_000;

/** Grand Crusader's window, from `registerGrandCrusader`. Six seconds to spend a free Avenger's Shield. */
export const GRAND_CRUSADER_MS = 6000;

/** Shield of the Righteous' mitigation buff, from its `RelatedSelfBuff`. Extends rather than refreshes. */
export const SOTR_BUFF_MS = 3000;

/** Bastion of Glory: five stacks, twenty seconds, consumed by Word of Glory. */
export const BASTION_OF_GLORY_MS = 20_000;

/**
 * Sacred Shield's aura, from `registerSacredShield`: five ticks of six seconds.
 *
 * Thirty seconds total, which is what makes the APL's "refresh under 5s" rule a real rule rather
 * than a rounding — the button has a 6s cooldown of its own, so a refresh window missed by a global
 * is not recoverable inside the same tick.
 */
export const SACRED_SHIELD_MS = 30_000;

/** How long is left on Sacred Shield when the sim's list wants it re-applied. */
export const SACRED_SHIELD_REFRESH_MS = 5000;

/**
 * The attack-power gain that makes re-snapshotting Sacred Shield worth a global at all.
 *
 * 20%, the reader's figure. The shield snapshots at cast and re-applies off that snapshot every six
 * seconds, and its size runs off spell power — which for Protection *is* attack power, since
 * `guarded_by_the_light.go` overrides spell power to `floor(MeleeAttackPower() * 0.5)`. So Vengeance
 * decides how big the shield is, and a refresh taken while Vengeance is flat pays a damaging global
 * for nothing.
 *
 * A threshold rather than a rule, and it grades rather than demands: below this the press is a fault
 * only if something else was ready, because a global nothing else wanted is free.
 */
export const SACRED_SHIELD_WORTH_IT_PCT = 20;

/**
 * The attack-power gain that puts Sacred Shield above every damaging button.
 *
 * 100% — a doubling, also the reader's figure, and the gap between this and the 20% above is the point.
 * A fifth more Vengeance makes a refresh worth a *spare* global. Twice the Vengeance makes the shield
 * worth taking a global *from* the rotation, because the snapshot will then stand for the next thirty
 * seconds of re-applications.
 */
export const SACRED_SHIELD_SNAPSHOT_PCT = 100;

/**
 * How much smaller a Sacred Shield refresh may be and still count as the same shield.
 *
 * The reader's figure, and it exists for one question: when nothing that deals damage is off
 * cooldown, is there anything worth doing with the global at all? A refresh that would land within
 * this much of the running shield is worth taking — the aura is maintained for free, since nothing
 * was competing for the press. One that would land meaningfully smaller is not, and a global with
 * nothing behind it is not a fault the player committed.
 */
export const SACRED_SHIELD_EQUAL_PCT = 5;

/**
 * The health a target has to be under for Hammer of Wrath.
 *
 * The only condition, for Protection: `sim/paladin/hammer_of_wrath.go` gates the spell on
 * `IsExecutePhase20()` and nothing else, and the tooltip's "or during Avenging Wrath" belongs to Sword
 * of Light, the Retribution passive. So there is no second clause to get out of step with.
 *
 * Here rather than in `apl.ts`, where it started, because two things read it now: the priority list
 * deciding whether the button was wanted, and the globals measure deciding whether there was anything
 * to press at all. Those two must not be able to disagree about when the execute is live.
 */
export const HAMMER_OF_WRATH_HEALTH_PCT = 20;

const ABILITIES: Ability[] = [
	// ---------------------------------------------------------------------------------------------
	// The generators. Every one is a cooldown, and every one of those cooldowns is haste-scaled.
	// ---------------------------------------------------------------------------------------------
	{
		key: 'crusader-strike',
		name: 'Crusader Strike',
		castIds: [35395],
		damageIds: [35395],
		onGcd: true,
		gate: 'cooldown',
		// `sim/paladin/crusader_strike.go`: 4500ms on `paladin.BuilderCooldown()`, one holy power on
		// a landed hit. The shared timer is why `sharesCooldownWith` exists.
		cooldownMs: 4500,
		hasteScaled: true,
		sharesCooldownWith: 'hammer-of-the-righteous',
	},
	{
		key: 'hammer-of-the-righteous',
		name: 'Hammer of the Righteous',
		castIds: [53595],
		// Two ids, and the split is the point: 53595 is the single-target hit, 88263 the cleave that
		// lands on everything else. `sim/paladin/hammer_of_the_righteous.go` registers them as two spells
		// off one press.
		damageIds: [53595, 88263],
		// And the log emits a *cast* under 88263 as well — five of each on a reference pull, one press
		// apiece. Counted as presses that is one button reported as two.
		echoCastIds: [88263],
		onGcd: true,
		gate: 'cooldown',
		cooldownMs: 4500,
		hasteScaled: true,
		sharesCooldownWith: 'crusader-strike',
		applies: ['weakened-blows'],
	},
	{
		key: 'judgment',
		name: 'Judgment',
		castIds: [20271],
		damageIds: [20271],
		onGcd: true,
		gate: 'cooldown',
		// `sim/paladin/judgment.go`: 6s. The holy power comes from Judgments of the Wise (105424),
		// which is a passive rather than part of the cast, so it is modelled as an aura below.
		cooldownMs: 6000,
		hasteScaled: true,
	},
	{
		key: 'avengers-shield',
		name: "Avenger's Shield",
		castIds: [31935],
		damageIds: [31935],
		onGcd: true,
		gate: 'cooldown',
		// `sim/paladin/protection/avengers_shield.go`: 15s, and the only cooldown on this list that
		// something other than time can clear — Grand Crusader resets it outright.
		cooldownMs: 15_000,
		hasteScaled: true,
		consumes: ['grand-crusader'],
	},
	{
		key: 'holy-wrath',
		name: 'Holy Wrath',
		// 119072 rather than the 2812 a Wrath-era note would give: the spell was re-issued in 5.x.
		castIds: [119072],
		damageIds: [119072],
		onGcd: true,
		gate: 'cooldown',
		cooldownMs: 9000,
		hasteScaled: true,
	},
	{
		key: 'consecration',
		name: 'Consecration',
		castIds: [26573],
		// The sim gives the dot its parent's ActionID (`consecration.go` labels the tick 26573), but
		// the game does not: MoP logs the ticks under 81297. Both are listed because the report has to
		// read a log, and a damage id that only the sim uses would drop every tick on the pull.
		damageIds: [26573, 81297],
		onGcd: true,
		gate: 'cooldown',
		cooldownMs: 9000,
		hasteScaled: true,
	},
	{
		key: 'hammer-of-wrath',
		name: 'Hammer of Wrath',
		castIds: [24275],
		damageIds: [24275],
		onGcd: true,
		// Conditional rather than cooldown, and that is a judgement about what to report: the button
		// needs the target under 20% health. Health is not in the player's own event stream, so idle
		// cooldown time on it is not a fault the log can prove — see `gate: 'conditional'`.
		//
		// Execute only, for Protection. Avenging Wrath does *not* unlock it — `hammer_of_wrath.go` gates
		// the spell on `IsExecutePhase20()` alone, and the "or during Avenging Wrath" half of its tooltip
		// is inside a `-- Sword of Light --` block, which is the Retribution passive.
		gate: 'conditional',
		cooldownMs: 6000,
		hasteScaled: true,
	},

	// ---------------------------------------------------------------------------------------------
	// The spenders.
	// ---------------------------------------------------------------------------------------------
	{
		key: 'shield-of-the-righteous',
		name: 'Shield of the Righteous',
		castIds: [53600],
		damageIds: [53600],
		/**
		 * Off the global, and this is the most load-bearing flag in the file.
		 *
		 * `sim/paladin/protection/shield_of_the_righteous.go` gives its cast `NonEmpty: true` and no
		 * `GCD` at all, where Crusader Strike carries `GCD: core.GCDDefault`. So the spender costs the
		 * rotation none of the globals the generators compete for, and pressing it can never be the
		 * reason a generator was late.
		 *
		 * Most of this report's shape follows from that. The priority ladder judges on-GCD presses only,
		 * so it never sees this button — there is no "you should have spent" verdict to give, because
		 * spending is free. The only way holy power is lost is by generating it into a full bar, and the
		 * log reports that directly as `waste` on a `resourcechange`. The question "did you spend well"
		 * collapses into one measured number that needs no reconstruction.
		 */
		onGcd: false,
		// Holy-power gated: a 1000ms cooldown at the assumed haste is never what holds this back. Three
		// holy power is.
		gate: 'holy-power',
		cooldownMs: 1500,
		hasteScaled: true,
		applies: ['shield-of-the-righteous', 'bastion-of-glory'],
	},
	{
		key: 'word-of-glory',
		name: 'Word of Glory',
		castIds: [85673],
		// Off the global for this spec only: `GCD: core.TernaryDuration(isProt, 0, core.GCDDefault)` in
		// `sim/paladin/word_of_glory.go`. A Retribution Paladin pays a global for the same button.
		onGcd: false,
		gate: 'holy-power',
		// Off the damage comparison, on the holy-power ledger. See `utility` in game/model.ts.
		utility: true,
		consumes: ['bastion-of-glory'],
	},
	{
		key: 'eternal-flame',
		name: 'Eternal Flame',
		// The level 45 talent that replaces Word of Glory. Listed alongside rather than instead of it
		// because which one a player brought is a fact about the log, not about the spec.
		castIds: [114163],
		// Off the global, on the same line of the same file as Word of Glory.
		onGcd: false,
		gate: 'holy-power',
		utility: true,
		consumes: ['bastion-of-glory'],
	},

	// ---------------------------------------------------------------------------------------------
	// Talents that cost a global and deal damage. Which one the player brought is read off the log.
	// ---------------------------------------------------------------------------------------------
	{
		key: 'execution-sentence',
		name: 'Execution Sentence',
		// Neither 114157 nor 114916 appears as a cast in a real log: traced through one pull, 114916 shows up
		// as thirty ticks of damage, three debuff applications and three removals, and there is no cast event
		// under any id at all. So the press is read from the debuff going up — see `pressSeenAsAura`. Until
		// that was found, every Execution Sentence was missing from the global count and the ladder's talent
		// gate stayed shut for a player who was demonstrably using it.
		castIds: [114916],
		damageIds: [114916],
		pressSeenAsAura: 'execution-sentence',
		onGcd: true,
		gate: 'cooldown',
		// `executionSentenceFactory`: one minute, and not haste-scaled — the level 90 talents are
		// outside Sanctity of Battle's mask.
		cooldownMs: 60_000,
	},
	{
		key: 'lights-hammer',
		name: "Light's Hammer",
		castIds: [114158],
		// The hammer itself never hits; Arcing Light (114919) is what the ticks log as.
		damageIds: [114919],
		onGcd: true,
		gate: 'cooldown',
		cooldownMs: 60_000,
	},
	{
		key: 'holy-prism',
		name: 'Holy Prism',
		castIds: [114852],
		damageIds: [114852],
		onGcd: true,
		gate: 'cooldown',
		cooldownMs: 20_000,
	},
	{
		key: 'sacred-shield',
		name: 'Sacred Shield',
		castIds: [20925],
		onGcd: true,
		// A cooldown that is pressed to maintain an aura rather than to spend a cooldown, so idle time
		// on it says nothing: the fault is a gap in the aura, which the aura's own section measures.
		gate: 'conditional',
		cooldownMs: 6000,
		applies: ['sacred-shield'],
	},

	// ---------------------------------------------------------------------------------------------
	// Damage cooldowns.
	// ---------------------------------------------------------------------------------------------
	{
		key: 'avenging-wrath',
		name: 'Avenging Wrath',
		castIds: [31884],
		onGcd: false,
		gate: 'cooldown',
		cooldownMs: 180_000,
		// 20% more damage for 20 seconds, and it is also what makes Hammer of Wrath castable on a
		// healthy target — see the `hammer-of-wrath` gate.
		applies: ['avenging-wrath'],
	},
	{
		key: 'holy-avenger',
		name: 'Holy Avenger',
		castIds: [105809],
		// Off the global, like Avenging Wrath: both are `NonEmpty: true` with no GCD in their cast
		// configs. It matters for the ladder, which only judges presses that cost a global — neither of
		// these competes with a generator, so neither can be a skip.
		onGcd: false,
		gate: 'cooldown',
		// Two minutes, from `registerHolyAvenger`. Not three, which is Avenging Wrath's.
		cooldownMs: 120_000,
		applies: ['holy-avenger'],
	},

	// ---------------------------------------------------------------------------------------------
	// Counted, never scored: the defensives and the seal. They are here so the presses have names and
	// so a defensive global is not read as a missing generator.
	// ---------------------------------------------------------------------------------------------
	{
		key: 'speed-of-light',
		name: 'Speed of Light',
		castIds: [85499],
		// Off the global: `sim/paladin/talents.go:68-76` gives its cast config a cooldown and no GCD at
		// all, which `spell.go:324` then reads as haste-ignoring because both GCD and cast time are nought.
		onGcd: false,
		gate: 'other',
		cooldownMs: 45_000,
	},
	{
		key: 'divine-protection',
		name: 'Divine Protection',
		castIds: [498],
		onGcd: false,
		gate: 'other',
		cooldownMs: 60_000,
	},
	{
		key: 'guardian-of-ancient-kings',
		name: 'Guardian of Ancient Kings',
		castIds: [86659],
		onGcd: false,
		gate: 'other',
		cooldownMs: 180_000,
	},
	{
		key: 'ardent-defender',
		name: 'Ardent Defender',
		castIds: [31850],
		onGcd: false,
		gate: 'other',
		cooldownMs: 180_000,
	},
	{
		key: 'seal-of-truth',
		name: 'Seal of Truth',
		castIds: [31801],
		onGcd: true,
		gate: 'other',
		applies: ['seal-of-truth'],
	},
	{
		key: 'seal-of-righteousness',
		name: 'Seal of Righteousness',
		castIds: [20154],
		onGcd: true,
		gate: 'other',
		applies: ['seal-of-righteousness'],
	},
	{
		key: 'seal-of-insight',
		name: 'Seal of Insight',
		castIds: [20165],
		onGcd: true,
		gate: 'other',
		applies: ['seal-of-insight'],
	},

	// ---------------------------------------------------------------------------------------------
	// The rest of what a real pull presses. Every id below was read off a log rather than guessed at:
	// they are what the probe harness listed as unmodelled, resolved through Wowhead's mop-classic
	// tooltips. They are here so the cast table can name them, and so a global spent on one of them is
	// not silently attributed to the rotation.
	// ---------------------------------------------------------------------------------------------
	{
		key: 'grand-crusader-gain',
		name: 'Grand Crusader',
		// 98057, and not a button at all — it is the holy power the proc hands over, which this log
		// records as a cast. Eleven on one reference pull.
		//
		// Worth having for one reason: `sim/paladin/protection/grand_crusader.go` gains holy power under
		// this id only when Avenger's Shield is pressed while the proc is up. So a count of these is a
		// count of procs actually *used*, against `applybuff 85416` for procs *offered* — which turns
		// wasted procs into a subtraction rather than an inference.
		castIds: [98057],
		onGcd: false,
		gate: 'other',
	},
	{
		key: 'hand-of-reckoning',
		name: 'Hand of Reckoning',
		// Wowhead names 62124 "Reckoning". It is the taunt, and a taunt is a global the rotation lost for
		// a reason no damage report is entitled to an opinion about.
		castIds: [62124],
		onGcd: true,
		gate: 'other',
	},
	{
		key: 'fist-of-justice',
		name: 'Fist of Justice',
		castIds: [105593],
		onGcd: true,
		gate: 'other',
	},
	{
		key: 'lay-on-hands',
		name: 'Lay on Hands',
		// `sim/paladin/lay_on_hands.go` gives its cast no GCD.
		castIds: [633],
		onGcd: false,
		gate: 'other',
		cooldownMs: 600_000,
	},
	{
		key: 'potion-of-mogu-power',
		name: 'Potion of Mogu Power',
		castIds: [105706],
		onGcd: false,
		gate: 'other',
		onUse: true,
		applies: ['potion-of-mogu-power'],
	},

	// ---------------------------------------------------------------------------------------------
	// Passive damage. Pressed by nobody, but it is a real share of the total.
	//
	// Three that were here and are not: Melee, Stormlash and Lightning Strike. All three are damage ids
	// wanting a name and nothing more, and all three name *shared* things — an auto-attack, somebody
	// else's totem, a meta gem's payload — so both other specs name them in `EXTRA_NAMES` rather than
	// declaring an ability. This one does the same, in `lib/index.ts`. It costs one real thing: the
	// fork declared Melee with `echoCastIds: [1]`, which is a better treatment than either other spec
	// has, and moving it to `SHARED_ABILITIES` so all three could keep it would move the Windwalker's
	// own cast counts. Worth doing on its own; not as a side effect of adding a spec.
	// ---------------------------------------------------------------------------------------------
	{
		key: 'seal-of-truth-proc',
		name: 'Seal of Truth',
		castIds: [],
		// The seal's own hit (42463) and Censure's dot (31803). Prot deals 80% less with both —
		// `protection.go` applies a -0.8 damage mod to exactly this pair — so a small share here is
		// correct rather than a sign of a missing seal.
		damageIds: [42463, 31803],
		onGcd: false,
		gate: 'other',
	},
	{
		key: 'seal-of-righteousness-proc',
		name: 'Seal of Righteousness',
		castIds: [],
		damageIds: [101423],
		onGcd: false,
		gate: 'other',
	},
];

// Four entries the fork carried and this build does not need: Synapse Springs, Flurry of Xuen,
// Bloodlust and the Capacitive Primal Diamond's stacking buff. All four are in `SHARED_ABILITIES` /
// `SHARED_AURAS`, which a single-spec build had no reason to have — and in two cases ours says more.
// The shared Bloodlust carries the `variants` that name which of the five spells a pull got, and the
// shared 137596 is declared as the five-stack *counter* it is rather than as a plain buff, with the
// hunter's second payload id beside it.
const AURAS: Aura[] = [
	{
		key: 'potion-of-mogu-power',
		name: 'Potion of Mogu Power',
		// The press and the buff under one id, which is how the log books every combat potion in this
		// expansion — the Elemental's Jade Serpent Potion and the Windwalker's Virmen's Bite are the same
		// shape. Measured here rather than assumed: three apply/remove pairs under 105706 on the Garrosh
		// capture, and nothing else in the 105000 range but Holy Avenger.
		ids: [105_706],
		kind: 'buff',
		durationMs: 25_000,
		appliedBy: 'potion-of-mogu-power',
	},
	{
		key: 'righteous-fury',
		name: 'Righteous Fury',
		ids: [25780],
		kind: 'buff',
		// The spec proof. MoP Classic reports `specID` as 0, and unlike a Windwalker's brew there is
		// no damage button only this spec presses — Crusader Strike and Judgment belong to all three.
		// Righteous Fury is the tanking stance, and `registerRighteousFury` is Protection-only in the
		// sim. `playerDetails` is asked as well; this is the check that does not need a second query.
	},
	{
		key: 'grand-crusader',
		name: 'Grand Crusader',
		ids: [85416],
		kind: 'buff',
		durationMs: GRAND_CRUSADER_MS,
		// No `appliedBy`: it comes off a dodge, a parry, or a landed Crusader Strike or Hammer of the
		// Righteous, at 12% with a one-second internal cooldown. Nothing is pressed to get it, which
		// is exactly why wasting one is a fault worth reporting.
		consumedBy: ['avengers-shield'],
	},
	{
		key: 'shield-of-the-righteous',
		name: 'Shield of the Righteous',
		ids: [132403],
		kind: 'buff',
		durationMs: SOTR_BUFF_MS,
		appliedBy: 'shield-of-the-righteous',
		// It extends rather than restarts — `UpdateExpires(ExpiresAt() + Duration)` — so a second
		// press inside the window is not a refresh that lost anything.
	},
	{
		key: 'bastion-of-glory',
		name: 'Bastion of Glory',
		ids: [114637],
		kind: 'buff',
		durationMs: BASTION_OF_GLORY_MS,
		maxStacks: 5,
		appliedBy: 'shield-of-the-righteous',
		consumedBy: ['word-of-glory', 'eternal-flame'],
	},
	{
		key: 'holy-avenger',
		name: 'Holy Avenger',
		ids: [105809],
		kind: 'buff',
		durationMs: HOLY_AVENGER_MS,
		appliedBy: 'holy-avenger',
	},
	{
		key: 'avenging-wrath',
		name: 'Avenging Wrath',
		ids: [31884],
		kind: 'buff',
		// Twenty seconds, or thirty with Sanctified Wrath — `TernaryFloat64(Talents.SanctifiedWrath,
		// 30, 20)`. The shorter one is assumed because the assumed build takes Holy Avenger instead.
		durationMs: 20_000,
		appliedBy: 'avenging-wrath',
	},
	{
		key: 'sacred-shield',
		name: 'Sacred Shield',
		ids: [20925],
		kind: 'buff',
		durationMs: SACRED_SHIELD_MS,
		appliedBy: 'sacred-shield',
		// The absorb itself logs under 65148, and it is deliberately not listed here: it is a separate
		// aura that re-applies every six seconds, so folding it into this one would report the buff as
		// dropping five times a pull.
	},
	{
		key: 'weakened-blows',
		name: 'Weakened Blows',
		ids: [115798],
		kind: 'debuff',
		durationMs: 30_000,
		appliedBy: 'hammer-of-the-righteous',
	},
	{
		key: 'seal-of-truth',
		name: 'Seal of Truth',
		ids: [31801],
		kind: 'buff',
		appliedBy: 'seal-of-truth',
	},
	{
		key: 'seal-of-righteousness',
		name: 'Seal of Righteousness',
		ids: [20154],
		kind: 'buff',
		appliedBy: 'seal-of-righteousness',
	},
	{
		key: 'seal-of-insight',
		name: 'Seal of Insight',
		ids: [20165],
		kind: 'buff',
		appliedBy: 'seal-of-insight',
	},
	{
		key: 'censure',
		name: 'Censure',
		ids: [31803],
		kind: 'debuff',
		maxStacks: 5,
		durationMs: 15_000,
	},
	{
		key: 'speed-of-light',
		name: 'Speed of Light',
		ids: [85499],
		kind: 'buff',
		// `sim/paladin/talents.go:46-57` — 8s, and a pure movement-speed effect (`NewActiveMovementSpeedEffect`,
		// +70%) with no bearing on damage taken or dealt. Declared anyway, and the reason is the whole point
		// of declaring auras: an aura nothing names renders on the timeline as a bare spell id with no icon,
		// which is what a reader reported seeing.
		//
		// **It appears in none of the five committed captures**, which is why `undeclaredAuras.test.ts` never
		// raised it — that sweep can only see what a fixture carries, so a talent this tank did not take is
		// outside its reach entirely. Found on a reader's own log rather than by the guard.
		//
		// **Declaring the aura alone was not enough, which is the part worth remembering.** The first pass
		// added this entry and the id still drew bare, because the timeline names a *press* from an
		// `Ability`'s `castIds` — an aura with no button behind it gives the lane nothing to label. The
		// ability above is what actually fixes it; this makes the buff it applies nameable too.
		durationMs: 8000,
		appliedBy: 'speed-of-light',
	},
	{
		key: 'divine-purpose',
		name: 'Divine Purpose',
		ids: [90174],
		kind: 'buff',
		durationMs: 8000,
		// The level 75 alternative to Holy Avenger. Modelled although the assumed build does not take
		// it, because it changes what the holy-power bar means: the spender pays nothing and spends as
		// if it had three, so a bar that does not fall on a press is the talent rather than a bad read.
	},
	{
		key: 'sanctified-wrath',
		name: 'Sanctified Wrath',
		ids: [114232],
		kind: 'buff',
		// The other level 75 alternative. Its presence is what makes the sim's "Judgment inside
		// Avenging Wrath" rule exist at all, so the ladder reads this rather than assuming it.
	},
	{
		key: 'bastion-of-power',
		name: 'Bastion of Power',
		ids: [144569],
		kind: 'buff',
		// Tier 16 four-piece, off `sim/paladin/items.go` ("Plate of Winged Triumph"): Shield of the
		// Righteous makes the next Word of Glory free. A survival bonus rather than a damage one, and
		// it is here so a free Word of Glory is not read as holy power the damage rotation lost.
	},
	{
		key: 'shield-of-glory',
		name: 'Shield of Glory',
		ids: [138242],
		kind: 'buff',
		// Tier 15 two-piece, off the same file ("Plate of the Lightning Emperor").
	},
	{
		key: 'execution-sentence',
		name: 'Execution Sentence',
		ids: [114916],
		kind: 'debuff',
		durationMs: 10_000,
		appliedBy: 'execution-sentence',
		// The only evidence the button was pressed. See `pressSeenAsAura` on the ability.
	},
	{
		key: 'vengeance',
		name: 'Vengeance',
		ids: [84839],
		kind: 'buff',
		// Read but not judged in this iteration. A tank's attack power is mostly this, and this is
		// mostly damage taken — so it explains the size of every number in the damage table without
		// being a rotation decision. The sim's priority list never reads it, which is why nothing
		// here does either yet.
	},
];

/**
 * The cooldowns that drive damage, and what has to line up for one to be worth pressing.
 *
 * A separate table from `ABILITIES` because the question is different. The ladder asks which button gets
 * a global; this asks whether a two-minute cooldown was spent at the right moment — and "the right
 * moment" is not a priority, it is an alignment. A Holy Avenger held for thirty seconds so it lands
 * inside Avenging Wrath is a *better* Holy Avenger, and every rule in the priority list would call
 * holding it a mistake.
 *
 * `snapshots` is the distinction that matters most here. Execution Sentence captures its damage when it
 * is cast — `executionSentenceFactory` in `sim/paladin/talents.go` gives its dot an `OnSnapshot` hook —
 * so the whole ten seconds is decided by the attack power and the buffs standing at the instant of the
 * press. Overlap tells you nothing about it: cast one second before Avenging Wrath and none of it is
 * boosted, cast one second after and all of it is. The buffs below are the opposite, and are measured
 * by how much of their window they shared.
 */
export interface DamageCooldown {
	key: string;
	castId: number;
	/** The spellbook cooldown. None of these is haste-scaled. */
	cooldownMs: number;
	durationMs: number;
	/** True when the press decides its damage once, at the moment it lands. */
	snapshots?: true;
	/**
	 * True when the reader presses this on cooldown on purpose and does not want it judged on alignment.
	 *
	 * Synapse Springs is the case. A one-minute tinker cannot be held for a three-minute cooldown without
	 * giving up presses, and the reader's own answer is that lining it up is not worth anything — so it is
	 * measured and printed, and kept out of every table that grades alignment. A metric nobody will act on
	 * is a metric that makes the ones beside it harder to read.
	 */
	pressedOnCooldown?: true;
	/**
	 * The most presses a single pull can hold, when something other than the cooldown decides that.
	 *
	 * The potion is the case, and without this its ceiling reads as pull length divided by a category
	 * cooldown — three on a two-and-a-half-minute fight, of which two were never available. A ceiling a
	 * player cannot reach is an accusation rather than a measurement, which is the same fault
	 * `talentTier` exists to prevent.
	 */
	maxPerFight?: number;
	/**
	 * Name of a mutually exclusive talent group this button belongs to.
	 *
	 * Without it a report accuses a player of missing a spell they did not bring. Execution Sentence,
	 * Light's Hammer and Holy Prism are one tier and you take exactly one — so on a pull where Light's
	 * Hammer went out nine times, Execution Sentence's ceiling is not nine missed casts, it is not a
	 * ceiling at all. Three of nine reference pulls read that way before this existed, and they were the
	 * three that supplied most of the "missed" total.
	 */
	talentTier?: string;
}

export const DAMAGE_COOLDOWNS: readonly DamageCooldown[] = [
	// The anchor. Everything else is aligned to this one, so it is listed first.
	{ key: 'avenging-wrath', castId: 31884, cooldownMs: 180_000, durationMs: 20_000 },
	{ key: 'holy-avenger', castId: 105809, cooldownMs: 120_000, durationMs: HOLY_AVENGER_MS },
	// Ten seconds, snapshotted at the press, and heavily back-loaded: `registerExecutionSentence` ramps each
	// tick 10% over the last and then multiplies the final one by five. So the press decides the damage and
	// the payoff arrives ten seconds later, which is exactly why lining the *cast* up matters.
	{
		key: 'execution-sentence',
		castId: 114916,
		cooldownMs: 60_000,
		durationMs: 10_000,
		snapshots: true,
		talentTier: 'level-90',
	},
	// The alternative on the same tier, and the one the reader took on three of the nine reference pulls.
	// `registerLightsHammer` ticks every two seconds and recomputes damage each tick, so it does not
	// snapshot — every second of its window counts, unlike Execution Sentence.
	{ key: 'lights-hammer', castId: 114158, cooldownMs: 60_000, durationMs: 15_000, talentTier: 'level-90' },
	// The third. One hit at the moment of the press, so there is no window to share — it is judged where it
	// landed, like a snapshot.
	{ key: 'holy-prism', castId: 114852, cooldownMs: 20_000, durationMs: 0, snapshots: true, talentTier: 'level-90' },
	// "Increases your Intellect, Agility, or Strength by 1920 for 10 sec", one minute.
	{ key: 'synapse-springs', castId: 126734, cooldownMs: 60_000, durationMs: 10_000, pressedOnCooldown: true },
	// "Increases your Strength by 4000 for 25 sec".
	//
	// One per fight, and that is the binding limit rather than the sixty seconds beside it: a combat
	// potion can be drunk once per encounter however long the encounter runs, so the category cooldown
	// never gets the chance to matter. The pre-pull potion is drunk out of combat and is not in the
	// log's fight window at all, so a count of presses here is a lower bound on what was actually drunk
	// — and the ceiling beside it is one.
	{ key: 'potion-of-mogu-power', castId: 105706, cooldownMs: 60_000, durationMs: 25_000, maxPerFight: 1 },
];

/**
 * The shared lists come first, on the same terms both other specs take them.
 *
 * Racials, flasks, the raid's haste cooldown, the trinket and meta procs, and the two raid health
 * buffs the Karma ceiling reads — none of them belongs to a class, and every spec needs them declared
 * or the engine's own lookups (`aura('bloodlust')`, `aura('berserking')`) fail at construction.
 *
 * The fork carried its own copies of several of these, because it was a single-spec build with no
 * shared list to reach for. Ours are the shared ones.
 */
export const PROTECTION: GameData = {
	abilities: [...SHARED_ABILITIES, ...ABILITIES],
	auras: [...SHARED_AURAS, ...AURAS],
};

/** The one way to ask what a spell id means. Construction validates the links between the two lists. */
export const registry = createRegistry(PROTECTION);
