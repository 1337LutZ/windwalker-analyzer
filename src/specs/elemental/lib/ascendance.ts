// The Ascendance press rules: whether each press rode the cooldown it was supposed to ride.
//
// `elementalAudit` already read every input this needs — `ascCasts` from `castTimes(ASCENDANCE)`, the
// core's `hasteWindows`, `t16DebuffWindows`, the contact clock — and `FlameShockPressKind` already
// carried an `'ascPrep'` arm, so the audit knew Ascendance prep existed. What it never did was grade
// the press. This module is that grade and nothing else: a pure function over values the audit
// already holds, which is what let it be built while four lanes were writing `index.ts` and wired in
// afterwards as one call. It is wired now — `elementalAudit`'s Ascendance block calls
// `ascendanceSync` and publishes the verdicts on `AscendanceAudit`.
//
// ------------------------------------------------------------- the two rules, from the sim's list
//
// Not invented here. `wowsims-mop/ui/shaman/elemental/apls/p5.apl.json` casts Ascendance (114049)
// from exactly two priority entries, and the order they appear in is part of the rule:
//
//   priorityList[14]  dotRemainingTime(8050) > 15s  AND  currentTime <= 5s
//   priorityList[15]  dotRemainingTime(8050) > 15s  AND  auraRemainingTime(CurrentTarget, 144999) >= 10s
//
// So the list presses Ascendance in the opener unconditionally, and presses it later only when
// **Elemental Discharge** — the T16 two-piece debuff — has ten seconds or more left on the target.
// Those are the user's two sentences, in the simulator's own numbers: "max 4-5 seconds into
// Bloodlust (if on pull)" is entry 14, and "if the T16 two-piece is present, sync it with that" is
// entry 15.
//
// **Which press gets which rule is therefore settled by the press, not by the player's gear.** The
// first Ascendance of a pull *is* the opener press, and entry 14 governs it. Every later press is at
// least one 180-second cooldown further in, so `currentTime <= 5s` can never hold for it and entry 15
// is the only rule that can. One total decision, no press judged twice — see `ascendanceSync`.
//
// This is a deliberate departure from "the two-piece rule replaces the Bloodlust rule outright", and
// the reason is measurable rather than aesthetic. All three committed pulls press Ascendance in the
// opener with no Elemental Discharge up at all — `phased` at 5 006 ms, `unbroken` at 3 676 ms,
// `cleave` at 3 487 ms, against first debuff windows opening at 26 490, 23 057 and 24 794 ms. Judging
// the opener against the discharge would fault every one of them for something entry 14 explicitly
// sanctions, which is the "charged the player for something they could not have done" bug this audit
// has already shipped four times.
//
// **The Flame Shock half of both entries is deliberately not graded here.** `dotRemainingTime(8050) >
// 15s` is the Flame Shock section's business and the audit already publishes `fsRemainingMs` on every
// Ascendance press for it. Grading one press against the same condition in two sections is how a
// report ends up contradicting itself.
//
// ------------------------------------------------ the two absolute rules, from the user (plan §80)
//
// Two more sentences, and both are phrased as absolutes — Ascendance is **always** used in the opener,
// and it must **never** lose uptime to the end of the fight. Plan §80 settled that the absolutes among
// the user's six new rules are *graded* while the hedged ones are shown with a reason, so both of these
// arrive as grades.
//
// **Neither is a third arm.** Each is a second condition inside the arm that already governs its class
// of press, and the pair is symmetric:
//
//   press 0    (entry 14)   pressed inside the opener      AND   no more than ASCENDANCE_INTO_HASTE_MS
//                           — absolute, anchored on the          into a haste cooldown, *when the raid
//                           bell                                 brought one* — conditional
//
//   press >= 1 (entry 15)   the fifteen seconds fit        AND   ten seconds of Elemental Discharge
//                           before the kill — absolute,          left, *when the two-piece is in
//                           anchored on the bell                 evidence* — conditional
//
// So a press's grade is the **and** of one unconditional demand and one that only applies when the log
// carries the thing it measures against. That is what "a fault rather than one branch among several"
// (§80) means concretely, because both absolutes used to be *refusals*:
//
//   - A pull that brought no haste cooldown came back `'no-cooldown-on-pull'` and its opener went
//     ungraded. **That reason is gone.** Opening with Ascendance needs no raid cooldown, so a missing
//     one is a missing *measurement* — `delayMs` and `syncStartMs` come back null and rule 1 grades the
//     press by itself.
//   - A press too late for the sync came back `'pull-ends-too-soon'`. That reason survives, but only
//     where the button could not have been pressed sooner — see `ASCENDANCE_DURATION_MS`.
//
// **Precedence is unchanged, and it is still the press index that decides it.** The index picks the
// class first, and the class's own absolute follows; no press is read by both classes. That ordering is
// what keeps the two absolutes from contradicting each other on a pull shorter than fifteen seconds:
// entry 14 *asks* for the opener press, so the opener is graded on rule 1 and is never faulted for a
// window the kill cut short. Rule 2 judges only presses the player chose the moment of, which is the
// class entry 15 governs — and `wastedMs` is still reported on the opener, because the measurement is
// true even where no rule charges for it.
//
// ---------------------------------------------------------------- the haste cooldown
//
// Not re-derived, and deliberately not a bare spell id. `src/lib/game/shared.ts:132-155` declares the
// whole group as one aura — `ids: [2825, 32182, 80353, 90355, 146555]`, named for the effect rather
// than for any one spell, with `variants` saying which was actually cast — and `analyseCore`'s single
// `auraWindows(selfEvents, spec.registry.aura('bloodlust'), …)` walks it once and publishes the result
// on `Handles.hasteWindows`, precisely so a spec's audit reads the cooldown instead of walking the
// stream a second time. This module takes those windows as a parameter and never names a spell.
//
// That it works for the whole group is measured, not asserted: the three committed pulls carry three
// *different* members of it — Heroism (32182) on `phased`, cast by another player; Bloodlust (2825) on
// `unbroken`, cast by the shaman himself; Time Warp (80353) on `cleave`. All three read identically.
//
// Two consequences of that walk are load-bearing below, and neither is this module's to fix:
//
//   - The Bloodlust aura declares no `durationMs`, so `auraWindows`' `openAtPull` inference can never
//     fire for it (`auraWindows` refuses that rule without a duration bound). A haste cooldown cast
//     *before* the bell leaves nothing in a fight-scoped stream but its own `removebuff`, which the
//     default walk discards. Such a pull reads as "no haste cooldown on the pull" and is not graded —
//     silence, not a zero.
//   - `hasteWindows` is built from `selfEvents`, i.e. events whose `targetID` is the player
//     (`events/parse.ts:26`), so a shaman who lusts the raid does not close his own window with
//     somebody else's `removebuff`. Measured: `unbroken` carries 45 events of id 2825 and comes back
//     as exactly one window, `[785, 40790]`.
//
// ------------------------------------------------- the T16 two-piece, and the id it must NOT read
//
// Established from the simulator, the 5.4 client data and all three committed pulls.
//
// The set is `ItemSetCelestialHarmonyRegalia` (`wowsims-mop/sim/shaman/items_mop.go:98`). Its
// two-piece (`items_mop.go:100-140`) registers **one** aura, on the enemy:
//
//     ActionID: core.ActionID{SpellID: 144999}, Duration: time.Second * 2, MaxStacks: 6,
//     OnStacksChange: aura.Duration = time.Second * 2 * time.Duration(newStacks)
//     …AttachProcTrigger({ Callback: CallbackOnSpellHitDealt, Outcome: OutcomeLanded,
//       ClassSpellMask: SpellMaskFulmination, TriggerImmediately: true,
//       Handler: debuff.SetStacks(sim, shaman.LightningShieldAura.GetStacks()-1) })
//
// **This is why the rule is gradeable at all.** There is no `ProcChance` and no `ICD` on that
// trigger: every landed Fulmination applies it, and its length is `2s × (Lightning Shield charges
// consumed)`, capped by `MaxStacks: 6` at twelve seconds. So the player chooses both whether it is up
// and how long it lasts, and entry 15's ten-second demand means Fulminating at near-full charges
// immediately before pressing Ascendance. That is a window a player can aim at — unlike the T16
// *four*-piece, which is a 10-second guardian summon on a 60-second internal cooldown off a landed
// Lightning Bolt (`items_mop.go:141-153`), a die roll with nothing to aim at and no relationship to
// Ascendance whatsoever. The four-piece is not graded and should not be.
//
// **Read 144999 and never 144998.** 144998 is a *set-bonus passive*: the simulator only ever
// `ExposeToAPL`s it (`items_mop.go:138`), the client's `Spell` row for it has an **empty**
// `AuraDescription_lang` and a description that merely forwards 144999's numbers, and it is a row in
// `ItemSetSpell` (SpellID 144998, Threshold 2, ItemSetID 1182). A combat log never writes it. Across
// all three committed pulls 144998 appears **zero** times, while 144999 appears 20, 18 and 24 times as
// `applydebuff`/`refreshdebuff`/`removedebuff` sourced by the player. In the p5 list `auraIsActive(144998)`
// is a *"do I own the two-piece"* branch selector for the Earth Shock rules, not a window.
//
// The audit models **only** 144999, as the `t16-2pc-debuff` aura. It used to carry a `t16-2pc-proc`
// declaration for 144998 beside it, and `344af23` (plan step 49) deleted that: an aura keyed to an id
// the game never writes could only ever draw an empty lane and read as "the proc never fired". The
// paragraph above stays because the id is still the trap — it is the number in the p5 list, so the next
// reader of that list will reach for it — but nothing in this codebase reads it any more. This module
// takes the live windows as a parameter and touches no declaration.

