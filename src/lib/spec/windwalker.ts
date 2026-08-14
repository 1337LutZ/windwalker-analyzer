// Windwalker Monk, MoP Classic 5.4.
//
// Everything specific to the spec lives here: the kit, the thresholds, and the wiring that turns
// the generic primitives in ../analysis into an Analysis. The primitives know nothing about monks;
// this file is the only thing that does.
//
// The kit is declared as data — Ability and Aura objects that name each other — and read back
// through a Registry. That is the whole point: a combat log is a stream of bare spell ids, and
// pairing two of them because their constants had similar names is how every early bug here got in.
// `registry.abilityByCastId(117418)` answers "nothing", because a channel tick is not a press.
//
// Ids are verified against qDZ2J7v4CP98aQmV #57 and KvCazMYkqZxfjRBg #48 (Garrosh HC 25).

import { abilityIdOf, eventsOn, isDamage } from '~/lib/events';
import { formatGap } from '~/lib/format';
import type { Ability, Aura, Channel, GameData } from '~/lib/game/model';
import { createRegistry } from '~/lib/game/registry';
import { DEFAULT_SETTINGS, clampHealth, clampLeeway, type AnalysisSettings } from '~/lib/settings';
import type {
	Analysis,
	BrewUse,
	FightDataset,
	LostCastRow,
	Miss,
	ProcWindow,
	SnapshotGrade,
	Window,
} from '~/lib/types';
import {
	aggregateDamage,
	auraTimeline,
	auraWindows,
	buildCastTable,
	castSeries,
	channelTickTimes,
	cooldownDrift,
	engagedWindows,
	inWindow,
	intersect,
	makeLinker,
	measureChannels,
	median,
	mergeIntervals,
	pairDrainsToWindows,
	primaryTargetID,
	damageByTarget,
	r1,
	remainingAtCast,
	remainingIn,
	snapshotWindowEnd,
	toIntervals,
	trackStackBank,
	unionMs,
	uptimePct,
	type Interval,
} from '../analysis';

// ------------------------------------------------------------------ constants
//
// Declared once and handed to the game objects below, so the model carries the number and nothing
// reads a bare one twice.

/** The Tigereye Brew bank caps at 20. Its removals are how a use is read — never the cast. */
const TEB_CAP = 20;
/** Stacks a full use drains. */
const TEB_DRAIN = 10;
/** A brew always lasts 15s; a re-cast refreshes it rather than extending it. */
const TEB_ACTIVE_MS = 15000;

const TIGER_POWER_MS = 20000;
const COMBO_BREAKER_MS = 15000;
/** The Rune's proc is shorter than the brew that snapshots it, and that gap is the whole game. */
const RE_ORIGINATION_MS = 10000;

/**
 * Stacks the bank must hold before a proc counts as a chance the player passed up.
 *
 * **The sim does not contain this rule.** An earlier version of this comment said it came from the
 * sim's priority list; that was checked against `ui/monk/windwalker/apls/default.apl.json` and is
 * false — no `4` appears anywhere in its Tigereye Brew logic. What the APL actually gates the
 * snapshot on is relative, not a floor:
 *
 *     "TEB: Stacks > Current"  ⇒  auraNumStacks(1247279) > auraNumStacks(1247275)
 *                                 bank stacks > stacks already frozen into the running brew
 *
 * which, with no brew running, is simply "at least one stack". So this constant is a judgement about
 * what is worth calling a mistake rather than a transcription of the rotation. It is deliberately
 * the stricter of the two readings: it only ever *excuses* procs, so it can never invent a fault.
 * Changing it moves the catch-rate denominator and nothing else.
 *
 * **Kept at four deliberately**, with the divergence from the APL known and accepted: a brew spent on
 * four stacks or fewer is too small to be worth the global, so a proc that only ever offered that is
 * not a chance the player passed up. Do not "correct" it to the APL's condition without asking — the
 * difference is the point, not an oversight.
 *
 * This is what separates a proc the player *missed* from one they were never offered. A pull opens
 * with an empty bank, so the first proc routinely arrives with nothing to spend — counting it as a
 * failure told players they had missed something they could not have taken.
 *
 * Measured against the bank's **peak across the proc window**, not its level at the proc's start:
 * stacks keep building during the ten seconds, so a proc can open under the threshold and cross it
 * with several seconds still to run. Judging at the start alone marks those as impossible when the
 * late brew — which is the play the rotation actually wants — was there to be taken.
 */
const SNAPSHOT_STACK_FLOOR = 4;

/**
 * Fists of Fury is the kit's only channel. Its ticks log as `cast` under their own id, so the
 * channel has to be counted off its own id and its length measured from the ticks; counting by name
 * turned 12 channels into 71 casts.
 */
const FOF_CHANNEL: Channel = { tickId: 117418, baseMs: 4000 };

export const GCD_MS = 1000;

/**
 * Share of a player's damage that has to land on one enemy before debuff uptime on that enemy is
 * worth grading.
 *
 * Measured across 25 real kills: single-target pulls sit near 100%, while the add fights that
 * produced the false red grades sit far below. Two thirds is comfortably between the two groups
 * rather than tuned to either.
 */
export const SINGLE_TARGET_SHARE_PCT = 66;

// -------------------------------------------------------------------- the kit
//
// `onGcd` marks the abilities that consume a global cooldown. Everything else the player presses
// (brews, trinkets, racials, potions, Roll) is off-GCD and must not inflate GCD utilisation.
//
// `gate` is what actually limits the button, and it decides whether a "lost cast" figure means
// anything: `chi` and `energy` buttons have no cooldown to drift against, `conditional` ones are
// judged against their conditions, and `other` is counted but never scored.

