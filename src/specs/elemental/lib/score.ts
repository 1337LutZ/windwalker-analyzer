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
	const { flameShock, earthShock, searingTotem, snapshots, lightningShield, cpm } = el;

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
