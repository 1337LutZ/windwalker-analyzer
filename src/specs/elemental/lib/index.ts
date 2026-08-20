// The Elemental shaman's half of the report: the model that names its buttons, the settings a reader
// owns, and the audit that turns one fight into the Elemental sections' figures.
//
// The ids, cooldowns and durations are read from wowsims-mop (`/home/lutz/personal/wowsims-mop`),
// which is the source of truth this module is checked against: `sim/shaman/*.go` and
// `sim/shaman/elemental/*.go` for the spells, `ui/shaman/elemental/apls/p5.apl.json` for the
// priority list, and the trinket files under `sim/common/mop/` for the proc auras.
//
// ## The rotation this report grades against
//
// The p5 list (`apls/p5.apl.json`), not `default.apl.json` — see `spec/elementalApl.ts` for the
// transcription and the exclusions. In short: the filler ladder is Unleash Elements, Flame Shock,
// Lava Burst, Elemental Blast, Earth Shock, Searing Totem, Lightning Bolt; the cooldowns section
// takes Ascendance, Elemental Mastery, Fire Elemental and the potion; the Flame Shock section takes
// the snapshot rules.
//
// ## What the audit reads that the engine does not
//
// The Elemental ladder decides nothing on a resource bar, so the engine walks it with
// `barsRequired: false` and no sampled bars. What it reads instead: the Flame Shock dot on the
// primary target, Lightning Shield's stack counter, and Ascendance's cooldown clock (via the
// engine's `offLadderCooldowns`, because Ascendance is off-GCD and off the ladder).

import {
	type AuraPoint,
	type AuraWindow,
	auraDrops,
	auraLevels,
	DROP_MS,
	auraTimeline,
	auraWindows,
	inWindow,
	levelAt,
	levelWindows,
	remainingAtCast,
	remainingIn,
	toIntervals,
	uptimePct,
} from '~/lib/analysis/auras';
import { atCapWindows } from '~/lib/analysis/counters';
import { dotTicksBySpawn, inLastTickWindow, tickWindowAt } from '~/lib/analysis/ticks';
import { complementOf, intersect, mergeIntervals, overlapMs, unionMs, type Interval } from '~/lib/analysis/intervals';
import { median } from '~/lib/analysis/format';
import { lastIndexAtOrBefore, stampAtOrBefore } from '~/lib/analysis/search';
import { intervalsAtLeast, isJudgeableTarget, overlapPoints } from '~/lib/analysis/targets';
import type { AnalysisSettings, SettingSchema } from '~/lib/settings';
import { defaultSettings } from '~/lib/settings';
import type {
	Analysis,
	AuraLane,
	EarthShockReason,
	FlameShockPress,
	FlameShockPressKind,
	ElementalAuditResult,
	FightDataset,
	Miss,
	SearingTotemPress,
	StormlashAudit,
	WclEvent,
	Window,
} from '~/lib/types';
import { abilityIdOf, instanceKey, isAuraEvent } from '~/lib/events/guards';

import type { Handles } from '~/lib/analysis/analyseCore';
import { analyseCore, type SpecConfig } from '~/lib/analysis/analyseCore';
import type { Ability, Aura, Dot, GameData } from '~/lib/game/model';
import { SHARED_ABILITIES, SHARED_AURAS } from '~/lib/game/shared';
import { createRegistry } from '~/lib/game/registry';
import { CLASS_COLOR } from '~/lib/game/classes';
import { aplAudit, type AplInputs, ALL_BANDS } from '~/lib/spec/apl';
import type { AplAudit, Band } from '~/lib/spec/apl';
import { LADDER } from './apl';
import { RESOURCE_TYPE } from '~/lib/game/resources';

// ------------------------------------------------------------------- constants

/** One global's length. Haste shortens the Elemental GCD in the sim; the engine takes one number. */
const GCD_MS = 1500;

/**
 * How long a second enemy has to be under fire before a pull reads as multi-target.
 *
 * The same calibration the Windwalker config carries (`TARGET_WINDOW_MS`, `MULTI_TARGET_SHARE_PCT`,
 * `SINGLE_TARGET_SHARE_PCT`): these thresholds describe a pull rather than a spec, and both specs
 * read the same ones.
 */
const TARGET_WINDOW_MS = 5000;
const MULTI_TARGET_SHARE_PCT = 33;
const SINGLE_TARGET_SHARE_PCT = 66;

/** How long without a hit before an engaged stretch ends, as in the Windwalker config. */
const ENGAGED_GAP_MS = 15000;

/** How wide a same-press pair of casts can be and still be one press, as in the Windwalker config. */
const SAME_PRESS_MS = 50;

const POTION_SLOTS = 2;
/** Jade Serpent Potion's category cooldown, 60s — the same table Virmen's Bite is read from. */
const POTION_CATEGORY_CD_MS = 60_000;

/**
 * Flame Shock's duration, from `sim/shaman/shocks.go`: ten ticks of three seconds.
 *
 * The dot snapshots spellpower at application (`OnSnapshot`), which is what makes refreshes inside
 * the int-proc windows the Flame Shock section grades.
 */
const FLAME_SHOCK_DURATION_MS = 30_000;

/**
 * How long a **second** target has to live before a Flame Shock on it was worth the global.
 *
 * Twenty seconds, and it is a judgement about payback time rather than a property of the spell — which
 * is the whole reason it has a name. Flame Shock's damage arrives in ten three-second ticks, so the
 * global that applies it is only bought back once enough of them have landed to beat the Lightning Bolt
 * that global would otherwise have been. Two thirds of the dot's own 30s duration is where that
 * crossing sits, and it is deliberately not the duration: a dot that runs its full length is not the
 * bar, the bar is the point past which it has out-earned the cast it displaced.
 *
 * It cuts both ways, which is the point. A mob that dies four seconds after the dot lands cost the
 * player nothing by going undotted, so charging them for the omission invents a fault they could not
 * have avoided — and crediting the *application* is just as wrong, because that global really was
 * thrown away. Below this bar the report says nothing about the second dot either way.
 */
const FS_SECOND_TARGET_LIFETIME_MS = 20_000;

/**
 * Flame Shock's tick schedule, and what replaced the reader's own refresh window.
 *
 * Ten ticks of three seconds unhasted, from the same `sim/shaman/shocks.go` the duration above comes
 * from. The pull never runs at that cadence: haste shortens the interval and leaves the duration
 * alone, so the tick *count* moves, and the two committed fixtures carry the dot at 13, 17 and 22
 * ticks inside a single fight. What the audit grades a refresh on is therefore the cadence measured
 * off that pull's own ticks — see `lib/analysis/ticks.ts` — and not a number anybody declared.
 *
 * That is what retired `flameShockRefreshMs`. The setting was a fixed 3 000ms fudge standing in for
 * the priority list's own rule, which its own comment already quoted: refresh "when the dot has less
 * than one tick left". One tick is what this measures.
 */
const FLAME_SHOCK_DOT: Dot = {
	durationMs: FLAME_SHOCK_DURATION_MS,
	tickMs: 3000,
	ticks: 10,
	hastedTicks: true,
	// Measured on `phased`: the refresh at 59 530 had a tick pending at 60 368, that tick fired, and the
	// dot then ran a further seventeen periods — eighteen ticks out of a seventeen-tick application.
	rollsOver: true,
};

/** The sim's own thresholds, written where the audit reads them: rules 12, 13 and 18 of the p5 list. */
const FS_ASC_PREP_MS = 16_000;
const ES_FS_MIN_MS = 6000;
const ES_ASC_HOLD_SEC = 6;

/** Ascendance's cooldown and duration, from `sim/shaman/ascendance.go` (180s, 15s). */
const ASCENDANCE_COOLDOWN_MS = 180_000;
const ASCENDANCE_DURATION_MS = 15_000;

/** Elemental Mastery: 90s, 20s, off the GCD — `sim/shaman/talents_elemental.go`. */
const ELEMENTAL_MASTERY_COOLDOWN_MS = 90_000;
const ELEMENTAL_MASTERY_DURATION_MS = 20_000;

/**
 * Fire Elemental's cooldown: five minutes, or three with Primal Elementalist.
 *
 * The sim grants the three minutes (`sim/shaman/talents_elemental.go`); this report cannot read the
 * talent reliably off a log, so the drift figure is measured against five and the section says so
 * when a log's own Fire Elemental windows read three.
 */
const FIRE_ELEMENTAL_COOLDOWN_MS = 300_000;
/** And its duration, from `sim/shaman/fire_elemental_totem.go` — the other half of the PE detection. */
const FIRE_ELEMENTAL_DURATION_MS = 60_000;

/** Searing Totem's duration, from `sim/shaman/fire_totems.go`: forty ticks of about 1.5s. */
const SEARING_TOTEM_DURATION_MS = 60_000;

/** The Earth Elemental's end-of-fight window, from the p5 list (`remainingTime <= 62s`). */
const EE_END_MS = 62_000;

/**
 * How little of the fight may be left for a Searing Totem placement to still be worth the global.
 *
 * The totem lasts a minute, so a placement with ten seconds to go throws away fifty of them — a
 * global that bought five ticks. The threshold mirrors the cooldown leeway's spirit: a placement in
 * the last stretch is a loss the player caused, not a latency artefact.
 */
const SEARING_TOTEM_LATE_MS = 10_000;

/** Stormlash Totem's buff, from `sim/core/buffs.go` (`StormLashDuration = time.Second * 10`). */
const STORMLASH_DURATION_MS = 10_000;

/** Unleash Elements' cooldown, from `sim/shaman/unleash_elements.go`. */
const UNLEASH_ELEMENTS_COOLDOWN_MS = 15_000;

/** The ceiling Lightning Shield holds (`maxStacks 7`) — the sim opens the fight with it full. */
const LIGHTNING_SHIELD_MAX_STACKS = 7;

/**
 * How long the shield may sit at the ceiling before the time counts as overcapped.
 *
 * The shield is spent by Earth Shock's Fulmination, so sitting at seven stacks is a shock the player
 * is not taking — and every Lightning Bolt after that is Rolling Thunder that has nowhere to put its
 * charge. A press worth of grace is forgiven, as with the cooldown leeway; past it, each second at
 * seven is a second of overcapping.
 */
const LIGHTNING_SHIELD_OVERCAP_DEFAULT_MS = 1500;
const LIGHTNING_SHIELD_OVERCAP_MIN_MS = 1000;
const LIGHTNING_SHIELD_OVERCAP_MAX_MS = 5000;

