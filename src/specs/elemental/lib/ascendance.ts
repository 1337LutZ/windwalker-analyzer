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
// the reason is measurable rather than aesthetic. **Three of the four committed pulls** press Ascendance
// in the opener with no Elemental Discharge up at all — `phased` at 5 006 ms, `unbroken` at 3 676 ms,
// `cleave` at 3 487 ms, against first debuff windows opening at 26 490, 23 057 and 24 794 ms. Judging
// the opener against the discharge would fault every one of them for something entry 14 explicitly
// sanctions, which is the "charged the player for something they could not have done" bug this audit
// has already shipped four times.
//
// **`addsThenBoss` is the fourth, and it makes the same argument from the far end rather than weakening
// it.** That shaman has no T16 two-piece at all — 144999 appears **zero** times in the log — so an
// opener judged against Elemental Discharge would be judged against a debuff the player had no way to
// apply. It is also the first committed pull that does *not* open with Ascendance: the first press is at
// **17 101 ms** of a 560 261 ms pull. What excuses it is neither rule: the pull's contact clock does not
// start until 7 004 ms, past the 5 250 ms deadline, so the opener comes back `'nothing-to-hit'` before
// rule 1 can fault it for being twelve seconds late. Every claim in this file that reads "all three
// committed pulls" was written before that pull existed, and several of them were about to say
// something the fourth log contradicts.
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
// ------------------------------------------- the two Skull Banner rules, from the user (plan §80)
//
// Two more sentences, and this pair is **not** phrased alike, which is the whole of how they are
// modelled:
//
//   > Ascandence should have at least 90% overlap with Skull Banner (Skull banner is 10s, Asc 15s
//   > 90% in this case would be based on the SB 10s)
//
//   > 2nd Ascandence should ideally be synced with 2nd Skull Banners
//
// "should have at least" against "should ideally be". So **rule 3 is graded and rule 4 is shown** —
// the vocabulary §80's own box sets up ("treat the absolutes as graded and the ideals as
// shown-with-a-reason"), applied per sentence rather than to the block. That box files 3, 4 and 6
// together as "hedged in the request ('ideally')", and on the user's actual words that is true of 4
// and 6 and not of 3: rule 3 carries no hedge and is the one rule of the six the user wrote the
// arithmetic out for. A departure from the plan's grouping, stated here so it is a decision rather
// than a slip. `bannerOverlapMs` therefore participates in `grade`; `secondBannerSynced` never does,
// and a test asserts that a `false` there leaves a press `good`.
//
// **The denominator is the banner's ten seconds, so the bar is 9 000 ms** — see
// `SKULL_BANNER_OVERLAP_MIN_MS`, which is where the reason the user gave for it is written down.
//
// ------------------------------------------------------- what "overlap with Skull Banner" is over
//
// **Rule 3 measures the union of every banner that landed on the player, not the best single one**,
// and `phased` is why. Its opener is at 5 006 ms and two warriors staggered their banners: one from
// 3 319 to 13 760 ms and the next from 13 760 to 23 838. The best *single* banner gives the press
// 8 754 ms and fails the rule by 246 ms — while Skull Banner was in fact up for 14 999 of the
// 15 000 ms of that Ascendance. Faulting a player whose buff never lapsed, because two other players
// staggered their presses, is the "charged the player for something they could not have done" bug
// this module's comments already name four times.
//
// The union reading also **agrees with the per-banner reading on the case the user described**: they
// wrote "Skull banner is 10s", singular, because one warrior presses one banner, and where a press
// sees one banner the union *is* that banner. So this is a strict generalisation of the sentence
// rather than a reinterpretation of it — and it is what makes the stated denominator make sense, since
// 90% of Ascendance's own fifteen seconds is a bar no single ten-second banner could clear.
//
// **Rule 4 reads a different set on purpose: each caster's own second banner.** The two rules ask
// different questions. Rule 3 asks "was the buff up", which is a union question — the player felt one
// buff whoever supplied it. Rule 4 asks whether the two *cooldowns* lined up on their second rotation,
// which is a question about presses, and a press belongs to a caster: Skull Banner is a three-minute
// button (`sim/core/buffs.go:1122`, `SkullBannerCD = time.Minute * 3`) exactly as Ascendance is, so
// "the 2nd Skull Banner" is one warrior's second press of it and not the second bar on the chart.
//
// Measured, and the distinction decides the answer on real data. On `cleave` the banners arrive at
// 2 814, 14 299, 184 448 and 203 392 ms from two warriors pressing 2 814/184 448 and 14 299/203 392.
// The second Ascendance is at 184 240. Counting bars, "the 2nd Skull Banner" is 14 299 and the rule
// reads false by three minutes; counting each warrior's second press, it is 184 448 and the two are
// synced to 208 ms. `phased` is the same shape — its second Ascendance at 196 197 lines up with the
// second banner of the warrior who opened at 13 760, not with the second bar at 13 760 itself.
//
// That per-caster bucket is not built here and is not this module's to build: `windowsBySource` and
// `raidSourceLanes` (`lib/analysis/raidCasters.ts`) already walk the raid stream into one entry per
// *resolved* caster — resolved through `petOwner`, because every banner is applied by the object the
// warrior planted and each planting is its own actor. This module takes those entries as a parameter
// and never names a spell or walks a stream.
//
// ---------------------------------------------- the parameter is optional, and silence is its default
//
// `skullBannerWindows` is optional because the windows are assembled in `index.ts`, which four lanes
// have been writing at once, and this module was built and tested ahead of its call site once before.
// **Absent, it degrades to "cannot say" and never to "good" or "bad":** `bannerOverlapMs` and
// `secondBannerSynced` come back null and rule 3 passes its half of the `and` unasked, exactly as a
// null `delayMs` does for entry 14. A rule that silently passed because its input never arrived would
// be worse than an absent one, so the null is pinned by test from both sides.
//
// **An empty reading is the same silence, and deliberately not the `[]`-means-fault call
// `t16TwoPieceWindows` makes.** There the empty array is a fault because the set is the player's and
// Fulmination is their button. Skull Banner is somebody else's button entirely: a pull where no warrior
// banner reached the player is a fact about the raid roster, and a shaman cannot press it. Nor can a
// log show a warrior's cooldown — the same limit `index.ts` already records against the Earth Elemental
// rung's `spellTimeToReady(114206)` term. So no banners means no measurement, not a zero.
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
// That it works for the whole group is measured, not asserted: the four committed pulls carry three
// *different* members of it — Heroism (32182) on `phased`, cast by another player; Bloodlust (2825) on
// `unbroken`, cast by the shaman himself; Time Warp (80353) on `cleave`; Heroism again on
// `addsThenBoss`. All four read identically through the one `hasteWindows` call.
//
// **The fourth is not a repeat, though, and it is the interesting one.** Its Heroism opens at
// **438 207 ms** — seven minutes into a nine-minute pull — so `ascendanceSync`'s anchor search
// (`hasteWindows.find((w) => w.start <= ASCENDANCE_INTO_HASTE_MS)`) declines it, and the pull reads as
// "no haste cooldown on the pull" with a haste cooldown plainly in the log. That is the first committed
// pull to exercise the *late*-cooldown half of the two bullets below, and the reason `delayMs` and
// `syncStartMs` are a missing measurement rather than a refusal: rule 1 grades that opener alone.
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
// Established from the simulator, the 5.4 client data and the three committed pulls that carry the set
// at all. The fourth, `addsThenBoss`, carries neither id — which is its own kind of evidence and is
// counted below rather than glossed over.
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
// all **four** committed pulls 144998 appears **zero** times, while 144999 appears 20 times on `phased`,
// 18 on `unbroken`, 20 on `cleave` and **0** on `addsThenBoss`, as
// `applydebuff`/`refreshdebuff`/`removedebuff` sourced by the player. In the p5 list `auraIsActive(144998)`
// is a *"do I own the two-piece"* branch selector for the Earth Shock rules, not a window.
//
// **Two corrections in that sentence, and one of them was wrong before the fourth pull arrived.** It
// used to read "20, 18 and 24": `cleave`'s count is 20 (8 `applydebuff`, 4 `refreshdebuff`, 8
// `removedebuff`), never 24, so the figure a reader would have checked the id against was a number no
// fixture ever held.
//
// **And `addsThenBoss`' zero is the opposite claim to 144998's zero, which is why it is spelled out.**
// 144998 reads zero on a pull that *has* the set, so the zero is about the id. 144999 reads zero on
// `addsThenBoss` because that shaman has no two-piece — `sharedFixtures.test.ts`' equipped-iff-fired
// grid is what separates the two readings, and it is the reason a lane keyed to 144999 may come back
// empty without anything being wrong. The audit's own answer for that pull is
// `'no-two-piece-evidence'`, on three real presses.
//
// The audit models **only** 144999, as the `t16-2pc-debuff` aura. It used to carry a `t16-2pc-proc`
// declaration for 144998 beside it, and `344af23` (plan step 49) deleted that: an aura keyed to an id
// the game never writes could only ever draw an empty lane and read as "the proc never fired". The
// paragraph above stays because the id is still the trap — it is the number in the p5 list, so the next
// reader of that list will reach for it — but nothing in this codebase reads it any more. This module
// takes the live windows as a parameter and touches no declaration.

