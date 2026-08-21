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
	SELF_EVENT_MS,
	levelAt,
	levelWindows,
	remainingAtCast,
	remainingIn,
	toIntervals,
	uptimePct,
} from '~/lib/analysis/auras';
import { atCapWindows } from '~/lib/analysis/counters';
import {
	dotSnapshotIn,
	dotTickBudgetIn,
	dotTickSnapshotsBySpawn,
	dotTicksBySpawn,
	inLastTick,
	inLastTickWindow,
	tickWindowAt,
} from '~/lib/analysis/ticks';
import { complementOf, intersect, mergeIntervals, overlapMs, unionMs, type Interval } from '~/lib/analysis/intervals';
import { damageByTarget } from '~/lib/analysis/damage';
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
import { abilityIdOf, instanceKey, isAuraEvent, isAuraRefresh, isCast } from '~/lib/events/guards';

import type { Handles } from '~/lib/analysis/analyseCore';
import { analyseCore, type SpecConfig } from '~/lib/analysis/analyseCore';
import type { Ability, Aura, Dot, GameData } from '~/lib/game/model';
import { SHARED_ABILITIES, SHARED_AURAS } from '~/lib/game/shared';
import { createRegistry } from '~/lib/game/registry';
import { CLASS_COLOR } from '~/lib/game/classes';
import { aplAudit, type AplInputs, ALL_BANDS } from '~/lib/spec/apl';
import type { AplAudit, Band } from '~/lib/spec/apl';
import { LADDER } from './apl';
import { ascendanceSync } from './ascendance';
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
 * How many Flame Shock rows the timeline draws before the rest go to the picker.
 *
 * The Windwalker's `RSK_TARGET_LANES` and the same number, because it is the same judgement about the
 * same chart: past half a dozen rows of one aura the enemies' block stops being read and starts being
 * scrolled. The cap decides what is drawn *by default* and nothing else — the enemies past it are
 * carried in `timeline.hiddenLanes` and counted in `timeline.hiddenTargets`, so the chart can offer
 * them and can say how many it is not showing. A cap that dropped them would be the chart quietly
 * disagreeing with the pull.
 *
 * Not a per-spec setting: it is a property of how tall a chart reads, not of how a pull is scored, and
 * `lib/settings` is for the thresholds the analysis is *measured* with.
 */
const FS_TARGET_LANES = 6;

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
/**
 * How little of the two-piece debuff has to be left before the list wants the shock inside its window.
 *
 * `auraRemainingTime(CurrentTarget, 144999) <= 4s`, the third clause of the second branch of
 * `Earth Shock Rules`. The debuff is Elemental Discharge (`sim/shaman/items_mop.go:107`) and 144999 is
 * the id the game actually writes — 144998, which the same rule tests for *presence*, is the sim's
 * `ExposeToAPL` handle for the same proc and never appears in a log. Both clauses are read off the one
 * set of windows this audit can see, which is the 144999 debuff on the primary target.
 */
const ES_TWO_PIECE_TAIL_MS = 4000;
/**
 * How much stronger a new Flame Shock application has to be for refreshing early to be the right press.
 *
 * The sim's own number, not a tolerance chosen here: `Flame Shock Rules` in
 * `ui/shaman/elemental/apls/p5.apl.json` gates the early refresh on `dotPercentIncrease(8050) > 10%`,
 * and the literal `"10%"` appears twice in that variable with no 15% anywhere for this spell. Worth
 * naming because the rule was reported to this project as 15%, and the report's own copy already said
 * ten (`flameShockSnapshots.measurable`).
 */
const FS_SNAPSHOT_GAIN = 0.1;
const ES_FS_MIN_MS = 6000;
const ES_ASC_HOLD_SEC = 6;

/**
 * The opener: how far into the pull a press may land and still be judged as one of its first globals.
 *
 * The sim's own horizon — `priorityList[14]`'s second condition is literally `currentTime <= 5s`, and
 * entries 9 and 14 both gate on it. Two rules in this audit read it: `AscendancePress.opener` and the
 * Elemental Mastery `reason`'s `'opener'` branch, which short-circuits four other branches. Both are
 * **anchored on the pull**, which is what makes them one question and lets them share one predicate.
 *
 * Deliberately not `ASCENDANCE_INTO_HASTE_MS`, which is also 5 000 and also called "the opener" in its
 * own docstring. That one is anchored on the *haste cooldown opening* and does three further jobs
 * (`ascendance.ts`: the good/bad lateness grade, whether a haste cooldown counts as "on the pull", and
 * the right edge of the `nothing-to-hit` exemption). The two numbers agree today and their readers do
 * not, so widening one must not widen the other.
 */
const OPENER_MS = 5000;

/**
 * What the opener comparison forgives: **timestamp jitter and the reaction between them**, and nothing
 * that could be called a global of play.
 *
 * `phased` opens with an Ascendance at **5 006ms** and was told it was not the opener by six
 * milliseconds. A player who pressed four buttons and then this one has made the opener; a log whose
 * stamps are rounded to the millisecond and whose events are ordered by a server has no business
 * deciding that on the sixth.
 *
 * **250ms, and chosen over flooring.** `Math.floor(t / 1000) * 1000 <= OPENER_MS` was the other
 * candidate and it admits anything up to 5 999ms — a full second of tolerance arriving as a side effect
 * of the arithmetic rather than as a stated intent, and a second is most of a lusted global (the
 * Elemental `GCD_MS` is 1 500ms and the haste cooldown is ×1.3 cast speed, so around 1 150ms). A press
 * a whole global late is late and the report should say so. 250ms cannot hide one.
 *
 * The magnitude has precedent in this codebase: `SELF_EVENT_MS` in `lib/analysis/auras.ts` is also 250,
 * for the ordering slop between a cast and the aura event it produces. Cited for the size and
 * deliberately **not** reused — that constant is about one press against its own aura and this one is
 * about a press against the bell, so tightening either must not move the other.
 */
const OPENER_GRACE_MS = 250;

/**
 * Whether a press at `t` counts as part of the opener — the single predicate both pull-anchored readers
 * call.
 *
 * One function rather than two `t <= 5000` literals, which is what the sites were. `docs/conventions.md`
 * is explicit about the cost of the second copy, and `ASCENDANCE_INTO_HASTE_MS`' docstring names these
 * two literals by hand precisely because it could not stop them drifting.
 */
