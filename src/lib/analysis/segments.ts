// Cutting a pull into sections by what the rotation should have been.
//
// A pull is currently collapsed to one word — single or multi, at a 33% share — and scored as one
// scorecard. Measured across all fourteen Siege bosses that is wrong on thirteen of them: Galakras
// alternates add waves and boss-alone phases for seven minutes and gets one letter for all of it, and
// 38.6% of Immerseus is time with no enemy at all, filed as single-target because `bandOf(0)` is 1.
//
// This module is the one reading of "which part of the fight was this". Nothing downstream may
// re-derive it — the tree has been bitten by exactly that before, which is why `viewBands` had to
// document itself as a third reading of the target count "free to disagree with both".
//
// **Pure, and a function of that pull's own count series.** No encounter id reaches it and no lookup
// table of boss names sits behind it: the segments describe what *this player* did on *this pull*, so
// two players on the same fight producing different timelines is the analysis working rather than
// drift to be smoothed. `MULTI_TARGET_SHARE_PCT` already holds the same line, with the same evidence —
// two monks on one Norushen pull at 22.9% and 56.2%.
//
// The cut is **two-level: downtime from the contact clock first, then mode hysteresis inside each
// contact window.** Running downtime through the mode hysteresis as a fourth value was tried and
// overshoots — it absorbs neighbouring contact and reports 131s of idle on Immerseus, which has 81s.

import { type Band, bandOf } from '~/lib/spec/apl';

import { stretchesFromPoints } from './counters';
import { complementOf, type Interval, mergeIntervals } from './intervals';

/**
 * What the rotation should have been, for as long as the segment lasts.
 *
 * `single` / `cleave` / `aoe` are the three the count series can produce directly. `mixed` is what a
 * segment gets when no one of those held enough of it to be worth naming — see `mixedShare`. `idle` is
 * the player damaging nothing, which is a section of the fight and not a stretch of single-target.
 */
export type SegmentMode = 'single' | 'cleave' | 'aoe' | 'mixed' | 'idle';

/** The three a live count maps to. `mixed` and `idle` are verdicts about a span, not about a count. */
type ContactMode = 'single' | 'cleave' | 'aoe';

/**
 * The mode a live enemy count reads as.
 *
 * The same three lines `bandOf` draws, collapsed by one: the priority list splits bands 3 and 4 (entry
 * 20's raw `targets >= 4` Spinning Crane Kick), but a *section* of a fight does not change character
 * between three enemies and four, and cutting there would double the boundaries for a distinction
 * `medianEnemies` publishes anyway.
 *
 * Zero reads as single, exactly as `bandOf(0)` does, and that is safe here rather than the bug §3a
 * names — every zero run long enough to matter has already been taken out as `idle` before this is
 * asked, and the short ones left inside a contact window cannot open a segment (see `eligible`).
 */
function modeOf(count: number): ContactMode {
	if (count >= 3) return 'aoe';
	if (count === 2) return 'cleave';
	return 'single';
}

/**
 * The floor a mode has to hold for before a segment can enter it.
 *
 * **8 000 ms, chosen by sweep rather than by matching the contact gap.** The 15 000 an earlier draft
 * used was tidy and wrong: `ENGAGED_GAP_MS` governs when *contact* breaks, not how long a rotation mode
 * must hold. At 15s hysteresis never enters a mode whose adds arrive in bursts, so the pull stays in
 * whatever it started in — Siegecrafter Blackfuse came out as one `single` section holding 92s of
 * two-or-more, and Norushen as a 139s `single` section that is 35% single.
 *
 * Purity — how much of a segment is actually at the mode on its label — swept over all fourteen Siege
 * pulls:
 *
 * ```
 * floor   segments   purity
 *  20s        31       66%
 *  15s        42       71%   the earlier drafts
 *  12s         -       73%
 *  10s        71       77%
 *   8s        84       81%   knee: segments still long enough to grade
 *   6s       114       85%
 *   5s         -       90%
 *   4s       187       92%   too short — MIN_GRADED_SAMPLE is 3, and 4s is three globals
 * ```
 *
 * Those counts are of *contact* segments; the fourteen downtime sections are cut by the contact clock
 * and are not subject to this floor at all.
 */