// ------------------------------------------------------------------ abilities

const ABILITIES: Ability[] = [
	{
		key: 'unleash-elements',
		name: 'Unleash Elements',
		castIds: [73680],
		damageIds: [73680],
		onGcd: true,
		// A talent-gated 15s cooldown, and the p5 list's priority 0 — the one exclusion that made the
		// ladder: it is a filler-slot press when talented, so it gets a drift row and a rung.
		gate: 'cooldown',
		cooldownMs: UNLEASH_ELEMENTS_COOLDOWN_MS,
	},
	{
		key: 'flame-shock',
		name: 'Flame Shock',
		castIds: [8050],
		damageIds: [8050],
		onGcd: true,
		// Gated on its own dot's state rather than on time; the section grades the refresh timing.
		gate: 'conditional',
		applies: ['flame-shock'],
		dot: FLAME_SHOCK_DOT,
	},
	{
		key: 'lava-burst',
		name: 'Lava Burst',
		castIds: [51505],
		damageIds: [51505],
		onGcd: true,
		// The 8s cooldown is real but not a bare clock — Lava Surge and Ascendance reset it — and the
		// ladder's `readyWhen` reads those resets. The 100% crit and the Flame Shock gate come from
		// `sim/shaman/elemental/lavaburst.go`, as does the 2s cast.
		castTimeMs: 2000,
		gate: 'conditional',
		cooldownMs: 8000,
	},
	{
		key: 'elemental-blast',
		name: 'Elemental Blast',
		castIds: [117014],
		damageIds: [118522],
		onGcd: true,
		// Talent-gated 12s cooldown, pressed whenever it is back — `sim/shaman/elemental_blast.go:47`,
		// where it is a 2s cast.
		castTimeMs: 2000,
		gate: 'cooldown',
		cooldownMs: 12_000,
	},
	{
		key: 'earth-shock',
		name: 'Earth Shock',
		castIds: [8042],
		damageIds: [8042],
		onGcd: true,
		// Gated on the Lightning Shield counter and the shock timer it shares with Flame Shock.
		gate: 'conditional',
	},
	{
		key: 'searing-totem',
		name: 'Searing Totem',
		castIds: [3599],
		damageIds: [3606],
		onGcd: true,
		// Gated on the totem's own dot and on the Fire Elemental not being out.
		gate: 'conditional',
		applies: ['searing-totem'],
	},
	{
		key: 'lightning-bolt',
		name: 'Lightning Bolt',
		castIds: [403],
		damageIds: [403],
		onGcd: true,
		// The unconditional filler. Judged against nothing but its place in the list. The 2.5s cast is
		// from `sim/shaman/lightning_bolt.go:21`.
		castTimeMs: 2500,
		gate: 'conditional',
	},
	{
		key: 'ascendance',
		name: 'Ascendance',
		castIds: [114049],
		damageIds: [114049],
		onGcd: false,
		gate: 'cooldown',
		cooldownMs: ASCENDANCE_COOLDOWN_MS,
		applies: ['ascendance'],
		// The p5 list presses it under two rules — the opener (FS up, first five seconds) and the
		// tier-16 two-piece window (the debuff on the target with 10s left) — both judged by the
		// cooldowns section rather than against the bare cooldown.
		note: 'Judged against its two p5 rules, never against its cooldown.',
	},
	{
		key: 'elemental-mastery',
		name: 'Elemental Mastery',
		castIds: [16166],
		damageIds: [16166],
		onGcd: false,
		gate: 'cooldown',
		cooldownMs: ELEMENTAL_MASTERY_COOLDOWN_MS,
		applies: ['elemental-mastery'],
	},
	{
		key: 'fire-elemental',
		name: 'Fire Elemental',
		castIds: [2894],
		damageIds: [2894],
		onGcd: true,
		// Five minutes, or three with Primal Elementalist — see the constant above for how the report
		// handles the split. The p5 list presses it prepull and on cooldown, synced with Ascendance.
		gate: 'cooldown',
		cooldownMs: FIRE_ELEMENTAL_COOLDOWN_MS,
		applies: ['fire-elemental'],
	},
	{
		key: 'stormlash-totem',
		name: 'Stormlash Totem',
		castIds: [120668],
		damageIds: [120668],
		onGcd: true,
		// A five-minute raid cooldown (`sim/core/buffs.go: StormLashCD`), talent-gated in the list.
		// Counted and never scored.
		gate: 'other',
		cooldownMs: 300_000,
	},
	{
		key: 'earth-elemental',
		name: 'Earth Elemental',
		castIds: [2062],
		damageIds: [2062],
		onGcd: true,
		// The p5 list presses it almost entirely in end-of-fight terms (`remainingTime <= 62s`), so a
		// drift verdict would call the list's own plan a fault. Counted and never scored.
		gate: 'other',
		cooldownMs: 120_000,
	},
	{
		key: 'jade-serpent-potion',
		name: 'Jade Serpent Potion',
		// The intellect combat potion. wowsims keys it on the item — the p5 list casts `itemId 76093`
		// — and the log books both the press and the buff under the spell 105702, as with Virmen's Bite.
		castIds: [105702],
		onGcd: false,
		gate: 'other',
		onUse: true,
		applies: ['jade-serpent-potion'],
	},
	// The active defensives and cooldowns that put a buff on the shaman: not rotation, so `gate:
	// 'other'` and never scored — but the buff window is worth drawing, so the press carries its aura.
	{
		key: 'astral-shift',
		name: 'Astral Shift',
		// 40% damage reduction for 8s — the shaman defensive.
		castIds: [108271],
		onGcd: false,
		gate: 'other',
		cooldownMs: 120_000,
		applies: ['astral-shift'],
	},
	{
		key: 'spiritwalkers-grace',
		name: "Spiritwalker's Grace",
		// Cast while moving for 15s — `sim/shaman/spiritwalkers_grace.go`.
		castIds: [79206],
		onGcd: false,
		gate: 'other',
		cooldownMs: 120_000,
		applies: ['spiritwalkers-grace'],
	},
	{
		key: 'ancestral-guidance',
		name: 'Ancestral Guidance',
		// Converts damage to healing for 10s — the shaman heal cooldown.
		castIds: [108281],
		onGcd: false,
		gate: 'other',
		cooldownMs: 120_000,
		applies: ['ancestral-guidance'],
	},
];

// ---------------------------------------------------------------------- auras

const AURAS: Aura[] = [
	{
		key: 'flame-shock',
		name: 'Flame Shock',
		ids: [8050],
		kind: 'debuff',
		durationMs: FLAME_SHOCK_DURATION_MS,
		appliedBy: 'flame-shock',
	},
	{
		key: 'ascendance',
		name: 'Ascendance',
		// The buff is 114050, not the cast's 114049 — measured on a:9XYKBd34HLVqQA8D: casting 114049
		// applies 114050 to the shaman for the fifteen seconds, and that is the window the lane draws.
		ids: [114050],
		kind: 'buff',
		durationMs: ASCENDANCE_DURATION_MS,
		appliedBy: 'ascendance',
	},
	{
		key: 'elemental-mastery',
		name: 'Elemental Mastery',
		ids: [16166],
		kind: 'buff',
		durationMs: ELEMENTAL_MASTERY_DURATION_MS,
		appliedBy: 'elemental-mastery',
	},
	{
		key: 'lava-surge',
		name: 'Lava Surge',
		ids: [77762],
		kind: 'buff',
	},
	{
		key: 'lightning-shield',
		name: 'Lightning Shield',
		ids: [324],
		kind: 'buff',
		maxStacks: LIGHTNING_SHIELD_MAX_STACKS,
		// An hour-long buff, pre-applied before the bell; the ES rule reads the counter, not the window.
		durationMs: 3_600_000,
	},
	{
		key: 'searing-totem',
		name: 'Searing Totem',
		ids: [3599],
		kind: 'debuff',
		durationMs: SEARING_TOTEM_DURATION_MS,
		appliedBy: 'searing-totem',
	},
	{
		key: 'fire-elemental',
		name: 'Fire Elemental',
		ids: [2894],
		kind: 'buff',
		durationMs: FIRE_ELEMENTAL_DURATION_MS,
		appliedBy: 'fire-elemental',
	},
	{
		key: 'stormlash-totem',
		name: 'Stormlash Totem',
		ids: [120668],
		kind: 'buff',
		durationMs: STORMLASH_DURATION_MS,
		appliedBy: 'stormlash-totem',
	},
	{
		key: 't16-2pc-proc',
		name: 'Celestial Harmony',
		ids: [144998],
		kind: 'buff',
	},
	{
		key: 't16-2pc-debuff',
		name: 'Elemental Discharge',
		ids: [144999],
		kind: 'debuff',
	},
	// Talent auras, registered so the audit can ask whether a log carried them at all. The snapshot
	// section's copy is what leans on them: the p5 list only claims its proc-window Flame Shock
	// reapplies for a shaman who took Elemental Blast or Primal Elementalist.
	{
		key: 'unleashed-fury',
		name: 'Unleashed Fury',
		ids: [117012],
		kind: 'buff',
	},
	{
		key: 'primal-elementalist',
		name: 'Primal Elementalist',
		ids: [117013],
		kind: 'buff',
	},
	{
		key: 't15-4pc',
		name: 'T15 4pc: Ascendant Harmony',
		ids: [138144],
		kind: 'buff',
	},
	{
		key: 'jade-serpent-potion',
		name: 'Jade Serpent Potion',
		// The potion buff, under the same id as the press — see the ability, which is where the sim's
		// item-keyed spell is explained. 25s, the same table Virmen's Bite is read from: the combat
		// potion's `buffDuration` in `assets/database/db.json` (item 76093), fed through the same
		// divide-by-1000 in `tools/database/dbc/consumable.go`.
		ids: [105702],
		kind: 'buff',
		durationMs: 25_000,
		appliedBy: 'jade-serpent-potion',
	},
	{
		key: 'astral-shift',
		name: 'Astral Shift',
		ids: [108271],
		kind: 'buff',
		durationMs: 8000,
		appliedBy: 'astral-shift',
	},
	{
		key: 'spiritwalkers-grace',
		name: "Spiritwalker's Grace",
		ids: [79206],
		kind: 'buff',
		durationMs: 15_000,
		appliedBy: 'spiritwalkers-grace',
	},
	{
		key: 'ancestral-guidance',
		name: 'Ancestral Guidance',
		ids: [108281],
		kind: 'buff',
		durationMs: 10_000,
		appliedBy: 'ancestral-guidance',
	},
];

