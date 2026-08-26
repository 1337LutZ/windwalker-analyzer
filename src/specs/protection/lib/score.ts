// What a Protection pull is graded on, and what it deliberately is not.
//
// The fork this spec comes from grades **nothing**. Its summary tiles carry no colour at all, and it
// says why: the thresholds would be the reader's opinion dressed as a measurement. That is a real
// position and it is not this report's — every other spec here carries a scorecard, and a spec that
// opted out would leave the summary, the ranked grid and the whole-pull verdict blank on one third of
// the site.
//
// So this grades two things, and only two, because they are the two whose lines can be defended:
//
//   - **The globals that were free to press and were not.** `missedFree` over `available`, which is
//     the fork's own headline figure with the fight's share already taken off it. What a threshold has
//     to be defensible about here is only the *size* of an acceptable gap, not whether a gap is bad.
//   - **The presses the cooldowns offered and never got.** Our own `lostCasts`, on the same rule every
//     other spec uses, as a share of what those buttons offered.
//
// Everything else the report measures is described rather than judged: where a cooldown landed, what
// a Sacred Shield refresh replaced, how much of the pull had a Consecration under it. The fork's
// reasoning applies unchanged to those — a threshold on them would be invented.

import { overallOf, section, sharePct, grader, gradeOf, GRADE_ORDER } from '~/lib/score';
import type { Grade, MetricRule, Scorecard, ScoreView, Threshold } from '~/lib/score';
import type { Analysis, ProtectionAudit } from '~/lib/types';
import { GCD_FLOOR_HASTE } from '~/lib/analysis/haste';

/** The audit's fields, named for the type that holds them — the same bounded cast the Elemental makes. */
type ProtectionAnalysis = Analysis & ProtectionAudit;

/**
 * How a share of wasted holy power reads as a colour.
 *
 * A reading aid rather than a grade: nothing here reaches a scorecard, and `lib/score` deliberately
 * grades no resource metric on any spec. Holy power caps at five and a generator that returns into a
 * full bar has thrown one away, which is a countable fault — but how many is acceptable on a pull
 * where the spender is off the global is not something the sim or the ladder states.
 */
const WASTE: Threshold = { good: 10, ok: 25, higherIsBetter: false };

export function wasteTone(wasted: number, generated: number): Grade | null {
	return generated > 0 ? gradeOf(WASTE, (wasted / generated) * 100) : null;
}