import type { AuraWindow } from '~/lib/analysis/auras';
import { mergeIntervals, overlapMs } from '~/lib/analysis/intervals';
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
 *      nothing more. On a lust-on-pull the two anchors are within a second of each other anyway: three
 *      of the four committed pulls open theirs at 1 777, 785 and 941 ms. The fourth,
 *      `addsThenBoss`, has no lust-on-pull to be within a second of — its only haste cooldown opens at
 *      438 207 ms and the anchor search declines it — so it constrains this number in neither direction.
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
 *      Three real presses land at 3 229, 2 891 and 2 546 ms into their cooldowns, so the bound sits
 *      1.8 s above the latest of them: close enough to bite on a sloppier pull, far enough not to fault
 *      a clean one. Still three and not four: `addsThenBoss` is the fourth committed pull and it
 *      contributes no delta at all, because the cooldown its opener would have been measured into
 *      opened at 438 207 ms and is not the pull's. A fourth log has therefore not widened the evidence
 *      for this number — worth saying plainly, because the count in this bullet is the whole of the
 *      empirical case for 5 000 over 4 000.
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
 * Rule 1 on the raw `OPENER_MS` would fault a clean opener on one of the four committed pulls — still
 * exactly one, and still `phased`: the other three open at 3 676, 3 487 and 17 101 ms, and the last of
 * those is past both bounds and exempted by `'nothing-to-hit'` rather than saved by the grace.
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
 *
 * *** The committed logs do not agree with the sim about this number, and the disagreement is measured
 * rather than assumed. *** `addsThenBoss` presses 114049 four times — 17 101, 173 985, 395 244 and
 * 539 625 ms — so two consecutive presses are **156 884 ms** and **144 381 ms** apart, both inside the
 * three minutes this constant asserts. Whatever the cause, the second reader above is the one that
 * cares: `readyAtMs` computes 575 244 for that last press and the log proves the button was in fact
 * back by 539 625, so the guard would answer "no press at this index could have fitted" about a press
 * that was demonstrably available.
 *
 * **No grade moves on any committed pull today** — that press wastes nothing (539 625 + 15 000 is inside
 * the 560 261 ms pull), so rule 2 never reaches the guard, which is why this is a note and not a change.
 * `ascendance.test.ts` pins the four presses and the two short gaps so the next reader finds the fact
 * rather than the assumption. The fix, if a pull ever does turn on it, is to read the previous press's
 * *own* recovery from the log rather than adding 180 000 to it; that is a change to the guard and wants
 * its own red.
 */
