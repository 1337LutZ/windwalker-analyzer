// The Elemental scoring module: the bands, the weights and the whole-pull verdicts for this spec
// only.
//
// The same division the Windwalker module makes: the generic shapes live in `lib/score` — a grade
// is a grade for any spec — but everything that says what an *Elemental* number means lives here.
// The thresholds that turn the audit's measurements into judgements, the weights that turn those
// judgements into a headline, and the reading aids that colour the tiles.

import type { Analysis, ElementalAuditResult } from '~/lib/types';
import { GRADE_ORDER, gradeOf, gradedOver, grader, overallOf, section, shareOf, sharePct } from '~/lib/score';
import type { Grade, MetricRule, Scorecard, ScoreView, Threshold } from '~/lib/score';

import { registry } from './index';

/**
 * The Elemental audit's fields, named for the type that holds them.
 *
 * `analyseCore` merges the audit's fields over `AnalysisCore` but types the result `Analysis` —
 * the Windwalker shape — so the Elemental module casts at its own boundary. This is the same
 * bounded, stated cast the Elemental audit already makes at the `SpecConfig` boundary and the
 * Windwalker views make for their rule keys: the fields below were produced by `elementalAudit`,
 * which is the only place an Elemental analysis can come from.
 */
type ElementalAnalysis = Analysis & ElementalAuditResult;

// The four helpers that used to be copied here live in `~/lib/score`. The binding to this spec's
// thresholds moved *into* `scoreAnalysis` as `grader(THRESHOLDS, view)`: it now carries the pull's
// reading as well as the table, and a module-level constant cannot, because the reading arrives per
// call. That is the point of binding it once — the reading is the half it would be easy to leave off
// exactly one metric, which is the failure mode the whole mechanism replaces.

/**
 * How a share of a wasted pool reads as a colour.
 *
 * Deliberately *not* part of `lib/score`'s graded model, for the same reason the Windwalker's copy of
 * this is not: nothing in the simulator or the priority list says how much of a pool it is acceptable
 * to throw away, and inventing a threshold in order to call a verdict is the failure this report is
 * built to avoid. What this is instead is a reading aid on one tile, so a number a reader cannot
 * calibrate carries some hint of its own size. Nothing it returns reaches a scorecard or the headline.
 *
 * Far more forgiving than the monk's 2%/5%, because mana is not the constraint an Elemental's rotation
 * runs into. A monk who lets energy sit at the ceiling has lost the global that would have spent it; a
 * shaman at full mana has lost regeneration from a pool deep enough to cast from for the whole pull,
 * and the fault the mana section actually draws is the opposite end — the stretches spent empty. So a
 * small share is not worth a colour at all, and only a large one is worth a reader's eye.
 *
 * Round numbers, and round on purpose. One reference report is not a distribution, and quantiles taken
 * off it would claim a precision that does not exist.
 *
 * Reached today only if this spec grows a second bar: `Resource` draws mana as the one pool whose being
 * full is not a fault, so it shows no waste tile to colour. It lives on the definition anyway because
 * every spec has to answer the question, and this is the Elemental's honest answer to it.
 */
const WASTE: Threshold = { good: 10, ok: 25, higherIsBetter: false };

export function wasteTone(wasted: number, generated: number): Grade | null {
	// No denominator, no opinion. A pull that regenerated nothing has not wasted a share of anything.
	return generated > 0 ? gradeOf(WASTE, (wasted / generated) * 100) : null;
}

/**
 * Grades one pull.
 *
 * Section keys match the report's section ids, so a component asks for its own verdict by the name
 * it already has.
 */
