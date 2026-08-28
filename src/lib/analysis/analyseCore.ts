// The engine's generic core: everything any spec's log shares, computed from the fight and the
// spec's `SpecConfig` alone.
//
// A spec is a model (its abilities and auras, `spec.registry`) plus two hooks:
//
//   - `identify(h)` — whether this player was actually playing the spec. A Monk with no Tigereye
//     Brew is a Brewmaster or Mistweaver, and a report must refuse to grade them as Windwalker.
//   - `audit(h)` — every figure the log can only answer with the spec's model in hand: its
//     cooldowns, its auras, its priority list. The audit sees `Handles` and nothing else.
//
// The audit runs in the middle of the pass, once the press marks and the reconstructed resource
// bars exist — the two things the last audits need and the reason the assembly below is split. The
// core then merges the spec's half over its own: `Analysis = AnalysisCore & SpecAuditResult`, with
// `cpm` and `timeline` the two places the halves genuinely share a figure.

import SPELLS from '~/generated/spells.json';
import type { DamageEvent, WclEvent } from '~/lib/events';
import {
	abilityIdOf,
	eventsOn,
	instanceKey,
	isCast,
	isCombatantInfo,
	isDamage,
	isDeath,
	isResurrect,
} from '~/lib/events';
import type { Ability } from '~/lib/game/model';
import { excludedDamageActorIDs, uncountedActorIDs } from '~/lib/game/rankingExclusions';
import { appliesExemptions, DEFAULT_ANALYSIS_MODE, type AnalysisMode } from '~/lib/analysis/analysisMode';
import { conditionalExclusions, isStruckHit } from '~/lib/game/conditionalExclusions';
import type { FightPhase } from '~/lib/wcl/phases';
import type { Registry } from '~/lib/game/registry';
import type { ResourceConfig } from '~/lib/game/resources';
import type { SpecColors } from '~/lib/game/classes';
import type { AnalysisSettings, SettingSchema } from '~/lib/settings/model';
import { clampSettings } from '~/lib/settings/model';
import type {
	AbilityDamage,
	Analysis,
	AnalysisCore,
	Actor,
	CastMark,
	CastRow,
	DeathMark,
	FightDataset,
	GearSummary,
	LostCastRow,
	MeasuredGcd,
	PotionAudit,
	RaidBuffSummary,
	ResourceBarAudit,
	SpecAuditResult,
	TargetMode,
	Window,
} from '~/lib/types';
import { type AuraWindow, auraWindows } from './auras';
import {
	buildCastTable,
	castSeries,
	measureCastDurations,
	channelTickTimes,
	measureChannels,
	type CastPress,
	type CastSeries,
	type Channel,
} from './casts';
import { cooldownDrift } from './cooldowns';
import { aggregateDamage, damageByTarget, primaryTargetID } from './damage';
import { pointsResourceAudit, poolResourceAudit, resourceSamples, wclPowerTypeOf } from './energy';
import { engagedWindows } from './engagement';
import { readGear, readTalents } from './gear';
import { buildReplay } from './replay';
import { segmentPull } from './segments';
import { complementOf, intersect, type Interval, unionMs } from './intervals';
import { enforcedDowntime, unavoidableWindows } from './enforced';
import { makeLinker } from './links';
import { RAID_BUFF_NAMES, readRaidBuffs } from './raidBuffs';
import {
	countAt,
	intervalsAtLeast,
	isJudgeableTarget,
	observeSpawns,
	spawnLives,
	spawnRecords,
	targetCounts,
	type SpawnLife,
	type TargetHit,
} from './targets';
import { median, r1 } from './format';

/**
 * Everything the core computed that a spec's audit may read — and the only thing it may read.
 *
 * The audit is a pure function of this object: same handles, same answer. That is what lets a second
 * spec be written without touching the core, and what lets the core be tested once for every spec.
 */
export interface Handles {
	code: string;
	fight: FightDataset['fight'];
	actor: Actor;
	events: readonly WclEvent[];
	actors: readonly Actor[];
	/** Fight-relative clock origin; every timestamp in the handles is relative to it. */
	t0: number;
	duration: number;
	/** Names for ids the registry does not model: damage table, raid-buff roster, then the spell map. */
	nameOf(id: number): string;
	/** A WarcraftLogs event link for a fight-relative timestamp. */
	link(t: number): string;
	/** The player's own events (`targetID` = actor), for self-buff walks. */
	selfEvents: readonly WclEvent[];
	/** Every Stormlash Totem placement in the fight, from every shaman — the raid-wide Stormlash view. */
	raidStormlash: readonly WclEvent[];
	registry: Registry;
	/** Casts grouped by ability, exactly as the cast table was built from. */
	series: Map<string, CastSeries>;
	castList: CastRow[];
	// ## Which of the three a consumer should reach for
	//
	// The ruling, written here because this is the one place all of them are read from and an audit of the
	// twenty call sites across the two specs found only three that said which clock they were on:
	//
	// - Grading a **choice** — did the list want this button, was the proc up when they decided, was the
	//   cooldown ready when they chose — reads `castBeginTimes`. The conditions were true or false at the
	//   commit, and that is the thing being graded.
	// - Measuring an **effect** — what a snapshot took, when a dot went on, when a totem began occupying
	//   its slot, how long a channel locked the player out — reads `castTimes`. The game decides those at
	//   the completion.
	// - A **join key** against another event stream reads whichever clock the other side is stamped on,
	//   which in practice is always `castTimes`: a resource reading or a buff application exists only on
	//   the `cast` event. `CastMark.t` and `AplPress.t` stay landings for exactly this reason.
	// - A site with one of each — the press's verdict *and* the effect it had — takes both and says so.
	//   `castPresses` exists for that: each press carries `begin` and `t` together rather than forcing a
	//   caller to line two arrays up.
	//
	// Two things this ruling does not settle, and both are live traps rather than hypotheticals. A landing
	// used as a **map key** couples to whatever populated the map, so a choice-grading list and the
	// `castPresses` map keyed for it have to move clocks in the same edit or every lookup silently misses
	// and falls through to a default. And most consumers are correct today only because their button is an
	// instant: 18 of those 20 sites read a button with no cast time at all, so the clock they picked has
	// never been tested. `castTimes` is deliberately still the pre-`begincast` meaning for that reason — a
	// consumer nobody has looked at is reading what it always read, rather than having been re-pointed by
	// a sweep.
	/**
	 * When each press of this button *landed*, in log order.
	 *
	 * The landing instant, so read it for a question about the effect and not about the choice. For a
	 * cast-time spell it is up to ~2.5s later than the moment the player committed, which is
	 * `castBeginTimes`. Unchanged in meaning since before both existed, so a consumer that has not been
	 * looked at is still reading what it always read rather than having been quietly re-pointed.
	 */
	castTimes(ability: Ability): number[];
	/**
	 * When each press of this button was *committed* — its `begincast`, or the cast instant for an
	 * instant press.
	 *
	 * The decision instant, and what anything grading a *choice* should read: the priority list's
	 * conditions were true or false at the moment the player pressed, not two seconds later when the
	 * spell arrived. Element-for-element with `castTimes`, and identical to it for a spec of instants.
	 */
	castBeginTimes(ability: Ability): number[];
	/**
	 * The same presses carrying the enemy spawn each was *aimed at*.
	 *
	 * For a button that can be aimed — a dot, a spirit, a taunt — the target of the press and the enemy
	 * the player happened to be hitting around it are different claims, and only the press's own event
	 * can answer the first. An audit grading a deliberate second dot on an add against the boss it was
	 * standing next to is grading the wrong enemy.
	 */
	castPresses(ability: Ability): CastPress[];
	castCount(ability: Ability): number;
	/** The measured channels, keyed by ability key — one entry per ability with a `channel` in the model. */
	channels: ReadonlyMap<string, Channel[]>;
	/** This player's damage (pets folded in), the per-ability table, and the sum it was taken against. */
	damageEvents: readonly DamageEvent[];
	abilities: AbilityDamage[];
	eventTotal: number;
	gear: GearSummary;
	raidBuffs: RaidBuffSummary;
	/**
	 * The ability ids `combatantinfo` says were already on the player when the pull started.
	 *
	 * The third rung of `auraWindows`' pre-pull evidence, and the only one that can see an aura which
	 * left no event at all — applied before the pull and never removed inside it, so there is no apply
	 * and no removal to pair or to orphan. Published here rather than re-read per lane because it comes
	 * off the same free `combatantinfo` event `gear` and `raidBuffs` above already read, so consulting
	 * it costs no request and one reader cannot disagree with another about what the list said.
	 *
	 * **It proves presence and never absence** — see `pullAuras` in `raidBuffs.ts`, where a monk's own
	 * Legacy of the Emperor is provably up at the pull and simply missing from this list — so a lane
	 * that *grades* must not read silence here as a fault, and must not read a window inferred from it
	 * as proof of a press.
	 */
	pullAuras: ReadonlySet<number>;
	/** The enemy this pull was about, and the share that decided it. */
	primaryID: number | undefined;
	primaryGameID: number | null;
	primaryName: string | null;
	primaryDamageShare: number;
	singleTarget: boolean;
	/**
	 * The boss's clock (`engaged`) and the player's (`contact`). Both matter and neither replaces the
	 * other: a figure that grades a choice is measured over the time the player had a choice, which is
	 * `contact`; a figure that describes the boss's own reachability is `engaged`.
	 */
	engaged: Interval[];
	engagedMs: number;
	contact: Interval[];
	inContactMs: number;
	/**
	 * Every hit the player landed themselves: when, and on whom. Ticks and pets are out, and so is
	 * anything landed on a unit that was never a target — see `spawnLives`.
	 */
	landedHits: Array<TargetHit & { key: string; abilityID: number | null }>;
	/**
	 * What the log knows about each enemy spawn the player touched, keyed by `instanceKey`.
	 *
	 * Published so an audit that asks a *narrower* question than "was this a target" — a dot's reader,
	 * which also cares whether the unit was going to be there long enough to be worth a global — reads
	 * the same facts through the same `isJudgeableTarget` predicate rather than deriving its own.
	 */
	spawnLives: ReadonlyMap<string, SpawnLife>;
	multiTargetWindows: Interval[];
	/**
	 * The same `>= 2` series with the parsing ruleset's strikes **left in** — the floor a dot rule wants.
	 *
	 * `multiTargetWindows` above answers "was there a second enemy worth turning towards", and in parsing
	 * mode a struck body is not one: its damage does not count, so a stretch spent on it is not evidence
	 * the pull was multi-target. That is right for every rule banded on the target count and wrong for one
	 * rule, because a dot on a second body is not paid for by that body's health bar.
	 *
	 * **A Flame Shock on a struck add still funnels into the boss.** Its ticks roll Lava Surge, and the
	 * Lava Bursts those procs pay for are cast at the primary — so the global spent dotting an add whose
	 * own damage WarcraftLogs strikes is still a global that raised single-target damage. Suppressing the
	 * rule there does not withhold a judgement, it invents a fault: the report stops asking for a dot the
	 * shaman was right to apply, and a reader in parsing mode is told to do less of the correct thing.
	 *
	 * So this keeps `ignoredMultiTargetActors` — a Blackfuse Shredder at 90% damage reduction is a
	 * different claim, about a body nobody is really fighting — and drops only the mode's own strikes.
	 * Identical to `multiTargetWindows` in progression mode, where nothing is struck at all.
	 */
	dotMultiTargetWindows: Interval[];
	/**
	 * The `>= 3` ladder series with the same strikes left in — the *ceiling* that floor has to be paired
	 * with.
	 *
	 * A band cut needs both edges from the same reading of the target count, and moving only the floor is
	 * how the multi-dot clock came out longer in parsing mode than in progression: the struck body stopped
	 * raising the ladder's count too, so stretches that were the aoe list on the pull as fought fell back
	 * into the band this rule is graded at, and the rule was asked of moments it does not exist at.
	 *
	 * Which is the mirror of the reason the floor moved. A struck add is still a body: it still makes the
	 * third enemy that puts the shaman on `aoe.apl.json`, where there is no multi-dot rung at all. The dot
	 * is worth a global at two enemies whatever the ruleset thinks of the second one, and it is not the
	 * rung being run at three whatever the ruleset thinks of the third.
	 */
	dotAoeWindows: Interval[];
	/** The stretches the aoe list applied to — band 3 or more. See where it is built for why three. */
	aoeWindows: Interval[];
	multiTargetMs: number;
	/** The time with at least one enemy in the count window — the target mode's denominator. */
	contactMs: number;
	/**
	 * The live enemy count read at each press, with the spec's own multi-target evidence excluded.
	 *
	 * The **damage** count: units that actually took damage. What almost every ladder rule wants, because
	 * almost every rule is about damage dealt.
	 */
	aplTargetCountAt(t: number): number;
	/**
	 * The same reading counting every unit the player *hit*, damage or not — what a hit-count trigger
	 * fires on. Only a rule whose ability declares `targeting.multiTargetBenefit: 'trigger'` should band on it.
	 */
	triggerTargetCountAt(t: number): number;
	/**
	 * The declared bars, fully audited: a pool bar (cap time, regen rate) or a points bar (the
	 * reconstructed walk, the overflow) under the key the spec named it with. The engine computed
	 * these from the spec's `resources` config — the spec's audit reads its bars here instead of
	 * rebuilding them.
	 */
	resourceAudits: Record<string, ResourceBarAudit>;
	/**
	 * The encounter's phase transitions, joined to their names — `[]` when WarcraftLogs reports none.
	 *
	 * On the handles because a spec's audit is the second thing that asks: the core puts them on the
	 * timeline, and a rule that excuses a phase needs the same list rather than a second reading of it.
	 * Empty covers both "this encounter has no phases" and "this dataset predates the fetch"; nothing
	 * here can tell those apart and nothing should pretend to.
	 */
	phases: readonly FightPhase[];
	/**
	 * The pull's global clock, as the core measured it — the three numbers every "how many presses did
	 * this pull have room for" figure divides by.
	 *
	 * On the handles because a spec's own audit is the second thing that asks. `AnalysisCore` publishes
	 * the same values for the report to render; these are the same ones, before the spec's half runs,
	 * so the two halves of the analysis cannot disagree about how long a global was.
	 *
	 * `effectiveGcd` is **measured**, not declared: the median observed gap after an instant press,
	 * floored at `GCD_MIN_MS` and capped at the spec's own `gcdMs`. For a spec whose global moves with
	 * haste that median *is* the hasted global, which is why nothing about a haste model is needed to
	 * count globals — see `lib/analysis/haste`, which models the cooldowns instead.
	 */
	effectiveGcd: number;
	/**
	 * The same median before either end of the clamp — the reading, rather than the divisor.
	 *
	 * Here so an audit that wants to *check* a model of the global has something the model cannot have
	 * already agreed with. `effectiveGcd` above is capped at `spec.gcdMs`, and a spec that declares its
	 * floor as its GCD gets the same number back on every pull. See `MeasuredGcd`.
	 */
	measuredGcd: MeasuredGcd;
	/** WarcraftLogs' own active time for this player, falling back to the pull's length. */
	activeMs: number;
	/** How many globals the pull had room for: `activeMs` over `effectiveGcd`, floored. */
	gcdSlots: number;
	/** Presses that actually cost a global. */
	onGcdCasts: number;
	/** Cooldowns that sat ready and unused, judged against the engaged windows. */
	lostCasts: LostCastRow[];
	/**
	 * One mark per press, flattened out of the per-ability buckets, deduplicated — and nothing else.
	 * The spec's audit may decorate them (Storm, Earth and Fire carries the enemy it sent a spirit to)
	 * and returns the final marks as `timeline.casts`.
	 */
	marks: CastMark[];
	/** The potion's windows, including one that was already running when the pull started. */
	potionWindows: Window[];
	/**
	 * The raid's haste cooldown on this player — the Bloodlust group, whoever cast it — and the Troll
	 * racial's own burst, each window carrying the variant that opened it.
	 *
	 * Here so a spec's audit reads the cooldown rather than re-deriving it. Published unfiltered: a
	 * window trimmed to one section's question is the wrong picture for the next section, so the
	 * trimming belongs to the caller.
	 */
	hasteWindows: AuraWindow[];
	berserkingWindows: AuraWindow[];
	/** The thresholds a reader owns, clamped against the spec's own schema — an audit reads the keys its schema declared. */
	settings: AnalysisSettings;
}

