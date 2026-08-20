// The Elemental scoring module: the bands, the weights and the whole-pull verdicts for this spec
// only.
//
// The same division the Windwalker module makes: the generic shapes live in `lib/score` — a grade
// is a grade for any spec — but everything that says what an *Elemental* number means lives here.
// The thresholds that turn the audit's measurements into judgements, the weights that turn those
// judgements into a headline, and the reading aids that colour the tiles.

import type { Analysis, ElementalAuditResult, TargetMode } from '~/lib/types';
import { GRADE_ORDER, gradeOf, metricOf, overall, section, sharePct } from '~/lib/score';
import type { Grade, Metric, Scorecard, Threshold } from '~/lib/score';

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
export function scoreAnalysis(analysis: Analysis, mode: TargetMode | null = null): Scorecard {
	const el = analysis as ElementalAnalysis;
	const { flameShock, earthShock, searingTotem, snapshots, lightningShield, fireElemental, cpm } = el;

	const gcdUtilisation = metric('gcdUtilisation', cpm.gcdSlots > 0 ? cpm.gcdUtilisationPct : null);

	const flameShockUptime = metric('flameShockUptime', flameShock.windows.length > 0 ? flameShock.uptimePct : null);
	// The refreshes that bought nothing: neither the reader's own keep-it-up window nor the sim's
	// Ascendance prep. Over the refreshes taken — never over the applies, which are the presses that
	// were correct by construction (there was no dot to clip).
	const flameShockWaste = metric(
		'flameShockWaste',
		sharePct(flameShock.refreshes - flameShock.windowed - flameShock.ascPrep, flameShock.refreshes),
	);

	// The cleave preset's multi-dot rule: while two or more enemies are up, the dot should also sit on
	// the secondary target. Null on a single-target pull, where there was no second target to dot.
	const flameShockMultiDot = metric(
		'flameShockMultiDot',
		flameShock.multiTargetMs > 0 ? flameShock.multiDotUptimePct : null,
	);

	const earthShockGood = metric(
		'earthShockGood',
		earthShock.presses.length > 0 ? sharePct(earthShock.good, earthShock.presses.length) : null,
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
	const lightningShieldOvercap = metric(
		'lightningShieldOvercap',
		lightningShield.maxStacks > 0 ? lightningShield.overcapMs : null,
	);
	const lightningShieldFellOff = metric('lightningShieldFellOff', lightningShield.fellOff);

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
	];

	return {
		overall: overall(all, weightsFor(mode)),
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
	 * A refresh is a fault only when it was neither the reader's keep-it-up window nor the sim's
	 * Ascendance prep — the two reasons to press the button while the dot is already up. Everything
	 * else clips a healthy dot for no gain. Lower is better.
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
	 * The rule is a stack counter plus a clock: press when Lightning Shield is at the ceiling, the
	 * Flame Shock dot has time to live, Ascendance is not about to demand the shock timer, and no
	 * two-piece proc is up. A press that passes all four is the list's own call; a press that fails
	 * one is a shock spent early.
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
};

/**
 * What changes when the pull is read as multi-target.
 *
 * None of the metrics are mode-dependent yet: the Flame Shock dot, the Earth Shock clock and the
 * snapshot windows are all primary-target readings that stand regardless of how many enemies were
 * up. The signature is kept so the registry's `weightsFor` contract is met, and so a mode-aware
 * weight is a one-line change here rather than a registry change.
 */
export function weightsFor(_mode: 'single' | 'multi' | null): Record<MetricKey, number> {
	return WEIGHTS;
}