export function scoreAnalysis(analysis: Analysis, view: ScoreView = null): Scorecard {
	const el = analysis as ElementalAnalysis;
	const { flameShock, earthShock, searingTotem, snapshots, lightningShield, fireElemental, cpm } = el;
	// Bound once, so no metric below can be built outside the exemption. See `grader`.
	const metric = grader(THRESHOLDS, view);

	const gcdUtilisation = metric('gcdUtilisation', cpm.gcdSlots > 0 ? cpm.gcdUtilisationPct : null);

	/**
	 * **`gradedOver` and not the bare percentage, which is the half of the exemption that the declaration
	 * cannot supply.** `scoredMs` is the contact clock less the stretches three or more enemies were up, so
	 * on a pull spent wholly above two enemies it is zero — and a share taken over no time at all is not a
	 * dot nobody dropped, it is a dot nobody measured. `windows.length > 0` does not catch that: the dot
	 * was applied, its windows exist, and every one of them fell outside the graded clock.
	 *
	 * Both guards, because they answer different questions. The window count says the log holds no dot at
	 * all; the clock says no stretch of this pull was this rule's to grade. `metricOf` nulls on either.
	 */
	const flameShockUptime = metric(
		'flameShockUptime',
		gradedOver(flameShock.windows.length > 0 ? flameShock.uptimePct : null, flameShock.scoredMs),
	);
	/**
	 * The refreshes that bought nothing — none of the three reasons the list has to press the button into a
	 * dot that is still running. Over the refreshes **a list asked the question at**, and never over the
	 * applies, which were correct by construction (there was no dot to clip).
	 *
	 * **Not nullable per press, and that is the point.** A press the log cannot measure a snapshot delta
	 * for keeps whatever kind it would have had without one, so it lands in `refreshes` and in none of the
	 * three excuses — charged, which is the old verdict, rather than quietly forgiven.
	 *
	 * **The two `unjudged` terms are the numerator per band this entry used to ask for, and the declaration
	 * below could never have given it.** `bands: [1]` nulls a metric only when the intersection with the
	 * pull's own bands comes out *empty*, and `cleave` — the mixed pull the whole exercise came off —
	 * resolves to `[1, 2, 3, 4]`, so the declaration intersects non-empty and narrows nothing whatsoever.
	 * The audit narrows the sample instead, press by press, off the same `aplTargetCountAt` series the
	 * priority ladder bands its rungs on: `FlameShockPress.judged`, counted at `fsUnjudgedRefreshes`. The
	 * declaration stays and now claims only what it can — that a reader who declares a whole pull
	 * multi-target is not asked this question at all.
	 *
	 * **Written as a subtraction from the pull-wide ledger and not as an independent graded pair**, which is
	 * the same expression with one property the pair does not have: every consumer that rewrites
	 * `refreshes`, `windowed`, `ascPrep` or `snapshotGain` moves this grade with it. The section prints its
	 * verdict off exactly those four, and is rendered against hand-written ledgers in its own tests; a grade
	 * read off two separate counts would describe the real pull while the sentence beside it described the
	 * written one. `FlameShockAudit.unjudgedRefreshes` states it as the field's own reason. The identity is
	 * `judged waste / judged refreshes` either way — asserted per fixture in `__fixtures__/bands.test.ts`.
	 *
	 * Band 1 alone, and the argument is at `FlameShockPress.judged`. In short: what a refresh is credited
	 * for here is p5's three excuses, and `cleave.apl.json` rung 9 is `maxOverlap: 2s` and nothing else —
	 * no snapshot term, no Ascendance term, and a flat 2 000ms where the last-tick excuse is measured
	 * against the dot's own cadence. The two disagree in both directions, so band 2 is out rather than
	 * merely generous.
	 *
	 * ## What it does to the three committed pulls
	 *
	 * Stated per pull, because a declared scope that moves nothing looks like a control and is not one.
	 *
	 *   - `phased` and `unbroken` **never exceed one enemy**, so every refresh is judged: 4 of 4 and 6 of
	 *     6, 25% `ok` and 33.33% `bad`, both unmoved. They are the deliberate no-change guards.
	 *   - `cleave` is the only committed pull with band-3+ time, and its sample goes from **2 refreshes to
	 *     1** — `unjudgedRefreshes` is 1 and `unjudgedWaste` is 1. The press that leaves is the faulted one,
	 *     at 57 499ms with **four** enemies up, where `aoe.apl.json` rung 1 refuses to refresh a live dot at
	 *     all and not one of p5's three excuses is on the list. The numerator goes to 0 and the raw share
	 *     from 50% to 0%.
	 *
	 * **And on `cleave` it still refuses, which is the honest outcome rather than the satisfying one.** One
	 * judged refresh is under `MIN_GRADED_SAMPLE`, and two refreshes already were — the card was
	 * unmeasurable before this change and is unmeasurable after it, so no pull's count of graded metrics
	 * moves and `overall()` keeps the denominator it had. What changed is the ground the refusal stands on:
	 * a sample of one press the rule was about, rather than a sample of two with a band-4 press in it. The
	 * report stops making a claim it could not support; it does not start making a better one.
	 *
	 * **`shareOf` and not `sharePct`, which is what applies that floor.** The denominator is a count of
	 * presses rather than a span of milliseconds, so the floor means something here: three is the first
	 * denominator with an interior, and below it every grade this metric can produce is one press away from
	 * a different one. `MIN_GRADED_SAMPLE` names this row in its own docblock, and names this exact pair —
	 * `1/2` today and `0/1` once the aoe stretches leave — as the case that found it.
	 *
	 * **What the two audit tests read, now that the two shares differ.** `flameShockClearcasting.test.ts`
	 * and `flameShockSnapshot.test.ts` reconstruct this share off the audit rather than off `metric.value`,
	 * because what they assert is the *attribution* — which press the walk called windowed, which it called
	 * a snapshot gain — and `metricOf` zeroes the value of a metric it refuses. They reconstruct it
	 * **pull-wide**, `(refreshes − windowed − ascPrep − snapshotGain) / refreshes`, which is this expression
	 * without its two `unjudged` terms and the figure the section's tiles and verdict sentence show. That is
	 * deliberate: an attribution test should not go quiet because a band left the sample, and the two
	 * numbers are the same on every pull that stays at one enemy.
	 */
	const flameShockWaste = metric(
		'flameShockWaste',
		shareOf(
			flameShock.refreshes -
				flameShock.windowed -
				flameShock.ascPrep -
				flameShock.snapshotGain -
				flameShock.unjudgedWaste,
			flameShock.refreshes - flameShock.unjudgedRefreshes,
		),
	);

	/**
	 * The cleave preset's multi-dot rule: while two enemies are up, the dot should also sit on the
	 * secondary target.
	 *
	 * **`gradedOver` and no hand-written guard in front of it**, which is a collapse rather than an
	 * addition. This read `multiTargetMs > 0 ? pct : null`, and that ternary *was* the empty-clock check,
	 * written out by hand at the one call site that happened to think of it — the failure `Measured` exists
	 * to stop. `multiTargetMs` is this share's denominator, so passing it as the graded length says the
	 * same thing through the one mechanism, and `metricOf` nulls on it for the same reason it nulls on the
	 * shield's.
	 *
	 * Unlike `flameShockUptime` there is no second guard to keep beside it, because there is no second
	 * question. The dot's uptime keeps `windows.length > 0` because "no dot in the log at all" and "no
	 * gradable stretch" are different facts; here both of the ways this can be empty — no second target
	 * worth dotting, no stretch at two enemies — are already *in* the clock, by the audit's construction of
	 * it. A `windows.length` clause on the secondary's dot would be worse than redundant: an undotted
	 * secondary is precisely the fault this metric exists to report, so refusing to grade the pull that has
	 * none would silence the only answer it can give.
	 *
	 * The clock behind it is band 2 alone — `>= 2` less `>= 3` — and that cut is the audit's, at `mdGraded`
	 * in `index.ts`. What it is worth is at this metric's threshold entry.
	 */
	const flameShockMultiDot = metric(
		'flameShockMultiDot',
		gradedOver(flameShock.multiDotUptimePct, flameShock.multiTargetMs),
	);

	/**
	 * Over `judged` and not `presses.length`: the band-3 and band-4 presses are not in the denominator.
	 *
	 * `aoe.apl.json` has no Earth Shock rung, so at three or more enemies there is no rule for a shock to
	 * be good or bad against, and since `0de530e` the priority ladder says the same thing — `earth-shock`
	 * is `bands: [1, 2]`. Counting those presses here graded them against the single-target rule while the
	 * ladder graded them against Chain Lightning, which is the two halves of the report disagreeing about
	 * one press. See `EarthShockPress.good`, which is null for exactly those presses.
	 *
	 * **This metric was band-aware before `bands` existed, and `judged` is the half that made it real.**
	 * The declaration on the rule below says which counts the number means anything at; this counter is
	 * what actually removes the presses made at the other counts. Measured on `cleave`: twelve presses, of
	 * which four were at one enemy and three at two, and `judged` is exactly those seven. That pairing —
	 * a declared scope and a narrowed sample — is what every other count metric in this table still owes,
	 * and the reason it is worth naming here is that the declaration alone would not have done it.
	 *
	 * `shareOf` rather than the old `judged > 0 ?` guard, which said the same thing in one of the two
	 * cases: a denominator of zero still declines, and one of two judged presses now declines as well.
	 * Two shocks cannot separate a habit from a coin toss — see `MIN_GRADED_SAMPLE`.
	 */
	const earthShockGood = metric('earthShockGood', shareOf(earthShock.good, earthShock.judged));

	// `gradedOver` for the reason `flameShockUptime` above gives: `scoredMs` here composes three exempt
	// causes — the elemental's window, the intermissions and the add waves — and a pull that is all three
	// arrives with an empty clock. A totem clock nobody measured must not read as a totem nobody dropped.
	const searingTotemUptime = metric(
		'searingTotemUptime',
		gradedOver(searingTotem.windows.length > 0 ? searingTotem.uptimePct : null, searingTotem.scoredMs),
	);

	// Placements under the Fire Elemental: the one case the list forbids outright, so it is counted on
	// its own rather than folded into the uptime figure. Null when the totem was never cast, so the
	// section reads "none" rather than "good" on a pull with nothing to grade.
	//
	// **No band, and this is the one metric here where an earlier plan asked for one.** That plan wanted
	// band 3 and up exempt, by the same argument that carries `searingTotemUptime`: `aoe.apl.json` has no
	// Searing Totem rung, so above two enemies the totem is not a press the list asks for. The argument
	// does not reach this number, because this number is not about the list. One fire totem stands at a
	// time and the elemental supersedes the totem — `SearingTotemAudit.windows` are already cut short
	// wherever `feWindows` took the slot — so a totem pressed under the elemental bought nothing at
	// *every* target count. The count changes which button the global should have gone to; it does not
	// change that this global bought a totem that was replaced the instant it landed. Same shape as
	// `lightningShieldFellOff` below, and the opposite shape from the shield's *spending*.
	//
	// And a band here would forgive in two places at once. A totem pressed at five enemies is already
	// faulted by the priority ladder, where `searing-totem` is `bands: [1, 2]` and the press falls
	// through to Chain Lightning. Exempting it here as well would leave the one press that is wrong on
	// both counts — no rung asked for it *and* the slot it claimed was occupied — carrying no verdict
	// anywhere. `feOverlaps` is 0 on all three committed pulls, so this ruling costs nothing measurable
	// today; it is written down because the plan it overrules is still readable.
	const searingTotemOverlaps = metric(
		'searingTotemOverlaps',
		searingTotem.windows.length > 0 ? searingTotem.feOverlaps : null,
	);

	/**
	 * Whether the Fire Elemental was already out when the bell rang.
	 *
	 * Two states, and the second one is deliberately not a fault — see the threshold for the whole of
	 * that argument. What is decided here is only whether this pull may be asked the question at all,
	 * and both halves of the gate are the elemental's own minute rather than a number invented for it:
	 *
	 *   - **The pull has to be at least as long as the summon lasts.** A pre-pull elemental is visible
	 *     only as the bare expiry it leaves behind — `auraWindows`' `openAtPull` recovers the window
	 *     from that removal and from nothing else — so on a shorter fight it would still have been
	 *     standing at the last event and leaves no trace at all. "Not out at the bell" and "cannot
	 *     tell" are the same event stream there, and the second one is the truth. The same refusal the
	 *     Windwalker's pre-pull potion slot makes, for the same reason.
	 *   - **This player has to have been in the fight for the stretch a pre-pull summon would have
	 *     covered.** A pull the player entered late is not a pull whose opening was theirs to fill,
	 *     and judging its first minute would charge them for a fight they were not in. Contact is
	 *     asked for *somewhere* inside that minute rather than at the bell itself: the first landed hit
	 *     is a cast plus its travel time behind the pull on every real log — 1.0s on `phased`, 1.6s on
	 *     `unbroken` — so a stricter reading would refuse both committed pulls.
	 */
	const elementalMinuteMs = registry.aura('fire-elemental').durationMs ?? 0;
	const inFightForTheOpening = (el.timeline?.contactSegments ?? []).some(([start]) => start < elementalMinuteMs);
	const fireElementalPrepull = metric(
		'fireElementalPrepull',
		el.durationMs >= elementalMinuteMs && inFightForTheOpening ? (fireElemental.prepull ? 1 : 0) : null,
	);

	/**
	 * Rule 5 — the summon's uptime inside the haste cooldown the raid brought on the pull.
	 *
	 * **`gradedOver` and no second guard in front of it, which is the whole shape of this metric.** The
	 * audit hands over a numerator and the clock it was measured on, and every reason this pull might have
	 * nothing to say has already been folded into that clock: the talent not taken, the talent unreadable,
	 * and a haste cooldown that did not go out on the pull. So there is exactly one place the refusal can
	 * come from, and no proxy in front of it that could answer a different question — "the summon was out",
	 * "the raid lusted", "the talent list was read" are all true of pulls this rule cannot grade.
	 *
	 * `sharePct` is belt to the same braces: it declines at a whole of zero, so the value is null on the
	 * identical condition `metricOf` refuses on. Both, because they say it in different places, and
	 * neither is load-bearing alone.
	 *
	 * **Not `shareOf`.** The denominator is a span of milliseconds and `MIN_GRADED_SAMPLE` is a floor on
	 * *events* — three milliseconds of lust is not a sample of three, and `sharePct` is what
	 * `lib/score/build.ts` says to reach for when the whole is a clock.
	 */
	const fireElementalHasteUptime = metric(
		'fireElementalHasteUptime',
		gradedOver(
			sharePct(fireElemental.hasteUptime.coveredMs, fireElemental.hasteUptime.gradedMs),
			fireElemental.hasteUptime.gradedMs,
		),
	);

	// Against the windows the pull could actually have claimed, not every proc window that fired. A
	// window the dot was down through was never a chance to refresh it. Named `flameShockSnapshots`
	// rather than the Windwalker's `snapshotRate` so the two specs' takeaway copy does not collide:
	// the Windwalker's says "brew on the last global of a Re-Origination window", which is not advice
	// an Elemental can act on.
	const snapshotRate = metric(
		'flameShockSnapshots',
		shareOf(snapshots.refreshed, snapshots.refreshed + snapshots.missed),
	);

	// Lightning Shield's own two faults: sitting at the ceiling so long the Rolling Thunder has
	// nowhere to put its charge, and letting the shield come all the way off. Both are carried into
	// the summary as cards; neither is weighted heavily enough to swing the headline, because both are
	// "wake up and spend it" habits rather than the snapshots the spec is built on.
	//
	// **The two halves of one aura are graded on two different clocks and declare different bands, and
	// that is deliberate.**
	// Amendment 3: Rolling Thunder (88765) returns 2% of maximum mana per charge granted, doubled by
	// the T16 four-piece, and it only runs while the buff is up — so the shield's *uptime* is the
	// spec's mana engine at every target count and `fellOff` is graded over the whole pull, banded or
	// not. Its *spending* is what the target count changes: nothing in the aoe list spends the
	// charges, so sitting at seven through an add wave is the only possible state and cannot be a
	// fault. `overcapMs` therefore arrives already measured against the single-target stretches alone
	// (`atCapWindowsIn`, restarted at every regime boundary), and this site takes it as given — the
	// clock is the audit's to cut, not the score's to second-guess.
	//
	// **The one hazard a band declaration makes worse rather than better, and it is closed here.** A pull
	// with no single-target stretch at all has an empty graded clock, and `0ms of overcap` over no time is
	// `good` — the best mark on the card, handed to exactly the pull the exemption just excused, which is
	// a free pass rather than the honest "cannot say". `maxStacks > 0` is the wrong guard for it, because
	// the shield was up and counting the whole time; every proxy for "was the thing present" answers a
	// different question from "was anything graded".
	//
	// So the value arrives through `gradedOver` and `metricOf` nulls on a graded length of zero. The
	// `maxStacks` clause stays in front of it because the two guards say different things — no shield in
	// the log at all, against no stretch of the pull this rule could speak about — and `maxStacks` is the
	// game model's ceiling rather than this pull's peak, so it was never the clock question in disguise.
	//
	// `gradedMs` is `unionMs(gradedSpans)`, published by the audit next to the array the overcap was
	// measured inside. Deriving it here from `aoeWindows` and `durationMs` was considered and rejected: it
	// would be a second computation of a span the audit already holds, free to disagree with the one the
	// overcap was actually measured in, and the whole reason it is a published field rather than an
	// inference is that a guard reconstructed at the reader is a guard that can drift out of step with the
	// thing it guards. `bandedClocks.test.ts` is where the empty-clock pull is built and the refusal
	// asserted, since no committed fixture has that shape.
	const lightningShieldOvercap = metric(
		'lightningShieldOvercap',
		gradedOver(lightningShield.maxStacks > 0 ? lightningShield.overcapMs : null, lightningShield.gradedMs),
	);
	const lightningShieldFellOff = metric('lightningShieldFellOff', lightningShield.fellOff);

	/**
	 * The pool's two faults, and both of them are omissions — the player is charged for *not* pressing
	 * something, so the evidence bar is higher than it is for a press that went out at the wrong moment.
	 *
	 * **Unmeasurable, not zero, on a log that carried no readings.** Two of the three committed fixtures
	 * hold no `classResources` at all — `phased` and `unbroken` were captured without the flag — and
	 * without this clause they would be the two best-graded mana pulls in the report, on no data. The
	 * same refusal `flameShockMultiDot` makes on a single-target pull, and the same one this spec's
	 * Fire Elemental threshold spells out at length: a metric that cannot be answered leaves
	 * `overall()`'s weighted denominator rather than reading as a free full mark.
	 *
	 * **And unmeasurable on a pull that never put the pool below the line with the button in hand**, which
	 * is the second half of the same guard and the one the plan asked for by name: *"if none of them ever
	 * drops under 15% the section grades nothing and the metric must be unmeasurable, not a free 100%."*
	 * `gradedMs` is the length of the clock the fault was measured over — time below the line with the
	 * tool provably available — and a zero there covers the pull that never got low, the pull that got low
	 * only while both buttons were away, and the pull too short to prove availability across at all. None
	 * of them is a pull where a press was declined, so none of them earns the mark for not declining one.
	 * This is the hazard `lightningShieldOvercap`'s own comment names two blocks below and could not fix
	 * for want of exactly this number.
	 *
	 * Optional though the type requires it, for the reason the `timeline?` read above is: an `Analysis`
	 * is serialised, and a report captured before this audit existed arrives without the field. Absent is
	 * the same answer as no readings.
	 */
	const mana = el.mana as ElementalAnalysis['mana'] | undefined;
	const manaRead = mana !== undefined && mana.samples > 0;
	/**
	 * Thunderstorm's fault, in milliseconds: the pool at or under 15% with the rescue in hand.
	 *
	 * A duration and not a count, because what the fault costs is time — every second at 15% is a second
	 * the next Lava Burst might not go out, and a stretch twice as long is twice as bad. The count of
	 * stretches is on the page beside it; the graded number is the clock.
	 */
	const thunderstormMissed = metric(
		'thunderstormMissed',
		manaRead && mana.starved.gradedMs > 0 ? mana.starved.ms : null,
	);
	/**
	 * Shamanistic Rage's fault, as a count of presses the priority list asked for and did not get.
	 *
	 * A count and not a duration, and the difference is the point: the Rage lasts fifteen seconds off a
	 * sixty-second timer, so it can only be pressed once a minute and "how long you were under 70%" is
	 * mostly a fact about the fight rather than about the press. What the player controls is whether the
	 * button went down each time it came back to a pool already under the line, and that is a count.
	 */
	const shamanisticRageMissed = metric(
		'shamanisticRageMissed',
		manaRead && mana.strained.gradedMs > 0 ? mana.strained.stretches : null,
	);

	const all = [
		gcdUtilisation,
		flameShockUptime,
		flameShockWaste,
		flameShockMultiDot,
		earthShockGood,
		searingTotemUptime,
		searingTotemOverlaps,
		fireElementalPrepull,
		fireElementalHasteUptime,
		snapshotRate,
		lightningShieldOvercap,
		lightningShieldFellOff,
		thunderstormMissed,
		shamanisticRageMissed,
	];

	// `overallOf` rather than `overall`: the denominator travels with the verdict, so a headline drawn
	// over a pull most of whose weight went unjudged says so instead of reading as a whole-pull claim.
	const { grade, judged } = overallOf(all, weightsFor(view));

	return {
		overall: grade,
		judged,
		sections: {
			flameShock: section([flameShockUptime, flameShockWaste], [flameShockMultiDot]),
			earthShock: section([earthShockGood]),
			searingTotem: section([searingTotemUptime, searingTotemOverlaps]),
			// The summon's own section, which carries one metric and gets no card link: the anchors map in
			// `specSections.tsx` has no entry for it, so the takeaway renders without a jump the way the
			// `casts` card already does. It is a section here because the scorecard is the only route into
			// the summary — `Takeaways` walks these sections — and the page's Fire Elemental section reads
			// the same metric back through `toneOf` for its own note.
			// Both of the summon's rules, and `fireElementalPrepull` stays first: the section's own note and
			// `firePrepull.test.ts` both read `metrics[0]`, and the pre-pull grade is the one that answers
			// "was it out at all". Rule 5 is primary beside it rather than secondary, because it is a graded
			// absolute — a section that could not go worse than `ok` cannot carry one.
			fireElemental: section([fireElementalPrepull, fireElementalHasteUptime]),
			flameShockSnapshots: section([snapshotRate]),
			// The shield's section carries both of its faults; neither is primary-weighted enough to
			// carry a headline, but the section still reads a verdict off them for its own copy.
			lightningShield: section([lightningShieldOvercap, lightningShieldFellOff]),
			// The pool's own section, and both of its faults are omissions — see the metrics above. Neither is
			// primary-weighted enough to carry the headline on its own; the section reads its verdict off
			// both so its copy can say which of the two buttons was the one left on the bar.
			mana: section([thunderstormMissed, shamanisticRageMissed]),
			casts: section([gcdUtilisation]),
		},
	};
}

