// The Ascendance press rule the audit models but does not judge: whether the fifteen seconds were
// spent inside the raid's haste cooldown.
//
// `elementalAudit` already reads every input this needs — `ascPresses` from `castTimes(ASCENDANCE)`,
// the core's `hasteWindows`, the contact clock — and `FlameShockPressKind` already carries an
// `'ascPrep'` arm, so the audit knows Ascendance prep exists. What it never did was grade the press.
// This module is that grade and nothing else: a pure function over the values the audit already
// holds, so wiring it in is one call rather than a fifth concurrent edit to `index.ts`.
//
// ---------------------------------------------------------------- the haste cooldown
//
// Not re-derived here, and deliberately not a bare spell id. `src/lib/game/shared.ts:132-155`
// declares the whole group as one aura — `ids: [2825, 32182, 80353, 90355, 146555]`, named for the
// effect rather than for any one spell, with `variants` saying which was actually cast — and
// `analyseCore`'s single `auraWindows(selfEvents, spec.registry.aura('bloodlust'), …)` walks it once
// and publishes the result on `Handles.hasteWindows`, precisely so
// a spec's audit reads the cooldown instead of walking the stream a second time. This module takes
// those windows as a parameter. A raid with a mage instead of a shaman therefore grades identically,
// which is the whole point of the shared table.
//
// Two consequences of that walk are load-bearing below, and neither is this module's to fix:
//
//   - The Bloodlust aura declares no `durationMs`, so `auraWindows`' `openAtPull` inference can never
//     fire for it (`auraWindows` refuses that rule without a duration bound). A haste cooldown
//     cast *before* the bell leaves nothing in a fight-scoped stream but its own `removebuff`, which
//     the default walk discards. Such a pull reads as "no haste cooldown on the pull" and is not
//     graded — silence, not a zero.
//   - `hasteWindows` is built from `selfEvents`, i.e. events whose `targetID` is the player
//     (`events/parse.ts:26`), so a shaman who lusts the raid does not close his own window with
//     somebody else's `removebuff`. Measured: `unbroken` carries 45 events of id 2825 and comes back
//     as exactly one window, `[785, 40790]`.
//
// ------------------------------------------------------- the T16 four-piece, from the source
//
// Established from the simulator and from both committed anonymous pulls, not from memory, and the
// finding is that **there is nothing here for Ascendance to be synced with.**
//
// The Elemental T16 set is `ItemSetCelestialHarmonyRegalia`,
// `wowsims-mop/sim/shaman/items_mop.go:98`. Its four-piece (`items_mop.go:141-153`) is:
//
//     Callback: core.CallbackOnSpellHitDealt, Outcome: core.OutcomeLanded,
//     ClassSpellMask: SpellMaskLightningBolt | SpellMaskChainLightning,
//     ICD: time.Second * 60,
//     Handler: shaman.LightningElemental.EnableWithTimeout(sim, …, 10*time.Second)
//
// A landed Lightning Bolt or Chain Lightning has a chance, at most once a minute, to summon a
// guardian for ten seconds. It touches Ascendance's cooldown, its duration and its damage not at
// all. It is a proc, not a press: there is no window a player can choose to line Ascendance up with,
// and grading a press against one would charge the player for a die roll. That would be a fifth bug
// of the shape this audit has already shipped four times (plan steps 26, 31a, 31b, 34), which is
// worse than shipping no grade.
//
// The set bonus that *does* sync with Ascendance is the **T15** four-piece, `Ascendant Harmony`
// (138144, `items_mop.go:85-91` — each Lava Burst takes 1.5s off Ascendance's cooldown). The audit
// already models it as the `t15-4pc` aura, and `emPresses` already has a `'t15'` branch for it.
//
// **Detectability, for the record, since the answer is yes and a future lane will want it.** The
// four-piece is visible in the stream the app already fetches, though not where one would look:
//
//   - `combatantinfo.gear[].setID` does NOT work. Both committed pulls wear four pieces of set 1182
//     ("Celestial Harmony Regalia", `wowsims.db` `ItemSet` 1182 → items 99092-99095, 99106), and WCL
//     stamps `setID` on two of the four in `phased` and on none of the four in `unbroken`. Counting
//     it reports 2 and 0 against a true 4 — a value assumed rather than read is how a sibling lane's
//     whole bug happened.
//   - The proc firing IS in the stream. `phased` carries five `summon` events of ability **145000**
//     ("Summon Lightning Elemental") sourced by the player, at 1013, 62028, 122557, 192535 and
//     252846 ms; `unbroken` carries four, at 1630, 61654, 123013 and 183329 ms. Every gap is between
//     60 024 and 69 978 ms — the 60-second ICD above, measured rather than assumed. Presence of a
//     `summon` of 145000 is proof of the four-piece.
//   - Do not reach for 145003 or 144998. Both are the simulator's `ExposeToAPL` handles
//     (`items_mop.go:138`, `:151`), not ids the game logs; 144998 appears zero times in either pull
//     while the 2-piece's real debuff, 144999, appears eighteen and twenty times.
//
// So the T16 arm below is a precedence gate with no rule behind it. It is real code rather than a
// comment because the requirement is that the four-piece rule *replaces* the Bloodlust rule rather
// than both firing — and a precedence expressed as prose is a precedence nobody can test.