export function scoreAnalysis(analysis: Analysis, view: ScoreView = null): Scorecard {
	const prot = analysis as ProtectionAnalysis;
	const metric = grader(THRESHOLDS, view);

	/**
	 * The globals nobody took away, as a share of the globals the pull had room for.
	 *
	 * **`missedFree` and never `missed`**, which is the whole reason the enforced table exists. A
	 * Paragons pull whose player spent thirty seconds as a scorpion did not miss thirty seconds of
	 * globals; charging them for it is the fabricated fault this spec was ported to remove.
	 *
	 * Null rather than nought on a pull with no room measured at all — a fight so short that WarcraftLogs
	 * reports no active time has no denominator, and a share over nothing is not nought.
	 */
	const globalsMissed = metric(
		'globalsMissed',
		prot.globals.available > 0 ? sharePct(prot.globals.missedFree, prot.globals.available) : null,
	);

	/**
	 * Presses the cooldowns offered and never got, as a share of the presses they offered in total.
	 *
	 * **A share of presses and not a duration, which is a correction rather than a preference.** Seconds
	 * held over pull length was the first shape of this and it is unbounded: several buttons idle at
	 * once, so the three reference pulls read 217%, 238% and 157% of their own length, against a
	 * threshold that could only ever say `bad`. A number no pull can pass is not a rule.
	 *
	 * Read off the core's `lostCasts` rather than rebuilt, so this and the cast table cannot disagree
	 * about what was held. Two things make that reading true on this spec and neither is optional: the
	 * haste curve, without which every generator looks permanently late against a base cooldown it never
	 * had, and the shared-cooldown merge, without which the builder pair reports the same idle seconds
	 * twice — 190 lost casts between them on the Garrosh capture, against 19 for the one button they
	 * actually are.
	 */
	const lost = analysis.lostCasts.reduce((sum, row) => sum + row.lostCasts, 0);
	const offered = analysis.lostCasts.reduce((sum, row) => sum + row.casts + row.lostCasts, 0);
	const cooldownsMissed = metric('cooldownsMissed', offered > 0 ? sharePct(lost, offered) : null);

	/**
	 * Externals the raid could have put on this tank and never did, as a share of the slots offered.
	 *
	 * **A card and not a grade**, which is the distinction the rest of this file spends its header on.
	 * It is in `sections` so a reader sees it and is out of `all` below, so it moves the overall letter
	 * by nothing. An unused external is a real loss and it is somebody else's press: charging a tank's
	 * own score for what their healers did not do would be the fabricated fault this spec was ported to
	 * remove, in a new place.
	 *
	 * Null when the roster offered nothing — a raid with nobody who could cast one has not missed any,
	 * and a share over nothing is not nought. `unused` already counts per *slot* rather than per button,
	 * so two Hands nobody pressed are the one chance they really were.
	 */
	/**
	 * **Silent unless the pull gives it something to be about**, which is the whole calibration of it.
	 *
	 * An unused external is only a loss if the tank needed one. On a pull they never came close to dying
	 * and never reached their Vengeance ceiling, "your raid did not press Pain Suppression" is a true
	 * sentence about nothing — noise on a card that costs a reader attention, and an invitation to go
	 * and ask a healer for something neither of them needed.
	 *
	 * Two things make it relevant and both are already measured. **A death** is the unarguable one:
	 * whatever else was true, an external was worth having. **Time at the Vengeance ceiling** is the
	 * other and the sharper on a pull nobody died — it says the fight was hitting faster than this
	 * player's health could convert, which is exactly the state an external is for, and it is the same
	 * reading the recommendation copy leans on.
	 *
	 * Null on every other pull, which parks it at `ok` and prints nothing. Nothing about the *catalogue*
	 * changes: the Externals section still lists every row on every pull, and its own recommendation
	 * still names what went unused. This is only about what earns a card in the summary.
	 */
	const externalsOffered = prot.externals.available;
	const neededOne = (analysis.timeline?.deaths?.length ?? 0) > 0 || prot.vengeance.nearCapMs > 0;
	const externalsMissed = metric(
		'externalsMissed',
		externalsOffered > 0 && neededOne ? sharePct(prot.externals.unused, externalsOffered) : null,
	);

	/**
	 * The pull's melee haste, against the breakpoint it is aiming at.
	 *
	 * **The figure a reader recognises, not a share of it.** This was the haste expressed as a percentage
	 * *of* the breakpoint and capped at 100, so the card said "target 100% or better" — a number that
	 * appears nowhere else in the report and matches nothing on a character sheet. It reads its own
	 * quantity now: 52.8% against a target of 50%, which is the pair the Haste section prints and the
	 * pair a player reads off their own gear.
	 *
	 * The target is the sim's line rather than a chosen one — `GCD_FLOOR_HASTE` is where Sanctity of
	 * Battle's reduction stops buying globals — so it moves with the constant the section argues from.
	 *
	 * Out of `all`, so it moves no letter. A gear decision is not a play fault.
	 */
	const hasteToBreakpoint = metric('hasteToBreakpoint', (prot.haste.base - 1) * 100);

	const all = [globalsMissed, cooldownsMissed];
	const { grade, judged } = overallOf(all, weightsFor(view));

	return {
		overall: grade,
		judged,
		sections: {
			// Keyed by the page section each card is about, because `Scorecard` titles a card from
			// `<key>.title` and falls back to the metric's own label when there is none — which prints the
			// same words twice, once as the heading and once as the row under it. `globals` is a section on
			// this page; `cooldownDrift` is the Elemental's heading for the same subject and the honest
			// place for this figure until Protection has a cooldown section of its own.
			globals: section([globalsMissed]),
			cooldownDrift: section([cooldownsMissed]),
			// Both keyed by the page section that argues them, the same join the other two make — see the
			// note above. Neither reaches `all`, so neither moves the overall grade.
			externals: section([externalsMissed]),
			haste: section([hasteToBreakpoint]),
		},
	};
}

export { GRADE_ORDER };

/**
 * Where the two lines sit, and why each one sits there.
 *
 * Both are shares, and both are deliberately wide. This spec's report is mostly descriptive, and a
 * tight threshold on the two figures it does grade would let the scorecard make claims the rest of
 * the page declines to make.
 */
