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
