// Reading a pull at one of its rotations, and letting the reader disagree.
//
// View state, and deliberately not an analysis setting. `lib/settings` says what belongs to it in its
// own opening lines — the handful of thresholds "a reader is entitled to disagree with", numbers that
// "depend on the person, not on the spec", like how fast someone can react to a proc. This is not one
// of those. Forcing a pull to be read as single-target changes nothing the engine measured: the
// counts stand, the uptime stands, and only which reading the report argues from moves.
//
// Putting it in `AnalysisSettings` would do two things nobody wants. It would persist to
// localStorage and follow the reader onto the next fight they picked — a Galakras pull silently
// graded as single-target because they forced it on Immerseus twenty minutes ago. And it would make
// the choice an input to `analyse()`, so a label could not change without re-running the analysis.
// So it lives where the selection does: in the component that renders the report, for as long as that
// report is on screen.

import { type Interval, mergeIntervals } from '~/lib/analysis/intervals';
import type { SegmentMode, SegmentTimeline } from '~/lib/analysis/segments';
import { type BandView, spreading } from '~/lib/score';
import { type Band, bandOf } from '~/lib/spec/apl';
import type { TargetMode, TargetSummary } from '~/lib/types';

/** What the reader can ask for: the whole fight, or one of its readings outright. */
export type TargetModeChoice = 'auto' | TargetMode;

/**
 * The choices a control may put in front of a reader, which is every one but `'multi'`.
 *
 * `'multi'` is the detection's word and not a rotation: it means "two or more", which is a cleave and
 * an eight-target pack folded together, and the fold is the thing this vocabulary was widened to undo.
 * A button offering it would hand back the reading the whole exercise removed. It stays a legal
 * `TargetModeChoice` because `TargetSummary.detected` produces it and a caller may hand it straight
 * on — see `bandForMode` and `spansForChoice`, both of which answer for it.
 */
export type OfferedChoice = Exclude<TargetModeChoice, 'multi'>;

/**
 * How long a mode has to hold, across the whole pull, before the control offers it as a reading.
 *
 * **30 000 ms — about twenty globals, and roughly four times `MIN_GRADED_SAMPLE`'s worth of presses.**
 * A position that grades nothing is worse than a missing one: `MIN_GRADED_SAMPLE` and
 * `MIN_JUDGED_WEIGHT_SHARE` would refuse most of the card, so the reader clicks a button and is told
 * the report cannot say — which reads as a broken control rather than as an honest refusal.
 *
 * Measured across the eight committed pulls that carry a timeline, this is what the menu comes out as:
 *
 * ```
 *                          single   cleave      aoe   offers
 *   ww/ironJuggernaut      190.3s        -        -   single
 *   ww/idle                 28.1s     8.1s    15.7s   —                (128s of it is mixed, 75s idle)
 *   ww/sections            106.8s    68.3s   138.4s   single cleave aoe
 *   ww/uncounted           211.3s        -        -   single
 *   el/addsThenBoss        105.9s    96.0s   317.4s   single cleave aoe
 *   el/cleave              106.7s    15.4s    67.5s   single aoe
 *   el/phased              245.4s        -        -   single
 *   el/unbroken            184.4s        -        -   single
 * ```
 *
 * Two of those rows are the argument for deriving the menu at all. **`el/cleave` does not offer
 * Cleave** — the fixture named for cleaving spends 15.4 s of 263 s in a cleave segment, and its
 * multi-target time is an eight-target reading rather than a two-target one. **`ww/idle` offers
 * nothing but the whole fight**: no rotation held for half a minute, so every narrower reading there
 * would be a letter earned on scraps. The plan's own case is the same shape from the other side —
 * Norushen has no single-target segment at all, and a fixed list would put a Single Target button on a
 * pull with nothing behind it.
 */
export const TARGET_MODE_MIN_MS = 30_000;

/** The three the menu is drawn from, in ascending enemy count — the order a reader expects them in. */
const OFFERABLE: readonly Extract<SegmentMode, TargetMode>[] = ['single', 'cleave', 'aoe'];