export const THRESHOLDS = {
	/**
	 * Globals the player was free to press and did not, as a share of the pull's room.
	 *
	 * The bar is a *tank's* rather than a damage dealer's, and that is the whole calibration argument.
	 * A Protection Paladin spends globals on things this report does not count as presses — a taunt
	 * swap, a Hand of Sacrifice, a run out to a mechanic — and every one of them is correct play that
	 * reads here as a missed global. The Windwalker's `gcdUtilisation` sits at 90/75 for a spec whose
	 * only job is the rotation; ten and twenty-five percent of a tank's globals is the same statement
	 * about a role that has another one.
	 *
	 * Nothing softer would be honest either: the fork's own sweep of ninety-four kills puts the median
	 * free miss well inside ten percent, so a `good` here is a pull that pressed what it could.
	 */
	globalsMissed: { good: 10, ok: 25, higherIsBetter: false, unit: 'percent' },
	/**
	 * Presses the cooldowns offered that were never made, as a share of the presses they offered.
	 *
	 * A share rather than a count, for the reason every rate in this repository is one: a nine-minute
	 * pull offers more of everything than a two-minute one, and a count would rank the bosses by length.
	 *
	 * The lines are calibrated against the three reference pulls rather than picked, and the spread is
	 * what makes them worth stating: Fallen Protectors reads 10.3%, Garrosh 19.4% and Paragons 40.1%,
	 * on the same character, in the same week, under the same ladder. So a tenth is what a clean pull of
	 * this spec looks like and a quarter is where a real habit starts showing, which is what these two
	 * lines say.
	 *
	 * Wide at the top for the same reason `globalsMissed` is: two of the audited buttons are held on
	 * purpose — Avenging Wrath waits for a window worth spending it in, and Hammer of Wrath cannot be
	 * pressed above twenty percent health at all. `needsTarget` clips the second and nothing clips the
	 * first, so a pull that banked its Wrath correctly reads some loss here by construction.
	 */
	cooldownsMissed: { good: 10, ok: 25, higherIsBetter: false, unit: 'percent' },
	/**
	 * Externals the raid never used, as a share of what it could have cast.
	 *
	 * Wide, and deliberately: this is a raid's habit rather than a player's, and it is on the page as a
	 * recommendation rather than a judgement. The five captures read 0%, 14%, 0%, 71% and 43% — a spread
	 * that says the line is measuring something, and that a quarter is a raid using most of what it has
	 * while three quarters unused is a raid that has stopped thinking about it.
	 */
	externalsMissed: { good: 25, ok: 60, higherIsBetter: false, unit: 'percent' },
	/**
	 * Melee haste, against the breakpoint the global stops improving at.
	 *
	 * `good` is the breakpoint itself, derived from `GCD_FLOOR_HASTE` rather than typed as 50 so the two
	 * cannot drift apart. `ok` is two and a half points under it — close enough that one piece of gear
	 * closes the gap, which is what separates "nearly there" from "this needs a plan". `ceiling` is the
	 * same number again and is what stops the card inviting a reader past it — see below.
	 */
	hasteToBreakpoint: {
		good: (GCD_FLOOR_HASTE - 1) * 100,
		ok: (GCD_FLOOR_HASTE - 1) * 100 - 2.5,
		higherIsBetter: true,
		unit: 'percent',
		/**
		 * **The breakpoint is a lid, not a bar, and the card has to word it that way.**
		 *
		 * `MetricRule.ceiling` is what tells the scorecard that a `good` line is the best reading the pull
		 * could have rather than a floor to clear, and it changes the target line from "target 50% or
		 * better" to "target 50%". The distinction is the whole of what a reader was getting wrong here:
		 * fifty percent is where Sanctity of Battle's reduction stops buying globals, so haste past it is
		 * not a better score — it is haste buying something this metric does not measure.
		 *
		 * The same field `potionsUsed` and `fireElementalPrepull` use, for the same reason their docblock
		 * gives: a target nobody should chase past must not be written as one they can.
		 */
		ceiling: (GCD_FLOOR_HASTE - 1) * 100,
	},
	// `MetricRule` rather than `Threshold & { unit }`, which is what the Elemental's table satisfies and
	// what `ceiling` needs — see the note on `hasteToBreakpoint`. The narrower shape was fine while every
	// rule here was a plain bar.
} as const satisfies Record<string, MetricRule>;

export type MetricKey = keyof typeof THRESHOLDS;

/**
 * How much each metric moves the summary.
 *
 * Two metrics and a two-to-one split. The globals figure is the report's subject — it is what the
 * fork was built to measure and what every section under it explains — and a cooldown held is a
 * smaller, more forgivable thing that the cast table already itemises.
 */
export const WEIGHTS: Record<MetricKey, number> = {
	globalsMissed: 4,
	cooldownsMissed: 2,
	// Nought, and not an omission. Both are drawn as cards and neither is the player's to answer for:
	// one is the raid's use of its own cooldowns, the other is the gear they walked in wearing.
	// `overallOf` is handed only the two above, so these never reach it — the zero is here so the record
	// stays total and a future reader sees the decision rather than a missing key.
	externalsMissed: 0,
	hasteToBreakpoint: 0,
};

export function weightsFor(_view: ScoreView): Record<MetricKey, number> {
	return WEIGHTS;
}