import type { AuraWindow } from '~/lib/analysis/auras';
import type { Interval } from '~/lib/analysis/intervals';
import type { Window } from '~/lib/types';

/**
 * How far into the raid's haste cooldown the opener may go before the press reads as late.
 *
 * **One number, and this is why it is 5 000 ms rather than the 4 000 the request also allowed.**
 *
 *   1. It is the simulator's own opener horizon. `priorityList[14]`'s second condition is literally
 *      `currentTime <= 5s`. The anchor differs — the sim measures from the pull and this rule measures
 *      from the haste cooldown opening, because the user's rule is explicitly "into Bloodlust" — so
 *      entry 14 settles the *magnitude* rather than the comparison, and it is quoted for that and
 *      nothing more. On a lust-on-pull the two anchors are within a second of each other anyway: the
 *      three committed pulls open theirs at 1 777, 785 and 941 ms.
 *   2. It is the number this audit already calls "the opener" — `t <= 5000` in `ascPresses`, and the
 *      same `t <= 5000` in `emPresses`' `'opener'` branch. Reusing it is what keeps the report from
 *      calling one press the opener and late into Bloodlust in the same breath, and a second
 *      nearly-identical constant is exactly the drift `docs/conventions.md` warns about. (No line
 *      numbers for `index.ts`: several lanes are writing that file concurrently and every number in
 *      it moves.)
 *   3. It is comfortably more than the globals the opener actually needs. The Elemental `GCD_MS` is
 *      1 500 ms and haste shortens it; the haste cooldown is ×1.3 cast speed
 *      (`wowsims-mop/sim/core/buffs.go:689`, `multiplyCastSpeedEffect(aura, 1.3)`), so a lusted global
 *      is around 1 150 ms before any gear haste. Five seconds is four such globals — more than the p5
 *      list spends before Ascendance, so a press outside it is a real delay rather than opener jitter.
 *   4. Where the request gave a range, the top of it is the direction this audit is obliged to err in.
 *      The three real presses land at 3 229, 2 891 and 2 546 ms into their cooldowns, so the bound
 *      sits 1.8 s above the latest of them: close enough to bite on a sloppier pull, far enough not to
 *      fault a clean one.
 *
 * It doubles as the definition of **"on the pull"** for the haste cooldown itself — a cooldown that
 * opened after the opener is not the pull's, and Ascendance may well have been down for it. Same
 * reason as above: one constant cannot drift from itself.
 */
