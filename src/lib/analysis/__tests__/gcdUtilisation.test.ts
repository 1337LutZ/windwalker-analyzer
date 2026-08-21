// The clock `gcdUtilisationPct` is measured against — and the four figures that deliberately stay on
// the other one.
//
// The defect this file exists for: the figure used to divide a numerator this engine rebuilds from
// *cast* events by `activeTime`, which is WarcraftLogs' own number off the damage table. Two
// independent estimates of how busy a player was, with no arithmetic relationship between them, so
// nothing bounded the ratio and it could exceed 100%. It never did on a committed fixture, but the
// headroom was luck rather than structure: on `phased` the two clocks sit 32.7 seconds apart, and
// pricing the twenty-three healing globals that pull spends off-rotation would have taken it to
// 97.93% against the old denominator and past 100% against nothing at all.
//
// Both halves now come from this pass. The denominator is `contact` — the player's own clock, the time
// they were in a position to press something — and the numerator is the occupied globals *clipped to
// that same clock*, which is what makes the bound structural rather than a clamp.
//
// It lives here rather than in either spec's test directory because the change is one clock in shared
// code and it moves both specs' graded numbers. A per-spec copy would pass while the other spec
// silently regressed, which is the argument `immuneTargets.test.ts` beside it makes at length.
//
// All fixtures are raw `FightDataset`s from anonymous (`a:`) reports, so `analyse` really runs.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isDamage } from '~/lib/events';
import type { Analysis, FightDataset } from '~/lib/types';
import { analyse as analyseElemental } from '~/specs/elemental/lib';
import { analyse as analyseWindwalker } from '~/specs/windwalker/lib';

const load = (path: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, path), 'utf8')) as FightDataset;

const WW = '../../../specs/windwalker/__fixtures__/dataset-ironJuggernaut.json';
const EL = (name: string): string => `../../../specs/elemental/__fixtures__/${name}.json`;

/**
 * The published contact clock, summed from the segments the analysis carries.
 *
 * Deliberately re-derived from `timeline.contactSegments` rather than read off some field beside the
 * percentage: the point of every assertion below is that the denominator *is* the clock the chart
 * shades, and a test that read one number twice would prove nothing about that.
 */
const contactMs = (a: Analysis): number => {
	const segments = a.timeline?.contactSegments;
	if (segments === undefined) throw new Error('analysis carries no contact segments');
	return segments.reduce((sum, [start, end]) => sum + (end - start), 0);
};

const pct = (n: number): number => +n.toFixed(2);

describe('gcdUtilisationPct is measured against the contact clock', () => {
	/**
	 * The pull the whole change is about, and the only committed fixture where the two clocks diverge
	 * far enough to tell them apart.
	 *
	 * The premise is asserted before the figure, so the pin cannot be satisfied by accident: WCL's
	 * `activeTime` and this engine's contact clock are 32 689 ms apart here, and 84.21% against the
	 * first is 94.08% against the second. The boss submerges from 142.3s to 192.5s and the player spends
	 * it healing, which is time they were in no position to press a Lightning Bolt — so it belongs in
	 * neither half of a figure about globals filled.
	 */
	it('reads the phased pull against contact and not against WarcraftLogs active time', () => {
		const el = analyseElemental(load(EL('phased')));
		expect(el.cpm.activeMs).toBe(239_246);
		expect(contactMs(el)).toBe(206_557);
		expect(el.cpm.activeMs - contactMs(el)).toBe(32_689);
		expect(pct(el.cpm.gcdUtilisationPct)).toBe(94.08);
	});

	/**
	 * The multi-target pull, where the two clocks are identical to the millisecond — so the only thing
	 * that can have moved this figure is the numerator.
	 *
	 * 90.81% before and 86.89% after, and the 10 254 ms of difference is double-counted occupancy the
	 * summed numerator could not see: two presses closer together than one effective global occupy the
	 * span between them once and were charged twice. A union of intervals charges it once.
	 */
	it('drops the occupancy a sum double-counted, on the pull where the clocks agree', () => {
		const el = analyseElemental(load(EL('cleave')));
		expect(el.cpm.activeMs).toBe(261_572);
		expect(contactMs(el)).toBe(261_572);
		expect(pct(el.cpm.gcdUtilisationPct)).toBe(86.89);
	});

	it('reads the single-target pull at 90.80', () => {
		const el = analyseElemental(load(EL('unbroken')));
		expect(contactMs(el)).toBe(181_775);
		expect(pct(el.cpm.gcdUtilisationPct)).toBe(90.8);
	});

	/** The other spec, on the same shared clock — this file's reason for not living under either. */
	it('reads the Windwalker pull at 88.55', () => {
		const ww = analyseWindwalker(load(WW));
		expect(contactMs(ww)).toBe(189_618);
		expect(pct(ww.cpm.gcdUtilisationPct)).toBe(88.55);
	});
});

