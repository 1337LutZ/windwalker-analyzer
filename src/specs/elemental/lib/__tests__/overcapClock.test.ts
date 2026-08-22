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
		expect(load('phased').lightningShield.overcapMs).toBe(40_441);
		expect(load('unbroken').lightningShield.overcapMs).toBe(23_387);
		for (const name of ['phased', 'unbroken'] as const) {
			expect(load(name).lightningShield.aoeWindows).toEqual([]);
			expect(load(name).targets?.counts?.max).toBe(1);
		}
	});

	it('drops the AoE stretches on the multi-target pull', () => {
		const cleave = load('cleave');
		// 119 313ms before this clock existed — so **76% of the old figure was time the list did not ask the
		// player to spend the shield in**. The exempt stretches are 109 869ms of a 263 233ms pull, a little
		// over 40%, and they carried nearly all of the fault.
		expect(cleave.lightningShield.overcapMs).toBe(28_625);
		expect(ms(cleave.lightningShield.aoeWindows)).toBe(109_869);
		expect(cleave.lightningShield.aoeWindows).toHaveLength(8);
	});

	it('restarts the grace at each boundary rather than subtracting afterwards', () => {
		// The difference between the two readings is exactly one leeway per boundary that a capped stretch
		// spans — 4 500ms across three of `cleave`'s seven. Asserted as the *gap* rather than by
		// reimplementing the rejected form, so this cannot drift into testing its own arithmetic.
		const cleave = load('cleave');
		expect(cleave.lightningShield.leewayMs).toBe(1500);
		// Subtract-after measures 33 125ms; the segmented clock measures 28 625ms.
		expect(33_125 - cleave.lightningShield.overcapMs).toBe(3 * cleave.lightningShield.leewayMs);
	});

	it('keeps falling off graded on every band, because the shield is a mana engine', () => {
		// Rolling Thunder returns 2% of maximum mana per charge and only while the buff is up, so keeping it
		// up is right at any target count. `cleave` drops it once and that stays a fault even though most of
		// the pull is exempt from the *overcap* clock — the two halves of one aura on two clocks, which is
		// the thing a reader would otherwise read as a bug.
		const cleave = load('cleave');
		expect(cleave.lightningShield.fellOff).toBe(1);
		// Two fifths of the pull is exempt from the overcap clock and none of it is exempt from this one.
		const exemptShare = ms(cleave.lightningShield.aoeWindows) / cleave.durationMs;
		expect(exemptShare).toBeGreaterThan(0.4);
		expect(exemptShare).toBeLessThan(0.5);
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