const ABILITIES: Ability[] = [
	{
		key: 'jab',
		name: 'Jab',
		// One id per weapon type, and the full set matters: a monk holding a weapon whose id is missing
		// has every Jab dropped from the cast table silently. Verified against the sim's game database
		// — these are the Mists-era player spells named `Jab`, each with its own icon — after a real
		// log turned up damage under 115693, which this list did not have.
		//
		// 100780 is the sim's canonical id (`sim/monk/jab.go`) and the one the APL casts.
		castIds: [100780, 108557, 115687, 115693, 115695, 115698],
		damageIds: [100780, 108557, 115687, 115693, 115695, 115698],
		onGcd: true,
		// Energy, not chi: 40 energy for 2 chi (`sim/monk/jab.go`, `EnergyCost.Cost: 40` then
		// `AddChi`). It is the generator the spenders live on, so gating it on chi had the economy
		// backwards.
		gate: 'energy',
	},
	{
		key: 'tiger-palm',
		name: 'Tiger Palm',
		castIds: [100787],
		damageIds: [100787],
		onGcd: true,
		gate: 'chi',
		applies: ['tiger-power'],
		consumes: ['combo-breaker-tiger-palm'],
	},
	{
		key: 'blackout-kick',
		name: 'Blackout Kick',
		castIds: [100784],
		damageIds: [100784, 128531],
		onGcd: true,
		gate: 'chi',
		applies: ['blackout-kick-dot'],
		consumes: ['combo-breaker-blackout-kick'],
	},
	{
		key: 'rising-sun-kick',
		name: 'Rising Sun Kick',
		castIds: [107428],
		damageIds: [107428],
		onGcd: true,
		gate: 'cooldown',
		cooldownMs: 8000,
		// The uptime metric hangs off the debuff this applies, never off the cast id.
		applies: ['rising-sun-kick-debuff'],
	},
	{
		key: 'fists-of-fury',
		name: 'Fists of Fury',
		castIds: [113656],
		damageIds: [FOF_CHANNEL.tickId],
		onGcd: true,
		gate: 'conditional',
		cooldownMs: 25000,
		channel: FOF_CHANNEL,
		/**
		 * It has a 25s cooldown but is never played off it. It is a ~4s channel that locks you out of
		 * everything else, so the sim's Windwalker APL
		 * (wowsims-mop/ui/monk/windwalker/apls/default.apl.json, priority 24) gates it on three
		 * conditions and ranks it *below* Rising Sun Kick, Tiger Palm, Chi Wave and Combo Breaker:
		 * Blackout Kick:
		 *   1. time-to-energy-cap must exceed the channel, so the channel never overcaps energy
		 *   2. not during Energizing Brew, unless Rushing Jade Wind covers the whole channel
		 *   3. if Re-Origination is up, only channel when the proc outlasts it AND a brew is running
		 * Scoring it as "N of M possible casts" is the same fabricated indictment as doing it to Jab,
		 * which is what `gate: 'conditional'` is there to prevent.
		 */
		note: 'Judged against the APL conditions, never against its cooldown.',
	},
	{
		key: 'rushing-jade-wind',
		name: 'Rushing Jade Wind',
		castIds: [116847],
		damageIds: [148187],
		onGcd: true,
		// 40 energy, and it generates chi (`sim/monk/talents.go`, `registerRushingJadeWind`).
		gate: 'energy',
		applies: ['rushing-jade-wind'],
	},
	{
		key: 'spinning-crane-kick',
		name: 'Spinning Crane Kick',
		castIds: [101546],
		damageIds: [107270],
		onGcd: true,
		// 40 energy for 1 chi (`sim/monk/spinning_crane_kick.go`).
		gate: 'energy',
	},
	{
		key: 'chi-wave',
		name: 'Chi Wave',
		castIds: [115098],
		damageIds: [132467],
		onGcd: true,
		gate: 'cooldown',
		cooldownMs: 15000,
	},
	{
		key: 'expel-harm',
		name: 'Expel Harm',
		castIds: [115072],
		// Its damage lands under its own id, not the cast's.
		damageIds: [115129],
		onGcd: true,
		// It has a real 15s cooldown, but it is absent from the Windwalker APL — it is played for the
		// heal, not the damage — so holding it is not a fault this report may name.
		gate: 'other',
	},
	{
		key: 'flying-serpent-kick',
		name: 'Flying Serpent Kick',
		castIds: [101545],
		damageIds: [123586],
		onGcd: true,
		gate: 'other',
		// A movement button. It does damage, and that damage is counted — but it is not a rotation
		// decision, so it is kept out of the per-ability comparison for the same reason a trinket proc
		// is: the chart is about choices, and nobody presses this one for the numbers.
		utility: true,
	},
	{
		key: 'touch-of-karma',
		name: 'Touch of Karma',
		castIds: [122470],
		// The reflect lands under its own id, which is how the damage it returned can be measured.
		damageIds: [124280],
		onGcd: true,
		// A defensive, but one that does real damage: it redirects what you take onto the target, so an
		// unused charge is damage not done as well as damage not avoided. 90s verified in the game
		// database (`SpellCooldowns.RecoveryTime` for 122470); the sim does not model it at all.
		//
		// It was previously left ungated on the reasoning that holding a defensive is not a fault. That
		// still holds for *when* it goes out — which is why it is `conditional` rather than `cooldown`,
		// so it is never billed for drift — but how many of its charges went unused across a pull is a
		// fair thing to show.
		gate: 'conditional',
		cooldownMs: 90000,
	},
	{
		key: 'leg-sweep',
		name: 'Leg Sweep',
		castIds: [119381],
		onGcd: true,
		gate: 'other',
	},
	{
		key: 'energizing-brew',
		name: 'Energizing Brew',
		castIds: [115288],
		onGcd: false,
		// Conditional, not a cooldown to hold to. The sim's APL presses it on
		// `energyTimeToCap > 5s AND (Bloodlust inactive OR (Rushing Jade Wind known AND >1 target))`,
		// so holding it through Bloodlust is the intended play. Scored as a cooldown it produced
		// "lost casts" for doing the right thing.
		gate: 'conditional',
		cooldownMs: 60000,
		applies: ['energizing-brew'],
		note: 'Held deliberately through Bloodlust, so it is never judged against its cooldown.',
	},
	{
		key: 'chi-brew',
		name: 'Chi Brew',
		castIds: [115399],
		onGcd: false,
		// Two charges on a 45s recharge (`sim/monk/talents.go`: `Charges: 2, RechargeTime: 45s`), and
		// conditional on top. Drift measured against a flat 45s cooldown misreads a charge-banked
		// ability completely — holding both charges for a burst window is correct play, and the old
		// model billed it as two lost casts.
		gate: 'conditional',
		cooldownMs: 45000,
		note: 'Two charges on a 45s recharge, and spent to a condition rather than on cooldown.',
	},
	{
		key: 'storm-earth-and-fire',
		name: 'Storm, Earth and Fire',
		castIds: [138228],
		// On the global, which is why its absence mattered: every press was missing from the on-GCD
		// count, so GCD utilisation was understated for anyone playing it.
		onGcd: true,
		gate: 'conditional',
		note: "Spent on the APL's target conditions rather than on a cooldown.",
	},
	{
		key: 'invoke-xuen',
		name: 'Invoke Xuen, the White Tiger',
		castIds: [123904],
		onGcd: false,
		gate: 'cooldown',
		cooldownMs: 180000,
	},
	{
		key: 'touch-of-death',
		name: 'Touch of Death',
		castIds: [115080],
		onGcd: true,
		// The APL's top priority when it is available, but availability is a health threshold on the
		// target rather than a cooldown coming up, so drift against it would be fiction.
		gate: 'conditional',
	},
	{
		key: 'tigereye-brew',
		name: 'Tigereye Brew',
		castIds: [1247275],
		onGcd: false,
		gate: 'other',
		applies: ['tigereye-brew'],
		consumes: ['tigereye-brew-bank'],
	},
];

