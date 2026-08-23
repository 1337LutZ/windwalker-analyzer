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

import type { BandView } from '~/lib/score';
import { type Band, bandOf } from '~/lib/spec/apl';
import type { TargetMode, TargetSummary } from '~/lib/types';

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
 *
 * **One band per pull, which is the limit of what a mode can say.** Two sections want exactly that —
 * they print one list and judge against one list — so this is the right answer for them. It is the
 * wrong answer for scoring, because a metric is graded over a clock and a pull's clock can run through
 * several bands: every committed multi-target fixture visits all four. `resolveBands` below is the
 * reading that keeps them.
 */
export function bandForMode(mode: TargetMode | null): Band | null {
	if (mode === null) return null;
	return mode === 'single' ? 1 : 3;
}

/**
 * Every band the pull's counts actually visited.
 *
 * **Off `TargetSummary.aplCounts` — the ladder's series — and not `counts` beside it.** This answers
 * "does this rung of the priority list apply anywhere in this pull" (see `BandView.bands`, and
 * `gradedBands`, the only thing that consumes the answer), and by the rule the two series were
 * separated under, a question about which rung applied reads the ladder's series. The evidence series
 * answers a different question — was there an enemy there — and `detected`, `multiTargetPct` and the
 * whole-pull mode the weights ride on all still read that one, correctly.
 *
 * **Why the swap, given that the evidence series is the more generous reading.** It is, and the
 * generous direction is the safe one — that argument is made below about dwell floors and it stands.
 * But it is an argument against inventing a *threshold*, not a licence to read a different
 * measurement. `aplCounts` is not a stingier `counts`; it is the count the ladder was actually handed,
 * and a rule graded at a band the ladder never presented is a fault invented for not pressing a button
 * the priority list did not ask for. Two further reasons it is this way round:
 *
 *   - **The two band consumers have to agree.** The Windwalker's `tigerPalmShare` narrows its press
 *     sample with the same vocabulary at the same instants. Reading one series here and the other there
 *     lets the exemption and the sample argue about the same moment — the failure `resolveBands` below
 *     already names about the grade and the weights.
 *   - **It costs no exemption on anything in the tree.** Only the Windwalker declares an exclusion, and
 *     its only banded rule is `tigerPalmWaste`'s `bands: [1]`. `bandOf(0)` is 1, so a stretch the
 *     exclusion empties still reports band 1 and the intersection stays non-empty either way. Every
 *     Elemental declaration is on a spec with no exclusion, where the two series are the same array. So
 *     this closes the mismatch without moving a grade.
 *
 * Falls back to `counts` when `aplCounts` is absent — every fixture captured before that field existed
 * — which is what keeps their band sets exactly what they were captured under.
 *
 * Either series is already a trailing-window count — so one point is a window of that many enemies
 * rather than an instant, and a band in this set was held for long enough to be counted at all. No
 * dwell floor on top of that, deliberately: it would be an invented threshold, and it would push in the
 * dangerous direction. A generous set makes a rule *harder* to exempt (the intersection stays non-empty
 * and the clock is cut stretch by stretch instead), and erring towards judging too much is recoverable
 * in a way that erring towards excusing is not.
 *
 * Null for a pull with no counts at all — every fixture captured before they existed. Not the empty
 * array: see `BandView.bands`.
 */
export function bandsInPull(targets: TargetSummary | undefined): readonly Band[] | null {
	const points = targets?.aplCounts?.points ?? targets?.counts.points ?? [];
	if (points.length === 0) return null;
	const seen = new Set<Band>(points.map(([, enemies]) => bandOf(enemies)));
	return [...seen].sort((a, b) => a - b);
}

/**
 * The bands to score a pull at: what it was fought at, or the one reading the reader forced.
 *
 * The counterpart of `resolveTargetMode` for everything downstream of a grade, and the reason it is a
 * separate function rather than a field on that one: the reader's override genuinely is a mode — their
 * switch has two positions and they are saying "read the whole pull as this" — while the detection is
 * a set, and a mixed pull is only expressible as the set. Forcing therefore narrows to one band
 * through `bandForMode`, and that narrowing is the reader's own claim rather than this module's guess.
 *
 * The three committed Elemental fixtures make the difference concrete: `phased` and `unbroken` never
 * exceed one enemy, so both readings agree on band 1 and nothing here can change them, while `cleave`
 * reads `[1, 2, 3, 4]` under detection and would be flattened to `[3]` by its detected mode alone.
 *
 * The whole-pull mode rides along on the result — see `BandView.mode` — rather than being fetched by
 * the caller from `resolveTargetMode` a second time. Both readings come off the same two inputs, so
 * resolving them together is what makes it impossible for the grade and the weights to be arguing
 * about different pulls.
 */
export function resolveBands(targets: TargetSummary | undefined, choice: TargetModeChoice): BandView {
	const { mode } = resolveTargetMode(targets?.detected, choice);
	if (choice === 'auto') return { bands: bandsInPull(targets), mode, forced: false };
	const forced = bandForMode(choice);
	return { bands: forced === null ? null : [forced], mode, forced: true };
}