import type { AuraWindow } from '~/lib/analysis/auras';
import type { Interval } from '~/lib/analysis/intervals';
import type { Window } from '~/lib/types';

/**
 * How far into the raid's haste cooldown Ascendance may go before the press reads as late.
 *
 * **One number, and this is why it is 5 000 ms rather than the 4 000 the request also allowed.**
 *
 *   1. It is the number this audit already calls "the opener". `AscendancePress.opener` is
 *      `t <= 5000` in `ascPresses`, and `emPresses`' own `'opener'` branch is the same `t <= 5000`.
 *      No line numbers for `index.ts`: five lanes are writing that file concurrently and every number
 *      in it moves. The rule being added here *is* "Ascendance is an opener press", so reusing
 *      the opener's own boundary is what keeps the report from calling one press the opener and late
 *      into Bloodlust in the same breath. A second, nearly-identical constant is exactly how
 *      `docs/conventions.md` says numbers drift apart — "several copies carried the numbers while
 *      dropping the comment that justified them".
 *   2. It is comfortably more than the globals the opener actually needs. The Elemental `GCD_MS` is
 *      1 500 ms and haste shortens it; the haste cooldown is ×1.3 cast speed
 *      (`wowsims-mop/sim/core/buffs.go:689`, `multiplyCastSpeedEffect(aura, 1.3)`), so a lusted
 *      global is around 1 150 ms before any gear haste. Five seconds is four such globals, which is
 *      more than the p5 list spends before Ascendance — so a press outside it is a real delay rather
 *      than opener jitter.
 *   3. Where the request gave a range, the top of it is the direction this audit is obliged to err
 *      in. On the two committed pulls the real presses land at 3 229 ms (`phased`) and 2 891 ms
 *      (`unbroken`) into the cooldown, so the bound sits 1.8 s above the later of the two: close
 *      enough to bite on a sloppier pull, far enough not to fault a clean one.
 *
 * It doubles as the definition of **"on the pull"** — see `ASCENDANCE_SYNC_LIMIT_MS`'s use against
 * `window.start` in `ascendanceSync`. Same reason: the rule is about the opener, so a haste cooldown
 * that went out after the opener is not the pull's, and one constant cannot drift from itself.
 */
export const ASCENDANCE_SYNC_LIMIT_MS = 5000;

/**
 * Ascendance's cooldown — `wowsims-mop/sim/shaman/ascendance.go`, 180 s.
 *
 * A local copy of `index.ts`' own `ASCENDANCE_COOLDOWN_MS`, and the duplication is stated rather than
 * hidden: this
 * module is deliberately not importing from `index.ts`, because the wiring goes the other way and a
 * cycle is worse than a repeated literal. When it lands, this and the `index.ts` copy should be one
 * exported constant — `src/specs/elemental/lib/index.ts` is where the Elemental game numbers already
 * live, so exporting it there and importing it here is the resolution.
 */