const AURAS: Aura[] = [
	{
		key: 'tigereye-brew-bank',
		name: 'Tigereye Brew (bank)',
		ids: [1247279],
		kind: 'buff',
		maxStacks: TEB_CAP,
		drainsPerUse: TEB_DRAIN,
		// Nothing applies it: it is earned by spending chi, and only its removals are readable.
		consumedBy: ['tigereye-brew'],
	},
	{
		key: 'tigereye-brew',
		name: 'Tigereye Brew',
		ids: [1247275],
		kind: 'buff',
		durationMs: TEB_ACTIVE_MS,
		// A re-cast restarts the 15s rather than extending it, and WarcraftLogs records that as a
		// `refreshbuff` inside the running window — so one apply→remove pair can cover two brews, and
		// only the second one's snapshot is live.
		refreshRestarts: true,
		appliedBy: 'tigereye-brew',
	},
	{
		key: 'tiger-power',
		name: 'Tiger Power',
		ids: [125359],
		kind: 'buff',
		durationMs: TIGER_POWER_MS,
		appliedBy: 'tiger-palm',
	},
	{
		key: 'combo-breaker-tiger-palm',
		name: 'Combo Breaker: Tiger Palm',
		ids: [118864],
		kind: 'buff',
		durationMs: COMBO_BREAKER_MS,
		consumedBy: ['tiger-palm'],
	},
	{
		key: 'combo-breaker-blackout-kick',
		name: 'Combo Breaker: Blackout Kick',
		ids: [116768],
		kind: 'buff',
		durationMs: COMBO_BREAKER_MS,
		consumedBy: ['blackout-kick'],
	},
	{
		key: 'rising-sun-kick-debuff',
		name: 'Rising Sun Kick (debuff)',
		ids: [130320],
		kind: 'debuff',
		appliedBy: 'rising-sun-kick',
	},
	{
		key: 'blackout-kick-dot',
		name: 'Blackout Kick (DoT)',
		ids: [128531],
		kind: 'debuff',
		appliedBy: 'blackout-kick',
	},
	{
		key: 'energizing-brew',
		name: 'Energizing Brew',
		ids: [115288],
		kind: 'buff',
		appliedBy: 'energizing-brew',
	},
	{
		key: 'rushing-jade-wind',
		name: 'Rushing Jade Wind',
		ids: [116847],
		kind: 'buff',
		appliedBy: 'rushing-jade-wind',
	},
	{
		key: 're-origination',
		name: 'Re-Origination',
		/**
		 * Rune of Re-Origination converts your two lowest secondary stats into twice as much of your
		 * highest, and logs a *different aura per stat gained*. Which one you get depends on what else
		 * was up at the proc, so a single fight can mix all three — reading only Mastery undercounted
		 * one monk by 3 of his 15 procs. Mapping confirmed two ways: the DBC effect order (index 0 is
		 * the rating gained) and the sim's own sim/common/mop/trinkets_phase_3_52.go.
		 */
		ids: [139117, 139120, 139121],
		variants: { 139117: 'Crit', 139120: 'Mastery', 139121: 'Haste' },
		kind: 'buff',
		durationMs: RE_ORIGINATION_MS,
	},
];

export const WINDWALKER: GameData = { abilities: ABILITIES, auras: AURAS };

/** The one way to ask what a spell id means. Construction validates the links between the two lists. */
export const registry = createRegistry(WINDWALKER);

const RISING_SUN_KICK = registry.ability('rising-sun-kick');
const FISTS_OF_FURY = registry.ability('fists-of-fury');
const TIGER_PALM = registry.ability('tiger-palm');
const TOUCH_OF_KARMA = registry.ability('touch-of-karma');
const TIGEREYE_BREW = registry.ability('tigereye-brew');

const BREW = registry.aura('tigereye-brew');
const BREW_BANK = registry.aura('tigereye-brew-bank');
const RE_ORIGINATION = registry.aura('re-origination');
const RSK_DEBUFF = registry.aura('rising-sun-kick-debuff');
const TIGER_POWER = registry.aura('tiger-power');
const CB_TIGER_PALM = registry.aura('combo-breaker-tiger-palm');
const ENERGIZING_BREW = registry.aura('energizing-brew');
const RUSHING_JADE_WIND = registry.aura('rushing-jade-wind');
const COMBO_BREAKERS = [CB_TIGER_PALM, registry.aura('combo-breaker-blackout-kick')];

/** The id an aura is reported under. Every aura above declares at least one. */
const auraId = (aura: Aura): number => aura.ids[0] ?? 0;
/** The id an ability is reported under. Likewise. */
const castId = (ability: Ability): number => ability.castIds[0] ?? 0;

/**
 * The buttons the APL presses on cooldown: exactly the abilities the model gates on `cooldown`.
 * Fists of Fury is deliberately not among them — it is a conditional channel — and Jab, Blackout
 * Kick, Tiger Palm and Rushing Jade Wind have no cooldown to drift against.
 */
const ON_COOLDOWN: Ability[] = ABILITIES.filter((a) => a.gate === 'cooldown');

/** Holding these is only a mistake while the boss is up. The other two are resource cooldowns. */
const NEEDS_TARGET: ReadonlySet<string> = new Set(['rising-sun-kick', 'chi-wave']);

/**
 * Names for the ids the model deliberately does not carry: off-GCD utility and consumables, which
 * are counted but never scored, and damage with no cast behind it. Nothing here is an Ability,
 * which is exactly what marks its damage passive — autoattacks, Tiger Strikes, trinket and enchant
 * procs and external buffs are a readout of gear rather than something to coach. WarcraftLogs' own
 * damage table fills in anything not listed; whatever is still unknown renders as `#id`.
 */
const EXTRA_NAMES: Record<number, string> = {
	1: 'Melee',
	116841: "Tiger's Lust",
	109132: 'Roll',
	122783: 'Diffuse Magic',
	115203: 'Fortifying Brew',
	116705: 'Spear Hand Strike',
	116709: 'Spear Hand Strike',
	120273: 'Tiger Strikes',
	120274: 'Tiger Strikes',
	120278: 'Tiger Strikes',
	146061: 'Multistrike',
	124335: 'Swift Reflexes',
	115129: 'Expel Harm',
	137596: 'Capacitance',
	137597: 'Lightning Strike',
	146194: 'Flurry of Xuen',
	147891: 'Flurry of Xuen',
	145024: 'Focus of Xuen',
	126734: 'Synapse Springs',
	26297: 'Berserking',
	6262: 'Healthstone',
	105697: "Virmen's Bite",
	120032: 'Dancing Steel',
	148903: 'Vicious',
};