/**
 * A spec's claim to a game: the model that names its buttons, the numbers the core has to know to
 * measure a pull in its currency, and the two hooks that turn a pull into its half of the analysis.
 */
export interface SpecConfig {
	specName: string;
	registry: Registry;
	/** One global's length. Windwalker's abilities cost energy and chi, so haste does not shorten it. */
	gcdMs: number;
	/**
	 * How far this spec reaches, in yards — `MELEE_YARDS` or `CASTER_YARDS` from `./replay`.
	 *
	 * **Declared, and the sim is where the answer comes from.** The replay draws it as a ring around the
	 * player, which is the only thing on that map turning a distance into something a reader can judge.
	 * It was briefly measured off each pull's own hit distances instead, which reads well and answers a
	 * different question: a caster who spent one pull in melee would have been handed a melee ring, and
	 * how far a spec reaches is not a fact about one pull. Set it the way `gcdMs` is set.
	 */
	reachYards: number;
	/** Names for ids the model deliberately does not carry — see the module doc in `spec/windwalker`. */
	extraNames: Record<number, string>;
	/**
	 * What one press of an id the model does not carry costs, as a fraction of this spec's own global.
	 *
	 * **The rule this exists for: a global spent while the player was in contact must be measured.** An
	 * id that is only *named* resolves to no `Ability`, so `abilityByCastId` returns `undefined`, so the
	 * walk below skipped it and it occupied zero milliseconds — a player who spent a real global on it
	 * read as one who pressed nothing. Fourteen Healing Spheres, two Tiger's Lusts, a Purge, a Ghost
	 * Wolf and both of a monk's own Legacy buffs were being priced at nothing on committed pulls.
	 *
	 * **A fraction and not a duration, because the game's number is a base and the pull's is measured.**
	 * `SpellCooldowns.StartRecoveryTime` (joined on `SpellID`, in the simulator's
	 * `tools/database/wowsims.db`) is the global a spell triggers *before haste*, and it is a base for
	 * that spell's class: every Windwalker button reads 1000 there and every Elemental one reads 1500,
	 * so the same 500ms Healing Sphere is half a monk's global and a third of a caster's. Writing 500
	 * here would be right for the monk by coincidence and wrong for the next spec, and it would ignore
	 * haste on a spec that has any. So each spec states `StartRecoveryTime(id) / StartRecoveryTime(its
	 * own rotational button)` and the engine multiplies that by the pull's **measured** `effectiveGcd`.
	 *
	 * **A sibling table rather than a richer `extraNames`, and the reason is what `extraNames` holds.**
	 * That map is read by `nameOf` for any id a *damage* row can carry, so most of its entries are
	 * mastery overloads, weapon procs, meta gems and pet spells — things that never appear as a `cast`
	 * at all and have no global to state. Widening its value type would force twenty-odd passives per
	 * spec to answer a question that does not apply to them, and the honest answer would be a zero
	 * indistinguishable from "a real button nobody priced". This table carries an entry only where a
	 * press exists, so its length is the length of the census. It also lets a spec price a press whose
	 * *name* is settled elsewhere: the two Legacy buffs are named in the shared `RAID_BUFF_NAMES`
	 * roster, and what a monk's global costs a monk is not a fact that roster could hold.
	 *
	 * `0` means genuinely off the global and is the right answer for most of what lands here — Roll,
	 * Provoke, Zen Meditation, Shamanistic Rage and the melee swing all read `StartRecoveryTime` 0. It
	 * is not a *default*, though, which is the whole of the guard: `analysis/__tests__/fixtureCoverage.test.ts`
	 * fails on any unmodelled id a committed fixture presses that has no entry here, so the next button
	 * cannot slip through by being silent. Absent and zero mean different things, and only one of them
	 * is a decision.
	 */
	extraGlobals: Record<number, number>;
	/**
	 * The resource bars this spec's rotation spends, keyed by the name the audit reads them under.
	 *
	 * Declared in the sim's own vocabulary (`~/lib/game/resources` — its `spell.proto` `ResourceType`
	 * and `SecondaryResourceType` enums), so a bar is named the way the sim names it and never by a
	 * bare number. The engine samples every declared bar, computes its full audit, and publishes it
	 * as `analysis.resources[key]`; a spec that spends no bar declares none and draws no resource
	 * section.
	 */
	resources: Record<string, ResourceConfig>;
	/**
	 * Bars the spec computes itself, drawn beside the declared ones and **ahead** of them.
	 *
	 * The declared `resources` above are sampled generically: the engine reads a power type off
	 * `classResources` and audits it. Some readings a spec wants on the same axes cannot come from
	 * there — a tank's Vengeance is attack power, which the log staples onto events as a plain field
	 * rather than as a bar, and whose ceiling is the player's own maximum health.
	 *
	 * Called after `audit()` so a spec can hand back something it has already computed rather than
	 * measuring the pull twice, and merged **first** so these draw above the declared bars:
	 * `CastTimeline` derives its lane order from `Object.keys`, so key order *is* row order.
	 *
	 * Generic on purpose. Vengeance is every tank's, not a Paladin idea, and the seam is what lets a
	 * future Blood or Guardian spec put the same reading on the same chart without touching the engine.
	 */
	extraResources?(h: Handles, audit: SpecAuditResult): Record<string, ResourceBarAudit>;
	/**
	 * The spec's report colours, derived from its class's primary colour as wowsims-mop defines it
	 * (`ui/core/player_classes/*.ts` `hexColor`) — see `~/lib/game/classes`. The bars and accents of
	 * the spec's sections draw in these, so each spec's report is recognisable at a glance.
	 */
	colors: SpecColors;
	thresholds: {
		/** The trailing window a target count is taken over. */
		targetWindowMs: number;
		/** The multi-target share a pull must reach before it reads as multi-target. */
		multiTargetSharePct: number;
		/** The primary-target share a pull must reach before it reads as single-target. */
		singleTargetSharePct: number;
		/** How long without a hit before an engaged stretch ends. */
		engagedGapMs: number;
	};
	/**
	 * Actors that do not count as useful multi-target damage, resolved from the fight's NPC list.
	 *
	 * They are dropped from the fan-out count and only from it: the damage was dealt and belongs in
	 * the table, but a swing that spread across enemies the spec does not count is not evidence that
	 * an area button had that many targets.
	 */
	ignoredMultiTargetActors(
		encounterID: number | undefined,
		enemyNPCs: readonly { id: number; gameID?: number | null }[] | undefined,
	): ReadonlySet<number>;
	/** Abilities whose cooldown only matters while the boss was up — their drift windows are clipped to `engaged`. */
	needsTarget: ReadonlySet<string>;
	/** The widest a same-press pair of casts can be and still be one press. */
	samePressMs: number;
	potion: {
		abilityKey: string;
		auraKey: string;
		/** The ceiling the count is printed against — two per pull, one before it and one inside. */
		slots: number;
		/** How long a press locks the category cooldown, which decides whether the second slot was on offer. */
		categoryCooldownMs: number;
	};
	/**
	 * Abilities whose damage must not establish multi-target evidence for the priority list.
	 *
	 * The target count and the APL's live count are read off the same hits — except these, whose
	 * periodic damage would keep the ladder in its multi-target branch long after the adds are gone.
	 */
	aplTargetCountExclude?: readonly string[];
	/**
	 * This spec's cooldowns at a moment in the pull, for a spec whose cooldowns move with haste.
	 *
	 * Absent on every spec whose cooldowns are fixed, which is both of the first two, and every drift
	 * figure on their captures is unchanged by this existing — `cooldownDrift` takes the declared
	 * number when nothing is passed. A spec that declares `hasteScaled` on an ability declares this
	 * too, and the two together are the whole of the feature.
	 *
	 * Built from the dataset rather than from the handles, because the handles are what it feeds: the
	 * curve needs the haste rating off `combatantinfo` and the Bloodlust windows, and both are read
	 * before the cast tables that consume it.
	 */
	cooldownAt?(dataset: FightDataset, ability: Ability, t: number): number;
	/** Whether this player was actually playing the spec. False means the UI must refuse to render. */
	identify(h: Handles): boolean;
	/** The spec's half of the analysis, computed from the handles and nothing else. */
	audit(h: Handles): SpecAuditResult;
	/** The thresholds a reader may disagree with, clamped against these before anything reads them. */
	settings: SettingSchema[];
}

/** How the target-count audit keys the "one enemy" reading. Same pair the debuff walk buckets on. */

/**
 * The shortest global the game will hand out: the cap haste is allowed to pull the GCD down to.
 *
 * One number, exported, because two things need it and a second copy is how two things come to
 * disagree about one rule. `analyseCore` floors its measured `effectiveGcd` here — a median of observed
 * gaps can only ever be at or above the floor — and `charts/castRows.ts` uses it as the ceiling on how
 * much track one press icon may reserve, which is the only bound that makes "two presses a global apart
 * share a row" true at every zoom rung.
 */
export const GCD_MIN_MS = 1000;

/**
 * The id every melee auto-attack in the game is logged under.
 *
 * Not a spec's number and deliberately not a spec's declaration: an auto-attack has no button behind it,
 * so no `Ability` can carry `targeting.aimed` for it however many a spec declares. It is the one aimed
 * hit the model structurally cannot state, which is why the sweep below adds it by hand.
 *
 * **It is written out in three places and this comment is the map**, rather than a fourth copy pretending
 * to be the only one. Both specs name `1: 'Melee'` in their `extraNames` — the names table, a different
 * question — and the Windwalker's `SINGLE_TARGET_DAMAGE_IDS` writes it for its Storm, Earth and Fire
 * audit. Collapsing the three would mean giving one module the say over what the other two mean by it,
 * and the three mean three things; the shared fact is the game's, not this engine's.
 */
const MELEE_DAMAGE_ID = 1;