export const ASCENDANCE_COOLDOWN_MS = 180_000;

/**
 * Skull Banner's window, **confirmed against the simulator rather than taken from the request**.
 *
 * `wowsims-mop/sim/core/buffs.go:1121` is `const SkullBannerDuration = time.Second * 10`, and
 * `SkullBannerAura` at `:1153` registers the buff with `Duration: SkullBannerDuration` — so ten seconds,
 * which is what the user said, and it is stated here because the rule below is arithmetic on it. The
 * cooldown beside it at `:1122` is `SkullBannerCD = time.Minute * 3`, which is what makes "the 2nd Skull
 * Banner" a meaningful ordinal at all.
 *
 * The id is **114206** and never 114207. `sim/core/buffs.go:1118` is `var SkullBannerActionID =
 * ActionID{SpellID: 114206}` and the aura registers under the same number; 114207 occurs once in the
 * simulator, as the icon its buff picker draws (`ui/core/components/inputs/buffs_debuffs.ts:108`). The
 * logs agree with the sim: 114206 lands on the player on all **four** committed pulls — 8, 4, 8 and 12
 * events targeting the shaman on `phased`, `unbroken`, `cleave` and `addsThenBoss` — and 114207 on none
 * of them.
 * `game/shared.ts` declares exactly that — `ids: [114206]`, `durationMs: 10_000` — so **this module
 * names neither number**, and this note exists only because the split is the trap 144998 already was.
 * The windows arrive as a parameter, walked from the declaration by `raidCasters.ts`.
 */