export const ASCENDANCE_INTO_HASTE_MS = 5000;

/**
 * The last instant a first press can land and still be the opener — the **pull-anchored** bound.
 *
 * `OPENER_MS + OPENER_GRACE_MS` from `src/specs/elemental/lib/index.ts`, 5 000 + 250, which is the
 * boundary plan §52a settled and the one `isOpener` already applies to `AscendancePress.opener` and to
 * Elemental Mastery's `'opener'` branch. Reused rather than re-derived: two opener boundaries in one
 * spec is precisely the drift `ASCENDANCE_INTO_HASTE_MS`' docstring exists to prevent.
 *
 * **The grace is load-bearing for rule 1, not inherited politely.** `OPENER_GRACE_MS`' own docstring is
 * explicit that it forgives "timestamp jitter and the reaction between them", and nothing that could be
 * called a global of play — and the press it was written for is the press this rule now grades:
 * `phased` opens with Ascendance at **5 006 ms**, which a bare 5 000 called late by six milliseconds.
 * Rule 1 on the raw `OPENER_MS` would fault a clean opener on one of the three committed pulls.
 *
 * **A stated copy, pinned by test.** The wiring runs `index.ts` → this module, so importing `isOpener`
 * back out of `index.ts` would close a cycle — the same trade `ASCENDANCE_COOLDOWN_MS` below makes, and
 * for the same reason. The copy is not left to drift: the suite pins it as the exact largest `t` for
 * which `index.ts`' own `isOpener` returns true, so a change to either side is a failing test rather
 * than a silent second boundary. The resolution, for a lane that owns both files: move `OPENER_MS`,
 * `OPENER_GRACE_MS` and `isOpener` into a leaf module both can import, and delete this.
 *
 * Not `ASCENDANCE_INTO_HASTE_MS`, which is also about the opener and is also five seconds. That one is
 * anchored on the **haste cooldown opening**, this one on the **bell**, and they disagree by design: a
 * press four seconds into a lust that itself went out four seconds in is inside the haste bound and
 * outside the opener, and rule 1 faults it.
 */