// ---------------------------------------------------------------- thresholds

/** The APL threshold for a Tiger Palm refresh: auraRemainingTime(Tiger Power) <= 1s. */
export const TP_REFRESH_WINDOW_MS = 1000;

/**
 * How late inside a Re-Origination proc a brew went out. The brew keeps the Rune's converted stats
 * for its whole 15s while the proc lasts 10, so the target is the final global of the proc: every
 * second of proc left on the clock is a second of boosted brew given away.
 *
 * Exactly one global, and derived from `GCD_MS` rather than written out, because that is what the
 * label on the chart claims it is. It used to be a hand-set 1500ms — a reaction-time allowance
 * borrowed from the 1.5s spell global — which made the band half again as wide as a Windwalker
 * global actually is: this spec's buttons cost energy and chi, so the global is a flat 1.0s that
 * haste does not shorten. A brew landing 1.4s before the proc ended was being credited as landing
 * on the last global when a full global had in fact gone by.
 */
/**
 * The default reaction window: one global.
 *
 * Kept as the engine's default rather than its rule. A player on 200ms latency is logged 200ms after
 * they acted, and someone who deliberately brews with a two-second cushion is playing a considered
 * game — so the window is a setting, and this is only where it starts. See `lib/settings`.
 */
export const LAST_GCD_MS = GCD_MS;
/** Still respectable. */
export const LATE_MS = 3000;

/**
 * How long after a Touch of Karma its redirect can still be landing.
 *
 * Not the ten seconds the tooltip advertises. Measured against a real pull, the redirect ticks once
 * a second from about 2.8s after the cast through to 11.8s — the aura goes up a moment after the
 * press and the ticks run on from there — so a flat ten-second window silently dropped the last two
 * ticks and under-reported the use by a fifth. Generous on purpose: ticks are attributed to the most
 * recent cast before them, so a wide bound cannot steal damage from a neighbouring use, while a
 * tight one loses damage outright.
 *
 * The *cap* on what it redirects is a share of maximum health and *cannot* be measured from these
 * logs: MoP Classic reports carry no `combatantInfo` and no `maxHitPoints` on any event — checked
 * across damage-taken, healing and resource events, on an anonymous report and an ordinary one. So
 * the report says what each use returned and never claims what it could have.
 */
export const KARMA_WINDOW_MS = 20000;

/** A proc window this close to the full duration ran out instead of being spent. */
export const CB_EXPIRY_SLACK_MS = 500;

/** A gap this long in damage to the primary target means it went untargetable. */
export const ENGAGED_GAP_MS = 15000;
/** Debuff gaps shorter than this are refresh jitter, not drops. */
export const DROP_MS = 1000;

// -------------------------------------------------------------------- engine