export const SKULL_BANNER_DURATION_MS = 10_000;

/**
 * How much Skull Banner an Ascendance window must contain — rule 3's bound, and it is 90% of **ten**
 * seconds.
 *
 * The one rule of the user's six they wrote the arithmetic out for, and they wrote it out because the
 * obvious reading is the wrong one: *"Ascandence should have at least 90% overlap with Skull Banner
 * (Skull banner is 10s, Asc 15s 90% in this case would be based on the SB 10s)"*. So the denominator is
 * `SKULL_BANNER_DURATION_MS` and the bar is 9 000 ms.
 *
 * **Not 90% of Ascendance's fifteen seconds, which would be 13 500 and a near-unfailable rule.** A
 * single ten-second banner cannot put 13 500 ms inside anything, so that reading would fault every
 * press that is not double-bannered and pass nothing else — the rule would be measuring the raid's
 * warrior count. Getting the two durations the right way round is the whole content of the user's
 * parenthesis.
 *
 * Read by rule 3 for its grade and by rule 4 for its shown verdict, so the two cannot drift apart. Rule
 * 4's own sentence gives no number — "should ideally be synced" — and inventing a second one for it
 * would be a threshold with no author.
 */
export const SKULL_BANNER_OVERLAP_MIN_MS = 9000;

/**
 * One caster's Skull Banners, as they landed on this player.
 *
 * The shape `windowsBySource`/`raidSourceLanes` already produce — one entry per *resolved* caster, that
 * caster's windows in clock order — because rule 4 needs the press index within a caster and rule 3
 * needs the union across all of them. Taking the bucketed form rather than a flat window list is what
 * lets one parameter answer both without this module deciding whose banner is whose.
 */
