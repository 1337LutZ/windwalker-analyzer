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

import { cooldownDrift } from '~/lib/analysis/cooldowns';
import { auraLevels, auraWindows, inWindow, levelWindows, remainingIn, toIntervals } from '~/lib/analysis/auras';
import { mergeIntervals, type Interval } from '~/lib/analysis/intervals';
import type { AnalysisSettings, SettingSchema } from '~/lib/settings';
import { defaultSettings } from '~/lib/settings';
import type { Analysis, AuraLane, ElementalAuditResult, FightDataset, Miss, WclEvent, Window } from '~/lib/types';
import { clampSettings } from '~/lib/settings';
import { abilityIdOf, isAuraEvent } from '~/lib/events/guards';

import type { Handles } from '~/lib/analysis/analyseCore';
import { analyseCore, type SpecConfig } from '~/lib/analysis/analyseCore';
import type { Ability, Aura, GameData } from '~/lib/game/model';
import { createRegistry } from '~/lib/game/registry';
import { CLASS_COLOR } from '~/lib/game/classes';
import { RESOURCE_TYPE } from '~/lib/game/resources';
import { aplAudit, type AplInputs, ALL_BANDS } from '~/lib/spec/apl';
import type { AplAudit, Band } from '~/lib/spec/apl';
import { LADDER } from './apl';

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
 * The default Flame Shock refresh window, and only the default: the reader owns this one.
 *
 * The p5 list never refreshes the dot on a clock — its Flame Shock rules are the proc-window
 * reapplies and the Ascendance prep — so the keep-it-up window is this report's reading, floored at
 * the sim's own number (Lava Burst is gated on the dot outliving its 2s cast) and capped at a
 * quarter of the 30s dot, past which a refresh throws away more of the dot than it renews.
 */
const FS_REFRESH_DEFAULT_MS = 3000;
const FS_REFRESH_MIN_MS = 1000;
const FS_REFRESH_MAX_MS = 7500;

/** The sim's own thresholds, written where the audit reads them: rules 12, 13 and 18 of the p5 list. */
const FS_ASC_PREP_MS = 16_000;
const FS_LB_GATE_MS = 2000;
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

/** Unleash Elements' cooldown, from `sim/shaman/unleash_elements.go`. */
const UNLEASH_ELEMENTS_COOLDOWN_MS = 15_000;

/** The ceiling Lightning Shield holds (`maxStacks 7`) — the sim opens the fight with it full. */
const LIGHTNING_SHIELD_MAX_STACKS = 7;

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
	},
	{
		key: 'lava-burst',
		name: 'Lava Burst',
		castIds: [51505],
		damageIds: [51505],
		onGcd: true,
		// The 8s cooldown is real but not a bare clock — Lava Surge and Ascendance reset it — and the
		// ladder's `readyWhen` reads those resets. The 100% crit and the Flame Shock gate come from
		// `sim/shaman/elemental/lavaburst.go`.
		gate: 'conditional',
		cooldownMs: 8000,
	},
	{
		key: 'elemental-blast',
		name: 'Elemental Blast',
		castIds: [117014],
		damageIds: [118522],
		onGcd: true,
		// Talent-gated 12s cooldown, pressed whenever it is back — `sim/shaman/elemental_blast.go`.
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
		// The unconditional filler. Judged against nothing but its place in the list.
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
		// — and the log books both the press and the buff under the spell 105696, as with Virmen's Bite.
		castIds: [105696],
		onGcd: false,
		gate: 'other',
		onUse: true,
		applies: ['jade-serpent-potion'],
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
		ids: [114049],
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
		key: 't16-2pc-proc',
		name: 'T16 2pc: Celestial Harmony',
		ids: [144998],
		kind: 'buff',
	},
	{
		key: 't16-2pc-debuff',
		name: 'T16 2pc: Elemental Discharge',
		ids: [144999],
		kind: 'debuff',
	},
	{
		key: 'unerring-vision',
		name: 'Unerring Vision of Lei-Shen',
		ids: [138963],
		kind: 'buff',
	},
	{
		key: 'unerring-vision-stacks',
		name: 'Unerring Vision of Lei-Shen (stacking)',
		ids: [138786],
		kind: 'buff',
		maxStacks: 10,
	},
	{
		key: 'breath-of-hydra',
		name: 'Breath of the Hydra',
		ids: [138898],
		kind: 'buff',
	},
	{
		key: 'chayes',
		name: "Cha-Ye's Essence of Brilliance",
		ids: [139133],
		kind: 'buff',
	},
	{
		key: 'wrath-of-darkspear',
		name: 'Wrath of the Darkspear',
		ids: [146184],
		kind: 'buff',
		maxStacks: 10,
	},
	{
		key: 'tempus-repit',
		name: 'Tempus Repit',
		ids: [137590],
		kind: 'buff',
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
];

