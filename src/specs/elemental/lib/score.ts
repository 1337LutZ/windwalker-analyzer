// The Elemental scoring module: the bands, the weights and the whole-pull verdicts for this spec
// only.
//
// The same division the Windwalker module makes: the generic shapes live in `lib/score` — a grade
// is a grade for any spec — but everything that says what an *Elemental* number means lives here.
// The thresholds that turn the audit's measurements into judgements, the weights that turn those
// judgements into a headline, and the reading aids that colour the tiles.

import type { Analysis, ElementalAuditResult } from '~/lib/types';
import { GRADE_ORDER, gradeOf, metricOf, overall, section, sharePct } from '~/lib/score';
import type { Grade, Metric, Scorecard, ScoreView, Threshold } from '~/lib/score';

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

// The four helpers that used to be copied here live in `~/lib/score`; only `metric`'s binding to this
// spec's thresholds stays.
const metric = (key: MetricKey, value: number | null, context?: string): Metric =>
	metricOf(THRESHOLDS, key, value, context);

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

	const gcdUtilisation = metric('gcdUtilisation', cpm.gcdSlots > 0 ? cpm.gcdUtilisationPct : null);

	const flameShockUptime = metric('flameShockUptime', flameShock.windows.length > 0 ? flameShock.uptimePct : null);
	/**
	 * The refreshes that bought nothing — none of the three reasons the list has to press the button
	 * into a dot that is still running. Over the refreshes taken, never over the applies, which were
	 * correct by construction (there was no dot to clip).
	 *
	 * **Not nullable, and that is the point.** A press the log cannot measure a snapshot delta for keeps
	 * whatever kind it would have had without one, so it lands in `refreshes` and in none of the three
	 * excuses — charged, which is the old verdict, rather than quietly forgiven. The unmeasurable case
	 * is per press; there is no pull-level "cannot say" for this figure to carry, and `sharePct` already
	 * returns null for the only pull that genuinely cannot answer, the one with no refreshes at all.
	 */
	const flameShockWaste = metric(
		'flameShockWaste',
		sharePct(
			flameShock.refreshes - flameShock.windowed - flameShock.ascPrep - flameShock.snapshotGain,
			flameShock.refreshes,
		),
	);

	// The cleave preset's multi-dot rule: while two or more enemies are up, the dot should also sit on
	// the secondary target. Null on a single-target pull, where there was no second target to dot.
	const flameShockMultiDot = metric(
		'flameShockMultiDot',
		flameShock.multiTargetMs > 0 ? flameShock.multiDotUptimePct : null,
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
	 * Null when nothing is judged — a pull spent entirely at three or more enemies has no shock this can
	 * speak about, and a nullable metric leaves `overall()`'s weighted denominator (§75 decision 2) rather
	 * than reading as a free 0%.
	 */
	const earthShockGood = metric(
		'earthShockGood',
		earthShock.judged > 0 ? sharePct(earthShock.good, earthShock.judged) : null,
	);

	const searingTotemUptime = metric(
		'searingTotemUptime',
		searingTotem.windows.length > 0 ? searingTotem.uptimePct : null,
	);

	// Placements under the Fire Elemental: the one case the list forbids outright, so it is counted on
	// its own rather than folded into the uptime figure. Null when the totem was never cast, so the
	// section reads "none" rather than "good" on a pull with nothing to grade.
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

	// Against the windows the pull could actually have claimed, not every proc window that fired. A
	// window the dot was down through was never a chance to refresh it. Named `flameShockSnapshots`
	// rather than the Windwalker's `snapshotRate` so the two specs' takeaway copy does not collide:
	// the Windwalker's says "brew on the last global of a Re-Origination window", which is not advice
	// an Elemental can act on.
	const snapshotRate = metric(
		'flameShockSnapshots',
		sharePct(snapshots.refreshed, snapshots.refreshed + snapshots.missed),
	);

	// Lightning Shield's own two faults: sitting at the ceiling so long the Rolling Thunder has
	// nowhere to put its charge, and letting the shield come all the way off. Both are carried into
	// the summary as cards; neither is weighted heavily enough to swing the headline, because both are
	// "wake up and spend it" habits rather than the snapshots the spec is built on.
	//
	// **The two halves of one aura are graded on two different clocks, and that is deliberate.**
	// Amendment 3: Rolling Thunder (88765) returns 2% of maximum mana per charge granted, doubled by
	// the T16 four-piece, and it only runs while the buff is up — so the shield's *uptime* is the
	// spec's mana engine at every target count and `fellOff` is graded over the whole pull, banded or
	// not. Its *spending* is what the target count changes: nothing in the aoe list spends the
	// charges, so sitting at seven through an add wave is the only possible state and cannot be a
	// fault. `overcapMs` therefore arrives already measured against the single-target stretches alone
	// (`atCapWindowsIn`, restarted at every regime boundary), and this site takes it as given — the
	// clock is the audit's to cut, not the score's to second-guess.
	//
	// One hazard that is *not* handled here yet, and needs the audit to say so rather than this file
	// to infer it: a pull with no single-target stretch at all has an empty graded clock, and `0ms of
	// overcap` over no time is `good` — a free pass rather than the honest "cannot say". `maxStacks >
	// 0` is the wrong guard for it, because the shield was up and counting the whole time. A nullable
	// metric already leaves `overall()`'s weighted denominator (§75 decision 2), so the fix is one
	// more clause here as soon as the audit publishes the length of the clock it graded.
	const lightningShieldOvercap = metric(
		'lightningShieldOvercap',
		lightningShield.maxStacks > 0 ? lightningShield.overcapMs : null,
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
		snapshotRate,
		lightningShieldOvercap,
		lightningShieldFellOff,
		thunderstormMissed,
		shamanisticRageMissed,
	];

	return {
		overall: overall(all, weightsFor(view)),
		sections: {
			flameShock: section([flameShockUptime, flameShockWaste], [flameShockMultiDot]),
			earthShock: section([earthShockGood]),
			searingTotem: section([searingTotemUptime, searingTotemOverlaps]),
			// The summon's own section, which carries one metric and gets no card link: the anchors map in
			// `specSections.tsx` has no entry for it, so the takeaway renders without a jump the way the
			// `casts` card already does. It is a section here because the scorecard is the only route into
			// the summary — `Takeaways` walks these sections — and the page's Fire Elemental section reads
			// the same metric back through `toneOf` for its own note.
			fireElemental: section([fireElementalPrepull]),
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

export const THRESHOLDS = {
	/**
	 * Share of available globals actually used.
	 *
	 * Elemental is a cooldown- and proc-driven rotation on a 1.5s global: there is no resource bar
	 * to overcap, so the ceiling is the boss's uptime rather than a pool refilling. Between casts the
	 * list genuinely wants to stand still — waiting for a Lava Surge or a cooldown is correct play,
	 * not a missed global — so the bands are cut looser than the Windwalker's energy-gated rotation
	 * and a high number is not the target the way it is there.
	 */
	gcdUtilisation: { good: 80, ok: 65, higherIsBetter: true },

	/**
	 * Flame Shock's uptime on the primary target, against engaged time.
	 *
	 * A thirty-second dot with no cooldown and no cast time is meant to be up for the whole pull;
	 * the sim's own Lava Burst rule refuses to cast Lava Burst unless the dot outlives its cast, so a
	 * dropped Flame Shock is not one global but a cascade. The bar is therefore high, like the
	 * Windwalker's Rising Sun Kick debuff.
	 */
	flameShockUptime: { good: 95, ok: 85, higherIsBetter: true },

	/**
	 * Share of Flame Shock refreshes that bought nothing.
	 *
	 * A refresh is a fault only when it was none of the three reasons the list has to press the button
	 * while the dot is already up: its last tick window, the Ascendance prep, or a new application worth
	 * more than 10% more damage per millisecond of dot than the one it replaced. Everything else clips a
	 * healthy dot for no gain. Lower is better.
	 */
	flameShockWaste: { good: 10, ok: 30, higherIsBetter: false },

	/**
	 * The dot's uptime on the secondary target while two or more enemies were up — the cleave preset's
	 * multi-dot rule. A second target that stays undotted for the whole multi-target stretch is a dot
	 * the player never put where it would tick for free; keeping both up is the skill the fight asks
	 * for. Unmeasurable on a single-target pull.
	 */
	flameShockMultiDot: { good: 85, ok: 60, higherIsBetter: true },

	/**
	 * Share of Earth Shock presses the sim's rule wanted.
	 *
	 * The rule is two rules, and the tier-16 two-piece proc picks which one a press is judged against:
	 * with the proc down, Lightning Shield at the ceiling, the Flame Shock dot above six seconds and
	 * Ascendance not about to demand the shock timer; with the proc up, the shield at the ceiling, the
	 * proc's debuff inside its last four seconds and the dot outliving two ticks. A press that passes its
	 * own branch is the list's own call; a press that fails a condition of it is a shock spent early.
	 */
	earthShockGood: { good: 85, ok: 65, higherIsBetter: true },

	/**
	 * Searing Totem's uptime against the time it could have been up.
	 *
	 * A sixty-second totem with a one-global press. The sim gates it on the Fire Elemental not being
	 * out and no totem already ticking, and the denominator is that same ceiling rather than the whole
	 * of engaged time: only one Fire totem stands at a time, so the elemental's minute was never a
	 * stretch the player could have had a totem in. Held against engaged time the thresholds below
	 * were unreachable on any pull that used the elemental on cooldown — a low number now means the
	 * totem genuinely sat unsummoned while the slot was free.
	 */
	searingTotemUptime: { good: 85, ok: 65, higherIsBetter: true },

	/**
	 * Placements made while the Fire Elemental was out.
	 *
	 * The list keeps the two summons apart — the Fire Elemental replaces the totem, so a totem placed
	 * under it is a global that bought a totem the elemental already superseded. Zero is the target and
	 * is genuinely achievable; more than one is the habit. Lower is better.
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
	 */
	fireElementalPrepull: { good: 1, ok: 0, higherIsBetter: true },

	/**
	 * Share of proc-window Flame Shock refreshes caught.
	 *
	 * The Elemental's whole payoff: the p5 list's Flame Shock rule (priority 7) wants the dot
	 * reapplied while a trigger and an int proc overlap. A missed window is a snapshot that never got
	 * its multiplier; catching most of them is the skill being measured, catching under half means
	 * the pairing is not being played at all.
	 */
	flameShockSnapshots: { good: 70, ok: 45, higherIsBetter: true },

	/**
	 * Time the shield sat at the ceiling past the reader's leeway, in milliseconds.
	 *
	 * Sitting at seven stacks is a shock not taken, and every Lightning Bolt after that is Rolling
	 * Thunder with nowhere to put its charge. Zero is genuinely achievable — the shield is spent by a
	 * one-global instant — so anything above the grace is a real miss; a handful of seconds is a slow
	 * reaction, more than that is the habit. Lower is better.
	 */
	lightningShieldOvercap: { good: 0, ok: 5000, higherIsBetter: false },

	/**
	 * How many times the shield came all the way off.
	 *
	 * A full removal is not a stack spent — it is the whole counter thrown away, and the shield has to
	 * be re-applied and rebuilt from one. Zero is the target; one is usually a death, two is a habit.
	 * Lower is better.
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
	 */
	shamanisticRageMissed: { good: 0, ok: 1, higherIsBetter: false },
} as const satisfies Record<string, Threshold>;

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
 * None of the metrics are mode-dependent yet: the Flame Shock dot, the Earth Shock clock and the
 * snapshot windows are all primary-target readings that stand regardless of how many enemies were
 * up. The signature is kept so the registry's `weightsFor` contract is met, and so a mode-aware
 * weight is a one-line change here rather than a registry change.
 *
 * A `ScoreView` and not a mode, because that is what the seam now hands over: `useReportCopy` resolves
 * a `BandView`, and a function typed on the mode would have taken the object and compared it against
 * `'multi'` — always false, silently, with the type system satisfied by method bivariance. `viewMode` in
 * `lib/score` is the accessor for the half of a view that is a mode, and is what the first mode-aware
 * weight here reads. Nothing reads it yet, which is exactly why the type had to be right first.
 */
export function weightsFor(_view: ScoreView): Record<MetricKey, number> {
	return WEIGHTS;
}