export interface BannerCasterWindows {
	/** The report actor id of the player who pressed it — `LaneSource.id`, the owner and not the object. */
	source: number;
	/** That caster's banners, ascending by start. `windows[1]` is their second press. */
	windows: readonly Window[];
}

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
	/**
	 * Rule 3 — how much Skull Banner this press's Ascendance window contained, against
	 * `SKULL_BANNER_OVERLAP_MIN_MS`.
	 *
	 * The **union** of every banner that landed on the player, clipped to `[t, t + 15s]` and to the kill.
	 * A measurement on every press, reported even where nothing is charged for it, on the same terms as
	 * `wastedMs`.
	 *
	 * **Null means there was nothing to measure against, and only that** — no banner reading was passed
	 * in, or the pull carried none that reached the player. It never means "not asked because the press
	 * was exempt": an exempt press still reports the overlap it had. A null passes rule 3's half of the
	 * grade, exactly as a null `delayMs` passes entry 14's.
	 *
	 * A small number here does not always mean a fault, and the guard is deliberate rather than missing:
	 * a press with less pull left than the rule's own 9 000 ms could not have met it whatever it did, so
	 * rule 3 stands down and the number is still reported. Same principle as rule 2's availability guard.
	 */
	bannerOverlapMs: number | null;
	/**
	 * Rule 4 — how much of the *second banner* this press's window contained. Non-null on the second
	 * press alone.
	 *
	 * Not the union `bannerOverlapMs` reads: the best overlap against any one caster's **own second
	 * banner**, because "the 2nd Skull Banner" is a warrior's second press of a three-minute button and
	 * not the second bar drawn on the chart. See the header for the `cleave` measurement that separates
	 * the two readings by three minutes.
	 *
	 * Null on every press but the second, and on the second when no caster pressed twice — which is
	 * `unbroken`, where two warriors banner once each.
	 *
	 * `addsThenBoss` is the pull that reads it **false** on real data: both its warriors banner three
	 * times, and the second Ascendance at 173 985 ms sits between their first and second rotations, so the
	 * overlap is 0. Rule 4 shows that and grades nothing, which is the hedge working — that press is
	 * exempt for a different reason entirely.
	 */
	secondBannerOverlapMs: number | null;
	/**
	 * Rule 4's verdict, and **it is shown rather than graded**.
	 *
	 * The user hedged this one — "should *ideally* be synced" — where rule 3 says "should have at least",
	 * so this never enters `grade`. `null` is "cannot say" and covers every press but the second as well
	 * as a second press with no second banner to compare against. Decided on
	 * `SKULL_BANNER_OVERLAP_MIN_MS`, borrowed from rule 3 because rule 4's sentence names no number.
	 */
	secondBannerSynced: boolean | null;
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
	/**
	 * Every Ascendance press in the pull, ascending, each on the instant it *landed*.
	 *
	 * Named as an instant rather than as whichever accessor the caller happens to reach for, because
	 * the contract is the clock and not the function — a field pinned to `castTimes(ASCENDANCE)` goes
	 * stale the moment its caller moves, and says nothing about what should have moved with it.
	 *
	 * The landing is what every rule in this module needs. All of them measure the fifteen seconds a
	 * press bought — its overlap with the haste cooldown, with a Skull Banner, with the two-piece
	 * discharge, and the tail it wastes past the kill — and the buff starts when the cast completes.
	 * `readyAtMs` wants the same instant for a second reason: a cooldown is armed at the landing and not
	 * at the commit (`wowsims-mop` `sim/core/cast.go:184-205`, `:258-268`).
	 *
	 * Ascendance is an instant, so its caller's two clocks coincide and no fixture — and no synthetic
	 * built out of this one array — can tell them apart. Nothing here can guard the choice; the guard
	 * would have to sit at the call site, on the accessor it reads.
	 */
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
	/**
	 * Skull Banner as this player received it, one entry per caster — rules 3 and 4's only input.
	 *
	 * **Optional, and its absence is silence.** `undefined` is the state this module ships in until
	 * `index.ts` passes it: rule 3 is not asked, rule 4 says nothing, and no press can be graded better
	 * or worse for it. Same treatment for an empty array and for a caster list whose windows are all
	 * empty — a pull no warrior banner reached is the raid's roster and not the shaman's press, so there
	 * is nothing to fault. This is the one place this module differs from `t16TwoPieceWindows`' `null`
	 * versus `[]` distinction, and the header says why.
	 *
	 * Fight-relative and already narrowed to what landed on *this* player, because that is what
	 * `raidSourceLanes` produces: it passes `onTarget: actorID` precisely so a raid-wide stream is not
	 * counted twenty-five times. Bucketed per resolved caster, so `windows[1]` is a warrior's second
	 * press rather than the second banner in the pull.
	 */
	skullBannerWindows?: readonly BannerCasterWindows[];
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
 * **Rule 3 is a third condition in that same `and`, on both arms, and it is the only one shared between
 * them.** Every press wants Skull Banner inside its window whichever entry it answers to, so the
 * measurement and the bound are the press's rather than the arm's and are taken once above the branch.
 * Like rule 2 it is strictly additive — it can only turn a press bad — and like entry 14 it is silent
 * where the log gave it nothing to measure. **Rule 4 is in no grade at all**: the user hedged it, so it
 * rides out on the second press as `secondBannerSynced` and moves nothing.
 *
 * The exemptions worth naming are the ones that fire on real data, and all of them are the same
 * principle — never charge a player for a press they could not have made. **Three of the six reasons now
 * have a committed pull behind them, where this paragraph used to name one.**
 *
 *   - `'pull-ends-too-soon'`, on `unbroken`'s second press, at 183 734 ms of a 184 448 ms pull, 714 ms
 *     from the kill: it wastes 14 286 ms of its window and cannot meet a ten-second sync. Neither is its
 *     fault — its own opener went out at 3 676 ms, which put the button back at **183 676 ms**, and the
 *     press came **58 ms later**. There was no earlier press to make, so rule 2 stands down and the sync
 *     exempts it, the verdict this module already gave it before either rule existed.
 *   - `'nothing-to-hit'`, on `addsThenBoss`' **opener**. Its first press is at 17 101 ms, twelve seconds
 *     past `OPENER_DEADLINE_MS`, so rule 1 would fault it — but the pull's contact clock does not open
 *     until 7 004 ms, past the same deadline, and there was nothing to spend the cooldown on inside the
 *     stretch being judged. The one exemption the suite could only build synthetically has a pull.
 *   - `'no-two-piece-evidence'`, on `addsThenBoss`' other three presses. That shaman has no T16
 *     two-piece, so entry 15 does not apply to him at all and rule 2 has nothing to charge either
 *     (all three windows fit inside the pull).
 *
 * The consequence is a pull-level grade no committed fixture had: `addsThenBoss` is `none`, every press
 * exempt, against `bad` / `good` / `bad` on the other three.
 */