/** The full analysis of one fight for one spec. */
export function analyseCore(
	dataset: FightDataset,
	settings: AnalysisSettings,
	spec: SpecConfig,
	mode: AnalysisMode = DEFAULT_ANALYSIS_MODE,
): Analysis {
	// The thresholds the reader owns, clamped against the spec's own schema. Everything else here is
	// the spec's; these are theirs, because they describe their latency and their hands rather than
	// the rotation.
	const clamped = clampSettings(settings, spec.settings);
	// Passed to every `cooldownDrift` call this pass makes, and there are two: the lost-cast row below
	// and the Blackout Kick audit, which measures starvation inside the drift windows that row reports.
	// One value threaded through both is what keeps "the kick sat ready for 12s" and "9s of that was
	// chi" two readings of one clock rather than two clocks.
	const cooldownLeewayMs = clamped.cooldownLeewayMs;

	const { code, fight, actor, events, table, actors, raidStormlash } = dataset;
	const t0 = fight.startTime;
	const duration = fight.endTime - fight.startTime;
	const entry = table.damageDone.entries.find((x) => x.name === actor.name);
	/**
	 * WarcraftLogs' own `activeTime` for this player, off the damage table — **not a clock this engine
	 * builds**, and the last figure in the report that can be checked against the WCL site.
	 *
	 * What it actually measures, established on the four raw fixtures rather than assumed. It is a
	 * *presence* span, not an occupancy one: on `cleave` and the Windwalker's `ironJuggernaut` it equals
	 * the span from the player's first damage event to their last **to the millisecond** (261 572ms and
	 * 189 735ms), across gaps of up to 3 985ms in which nothing of theirs landed, and it counts the DoT
	 * ticks and the pet damage this engine's contact clock rejects. So it answers "did the log see
	 * something of yours land inside this window", which is close to "were they in the fight" and a long
	 * way from "were they pressing something". On `phased` — the only committed fixture with real downtime
	 * — it keeps 32 689ms that `inContactMs` drops: the submerge from 142.3s to 192.5s the player spent
	 * healing, 370 heal events between 145 219ms and 245 954ms.
	 *
	 * Three readers left, and the clock each one should be on is argued where it is assembled (`cpm`,
	 * below): `activePct`, `gcdSlots`, and the field itself, republished so the gap between the two clocks
	 * stays visible. `totalCpm` and every per-ability rate used to be here too and are now on `contact`.
	 *
	 * **The fallback is loud, following `uptimePct`'s precedent in `auras.ts`.** A player with no row in
	 * the damage table — a healer, or someone who died before landing a hit; `resolvePlayer` will hand
	 * either of them over, since the only gate is `friendlyPlayers` — silently moved every reader onto the
	 * pull length, and `activePct` printed exactly 100.00% for the one player it can say nothing at all
	 * about. That reads as a flawless pull rather than as a missing row. Measured on `cleave` with the
	 * actor renamed: `activePct` 99.37 → 100.00. A warning rather than a throw for the reason `uptimePct`
	 * gives — a report is a read-only view of a log and the rest of the page is unaffected — and it names
	 * both spans, so the substitution is visible rather than inferred.
	 *
	 * **The blast radius of that fallback is two fields narrower than it was.** `totalCpm` and the
	 * per-ability rates are on the contact clock now, which is built from the player's own damage events
	 * and does not care whether the damage table carried a row for them: on the renamed `cleave` actor
	 * they stay at 46.79 rather than drifting to 46.50. `activePct` and `gcdSlots` are still exposed to
	 * it, which is why the warning is still worth printing.
	 */
	if (entry === undefined && import.meta.env.DEV) {
		console.warn(
			`[analyseCore] no damage-table row for ${actor.name}: WarcraftLogs' activeTime is unavailable, so the ` +
				`${duration}ms pull length is standing in for it. activePct will read 100%, and gcdSlots is ` +
				`counted over the pull rather than over the active span. The cast rates are unaffected: they ` +
				`are per contact minute, off this player's own damage events.`,
		);
	}
	const activeMs = entry?.activeTime ?? duration;

	const tableNames: Record<number, string> = {};
	for (const e of table.damageDone.entries) {
		for (const a of e.abilities ?? []) tableNames[a.guid] ??= a.name;
	}
	// Only ever asked about ids the registry does not model: the primitives take an ability's own
	// name when they have one. The residual list wins over the damage table, which names by damage
	// id and so cannot tell a proc from the trinket that fired it.
	//
	// The raid-buff roster sits between them for that same reason and answers a case the damage table
	// structurally cannot: it names by the id the *caster* presses, and a buff the Monk casts on the
	// raid does no damage at all — so Legacy of the Emperor and Legacy of the White Tiger reach the
	// cast timeline as presses that nothing downstream of here could ever have named.
	//
	// The generated spell map sits last, immediately before giving up. It is a static dictionary built
	// from the simulator's database and topped up from Wowhead, so it knows the utility buttons and
	// boss abilities the three sources above have no reason to carry — Transcendence, Zen Meditation,
	// Detox, Mortal Wounds. Deliberately *below* the damage table rather than above it: the table is
	// this log's own account of what happened and is specific to it, while the map is general, so the
	// map may only answer where the alternative was rendering a bare `#id` at the reader.
	const SPELL_NAMES = SPELLS.spells as Record<string, { name: string; icon: string }>;
	const nameOf = (id: number): string =>
		spec.extraNames[id] ?? RAID_BUFF_NAMES.get(id) ?? tableNames[id] ?? SPELL_NAMES[String(id)]?.name ?? `#${id}`;

	/** Actor id to name, built once — the same reason `petIDs` and `enemyIDs` below are sets. */
	const actorNames = new Map(actors.map((a) => [a.id, a.name]));

	const petIDs = new Set(actors.filter((a) => a.petOwner === actor.id).map((a) => a.id));
	const mine = (id: number | undefined): boolean => id !== undefined && (id === actor.id || petIDs.has(id));
	const link = makeLinker({
		code,
		fightID: fight.id,
		sourceID: actor.id,
		fightStart: t0,
	});
	const selfEvents = eventsOn(events, actor.id);

	// ------------------------------------------------------ cast durations
	// Measured before the cast series rather than after it, which is the whole point: the series needs
	// them to know when each press was *committed*, and for a while it did not have them — so the GCD
	// walk below anchored occupancy at the `begincast` while every consumer of the series read the
	// landing, and the two disagreed by a full cast time. See `measureCastDurations`.
	const { durations: castDurations, cancelled: cancelledBegins } = measureCastDurations(
		events,
		actor.id,
		t0,
		spec.registry,
	);

	// ------------------------------------------------------------------ casts
	// Keyed by ability, so Jab's two weapon ids are one row and a channel's ticks are not presses.
	const series = castSeries(events, actor.id, t0, spec.registry, castDurations);
	// The per-ability table is built further down, below `inContactMs`, because its rates are per
	// contact minute and a clock cannot be divided by before it is measured. Only the table moves;
	// `series` stays here, where the presses every audit reads are keyed.

	const castTimes = (ability: Ability): number[] => series.get(ability.key)?.times ?? [];
	const castBeginTimes = (ability: Ability): number[] => series.get(ability.key)?.beginTimes ?? [];
	const castPresses = (ability: Ability): CastPress[] => series.get(ability.key)?.presses ?? [];
	const castCount = (ability: Ability): number => series.get(ability.key)?.count ?? 0;

	// ----------------------------------------------------------------- channels
	// Every ability whose press locks the player out is measured at its real length from its tick
	// stream, so haste is already in the number. Windwalker has one; a spec may have none or several.
	//
	// **`castTimes` and not `castBeginTimes`, and it is the right one rather than the untouched one.** A
	// channel has no cast bar: the log writes its `cast` at the instant the channel *starts*, and the
	// ticks that follow are timed from there — which is what `measureChannels` needs, since it claims the
	// ticks in `[start - leadMs, start + maxMs]` and would lose the first one to a start placed early.
	// The two clocks agree here anyway, and measurably so rather than by assumption: 0 of 394 presses on
	// `dataset-ironJuggernaut` have `begin < t`, Fists of Fury included, so nothing pairs a `begincast`
	// with this spec's one channel at all. The day a spec declares a channel behind a real cast bar, this
	// still wants the landing — the lockout starts when the channelling does.
	const channels = new Map<string, Channel[]>();
	for (const ability of spec.registry.abilities) {
		if (!ability.channel) continue;
		channels.set(ability.key, measureChannels(castTimes(ability), channelTickTimes(events, ability, actor.id, t0)));
	}

	// ----------------------------------------------------------------- damage
	// Resolved here rather than beside the target count further down, because both readers need it and
	// the damage table is the earlier of the two. See `ignoredMultiTargetActors` on the spec config.
	const ignoredMultiTargetIDs = spec.ignoredMultiTargetActors(fight.encounterID, table.fight.enemyNPCs);
	/**
	 * The bodies WarcraftLogs strikes off a ranking, where striking off the damage strikes off the enemy.
	 *
	 * **Damage that does not count must not raise the enemy count either**, which is the whole of the
	 * rule and is what `reach: 'both'` says on a row of `game/rankingExclusions`. Rows reaching only the
	 * damage stay in the count: an add whose damage is discounted was still a body in front of the
	 * player, and the rotation had to deal with it.
	 *
	 * Joined to the filter beside it rather than made a series of its own, and that is deliberate. This
	 * file already publishes three readings of "how many enemies" — the damage count, the ladder's, and
	 * the hit-count a trigger fires on — and its own comments record what a reading free to disagree with
	 * the others costs. A fourth would be that mistake again; a second predicate on one filter cannot
	 * drift from anything.
	 *
	 * Measured reach: two of the thirteen rows carry `both` — Blood on the Paragons and Minion of Y'Shaarj
	 * on Garrosh — and **both are heroic-only**, so a Normal pull's counted series is the raw one by
	 * construction. Neither has a committed pull, so nothing in the fixture tree is uncounted today;
	 * `game/__tests__/exclusionEvidence.test.ts` keeps a column pinned at zero for the day one arrives.
	 *
	 * Malkorok's Living Corruption was the third until `uncounted.json` was measured against it and found
	 * four of its twenty bodies held past a target window, which the table's own header says makes a body
	 * one the rotation had time to react to. That row is `'damage'` now and this pull publishes a peak of
	 * three enemies where it published one.
	 */
	const uncountedIDs = uncountedActorIDs(fight.encounterID, fight.difficulty, table.fight.enemyNPCs, mode);
	const damageEvents = events.filter(isDamage).filter((e) => mine(e.sourceID));
	/**
	 * Which enemy spawns were ever targets at all — the question before "how many of them were there".
	 *
	 * Derived from the log rather than declared, which is the difference between this and
	 * `ignoredMultiTargetActors` beside it: that list is a static judgement about an NPC type, while a
	 * unit nothing can damage says so itself, in every hit it returns. Computed once here so the fan-out
	 * count in the damage table and the per-moment count further down cannot disagree — which is the
	 * mistake `ignoredMultiTargetActorIDs`' own comment records having already made once.
	 */
	/**
	 * One walk over the damage stream, reduced two ways below — the lives every dot reader takes, and the
	 * published spawn table. `observeSpawns`' own docblock carries why that is one walk and not two.
	 *
	 * The aimed set is handed over here even though `spawnLives` reads none of it, because the *records*
	 * do and the two must not be observed differently. A spec that declares no aimed button hands over an
	 * empty set and publishes no records at all — see `spawns` below.
	 */
	const declaredAimedIds = spec.registry.abilities
		.filter((ability) => ability.targeting?.aimed === true)
		.flatMap((ability) => ability.damageIds ?? []);
	const aimedDamageIds = new Set([MELEE_DAMAGE_ID, ...declaredAimedIds]);
	const observedSpawns = observeSpawns(damageEvents, t0, aimedDamageIds);
	const spawnLifeByKey = spawnLives(observedSpawns, duration, spec.thresholds.targetWindowMs);
	const immuneSpawns = new Set([...spawnLifeByKey].filter(([, life]) => !isJudgeableTarget(life)).map(([key]) => key));
	/**
	 * The same walk kept whole: one row per enemy **body**, published as `Analysis.spawns`.
	 *
	 * Here rather than beside the count series further down, and that placement is the point.
	 * `spawnRecords` and `spawnLives` are two readings of one *walk* over `damageEvents` — `targets.ts`
	 * says so in as many words, and says a second implementation of that walk is how the two would come
	 * to disagree about when a spawn was first touched. Built on the line below the reading it shares the
	 * walk with, both take the same three arguments from the same expressions, and there is nowhere for a
	 * divergence to hide. They are still two *calls*, so the array is traversed twice; that is a cost
	 * rather than a risk, and `SpawnObservation` carries the note about when it stops being worth paying.
	 *
	 * ## Where the aimed set comes from, and why not the spec's own constant
	 *
	 * Swept off the model — every `Ability` declaring `targeting.aimed`, unioned over its `damageIds` —
	 * rather than imported from the Windwalker's `SINGLE_TARGET_DAMAGE_IDS`, which builds the same union
	 * from the same declaration and is not exported.
	 *
	 * `AbilityTargeting.aimed` is a **spec-agnostic** field in `game/model.ts` whose docblock is written
	 * for exactly this question ("the discriminator between a body a player fought and one their area
	 * damage happened to touch"), and this file is the spec-agnostic half of the engine: it already sweeps
	 * `spec.registry.abilities` for `channel` a hundred lines above. Reaching into one spec's private
	 * constant would make the core unable to answer for the other spec it serves, and it would tie this
	 * reading to a metric's needs rather than to the model's — that constant's own docblock argues its
	 * membership from *where an actor stood*, for the Storm, Earth and Fire audit, which is a different
	 * question that happens to have the same answer today. Two questions sharing one set by coincidence
	 * is not a reason to give them one name.
	 *
	 * Melee is added because it is declared nowhere and cannot be: there is no button behind an auto-attack,
	 * so no `Ability` can carry the flag for it. Id 1 is the game's number rather than a spec's — both
	 * specs already name it `Melee` in their `extraNames`, and the Windwalker's constant writes it out for
	 * the same reason this does. It is load-bearing here rather than tidy: 42 of the 60 aimed presses
	 * `rankingExclusions` quotes for Thok's `Kor'kron Jailer` are melee auto-attacks, and a body a monk only
	 * ever meleed would read as splash without it.
	 *
	 * ## Why a spec that declares none gets no `spawns` at all
	 *
	 * `SpawnRecordInputs.aimedDamageIds` refuses an empty set, and the reason it gives is the reason for
	 * the guard here: an empty aimed set makes **every** body on the pull read as splash, which is not a
	 * neutral answer but a wrong one shaped exactly like the finding `aimedPresses` exists to report — a
	 * table's worth of `reach: 'both'` verdicts handed out by a spec that simply never declared its buttons.
	 * The Elemental is that spec today: it declares no `targeting.aimed` anywhere, so the sweep finds
	 * nothing and melee alone would be a caster's aimed set, which is emptiness wearing a number.
	 *
	 * So the field is published only where the sweep found something, and absent means "this spec has not
	 * answered the question" rather than "no body was ever chosen". The two are indistinguishable in the
	 * rows themselves, which is why the difference has to live in whether there are rows at all.
	 */
	const spawns =
		declaredAimedIds.length === 0
			? undefined
			: spawnRecords(observedSpawns, {
					t0,
					endMs: duration,
					windowMs: spec.thresholds.targetWindowMs,
					excluded: uncountedIDs,
					// Straight through from the fetch, and absent is a real state rather than a default: the
					// three Windwalker pulls captured on 2026-08-24 carry it and every fixture older than that
					// does not. `SpawnRecord.deathMs` documents what a reader may and may not conclude from a
					// row with no death on it.
					...(dataset.enemyDeaths === undefined ? {} : { enemyDeaths: dataset.enemyDeaths }),
					// Both halves of the report's answer to "who is actor 237", merged because neither half is
					// whole. `enemyNPCs` carries `gameID` and `reportFights.graphql` asks it for no name at all;
					// the report's `actors` list carries the name and no `gameID`. A row that had only the first
					// could not be read by a human and one that had only the second could not be joined to a
					// ruleset written in `gameID`s.
					npcs: (table.fight.enemyNPCs ?? []).map((npc) => ({ ...npc, name: actorNames.get(npc.id) ?? null })),
				});
	const { abilities, eventTotal } = aggregateDamage(
		damageEvents,
		spec.registry,
		nameOf,
		ignoredMultiTargetIDs,
		immuneSpawns,
	);

	// ------------------------------------------------------------- the GCD
	/**
	 * Every press that took a global, and how much of one it took.
	 *
	 * **A press is here if the spec priced it, not if the spec modelled it.** It used to require an
	 * `Ability` with `onGcd: true`, which made "did this cost a global" a side effect of "is this on the
	 * priority ladder" — two different questions that a rotational button happens to answer the same
	 * way. Everything else a player presses answers them differently: a monk's Legacy of the White
	 * Tiger, a shaman's Purge, a Tiger's Lust to reach the next pack. None of those is on any ladder and
	 * every one of them costs the player a global they cannot spend on damage, and every one of them was
	 * priced at **zero** occupied milliseconds. `spec.extraGlobals` is where a named id states its cost
	 * and the docblock on that field argues its shape; `0` there — Roll, Provoke, the melee swing — is a
	 * decision and skips the press exactly as before.
	 *
	 * Measured rather than taken off the spec: the start of an instant full-global press to the start of
	 * the next press is exactly one GCD. Three kinds of pair are excluded from the sample and each for
	 * its own reason.
	 *
	 *   A **cast-time** spell's gap is its cast time, so a pair whose earlier press is a hard cast says
	 *   nothing about the global. That exclusion is the original one and is unchanged.
	 *
	 *   A **part-global** press — `globals < 1` — is the exclusion this lane added, and it is the reason
	 *   `globals` is carried on the row rather than resolved straight into the interval below. Healing
	 *   Sphere costs a monk half a global (`StartRecoveryTime` 500 against Jab's 1000) and the three
	 *   shaman totems cost two thirds of a caster's (1000 against Lightning Bolt's 1500). A press that
	 *   frees the player again after 500ms is followed 500ms later, so counting that pair would feed the
	 *   median a sample of half a global fourteen times over on `idle.json` and drag the estimate of the
	 *   *standard* global down — which is what this number is for, and what `gcdSlots` and `targetTails`
	 *   both read it as. **They occupy time and they do not vote**, which is the split the two loops
	 *   below make: the interval loop reads every row, the sample loop reads only the full ones.
	 *
	 *   A pair whose *later* press is part-global is kept, and deliberately: what that gap measures is
	 *   the **earlier** press's global, and the earlier press is a full one or the pair was already
	 *   dropped. Excluding it would throw away a sample for a property of the wrong press.
	 *
	 * **The sample count goes up, and that is the second half of the fix.** A press missing from this
	 * list did not merely cost nothing — it welded the two presses either side of it into one gap of two
	 * globals, and that gap was fed to the median as though it were one. Both effects are corrected by
	 * the same line, and the correction is measurable and small. Across the eight committed raw pulls the
	 * sample count rises by 1, 3, 1, 1, 2, 5, 4 and 1 — `ele/addsThenBoss` 111 → 112, `ele/cleave`
	 * 46 → 49, `ele/phased` 41 → 42, `ele/unbroken` 45 → 46, `ww/dataset-ironJuggernaut` 166 → 168,
	 * `ww/idle` 105 → 110, `ww/sections` 291 → 295, `ww/uncounted` 180 → 181 — and **`effectiveGcd` does
	 * not move on any of them**. The raw median under it moves on two, by one millisecond each and in
	 * opposite directions (`ww/idle` 1012 → 1013, `ww/uncounted` 1008 → 1007), and both are clamped to
	 * the Windwalker's flat 1000 before anything reads them. A median over forty-plus samples is robust
	 * and the welded gaps were a handful, so what this bought is a better-founded number rather than a
	 * different one. That it is small is worth knowing rather than assuming: `gcdSlots`, `aoeWindows` and
	 * `targetTails` all divide by this, and a large move would have reached them without anyone asking.
	 *
	 * Floored at the game's 1s minimum and capped at the spec's own GCD, so a fixed-GCD spec
	 * (Windwalker) keeps its declared value while a hasted one (Elemental) lands on what the log did.
	 */
	const onGcdStarts: Array<{ start: number; instant: boolean; duration: number; globals: number }> = [];
	for (const e of events) {
		if (e.sourceID !== actor.id || !isCast(e)) continue;
		const id = abilityIdOf(e);
		if (id === null || spec.registry.isChannelTick(id)) continue;
		const ability = spec.registry.abilityByCastId(id);
		// A modelled button is one global or none, which is the whole of what `onGcd` can say. An
		// unmodelled one says how much of a global it took, and `?? 0` is not a default the guard leaves
		// reachable — `fixtureCoverage.test.ts` fails on an unpriced press before it can be read here.
		const globals = ability === undefined ? (spec.extraGlobals[id] ?? 0) : ability.onGcd ? 1 : 0;
		if (globals <= 0) continue;
		const t = e.timestamp - t0;
		const duration = castDurations.get(`${id}:${t}`);
		onGcdStarts.push({ start: t - (duration ?? 0), instant: duration === undefined, duration: duration ?? 0, globals });
	}
	onGcdStarts.sort((a, b) => a.start - b.start);
	const gcdGaps: number[] = [];
	for (let i = 1; i < onGcdStarts.length; i++) {
		const previous = onGcdStarts[i - 1]!;
		if (!previous.instant || previous.globals < 1) continue;
		gcdGaps.push(onGcdStarts[i]!.start - previous.start);
	}
	const effectiveGcd = gcdGaps.length > 0 ? Math.max(GCD_MIN_MS, Math.min(median(gcdGaps), spec.gcdMs)) : spec.gcdMs;
	/**
	 * The same median with neither end of the clamp on it, published beside the clamped one.
	 *
	 * Two figures out of one measurement, because they answer two questions and only the clamped one
	 * can answer the first. `effectiveGcd` is a **divisor** — a slot count, a track width, a leeway —
	 * and a divisor has to be a plausible global whatever a nine-gap wipe hands it. This is
	 * **evidence**, and evidence that has been squeezed to fit the thing it is meant to check is not
	 * evidence: on a spec whose `gcdMs` is already `GCD_MIN_MS`, the floor and the cap meet, and the
	 * published figure is 1000ms on every pull however the presses fell. See `MeasuredGcd`.
	 */
	const measuredGcd: MeasuredGcd = {
		medianMs: gcdGaps.length > 0 ? median(gcdGaps) : null,
		samples: gcdGaps.length,
	};

	/**
	 * Where each on-GCD press sat on the clock — spans, not a sum.
	 *
	 * Time *occupied*, which is not the same as time *used*: a press that bought nothing occupies its
	 * global just as thoroughly as one that did. Each on-GCD press occupies its share of an effective
	 * GCD — one for a modelled button and whatever `spec.extraGlobals` declared for a named one, so a
	 * Healing Sphere occupies half of the pull's measured global rather than all of it or none of it —
	 * except a cast-time spell, which occupies its *measured* cast length (the begincast-to-cast gap,
	 * with haste and reaction already in it, so no base-cast-time scaling is needed), and a channel,
	 * which occupies its real measured length instead. The deduction for a press that bought nothing
	 * happens in the spec's audit, via `cpm.wastedGcds`.
	 *
	 * A press made outside the player's contact windows is *not* excluded here and must not be: it is
	 * dropped further down, by `occupiedMs`, from numerator and denominator together. That is the
	 * documented rule — a global spent during an intermission is neither counted as filled nor held
	 * against the player — and it only works because both halves are clipped to one clock. It is doing
	 * real work here: of `ele/phased`'s twenty-three newly priced presses, twenty-two are Chain Heals,
	 * Healing Rains and a Healing Surge cast while nothing was in reach, leaving one Healing Stream
	 * Totem inside contact and moving the pull's figure **+0.37**. `ww/idle`'s eighteen are five whole
	 * globals inside contact and thirteen presses outside, and it moves **+3.13**. Two pulls with
	 * comparable numbers of newly priced presses and an order of magnitude between their answers,
	 * decided entirely by where the presses fell.
	 *
	 * Kept as intervals rather than summed, because the total is about to be divided by a clock and a
	 * sum cannot be clipped to one. Two things a sum gets wrong, both of which push a share of a whole
	 * past 100%: two presses 900ms apart under a 1.0s global occupy 1.9s of the pull and sum to 2.0s,
	 * and a press whose bar runs past the last hit of a contact window occupies time the denominator
	 * does not contain. `occupiedMs`, below the contact clock, is where the clipping happens.
	 */
	const channelMsAt = new Map<number, number>();
	for (const list of channels.values()) {
		for (const ch of list) channelMsAt.set(ch.start, ch.channelMs);
	}
	const occupancy: Interval[] = onGcdStarts.map((c) => {
		// Looked up on the press's own start, which is where a channel is: a channel logs no cast bar, so
		// its `start` here is the `cast` instant, which is exactly the `start` `measureChannels` keyed its
		// measurement on. The effective global is deliberately *not* a floor under a channel — the same
		// arithmetic the summed version did by deducting one global per channel before adding the
		// measured channel time back.
		const channelMs = channelMsAt.get(c.start);
		const ms = channelMs === undefined ? Math.max(effectiveGcd * c.globals, c.duration) : channelMs;
		return [c.start, c.start + ms];
	});

	// Read from the `combatantinfo` the event fetch already returned, so this costs no request.
	const gear = readGear(events, actor.id);

	// The same event again, for the talent list. Published on the analysis rather than read per spec
	// because the compare page needs it for any spec: an ability one log took and the other did not is
	// "did not take it", and only these two lists can say so. `readTalents` answers three ways and the
	// array keeps all three — a list, an empty-of-this-id list, and null for a log that carried no
	// `combatantinfo` at all.
	const talents = readTalents(events, actor.id);

	// Beside the gear because it reads the same free `combatantinfo` — that event's aura list is the
	// only record of anything buffed before the pull, and without it a raid that buffs in the usual
	// place looks unbuffed.
	const raidBuffs = readRaidBuffs(events, actor.id, t0, fight.endTime);

	// The same event again, for the ids alone. `readRaidBuffs` keys its own copy by `id:source` because
	// it has to know *who* supplied a buff; an aura lane only ever asks whether the aura was there, so
	// the source is dropped here rather than making every caller strip it.
	const pullAuras = new Set<number>();
	for (const e of events) {
		if (!isCombatantInfo(e) || e.sourceID !== actor.id) continue;
		for (const aura of e.auras ?? []) {
			if (typeof aura.ability === 'number') pullAuras.add(aura.ability);
		}
	}

	// ----------------------------------------------------------- primary target
	// Which enemies the report itself calls bosses. WarcraftLogs marks them in the report's master
	// data — `type: 'NPC'`, `subType: 'Boss'` — which is the only place a boss is *named* rather than
	// inferred, and inferring it from damage picked an add on every fight where the adds are the job.
	const bossIDs = new Set(actors.filter((a) => a.type === 'NPC' && a.subType === 'Boss').map((a) => a.id));
	const primaryID = primaryTargetID(damageEvents, bossIDs);

	/**
	 * How much of the player's damage the primary target took.
	 *
	 * A whole-pull concentration read: the section prints it beside a spread pull so the reader knows
	 * the debuff was being moved around rather than held, and `singleTarget` decides whether the pull
	 * was concentrated enough to be read as one.
	 */
	const primaryDamageShare = (() => {
		const byTarget = damageByTarget(damageEvents);
		const total = [...byTarget.values()].reduce((sum, amount) => sum + amount, 0);
		if (total <= 0 || primaryID === undefined) return 0;
		return ((byTarget.get(primaryID) ?? 0) / total) * 100;
	})();
	/** Whether the pull was concentrated enough on one enemy to be read as single-target. */
	const singleTarget = primaryDamageShare >= spec.thresholds.singleTargetSharePct;
	const primaryGameID = (table.fight.enemyNPCs ?? []).find((n) => n.id === primaryID)?.gameID ?? null;
	// The report's actor list is the only thing that can name an enemy. Null when the list cannot
	// answer, and the row falls back to its unqualified wording rather than naming the wrong add.
	const primaryName = actors.find((a) => a.id === primaryID)?.name ?? null;

	/**
	 * The two clocks, and the rule for choosing between them.
	 *
	 * **A figure that grades what the player chose is measured over the time they had a choice; a
	 * figure that describes the pull is measured over the pull.** `engaged` below is the **boss's**
	 * clock — when the primary target was there to be hit. `contact`, further down, is the
	 * **player's** — when there was anything at all in reach. They are not interchangeable and must
	 * not be merged: on the Galakras kill in `a:6MhZgjyAknFWrYfK` the boss is reachable for 66.6
	 * seconds of a 434.2-second pull while the player fights for 317.2 of it across six segments.
	 */
	const engaged = engagedWindows(
		// Landed hits only. A damage-over-time tick is not contact: it lands on a boss that has gone
		// untargetable just as happily as on one being hit, so counting ticks as engagement bridges the
		// very gaps this is looking for.
		damageEvents
			.filter((e) => e.targetID === primaryID && !(isDamage(e) && e.tick === true))
			.map((e) => e.timestamp - t0),
		spec.thresholds.engagedGapMs,
	);
	const engagedMs = unionMs(engaged);

	/**
	 * When the player was in contact with *anything*, as opposed to with the boss.
	 *
	 * A second, deliberately wider notion of engagement. The windows above are scoped to the primary
	 * target because that is what the *resource* audit splits on — a bar that fills while the boss is
	 * away is the fight's doing — but their complement is not downtime. On an add fight the player is
	 * fighting for most of the pull and touching the boss for very little of it, and drawing that
	 * complement as "the fight took the target away" flagged 85% of a Galakras pull as intermission.
	 *
	 * The hits are the player's own *direct* damage and nothing else. Ticks are out because a DoT keeps
	 * ticking on a boss nobody can reach, so counting one bridges a real intermission. Pet damage is out
	 * because a pet picks a target and stays on it. Proc damage is out for the same reason a tick is —
	 * Essence of Yu'lon, Multistrike and the Lightning Shield discharge all fire on their own after the
	 * cast that spawned them, and a shaman who stops casting to heal through a transition is still
	 * "hitting" if the cloak proc is allowed to say so. Only a press that landed as a modelled ability
	 * against an enemy is contact.
	 */
	const enemyIDs = new Set(actors.filter((a) => a.type === 'NPC').map((a) => a.id));
	/**
	 * The hits WarcraftLogs' own Siege ruleset strikes, from both halves of it.
	 *
	 * `excludedDamageActorIDs` is the eleven decided rows keyed by NPC; `conditionalExclusions` is the two
	 * that had to be read off the pull instead. Their own files carry the rules and the evidence; what is
	 * decided *here* is the only question those files cannot answer, which is what a struck hit costs.
	 *
	 * **It costs contact, and contact alone.** `damageEvents` is not filtered, and that omission is the
	 * whole design. The spawn walk below still sees every body, so a struck add still raises the target
	 * count and still puts the pull in the band its adds earned — which is exactly what the `reach` rows
	 * argue for at length, one measured row at a time: a Kor'kron Jailer held for 39.6s "was a body the
	 * rotation had every reason to react to". Those rows are an argument about the *count*, and this leaves
	 * the count alone. What they never argued is that the same hits should also be the evidence a stretch
	 * of the pull gets *graded* on.
	 *
	 * So a global whose only landed hit was struck is not scored — not scored badly, **not scored** — and a
	 * global that also touched something real is untouched. That is the difference between an exemption and
	 * a penalty, and it is the one this codebase spends `docs/exemptions.md` insisting on.
	 *
	 * ***The cost is real and is not hidden.*** Thok's row says a count exclusion "would remove contact time
	 * from the denominator" and offers that as a reason against it; this removes contact time. The reply is
	 * that the denominator is the right place for it and the count was not: a player alone on a Jailer for
	 * 39.6s did fight it, and their rotation over those 39.6s is not evidence WarcraftLogs will accept about
	 * how they play. Refusing to grade it is the honest answer to a stretch of pull the ruleset has struck.
	 */
	const struckActorIDs = excludedDamageActorIDs(fight.encounterID, fight.difficulty, table.fight.enemyNPCs, mode);
	// Gated with the table beside it: these are the same ruleset read off the pull instead of off a list,
	// so a reader who has asked for the fight as fought must not have them applied either.
	const struckSpawns = !appliesExemptions(mode)
		? new Map()
		: conditionalExclusions({
				encounterID: fight.encounterID,
				difficulty: fight.difficulty,
				events,
				enemyDeaths: dataset.enemyDeaths,
				isEnemy: (id) => enemyIDs.has(id),
				isBoss: (id) => bossIDs.has(id),
			});
	const struckHit = (e: WclEvent): boolean =>
		(e.targetID !== undefined && struckActorIDs.has(e.targetID)) ||
		isStruckHit(struckSpawns, e.targetID, e.targetInstance, e.timestamp);
	const contact = engagedWindows(
		damageEvents
			.filter((e) => e.sourceID === actor.id && !(isDamage(e) && e.tick === true))
			.filter((e) => e.targetID !== undefined && enemyIDs.has(e.targetID))
			.filter((e) => !struckHit(e))
			.filter((e) => {
				const id = abilityIdOf(e);
				return id !== null && spec.registry.abilityByDamageId(id) !== undefined;
			})
			.map((e) => e.timestamp - t0),
		spec.thresholds.engagedGapMs,
	);
	/**
	 * The seconds the encounter took away and the player could not have taken back.
	 *
	 * ***A stun is not a missed global, and until now every spec but one was charged for it.*** The
	 * enforced table has always existed, and its credit reached exactly one figure: Protection's
	 * `globals.missedFree`. `gcdUtilisationPct` never saw it, so a monk Gouged for eight seconds on
	 * Fallen Protectors had those eight seconds sitting in the denominator of their own globals figure
	 * with nothing they could have put in them. Contact does not break either, because `engagedWindows`
	 * only splits on a gap longer than `ENGAGED_GAP_MS` — fifteen seconds — and every rule in the table
	 * but one is shorter than that.
	 *
	 * **Only the unavoidable ones.** Whirling is dodgeable, so it stays in the denominator: forgiving it
	 * would pay a player for standing in something. See `EnforcedRule.dodgeable`, where the distinction
	 * is declared because no event stream carries it.
	 *
	 * Subtracted from `contact` itself rather than from the total, so it leaves **both** halves of every
	 * ratio built on that clock. A press cannot happen inside a stun, so the numerator barely moves; what
	 * moves is the divisor, which is the half that was wrong.
	 */
	const enforced = enforcedDowntime({
		encounterID: fight.encounterID,
		events,
		actorID: actor.id,
		t0,
		endTime: fight.endTime,
		durationMs: duration,
		phases: dataset.phases ?? [],
	});
	// `intersect` with the complement rather than a `subtract` helper: the two primitives already exist
	// and already cut clocks this way everywhere else in this file.
	const contactLessEnforced = intersect(contact, complementOf(unavoidableWindows(enforced), duration));
	/** Named apart from `contactMs` further down, which is the target-count audit's own, narrower clock. */
	const inContactMs = unionMs(contactLessEnforced);

	// ------------------------------------------------------------------ cast table
	/**
	 * The per-ability rows, and the two press counts, built here rather than beside `series` above
	 * because all three are measured per **contact** minute and the clock has to exist first.
	 *
	 * The counts themselves are clock-free — `onGcd` and `count` — and are moved only because they read
	 * `castList`. Deriving them from `series` instead would put the on-GCD decision in a second place,
	 * and that decision is the one Chain Lightning was silently on the wrong side of for 53 tests.
	 */
	const castList = buildCastTable(series.values(), { contactMs: inContactMs, nameOf });
	const onGcdCasts = castList.filter((c) => c.onGcd).reduce((s, c) => s + c.count, 0);
	const offGcdCasts = castList.filter((c) => !c.onGcd).reduce((s, c) => s + c.count, 0);

	/**
	 * The occupied globals, clipped to the clock they are about to be divided by.
	 *
	 * This is the whole of the fix for a `gcdUtilisationPct` that could exceed 100%. The old figure
	 * divided a numerator rebuilt from *cast* events by WarcraftLogs' own `activeTime` off the damage
	 * table — two independent estimates of how busy the player was, with no arithmetic relationship
	 * between them, so nothing bounded the ratio. On the `phased` fixture the two clocks sat 32.7
	 * seconds apart and the headroom that hid the defect had already been half spent by pricing one
	 * missing filler.
	 *
	 * Both halves now come from this pass, and the numerator is a subset of the denominator by
	 * construction: a union of intervals intersected with `contact` cannot cover more than `contact`
	 * does. That is a structural bound rather than a clamp, which is why there is no clamp here — the
	 * `uptimePct` warning in `auras.ts` exists because that call site *can* still be handed
	 * mismatched spans, and this one cannot.
	 *
	 * What the clipping actually drops is a press made while nothing was in reach: a global spent
	 * during an intermission is neither counted as filled nor held against the player, because the
	 * denominator does not contain that time either. That is the same rule the debuff ledgers already
	 * apply to a dot missing while the boss is away.
	 */
	const occupiedMs = unionMs(intersect(occupancy, contact));

	/**
	 * Every hit the player landed themselves: when, and on whom.
	 *
	 * Ticks are out for the reason `engagedWindows` takes them out — a tick lands on an enemy nobody is
	 * near, so it is not evidence of contact. The pet's damage is out too: a pet picks a target and
	 * stays on it, so its swings would say the player was still on an add they left five seconds ago.
	 *
	 * Sorted rather than trusted to arrive in order — the walk that reads this treats each hit as "the
	 * enemy the player was on until the next one", so one event out of order would hand a stretch of
	 * the pull to the wrong enemy.
	 *
	 * `target` and `instance` are both carried, and both are load-bearing. The debuff walk asks about
	 * the one add in front of the player, so it needs the spawn; the ignore list is written against an
	 * NPC *type*, so it needs the id; and the count itself needs the spawn, because WarcraftLogs hands
	 * ten simultaneous adds one `targetID` and counting on that alone calls all ten of them one enemy.
	 */
	// Players and their pets, from the actor list. The audited actor is in here too, which costs
	// nothing: a press cannot land on its own caster.
	const friendlyIDs = new Set(actors.filter((a) => a.type === 'Player' || a.type === 'Pet').map((a) => a.id));
	const hitsOnAnything: Array<TargetHit & { key: string; abilityID: number | null }> = [];
	for (const e of damageEvents) {
		if (e.sourceID !== actor.id || e.tick === true || e.targetID === undefined) continue;
		// Not a friendly. On one committed pull the second-busiest "enemy" was actor 1, a friendly paladin
		// with eight damage events, and it was eligible both to pad the target count and to be picked as
		// the secondary dot target. A friendly is a target for neither damage nor a hit-count trigger, so
		// the exclusion belongs here rather than in either of the two counts derived below.
		//
		// Stated as "known to be friendly" rather than `enemyIDs.has(...)` on purpose, even though
		// `contact` above is built the other way round. An id absent from the actor list is *unknown*,
		// not friendly, and requiring proof of enemyhood would silently drop every real target on a log
		// whose actor list came back short — a failure that looks exactly like a quiet pull. The bug
		// being fixed was a target the log positively declared a `Player`, so that is what is excluded.
		if (friendlyIDs.has(e.targetID)) continue;
		hitsOnAnything.push({
			t: e.timestamp - t0,
			target: e.targetID,
			...(e.targetInstance === undefined ? {} : { instance: e.targetInstance }),
			key: instanceKey(e.targetID, e.targetInstance),
			abilityID: abilityIdOf(e),
		});
	}
	hitsOnAnything.sort((a, b) => a.t - b.t);
	/**
	 * The same hits with the units nothing can damage taken out — which is the list every reader of
	 * "the enemy in front of the player" wants.
	 *
	 * Filtered here, at the one place the hit list is built, rather than by each of the readers of it:
	 * the damage-side target count, the Windwalker's Rising Sun Kick coverage walk, the Elemental's
	 * "which spawn was the player on" and its second-dot pick. Every one of them was reading a Crawler
	 * Mine on Iron Juggernaut as an enemy in front of the player, and charging a stretch of contact time
	 * as uncovered by a debuff no debuff could ever have been on.
	 *
	 * `hitsOnAnything` above is deliberately kept: a **hit-count trigger** fires on a unit it could not
	 * damage, so the two counts below are two different questions and neither list can answer both.
	 */
	const landedHits = hitsOnAnything.filter((hit) => isJudgeableTarget(spawnLifeByKey.get(hit.key)));

	// ---------------------------------------------------------- target count
	/**
	 * How many enemies the player was damaging, moment by moment, and what that makes the pull.
	 *
	 * A pull is not single- or multi-target as a whole, it is one for four minutes and the other for
	 * one — and the priority list reads the live count at each press rather than a whole-pull number,
	 * because nothing could tell it which minute it was in.
	 */
	const multiTargetHits = landedHits.filter(
		(hit) => !ignoredMultiTargetIDs.has(hit.target) && !uncountedIDs.has(hit.target),
	);
	const targetPoints = targetCounts(multiTargetHits, spec.thresholds.targetWindowMs);
	// The same hits with the mode's strikes left in — see `dotMultiTargetWindows` on the shape above for
	// why one rule wants a floor the others must not have. Derived here, beside the series it differs from
	// by exactly one predicate, so the difference stays visible as that one predicate.
	const dotTargetPoints = targetCounts(
		landedHits.filter((hit) => !ignoredMultiTargetIDs.has(hit.target)),
		spec.thresholds.targetWindowMs,
	);
	// The spec may keep its own area damage from establishing multi-target evidence for the priority
	// list — WW does, for Rushing Jade Wind. This matters when WarcraftLogs omits the periodic `tick`
	// flag: one short-lived add hit by the wind would otherwise keep the ladder in its multi-target
	// branch and recommend more wind after the add was gone.
	const targetCountExcludedDamageIDs = new Set(
		(spec.aplTargetCountExclude ?? []).flatMap((key) => spec.registry.ability(key).damageIds ?? []),
	);
	const notOwnAreaDamage = (hit: { abilityID: number | null }): boolean =>
		!targetCountExcludedDamageIDs.has(hit.abilityID ?? -1);
	const aplTargetHits = multiTargetHits.filter(notOwnAreaDamage);
	const aplTargetPoints = targetCounts(aplTargetHits, spec.thresholds.targetWindowMs);
	// The ladder's own series with the mode's strikes left in, paired with `dotTargetPoints` above: one
	// rule needs both its edges read off the pull as fought. See `dotAoeWindows` on the shape above.
	const dotAplTargetPoints = targetCounts(
		landedHits.filter((hit) => !ignoredMultiTargetIDs.has(hit.target)).filter(notOwnAreaDamage),
		spec.thresholds.targetWindowMs,
	);
	const aplTargetCountAt = countAt(aplTargetPoints);
	/**
	 * The other reading of the same moment: how many units the player *hit*, damage or not.
	 *
	 * The count a hit-count trigger fires on. Built off `hitsOnAnything` rather than `landedHits`, which
	 * is the entire difference between the two — Rushing Jade Wind's chi refund fires on three units hit
	 * whether or not any damage lands, so a monk who put the wind into three Crawler Mines got the chi
	 * and pressed correctly, and a ladder banded on the damage count calls that a fault.
	 *
	 * Everything else about it is identical to the damage count above, deliberately: the same spec ignore
	 * list, the same own-area-damage exclusion, the same window. Only the immunity question differs, so
	 * the two series cannot drift apart for any other reason.
	 */
	const triggerHits = hitsOnAnything.filter(
		(hit) => !ignoredMultiTargetIDs.has(hit.target) && !uncountedIDs.has(hit.target),
	);
	const triggerTargetPoints = targetCounts(triggerHits.filter(notOwnAreaDamage), spec.thresholds.targetWindowMs);
	const triggerTargetCountAt = countAt(triggerTargetPoints);
	/**
	 * The same hits with the spec's own area damage **left in** — the series a declared refund is gated on.
	 *
	 * `ResourceConfig.gains.minTargets` models a rule the game applies to the world and not to the priority
	 * list: wowsims' `registerRushingJadeWind` pays its chi under
	 * `if sim.Environment.ActiveTargetCount() >= 3`, which is a fact about how many enemies were up. So the
	 * gate wants the widest honest count of what the press reached, and `triggerTargetPoints` above is not
	 * it — that series has `notOwnAreaDamage` applied, and for the Windwalker that filter is exactly
	 * `rushing-jade-wind`, the **one button in the tree that declares `minTargets`**. The gate was reading a
	 * count its own ability had been deleted from, so on a pack the wind alone was reaching it fell under
	 * the floor and denied a refund the game had paid.
	 *
	 * **The exclusion is not wrong where it lives; it is wrong here.** It exists to stop a button citing
	 * itself on the ladder — "the wind hit three, so press more wind" — and a refund is not a
	 * recommendation. Nothing circular follows from counting the hits that earned it.
	 *
	 * **Scored against the log's own record of the refund rather than against the other series.**
	 * WarcraftLogs reports the wind's chi as a `resourcechange` under 129881 — see
	 * `ResourceConfig.gains.reportedAs` for how that id was established — so each press can be checked
	 * against whether the game actually paid it. Pairing every event with the press it follows:
	 *
	 *     sections.json  33 presses, log paid 27  this series pays 26, wrong on 7   excluded pays 23, wrong on 10
	 *     idle.json       9 presses, log paid  4  this series pays  4, wrong on 4   excluded pays  4, wrong on  4
	 *
	 * Three of `sections`' ten wrong verdicts go away and none of `idle`'s four, because the two series part
	 * company at exactly three presses — t=233 185ms, 248 986ms and 360 082ms, where the excluded series
	 * reads 1, 2 and 2 against this one's 4, 3 and 5 — and the log paid all three. **Neither series
	 * reproduces the log press for press**: a trailing-window count of hits is a proxy for a live target
	 * count, and 7 of 33 is the size of that gap. What the change does is stop the proxy being made worse on
	 * purpose.
	 *
	 * **On both of those pulls the gate now decides nothing**, because `reportedAs` takes the log's word for
	 * the whole pull wherever the log gives one. What is left for the gate is a log carrying no 129881 at
	 * all, and no committed fixture is one — so the synthetic pulls in `__tests__/resourceGains.test.ts` are
	 * the only thing holding it, deliberately, and that file's header says so.
	 */
	const refundTargetPoints = targetCounts(triggerHits, spec.thresholds.targetWindowMs);
	const refundTargetCountAt = countAt(refundTargetPoints);
	/**
	 * The stretches a **second enemy existed** — two or more, and the stretches themselves rather than
	 * only their total, because some audits ask whether any *one* of them ran long enough to be worth
	 * something. Named here rather than counted twice.
	 *
	 * **Off `targetPoints` and deliberately not `aplTargetPoints` beside it, which is the opposite choice
	 * from `aoeWindows` below.** The two are the same array for a spec that declares no
	 * `aplTargetCountExclude` — every Elemental fixture in the tree — so nothing measured on those can
	 * tell them apart, and the reason for the split has to be argued rather than observed.
	 *
	 * This is an **evidence** question and `aoeWindows` is a **band** question, and that is the whole of
	 * the difference. A band question asks which rung of the priority list applied, so it has to read the
	 * series the ladder bands on or it is not asking about the ladder at all. This one asks whether the
	 * pull ever offered a second target — and a spec's own area damage landing on an add is proof the add
	 * was there. The exclusion exists to stop a button justifying *itself* on the ladder ("the wind hit
	 * three, so press more wind"); it is not a claim that the enemies were imaginary.
	 *
	 * **Measured, on a synthetic Windwalker pull whose only fan-out is Rushing Jade Wind** — the spec's
	 * one declared exclusion — in `__tests__/targetSeries.test.ts`. The damage series reads two enemies
	 * for 32 000ms of a 60s pull; the APL series reads one for the whole of it. Reading the APL series
	 * here would take `multiTargetMs` from 32 000 to 0 and `detected` from `multi` to `single` on a pull
	 * with an add up for half a minute, and it would tell the Windwalker's Storm, Earth and Fire audit
	 * that the pull never justified the cooldown — on exactly the pull the cooldown is for.
	 */
	const multiTargetWindows = intervalsAtLeast(targetPoints, 2, duration);
	const dotMultiTargetWindows = intervalsAtLeast(dotTargetPoints, 2, duration);
	const multiTargetMs = unionMs(multiTargetWindows);
	/**
	 * The pull cut into stretches of one rotation mode — the single reading, published on `Analysis`.
	 *
	 * **Off `aplTargetPoints` and not `targetPoints`, for the reason `aoeWindows` below is.** A segment
	 * says which priority list applied over a stretch, which is a *band* question, and a band question
	 * has to read the series the ladder bands on or it is not asking about the ladder at all. The two
	 * arrays are identical for a spec declaring no `aplTargetCountExclude`, so no committed Elemental
	 * pull can tell them apart and the choice has to be argued rather than observed.
	 *
	 * The two constants are handed over rather than defaulted inside `segmentPull`, so the *threshold*
	 * the idle cut uses is the one `engagedWindows` built `contact` with above: `engagedGapMs` is that
	 * number, the count series lags the last hit by a whole `targetWindowMs`, and a zero-run longer than
	 * the difference is exactly a hit gap longer than the gap. One number, read from one place.
	 *
	 * **What that does not make the two is the same clock, and no reader downstream may assume it.** The
	 * threshold is shared; the series are not. `contact` is built from the player's own direct, non-tick,
	 * modelled damage on an enemy actor, while `aplTargetPoints` counts landed hits with pets folded in,
	 * ticks included, immune and short-lived bodies dropped, and this spec's own area damage taken out —
	 * and it pads the last point by a window where `engagedWindows` stops at the last hit. So an `idle`
	 * span is not the complement of `contact` and the two totals differ: on `elemental/phased` the
	 * segments report 12.9s of idle against the 51.7s that clock leaves out.
	 */
	const segments = segmentPull(aplTargetPoints, duration, {
		contactGapMs: spec.thresholds.engagedGapMs,
		windowMs: spec.thresholds.targetWindowMs,
	});
	/**
	 * Where the pull happened, when the stream says.
	 *
	 * Read off the same `events` every clock above is built from, and free: the positions ride in the
	 * resource block the fetch already asks for. Undefined on a capture taken before `includeResources`
	 * reached this query, which is why the field is optional — see `buildReplay`.
	 */
	const replay = buildReplay(events, t0, duration, spec.reachYards, actorNames);
	/**
	 * The stretches the **aoe** priority list was the applicable one — three enemies or more.
	 *
	 * Off `aplTargetPoints` and deliberately not `targetPoints` beside it, because this is a question
	 * about which *ladder band* applied and those two series are not the same: the APL one excludes the
	 * spec's own area damage (`aplTargetCountExclude`), so a spec that cleaves with its filler would
	 * otherwise read as fighting a pack it created. Plan §41 found the two disagreeing and nothing
	 * saying why; this is the side that has to be the ladder's.
	 *
	 * Three and not two, because the two lists differ: at two targets the *cleave* list still spends
	 * Lightning Shield and multi-dots Flame Shock, so those stretches stay graded. It is only from three
	 * that the aoe list stops asking for either, which is what makes a single-target clock unable to
	 * count them.
	 */
	/**
	 * **The trailing edge is cut to one global, because a stretch otherwise runs a full window past the
	 * last hit that made it.** `targetCounts`' count can only *fall* at the moment some hit ages out, so
	 * a stretch closed by a fall closes at exactly `lastHitOnThirdEnemy + targetWindowMs`. That is not a
	 * distribution with a tail — measured on `cleave` it is exactly one window, seven stretches out of
	 * eight, the eighth being shorter only because the kill clamped it.
	 *
	 * What that cost before the trim: **28 378ms of `cleave`'s 109 869ms exempt total was time after the
	 * last hit any add in that stretch ever took** — boss-only time being forgiven. The opening edge has
	 * no such lag (a trailing window admits an enemy on the very hit that made the count), so the error
	 * was one-directional and always in the direction of forgiving.
	 *
	 * **A shorter window was the wrong fix and was measured as such.** Rebuilding the series at 3000ms
	 * gives 13 stretches, at 1500ms nineteen, at 750ms fifty-seven — a short window does not trim tails,
	 * it punches holes mid-wave, which is the flicker the window exists to suppress. Trimming the close
	 * instead lands one global past the last three-wide hit while keeping every mid-wave millisecond
	 * smoothed.
	 *
	 * One global of grace rather than none: the priority list re-reads its conditions once a global, and
	 * nothing a player does answers faster. **`effectiveGcd` and not `spec.gcdMs`, so it is the global
	 * this pull was actually played on — and the arithmetic below is in that global, not the declared
	 * one.** On `cleave` the median observed gap measures **1 124ms** (floored at `GCD_MIN_MS`, capped at
	 * the Elemental's declared 1 500), so the trim is `5 000 - 1 124 = 3 876ms` and each close lands on
	 * `h3 + 1 124` — inside where even a 1 500ms window would have closed. Written against the declared
	 * global the trim would be 3 500ms and every figure below would be a few hundred milliseconds per
	 * stretch out; `targetTails.test.ts` recovers the grace from the audit rather than naming it, for
	 * exactly that reason.
	 *
	 * **What it removes, at that measured trim.** Six of `cleave`'s eight stretches lose 3 876ms each
	 * (23 256ms); a seventh — [244 182, 247 937], 3 755ms long — is shorter than the trim and so drops
	 * whole; the eighth is the one the kill clamped and is left alone by design. 27 011ms in total,
	 * taking the exemption from **109 869ms to 82 858ms** and its share of the 263 233ms pull from
	 * **41.7% to 31.5%**. Downstream the Lightning Shield's overcap figure rises from **28 625ms to
	 * 42 157ms** across nine graded windows rather than eight — less forgiven, which is the point.
	 * `phased` and `unbroken` never reach three enemies and do not move at all.
	 *
	 * **The per-press band is deliberately *not* trimmed, and `earthShockGood` therefore does not move.**
	 * A clock charges or forgives what was *true* at a moment; a band labels a press by what the player
	 * *knew*, and an add hit a second ago is still an add to the person pressing. `0de530e` also made the
	 * section read the same series as the ladder so the two cannot disagree about one press, and trimming
	 * one of them would break that on purpose. What the five presses `cleave` exempts by band actually
	 * are is measured at the Earth Shock `band` docblock in `specs/elemental/lib/index.ts`.
	 *
	 * **`multiTargetWindows` and the contact clock deliberately keep the default 0.** They are evidence
	 * and a denominator, not exemptions — trimming them would shrink the very clock the mode share is
	 * measured against. They also read the *other* series, and that half of the split is argued where
	 * `multiTargetWindows` is built above rather than repeated here.
	 */
	const aoeWindows = intervalsAtLeast(aplTargetPoints, 3, duration, spec.thresholds.targetWindowMs - effectiveGcd);
	const dotAoeWindows = intervalsAtLeast(
		dotAplTargetPoints,
		3,
		duration,
		spec.thresholds.targetWindowMs - effectiveGcd,
	);
	/**
	 * Against the time the player was hitting *anything*, and deliberately neither of the two obvious
	 * alternatives.
	 *
	 * Not engaged time, which is the boss's clock: on the Galakras kill in `a:6MhZgjyAknFWrYfK` the
	 * boss is reachable for the last 84 seconds of a five-minute pull, so measuring the mode against
	 * engaged time called a fight whose middle three minutes are add waves single-target.
	 *
	 * Not pull length either, which counts every second nobody could hit anything as evidence for
	 * single target. The time with at least one enemy in the window is the honest denominator.
	 *
	 * **`targetPoints` and not `aplTargetPoints`, for the reason `multiTargetWindows` gives above — and
	 * this one is half of a ratio, so it is the place the mistake would be worst.** A denominator has to
	 * count the time the player really was in contact, and a spec's own area damage is contact.
	 *
	 * `multiTargetPct` below is `multiTargetMs / contactMs`, and **both halves come off `targetPoints`.**
	 * On the synthetic wind-only pull in `__tests__/targetSeries.test.ts` the damage series gives
	 * 32 000ms over 39 000ms — 82.1%, `multi`. The APL series gives 0ms over 10 000ms — 0%, `single`.
	 * Either is at least self-consistent. Moving *this* half alone, which is the tempting edit because
	 * the exclusion is easiest to argue for on a denominator, gives 32 000 over 10 000: **320%, a share
	 * of a clock larger than the clock**, and a `detected` that is `multi` for an arithmetic reason
	 * rather than a measured one. Not a clock this engine happens to clamp — it simply would not mean
	 * anything. A ratio's two halves move together or not at all.
	 *
	 * Nothing else reads this clock. `inContactMs` further up is the one `totalCpm` and
	 * `gcdUtilisationPct` are per, and it is built from the `contact` segments rather than from either
	 * count series, so neither of these two choices can move a rate.
	 */
	const contactMs = unionMs(intervalsAtLeast(targetPoints, 1, duration));
	const multiTargetPct = contactMs > 0 ? (multiTargetMs / contactMs) * 100 : 0;
	const detectedMode: TargetMode = multiTargetPct >= spec.thresholds.multiTargetSharePct ? 'multi' : 'single';

	// ----------------------------------------------------------------- resources
	// Read straight off the `classResources` snapshots the events query asks for. The bars' own audits
	// split them by the contact windows computed immediately above — a bar that fills while there is
	// nothing to hit is the fight's doing, and only the other half of the number describes anything
	// the player chose.
	//
	// Every declared bar is audited here, so a second spec that spends a bar gets the full reading
	// (a pool's cap time and regen rate, a points bar's reconstructed walk and overflow) without
	// writing any of it — the spec's own audit reads `resourceAudits` instead of rebuilding the bars.
	const resourceAudits: Record<string, ResourceBarAudit> = {};
	for (const [key, config] of Object.entries(spec.resources)) {
		const samples = resourceSamples(events, wclPowerTypeOf(config.type), actor.id, t0);
		if (config.kind === 'pool') {
			resourceAudits[key] = poolResourceAudit(config.type, samples, duration, contact, link);
		} else {
			// The config names its generators by the model's own ability keys, so a button cannot be
			// listed under one name in the model and another here — and an unknown key fails loudly at
			// construction rather than silently generating nothing.
			// **Asked with the press's own moment, because a generator's yield is not always constant.**
			// Rushing Jade Wind pays its chi only at three units or more, and a flat lookup credited it on
			// every press — a fault pointing the opposite way to the ladder's, so the two cancelled in a
			// report and hid each other. `minTargets` is counted against `refundTargetCountAt`, whose
			// docblock carries the argument for that series and the log measurement that settles it.
			const gainsOf = (abilityID: number, atMs: number): number | undefined => {
				const ability = spec.registry.abilityByCastId(abilityID);
				if (ability === undefined) return undefined;
				for (const gain of config.gains ?? []) {
					if (gain.abilityKey !== ability.key) continue;
					if (gain.minTargets !== undefined && refundTargetCountAt(atMs) < gain.minTargets) return undefined;
					return gain.amount;
				}
				return undefined;
			};
			// A gain the log reports itself, keyed by the id it presses under rather than the id it is
			// reported under — `pointsResourceAudit` cuts those out of the table so the walk cannot credit
			// them twice, and it can only recognise them by the `resourcechange`'s own ability. Chi Brew
			// presses and reports under one id and needs nothing here; Rushing Jade Wind does not, and was
			// counted twice on every log that reports it. See `ResourceConfig.gains.reportedAs`.
			const reportedAs = new Map<number, number>();
			for (const gain of config.gains ?? []) {
				if (gain.reportedAs === undefined) continue;
				for (const castId of spec.registry.ability(gain.abilityKey).castIds) reportedAs.set(castId, gain.reportedAs);
			}
			resourceAudits[key] = pointsResourceAudit(
				config.type,
				events,
				actor.id,
				t0,
				gainsOf,
				samples,
				wclPowerTypeOf(config.type),
				reportedAs,
			);
		}
	}

	// ------------------------------------------------------------ lost casts
	// Buttons that share one timer are one row, and the merge has to happen before the walk rather than
	// after it. Crusader Strike and Hammer of the Righteous both sit on `paladin.BuilderCooldown()`, so
	// a walk over each in isolation sees the *other* button's presses as gaps: measured on the Garrosh
	// capture, Crusader Strike read 52 lost casts and Hammer of the Righteous 138, against a pair that
	// was actually pressed 142 times on one cooldown and lost far fewer. Neither number was a fact
	// about the player.
	//
	// The partner is dropped rather than merged into: `sharesCooldownWith` is declared on both halves
	// and `createRegistry` refuses a pair that disagrees, so taking the first of the two and skipping
	// the second is a stable choice however the table is ordered.
	const sharedHandled = new Set<string>();
	const lostCasts = spec.registry.abilities
		.filter((a) => a.gate === 'cooldown')
		.map((ability): LostCastRow | null => {
			// **Both clocks, one to each end of the window** — the completions to open it, the commits to
			// close it. `cooldownDrift`'s docblock carries the argument; the short of it is that the game
			// arms a cooldown at `SPELL_CAST_SUCCESS` (so the window opens at `previous completion +
			// cooldownMs`) while the button stopped sitting *unused* at the moment the player committed to
			// the next press.
			//
			// The arming half is the simulator's, not this repo's reading of itself: in `wowsims-mop` a
			// cast-time spell reaches `spell.triggerCooldown(sim)` only from inside its `Hardcast`'s
			// `OnComplete` (`sim/core/cast.go:178-205`), which fires at `Hardcast.Expires` = `begincast +
			// castTime` (`sim/core/gcd.go:8-24`), and `triggerCooldown` arms `spell.CD` at `sim.CurrentTime`
			// (`cast.go:258-268`). `spec/apl.ts`' `ready()` states the same premise and keeps `lastCast` on
			// landings for it — but it and this site and `cooldowns.ts` were, until that citation, three
			// comments pointing at each other.
			//
			// This site is why both are reachable here: `castTimes` is `CastSeries.times` and
			// `castBeginTimes` is `CastSeries.beginTimes`, element-for-element with it. Nothing on a
			// committed fixture moves by passing the second one — the Windwalker declares no `castTimeMs`
			// anywhere and the only cooldown-gated Elemental button with one is `elemental-blast`
			// (`castTimeMs: 2000`, `cooldownMs: 12_000`, on its own entry in `specs/elemental/lib/index.ts` —
			// named rather than numbered, because the line citation this replaced had already rotted by 74
			// lines under the lanes editing that file), a talent nobody in `phased`, `unbroken` or `cleave`
			// took. It is the *next* cast-time cooldown that this
			// is for, which on the old clock would have been charged one cast time per press and handed a
			// phantom lost cast for flawless play with nothing anywhere failing.
			//
			// (Plan §47 recorded this the other way round, "understated by one cast time". That only holds
			// if the cooldown is armed at the `begincast`, which is not the premise this codebase reads its
			// cooldowns on.)
			// The pair's other half, when this button declares one and the registry can resolve it.
			const partnerKey = ability.sharesCooldownWith;
			if (partnerKey !== undefined && sharedHandled.has(ability.key)) return null;
			const partner = partnerKey === undefined ? undefined : spec.registry.abilities.find((a) => a.key === partnerKey);
			if (partner !== undefined) sharedHandled.add(partner.key);

			// One series for the pair, in time order. `castBeginTimes` has to be merged the same way and
			// stay element-for-element with it, or the two clocks come apart — see `cooldownDrift`.
			const own = castTimes(ability).map((t, i) => [t, castBeginTimes(ability)[i] ?? t] as const);
			const theirs =
				partner === undefined ? [] : castTimes(partner).map((t, i) => [t, castBeginTimes(partner)[i] ?? t] as const);
			const merged = [...own, ...theirs].sort((a, b) => a[0] - b[0]);
			const times = merged.map(([t]) => t);
			const begins = merged.map(([, b]) => b);
			if (!times.length) return null;
			const live: Interval[] = spec.needsTarget.has(ability.key) && engaged.length ? engaged : [[0, duration]];
			const drift = cooldownDrift(
				times,
				ability,
				live,
				duration,
				cooldownLeewayMs,
				begins,
				// Only for a spec that declares one. Everything else takes the declared `cooldownMs`, which
				// is what every committed capture was measured against.
				spec.cooldownAt === undefined ? undefined : (t) => spec.cooldownAt!(dataset, ability, t),
			);
			return {
				id: ability.castIds[0] ?? 0,
				// A pair is named as one, because it is one button's worth of cooldown however many keys
				// are bound to it. A row reading only the first half would attribute the other half's
				// presses to a button the reader can see was pressed far fewer times.
				name: partner === undefined ? ability.name : `${ability.name} · ${partner.name}`,
				cooldownSec: (ability.cooldownMs ?? 0) / 1000,
				casts: times.length,
				driftSec: r1(drift.driftMs / 1000),
				lostCasts: drift.lostCasts,
				openerSec: r1(drift.openerMs / 1000),
				tailSec: r1(drift.tailMs / 1000),
				worst: drift.windows.slice(0, 3).map((w) => ({
					at: w.start,
					seconds: r1(w.ms / 1000),
					link: link(w.start),
				})),
			};
		})
		.filter((row): row is LostCastRow => row !== null);

	// --------------------------------------------------------- cast marks
	// Every press on one clock, flattened out of the per-ability buckets.
	//
	// Assembled here rather than in a primitive, and deliberately: it invents nothing. The presses are
	// the same `castSeries` the cast table is built from, and a second reading of the same events
	// could disagree with the count printed beside it.
	const marks: CastMark[] = [...series.values()]
		.flatMap((c) =>
			c.times.map((t) => {
				// `c.id` is the series' representative id, which for every cast-time button in this report
				// is its one cast id — the same id the pairing keyed on above.
				const castTimeMs = castDurations.get(`${c.id}:${t}`);
				return {
					t,
					// The commit instant, carried beside the landing rather than replacing it — see `CastMark`.
					// Derived from the same duration the cast bar is drawn from, so the mark, the bar and the
					// GCD walk cannot disagree about when this press started.
					begin: t - (castTimeMs ?? 0),
					// The button's canonical id, not `c.id` — which is whichever id the log happened to use
					// first. Jab logs one id per weapon type and those ids carry the *weapon's* icon, so a monk
					// holding a sword would have had every Jab on the timeline drawn as a sword.
					id: c.ability?.castIds[0] ?? c.id,
					name: c.ability?.name ?? nameOf(c.id),
					// An unmodelled press reads as off-GCD, the same assumption `buildCastTable` makes and for
					// the same reason: a trinket drawn at the weight of a global claims a global was spent.
					onGcd: c.ability?.onGcd ?? false,
					...(castTimeMs === undefined ? {} : { castTimeMs }),
				};
			}),
		)
		.sort((a, b) => a.t - b.t)
		// One press, one mark — even when the log writes the press twice.
		//
		// Spear Hand Strike is the case: its interrupt and its silence are separate spells that fire
		// together, so a single press arrives as 116705 and 116709 two milliseconds apart. Drawn as two
		// marks it reads as two presses, and because an icon is exactly one global wide the packer opens
		// a second row for the lane — which says the player pressed it twice at once.
		//
		// The rule is deliberately narrow: same name, *different* id, near-simultaneous. Same-id repeats
		// are left alone, and that is what protects auto-attacks — a dual-wielding monk lands main-hand
		// and off-hand swings milliseconds apart, both under id 1, and those are two real attacks rather
		// than one logged twice. Nothing pressed twice inside `samePressMs` is a second press either:
		// the global is a thousand milliseconds and this is a fiftieth of it.
		.filter((mark, i, all) => {
			const prev = all[i - 1];
			return prev === undefined || prev.name !== mark.name || prev.id === mark.id || mark.t - prev.t > spec.samePressMs;
		});

	// -------------------------------------------------- cancelled casts
	// The `begincast`s no `cast` ever completed — a press that started and was interrupted. Each carries
	// the cast time the spell would have needed, read from the median of that same button's completed
	// casts, so the red bar the timeline draws is the global the reader lost rather than a marker of
	// unknown width. A button that was only ever cancelled falls back to a global and a half.
	const castTimesById = new Map<number, number[]>();
	for (const mark of marks) {
		if (mark.castTimeMs === undefined) continue;
		const list = castTimesById.get(mark.id) ?? [];
		list.push(mark.castTimeMs);
		castTimesById.set(mark.id, list);
	}
	const cancels: CastMark[] = [];
	for (const [rawId, stack] of cancelledBegins) {
		const ability = spec.registry.abilityByCastId(rawId);
		const id = ability?.castIds[0] ?? rawId;
		const expected = castTimesById.get(id);
		const castTimeMs = expected !== undefined && expected.length > 0 ? Math.round(median(expected)) : 1500;
		for (const t of stack) {
			cancels.push({
				t,
				id,
				name: ability?.name ?? nameOf(rawId),
				onGcd: ability?.onGcd ?? false,
				castTimeMs,
				cancelled: true,
			});
		}
	}
	cancels.sort((a, b) => a.t - b.t);

	// ----------------------------------------------------------- player's deaths
	/**
	 * The player's own deaths, off the event stream that was already fetched.
	 *
	 * Filtered by `targetID` and not by `sourceID`: a death event names the killer in `sourceID` — or
	 * `-1` when the game credits nobody — and the victim in `targetID`. WarcraftLogs returns it for a
	 * `sourceID` filter matching the victim all the same, which is why these arrive without a second
	 * query and why filtering the way the field is named would drop every one of them.
	 *
	 * Nothing here is graded. A death explains a lane that stops and is never a fault this report
	 * counts, so it reaches the timeline as a mark and reaches no metric at all.
	 */
	// When the player was picked back up. A death runs until the next of these, or to the end of the
	// pull when none follows — a corpse held to the kill is the same event with no closing bracket.
	const revivals = events
		.filter(isResurrect)
		.filter((e) => e.targetID === actor.id)
		.map((e) => e.timestamp - t0)
		.sort((a, b) => a - b);

	const deaths: DeathMark[] = events
		.filter(isDeath)
		.filter((e) => e.targetID === actor.id)
		.map((e): DeathMark => {
			// Zero is the log's "nothing killed them that has a spell id" — a fall, a wipe, the enrage
			// timer — and resolving it would ask the icon map for spell 0 and the name table for `#0`.
			const abilityId =
				e.killingAbilityGameID !== undefined && e.killingAbilityGameID > 0 ? e.killingAbilityGameID : null;
			const at = e.timestamp - t0;
			const back = revivals.find((r) => r > at);
			return {
				t: at,
				abilityId,
				ability: abilityId === null ? null : nameOf(abilityId),
				until: back ?? duration,
				resurrected: back !== undefined,
			};
		})
		.sort((a, b) => a.t - b.t);

	// --------------------------------------------------------------- Potions
	/**
	 * The pull's potion windows, including the one that was already running when the pull started.
	 *
	 * `openAtPull` is what recovers it, and the argument for the recovery is in `auraWindows`. The
	 * short version: a fight-scoped query returns only what happened inside the fight, so a potion
	 * drunk before the pull leaves no apply and no cast — the whole of it in the stream is the
	 * `removebuff` where it ran out, which the default walk drops for having nothing to pair with.
	 */
	const potionAbility = spec.registry.ability(spec.potion.abilityKey);
	const potionAura = spec.registry.aura(spec.potion.auraKey);
	const potionWindows = auraWindows(selfEvents, potionAura, t0, fight.endTime, { openAtPull: true });

	/**
	 * When *this player* joined the fight, which is not when the fight started.
	 *
	 * WarcraftLogs starts the clock the moment the boss is engaged — by anyone — so a player still
	 * running in is already inside the fight window while being out of combat themselves. A potion
	 * drunk in that gap is a pre-pull potion that happens to carry a positive timestamp, and it leaves
	 * the full `applybuff` + `cast` + `removebuff` triple an in-combat press leaves. Nothing about the
	 * events tells the two apart, so the separation has to come from what the player was doing around
	 * them, and this is that instant.
	 *
	 * **The earliest thing in the log that is this player fighting**, taken as the earlier of two,
	 * because each covers a case the other misses:
	 *
	 *   - **A cast of an ability that deals damage.** Combat starts at the press, not where the damage
	 *     lands, and for a Windwalker those are routinely different: Chi Wave travels. `damageIds` is
	 *     what "deals damage" means here, so the model answers the question rather than a list of ids
	 *     repeated in this file.
	 *   - **A damage event sourced by the player or one of their pets.** An auto-attack logs no cast at
	 *     all, and Xuen's first swing puts its owner in combat without the monk having pressed anything
	 *     since the summon.
	 *
	 * Null when the log shows this player neither casting anything damaging nor damaging anything.
	 * Null is the honest answer rather than a fallback: with no instant to be before, *every* press
	 * would qualify, and a potion drunk three minutes into a pull would file as pre-pull.
	 */
	const engagedAt = ((): number | null => {
		const strikes = (e: WclEvent): boolean => {
			if (!isCast(e) || e.sourceID !== actor.id) return false;
			const id = abilityIdOf(e);
			return id !== null && (spec.registry.abilityByCastId(id)?.damageIds?.length ?? 0) > 0;
		};
		// `damageEvents` is already this player's and their pets', in time order.
		const times = [events.find(strikes), damageEvents[0]].filter((e) => e !== undefined).map((e) => e.timestamp - t0);
		return times.length === 0 ? null : Math.min(...times);
	})();

	/**
	 * Potions used, out of the two the game allows.
	 *
	 * **A count of potions, not of slots**, and the two can only disagree in one direction: a player
	 * who drank twice after engaging has two potions and one filled slot, and reading that as one of
	 * two would print a fault at somebody who drank everything they had.
	 *
	 * The two slots are kept apart because which one went unfilled is the whole of the advice. A press
	 * reaches the pre-pull slot by either of the two routes `prePull` sets out, and every other press
	 * is a combat one. Capped at `spec.potion.slots`, the ceiling the number is printed against.
	 *
	 * Only the modelled potion is counted, which is the false-negative direction: the count can
	 * under-report, never over-report.
	 */
	const potions = ((): PotionAudit => {
		const presses = events
			.filter((e) => isCast(e) && e.sourceID === actor.id && abilityIdOf(e) === (potionAbility.castIds[0] ?? 0))
			.map((e) => e.timestamp - t0)
			.sort((a, b) => a - b);
		const prePullWindow = potionWindows.find((w) => w.preexisting === true);

		/**
		 * The press that filled the pre-pull slot from inside the fight window.
		 *
		 * A potion drunk before this player entered the fight is a pre-pull potion in the only sense
		 * the two slots are about: it went down out of combat, so it started the category cooldown
		 * without spending the one press combat allows, and the second slot came up a minute later
		 * exactly as it does after a press taken before the pull.
		 *
		 * **Second in line, never a replacement.** A buff already running at the pull is direct
		 * evidence and this is an inference from timing, so `prePullWindow` takes the slot wherever it
		 * exists and an early press then stays an ordinary combat press.
		 *
		 * Strictly before, because a press in the same millisecond as the player's first strike is
		 * evidence of nothing, and this rule only ever claims the slot on a press that came first.
		 */
		const earlyPress =
			prePullWindow !== undefined || engagedAt === null ? undefined : presses.find((at) => at < engagedAt);

		const prePull =
			prePullWindow !== undefined
				? // Negative, and arithmetic rather than a guess: a buff that was running at the pull and came
					// off at `end` went down one full duration before that.
					{ drunkMs: prePullWindow.end - (potionAura.durationMs ?? 0), expiredMs: prePullWindow.end, preexisting: true }
				: earlyPress === undefined
					? null
					: {
							drunkMs: earlyPress,
							// Read off the press's own window, which is in the stream because an in-fight potion logs
							// the whole triple.
							expiredMs:
								potionWindows.find((w) => w.end >= earlyPress)?.end ?? earlyPress + (potionAura.durationMs ?? 0),
							preexisting: false,
						};

		const combat = presses.filter((at) => at !== earlyPress);

		/**
		 * Whether this pull could answer at all — which is not the same as answering zero.
		 *
		 * A pre-pull potion is only visible because it expires inside the fight, so on a pull shorter
		 * than its own duration it would still have been up at the last event and leaves nothing at all
		 * behind: "no pre-pull potion" and "cannot tell" are the same stream, and the second is the
		 * truth. The combat slot is locked by a pre-pull press for `categoryCooldownMs`, so a pull that
		 * ended inside that never offered it; with no pre-pull press nothing was locked and it was
		 * available from the first global, which is why the guard is conditional rather than a flat
		 * floor.
		 *
		 * `drunkMs` being signed is what lets the combat guard stand unchanged across both shapes of
		 * pre-pull press: the lock starts where the potion went down, whether that is 1.0s before the
		 * pull or 0.5s after it.
		 */
		const prePullReadable = duration >= (potionAura.durationMs ?? 0);
		const combatReadable = prePull === null || duration >= prePull.drunkMs + spec.potion.categoryCooldownMs;

		return {
			name: potionAura.name,
			id: potionAura.ids[0] ?? 0,
			used: Math.min((prePull === null ? 0 : 1) + combat.length, spec.potion.slots),
			slots: spec.potion.slots,
			prePull,
			combat,
			measurable: prePullReadable && combatReadable,
		};
	})();

	// --------------------------------------------------- raid haste cooldown
	// The Bloodlust group and Berserking, detected here so every spec shades them on the timeline
	// without writing its own audit. The player's own aura events are the source, and the shared auras
	// carry the ids and the Bloodlust variants.
	//
	// Read before the audit runs rather than after it, because a spec's own sections want the same
	// windows: the Windwalker grades Energizing Brew against the raid cooldown, and it used to walk
	// the events a second time to get them. Two walks over one aura are two things that can disagree
	// the moment either side gains a guard, and the section and the band drawn under it disagreeing
	// about where Bloodlust started is not a bug a reader can see. One walk, published on the handles
	// and on the timeline both.
	//
	// `openAtPull` on both, and rung 2 only. A haste cooldown pressed just before the pull is ordinary
	// play, and without the inference its whole in-fight stretch is invisible: the removal is the only
	// event the fetch returns, the default walk discards it, and the pull reads as having had no haste
	// cooldown at all. Rung 3 is deliberately *not* asked for — Bloodlust runs 40s and Berserking 10s,
	// so a `combatantinfo`-only bar would shade a four-minute fight as hasted throughout.
	const hasteWindows = auraWindows(selfEvents, spec.registry.aura('bloodlust'), t0, fight.endTime, {
		openAtPull: true,
	});
	const berserkingWindows = auraWindows(selfEvents, spec.registry.aura('berserking'), t0, fight.endTime, {
		openAtPull: true,
	});

	// ------------------------------------------------------------------- hooks
	// The audit runs once the press marks and the resource samples exist — the last things its own
	// audits read. It sees nothing but these handles, and `identify` runs before it because the spec
	// check answers a question the core itself has to print (`isSpec`) rather than one the audit does.
	const h: Handles = {
		phases: dataset.phases ?? [],
		effectiveGcd,
		measuredGcd,
		activeMs,
		gcdSlots: Math.floor(activeMs / effectiveGcd),
		onGcdCasts,
		code,
		fight,
		actor,
		events,
		actors,
		t0,
		duration,
		nameOf,
		link,
		selfEvents,
		raidStormlash: raidStormlash ?? [],
		pullAuras,
		registry: spec.registry,
		series,
		castList,
		castTimes,
		castBeginTimes,
		castPresses,
		castCount,
		channels,
		damageEvents,
		abilities,
		eventTotal,
		gear,
		raidBuffs,
		primaryID,
		primaryGameID,
		primaryName,
		primaryDamageShare,
		singleTarget,
		engaged,
		engagedMs,
		contact,
		inContactMs,
		landedHits,
		spawnLives: spawnLifeByKey,
		multiTargetWindows,
		dotMultiTargetWindows,
		dotAoeWindows,
		aoeWindows,
		multiTargetMs,
		contactMs,
		aplTargetCountAt,
		triggerTargetCountAt,
		resourceAudits,
		lostCasts,
		marks,
		potionWindows,
		hasteWindows,
		berserkingWindows,
		settings: clamped,
	};

	const isSpec = spec.identify(h);
	const audit = spec.audit(h);
	// Spec-computed bars, ahead of the declared ones so they draw on top — see `SpecConfig.extraResources`.
	const allResources: Record<string, ResourceBarAudit> = { ...spec.extraResources?.(h, audit), ...resourceAudits };

	// --------------------------------------------------------------- assembly
	const core: AnalysisCore = {
		player: actor.name,
		code,
		fightID: fight.id,
		fightStartMs: t0,
		actorID: actor.id,
		encounter: fight.name,
		difficulty: fight.difficulty,
		size: fight.size ?? 0,
		difficultyName: dataset.difficultyNames?.[fight.difficulty] ?? null,
		kill: fight.kill,
		durationMs: duration,
		itemLevel: entry?.itemLevel ?? null,
		// WarcraftLogs' own percentile for this pull, carried through untouched. Null where the site has
		// none — see `FightDataset.rankPercent`; `undefined` where a dataset predates the fetch, and the
		// header draws nothing in either case rather than a nought.
		rankPercent: dataset.rankPercent ?? null,
		isSpec,
		specName: spec.specName,
		primaryTarget: { id: primaryID, gameID: primaryGameID, name: primaryName },
		damage: {
			wclTotal: entry?.total ?? null,
			eventTotal,
			dps: duration > 0 ? (entry?.total ?? eventTotal) / (duration / 1000) : 0,
			abilities,
		},
		// ------------------------------------------------ the two clocks, one field at a time
		//
		// `gcdUtilisationPct` is measured against `inContactMs`, this engine's own clock, and the four
		// fields here are measured against WarcraftLogs' `activeTime`. **Which of the two each figure
		// belongs on is decided per field below rather than left to be discovered**, because the failure
		// mode of the move that put the GCD figure on contact is half the report following it and nobody
		// being able to say which half. Audited across all four raw fixtures; every reason is a
		// measurement.
		cpm: {
			/**
			 * **Per contact minute** — the player's own clock, the same one `gcdUtilisationPct` is measured
			 * against, and moved here from WarcraftLogs' `activeTime`.
			 *
			 * It was the last genuine two-clock pairing in this engine: our own count of presses over
			 * WarcraftLogs' estimate of how busy the player was. Those two have no arithmetic relationship —
			 * we count the presses off the cast stream, `activeTime` is a presence span off the damage table —
			 * which is the defect `fe3d7ad` corrected for the GCD share, and that Flame Shock's and Searing
			 * Totem's uptimes were corrected for before it. It survived longer than all three because **a rate has no 100% to cross**: nothing
			 * clamped, nothing printed an impossible value, and so nothing looked wrong.
			 *
			 * Measured, on the four raw fixtures, old against new:
			 *
			 *   ele/phased     39.88 → 46.19   (+6.31, the 32.7s submerge was charged as castable time)
			 *   ele/cleave     46.79 → 46.79   (0.00, the two clocks agree to the millisecond here)
			 *   ele/unbroken   46.48 → 46.87   (+0.39)
			 *   ww/iron        52.81 → 52.84   (+0.03, and this one is the canary — an all-instant bar whose
			 *                                   clocks are 117ms apart cannot move, so a big move means the
			 *                                   contact clock has stopped measuring contact)
			 *
			 * Nothing graded moves with it: neither spec's `score.ts` reads this field, and the `casts` verdict
			 * is selected by `gcdUtilisation`'s band. It is printed in two places, and both had to move in the
			 * same change or the section would contradict itself — `buildCastTable`'s per-ability rates (the
			 * suite pins Σ rows == this figure) and `CastsPerMinute.tsx`, which multiplies a row's rate back by
			 * the same span to print a cast count.
			 *
			 * One sentence in `report.json` is now false and is another lane's file to fix: `casts.presses`
			 * prints `activeMs` as "the span the cast count was taken over", which is no longer the span this
			 * rate was taken over. Reported rather than worked around.
			 */
			totalCpm: inContactMs > 0 ? onGcdCasts / (inContactMs / 60000) : 0,
			onGcdCasts,
			offGcdCasts,
			// **Stays, because the clock very nearly cancels out of its only printed reader.** Two readers:
			// `PaceTiles.tsx` divides this by `activeMs / 60_000` — so the `activeMs` cancels and what
			// survives is ≈`60_000 / effectiveGcd` plus the floor — and each spec's `score.ts` gates the
			// GCD metric on `> 0`. Measured: rebuilding it from `inContactMs` gives 182/232/174/188 slots
			// against today's 211/232/176/189, which moves the printed target rate by less than 0.4 cpm
			// (52.92→52.85, 53.22→53.22, 57.62→57.36, 59.77→59.45). A moved number on both specs to buy
			// four hundredths of a cast per minute is not worth it, and the gate is true on both clocks
			// wherever it is true on either.
			//
			// What *was* wrong here was the reason written at that call site, which claimed this figure
			// prices a hard cast at more than one global. It does not — `effectiveGcd` is the median gap
			// measured **after an instant press only**, deliberately excluding cast time — and the claim
			// is corrected in `PaceTiles.tsx` rather than papered over here.
			gcdSlots: Math.floor(activeMs / effectiveGcd),
			activeMs,
			// **Stays on the pull length, and this is the one figure that should.**
			//
			// It looks like the pairing `gcdUtilisationPct` had and it is not one. Both halves are
			// WarcraftLogs', for the same fight: `duration` is `fight.endTime - fight.startTime` off
			// `reportFights`, and `activeTime` comes off `table(dataType: DamageDone, fightIDs: [id])` —
			// the same fight window, measured by the same party. The numerator is that party's measure of
			// a sub-span of the denominator's own span, which is exactly the arithmetic relationship
			// `productiveMs / activeTime` lacked. And nothing in this engine can push either half: the
			// headroom §44 watched being spent was being spent because *we* were growing the numerator by
			// pricing more abilities, and here we compute neither number.
			//
			// **Moving it to `inContactMs` — the obvious repair — is measurably the defect, not the fix.**
			// `activeMs / inContactMs` reads 115.83% on `phased`, 100.83% on `unbroken` and 100.06% on the
			// Windwalker: three of the four raw fixtures over 100, which is the reading `fe3d7ad` removed.
			// Contact is *narrower* than WarcraftLogs' clock, so it cannot be the denominator of a
			// numerator that WarcraftLogs measured.
			//
			// So it stays, and it stays for the reason §2 gave for keeping `activeMs` published at all:
			// the gap between the two clocks is itself the signal. On `phased` this prints 92.62% where
			// contact says 79.97% — 12.65 points, one pull in four, and the pull where a reader most needs
			// to know the difference. Deleting the comparison would delete the evidence. What is genuinely
			// wrong is the sentence drawn from it: `report.json`'s `casts.activeTime` says "You were active
			// for X% of the pull", and on the measurement above this number cannot support "active".
			// Headroom to 100, for anyone watching it: 7.38 / 0.63 / 0.63 / 0.30 points.
			activePct: duration > 0 ? (activeMs / duration) * 100 : 0,
			// The audit's two fields are merged in below, once it has run; the price it sets for
			// wasted globals has to be the merged figure, not a guess made before it.
			gcdUtilisationPct: 0,
			channelSec: 0,
		},
		casts: castList,
		// The core's half of the timeline: the deaths, and the contact clock every spec shades
		// intermissions against — the spec's audit merges its own presses and lanes over this.
		timeline: { deaths, contactSegments: contact, cancels, hasteWindows, berserkingWindows },
		segments,
		replay,
		lostCasts,
		// **Both series are published, because both questions are asked downstream.** `counts` is
		// `targetPoints`, the evidence one — what the target-count section draws, and the half of
		// `multiTargetPct` a reader can see. `aplCounts` is `aplTargetPoints`, the one the ladder bands on.
		// For a spec with no `aplTargetCountExclude` they are the same array and the second says nothing;
		// for one that declares an exclusion they are different numbers, and a band question that read the
		// first would be scoring a rung the priority list never presented. `view/targetMode`'s
		// `bandsInPull` and the Windwalker's `tigerPalmShare` are the two band questions, and they read
		// `aplCounts`. See `multiTargetWindows` above for the split, and `aoeWindows` for the rule about
		// which side a band question belongs on.
		targets: {
			windowMs: spec.thresholds.targetWindowMs,
			counts: {
				max: targetPoints.reduce((most, [, count]) => Math.max(most, count), 0),
				points: targetPoints,
			},
			aplCounts: {
				max: aplTargetPoints.reduce((most, [, count]) => Math.max(most, count), 0),
				points: aplTargetPoints,
			},
			multiTargetMs,
			multiTargetPct,
			thresholdPct: spec.thresholds.multiTargetSharePct,
			detected: detectedMode,
		},
		// The evidence both series above are reductions of, spread rather than assigned so a spec that
		// declared no aimed button writes no key at all. `spawns: undefined` and no `spawns` are different
		// facts to a reader that guards on `'spawns' in analysis`, and the second is the true one — see the
		// field's own docblock for why an empty aimed set may not produce rows.
		...(spawns === undefined ? {} : { spawns }),
		gear,
		talents: talents === null ? null : [...talents],
		raidBuffs,
		potions,
		resources: allResources,
	};

	// The two places the halves share one figure. The spec's audit found the wasted globals; the core
	// prices them against the time the pull actually occupied, so the deduction and the headline stay
	// readings of one clock.
	//
	// A count times a global rather than an interval subtraction, so a wasted press made outside the
	// contact clock is deducted from a numerator that never counted it. That errs downward — towards
	// reporting less filled time than the player managed — which is the direction a report about the
	// player's own faults should err in, and it is why nothing here can push the ratio above 100%.
	const wastedGcds = audit.cpm.wastedGcds ?? 0;
	const productiveMs = Math.max(0, occupiedMs - wastedGcds * effectiveGcd);

	// `core.timeline` and `audit.timeline` are both optional on their interfaces — the committed
	// fixtures predate them — but `analyseCore` itself always fills the first and the spec's audit
	// always fills the second, so the merged object is a complete `CastTimeline` in practice.
	return {
		...core,
		...audit,
		cpm: {
			...core.cpm,
			...audit.cpm,
			gcdUtilisationPct: inContactMs > 0 ? (productiveMs / inContactMs) * 100 : 0,
		},
		timeline: {
			...core.timeline,
			...audit.timeline,
			// Straight through from the fetch. Spread last so it cannot be clobbered by a spec that happens
			// to put a `phases` on its own timeline, and guarded so a dataset with no `phases` at all does
			// not write the key as `undefined`, which would clobber the audit's in the other direction.
			//
			// The two shapes this produces are **not** "no phases" versus "one phase", which is what this
			// comment claimed until a re-capture disproved it. `fetchFightDataset` always sets `phases`,
			// because `resolveFightPhases` always returns an array — so an encounter WarcraftLogs knows no
			// phases for, 6 of the 14 Siege ones and Kor'kron Dark Shaman among them, arrives here as `[]`
			// and is written as `[]`. Absent means only that the dataset never carried the field: the
			// committed fixtures predate it and hand-built test datasets omit it. Never-asked versus
			// asked-and-none, and nothing downstream distinguishes them — `CastTimeline` gates its gutter
			// and its note on `phases.length`, so both draw nothing. See `phasesPassthrough.test.ts`.
			...(dataset.phases === undefined ? {} : { phases: dataset.phases }),
		},
	} as Analysis;
}
