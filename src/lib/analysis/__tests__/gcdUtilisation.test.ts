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
import { describe, expect, it, vi } from 'vitest';

import { GCD_MIN_MS } from '~/lib/analysis/analyseCore';
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
	 *
	 * **87.32 since the Flame Shock snapshot rule landed, and the denominator did not move again.** The
	 * numerator subtracts `wastedGcds * effectiveGcd`, and one of this pull's two early refreshes turned
	 * out to snapshot a dot 42.7% stronger per millisecond — a press the priority list wants — so it is
	 * no longer charged as a wasted global. One global's worth of occupancy came back, on both fixtures
	 * below as well. Not a re-grade anywhere: the band is `good` at 80.
	 */
	it('drops the occupancy a sum double-counted, on the pull where the clocks agree', () => {
		const el = analyseElemental(load(EL('cleave')));
		expect(el.cpm.activeMs).toBe(261_572);
		expect(contactMs(el)).toBe(261_572);
		expect(pct(el.cpm.gcdUtilisationPct)).toBe(87.32);
	});

	/**
	 * The mechanism plan §44 records the user suspecting — a sub-second cast charged less than a global —
	 * measured on the pull it was reported from, and refuted.
	 *
	 * 62 of `cleave`'s 158 measured casts complete inside that pull's own global, 31 of them Chain
	 * Lightnings at 856–1 157ms. Occupancy is `max(effectiveGcd, duration)`, so every one of them is
	 * charged in full — and the pin above is what falls if that stops being true. Measured on an isolated
	 * copy: charging the measured cast length instead reads **cleave 87.32 → 83.82, phased 94.08 → 93.37,
	 * unbroken 91.94 → 90.39, and the Windwalker unmoved at 88.55**, which is §36's finding (it recorded
	 * 3.66pp against the old `activeTime` denominator; it is 3.50pp against contact). So the assertions
	 * here are no-change guards on the *inputs* that figure moves with — how many presses are fast enough
	 * for the question to arise, and the size of the global they are charged against. The lines those
	 * presses draw are pinned in `components/charts/__tests__/gcdRules.test.ts`, which is the half of §44
	 * the user could see.
	 *
	 * **And the floor is not what is doing the work on this pull**, which is worth pinning because it is
	 * what a reader assumes. `effectiveGcd` is the measured median gap, floored at `GCD_MIN_MS` and
	 * capped at the spec's own 1 500: here it lands between 1 122.6 and 1 127.5ms — bracketed by the
	 * published slot count, since `gcdSlots` is `floor(activeMs / effectiveGcd)` — so a 856ms Chain
	 * Lightning is charged the ~1 127ms global this player was playing on and not the 1 000ms floor.
	 * The floor binds on the Windwalker instead, whose declared global *is* 1 000 and whose whole bar is
	 * instant: 167 on-GCD presses on that fixture and not one measured cast, which is why no rule about
	 * cast length can move that spec.
	 */
	it('charges a full global for a cast that finished inside one', () => {
		const el = analyseElemental(load(EL('cleave')));
		const measured = (el.timeline?.casts ?? []).filter((c) => c.onGcd && c.castTimeMs !== undefined);
		const inside = measured.filter((c) => (c.castTimeMs ?? 0) < GCD_MIN_MS);
		expect(measured.length).toBe(158); // no-change guard
		expect(inside.length).toBe(62); // no-change guard
		expect(inside.filter((c) => c.id === 421).length).toBe(31); // no-change guard: Chain Lightning
		expect(el.cpm.gcdSlots).toBe(232);
		expect(+(el.cpm.activeMs / el.cpm.gcdSlots).toFixed(1)).toBe(1127.5);
		expect(el.cpm.activeMs / (el.cpm.gcdSlots + 1)).toBeGreaterThan(GCD_MIN_MS);

		const ww = analyseWindwalker(load(WW));
		expect((ww.timeline?.casts ?? []).filter((c) => c.castTimeMs !== undefined)).toEqual([]);
		expect((ww.timeline?.casts ?? []).filter((c) => c.onGcd).length).toBe(167);
	});

	/** 90.80 until two of this pull's four early refreshes were found to be the list's own play. */
	it('reads the single-target pull at 91.94', () => {
		const el = analyseElemental(load(EL('unbroken')));
		expect(contactMs(el)).toBe(181_775);
		expect(pct(el.cpm.gcdUtilisationPct)).toBe(91.94);
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
		// is the real measurement — the presses inside the surviving minute cover 95.10% of it, and the
		// three-and-a-half minutes of presses outside it are simply not in the numerator. It read 93.17
		// before the Flame Shock snapshot rule stopped charging this pull's refresh at 29 777 as waste;
		// that press is inside the surviving minute, so its global comes back into this numerator too.
		expect(pct(truncated.cpm.gcdUtilisationPct)).toBe(95.1);
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

/**
 * `activePct`, and why it is the one figure that should stay on WarcraftLogs' clock.
 *
 * §44 left it as the last open box, on the reading that `activeMs / duration` is the same pairing of two
 * independently estimated clocks that `productiveMs / activeMs` was. Measured, it is not, and the repair
 * that reading implies would put three of these four fixtures over 100%.
 *
 * The two halves share an origin and a scale. `duration` is `fight.endTime - fight.startTime` off
 * `reportFights`; `activeTime` comes off `table(dataType: DamageDone, fightIDs: [$fightID])`, the same
 * fight window measured by the same party. The numerator is WarcraftLogs' measure of a sub-span of the
 * denominator's own span — the arithmetic relationship the GCD figure lacked — and this engine computes
 * neither half, so no amount of pricing more abilities can push it the way it was pushing the other one.
 *
 * What is left wrong is the sentence, not the sum, and the sentence is in `report.json`.
 */
describe('activePct stays on the pull length, and the obvious repair is the defect', () => {
	const raw = {
		phased: load(EL('phased')),
		cleave: load(EL('cleave')),
		unbroken: load(EL('unbroken')),
		iron: load(WW),
	};
	const analysed = {
		phased: analyseElemental(raw.phased),
		cleave: analyseElemental(raw.cleave),
		unbroken: analyseElemental(raw.unbroken),
		iron: analyseWindwalker(raw.iron),
	};

	/**
	 * The measurement the whole decision rests on: contact is *narrower* than WarcraftLogs' clock, so it
	 * cannot be the denominator of a numerator WarcraftLogs measured.
	 *
	 * This is the guard that goes red if someone repairs `activePct` the way §44's box reads, and it is
	 * deliberately expressed as the percentage that repair would print rather than as an inequality
	 * between the two millisecond figures — an inequality would still pass at 100.0001%.
	 */
	it('would print over 100% on three of four fixtures if the denominator moved to contact', () => {
		const against = (a: Analysis): number => pct((a.cpm.activeMs / contactMs(a)) * 100);
		expect(against(analysed.phased)).toBe(115.83);
		expect(against(analysed.unbroken)).toBe(100.83);
		expect(against(analysed.iron)).toBe(100.06);
		// The one pull where the two clocks agree to the millisecond, so it alone would survive the move.
		expect(against(analysed.cleave)).toBe(100);
		// Tied to the published field, so the counterfactual above is a guard rather than a note: this is
		// the line that falls if the denominator is ever moved onto that clock.
		for (const a of Object.values(analysed)) expect(a.cpm.activePct).toBeLessThanOrEqual(100);
	});

	/**
	 * What `activeTime` actually is, measured rather than taken from its name.
	 *
	 * On two of the four fixtures it equals the span from the player's first damage event to their last
	 * **to the millisecond**, and the span is built here from the raw event stream rather than from
	 * anything the analysis publishes, so the two sides of the assertion have no shared derivation. That
	 * makes it a presence clock: it does not shrink for a player who has stopped pressing things, as long
	 * as a DoT tick or a pet swing keeps landing. `unbroken` is 438ms wider than its own damage span,
	 * which is the residue of whatever WarcraftLogs pads the ends with, and is the reason this is pinned
	 * as a measurement rather than asserted as a formula.
	 */
	it('is the span the log saw something of the player land in, not the time they were pressing', () => {
		const damageSpan = (ds: FightDataset): number => {
			const t = ds.events
				.filter((e) => e.sourceID === ds.actor.id && isDamage(e))
				.map((e) => e.timestamp - ds.fight.startTime);
			return Math.max(...t) - Math.min(...t);
		};
		expect(damageSpan(raw.cleave)).toBe(analysed.cleave.cpm.activeMs);
		expect(damageSpan(raw.iron)).toBe(analysed.iron.cpm.activeMs);
		expect(analysed.unbroken.cpm.activeMs - damageSpan(raw.unbroken)).toBe(438);
		// And on the pull with real downtime it keeps 32 689ms the contact clock rejects — the submerge
		// the player spent healing. So "active" here includes a stretch with no modelled press in it.
		expect(analysed.phased.cpm.activeMs - damageSpan(raw.phased)).toBe(-17_591);
		expect(analysed.phased.cpm.activeMs - contactMs(analysed.phased)).toBe(32_689);
	});

	/**
	 * The headroom, per fixture, the way §44 asked for it — and the reading that matters beside it.
	 *
	 * 7.38 points on `phased` and under a point on the other three, which sounds like the same thin
	 * margin the GCD figure was living on. It is not the same situation: that one was thin *and*
	 * shrinking, because this engine owned its numerator. This one has no moving part on our side.
	 *
	 * The second half of each pair is the point of keeping both clocks published. On `phased` the
	 * sentence drawn from `activePct` credits the player with 92.62% of the pull while their own rotation
	 * clock says 79.97% — 12.65 points, on the one fixture in four where a reader needs the difference.
	 */
	it('pins the headroom to 100 and the gap to our own clock', () => {
		const rows = [
			['phased', 92.62, 79.97],
			['cleave', 99.37, 99.37],
			['unbroken', 99.37, 98.55],
			['iron', 99.7, 99.64],
		] as const;
		for (const [key, wcl, ours] of rows) {
			const a = analysed[key];
			expect(pct(a.cpm.activePct)).toBe(wcl);
			expect(pct((contactMs(a) / a.durationMs) * 100)).toBe(ours);
		}
		expect(rows.map(([key]) => analysed[key].durationMs - analysed[key].cpm.activeMs)).toEqual([
			19_058, 1_661, 1_163, 574,
		]);
	});

	/**
	 * The only route by which `activePct` reaches 100, and it is not a perfect pull.
	 *
	 * A player with no row in the damage table falls through to the pull length, which used to happen in
	 * silence: `activePct` printed exactly 100.00% for the one player it can say nothing about, and
	 * `totalCpm`, `gcdSlots` and every per-ability rate quietly became per *pull* minute. Reachable —
	 * `resolvePlayer` gates only on `friendlyPlayers`, so a healer or someone who died before landing a
	 * hit gets here. Reproduced by renaming the actor, which is the whole of what the lookup keys on.
	 */
	it('warns instead of silently substituting the pull length for a missing damage row', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const orphan = analyseElemental({ ...raw.cleave, actor: { ...raw.cleave.actor, name: 'Notinthetable' } });
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('no damage-table row for Notinthetable'));
		// Both spans named, which is the `uptimePct` precedent: the substitution is visible, not inferred.
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('263233ms pull length'));
		warn.mockRestore();
		expect(pct(orphan.cpm.activePct)).toBe(100);
		expect(pct(orphan.cpm.totalCpm)).toBe(46.5);
		// The real reading, for contrast — same pull, same presses, one name.
		expect(pct(analysed.cleave.cpm.activePct)).toBe(99.37);
		expect(pct(analysed.cleave.cpm.totalCpm)).toBe(46.79);
	});

	/**
	 * The CPM tile against the GCD tile, which `PaceTiles` claimed were the same ratio.
	 *
	 * They are not, and the gap is the §2 failure mode made concrete: since the GCD figure moved to the
	 * contact clock, the two tiles sit on different clocks *and* on different notions of a global, while
	 * carrying the same grade. All four assertions are **no-change guards** on the numbers now written in
	 * `PaceTiles.tsx` — nothing here should move, and if someone makes the tiles agree, this is where the
	 * comment gets found and corrected rather than left lying.
	 */
	it('measures how far the CPM tile is from the GCD tile it was said to match', () => {
		const tileRatio = (a: Analysis): number => {
			const targetCpm = a.cpm.gcdSlots / (a.cpm.activeMs / 60_000);
			return pct((a.cpm.totalCpm / targetCpm) * 100);
		};
		expect([tileRatio(analysed.phased), pct(analysed.phased.cpm.gcdUtilisationPct)]).toEqual([75.36, 94.08]);
		expect([tileRatio(analysed.unbroken), pct(analysed.unbroken.cpm.gcdUtilisationPct)]).toEqual([80.68, 91.94]);
		// The two that do agree, and the reason: an all-instant bar with nothing wasted is the case where
		// counting presses and counting milliseconds give the same answer.
		expect([tileRatio(analysed.iron), pct(analysed.iron.cpm.gcdUtilisationPct)]).toEqual([88.36, 88.55]);
		expect([tileRatio(analysed.cleave), pct(analysed.cleave.cpm.gcdUtilisationPct)]).toEqual([87.93, 87.32]);
	});
});
