// How much track one press icon reserves, and the unit that decides it.
//
// The user's report: "Chain Lightning seems to sometimes split onto multiple rows". A lane drawn two
// rows tall says two separate things were going on, and a rotation filler pressed once per global is
// one thing — so the split is a lie about the pull, and it was a lie the *zoom* decided.
//
// `packCasts` reserved `GCD_ICON_PX + ICON_GUTTER_PX - OVERLAP_TOLERANCE_PX` **pixels**, converted into
// milliseconds at the current scale. At the default rung that is 958ms, which clears a global with nine
// milliseconds to spare; every rung wider than the default reserves *more* than a global — 1 917ms at
// 12px/s, 7 667ms at 3px/s — so out there a lane of ordinary filler presses splits by construction.
// Measured over the nine committed pulls before the cap: `cleave`'s Chain Lightning drew 5, 4 and 2 rows
// at 3, 6 and 12px/s and `strong`'s Blackout Kick 5, 3 and 2. After it, every lane on all nine pulls is
// one row at all five rungs.
//
// These are unit tests over the packer rather than renders, and that is the point of the module: the
// chart only ever renders at `DEFAULT_ZOOM`, so a render test cannot reach the rungs where the defect
// lives.
import { describe, expect, it } from 'vitest';

import { GCD_MIN_MS } from '~/lib/analysis/analyseCore';
import type { CastMark } from '~/lib/types';
import { GCD_ICON_PX, packCasts } from '../castRows';
import { DEFAULT_ZOOM, ZOOM_LADDER } from '../scroll';

const DEFAULT_PX = ZOOM_LADDER[DEFAULT_ZOOM]!;
/** The widest rung — the fewest pixels per second, so the most milliseconds under one icon. */
const WIDEST_PX = ZOOM_LADDER[0]!;

/** An instant on-GCD press, so `commitOf` is its own timestamp and the commits are the numbers below. */
const press = (t: number, onGcd = true): CastMark => ({ t, id: 403, name: 'Chain Lightning', onGcd });

/** How many rows the lane needed, which is the whole of what this function decides. */
const rows = (casts: readonly CastMark[], pxPerSec: number): number => packCasts(casts, pxPerSec).rows;

describe('a lane of presses one global apart', () => {
	/**
	 * The claim, at both ends of the ladder: a global's spacing is enough, whatever the zoom.
	 *
	 * Two milliseconds under a global rather than exactly one, because the log does not stamp the game's
	 * own bound exactly — see the jitter allowance — and a test written on the exact boundary would pass
	 * on arithmetic that happens to be inclusive rather than on the rule being right.
	 */
	it.each(ZOOM_LADDER)('shares one row at %dpx/s', (pxPerSec) => {
		const lane = Array.from({ length: 40 }, (_, i) => press(i * (GCD_MIN_MS - 2)));
		expect(rows(lane, pxPerSec)).toBe(1);
	});

	/**
	 * And the pair on its own, at the widest rung, which is the case the old code could not do.
	 *
	 * At 3px/s an icon covers 7 667ms — eight globals — so the pixel-width reservation put these two
	 * presses eight rows apart in intent and two rows apart in practice. Revert the `Math.min` and this
	 * reads 2.
	 */
	it('shares one row at the widest rung, where an icon covers eight globals', () => {
		const pair = [press(0), press(GCD_MIN_MS - 2)];
		expect((GCD_ICON_PX / WIDEST_PX) * 1000).toBeGreaterThan(GCD_MIN_MS * 5);
		expect(rows(pair, WIDEST_PX)).toBe(1);
		expect(rows(pair, DEFAULT_PX)).toBe(1);
	});

	/**
	 * The jitter the allowance is there for, measured rather than assumed: the tightest on-GCD
	 * commit-to-commit gap across the nine committed pulls is 967ms, 33ms under the floor, and the next
	 * fourteen run 973 to 991ms. All of them have to share a row, at every rung.
	 */
	it.each([967, 973, 979, 985, 991])('shares one row at a gap of %dms, at every rung', (gap) => {
		const pair = [press(0), press(gap)];
		for (const pxPerSec of ZOOM_LADDER) expect(rows(pair, pxPerSec), `${gap}ms @ ${pxPerSec}px/s`).toBe(1);
	});
});

describe('a lane of presses closer together than a global', () => {
	/**
	 * The cap is a ceiling on the reservation and not a replacement for it, so two presses genuinely on
	 * top of each other still stack — which is the one collision that is not a matter of degree.
	 */
	it('stacks two presses on the same instant', () => {
		expect(rows([press(0), press(0)], DEFAULT_PX)).toBe(2);
		expect(rows([press(0), press(0)], WIDEST_PX)).toBe(2);
	});

	/** And a gap the game cannot have produced still reads as two things, at the zoom that can draw it. */
	it('stacks a pair half a global apart', () => {
		expect(rows([press(0), press(GCD_MIN_MS / 2)], DEFAULT_PX)).toBe(2);
	});

	/**
	 * The ceiling on the stacking, unchanged: past it the least-crowded row takes the mark and the two
	 * overlap, because a lane taller than the viewport is not a reading either.
	 */
	it('stops stacking at the cap rather than growing without one', () => {
		const pile = Array.from({ length: 30 }, () => press(0));
		expect(rows(pile, DEFAULT_PX)).toBe(5);
	});

	/** A lane whose presses cost no global never stacks at all — the swings rule, untouched. */
	it('never stacks a lane of presses that cost no global', () => {
		const swings = Array.from({ length: 40 }, (_, i) => press(i * 800, false));
		for (const pxPerSec of ZOOM_LADDER) expect(rows(swings, pxPerSec), `${pxPerSec}px/s`).toBe(1);
	});
});