export const OPENER_DEADLINE_MS = 5250;

/**
 * How much Elemental Discharge a non-opener press must have left to count as synced with it.
 *
 * The simulator's number, not a judgement of mine: `priorityList[15]` is
 * `auraRemainingTime(CurrentTarget, 144999) >= 10s`. Ten of the twelve seconds the two-piece can
 * possibly produce (`MaxStacks: 6` × 2 s), which is what makes it a real discipline test rather than a
 * formality — it can only be met by Fulminating at near-full Lightning Shield charges in the global
 * before the press.
 */
export const T16_2PC_SYNC_MIN_MS = 10_000;

/**
 * Ascendance's window, and **rule 2's boundary is this duration rather than a number chosen near it**.
 *
 * From the simulator, not from memory: `wowsims-mop/sim/shaman/ascendance.go:58-61` registers the buff
 * as `shaman.AscendanceAura = shaman.GetOrRegisterAura(core.Aura{ Label: "Ascendance", ActionID:
 * core.ActionID{SpellID: 114049}, Duration: time.Second * 15 })`, on the `time.Minute * 3` cooldown at
 * `:112`. Fifteen seconds is therefore what a press buys, so the last press that loses nothing is at
 * `durationMs - ASCENDANCE_DURATION_MS` — that press's fifteenth second is the pull's last — and one
 * millisecond later throws one millisecond away.
 *
 * **Deliberately not `T16_2PC_SYNC_MIN_MS`,** the other end-of-pull number in this file. Ten seconds is
 * what the *debuff* must have left for entry 15's sync to be met; fifteen is what the *buff* needs to
 * be spent in full. They answer different questions about the same press, and rule 2's is the wider, so
 * it is asked first and `'pull-ends-too-soon'` now reports only the presses rule 2 has already excused.
 *
 * A local copy of `index.ts`' `ASCENDANCE_DURATION_MS`, on the terms the cooldown below states.
 */
export const ASCENDANCE_DURATION_MS = 15_000;

/**
 * Ascendance's cooldown — `wowsims-mop/sim/shaman/ascendance.go:112`, `time.Minute * 3`.
 *
 * Two readers: the `first-press-past-one-cooldown` guard, and rule 2's availability guard — a press
 * cannot be faulted for losing window to the kill if the button did not come back in time to fit one,
 * which is the difference between a fault and a fact about the previous press.
 *
 * A local copy of `index.ts`' own `ASCENDANCE_COOLDOWN_MS`, and the duplication is stated rather than
 * hidden: this module deliberately does not import from `index.ts`, because the wiring goes the other
 * way and a cycle is worse than a repeated literal. When it lands, this and the `index.ts` copy should
 * be one exported constant — `src/specs/elemental/lib/index.ts` is where the Elemental game numbers
 * already live, so exporting it there and importing it here is the resolution. Exported here because
 * rule 2's suite has to be able to name it rather than write 180 000 by hand.
 */
export const ASCENDANCE_COOLDOWN_MS = 180_000;

