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
	raidScoped,
	SELF_EVENT_MS,
	levelAt,
	levelWindows,
	remainingAtCast,
	remainingIn,
	toIntervals,
	uptimePct,
} from '~/lib/analysis/auras';
import { atCapWindowsIn } from '~/lib/analysis/counters';
// Type only, for `fsPressAt` — the accessor that keeps the Flame Shock press list and the map keyed for
// it on one clock. See its docstring for why that has to be a function rather than a comment.
import type { CastPress } from '~/lib/analysis/casts';
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
import { readTalents } from '~/lib/analysis/gear';
import { raidSourceLanes, windowsBySource } from '~/lib/analysis/raidCasters';
import { median } from '~/lib/analysis/format';
import { lastIndexAtOrBefore, stampAtOrBefore, valueAtOrBefore } from '~/lib/analysis/search';
import { intervalsAtLeast, isJudgeableTarget, overlapPoints } from '~/lib/analysis/targets';
import type { AnalysisSettings, SettingSchema } from '~/lib/settings';
import { defaultSettings } from '~/lib/settings';
import type {
	Analysis,
	AscendanceFault,
	AuraLane,
	ElementalMasteryPress,
	EarthElementalPress,
	EarthElementalVerdict,
	EarthShockReason,
	FireElementalPress,
	FlameShockPress,
	FlameShockPressKind,
	ElementalAuditResult,
	ManaAudit,
	ManaFault,
	ManaLowStretch,
	ResourceCurve,
	FightDataset,
	Miss,
	SearingTotemPress,
	StormlashAudit,
	StormlashReceived,
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
import { aplAudit, type AplInputs, ALL_BANDS, bandOf } from '~/lib/spec/apl';
import type { AplAudit, Band } from '~/lib/spec/apl';
import { LADDER, UNARBITRATED } from './apl';
import { ascendanceSync, OPENER_DEADLINE_MS, type AscendancePressVerdict } from './ascendance';
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
 *
 * ### Re-examined against Clearcasting, and deliberately left alone (plan §87)
 *
 * The objection was sharp and arithmetically right: Clearcasting is **+20%** and up for 52-72% of these
 * pulls, so a stack on its own is twice this number and "a bar a single always-available proc clears is
 * not a bar". Three things answer it, in the order they were measured.
 *
 * **1. The sim's own numerator has the proc in it, so the total is the figure being cited.**
 * `dotPercentIncrease` divides `ExpectedTickDamage` by `ExpectedTickDamageFromCurrentSnapshot`
 * (`sim/core/apl_values_dot.go:338-347`), and Flame Shock's non-snapshot branch is
 * `spell.CalcPeriodicDamage(...)` (`sim/shaman/shocks.go:96-107`) — the spell's *current*
 * `DamageMultiplier`, which is where the school mod lives. So the list this report grades against would
 * itself refresh early under Clearcasting, **because of** Clearcasting. Netting the proc out here would
 * make this figure disagree with the rotation it is named after, and a press the sim would make would
 * start reading as waste.
 *
 * **2. It is not the proc that carries the credited presses anyway, and that is measured per press.**
 * `FlameShockPress.snapshotDeltaWithoutClearcastingPct` divides the +20% out of whichever of the two
 * applications froze it. On the committed fixtures every one of the seven graded presses lands on the
 * same side of this threshold either way: the three credited ones are +42.4/+56.2/+32.7 as measured and
 * +18.7/+30.1/+59.2 with the proc removed. One of the three is *stronger* with it removed, because the
 * dot it replaced had the proc and the dot it applied did not.
 *
 * **3. Raising it would be a move no fixture can see.** The seven graded deltas are +56.2%, +42.4%,
 * +32.7%, +0.01%, −23.3%, −41.0% and −52.5%, so **every threshold strictly between +0.01% and +32.7%
 * classifies all seven identically** — and on the proc-free reading the same is true from +0.01% to
 * +18.7%. Moving a graded threshold into a gap that wide is tuning against nothing, which is plan §90's
 * finding verbatim: a declared control that changed no outcome while looking like one.
 *
 * What was wrong was the **copy**, which named a trinket's spellpower as the reason. That is fixed where
 * it was wrong: `flameShock.intent`, `flameShock.state.snapshot*` and `flameShock.snapshotNote`.
 */
const FS_SNAPSHOT_GAIN = 0.1;
const ES_FS_MIN_MS = 6000;
const ES_ASC_HOLD_SEC = 6;

/**
 * What the **two-target** list asks of an Earth Shock, and it is a different rule rather than a looser one.
 *
 * `ui/shaman/elemental/apls/cleave.apl.json` rung 13 is the whole of it:
 *
 * ```
 * auraNumStacks(324) >= 6  AND  dotRemainingTime(8050) >= 8s  AND  dotRemainingTime(8050) >= 8s
 * ```
 *
 * Three things about that, each of which the single-target transcription gets wrong at two enemies:
 *
 *   - **Six stacks, not seven.** A spend at six is the list's own call there, and it was being reported
 *     as Fulmination thrown away — a correct press marked wrong, the same class of error as the early
 *     Flame Shock refresh (§62).
 *   - **Eight seconds of dot, not six.** The multi-target floor is *higher*, so this is not the
 *     single-target rule with the numbers relaxed.
 *   - **No Ascendance hold and no two-piece term at all.** There is no `spellTimeToReady(114049)` clause
 *     and no `auraIsActive(144998)` clause, which means there is no branch for the set to pick either:
 *     the two-target list has exactly one form, whatever gear the player is in.
 *
 * **`dotRemainingTime >= 8s` really is stated twice in the preset**, character for character, and it is
 * a redundant term in the source rather than a slip in this transcription — checked against the file.
 * Written once here because `x >= 8 AND x >= 8` is `x >= 8`; nobody should "fix" this into two different
 * numbers on the assumption that the second one was meant to be something else.
 */
const ES_CLEAVE_STACKS = 6;
const ES_CLEAVE_FS_MIN_MS = 8000;

/**
 * The Earth Shock reasons that mean "spent under the stacks this band's list asks for".
 *
 * Two entries because the two lists ask for different counts and the section has to be able to say
 * which one it means — see `EarthShockReason`. Named here so `lightningShield.badSpends` can read the
 * press's own verdict instead of re-testing the stack count against a second, band-blind copy of the
 * rule.
 */
const ES_STACK_REASONS: readonly EarthShockReason[] = ['belowFull', 'cleaveStacks'];

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
 * The sim grants the three minutes (`sim/shaman/talents_elemental.go`); the drift figure is measured
 * against five, and the section says so when a log's own Fire Elemental windows read three.
 *
 * **The reason given here for measuring against five was wrong and is corrected rather than kept.** It
 * said the report "cannot read the talent reliably off a log". It can: Primal Elementalist is 117013 and
 * it is in the `combatantinfo` talent list of all three committed fixtures, which `readTalents` answers
 * directly — the same read that now publishes `elementalMastery.talented`. So the five minutes is a
 * *measurement this lane did not change*, not a limit of the data, and the window-length detection below
 * is a dance around a fact that is now available.
 *
 * Left alone deliberately: `FIRE_ELEMENTAL_COOLDOWN_MS` feeds `cooldownDrift`, so moving it moves a
 * graded figure on every pull and wants a before/after per fixture of its own. It is also the blocker
 * for the queued Primal Fire Elemental uptime rule, which is where that measurement belongs.
 */
const FIRE_ELEMENTAL_COOLDOWN_MS = 300_000;
/** And its duration, from `sim/shaman/fire_elemental_totem.go` — the other half of the PE detection. */
const FIRE_ELEMENTAL_DURATION_MS = 60_000;
/**
 * The same summon with Glyph of Fire Elemental Totem, which halves it — `sim/shaman/apl_values.go`
 * builds `shamanFireElementalDuration` as exactly `Ternary(HasMajorGlyph(GlyphOfFireElementalTotem),
 * 30, 60) * time.Second`, and two branches of the Earth Elemental rule are written against it.
 */
const FE_GLYPHED_DURATION_MS = 30_000;
/**
 * How much longer than its declared length an observed aura window may read before the difference is
 * evidence rather than bookkeeping.
 *
 * A `removebuff` and the tick that preceded it share a millisecond, `applybuff` can land either side of
 * the cast, and a pre-pull window is clamped to the bell — none of which moves a window by seconds. Two
 * of them is generous, and it is only ever asked in the direction that makes the answer *less* certain.
 */
const AURA_WINDOW_JITTER_MS = 2_000;

/** Searing Totem's duration, from `sim/shaman/fire_totems.go`: forty ticks of about 1.5s. */
const SEARING_TOTEM_DURATION_MS = 60_000;

/** The Earth Elemental's end-of-fight window, from the p5 list (`remainingTime <= 62s`) — branch A. */
const EE_END_MS = 62_000;
/** Branch B's floor on what is left of the pull: `remainingTime >= 5s`. */
const EE_MIN_REMAINING_MS = 5_000;
/** Branch B's Ascendance window: `spellTimeToReady(114049) <= 20s`. */
const EE_ASC_SOON_SEC = 20;

/**
 * The Earth Elemental's own cooldown: five minutes, the same as the Fire Elemental's.
 *
 * **Which of the two numbers this is.** The summon sits behind two timers in
 * `sim/shaman/earth_elemental_totem.go`: its own `CD.Duration` of `time.Minute * 5`, and a `SharedCD` of
 * `time.Minute * 1` on `ElementalSharedCDTimer` that it shares with the Fire Elemental. `cooldownMs` is
 * the button's own clock — `cooldowns.ts` reads it as "ready again at `last cast + cooldownMs`" — so it is
 * the five minutes. The shared minute is a constraint *between* two buttons, which this model has no field
 * for and no reader that wants one. The field said 120 000, which is neither of them.
 */
const EARTH_ELEMENTAL_COOLDOWN_MS = 300_000;

/**
 * The Earth Elemental's own minute — `sim/shaman/earth_elemental_totem.go`'s `totalDuration`, and the
 * client's `SpellDuration` row for 118323, which agree at 60 000ms.
 *
 * Needed for the same reason the Fire Elemental's is: `auraWindows`' `openAtPull` inference refuses to
 * recover a pre-pull window without a duration bound, so an aura declared without one can never report
 * a summon made before the bell.
 */
const EARTH_ELEMENTAL_DURATION_MS = 60_000;

/**
 * The two buttons that refill the pool, and the two lines the cleave list presses them at.
 *
 * Read out of `ui/shaman/elemental/apls/cleave.apl.json` and the sim, not recalled:
 *
 *   - **Thunderstorm 51490.** `:15` casts it at `currentManaPercent OpLe 15%`. It restores 15% of
 *     maximum mana (`sim/shaman/elemental/thunderstorm.go:14`, `:41` — `AddMana(MaxMana()*0.15)`),
 *     costs nothing (`BaseCostPercent: 0`) and takes a global (`GCD: core.GCDDefault`), on a 45s
 *     timer (`:32`).
 *   - **Shamanistic Rage 30823.** `:0` casts it at `currentManaPercent OpLe 70%`. Fifteen seconds of
 *     `SpellMod_PowerCost_Pct` (`sim/shaman/shamanistic_rage.go:16-19`), off the global — the one
 *     Elemental press that genuinely is — on a 60s timer (`:28`), registered as `CooldownTypeMana`.
 *
 * Both operators are `OpLe`, so both lines are "at or under" and not "under". Only the cleave list
 * writes either of them out; `p5` and `aoe` leave `autocastOtherCooldowns` to find the Rage, which is
 * itself the evidence that mana binds on a multi-target pull and not on a single-target one.
 */
const THUNDERSTORM_ID = 51_490;
const THUNDERSTORM_CD_MS = 45_000;
const MANA_STARVED_PCT = 15;
const SHAMANISTIC_RAGE_ID = 30_823;
const SHAMANISTIC_RAGE_CD_MS = 60_000;
const MANA_STRAINED_PCT = 70;

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
 * Clearcasting's two stacks and fifteen seconds, both off `sim/shaman/talents_elemental.go` — `maxStacks
 * := int32(2)` at :150 and `Duration: time.Second * 15` on the aura at :153.
 *
 * Stated as constants for the reason `LIGHTNING_SHIELD_MAX_STACKS` is: the ceiling is what a drawn bar's
 * stack shading is measured against, so reading it off a pull's own peak would draw a pull that never
 * doubled up as though two were never available. The three fixtures happen to reach two on every one, so
 * a peak-derived ceiling would agree today and drift silently on the first pull that does not.
 */
const CLEARCASTING_MAX_STACKS = 2;
const CLEARCASTING_DURATION_MS = 15_000;
/**
 * The factor Clearcasting multiplies an Elemental-school spell's damage by, and the one number in this
 * file whose job is to split a shipped figure into two named halves.
 *
 * `SpellMod_DamageDone_Pct` **+0.2** over `School: core.SpellSchoolElemental`
 * (`sim/shaman/talents_elemental.go`), applied as `spell.DamageMultiplier *= 1 + mod.floatValue`
 * (`sim/core/spell_mod.go:499`) and then frozen by `Dot.Snapshot` — the chain `clearcasting.test.ts`
 * proves five ways out of the sim and then measures off the fixtures at 1.236 and 1.262.
 *
 * It is here because it is the **largest single term in `snapshotDeltaPct`** and was an unnamed one until
 * plan §87: one stack is twice the threshold the refresh is credited against, and it is up for 52-72% of
 * these pulls, so a reader told a refresh was "worth the tick" could not tell whether the dot grew because
 * of the gear the copy talked about or because of a proc every crit hands out. Dividing it back out does
 * not change what is graded — see `FS_SNAPSHOT_GAIN` for why that would be the wrong move.
 */
const CLEARCASTING_DAMAGE_MULT = 1.2;

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
		/**
		 * The fire totem slot's other occupant, declared so a press of it is not priced at zero.
		 *
		 * **Confirmed in the simulator rather than assumed.** `sim/shaman/fire_totems.go:71-108` registers
		 * it: `:73` is `ActionID{SpellID: 8190}`, `:76` is `Flags: core.SpellFlagAoE | core.SpellFlagAPL |
		 * SpellFlagShamanSpell`, `:91` is `IsAOE: true` and `:101` calls `CalcPeriodicAoeDamage`. So this is
		 * the sim's actual AoE fire totem, where Searing Totem (`:14-16`, `3599`) puts its dot on one unit.
		 * A `GCD: time.Second` and 21.1% of base mana, 30 ticks of 2s. `ApplyEffects` deactivates Searing
		 * Totem's dot and disables the Fire Elemental, because all three share one totem slot.
		 * `assets/database/db.json` names 8190 "Magma Totem" with an icon, which is the second source and
		 * the one that matters most here — see below.
		 *
		 * **It appears in no committed fixture: zero events of 8190 on `phased`, `unbroken` and `cleave`,
		 * against 4, 4 and 6 casts of 3599.** That is declared and not dressed up. Three single-target and
		 * light-cleave pulls are exactly where nobody drops a five-target totem, so the absence is a
		 * statement about the fixture set rather than about the id — and it is emphatically *not* the 144998
		 * shape, which was the simulator's `ExposeToAPL` handle for a proc the game never writes at all.
		 * 8190 is a `RegisterSpell` with a real `ActionID` and a real icon in the item database. What it
		 * means in practice is that nothing here can be tested against a real press, so this entry claims
		 * the least it can.
		 *
		 * **Why it is worth declaring anyway, with no log to check it against.** An undeclared cast id is
		 * not merely unnamed: `fixtureCoverage.test.ts`s own header records what happens: `castSeries`
		 * files it under `#8190`, `buildCastTable` labels it off-GCD because that is the safe default for a
		 * trinket, and the core's GCD walk asks `abilityByCastId` and `continue`s. So every press is priced
		 * at **zero occupied time**, which deflates `gcdUtilisationPct` — a graded metric — for the one
		 * player who uses the button. That is the Chain Lightning failure verbatim, and it does not need a
		 * fixture to be true.
		 *
		 * **Three things this deliberately does not do**, each because the evidence is not there:
		 *
		 *   - **No `damageIds`.** Searing Totem's damage logs under 3606 rather than 3599, so Magma's is
		 *     very likely its own id too — and nothing available says which. `db.json`s `spellIcons` carries
		 *     cast ids only (3606 is absent from it as well), and guessing is how 120687 came to be wrong
		 *     for three fixtures. Its ticks therefore stay unattributed in the damage table, exactly as
		 *     they are today; that is a smaller error than a wrong id, and it is an honest one.
		 *   - **No rung on the ladder.** 8190 appears in **none** of the five Elemental presets —
		 *     `aoe`, `cleave`, `default`, `p4`, `p5` — so the sim's own AoE list really is Flame Shock,
		 *     potion, Lava Beam, Chain Lightning with no Magma Totem in it. §91 took five rungs *out* of
		 *     bands 3 and 4 for not being in `aoe.apl.json`; inventing one would be that mistake in
		 *     reverse. A press of it is still measured against Chain Lightning, and that is what the list
		 *     we transcribe says, not an oversight of ours.
		 *   - **No aura, and no row in the Rotation reference.** The aura is the useful missing half — Magma
		 *     occupies the fire totem slot, so the `searing-totem` rung would stop demanding a Searing Totem
		 *     the player already replaced — but a declared aura that fires in no fixture belongs on
		 *     `fixtureCoverage.test.ts`s `SILENT_AURAS` ledger, and that file is another lane's. The
		 *     reference row is refused for the same reason as the rung: it prints a `condition` beside each
		 *     entry, and there is no list to quote one from.
		 */
		key: 'magma-totem',
		name: 'Magma Totem',
		castIds: [8190],
		onGcd: true,
		// The same gate as Searing Totem, and for the same reason: no cooldown, and the press is decided by
		// what is already in the fire totem slot.
		gate: 'conditional',
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
		// drift verdict would call the list's own plan a fault. Counted and never scored: `gate: 'other'`
		// makes `cooldownDrift` read the cooldown as zero and `analyseCore` leave it out of `lostCasts`
		// altogether, so the corrected figure below moves nothing but the cast table's own CD column.
		gate: 'other',
		cooldownMs: EARTH_ELEMENTAL_COOLDOWN_MS,
		applies: ['earth-elemental'],
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
	/**
	 * **Clearcasting — the Elemental Focus proc, and a +20% damage multiplier nothing in this report knew
	 * about.** Found by the undeclared-aura sweep (`68671a5`, plan §82) with **728 events across the three
	 * committed pulls**, the busiest id it turned up; until now the only thing in the repository that knew
	 * the number existed was `EXTRA_NAMES` below, labelling a damage-table row.
	 *
	 * `sim/shaman/talents_elemental.go`. The aura is registered at :153 as `Label: "Clearcasting"`,
	 * `ActionID{SpellID: 16246}`, `Duration: time.Second * 15`, `MaxStacks: maxStacks` where
	 * `maxStacks := int32(2)` at :150. It attaches three spell mods: `SpellMod_PowerCost_Pct` −0.25 over
	 * `canConsumeSpells`, `SpellMod_DamageDone_Pct` **+0.2 for `School: core.SpellSchoolElemental`**, and
	 * the same +0.2 again for `SpellMaskEarthquake` — which needs its own mod because Earthquake is
	 * Physical and so outside the school mask. `SpellSchoolElemental` is
	 * `SpellSchoolFire | SpellSchoolNature | SpellSchoolFrost` (`sim/core/flags.go:221`), so **every
	 * damaging spell this spec presses is inside it**.
	 *
	 * A `MakeProcTriggerAura` at :179 puts it up: `CallbackOnSpellHitDealt`, `Outcome: OutcomeCrit`, over
	 * `canTriggerSpells`, and its handler calls `SetStacks(sim, maxStacks)` — so **any crit refills it to
	 * two** rather than adding one. The aura's own `OnCastComplete` at :157 spends one stack per cast
	 * matching `canConsumeSpells`, skipping echoes and skipping the cast that just triggered it.
	 *
	 * **Both numbers are the log's as well as the sim's**, measured on the three fixtures: no pull ever
	 * shows a third stack, and of 361 drops, 291 coincide with a cast of a consuming spell — 403, 421,
	 * 51505, 8042, 8050 and 114074, exactly `canConsumeSpells` — while 70 fell off unspent.
	 *
	 * `durationMs` and `maxStacks` and nothing else. No `appliedBy`, because what puts it up is a crit and
	 * not a press. And **no grading**, because no rotation asks for it: 16246, "Clearcasting" and
	 * "Elemental Focus" appear in none of the five `ui/shaman/elemental/apls/*.apl.json` lists, the three
	 * this spec reads (`p5`, `cleave`, `aoe`) included. A metric nobody's rotation asks for is one this
	 * report should not invent.
	 */
	{
		key: 'clearcasting',
		name: 'Clearcasting',
		ids: [16_246],
		kind: 'buff',
		maxStacks: CLEARCASTING_MAX_STACKS,
		durationMs: CLEARCASTING_DURATION_MS,
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
		key: 'earth-elemental',
		name: 'Earth Elemental',
		/**
		 * The same two-id shape as the Fire Elemental above, and declared for the same one reason: until
		 * this existed, a pre-pulled Earth Elemental was invisible.
		 *
		 * 2062 is the *press* and **118323 is the aura** — measured on the committed fixtures, where a
		 * summon inside the pull emits both:
		 *
		 * ```
		 * applybuff 118323  player -> player     the buff that says the elemental is out
		 * summon    118323  player -> the pet    the body
		 * cast      2062    player               the press
		 * summon    2062    player -> the totem  the totem object
		 * ```
		 *
		 * `phased` at 240.166s and `unbroken` at 66.657s, both with the `applybuff` a millisecond before
		 * the `summon`; `unbroken` also carries the `removebuff` at 126.657s, one minute later. `cleave`
		 * carries neither id and no pet of its own, which is a pull that genuinely never summoned it.
		 *
		 * **No committed fixture carries a pre-pull one**, so the branch this unlocks is covered by a
		 * synthetic pull rather than by a fixture — see `elementals.test.ts`. That asymmetry is the same
		 * one that hid the Fire Elemental's tile reading zero on all three: a branch no fixture reaches
		 * is a branch nothing looked wrong in.
		 */
		ids: [2062, 118323],
		kind: 'buff',
		durationMs: EARTH_ELEMENTAL_DURATION_MS,
		appliedBy: 'earth-elemental',
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
/**
 * The talent row Elemental Mastery occupies, which is the same number the button casts under.
 *
 * Tier 4 column 0 of the shaman tree (`ui/core/talents/trees/shaman.json:87-93`), gated at
 * `sim/shaman/talents.go:37`. Named rather than read off `castIds[0]` because the two are separate facts
 * that happen to agree — a `combatantinfo` talent id and a cast id — and an ability that gained a second
 * cast id would silently start asking about the wrong one.
 */
const ELEMENTAL_MASTERY_TALENT_ID = 16_166;
/**
 * The talent row Primal Elementalist occupies, and the gate on the summon's haste-cooldown uptime.
 *
 * The level-90 row of the shaman tree, next to Unleashed Fury — the pairing the `AURAS` table above
 * already records, where 117012 and 117013 sit side by side. The id the `combatantinfo` list carries is
 * the same one: all three committed pulls name **117013** in it.
 *
 * Named here for the reason `ELEMENTAL_MASTERY_TALENT_ID` above is — a talent id and a cast id are
 * separate facts — and with one difference that matters more here: this talent has *no* button of its
 * own, so there is no cast list it could have been read off even in principle, and `readTalents` is the
 * only route to it.
 *
 * The declared `primal-elementalist` aura (117012's neighbour in the `AURAS` table) is deliberately not
 * what this reads. That entry exists so the coverage ledger can ask whether a log ever *applied* the
 * buff; the question here is whether the player brought the talent, which a pull that never got the
 * buff up still answers.
 */
const PRIMAL_ELEMENTALIST_TALENT_ID = 117_013;
const FIRE_ELEMENTAL = registry.ability('fire-elemental');
const EARTH_ELEMENTAL = registry.ability('earth-elemental');
const LAVA_BURST = registry.ability('lava-burst');
const STORMLASH_TOTEM = registry.ability('stormlash-totem');

const FS_DEBUFF = registry.aura('flame-shock');
const ASCENDANCE_AURA = registry.aura('ascendance');
const LAVA_SURGE = registry.aura('lava-surge');
const CLEARCASTING = registry.aura('clearcasting');
const LIGHTNING_SHIELD = registry.aura('lightning-shield');
const SEARING_TOTEM_DOT = registry.aura('searing-totem');
const FIRE_ELEMENTAL_AURA = registry.aura('fire-elemental');
const EARTH_ELEMENTAL_AURA = registry.aura('earth-elemental');
// No `STORMLASH_AURA` binding: the buff's rows are resolved out of the registry by key alongside Skull
// Banner's, because the two are one mechanism and the second is not declared in every model — see
// `RAID_SOURCE_AURAS` in the timeline block.
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
/**
 * The caster legendary cloak's proc — and the one item effect in this list that lands on the *enemy*.
 *
 * Xing-Ho, Breath of Yu'lon, declared in `lib/game/shared.ts` with `kind: 'debuff'` and the whole of the
 * evidence written out there. It is bound here for the reason the four below it are: it fires on every
 * committed pull — 13, 18 and 16 `applydebuff` of 146198 — and had no row.
 */
const ESSENCE_OF_YULON = registry.aura('essence-of-yulon');
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
 * Tide Totem (108280), Totemic Projection (108287) and Purge (370) all occupy a global in game. **They
 * are off-*rotation* globals, not off-GCD ones, and this report knowingly leaves them unpriced.** Only
 * Shamanistic Rage (30823) is genuinely off the global.
 *
 * Purge is the twelfth and arrived with `addsThenBoss.json`; the eleven the deltas below were measured
 * against are the eleven named before it.
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
	// The two elementals' own spells, and **four of these five labels were wrong** — checked one id at a
	// time against the 5.4 client's `SpellName` rows and against `sim/shaman/fire_elemental_spells.go`
	// and `earth_elemental_spells.go`, which register the same five numbers by name. Only Fire Blast was
	// right. The rest were shifted by one and two were invented: 117588 is Fire Nova (there is no "Fire
	// Shield"), 118350 is Empower, 118297 is Immolate, and the Earth Elemental's 118345 is Pulverize.
	// Neither pet's white swing reaches this map at all — melee books under `-4`.
	//
	// A wrong label here is not cosmetic in the way it looks. This map is what names a row in the damage
	// table, so a reader comparing their own log against the report saw damage attributed to a spell
	// their elemental never cast, twice over, with the real spell's name sitting on the wrong row.
	57984: 'Fire Elemental: Fire Blast',
	117588: 'Fire Elemental: Fire Nova',
	118297: 'Fire Elemental: Immolate',
	118350: 'Fire Elemental: Empower',
	118345: 'Earth Elemental: Pulverize',
	114206: 'Skull Banner',
	// The off-rotation presses, declared rather than left to the spell map to name. Every one of them
	// except Shamanistic Rage takes a global — see the note above for why they are named and not
	// priced. Listing them is what lets `fixtureCoverage.test.ts` tell "known and unpriced" apart from
	// "forgotten", which is the distinction that was missing when Chain Lightning was neither.
	// Purge, one press on `addsThenBoss.json` and the only cast id that fixture brought in that nothing
	// here had a name for. It takes a global like the rest of this block, and it is off-rotation for the
	// same reason Chain Heal is: `ui/shaman/elemental/apls/*.apl.json` never asks for it, so pricing it
	// would make `gcdUtilisationPct` answer "were you busy" instead of "did you fill the globals the
	// rotation wanted". Named rather than modelled, which is what keeps it out of `#370`.
	370: 'Purge',
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
 * **Which of the demands a bad press actually failed** — the field the table needs and the grade
 * cannot supply.
 *
 * `ascendanceSync` publishes `grade: 'bad'` as the `and` of two or three conditions, and a reader
 * looking at a red cell needs the one that broke, because each has a different thing to do about it:
 * press it in the opener, press it sooner, press it into the haste, wait for the discharge, press it
 * under the banner. So this decomposes the verdict rather than re-computing it — `grade` stays the
 * authority on *whether* a press was bad and this only ever names *why*, which is why every arm
 * below is guarded on `grade === 'bad'` and there is no path that can invent a fault on a good press.
 *
 * **The order is the rule's own conjunction order, not a preference.** More than one demand can fail
 * on one press, and the sim asks them in a fixed sequence per arm — rule 1 then entry 14 then rule 3
 * on the opener, rule 2 then entry 15 then rule 3 on a later press — so naming the first that failed
 * is naming the same one the grade expression short-circuits on.
 *
 * **Rule 2 is read structurally rather than arithmetically**, which is the part worth knowing. Its
 * branch in `ascendanceSync` returns before the two-piece is ever consulted, so it is the only bad
 * `t16-2pc` verdict that reports no `dischargeRemainingMs` at all — the entry-15 branch always sets
 * a number there, zero included. Testing for that null is therefore reading the shape the module
 * published, not guessing at the predicate behind it.
 *
 * The final `'no-banner'` is a fallback with an argument: `grade === 'bad'` means at least one
 * conjunct failed, and every other conjunct has been excluded by the time control reaches it. The
 * suite asserts the invariant in both directions rather than trusting that reasoning — a named fault
 * always has its own quantity offside, and a bad press always has a fault.
 */
export const ascendanceFault = (sync: AscendancePressVerdict): AscendanceFault | null => {
	if (sync.grade !== 'bad') return null;
	// Rule 2, and the one that is not a threshold comparison at all: the window ran past the kill.
	if (sync.rule === 't16-2pc' && sync.dischargeRemainingMs === null) return 'window-past-the-kill';
	if (sync.rule === 'bloodlust') {
		// Rule 1 first: the opener press is not optional, so being outside the opener at all is the
		// fault, before anything about what it was pressed into.
		if (sync.t > OPENER_DEADLINE_MS) return 'opener-late';
		if (sync.delayMs !== null && sync.delayMs > sync.limitMs) return 'late-into-haste';
		return 'no-banner';
	}
	if (sync.dischargeRemainingMs !== null && sync.dischargeRemainingMs < sync.limitMs) return 'discharge-too-short';
	// Rule 3 by exclusion, and the exclusion is what makes it safe. Rule 3's own availability guard —
	// a press with less pull left than the 9 000 ms it wants is not faulted for missing them — lives
	// inside `bannerOk` in `ascendanceSync`, and reaching this line means that expression is the only
	// conjunct left that can have failed. Re-testing `bannerOverlapMs` here would be a second copy of
	// that guard, free to drift from the first; inheriting it costs nothing and cannot.
	return 'no-banner';
};

/**
 * The stretches a sampled pool sat at or under a share of its ceiling.
 *
 * Two adjacent readings both under the line means the bar was under it between them — the same
 * convention `emptiedOf` (`components/charts/capped.ts:42`) draws the empty stretches with, and
 * deliberately the same: a bar is read from readings stamped onto events at about three a second, and
 * anything between two readings is not measured. So a dip that opened and closed inside one gap is
 * missed, and these figures under-report rather than over-report. That is the right direction for a
 * fault: nothing is charged that was not seen.
 *
 * `pct` on each stretch is the **deepest** reading in it, not its edges, which sit on the line by
 * construction.
 */
function lowStretches(curve: ResourceCurve, pct: number, link: (t: number) => string): ManaLowStretch[] {
	const out: ManaLowStretch[] = [];
	if (curve.max <= 0) return out;
	const line = (curve.max * pct) / 100;
	const points = curve.points;
	for (let i = 1; i < points.length; i += 1) {
		const prev = points[i - 1];
		const cur = points[i];
		if (prev === undefined || cur === undefined) continue;
		if (prev[1] > line || cur[1] > line) continue;
		const deepest = (Math.min(prev[1], cur[1]) / curve.max) * 100;
		const last = out[out.length - 1];
		// Merged as they are found, as `emptiedOf` does: consecutive readings under the line are one
		// stretch rather than one band per gap between them.
		if (last !== undefined && last.end === prev[0]) {
			last.end = cur[0];
			last.pct = Math.min(last.pct, deepest);
		} else out.push({ start: prev[0], end: cur[0], pct: deepest, link: link(prev[0]) });
	}
	return out;
}

/**
 * One of the two mana faults: the pool under a line with the button for it provably in hand.
 *
 * **Availability is derived from the presses, because neither button is in the model.** Thunderstorm
 * and Shamanistic Rage are both named in `EXTRA_NAMES` as off-rotation globals and neither carries a
 * `cooldownMs`, so there is no cooldown series to read. Two rules turn presses into availability, and
 * the second one is what keeps this from charging a player for something they could not have done:
 *
 *   - **A press at `p` puts the button away until `p + cooldown`.** Those stretches are `onCooldownMs`
 *     wherever the pool was low through them, and nothing charges them. This is the both-tools-down
 *     case the plan names: at 15% the list wants both buttons, and a stretch with neither of them back
 *     yet is the fight taking the mana rather than the player misplaying.
 *   - **Nothing before `cooldown` can be proved either way.** A log holds nothing from before its own
 *     first event, so a press taken a second before the bell is invisible here — and a press taken any
 *     earlier than that has already come back by `cooldown`. From `cooldown` onwards the presses inside
 *     the pull are therefore the whole story, and before it they are not. That opening is reported as
 *     `unprovenMs` rather than guessed at in either direction. It costs the first 45s of a pull for
 *     Thunderstorm and the first 60s for the Rage, which is the honest price of the log's own horizon.
 *
 * **And a stretch has to be at least one global long to be charged.** The priority list re-reads the
 * pool once a global, so a shorter overlap is a stretch the list never got to look at the pool inside —
 * charging it would fault a press nobody was offered. One global rather than a reaction time invented
 * for the purpose: it is the list's own evaluation cadence and no wider a grace than that.
 */
function manaFault(
	low: readonly ManaLowStretch[],
	presses: readonly number[],
	cooldownMs: number,
	duration: number,
	gcdMs: number,
	link: (t: number) => string,
): { fault: ManaFault; ready: Interval[]; busy: Interval[] } {
	const lowIntervals = low.map(({ start, end }): Interval => [start, end]);
	// Provably away: every press's own cooldown. Provably in hand: the rest of the pull from `cooldownMs`
	// on. Between them sits the opening, which is neither.
	const busy = mergeIntervals(presses.map((p): Interval => [p, p + cooldownMs]));
	const provable: Interval[] = duration > cooldownMs ? [[cooldownMs, duration]] : [];
	const ready = intersect(complementOf(busy, duration), provable);
	const charged = intersect(lowIntervals, ready).filter(([start, end]) => end - start >= gcdMs);
	// The deepest reading of whichever low stretch a charged sliver came out of — read back rather than
	// recomputed, so a row's percentage is the same number the stretch was found with.
	const deepestIn = (start: number, end: number): number => {
		const overlapping = low.filter((w) => w.start < end && w.end > start).map((w) => w.pct);
		// `charged` is an intersection with `low`, so there is always at least one — the fallback is the
		// line itself rather than `Infinity`, which would render as a percentage nothing produced.
		return overlapping.length > 0 ? Math.min(...overlapping) : 0;
	};
	return {
		fault: {
			lowMs: unionMs(lowIntervals),
			ms: unionMs(charged),
			stretches: charged.length,
			onCooldownMs: unionMs(intersect(lowIntervals, busy)),
			unprovenMs: unionMs(intersect(lowIntervals, complementOf([...busy, ...provable], duration))),
			gradedMs: unionMs(intersect(lowIntervals, ready)),
			windows: charged.map(([start, end]) => ({
				start,
				end,
				pct: deepestIn(start, end),
				link: link(start),
			})),
		},
		ready,
		busy,
	};
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
		t0,
		duration,
		link,
		selfEvents,
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
		aoeWindows,
		contact,
		hasteWindows,
	} = h;
	const { lightningShieldOvercapMs, searingTotemRefreshMs } = h.settings;
	const fightEnd = t0 + duration;

	/**
	 * The two raid-wide streams this audit is handed, named as the raid's rather than taken as given.
	 *
	 * Plan §31a. Three bugs in this file were one mistake — `auraLevels(events, …)` where the line beside
	 * it walked `selfEvents` — and all three read as another player's aura on this shaman's report: two
	 * snapshot triggers opened windows off somebody else's trinket, and the two-shaman Flame Shock the
	 * `dotWindowsOnTarget` comment records is the same species. `raidScoped` makes that shape a *compile*
	 * error rather than a thing to catch in review: the three aura walks take `ScopedEvents`, which these
	 * two values are deliberately not assignable to.
	 *
	 * A cast at runtime and nothing else, so no figure here can move. The consumers below are unaffected —
	 * every one of them wants the raid stream and takes `readonly WclEvent[]`, which a branded stream still
	 * satisfies: the dot walks (which bucket by spawn *before* they walk, and the bucket is the scope), the
	 * damage and tick sweeps, and the Stormlash loop, which reads one placement per shaman on purpose.
	 */
	const events = raidScoped(h.events);
	const raidStormlash = raidScoped(h.raidStormlash);

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
	/**
	 * And the same thing again for a debuff that is **not aimed anywhere** — a proc that lands on whatever
	 * the player's spell happened to hit.
	 *
	 * `dotLaneWindows` above scopes to `primaryID`, which is right for Flame Shock and for the two-piece:
	 * both are things the player put on a chosen enemy, and a figure labelled with the boss's name has to
	 * be the boss's. A cloak proc chooses nothing. On `cleave` it lands on add spawns as readily as on the
	 * boss, so a primary-scoped walk draws part of the row and calls it the proc's uptime.
	 *
	 * **Measured rather than argued from the shape:** through `dotLaneWindows` the Essence of Yu'lon row
	 * reads **11** windows on `cleave` against 13 here, and is identical on the two single-target pulls
	 * (18 and 16 either way). So the difference is exactly the two procs that burned an add, and it is only
	 * visible on the pull that has adds — which is why the choice needs a fixture behind it and not a
	 * paragraph.
	 *
	 * So this one drops the target filter and keeps the source filter, which `dotWindowsBySpawn` already
	 * splits apart for exactly this reason — `.merged` is then the union across every spawn that carried
	 * it, on the same argument `ascendanceSync` makes for unioning Skull Banner: the effect was running or
	 * it was not, and two enemies burning at once is one proc rather than two.
	 *
	 * No `openAtPull`. The inference needs a duration bound and this aura declares four seconds, so all it
	 * could ever recover is a proc that expired in the pull's first four milliseconds-to-seconds — a
	 * stretch no reader is looking for, bought at the cost of a bar drawn from `00:00` on evidence of one
	 * event. The graded readings do not touch this walk at all; nothing but the chart reads it.
	 */
	const procDebuffLaneWindows = (aura: Aura): Window[] =>
		dotWindowsBySpawn(events, aura, t0, fightEnd, actor.id).merged.map(([start, end]) => ({ start, end }));
	// A cast's fixed-duration window (a totem, the Fire Elemental) runs until the spell would expire,
	// but the fight may end first — clamp it so a Searing Totem laid in the last global does not draw a
	// sixty-second tail past the pull.
	const untilFightEnd = (t: number, ms: number): Interval => [t, Math.min(t + ms, duration)];

	/**
	 * **The Ascendance press list, on the landing clock — and this site is *mixed* rather than
	 * choice-graded, which is the opposite of how it reads.**
	 *
	 * Seven readers hang off this one binding, more than any other cast list in the file, and an audit
	 * that filed it as "grades a choice, so it wants `castBeginTimes` the day the button gains a cast
	 * time" would be wrong about six of the seven. The ruling on `analyseCore`'s `Handles` splits them:
	 *
	 *   - **`ascendanceReadyInSec(ascCasts, t)`** — five calls, from the Flame Shock, Earth Shock,
	 *     Elemental Mastery, Fire Elemental and Earth Elemental blocks. This is `last + 180s - t`, i.e.
	 *     the **cooldown's arming instant**, and `5cde12d` settled from the simulator that a cooldown is
	 *     armed at the *landing*: `triggerCooldown` is called only from `Hardcast.OnComplete`
	 *     (`sim/core/cast.go:187-205`), which fires at `Expires = begincast + castTime`. So the landing
	 *     is correct here and the commit would be wrong — re-pointing this list would make every one of
	 *     those five readiness figures early by the cast time. `apl.ts:758-760` says the same thing about
	 *     `lastCast`, for the same reason.
	 *   - **`offLadderCooldowns[114049].casts`** — the same arming clock, read by `cooldownsAt`'s
	 *     `readyInSec` for a button the ladder walk cannot see because it is off-GCD. Landing.
	 *   - **`laneWindows(ASCENDANCE_AURA, ascCasts)`** — twice, the drawn lane and `ascendanceAtPull`.
	 *     A **join key** against the aura stream: it exists because the press (114049) and the buff
	 *     (114050) are different ids, so it is asking "is there a press in this window's neighbourhood",
	 *     against `applybuff`/`removebuff` stamps. The ruling puts a join on whichever clock the other
	 *     side carries, and that is the `cast`.
	 *   - **`ascendanceSync({ ascendanceCasts: ascCasts, … })`** — the one genuinely choice-graded
	 *     reader, and the day this button gains a cast time it is the only one that moves. Its rules ask
	 *     whether the press was in the opener, how far into a haste cooldown it went, and how much
	 *     Elemental Discharge and Skull Banner were left, all of which were true or false when the player
	 *     decided. It is also *itself* mixed — `wastedMs` and the "never lose uptime to the kill" rule
	 *     measure the fifteen-second window, which the game opens at the landing — so the split has to be
	 *     drawn inside `./ascendance` and cannot be drawn by what is handed to it from here.
	 *
	 * Left as one binding rather than split into a landing list and a commit list **because six of the
	 * seven want the landing and the seventh cannot use a bare list honestly.** Two names here would put
	 * the commit list at one call site and imply `ascendanceSync` was uniformly on it, which is the
	 * claim above that is false. `castPresses(ASCENDANCE)` is the shape that fits — each press carrying
	 * both instants — and that is a change to `ascendanceSync`'s signature, in a module this lane does
	 * not own.
	 *
	 * Ascendance is an instant (no `castTime` in `sim/shaman/ascendance.go`), so `castTimes` and
	 * `castBeginTimes` are identical on it today and nothing above is observable yet.
	 * `ascendanceClock.test.ts` builds the pull where they are not, so the five readiness reads are
	 * pinned to the landing rather than to the fact that no fixture can tell.
	 */
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

	/**
	 * The stretches of this pull a banded rule is honest over: everything **less** the time three or more
	 * enemies were up.
	 *
	 * **This is the half of the exemption that changes a number, and it belongs here rather than in the
	 * score.** `lib/score/bands.ts` says so in its own words — "Nothing here decides *how much* of a
	 * clock to cut" — and `MetricRule.bands` only nulls a metric when the band intersection comes out
	 * *empty*. On the pull this whole exercise is about, that intersection is never empty: `cleave`
	 * resolves to `[1, 2, 3, 4]`, so a declaration on its own leaves every clock grading add-wave time
	 * exactly as it did before while presenting as band-aware. Cutting is the audit's job because the
	 * audit is the only thing that holds the stretches.
	 *
	 * Four clocks are cut with it, and **each cuts both halves of its own ratio with this same array.**
	 * Clipping a numerator and not its denominator is how a percentage above 100 happens, and this file
	 * has already produced one that way — see `fsContactMs` and the 100.21% its docblock dissects. So the
	 * rule is: intersect the denominator, and intersect the numerator with the identical array, never
	 * with a second derivation of "when was it AoE". That second derivation is the mistake
	 * `exemptTrack.test.ts` was written after three charts each made differently.
	 *
	 * Band 3 up and not band 2. `cleave.apl.json` still spends the shield — at six stacks rather than
	 * seven — still keeps the totem, which it promotes above four other rungs, and still asks for the dot
	 * on both targets. Exempting two enemies would excuse a pull from a list that is *stricter* rather
	 * than absent. `aoeWindows` is the core's own three-or-more series, already trimmed of the trailing
	 * window of boss-only time that closes a stretch when the count merely falls (`fbc4963`), so nothing
	 * here re-derives that boundary either.
	 *
	 * **Three of the four readers use it as a ceiling over a clock whose floor is "anything at all"; the
	 * fourth uses it as a ceiling over a clock that already had a floor.** `mdGraded` intersects it with
	 * `multiTargetWindows` rather than with `contact`, so `flameShockMultiDot` — declared `bands: [2]`, off
	 * a rung that exists at two enemies and at no other count — is graded over band 2 and nothing else.
	 * The same array, supplying the second of two edges rather than the only one; see that block for why
	 * it takes two count series and cannot be an "exactly two" series derived here.
	 *
	 * Not every clock wants it, and the ones that decline say why at their own threshold: a slot fact, a
	 * global, a resource or a pre-pull press exists identically at every count. `lightningShieldFellOff`
	 * is the sharpest of those — Rolling Thunder pays 2% of maximum mana per charge and only while the
	 * buff is up, so keeping the shield up is right at every count and only *spending* it is banded.
	 */
	const gradedSpans = complementOf(aoeWindows, duration);

	// --------------------------------------------------------- Flame Shock
	// The dot on the enemy the pull was about. Without a primary there is nothing to measure — the
	// section reads zero rather than inventing a target.
	//
	// **Two readings, and which one a consumer gets is the whole of this block.**
	//
	// `fsMerged` is this walk's union across every spawn of that enemy id, and it is the only thing
	// this walk is for. It is the honest reading for the uptime figure, the timeline lane, the drop
	// ledger and the snapshot windows: a row labelled with one enemy's name should say whether that
	// enemy had the dot.
	//
	// `fsRemainingAt` is the other reading — the dot on the spawn `spawnAt` says the player was on —
	// and every rule that grades a press takes it instead: the Earth Shock `fsLow` reason, the
	// Elemental Mastery sync and the Ascendance prep check, the ladder's own `dotRemainingTime`, and
	// `fsPresses` through its per-spawn timeline below. On a multi-add pull the union answers a
	// question none of them asked: an Earth Shock pressed while a *different* spawn carried the dot
	// read as "dot up" when the enemy in front of the player had nothing on it. This is the split the
	// Windwalker already draws — `rskByInstance` for a graded press, `rskByTarget` for anything drawn.
	//
	// **But `fsRemainingAt` is not taken off `fsDot`, and that is the correction rather than a detail.**
	// `byInstance` here is keyed only by spawns of the *primary*, so on a pull with adds the spawn
	// `spawnAt` names is usually not in it, the lookup misses, and an empty array reads as **zero
	// remaining** — a fabricated figure indistinguishable from "the enemy being hit had no dot". Both
	// per-spawn readers therefore key into `fsDotAnywhere` below, which is the same walk one scope
	// wider, on the argument the graded numerator already makes there at length. Measured: 166 of
	// `addsThenBoss`' 408 ladder verdicts, on a pull whose primary is untargetable — and so provably
	// undotted — for its first 442 of 560 seconds. See `addsThenBossLadder.test.ts`.
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
	 * hit owning the time until the next, intersected with the graded clock. This is the Windwalker's own
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
	/**
	 * The clock this share is taken over: contact time, **less** the stretches three or more enemies
	 * were up — the second exempt cause composed into the same array the first one already was.
	 *
	 * `searingTotem`'s `stScored` is the pattern, and this now reads the same way: one `intersect` whose
	 * complement carries every reason a stretch is not this rule's to grade. Adding the third cause there
	 * was one array literal for exactly this reason, and adding the second one here is one `intersect`.
	 *
	 * **Both halves of the ratio come off this, and that is not a tidiness point.** `fsDotOn` below clips
	 * every spawn's dot to this array, so the numerator is inside it by construction, and `fsGradedMs` is
	 * its own union — one array, one denominator, and no second reading of "when was it AoE" to disagree
	 * with. The block above spent four paragraphs on the 100.21% that a numerator and a denominator
	 * measured over different spans produced, and clipping one half of this pair and not the other is the
	 * same defect with a new cause.
	 *
	 * **Why the dot's clock is banded at all**, since `aoe.apl.json` plainly does want the dot: what that
	 * list has no rung for is the thing the 95%/85% bar is *derived* from. It carries no Lava Burst at
	 * all, so the cascade the threshold is written on — a dropped dot costing far more than the global
	 * that would have replaced it — does not exist above two enemies. The full argument, and the reason
	 * band 2 keeps the bar, is at `flameShockUptime` in `score.ts`.
	 */
	const fsGraded = intersect(contact, gradedSpans);
	const fsGradedMs = unionMs(fsGraded);
	const fsContactDotBySpawn = new Map<string, Interval[]>();
	const fsDotOn = (key: string): Interval[] => {
		const known = fsContactDotBySpawn.get(key);
		if (known !== undefined) return known;
		// Merged and clipped once per spawn rather than once per hit: a boss carried through a whole pull
		// is thousands of hits against the same handful of windows.
		const windows = mergeIntervals(intersect(toIntervals(fsDotAnywhere.get(key) ?? []), fsGraded));
		fsContactDotBySpawn.set(key, windows);
		return windows;
	};
	const fsCoveredParts: Interval[] = [];
	for (let i = 0; i < landedHits.length; i++) {
		const hit = landedHits[i];
		if (hit === undefined) continue;
		// Each hit owns the time until the next one — that is how long the player was demonstrably on
		// that enemy — and the last one owns the rest of the pull, which the intersection with the graded
		// clock has already clipped back to nothing past the final window.
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
	/**
	 * The dot's remaining time on the spawn the player was on at `t`; zero when that spawn had none.
	 *
	 * **`fsDotAnywhere` and not `fsDot.byInstance`**, for the reason that block gives: a map keyed by the
	 * primary's spawns cannot answer about an add, and a miss here returns a zero no reader can tell
	 * apart from a measured one.
	 */
	const fsRemainingAt = (t: number): number => {
		const key = spawnAt(t);
		return key === null ? 0 : remainingIn(t, fsDotAnywhere.get(key) ?? []);
	};

	/**
	 * **The clock every Flame Shock reading in this block is on, declared once as a function so that
	 * moving it moves the map key with it.**
	 *
	 * `analyseCore`'s `Handles` ruling names a landing used as a **map key** as one of the two live traps
	 * it deliberately does not settle, and this is that trap. `fsAimedAt` below is keyed by a press
	 * instant and `fsCasts` is the list of instants looked up in it; both are `press.t` today, and if one
	 * moved to `press.begin` alone every lookup would *silently* miss and fall through to `spawnAt(t)` —
	 * the hit-enemy fallback whose own docstring exists to say it is the wrong enemy for this one button.
	 * A comment cannot hold that: the two lines are fifty apart and the failure mode is a wrong answer
	 * rather than an error. So the accessor is the single point of change and both sides call it, and
	 * `flameShockAimedClock.test.ts` pins the pair on a synthetic press whose `begin` and `t` differ.
	 *
	 * **It is the landing (`press.t`), and here that is a decision rather than the accident it is at the
	 * other six unstated sites in this file.** Almost everything downstream is a join against an event
	 * stream, which the ruling puts on whichever clock the other side carries — `remainingAtCast` and
	 * `fsTimelines` against the dot's own aura events, `tickWindowAt` and `dotTickBudgetIn` against its
	 * ticks, `beganAsRefresh` against the `refreshdebuff` stamps, `downBefore` against the walked
	 * windows, `fsPressBounds` as the boundary between two applications. Every one of those is stamped at
	 * the `cast`, so this list has to be. The day Flame Shock gains a cast time it is the two
	 * *choice*-graded fields on the row — `ascReadyInSec` and the `ascPrep` verdict built from it — that
	 * move to the commit, and they move individually rather than by re-pointing this accessor.
	 */
	const fsPressAt = (press: CastPress): number => press.t;
	const fsPressList = castPresses(FLAME_SHOCK);
	// Element-for-element `castTimes(FLAME_SHOCK)` — `CastSeries.times` and `CastSeries.presses` are
	// parallel by construction — read through the accessor above so the clock is stated rather than
	// implied by which of the three handles was reached for.
	const fsCasts = fsPressList.map(fsPressAt);
	// The dot's own clock, read blind to the refresh the press itself caused — that refresh is stamped
	// a millisecond *before* the cast, and reading it scored every press as a full 30s. `remainingAtCast`
	// is the same guard the Windwalker's Tiger Palm refresh uses, for the same reason.
	//
	// One timeline per **spawn**, not one for the target. `remainingAtCast` takes the last point before
	// the press and nothing else, so a stream with two spawns interleaved hands it the *other* add's
	// remove — which zeroes a dot still running on the enemy being hit and then reads the next refresh
	// of it as a fresh apply. Same mistake as bucketing the windows by id, one function further on.
	//
	// **Every spawn, and not `targetID === primaryID` — the third and last instance of the family
	// `4b63f99` fixed two of.** `remainingAtCast` is handed `fsTimelines.get(spawn)` for the spawn the
	// press was *aimed at*, which through an add wave is an add's; a map built only from the primary's
	// events misses, and `remainingAtCast([], …)` is **0** — a fabricated figure no reader can tell
	// apart from "the enemy this press was aimed at had no dot". Every press at an add therefore read
	// as an application. Shape-parallel to `fsDotAnywhere` / `dotWindowsBySpawn` above, which already
	// bucket every spawn and already argue for it at length. Measured on `addsThenBoss`: six of the 24
	// add-phase presses were genuine refreshes, and both graded figures it moves —
	// `flameShockWaste` 80.0% (n=5) → 77.8% (n=9) and `gcdUtilisation` 83.722% → 82.898% — move
	// toward *more* fault, so this cannot flatter a pull. See `flameShockAimedTimeline.test.ts`.
	//
	// **The source filter is not optional once the target scope widens.** `auraTimeline` filters by
	// aura id alone, so a second Elemental shaman's Flame Shock on the same enemy would interleave
	// into this stream — their apply is `up` and their remove zeroes a dot still running, which is the
	// exact two-shaman bug `dotWindowsBySpawn` documents. Scoped to the primary that was mostly
	// hidden; over every spawn it is not. No committed fixture has a second shaman, so this changes no
	// figure on any of the four — it is latent correctness, held by a synthetic pull in that test.
	const fsTimelines = new Map<string, readonly AuraPoint[]>();
	{
		const bySpawn = new Map<string, WclEvent[]>();
		for (const e of events) {
			if (e.targetID === undefined) continue;
			if (e.sourceID !== actor.id) continue;
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
	 *
	 * **Keyed through `fsPressAt`, which is what makes the key and every reader of it one edit.** This map
	 * is looked up as `fsAimedAt.get(t)` for each `t` in `fsCasts`, and `fsCasts` is that same accessor
	 * mapped over the same list — so the two cannot come apart under a clock change. Written out as
	 * `press.t` here it could, and silently: a missed lookup is indistinguishable from a press the log
	 * named no target for, and both take the fallback below.
	 */
	const fsAimedAt = new Map(fsPressList.map((press) => [fsPressAt(press), press.spawn]));
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
	 *
	 * **`fsDotAnywhere`, the same correction `fsRemainingAt` carries and for the same reason.** Off
	 * `fsDot.byInstance` a spawn that is not the primary's misses, the walk finds no window, and the
	 * `null` it returns is the *opener* verdict — so a dot that lapsed ten seconds ago on the add being
	 * hit was graded as a first press. This half feeds press `kind` rather than a ladder verdict: on
	 * `addsThenBoss` it moves seven of the 31 Flame Shock presses and no graded figure, `flameShockWaste`
	 * included, which counts refreshes and these are all applications. `flameShockPerSpawn.test.ts` holds
	 * both halves on a two-enemy pull.
	 */
	const downBefore = (spawn: string | null, t: number): number | null => {
		if (spawn === null) return null;
		const windows = fsDotAnywhere.get(spawn) ?? [];
		let previousEnd: number | null = null;
		for (const w of windows) {
			if (w.start >= t) break;
			previousEnd = Math.max(previousEnd ?? 0, Math.min(w.end, t));
		}
		if (previousEnd === null) return null;
		// Charged only for the part the player was present for, the same way `auraDrops` charges a gap.
		return Math.max(0, t - previousEnd - overlapMs(previousEnd, t, fsAway));
	};

	/**
	 * Clearcasting's own windows, for the snapshot attribution each press carries.
	 *
	 * `selfWindows` and not `laneWindows`: the plain walk, with no pre-pull inference. That is the standing
	 * rule this file states at `laneWindows` — an inferred bar is evidence about the pull and never about a
	 * press — and it bites here, because the drawn row *does* infer and a press one second into the fight
	 * would otherwise be told it froze a proc recovered from a bare removal.
	 *
	 * This grades nothing. `clearcasting.test.ts` asserts that no rotation asks for the proc and that the
	 * audit publishes no figure about it, and that still holds: what is published here is an attribution of
	 * a number the report already showed, not a judgement on a press the player made.
	 */
	const clearcastingWindows = selfWindows(CLEARCASTING);

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
		/**
		 * Which of the two applications froze Clearcasting, and the delta with its +20% taken back out.
		 *
		 * Plan §87. `snapshotDeltaPct` above is the sim's own ratio and stays the graded one, but it is a
		 * *total*, and its biggest single term is a proc no reader of this section was ever told about:
		 * `CLEARCASTING_DAMAGE_MULT` is +20% against a threshold of ten, so a stack on one side of the
		 * comparison and not the other clears the bar by itself. That is not a reason to net it out of the
		 * grade (`FS_SNAPSHOT_GAIN` says why) — it is a reason the section has to be able to **name** it,
		 * and the aura being modelled since `8f3f579` is what makes naming it possible.
		 *
		 * Read at the press for the new application and at the press before it on the same spawn for the one
		 * being replaced, which is the same pair of boundaries the strengths themselves come from — so the
		 * proc state and the ratio cannot end up describing different applications.
		 *
		 * **The containment test has to include the closing instant, and this is not a convention.** Flame
		 * Shock is on the sim's `canConsumeSpells` mask, and `applyEffects` runs *before* `OnCastComplete`
		 * (`sim/core/cast.go:329-332`), so a press that spends the last stack is applied with the multiplier
		 * still on. The log writes that as a `removebuff` in the very millisecond of the cast: three of the
		 * fixtures' presses are exactly that, and a half-open reading would call every one of them
		 * proc-free. `inWindow` is inclusive at both ends, and `clearcasting.test.ts` measured the +20% off
		 * the fixtures with the same inclusive test.
		 */
		const clearcasting = inWindow(t, clearcastingWindows);
		const clearcastingBefore =
			bounds !== undefined && Number.isFinite(bounds.previous) ? inWindow(bounds.previous, clearcastingWindows) : null;
		/**
		 * `snapshotDeltaPct` with Clearcasting's term divided out — the part of the gain the proc cannot
		 * explain. Held to being the **identical value** when the proc is not a term at all, which the early
		 * return below guarantees rather than approximates: a reader of the two fields together decides
		 * whether to name the proc by whether they differ, so an epsilon here would be a wrong sentence.
		 */
		const snapshotDeltaWithoutClearcastingPct =
			snapshotDeltaPct === null || clearcastingBefore === null || clearcastingBefore === clearcasting
				? snapshotDeltaPct
				: clearcasting
					? (1 + snapshotDeltaPct) / CLEARCASTING_DAMAGE_MULT - 1
					: (1 + snapshotDeltaPct) * CLEARCASTING_DAMAGE_MULT - 1;
		const exposed = remaining > 0 ? null : downBefore(spawn, t);
		/**
		 * Whether this press was made at a target count `flameShockWaste`'s rule exists at — band 1.
		 *
		 * The same reading, off the same series, as `EarthShockPress.band` above: `aplTargetCountAt` is what
		 * the priority ladder bands each rung on, so the section, the ladder and this flag cannot disagree
		 * about which list one press was under. The argument for band 1 alone — p5's three excuses against
		 * `cleave.apl.json` rung 9's flat `maxOverlap: 2s`, which our last-tick excuse is wider than in one
		 * direction and narrower in the other — is at `FlameShockPress.judged`.
		 *
		 * Published on every press and not only on the refreshes, because it is a fact about the pull at that
		 * instant. Which presses `flameShockWaste` grades is this **and** a live dot under them; the
		 * complement of that pair — what comes out of the graded share — is taken once, at
		 * `fsUnjudgedRefreshes`.
		 *
		 * **The band itself is published beside the flag**, and the flag is derived from it rather than
		 * from a second reading of the series — see `FlameShockPress.band` for why `judged` alone cannot be
		 * captioned, and `earthShockAoeBand.test.ts` for what two readings of one series cost last time.
		 *
		 * **One call to `aplTargetCountAt`, three fields off it**, and the middle one is new: `targets` is the
		 * raw count, `band` is `bandOf(targets)`, `judged` is `band === 1`. All three are functions of a
		 * single reading and so cannot disagree by construction. `targets` exists because band 4 means *four
		 * or more* and the depth chart's per-press tooltip printed it as a flat "4 enemies up" — see
		 * `FlameShockPress.targets`. Reading the series a second time to recover the count would have been
		 * the drift `earthShockAoeBand.test.ts` is about; taking the same reading one step earlier is not.
		 */
		const targets = aplTargetCountAt(t);
		const band = bandOf(targets);
		const judged = band === 1;
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
			judged,
			band,
			targets,
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
			snapshotClearcasting: clearcasting,
			snapshotDeltaWithoutClearcastingPct,
			// A refresh while Ascendance is up is a global thrown away — the list wants Lava Burst then.
			duringAscendance: inWindow(t, ascActiveWindows),
		};
	});
	// An `apply` and a `reapply` both put the dot up; only the refresh states renew one that was running.
	const applies = fsPresses.filter((p) => p.remainingMs === null).length;
	const refreshes = fsPresses.length - applies;
	/**
	 * The refreshes no grade may be taken off: the ones made at a target count the rule does not exist at.
	 *
	 * **The numerator per band the `flameShockWaste` threshold asked for**, and the reason it had to be here
	 * rather than in `score.ts` is that `bands: [1]` on a rule cannot do it — an intersection nulls a metric
	 * only when it comes out empty, and `cleave` resolves to `[1, 2, 3, 4]`, so the declaration intersects
	 * non-empty and narrows nothing. This is the sample narrowing with the pull instead: on `cleave` the two
	 * refreshes were made at one enemy and at four, so one comes out; `phased` and `unbroken` never leave
	 * band 1 and lose nothing.
	 *
	 * Taken as one array so the two counts published off it cannot end up over different sets of presses —
	 * the failure `earthShockGood` was written to avoid, and the same shape as `esPresses`' `good`/`judged`
	 * pair below. Published as the part that comes *out* of the pull-wide ledger rather than as an
	 * independent graded pair; `FlameShockAudit.unjudgedRefreshes` has the two reasons.
	 */
	const fsUnjudgedRefreshes = fsPresses.filter((p) => !p.judged && p.remainingMs !== null);

	// ----------------------------------------------- Flame Shock multi-dot
	// The cleave preset's rule (maxDots 2) keeps the dot on a second target while two enemies are up —
	// the Dark Shaman are the textbook case. The secondary is the second-busiest enemy the player
	// actually hit, and the metric is the dot's uptime on it over the stretches that rule was running:
	// two enemies and not three, which is the one banded clock in this file with an edge at both ends.
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
	/**
	 * The stretches this rule is graded over: **band 2 alone** — two enemies up, and not three.
	 *
	 * **The one clock in this file whose cut is a difference of two arrays rather than the complement of
	 * one, and that is the whole of what is new here.** The other three banded clocks are band-1-or-2
	 * rules: their lower edge is "anything at all", so cutting them is `intersect(wholeClock, gradedSpans)`
	 * and `gradedSpans` supplies the only edge there is. `flameShockMultiDot` declares `bands: [2]` and
	 * means it — `cleave.apl.json` rung 9 is `maxDots: 2`, a rule that does not exist at one enemy because
	 * there is no second target to dot, and does not exist at three because `aoe.apl.json` has no
	 * multi-dot rung at all. So this rule needs **both** edges: a floor at two and a ceiling under three.
	 *
	 * The floor is already here and always was — `multiTargetWindows` is the core's `>= 2` series, which is
	 * why band 1 never reached this figure and why the two single-target fixtures read zero. What was
	 * missing is the ceiling, and it is the same `gradedSpans` the other three take: `>= 2` minus `>= 3`
	 * leaves exactly the stretches at two. Which is the mirror image of the others rather than a different
	 * mechanism — there, band 2 is the last band kept; here it is the only one.
	 *
	 * **Two series and not one, deliberately, and it is worth being precise about what that costs.**
	 * `multiTargetWindows` is `intervalsAtLeast(targetPoints, 2, duration)` and `aoeWindows` is
	 * `intervalsAtLeast(aplTargetPoints, 3, duration, targetWindowMs - effectiveGcd)`: a different count
	 * series (the APL one excludes the spec's own area damage, per plan §41) and a trailing edge trimmed to
	 * one global (`fbc4963`). So the difference is not "the interval where the count was exactly 2" derived
	 * afresh — it is the band-2-or-more clock less the stretches the *ladder* read as its aoe band. That is
	 * the right pair on purpose: the numerator here is a dot the player did or did not keep up, so the floor
	 * wants the damage series that decides whether a second target existed, and the ceiling wants the
	 * ladder's own series, because the question the ceiling asks is which list was running. Re-deriving an
	 * "exactly two" series off either one alone would be a third reading of the target count, free to
	 * disagree with both — the defect `exemptTrack.test.ts` was written after.
	 *
	 * **Both halves of the ratio come off this array**, as everywhere else in this audit:
	 * `multiDotUptimeMs` intersects the secondary's dot with it and `mdGradedMs` is its own length, so the
	 * numerator is inside the denominator by construction. Clipping one half of a band cut and not the
	 * other is how `fsContactMs` once published 100.21%.
	 *
	 * **And the premise that makes the pairing untestable is itself now held.** No committed pull can tell
	 * it from either single-series reading, because this spec declares no `aplTargetCountExclude` and the
	 * two arrays are identical point for point. `bandedClocks.test.ts` asserts exactly that, so it goes red
	 * the day it stops being true — which is the day this expression starts straddling two series that
	 * genuinely differ and wants re-reading against the rule above.
	 */
	const mdGraded = intersect(multiTargetWindows, gradedSpans);
	const mdGradedMs = unionMs(mdGraded);
	const multiDotUptimeMs = unionMs(intersect(fsSecondaryWindows, mdGraded));
	/**
	 * The denominator, and it is the *dot's* clock rather than the pull's.
	 *
	 * Zero when the pull put no second target worth dotting in front of the player, which is a different
	 * fact from a second dot that was never kept up — and the only one of the two this pull can support.
	 * Both readers of this figure already treat it as exactly that gate: `score.ts` grades nothing when
	 * it is zero and the section hides the tile, so a pull whose only other enemy was an immune mine or
	 * an add that died in four seconds is left unjudged instead of being handed a 0% it could not have
	 * beaten.
	 *
	 * **And now also the graded length, which is why it is `mdGradedMs` and no longer the core's
	 * `multiTargetMs` verbatim.** It carries two reasons to be empty rather than one — no second target
	 * worth dotting, and no stretch at two enemies for the rule to be a rule at — and `score.ts` hands it
	 * to `gradedOver` so both arrive as "cannot say". This metric does not get a second field of its own
	 * next to it, the way `lightningShield.gradedMs` did: the shield's `overcapMs` is a *fault count* with
	 * no denominator field anywhere, so its clock had to be published separately, whereas this number *is*
	 * the denominator of the percentage beside it. A parallel `gradedMs` here would be a second name for
	 * one number — exactly what `8d8b1f0` declined to add beside `scoredMs` and `contactUptimeMs`, on the
	 * grounds that they already were the denominator and the numerator.
	 */
	const multiDotMs = secondaryID === undefined ? 0 : mdGradedMs;
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
	/**
	 * **Flame Shock is Lava Burst's ×1.5, and the instant it is judged at is the whole subtlety.**
	 *
	 * The multiplier, not the crit: `BonusCritPercent: 100` in `sim/shaman/elemental/lavaburst.go:48`
	 * is unconditional, so in this model Lava Burst always crits and what Flame Shock grants is a ×1.5
	 * on the damage. "Damage/crit bonus" is one thing, not two.
	 *
	 * **Three instants exist and only two of them are the sim's.** `ApplyEffects` (`:69-80`) tests
	 * `ele.FlameShock.Dot(target).IsActive()` and computes `result` there — at **cast completion** — and
	 * only `DealDamage` is deferred by `WaitTravelTime`. So the sim decides once, before the missile
	 * flies, and a dot that expires during the ~800ms of travel keeps the bonus. A reader who believes
	 * the bonus needs the dot up *at impact* — a natural reading, and one this project was asked about
	 * directly — will see a press credited here and read it as a bug. It is not: the multiplier was
	 * already banked when the cast landed.
	 *
	 * **So this field reads the completion instant, `CastPress.t`, and not the commit** — even though the
	 * row's own `t` is the commit and `surge` and `ascendance` beside it are read there. The two are
	 * different questions and this codebase keeps them apart everywhere else:
	 *
	 *   - *Was this press the right choice?* is judged at the **commit**, because that is when the player
	 *     decided, which is why `surge`, `ascendance` and the APL's whole state read `begin`.
	 *   - *Did the ×1.5 actually apply?* is a fact about the **game**, and the game decides it when the
	 *     cast completes.
	 *
	 * This is the second question — the docstring on the field calls a false reading "threw a third of
	 * the hit away" — so reading the commit would let it answer `true` for a press that demonstrably got
	 * no bonus. That the ladder's Lava Burst rung separately refuses a press whose dot will not outlive
	 * the cast (`auras.remainingMs('flame-shock') > LAVA_BURST_CAST_MS`) does not rescue it: that charges
	 * the *choice*, at the commit, where it belongs, and leaves this field free to state the *outcome*
	 * truthfully. Neither double-counts the other.
	 *
	 * Being published rather than graded makes the literal truth matter more, not less: a figure nobody
	 * is scored on is read as a fact. Empirically the choice is invisible today — commit and completion
	 * agree on all 133 presses across the three fixtures — so the synthetic pull is what pins it.
	 *
	 * **Published, not graded, and `overall()` is untouched.** Every millisecond the dot was down is
	 * already charged by `flameShockUptime` (weight 3), and a Lava Burst inside one of those stretches is
	 * a consequence of that same dropped dot rather than a second mistake. Grading it would mark one
	 * error down twice — exactly why `lightningShield.badSpends` is listed and left ungraded next to
	 * `earthShockGood`. Measured before deciding: **zero** such presses across `cleave`, `phased` and
	 * `unbroken` (43, 49 and 41 presses, every one committed with the dot up), so a metric would also
	 * carry weight while reading a perfect 100% on every pull the repo can check it against.
	 *
	 * **Over every spawn, not `fsDot.byInstance`.** `fsDot` is scoped to the primary, so a Lava Burst
	 * aimed at a dotted add would read as undotted — `cleave` already carries a Flame Shock on `478:1`,
	 * so that is a live shape and not a hypothetical. The fallback to `spawnAt` when the cast event
	 * named no target is `fsAimedAt`'s: judge the press against the enemy every other rule at that
	 * instant is judged against, rather than dropping it out of the audit.
	 */
	const lavaBurstPresses = castPresses(LAVA_BURST).map((press) => {
		const spawn = press.spawn ?? spawnAt(press.begin);
		return {
			t: press.begin,
			surge: inWindow(press.begin, lavaSurgeWindows),
			ascendance: inWindow(press.begin, ascActiveWindows),
			// Null is "no enemy to judge against", which happens only on a pull with no landed hit at
			// all; an empty window list is a real answer — that enemy never carried the dot.
			flameShock: spawn === null ? null : inWindow(press.t, fsDotAnywhere.get(spawn) ?? []),
		};
	});

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
	/**
	 * **The landing clock, and every one of this row's four inputs is a join against an event stream.**
	 *
	 * Stated because it was not: the `Handles` ruling's audit found eighteen of twenty cast readers across
	 * the two specs reading a button with no cast time at all, so the clock each had picked was never
	 * exercised. Earth Shock is one of them — no `castTimeMs` in the model above, and none in the sim:
	 * `newShockSpellConfig` (`sim/shaman/shocks.go:14-40`, shared by both shocks) sets `DefaultCast` to
	 * `{GCD: core.GCDDefault}` and no `CastTime` at all, which is the instant branch of
	 * `sim/core/cast.go`. So `castTimes` and `castBeginTimes` are the same array here and nothing below
	 * is observable yet.
	 *
	 * It would nonetheless stay the landing if that changed, because all four reads are join keys:
	 * `levelAt(lsLevels, t)` against the Lightning Shield stack events, `fsRemainingAt(t)` against the
	 * dot's walked windows, `inWindow(t, twoPieceWindows)` against the Elemental Discharge debuff. Each
	 * of those exists only on a `cast`, `applydebuff` or stack change, so a commit-stamped lookup would
	 * read a shield charge the player had not been granted yet.
	 *
	 * The **one** input that would move is `ascendanceReadyInSec(ascCasts, t)` and the `ascReady` fault
	 * built from it — a claim about what was ready when the player *chose* — plus the row's own `t` if
	 * the table is to say when the button went down. That is the mixed shape the ruling names, and
	 * `castPresses(EARTH_SHOCK)` is what it wants: `press.begin` for those two and `press.t` for the
	 * other three, on one row, rather than two arrays a caller has to line up. Not done today because
	 * with `begin === t` it would be a refactor with no observable half, and `lavaBurstPresses` above
	 * already carries the pattern for when there is one.
	 */
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
		/**
		 * **Which of the sim's three lists judges this press, read at the press.**
		 *
		 * There are three priority lists in `ui/shaman/elemental/apls/` and this audit used to transcribe
		 * one of them onto every pull. `cleave.apl.json` rung 13 spends the shield at **six** stacks with
		 * an **eight**-second dot floor and neither an Ascendance hold nor a two-piece term, so a shock
		 * taken at six on a two-target pull was being faulted for following the rotation.
		 *
		 * **The per-press count, not the pull's mode.** `detectedMode` is one verdict for a whole pull off
		 * a 33% share, and `cleave` runs from one enemy to thirteen inside its four minutes — four of its
		 * twelve shocks land at one target and three at two. A whole-pull band would have judged either
		 * the single-target stretches against the two-target list or the reverse, and both are wrong in
		 * the same way the thing being fixed here is wrong. `aplTargetCountAt` is the same reading the
		 * priority ladder bands each rung on, so the section and the ladder cannot disagree about which
		 * list a press was under.
		 *
		 * **Bands 3 and 4 are not judged at all, and the paragraph this replaces is worth keeping in
		 * mind.** It said the two bands kept the single-target form, called that a known gap, and pointed
		 * at §64 item 3 as the change that would close it — correctly, at the time. Item 3 has since landed
		 * on the ladder side (`0de530e`): `earth-shock` in `apl.ts` is now `bands: [1, 2]`, so at three or
		 * more enemies the ladder has no Earth Shock rung and a shock there is weighed against Chain
		 * Lightning instead. Leaving the single-target form here would have made this section and the
		 * ladder disagree about the same press — the section faulting it for a shield it did not spend
		 * under a list that never asks for the shield to be spent — and the docblock above states exactly
		 * why they must not: `aplTargetCountAt` is the same reading the ladder bands each rung on.
		 *
		 * So the honest answer that paragraph already named is taken: **out of the denominator entirely**,
		 * as `good: null`. `aoe.apl.json` is five rungs and Earth Shock is not one of them — nothing in
		 * that list spends the shield, so there is no rule for the press to be good or bad against and
		 * neither answer is available. It is the same exemption `gradedSpans` already applies to the
		 * shield's overcap clock, the dot's uptime clock and the totem's, for the same reason and off the
		 * same windows.
		 *
		 * Measured, per §90's rule that a declared control has to be shown to separate: on the committed
		 * fixtures this is **five presses, all on `cleave`** — three at band 3 and two at band 4, of which
		 * two read good and three read faults under the single-target form they should never have been
		 * under. `earthShockGood` on that pull moves 6/12 = 50% to 4/7 = 57.14%; `unbroken` and `phased`
		 * are entirely band 1 and do not move at all. No grade and no band changes: 57.14% is still under
		 * the 65% `ok` boundary.
		 *
		 * ## What those five presses are, now that the exemption clock has been measured against them
		 *
		 * **The band is deliberately not trimmed, and this paragraph is the price of that decision stated
		 * rather than left implicit.** `analyseCore`'s `aoeWindows` now cuts a full window of trailing lag
		 * off each exempt stretch, because a stretch closed by the count *falling* closes at
		 * `lastHitOnThirdEnemy + targetWindowMs`, and a clock that forgives that tail is forgiving boss-only
		 * time. `aplTargetCountAt` here keeps the untrimmed reading, on two arguments: a clock charges or
		 * forgives what was *true* at a moment, while a band labels a press by what the player **knew**,
		 * and an add hit a second ago is still an add to the person pressing; and `0de530e` deliberately
		 * made this section read the same series as the ladder so the two cannot disagree about one press,
		 * which trimming one of them would break on purpose.
		 *
		 * So the two readings now differ, and this is by how much. Against the *trimmed* stretches — one
		 * measured global past three-wide contact rather than a full window — **three of the five fall
		 * outside**, shown with the distance from each press back to the last hit on its third enemy and
		 * back to the last hit on any add at all:
		 *
		 * | press | band | inside trimmed | since 3rd enemy | since any add |
		 * | --- | --- | --- | --- | --- |
		 * | 84 144 | 4 | no | 1 681ms | 1 651ms |
		 * | 104 984 | 4 | **yes** | 724ms | 724ms |
		 * | 208 430 | 3 | no | 4 469ms | 4 469ms |
		 * | 220 746 | 3 | **yes** | 1 085ms | 1 085ms |
		 * | 244 241 | 3 | no | 1 304ms | **59ms** |
		 *
		 * **And only one of the three is clearly the window rather than the adds.** 208 430 is 4 469ms past
		 * any add hit — nine tenths of a full window of pure boss time — and nothing defends banding it at
		 * three. 84 144 is marginal, 527ms past the trim boundary. 244 241 argues the *other* way, which is
		 * why this is a measurement and not an error to correct: it is 1 304ms past its third enemy's last
		 * hit but only **59ms** past a hit on an add, so an add was being struck essentially at the instant
		 * of the press. That is a real multi-target moment the *count* had lost rather than boss-only time
		 * being excused — and it is the press inside [244 182, 247 937], the one exempt stretch the trim
		 * drops whole.
		 *
		 * Recorded, not acted on. Nothing here changes a band, a grade or a figure, and `earthShockGood` on
		 * `cleave` stays 4/7 = 57.14%.
		 */
		const band = bandOf(aplTargetCountAt(t));
		const reasons: EarthShockReason[] = [];
		// No list, no verdict. Ahead of the branches rather than inside them, so nothing below can push a
		// reason onto a press nothing is entitled to judge.
		const judged = band === 1 || band === 2;
		if (!judged) {
			// Nothing to test. Left with no reasons, which is what keeps it out of `badSpends` as well: a
			// shock the aoe list never asked to be held cannot be Fulmination thrown away.
		} else if (band === 2) {
			// The Cleave list, and its two terms are the whole rule — see `ES_CLEAVE_STACKS`. No branch on
			// the set, because rung 13 does not mention it.
			if (stacks !== null && stacks < ES_CLEAVE_STACKS) reasons.push('cleaveStacks');
			if (fsRemaining < ES_CLEAVE_FS_MIN_MS) reasons.push('cleaveDot');
		} else if (twoPieceOwned) {
			if (stacks !== null && stacks < lightningShieldCap) reasons.push('belowFull');
			if (remainingIn(t, twoPieceWindows) > ES_TWO_PIECE_TAIL_MS) reasons.push('twoPiece');
			if (fsRemaining < 2 * tickMs) reasons.push('fsTail');
		} else {
			if (stacks !== null && stacks < lightningShieldCap) reasons.push('belowFull');
			if (fsRemaining < ES_FS_MIN_MS) reasons.push('fsLow');
			if (ascReadyInSec < ES_ASC_HOLD_SEC) reasons.push('ascReady');
		}
		return {
			t,
			lsStacks: stacks,
			fsRemainingMs: fsRemaining,
			ascReadyInSec,
			twoPiece,
			band,
			good: judged ? reasons.length === 0 : null,
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
	/**
	 * The clock the overcap is graded on: the pull **less** the stretches the aoe list applied to.
	 *
	 * Nothing in `aoe.apl.json` spends the shield — no Earth Shock rung at all — so sitting at seven
	 * through an add wave is the only state available and cannot be a fault. Band 2 stays in, because the
	 * cleave list still spends it, at `stacks >= 6` rather than 7.
	 *
	 * **`gradedSpans` and no longer a `complementOf` of its own.** This was the first clock in the file to
	 * be cut and it derived its own array; now that the dot's clock and the totem's are cut by the same
	 * rule, three copies of `complementOf(aoeWindows, duration)` would be three chances for one of them to
	 * drift — the identity `exemptTrack.test.ts` exists to enforce, one level in from the charts. So the
	 * array is hoisted to the top of the audit and this is one of its three readers.
	 *
	 * **`atCapWindowsIn` and not `atCapWindows` clipped afterwards**, which is the half of this that is
	 * easy to get wrong: the leeway comes off the *front* of each merged stretch, so a stretch that began
	 * during the adds and ran on into the boss phase would arrive at the boundary with its grace already
	 * spent and be faulted from the first millisecond of single-target play. Cut and restarted per segment,
	 * the swap back to the boss gets its own press's worth of grace. Worth 4 500ms on `cleave` — three of
	 * its seven interior boundaries — and the two readings differ by exactly one leeway per boundary.
	 *
	 * `fellOff` is deliberately **not** on this clock: Rolling Thunder returns 2% of maximum mana per
	 * charge and only while the buff is up, so keeping the shield up is right at every target count and
	 * only spending its stacks is band-dependent.
	 */
	const overcapWindows = atCapWindowsIn(lsLevels, gradedSpans, lightningShieldCap, lightningShieldOvercapMs);
	const overcapMs = unionMs(toIntervals(overcapWindows));
	/**
	 * The length of the clock above — the number that keeps this exemption from becoming a free pass.
	 *
	 * `overcapMs` is a fault measured *inside* `gradedSpans`, so on a pull with no band-1-or-2 stretch at
	 * all it is `0ms` of overcap over `0ms` of gradable time — and `0` against a `good: 0` threshold is
	 * the best mark on the card, handed to exactly the pull the exemption just excused. Every proxy for
	 * "was the thing present" answers a different question: `maxStacks > 0` is true of such a pull,
	 * because the shield was up and counting the whole way through. Only the graded length can say that
	 * nothing was judged, which is why `score.ts` passes it through `gradedOver` and `metricOf` nulls on
	 * a zero.
	 *
	 * Published rather than left for the score to rebuild from `aoeWindows` and `durationMs`. A guard
	 * reconstructed at the reader is a guard free to drift out of step with the thing it guards, and the
	 * whole reason the shield's exempt stretches are published at all is that a second derivation of them
	 * is what `exemptTrack.test.ts` was written after. `ManaAudit`'s two clocks already carry a field of
	 * this name for this exact purpose, so the name is this audit's own rather than invented here.
	 */
	const shieldGradedMs = unionMs(gradedSpans);
	// Fell off: the stretches the shield was down, which is the complement of the stretches it was up.
	// `complementOf` rather than the walk that was written here — same merge, same gap-push, same tail,
	// and it is imported into this file already. `auraLevels` only ever emits stretches at level 1 or
	// above, so every stretch is an up-period and the complement is exactly the down time.
	const downWindows: Window[] = complementOf(toIntervals(levelWindows(lsLevels)), duration).map(([start, end]) => ({
		start,
		end,
	}));
	const fellOff = downWindows.length;

	// ------------------------------------------------------------------ mana
	/**
	 * The pool, and the two buttons that refill it — Amendment 1's section.
	 *
	 * **Read off the bar the cast log already draws**, not walked out of the events a second time. The
	 * engine samples every bar the spec declares and publishes the full audit as `h.resourceAudits`
	 * (`analyseCore.ts:804`), and `resources.mana` is the same object the timeline's row and the section's
	 * chart are drawn from — so the figures below and the line a reader is looking at cannot disagree.
	 * Two independent readings of one pool is how this report has already produced a share above 100%.
	 *
	 * **`samples === 0` is a log that carried no `classResources` at all, and it is not a clean pull.**
	 * Two of the three committed fixtures are exactly that: `phased` and `unbroken` were captured without
	 * `includeResources: true` and hold no reading of the bar, so every figure here is zero on them and
	 * means nothing. The score module reads `samples` and returns null rather than a free full mark —
	 * without that clause the two pulls with no mana data would be the two best-graded mana pulls in the
	 * report.
	 *
	 * Both buttons come out of the raw casts rather than out of the registry, because neither is in it:
	 * `EXTRA_NAMES` names both ids as off-rotation globals, knowingly unpriced, so that `gcdUtilisationPct`
	 * keeps answering "of the globals the rotation wanted, how many did you fill" rather than "was this
	 * player busy". **This section does not overturn that**, and is written so it cannot: nothing here
	 * counts a press as a credit or reaches `cpm`. What it grades is the omission at a pool the cleave
	 * list names a number for, which leaves Thunderstorm off the ladder and out of the global count
	 * exactly where it was.
	 */
	const manaBar = h.resourceAudits.mana;
	const manaCurve: ResourceCurve =
		manaBar !== undefined && manaBar.kind === 'pool' ? manaBar.curve : { points: [], max: 0 };
	const manaSamples = manaBar !== undefined && manaBar.kind === 'pool' ? manaBar.samples : 0;
	const pressesOf = (id: number): number[] =>
		h.events.filter((e) => isCast(e) && e.sourceID === actor.id && abilityIdOf(e) === id).map((e) => e.timestamp - t0);
	const starvedLow = lowStretches(manaCurve, MANA_STARVED_PCT, link);
	const strainedLow = lowStretches(manaCurve, MANA_STRAINED_PCT, link);
	const thunderstormPresses = pressesOf(THUNDERSTORM_ID);
	const starved = manaFault(starvedLow, thunderstormPresses, THUNDERSTORM_CD_MS, duration, GCD_MS, link);
	const strained = manaFault(
		strainedLow,
		pressesOf(SHAMANISTIC_RAGE_ID),
		SHAMANISTIC_RAGE_CD_MS,
		duration,
		GCD_MS,
		link,
	);
	/**
	 * The starved stretches with **both** tools provably still coming back.
	 *
	 * The one number that says "the fight took this mana". At 15% the cleave list wants both buttons, so a
	 * stretch with neither of them back is a stretch no press could have rescued — the same refusal as the
	 * exempt band and the surge wasted inside a submerge. Nothing charges it, and the section says so.
	 */
	const bothOnCooldownWindows = mergeIntervals(
		intersect(
			starvedLow.map(({ start, end }): Interval => [start, end]),
			intersect(starved.busy, strained.busy),
		),
	);
	const bothOnCooldownMs = unionMs(bothOnCooldownWindows);
	/**
	 * The overlap between a charged starved stretch and the shield being down — Amendment 1's link to
	 * Amendment 3, and a cause rather than a coincidence.
	 *
	 * Rolling Thunder (88765) returns 2% of maximum mana per charge it grants, off Lightning Bolt, Chain
	 * Lightning and Lava Beam, and only while Lightning Shield is up — the `ExtraCondition` at
	 * `sim/shaman/talents_elemental.go:131`. So a shield that fell off stopped the pool refilling as well
	 * as stopping the damage, which is the whole reason `lightningShieldFellOff` stays graded at every
	 * target count while `lightningShieldOvercap` does not.
	 *
	 * Against `downWindows` — the array the shield's own `fellOff` is counted from — rather than a second
	 * derivation of when the buff was down. Zero on a pull whose starvation did not coincide with shield
	 * downtime, and the section says nothing about the shield when it is zero: the connection is only made
	 * where the numbers make it.
	 */
	const manaShieldDownMs = unionMs(
		intersect(
			starved.fault.windows.map(({ start, end }): Interval => [start, end]),
			downWindows.map(({ start, end }): Interval => [start, end]),
		),
	);
	const manaLine = (manaCurve.max * MANA_STARVED_PCT) / 100;
	const mana: ManaAudit = {
		samples: manaSamples,
		max: manaCurve.max,
		minPct:
			manaSamples > 0 && manaCurve.max > 0 && manaCurve.points.length > 0
				? (Math.min(...manaCurve.points.map(([, amount]) => amount)) / manaCurve.max) * 100
				: null,
		starvedPct: MANA_STARVED_PCT,
		strainedPct: MANA_STRAINED_PCT,
		floorMs: GCD_MS,
		starved: starved.fault,
		strained: strained.fault,
		bothOnCooldownMs,
		bothOnCooldownWindows: bothOnCooldownWindows.map(([start, end]): Window => ({ start, end })),
		// Stated, never graded — see the field's own docstring for why pressing it early is named and not
		// charged. Read at the press against the last reading at or before it, so a press with no reading
		// behind it at all is not counted as early.
		earlyThunderstorms: thunderstormPresses.filter((at) => {
			const reading = valueAtOrBefore(manaCurve.points, at);
			return reading !== null && reading > manaLine;
		}).length,
		shieldDownMs: manaShieldDownMs,
	};
	// Bad spends: an Earth Shock that spent fewer stacks than the list it was under asks for.
	//
	// **Read off the press's own reasons rather than re-tested here, and that is the fix as much as the
	// band is.** The predicate used to be `p.lsStacks < lightningShieldCap` written out over this array —
	// the aura's ceiling of seven, on every pull, at every target count. `cleave.apl.json` spends the
	// shield at **six**, so a shock taken at six on a two-target stretch was listed here as Fulmination
	// thrown away while the rotation it was following had asked for exactly that. Two copies of one rule
	// is two places for it to drift, and it had already drifted the moment the rule became band-aware; so
	// the rule now lives once, up at the press, and this reads its answer.
	//
	// **Listed, deliberately not graded.** A shock spent under its band's floor already fails one of the
	// conditions behind `earthShockGood` — the reasons below are pushed as reasons a press is not good —
	// so it has already cost the reader a graded metric in the Earth Shock section. Grading it a second
	// time here would mark one mistake down twice and make the summary read worse than the pull was.
	//
	// Which is why this section shows the *table* and no grade on the tile: the row is the evidence, and
	// the verdict on it lives where the press is judged. A review read the missing grade as an oversight;
	// it is the double-count being avoided, and this comment exists so the next one does not have to ask.
	const badSpends = esPresses
		.filter((p) => p.reasons.some((reason) => ES_STACK_REASONS.includes(reason)))
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
	/**
	 * **The two Fire totem placement lists, on the landing clock — the *effect* side of the ruling, and
	 * the counterpart of `feCommits` some four hundred lines below.**
	 *
	 * This file reads the Fire Elemental cast list twice, on opposite sides of `analyseCore`'s `Handles`
	 * ruling, and they coexist today only because the button is an instant. Renamed apart so that a
	 * future edit to one has to see the other:
	 *
	 *   - **Here, `feCasts` / `stCasts` — the landing.** What these are is the instant a summon *began
	 *     occupying* the one Fire totem slot, which is exactly the ruling's "when a totem began occupying
	 *     its slot" example of an effect: the slot walk below closes whatever the slot held at each of
	 *     these stamps, `feWindows` is measured from them, and `stScored` divides by their complement.
	 *     The game destroys the standing totem when the new one lands, not when the player starts
	 *     pressing, so a commit-stamped walk would hand a Searing Totem back seconds of a slot the
	 *     elemental was already in. `fePrepullWindow`'s guard on the next line is a join against the
	 *     aura's own `removebuff` and is on the landing for the join reason instead.
	 *   - **`feCommits`, in the press-verdict block — the commit.** Whether the press was on-rule is a
	 *     claim about what the player knew when they chose.
	 *
	 * Neither totem has a cast time — `registerFireElementalTotem` (`sim/shaman/fire_elemental_totem.go:31`,
	 * `GCD: core.GCDDefault`) and `registerSearingTotemSpell` (`sim/shaman/fire_totems.go:24-28`,
	 * `GCD: time.Second`) each set a GCD and no `CastTime`, which is the instant branch of
	 * `sim/core/cast.go` — so the two lists are identical arrays today and the split above is stated
	 * intent rather than an observable difference.
	 */
	const stCasts = castTimes(SEARING_TOTEM);
	const feCasts = castTimes(FIRE_ELEMENTAL);
	const feAuraWindows = auraWindows(selfEvents, FIRE_ELEMENTAL_AURA, t0, fightEnd, { openAtPull: true });
	const fePrepullWindow = feAuraWindows.find((w) => w.preexisting === true && !feCasts.some((t) => t <= w.end));
	/**
	 * `shamanFireElementalDuration` — the summon's declared length, which two branches of the Earth
	 * Elemental rule are written in, or **null when this log cannot say**.
	 *
	 * The sim's value is a flat fact about the character rather than about the pull: 30 seconds with
	 * Glyph of Fire Elemental Totem, 60 without (`sim/shaman/apl_values.go`,
	 * `TernaryDuration(HasMajorGlyph(GlyphOfFireElementalTotem), 30, 60)`). A log carries no glyph list,
	 * so the pet's **observed** window is the second source, and it answers in one direction only:
	 *
	 *   - A summon that was up for longer than thirty seconds **cannot** have been a thirty-second one,
	 *     so the glyph is not taken and the value is sixty. Definite.
	 *   - Anything shorter is **not** evidence of the glyph, because a sixty-second summon looks exactly
	 *     the same once a Searing Totem takes the fire slot back off it (one Fire totem stands at a time,
	 *     which is why `feWindows` is cut by the slot walk above) or the kill lands inside its minute.
	 *
	 * So it reads sixty or it reads nothing, and the branch that wants `< 60s` can therefore be refuted
	 * but never confirmed. That is stated on `EarthElementalVerdict` too, because it is the reason one of
	 * that rule's three branches has no verdict of its own.
	 *
	 * Off the aura's own windows and not off `feWindows`: the latter gives a cast-derived placement the
	 * *declared* sixty seconds, so reading the glyph out of it would be this constant proving itself.
	 * These are `applybuff`→`removebuff` pairs, and a pre-pull one is clamped at the bell — which only
	 * ever shortens it, so a window past thirty seconds is still proof.
	 */
	const feObservedMs = feAuraWindows.reduce((longest, w) => Math.max(longest, w.end - w.start), 0);
	const feDeclaredDurationMs: number | null =
		feObservedMs > FE_GLYPHED_DURATION_MS + AURA_WINDOW_JITTER_MS ? FIRE_ELEMENTAL_DURATION_MS : null;
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
	 *
	 * **And a third cause, `gradedSpans` — the stretches three or more enemies were up.** The same shape
	 * as the two above and composed the same way, which is the point: `aoe.apl.json` is five rungs and
	 * neither Searing Totem nor Magma Totem is one of them, so above two enemies there is no fire-totem
	 * rung anywhere in the running list and the slot sitting empty is not a totem the player dropped.
	 * The ladder already reads it this way — `apl.ts` bands its `searing-totem` rung `[1, 2]` off the
	 * same sim fact, that Searing Totem is the *single-target* fire totem — so the section and the ladder
	 * cannot now disagree about the same empty slot. Band 2 stays in the clock because `cleave.apl.json`
	 * keeps the totem and promotes it above Flame Shock, Lava Burst, Elemental Blast and Earth Shock.
	 *
	 * Because the numerator follows the denominator here by construction, this really was the one array
	 * literal `searingTotemUptime`'s threshold predicted it would be. Worth 82 858ms on `cleave` and
	 * nothing at all on `phased` or `unbroken`, neither of which ever exceeds one enemy.
	 */
	const stScored = intersect(intersect(contact, complementOf(feWindows, duration)), gradedSpans);
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
	 * The raid's own buffs, bucketed per caster — **hoisted above the Ascendance block because the grade
	 * needs them, not just the chart.**
	 *
	 * This used to sit in the timeline block several hundred lines below, which was fine while its only
	 * reader was the row it draws. §80's rules 3 and 4 made Skull Banner a grading input, and
	 * `ascendanceSync` takes it as an optional parameter that nothing passed — so both rules were correct,
	 * tested and inert. Moving the declaration is the whole of the wiring, and it avoids the alternative,
	 * which was a second walk of the same raid stream for the same windows.
	 *
	 * Unchanged otherwise: `raidLanes.drawn` still feeds the timeline from here, and the argument for
	 * resolving the auras by key rather than naming constants is on that block below.
	 */
	const RAID_SOURCE_AURAS = ['stormlash-totem', 'skull-banner'];
	const raidLanes = raidSourceLanes(
		events,
		registry.auras.filter((a) => RAID_SOURCE_AURAS.includes(a.key)),
		{ t0, pullMs: duration, actorID: actor.id, actors: h.actors },
	);

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
		// Rules 3 and 4's input, and two things in this expression are load-bearing.
		//
		// **`drawn` and `hidden` both.** `raidSourceLanes` caps drawn rows at `RAID_SOURCE_LANES`, because
		// a chart has a row budget. A grade must not inherit one: a seventh warrior's banner is evidence
		// about the pull whether or not there is screen space for it.
		//
		// **`l.source?.id` and not the event's `sourceID`.** That id is the `petOwner`-resolved caster, which
		// is what makes `windows[1]` a warrior's *second press* rather than the second banner object in the
		// stream — the distinction rule 4 turns on, and worth three minutes of error on `cleave`.
		skullBannerWindows: [...raidLanes.drawn, ...raidLanes.hidden]
			.filter((l) => l.key === 'skull-banner')
			.map((l) => ({ source: l.source?.id ?? -1, windows: l.windows })),
	});
	// Mapped over the verdicts rather than over `ascCasts`, so a press and its verdict cannot come
	// apart: `ascendanceSync` maps the cast list one-to-one, and taking the `t` off the verdict is what
	// makes that guarantee structural rather than an index both sides have to agree about.
	const ascPresses = ascSync.presses.map((sync) => ({
		t: sync.t,
		fault: ascendanceFault(sync),
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
	// The talent list the log carried at the bell, or null where it carried none. One read for the file:
	// `combatantinfo` is a single event and the only thing that can answer "was this button even taken".
	const talents = readTalents(events, actor.id);
	const t15Windows = selfWindows(T15_4PC);
	/**
	 * **The landing clock, unstated until now, and this row is the file's clearest *mixed* site.**
	 *
	 * Elemental Mastery is off the GCD and instant, so `castTimes` and `castBeginTimes` are the same
	 * array on it and none of what follows is observable — which is exactly why it is worth writing down,
	 * per the `Handles` ruling's note that eighteen of the twenty cast readers in this project have never
	 * had their clock exercised.
	 *
	 * The row is a verdict — `reason` names which of rule 9's four arms sanctioned the press — so the
	 * *choice* half wants the commit: `isOpener(t)`, and `ascendanceReadyInSec(ascCasts, t)`, which asks
	 * how far Ascendance was from coming back at the instant the player decided to pair the two. But
	 * every one of its inputs is also a **join key** against a walked window list — `fsRemainingAt(t)`
	 * against the dot, `inWindow(t, t15Windows)` against the tier-15 proc, `inWindow(t,
	 * ascActiveWindows)` against Ascendance's own buff — and those are stamped on `applybuff`, i.e. the
	 * landing. So the day this button gains a cast time it needs both instants on one row and not a
	 * re-pointing: `castPresses(ELEMENTAL_MASTERY)`, with `press.begin` for the two choice terms, the
	 * published `t` and the opener test, and `press.t` for the three window lookups.
	 *
	 * Not converted today because with `begin === t` the conversion has no observable half, and a
	 * synthetic that fixed one would be pinning `castPresses`' own contract rather than anything this
	 * block decides — `Ascendance`'s readiness read is where that contract is actually load-bearing, and
	 * `ascendanceClock.test.ts` pins it there once for all five callers including this one.
	 */
	const emPresses = castTimes(ELEMENTAL_MASTERY).map((t) => {
		const ascReady = ascendanceReadyInSec(ascCasts, t);
		// Per spawn, on the same terms as the Ascendance press it is synced with — the `sync` reason is
		// a claim about the dot on the enemy the pair of cooldowns is about to be spent on.
		const fsRemaining = fsRemainingAt(t);
		const t15Active = inWindow(t, t15Windows);
		const ascActive = inWindow(t, ascActiveWindows);
		// `off` split in two, and the split is the whole of the change: the old arm was
		// `!t15Active && (ascReady >= 85 || ascReady < 4)`, whose two disjuncts are opposite situations that
		// the rotation permits for opposite reasons. No press changes side — 4 < 85, so the conditions
		// cannot both hold — and the report gains the ability to say which one it is looking at.
		const reason: ElementalMasteryPress['reason'] = isOpener(t)
			? 'opener'
			: ascReady <= 2 && fsRemaining <= FS_ASC_PREP_MS
				? 'sync'
				: t15Active && (ascActive || ascReady >= 90 || ascReady < 2)
					? 't15'
					: !t15Active && ascReady < 4
						? 'off-near'
						: !t15Active && ascReady >= 85
							? 'off-far'
							: null;
		return { t, reason, ascReadySec: ascReady };
	});
	/**
	 * **The commit clock — the *choice* side of the ruling, and the counterpart of `feCasts` in the Fire
	 * totem slot block above, which reads this same button's presses on the landing.**
	 *
	 * Named apart from `feCasts` rather than sharing it, so neither reading can be moved without seeing
	 * the other. Both are correct today and only because a totem press is an instant; the argument for
	 * each being on the clock it is on is written out at `feCasts`.
	 *
	 * Every term of `fePresses`' verdict below is what the player knew when they pressed. `duration - t`
	 * is how much pull they had left to spend the summon in, and `ascendanceReadyInSec` is how close
	 * Ascendance was to coming back — both read at the decision, because a rule saying "press this when
	 * the fight has under a minute left" is a rule about the moment the button goes down. The row's own
	 * `t` is the commit for the same reason, and matches `lavaBurstPresses` above, which is this file's
	 * precedent for a graded press row: `t: press.begin`, with only the outcome fields on the landing.
	 *
	 * Nothing joins on this list — `fePresses` is published straight onto `fireElemental.presses` and the
	 * bar is drawn from `feWindows` — so unlike `eeCasts` and `ascCasts` there is no join key here
	 * holding it on the landing, and it is the one Fire Elemental reading that can be moved cleanly. The
	 * cooldown-drift row for this button is untouched either way: that reads `castTimes` inside
	 * `analyseCore`, where a cooldown is armed at the landing.
	 */
	const feCommits = castBeginTimes(FIRE_ELEMENTAL);
	/**
	 * Every Fire Elemental **use**, which is not the same list as every cast event.
	 *
	 * A summon made before the bell logs no cast inside the fight window — that absence is the whole
	 * reason `fePrepullWindow` exists — so a list built from `castTimes` alone came back empty on all
	 * three committed fixtures while the same audit drew a 58-second bar and set `prepull: true`. The
	 * section's "Summons" tile printed that empty length, so two parts of one section disagreed about
	 * whether the button had been pressed, and the tile is the one a reader believes.
	 *
	 * A row with provenance rather than `presses.length + (prepull ? 1 : 0)`: the count and the table
	 * come off one list, so they cannot disagree again in the other direction, and `inferred` says which
	 * rows have a cast event behind them. `t: 0` is the honest stamp — the window itself is recovered as
	 * `[0, expiry]` and the press's real instant is not in the log at all.
	 *
	 * `reason: 'prepull'` and not the branch arithmetic below. Fed through that, a pre-pull use would
	 * read `'early'` on every pull longer than three minutes, which is the p5 list's own opening play
	 * scored as a mistake — the "charged the player for something they could not have done" shape this
	 * audit has shipped four times.
	 */
	const fePresses: FireElementalPress[] = [
		...(fePrepullWindow === undefined
			? []
			: [{ t: 0, reason: 'prepull' as const, inferred: true } satisfies FireElementalPress]),
		...feCommits.map((t): FireElementalPress => {
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
			return { t, reason, inferred: false };
		}),
	];

	/**
	 * **Rule 5 of the user's six (plan §80): the Primal Fire Elemental should be out for the whole of
	 * Bloodlust.** The numerator, its own denominator, and the three ways this pull can decline to answer.
	 *
	 * Phrased as an absolute — "100% uptime" — so it grades, on the same reading of the user's wording
	 * that made rules 1 and 2 grades and left 3, 4 and 6 shown: see the header of `./ascendance`, where
	 * the sentence-by-sentence split is argued. Unlike those four this is not a rule about an Ascendance
	 * press, so it is measured here, on the summon, rather than there.
	 *
	 * ## The clock, and why it is one haste cooldown rather than all of them
	 *
	 * **The cooldown that opened inside the opener, and no other** — `isOpener`, this file's own
	 * definition of "on the pull", which is the same narrowing `ascendanceSync` already makes with
	 * `w.start <= ASCENDANCE_INTO_HASTE_MS` and for a reason that binds harder here: *"one that went out
	 * at 90s is a different tactical situation and is not read as the pull's"*.
	 *
	 * That is not tidiness, it is the availability guard. A raid that lusts at three minutes may be
	 * lusting into a stretch where this player's five- or three-minute summon is simply not up, and
	 * faulting them for it would be the "charged the player for something they could not have done" shape
	 * this audit has shipped four times. On a lust *on the pull* there is nothing to guard: nothing has
	 * consumed the cooldown yet, so the summon was available to whoever wanted it, pre-pull or pressed at
	 * the bell. So the one window this rule speaks about is the one window it can speak about honestly,
	 * and a pull whose only haste cooldown came later says nothing at all.
	 *
	 * ## And why the talent gates the clock rather than the value
	 *
	 * §80 states the gate: *"this is only a fault for a player who took the talent"*. Without Primal
	 * Elementalist there is no Primal Fire Elemental to have 100% of — the summon is the ordinary one —
	 * so a shaman who took Unleashed Fury or Elemental Blast instead has not failed this rule, they were
	 * never asked it. Read against `true` and not for truthiness, because `readTalents` answers three
	 * ways and only one of them is "did not take it": a log with no `combatantinfo` has said nothing, and
	 * grading that pull would be the report inventing a talent choice. Both non-answers land on the same
	 * empty clock, which is the right place for them — `metricOf` nulls on `gradedMs <= 0`, so the score
	 * says "cannot say" instead of handing an unasked pull a free full mark.
	 *
	 * ## The numerator is the aura's own windows, not the Fire totem slot's
	 *
	 * `feAuraWindows` and deliberately not `feWindows`. The slot walk stamps every placement with the
	 * *declared* sixty seconds (`untilFightEnd(t, FIRE_ELEMENTAL_DURATION_MS)`), and `feDeclaredDurationMs`
	 * above spells out that Glyph of Fire Elemental Totem halves that and no log carries a glyph list —
	 * so a glyphed player's slot window claims thirty seconds the pet was not standing for, and this
	 * figure would read 100% off a summon that expired halfway through the lust. The aura's windows have
	 * evidence at both ends: an `applybuff`/`removebuff` pair, or the pre-pull recovery clamped at the
	 * bell, which only ever shortens. Merged first, because `overlapMs` sums its ranges and a
	 * re-application inside a window that never closed would otherwise be counted twice.
	 *
	 * ## No contact clock on either half
	 *
	 * Every other uptime in this audit divides by engaged time, and this one does not. The question is
	 * whether the pet was standing, and a phase transition does not despawn it — cutting the stretches
	 * with nothing to hit would shorten both halves of a ratio that is already about the summon rather
	 * than about damage, and would let a pull whose lust landed wholly in a transition read 100% off no
	 * clock at all.
	 */
	const primalElementalist = talents === null ? null : talents.has(PRIMAL_ELEMENTALIST_TALENT_ID);
	const feHasteWindow = primalElementalist === true ? hasteWindows.find((w) => isOpener(w.start)) : undefined;
	const feAuraSpans = mergeIntervals(feAuraWindows.map((w): Interval => [w.start, w.end]));
	const feHasteUptime = {
		gradedMs: feHasteWindow === undefined ? 0 : feHasteWindow.end - feHasteWindow.start,
		coveredMs: feHasteWindow === undefined ? 0 : overlapMs(feHasteWindow.start, feHasteWindow.end, feAuraSpans),
	};

	/**
	 * The Earth Elemental, judged against **all three** branches of the list's own rule, to whatever
	 * depth this log can read each of them.
	 *
	 * `Earth Elemental Rules` (priority 21 of `p5.apl.json`) is an or of three, and the section used to
	 * transcribe the first one and describe the pull as if it were the whole rule. It is not:
	 *
	 * ```
	 * A  remainingTime <= 62s
	 * B  NOT auraIsActive(2894) AND remainingTime >= 5s AND spellTimeToReady(114049) <= 20s
	 *    AND shamanFireElementalDuration == 60s AND spellTimeToReady(114206 Skull Banner) < 20s
	 *    AND spellTimeToReady(2894) > 60s
	 * C  shamanFireElementalDuration < 60s AND NOT auraIsActive(2894) AND spellTimeToReady(2894) < 65s
	 * ```
	 *
	 * **Nothing in it wants the summon before the bell**, which is why this is graded per press and not
	 * by symmetry with `fireElementalPrepull`: at the pull `remainingTime` is maximal so A is false, and
	 * B needs the Fire Elemental's own cooldown more than a minute away, which it is not at the start of
	 * a pull. So the pre-pull *inference* below stays — it is how the row gets drawn (§68) — and it is
	 * not the graded question (§75).
	 *
	 * **Two of the three branches can be refuted and neither can be confirmed**, and the report says so
	 * rather than resolving it:
	 *
	 *   - **B ends at another player's cooldown.** `spellTimeToReady(114206)` is Skull Banner, a warrior's
	 *     button, and no combat log answers when somebody else's cooldown comes back. `spellTimeToReady(2894)`
	 *     is unreadable for a second reason — a pre-pull Fire Elemental logs no press instant, and Primal
	 *     Elementalist decides whether that clock is three minutes or five, neither of which a log states.
	 *   - **C opens on a glyph.** `shamanFireElementalDuration < 60s` is Glyph of Fire Elemental Totem,
	 *     and `feDeclaredDurationMs` above can only ever prove its *absence* — see the argument there.
	 *
	 * So a press that only B or C could have justified reads **`'unknown'`, never a fault**: the nullable
	 * answer §75 decision 2 accepted, and the three-valued discipline `lib/spec/apl.ts` documents. A
	 * press every readable term refutes is `'off-rule'`, which is a real fault. Collapsing the two is how
	 * a report starts inventing them.
	 *
	 * Recovered the same way as the Fire Elemental and for the sharper version of the same reason. This
	 * cooldown had **no** pre-pull inference at all, so a pull with no 2062 cast read as an unused
	 * cooldown whether it was unused or summoned before the bell, and nothing in the report could tell
	 * those apart. `cleave` is that pull: zero presses and no evidence either way until now.
	 *
	 * The verdict is the same expression for an inferred use as for a read one rather than a hardcoded
	 * value. On a pull shorter than the end window a pre-pull summon really is inside branch A, and one
	 * expression cannot disagree with itself about that — the *grading* excludes it, not the reading.
	 *
	 * **On the landing clock, and unlike the Fire Elemental's verdict this one cannot simply be moved.**
	 * Three readers share this list and two of them are join keys: `eePrepullWindow` on the next line
	 * tests the recovered aura window against the presses, and `laneWindows(EARTH_ELEMENTAL_AURA,
	 * eeCasts)` at the timeline does the same for the drawn bar — both exist because the press (2062) and
	 * the buff (118323) are different ids, so `auraWindows`' own per-id guard cannot see the press, and
	 * both are matching against `applybuff`/`removebuff` stamps. The third, `eeVerdictAt(t)`, is a choice
	 * grade whose terms are `remainingTime` and two `spellTimeToReady` clocks read as the player chose.
	 * So this is the mixed shape too, and the day Earth Elemental gains a cast time it wants
	 * `castPresses`: `press.t` for the two guards and `press.begin` for the verdict. Splitting it now
	 * would be two names for one array — the summon is instant
	 * (`sim/shaman/earth_elemental_totem.go:29-32` sets `GCD: core.GCDDefault` and no `CastTime`) — and
	 * would put the guards and the grade on lists a reader could not tell apart.
	 */
	const eeCasts = castTimes(EARTH_ELEMENTAL);
	const eePrepullWindow = auraWindows(selfEvents, EARTH_ELEMENTAL_AURA, t0, fightEnd, { openAtPull: true }).find(
		(w) => w.preexisting === true && !eeCasts.some((t) => t <= w.end),
	);
	const eeVerdictAt = (t: number): EarthElementalVerdict => {
		const remaining = duration - t;
		// A. The one branch a log reads all the way to true.
		if (remaining <= EE_END_MS) return 'near-end';
		const feActive = inWindow(
			t,
			feWindows.map(([start, end]) => ({ start, end })),
		);
		// B's readable terms. `spellTimeToReady(114206)` and `spellTimeToReady(2894)` are not among them,
		// so B can never be true — it is false when one of these refutes it and `unknown` otherwise.
		const bRefuted =
			feActive ||
			remaining < EE_MIN_REMAINING_MS ||
			ascendanceReadyInSec(ascCasts, t) > EE_ASC_SOON_SEC ||
			(feDeclaredDurationMs !== null && feDeclaredDurationMs !== FIRE_ELEMENTAL_DURATION_MS);
		// C's readable terms, on the same footing: `spellTimeToReady(2894)` is unreadable here too, and
		// the glyph term can only come back false or unreadable.
		const cRefuted = feActive || (feDeclaredDurationMs !== null && feDeclaredDurationMs >= FIRE_ELEMENTAL_DURATION_MS);
		return bRefuted && cRefuted ? 'off-rule' : 'unknown';
	};
	const eePresses: EarthElementalPress[] = [
		...(eePrepullWindow === undefined
			? []
			: [{ t: 0, verdict: eeVerdictAt(0), inferred: true } satisfies EarthElementalPress]),
		...eeCasts.map((t): EarthElementalPress => ({ t, verdict: eeVerdictAt(t), inferred: false })),
	];
	// The graded half: read presses only, and `unknown` out of the denominator rather than into it.
	const eeGradable = eePresses.filter((p) => !p.inferred && p.verdict !== 'unknown');
	// Whether the Fire Elemental was already out when the bell went — the prepull press the list makes
	// when Heroism is going up on the pull. The window itself is recovered up at the Fire totem slot
	// walk, which needs it to seed the slot; asking `auraWindows` a second time here would be a second
	// answer to one question, and the two could drift apart on the id list alone.

	// ------------------------------------------------------------ Stormlash
	// The raid's totems, one window per placement, grouped by the shaman who laid it. The buff does not
	// stack, so the overlaps are the section's argument: a totem laid on top of a running one is wasted.
	//
	// **The bucketing is `windowsBySource`' now, not this file's.** It was written here — a loop into a
	// `Map<sourceID, Window[]>` — and Skull Banner is the same walk over a different id, so a second copy
	// of it was the alternative to lifting it. The section's three numbers are unchanged by construction:
	// the shared walk opens a window at every placement and, with no removal in a stream of casts, closes
	// each at `min(start + holdsMs, pullMs)`, which is exactly what `untilFightEnd` did here. Clamped for
	// the same reason it was: a totem laid with five seconds of fight left does not run its full ten, and
	// its two neighbours clamp too — the timeline rows below and `stormlashOverlaps`, which closes at
	// `duration` — so an unclamped reading had the section's three numbers measured three different ways.
	//
	// `raidStormlash` goes in branded, which is the point of the brand: a walk that buckets by *caster* is
	// meaningless on a stream narrowed to one actor and would answer with one bucket rather than fail.
	// **No `onTarget`** — a placement lands on nobody, and the fetch is already narrowed to the one id.
	const stormlashShamans: StormlashAudit['shamans'] = windowsBySource(raidStormlash, STORMLASH_TOTEM.castIds, {
		t0,
		pullMs: duration,
		holdsMs: STORMLASH_DURATION_MS,
	}).map(({ source, windows }) => ({
		id: source,
		name: h.actors.find((a) => a.id === source)?.name ?? null,
		windows,
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
	/**
	 * The totems that actually reached this player, one row per instance — **and §80's rule 6 on the
	 * player's own.**
	 *
	 * ## Which source, because the obvious one is empty
	 *
	 * `stormlashShamans` above is the raid's *placements*, off `raidStormlash` — a separate fetch, and
	 * **no committed fixture carries it**: `shamans` is `[]` and `totems` is `0` on all three. A table
	 * built off it would render empty on every pull we hold while looking finished, which is the failure
	 * mode plan §93 named. So the rows come off `raidLanes` instead — the aura walk over the fight's own
	 * stream, narrowed by `onTarget` to the buff that landed on this player — which has 2, 4 and 4 rows.
	 * The two are not two readings of one fact: one is what the raid laid, the other is what reached the
	 * player, and only the second is answerable without the extra fetch. The section says so in as many
	 * words rather than leaving a reader to reconcile a table of four totems with a tile reading zero.
	 *
	 * `drawn` **and** `hidden`, for the same reason the Skull Banner argument above takes both: a chart
	 * has a six-row budget and a table does not, and a seventh shaman's totem is a fact about the pull
	 * whether or not there is screen space for its lane.
	 *
	 * ## Which question rule 6 asks — the cast, not the overlap
	 *
	 * The user's words are "Stormlash should ideally **not be cast** during Ascendance", and this reads
	 * them literally: the press, inside the player's own Ascendance. Lane F measured that at **0 of 3**
	 * committed pulls, and measured the *overlap* reading — the player's own totem merely running inside
	 * the window — at 1 of 3 (`phased`, 7 136 of that totem's 9 714 ms). The overlap has the bigger
	 * number and is still the wrong question, for a reason no amount of data settles:
	 *
	 * **An overlap is not a fault, it is the good case.** Stormlash procs off what the raid does while it
	 * is up, so a totem running through a burst window is worth *more*, not less. What costs something is
	 * the **global**: during Ascendance every one of them was wanted on Lava Beam, which is the identical
	 * argument the Flame Shock ladder already makes about a refresh under Ascendance ("a global the list
	 * wanted on Lava Burst"). Reporting the overlap as an improvement would have printed a benefit as a
	 * problem and told a reader to stop doing something right.
	 *
	 * **So the row is empty of faults on all three fixtures, deliberately.** That is the honest answer
	 * and not a hole: these three pulls did not make this mistake, and the table says so on the rows it
	 * does have rather than by showing nothing. It can fire — a press eleven seconds into an opener that
	 * began at five is all it takes, and `stormlash.test.ts` builds exactly that — so this is not the
	 * 144998 shape of an id the game never writes.
	 *
	 * ## Off the press, not off the bar
	 *
	 * The buff goes up after the summon lands: 807 ms later on `phased`, 192 on `unbroken`, 214 on
	 * `cleave`. The global was spent at the press, so the press is what is tested, recovered as the
	 * latest own cast within one totem's lifetime of the bar opening. Anything else keeps the bar's own
	 * start, which is the only reading available for a totem whose press this log did not carry.
	 *
	 * A press that never put the buff on the player at all has no row, and cannot: this list is the
	 * totems that *reached* them. That costs nothing observable — a shaman is inside their own totem's
	 * radius when they drop it — and the alternative is a row with no bar in a table of bars.
	 */
	/**
	 * **The landing clock, and this one is a pure *join key*, so it is the only one of the file's unstated
	 * sites that would not move even in principle.**
	 *
	 * `stampAtOrBefore(stormlashPresses, w.start)` matches a press against `w.start`, and `w.start` is
	 * the buff bar's own opening off `raidSourceLanes` — an `applybuff` stamp. The ruling puts a join on
	 * whichever clock the other side carries, and this side has to be able to sit *before* that stamp by
	 * a bounded amount: the block above measures the buff landing 807 ms after the press on `phased`, 192
	 * on `unbroken`, 214 on `cleave`, and the recovery is "the latest own cast within one totem's
	 * lifetime of the bar opening". A commit-stamped list would widen that gap by the cast time in the
	 * only direction the search can already be wrong, for no gain — the question here is which press this
	 * bar came from, not whether the press was a good one.
	 *
	 * Instant today in any case: `registerStormlashCD` (`sim/shaman/stormlash_totem.go:24`) registers the
	 * summon with no `CastTime`.
	 */
	const stormlashPresses = castTimes(STORMLASH_TOTEM);
	const stormlashReceived: StormlashReceived[] = [...raidLanes.drawn, ...raidLanes.hidden]
		.filter((l) => l.key === 'stormlash-totem')
		.flatMap((l) =>
			l.windows.map((w): StormlashReceived => {
				const source = l.source ?? { id: -1, name: null, own: false };
				const press = stampAtOrBefore(stormlashPresses, w.start);
				return {
					t: w.start,
					end: w.end,
					source,
					duringAscendance:
						source.own && press !== null && w.start - press <= STORMLASH_DURATION_MS
							? inWindow(press, ascActiveWindows)
							: source.own
								? inWindow(w.start, ascActiveWindows)
								: null,
				};
			}),
		)
		.sort((a, b) => a.t - b.t);

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
		// The three on-GCD buttons the ladder declares off its own business, so their presses read
		// `off-list` with the section that judges them named, instead of being charged to whichever filler
		// rung the band happened to leave standing. The declaration lives on the ladder and is read here:
		// `LADDER` and this belong to the same transcription, and a second copy of the id list in this file
		// could disagree with it.
		unarbitrated: UNARBITRATED,
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
	 * `flameShock.uptimePct` is the graded clock's reading (`fsContactWindows` over `fsGradedMs`) and it is
	 * measured a long way above this; the primary's row is `dotLaneWindows(FS_DEBUFF)` — the very array the
	 * lane already drew — so the row the reader compares the figure against is unchanged, and the enemies
	 * added beside it are rows the figure was never measured over. The three reference pulls read 98.2015%,
	 * 100% and 72.2979% before this block existed and read the same after it. `cleave`'s third figure has
	 * since become 83.8989% by a change to that clock rather than to these rows, and
	 * `flameShockTargetLanes.test.ts` keeps the other two pinned as the evidence of which cause it was.
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
	 * One row per raid buff another player cast on this shaman, per caster.
	 *
	 * **This replaces the merged `stormlash-totem` lane, which was the player's own cast plus ten seconds.**
	 * The row is now the shaman rather than the pull, so four shamans staggering totems read as four rows a
	 * reader can see stacking instead of one bar saying "a totem was up here".
	 *
	 * **Per caster and not per instance, which is a correction to what shipped first.** The first version drew
	 * a row per totem, on the argument that a row is one totem and two rows for one shaman are the evidence
	 * of a shaman who laid two. The user reported it: "multi stormlash casts of the same player show up in
	 * new rows, not 1 row per player containing 2 buffs". They are right — a row whose name repeats three
	 * times down the block stops identifying anything, and the block then grows with presses rather than
	 * with the raid. Both bars still exist inside the one row, with the gap between them drawn, which is the
	 * fact the extra rows were being spent on.
	 *
	 * **The player's own press merges into their own row, which is the other half of that report:** "stormlash
	 * cast of yourself is not merged with the buff aura". The earlier reasoning here — that the press and the
	 * window are two readings of one fact and only the window is the same currency as the other shamans'
	 * rows — was wrong about what a reader wants. Their cast of the totem and the totem's bar are one totem,
	 * and splitting them puts the same event on two rows. `LaneSource.own` is how the chart knows which of
	 * several same-key rows is the player's, because `CastTimeline` reads an `Analysis` and has no actor id.
	 *
	 * `raidScoped(h.events)` is the fight's whole stream, and `raidSourceLanes` narrows it to what landed on
	 * *this* player. That narrowing is load-bearing rather than tidy: `phased` carries 38 applications of one
	 * shaman's totem going out across the raid, of which one is on this shaman, and bucketing all 38 by
	 * caster would report one caster with 38 instances.
	 *
	 * **Which buffs, and why by key.** Both are raid-wide, cast by somebody else, and do not stack — the
	 * shape `LaneSource` exists for. Resolved out of the registry rather than named as constants so that a
	 * buff the model has not declared is simply absent instead of a crash: `skull-banner` belongs in
	 * `game/shared.ts` (it lands on a monk exactly as it lands on a shaman) and the day it is declared there
	 * both specs draw it with no further edit here.
	 */
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
		// One row per Stormlash and per Skull Banner this shaman was actually given, whoever cast it — the
		// player's own first. Where the single merged Stormlash row used to be, so the declared order finds
		// them in the same place; see `raidLanes`.
		...raidLanes.drawn,
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
		// The other summon, which had no row at all: it was excused in `drawnAuras.test.ts`' `NOT_LANES`
		// ledger as "declared for the pre-pull inference", and that excused the status quo rather than a
		// decision. It has the strongest rotational claim of anything on that list — the summon costs a
		// global and holds the earth totem slot for its whole minute, which is exactly what a reader
		// cannot see from the press mark alone — and `TIMELINE_ROW_ORDER` has named an `Earth Elemental`
		// row since before there was an aura to fill it.
		//
		// `eeCasts` as the press guard, and for the same reason Ascendance needs one: the press is 2062
		// and the buff is 118323, so `auraWindows`' own "was this opening logged in-fight" test — which is
		// per id — cannot see the press that opened a window it is about to call pre-pull. Through
		// `laneWindows` rather than `selfWindows` so the bar shows a pre-pull summon, and the press
		// verdicts above keep the plain reading: `earthElemental.presses` is unchanged either way.
		lane(EARTH_ELEMENTAL_AURA, 'buff', laneWindows(EARTH_ELEMENTAL_AURA, eeCasts)),
		lane(LAVA_SURGE, 'proc', laneWindows(LAVA_SURGE)),
		/**
		 * **Clearcasting, as one row on the cast log and deliberately not on the summary timeline.**
		 *
		 * The drawn-aura guard gives two ways out — a row, or a `NOT_LANES` entry with a reason — and the
		 * argument for a row is that this is the largest *unseen* multiplier on the spec. A reader looking at
		 * a Flame Shock press wants to know whether it snapshotted +20%, and this row is the only place in
		 * the report that can tell them.
		 *
		 * **Which chart it lands on is what makes the row affordable, and it is not this line that decides
		 * it.** `lanes` is what the cast log draws; the summary timeline draws
		 * `SUMMARY_LANE_KEYS` — an allow-list in `lib/view/timelineBanks.ts` that this key is not on and
		 * should not be added to. So the noise objection is answered by where it is drawn rather than by
		 * whether: on the cast log the row is zoomable, per-press, and toggleable with the rest of its group,
		 * which is exactly the reading it is for; on the four-minute summary those 40–46 windows would be a
		 * picket fence beside five rows a reader is trying to line up. Measured per pull, this row carries
		 * **40, 38 and 46 windows** on `unbroken`, `phased` and `cleave` — the same order as the
		 * `lava-surge` row directly above it, which is why that row is the precedent rather than a
		 * counter-example.
		 *
		 * **Not a bank either, which was the other option.** Lightning Shield is drawn as a counter because
		 * something fills it, it holds a ceiling, and a press spends it whole — so sitting at the cap and
		 * falling off are faults worth reddening. None of that is true here: the stacks are consumed by the
		 * casts the player was making anyway, no rotation asks for them (see the aura's own declaration),
		 * and a bank with fault windows would print a fault this proc cannot have. Two stacks read off the
		 * `stacks` field on the bar is the whole of what there is to say.
		 *
		 * `'proc'` and not `'buff'`: a crit puts it up, not a press — the same call `lava-surge` makes.
		 */
		lane(CLEARCASTING, 'proc', laneWindows(CLEARCASTING)),
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
		/**
		 * **The fifth of that group, and the one the drawn-aura guard was structurally unable to ask for.**
		 *
		 * `essence-of-yulon` fires plainly — 13, 18 and 16 `applydebuff` of 146198 across the three
		 * committed pulls, asserted in `lib/game/__tests__/sharedFixtures.test.ts` — and had neither a row
		 * nor a `NOT_LANES` entry. It went missing for a reason worth writing down rather than fixing
		 * quietly: **it is an enemy debuff, and the guard walks auras put on the *player***
		 * (`aurasPutOnPlayer`). So the sweep that caught the four rows above could not have flagged this
		 * one however busy it got, and neither could the undeclared-id ledger beside it, which reads the
		 * same player-scoped stream. Same class as the third failure mode that ledger was built for,
		 * wearing a different hat — and `shared.ts`' own declaration already records the *declaration* half
		 * of it: "a Buffs sweep is structurally incapable of finding one".
		 *
		 * A row rather than a ledger entry, and the ledger is not merely the lazier option — it is
		 * unavailable. `staleExcuses` fails any `NOT_LANES` key that fires on no pull's player-scoped
		 * sweep, and this key fires on none of them, so writing the reason down would break the guard that
		 * keeps reasons honest. `drawnAuras.test.ts` records that dead end where a reader would look for it.
		 *
		 * `'proc'` and not `'debuff'`: the group is what the row's tone claims about agency, and this is
		 * something the cloak did, not something the player aimed. The two rows on this timeline that are
		 * `'debuff'` — Flame Shock and Elemental Discharge — are both presses.
		 */
		lane(ESSENCE_OF_YULON, 'proc', procDebuffLaneWindows(ESSENCE_OF_YULON)),
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

	// The enemies past the cap, in the same shape, and the raid-buff instances past theirs. Not in `lanes`,
	// deliberately: that array is what the chart draws, and these are what it may be asked to draw instead.
	// `hiddenTargets` stays a count of *enemies* — the caption it feeds says "enemies" — so the raid-buff
	// overflow is carried without being counted there.
	const hiddenLanes: AuraLane[] = [...fsTargets.rest.map(targetLane), ...raidLanes.hidden];

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
			// Over `fsGradedMs` and not `inContactMs`: the same clock `fsContactWindows` was clipped to, so
			// the two halves of this share are one array's numerator and that array's own length.
			uptimePct: uptimePct(fsContactWindows, fsGradedMs),
			applies,
			refreshes,
			windowed: fsPresses.filter((p) => p.windowed).length,
			ascPrep: fsPresses.filter((p) => p.ascPrep).length,
			// Off the *kind* and not off the delta, which is what keeps the three excuses from overlapping:
			// a press that was already `windowed` carries a delta too, and counting it here would subtract
			// it from `flameShockWaste` twice.
			snapshotGain: fsPresses.filter((p) => p.kind === 'snapshot').length,
			// What comes out of the graded share, beside the pull-wide counts above rather than in place of
			// them: the tiles and the verdict sentence report every refresh the player made, and only the
			// score is narrowed.
			unjudgedRefreshes: fsUnjudgedRefreshes.length,
			// `early` is exactly "a refresh with none of the three excuses" — the kinds are ordered so a press
			// can be credited once, so this cannot double-subtract the way a hand-written conjunction can.
			unjudgedWaste: fsUnjudgedRefreshes.filter((p) => p.kind === 'early').length,
			tickMs: fsTickMs,
			durationMs: FLAME_SHOCK_DURATION_MS,
			presses: fsPresses,
			multiDotUptimeMs,
			multiDotUptimePct,
			// The band-2 clock and no longer the core's `>= 2` one: the same field, the same role — this
			// share's denominator and its gate — measured over the stretches rung 9 was a rule at.
			multiTargetMs: multiDotMs,
			// The subject, beside its clock, so a zero clock can say which of its two causes it was. Null
			// rather than `undefined`, because an `Analysis` is serialised and `undefined` does not survive
			// `JSON.stringify` — an absent key and "no second target" would then be one value again.
			secondaryID: secondaryID ?? null,
			scoredMs: fsGradedMs,
			contactUptimeMs: fsContactMs,
			// The same merge the figure above is the union of, so the drawn clock and the printed
			// percentage cannot disagree. Built at `fsContactWindows` and published rather than rebuilt.
			contactWindows: fsContactWindows,
		},
		mana,
		lavaBurst: {
			procs: lavaSurgeProcs,
			presses: lavaBurstPresses,
			wasted: lavaSurgeProcs.filter((p) => p.wasted).length,
		},
		earthShock: {
			presses: esPresses,
			// `=== true` and `!== null`, not the truthiness of either: `good` is nullable now, and `!p.good`
			// would fold the unjudged presses in with the faulted ones — which is the exact reading the band
			// exemption exists to stop.
			good: esPresses.filter((p) => p.good === true).length,
			judged: esPresses.filter((p) => p.good !== null).length,
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
		elementalMastery: {
			// A talent list the log carried with 16166 absent is a real "not talented"; no list at all is a
			// report that cannot say, and must not render as a choice the player made. Same three-state
			// field and same reasoning as the Windwalker's Chi Brew (`windwalker/lib/index.ts:2244`).
			//
			// **16166 really is a talent and Ascendance really is not**, which is why only this button gets
			// the field: Elemental Mastery is tier 4 column 0 of the shaman tree
			// (`ui/core/talents/trees/shaman.json:87-93`) and gated at `sim/shaman/talents.go:37`, while
			// 114049 appears in none of the tree's eighteen entries and is registered unconditionally at
			// `sim/shaman/shaman.go:245`. All three committed fixtures carry a list *without* 16166.
			talented: talents === null ? null : talents.has(ELEMENTAL_MASTERY_TALENT_ID),
			presses: emPresses,
		},
		fireElemental: { presses: fePresses, prepull: fePrepullWindow !== undefined, hasteUptime: feHasteUptime },
		earthElemental: {
			presses: eePresses,
			prepull: eePrepullWindow !== undefined,
			good: eeGradable.filter((p) => p.verdict === 'near-end').length,
			graded: eeGradable.length,
		},
		stormlash: {
			shamans: stormlashShamans,
			overlaps: stormlashOverlaps,
			totems: stormlashTotems,
			received: stormlashReceived,
		},
		lightningShield: {
			points: lsPoints,
			maxStacks: lightningShieldCap,
			overcapMs,
			gradedMs: shieldGradedMs,
			leewayMs: lightningShieldOvercapMs,
			// The stretches `overcapMs` above dropped, so the chart can grey exactly what the denominator
			// refused rather than a second guess at it — the rule `exemptTrack.test.ts` exists to enforce.
			aoeWindows: aoeWindows.map(([start, end]): Window => ({ start, end })),
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