export { GRADE_ORDER };

// Where the lines sit, and why each one sits there.
//
// These are the only numbers in the app that turn a measurement into a judgement, so each carries
// the reasoning that put it where it is. The same convention the Windwalker thresholds keep.
//
// ## What `bands` on a rule here does, and what it does not
//
// Read this before adding one, because the name invites a stronger reading than the mechanism has.
//
// A declaration is a statement about *which target counts this number means anything at*. `metricOf`
// reads it exactly one way: it intersects the rule's bands with the bands the pull was read at, and if
// that intersection is **empty** the metric is `unmeasurable` with `exempt` beside it. So a declaration
// speaks only to a pull that never entered the rule's bands at all — a pull read wholly as multi-target,
// or one whose counts never left the range the rule is not about.
//
// **It does not cut a clock**, and on its own — on the mixed pull this whole exercise is about — it
// therefore changes nothing. `cleave` resolves to `[1, 2, 3, 4]`, so every declaration below intersects
// non-empty. `lib/score/bands.ts` says so in its own words: "Nothing here decides *how much* of a clock
// to cut."
//
// **The half that does is the audit's, and it has landed.** `specs/elemental/lib/index.ts` hoists one
// `gradedSpans = complementOf(aoeWindows, duration)` and cuts four clocks with it — the dot's uptime, the
// totem's uptime, the shield's overcap and the second dot's uptime — intersecting the numerator and the
// denominator of each ratio with the same array, because clipping one half and not the other is how an
// uptime above 100% happens. It publishes the length of each, so `metricOf` can null on a clock that came
// out empty rather than grading `0ms of fault` over `0ms of time` as a perfect pull.
//
// The fourth is the odd one and worth naming here: `flameShockMultiDot` is `bands: [2]` rather than
// `[1, 2]`, so `gradedSpans` is its *ceiling* over a clock that already had a floor — the cut is
// `intersect(multiTargetWindows, gradedSpans)`, the `>= 2` series less the `>= 3` one, and what is left is
// band 2 and nothing else. Same array, both edges.
//
// So a declaration is necessary and not sufficient, and both halves have to be present for a rule to be
// honest. Four of the seven declarations below have a cut clock behind them, `flameShockMultiDot` being the
// last to get one — band 2 alone, `>= 2` less `>= 3`, the one cut with an edge at both ends. The remaining
// three are rules whose *sample* is narrowed instead of their clock (`earthShockGood`'s `judged` counter) or
// whose number is a count of presses rather than a span. Reading a verdict, the two states to keep apart
// are: an `exempt` metric was never asked of this pull at all, and a graded metric whose clock has been
// narrowed to the stretches that did ask.
//
// What earns a declaration: a rung only some target counts' lists contain, where the *number this
// metric is* is a reading of that rung. What does not: a resource, a slot, a global or a pre-pull press
// that exists identically at every count — those stay graded everywhere, however many enemies were up.
// Seven of the thirteen entries below carry one; the six that do not each say why beside them.

