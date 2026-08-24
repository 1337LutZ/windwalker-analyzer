// Which target counts a pull was fought at, and which of them a rule is honest over.
//
// The report has always had two vocabularies for "how many enemies". The APL ladder has four bands
// and gates each entry on the ones its rung exists in; everything else has `TargetMode`, which was
// `'single' | 'multi'` for a whole pull. `view/targetMode.bandForMode` is where they meet, and it used
// to meet them by collapsing four values into two and expanding two back into `{1, 3}` — so a pull
// that spent four minutes on a boss and one on a pack of six was a single word, and whichever word
// won, one of those two stretches was graded against a list that was never applicable to it.
//
// **`TargetMode` carries four values now**, three of them the segments' own, so the conversion below
// is a mapping between vocabularies of the same width rather than a fold — a two-target reading no
// longer arrives at the three-target list. What a mode still cannot express is a pull that was several
// of them at different minutes, which is the whole reason `BandView` is a set.
//
// That is the whole of the bug this module exists for: an add wave then a boss produces a report whose
// every complaint is about dot uptime, because the dot clocks ran through stretches where no list
// asked for the dot. The fix is not a patch per metric. It is that a rule says which counts it belongs
// to, one mechanism reads that, and a rule with nothing left to grade says so instead of passing.
//
// Nothing here decides *how much* of a clock to cut — that is the audit's, which already restarts its
// clocks at every regime boundary. This is the declaration side, plus the one honest conversion.

import type { Interval } from '~/lib/analysis/intervals';
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
	/**
	 * The stretches of the pull this reading covers, or `null` for the whole of it.
	 *
	 * **This is the half `bands` alone could never express, and its absence is a defect this interface
	 * documented for a long time before it could be fixed.** `viewBands`' own docblock states it: a mixed
	 * pull forced to one mode *"arrives here as one band, and the four minutes that were not at that
	 * count are graded against a list that did not apply to them"*. Narrowing the band set says which
	 * rules apply; it does nothing to the clock they are measured over, so a reader asking to see the
	 * single-target half of a pull still got every metric measured across all of it.
	 *
	 * Populated from `Analysis.segments` — the union of the segments whose mode the reader chose. `null`
	 * on the default reading, which grades the whole pull exactly as before, and `null` on any pull whose
	 * segments are absent (every fixture captured before they existed). **Null must never be read as "no
	 * span applies"**: that would empty every clock at once, which is the failure direction this whole
	 * mechanism is built to avoid, and it is the same trap `bands: null` carries.
	 */
	spans?: readonly Interval[] | null;
}

/**
 * What a scoring call may be told about the pull's target counts.
 *
 * A union, and only because of sequencing: every caller today hands over a `TargetMode`, and the
 * bands cannot arrive at all until the callers are converted one at a time. `BandView` is the form
 * that can express a mixed pull; `TargetMode` is the form one press of the reader's control produces,
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
 * The bands a scoring call was told about — the only place a mode becomes bands.
 *
 * **This docblock used to open by calling itself lossy, and half of that defect has been fixed rather
 * than re-argued.** The lossy half was the vocabulary: two words expanded into `{1, 3}`, so a
 * two-target reading was handed the three-target list, which contains Spinning Crane Kick and moves
 * the chi dump's energy reserve to its higher number. `TargetMode` has four values now and three of
 * them name a band outright — `single` is 1, `cleave` is 2, `aoe` is 3 — so nothing is guessed on the
 * way through. `multi` keeps 3 because that is what the word has always meant here and because every
 * reading that used to arrive under it lands where it landed before. These are the same answers
 * `bandForMode` gives, and they have to be: a press judged at one band and a list printed at another
 * is the one failure that pairing exists to prevent.
 *
 * **What is still lossy is the arithmetic, not the vocabulary, and it cannot be fixed here.** A mixed
 * pull handed over as a mode arrives as one band whatever that band is, and the minutes that were not
 * at that count are graded against a list that did not apply to them. `BandView` is the shape that
 * answers it — a set for which rules applied, and `spans` for how much of the clock they applied over.
 * The fix for a caller that minds is still to hand one over, not to make this function cleverer: it
 * has one word to work from and nothing to be clever with.
 */
export function viewBands(view: ScoreView): readonly Band[] | null {
	if (view === null || view === undefined) return null;
	if (typeof view === 'string') return view === 'single' ? [1] : view === 'cleave' ? [2] : [3];
	return view.bands;
}

/**
 * Whether a reading is one where the job was spreading damage rather than aimed at one body.
 *
 * **The line is drawn at two enemies, not at three, and the tree draws it there three times already.**
 * `TargetSummary.multiTargetMs` counts time at two or more; `MULTI_TARGET_SHARE_PCT` decides the whole
 * pull against that clock; and the Windwalker's ladder puts `rushing-jade-wind-open` at `bands: [2, 3,
 * 4]`, so from two enemies up the priority list has already moved a spreading button above Rising Sun
 * Kick. A fourth reading that called two targets "aimed" would disagree with all three.
 *
 * The one caller today is `weightsFor`, and what it prices is a claim about the pull rather than about
 * a rung: how much a one-target number should matter when the job was spreading. `cleave` and `aoe`
 * answer that question the same way, because at both counts the list has stopped asking for the
 * one-target button first. Where they differ is *which* rungs apply, and that difference is carried by
 * the band — which is the division of labour `BandView.mode` and `BandView.bands` exist to keep.
 *
 * Null is not spreading, and it is not aimed either: it is nothing said. It reads as `false` here
 * because the caller is choosing between a base table and a discount, and the base table is what every
 * pull got before any of this existed.
 */
export function spreading(mode: TargetMode | null | undefined): boolean {
	return mode === 'cleave' || mode === 'aoe' || mode === 'multi';
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
