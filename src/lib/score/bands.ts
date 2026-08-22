// Which target counts a pull was fought at, and which of them a rule is honest over.
//
// The report has always had two vocabularies for "how many enemies". The APL ladder has four bands
// and gates each entry on the ones its rung exists in; everything else has `TargetMode`, which is
// `'single' | 'multi'` for a whole pull. `view/targetMode.bandForMode` is where they meet, and it
// meets them by collapsing four values into two and expanding two back into `{1, 3}` — so a pull that
// spent four minutes on a boss and one on a pack of six is a single word, and whichever word wins,
// one of those two stretches is graded against a list that was never applicable to it.
//
// That is the whole of the bug this module exists for: an add wave then a boss produces a report whose
// every complaint is about dot uptime, because the dot clocks ran through stretches where no list
// asked for the dot. The fix is not a patch per metric. It is that a rule says which counts it belongs
// to, one mechanism reads that, and a rule with nothing left to grade says so instead of passing.
//
// Nothing here decides *how much* of a clock to cut — that is the audit's, which already restarts its
// clocks at every regime boundary. This is the declaration side, plus the one honest conversion.

import { ALL_BANDS, type Band } from '~/lib/spec/apl';
import type { TargetMode } from '~/lib/types';

import type { MetricRule } from './model';

/**
 * The bands a pull is to be read at.
 *
 * Deliberately a *set* and not a single band, because a mixed pull is the case the mode could not
 * express: `bands: [1, 2, 3, 4]` is the honest reading of an encounter with add waves and a boss, and
 * it is what every committed multi-target fixture actually produces.
 *
 * What the set is for, and what it is not for. It answers "does this rule apply anywhere in this
 * pull" — the question whose only two useful answers are "somewhere" and "nowhere", the second being
 * the one that must not grade. It does **not** answer "how much of the clock counted": a pull that
 * touched band 1 for one window and band 4 for four minutes has band 1 in this set, and grading its
 * whole dot clock on the strength of that would be the same free pass in a different disguise. The
 * length of the graded clock is how that half is carried — see `Metric.gradedMs`.
 */
export interface BandView {
	/**
	 * The bands to read the pull at, or null when there is no basis to say.
	 *
	 * Null rather than a default, the same refusal `resolveTargetMode` makes: a pull analysed before
	 * the counts existed has no answer here, and any default would grade real stretches against a list
	 * chosen by a guess. A caller holding null grades everything, which is what it did before bands
	 * existed and is the conservative direction — it judges too much rather than excusing too much.
	 *
	 * Never the empty array. Empty would read as "no band applies", which exempts every banded rule at
	 * once; nothing produces it, and a caller seeing it would be right to treat it as a bug.
	 */
	bands: readonly Band[] | null;
	/**
	 * The same pull read as one whole-pull mode, for the questions a set of bands cannot answer.
	 *
	 * Both readings, on one object, because the two questions in the scorecard are genuinely different.
	 * *Which rules applied* is per-rung and per-moment, and only the set can answer it — that is
	 * everything above. *How much a one-target number should matter when the job was spreading* is a
	 * claim about the pull as a whole: `MULTI_TARGET_WEIGHTS` discounts Rising Sun Kick uptime on that
	 * argument, and a band set has nothing to say about it. A pull that dipped to one enemy for one
	 * window was not thereby a single-target pull.
	 *
	 * Carried rather than derived, in either direction. Deriving the mode from the set would need an
	 * invented dwell threshold, which `resolveBands` declines to invent for exactly the reason stated
	 * there; deriving the set from the mode is `viewBands`' lossy arm and is the thing this interface
	 * exists to stop. So both come off the same two inputs — the counts and the reader's choice — in one
	 * place, and the score and the weights cannot disagree about what the pull was.
	 *
	 * Null on the same terms as `bands`: nothing detected a reading and the reader has not forced one.
	 */
	mode: TargetMode | null;
	/** True when the reader forced the reading rather than the counts detecting it. */
	forced: boolean;
}

/**
 * What a scoring call may be told about the pull's target counts.
 *
 * A union, and only because of sequencing: every caller today hands over a `TargetMode`, and the
 * bands cannot arrive at all until the callers are converted one at a time. `BandView` is the form
 * that can express a mixed pull; `TargetMode` is the form the reader's own two-way switch produces,
 * and passing one is a statement that the whole pull is to be read at one band. `null` is "nothing
 * said", which grades everything.
 */
export type ScoreView = BandView | TargetMode | null | undefined;

/** The bands a rule declares, defaulted the way the ladder defaults its entries: all of them. */
export function bandsOf(rule: Pick<MetricRule, 'bands'>): readonly Band[] {
	return rule.bands ?? ALL_BANDS;
}

/** Whether a rule is one of the ones the list contains at this target count. */
export function appliesAt(rule: Pick<MetricRule, 'bands'>, band: Band): boolean {
	return bandsOf(rule).includes(band);
}

/**
 * The bands of this pull that this rule is honest over — the intersection, and the empty answer is
 * the whole point of the exercise.
 *
 * Empty means the pull never entered the rule's bands, so the rule was never asked of it. A pull that
 * touched even one of them keeps the rule: the stretches that were not in band are cut from the
 * *clock*, by the audit that owns the clock, and this function has no business guessing how many ms
 * that leaves.
 *
 * A null pull view returns the rule's own bands rather than nothing: "no basis to say" must not turn
 * into "not applicable", because that would silently exempt every banded rule on every fixture
 * captured before the counts existed.
 */
export function gradedBands(rule: Pick<MetricRule, 'bands'>, pull: readonly Band[] | null): readonly Band[] {
	const declared = bandsOf(rule);
	return pull === null ? declared : declared.filter((band) => pull.includes(band));
}

/**
 * The bands a scoring call was told about — the only place a mode becomes bands, and it is lossy.
 *
 * `'single'` is band 1 and `'multi'` is band 3, the same two answers `bandForMode` gives and for the
 * same reason (three is where the multi-target lists have taken their shape; four adds one rung most
 * packs never reach). It is lossy in the direction that matters: a mixed pull handed over as a mode
 * arrives here as one band, and the four minutes that were not at that count are graded against a
 * list that did not apply to them. The fix for a caller that minds is to hand over a `BandView`, not
 * to make this function cleverer — it has nothing to be clever with.
 */
export function viewBands(view: ScoreView): readonly Band[] | null {
	if (view === null || view === undefined) return null;
	if (typeof view === 'string') return view === 'single' ? [1] : [3];
	return view.bands;
}

/**
 * The whole-pull reading a scoring call was told about — the counterpart of `viewBands`, and the
 * only one of the two that a `TargetMode` can answer without losing anything.
 *
 * For a bare mode it is the mode itself. For a `BandView` it is the mode that view was resolved
 * alongside, which is why that field exists rather than being reconstructed from the set here: see
 * `BandView.mode`.
 */
export function viewMode(view: ScoreView): TargetMode | null {
	if (view === null || view === undefined) return null;
	return typeof view === 'string' ? view : view.mode;
}