export const THRESHOLDS = {
	/**
	 * Share of available globals actually used.
	 *
	 * Elemental is a cooldown- and proc-driven rotation on a 1.5s global: there is no resource bar
	 * to overcap, so the ceiling is the boss's uptime rather than a pool refilling. Between casts the
	 * list genuinely wants to stand still — waiting for a Lava Surge or a cooldown is correct play,
	 * not a missed global — so the thresholds are cut looser than the Windwalker's energy-gated rotation
	 * and a high number is not the target the way it is there.
	 *
	 * **No band.** Every one of the three lists fills every global, and none of them has a rung that says
	 * to stand still — the standing still this forgives is the *absence* of a ready rung, which happens
	 * at all four counts. Filling globals is the one thing this spec is asked for identically however many
	 * enemies are up, and the aoe list is if anything the easiest of the three to fill them from.
	 */
	gcdUtilisation: { good: 80, ok: 65, higherIsBetter: true },

	/**
	 * Flame Shock's uptime on the primary target, against engaged time.
	 *
	 * A thirty-second dot with no cooldown and no cast time is meant to be up for the whole pull;
	 * the sim's own Lava Burst rule refuses to cast Lava Burst unless the dot outlives its cast, so a
	 * dropped Flame Shock is not one global but a cascade. The bar is therefore high, like the
	 * Windwalker's Rising Sun Kick debuff.
	 *
	 * **`bands: [1, 2]`, and the argument is about the bar rather than about the button.** It would be
	 * wrong to say the aoe list does not want the dot: `aoe.apl.json` rung 1 casts it, on
	 * `auraIsKnown(138898) AND not(dotIsActive(8050))`. What that list does not have is the thing the
	 * 95%/85% bar is *derived from* — it carries **no Lava Burst rung at all**, so the cascade in the
	 * paragraph above, a dropped dot costing far more than the global that would have replaced it, does
	 * not exist above two enemies. All the aoe list asks is that the dot go back up when it is down,
	 * once, at a rung below the beam; a 95% clock is not that rule stated in percent. The p5 rules this
	 * bar was written from — 7, 12 and 16 — are band 1, and `cleave.apl.json`'s rung 9 is band 2, so
	 * those two counts keep it.
	 *
	 * **The declaration does not shorten the clock; the audit does, and it now has.** `uptimePct` is
	 * `contactUptimeMs / scoredMs`, and both halves are intersected with `gradedSpans` in
	 * `specs/elemental/lib/index.ts` — together, in one array, because clipping one and not the other is
	 * how a share above 100% happens. On `cleave` the denominator went from 261 572ms to 178 814ms and the
	 * numerator from 189 111ms to 150 023ms, taking the figure from **72.30% to 83.90%**. Both single-target
	 * fixtures are unmoved, which is what says the cut found the add waves and nothing else.
	 *
	 * It is still `bad`: 83.90% is 1.1 points under the 85% `ok` line. That is the honest outcome and worth
	 * stating plainly, because the point of the cut was never to make the number pass — it was to measure
	 * it over the stretches a list asked for the dot. This player dropped the dot on the boss too, and the
	 * exemption does not hide it.
	 */
	flameShockUptime: { good: 95, ok: 85, higherIsBetter: true, bands: [1, 2] },

	/**
	 * Share of Flame Shock refreshes that bought nothing.
	 *
	 * A refresh is a fault only when it was none of the three reasons the list has to press the button
	 * while the dot is already up: its last tick window, the Ascendance prep, or a new application worth
	 * more than 10% more damage per millisecond of dot than the one it replaced. Everything else clips a
	 * healthy dot for no gain. Lower is better.
	 *
	 * **`bands: [1]`, and band 2 is out as well as band 3+ — which is the answer that needed measuring.**
	 * The reason is that this number's *numerator* is p5's, clause by clause. `cleave.apl.json` rung 9 is
	 * `multidot(8050, maxDots: 2, maxOverlap: 2s)` and that is its whole Flame Shock rule: it carries
	 * neither p5's snapshot reapply (7) nor its Ascendance prep (12), so two of the three excuses
	 * subtracted above are not excuses the two-target list ever granted. Nor does the third survive
	 * intact — `windowed` is measured against the dot's own tick cadence, which ran at 1 349, 1 748 and
	 * 2 275ms on one committed pull, so a refresh with 2 400ms left is excused here and faulted by rung
	 * 9's flat 2 000ms. The excuse set is wrong in *both* directions at band 2, not merely too generous,
	 * and grading against it is the same defect `apl.ts` already fixed for this rung: applying p5's
	 * Ascendance-prep clause above one target "was this ladder asking for a press the sim's own list
	 * never asks for".
	 *
	 * **What that costs, stated rather than left to be found.** At band 3+ `aoe.apl.json` rung 1 refuses
	 * to refresh a live dot at all, so a band-3+ refresh is a fault by a *stricter* rule than this one,
	 * and declaring the band means the score says "cannot say" about it instead of faulting it. That is
	 * the forgiving direction, which is the dangerous one. It is acceptable only because the press is not
	 * thereby unattributed: the priority ladder's `flame-shock` rung switches lists per press, so a live-dot
	 * refresh at three enemies fails its condition there and is charged against Chain Lightning or Lava
	 * Beam — the same disposal `apl.ts` argues for Earth Shock.
	 *
	 * **The numerator per band this entry used to ask for has landed, and it is not what the declaration
	 * does.** The sentence here was "a numerator per band in the audit, not a wider declaration here", and
	 * the audit now publishes one: `FlameShockPress.judged` per press, and `unjudgedRefreshes` and
	 * `unjudgedWaste` beside it as what that flag takes out, so the *sample* is cut to band 1 instead of
	 * being counted at every band under a declaration that says band 1. What the rule declares and what the number is measured over are the
	 * same set of presses for the first time. It does not let this metric speak at bands 2 or 3+ — nothing
	 * in this table can, because the three excuses are p5's and neither other list grants them — and it
	 * moves neither of the two single-target pulls, which never leave band 1. On `cleave` it removes one
	 * refresh of two, which is the band-4 press at 57 499ms, and the metric then refuses at
	 * `MIN_GRADED_SAMPLE` rather than grading a 50% that was that one press. See the metric itself for
	 * what each pull reads before and after.
	 */
	flameShockWaste: { good: 10, ok: 30, higherIsBetter: false, bands: [1] },

	/**
	 * The dot's uptime on the secondary target while **two** enemies were up — the cleave preset's
	 * multi-dot rule. A second target that stays undotted for the whole of that stretch is a dot the
	 * player never put where it would tick for free; keeping both up is the skill the fight asks for.
	 * Unmeasurable on a single-target pull.
	 *
	 * **`bands: [2]` — one band, and the only entry in this table with a hole in the middle of it.** The
	 * second dot is `cleave.apl.json` rung 9's `maxDots: 2` and appears in neither of the other two
	 * lists: p5's rung 16 is `maxDots: 1` and never leaves the unit it is aimed at, and `aoe.apl.json`
	 * rung 1 has no `multidot` at all. So band 1 is excluded for the reason the metric already declined
	 * there — there was no second target — and band 3+ is excluded because from three enemies up the list
	 * stops asking for a second dot and starts asking for Lava Beam and Chain Lightning. Two enemies is
	 * the one count at which spreading the dot is the rule.
	 *
	 * The band and the empty-clock guard say different things, and both survive: the clock says the pull
	 * offered no gradable two-target stretch, the band says the list did not ask for a second dot at the
	 * counts this pull visited. On `phased` and `unbroken` the two agree and the metric reads `exempt`
	 * where it once read only "cannot say" — the same number, a better reason.
	 *
	 * **This was the last clock in the table still uncut, and it is cut now.** `multiTargetMs` was the time
	 * two *or more* enemies were up, so on a mixed pull it ran through bands 3 and 4 as well and the
	 * declaration above did not shorten it. It is now `intersect(multiTargetWindows, gradedSpans)` — the
	 * `>= 2` series less the `>= 3` one, which is band 2 alone and the only cut in this audit with an edge
	 * at *both* ends; the other three are band-1-or-2 rules and take a ceiling only. `multiDotUptimeMs`
	 * comes off the identical array, so the ratio's two halves cannot disagree.
	 *
	 * **On `cleave` the clock goes 148 865ms to 66 007ms and the figure 16.64% to 18.73%, and the metric
	 * stays `bad`** — as does the section, and the pull's verdict. The whole 82 858ms the denominator loses
	 * is the exempt array to the millisecond, which is the arithmetic saying every add-wave second was
	 * inside the two-target clock and none of it outside. The numerator loses 12 407ms of 24 769. Neither
	 * single-target fixture moves, because neither ever reaches two enemies.
	 *
	 * So this is a correctness change with **no verdict behind it**, which is worth stating rather than
	 * dressing up: 18.73% is as far under the 60% `ok` line as 16.64% was. On this pull the undotted second
	 * target is a *real* fault and not an artefact of a clock that ran too long — the player dotted the
	 * secondary for under a fifth of the time two enemies were up whichever way the stretch is counted.
	 * What the cut buys is that the published figure is now a reading of the rung it names, and that a pull
	 * whose only two-target seconds fell inside an add wave says "cannot say" instead of 0%.
	 */
	flameShockMultiDot: { good: 85, ok: 60, higherIsBetter: true, bands: [2] },

	/**
	 * Share of Earth Shock presses the sim's rule wanted.
	 *
	 * The rule is two rules, and the tier-16 two-piece proc picks which one a press is judged against:
	 * with the proc down, Lightning Shield at the ceiling, the Flame Shock dot above six seconds and
	 * Ascendance not about to demand the shock timer; with the proc up, the shield at the ceiling, the
	 * proc's debuff inside its last four seconds and the dot outliving two ticks. A press that passes its
	 * own branch is the list's own call; a press that fails a condition of it is a shock spent early.
	 *
	 * **`bands: [1, 2]`, migrated from the bespoke counter that has been doing this job since `0de530e`.**
	 * `aoe.apl.json` has no Earth Shock rung, so from three enemies up there is no branch a press can pass
	 * or fail, and the ladder already declares `earth-shock` the same way. The counter is
	 * `EarthShockAudit.judged` and it stays exactly as it is — it is the narrowed *sample*, which is the
	 * half a declaration cannot supply, and on `cleave` it is the seven presses made at one or two enemies
	 * out of twelve made. What the declaration adds is the case the counter cannot express: a pull read
	 * wholly above two enemies now reads `exempt` — the rule was not asked — rather than merely arriving at
	 * a denominator of zero, which is "the log could not say" and is a different sentence.
	 */
	earthShockGood: { good: 85, ok: 65, higherIsBetter: true, bands: [1, 2] },

	/**
	 * Searing Totem's uptime against the time it could have been up.
	 *
	 * A sixty-second totem with a one-global press. The sim gates it on the Fire Elemental not being
	 * out and no totem already ticking, and the denominator is that same ceiling rather than the whole
	 * of engaged time: only one Fire totem stands at a time, so the elemental's minute was never a
	 * stretch the player could have had a totem in. Held against engaged time the thresholds below
	 * were unreachable on any pull that used the elemental on cooldown — a low number now means the
	 * totem genuinely sat unsummoned while the slot was free.
	 *
	 * **`bands: [1, 2]`, and this is the plainest transcription in the table.** `aoe.apl.json` is five
	 * rungs long and Searing Totem is not one of them, nor is Magma Totem — after the pre-pull Fire
	 * Elemental that slot has no rung anywhere in that list, and `apl.ts` has already banded the ladder's
	 * `searing-totem` rung `[1, 2]` on exactly this reading. Band 2 stays in because
	 * `cleave.apl.json` not only keeps the totem but promotes it *above* Flame Shock, Lava Burst,
	 * Elemental Blast and Earth Shock, so the two-target list is the one that asks for it hardest.
	 *
	 * **This was the cheapest of the clocks to cut, and it really was the one edit predicted.** `scoredMs`
	 * was already `intersect(contact, complementOf(feWindows))` — the site composes exempt causes into the
	 * denominator and the numerator follows by construction, which its own comment says in as many words
	 * ("the numerator is intersected with the same clock rather than taken raw, so it follows this line
	 * without a second edit"). `gradedSpans` went in as a third term.
	 *
	 * `cleave` moves from 78.72% over 204 835ms to **88.50% over 127 378ms**, which crosses the 85% line:
	 * the section goes `ok` to `good` and the totem stops appearing among the pull's faults. That is the
	 * change working as intended rather than a threshold being flattered — 77 457ms of the old denominator
	 * was time no list had a fire-totem rung in, and the player kept the totem up through most of what was
	 * left. Neither single-target fixture moves.
	 */
	searingTotemUptime: { good: 85, ok: 65, higherIsBetter: true, bands: [1, 2] },

	/**
	 * Placements made while the Fire Elemental was out.
	 *
	 * The list keeps the two summons apart — the Fire Elemental replaces the totem, so a totem placed
	 * under it is a global that bought a totem the elemental already superseded. Zero is the target and
	 * is genuinely achievable; more than one is the habit. Lower is better.
	 *
	 * **No band, against an earlier plan that asked for band 3+ exempt here.** The whole argument for
	 * that is the one directly above, and it does not reach this number: the rung's absence from
	 * `aoe.apl.json` says the totem was not the button to press, while this says the button bought
	 * nothing when it was pressed. One fire totem stands at a time and the elemental supersedes it at
	 * every target count, so the global was wasted whichever list was running — a slot fact, not a list
	 * fact, and the same shape as `lightningShieldFellOff`. See the note at the metric.
	 */
	searingTotemOverlaps: { good: 0, ok: 1, higherIsBetter: false },

	/**
	 * Whether the Fire Elemental was out when the bell rang — 1 for yes, 0 for no.
	 *
	 * Pre-pulling it is free and pays twice: the elemental works from the first second, and its
	 * five-minute cooldown starts turning that much earlier, which on a long pull is the difference
	 * between one summon and two. So the pull that had it out at the bell is `good`, and the report
	 * should say so.
	 *
	 * **`bad` is unreachable, and that is the point of this entry.** `ok` is the worst this can grade,
	 * because calling the absence a fault would require the log to prove the player *could* have
	 * pressed it, and one fight's events cannot:
	 *
	 *   - **The cooldown is longer than a pull.** Five minutes, or three with Primal Elementalist. A
	 *     shaman who spent it on the attempt before this one and re-pulled two minutes later entered
	 *     this fight with no summon to make, and the log holds nothing from before its own first event
	 *     to tell that apart from a player who had it in hand and did not press it. A press inside the
	 *     pull does not settle it either: it proves the cooldown was ready *then*, and bounds what was
	 *     left at the bell from above, never at zero.
	 *   - **Nothing says this player was at the bell.** The measurability gate refuses the pull the
	 *     player demonstrably was not in for the opening minute, but a late join it cannot see stays
	 *     unseen.
	 *
	 * So the number is reported, it costs the headline the difference between a full mark and a half
	 * one at the lightest weight the table has, and it is never called a mistake. Three of this audit's
	 * bugs so far — plan steps 26, 31a and 31b — were faults invented by charging a player for
	 * something they could not have done, and a `bad` band here would have been the fourth.
	 *
	 * **No band, and it is the clearest case in the table.** This is a question about a single instant —
	 * the bell — and it is asked before any target count exists to read. All three lists pre-pull the
	 * elemental, `autocastOtherCooldowns` in the aoe list casts it as a registered major cooldown, and
	 * the pull's counts say nothing about what was standing when it started.
	 */
	fireElementalPrepull: { good: 1, ok: 0, higherIsBetter: true },

	/**
	 * The Primal Fire Elemental's uptime inside the haste cooldown the raid brought on the pull.
	 *
	 * **`good` and `ok` are both 100, and that is the rule the user wrote rather than a line chosen near
	 * it.** "Primal Fire Elemental should have 100% uptime during Bloodlust" names no middle, so inventing
	 * one would be this table asserting a tolerance the request does not contain. An absolute grades
	 * binary, which is exactly how rules 1 and 2 grade — `AscendancePressVerdict.grade` is
	 * `'good' | 'bad' | 'none'` and has no third band either. The `none` of that pair is `unmeasurable`
	 * here, and it is the empty clock that produces it.
	 *
	 * A binary rule is only defensible because the two halves of the share come off the *same* clock and
	 * neither is an inference. `coveredMs` is `overlapMs` of the aura's own `applybuff`/`removebuff` pairs
	 * against the haste window, both fight-relative, so containment gives exactly 100 and not 99.99 —
	 * measured on all three committed pulls, which read 40 008/40 008, 40 005/40 005 and 40 006/40 006 ms.
	 * The declared-duration reading this deliberately does not use (`feWindows`, the Fire totem slot walk)
	 * is where a rounding tolerance would have been needed, and the argument against it is on the audit.
	 *
	 * ## What this measures on the pulls we hold: nothing, and it is worth saying so plainly
	 *
	 * **All three committed fixtures read exactly 100.00% and the figure has no variance at all.** Every
	 * one of them took Primal Elementalist (117013 is in all three `combatantinfo` lists), every one had
	 * the elemental out before the bell — `[0, 57 259]`, `[0, 58 014]`, `[0, 58 298]` — and every one was
	 * lusted inside the first two seconds for forty seconds, under a different spell each time (Heroism,
	 * Bloodlust, Time Warp). A pre-pull summon's minute contains an on-pull lust's forty seconds by
	 * construction, so this is structural rather than three players getting it right.
	 *
	 * §80's own box warned about exactly this — *"a metric that reads a flat 100% everywhere carries weight
	 * while discriminating nothing"* — and the warning is upheld rather than waved through. It carries
	 * **no** weight (see `WEIGHTS`, where the two headlines a weight of 1 moved are written out), and the
	 * fault side of the rule is carried on synthetic pulls in `lib/__tests__/firePrimalHaste.test.ts`
	 * rather than by moving this line until a fixture failed it.
	 * What it is **not** is the free-pass shape, which is a `good` handed out over an empty clock: the
	 * clock here is forty real seconds of haste on all three pulls, and the three pulls that have no clock
	 * are refused rather than credited.
	 *
	 * **No band, and the argument is that the summon is the same job at every target count.** A band
	 * declaration says "this figure means nothing at these counts", and there is no count at which a
	 * standing Primal Fire Elemental means nothing: it is a pet that attacks whatever is in front of it,
	 * the haste that makes its window worth aiming at is raid-wide, and none of the three priority lists
	 * has a rung that would rather the slot were empty — `aoe.apl.json` no more asks for the fire totem
	 * slot to be free than `p5.apl.json` does. That is the shape of argument the six unbanded rules share:
	 * the opportunity exists identically however many enemies are up, so declining to grade it at some of
	 * them would be silence bought with nothing.
	 */
	fireElementalHasteUptime: { good: 100, ok: 100, higherIsBetter: true },

	/**
	 * Share of proc-window Flame Shock refreshes caught.
	 *
	 * The Elemental's whole payoff: the p5 list's Flame Shock rule (priority 7) wants the dot
	 * reapplied while a trigger and an int proc overlap. A missed window is a snapshot that never got
	 * its multiplier; catching most of them is the skill being measured, catching under half means
	 * the pairing is not being played at all.
	 *
	 * **`bands: [1]`: the rule this measures is p5 rung 7, and neither other list carries it.** `apl.ts`
	 * states it directly — "neither list carries p5's snapshot reapplies (7) or its Ascendance prep (12)"
	 * — so a snapshot window that opened while three enemies were up was never a refresh the running list
	 * asked for, and at the weight this metric carries that matters more here than anywhere else in the
	 * table.
	 *
	 * **And it cannot be shown to change anything on the fixtures we hold, which is stated rather than
	 * implied.** All three committed pulls audit `refreshed: 0, missed: 0` — none of them wore a trigger
	 * and an int proc at the same time — so the metric is already unmeasurable on every one of them, at
	 * every reading, before and after this declaration. `shareOf` on the same line is in the same
	 * position: it refuses a denominator under three, and the denominator here is zero. Both are
	 * therefore untested against a real pull and both are the same claim the other six entries make.
	 * The first fixture with a live snapshot window will be the first evidence either way.
	 */
	flameShockSnapshots: { good: 70, ok: 45, higherIsBetter: true, bands: [1] },

	/**
	 * Time the shield sat at the ceiling past the reader's leeway, in milliseconds.
	 *
	 * Sitting at seven stacks is a shock not taken, and every Lightning Bolt after that is Rolling
	 * Thunder with nowhere to put its charge. Zero is genuinely achievable — the shield is spent by a
	 * one-global instant — so anything above the grace is a real miss; a handful of seconds is a slow
	 * reaction, more than that is the habit. Lower is better.
	 *
	 * **`bands: [1, 2]`, and this is the one metric whose clock is already cut to match.** Nothing in
	 * `aoe.apl.json` spends the shield — no Earth Shock rung at all — so sitting at seven through an add
	 * wave is the only state the list leaves available. Band 2 stays in because `cleave.apl.json` does
	 * spend it, at six stacks rather than seven, and exempting a pull from a list that is *stricter* would
	 * be the wrong way round. The audit builds `shieldGradedSpans = complementOf(aoeWindows, duration)`
	 * and measures the overcap inside it, per segment, so the leeway restarts at every boundary.
	 *
	 * So the declaration here is the honest scope for a number that is honestly measured — and it is the
	 * entry that made the empty-clock guard reachable, which is now closed: the audit publishes
	 * `lightningShield.gradedMs` and the metric goes through `gradedOver`, so a pull with no band-1-or-2
	 * stretch reads "cannot say" instead of collecting a free zero. See the note at the metric.
	 *
	 * `overcapMs` itself does not move on any fixture — this clock was already cut — so `cleave` stays at
	 * 42 157ms and `bad`. What changed is only that an empty one can no longer pass for a perfect one.
	 */
	lightningShieldOvercap: { good: 0, ok: 5000, higherIsBetter: false, bands: [1, 2] },

	/**
	 * How many times the shield came all the way off.
	 *
	 * A full removal is not a stack spent — it is the whole counter thrown away, and the shield has to
	 * be re-applied and rebuilt from one. Zero is the target; one is usually a death, two is a habit.
	 * Lower is better.
	 *
	 * **No band, and it is the deliberate counterpart of the entry above.** The two halves of one aura
	 * are scoped differently on purpose. Rolling Thunder (88765) returns 2% of maximum mana per charge
	 * granted, doubled by the T16 four-piece, and it only runs while the buff is up — so the shield's
	 * *uptime* is this spec's mana engine at every target count, and the aoe list needs that mana as much
	 * as p5 does. What the target count changes is only whether the *stacks* are spendable, which is the
	 * entry above. The resource exists identically at every count; only the rung that spends it does not.
	 */
	lightningShieldFellOff: { good: 0, ok: 1, higherIsBetter: false },

	/**
	 * Time spent at or under 15% mana with Thunderstorm in hand, in milliseconds.
	 *
	 * 15% is the sim's own trigger and not a number invented here: `cleave.apl.json:15` casts 51490 at
	 * `currentManaPercent OpLe 15%`, and the press returns 15% of maximum mana for no mana at all
	 * (`sim/shaman/elemental/thunderstorm.go:14`, `:41`). So zero is genuinely achievable — one instant
	 * global lifts the pool clear of the line — and anything above the grace is a rescue that was sitting
	 * on the bar unused.
	 *
	 * The grace is the same five seconds `lightningShieldOvercap` uses, and for the same reason: a player
	 * watching a bar drop needs a global or two to notice and press, and charging the first of those would
	 * be charging reaction time. Beyond it the pool was low, the button was up, and nothing happened.
	 *
	 * **This does not grade pressing Thunderstorm too early, and that is deliberate.** The press costs a
	 * global, so taking it on a full pool trades a Lightning Bolt for mana nobody needed — a real if small
	 * waste, which the section states as a count and leaves uncoloured. Grading it as well would build the
	 * mirror of this threshold, and the two together would ask a player to press the button exactly once
	 * per starved stretch and never otherwise. Nothing here counts a press as a credit either, so no part
	 * of this rewards pressing it more often. Lower is better.
	 *
	 * **No band.** The 15% trigger is `cleave.apl.json`'s own line, so the rule is not even band 1's to
	 * begin with, and an empty pool stops every one of the three lists — `aoe.apl.json`'s Lava Beam and
	 * Chain Lightning cost mana like anything else. The rescue is on the bar and off the global at every
	 * count. This is the shape the module doc calls a resource rather than a rung.
	 */
	thunderstormMissed: { good: 0, ok: 5000, higherIsBetter: false },

	/**
	 * Stretches at or under 70% mana with Shamanistic Rage in hand and never pressed.
	 *
	 * 70% is again the list's own number — `cleave.apl.json:0`, `currentManaPercent OpLe 70%` — and the
	 * press is the cheapest one an Elemental owns: fifteen seconds of reduced cost
	 * (`SpellMod_PowerCost_Pct`, `sim/shaman/shamanistic_rage.go:16-19`) off a sixty-second timer, and the
	 * one press in this spec that genuinely does not take a global. So a stretch under the line with the
	 * button up is a press that would have cost nothing at all.
	 *
	 * **Counted and graded more gently than Thunderstorm's clock, because it saves less.** Thunderstorm is
	 * a rescue — 15% of the pool back in one press; the Rage is a discount on what you cast next, and the
	 * plan's own summary of it is "2% a cast rather than a rescue". Zero is achievable on any pull, one is a
	 * lapse and two is a habit, which is where `lightningShieldFellOff` and `searingTotemOverlaps` sit for
	 * the same shape of miss. Lower is better.
	 *
	 * **No band**, for the reason directly above and one more of its own: the Rage is a registered major
	 * cooldown, so `aoe.apl.json`'s `autocastOtherCooldowns` rung presses it there even though that list
	 * names no mana button of its own. It is the one press in this spec that is asked for at every count
	 * by every list.
	 */
	shamanisticRageMissed: { good: 0, ok: 1, higherIsBetter: false },
} as const satisfies Record<string, MetricRule>;