export const ELEMENTAL: GameData = {
	abilities: [...SHARED_ABILITIES, ...ABILITIES],
	auras: [...SHARED_AURAS, ...AURAS],
};

/** The one way to ask what a spell id means. Construction validates the links between the two lists. */
export const registry = createRegistry(ELEMENTAL);

const FLAME_SHOCK = registry.ability('flame-shock');
const EARTH_SHOCK = registry.ability('earth-shock');
const SEARING_TOTEM = registry.ability('searing-totem');
const ASCENDANCE = registry.ability('ascendance');
const ELEMENTAL_MASTERY = registry.ability('elemental-mastery');
const FIRE_ELEMENTAL = registry.ability('fire-elemental');
const EARTH_ELEMENTAL = registry.ability('earth-elemental');
const LAVA_BURST = registry.ability('lava-burst');
const STORMLASH_TOTEM = registry.ability('stormlash-totem');

const FS_DEBUFF = registry.aura('flame-shock');
const ASCENDANCE_AURA = registry.aura('ascendance');
const LAVA_SURGE = registry.aura('lava-surge');
const LIGHTNING_SHIELD = registry.aura('lightning-shield');
const SEARING_TOTEM_DOT = registry.aura('searing-totem');
const FIRE_ELEMENTAL_AURA = registry.aura('fire-elemental');
const STORMLASH_AURA = registry.aura('stormlash-totem');
const T15_4PC = registry.aura('t15-4pc');
const T16_2PC_PROC = registry.aura('t16-2pc-proc');
const T16_2PC_DEBUFF = registry.aura('t16-2pc-debuff');
const UNERRING_VISION = registry.aura('unerring-vision');
const UNERRING_VISION_STACKS = registry.aura('unerring-vision-stacks');
const BREATH_OF_HYDRA = registry.aura('breath-of-hydra');
const CHAYES = registry.aura('chayes');
const WRATH_OF_DARKSPEAR = registry.aura('wrath-of-darkspear');
const TEMPUS_REPIT = registry.aura('tempus-repit');

/**
 * Names for the ids the model deliberately does not carry: off-GCD utility, the overload damage and
 * the pets. Nothing here is an Ability, which is exactly what marks its damage passive — the
 * Elemental Overloads are a mastery readout, and the totems and pets are summons rather than
 * buttons the rotation spends globals on.
 */
const EXTRA_NAMES: Record<number, string> = {
	1: 'Melee',
	324: 'Lightning Shield',
	16246: 'Elemental Focus',
	45284: 'Elemental Overload (Lightning Bolt)',
	45294: 'Elemental Overload (Flame Shock)',
	45296: 'Elemental Overload (Earth Shock)',
	45297: 'Elemental Overload (Chain Lightning)',
	114991: 'Elemental Overload (Lava Beam)',
	118523: 'Elemental Overload (Elemental Blast)',
	26364: 'Lightning Shield Discharge',
	88765: 'Rolling Thunder',
	88767: 'Fulmination',
	16886: 'Elemental Overload (mastery)',
	51490: 'Thunderstorm',
	33697: 'Blood Fury',
	26297: 'Berserking',
	57984: 'Fire Elemental: Fire Blast',
	117588: 'Fire Elemental: Fire Shield',
	118297: 'Fire Elemental: melee',
	118350: 'Fire Elemental: Fire Nova',
	118345: 'Earth Elemental: melee',
	114206: 'Skull Banner',
};

// ------------------------------------------------------------------ settings

export const ELEMENTAL_SETTINGS: SettingSchema[] = [
	// `flameShockRefreshMs` used to be the first entry here, and it is gone rather than re-defaulted:
	// the dot's own tick cadence is what grades a refresh now, and it is measured rather than chosen.
	// See `FLAME_SHOCK_DOT` above and `lib/settings/model.ts`, which carries the retirement note.
	{
		key: 'cooldownLeewayMs',
		tKey: 'settings.cooldown',
		// A global and a half, and the whole of a wait is forgiven rather than a slice off a longer
		// one. The shortest cooldown in the audited set is Unleash Elements' 15s, and each wait is
		// forgiven in full and separately.
		default: 1500,
		min: 1000,
		max: 2000,
		step: 250,
	},
	{
		key: 'lightningShieldOvercapMs',
		tKey: 'settings.ele.lightningShieldOvercap',
		// How long the shield may sit at seven before the time past it is called overcapping. One
		// press's worth of grace, like the cooldown leeway, because the shock that should spend the
		// shield has to be finished and the reaction has to land.
		default: LIGHTNING_SHIELD_OVERCAP_DEFAULT_MS,
		min: LIGHTNING_SHIELD_OVERCAP_MIN_MS,
		max: LIGHTNING_SHIELD_OVERCAP_MAX_MS,
		step: 250,
	},
	{
		key: 'searingTotemRefreshMs',
		tKey: 'settings.ele.searingTotemRefresh',
		// How much of the totem's minute may remain for a re-press to read as a plain early refresh
		// rather than a clip. A press over a totem with more than this left is throwing away the rest.
		default: 1500,
		min: 1000,
		max: 3000,
		step: 250,
	},
];

/**
 * The cooldown buttons whose idle time is only chargeable while the boss was up.
 *
 * Every `cooldown`-gated damage button: Unleash Elements, Elemental Blast and Ascendance do nothing
 * with no target, Elemental Mastery and Fire Elemental same. Earth Elemental is `other` and never
 * scored; Earth Shock and the rest are `conditional` and have no drift row to clip.
 */
const NEEDS_TARGET: ReadonlySet<string> = new Set([
	'unleash-elements',
	'elemental-blast',
	'ascendance',
	'elemental-mastery',
	'fire-elemental',
]);

// -------------------------------------------------------------------- audit

/**
 * The dot's windows on one target: once per spawn that carried it, and once as the union.
 *
 * Two readings out of one walk, because they answer two different questions and this file has already
 * paid once for confusing them. `merged` is "did this enemy have the dot" — the honest reading for a
 * figure or a lane labelled with one enemy's name. `byInstance` is "did the add in front of the player
 * have the dot" — the only honest reading for anything grading a press. The Windwalker splits the same
 * measurement the same way, `rskByTarget` against `rskByInstance`, for the same reason.
 */
interface DotWindows {
	/**
	 * Each spawn's own windows, keyed by `instanceKey` and merged within the spawn.
	 *
	 * `Window[]` rather than `Interval[]` because the only thing that reads it is `remainingIn` at a
	 * press — the shared helper rather than a fifth hand-rolled copy of its loop — and converting once
	 * here beats converting per press.
	 */
	byInstance: ReadonlyMap<string, readonly Window[]>;
	/** The union across every spawn of the enemy id. */
	merged: Interval[];
}

/**
 * The dot's windows on one target, refresh-open, per spawn and merged.
 *
 * The same machinery the Rising Sun Kick debuff uses (`windwalker.ts`): bucket the 8050 aura events
 * by the enemy they landed on, walk each bucket with `openOnRefresh` so a refresh with nothing open
 * is still proof the dot was up, and merge the result — every reading downstream comes out of this one
 * walk, so the figure and the per-press reads cannot disagree about the pull.
 *
 * Flame Shock shares its id with the cast, which the RSK debuff never had to deal with; the buckets
 * are filtered to aura events before `auraWindows` sees them, so a cast event is never mistaken for
 * an application.
 *
 * Bucketed by **spawn** — `instanceKey(targetID, targetInstance)` — and not by `targetID` alone.
 * WarcraftLogs gives one actor id to an NPC *type*, so every copy of an add shares it, and one bucket
 * per id hands `auraWindows` several spawns' applies and removes interleaved into a single stream:
 * each remove closes whichever window is open, and every apply arriving while one is already open is
 * dropped. The Windwalker's own comment measures the cost of exactly that mistake at 17.4 seconds of
 * discarded coverage on `a:6MhZgjyAknFWrYfK` #10. This function was written from that one and lost
 * the instance on the way across; the union of a target's spawns is what "the dot was on this enemy"
 * honestly means for a figure labelled with one name.
 */
function dotWindowsOnTarget(
	events: readonly WclEvent[],
	aura: Aura,
	t0: number,
	fightEnd: number,
	targetID: number | undefined,
	sourceID: number,
): DotWindows {
	if (targetID === undefined) return { byInstance: new Map(), merged: [] };
	const ids = new Set(aura.ids);
	const buckets = new Map<string, WclEvent[]>();
	for (const e of events) {
		if (e.targetID !== targetID) continue;
		// **This player's dot, not the debuff.** Two Elemental shamans both keep Flame Shock on the boss,
		// and the log carries both — so a walk over every source interleaves two dots into one stream and
		// credits this player with the other's coverage. `sourceID` is required rather than defaulted so a
		// third caller has to decide whose aura it is asking about.
		//
		// The removes are filtered too, and that is the deliberate half. A remove sourced to someone else
		// is the *other* shaman's dot ending, and letting it through would close this player's window
		// early. The known cost is a dispel: if a log ever attributes the removal of this dot to the
		// dispeller rather than the caster, the window here runs on past it. No MoP encounter dispels
		// Flame Shock, and the alternative — accepting foreign removes — is the two-shaman bug back again.
		if (e.sourceID !== sourceID) continue;
		const id = abilityIdOf(e);
		if (id === null || !ids.has(id) || !isAuraEvent(e)) continue;
		const key = instanceKey(e.targetID, e.targetInstance);
		const bucket = buckets.get(key);
		if (bucket) bucket.push(e);
		else buckets.set(key, [e]);
	}
	// Walked per spawn, kept per spawn, and merged across them: two copies of an add carrying the dot
	// at once is the enemy covered, not twice covered, and `mergeIntervals` is what says so.
	const byInstance = new Map<string, readonly Window[]>();
	const all: Interval[] = [];
	for (const [key, bucket] of buckets) {
		const spans = mergeIntervals(toIntervals(auraWindows(bucket, aura, t0, fightEnd, { openOnRefresh: true })));
		byInstance.set(
			key,
			spans.map(([start, end]) => ({ start, end })),
		);
		all.push(...spans);
	}
	return { byInstance, merged: mergeIntervals(all) };
}