/**
 * Which of the two priority entries governs one press. Exactly one ever does — see `ascendanceSync`.
 *
 * The **class** of press rather than the single condition that decided its grade: since plan §80 each
 * class grades one absolute demand of the user's and one of the sim's conditional ones, so `'bloodlust'`
 * means "the opener press, judged on the opener and on the haste cooldown" and `'t16-2pc'` means "a
 * later press, judged on the window it had left and on the discharge it found". The fields say which of
 * the pair spoke: a null `delayMs` is "no haste cooldown to measure into", and a null
 * `dischargeRemainingMs` on a `bad` is rule 2's fault rather than the sync's.
 */
export type AscendanceRule = 'bloodlust' | 't16-2pc';

/**
 * Why a press could not be judged.
 *
 * Every one of these is a case where the log does not prove a fault, and each is reported as itself
 * rather than collapsed into a bad grade — the distinction `docs/conventions.md` draws between
 * `verdict_bad` and `verdict_none`: "a pull that never offered the chance has not failed to take it".
 */
export type AscendanceReason =
	/** Ascendance was already running when the bell went — the press this rule judges is off-stream. */
	| 'ascendance-up-at-the-pull'
	/** The first press came more than one Ascendance cooldown in, so it may be a second charge. */
	| 'first-press-past-one-cooldown'
	/** Nothing was reachable when the press had to be made, so it could not have bought anything. */
	| 'nothing-to-hit'
	/** The caller established the player does not have the two-piece, so entry 15 does not apply. */
	| 'no-two-piece-evidence'
	/** The two-piece rule applies and the pull carries no Elemental Discharge at all to sync against. */
	| 't16-2pc-not-in-log'
	/**
	 * Less of the pull was left than the sync itself demands, so no press could have satisfied it.
	 *
	 * Reached only once rule 2 has established the press could not have been made sooner either — a
	 * press that *could* have been is faulted for the window it wasted rather than exempted for the
	 * sync it could not reach.
	 */
	| 'pull-ends-too-soon';

/** How one Ascendance press read against whichever rule governs it. */
export interface AscendancePressVerdict {
	/** The press, fight-relative. */
	t: number;
	/** The rule that judged it. The two never both fire on one press. */
	rule: AscendanceRule;
	/** `none` means this press could not be judged, and `reason` says which way. */
	grade: 'good' | 'bad' | 'none';
	reason: AscendanceReason | null;
	/** Bloodlust arm: ms from the haste cooldown opening to the press. Null under the two-piece rule. */
	delayMs: number | null;
	/** Two-piece arm: ms of Elemental Discharge left at the press. Null under the Bloodlust rule. */
	dischargeRemainingMs: number | null;
	/** The window the press was read against, fight-relative; null when there was none to read. */
	syncStartMs: number | null;
	/** The bound this press's own arm judged its own quantity against, so no threshold is implicit. */
	limitMs: number;
	/**
	 * How much of Ascendance's fifteen seconds fell past the kill, or null when all of it fit.
	 *
	 * A measurement on every press, including the ones nothing is charged for. The opener of a pull that
	 * died in eight seconds reports its waste and is still graded good, because entry 14 asked for that
	 * press; only a later press that could have been made sooner is faulted for the same number. On
	 * `unbroken`'s second press it is 14 286 — fifteen seconds less the 714 ms of pull that were left.
	 */
	wastedMs: number | null;
}

/** Every Ascendance press in the pull, and the pull's worst gradeable verdict. */
export interface AscendanceSyncVerdict {
	presses: AscendancePressVerdict[];
	/**
	 * The worst grade any press earned, or `none` when not one of them could be judged.
	 *
	 * `bad` beats `good` beats `none`. A pull that pressed Ascendance zero times has no press to have
	 * got wrong, so the verdict comes off rule 1 instead: never pressing it is the plainest way to fail
	 * "always used in the opener", and the pull is `bad` unless one of that rule's own guards refuses —
	 * see `ascendanceSync`. This is the one grade not carried by a press.
	 */
	grade: 'good' | 'bad' | 'none';
}

/**
 * Everything the rules read, all of it already computed inside `elementalAudit`.
 *
 * Fight-relative milliseconds throughout, which is what every one of these values already is:
 * `castTimes` returns fight-relative stamps, `auraWindows` subtracts `t0` from both ends, and
 * `Handles.contact` is built from the same clock.
 */