export const ELEMENTAL: GameData = { abilities: ABILITIES, auras: AURAS };

/** The one way to ask what a spell id means. Construction validates the links between the two lists. */
export const registry = createRegistry(ELEMENTAL);

const FLAME_SHOCK = registry.ability('flame-shock');
const LAVA_BURST = registry.ability('lava-burst');
const EARTH_SHOCK = registry.ability('earth-shock');
const SEARING_TOTEM = registry.ability('searing-totem');
const ASCENDANCE = registry.ability('ascendance');
const ELEMENTAL_MASTERY = registry.ability('elemental-mastery');
const FIRE_ELEMENTAL = registry.ability('fire-elemental');

const FS_DEBUFF = registry.aura('flame-shock');
const ASCENDANCE_AURA = registry.aura('ascendance');
const LAVA_SURGE = registry.aura('lava-surge');
const LIGHTNING_SHIELD = registry.aura('lightning-shield');
const SEARING_TOTEM_DOT = registry.aura('searing-totem');
const FIRE_ELEMENTAL_AURA = registry.aura('fire-elemental');
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
	{
		key: 'flameShockRefreshMs',
		tKey: 'settings.ele.flameShock',
		// The keep-it-up window. The floor is the sim's own Lava Burst gate (the dot must outlive the
		// 2s cast), and the ceiling is a quarter of the 30s dot: past it a press throws away more of
		// the dot than it renews, and every clip would be graded a refresh, emptying the "wasted"
		// count the section exists to report.
		default: FS_REFRESH_DEFAULT_MS,
		min: FS_REFRESH_MIN_MS,
		max: FS_REFRESH_MAX_MS,
		step: 250,
	},
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
 * The dot's windows on one target, refresh-open and merged.
 *
 * The same machinery the Rising Sun Kick debuff uses (`windwalker.ts`): bucket the 8050 aura events
 * by the enemy they landed on, walk each bucket with `openOnRefresh` so a refresh with nothing open
 * is still proof the dot was up, and merge the result — the merged intervals are what the uptime
 * and the remaining-time reads share, so the figure and the reads cannot disagree about the pull.
 *
 * Flame Shock shares its id with the cast, which the RSK debuff never had to deal with; the buckets
 * are filtered to aura events before `auraWindows` sees them, so a cast event is never mistaken for
 * an application.
 */
function dotWindowsOnTarget(
	events: readonly WclEvent[],
	aura: Aura,
	t0: number,
	fightEnd: number,
	targetID: number | undefined,
): Interval[] {
	const ids = new Set(aura.ids);
	const bucket: WclEvent[] = [];
	for (const e of events) {
		if (e.targetID !== targetID) continue;
		const id = abilityIdOf(e);
		if (id === null || !ids.has(id) || !isAuraEvent(e)) continue;
		bucket.push(e);
	}
	return mergeIntervals(toIntervals(auraWindows(bucket, aura, t0, fightEnd, { openOnRefresh: true })));
}