/**
 * Seconds until Ascendance is back, read off its presses and its 180s cooldown.
 *
 * The search is `stampAtOrBefore`, not a fourth hand-rolled binary search. This function used to
 * carry its own, character for character the same loop as `valueAt` in `spec/apl.ts` and `countAt` in
 * `analysis/targets.ts` — and it was written in the same change that deleted one of those copies.
 */
function ascendanceReadyInSec(ascCasts: readonly number[], t: number): number {
	const last = stampAtOrBefore(ascCasts, t);
	if (last === null) return 0;
	return Math.max(0, last + ASCENDANCE_COOLDOWN_MS - t) / 1000;
}

/**
 * The Elemental's half of the analysis, from the engine's `Handles` and nothing else.
 *
 * The core has already assembled the press marks, the contact and engaged clocks, the primary
 * target, the damage table and the lost-cast rows; everything here is what only an Elemental model
 * can say about them.
 */
export function elementalAudit(h: Handles): ElementalAuditResult {
	const {
		actor,
		castPresses,
		events,
		t0,
		duration,
		link,
		selfEvents,
		raidStormlash,
		castTimes,
		primaryID,
		primaryName,
		engaged,
		engagedMs,
		marks,
		aplTargetCountAt,
		lostCasts,
		landedHits,
		spawnLives,
		multiTargetWindows,
		multiTargetMs,
		contact,
	} = h;
	const { lightningShieldOvercapMs, searingTotemRefreshMs } = h.settings;
	const fightEnd = t0 + duration;

	/**
	 * The player's own windows for one aura, walked once.
	 *
	 * `auraWindows` is a pass over the whole event stream, and this audit was asking for the same aura's
	 * windows two and three times over — Ascendance three times, Lava Surge three, and four item procs
	 * twice each — because the snapshot block, the APL inputs and the lane list each reached for their
	 * own copy. Sixteen calls covering nine auras. Memoised by the aura's registry key, which is unique
	 * by construction (`createRegistry` throws on a duplicate).
	 *
	 * Only the default walk goes through here. `openAtPull` changes what the walk *means* — it recovers
	 * a window that was already running when the bell went — so that call keeps its own line rather than
	 * sharing a cache entry with the plain reading of the same aura.
	 *
	 * `readonly AuraWindow[]`, and both halves matter now that five sections hold the same array. Readonly
	 * because a caller that sorted or spliced its "own" windows would silently reorder everyone else's;
	 * `AuraWindow` because declaring `Window[]` threw away the `id` and `variant` the walk had already
	 * resolved, for every aura that went through the cache.
	 */
	const selfWindowCache = new Map<string, readonly AuraWindow[]>();
	const selfWindows = (aura: Aura): readonly AuraWindow[] => {
		const cached = selfWindowCache.get(aura.key);
		if (cached !== undefined) return cached;
		const walked = auraWindows(selfEvents, aura, t0, fightEnd);
		selfWindowCache.set(aura.key, walked);
		return walked;
	};
	// A cast's fixed-duration window (a totem, the Fire Elemental) runs until the spell would expire,
	// but the fight may end first — clamp it so a Searing Totem laid in the last global does not draw a
	// sixty-second tail past the pull.
	const untilFightEnd = (t: number, ms: number): Interval => [t, Math.min(t + ms, duration)];

	const ascCasts = castTimes(ASCENDANCE);
	const ascActiveWindows = selfWindows(ASCENDANCE_AURA);

	// ------------------------------------------------ the enemy in front of the player
	/**
	 * Which spawn the player was on at an instant, as an `instanceKey` — the core's `landedHits` read
	 * backwards.
	 *
	 * Every rule that grades a press makes a claim about one enemy: the one being hit. `landedHits` is
	 * already exactly what that needs — sorted, ticks and pets out, and carrying the spawn rather than
	 * only the actor id, because WarcraftLogs hands ten simultaneous adds one `targetID` and the id
	 * alone calls all ten of them the same enemy. So each hit owns the time until the next one, and the
	 * enemy at `t` is the one the last hit at or before `t` landed on.
	 *
	 * `lastIndexAtOrBefore` and not a loop of its own. This is the same step-series search as
	 * `ascendanceReadyInSec`, and the reason `search.ts` exists is that it had been written out four
	 * times before anybody noticed.
	 *
	 * **Before the first landed hit — the opener — the answer is the _first_ hit's spawn.** A press in
	 * the opening global is aimed at whatever the next global lands on: the player has one thing
	 * targeted and has not swapped off it yet. Both alternatives are worse, and both were considered.
	 * Falling back to the union re-introduces the exact looseness this walk exists to remove. Reading
	 * "no spawn, therefore no dot" is worse still — it charges the opener's Earth Shock with `fsLow`
	 * and the opener's Ascendance with a missing dot on every pull, which is a fabricated fault rather
	 * than a missing measurement.
	 *
	 * Null only when the player landed no direct hit in the whole pull. That is not a quiet "no dot":
	 * it is a pull with no enemy in it at all — `primaryID` there came off a tick or a pet — so nothing
	 * this audit grades has a target to be graded against and there is no honest reading to give.
	 *
	 * Ties inside one millisecond go to the last hit in the sorted stream, the same arbitrary-but-
	 * bounded choice the Windwalker's own walk makes: an area hit lands on every enemy at one stamp, so
	 * which of them is "the" target there is undecidable, and it is the same dot on each of them.
	 */
	const spawnAt = (t: number): string | null => {
		if (landedHits.length === 0) return null;
		const at = lastIndexAtOrBefore(landedHits.length, (i) => landedHits[i]?.t ?? Infinity, t);
		return (at === -1 ? landedHits[0] : landedHits[at])?.key ?? null;
	};

	// --------------------------------------------------------- Flame Shock
	// The dot on the enemy the pull was about. Without a primary there is nothing to measure — the
	// section reads zero rather than inventing a target.
	//
	// **Two readings out of one walk, and which one a consumer gets is the whole of this block.**
	//
	// `fsMerged` is the union across every spawn of that enemy id. It is the honest reading for the
	// uptime figure, the timeline lane, the drop ledger and the snapshot windows: a row labelled with
	// one enemy's name should say whether that enemy had the dot.
	//
	// `fsRemainingAt` is the other reading — the dot on the spawn `spawnAt` says the player was on —
	// and every rule that grades a press takes it instead: the Earth Shock `fsLow` reason, the
	// Elemental Mastery sync and the Ascendance prep check, the ladder's own `dotRemainingTime`, and
	// `fsPresses` through its per-spawn timeline below. On a multi-add pull the union answers a
	// question none of them asked: an Earth Shock pressed while a *different* spawn carried the dot
	// read as "dot up" when the enemy in front of the player had nothing on it. This is the split the
	// Windwalker already draws — `rskByInstance` for a graded press, `rskByTarget` for anything drawn.
	const fsDot = dotWindowsOnTarget(events, FS_DEBUFF, t0, fightEnd, primaryID, actor.id);
	const fsMerged: Window[] = fsDot.merged.map(([start, end]) => ({ start, end }));
	const fsUptimeMs = unionMs(toIntervals(fsMerged));
	/**
	 * The same coverage, clipped to the clock it is graded against — and the reason the tile once read
	 * **100.21%**.
	 *
	 * `fsMerged` runs over the whole pull: the dot goes up when it goes up and its window closes at the
	 * `removedebuff` the boss's death emits, or at the last event of the fight. `engagedMs` is a
	 * different span — the union of `engaged`, which is built from the player's own landed non-tick hits
	 * on the primary target and so cannot begin before the first of them or run past the last. Dividing
	 * one by the other divides two clocks, and on a pull where the dot never falls off the numerator
	 * wins.
	 *
	 * Measured, on the pull that produced the figure: the last landed hit is at 364.238s, the dot's
	 * removal is stamped at 365.014s, and the dot went up 1ms after the first hit. The numerator carried
	 * 365 009ms against a 364 234ms denominator — 775ms of dot ticking on a boss that had already taken
	 * its last hit — and 365 009 / 364 234 is 100.2128%. Nothing was double-counted and no merge was
	 * wrong; the two spans simply disagreed about when the pull was.
	 *
	 * So the numerator is intersected with the denominator's own windows, which is what `multiDotUptimeMs`
	 * and `stUptimeMs` below already do — Flame Shock was the one figure in this file measuring a union
	 * against a bare scalar. That makes the ratio a share by construction rather than by luck, since
	 * `intersect` cannot return more time than `engaged` contains, and it closes the same hole one
	 * segment earlier: a dot ticking on across a gap *between* two engaged stretches was credited
	 * against a denominator that excludes that gap.
	 *
	 * `windows` and `uptimeMs` are deliberately left whole. They are what the timeline lane draws and
	 * what the drop ledger reads, and both are claims about the pull rather than about the share —
	 * clipping them would put a seam in the drawn dot where the boss merely stopped being hit.
	 */
	const fsEngagedWindows: Window[] = intersect(fsDot.merged, engaged).map(([start, end]) => ({ start, end }));
	/** The dot's remaining time on the spawn the player was on at `t`; zero when that spawn had none. */
	const fsRemainingAt = (t: number): number => {
		const key = spawnAt(t);
		return key === null ? 0 : remainingIn(t, fsDot.byInstance.get(key) ?? []);
	};

	const fsCasts = castTimes(FLAME_SHOCK);
	// The dot's own clock, read blind to the refresh the press itself caused — that refresh is stamped
	// a millisecond *before* the cast, and reading it scored every press as a full 30s. `remainingAtCast`
	// is the same guard the Windwalker's Tiger Palm refresh uses, for the same reason.
	//
	// One timeline per **spawn**, not one for the target. `remainingAtCast` takes the last point before
	// the press and nothing else, so a stream with two spawns interleaved hands it the *other* add's
	// remove — which zeroes a dot still running on the enemy being hit and then reads the next refresh
	// of it as a fresh apply. Same mistake as bucketing the windows by id, one function further on.
	const fsTimelines = new Map<string, readonly AuraPoint[]>();
	if (primaryID !== undefined) {
		const bySpawn = new Map<string, WclEvent[]>();
		for (const e of events) {
			if (e.targetID !== primaryID) continue;
			const key = instanceKey(e.targetID, e.targetInstance);
			const bucket = bySpawn.get(key);
			if (bucket) bucket.push(e);
			else bySpawn.set(key, [e]);
		}
		for (const [key, bucket] of bySpawn) fsTimelines.set(key, auraTimeline(bucket, FS_DEBUFF, t0));
	}
	/**
	 * The dot's own ticks, per spawn — the pull's answer to how wide its last tick window is.
	 *
	 * Keyed the same way `fsTimelines` is, and for the same reason: two spawns of one add interleave into
	 * a single stream, and an interval measured across the seam belongs to neither of them. Sourced to
	 * this player, so another shaman's dot on the same boss cannot lend its cadence to this one.
	 */
	const fsTicks = dotTicksBySpawn(events, FS_DEBUFF, t0, actor.id);

	/**
	 * The spawn a Flame Shock press was **aimed at**, from the cast's own event.
	 *
	 * Not `spawnAt(t)`, which answers a different question: the enemy the player was *hitting* around
	 * then. For every other rule in this audit those coincide closely enough, because a rule about
	 * Earth Shock is a rule about the enemy in front of you. A Flame Shock press is the one case where
	 * they genuinely diverge, and diverge by design — the cleave rule's whole point is a *second* dot
	 * on an add while every hit either side of it lands on the boss. Graded against the hit enemy, that
	 * deliberate multi-dot reads as a refresh of a dot that was already up, and is charged as a wasted
	 * global for doing exactly what the priority list asked.
	 *
	 * Falls back to the hit spawn when the cast event named no target at all. That is not a guess about
	 * aim: it is the same enemy every other rule at that instant is judged against, so a press with no
	 * target reads consistently with its neighbours instead of dropping out of the audit.
	 */
	const fsAimedAt = new Map(castPresses(FLAME_SHOCK).map((press) => [press.t, press.spawn]));
	/**
	 * The stretches the player was not in contact — the fight's own interruptions.
	 *
	 * Declared here rather than beside the miss ledger that also reads it, because `downBefore` below
	 * closes over it and runs immediately. Left further down it was a TDZ `ReferenceError` at runtime that
	 * `tsc` cannot see, being inside a closure — the same trap `fightEnd` fell into earlier in this file.
	 */
	const fsAway = complementOf(contact, duration);

	/**
	 * The time the dot had been down, on this spawn, while the player was in contact.
	 *
	 * The three down-states hang off this. `null` means the dot had never been up on that spawn at all —
	 * an opener, which is a different fact from "it lapsed and you were there", and the difference is
	 * what stops the report accusing a player of a late refresh on their first press of the pull.
	 */
	const downBefore = (spawn: string | null, t: number): number | null => {
		if (spawn === null) return null;
		const windows = fsDot.byInstance.get(spawn) ?? [];
		let previousEnd: number | null = null;
		for (const w of windows) {
			if (w.start >= t) break;
			previousEnd = Math.max(previousEnd ?? 0, Math.min(w.end, t));
		}
		if (previousEnd === null) return null;
		// Charged only for the part the player was present for, the same way `auraDrops` charges a gap.
		return Math.max(0, t - previousEnd - overlapMs(previousEnd, t, fsAway));
	};

	const fsPresses: FlameShockPress[] = fsCasts.map((t) => {
		const spawn = fsAimedAt.get(t) ?? spawnAt(t);
		// An empty timeline needs no separate arm: `remainingAtCast` reads nothing as 0, and 0 is the
		// "no dot was up" case the three down-states below split apart.
		const remaining = remainingAtCast(spawn === null ? [] : (fsTimelines.get(spawn) ?? []), t, FS_DEBUFF);
		const ascReadyInSec = ascendanceReadyInSec(ascCasts, t);
		/**
		 * The dot's last tick window at this press, measured off its own ticks.
		 *
		 * This is what `flameShockRefreshMs` used to be, and the difference is not a tuning. One tick
		 * period or less left means one tick is still pending, and reapplying there rolls that tick over:
		 * the player keeps it *and* gets a full fresh dot, which is the most the global can buy. Earlier
		 * than that the same global buys the same fresh dot while more of the old one was still owed.
		 *
		 * On the two committed pulls the window measures 1 349ms, 1 748ms or 2 275ms depending on which
		 * haste cooldowns were up — never the 3 000ms the setting defaulted to, and never the same number
		 * twice in one fight. Falls back to the unhasted 3 000ms period when the log carries too few ticks
		 * to measure one (a press onto a spawn that never had the dot, or a synthetic pull).
		 */
		const tickWindow = tickWindowAt(spawn === null ? [] : (fsTicks.get(spawn) ?? []), t, FLAME_SHOCK_DOT);
		const windowed = inLastTickWindow(remaining, tickWindow, FLAME_SHOCK_DOT);
		const ascPrep = remaining > 0 && remaining < FS_ASC_PREP_MS && ascReadyInSec <= 2;
		const exposed = remaining > 0 ? null : downBefore(spawn, t);
		const kind: FlameShockPressKind =
			remaining > 0
				? windowed
					? 'windowed'
					: ascPrep
						? 'ascPrep'
						: 'early'
				: exposed === null
					? 'apply'
					: exposed > DROP_MS
						? 'late'
						: 'reapply';
		return {
			t,
			kind,
			remainingMs: remaining > 0 ? remaining : null,
			exposedMs: remaining > 0 ? null : (exposed ?? 0),
			tickMs: tickWindow.cadenceMs,
			windowed,
			ascPrep,
			// A refresh while Ascendance is up is a global thrown away — the list wants Lava Burst then.
			duringAscendance: inWindow(t, ascActiveWindows),
		};
	});
	// An `apply` and a `reapply` both put the dot up; only the refresh states renew one that was running.
	const applies = fsPresses.filter((p) => p.remainingMs === null).length;
	const refreshes = fsPresses.length - applies;

	// ----------------------------------------------- Flame Shock multi-dot
	// The cleave preset's rule (maxDots 2) keeps the dot on a second target while two or more enemies
	// are up — the Dark Shaman are the textbook case. The secondary is the second-busiest enemy the
	// player actually hit, and the metric is the dot's uptime on it over the multi-target stretch.
	//
	// Only out of enemies this rule can fairly be applied to, which is the *second* clause of the same
	// predicate the core already used to build `landedHits`. The core asked "is this a target at all"
	// and dropped the units nothing can damage; this asks the narrower question a dot has to ask —
	// was it going to be there long enough for the global to pay for itself — with the same
	// `isJudgeableTarget` over the same `spawnLives`, so the two cannot answer differently.
	const hitCounts = new Map<number, number>();
	for (const hit of landedHits) {
		if (!isJudgeableTarget(spawnLives.get(hit.key), { minLifetimeMs: FS_SECOND_TARGET_LIFETIME_MS })) continue;
		hitCounts.set(hit.target, (hitCounts.get(hit.target) ?? 0) + 1);
	}
	const secondaryID = [...hitCounts.entries()].filter(([id]) => id !== primaryID).sort((a, b) => b[1] - a[1])[0]?.[0];
	// The union across the secondary's own spawns, for the same reason the primary's figure is: this is
	// a percentage labelled with one enemy, not a verdict on one press.
	const fsSecondaryWindows = dotWindowsOnTarget(events, FS_DEBUFF, t0, fightEnd, secondaryID, actor.id).merged;
	const multiDotUptimeMs = unionMs(intersect(fsSecondaryWindows, multiTargetWindows));
	/**
	 * The denominator, and it is the *dot's* clock rather than the pull's.
	 *
	 * Zero when the pull put no second target worth dotting in front of the player, which is a different
	 * fact from a second dot that was never kept up — and the only one of the two this pull can support.
	 * Both readers of this figure already treat it as exactly that gate: `score.ts` grades nothing when
	 * it is zero and the section hides the tile, so a pull whose only other enemy was an immune mine or
	 * an add that died in four seconds is left unjudged instead of being handed a 0% it could not have
	 * beaten.
	 */
	const multiDotMs = secondaryID === undefined ? 0 : multiTargetMs;
	const multiDotUptimePct = multiDotMs > 0 ? (multiDotUptimeMs / multiDotMs) * 100 : 0;

	// ------------------------------------------------------------ Lava Burst
	// Lava Surge (77762) makes one Lava Burst free, and Ascendance resets the cooldown — the ladder's
	// `readyWhen` is exactly those two resets. The section answers the one question a bare cast count
	// cannot: a surge that expired with no Lava Burst inside was a free cast thrown away.
	const lavaSurgeWindows = selfWindows(LAVA_SURGE);
	const lavaBurstCasts = castTimes(LAVA_BURST);
	const lavaSurgeProcs = lavaSurgeWindows.map((w) => {
		const consumed = lavaBurstCasts.some((t) => t >= w.start && t <= w.end);
		return {
			start: w.start,
			end: w.end,
			consumed,
			// A surge that expired while the player could not act — an intermission — is the fight
			// taking the free cast back, not a cast the player threw away.
			wasted: !consumed && contact.some(([s, e]) => w.end >= s && w.end < e),
		};
	});
	const lavaBurstPresses = lavaBurstCasts.map((t) => ({
		t,
		surge: inWindow(t, lavaSurgeWindows),
		ascendance: inWindow(t, ascActiveWindows),
	}));

	// ---------------------------------------------------------- Earth Shock
	// The shield is a self-buff, so its counter is read off the player's own events rather than the
	// fight's — a raid with two shamans interleaves two shields under one id, and mixing them would
	// turn each press's stack count into whichever shaman spent last.
	// The cap off the aura that declares it — one definition, and the same one `trackStackBank` reads.
	// Non-null because the registry entry above sets `maxStacks` unconditionally; a `??` fallback to the
	// module constant would be unreachable code implying the two could disagree.
	const lightningShieldCap = LIGHTNING_SHIELD.maxStacks ?? 0;
	const lsLevels = auraLevels(selfEvents, LIGHTNING_SHIELD, t0, fightEnd);
	const twoPieceWindows = selfWindows(T16_2PC_PROC);
	const esPresses = castTimes(EARTH_SHOCK).map((t) => {
		const stacks = levelAt(lsLevels, t);
		// The dot on the enemy this shock is being fired at, not on any spawn of its actor id — the
		// `fsLow` reason below is a statement about the target in front of the player.
		const fsRemaining = fsRemainingAt(t);
		const ascReadyInSec = ascendanceReadyInSec(ascCasts, t);
		const twoPiece = inWindow(t, twoPieceWindows);
		// The four conditions the sim's rule wants, and the reason each failure maps to — so the
		// section can say *why* a shock went early instead of collapsing all four into one word.
		const reasons: EarthShockReason[] = [];
		if (stacks !== null && stacks < lightningShieldCap) reasons.push('belowFull');
		if (fsRemaining < ES_FS_MIN_MS) reasons.push('fsLow');
		if (ascReadyInSec < ES_ASC_HOLD_SEC) reasons.push('ascReady');
		if (twoPiece) reasons.push('twoPiece');
		return {
			t,
			lsStacks: stacks,
			fsRemainingMs: fsRemaining,
			ascReadyInSec,
			twoPiece,
			good: reasons.length === 0,
			reasons,
		};
	});

	// ------------------------------------------------------ Lightning Shield
	// The counter itself, drawn as a step series — one point per stack change, the level the log
	// stamped after it. `levelAt` already reads these with the press's own drain guarded off; the
	// audit also answers the three questions a reader asks of a counter aura: did it sit at the
	// ceiling too long, did it come off, and were the spends taken at the ceiling.
	const lsPoints: Array<[number, number]> = lsLevels.map((l) => [l.start, l.level]);
	// The ceiling stretches, past the reader's grace, through the shared counter derivation rather than a
	// walk of its own. `lsLevels` is already `CounterStretch`-shaped, and passing the stretches rather
	// than `lsPoints` is deliberate: the shield's series has gaps, and inferring a stretch's end from the
	// next entry's start would run a 3s window at the ceiling across a 40s absence.
	const overcapWindows = atCapWindows(lsLevels, lightningShieldCap, lightningShieldOvercapMs);
	const overcapMs = unionMs(toIntervals(overcapWindows));
	// Fell off: the stretches the shield was down, which is the complement of the stretches it was up.
	// `complementOf` rather than the walk that was written here — same merge, same gap-push, same tail,
	// and it is imported into this file already. `auraLevels` only ever emits stretches at level 1 or
	// above, so every stretch is an up-period and the complement is exactly the down time.
	const downWindows: Window[] = complementOf(toIntervals(levelWindows(lsLevels)), duration).map(([start, end]) => ({
		start,
		end,
	}));
	const fellOff = downWindows.length;
	// Bad spends: an Earth Shock that spent fewer than the ceiling. A spend at the ceiling is the
	// whole game and is not shown — the section only lists the ones that threw Fulmination away.
	// Computed once and counted from here: the same predicate used to be written out three times over
	// this one array, and three copies of a rule are three places for it to drift.
	// **Listed, deliberately not graded.** A shock spent under the ceiling already fails one of the four
	// conditions behind `earthShockGood` — `belowFull` is pushed as a reason a press is not good — so it
	// has already cost the reader a graded metric in the Earth Shock section. Grading it a second time
	// here would mark one mistake down twice and make the summary read worse than the pull was.
	//
	// Which is why this section shows the *table* and no grade on the tile: the row is the evidence, and
	// the verdict on it lives where the press is judged. A review read the missing grade as an oversight;
	// it is the double-count being avoided, and this comment exists so the next one does not have to ask.
	const badSpends = esPresses
		.filter((p) => p.lsStacks !== null && p.lsStacks < lightningShieldCap)
		.map((p) => ({ t: p.t, stacks: p.lsStacks }));

	// ---------------------------------------------------------- Searing Totem
	// A fire-and-forget: one global, a minute of ticks. Three faults grade it — a re-press that clips
	// a healthy totem, a placement under the Fire Elemental (the list keeps the two apart), and a
	// placement with ten seconds or less of fight left.
	//
	// **There is one Fire totem slot, and both summons take it.** `registerSearingTotemSpell` calls
	// `FireElemental.Disable`; `registerFireElementalTotem` deactivates the Searing Totem dot. So
	// whichever went down last is the only one standing, and priority 20 of the p5 list gates the
	// totem on `!fire-elemental` for exactly that reason.
	//
	// Which is why both window sets come out of *one* walk over both cast lists in time order, each
	// placement closing whatever the slot held. Derived independently they overlapped, and every
	// number downstream inherited the overlap: the graph drew a totem ticking through a Fire Elemental
	// that had already destroyed it, the uptime figure counted that stretch as kept, and a re-press
	// after an elemental read as a clip of a totem that was not there.
	//
	// **And the walk starts with whatever the bell found in the slot.** A Fire Elemental summoned before
	// the pull logs no cast inside the fight window — its only trace is the bare `removebuff` where it
	// expired, which `auraWindows`' `openAtPull` recovers as `[0, expiry]`. Built from the cast list
	// alone the walk saw an empty slot for that stretch, left the elemental's own minute inside the
	// Searing Totem denominator, and charged the player for seconds the elemental was standing in the
	// one slot a totem could have gone in. That is precisely the fault-fabrication the paragraph above
	// exists to prevent, one summon short of being caught.
	const fePrepullWindow = auraWindows(selfEvents, FIRE_ELEMENTAL_AURA, t0, fightEnd, { openAtPull: true }).find(
		(w) => w.preexisting === true,
	);
	const stCasts = castTimes(SEARING_TOTEM);
	const feCasts = castTimes(FIRE_ELEMENTAL);
	type FireTotem = 'searing' | 'elemental';
	const placements: Array<{ t: number; kind: FireTotem }> = [
		...stCasts.map((t): { t: number; kind: FireTotem } => ({ t, kind: 'searing' })),
		...feCasts.map((t): { t: number; kind: FireTotem } => ({ t, kind: 'elemental' })),
	].sort((a, b) => a.t - b.t);
	const stIntervals: Interval[] = [];
	const feIntervals: Interval[] = [];
	// What the slot holds as the walk moves through it. Both per-press reads come off this rather than
	// off the totem's own cast list, so a press cannot be told it clipped a totem the Fire Elemental
	// had already taken away — `held.kind` is the whole of that guard.
	//
	// Seeded with the pre-pull elemental where there was one, so the first placement of the pull closes
	// it exactly as an in-fight summon would.
	let held: { kind: FireTotem; start: number; end: number } | null =
		fePrepullWindow === undefined ? null : { kind: 'elemental', start: 0, end: fePrepullWindow.end };
	// The two faults the walk is the only place that can see, keyed by the press they belong to.
	const stRemaining = new Map<number, number>();
	const stFeOverlap = new Set<number>();
	const close = (at: number) => {
		if (held === null) return;
		const end = Math.min(held.end, at);
		// Zero-length spans are dropped rather than pushed: two summons stamped on the same millisecond
		// are one placement as far as the slot is concerned, and a `[t, t]` span downstream is a band
		// the chart still draws at its minimum width.
		if (end > held.start) (held.kind === 'searing' ? stIntervals : feIntervals).push([held.start, end]);
		held = null;
	};
	for (const { t, kind } of placements) {
		if (kind === 'searing' && held !== null && held.end > t) {
			if (held.kind === 'searing') stRemaining.set(t, held.end - t);
			else stFeOverlap.add(t);
		}
		close(t);
		const durationMs = kind === 'searing' ? SEARING_TOTEM_DURATION_MS : FIRE_ELEMENTAL_DURATION_MS;
		const [start, end] = untilFightEnd(t, durationMs);
		held = { kind, start, end };
	}
	close(Infinity);

	const stMerged: Window[] = mergeIntervals(stIntervals).map(([start, end]) => ({ start, end }));
	const feWindows = mergeIntervals(feIntervals);
	const stPresses: SearingTotemPress[] = stCasts.map((t) => {
		const remainingMs = stRemaining.get(t) ?? null;
		return {
			t,
			remainingMs,
			clipped: remainingMs !== null && remainingMs > searingTotemRefreshMs,
			feOverlap: stFeOverlap.has(t),
			// `duration`, not `fightEnd`: press times are fight-relative and `fightEnd` is the absolute
			// stamp `auraWindows` is handed, so subtracting one from the other measured the pull's
			// distance from the epoch and no placement was ever late.
			late: duration - t < SEARING_TOTEM_LATE_MS,
		};
	});
	const stClipped = stPresses.filter((p) => p.clipped);
	const stWastedMs = stClipped.reduce((s, p) => s + (p.remainingMs ?? 0), 0);

	/**
	 * The clock the totem is graded against: engaged time, less every stretch the Fire Elemental owned
	 * the slot.
	 *
	 * A player cannot have a Searing Totem up while the elemental is out, so that time is not a totem
	 * they dropped — it comes out of the denominator rather than being scored as a miss. Without this
	 * a pull that used the elemental on cooldown could not clear the section's "good" bar however well
	 * the totem was kept.
	 *
	 * The numerator is intersected with the same clock rather than taken raw. Two halves of one ratio
	 * measured over two different stretches is how a percentage above 100 happens — a totem ticking
	 * through an intermission would have counted up against a denominator the intermission was already
	 * out of.
	 */
	const stScored = intersect(engaged, complementOf(feWindows, duration));
	const stScoredMs = unionMs(stScored);
	const stUptimeMs = unionMs(intersect(stIntervals, stScored));

	// ------------------------------------------------------------ Snapshots
	// The sim's Flame Shock rule (priority 7) wants the dot reapplied while (Elemental Blast or
	// Primal Elementalist is talented — a gate the section's copy owns) AND a proc window is up:
	// the UVLS buff, the UVLS counter at ten, or Black Blood of Y'Shaarj at ten — with one of the
	// int procs (Breath of the Hydra, Cha-Ye's, Tempus Repit) also up. The `dotPercentIncrease >
	// 10%` half of the rule is unmeasurable off a log; the int-proc requirement is its readable
	// stand-in, and the section says so.
	const triggerWindows = new Map<'unerring-vision' | 'uvls-stacks' | 'black-blood', Interval[]>();
	triggerWindows.set('unerring-vision', toIntervals(selfWindows(UNERRING_VISION)));
	triggerWindows.set(
		'uvls-stacks',
		toIntervals(levelWindows(auraLevels(events, UNERRING_VISION_STACKS, t0, fightEnd), 10)),
	);
	triggerWindows.set(
		'black-blood',
		toIntervals(levelWindows(auraLevels(events, WRATH_OF_DARKSPEAR, t0, fightEnd), 10)),
	);
	const intProcWindows = mergeIntervals([
		...toIntervals(selfWindows(BREATH_OF_HYDRA)),
		...toIntervals(selfWindows(CHAYES)),
		...toIntervals(selfWindows(TEMPUS_REPIT)),
	]);
	const snapshotWindows: ElementalAuditResult['snapshots']['windows'] = [];
	for (const [source, triggers] of triggerWindows) {
		for (const [start, end] of triggers) {
			// The window the rule actually claims is the overlap of the trigger with an int proc.
			const overlap = intProcWindows.filter(([s, e]) => e > start && s < end);
			for (const [s, e] of overlap) {
				const windowStart = Math.max(start, s);
				const windowEnd = Math.min(end, e);
				if (windowEnd <= windowStart) continue;
				snapshotWindows.push({ start: windowStart, end: windowEnd, source });
			}
		}
	}
	snapshotWindows.sort((a, b) => a.start - b.start);
	let snapRefreshed = 0;
	let snapMissed = 0;
	for (const window of snapshotWindows) {
		const refreshInside = fsPresses.some((p) => p.remainingMs !== null && p.t >= window.start && p.t <= window.end);
		if (refreshInside) snapRefreshed++;
		else if (inWindow(window.start, fsMerged)) snapMissed++;
	}

	// ------------------------------------------------------------ Ascendance
	// The two-piece debuff's union: it is drawn as a lane, and the two-piece read below is a check on
	// this player's own proc rather than on which add they were facing.
	const t16DebuffWindows = dotWindowsOnTarget(events, T16_2PC_DEBUFF, t0, fightEnd, primaryID, actor.id).merged;
	const ascPresses = ascCasts.map((t) => ({
		t,
		// Per spawn: "Ascendance pressed without a fresh Flame Shock" is a claim about the enemy the
		// player was about to spend the window on, and the list's own rule reads `dotRemainingTime`,
		// which the sim evaluates against the current target.
		fsRemainingMs: fsRemainingAt(t) || null,
		opener: t <= 5000,
		twoPiece:
			remainingIn(
				t,
				t16DebuffWindows.map(([start, end]) => ({ start, end })),
			) >= 10_000,
	}));

	// The two cooldowns the list does not judge against a bare clock either, each read against its
	// full rule from the p5 list.
	//
	// Elemental Mastery (rule 9) is synced with Ascendance: the opener, or Ascendance ready inside 2s
	// with the dot under 16s, or a tier-15 four-piece window, or — without that four-piece — Ascendance
	// far away or imminent. Fire Elemental (rule 19) is the pull's last sixty seconds, or synced with
	// Ascendance inside 150s, or pressed early enough that it will be back before the pull ends.
	const t15Windows = selfWindows(T15_4PC);
	const emPresses = castTimes(ELEMENTAL_MASTERY).map((t) => {
		const ascReady = ascendanceReadyInSec(ascCasts, t);
		// Per spawn, on the same terms as the Ascendance press it is synced with — the `sync` reason is
		// a claim about the dot on the enemy the pair of cooldowns is about to be spent on.
		const fsRemaining = fsRemainingAt(t);
		const t15Active = inWindow(t, t15Windows);
		const ascActive = inWindow(t, ascActiveWindows);
		const reason: 'opener' | 'sync' | 't15' | 'off' | null =
			t <= 5000
				? 'opener'
				: ascReady <= 2 && fsRemaining <= FS_ASC_PREP_MS
					? 'sync'
					: t15Active && (ascActive || ascReady >= 90 || ascReady < 2)
						? 't15'
						: !t15Active && (ascReady >= 85 || ascReady < 4)
							? 'off'
							: null;
		return { t, reason };
	});
	const fePresses = castTimes(FIRE_ELEMENTAL).map((t) => {
		const remaining = duration - t;
		const ascReady = ascendanceReadyInSec(ascCasts, t);
		const reason: 'near-end' | 'sync' | 'early' | null =
			remaining < FIRE_ELEMENTAL_DURATION_MS
				? 'near-end'
				: remaining < 150_000 && ascReady <= 5
					? 'sync'
					: remaining > 180_000
						? 'early'
						: null;
		return { t, reason };
	});

	// The Earth Elemental, judged against the list's own end-of-fight rule (`remainingTime <= 62s`) —
	// the one branch the p5 list actually uses, the Skull Banner and no-Primal-Elementalist edges aside.
	const eePresses = castTimes(EARTH_ELEMENTAL).map((t) => ({ t, nearEnd: duration - t <= EE_END_MS }));
	// Whether the Fire Elemental was already out when the bell went — the prepull press the list makes
	// when Heroism is going up on the pull.
	const fePrepull = auraWindows(selfEvents, FIRE_ELEMENTAL_AURA, t0, fightEnd, { openAtPull: true }).some(
		(w) => w.preexisting === true,
	);

	// ------------------------------------------------------------ Stormlash
	// The raid's totems, one window per placement, grouped by the shaman who laid it. The buff does not
	// stack, so the overlaps are the section's argument: a totem laid on top of a running one is wasted.
	const stormlashByShaman = new Map<number, Window[]>();
	for (const e of raidStormlash) {
		const at = e.timestamp - t0;
		const source = e.sourceID ?? -1;
		const list = stormlashByShaman.get(source) ?? [];
		list.push({ start: at, end: at + STORMLASH_DURATION_MS });
		stormlashByShaman.set(source, list);
	}
	const stormlashShamans: StormlashAudit['shamans'] = [...stormlashByShaman.entries()].map(([id, windows]) => ({
		id,
		name: h.actors.find((a) => a.id === id)?.name ?? null,
		windows: windows.sort((a, b) => a.start - b.start),
	}));
	const stormlashTotems = stormlashShamans.reduce((s, shaman) => s + shaman.windows.length, 0);
	// The stretches two totems were up at once. `overlapPoints` + `intervalsAtLeast` rather than the
	// boundary sweep that was written here, which reported an overlap still running at the kill with
	// the totem's own expiry instead of the fight's end — a stretch longer than the pull — and emitted
	// a zero-length overlap for two totems sharing an instant.
	const stormlashOverlaps: Window[] = intervalsAtLeast(
		overlapPoints(stormlashShamans.flatMap((shaman) => shaman.windows.map((w): Interval => [w.start, w.end]))),
		2,
		duration,
	).map(([start, end]) => ({ start, end }));

	// ------------------------------------------------------------------ APL
	const auras: AplInputs['auras'] = {
		// The union, and only for `present` — "this pull carried the dot at all" is a fact about the pull.
		// Every rule that reads the dot reads `dotRemainingTime`, which comes through `auraRemainingAt`
		// below instead, because no window array can express "on whichever enemy I am facing": clipping
		// a spawn's window at the moment the player left the enemy makes `remainingIn` read the *future*
		// target swap as the dot expiring, and leaving it unclipped is the union again.
		'flame-shock': fsMerged,
		ascendance: toIntervals(selfWindows(ASCENDANCE_AURA)).map(([start, end]) => ({
			start,
			end,
		})),
		'lava-surge': toIntervals(selfWindows(LAVA_SURGE)).map(([start, end]) => ({
			start,
			end,
		})),
		'searing-totem': stMerged,
		// Both off the Fire totem slot walk above, not re-derived here. The APL's priority 20 asks
		// whether either was up, and answering it from a second pair of window sets would let the
		// ladder disagree with the section that grades the same press.
		'fire-elemental': feWindows.map(([start, end]) => ({ start, end })),
		't16-2pc-proc': toIntervals(twoPieceWindows).map(([start, end]) => ({ start, end })),
	};
	const emptyCurve = { max: 0, points: [] as Array<[number, number]> };
	const aplInputs: AplInputs = {
		casts: marks,
		energy: emptyCurve,
		chi: emptyCurve,
		regenPerSec: 0,
		gcdMs: GCD_MS,
		pullMs: duration,
		auras,
		// The one aura whose answer depends on *which* enemy, not only on when. The p5 list writes it as
		// `dotRemainingTime(8050)`, which the sim evaluates against the unit the action is aimed at, so
		// this is the closer transcription as well as the tighter one.
		auraRemainingAt: { 'flame-shock': fsRemainingAt },
		fofChannelSec: 0,
		targetsAt: aplTargetCountAt,
		stackLevels: { 'lightning-shield': lsLevels },
		offLadderCooldowns: { [ASCENDANCE.castIds[0]!]: { cooldownMs: ASCENDANCE_COOLDOWN_MS, casts: ascCasts } },
		barsRequired: false,
	};
	const apl = aplAudit(aplInputs, LADDER);
	const aplForced: Partial<Record<Band, AplAudit | null>> = {};
	for (const band of ALL_BANDS) {
		aplForced[band] = aplAudit({ ...aplInputs, forceBand: band }, LADDER);
	}

	// ------------------------------------------------------------ miss ledger
	// Through `auraDrops`, and with the contact clock handed over as evidence.
	//
	// Two rules apply. Anything under `DROP_MS` is refresh jitter, not a drop. And a gap is charged only
	// for the part of it the player was in contact for — so the boss submerging costs nothing, while a
	// hole taken with the boss in reach costs all of it.
	//
	// The `away` argument is the whole point. Without it `auraDrops` forgives the *largest* gap
	// unconditionally, which on a single-phase pull is the one real drop the player made: the ledger
	// would go silent about exactly the mistake it exists to report. Measured on
	// `a:qHRAFwdGzaB6MPYC` #14, the four gaps are 36ms, 888ms, 643ms and 41 914ms, and only the last
	// has any claim to being a phase break — it carries 529ms of contact against 41.4s of absence.
	const fsDropMisses: Miss[] = auraDrops(toIntervals(fsMerged), DROP_MS, fsAway).drops.map((gap) => ({
		kind: primaryName === null ? 'Flame Shock dropped' : `Flame Shock dropped (${primaryName})`,
		at: gap.t,
		detail: `${(gap.ms / 1000).toFixed(1)}s without the dot`,
		link: link(gap.t),
	}));
	const snapshotMisses: Miss[] = snapshotWindows
		.filter((w) => inWindow(w.start, fsMerged))
		.filter((w) => !fsPresses.some((p) => p.remainingMs !== null && p.t >= w.start && p.t <= w.end))
		.map((w) => ({
			kind: `Snapshot missed (${w.source})`,
			at: w.start,
			detail: 'Flame Shock was up and was not refreshed inside the proc window',
			link: link(w.start),
		}));
	const ascMisses: Miss[] = ascPresses
		.filter((p) => p.fsRemainingMs !== null && p.fsRemainingMs < FS_ASC_PREP_MS)
		.map((p) => ({
			kind: 'Ascendance pressed without a fresh Flame Shock',
			at: p.t,
			detail: `the dot had ${(p.fsRemainingMs! / 1000).toFixed(1)}s left; the list wants over 15s`,
			link: link(p.t),
		}));
	const heldMisses: Miss[] = lostCasts.flatMap((l) =>
		l.worst
			.filter((w) => w.seconds >= l.cooldownSec)
			.map((w) => ({
				kind: `${l.name} held`,
				at: w.at,
				detail: `ready and unused for ${w.seconds}s`,
				link: w.link,
			})),
	);

	// -------------------------------------------------------------- timeline
	const lane = (aura: Ability | Aura, group: 'buff' | 'proc' | 'debuff', windows: readonly Window[]): AuraLane => ({
		key: aura.key,
		name: aura.name,
		id: ('castIds' in aura ? aura.castIds[0] : aura.ids[0]) ?? 0,
		group,
		windows: windows.map((w) => ({ start: w.start, end: w.end })),
	});
	const lanes: AuraLane[] = [
		lane(FS_DEBUFF, 'debuff', fsMerged),
		// The player's own Stormlash, not the raid's: the timeline is this player's story, and the raid
		// view lives in the Stormlash section. The cast carries the window because the totem lasts a
		// fixed ten seconds.
		lane(
			STORMLASH_AURA,
			'buff',
			mergeIntervals(castTimes(STORMLASH_TOTEM).map((t) => untilFightEnd(t, STORMLASH_DURATION_MS))).map(([s, e]) => ({
				start: s,
				end: e,
			})),
		),
		lane(
			ASCENDANCE_AURA,
			'buff',
			toIntervals(selfWindows(ASCENDANCE_AURA)).map(([s, e]) => ({ start: s, end: e })),
		),
		lane(
			ELEMENTAL_MASTERY,
			'buff',
			toIntervals(selfWindows(registry.aura('elemental-mastery'))).map(([s, e]) => ({
				start: s,
				end: e,
			})),
		),
		// The elemental's windows off the Fire totem slot walk, so this lane and the Searing Totem lane
		// under it are the two halves of one slot rather than two independent claims on the same time.
		lane(
			FIRE_ELEMENTAL_AURA,
			'buff',
			feWindows.map(([s, e]) => ({ start: s, end: e })),
		),
		lane(SEARING_TOTEM_DOT, 'debuff', stMerged),
		lane(
			LAVA_SURGE,
			'proc',
			toIntervals(selfWindows(LAVA_SURGE)).map(([s, e]) => ({ start: s, end: e })),
		),
		lane(
			T16_2PC_PROC,
			'proc',
			toIntervals(twoPieceWindows).map(([s, e]) => ({ start: s, end: e })),
		),
		// The two-piece debuff the proc leaves on the primary target, so the Ascendance two-piece window
		// can be read off the timeline rather than only off the cooldowns section.
		lane(
			T16_2PC_DEBUFF,
			'debuff',
			t16DebuffWindows.map(([start, end]) => ({ start, end })),
		),
		lane(
			UNERRING_VISION,
			'proc',
			toIntervals(selfWindows(UNERRING_VISION)).map(([s, e]) => ({ start: s, end: e })),
		),
		lane(
			BREATH_OF_HYDRA,
			'proc',
			toIntervals(selfWindows(BREATH_OF_HYDRA)).map(([s, e]) => ({ start: s, end: e })),
		),
		lane(
			CHAYES,
			'proc',
			toIntervals(selfWindows(CHAYES)).map(([s, e]) => ({ start: s, end: e })),
		),
		lane(
			WRATH_OF_DARKSPEAR,
			'proc',
			toIntervals(selfWindows(WRATH_OF_DARKSPEAR)).map(([s, e]) => ({ start: s, end: e })),
		),
		// An aura the log never carried has no windows and no business taking a row — the talent was not
		// taken, or the trinket was not worn. Dropped rather than drawn empty, so the timeline names only
		// what actually happened.
	].filter((l) => l.windows.length > 0);

	// -------------------------------------------------------------- assembly
	// The globals this audit found spent on a press that bought nothing: a Flame Shock refresh that
	// was neither the reader's keep-it-up window nor the sim's Ascendance prep, and every Searing
	// Totem pressed over a healthy one.
	const wastedGcds =
		fsPresses.filter((p) => p.remainingMs !== null && !p.windowed && !p.ascPrep).length + stClipped.length;

	/**
	 * One tick window for the whole pull, out of a rule that is per press.
	 *
	 * The chart draws a single band and the section quotes a single figure, and a pull whose haste moved
	 * has no single tick window — `phased` is graded against 1 349ms, 1 748ms and 2 275ms in the same
	 * fight. The median of the windows the refreshes were actually judged against is the one that
	 * describes most of them; the per-press truth stays on each press's own `tickMs`, which is what the
	 * verdict was decided on. Falls back to the unhasted period on a pull with nothing to refresh.
	 */
	const fsRefreshWindows = fsPresses.filter((p) => p.remainingMs !== null).map((p) => p.tickMs);
	const fsTickMs = fsRefreshWindows.length > 0 ? median(fsRefreshWindows) : FLAME_SHOCK_DOT.tickMs;

	return {
		flameShock: {
			windows: fsMerged,
			uptimeMs: fsUptimeMs,
			uptimePct: uptimePct(fsEngagedWindows, engagedMs),
			applies,
			refreshes,
			windowed: fsPresses.filter((p) => p.windowed).length,
			ascPrep: fsPresses.filter((p) => p.ascPrep).length,
			refreshMs: fsTickMs,
			ticks: Math.round(FLAME_SHOCK_DURATION_MS / fsTickMs),
			durationMs: FLAME_SHOCK_DURATION_MS,
			presses: fsPresses,
			multiDotUptimeMs,
			multiDotUptimePct,
			multiTargetMs: multiDotMs,
		},
		lavaBurst: {
			procs: lavaSurgeProcs,
			presses: lavaBurstPresses,
			wasted: lavaSurgeProcs.filter((p) => p.wasted).length,
		},
		earthShock: {
			presses: esPresses,
			good: esPresses.filter((p) => p.good).length,
			belowFull: badSpends.length,
		},
		searingTotem: {
			windows: stMerged,
			uptimeMs: stUptimeMs,
			scoredMs: stScoredMs,
			uptimePct: stScoredMs > 0 ? (stUptimeMs / stScoredMs) * 100 : 0,
			// Carried so the graph can leave the elemental's stretch out of its "down" band the same way
			// the figure above leaves it out of the denominator. Two readings of when the slot was taken
			// would be two answers, and the one the reader sees would be the chart's.
			feWindows: feWindows.map(([start, end]) => ({ start, end })),
			presses: stPresses,
			clipped: stClipped.length,
			wastedMs: stWastedMs,
			feOverlaps: stPresses.filter((p) => p.feOverlap).length,
			latePlacements: stPresses.filter((p) => p.late).length,
		},
		snapshots: {
			windows: snapshotWindows,
			refreshed: snapRefreshed,
			missed: snapMissed,
		},
		ascendance: { presses: ascPresses },
		elementalMastery: { presses: emPresses },
		fireElemental: { presses: fePresses, prepull: fePrepull },
		earthElemental: { presses: eePresses },
		stormlash: { shamans: stormlashShamans, overlaps: stormlashOverlaps, totems: stormlashTotems },
		lightningShield: {
			points: lsPoints,
			maxStacks: lightningShieldCap,
			overcapMs,
			leewayMs: lightningShieldOvercapMs,
			overcapWindows,
			fellOff,
			downWindows,
			badSpends,
		},
		apl,
		aplForced,
		misses: [...fsDropMisses, ...snapshotMisses, ...ascMisses, ...heldMisses],
		cpm: { wastedGcds, channelSec: 0 },
		timeline: { casts: marks, lanes },
	};
}