export const isOpener = (t: number): boolean => t <= OPENER_MS + OPENER_GRACE_MS;

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
		key: 'chain-lightning',
		name: 'Chain Lightning',
		castIds: [421],
		damageIds: [421],
		onGcd: true,
		// The multi-target filler, and the reason this entry exists: without it the shared core skips
		// every press — the GCD walk asks `abilityByCastId` and `continue`s on `undefined` — so 70
		// casts on the `cleave` fixture were priced at zero occupied time and 15.7% of its damage was
		// reported as though no cast had produced it. The 2s cast is `NewChainSpellConfig`'s
		// `BaseCastTime` in `sim/shaman/chain_lightning.go`.
		//
		// `conditional`, deliberately not `cooldown`: the sim does give it a 3s timer, but what
		// decides the press is how many enemies are up, so a drift verdict would invent a fault out of
		// a single-target stretch where holding it was right.
		castTimeMs: 2000,
		gate: 'conditional',
	},
	{
		key: 'lava-beam',
		name: 'Lava Beam',
		castIds: [114074],
		damageIds: [114074],
		onGcd: true,
		// Chain Lightning's replacement while Ascendance is up: `sim/shaman/elemental/lava_beam.go`
		// gates it on `ele.AscendanceAura.IsActive()` and takes the same 2s base cast. Gated on that
		// window rather than on a clock of its own, so `conditional` for the same reason.
		//
		// Only 114074 is the press. The log carries Lava Beam damage under 114738 as well, and that is
		// the mastery overload rather than a second half of the cast — measured on `cleave`, its hits
		// land 42ms behind the beam's own and average 73% of them, exactly as 45297 sits behind Chain
		// Lightning — so it stays named among the overloads instead of being claimed here.
		castTimeMs: 2000,
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
		// Three ids for one totem, and only the cast was right. **120668 is what the shaman presses**;
		// **120687 is the damage** each lash deals, which is what a damage row has to match; and 120676 is
		// the buff the raid gets, declared as its own aura below. Measured on three anonymous 25H nights:
		// cast 200, aura 7,447, and the damage is ~2.0 bn. The committed Elemental fixtures carry
		// `abilityGameID: 120687` themselves, so the damage row was matching an id the data never writes.
		castIds: [120668],
		damageIds: [120687],
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
		/**
		 * **Two ids, and the second one is the whole of the buff on most logs.**
		 *
		 * One press emits four events, measured on `XVtHDFb7njPr2KA1` fight 10 at 298.221s where this
		 * shaman summoned it inside the pull:
		 *
		 * ```
		 * applybuff 118291  player -> player     the buff that says the elemental is out
		 * summon    118291  player -> the pet    Primal Fire Elemental, the Primal Elementalist body
		 * cast      2894    player               the press
		 * summon    2894    player -> the totem  Fire Elemental Totem, the totem object
		 * ```
		 *
		 * So 2894 is the *cast* and 118291 is the *aura*, and declaring only 2894 here meant the aura
		 * had no id that any log ever applies. Nothing noticed while every window came off the cast
		 * list — but a summon made before the bell logs none of those four events, and its only trace
		 * inside the fight window is a bare `removebuff 118291` where it expired. That is exactly the
		 * shape `auraWindows`' `openAtPull` recovers, and with 118291 absent from this list it had
		 * nothing to recover: a pre-pulled elemental read as never summoned at all.
		 *
		 * Not inferred — every Elemental log this project holds carries it, one bare `removebuff 118291`
		 * on the audited player and no apply of it anywhere: `phased` at 57.259s, `unbroken` at 58.014s,
		 * `cleave` at 58.298s, and the reported pull at 57.204s. All four inside the minute below, which
		 * is what makes each of them a summon that predates the bell.
		 */
		ids: [2894, 118291],
		kind: 'buff',
		durationMs: FIRE_ELEMENTAL_DURATION_MS,
		appliedBy: 'fire-elemental',
	},
	{
		key: 'stormlash-totem',
		name: 'Stormlash Totem',
		// The aura the raid gets is **120676**, not the press. Confirmed on all four committed raw fixtures
		// (8/4/8 Elemental, 4 Windwalker) and on 7,447 applications across three raid nights, while 120668
		// never appears as a buff at all. Note it lands on a monk too, so this is arguably a shared raid
		// buff rather than an Elemental-only one — worth moving to `game/shared.ts` when someone is there.
		ids: [120676],
		kind: 'buff',
		durationMs: STORMLASH_DURATION_MS,
		appliedBy: 'stormlash-totem',
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
const T16_2PC_DEBUFF = registry.aura('t16-2pc-debuff');
const UNERRING_VISION = registry.aura('unerring-vision');
const WUSHOOLAYS_STACKS = registry.aura('wushoolays-lightning-stacks');
const BREATH_OF_HYDRA = registry.aura('breath-of-hydra');
const CHAYES = registry.aura('chayes');
const WRATH_OF_DARKSPEAR = registry.aura('wrath-of-darkspear');
const WRATH_OF_DARKSPEAR_STACKS = registry.aura('wrath-of-darkspear-stacks');
const TEMPUS_REPIT = registry.aura('tempus-repit');
// The gear effects that actually fired on every committed pull and had no row until now. Each one is a
// buff a reader can see in their own log and could not find in this report — see the lane list below.
const JADE_SPIRIT = registry.aura('jade-spirit');
const LIGHTWEAVE = registry.aura('lightweave');
const TOXIC_POWER = registry.aura('toxic-power');
const EXPANDED_MIND = registry.aura('expanded-mind');
const SYNAPSE_SPRINGS = registry.aura('synapse-springs');
const JADE_SERPENT_POTION = registry.aura('jade-serpent-potion');
// The three the reader pressed or was given that had no row of their own. Bloodlust and Berserking were
// shaded as the full-height haste wash and nothing else; Blood Fury is spell power, so it was not even
// in that.
const BLOODLUST = registry.aura('bloodlust');
const BERSERKING = registry.aura('berserking');
const BLOOD_FURY = registry.aura('blood-fury');

/**
 * Names for the ids the model deliberately does not carry, and a list that is **not** all one thing.
 *
 * Most of it is what it looks like: the melee swing, the mastery overloads, the shield's own
 * discharge, the procs, the racials and the pets' spells. None of those is a button, which is what
 * makes their damage `passive` — nothing here is an `Ability`, and that is the whole mechanism.
 *
 * The rest is a knowing omission and used to be described as though it were the same thing. This
 * comment claimed everything below was "off-GCD utility"; the logs say otherwise. Lightning Shield
 * (324), Ghost Wolf (2645), Bloodlust (2825), Healing Stream Totem (5394), Healing Surge (8004),
 * Thunderstorm (51490), Earthgrab Totem (51485), Chain Heal (1064), Healing Rain (73920), Healing
 * Tide Totem (108280) and Totemic Projection (108287) all occupy a global in game. **They are
 * off-*rotation* globals, not off-GCD ones, and this report knowingly leaves them unpriced.** Only
 * Shamanistic Rage (30823) is genuinely off the global.
 *
 * **The decision stands and its argument has changed under it, so here is the argument as it is now.**
 *
 * It used to be a headroom argument, and a good one at the time: pricing all eleven took
 * `gcdUtilisationPct` from 84.21% to 97.93% on `phased`, 91.26% to 93.40% on `unbroken` and 90.81% to
 * 94.12% on `cleave`, and the figure divided a numerator rebuilt from cast events by WarcraftLogs' own
 * `activeTime` — two clocks with no structural bound between them — so 97.93% spent nearly all the
 * headroom that had been hiding the absence of one, and a pull that healed slightly harder would print
 * over 100%.
 *
 * That argument is retired, because both halves of the figure moved (`fe3d7ad`, plan §2 — not this
 * lane's change). The denominator is the player's own contact clock and the numerator is a union of
 * occupied spans clipped to it, so the ratio is bounded by construction rather than by luck and cannot
 * exceed 100 however much is priced into it. The baselines are now **94.08% on `phased`, 90.80% on
 * `unbroken` and 86.89% on `cleave`** — measured, and none of the three is the number quoted above.
 *
 * **The six deltas above are therefore history and not evidence.** Every one was measured against the
 * old arithmetic; what pricing these eleven would do to the figure now has not been measured, and it
 * should be re-derived rather than reasoned about from these numbers if the question is reopened.
 *
 * What survives is the reason that was never about headroom: these are off-**rotation** globals. Pricing
 * them makes the figure answer "was this player busy" when what the section asks is "of the globals the
 * rotation wanted, how many did you fill" — and a Chain Heal cast through a transition is a global the
 * rotation did not want. The clock question that used to be deferred here (plan step 44) is answered;
 * this one is a judgement about what the metric means, and it keeps them named and unpriced.
 *
 * Unpriced is no longer silent, which is the other half of the decision: `unmodelledPresses` counts
 * every press landing here, `pulls.test.ts` pins the count on all three fixtures, and
 * `fixtureCoverage.test.ts` fails if a cast id shows up in a fixture that is neither modelled nor
 * named below. That is what was missing when Chain Lightning went unmodelled for 53 tests.
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
	// The id the log actually books Lava Beam's overload under — 114991 is the sim's. Named here
	// because the spell map calls it plain "Lava Beam", which put a second row of that name in the
	// damage table with no cast behind it and no way for a reader to tell which was which.
	114738: 'Elemental Overload (Lava Beam)',
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
	// Immolate, and not melee — the §48 leftover, corrected against the client's own `SpellName` row
	// (118297 = "Immolate") and `sim/shaman/fire_elemental_spells.go:72`, `registerImmolate`. It logs as
	// a cast dot (begincast/cast/applydebuff/tick); the pet's actual melee books under `-4`, which never
	// reaches this map.
	118297: 'Fire Elemental: Immolate',
	118350: 'Fire Elemental: Fire Nova',
	118345: 'Earth Elemental: melee',
	114206: 'Skull Banner',
	// The off-rotation presses, declared rather than left to the spell map to name. Every one of them
	// except Shamanistic Rage takes a global — see the note above for why they are named and not
	// priced. Listing them is what lets `fixtureCoverage.test.ts` tell "known and unpriced" apart from
	// "forgotten", which is the distinction that was missing when Chain Lightning was neither.
	1064: 'Chain Heal',
	2645: 'Ghost Wolf',
	2825: 'Bloodlust',
	5394: 'Healing Stream Totem',
	8004: 'Healing Surge',
	51485: 'Earthgrab Totem',
	73920: 'Healing Rain',
	108280: 'Healing Tide Totem',
	108287: 'Totemic Projection',
	// The one press here that really is off the global.
	30823: 'Shamanistic Rage',
};

// ------------------------------------------------------------------ settings

export const ELEMENTAL_SETTINGS: SettingSchema[] = [
	// `flameShockRefreshMs` used to be the first entry here, and it is gone rather than re-defaulted:
	// the dot's own tick cadence is what grades a refresh now, and it is measured rather than chosen.
	// See `FLAME_SHOCK_DOT` above and `lib/settings/model.ts`, which carries the retirement note.
	{
		key: 'cooldownLeewayMs',
		// `settings.ele.cooldown`, not the bare `settings.cooldown` this pointed at: the hint names the
		// buttons the leeway applies to, and a shared key cannot name two specs' buttons. The Windwalker
		// moved to `settings.ww.cooldown` in the same pass, which is what made this one the odd one out.
		tKey: 'settings.ele.cooldown',
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
	/**
	 * Each **enemy id's** own windows — that id's spawns unioned — which is what a drawn row means.
	 *
	 * The third reading, and it is neither of the two above rather than a convenience over them. A row
	 * labelled "Automated Shredder" is a claim about that enemy, so it wants the spawns of *one* id
	 * merged and no others; `merged` has already thrown the ids away, and `byInstance` would give the
	 * same add two indistinguishable rows. The Windwalker draws from exactly this reading and calls it
	 * `rskByTarget`.
	 *
	 * Built in the walk rather than by splitting `instanceKey` back apart at the call site: the loop has
	 * `targetID` in hand, and a caller that parsed `"470:-"` would be coupled to that helper's string
	 * format from another module.
	 *
	 * **Nothing graded reads it.** It exists for the timeline's per-enemy rows.
	 */
	byTarget: ReadonlyMap<number, Interval[]>;
	/** The union across every spawn of the enemy id. */
	merged: Interval[];
	/**
	 * True when any spawn's first window was **inferred** rather than logged — `openAtPull` only.
	 *
	 * A flag rather than a `preexisting` on `merged`, because `merged` is `Interval[]` and its callers
	 * want it that way. Carried out of the walk instead of re-derived by the caller from "the first
	 * window starts at zero": that test would be two readings of one fact, and the whole point of this
	 * return is that a drawn lane and a graded union can differ. Always false without `openAtPull`, which
	 * is every graded reader in this file.
	 */
	inferredAtPull: boolean;
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
 * an application. **`openAtPull` is the one caller that needs them back** — see there.
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
	options: { openAtPull?: boolean } = {},
): DotWindows {
	if (targetID === undefined) return { byInstance: new Map(), byTarget: new Map(), merged: [], inferredAtPull: false };
	return dotWindowsBySpawn(events, aura, t0, fightEnd, sourceID, targetID, options);
}

