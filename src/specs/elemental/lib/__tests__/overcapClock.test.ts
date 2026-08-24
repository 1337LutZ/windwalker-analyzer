// The overcap figure is graded on the pull less its AoE stretches, and the chart greys the same array.
//
// `aoe.apl.json` has **no Earth Shock rung at all**, so from three enemies up there is nothing to spend the
// shield into and sitting at seven is the only state available. Charging it was faulting a player for the one
// state the list leaves them. Two enemies stays graded, because the cleave list does spend the shield — at six
// stacks rather than seven — so exempting band 2 would excuse a pull from a list that is *stricter*.
//
// The second claim is the subtle one and it is why `atCapWindowsIn` exists: the leeway comes off the **front**
// of each merged stretch, so subtracting the AoE windows afterwards would leave a stretch that began during
// the adds arriving at the boundary with its grace already spent — faulted from the first millisecond of
// single-target play, once per swap back.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '~/specs/elemental/lib';

const load = (name: string): Analysis & ElementalAuditResult =>
	analyse(
		JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset,
	) as Analysis & ElementalAuditResult;

const ms = (windows: ReadonlyArray<{ start: number; end: number }>) =>
	windows.reduce((total, w) => total + (w.end - w.start), 0);

describe('the shield overcap clock', () => {
	it('is untouched on the two pulls that never reach three enemies', () => {
		// Not vacuous: both have real overcap to lose, and they keep all of it.
		expect(load('phased').lightningShield.overcapMs).toBe(17_568);
		expect(load('unbroken').lightningShield.overcapMs).toBe(4514);
		for (const name of ['phased', 'unbroken'] as const) {
			expect(load(name).lightningShield.aoeWindows).toEqual([]);
			expect(load(name).targets?.counts?.max).toBe(1);
		}
	});

	it('drops the AoE stretches on the multi-target pull', () => {
		const cleave = load('cleave');
		// 119 313ms before this clock existed — so **65% of the old figure was time the list did not ask the
		// player to spend the shield in**. The exempt stretches are 82 858ms of a 263 233ms pull, a little
		// under a third, and they still carry most of the fault.
		//
		// All three numbers moved with the trailing-edge trim, and every one of them in the direction that
		// forgives *less*: the exemption used to read 109 869ms over eight stretches and left the overcap at
		// 28 625ms. A stretch closed by the count falling closed a full 5 000ms window past the last hit
		// that made it, so a window of boss-only time was handed back at the end of every add wave — 28
		// 378ms of the old total was time after the last hit any add in its stretch ever took.
		// `analyseCore`'s `aoeWindows` now cuts that tail to one measured global, and
		// `targetTails.test.ts` derives the 27 011ms that removes and reproduces this array from the
		// fixture's raw damage rows.
		expect(cleave.lightningShield.overcapMs).toBe(21_864);
		expect(ms(cleave.lightningShield.aoeWindows)).toBe(82_858);
		expect(cleave.lightningShield.aoeWindows).toHaveLength(7);
	});

	/**
	 * The property, re-derived off the two published arrays rather than off a number the rejected form
	 * produced.
	 *
	 * It used to read `33_125 - overcapMs === 3 * leewayMs`, where 33 125 was the subtract-after
	 * measurement recorded by hand. The trim moves both sides *and* the boundary count, and renumbering
	 * two hardcoded figures would have passed while proving nothing — so the assertion is now the
	 * behaviour's own **signature**, which needs no number from an implementation that does not exist.
	 *
	 * The grace comes off the **front** of each merged capped stretch. So a stretch that continues across
	 * a regime boundary shows up, under the segmented clock, as a graded window opening exactly one leeway
	 * *after* an exempt stretch closed — the grace being taken again on the far side. Subtract-after gives
	 * the opposite shape: that stretch arrives at the boundary with its grace already spent, and its
	 * graded piece opens **at** the boundary. One of those two sets is non-empty and the other is empty,
	 * whichever clock is running, and the count of the first is exactly how many extra leeways the
	 * segmented reading forgives.
	 *
	 * Four boundaries now, where the old series had three: the trim moved six closes earlier, and a capped
	 * stretch that used to sit wholly inside an exempt tail now straddles the boundary the tail's removal
	 * created. Read off the pull rather than asserted as a bare 4 — the `toBe` below is the count the
	 * signature finds, and the empty set beside it is the contrast guard.
	 */
	it('restarts the grace at each boundary rather than subtracting afterwards', () => {
		const cleave = load('cleave');
		const { leewayMs, aoeWindows, overcapWindows } = cleave.lightningShield;
		expect(leewayMs).toBe(5000);
		const exemptCloses = new Set(aoeWindows.map((w) => w.end));
		const graceRestarted = overcapWindows.filter((w) => exemptCloses.has(w.start - leewayMs));
		const graceAlreadySpent = overcapWindows.filter((w) => exemptCloses.has(w.start));
		expect(graceRestarted).toHaveLength(3);
		// The rejected form's own signature, and it must be absent: a graded window opening flush against a
		// boundary is a stretch that crossed one and was charged from the first millisecond of the far side.
		expect(graceAlreadySpent).toEqual([]);
	});

	it('keeps falling off graded on every band, because the shield is a mana engine', () => {
		// Rolling Thunder returns 2% of maximum mana per charge and only while the buff is up, so keeping it
		// up is right at any target count. `cleave` drops it once and that stays a fault even though much of
		// the pull is exempt from the *overcap* clock — the two halves of one aura on two clocks, which is
		// the thing a reader would otherwise read as a bug.
		const cleave = load('cleave');
		expect(cleave.lightningShield.fellOff).toBe(1);
		// Just under a third of the pull is exempt from the overcap clock and none of it is exempt from this
		// one. Was two fifths before the trailing-edge trim; the bounds moved with it and the point did not
		// — the gap between the two clocks is what this case is about, not its size.
		const exemptShare = ms(cleave.lightningShield.aoeWindows) / cleave.durationMs;
		expect(exemptShare).toBeGreaterThan(0.3);
		expect(exemptShare).toBeLessThan(0.35);
	});

	it('publishes the exempt array rather than leaving the chart to re-derive it', () => {
		// The identity `exemptTrack.test.ts` was written to enforce: the greyed row is the same array the
		// denominator dropped. Checked by construction — every exempt window must be absent from the graded
		// overcap windows.
		const cleave = load('cleave');
		for (const exempt of cleave.lightningShield.aoeWindows) {
			for (const graded of cleave.lightningShield.overcapWindows) {
				const overlap = Math.min(graded.end, exempt.end) - Math.max(graded.start, exempt.start);
				expect(overlap).toBeLessThanOrEqual(0);
			}
		}
		expect(cleave.lightningShield.overcapWindows.length).toBeGreaterThan(0);
	});
});