/** The stacking aura's level at a moment, or null before the first stretch. */
function stacksAt(levels: readonly { start: number; end: number; level: number }[], t: number): number | null {
	let lo = 0;
	let hi = levels.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const stretch = levels[mid];
		if (stretch === undefined) break;
		if (stretch.start <= t) {
			found = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return found === -1 ? null : (levels[found]?.level ?? null);
}

/** Seconds until Ascendance is back, read off its presses and its 180s cooldown. */
function ascendanceReadyInSec(ascCasts: readonly number[], t: number): number {
	let lo = 0;
	let hi = ascCasts.length - 1;
	let last: number | undefined;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const at = ascCasts[mid];
		if (at === undefined) break;
		if (at <= t) {
			last = at;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	if (last === undefined) return 0;
	return Math.max(0, last + ASCENDANCE_COOLDOWN_MS - t) / 1000;
}

/** The stack counter of an aura, as `AuraLevel` stretches. */
const levelsOf = (events: readonly WclEvent[], aura: Aura, t0: number, fightEnd: number) =>
	auraLevels(events, aura, t0, fightEnd);

/**
 * The Elemental's half of the analysis, from the engine's `Handles` and nothing else.
 *
 * The core has already assembled the press marks, the contact and engaged clocks, the primary
 * target, the damage table and the lost-cast rows; everything here is what only an Elemental model
 * can say about them.
 */
export function elementalAudit(h: Handles): ElementalAuditResult {
	const {
		events,
		t0,
		duration,
		link,
		selfEvents,
		castTimes,
		castCount,
		primaryID,
		primaryName,
		engaged,
		engagedMs,
		marks,
		aplTargetCountAt,
		lostCasts,
	} = h;
	const { flameShockRefreshMs } = h.settings;
	const fightEnd = t0 + duration;

	const ascCasts = castTimes(ASCENDANCE);

	// --------------------------------------------------------- Flame Shock
	// The dot on the enemy the pull was about. Without a primary there is nothing to measure — the
	// section reads zero rather than inventing a target.
	const fsWindows = primaryID === undefined ? [] : dotWindowsOnTarget(events, FS_DEBUFF, t0, fightEnd, primaryID);
	const fsMerged: Window[] = fsWindows.map(([start, end]) => ({ start, end }));
	const fsUptimeMs = fsMerged.reduce((s, w) => s + w.end - w.start, 0);

	const fsCasts = castTimes(FLAME_SHOCK);
	const fsPresses = fsCasts.map((t) => {
		const remaining = remainingIn(t, fsMerged);
		const ascReadyInSec = ascendanceReadyInSec(ascCasts, t);
		return {
			t,
			remainingMs: fsMerged.length === 0 ? null : remaining > 0 ? remaining : null,
			windowed: remaining > 0 && remaining <= flameShockRefreshMs,
			ascPrep: remaining > 0 && remaining < FS_ASC_PREP_MS && ascReadyInSec <= 2,
		};
	});
	const applies = fsPresses.filter((p) => p.remainingMs === null).length;
	const refreshes = fsPresses.length - applies;

	// ---------------------------------------------------------- Earth Shock
	const lsLevels = primaryID === undefined ? [] : levelsOf(events, LIGHTNING_SHIELD, t0, fightEnd);
	const twoPieceWindows = auraWindows(selfEvents, T16_2PC_PROC, t0, fightEnd);
	const esPresses = castTimes(EARTH_SHOCK).map((t) => {
		const stacks = stacksAt(lsLevels, t);
		const fsRemaining = remainingIn(t, fsMerged);
		const ascReadyInSec = ascendanceReadyInSec(ascCasts, t);
		const twoPiece = inWindow(t, twoPieceWindows);
		return {
			t,
			lsStacks: stacks,
			fsRemainingMs: fsRemaining,
			ascReadyInSec,
			twoPiece,
			good:
				(stacks === null || stacks >= LIGHTNING_SHIELD_MAX_STACKS) &&
				fsRemaining >= ES_FS_MIN_MS &&
				ascReadyInSec >= ES_ASC_HOLD_SEC &&
				!twoPiece,
		};
	});

	// ---------------------------------------------------------- Searing Totem
	const stCasts = castTimes(SEARING_TOTEM);
	const stMerged: Window[] = mergeIntervals(stCasts.map((t) => [t, t + SEARING_TOTEM_DURATION_MS] as Interval)).map(
		([start, end]) => ({ start, end }),
	);
	let stRefreshes = 0;
	let stWastedMs = 0;
	for (let i = 1; i < stCasts.length; i++) {
		const t = stCasts[i]!;
		const prev = stCasts[i - 1]!;
		if (t < prev + SEARING_TOTEM_DURATION_MS) {
			stRefreshes++;
			stWastedMs += Math.min(SEARING_TOTEM_DURATION_MS, prev + SEARING_TOTEM_DURATION_MS - t);
		}
	}
	const stUptimeMs = stMerged.reduce((s, w) => s + w.end - w.start, 0);

	// ------------------------------------------------------------ Snapshots
	// The sim's Flame Shock rule (priority 7) wants the dot reapplied while (Elemental Blast or
	// Primal Elementalist is talented — a gate the section's copy owns) AND a proc window is up:
	// the UVLS buff, the UVLS counter at ten, or Black Blood of Y'Shaarj at ten — with one of the
	// int procs (Breath of the Hydra, Cha-Ye's, Tempus Repit) also up. The `dotPercentIncrease >
	// 10%` half of the rule is unmeasurable off a log; the int-proc requirement is its readable
	// stand-in, and the section says so.
	const triggerWindows = new Map<'unerring-vision' | 'uvls-stacks' | 'black-blood', Interval[]>();
	triggerWindows.set('unerring-vision', toIntervals(auraWindows(selfEvents, UNERRING_VISION, t0, fightEnd)));
	triggerWindows.set(
		'uvls-stacks',
		toIntervals(levelWindows(levelsOf(events, UNERRING_VISION_STACKS, t0, fightEnd), 10)),
	);
	triggerWindows.set('black-blood', toIntervals(levelWindows(levelsOf(events, WRATH_OF_DARKSPEAR, t0, fightEnd), 10)));
	const intProcWindows = mergeIntervals([
		...toIntervals(auraWindows(selfEvents, BREATH_OF_HYDRA, t0, fightEnd)),
		...toIntervals(auraWindows(selfEvents, CHAYES, t0, fightEnd)),
		...toIntervals(auraWindows(selfEvents, TEMPUS_REPIT, t0, fightEnd)),
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
	const t16DebuffWindows =
		primaryID === undefined ? [] : dotWindowsOnTarget(events, T16_2PC_DEBUFF, t0, fightEnd, primaryID);
	const ascPresses = ascCasts.map((t) => ({
		t,
		fsRemainingMs: remainingIn(t, fsMerged) || null,
		opener: t <= 5000,
		twoPiece:
			remainingIn(
				t,
				t16DebuffWindows.map(([start, end]) => ({ start, end })),
			) >= 10_000,
	}));

	// ------------------------------------------------------------------ APL
	const auras: AplInputs['auras'] = {
		'flame-shock': fsMerged,
		ascendance: toIntervals(auraWindows(selfEvents, ASCENDANCE_AURA, t0, fightEnd)).map(([start, end]) => ({
			start,
			end,
		})),
		'lava-surge': toIntervals(auraWindows(selfEvents, LAVA_SURGE, t0, fightEnd)).map(([start, end]) => ({
			start,
			end,
		})),
		'searing-totem': stMerged,
		'fire-elemental': mergeIntervals(
			castTimes(FIRE_ELEMENTAL).map((t) => [t, t + FIRE_ELEMENTAL_DURATION_MS] as Interval),
		).map(([start, end]) => ({ start, end })),
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
	const fsDropMisses: Miss[] = [];
	for (let i = 1; i < fsMerged.length; i++) {
		const gap = fsMerged[i]!.start - fsMerged[i - 1]!.end;
		if (gap > GCD_MS) {
			fsDropMisses.push({
				kind: primaryName === null ? 'Flame Shock dropped' : `Flame Shock dropped (${primaryName})`,
				at: fsMerged[i - 1]!.end,
				detail: `${(gap / 1000).toFixed(1)}s without the dot`,
				link: link(fsMerged[i - 1]!.end),
			});
		}
	}
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
		lane(
			ASCENDANCE_AURA,
			'buff',
			toIntervals(auraWindows(selfEvents, ASCENDANCE_AURA, t0, fightEnd)).map(([s, e]) => ({ start: s, end: e })),
		),
		lane(
			ELEMENTAL_MASTERY,
			'buff',
			toIntervals(auraWindows(selfEvents, registry.aura('elemental-mastery'), t0, fightEnd)).map(([s, e]) => ({
				start: s,
				end: e,
			})),
		),
		lane(
			FIRE_ELEMENTAL_AURA,
			'buff',
			mergeIntervals(castTimes(FIRE_ELEMENTAL).map((t) => [t, t + FIRE_ELEMENTAL_DURATION_MS] as Interval)).map(
				([s, e]) => ({ start: s, end: e }),
			),
		),
		lane(SEARING_TOTEM_DOT, 'debuff', stMerged),
		lane(
			LAVA_SURGE,
			'proc',
			toIntervals(auraWindows(selfEvents, LAVA_SURGE, t0, fightEnd)).map(([s, e]) => ({ start: s, end: e })),
		),
		lane(
			T16_2PC_PROC,
			'proc',
			toIntervals(twoPieceWindows).map(([s, e]) => ({ start: s, end: e })),
		),
		lane(
			UNERRING_VISION,
			'proc',
			toIntervals(auraWindows(selfEvents, UNERRING_VISION, t0, fightEnd)).map(([s, e]) => ({ start: s, end: e })),
		),
		lane(
			BREATH_OF_HYDRA,
			'proc',
			toIntervals(auraWindows(selfEvents, BREATH_OF_HYDRA, t0, fightEnd)).map(([s, e]) => ({ start: s, end: e })),
		),
		lane(
			CHAYES,
			'proc',
			toIntervals(auraWindows(selfEvents, CHAYES, t0, fightEnd)).map(([s, e]) => ({ start: s, end: e })),
		),
		lane(
			WRATH_OF_DARKSPEAR,
			'proc',
			toIntervals(auraWindows(selfEvents, WRATH_OF_DARKSPEAR, t0, fightEnd)).map(([s, e]) => ({ start: s, end: e })),
		),
	];

	// -------------------------------------------------------------- assembly
	// The globals this audit found spent on a press that bought nothing: a Flame Shock refresh that
	// was neither the reader's keep-it-up window nor the sim's Ascendance prep, and every Searing
	// Totem pressed over a live one.
	const wastedGcds = fsPresses.filter((p) => p.remainingMs !== null && !p.windowed && !p.ascPrep).length + stRefreshes;

	return {
		flameShock: {
			windows: fsMerged,
			uptimeMs: fsUptimeMs,
			uptimePct: engagedMs > 0 ? (fsUptimeMs / engagedMs) * 100 : 0,
			applies,
			refreshes,
			windowed: fsPresses.filter((p) => p.windowed).length,
			ascPrep: fsPresses.filter((p) => p.ascPrep).length,
			presses: fsPresses,
		},
		earthShock: {
			presses: esPresses,
			good: esPresses.filter((p) => p.good).length,
			early: esPresses.filter((p) => p.lsStacks !== null && p.lsStacks < LIGHTNING_SHIELD_MAX_STACKS).length,
		},
		searingTotem: {
			windows: stMerged,
			uptimeMs: stUptimeMs,
			uptimePct: engagedMs > 0 ? (stUptimeMs / engagedMs) * 100 : 0,
			refreshes: stRefreshes,
			wastedMs: stWastedMs,
		},
		snapshots: {
			windows: snapshotWindows,
			refreshed: snapRefreshed,
			missed: snapMissed,
		},
		ascendance: { presses: ascPresses },
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
	// The Elemental ladder reads no resource bar — the rotation is purely cooldown- and proc-driven —
	// so there are no bars to sample and the report draws no resource section.
	resources: {},
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
