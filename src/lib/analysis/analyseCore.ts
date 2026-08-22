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
import { readGear } from './gear';
import { intersect, type Interval, unionMs } from './intervals';
import { makeLinker } from './links';
import { RAID_BUFF_NAMES, readRaidBuffs } from './raidBuffs';
import {
	countAt,
	intervalsAtLeast,
	isJudgeableTarget,
	spawnLives,
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
	 * The ability ids `combatantinfo` says were already on the player when the bell rang.
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
	 * fires on. Only a rule whose ability declares `multiTargetBenefit: 'trigger'` should band on it.
	 */
	triggerTargetCountAt(t: number): number;
	/**
	 * The declared bars, fully audited: a pool bar (cap time, regen rate) or a points bar (the
	 * reconstructed walk, the overflow) under the key the spec named it with. The engine computed
	 * these from the spec's `resources` config — the spec's audit reads its bars here instead of
	 * rebuilding them.
	 */
	resourceAudits: Record<string, ResourceBarAudit>;
	/** Cooldowns that sat ready and unused, judged against the engaged windows. */
	lostCasts: LostCastRow[];
	/**
	 * One mark per press, flattened out of the per-ability buckets, deduplicated — and nothing else.
	 * The spec's audit may decorate them (Storm, Earth and Fire carries the enemy it sent a spirit to)
	 * and returns the final marks as `timeline.casts`.
	 */
	marks: CastMark[];
	/** The potion's windows, including one that was already running when the bell went. */
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
	/** Names for ids the model deliberately does not carry — see the module doc in `spec/windwalker`. */
	extraNames: Record<number, string>;
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

/** The full analysis of one fight for one spec. */
export function analyseCore(dataset: FightDataset, settings: AnalysisSettings, spec: SpecConfig): Analysis {
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
	const spawnLifeByKey = spawnLives(damageEvents, t0, duration, spec.thresholds.targetWindowMs);
	const immuneSpawns = new Set([...spawnLifeByKey].filter(([, life]) => !isJudgeableTarget(life)).map(([key]) => key));
	const { abilities, eventTotal } = aggregateDamage(
		damageEvents,
		spec.registry,
		nameOf,
		ignoredMultiTargetIDs,
		immuneSpawns,
	);

	// ------------------------------------------------------------- the GCD
	// The effective global cooldown, measured rather than taken off the spec. The start of an instant
	// on-GCD press to the start of the next on-GCD press is exactly one GCD; a cast-time spell's gap
	// is its cast time, so those pairs are excluded. Floored at the game's 1s minimum and capped at the
	// spec's own GCD, so a fixed-GCD spec (Windwalker) keeps its declared value while a hasted one
	// (Elemental) lands on what the log actually did.
	const onGcdStarts: Array<{ start: number; instant: boolean; duration: number }> = [];
	for (const e of events) {
		if (e.sourceID !== actor.id || !isCast(e)) continue;
		const id = abilityIdOf(e);
		if (id === null || spec.registry.isChannelTick(id)) continue;
		const ability = spec.registry.abilityByCastId(id);
		if (ability === undefined || !ability.onGcd) continue;
		const t = e.timestamp - t0;
		const duration = castDurations.get(`${id}:${t}`);
		onGcdStarts.push({ start: t - (duration ?? 0), instant: duration === undefined, duration: duration ?? 0 });
	}
	onGcdStarts.sort((a, b) => a.start - b.start);
	const gcdGaps: number[] = [];
	for (let i = 1; i < onGcdStarts.length; i++) {
		if (!onGcdStarts[i - 1]!.instant) continue;
		gcdGaps.push(onGcdStarts[i]!.start - onGcdStarts[i - 1]!.start);
	}
	const effectiveGcd = gcdGaps.length > 0 ? Math.max(GCD_MIN_MS, Math.min(median(gcdGaps), spec.gcdMs)) : spec.gcdMs;

	/**
	 * Where each on-GCD press sat on the clock — spans, not a sum.
	 *
	 * Time *occupied*, which is not the same as time *used*: a press that bought nothing occupies its
	 * global just as thoroughly as one that did. Each on-GCD press occupies one effective GCD, except a
	 * cast-time spell, which occupies its *measured* cast length — the begincast-to-cast gap, with haste
	 * and reaction already in it, so no base-cast-time scaling is needed — and a channel, which occupies
	 * its real measured length instead. The deduction for a press that bought nothing happens in the
	 * spec's audit, via `cpm.wastedGcds`.
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
		const ms = channelMs === undefined ? Math.max(effectiveGcd, c.duration) : channelMs;
		return [c.start, c.start + ms];
	});

	// Read from the `combatantinfo` the event fetch already returned, so this costs no request.
	const gear = readGear(events, actor.id);

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
	const contact = engagedWindows(
		damageEvents
			.filter((e) => e.sourceID === actor.id && !(isDamage(e) && e.tick === true))
			.filter((e) => e.targetID !== undefined && enemyIDs.has(e.targetID))
			.filter((e) => {
				const id = abilityIdOf(e);
				return id !== null && spec.registry.abilityByDamageId(id) !== undefined;
			})
			.map((e) => e.timestamp - t0),
		spec.thresholds.engagedGapMs,
	);
	/** Named apart from `contactMs` further down, which is the target-count audit's own, narrower clock. */
	const inContactMs = unionMs(contact);

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
	const multiTargetHits = landedHits.filter((hit) => !ignoredMultiTargetIDs.has(hit.target));
	const targetPoints = targetCounts(multiTargetHits, spec.thresholds.targetWindowMs);
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
	const triggerTargetPoints = targetCounts(
		hitsOnAnything.filter((hit) => !ignoredMultiTargetIDs.has(hit.target)).filter(notOwnAreaDamage),
		spec.thresholds.targetWindowMs,
	);
	const triggerTargetCountAt = countAt(triggerTargetPoints);
	// The stretches themselves and not only their total: some audits ask whether any *one* of them
	// ran long enough to be worth something. Named here rather than counted twice.
	const multiTargetWindows = intervalsAtLeast(targetPoints, 2, duration);
	const multiTargetMs = unionMs(multiTargetWindows);
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
	const aoeWindows = intervalsAtLeast(aplTargetPoints, 3, duration);
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
			const gainsOf = (abilityID: number): number | undefined => {
				const ability = spec.registry.abilityByCastId(abilityID);
				if (ability === undefined) return undefined;
				for (const gain of config.gains ?? []) {
					if (gain.abilityKey === ability.key) return gain.amount;
				}
				return undefined;
			};
			resourceAudits[key] = pointsResourceAudit(
				config.type,
				events,
				actor.id,
				t0,
				gainsOf,
				samples,
				wclPowerTypeOf(config.type),
			);
		}
	}

	// ------------------------------------------------------------ lost casts
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
			const times = castTimes(ability);
			if (!times.length) return null;
			const live: Interval[] = spec.needsTarget.has(ability.key) && engaged.length ? engaged : [[0, duration]];
			const drift = cooldownDrift(times, ability, live, duration, cooldownLeewayMs, castBeginTimes(ability));
			return {
				id: ability.castIds[0] ?? 0,
				name: ability.name,
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
	 * The pull's potion windows, including the one that was already running when the bell went.
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
		 * exactly as it does after a press taken before the bell.
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
		 * bell or 0.5s after it.
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
	// `openAtPull` on both, and rung 2 only. A haste cooldown pressed just before the bell is ordinary
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
		lostCasts,
		targets: {
			windowMs: spec.thresholds.targetWindowMs,
			counts: {
				max: targetPoints.reduce((most, [, count]) => Math.max(most, count), 0),
				points: targetPoints,
			},
			multiTargetMs,
			multiTargetPct,
			thresholdPct: spec.thresholds.multiTargetSharePct,
			detected: detectedMode,
		},
		gear,
		raidBuffs,
		potions,
		resources: resourceAudits,
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
			// to put a `phases` on its own timeline, and omitted entirely when the fetch carried none rather
			// than written as an empty array — "WarcraftLogs knows no phases for this encounter" and "this
			// pull had one phase" are different facts, and 6 of the 14 Siege encounters are the first.
			...(dataset.phases === undefined ? {} : { phases: dataset.phases }),
		},
	} as Analysis;
}