/**
 * The same walk with the target filter optional — every spawn the dot ever landed on, keyed the same
 * way.
 *
 * Called with a `targetID` by `dotWindowsOnTarget` above and without one by the graded uptime
 * numerator, which asks "did the enemy the player was hitting have the dot" and so cannot be scoped
 * to one enemy in advance. Split out rather than copied: the source filter below and the
 * bucket-per-spawn rule are the two things this file has already paid for getting wrong, and
 * `docs/conventions.md` is explicit that the second copy is where the comment gets dropped and the bug
 * comes back.
 *
 * No enemy filter, and none is needed. The only reader of the unscoped map indexes it by the spawns in
 * `landedHits`, which the core has already cleared of friendlies and of units nothing could damage — so
 * a spawn this walk knows about and that list does not is simply never asked for.
 *
 * **`openAtPull` — for a drawn lane and never for a graded figure.** Plan §6 wants every aura lane to
 * show the whole window it can prove, and a dot pressed before the bell that expires in-fight leaves
 * nothing behind but its own `removedebuff`: no apply, so the default walk draws nothing at all for the
 * stretch it held. `auraWindows`' `openAtPull` recovers that as `[0, removal]`.
 *
 * Two things it changes here, and the second is the reason this is an option rather than the default.
 *
 *   - **The cast filter is relaxed.** `auraWindows` refuses the inference for an id whose opening this
 *     stream witnessed, and a `cast` counts — which is exactly the guard a dot needs, because Flame
 *     Shock's press and debuff are both 8050 and a press inside the fight is proof the dot went up
 *     inside it. `isAuraEvent` filtered that press out before the walk could read it, so the guard was
 *     blind by construction. Casts are admitted back for this walk only, and admitting them is safe for
 *     the same reason the filter was cautious: `auraWindows` treats a cast as evidence of an opening and
 *     never as an opening, so no cast can start a window.
 *   - **`inferredAtPull` comes back set** when any spawn's window was recovered that way, which is what
 *     lets the lane mark the bar as the inference it is.
 *
 * Off by default because **the graded readings must not move.** `flameShock.uptimePct` is measured from
 * this walk, and `[0, removal]` is a claim about the pull rather than about a press: a player who dotted
 * before the bell did nothing wrong, but neither did the log record them doing anything, and a graded
 * figure that credited the stretch would be scoring `combatantinfo`-grade evidence. So the drawn bar and
 * the graded union are allowed to differ, and every graded caller in this file leaves this off.
 */
function dotWindowsBySpawn(
	events: readonly WclEvent[],
	aura: Aura,
	t0: number,
	fightEnd: number,
	sourceID: number,
	targetID?: number,
	{ openAtPull = false }: { openAtPull?: boolean } = {},
): DotWindows {
	const ids = new Set(aura.ids);
	// The spawn's events and the enemy id they landed on. The id is kept beside the bucket rather than
	// read back out of the key, so `byTarget` below can group without anybody parsing `instanceKey`.
	const buckets = new Map<string, { target: number; events: WclEvent[] }>();
	for (const e of events) {
		if (targetID !== undefined && e.targetID !== targetID) continue;
		if (e.targetID === undefined) continue;
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
		if (id === null || !ids.has(id) || !(isAuraEvent(e) || (openAtPull && isCast(e)))) continue;
		const key = instanceKey(e.targetID, e.targetInstance);
		const bucket = buckets.get(key);
		if (bucket) bucket.events.push(e);
		else buckets.set(key, { target: e.targetID, events: [e] });
	}
	// Walked per spawn, kept per spawn, and merged across them: two copies of an add carrying the dot
	// at once is the enemy covered, not twice covered, and `mergeIntervals` is what says so.
	const byInstance = new Map<string, readonly Window[]>();
	const perTarget = new Map<number, Interval[]>();
	const all: Interval[] = [];
	let inferredAtPull = false;
	for (const [key, bucket] of buckets) {
		const walked = auraWindows(bucket.events, aura, t0, fightEnd, { openOnRefresh: true, openAtPull });
		if (walked.some((w) => w.preexisting === true)) inferredAtPull = true;
		const spans = mergeIntervals(toIntervals(walked));
		byInstance.set(
			key,
			spans.map(([start, end]) => ({ start, end })),
		);
		const gathered = perTarget.get(bucket.target);
		if (gathered) gathered.push(...spans);
		else perTarget.set(bucket.target, [...spans]);
		all.push(...spans);
	}
	// Merged per id for the same reason `merged` is merged across all of them: two copies of an add
	// carrying the dot at once is the enemy covered, not twice covered.
	const byTarget = new Map<number, Interval[]>();
	for (const [id, spans] of perTarget) byTarget.set(id, mergeIntervals(spans));
	return { byInstance, byTarget, merged: mergeIntervals(all), inferredAtPull };
}

/**
 * Merged spans as lane windows, with the span that opens at the bell marked `preexisting`.
 *
 * The one bookkeeping step every inferred lane in this file needs, and it is here rather than copied at
 * two call sites because both of them lose the flag the same way: a walk answers in `AuraWindow`s, the
 * spans get merged to settle overlaps, and `Interval` has nowhere to keep "this one was inferred". So
 * the fact travels beside the spans and is put back once.
 *
 * **Two conditions and neither implies the other.** `inferredAtPull` is the walk's own answer — it
 * recovered a window from a bare removal, or the totem-slot walk seeded the slot from one. `start === 0`
 * is the drawn span reaching the bell, which is what makes *this* span the one the inference is about;
 * the later spans of the same lane are ordinary. A window that opens at zero on a pull where nothing was
 * inferred is a logged application stamped at the pull, and it is left alone.
 */