export const SEGMENT_FLOOR_MS = 8000;

/**
 * The share a winning mode has to hold before the segment is named after it.
 *
 * 0.70, the third whole-pull value already agreed, applied one level down. Below it the segment is
 * `mixed`: no single mode describes it, and saying so is more useful than picking the largest minority.
 * Across the raid it names 22 of 84 segments and lifts honest labelling from 71% to 92%.
 */
export const SEGMENT_MIXED_SHARE = 0.7;

/** One section of the pull, and what the rotation should have been for its length. */
export interface FightSegment {
	/** Position in the timeline, 0-based. Segments are in order and tile the pull, so this is also an id. */
	index: number;
	/** Half-open, `[startMs, endMs)`, fight-relative. */
	startMs: number;
	endMs: number;
	mode: SegmentMode;
	/**
	 * The share of the segment's own clock spent at `mode`.
	 *
	 * For a `mixed` segment this is still the *winner's* real share — the number that fell short of
	 * `mixedShare` — and not zero and not the share of some blend. A reader has to be able to see how
	 * close the call was. 1 for `idle`, which is uniform by construction.
	 *
	 * **Time at no enemy counts against every mode rather than for `single`.** A contact window can hold
	 * zero runs of up to ten seconds — anything longer is already `idle` — and `modeOf(0)` is `single`,
	 * so letting them vote would report a window that was half silence as 100% single-target. That is
	 * §3a's fault in miniature, and the denominator is the segment's own clock either way, so the honest
	 * reading is that those milliseconds were at no mode at all and dilute whatever claim the label makes.
	 */
	dominance: number;
	/**
	 * The bands actually visited inside it, in ascending order.
	 *
	 * A count of zero contributes **nothing** here, deliberately: `bandOf(0)` is 1, and letting downtime
	 * report band 1 is the exact fault §3a exists to fix — it is how the ladder came to spend Immerseus'
	 * 81 idle seconds in its single-target list. Time at no enemies is in `msByCount[0]`, where it can be
	 * read as itself. So an `idle` segment's bands are empty, and so are those of a contact window that
	 * somehow held no enemy at all.
	 */
	bands: readonly Band[];
	/**
	 * The time-weighted median enemy count over the segment, zeros included.
	 *
	 * **The label alone oversells, and this is the correction.** `mode(n)` calls anything `n >= 3` "aoe",
	 * inherited from `bandOf`'s band-3 cut. On Paragons of the Klaxxi that is a lie of degree: exactly one
	 * of thirteen segments comes out `aoe`, 20.2s long, of which 17s is at *three* enemies — and under the
	 * parsing rules the pull peaks at three at all. A rule that branched on `mode === 'aoe'` would pick an
	 * eight-target rotation for three bodies. A rule that cares reads this number; a rule that does not
	 * reads the label.
	 */
	medianEnemies: number;
	/** Milliseconds at each enemy count seen inside the segment, zero included. Sums to `endMs - startMs`. */
	msByCount: Readonly<Record<number, number>>;
}

/** The published timeline, with the floor it was cut at so a reader can see what produced it. */
export interface SegmentTimeline {
	floorMs: number;
	segments: readonly FightSegment[];
}

export interface SegmentOptions {
	/**
	 * The hit gap that breaks contact — `ENGAGED_GAP_MS`, 15 000 ms, declared by both specs.
	 *
	 * Required rather than defaulted, and that is the point of taking it: this module may not import a
	 * spec, and a private copy of the number here is how the downtime cut and `engagedWindows` would
	 * drift apart. Pass the same constant that built the contact clock.
	 */
	contactGapMs: number;
	/**
	 * The trailing window the count series was taken over — `SpecThresholds.targetWindowMs`, 5 000 ms.
	 *
	 * Downtime is cut at `contactGapMs - windowMs` rather than at either one, because the two clocks
	 * measure the same silence from different ends. A count point falls to zero one window *after* the
	 * last hit that fed it, so a zero run of 10 000 ms is a hit gap of 15 000 ms — exactly the break
	 * `engagedWindows` already uses. Deriving it keeps the two readings the same cut rather than two cuts
	 * that agree today.
	 */
	windowMs: number;
	/** How long a mode must hold before a segment can enter it. Defaults to `SEGMENT_FLOOR_MS`. */
	floorMs?: number;
	/** Below this share the segment is `mixed`. Defaults to `SEGMENT_MIXED_SHARE`. */
	mixedShare?: number;
}