export function ascendanceSync(input: AscendanceSyncInput): AscendanceSyncVerdict {
	const {
		ascendanceCasts,
		ascendanceAtPull,
		hasteWindows,
		contact,
		durationMs,
		t16TwoPieceWindows,
		skullBannerWindows,
	} = input;

	// The latest press whose whole window fits before the kill, and how much of it a later one throws
	// away. One derivation, read by rule 2 for its grade and by every verdict for the measurement.
	const lastFittingPressMs = durationMs - ASCENDANCE_DURATION_MS;
	const wastedAt = (t: number): number | null =>
		t > lastFittingPressMs ? t + ASCENDANCE_DURATION_MS - durationMs : null;
	// The stretch this press actually bought, clipped to the kill — what both banner rules measure
	// inside, and the only place Ascendance's own duration meets the pull's length for them.
	const windowOf = (t: number): Interval => [t, Math.min(t + ASCENDANCE_DURATION_MS, durationMs)];

	// ---- rules 3 and 4's two readings of one input.
	//
	// Rule 3 unions every caster's banners, because the player felt one buff whoever supplied it, and
	// `overlapMs` sums its ranges — so merging first is not tidiness, it is what stops two warriors who
	// overlapped from being counted twice. `mergeIntervals` also joins ranges that merely *touch*, and
	// two abutting bars are one unbroken buff.
	//
	// **That touching case is real on three of the four committed pulls and not on all of them, which is
	// what this comment used to claim.** `phased` hands off at 13 760 ms, `unbroken` at 13 196 and
	// `addsThenBoss` at 234 719 — one warrior's banner coming off on the same millisecond the next goes
	// up. `cleave` never does: its four bars are 2 814–13 243, 14 299–24 568, 184 448–194 721 and
	// 203 392–213 744, so its union is its input and the merge is a no-op there. The universal was
	// already false on the third fixture, before the fourth arrived; the mechanism it justifies is
	// unaffected, since a no-op merge is exactly what a pull with no hand-off should get.
	//
	// `null` for both the missing parameter and an empty reading, which is the same claim — no banner to
	// measure against. Not a zero: see the field docs.
	const bannerUnion = mergeIntervals(
		(skullBannerWindows ?? []).flatMap((c) => c.windows.map(({ start, end }): Interval => [start, end])),
	);
	const bannerOverlapAt = (t: number): number | null => {
		if (bannerUnion.length === 0) return null;
		const [start, end] = windowOf(t);
		return overlapMs(start, end, bannerUnion);
	};
	// Rule 4's set: each caster's *own* second banner, and nothing else. One warrior's second press of a
	// three-minute button is what "the 2nd Skull Banner" names; the second bar in the pull is a different
	// banner on all four fixtures measured — including `addsThenBoss`, where two warriors banner *three*
	// times each and the second bar (18 482 ms) is neither caster's second press (228 626 and 234 719).
	// Casters who pressed once contribute nothing rather than their first.
	const secondBanners = (skullBannerWindows ?? []).flatMap((c) => (c.windows[1] === undefined ? [] : [c.windows[1]]));
	// The earliest moment the pull offered anything to spend a cooldown on. Read by the opener's
	// exemption and by rule 1's no-press-at-all case, which is why it is hoisted out of the map.
	const reachable = contactStart(contact);

	const presses = ascendanceCasts.map((t, index): AscendancePressVerdict => {
		// The whole of the precedence, in one expression. Index 0 is the opener press by definition;
		// anything else is past the opener by a 180-second cooldown and entry 14 cannot reach it.
		const rule: AscendanceRule = index === 0 ? 'bloodlust' : 't16-2pc';
		const limitMs = rule === 'bloodlust' ? ASCENDANCE_INTO_HASTE_MS : T16_2PC_SYNC_MIN_MS;
		const wastedMs = wastedAt(t);
		// Rule 3's measurement, and rule 2's guard's sibling: a press with less pull left than the rule's
		// own 9 000 ms could not have contained them however it was timed, so the overlap is reported and
		// the grade is not charged for it. Hoisted out of both arms because the number is the press's
		// rather than the arm's, and the two arms must not each grow their own copy of the bound.
		const bannerOverlapMs = bannerOverlapAt(t);
		const bannerOk =
			bannerOverlapMs === null ||
			bannerOverlapMs >= SKULL_BANNER_OVERLAP_MIN_MS ||
			durationMs - t < SKULL_BANNER_OVERLAP_MIN_MS;
		// Rule 4, on the second press and nowhere else. `Math.max` over the casters who pressed twice:
		// several warriors each have a second banner, and the rule is met if the press lined up with any
		// one of them — the same "was there a banner for it" question rule 3 asks of the union, narrowed to
		// the presses that share Ascendance's rotation.
		const secondBannerOverlapMs =
			index !== 1 || secondBanners.length === 0
				? null
				: Math.max(...secondBanners.map((w) => overlapMs(...windowOf(t), [[w.start, w.end]])));
		// Shown, never graded — `bannerOk` above is rule 3's and this appears in no grade expression.
		const secondBannerSynced =
			secondBannerOverlapMs === null ? null : secondBannerOverlapMs >= SKULL_BANNER_OVERLAP_MIN_MS;
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
			bannerOverlapMs,
			secondBannerOverlapMs,
			secondBannerSynced,
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
				// Rule 1, entry 14 and rule 3, all three necessary: the press must be in the opener, and —
				// where there was a haste cooldown to be late into — inside the haste bound as well, and —
				// where the pull carried a banner to measure — holding 9 000 ms of it. A null `delayMs` is "no
				// cooldown to measure against" and a null `bannerOverlapMs` is "no banner to measure
				// against"; neither can fault a press, so each passes its own half.
				grade: t <= OPENER_DEADLINE_MS && (delayMs === null || delayMs <= limitMs) && bannerOk ? 'good' : 'bad',
				reason: null,
				delayMs,
				dischargeRemainingMs: null,
				syncStartMs,
				limitMs,
				wastedMs,
				bannerOverlapMs,
				secondBannerOverlapMs,
				secondBannerSynced,
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
				bannerOverlapMs,
				secondBannerOverlapMs,
				secondBannerSynced,
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
			// Entry 15 and rule 3, both necessary and on the same terms as the opener arm's pair: the
			// discharge must have ten seconds left, and — where the pull carried a banner to measure — the
			// window must hold 9 000 ms of it.
			grade: dischargeRemainingMs >= limitMs && bannerOk ? 'good' : 'bad',
			reason: null,
			delayMs: null,
			dischargeRemainingMs,
			syncStartMs: open?.start ?? null,
			limitMs,
			wastedMs,
			bannerOverlapMs,
			secondBannerOverlapMs,
			secondBannerSynced,
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