/**
 * The readings this pull can carry, in the order a control offers them.
 *
 * **A function of the analysis, where it used to be a constant.** `TARGET_MODE_CHOICES` was
 * `['auto', 'single', 'multi']` for every pull in the game, which is a claim about the encounter roster
 * and not about the fight in front of the reader. The menu is now a claim about *this* pull: each
 * position says "there was enough of that rotation here to read it on its own", and the pull's own
 * segments are the only thing that can say so.
 *
 * `'auto'` is always first and is always offered, because reading the whole fight needs no evidence —
 * it is the fight. Everything after it is earned, at `TARGET_MODE_MIN_MS`.
 *
 * **A pull with no timeline offers nothing but the whole fight, and that is the honest answer rather
 * than a degraded one.** Every committed `Analysis` capture predates `Analysis.segments` and arrives
 * here `undefined`; `analyse()` has filled it in for every pull since. Offering the three anyway on
 * such a capture would offer precisely the defect this widening removes — `spansForChoice` returns
 * `null` without a timeline, so the reading would narrow the bands and leave every clock running over
 * the whole pull, which is the lossy arm `BandView.spans` exists to close.
 *
 * `mixed` and `idle` are never positions. A `mixed` stretch is one no single rotation described, so
 * the reading that keeps it is the whole fight; `idle` is time nothing was there to be hit, which is
 * evidence for no reading at all.
 */
export function targetModeChoices(segments: SegmentTimeline | undefined): readonly OfferedChoice[] {
	const offered: OfferedChoice[] = ['auto'];
	if (segments === undefined) return offered;
	const held = new Map<SegmentMode, number>();
	for (const segment of segments.segments) {
		held.set(segment.mode, (held.get(segment.mode) ?? 0) + segment.endMs - segment.startMs);
	}
	for (const mode of OFFERABLE) if ((held.get(mode) ?? 0) >= TARGET_MODE_MIN_MS) offered.push(mode);
	return offered;
}

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

/**
 * Reconciles what the pull looked like with what the reader asked for.
 *
 * **The disagreement is decided in the coarser of the two vocabularies, and it has to be.** The reader
 * now has three words and the detection still has two: `TargetSummary.detected` is one share against
 * one threshold, and neither a cleave nor an eight-target pack is a thing that number can name. So
 * comparing them literally would report a reader who chose Cleave on a pull detected `multi` as
 * contradicting it, when the two agree about everything the detection actually claimed. `spreading`
 * folds the choice back down to the detection's own pair, and the comparison happens there.
 *
 * What survives that fold is the disagreement the control exists to show: single against spreading,
 * either way round. A reader who forces one target on an add fight is still told the pull disagrees,
 * which is the case the whole override was built for.
 */
export function resolveTargetMode(
	detected: TargetMode | null | undefined,
	choice: TargetModeChoice,
): ResolvedTargetMode {
	const seen = detected ?? null;
	if (choice === 'auto') return { mode: seen, detected: seen, overridden: false };
	return { mode: choice, detected: seen, overridden: seen !== null && spreading(seen) !== spreading(choice) };
}

