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
	it('keeps its AoE cut off the two pulls that never reach three enemies', () => {
		// Not vacuous: both have real overcap to lose, and the AoE cut takes none of it.
		//
		// **These figures moved once, on the Ascendance cut and not on this one.** `phased` fell from
		// 17 568ms to 12 352ms because the shock is not to be pressed inside Ascendance, so the fifteen
		// seconds at the ceiling that the hold produces left the clock. `unbroken`'s 4 514 is unmoved: its
		// only Ascendance window is the opener, where the shield has not reached the ceiling yet.
		expect(load('phased').lightningShield.overcapMs).toBe(12_352);
		expect(load('unbroken').lightningShield.overcapMs).toBe(4514);
		for (const name of ['phased', 'unbroken'] as const) {
			expect(load(name).lightningShield.exemptWindows).toEqual([]);
			expect(load(name).targets?.counts?.max).toBe(1);
		}
	});

	it('drops the AoE stretches on the multi-target pull', () => {
		const cleave = load('cleave');
		// 119 313ms before this clock existed — so **88% of the old figure was time the list did not ask the
		// player to spend the shield in**. The exempt stretches are 129 456ms of a 263 233ms pull, just under
		// half of it, and they still carry most of the fault.
		//
		// **Four stretches and not seven, since the exemption moved from the raw three-or-more count onto
		// the pull's own segments.** The count crosses three and back inside a single add wave, so it read
		// the wave as several exempt pieces with graded holes between them; the segmentation reads one
		// stretch, and the holes were the part of this clock that charged a player for the list they were
		// actually running. The trailing-edge trim `fbc4963` added survived the move — `exemptFrom` applies
		// it to each merged stretch — so none of this hands back the window of boss-only time that fix
		// removed.
		expect(cleave.lightningShield.overcapMs).toBe(14_275);
		expect(ms(cleave.lightningShield.exemptWindows)).toBe(129_456);
		expect(cleave.lightningShield.exemptWindows).toHaveLength(4);
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
		const { leewayMs, exemptWindows, overcapWindows } = cleave.lightningShield;
		expect(leewayMs).toBe(5000);
		const exemptCloses = new Set(exemptWindows.map((w) => w.end));
		const graceRestarted = overcapWindows.filter((w) => exemptCloses.has(w.start - leewayMs));
		const graceAlreadySpent = overcapWindows.filter((w) => exemptCloses.has(w.start));
		// **Nought, and it was three while the exemption was the raw count.** That reading cut each add wave
		// into several exempt pieces, so the shield came back over the ceiling a leeway after a boundary
		// three times on this pull alone; the segmentation reads one stretch per wave, and no committed pull
		// now puts an overcap window exactly one leeway past an exempt close. Pinned at nought rather than
		// deleted: this line goes red the day a fixture exercises the positive case again, which is when the
		// count belongs back in it.
		expect(graceRestarted).toHaveLength(0);
		// The rejected form's own signature, and it must be absent: a graded window opening flush against a
		// boundary is a stretch that crossed one and was charged from the first millisecond of the far side.
		// Widened to all four pulls now that the positive half above is empty, so this case still carries a
		// falsifiable claim rather than two zeroes.
		expect(graceAlreadySpent).toEqual([]);
		for (const name of ['addsThenBoss', 'phased', 'unbroken'] as const) {
			const other = load(name).lightningShield;
			const closes = new Set(other.exemptWindows.map((w) => w.end));
			expect(
				other.overcapWindows.filter((w) => closes.has(w.start)),
				name,
			).toEqual([]);
		}
	});

	it('keeps falling off graded on every band, because the shield is a mana engine', () => {
		// Rolling Thunder returns 2% of maximum mana per charge and only while the buff is up, so keeping it
		// up is right at any target count. `cleave` drops it once and that stays a fault even though much of
		// the pull is exempt from the *overcap* clock — the two halves of one aura on two clocks, which is
		// the thing a reader would otherwise read as a bug.
		const cleave = load('cleave');
		expect(cleave.lightningShield.fellOff).toBe(1);
		// Just under half the pull is exempt from the overcap clock and none of it is exempt from this one.
		// Was just under a third while the exemption was the raw three-or-more count; the bounds moved with
		// it and the point did not — the gap between the two clocks is what this case is about, not its size.
		const exemptShare = ms(cleave.lightningShield.exemptWindows) / cleave.durationMs;
		expect(exemptShare).toBeGreaterThan(0.45);
		expect(exemptShare).toBeLessThan(0.55);
	});

	it('publishes the exempt array rather than leaving the chart to re-derive it', () => {
		// The identity `exemptTrack.test.ts` was written to enforce: the greyed row is the same array the
		// denominator dropped. Checked by construction — every exempt window must be absent from the graded
		// overcap windows.
		const cleave = load('cleave');
		for (const exempt of cleave.lightningShield.exemptWindows) {
			for (const graded of cleave.lightningShield.overcapWindows) {
				const overlap = Math.min(graded.end, exempt.end) - Math.max(graded.start, exempt.start);
				expect(overlap).toBeLessThanOrEqual(0);
			}
		}
		expect(cleave.lightningShield.overcapWindows.length).toBeGreaterThan(0);
	});
});