const ASCENDANCE_COOLDOWN_MS = 180_000;

/** Which of the two rules was applied. Exactly one is, ever — see `ascendanceSync`. */
export type AscendanceSyncRule = 'bloodlust' | 't16-4pc';

/**
 * Why the pull could not answer the question.
 *
 * Every one of these is a case where the log does not prove a fault, and each is reported as itself
 * rather than collapsed into a bad grade — the distinction `docs/conventions.md` draws between
 * `verdict_bad` and `verdict_none`: "a pull that never offered the chance has not failed to take it".
 */
export type AscendanceSyncReason =
	/** No haste cooldown opened inside the opener: never used, used later, or cast before the bell. */
	| 'no-cooldown-on-pull'
	/** The player never pressed Ascendance in this pull, so there is no press to place. */
	| 'no-ascendance-press'
	/** Ascendance was already running when the bell went — the press this rule judges is off-stream. */
	| 'ascendance-up-at-the-pull'
	/** The first press came more than one Ascendance cooldown in, so it may be a second charge. */
	| 'first-press-past-one-cooldown'
	/** Nothing was reachable inside the graded window, so the press could not have bought anything. */
	| 'nothing-to-hit'
	/** The T16 four-piece rule took precedence and has no window to sync against — see the module doc. */
	| 't16-4pc-has-no-sync-window';

/** How the pull's Ascendance opener read against whichever rule applied. */
export interface AscendanceSyncVerdict {
	/** The rule that was applied. `t16-4pc` replaces `bloodlust` outright; they never both fire. */
	rule: AscendanceSyncRule;
	/** `none` means the pull could not answer the question, and `reason` says which way. */
	grade: 'good' | 'bad' | 'none';
	reason: AscendanceSyncReason | null;
	/** The window the press was measured from, fight-relative; null when there was none to read. */
	syncStartMs: number | null;
	/** The Ascendance press that was graded, fight-relative; null when none was. */
	pressMs: number | null;
	/** `pressMs - syncStartMs`. Negative when the press came first, which is not late. */
	delayMs: number | null;
	/** The bound `delayMs` was judged against, always reported so the number is never implicit. */
	limitMs: number;
}

/**
 * Everything the rule reads, all of it already computed inside `elementalAudit`.
 *
 * Fight-relative milliseconds throughout, which is what every one of these values already is:
 * `castTimes` returns fight-relative stamps, `auraWindows` subtracts `t0` from both ends
 * (`analysis/auras.ts:127`), and `Handles.contact` is built from the same clock.
 */