function pullSpansAsWindows(spans: readonly Interval[], inferredAtPull: boolean): Window[] {
	return spans.map(([start, end]) =>
		inferredAtPull && start === 0 ? { start, end, preexisting: true } : { start, end },
	);
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
		castBeginTimes,
		primaryID,
		primaryName,
		marks,
		aplTargetCountAt,
		lostCasts,
		landedHits,
		spawnLives,
		multiTargetWindows,
		multiTargetMs,
		contact,
		inContactMs,
		hasteWindows,
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
	/**
	 * The same aura's windows for a **drawn lane**, with the pre-pull window inferred.
	 *
	 * Plan §6: a lane should show the whole window it can prove, and a lane that never asks for the
	 * inference starts its bar at the first in-fight event — so an aura already running at the bell reads
	 * as applied late, or as never applied at all. `auraWindows`' `openAtPull` recovers it from the bare
	 * removal it left behind and marks the window `preexisting`.
	 *
	 * **A second walk rather than switching the memo, and this is the whole of why.** Every aura here has
	 * two kinds of reader. `ascendance` is drawn *and* read by the Elemental Mastery `t15` branch and by
	 * the APL; `lava-surge` is drawn *and* is what `lavaSurgeProcs` grades; the four item procs are drawn
	 * *and* are the snapshot section's trigger and int-proc windows. An inferred bar is evidence about the
	 * pull and it is not evidence about a press, so the graders keep the plain walk and only the picture
	 * gains the inference. That is the standing rule on this inference — a lane that grades from its
	 * windows must not read an inferred bar as proof of anything the player did.
	 *
	 * `presses` is the hand-guard for an aura whose **cast id differs from its buff id**. `auraWindows`
	 * counts a `cast` of the aura's own id as proof the opening was logged inside the fight, and that test
	 * is per id — so where the two split, a stream that carried the press but lost the `applybuff` beside
	 * it (they share a millisecond, and pages are cut on timestamps) would have an ordinary in-fight
	 * window recovered as a pre-pull one. Ascendance is that case: 114049 for the press against 114050 for
	 * the buff. The guard is the one the Fire totem slot walk already uses below, for the same reason and
	 * in the same shape — a press at or before the recovered expiry can only be the press that opened it.
	 * Auras whose ids agree (Elemental Mastery, 16166 for both) need no list, and a proc with no press at
	 * all cannot have one.
	 *
	 * **`pullAuras` — rung 3 — is deliberately not used here.** It is sound only for an aura that could
	 * plausibly have lasted the pull, and every lane in this file is a timed cooldown, a proc or a dot:
	 * handing it `combatantinfo` presence would shade a whole fight as Ascended off a buff that lasts
	 * fifteen seconds. The Elemental's one permanent aura, Lightning Shield, is not drawn as a lane — it
	 * is read as a stack counter — so nothing here wants that rung.
	 */
	const laneWindowCache = new Map<string, readonly AuraWindow[]>();
	const laneWindows = (aura: Aura, presses: readonly number[] = []): readonly AuraWindow[] => {
		const cached = laneWindowCache.get(aura.key);
		if (cached !== undefined) return cached;
		const walked = auraWindows(selfEvents, aura, t0, fightEnd, { openAtPull: true }).filter(
			(w) => w.preexisting !== true || !presses.some((t) => t <= w.end),
		);
		laneWindowCache.set(aura.key, walked);
		return walked;
	};
	/**
	 * The same thing for a **dot**, which does not come off the player's own stream.
	 *
	 * `laneWindows` above walks `selfEvents`; Flame Shock and the two-piece debuff sit on an enemy and come
	 * out of `dotWindowsOnTarget`, bucketed per spawn. So this is the sibling of that closure rather than a
	 * second copy of it: the same rule — the picture infers, the graders do not — over the other walk.
	 *
	 * **The graded arrays are not rebuilt from this.** `fsMerged` and `twoPieceWindows` keep their own
	 * calls, deliberately: `flameShock.uptimePct`, the drop ledger, the snapshot check, the APL's `present`
	 * and Earth Shock's `twoPiece` condition all read those, and every one of them is a claim about a press.
	 * The union here is a superset of the graded one — the same walk plus a leading `[0, removal]` where the
	 * log left one — which is exactly the licence §6 asks for: the drawn bar may show more than the graded
	 * union, so long as it says which part of it was inferred.
	 *
	 * `preexisting` lands on the first merged window and only on that one. An inferred window always opens
	 * at zero, so it is always inside the first of the merged spans; the flag comes off the walk's own
	 * answer (`inferredAtPull`) rather than from testing whether that span starts at zero, which would be
	 * one fact read twice.
	 *
	 * Rung 3 does not apply and cannot: `combatantinfo` lists the auras on the **player** at the bell, and
	 * a dot on an enemy is not one of them. Both of these are rung 2 or nothing.
	 */
	const dotLaneWindows = (aura: Aura): Window[] => {
		const dot = dotWindowsOnTarget(events, aura, t0, fightEnd, primaryID, actor.id, { openAtPull: true });
		return pullSpansAsWindows(dot.merged, dot.inferredAtPull);
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
	 * The graded numerator: the dot on whichever spawn the player was in contact with, clipped to the
	 * contact clock — and the reason the tile once read **100.21%**.
	 *
	 * **Two mistakes are guarded here, and they are not the same mistake.**
	 *
	 * The first is a numerator and a denominator measured over different spans. `fsMerged` runs over the
	 * whole pull: the dot goes up when it goes up and its window closes at the `removedebuff` the boss's
	 * death emits, or at the last event of the fight. Either clock is a shorter span — built from landed
	 * non-tick hits, so it cannot begin before the first of them or run past the last. Measured, on the
	 * pull that produced the figure: the last landed hit is at 364.238s, the dot's removal is stamped at
	 * 365.014s, and the dot went up 1ms after the first hit. The numerator carried 365 009ms against a
	 * 364 234ms denominator — 775ms of dot ticking on a boss that had already taken its last hit — and
	 * 365 009 / 364 234 is 100.2128%. Nothing was double-counted and no merge was wrong; the two spans
	 * simply disagreed about when the pull was. So the numerator is intersected with the denominator's
	 * own windows, which is what `multiDotUptimeMs` and `stUptimeMs` below already do.
	 *
	 * The second is subtler and is what this block now exists for: **whose clock.** This figure used to
	 * divide the dot on the primary target by `engagedMs`, the *boss's* clock — the stretches the primary
	 * was there to be hit. The chart under the tile
	 * (`specs/elemental/components/charts/FlameShockUptime.tsx`) shades from `contact`, the *player's*
	 * clock, so the picture and the percentage were fractions of two different fights. Contact is the
	 * honest denominator for a metric about a button the player presses: it forgives the stretches they
	 * had nothing in reach, and it does not forgive the stretches they were in the fight and off the
	 * rotation. On `phased` the two are 206 557ms of contact against 239 246ms of engaged, and the 32.7s
	 * between them is not an untargetable boss — `engaged` is proof damage was landing on the primary
	 * throughout, from the pets and from unmodelled procs, both of which `contact` filters out. What
	 * contact forgives there is the player's own absence from the rotation.
	 *
	 * **And the numerator had to move with it, or the fix above comes straight back.** Clipped to
	 * `engaged` the numerator is 212 026ms on `phased`, which is *more* than contact's 206 557ms: divide
	 * one by the other and `uptimePct` clamps to 100 and warns. So the numerator is rebuilt on the same
	 * terms the denominator is — the dot on the enemy the player was demonstrably hitting, each landed
	 * hit owning the time until the next, intersected with `contact`. This is the Windwalker's own
	 * reading of its Rising Sun Kick debuff (`specs/windwalker/lib/index.ts`, `contactUpSegments` over
	 * `inContactMs`), built here off the same two pieces: a per-spawn dot map, and the hit list `spawnAt`
	 * already reads.
	 *
	 * **Over every spawn, not `fsDot.byInstance`, and the difference is 47 seconds.** `fsDot` is scoped to
	 * the primary target, so a map built from it credits nothing at all for the stretches the player was
	 * hitting an add — while `contact` counts every one of those stretches in the denominator. That is
	 * the same mismatch one step in: a numerator scoped to the primary's own spawns divided by the time
	 * the player was on *anything*. Measured on `cleave`, which spends 148.9s of its 263.2s multi-target:
	 * the primary-scoped numerator reads 187 930ms and the honest one 189 111ms, so the two agree there
	 * only because that player barely dotted the adds (`multiDotUptimePct` is 16.6%). On a pull where the
	 * cleave rule *was* followed the primary-scoped reading would charge every dotted add as downtime —
	 * a fault invented out of doing what the priority list asked. So the walk asks
	 * `dotWindowsBySpawn` for every spawn.
	 *
	 * Keyed by spawn and not by enemy id, for the reason that function gives at length: one `targetID`
	 * covers every copy of an add, and that id's *union* would credit a dot sitting on a copy the player
	 * killed two minutes ago.
	 *
	 * This is not the multi-dot metric in disguise. `multiDotUptimePct` asks whether a *second* dot went
	 * out on the secondary target across the stretches two enemies were up — a question about a press the
	 * player chose to make. This asks whether the enemy in front of them was dotted at all.
	 *
	 * `windows` and `uptimeMs` are deliberately left whole. They are what the timeline lane draws and
	 * what the drop ledger reads, and both are claims about the pull rather than about the share —
	 * clipping them would put a seam in the drawn dot where the boss merely stopped being hit.
	 */
	// One walk, two readings taken off it. `byInstance` is the graded numerator's, below; `byTarget` is
	// the timeline's per-enemy rows, down in the timeline section — the same split `fsDot` above makes,
	// one scope wider.
	const fsAnywhere = dotWindowsBySpawn(events, FS_DEBUFF, t0, fightEnd, actor.id);
	const fsDotAnywhere = fsAnywhere.byInstance;
	const fsContactDotBySpawn = new Map<string, Interval[]>();
	const fsDotOn = (key: string): Interval[] => {
		const known = fsContactDotBySpawn.get(key);
		if (known !== undefined) return known;
		// Merged and clipped once per spawn rather than once per hit: a boss carried through a whole pull
		// is thousands of hits against the same handful of windows.
		const windows = mergeIntervals(intersect(toIntervals(fsDotAnywhere.get(key) ?? []), contact));
		fsContactDotBySpawn.set(key, windows);
		return windows;
	};
	const fsCoveredParts: Interval[] = [];
	for (let i = 0; i < landedHits.length; i++) {
		const hit = landedHits[i];
		if (hit === undefined) continue;
		// Each hit owns the time until the next one — that is how long the player was demonstrably on
		// that enemy — and the last one owns the rest of the pull, which the intersection with contact
		// has already clipped back to nothing past the final window.
		const until = landedHits[i + 1]?.t ?? duration;
		for (const [start, end] of fsDotOn(hit.key)) {
			if (start >= until) break;
			if (end > hit.t) fsCoveredParts.push([Math.max(start, hit.t), Math.min(end, until)]);
		}
	}
	/** One quantity, three shapes: the merge is the walk's answer, the array is what a chart could draw. */
	const fsContactMerged = mergeIntervals(fsCoveredParts);
	const fsContactWindows: Window[] = fsContactMerged.map(([start, end]) => ({ start, end }));
	/**
	 * The third shape, and the one `flameShock.uptimePct` is a share of — published as
	 * `contactUptimeMs`.
	 *
	 * Off the same merge rather than a second union of the same parts, for the reason the pair above
	 * exists: two readings of one quantity are two answers, and the one a reader sees would be
	 * whichever the tile happened to call.
	 */
	const fsContactMs = unionMs(fsContactMerged);
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
	 * The same ticks with the snapshot each one carried, for the strength a press bought.
	 *
	 * Bucketed per spawn for a second reason on top of the cadence one above, and this one is measured:
	 * pooling `cleave`'s two spawns (470 and 478:1) puts the second add's ticks between the boss's and
	 * reads the boss's cadence as 756ms. Every verdict downstream of that number would be an invention.
	 */
	const fsTickSnapshots = dotTickSnapshotsBySpawn(events, FS_DEBUFF, t0, actor.id);

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
	// Declared here rather than beside `fsTickSnapshots`, which is where it belongs by subject: it closes
	// over `fsAimedAt` and runs immediately, so above that line it is a TDZ `ReferenceError` at runtime
	// that `tsc` cannot see — the same trap `fsAway` below and `fightEnd` earlier in this file fell into.
	/**
	 * The press before and the press after each press, on the spawn it was aimed at.
	 *
	 * A snapshot reading needs the application's own ticks and nothing else, and two presses at one spawn
	 * are the only boundary that can isolate them — see `dotSnapshotIn`. Keyed by press time because
	 * `fsCasts` is already the list of them and is already sorted.
	 */
	const fsPressBounds = new Map<number, { previous: number; next: number }>();
	{
		const bySpawn = new Map<string, number[]>();
		for (const t of fsCasts) {
			const spawn = fsAimedAt.get(t) ?? spawnAt(t);
			if (spawn === null) continue;
			const bucket = bySpawn.get(spawn);
			if (bucket) bucket.push(t);
			else bySpawn.set(spawn, [t]);
		}
		for (const presses of bySpawn.values()) {
			presses.forEach((t, i) => {
				// `-Infinity` and `Infinity` rather than nulls: the first press of a spawn has every earlier tick
				// to compare against (there are none) and the last has every later one, which is what the open
				// ends mean. `dotSnapshotIn` returns null on an empty segment, so the opener needs no special arm.
				fsPressBounds.set(t, { previous: presses[i - 1] ?? -Infinity, next: presses[i + 1] ?? Infinity });
			});
		}
	}
	/**
	 * Every instant the log called this dot **refreshed** rather than applied, per spawn.
	 *
	 * The one fact about an application that its own ticks cannot carry, and it is worth a whole tick:
	 * a refresh onto a live dot keeps the pending tick and schedules a full count on top of it
	 * (`dot.Duration += nextTick; dot.remainingTicks++`, `sim/core/dot.go:122-146`). WarcraftLogs'
	 * `refreshdebuff` is exactly the sim's `dot.IsActive()` at the press, so the distinction is read
	 * off the log rather than inferred from the declared remaining time — which is the number this whole
	 * derivation exists to stop grading against.
	 *
	 * Sourced to this player and keyed by spawn for the same reasons the tick streams are.
	 */
	const fsRefreshedAt = new Map<string, number[]>();
	for (const e of events) {
		if (!isAuraRefresh(e) || e.sourceID !== actor.id || e.targetID === undefined) continue;
		const id = abilityIdOf(e);
		if (id === null || !FS_DEBUFF.ids.includes(id)) continue;
		const key = instanceKey(e.targetID, e.targetInstance);
		const bucket = fsRefreshedAt.get(key);
		if (bucket) bucket.push(e.timestamp - t0);
		else fsRefreshedAt.set(key, [e.timestamp - t0]);
	}
	/**
	 * Did the application a press at `start` opened begin as a refresh onto a live dot?
	 *
	 * `SELF_EVENT_MS` because the aura event a press produces is stamped a moment either side of the
	 * cast — the same slop `remainingAtCast` guards against, cited for the same reason. False for an
	 * application with no press before it (`-Infinity`): a dot that was up before the pull began has no
	 * observable start, and inventing a pending tick for it would be a guess.
	 */
	const beganAsRefresh = (spawn: string | null, start: number): boolean =>
		spawn !== null &&
		Number.isFinite(start) &&
		(fsRefreshedAt.get(spawn) ?? []).some((r) => Math.abs(r - start) <= SELF_EVENT_MS);

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
		 * The dot's tick cadence at this press, measured off its own ticks.
		 *
		 * This is what `flameShockRefreshMs` used to be, and the difference is not a tuning: one tick is
		 * the width of the thing the verdict is about. On the two committed pulls it measures 1 349ms,
		 * 1 748ms or 2 275ms depending on which haste cooldowns were up — never the 3 000ms the setting
		 * defaulted to, and never the same number twice in one fight. Falls back to the unhasted 3 000ms
		 * period when the log carries too few ticks to measure one.
		 *
		 * **Reported, and no longer what grades the press.** It is the number the chart's band and the
		 * tooltip quote, and `ticksLeft` below is the verdict — a comparison of two durations is only
		 * accurate to within the half-tick that bankers rounding drops off the declared duration, which
		 * is the same size as the tick being tested. See `dotTickBudgetIn`.
		 */
		const tickWindow = tickWindowAt(spawn === null ? [] : (fsTicks.get(spawn) ?? []), t, FLAME_SHOCK_DOT);
		/**
		 * The press either side of this one on the spawn it was aimed at — the boundaries of the
		 * application it replaced, which both the tick count and the snapshot strength below are read
		 * inside. Declared once so the two cannot end up measuring different applications.
		 */
		const bounds = fsPressBounds.get(t);
		/**
		 * The ticks the dot this press replaced still owed — the number the verdict is actually made on.
		 *
		 * Bounded by the press before this one on the same spawn, which is the boundary of the application
		 * being refreshed: only one application can tick on one spawn between two presses at it. See
		 * `dotTickBudgetIn` for why this is counted and not subtracted, with both fixture presses where a
		 * duration test gives the opposite answer.
		 *
		 * Null when the application landed fewer than three ticks before the press — nothing to measure a
		 * period from, so nothing to count against. That is the opener of a spawn (whose dot was down
		 * anyway) and a synthetic pull with no periodic damage in it; those fall back to the declared
		 * duration through `inLastTickWindow`, which is the older and looser reading of the same rule.
		 */
		const budget = bounds
			? dotTickBudgetIn(spawn === null ? [] : (fsTicks.get(spawn) ?? []), bounds.previous, t, FLAME_SHOCK_DOT, {
					refreshed: beganAsRefresh(spawn, bounds.previous),
				})
			: null;
		const windowed =
			remaining > 0 &&
			(budget !== null
				? inLastTick(budget, FLAME_SHOCK_DOT)
				: inLastTickWindow(remaining, tickWindow, FLAME_SHOCK_DOT));
		const ascPrep = remaining > 0 && remaining < FS_ASC_PREP_MS && ascReadyInSec <= 2;
		/**
		 * How much stronger the dot this press put up is than the one it replaced — the sim's own reason to
		 * refresh early, and the third excuse a refresh can have.
		 *
		 * `Flame Shock Rules` in `ui/shaman/elemental/apls/p5.apl.json` refreshes early when
		 * `dotPercentIncrease(8050) > 10%`. The literal `"10%"` appears twice in that variable and no 15%
		 * exists anywhere for Flame Shock, which matters because the threshold was reported to this project
		 * as 15 — `flameShockSnapshots.measurable` in the copy already said 10.
		 *
		 * Both halves of the ratio are read off the ticks of one application on one spawn, bounded by the
		 * presses either side of it, and both are damage per millisecond of dot rather than per tick. See
		 * `dotSnapshotIn` and `FlameShockPress.snapshotDeltaPct` for why each of those is load-bearing.
		 *
		 * Computed only for a refresh. On a press that put the dot back up there is no live application to
		 * compare against — the previous one had already expired — so a ratio against it would be a number
		 * about a dot that was not there.
		 */
		const spawnTicks = spawn === null ? [] : (fsTickSnapshots.get(spawn) ?? []);
		const before = bounds ? dotSnapshotIn(spawnTicks, bounds.previous, t, FLAME_SHOCK_DOT) : null;
		const after = bounds ? dotSnapshotIn(spawnTicks, t, bounds.next, FLAME_SHOCK_DOT) : null;
		const snapshotDeltaPct =
			remaining > 0 && before !== null && after !== null ? after.strength / before.strength - 1 : null;
		const snapshotGain = snapshotDeltaPct !== null && snapshotDeltaPct > FS_SNAPSHOT_GAIN;
		const exposed = remaining > 0 ? null : downBefore(spawn, t);
		// `snapshot` sits *after* `windowed` and `ascPrep`, not before them. A last-tick refresh is already
		// the best the global can buy and needs no second justification, and crediting one press under two
		// excuses would subtract it twice out of `flameShockWaste`.
		const kind: FlameShockPressKind =
			remaining > 0
				? windowed
					? 'windowed'
					: ascPrep
						? 'ascPrep'
						: snapshotGain
							? 'snapshot'
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
			ticksLeft: budget?.left ?? null,
			// The same verdict as a length, so the chart can draw the last tick per press instead of
			// shading one band at the end of a declared 30s axis that no application ever ran for.
			intoLastTickMs: budget === null ? null : t - budget.lastTickAt,
			windowed,
			ascPrep,
			snapshotDeltaPct,
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
	/**
	 * The commit instant, not the landing, and this one changes real numbers.
	 *
	 * A surge is spent the moment the player starts the cast — that is what consumes the buff and what
	 * makes the cast free. Lava Burst takes two seconds, so a player who reacts to a surge nine seconds
	 * into its ten-second window commits inside the window and *lands* a second after it closed. Read at
	 * the landing, every one of those presses fell outside `[start, end]`: the proc was reported wasted
	 * and the press reported as not benefiting, on a pull where the player did exactly the right thing.
	 * A systematic false positive against late-window reactions, and the later the reaction the more
	 * certain the accusation.
	 *
	 * The same argument covers Ascendance below. Ascendance removes Lava Burst's cooldown for fifteen
	 * seconds; a press committed at 14.5s benefits from it and lands at 16.5s outside it.
	 */
	const lavaBurstCasts = castBeginTimes(LAVA_BURST);
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
	/**
	 * The two-piece window: the debuff the proc leaves on the target, read where it actually lands.
	 *
	 * This used to be `selfWindows(T16_2PC_PROC)` — the set's own name, `Celestial Harmony`, wired to id
	 * 144998. That number is the simulator's `ExposeToAPL` handle and the game never writes it, so the
	 * windows were permanently empty and everything downstream of them was too: Earth Shock's rule ran on
	 * three of its four conditions because `twoPiece` could not fire, the ladder's priority gate always
	 * read false, and a timeline lane drew nothing. Both committed pulls demonstrably had the set — 144999
	 * appears twenty times on one and eighteen on the other.
	 *
	 * It is also a *debuff on the target*, not a buff on the player, so the scoping was wrong as well as
	 * the id: `selfWindows` would have found nothing even had the number been right.
	 */
	const t16DebuffWindows = dotWindowsOnTarget(events, T16_2PC_DEBUFF, t0, fightEnd, primaryID, actor.id).merged;
	const twoPieceWindows: Window[] = t16DebuffWindows.map(([start, end]) => ({ start, end }));
	/**
	 * Whether this player owns the T16 two-piece, which is what picks Earth Shock's branch.
	 *
	 * Read off the debuff rather than off the gear, and the gear is genuinely the better evidence when it
	 * is there: `GearSlot.setID` exists (`analysis/gear.ts:113`) and `phased` carries two pieces of set
	 * 1182. But it is **absent on two of the three committed pulls** — `combatantinfo` simply does not
	 * carry the field on those captures, which is the case that field's own comment warns about — so a
	 * gear read would answer "no set" for a player the log proves had one.
	 *
	 * Elemental Discharge can only exist if the two-piece is equipped: it is applied by the set bonus's
	 * own proc trigger on Fulmination (`sim/shaman/items_mop.go:126-140`). So one window of it is proof,
	 * and no window is the absence of proof rather than proof of absence — which is why this errs onto
	 * branch A, the stricter one, rather than crediting a set nothing evidenced.
	 */
	const twoPieceOwned = twoPieceWindows.length > 0;
	const esPresses = castTimes(EARTH_SHOCK).map((t) => {
		const stacks = levelAt(lsLevels, t);
		// The dot on the enemy this shock is being fired at, not on any spawn of its actor id — the
		// `fsLow` reason below is a statement about the target in front of the player.
		const fsRemaining = fsRemainingAt(t);
		const ascReadyInSec = ascendanceReadyInSec(ascCasts, t);
		const twoPiece = inWindow(t, twoPieceWindows);
		/**
		 * The sim's rule is an **or of two branches**, and which one applies is decided by the player's
		 * **gear**, not by anything happening in the pull.
		 *
		 * `Earth Shock Rules` in `ui/shaman/elemental/apls/p5.apl.json` is `OR(A, B)` where A opens with
		 * `NOT auraIsActive(144998)` and B with `auraIsActive(144998)`. **144998 is not a proc.** It is the
		 * T16 two-piece's *set bonus aura*, exposed to the rotation language by
		 * `AttachProcTrigger(…).ExposeToAPL(144998)` (`sim/shaman/items_mop.go:126-140`) — so it is active
		 * for exactly as long as the set is equipped. The two branches are therefore "this player owns the
		 * two-piece" and "this player does not", and only one of them is reachable on a given pull:
		 *
		 *   - **A, without the set.** Shield at the ceiling, dot at least 6s, Ascendance at least 6s away.
		 *   - **B, with the set.** Shield at the ceiling, Elemental Discharge with **4s or less left**, and
		 *     the dot outliving **two ticks**. Ascendance is not asked about at all and the flat 6s dot
		 *     floor is gone.
		 *
		 * **B's debuff clause is satisfied when the debuff is *down*, and that is not a loophole — it is
		 * what the sim computes.** `auraRemainingTime` on an inactive aura returns 0
		 * (`sim/core/apl_values_aura.go:108-111`, `TernaryDuration(aura.IsActive(), …, 0)`) and `0 <= 4s`.
		 * `remainingIn` returns 0 outside a window for the same reason, so the two agree without a special
		 * case. Read as behaviour rather than arithmetic: with the set, Fulmination's job is to keep
		 * Elemental Discharge up, so shock when it is missing or about to lapse and hold when it has time
		 * left.
		 *
		 * **This was implemented per press against the debuff, which is wrong in one direction only.** A
		 * set owner whose debuff happened to be down fell through to branch A and was charged `fsLow` and
		 * `ascReady` — two conditions their rotation does not contain. Both committed pulls own the set, so
		 * every one of those presses was graded against the wrong branch.
		 *
		 * Only A was implemented, with the proc's window pushed as a fault reason full stop — so a shock
		 * fired exactly as B wants it was reported as a shock spent early. This can only ever excuse a
		 * press: B drops one of A's conditions and loosens another, and `2 × tickMs` is at most the 6 000ms
		 * `ES_FS_MIN_MS` (it reaches it only at zero haste, where `tickWindowAt` falls back to the unhasted
		 * period).
		 *
		 * `dotTickFrequency` is the tick *period*, not a rate — `sim/core/apl_values_dot.go:191-194` returns
		 * `dot.tickPeriod`, the value frozen at the application. So the floor is measured off this press's
		 * own cadence, the same reading the Flame Shock refresh verdicts use, and not off the audit's median:
		 * that median is wrong for any press outside the pull's dominant haste plateau.
		 */
		const esSpawn = spawnAt(t);
		const tickMs = tickWindowAt(esSpawn === null ? [] : (fsTicks.get(esSpawn) ?? []), t, FLAME_SHOCK_DOT).cadenceMs;
		const reasons: EarthShockReason[] = [];
		if (stacks !== null && stacks < lightningShieldCap) reasons.push('belowFull');
		if (twoPieceOwned) {
			if (remainingIn(t, twoPieceWindows) > ES_TWO_PIECE_TAIL_MS) reasons.push('twoPiece');
			if (fsRemaining < 2 * tickMs) reasons.push('fsTail');
		} else {
			if (fsRemaining < ES_FS_MIN_MS) reasons.push('fsLow');
			if (ascReadyInSec < ES_ASC_HOLD_SEC) reasons.push('ascReady');
		}
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
	//
	// The cast guard is *here* rather than inside `auraWindows` because this aura logs its press under a
	// different id from its buff — 2894 against 118291 — and that function's "nothing may have opened
	// this aura earlier in the stream" test is per id. Its own comment counts a cast under one of the
	// aura's ids as proof the opening was logged, which is the rule wanted; with the press on one id and
	// the buff on another, the buff's recovery cannot see the press. So a stream that carried the cast
	// but lost the `applybuff` beside it — they share a millisecond, and pages are cut on timestamps —
	// would have its ordinary in-fight summon recovered as a pre-pull one. A press at or before the
	// recovered expiry can only be that, since no shaman presses this twice inside one minute.
	const stCasts = castTimes(SEARING_TOTEM);
	const feCasts = castTimes(FIRE_ELEMENTAL);
	const fePrepullWindow = auraWindows(selfEvents, FIRE_ELEMENTAL_AURA, t0, fightEnd, { openAtPull: true }).find(
		(w) => w.preexisting === true && !feCasts.some((t) => t <= w.end),
	);
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
	 * The clock the totem is graded against: contact time, less every stretch the Fire Elemental owned
	 * the slot.
	 *
	 * A player cannot have a Searing Totem up while the elemental is out, so that time is not a totem
	 * they dropped — it comes out of the denominator rather than being scored as a miss. Without this
	 * a pull that used the elemental on cooldown could not clear the section's "good" bar however well
	 * the totem was kept.
	 *
	 * **`contact` and not `engaged`, for the same reason Flame Shock's share moved.** This used to divide
	 * by the primary target's own clock while `SearingTotemUptime.tsx` shaded its "down" band from
	 * `intersect(contactSegments, slotFree)` — so the picture forgave the stretches the player had nothing
	 * in reach and the percentage beside it did not. That is a chart and a figure describing two different
	 * fights in one section, which is the defect this pass exists to close; the chart's own comment
	 * already claims "the section's denominator drops the same stretch", and now it does. Dropping a
	 * totem is also a claim about the player rather than about the boss's reachability: a totem ticks on
	 * whatever is near it, so the seconds worth grading are the seconds the player was in the fight.
	 *
	 * Measured on `phased`, whose two clocks are 32.7s apart: 182 999ms of scored time becomes 150 310ms
	 * and the share goes from 65.57% to 79.83%. No fixture crosses a band on it.
	 *
	 * The numerator is intersected with the same clock rather than taken raw, so it follows this line
	 * without a second edit. Two halves of one ratio measured over two different stretches is how a
	 * percentage above 100 happens — a totem ticking through an intermission would have counted up
	 * against a denominator the intermission was already out of.
	 */
	const stScored = intersect(contact, complementOf(feWindows, duration));
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
	// `selfEvents`, not `events`, and this is not defensive tidying: both of these counters are worn by
	// whoever has the trinket, so reading the raid's stream opened a snapshot window on this shaman's
	// report whenever *another* player's Unerring Vision or Black Blood hit ten. The trigger beside them
	// is self-scoped and so are the int procs these are intersected with, which is what made the odd one
	// out invisible. It fabricated a fault — a `Snapshot missed` row for a trinket the audited player was
	// not wearing — and it is the same species as the bug `dotWindowsOnTarget`'s comment records.
	triggerWindows.set(
		'uvls-stacks',
		// Wushoolay's counter, not Unerring Vision's — Unerring Vision has none. The sim's own rule asks
		// `auraNumStacks(138786) >= 10`, and inside the sim that is coherent because a Go override put the
		// stacks on the window's id; in a log the window and the counter are separate ids and only 138788
		// ever reaches ten. Threshold off `aura.maxStacks`, because a literal is what let Skeer's counter of
		// twenty go unnoticed elsewhere.
		toIntervals(
			levelWindows(auraLevels(selfEvents, WUSHOOLAYS_STACKS, t0, fightEnd), WUSHOOLAYS_STACKS.maxStacks ?? 10),
		),
	);
	triggerWindows.set(
		'black-blood',
		// Same correction: 146184 is the window and 146202 is the ten-stack counter.
		toIntervals(
			levelWindows(
				auraLevels(selfEvents, WRATH_OF_DARKSPEAR_STACKS, t0, fightEnd),
				WRATH_OF_DARKSPEAR_STACKS.maxStacks ?? 10,
			),
		),
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
	// The two-piece window is `twoPieceWindows` above, computed once: it is drawn as a lane, gates the
	// ladder, is one of Earth Shock's four conditions, and is read here. Five readers of one union, so
	// they cannot disagree about when the proc was up.
	//
	/**
	 * Whether Ascendance was already running when the bell went.
	 *
	 * The same shape as `fePrepullWindow` below — an `openAtPull` walk, guarded by the press list —
	 * and off `laneWindows`' memo rather than a fourth walk of the same aura, which is exactly the
	 * guarded reading that closure already builds for the drawn lane. The guard is not optional here:
	 * Ascendance's press (114049) and buff (114050) are different ids, so `auraWindows`' per-id "was
	 * this opening logged" test cannot let the press vouch for the buff, and a stream that lost the
	 * `applybuff` sharing the press's millisecond would read an ordinary in-fight window as a pre-pull
	 * one. See `laneWindows`' own docstring, which names Ascendance as the case it exists for.
	 *
	 * An inferred window feeding a grader is normally the thing that closure forbids. It is admissible
	 * in this one direction and only this one: `ascendanceSync` reads this to **refuse** to grade —
	 * `'ascendance-up-at-the-pull'` — so the inference can only ever move a press from a fault to
	 * silence, never the other way. Same licence, and the same argument, as the pre-pull Fire Elemental
	 * seeding the fire totem slot walk.
	 */
	const ascendanceAtPull = laneWindows(ASCENDANCE_AURA, ascCasts).some((w) => w.preexisting === true);
	/**
	 * The press rules, from `./ascendance` — the opener against the raid's haste cooldown, every later
	 * press against the T16 two-piece.
	 *
	 * `null` rather than `[]` when the pull carries no Elemental Discharge, which is the distinction
	 * that module's `t16TwoPieceWindows` draws and the reason it is a parameter: `[]` claims the set is
	 * on the player and never procced, and nothing this audit reads can claim that. The evidence here is
	 * the debuff itself, so no windows means no evidence — `'no-two-piece-evidence'`, not a fault. The
	 * timeline lane makes the same call by construction, since empty lanes are dropped from it.
	 */
	const ascSync = ascendanceSync({
		ascendanceCasts: ascCasts,
		ascendanceAtPull,
		hasteWindows,
		contact,
		durationMs: duration,
		t16TwoPieceWindows: twoPieceWindows.length > 0 ? twoPieceWindows : null,
	});
	// Mapped over the verdicts rather than over `ascCasts`, so a press and its verdict cannot come
	// apart: `ascendanceSync` maps the cast list one-to-one, and taking the `t` off the verdict is what
	// makes that guarantee structural rather than an index both sides have to agree about.
	const ascPresses = ascSync.presses.map((sync) => ({
		t: sync.t,
		// Per spawn: "Ascendance pressed without a fresh Flame Shock" is a claim about the enemy the
		// player was about to spend the window on, and the list's own rule reads `dotRemainingTime`,
		// which the sim evaluates against the current target.
		fsRemainingMs: fsRemainingAt(sync.t) || null,
		opener: isOpener(sync.t),
		twoPiece: remainingIn(sync.t, twoPieceWindows) >= 10_000,
		sync,
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
		const reason: 'opener' | 'sync' | 't15' | 'off' | null = isOpener(t)
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
	// when Heroism is going up on the pull. The window itself is recovered up at the Fire totem slot
	// walk, which needs it to seed the slot; asking `auraWindows` a second time here would be a second
	// answer to one question, and the two could drift apart on the id list alone.

	// ------------------------------------------------------------ Stormlash
	// The raid's totems, one window per placement, grouped by the shaman who laid it. The buff does not
	// stack, so the overlaps are the section's argument: a totem laid on top of a running one is wasted.
	const stormlashByShaman = new Map<number, Window[]>();
	for (const e of raidStormlash) {
		const at = e.timestamp - t0;
		const source = e.sourceID ?? -1;
		const list = stormlashByShaman.get(source) ?? [];
		// Clamped, for the reason `untilFightEnd` exists: a totem laid with five seconds of fight left
		// does not run its full ten. Its two neighbours already clamp — the player's own timeline lane
		// through `untilFightEnd`, and `stormlashOverlaps` because `intervalsAtLeast` closes at
		// `duration` — so leaving this one unclamped had the section's three numbers measured three
		// different ways, and `StormlashTotems.tsx` drawing a bar past the end of its own axis.
		const [start, end] = untilFightEnd(at, STORMLASH_DURATION_MS);
		list.push({ start, end });
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
		't16-2pc-debuff': twoPieceWindows,
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
	/**
	 * One drawn row, and the copy that keeps the window's **provenance** on the way to it.
	 *
	 * This used to be `windows.map((w) => ({ start: w.start, end: w.end }))`, and that was the whole of
	 * why §6's marking requirement could not land: `preexisting` and `truncated` are what tell a bar the
	 * log proved both ends of from one that was inferred, and rebuilding each window from two of its
	 * fields threw both away. The chart reads them (`CastTimeline`'s `barNodesOf`), `LaneWindow` carries
	 * them, and no type could catch the loss — a narrower object still satisfies an optional field.
	 *
	 * Still a copy rather than the array itself: `AuraLane.windows` is mutable and several of the arrays
	 * handed in here are shared with a graded reader, so passing one through would let a consumer that
	 * sorted "its own" lane reorder a figure's own windows. Spread only when true, so a lane that carries
	 * neither flag serialises exactly as it did before — every captured fixture included.
	 */
	const lane = (aura: Ability | Aura, group: 'buff' | 'proc' | 'debuff', windows: readonly Window[]): AuraLane => ({
		key: aura.key,
		name: aura.name,
		id: ('castIds' in aura ? aura.castIds[0] : aura.ids[0]) ?? 0,
		group,
		windows: windows.map((w) => ({
			start: w.start,
			end: w.end,
			...(w.preexisting === true ? { preexisting: true } : {}),
			...(w.truncated === true ? { truncated: true } : {}),
		})),
	});
	/**
	 * The Flame Shock dot again, one row per enemy that carried it — for drawing, and only for drawing.
	 *
	 * The chart has had the whole per-enemy apparatus all along — `perTargetBlock`, the enemy headings,
	 * `collapseTargets`, the picker — and it groups on `AuraLane.target`. This file emitted no lane
	 * carrying one, so an Elemental's Flame Shock drew as a single merged bar even on the `cleave`
	 * fixture — a Siegecrafter Blackfuse pull whose stream carries 71 enemy spawns under six actor ids,
	 * two of which really did carry the dot. A merged bar says "something out there had the dot", which
	 * is the weaker claim `castLog.target.mergedNote` exists to warn about, and it was being offered as
	 * if it were the only one available.
	 *
	 * **Nothing computed here reaches a number, and that is the constraint rather than a remark.**
	 * `flameShock.uptimePct` is the contact clock's reading (`fsContactWindows` over `inContactMs`) and
	 * it is measured a long way above this; the primary's row is `dotLaneWindows(FS_DEBUFF)` — the very
	 * array the lane already drew — so the row the reader compares the figure against is unchanged, and
	 * the enemies added beside it are rows the figure was never measured over. The three reference pulls
	 * read 98.2015%, 100% and 72.2979% before this block existed and read the same after it.
	 *
	 * **Per enemy id, not per spawn**, even though `byTarget` is built out of the per-spawn walk.
	 * `LaneTarget.id` is a report actor id and `CastTimeline` keys its rows `${lane.key}@${target.id}`,
	 * so two spawns of one add would be two rows with one name, one id and one React key — reconciled
	 * into each other. The union of an id's spawns is also what a row labelled with an enemy's name
	 * honestly means, which is the argument `dotWindowsBySpawn` already makes for `merged`.
	 *
	 * What is decided here and nowhere else is *order and cut*. Ordered by the damage the enemy took
	 * from this player — the same currency `primaryID` itself was chosen in — so the row order agrees
	 * with the report's own answer to "which enemy was this pull about" rather than offering a second
	 * one. Time up was the alternative and it ranks a dotted-and-abandoned add above the one the player
	 * killed, because the dot runs its 30s either way.
	 */
	const fsTargets = (() => {
		// The report's actor list is the only thing that can name an enemy — `enemyNPCs` carries ids and
		// gameIDs and no names at all. An id it does not answer for stays null and the chart labels it as
		// an unnamed enemy carrying that id, which is the truth; a lane named after the wrong add is
		// worse than a lane named after none.
		const named = (id: number): string | null => h.actors.find((a) => a.id === id)?.name ?? null;
		const damageTaken = damageByTarget(h.damageEvents);
		const others = [...fsAnywhere.byTarget]
			.filter(([id]) => id !== primaryID)
			.map(([id, spans]) => ({
				id,
				name: named(id),
				damage: damageTaken.get(id) ?? 0,
				windows: spans.map(([start, end]): Window => ({ start, end })),
			}))
			// An enemy whose only trace is a stray refresh has no window to draw, and an empty row costs
			// a line to say that the add existed.
			.filter((target) => target.windows.length > 0)
			.sort((a, b) => b.damage - a.damage || (a.windows[0]?.start ?? 0) - (b.windows[0]?.start ?? 0));
		const drawn = others.slice(0, Math.max(0, FS_TARGET_LANES - 1));
		return {
			targets: [
				// The primary first, and its windows are `dotLaneWindows`' — the array this lane was already
				// drawn from, inferred pre-pull window and all. Re-deriving it from `byTarget` would draw the
				// boss's row from a different walk than the one the section's own provenance marking comes
				// off (`openAtPull`), and `prepullLanes.test.ts` is a test of exactly that bar.
				//
				// `primaryName` rather than `named(primaryID)`: the report already has an answer for this
				// enemy's name and the header prints it, so a second lookup could only disagree.
				...(primaryID === undefined ? [] : [{ id: primaryID, name: primaryName, windows: dotLaneWindows(FS_DEBUFF) }]),
				...drawn,
			],
			// The enemies past the cap, kept rather than counted and dropped: a reader who wants the
			// seventh add can only be offered it if it survived this far. Same order the sort left them in,
			// so `lanes` ++ `hiddenLanes` concatenates back into the full damage order.
			rest: others.slice(drawn.length),
			hidden: others.length - drawn.length,
		};
	})();
	/** A per-enemy row, in the one shape both the drawn set and the remainder are built from. */
	const targetLane = (target: { id: number; name: string | null; windows: Window[] }): AuraLane => ({
		...lane(FS_DEBUFF, 'debuff', target.windows),
		target: { id: target.id, name: target.name, primary: target.id === primaryID },
	});
	/**
	 * **The §6 audit of this file's `auraWindows` calls, written down because the calls that did _not_
	 * change are the more useful half.**
	 *
	 * Every lane below that comes from the player's own aura stream now goes through `laneWindows`, which
	 * infers the pre-pull window; see its docstring for why that is a second walk and not a switch on the
	 * memo, and for why rung 3 (`pullAuras`) is not used anywhere in this file.
	 *
	 * **`flame-shock` and `t16-2pc-debuff` now infer too**, through `dotLaneWindows` — the sibling closure
	 * for the auras that sit on an enemy rather than on the player. They were the two that could not, for
	 * two reasons that both had to go first: `dotWindowsBySpawn` filtered the press out of its buckets, so
	 * the "a cast proves the opening was logged in-fight" guard was blind even though Flame Shock's press
	 * and debuff are both 8050; and their windows are the **graded** ones, so an inferred bar could not be
	 * drawn until `lane` above stopped throwing `preexisting` away. Both fixed, and the two readings are
	 * now separate arrays: `fsMerged` and `twoPieceWindows` are still what every figure is measured from.
	 *
	 * The two lanes that still do **not** infer, and why not:
	 *
	 *   - **`searing-totem` and `fire-elemental`** come off the Fire totem slot walk, which already
	 *     recovers the pre-pull elemental with `openAtPull: true` and its own press guard. Asking
	 *     `auraWindows` a second time for either would be a second answer to one question.
	 *   - **`stormlash-totem`** is built from cast times and a fixed ten seconds, so there is no aura walk
	 *     to give an option to. A pre-pull Stormlash would need the press, and the press is the evidence.
	 *
	 * Every bar this file can infer is rung 2 — a removal the log really carried. Rung 3 needs
	 * `pullAuras` and nothing here passes it, so the hatched fill `CastTimeline` reserves for a
	 * snapshot-only bar is unreachable from an Elemental pull; a rung-2 bar is marked by its tooltip
	 * clock reading "before the pull" and by the caption that explains a bar with no press above it.
	 */
	const lanes: AuraLane[] = [
		// One row per enemy that carried the dot, sharing the aura's key and separated by their target —
		// the primary first, which is the row that used to stand for the whole pull on its own.
		...fsTargets.targets.map(targetLane),
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
			// `ascCasts` as the press guard: this aura's cast and buff ids differ, so `auraWindows`' own
			// guard cannot see the press. See `laneWindows`.
			//
			// Handed straight to `lane` rather than through `toIntervals(...).map(...)`, here and at every
			// other `laneWindows` row below. That round trip was doing nothing but converting an
			// `AuraWindow[]` into a shape `lane` already accepts, and on the way it dropped the
			// `preexisting` and `truncated` flags the walk had just set — which meant `lane` could carry
			// the provenance and still receive none.
			laneWindows(ASCENDANCE_AURA, ascCasts),
		),
		lane(ELEMENTAL_MASTERY, 'buff', laneWindows(registry.aura('elemental-mastery'))),
		// The elemental's windows off the Fire totem slot walk, so this lane and the Searing Totem lane
		// under it are the two halves of one slot rather than two independent claims on the same time.
		lane(
			FIRE_ELEMENTAL_AURA,
			'buff',
			// Marked where the slot walk seeded itself from a pre-pull summon: that stretch is inferred from
			// the bare `removebuff` the expiry left behind, exactly as a rung-2 window elsewhere is, and the
			// flag was being lost because the walk answers in `Interval`s. `searingTotem.feWindows` keeps the
			// plain spans — it is the chart's exempt band and not a claim about evidence.
			pullSpansAsWindows(feWindows, fePrepullWindow !== undefined),
		),
		lane(SEARING_TOTEM_DOT, 'debuff', stMerged),
		lane(LAVA_SURGE, 'proc', laneWindows(LAVA_SURGE)),
		// The two-piece debuff the proc leaves on the primary target, so the Ascendance two-piece window
		// can be read off the timeline rather than only off the cooldowns section. One lane, where there
		// used to be this and an empty `t16-2pc-proc` beside it.
		lane(T16_2PC_DEBUFF, 'debuff', dotLaneWindows(T16_2PC_DEBUFF)),
		lane(UNERRING_VISION, 'proc', laneWindows(UNERRING_VISION)),
		lane(BREATH_OF_HYDRA, 'proc', laneWindows(BREATH_OF_HYDRA)),
		lane(CHAYES, 'proc', laneWindows(CHAYES)),
		lane(WRATH_OF_DARKSPEAR, 'proc', laneWindows(WRATH_OF_DARKSPEAR)),
		// The gear that fires on every committed pull, and did not have a row.
		//
		// **How this was missed is the reason the guard below it exists.** The four rows above are the
		// trinkets *these fixtures' players did not wear* — declared correctly, filtered out by the
		// `windows.length > 0` line at the end of this array, and so invisible in the report and in this
		// list. The effects that did fire were never added, and nothing failed: the coverage ledger asks
		// "which declared aura never fires", which is the opposite question. A reader with Purified
		// Bindings and Kardris' Toxic Totem equipped saw neither in their timeline, on a pull where both
		// procced, and the model had both ids right the whole time.
		//
		// Split by group on purpose: a proc is something the pull gave you and an on-use is something you
		// pressed, and the tone should not claim you chose the first or were handed the second.
		lane(TEMPUS_REPIT, 'proc', laneWindows(TEMPUS_REPIT)),
		lane(JADE_SPIRIT, 'proc', laneWindows(JADE_SPIRIT)),
		lane(LIGHTWEAVE, 'proc', laneWindows(LIGHTWEAVE)),
		lane(TOXIC_POWER, 'proc', laneWindows(TOXIC_POWER)),
		lane(EXPANDED_MIND, 'proc', laneWindows(EXPANDED_MIND)),
		lane(SYNAPSE_SPRINGS, 'buff', laneWindows(SYNAPSE_SPRINGS)),
		lane(JADE_SERPENT_POTION, 'buff', laneWindows(JADE_SERPENT_POTION)),
		// **The haste wash is not a substitute for these rows, which is what having only the wash assumed.**
		// It is one full-height shade behind everything, so it says "haste was up somewhere in here" and
		// cannot say which of Bloodlust or Berserking, cannot be hovered for a duration, and disappears
		// entirely for a buff that is not haste. Blood Fury is spell power: it had no representation at all.
		//
		// Both are kept. The wash is the region — the reason a stretch of the pull looks different — and the
		// row is the aura, with its own start, end and tooltip. Drawing one and calling the other covered is
		// how these three went missing.
		lane(BLOODLUST, 'buff', laneWindows(BLOODLUST)),
		lane(BERSERKING, 'buff', laneWindows(BERSERKING)),
		lane(BLOOD_FURY, 'buff', laneWindows(BLOOD_FURY)),
		// An aura the log never carried has no windows and no business taking a row — the talent was not
		// taken, or the trinket was not worn. Dropped rather than drawn empty, so the timeline names only
		// what actually happened.
	].filter((l) => l.windows.length > 0);

	// The enemies past the cap, in the same shape. Not in `lanes`, deliberately: that array is what the
	// chart draws, and these are what it may be asked to draw instead.
	const hiddenLanes: AuraLane[] = fsTargets.rest.map(targetLane);

	// -------------------------------------------------------------- assembly
	// The globals this audit found spent on a press that bought nothing: a Flame Shock refresh that
	// was neither the reader's keep-it-up window nor the sim's Ascendance prep, and every Searing
	// Totem pressed over a healthy one.
	// The three excuses have to be the same three the section, the chart and `flameShockWaste` use, or
	// `gcdUtilisation` charges a global for a press the Flame Shock section calls correct.
	const wastedGcds =
		fsPresses.filter((p) => p.remainingMs !== null && !p.windowed && !p.ascPrep && p.kind !== 'snapshot').length +
		stClipped.length;

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
			uptimePct: uptimePct(fsContactWindows, inContactMs),
			applies,
			refreshes,
			windowed: fsPresses.filter((p) => p.windowed).length,
			ascPrep: fsPresses.filter((p) => p.ascPrep).length,
			// Off the *kind* and not off the delta, which is what keeps the three excuses from overlapping:
			// a press that was already `windowed` carries a delta too, and counting it here would subtract
			// it from `flameShockWaste` twice.
			snapshotGain: fsPresses.filter((p) => p.kind === 'snapshot').length,
			tickMs: fsTickMs,
			durationMs: FLAME_SHOCK_DURATION_MS,
			presses: fsPresses,
			multiDotUptimeMs,
			multiDotUptimePct,
			multiTargetMs: multiDotMs,
			scoredMs: inContactMs,
			contactUptimeMs: fsContactMs,
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
		ascendance: { presses: ascPresses, atPull: ascendanceAtPull, grade: ascSync.grade },
		elementalMastery: { presses: emPresses },
		fireElemental: { presses: fePresses, prepull: fePrepullWindow !== undefined },
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
		timeline: { casts: marks, lanes, hiddenTargets: fsTargets.hidden, hiddenLanes },
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