export interface AscendanceSyncInput {
	/** Every Ascendance press in the pull, ascending — `castTimes(ASCENDANCE)`. */
	ascendanceCasts: readonly number[];
	/**
	 * Whether Ascendance was already running when the bell went.
	 *
	 * The one guard the log can actually supply against faulting a press the player could not have
	 * made. A press made just before the pull puts the button on cooldown for three minutes and leaves
	 * nothing in a fight-scoped stream but a bare `removebuff` of 114050, which is exactly what
	 * `auraWindows`' `openAtPull` inference recovers — the `ascendance` aura declares
	 * `durationMs: 15_000`, so the bound that rule needs is available. Computed the same way the
	 * audit's own `fePrepull` already is.
	 *
	 * It is not a complete guard and this module does not pretend otherwise: a press more than fifteen
	 * seconds before the bell leaves no trace at all. `first-press-past-one-cooldown` is the second
	 * half of the defence — beyond one full cooldown the first visible press may be a second charge, so
	 * it is not graded.
	 */
	ascendanceAtPull: boolean;
	/**
	 * The raid's haste cooldown on this player — `Handles.hasteWindows`, unfiltered.
	 *
	 * `AuraWindow` rather than `Window` because that is what the core publishes, and the `variant` it
	 * carries is which of the five spells the raid actually brought.
	 */
	hasteWindows: readonly AuraWindow[];
	/** When the player had something to hit — `Handles.contact`. */
	contact: readonly Interval[];
	/** The pull's length, for the end-of-pull exemption — `Handles.duration`. */
	durationMs: number;
	/**
	 * Elemental Discharge (144999) on the target, or `null` when the player does not have the
	 * two-piece.
	 *
	 * `null` and `[]` are different claims and the difference is the point. `null` says the caller
	 * established the set is not there, so entry 15 does not apply to this player at all. `[]` says the
	 * set *is* there and the pull never landed a Fulmination, which entry 15 does apply to and cannot
	 * be satisfied — reported as `t16-2pc-not-in-log`, never as a fall-through to the Bloodlust rule.
	 * A gear-based detector would produce exactly that second case.
	 *
	 * The audit passes `twoPieceWindows`, which **is** the 144999 reading — `t16DebuffWindows` from
	 * `dotWindowsOnTarget` over the `t16-2pc-debuff` aura, in `Window` shape. This used to say the
	 * opposite ("do not pass `twoPieceWindows`, that reads `t16-2pc-proc`") and was written when a second
	 * declaration for 144998 existed; `344af23` deleted it and repointed that name at the live debuff, so
	 * the warning had come to forbid the one correct argument. Nothing named after the proc remains.
	 *
	 * The audit passes `null` for an empty array, deliberately: its evidence *is* the debuff, so no
	 * windows means no evidence rather than a set that never procced. The `[]` case is for a caller with
	 * gear evidence, and there is none today.
	 */
	t16TwoPieceWindows: readonly Window[] | null;
}

/**
 * The earliest moment the player had something to hit, or null when they never did.
 *
 * The first interval, not a scan for the minimum. `Handles.contact` comes out of `engagedWindows`
 * (`analysis/engagement.ts:12-28`), which sorts its input and emits ascending, non-overlapping
 * segments, so the first one is the earliest by construction. A defensive minimum here would be a
 * branch no test could tell apart from this one — checked by mutating it, and it could not.
 */
function contactStart(contact: readonly Interval[]): number | null {
	return contact[0]?.[0] ?? null;
}

/** Whether an instant fell inside any contact segment. */
function inContact(contact: readonly Interval[], t: number): boolean {
	return contact.some(([start, end]) => t >= start && t <= end);
}

const GRADE_ORDER = { none: 0, good: 1, bad: 2 } as const;