/** A stretch of the count series holding one value, clamped into the pull. */
interface CountSpan {
	start: number;
	end: number;
	count: number;
}

/** Adjacent spans that read as the same mode, merged — the unit hysteresis decides about. */
interface ModeRun {
	start: number;
	end: number;
	mode: ContactMode;
	/** Time inside the run at one enemy or more. A run that is all zeros may not open a segment. */
	contactMs: number;
}

/**
 * The count series as spans, clamped to `[0, durationMs]` and opened with a zero span where it starts late.
 *
 * `stretchesFromPoints` does the walk — the count series records one point per *change*, which is the
 * gapless step series that function is for — and it already clamps the tail. Two things it does not do,
 * both of which matter here:
 *
 *   - **The leading zero.** The series opens at the first landed hit, so a pull whose first hit is 12s in
 *     has no point before it at all. Without a `[0, firstHit)` span at zero that opening would simply be
 *     missing from the partition, and on Immerseus it is a third of the fight.
 *   - **A series with no points.** A player who damaged nothing is one zero span over the whole pull, not
 *     an empty timeline.
 *
 * Sorted first because nothing else guarantees it: `targetCounts` emits in order, but this function is
 * the published entry point and an out-of-order series would silently produce overlapping spans, which
 * is the one thing the partition invariant cannot survive.
 */
function spansOf(points: ReadonlyArray<readonly [number, number]>, durationMs: number): CountSpan[] {
	const sorted = [...points].sort((a, b) => a[0] - b[0]);
	const spans: CountSpan[] = [];
	for (const stretch of stretchesFromPoints(sorted, durationMs)) {
		const start = Math.max(0, stretch.start);
		if (stretch.end > start) spans.push({ start, end: stretch.end, count: stretch.level });
	}

	const opensAt = spans[0]?.start ?? durationMs;
	if (opensAt > 0) spans.unshift({ start: 0, end: opensAt, count: 0 });
	return spans;
}

/**
 * The spans of `[from, to)` collapsed into runs of one mode.
 *
 * Merging here rather than in the hysteresis walk is what makes that walk one comparison per run: two
 * adjacent counts of 3 and 5 are one stretch of `aoe` the player never left, and asking whether each of
 * them separately held for the floor would refuse to enter a mode the pull spent a minute in.
 */
function modeRunsIn(spans: readonly CountSpan[], from: number, to: number): ModeRun[] {
	const runs: ModeRun[] = [];
	for (const span of spans) {
		const start = Math.max(span.start, from);
		const end = Math.min(span.end, to);
		if (end <= start) continue;

		const mode = modeOf(span.count);
		const contactMs = span.count > 0 ? end - start : 0;
		const last = runs[runs.length - 1];
		if (last !== undefined && last.mode === mode) {
			last.end = end;
			last.contactMs += contactMs;
		} else runs.push({ start, end, mode, contactMs });
	}
	return runs;
}

