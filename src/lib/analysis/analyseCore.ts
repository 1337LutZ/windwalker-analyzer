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
import { abilityIdOf, eventsOn, instanceKey, isBeginCast, isCast, isDamage, isDeath, isResurrect } from '~/lib/events';
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
import { type Interval, unionMs } from './intervals';
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
	castTimes(ability: Ability): number[];
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
	multiTargetMs: number;
	/** The time with at least one enemy in the count window — the target mode's denominator. */
	contactMs: number;
	/** The live enemy count read at each press, with the spec's own multi-target evidence excluded. */
	aplTargetCountAt(t: number): number;
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

	// ------------------------------------------------------------------ casts
	// Keyed by ability, so Jab's two weapon ids are one row and a channel's ticks are not presses.
	const series = castSeries(events, actor.id, t0, spec.registry);
	const castList = buildCastTable(series.values(), { activeMs, nameOf });

	const castTimes = (ability: Ability): number[] => series.get(ability.key)?.times ?? [];
	const castPresses = (ability: Ability): CastPress[] => series.get(ability.key)?.presses ?? [];
	const castCount = (ability: Ability): number => series.get(ability.key)?.count ?? 0;

	// ----------------------------------------------------------------- channels
	// Every ability whose press locks the player out is measured at its real length from its tick
	// stream, so haste is already in the number. Windwalker has one; a spec may have none or several.
	const channels = new Map<string, Channel[]>();
	let channelledMs = 0;
	for (const ability of spec.registry.abilities) {
		if (!ability.channel) continue;
		const measured = measureChannels(castTimes(ability), channelTickTimes(events, ability, actor.id, t0));
		channels.set(ability.key, measured);
		channelledMs += measured.reduce((s, c) => s + c.channelMs, 0);
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

	// ------------------------------------------------------ cast durations
	// A cast-time spell logs a `begincast` when it starts and a `cast` when it completes; an instant
	// press logs only the `cast`. Pair each completed cast with the `begincast` that opened it to
	// measure the cast time, and treat a `begincast` no `cast` ever follows as a cancel. Keyed per
	// ability id and matched most-recent-first, because starting a second cast of the same spell
	// cancels the first — the log never says so, it just starts the next `begincast`.
	const MAX_CAST_MS = 5000;
	const MIN_CAST_MS = 100;
	const beginByAbility = new Map<number, number[]>();
	const castDurations = new Map<string, number>();
	for (const e of events) {
		if (e.sourceID !== actor.id) continue;
		const id = abilityIdOf(e);
		if (id === null) continue;
		const t = e.timestamp - t0;
		if (isBeginCast(e)) {
			const stack = beginByAbility.get(id) ?? [];
			stack.push(t);
			beginByAbility.set(id, stack);
		} else if (isCast(e)) {
			if (spec.registry.isChannelTick(id)) continue;
			const stack = beginByAbility.get(id);
			if (stack === undefined) continue;
			const begin = stack.length > 0 ? stack[stack.length - 1] : undefined;
			if (begin !== undefined && t - begin <= MAX_CAST_MS) {
				stack.pop();
				// A real cast time only: an instant press logs its `begincast` and `cast` in the same
				// instant, and that is not a bar worth drawing or a time worth carrying into a cancel's
				// median. Keyed by id and time, not time alone — an instant press lands in the same
				// millisecond as the cast that finished before it, and one key would hand it that cast's
				// time.
				if (t - begin >= MIN_CAST_MS) castDurations.set(`${id}:${t}`, t - begin);
			}
		}
	}

	// ------------------------------------------------------------- the GCD
	// The effective global cooldown, measured rather than taken off the spec. The start of an instant
	// on-GCD press to the start of the next on-GCD press is exactly one GCD; a cast-time spell's gap
	// is its cast time, so those pairs are excluded. Floored at the game's 1s minimum and capped at the
	// spec's own GCD, so a fixed-GCD spec (Windwalker) keeps its declared value while a hasted one
	// (Elemental) lands on what the log actually did.
	const GCD_MIN_MS = 1000;
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

	const onGcdCasts = castList.filter((c) => c.onGcd).reduce((s, c) => s + c.count, 0);
	const offGcdCasts = castList.filter((c) => !c.onGcd).reduce((s, c) => s + c.count, 0);
	// Time *occupied*, which is not the same as time *used* — a press that bought nothing occupies its
	// global just as thoroughly as one that did. Each on-GCD press occupies one effective GCD, except a
	// cast-time spell, which occupies its *measured* cast length — the begincast-to-cast gap, with
	// haste and reaction already in it, so no base-cast-time scaling is needed — and a channel, which is
	// counted at its real measured length. The deduction happens in the spec's audit, via
	// `cpm.wastedGcds`.
	const channelCount = [...channels.values()].reduce((s, list) => s + list.length, 0);
	const occupiedMs =
		Math.max(0, onGcdStarts.reduce((s, c) => s + Math.max(effectiveGcd, c.duration), 0) - channelCount * effectiveGcd) +
		channelledMs;

	// Read from the `combatantinfo` the event fetch already returned, so this costs no request.
	const gear = readGear(events, actor.id);

	// Beside the gear because it reads the same free `combatantinfo` — that event's aura list is the
	// only record of anything buffed before the pull, and without it a raid that buffs in the usual
	// place looks unbuffed.
	const raidBuffs = readRaidBuffs(events, actor.id, t0, fight.endTime);

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
	const landedHits: Array<TargetHit & { key: string; abilityID: number | null }> = [];
	for (const e of damageEvents) {
		if (e.sourceID !== actor.id || e.tick === true || e.targetID === undefined) continue;
		// A hit on a unit nothing can damage did not land on anything. Filtered here, at the one place
		// the hit list is built, rather than by each of the six readers of it — the target count and the
		// APL's band, the Windwalker's Rising Sun Kick coverage walk, the Elemental's "which enemy was
		// the player on" and its second-dot pick. Every one of them was reading a Crawler Mine on Iron
		// Juggernaut as an enemy in front of the player: it padded the fan-out count that decides
		// Rushing Jade Wind's three-target chi refund, and it charged a stretch of contact time as
		// uncovered by a debuff no debuff could ever have been on.
		if (!isJudgeableTarget(spawnLifeByKey.get(instanceKey(e.targetID, e.targetInstance)))) continue;
		landedHits.push({
			t: e.timestamp - t0,
			target: e.targetID,
			...(e.targetInstance === undefined ? {} : { instance: e.targetInstance }),
			key: instanceKey(e.targetID, e.targetInstance),
			abilityID: abilityIdOf(e),
		});
	}
	landedHits.sort((a, b) => a.t - b.t);

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
	const aplTargetHits = multiTargetHits.filter((hit) => !targetCountExcludedDamageIDs.has(hit.abilityID ?? -1));
	const aplTargetPoints = targetCounts(aplTargetHits, spec.thresholds.targetWindowMs);
	const aplTargetCountAt = countAt(aplTargetPoints);
	// The stretches themselves and not only their total: some audits ask whether any *one* of them
	// ran long enough to be worth something. Named here rather than counted twice.
	const multiTargetWindows = intervalsAtLeast(targetPoints, 2, duration);
	const multiTargetMs = unionMs(multiTargetWindows);
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
			const times = castTimes(ability);
			if (!times.length) return null;
			const live: Interval[] = spec.needsTarget.has(ability.key) && engaged.length ? engaged : [[0, duration]];
			const drift = cooldownDrift(times, ability, live, duration, cooldownLeewayMs);
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
	for (const [rawId, stack] of beginByAbility) {
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
	const hasteWindows = auraWindows(selfEvents, spec.registry.aura('bloodlust'), t0, fight.endTime);
	const berserkingWindows = auraWindows(selfEvents, spec.registry.aura('berserking'), t0, fight.endTime);

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
		registry: spec.registry,
		series,
		castList,
		castTimes,
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
		multiTargetMs,
		contactMs,
		aplTargetCountAt,
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
		cpm: {
			totalCpm: activeMs > 0 ? onGcdCasts / (activeMs / 60000) : 0,
			onGcdCasts,
			offGcdCasts,
			gcdSlots: Math.floor(activeMs / effectiveGcd),
			activeMs,
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
			gcdUtilisationPct: activeMs > 0 ? (productiveMs / activeMs) * 100 : 0,
		},
		timeline: {
			...core.timeline,
			...audit.timeline,
		},
	} as Analysis;
}