/** The full analysis of one fight for one Windwalker. */
export function analyse(dataset: FightDataset, settings: AnalysisSettings = DEFAULT_SETTINGS): Analysis {
	// The one threshold the reader owns. Everything else here is the spec's; this is theirs, because
	// it describes their latency and their hands rather than the rotation.
	const snapshotLeewayMs = clampLeeway(settings.snapshotLeewayMs);
	const { code, fight, actor, events, table, actors } = dataset;
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
	const nameOf = (id: number): string => EXTRA_NAMES[id] ?? tableNames[id] ?? `#${id}`;

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
	const series = castSeries(events, actor.id, t0, registry);
	const castList = buildCastTable(series.values(), { activeMs, nameOf });

	const castTimes = (ability: Ability): number[] => series.get(ability.key)?.times ?? [];
	const castCount = (ability: Ability): number => series.get(ability.key)?.count ?? 0;

	const fofChannels = measureChannels(castTimes(FISTS_OF_FURY), channelTickTimes(events, FISTS_OF_FURY, actor.id, t0));
	const fofChannelMs = fofChannels.reduce((s, c) => s + c.channelMs, 0);

	// ----------------------------------------------------------------- damage
	const damageEvents = events.filter(isDamage).filter((e) => mine(e.sourceID));
	const { abilities, eventTotal } = aggregateDamage(damageEvents, registry, nameOf);

	const onGcdCasts = castList.filter((c) => c.onGcd).reduce((s, c) => s + c.count, 0);
	const offGcdCasts = castList.filter((c) => !c.onGcd).reduce((s, c) => s + c.count, 0);
	// Each on-GCD press occupies one GCD, except Fists of Fury, whose channel is counted at its real
	// measured length instead of the single GCD its cast event implies.
	const occupiedMs = (onGcdCasts - fofChannels.length) * GCD_MS + fofChannelMs;

	// ---------------------------------------------------------- Tigereye Brew
	const bank = trackStackBank(events, BREW_BANK, actor.id, t0);
	// Classic logs report combatantinfo.specID as 0 and talentTree as empty, so the spec has to be
	// inferred. Tigereye Brew is Windwalker-only, which makes its bank aura the reliable tell: a
	// Brewmaster or Mistweaver produces none of it. Without this guard the analysis still "succeeds"
	// and reports nonsense — one Brewmaster came out at 0% Rising Sun Kick uptime with 59 of 61 Tiger
	// Palms wasted, which is simply what a tank's rotation looks like through a Windwalker lens.
	const isSpec = bank.timeline.length > 0;

	const brewWindows = auraWindows(selfEvents, BREW, t0, fight.endTime);
	const uses: BrewUse[] = pairDrainsToWindows(bank.drains, brewWindows).filter((d) => d.window !== null);
	const totalConsumed = uses.reduce((s, u) => s + u.consumed, 0);

	// ---------------------------------------------------------- Re-Origination
	// Each window carries the id that opened it, which is what says which stat came back.
	const rawProcs = auraWindows(selfEvents, RE_ORIGINATION, t0, fight.endTime);
	const statOf = (index: number): string => rawProcs[index]?.variant ?? RE_ORIGINATION.name;

	const procs: ProcWindow[] = rawProcs.map((w, i) => ({
		...w,
		spellID: w.id,
		stat: statOf(i),
		lengthMs: w.end - w.start,
		// Filled in below, once the brew bank is known.
		stacksAvailable: 0,
		couldSnapshot: false,
		// A proc that grants the same stat as the one before it changes nothing you were not already
		// holding — worth flagging, because a "missed" repeat is far cheaper than a missed switch.
		sameAsPrevious: i > 0 && statOf(i - 1) === statOf(i),
		snapshotAt: null,
		snapshotEnd: null,
		snapshotStacks: null,
		brewEnd: null,
		remainingMs: null,
		depthPct: null,
		grade: 'none' as SnapshotGrade,
		brewAlreadyUp: false,
		heldStat: null,
		redundant: false,
		brewCastInside: 0,
		stacksInside: 0,
		gapToNextMs: null,
		overlaps: [],
		devaluedMs: 0,
		wastedMs: 0,
		backToBack: false,
		backToBackWasted: false,
		b2bRole: null,
		b2bWaste: false,
		b2bWith: [],
		nextStat: null,
		// Filled in below, once the brew uses are known.
		missedByMs: null,
	}));

	for (const w of procs) {
		// A brew that landed just after the proc expired is a different mistake from never brewing at
		// all: the player read the proc and moved, and their latency or their hand cost them the
		// snapshot. Judged against the reader's own leeway — the same number that decides how late a
		// brew can be and still count as the final global — because it is the same slop, on the other
		// side of the boundary.
		const justAfter = uses.find((u) => u.t > w.end && u.t - w.end <= snapshotLeewayMs);
		w.missedByMs = justAfter ? justAfter.t - w.end : null;

		const inside = uses.filter((u) => u.t >= w.start && u.t <= w.end);
		// The last brew inside the proc is the one whose 15s carries furthest past it.
		const snap = inside[inside.length - 1] ?? null;
		w.brewCastInside = inside.length;
		w.stacksInside = inside.reduce((s, u) => s + u.consumed, 0);
		if (snap) {
			const remaining = w.end - snap.t;
			w.snapshotAt = snap.t;
			w.snapshotStacks = snap.consumed;
			// Seconds of proc still on the clock when the brew went out — lower is better, 0 is ideal.
			w.remainingMs = remaining;
			w.depthPct = ((snap.t - w.start) / w.lengthMs) * 100;
			w.grade = remaining <= snapshotLeewayMs ? 'last-gcd' : remaining <= LATE_MS ? 'late' : 'early';
		} else {
			// A brew already running when the proc landed benefits from it but was not aimed at it.
			w.brewAlreadyUp = brewWindows.some((b) => b.start < w.end && b.end > w.start);
		}
	}

	// Not every unsnapshotted proc costs anything. If the brew that was already running had itself
	// snapshotted a proc of the *same* stat, the player is already holding exactly those stats and
	// re-brewing would capture nothing new — that is redundant, not a miss. A different stat is a real
	// loss, because the running brew is holding the wrong conversion.
	for (const w of procs) {
		if (w.snapshotAt !== null || !w.brewAlreadyUp) continue;
		const brew = brewWindows.find((b) => b.start < w.end && b.end > w.start);
		if (!brew) continue;
		const heldBy = procs.find((p) => p.snapshotAt !== null && p.snapshotAt >= brew.start && p.snapshotAt <= brew.end);
		w.heldStat = heldBy?.stat ?? null;
		w.redundant = !!heldBy && heldBy.stat === w.stat;
	}

	// Back-to-back procs are the unlucky roll. You hold the brew to the end of a proc, snapshot it, and
	// the Rune immediately fires again — so for those seconds you would have had those stats live
	// anyway, and the snapshot you paid 10 stacks for is worth only its margin over a proc you were
	// getting for free. Measured as the overlap between the later procs and the brew this one
	// snapshotted; that overlap is exactly the devalued portion.
	procs.forEach((w, i) => {
		const next = procs[i + 1];
		w.gapToNextMs = next ? next.start - w.end : null;
		w.nextStat = next?.stat ?? null;

		const snapStart = w.snapshotAt;
		if (snapStart === null) return;
		// Take the window already paired with the drain rather than searching by timestamp: snapshotAt
		// is the bank-drain stamp, which lands ~1 ms before the brew's own applybuff, so a
		// `>= window.start` search misses its own window every time and silently reports zero
		// back-to-back procs.
		const brew = uses.find((u) => u.t === snapStart)?.window ?? null;
		w.brewEnd = brew?.end ?? null;
		if (!brew) return;

		const nextUse = uses.find((u) => u.t > snapStart);
		const snapEnd = snapshotWindowEnd(snapStart, brew, BREW, nextUse?.t ?? null);
		w.snapshotEnd = snapEnd;
		// A snapshot runs up to 15s and the Rune's internal cooldown is 10s, so one can still be
		// overlapped by more than one later proc. Walk forward until a proc starts after it has expired.
		for (let j = i + 1; j < procs.length; j++) {
			const p = procs[j];
			if (!p || p.start >= snapEnd) break;
			const ms = Math.min(snapEnd, p.end) - Math.max(snapStart, p.start);
			if (ms > 0) w.overlaps.push({ index: j, stat: p.stat, ms });
		}
		w.devaluedMs = w.overlaps.reduce((s, o) => s + o.ms, 0);
		// Whether an overlap wastes anything depends entirely on the stat. Another Mastery proc on top
		// of a snapshotted Mastery brew hands back what is already frozen in; a proc that returns a
		// *different* stat stacks something new on top. That is what elixir weaving buys — swapping the
		// Agility elixir for a Haste one makes Haste the highest secondary, so the next proc converts
		// into Haste (energy regen) instead of re-serving the Mastery already frozen into the brew.
		w.wastedMs = w.overlaps.filter((o) => o.stat === w.stat).reduce((s, o) => s + o.ms, 0);
		w.backToBack = w.overlaps.length > 0;
		w.backToBackWasted = w.wastedMs > 0;
	});

	// A back-to-back is a relationship, so both halves belong to it: the proc whose snapshot was
	// overlapped *and* every proc that overlapped it. Marking only the source leaves single-row bands
	// in the report for what is by definition a two-or-more-row event.
	procs.forEach((w, i) => {
		if (!w.backToBack) return;
		w.b2bRole = 'source';
		w.b2bWaste ||= w.backToBackWasted;
		for (const o of w.overlaps) {
			const p = procs[o.index];
			if (!p) continue;
			p.b2bRole ??= 'follow-up';
			p.overlapOfMs = o.ms;
			p.overlapOfIndex = i;
			p.b2bWaste ||= o.stat === w.stat;
			w.b2bWith.push(o.index);
		}
	});

	// The most the bank held at any point the proc was still running.
	//
	// It starts from the level carried in from before the window rather than from zero: the timeline
	// only records changes, so a proc that spans no change at all would otherwise read as an empty
	// bank when in fact it sat on a full one the whole time.
	const peakBankDuring = (start: number, end: number): number => {
		let carried = 0;
		let peak = 0;
		for (const [at, stacks] of bank.timeline) {
			if (at < start) {
				carried = stacks;
				continue;
			}
			if (at > end) break;
			peak = Math.max(peak, stacks);
		}
		return Math.max(peak, carried);
	};
	for (const w of procs) {
		w.stacksAvailable = peakBankDuring(w.start, w.end);
		// A proc the player actually brewed on was affordable by demonstration, whatever the floor
		// says — the rotation permits brewing below it, and excluding those produced catch rates above
		// 100% (a caught proc counted in the numerator and not the denominator).
		w.couldSnapshot = w.snapshotAt !== null || w.stacksAvailable > SNAPSHOT_STACK_FLOOR;
	}

	const opportunities = procs.filter((w) => w.couldSnapshot);
	const snapshotted = procs.filter((w) => w.snapshotAt !== null);
	// Every early snapshot throws away the proc's remainder; every proc never captured throws away its
	// whole window — unless it was redundant, which costs nothing. Same currency throughout: seconds of
	// Re-Origination-boosted brew not taken.
	const secondsGivenAway = r1(
		(snapshotted.reduce((s, w) => s + (w.remainingMs ?? 0), 0) +
			procs.filter((w) => w.snapshotAt === null && !w.redundant).reduce((s, w) => s + w.lengthMs, 0)) /
			1000,
	);
	const devaluedSec = r1(procs.reduce((s, w) => s + w.wastedMs, 0) / 1000);
	const statMix = procs.reduce<Record<string, number>>((acc, w) => {
		acc[w.stat] = (acc[w.stat] ?? 0) + 1;
		return acc;
	}, {});

	// ------------------------------------------------------- Rising Sun Kick
	const primaryID = primaryTargetID(damageEvents);

	/**
	 * How much of the player's damage the primary target took.
	 *
	 * Rising Sun Kick's debuff is per-target, and uptime is only a fair thing to grade when there was
	 * one target to keep it on. On Immerseus, Spoils of Pandaria, Galakras or either two-boss fight
	 * the damage is spread across adds by design, and measuring the debuff against whichever enemy
	 * happened to take the most produced uptimes as low as 0.6% — read as a red grade, for a player
	 * doing exactly what the fight asked. Below the threshold the metric declines to grade rather than
	 * inventing a fault; the number is still shown, with the caveat.
	 */
	const primaryDamageShare = (() => {
		const byTarget = damageByTarget(damageEvents);
		const total = [...byTarget.values()].reduce((sum, amount) => sum + amount, 0);
		if (total <= 0 || primaryID === undefined) return 0;
		return ((byTarget.get(primaryID) ?? 0) / total) * 100;
	})();
	const primaryGameID = (table.fight.enemyNPCs ?? []).find((n) => n.id === primaryID)?.gameID ?? null;
	// Scoped to the primary target: the same debuff on an add says nothing about the boss.
	const rskWindows = auraWindows(
		events.filter((e) => e.targetID === primaryID),
		RSK_DEBUFF,
		t0,
		fight.endTime,
	);
	const rskMerged = mergeIntervals(toIntervals(rskWindows));
	const engaged = engagedWindows(
		damageEvents.filter((e) => e.targetID === primaryID).map((e) => e.timestamp - t0),
		ENGAGED_GAP_MS,
	);
	const engagedMs = unionMs(engaged);
	const rskEngagedMs = unionMs(intersect(rskMerged, engaged));

	const allGaps: Array<{ t: number; ms: number }> = [];
	for (let i = 1; i < rskMerged.length; i++) {
		const prev = rskMerged[i - 1];
		const cur = rskMerged[i];
		if (prev && cur) allGaps.push({ t: prev[1], ms: cur[0] - prev[1] });
	}
	// The single longest gap is treated as the intermission. A heuristic: on a fight with two of them
	// it under-reports by one, which is why every window is kept in the output.
	const longestGap = Math.max(0, ...allGaps.map((g) => g.ms));
	const drops = allGaps.filter((g) => g.ms > DROP_MS && g.ms !== longestGap);

	// ---------------------------------------------------------- Combo Breaker
	const comboBreaker = COMBO_BREAKERS.map((aura) => {
		const windows = auraWindows(selfEvents, aura, t0, fight.endTime);
		const full = aura.durationMs ?? COMBO_BREAKER_MS;
		const expired = windows.filter((w) => w.end - w.start >= full - CB_EXPIRY_SLACK_MS);
		// The label is the button the proc makes free, which is exactly what consumes it.
		const label = (aura.consumedBy ?? []).map((key) => registry.ability(key).name).join(', ') || aura.name;
		return {
			id: auraId(aura),
			label,
			procs: windows.length,
			wasted: expired.length,
			expired,
		};
	});

	// ------------------------------------------------------------ Tiger Palm
	// Every Tiger Palm should be either a free Combo Breaker proc or a Tiger Power refresh. Anything
	// else clipped a healthy buff and burned a global that a Jab or Blackout Kick wanted. The buff
	// clock is read through `remainingAtCast`, which is blind to the refresh the press itself caused
	// — that refresh is stamped a millisecond *before* the cast, and reading it scored every press a
	// full 20s.
	const cbTigerPalmWindows = auraWindows(selfEvents, CB_TIGER_PALM, t0, fight.endTime);
	const tigerPowerTimeline = auraTimeline(selfEvents, TIGER_POWER, t0);

	const tigerPalmCasts = castTimes(TIGER_PALM).map((t) => {
		const proc = inWindow(t, cbTigerPalmWindows);
		const buffLeftMs = remainingAtCast(tigerPowerTimeline, t, TIGER_POWER);
		// Putting the buff up is not refreshing it, and the two were indistinguishable here: both read
		// zero remaining, so the opening Tiger Palm of a pull — and every one after the buff had
		// actually lapsed — was reported as a refresh, which is how a "refresh" turned up seven seconds
		// into a fight for a buff that lasts twenty. Both are justified presses, but only one of them
		// is a decision about timing, and the detail table has to be able to say which.
		const reason = proc
			? 'proc'
			: buffLeftMs <= 0
				? 'apply'
				: buffLeftMs <= TP_REFRESH_WINDOW_MS
					? 'refresh'
					: 'wasted';
		return { t, proc, buffLeftMs, reason: reason as 'proc' | 'apply' | 'refresh' | 'wasted' };
	});

	// ------------------------------------------------------- Touch of Karma
	// A defensive that does damage: it redirects what the player takes onto the target for ten
	// seconds. What makes a use good or bad is therefore not when the cooldown came up but whether
	// anything was hitting them while it ran — a Karma pressed into a quiet stretch returns almost
	// nothing, and that is the only judgement here the log can actually support.
	const karmaCasts = castTimes(TOUCH_OF_KARMA);
	const karmaDamageIds = new Set(TOUCH_OF_KARMA.damageIds ?? []);
	const karmaDamage = damageEvents.filter((e) => karmaDamageIds.has(abilityIdOf(e) ?? -1));
	// Each tick belongs to the most recent press before it, rather than to a window measured forward
	// from every press. Forward windows overlap when two Karmas land inside one another's tails and
	// double-count the tick; this cannot, and it loses nothing to a tail that runs long.
	const karmaUses = karmaCasts.map((t) => ({ t, reflected: 0, hits: 0 }));
	for (const event of karmaDamage) {
		const at = event.timestamp - t0;
		let owner: (typeof karmaUses)[number] | undefined;
		for (const use of karmaUses) {
			if (use.t <= at && at - use.t <= KARMA_WINDOW_MS) owner = use;
		}
		if (owner === undefined) continue;
		owner.reflected += event.amount ?? 0;
		owner.hits += 1;
	}
	const karmaReflected = karmaUses.reduce((sum, u) => sum + u.reflected, 0);
	// Touch of Karma redirects up to a full health pool per use, so a health pool is the whole ceiling.
	// The log cannot supply one — MoP Classic carries no health anywhere — so this is null unless the
	// reader has told the settings what theirs is, and the report claims no ceiling until they do.
	const karmaCap = clampHealth(settings.maxHealth);

	// ------------------------------------------------------------ lost casts
	const lostCasts = ON_COOLDOWN.map((ability): LostCastRow | null => {
		const times = castTimes(ability);
		if (!times.length) return null;
		const live: Interval[] = NEEDS_TARGET.has(ability.key) && engaged.length ? engaged : [[0, duration]];
		const drift = cooldownDrift(times, ability, live, duration);
		return {
			id: castId(ability),
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
	}).filter((row): row is LostCastRow => row !== null);

	// -------------------------------------------------------- Fists of Fury
	// Graded against the two APL conditions a log can answer. Condition 1 (energy cap) is not
	// checkable: WarcraftLogs emits only a handful of resourcechange events per fight, nowhere near
	// enough to reconstruct an energy curve, so a channel marked ok here may still have overcapped.
	const ebWindows = auraWindows(selfEvents, ENERGIZING_BREW, t0, fight.endTime);
	const rjwWindows = auraWindows(selfEvents, RUSHING_JADE_WIND, t0, fight.endTime);
	const fofCasts = fofChannels.map((ch) => {
		const t = ch.start;
		const channelMs = ch.channelMs || (FOF_CHANNEL.baseMs ?? 4000);
		const energizingBrew = inWindow(t, ebWindows);
		const rjwCovers = remainingIn(t, rjwWindows) >= channelMs;
		const proc = procs.find((p) => t >= p.start && t <= p.end) ?? null;
		const brewUp = inWindow(t, brewWindows);
		// APL condition 3 allows a channel inside a proc only if the proc outlasts it (plus a GCD) and a
		// brew is already holding the snapshot.
		const procOutlasts = proc ? proc.end - t + GCD_MS >= channelMs : true;
		const faults: string[] = [];
		if (energizingBrew && !rjwCovers)
			faults.push('channelled through Energizing Brew with no Rushing Jade Wind covering it');
		if (proc && !procOutlasts)
			faults.push(`started with only ${r1((proc.end - t) / 1000)}s of the Rune proc left, so it expired mid-channel`);
		if (proc && procOutlasts && !brewUp) faults.push('channelled inside a Rune proc with no brew holding the snapshot');
		return {
			t,
			channelMs,
			ticks: ch.ticks,
			energizingBrew,
			rjwCovers,
			brewUp,
			procRemainingMs: proc ? proc.end - t : null,
			faults,
			link: link(t),
		};
	});
	const channelledMs = fofCasts.reduce((s, c) => s + c.channelMs, 0);

	// ----------------------------------------------------------- miss ledger
	const misses: Miss[] = [
		...drops.map((g) => ({
			kind: 'RSK dropped',
			at: g.t,
			detail: `${r1(g.ms / 1000)}s without the debuff`,
			link: link(g.t),
		})),
		...procs
			.filter((w) => w.grade === 'none' && !w.redundant)
			.map((w) => ({
				kind: `Rune proc unsnapshotted (${w.stat})`,
				at: w.start,
				detail:
					w.missedByMs !== null
						? `brewed ${formatGap(w.missedByMs)} after the proc expired — read, but late`
						: w.brewAlreadyUp
							? `a brew was already running, holding ${w.heldStat ?? 'no proc at all'} instead of ${w.stat}`
							: 'proc expired with no brew cast at all',
				link: link(w.start),
			})),
		...procs
			.filter((w) => w.grade === 'early')
			.map((w) => ({
				kind: `Snapshot too early (${w.stat})`,
				at: w.snapshotAt ?? w.start,
				detail: `brewed with ${r1((w.remainingMs ?? 0) / 1000)}s of proc still on the clock`,
				link: link(w.snapshotAt ?? w.start),
			})),
		...lostCasts.flatMap((l) =>
			l.worst
				.filter((w) => w.seconds >= l.cooldownSec)
				.map((w) => ({
					kind: `${l.name} held`,
					at: w.at,
					detail: `ready and unused for ${w.seconds}s`,
					link: w.link,
				})),
		),
		...fofCasts
			.filter((c) => c.faults.length)
			.map((c) => ({
				kind: 'Fists of Fury misplaced',
				at: c.t,
				detail: c.faults.join('; '),
				link: c.link,
			})),
		...tigerPalmCasts
			.filter((c) => c.reason === 'wasted')
			.map((c) => ({
				kind: 'Tiger Palm wasted',
				at: c.t,
				detail: `no Combo Breaker, and Tiger Power still had ${r1(c.buffLeftMs / 1000)}s`,
				link: link(c.t),
			})),
		...uses
			.filter((u) => u.consumed < TEB_DRAIN)
			.map((u) => ({
				kind: 'Partial brew',
				at: u.t,
				detail: `${u.consumed} of ${TEB_DRAIN} stacks`,
				link: link(u.t),
			})),
		...comboBreaker.flatMap((cb) =>
			cb.expired.map((w) => ({
				kind: `Combo Breaker: ${cb.label} expired`,
				at: w.start,
				detail: 'proc timed out unused',
				link: link(w.start),
			})),
		),
	].sort((a, b) => a.at - b.at);

	// --------------------------------------------------------------- assembly
	return {
		player: actor.name,
		code,
		fightID: fight.id,
		actorID: actor.id,
		encounter: fight.name,
		difficulty: fight.difficulty,
		size: fight.size ?? 0,
		difficultyName: dataset.difficultyNames?.[fight.difficulty] ?? null,
		kill: fight.kill,
		durationMs: duration,
		itemLevel: entry?.itemLevel ?? null,
		isSpec,
		specName: 'Windwalker',
		primaryTarget: { id: primaryID, gameID: primaryGameID },
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
			gcdSlots: Math.floor(activeMs / GCD_MS),
			gcdUtilisationPct: activeMs > 0 ? (occupiedMs / activeMs) * 100 : 0,
			channelSec: r1(fofChannelMs / 1000),
			activeMs,
			activePct: duration > 0 ? (activeMs / duration) * 100 : 0,
		},
		casts: castList,
		lostCasts,
		brew: {
			uses: uses.length,
			castCount: castCount(TIGEREYE_BREW) || uses.length,
			totalConsumed,
			avgConsumed: uses.length ? totalConsumed / uses.length : 0,
			fullUses: uses.filter((u) => u.consumed >= TEB_DRAIN).length,
			refreshUses: uses.filter((u) => u.refresh).length,
			wastedAtCap: bank.wastedAtCap,
			maxStacks: bank.maxStacks,
			bankAtEnd: bank.bankAtEnd,
			uptimePct: uptimePct(brewWindows, duration),
			windows: brewWindows,
			useList: uses,
			bankTimeline: bank.timeline,
		},
		procs: {
			procs: procs.length,
			snapshotted: snapshotted.length,
			/** Procs where a brew landed inside the reader's leeway *after* the proc ended. */
			narrowlyMissed: procs.filter((w) => w.snapshotAt === null && w.missedByMs !== null).length,
			/** Procs the bank could actually have paid for — the honest denominator for a catch rate. */
			opportunities: opportunities.length,
			/** Procs that arrived with too few stacks to be worth a brew. Reported, never counted as faults. */
			unaffordable: procs.length - opportunities.length,
			stackFloor: SNAPSHOT_STACK_FLOOR,
			lastGcd: procs.filter((w) => w.grade === 'last-gcd').length,
			late: procs.filter((w) => w.grade === 'late').length,
			early: procs.filter((w) => w.grade === 'early').length,
			unsnapshotted: procs.filter((w) => w.grade === 'none').length,
			redundant: procs.filter((w) => w.redundant).length,
			sameAsPrevious: procs.filter((w) => w.sameAsPrevious).length,
			backToBack: procs.filter((w) => w.backToBack).length,
			backToBackWasted: procs.filter((w) => w.backToBackWasted).length,
			devaluedSec,
			medianRemainingSec: snapshotted.length ? r1(median(snapshotted.map((w) => w.remainingMs ?? 0)) / 1000) : null,
			meanDepthPct: snapshotted.length
				? snapshotted.reduce((s, w) => s + (w.depthPct ?? 0), 0) / snapshotted.length
				: 0,
			secondsGivenAway,
			brewsOutsideProc: uses.filter((u) => !procs.some((w) => u.t >= w.start && u.t <= w.end)).length,
			uptimePct: uptimePct(procs, duration),
			statMix,
			lastGcdMs: snapshotLeewayMs,
			lateMs: LATE_MS,
			windows: procs,
		},
		debuff: {
			casts: castCount(RISING_SUN_KICK),
			uptimeMs: unionMs(rskMerged),
			uptimePct: duration > 0 ? (unionMs(rskMerged) / duration) * 100 : 0,
			engagedMs,
			engagedUptimePct: engagedMs ? (rskEngagedMs / engagedMs) * 100 : 0,
			secondsLost: r1(drops.reduce((s, g) => s + g.ms, 0) / 1000),
			intermissionSec: r1(longestGap / 1000),
			// No link here. The section plots drops on a timeline rather than listing them, and the miss
			// ledger already carries a linked row per drop — a second copy nothing renders is a field
			// that quietly goes stale.
			drops: drops.map((g) => ({ at: g.t, seconds: r1(g.ms / 1000) })),
			windows: rskMerged.map(([start, end]): Window => ({ start, end })),
			engagedSegments: engaged,
			primaryDamageShare: r1(primaryDamageShare),
			singleTarget: primaryDamageShare >= SINGLE_TARGET_SHARE_PCT,
		},
		channel: {
			casts: fofCasts.length,
			channelSec: r1(channelledMs / 1000),
			avgChannelSec: fofCasts.length ? r1(channelledMs / fofCasts.length / 1000) : 0,
			withBrew: fofCasts.filter((c) => c.brewUp).length,
			inProc: fofCasts.filter((c) => c.procRemainingMs !== null).length,
			clean: fofCasts.filter((c) => !c.faults.length).length,
			faulted: fofCasts.filter((c) => c.faults.length).length,
			energyCheckable: false,
			castList: fofCasts,
		},
		karma: {
			casts: karmaCasts.length,
			// Uses the cooldown allowed: the opener plus one per full recharge inside the pull.
			available: TOUCH_OF_KARMA.cooldownMs ? Math.floor(duration / TOUCH_OF_KARMA.cooldownMs) + 1 : karmaCasts.length,
			reflected: karmaReflected,
			sharePct: eventTotal > 0 ? (karmaReflected / eventTotal) * 100 : 0,
			capPerUse: karmaCap,
			uses: karmaUses.map((use) => ({
				...use,
				// Can exceed 100: the redirect is capped per use, but a pull spans gear and buffs that
				// move a health pool, so a single number for the whole fight is an approximation. Showing
				// 104% is more honest than clamping it and pretending the ceiling was exact.
				capPct: karmaCap === null ? null : (use.reflected / karmaCap) * 100,
			})),
		},
		filler: {
			casts: tigerPalmCasts.length,
			onProc: tigerPalmCasts.filter((c) => c.reason === 'proc').length,
			applied: tigerPalmCasts.filter((c) => c.reason === 'apply').length,
			refresh: tigerPalmCasts.filter((c) => c.reason === 'refresh').length,
			wasted: tigerPalmCasts.filter((c) => c.reason === 'wasted').length,
			refreshWindowSec: TP_REFRESH_WINDOW_MS / 1000,
			buffUptimePct: uptimePct(auraWindows(selfEvents, TIGER_POWER, t0, fight.endTime), duration),
			castList: tigerPalmCasts,
		},
		comboBreaker: comboBreaker.map(({ id, label, procs: count, wasted }) => ({
			id,
			label,
			procs: count,
			wasted,
		})),
		misses,
	};
}
