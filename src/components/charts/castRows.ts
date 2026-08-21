// Which row each press icon sits on, and the instant it is measured from.
//
// Its own module rather than four helpers inside `CastTimeline`: a component module has to export
// nothing but components for React Fast Refresh to hot-swap it — the same rule `tones.ts` is a module
// for — and the packing rule below is a claim about the game's own timing that a test has to be able
// to ask at a zoom the rendered chart never reaches. `targetLanes.ts` and `timelineOrder.ts` are the
// two nearest neighbours of this shape.

import { GCD_MIN_MS } from '~/lib/analysis/analyseCore';
import type { CastMark } from '~/lib/types';

/**
 * The icon box for a press. One size for every mark, deliberately.
 *
 * Off-GCD presses used to be drawn smaller, so that a brew or a trinket could not be mistaken for a
 * global that was spent. That distinction was carrying real weight while every press shared one row
 * — and none once the presses were grouped into a lane per ability, because the lane's own label
 * already says which button it is. All it did then was make some rows shorter than others and leave
 * auto-attacks looking like a rendering fault.
 */
export const GCD_ICON_PX = 24;

/** Clear air between two icons on the same row, so neighbours read as two marks rather than one. */
const ICON_GUTTER_PX = 3;

/**
 * How much two icons may overlap before they are considered to collide.
 *
 * An icon is exactly one global wide at the default zoom, and consecutive presses land 990–1000ms
 * apart — so two ordinary Blackout Kicks overlapped by a quarter of a pixel and the packer opened a
 * second row for the whole lane. A lane drawn two rows tall reads as two different things happening,
 * which is a much bigger lie than a hairline of overlap.
 *
 * `RESERVATION_CAP_MS` now covers that case outright, and at every rung rather than at one. This still
 * binds at the tightest rung, where an icon covers half a global and the cap never reaches: 48px/s puts
 * 500ms under an icon against 562ms without the tolerance, which is the difference between admitting a
 * sub-global pair and splitting it. Kept for that, not for the case above.
 */
const OVERLAP_TOLERANCE_PX = 4;

/**
 * How many rows the cast lane may grow to before it stops stacking.
 *
 * A press is an instant, so two of them at the same moment have nowhere to go but upwards, and past
 * some number of simultaneous presses a lane taller than the viewport stops being a reading. Beyond
 * this the least-crowded row takes the mark and the two overlap, which is the honest failure: the
 * reader can see it is crowded and zoom in, which is what the ladder is for.
 *
 * It used to bind at the wide end of the ladder as well, where an icon covered several globals and a
 * whole pull's worth of ordinary filler presses collided. `RESERVATION_CAP_MS` is what stops that, so
 * what is left here is genuinely simultaneous presses — a Chi Brew's two charges, a press stamped on
 * the millisecond of another.
 */
const MAX_CAST_ROWS = 5;

/**
 * The most track one icon may reserve, whatever the zoom: one global, less the log's own jitter.
 *
 * **The unit was the defect.** The reservation above is an icon width in *pixels* converted into
 * milliseconds, so whether two presses one global apart collided depended on the zoom rung — and a
 * rung is not a fact about the rotation. Moving the packer onto the commit instant fixed most of it and
 * left nine milliseconds of margin: the closest pair of Lightning Bolt commits on the committed pulls
 * is 967ms against an icon covering 958ms at the default zoom. Any pair tighter than that split its
 * lane in two, and every rung wider than the default has an icon covering *more* than a global — two
 * seconds at 12px/s, nearly eight at 3px/s — so out there whole lanes split by construction. Measured
 * before this cap: `cleave`'s Chain Lightning drew 6, 4 and 2 rows at 3, 6 and 12px/s, and `strong`'s
 * Blackout Kick 5, 3 and 2.
 *
 * With the reservation capped at a global the collision test can no longer exceed the spacing the game
 * guarantees, so two presses a global apart share a row **at every rung, by construction**. What
 * happens instead at the wide end is that the icons overlap, which is the failure this function
 * already argues for everywhere else: overlap says the marks are closer together than the zoom can
 * draw, which is exactly true, and a second row says two separate things were going on, which is not.
 *
 * **The bound is the *floor*, not the pull's own median, and that is measured rather than assumed.**
 * `cpm`'s `effectiveGcd` is the obvious candidate and it does not work: it is a median of observed
 * gaps, so on a pull with raid haste it over-states the real global — the Elemental's reads ~1 124ms —
 * and a cap of 1 124 is above every gap that was splitting a lane, leaving Chain Lightning at 2 rows
 * at three of the five rungs. Measured. What the game actually guarantees is the *hasted* floor, which
 * is `GCD_MIN_MS`, imported rather than restated because `analyseCore` already clamps `effectiveGcd`
 * to it and two copies of one number is how the two come to disagree.
 *
 * `GCD_JITTER_MS` is the slack under that floor, and it is a millisecond constant because the thing it
 * absorbs is measured in milliseconds. Across the nine committed pulls the tightest on-GCD
 * commit-to-commit gap is 967ms — 33ms under the floor — and the next fourteen run 973 to 991ms.
 * Fifty is the next round number past the worst of them, and it is a twentieth of a global, so it
 * cannot let two presses a global apart overlap by more than a hairline. Deliberately **not**
 * `SELF_EVENT_MS`, which answers a different question — how long after a press its own aura events
 * arrive — and would then be unable to move without moving this.
 */
const GCD_JITTER_MS = 50;
const RESERVATION_CAP_MS = GCD_MIN_MS - GCD_JITTER_MS;