// ------------------------------------------------------------------- spec

/**
 * Whether this player was actually an Elemental shaman.
 *
 * Classic logs report combatantinfo.specID as 0, so the spec has to be inferred. Lava Burst is
 * Elemental-only — the sim's enhancement and restoration trees never register it — so a single
 * press is the reliable tell. Without this guard the analysis would "succeed" on an Enhancement
 * shaman and report a rotation nobody had the buttons for.
 */
const identify = (h: Handles): boolean => h.castCount(registry.ability('lava-burst')) > 0;

export const ELEMENTAL_SPEC: SpecConfig = {
	specName: 'Elemental',
	registry,
	gcdMs: GCD_MS,
	extraNames: EXTRA_NAMES,
	// The Elemental ladder reads no resource bar for its decisions — the rotation is purely cooldown-
	// and proc-driven — but the spec's *pool* is mana, which the timeline draws so a reader can see the
	// bar refill beside the presses. A pool, not points: mana refills on a clock and is never spent by
	// the ladder's own condition.
	resources: {
		mana: { type: RESOURCE_TYPE.mana, kind: 'pool' },
	},
	// The Elemental's report draws in the Shaman's own colour — wowsims-mop's `Shaman.hexColor` —
	// so it is recognisable as a shaman's report before a word is read.
	colors: { primary: CLASS_COLOR.shaman },
	thresholds: {
		targetWindowMs: TARGET_WINDOW_MS,
		multiTargetSharePct: MULTI_TARGET_SHARE_PCT,
		singleTargetSharePct: SINGLE_TARGET_SHARE_PCT,
		engagedGapMs: ENGAGED_GAP_MS,
	},
	ignoredMultiTargetActors: () => new Set(),
	needsTarget: NEEDS_TARGET,
	samePressMs: SAME_PRESS_MS,
	potion: {
		abilityKey: 'jade-serpent-potion',
		auraKey: 'jade-serpent-potion',
		slots: POTION_SLOTS,
		categoryCooldownMs: POTION_CATEGORY_CD_MS,
	},
	identify,
	audit: elementalAudit as unknown as SpecConfig['audit'],
	settings: ELEMENTAL_SETTINGS,
};

/** The full analysis of one fight for one Elemental shaman. */
export function analyse(
	dataset: FightDataset,
	settings: AnalysisSettings = defaultSettings(ELEMENTAL_SETTINGS),
): Analysis {
	return analyseCore(dataset, settings, ELEMENTAL_SPEC);
}
