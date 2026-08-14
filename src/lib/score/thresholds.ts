// Where the lines sit, and why each one sits there.
//
// These are the only numbers in the app that turn a measurement into a judgement, so each carries
// the reasoning that put it where it is. A threshold nobody can argue with is a threshold nobody can
// correct — if one of these is wrong, the comment is what makes it possible to see that.
//
// All of them were checked against three real pulls spanning strong, mediocre and poor play, so
// none of them is a guess that happens to grade every pull the same colour.

import type { Threshold } from './model';

export const THRESHOLDS = {
	/**
	 * Share of available globals actually used.
	 *
	 * Windwalker is energy-gated with real downtime, so 100% is not the target and never happens.
	 *
	 * Calibrated against 25 real kills rather than guessed: they run 65.5% to 92.0%, median 82.6%. The
	 * old 80/65 split put a *third* of that range below the bottom threshold, so no pull in the sample
	 * could score `bad` at all — a band nothing reaches is a weight that only ever flatters. These cut
	 * roughly at the sample's upper quartile and lower quartile, so the grade separates real pulls.
	 *
	 * What is measured beneath them has since narrowed: a global given to a Tiger Palm that bought
	 * nothing no longer counts as used, because crediting it made the report contradict itself — see
	 * `CpmSummary.gcdUtilisationPct`. The bands are unchanged and deliberately not re-cut, because the
	 * 25-kill sample that produced them predates the change and re-deriving quartiles from three
	 * fixtures would be a worse number than an honest old one. What the change does to those three is
	 * worth stating rather than discovering: strong is untouched at 83.6% with no wasted presses at
	 * all, mixed falls 87.4% → 79.9%, poor falls 90.2% → 78.3%. Both of the latter move from `good` to
	 * `ok`, which is the correction — a pull cannot be near the ceiling on globals while throwing away
	 * one press in eight.
	 */
	gcdUtilisation: { good: 85, ok: 75, higherIsBetter: true },

	/**
	 * Share of Re-Origination procs converted into a Tigereye Brew.
	 *
	 * The spec's whole payoff. A brew during a proc freezes the converted stats for the brew's full
	 * 15 seconds, so a missed proc is not a small loss. Catching most of them is the skill being
	 * measured; catching under half means the pairing is not being played at all.
	 *
	 * Measured against the procs the bank could have paid for. Procs that arrived with too few stacks
	 * to be worth a brew are not chances and never count against this.
	 */
	snapshotRate: { good: 70, ok: 45, higherIsBetter: true },

	/**
	 * How deep into the proc the brew landed, averaged over the procs that *were* caught.
	 *
	 * Descriptive only — its weight is zero, and the bands below exist to pick a sentence rather than
	 * to pass a judgement. The note here used to warn that "a player who catches two procs out of nine
	 * can post a better depth than one who catches twelve", and then graded it at full weight anyway.
	 * The three fixtures say the warning was not hypothetical:
	 *
	 *   strong  12 of 14 caught, mean depth 61.2%  →  bad
	 *   mixed    4 of 6  caught, mean depth 59.0%  →  bad
	 *   poor     2 of 8  caught, mean depth 86.1%  →  good
	 *
	 * The best snapshotter in the set graded worst on it and the worst graded best, because the
	 * average only ever sees the procs someone bothered to catch. A number conditional on another
	 * number cannot stand on its own, and no threshold fixes that — the inversion is in the shape of
	 * the average, not in where the lines sit. So the bands stay, the grade stops counting, and
	 * `snapshotRate` carries the section alone.
	 *
	 * The bands themselves are the recalibrated ones: the 25-kill sample runs 51.6% to 96.2%, so
	 * nothing could reach the old 45% floor either.
	 */
	snapshotDepth: { good: 80, ok: 65, higherIsBetter: true },

	/**
	 * Rising Sun Kick's debuff uptime against engaged time.
	 *
	 * A 15-second debuff on an 8-second cooldown, so the ceiling really is ~100% and the bar is
	 * correspondingly high. Measured against engaged time rather than pull time, so intermissions
	 * and target swaps do not read as mistakes.
	 *
	 * **The number underneath these bands has changed, and the bands have not.** It used to be the
	 * debuff on one inferred primary target, graded only on pulls concentrated on that target; it is
	 * now the debuff on whichever enemy the player was hitting at each moment, graded on every pull.
	 * That is a different population, so what it does to the same 25 real kills is worth stating rather
	 * than discovering:
	 *
	 *     graded before   13 of 25 pulls      good 9   ok 1   bad 3
	 *     graded now      25 of 25            good 5   ok 4   bad 16
	 *     spread          min 29.3  q25 71.3  median 84.3  q75 93.3  max 99.4
	 *
	 * The nine pulls the counts read as single-target still separate against these lines much as they
	 * always did (median 93.2, four of nine at or above 95). The sixteen the counts read as
	 * multi-target sit about fourteen points lower, and that is what puts two thirds of the sample in
	 * `bad`. How much of that gap is a fault is genuinely unresolved: on the Dark Shaman a 15s debuff
	 * and an 8s cooldown cover two bosses comfortably, so 59% there is a real miss, while on Spoils of
	 * Pandaria the adds die inside the cooldown and no amount of play reaches 95%. This sample cannot
	 * tell those apart, and a band cut from it would bake the mixture in.
	 *
	 * So they are deliberately left alone. Re-cutting them here would be tuning a new measurement to
	 * the sample that produced the old one, and doing it silently is how a threshold stops being
	 * arguable. The honest fix is mode-aware — `Analysis.targets.detected` now says which kind of pull
	 * it was — and that is a decision to take deliberately, with a population per mode, rather than a
	 * side effect of changing what is measured.
	 */
	rskUptime: { good: 95, ok: 88, higherIsBetter: true },

	/**
	 * Share of Tiger Palm presses that bought nothing.
	 *
	 * Tiger Palm earns its global two ways: spending a free Combo Breaker proc, or refreshing Tiger
	 * Power before it drops. Anything else clips a healthy buff and takes a global that Jab or
	 * Blackout Kick wanted. A handful is noise; a third of them is a habit.
	 */
	tigerPalmWaste: { good: 10, ok: 30, higherIsBetter: false },

	/**
	 * Average stacks consumed per brew, out of the ten a full brew spends.
	 *
	 * This one grades tightly on purpose: brewing under a full ten is throwing away the difference,
	 * and even weak pulls tend to land near the cap, so the interesting range is narrow.
	 */
	brewStacks: { good: 9.5, ok: 8.5, higherIsBetter: true },

	/**
	 * Stacks lost to sitting at the twenty-stack cap.
	 *
	 * Every stack gained at cap is a stack that never existed. Zero is genuinely achievable — it
	 * only asks that a brew goes out before the bank fills — so anything above zero is a real miss
	 * rather than a rounding error.
	 */
	brewCapWaste: { good: 0, ok: 5, higherIsBetter: false },
} as const satisfies Record<string, Threshold>;