/**
 * The instant a mark is *drawn* at: the press's commit, not its landing.
 *
 * One function because three readers need the same answer and had two. `castNodesOf` has always drawn
 * the icon and the cast bar from here — the press's moment is the start of the cast, and the bar that
 * follows it is the cast — while `packCasts` reserved track from `t` and `gcdRulesPath` ruled at `t`,
 * both of them the landing. One disagreement, two symptoms, and neither is a rounding difference on a
 * spec with cast times:
 *
 * - The rule for a two-second Lightning Bolt stood two seconds to the right of its own icon.
 * - The packer was not measuring the thing it was laying out. A completed cast lands at the same
 *   instant the *next* press's cancelled begincast is logged, because a cancel's `t` **is** its
 *   begincast — measured on `unbroken`, a landing at 156 530 against a cancel at 156 531, 1ms apart
 *   and well inside an icon, so the lane grew a second row. Their commits are 1 522ms apart and never
 *   collided. On the three Elemental pulls at the default zoom this was splitting Lightning Bolt,
 *   Lava Burst, Chain Lightning and Lava Beam.
 *
 * **A cancel keeps its `t`, and that is the data rather than a special case.** A cancelled mark is
 * built straight from the `begincast` no `cast` ever completed, so its `t` already is the commit — and
 * its `castTimeMs` is the *median* of that button's completed casts, an estimate for drawing the bar
 * the reader lost. Back-computing through it would move the press by a number no log ever measured.
 *
 * Derived rather than read off `CastMark.begin`, which names this instant and is the obvious source.
 * `begin` is absent on exactly the mark that caused the bug, and absent again on any analysis stored
 * before the field existed — where the icon is still drawn from `castTimeMs`. Computing what is drawn
 * is what makes the three unable to disagree; it equals `begin` on every mark that carries one.
 */
export const commitOf = (c: CastMark): number => (c.cancelled === true ? c.t : c.t - (c.castTimeMs ?? 0));

/**
 * Which row each press sits on, so that no two icons overlap.
 *
 * Marks are placed as percentages of the pull, but whether two of them *collide* is a question about
 * pixels: the same two casts 400ms apart are clear of each other at 48px/s and on top of each other
 * at 3px/s. So the packing is recomputed per zoom, converting each icon's half-width back into the
 * milliseconds it covers at the current scale.
 *
 * Greedy, in time order, first row that has room — which gives simultaneous presses their own rows
 * (the case that is not a matter of degree: two casts on the same timestamp can never share a row)
 * while keeping a quiet stretch of the pull on a single line.
 *
 * **A lane whose presses cost no global never stacks.** An icon is drawn one global wide, so the
 * packer charges every mark a global's worth of track — and that width is a claim about a *press*,
 * which occupies the global it starts. A swing occupies nothing: auto-attacks land on the weapon's
 * own timer, right through the globals the player is spending, and a dual-wielding monk lands two of
 * them in the same millisecond. Measured on the committed pulls, melee arrives every ~800ms against
 * an icon that covers ~960ms at the default zoom, so *every consecutive pair collides* and the greedy
 * fit opened a new row for each — four rows on `weave`, three on `mixed` and `waves`, and five at the
 * two widest rungs of the ladder on all six. A monk carries one two-hander or two one-handers, so
 * four melee rows is not a thing that can happen, and the reader was being shown one.
 *
 * Overlapping icons is the right failure here and stacking was the wrong one. A second row says two
 * separate things were going on; overlap says the marks are closer together than the zoom can draw,
 * which is exactly true and is what the ladder is for. Read off `onGcd` rather than off melee's id,
 * because the argument is about globals rather than about auto-attacks: it settles a Chi Brew's two
 * charges and a burst of Healing Spheres the same way, and neither of those is two rows either.
 *
 * That argument is why the reservation is **capped at a global** — see `RESERVATION_CAP_MS`. It applies
 * to a lane of presses just as much as to a lane of swings: whether two presses one global apart share
 * a row was a question about the zoom rung, and the rung is not a fact about the rotation.
 */

export function packCasts(
	casts: readonly CastMark[],
	pxPerSec: number,
): { rows: number; rowOf: Map<CastMark, number> } {
	if (casts.every((c) => !c.onGcd)) return { rows: 1, rowOf: new Map(casts.map((c) => [c, 0])) };
	const msPerPx = 1000 / pxPerSec;
	const rowOf = new Map<CastMark, number>();
	// The moment each row is free again, in fight time.
	const freeAt: number[] = [];

	// An icon starts at the commit and runs rightwards, so it occupies `[commit, commit + its own
	// width]`, less the slack that keeps a hairline of overlap from splitting a lane in two — **and
	// never more than a global, whatever the zoom.** See `RESERVATION_CAP_MS`.
	const widthMs = Math.min(
		Math.max(0, GCD_ICON_PX + ICON_GUTTER_PX - OVERLAP_TOLERANCE_PX) * msPerPx,
		RESERVATION_CAP_MS,
	);

	// Sorted by the same instant it packs on: the greedy fit only holds if rows are visited in
	// non-decreasing order of the key being compared, and a late-landing early-committed press would
	// otherwise be visited out of order.
	for (const c of [...casts].sort((a, b) => commitOf(a) - commitOf(b))) {
		const at = commitOf(c);
		let row = freeAt.findIndex((free) => at >= free);
		if (row === -1) {
			if (freeAt.length < MAX_CAST_ROWS) {
				row = freeAt.length;
			} else {
				// Every row is busy. The one that has been busy longest is the least bad place to overlap.
				row = freeAt.reduce((best, free, i) => (free < (freeAt[best] ?? Infinity) ? i : best), 0);
			}
		}
		freeAt[row] = at + widthMs;
		rowOf.set(c, row);
	}

	return { rows: Math.max(1, freeAt.length), rowOf };
}