/**
 * Where to cut `[from, to)`, by hysteresis: enter a mode only once it has held for the floor, leave only
 * once another has.
 *
 * ***The prototype's finding that decides the algorithm.*** Absorbing short runs greedily — the obvious
 * implementation, and the first one written — is **not monotonic in its own parameter**. Raising the floor
 * produces *more* segments:
 *
 * ```
 * Spoils of Pandaria    15s = 4    20s = 1    25s = 1    30s = 2
 * Kor'kron Dark Shaman  15s = 2    20s = 1    25s = 2    30s = 2
 * ```
 *
 * A parameter that does not move in one direction cannot be tuned or explained, and two implementations
 * of the same idea would disagree about the same pull. Hysteresis is chosen precisely because it is
 * monotonic, and the proof is short enough to keep here so nobody optimises it back into a greedy pass:
 *
 * > A run is *eligible* when it held for the floor (and held an enemy). Raising the floor can only remove
 * > runs from that set, so the eligible mode sequence at the higher floor is a **subsequence** of the one
 * > at the lower floor. The segment count is the number of blocks that sequence collapses into, and
 * > deleting one element of a sequence never increases its block count — it either sits inside a block, or
 * > it *is* a block and its removal may merge the two neighbours. So the count never rises.
 *
 * The opening mode is the first eligible run's, not the first run's, and the segment still starts at
 * `from`: a 200ms flicker of `aoe` before three minutes of one target is not a section of the fight, and
 * seeding from it would cut a 200ms segment off the front of every pull that opens on a stray cleave.
 * With nothing eligible at all the window is one segment, and dominance names it.
 */
function cutsIn(runs: readonly ModeRun[], from: number, to: number, floorMs: number): Interval[] {
	const eligible = runs.filter((run) => run.end - run.start >= floorMs && run.contactMs > 0);
	const opening = eligible[0];
	if (opening === undefined) return [[from, to]];

	const starts = [from];
	let current: ContactMode = opening.mode;
	for (const run of eligible) {
		if (run.mode === current) continue;
		current = run.mode;
		if (run.start > (starts[starts.length - 1] ?? from)) starts.push(run.start);
	}
	return starts.map((start, i): Interval => [start, starts[i + 1] ?? to]);
}

/** The time-weighted median of a count ledger — the count the middle millisecond of the segment was at. */
function medianOf(msByCount: ReadonlyMap<number, number>, totalMs: number): number {
	const counts = [...msByCount.keys()].sort((a, b) => a - b);
	let seen = 0;
	for (const count of counts) {
		seen += msByCount.get(count) ?? 0;
		if (seen * 2 >= totalMs) return count;
	}
	return counts[counts.length - 1] ?? 0;
}

/**
 * One cut span, labelled by what actually held it.
 *
 * **Relabelled by dominance, not by the mode it entered in.** Hysteresis decides *where* the boundaries
 * are, which is a question about how long a regime lasted; what the section then *was* is a question
 * about its own contents, and the two answers are allowed to differ. A segment entered as `single`
 * because that was the first thing to hold eight seconds, and then spent 70% of its length at four
 * enemies, is an `aoe` section with a slow start — and labelling it `single` is how the earlier drafts
 * came to report Norushen as a 139s single-target section that is 35% single.
 */
function labelled(
	index: number,
	startMs: number,
	endMs: number,
	spans: readonly CountSpan[],
	idle: boolean,
	mixedShare: number,
): FightSegment {
	const totalMs = endMs - startMs;
	const byCount = new Map<number, number>();
	const byMode = new Map<ContactMode, number>();
	for (const span of spans) {
		const start = Math.max(span.start, startMs);
		const end = Math.min(span.end, endMs);
		if (end <= start) continue;
		byCount.set(span.count, (byCount.get(span.count) ?? 0) + (end - start));
		// Zero does not vote — see `FightSegment.dominance`. It is still in `byCount`, so the time is
		// published rather than lost; it simply belongs to no mode.
		if (span.count > 0) {
			const mode = modeOf(span.count);
			byMode.set(mode, (byMode.get(mode) ?? 0) + (end - start));
		}
	}

	// Ties broken towards the smaller count — `single` over `cleave` over `aoe`. A tie under a 0.70 share
	// is `mixed` either way, so this only decides which share `dominance` reports, and reporting the
	// stricter list's is the recoverable direction: erring towards judging too much can be argued with,
	// erring towards excusing cannot.
	const order: readonly ContactMode[] = ['single', 'cleave', 'aoe'];
	let winner: ContactMode = 'single';
	let winnerMs = -1;
	for (const mode of order) {
		const ms = byMode.get(mode) ?? 0;
		if (ms > winnerMs) {
			winner = mode;
			winnerMs = ms;
		}
	}

	const dominance = totalMs > 0 ? winnerMs / totalMs : 0;
	const bands = [
		...new Set([...byCount].filter(([count, ms]) => count > 0 && ms > 0).map(([count]) => bandOf(count))),
	].sort((a, b) => a - b);

	return {
		index,
		startMs,
		endMs,
		mode: idle ? 'idle' : dominance < mixedShare ? 'mixed' : winner,
		dominance: idle ? 1 : dominance,
		bands: idle ? [] : bands,
		medianEnemies: medianOf(byCount, totalMs),
		msByCount: Object.fromEntries(byCount),
	};
}