/**
 * The bound, demonstrated rather than asserted.
 *
 * A ratio cannot be shown to be bounded by observing that it happens to be 94% on three pulls. So the
 * numerator is forced far past the denominator: `cleave`'s damage events are truncated at 60s while
 * every one of its 204 on-GCD presses is left in place. The contact clock collapses to the first
 * minute; the presses still occupy the best part of four.
 *
 * Three implementations give three different answers to this, which is what makes it a test:
 *
 *   - dividing by WarcraftLogs' `activeTime` — the old figure — is untouched by the cut, because
 *     `activeTime` comes off the damage *table* and the table is not what was edited. It reads ~87%
 *     and notices nothing.
 *   - dividing by contact with an unclipped numerator reads over 300%, which is not a percentage.
 *   - dividing by contact with the numerator clipped to it cannot exceed 100, and does not.
 */
describe('the ratio cannot exceed 100%, by construction rather than by clamp', () => {
	const full = analyseElemental(load(EL('cleave')));
	const CUT_AT = 60_000;

	const truncated = ((): Analysis => {
		const dataset = load(EL('cleave'));
		const t0 = dataset.fight.startTime;
		return analyseElemental({
			...dataset,
			// Damage only. Every cast, aura and resource event stays, so the presses this figure prices are
			// all still there and only the evidence of contact is removed.
			events: dataset.events.filter((e) => !isDamage(e) || e.timestamp - t0 <= CUT_AT),
		});
	})();

	it('collapses the contact clock without touching the presses or WarcraftLogs active time', () => {
		expect(contactMs(truncated)).toBeLessThan(CUT_AT + 5_000);
		expect(truncated.cpm.onGcdCasts).toBe(full.cpm.onGcdCasts);
		expect(truncated.cpm.activeMs).toBe(full.cpm.activeMs);
	});

	it('would read over 300% if the numerator were not clipped to the same clock', () => {
		// The occupancy the whole pull holds, recovered from the unedited analysis: its contact clock spans
		// the entire fight, so nothing is clipped out of it there and the product is the raw total.
		const occupiedMs = (full.cpm.gcdUtilisationPct / 100) * contactMs(full);
		expect(Math.round((occupiedMs / contactMs(truncated)) * 100)).toBeGreaterThan(300);
	});

	it('reads inside 100%, and gets there by arithmetic rather than by a clamp', () => {
		expect(truncated.cpm.gcdUtilisationPct).toBeLessThanOrEqual(100);
		// Not 100 exactly, which is the point: a clamp would have printed 100 and hidden the overflow. This
		// is the real measurement — the presses inside the surviving minute cover 93.17% of it, and the
		// three-and-a-half minutes of presses outside it are simply not in the numerator.
		expect(pct(truncated.cpm.gcdUtilisationPct)).toBe(93.17);
	});
});

/**
 * The four other readers of `activeMs`, and why each one stayed.
 *
 * The failure mode this change had to avoid is half the report moving to one clock and half staying on
 * the other, so the split is pinned here rather than left to be discovered. Only the figure that is a
 * *share of a bounded whole* moved. The rest are rates per active minute, or `activeMs` restated, and
 * each of them is reconstructed outside this engine by a file that reads `cpm.activeMs` directly —
 * `PaceTiles` divides `gcdSlots` by it, `CastsPerMinute` converts the per-ability rates back through
 * it, and `report.json`'s `casts.presses` prints it as the span the cast count was taken over. Moving
 * any of those three needs its component and its copy to move in the same change.
 */
describe('the readers that stay on WarcraftLogs active time', () => {
	const el = analyseElemental(load(EL('phased')));
	const ww = analyseWindwalker(load(WW));

	it('keeps activeMs published, which is the only remaining tie to the WarcraftLogs site', () => {
		expect(el.cpm.activeMs).toBe(239_246);
		expect(pct(el.cpm.activePct)).toBe(92.62);
		expect(pct((el.cpm.activeMs / el.durationMs) * 100)).toBe(92.62);
	});

	it('keeps totalCpm and gcdSlots on that clock too', () => {
		expect(pct(el.cpm.totalCpm)).toBe(39.88);
		expect(pct(el.cpm.onGcdCasts / (el.cpm.activeMs / 60_000))).toBe(39.88);
		expect(el.cpm.gcdSlots).toBe(211);
		expect(ww.cpm.gcdSlots).toBe(189);
		expect(pct(ww.cpm.totalCpm)).toBe(52.81);
	});

	/**
	 * The cast table's per-ability rates, against the headline they have to add up to.
	 *
	 * Two different code paths — `buildCastTable`'s own division and `totalCpm` — so this fails the
	 * moment one of them is moved to a different clock without the other. That is the exact shape of the
	 * regression this suite is here to make loud.
	 */
	it('keeps the cast table commensurable with the headline rate', () => {
		for (const a of [el, ww]) {
			const summed = a.casts.filter((row) => row.onGcd).reduce((sum, row) => sum + row.cpm, 0);
			expect(pct(summed)).toBe(pct(a.cpm.totalCpm));
		}
	});
});