export type MetricKey = keyof typeof THRESHOLDS;

/**
 * How much each metric moves the overall verdict.
 *
 * The snapshot catch and the Flame Shock economy carry the most, because they are the two things an
 * Elemental most controls and that most change the damage — the same reasoning the Windwalker module
 * applies to its own snapshot rate. The Earth Shock and Searing Totem clocks are weighted lightly:
 * they describe a habit more than a headline.
 */
export const WEIGHTS: Record<MetricKey, number> = {
	flameShockSnapshots: 4,
	flameShockUptime: 3,
	gcdUtilisation: 2,
	flameShockWaste: 2,
	flameShockMultiDot: 2,
	earthShockGood: 1,
	searingTotemUptime: 1,
	searingTotemOverlaps: 1,
	// The lightest weight there is, and it cannot grade worse than `ok` — so the most this can take off
	// a headline is half of one part in thirteen. Deliberate: what it measures is real, and what it can
	// prove about whose fault it was is nothing.
	fireElementalPrepull: 1,
	/**
	 * **Measured, graded, shown — and deliberately not counted.** Zero, on the Windwalker
	 * `snapshotDepth`'s terms: the metric goes on carrying a grade for the section and the copy to read,
	 * and the reason it does not move the headline lives beside every weight that does.
	 *
	 * **This is a measurement and not a caution.** At weight 1 the metric reads a flat `good` on every
	 * pull in the repository, and adding a constant `good` to a weighted mean does not describe pulls, it
	 * pushes all of them upward. Two of the three moved, at every reading:
	 *
	 * ```
	 *                     without        with weight 1
	 *   phased      73.08% of 13  ->  75.00% of 14   ok -> good
	 *   unbroken    61.54% of 13  ->  64.29% of 14   ok -> ok
	 *   cleave      42.31% of 13  ->  46.43% of 14   bad -> ok
	 * ```
	 *
	 * `phased` lands on **exactly** the 75% `good` line and `cleave` clears the 45% one. Both headlines
	 * were bought with a rule neither player could have failed: the summon was out before the bell and the
	 * raid lusted on the pull, so 100% was structural on all three. `cleave` is the pull this whole
	 * exercise began from and it is a `bad` pull; a rule that discriminates nothing must not be what
	 * upgrades it.
	 *
	 * Zero rather than deleting the metric, and rather than not grading it: the user's sentence is an
	 * absolute and absolutes grade (see `THRESHOLDS`), so the rule keeps its verdict and its refusal — it
	 * simply does not price them. Rules 1 and 2 are the same shape seen from further away: they grade every
	 * Ascendance press through `AscendancePressVerdict` and appear in no weight at all.
	 *
	 * **What to revisit, and with what.** A captured pull that actually fails this rule is the argument
	 * for a weight above zero, and the numbers above are what it has to beat. Until one exists the honest
	 * price of a rule that has never separated two pulls is nothing. Note the one thing zero costs, so it
	 * is a known price rather than a discovery: `Takeaways` filters on `weight > 0`, so a failing pull's
	 * card would carry the `bad` without the summary panel naming it.
	 */
	fireElementalHasteUptime: 0,
	lightningShieldOvercap: 1,
	lightningShieldFellOff: 1,
	/**
	 * Mana starvation with the rescue in hand, at the same weight as filling globals and the Flame Shock
	 * economy — above the shield's habits, below the two things that define the spec.
	 *
	 * Two rather than one because a pool at 15% stops the rotation outright: the list's own Lava Burst
	 * rung will not fire without the mana for it, so starving is not a habit that costs a little damage
	 * but a stretch where the ladder cannot run at all. Two rather than three or four because the
	 * snapshot catch and the dot's uptime are what an Elemental controls on *every* pull, and mana only
	 * binds on some of them — `p5` does not even name a mana button, which is the sim's own statement
	 * that on a single-target pull this is not the constraint.
	 */
	thunderstormMissed: 2,
	/**
	 * The lightest weight there is, deliberately. What the Rage saves is 2% a cast rather than a rescue,
	 * and the plan that asked for this section said so in as many words — so a player who never presses
	 * it has left something on the table and has not lost the pull. Same weight as the shield's two
	 * faults, which are the same kind of "wake up and press it" habit.
	 */
	shamanisticRageMissed: 1,
};