/**
 * The pull as an ordered timeline of sections, from its enemy count series alone.
 *
 * **Invariant, and it is a test rather than a comment: the segments partition `[0, durationMs]` exactly**
 * — no gaps, no overlaps, in order, on every input including an empty series. That is what makes every
 * downstream sum trustworthy, and it is the same property `exemptRows` already holds for the exempt track.
 *
 * Two levels, in this order:
 *
 *  1. **Downtime, from the contact clock.** A zero run longer than `contactGapMs - windowMs` is an `idle`
 *     segment. Downtime is cut at the contact gap and *not* at the mode floor, which is why Galakras comes
 *     out with 14s and 12s idle sections under an 8s floor: those are spans the contact clock already
 *     excludes from every graded denominator, so they are drawn to show the reader why a boundary is where
 *     it is rather than scored. A shorter zero run is not a section — it stays inside its neighbour.
 *  2. **Mode hysteresis inside each contact window**, then a dominance relabel. See `cutsIn` and
 *     `labelled`.
 *
 * Measured on Galakras, this derives the encounter's actual structure without being told what the fight
 * is — five add waves and two boss-alone phases, from a series of numbers.
 */
export function segmentPull(
	points: ReadonlyArray<readonly [number, number]>,
	durationMs: number,
	options: SegmentOptions,
): SegmentTimeline {
	const floorMs = options.floorMs ?? SEGMENT_FLOOR_MS;
	const mixedShare = options.mixedShare ?? SEGMENT_MIXED_SHARE;
	const idleOverMs = Math.max(0, options.contactGapMs - options.windowMs);

	const spans = spansOf(points, durationMs);
	if (durationMs <= 0) return { floorMs, segments: [] };

	// Merged before the length test, because two zero spans in a row are one silence the player sat
	// through. The series should not produce them — it records one point per change — but `spansOf`
	// prepends its own leading zero, and a series whose first point is itself a zero would otherwise be
	// two runs of five seconds where the player was idle for ten.
	const zeroRuns = mergeIntervals(
		spans.filter((span) => span.count === 0).map((span): Interval => [span.start, span.end]),
	);

	// A pull with no contact anywhere is idle whatever its length. Not a special case so much as the
	// absence of one: a short zero run is absorbed *into its neighbour*, and this run has no neighbour on
	// either side. Calling it `single` instead — which is what `modeOf(0)` would do — is precisely the
	// fault §3a exists to fix, and there is no dominance relabel that could rescue it.
	const allIdle = spans.every((span) => span.count === 0);
	const idleRuns = allIdle ? [[0, durationMs] as Interval] : zeroRuns.filter(([a, b]) => b - a > idleOverMs);

	const cuts: Array<{ span: Interval; idle: boolean }> = idleRuns.map((span) => ({ span, idle: true }));
	for (const [from, to] of complementOf(idleRuns, durationMs)) {
		for (const span of cutsIn(modeRunsIn(spans, from, to), from, to, floorMs)) cuts.push({ span, idle: false });
	}
	cuts.sort((a, b) => a.span[0] - b.span[0]);

	return {
		floorMs,
		segments: cuts.map(({ span: [start, end], idle }, index) => labelled(index, start, end, spans, idle, mixedShare)),
	};
}