/**
 * Where every Ascendance press landed relative to the cooldown it was supposed to ride.
 *
 * **Precedence is one total decision, taken per press, on the press's own index.** The first press of
 * a pull is the opener and the Bloodlust rule judges it; every later press is at least one 180-second
 * cooldown further in, so the simulator's `currentTime <= 5s` cannot hold for it and the two-piece
 * rule judges it instead. No press is ever read by both rules, and the discriminator is stated once
 * rather than falling out of the order two conditions happen to be written in.
 *
 * Each arm grades the **and** of its absolute condition and its conditional one, and applies its own
 * guards first — only a press that clears them gets a grade at all:
 *
 *   - **Bloodlust arm** — can the press be attributed to a button that was actually available (not
 *     already running at the bell, not past one full cooldown); and had the player something to hit
 *     inside the stretch being judged. Then: was it inside the opener (rule 1, always asked), and was
 *     it inside the haste bound (entry 14, asked only when the raid brought a cooldown to measure
 *     from — a pull without one is a missing measurement, not a refusal).
 *   - **Two-piece arm** — did the fifteen seconds fit before the kill, on a press that could have been
 *     made sooner and had something in front of it (rule 2, asked first and independent of the set);
 *     then, does entry 15 apply to this player at all, does the pull carry any Elemental Discharge, was
 *     there enough pull left for the ten seconds it demands, and was the player in contact.
 *
 * The two exemptions worth naming are the ones that fire on real data, and both are the same
 * principle — never charge a player for a press they could not have made. `unbroken`'s second press is
 * at 183 734 ms of a 184 448 ms pull, 714 ms from the kill, so it wastes 14 286 ms of its window and
 * cannot meet a ten-second sync. Neither is its fault: its own opener went out at 3 676 ms, which put
 * the button back at **183 676 ms**, and the press came **58 ms later**. There was no earlier press to
 * make, so rule 2 stands down and the sync exempts it as `'pull-ends-too-soon'` — the verdict this
 * module already gave it before either rule existed.
 */
