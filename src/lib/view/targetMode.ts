// Reading a pull as single- or multi-target, and letting the reader disagree.
//
// View state, and deliberately not an analysis setting. `lib/settings` says what belongs to it in its
// own opening lines — the handful of thresholds "a reader is entitled to disagree with", numbers that
// "depend on the person, not on the spec", like how fast someone can react to a proc. This is not one
// of those. Forcing a pull to be read as single-target changes nothing the engine measured: the
// counts stand, the uptime stands, and only which of the two readings the report argues from moves.
//
// Putting it in `AnalysisSettings` would do two things nobody wants. It would persist to
// localStorage and follow the reader onto the next fight they picked — a Galakras pull silently
// graded as single-target because they forced it on Immerseus twenty minutes ago. And it would make
// the choice an input to `analyse()`, so a label could not change without re-running the analysis.
// So it lives where the selection does: in the component that renders the report, for as long as that
// report is on screen.

import type { Band } from '~/lib/spec/apl';
import type { TargetMode } from '~/lib/types';

/** What the reader can ask for: the detected answer, or one of the two readings outright. */
export type TargetModeChoice = 'auto' | TargetMode;

/** The three, in the order a control offers them. Detection first, because it is the default. */
export const TARGET_MODE_CHOICES: readonly TargetModeChoice[] = ['auto', 'single', 'multi'];

export interface ResolvedTargetMode {
	/**
	 * Which reading to use — or null when nothing detected one and the reader has not said either.
	 *
	 * Null rather than a default. A pull analysed before the counts existed (every committed fixture)
	 * genuinely has no answer here, and handing back `'single'` would let a caller grade it against the
	 * single-target list on the strength of a guess this module made.
	 */
	mode: TargetMode | null;
	/** What the counts said, kept even when overridden: the reader has to see what they are contradicting. */
	detected: TargetMode | null;
	/** True when the reader's choice and the detection actually disagree — not merely when one was made. */
	overridden: boolean;
}

/** Reconciles what the pull looked like with what the reader asked for. */
export function resolveTargetMode(
	detected: TargetMode | null | undefined,
	choice: TargetModeChoice,
): ResolvedTargetMode {
	const seen = detected ?? null;
	if (choice === 'auto') return { mode: seen, detected: seen, overridden: false };
	return { mode: choice, detected: seen, overridden: seen !== null && seen !== choice };
}

/**
 * Which of the priority list's four bands a reading is read at.
 *
 * Two sections need this answer and they must give the same one: `PriorityLadder` judges every press
 * at this band, and `Rotation` prints the rungs that exist at it. If they disagreed, a reader sent
 * from a skip to the reference would arrive at a list that never contained the button they were told
 * they passed over — which is the one failure the pairing exists to prevent.
 *
 * `multi` is three rather than two or four, because three is where the multi-target list has taken
 * its shape: Rushing Jade Wind is above Rising Sun Kick, Spinning Crane Kick is in the list, and the
 * chi dump's energy reserve has moved to the higher of its two numbers. Four adds exactly one more
 * rung — the `targets >= 4` Crane Kick of entry 20 — and reading every pack as though it were four
 * enemies would print a rung most packs never reach.
 *
 * Null when nothing detected a reading and the reader has not chosen one, which is the same null
 * `resolveTargetMode` returns and means the same thing: no basis to pick, so do not pick.
 */
export function bandForMode(mode: TargetMode | null): Band | null {
	if (mode === null) return null;
	return mode === 'single' ? 1 : 3;
}