export type MetricKey = keyof typeof THRESHOLDS;

/**
 * How much each metric moves the overall verdict.
 *
 * Snapshotting and globals carry the most because they are the two things a Windwalker most
 * controls and that most change the damage. Brew-stack economy is weighted lightly: it barely
 * separates good pulls from bad ones in practice, so letting it swing the headline would make the
 * headline noisy.
 */
export const WEIGHTS: Record<MetricKey, number> = {
	// The two things this spec is actually about, and the two that separate the sample most sharply:
	// catch rate spreads 25–100% and Tiger Palm waste is frankly bimodal — players either have the
	// habit or they do not.
	snapshotRate: 4,
	tigerPalmWaste: 3,
	// Table stakes. Both are close to universally passed once the cast data is right, so they were
	// carrying five of thirteen weight while telling the reader almost nothing; a pull could post
	// three red sections and still come out `ok` on the strength of them.
	gcdUtilisation: 2,
	rskUptime: 2,
	// Measured, shown, and deliberately not counted. Zero rather than deletion so the metric keeps
	// existing for the copy to read a band off, and so the reason it does not count lives beside every
	// weight that does — see the note above `snapshotDepth` for the inversion that put it here.
	snapshotDepth: 0,
	brewStacks: 1,
	brewCapWaste: 1,
};