export function ascendanceSync(input: AscendanceSyncInput): AscendanceSyncVerdict {
	const { ascendanceCasts, ascendanceAtPull, hasteWindows, contact, durationMs, t16TwoPieceWindows } = input;

	// The latest press whose whole window fits before the kill, and how much of it a later one throws
	// away. One derivation, read by rule 2 for its grade and by every verdict for the measurement.
	const lastFittingPressMs = durationMs - ASCENDANCE_DURATION_MS;
	const wastedAt = (t: number): number | null =>
		t > lastFittingPressMs ? t + ASCENDANCE_DURATION_MS - durationMs : null;
	// The earliest moment the pull offered anything to spend a cooldown on. Read by the opener's
	// exemption and by rule 1's no-press-at-all case, which is why it is hoisted out of the map.
	const reachable = contactStart(contact);

	const presses = ascendanceCasts.map((t, index): AscendancePressVerdict => {
		// The whole of the precedence, in one expression. Index 0 is the opener press by definition;
		// anything else is past the opener by a 180-second cooldown and entry 14 cannot reach it.
		const rule: AscendanceRule = index === 0 ? 'bloodlust' : 't16-2pc';
		const limitMs = rule === 'bloodlust' ? ASCENDANCE_INTO_HASTE_MS : T16_2PC_SYNC_MIN_MS;
		const wastedMs = wastedAt(t);
		const none = (reason: AscendanceReason, syncStartMs: number | null = null): AscendancePressVerdict => ({
			t,
			rule,
			grade: 'none',
			reason,
			delayMs: null,
			dischargeRemainingMs: null,
			syncStartMs,
			limitMs,
			wastedMs,
		});

		if (rule === 'bloodlust') {
			// "If on pull": the haste cooldown that opened inside the opener. One that went out at 90s is
			// a different tactical situation and is not read as the pull's. Its absence is no longer a
			// refusal — rule 1 grades the opener with or without a cooldown to measure into — so this is
			// looked up for the measurement and for the exemption's right edge.
			const anchor = hasteWindows.find((w) => w.start <= ASCENDANCE_INTO_HASTE_MS);
			const syncStartMs = anchor?.start ?? null;
			if (ascendanceAtPull) return none('ascendance-up-at-the-pull', syncStartMs);
			if (t > ASCENDANCE_COOLDOWN_MS) return none('first-press-past-one-cooldown', syncStartMs);

			// Exempt time. The stretch being judged is everything the two halves of the grade look at —
			// the opener itself, and the haste bound measured from a cooldown that may open later than
			// the opener ends — so the deadline is the later of the two, and a pull that brought no
			// cooldown is judged on the opener alone. Asked as "had contact begun by the deadline" rather
			// than "was the press in contact", because the opener is graded on a window that legitimately
			// opens before the first landed hit: `unbroken`'s cooldown opens at 785 ms and its contact
			// clock does not start until 1 553 ms.
			const deadline = Math.max(OPENER_DEADLINE_MS, anchor === undefined ? 0 : anchor.start + limitMs);
			if (reachable === null || reachable > deadline) return none('nothing-to-hit', syncStartMs);

			// A press *before* the cooldown landed is not late. The bound is an upper bound on lateness,
			// not a demand that the two land in a particular order, so a negative delay grades good.
			const delayMs = anchor === undefined ? null : t - anchor.start;
			return {
				t,
				rule,
				// Rule 1 and entry 14, both necessary: the press must be in the opener, and — where there
				// was a haste cooldown to be late into — inside the haste bound as well. A null `delayMs`
				// is "no cooldown to measure against", which cannot fault a press, so it passes its half.
				grade: t <= OPENER_DEADLINE_MS && (delayMs === null || delayMs <= limitMs) ? 'good' : 'bad',
				reason: null,
				delayMs,
				dischargeRemainingMs: null,
				syncStartMs,
				limitMs,
				wastedMs,
			};
		}

		// Rule 2, asked before entry 15 and independent of it: the fifteen seconds are Ascendance's own
		// and owe nothing to the player's gear, so a press that let them run past the kill is a fault
		// whether or not the two-piece is in evidence. Strictly additive — it can only turn a press bad,
		// and every check below keeps the order and the reason it had before the rule existed.
		//
		// Two conditions guard it, and both are "the player could have done better", not "the player did
		// badly":
		//
		//   - **The previous press.** Ascendance is a three-minute button, so if it did not come back
		//     until after `lastFittingPressMs` there was no press at this index that could have fitted,
		//     and the truncation belongs to the pull's length rather than to this press. That is
		//     `unbroken` exactly — back at 183 676 ms, pressed at 183 734 — and it falls through to the
		//     sync, which exempts it as it always did. `?? 0` is unreachable (index >= 1 here) and is how
		//     the index is bounds-checked without a non-null assertion.
		//   - **Contact at the press.** A press with nothing in front of it bought nothing whenever it
		//     was made, so it is answered by the `'nothing-to-hit'` exemption below rather than charged
		//     for its timing. Folded into this condition rather than hoisted above it, so the order of
		//     the refusals — and the reason a real press comes back with — is exactly what §39 settled.
		const readyAtMs = (ascendanceCasts[index - 1] ?? 0) + ASCENDANCE_COOLDOWN_MS;
		if (wastedMs !== null && readyAtMs <= lastFittingPressMs && inContact(contact, t)) {
			return {
				t,
				rule,
				grade: 'bad',
				reason: null,
				delayMs: null,
				dischargeRemainingMs: null,
				syncStartMs: null,
				limitMs,
				wastedMs,
			};
		}

		if (t16TwoPieceWindows === null) return none('no-two-piece-evidence');
		if (t16TwoPieceWindows.length === 0) return none('t16-2pc-not-in-log');
		// Nothing the player did could have met a ten-second demand with less than ten seconds of pull
		// left, so the press is exempt rather than faulted.
		if (durationMs - t < limitMs) return none('pull-ends-too-soon');
		// An instant, not a window: a later press is a moment in the pull, and asking whether the player
		// was in contact at it is the honest question for a moment.
		if (!inContact(contact, t)) return none('nothing-to-hit');

		// Zero when the press found no discharge at all, which is the fault entry 15 describes rather
		// than a missing measurement: the set is in evidence, so Fulmination was the player's to press.
		const open = t16TwoPieceWindows.find((w) => t >= w.start && t <= w.end);
		const dischargeRemainingMs = open === undefined ? 0 : open.end - t;
		return {
			t,
			rule,
			grade: dischargeRemainingMs >= limitMs ? 'good' : 'bad',
			reason: null,
			delayMs: null,
			dischargeRemainingMs,
			syncStartMs: open?.start ?? null,
			limitMs,
			wastedMs,
		};
	});

	// The pull's headline is its worst gradeable press. A pull whose every press was exempt stays
	// `none` — it has not failed to take a chance it never had.
	const worst = presses.reduce<'good' | 'bad' | 'none'>(
		(worst, press) => (GRADE_ORDER[press.grade] > GRADE_ORDER[worst] ? press.grade : worst),
		'none',
	);

	// Rule 1 on a pull that never pressed it: there is no press to carry the verdict, so it lands on the
	// pull. Guarded the same three ways a press is, and for the same reason — the log has to prove the
	// player *could* have opened with it. Ascendance already running at the bell means the opener press
	// is off-stream; a pull that ended inside the opener never finished one; and a pull with nothing
	// reachable by the deadline had nothing to spend it on.
	const openerMissed =
		presses.length === 0 &&
		!ascendanceAtPull &&
		durationMs > OPENER_DEADLINE_MS &&
		reachable !== null &&
		reachable <= OPENER_DEADLINE_MS;
	return { presses, grade: openerMissed ? 'bad' : worst };
}