/**
 * Which of the priority list's four bands a reading is read at.
 *
 * Two sections need this answer and they must give the same one: `PriorityLadder` judges every press
 * at this band, and `Rotation` prints the rungs that exist at it. If they disagreed, a reader sent
 * from a skip to the reference would arrive at a list that never contained the button they were told
 * they passed over — which is the one failure the pairing exists to prevent.
 *
 * **Three of the four modes now name their band outright, and only the coarse one has to be argued.**
 * `single` is one and `cleave` is two, which is what those words mean; `aoe` is `n >= 3` in
 * `SegmentMode`'s own reading and lands on three. That is the whole of the widening's benefit here —
 * a two-target reading used to arrive as band 3 and be shown a list that wants Spinning Crane Kick,
 * which the list does not contain until three.
 *
 * `multi` is three rather than two or four, because three is where the multi-target list has taken
 * its shape: Rushing Jade Wind is above Rising Sun Kick, Spinning Crane Kick is in the list, and the
 * chi dump's energy reserve has moved to the higher of its two numbers. Four adds exactly one more
 * rung — the `targets >= 4` Crane Kick of entry 20 — and reading every pack as though it were four
 * enemies would print a rung most packs never reach. `aoe` shares that answer for the same reason and
 * keeps every reading that used to arrive as `multi` exactly where it was.
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
	if (mode === 'single') return 1;
	return mode === 'cleave' ? 2 : 3;
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
 *   - **It costs no exemption on anything in the tree**, and two specs declare an exclusion now rather
 *     than one. The Windwalker's only banded rule is `tigerPalmWaste`'s `bands: [1]`; `bandOf(0)` is 1,
 *     so a stretch the exclusion empties still reports band 1 and the intersection stays non-empty
 *     either way. Every Elemental declaration is on a spec with no exclusion, where the two series are
 *     the same array. **The Protection Paladin declares `['consecration', 'lights-hammer']` and declares
 *     no `bands` at all**, so nothing of its is scoped by this set today. So this closes the mismatch
 *     without moving a grade.
 *
 *     What the second exclusion does move is the set itself, in one place, and it is worth knowing where:
 *     the Paladin's `paragons` capture visits `[1, 2, 3, 4]` on the evidence series and `[1, 2, 3]` on the
 *     ladder's, because the fourth enemy is only ever reached by that player's own Consecration. That is
 *     the swap doing its job — a rung the ladder was never handed — and it is pinned in
 *     `analysis/__tests__/targetSeries.aplBands.test.ts` against the day a Protection rule is banded.
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
 * separate function rather than a field on that one: the reader's override genuinely is a mode — they
 * pick one position and are saying "read the pull as this" — while the detection is a set, and a mixed
 * pull is only expressible as the set. Forcing therefore narrows to one band through `bandForMode`,
 * and that narrowing is the reader's own claim rather than this module's guess.
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
export function resolveBands(
	targets: TargetSummary | undefined,
	choice: TargetModeChoice,
	segments?: SegmentTimeline | undefined,
): BandView {
	const { mode } = resolveTargetMode(targets?.detected, choice);
	if (choice === 'auto') return { bands: bandsInPull(targets), mode, forced: false, spans: null };
	const forced = bandForMode(choice);
	return {
		bands: forced === null ? null : [forced],
		mode,
		forced: true,
		spans: spansForChoice(segments, choice),
	};
}

/**
 * The stretches a forced reading covers — the union of the segments whose mode the reader asked for.
 *
 * **Third parameter and optional, on purpose.** Every existing caller keeps working and keeps getting
 * `spans: null`, which grades the whole pull exactly as before; a caller that wants the narrower reading
 * opts in by handing over the timeline. Converting them one at a time is the same sequencing argument
 * `ScoreView` makes for being a union at all.
 *
 * `null` rather than `[]` when the pull has no segments — every fixture captured before they existed is
 * in that position, and an empty array would read as "no stretch qualifies" and empty every clock at
 * once. That is the failure direction, and it is the same one `bands: null` guards.
 *
 * **The three offered readings take their own segments and nothing else.** This is where the fold that
 * `TargetMode`'s widening exists to remove used to live: `'multi'` collected `cleave` and `aoe`
 * together, so a reader asking about the pack got a clock that also ran through every two-target
 * stretch. `single` takes `single`, `cleave` takes `cleave`, `aoe` takes `aoe`, and the answer is what
 * the reader asked for rather than the nearest available union.
 *
 * **`mixed` belongs to no narrowed reading, which is a change of side rather than an omission.** It
 * used to be filed with the multi-target half on the argument that a stretch which was not
 * single-target must be the other thing. With three positions that argument is gone: a `mixed` segment
 * is by construction one that no single rotation described, so handing it to `cleave` or to `aoe` would
 * be picking a winner the segmentation already declined to pick. The reading that keeps it is the whole
 * fight, which is the default and covers everything. **`idle` belongs to none of them** for the older
 * reason — nothing was there to be hit, so it is evidence for no reading at all.
 *
 * `'multi'` keeps the old union, because it keeps the old meaning: it is the detection's "two or more",
 * and a caller handing it on is asking for exactly the stretches that were not one target. No control
 * offers it — see `OfferedChoice` — so this arm answers callers holding a detected mode rather than a
 * reader's press.
 */
function spansForChoice(
	segments: SegmentTimeline | undefined,
	choice: Exclude<TargetModeChoice, 'auto'>,
): readonly Interval[] | null {
	if (segments === undefined || segments.segments.length === 0) return null;
	const wanted = (mode: SegmentMode): boolean =>
		choice === 'multi' ? mode === 'cleave' || mode === 'aoe' || mode === 'mixed' : mode === choice;
	const picked = segments.segments
		.filter((segment) => wanted(segment.mode))
		.map((segment): Interval => [segment.startMs, segment.endMs]);
	return picked.length === 0 ? null : mergeIntervals(picked);
}