/**
 * What changes when the pull is read as multi-target.
 *
 * **No weight changes, and that is now a decision rather than a gap.** The claim this docstring used to
 * make — "none of the metrics are mode-dependent" — was already false when it was written and is plainly
 * false now: `earthShockGood` has been scoped to bands 1 and 2 since `0de530e`, `lightningShieldOvercap`
 * grades on a clock with the aoe stretches cut out of it, and seven of the thirteen rules above declare
 * their bands. Seven mode-dependent metrics is what this table is about.
 *
 * They are dependent the *other* way, though, which is why nothing here moves. The Windwalker's one
 * entry discounts Rising Sun Kick uptime on a multi-target pull — a whole-pull judgement that a
 * single-target number matters less when the job is spreading, which only a mode can express. The
 * Elemental's seven make a different claim: not that the number is worth less, but that at some counts it
 * is not a number at all. `MetricRule.bands` is where that belongs, and an exempt metric leaves
 * `overallOf`'s denominator entirely rather than being counted at a discount — so pricing it here as
 * well would charge the same pull twice for one fact.
 *
 * A `ScoreView` and not a mode, because that is what the seam hands over: `useReportCopy` resolves a
 * `BandView`, and a function typed on the mode would have taken the object and compared it against
 * `'multi'` — always false, silently, with the type system satisfied by method bivariance. `viewMode` in
 * `lib/score` is the accessor for the half of a view that is a mode, and is what a whole-pull weight here
 * would read if this spec ever grows one.
 */
export function weightsFor(_view: ScoreView): Record<MetricKey, number> {
	return WEIGHTS;
}