export interface AscendanceSyncInput {
	/** Every Ascendance press in the pull, ascending — `castTimes(ASCENDANCE)`. */
	ascendanceCasts: readonly number[];
	/**
	 * Whether Ascendance was already running when the bell went.
	 *
	 * The one guard the log can actually supply against faulting a press the player could not have
	 * made. A press made just before the pull puts the button on cooldown for three minutes and
	 * leaves nothing in a fight-scoped stream but a bare `removebuff` of 114050, which is exactly
	 * what `auraWindows`' `openAtPull` inference recovers — the `ascendance` aura declares
	 * `durationMs: 15_000`, so the bound that rule needs is available. Computed the same way the audit's
	 * own `fePrepull` already is.
	 *
	 * It is not a complete guard and this module does not pretend otherwise: a press more than
	 * fifteen seconds before the bell leaves no trace at all. `first-press-past-one-cooldown` below
	 * is the second half of the defence — beyond one full cooldown the first visible press may be a
	 * second charge, so it is not graded.
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
	/**
	 * The T16 four-piece's sync windows, or `null` when there are none to sync against.
	 *
	 * `null` is the correct wiring today and the module doc says why at length: the Elemental
	 * four-piece is a 10-second guardian summon on a 60-second internal cooldown, triggered by a
	 * landed Lightning Bolt or Chain Lightning, with no relationship to Ascendance whatsoever. The
	 * parameter exists so that the precedence is code — a non-null value takes over from the
	 * Bloodlust rule completely — rather than a comment hoping the branch ordering works out.
	 *
	 * An empty array is not the same as `null`: it says the four-piece rule applies and found nothing,
	 * which is graded `none` / `t16-4pc-has-no-sync-window` rather than falling through to Bloodlust.
	 */
	t16FourPieceWindows: readonly Window[] | null;
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

/**
 * Where the pull's Ascendance opener landed relative to the cooldown it was supposed to ride.
 *
 * **Precedence is the first decision made and it is total.** When `t16FourPieceWindows` is non-null
 * the four-piece rule applies and the haste cooldown is never consulted; when it is null the
 * Bloodlust rule applies. There is no path on which both are read, which is the requirement — two
 * conditions that both fire and happen to agree today are two conditions that disagree after the
 * next edit.
 *
 * Everything after that decision is shared, in this order, and the order is part of the rule:
 *
 *   1. **Was there a window to measure from at all** — the rule's own precondition.
 *   2. **Did the player press it** — no press, nothing to place.
 *   3. **Can the press be attributed** — not if Ascendance was already up at the bell, and not if the
 *      first press is more than one full cooldown in.
 *   4. **Could the press have bought anything** — a graded window with nothing reachable in it is
 *      exempt, the same reading `docs/plan.md` step 22 gives every uptime denominator.
 *
 * Only a pull that clears all four gets a grade, and the grade is a single comparison against
 * `ASCENDANCE_SYNC_LIMIT_MS`. A press *before* the window opened is not late — the bound is an upper
 * bound on lateness, not a demand that the two land in a particular order — so a negative `delayMs`
 * is `good`.
 */
export function ascendanceSync(input: AscendanceSyncInput): AscendanceSyncVerdict {
	const { ascendanceCasts, ascendanceAtPull, hasteWindows, contact, t16FourPieceWindows } = input;
	const limitMs = ASCENDANCE_SYNC_LIMIT_MS;
	const rule: AscendanceSyncRule = t16FourPieceWindows === null ? 'bloodlust' : 't16-4pc';
	const none = (reason: AscendanceSyncReason, syncStartMs: number | null = null): AscendanceSyncVerdict => ({
		rule,
		grade: 'none',
		reason,
		syncStartMs,
		pressMs: null,
		delayMs: null,
		limitMs,
	});

	// 1 — the window the press is measured from. For Bloodlust that is the haste cooldown that opened
	// inside the opener, which is what "if on pull" means: a cooldown that went out at 90s is a
	// different tactical situation and Ascendance may well have been down for it, so it is not read.
	const anchor =
		t16FourPieceWindows === null
			? hasteWindows.find((w) => w.start <= limitMs)
			: // The four-piece rule reads its own windows and stops. An empty list is the finding, not a
				// reason to reach for the haste cooldown instead.
				t16FourPieceWindows[0];
	if (anchor === undefined) {
		return none(t16FourPieceWindows === null ? 'no-cooldown-on-pull' : 't16-4pc-has-no-sync-window');
	}

	// 2 — the press. The *first* one: the rule is about the opener, and the recharge three minutes
	// later answers a different question.
	const pressMs = ascendanceCasts[0];
	if (pressMs === undefined) return none('no-ascendance-press', anchor.start);

	// 3 — can this press be attributed to a button that was actually available.
	if (ascendanceAtPull) return none('ascendance-up-at-the-pull', anchor.start);
	if (pressMs > ASCENDANCE_COOLDOWN_MS) return none('first-press-past-one-cooldown', anchor.start);

	// 4 — exempt time. The graded stretch is `[anchor.start, anchor.start + limitMs]`, and the press
	// only buys something if the player had a target inside it. A pull whose opening was an
	// intermission, or that carried no enemy at all, cannot be charged for a late press: it is the
	// same reading every uptime denominator in this report already takes.
	const reachable = contactStart(contact);
	if (reachable === null || reachable > anchor.start + limitMs) return none('nothing-to-hit', anchor.start);

	const delayMs = pressMs - anchor.start;
	return {
		rule,
		grade: delayMs <= limitMs ? 'good' : 'bad',
		reason: null,
		syncStartMs: anchor.start,
		pressMs,
		delayMs,
		limitMs,
	};
}
