// An early Flame Shock refresh is correct when the new application snapshots a stronger dot, and this
// is the file that proves the audit can tell.
//
// The rule is the sim's, not one invented here: `Flame Shock Rules` in
// `ui/shaman/elemental/apls/p5.apl.json` refreshes early on `dotPercentIncrease(8050) > 10%`. The
// figures below are all measured off the three committed raw fixtures — nothing is chosen, and every
// assertion names the fixture fact it rests on so that a change to the derivation shows up as a number
// that moved rather than as a test that went red for no stated reason.
//
// Two things this file is deliberately built to catch, because both are ways of passing while proving
// nothing:
//
//   - **Reading tick damage instead of damage per millisecond of dot.** Flame Shock snapshots its tick
//     period as well as its damage, so the sim's ratio has the period in it. Two of the seven graded
//     presses flip verdict between the two readings, and both are asserted below.
//   - **Pooling two spawns' ticks into one stream.** `cleave` has two, and pooling them reads the
//     boss's cadence as 902ms against its real 1 330ms. Asserted directly against the per-spawn read.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Aura, Dot } from '~/lib/game/model';
import type { Analysis, ElementalAuditResult, FightDataset, FlameShockPress } from '~/lib/types';
import { isDamage } from '~/lib/events/guards';
import { dotSnapshotIn, dotTickSnapshotsBySpawn } from '~/lib/analysis/ticks';

import { analyse } from '../index';
import { scoreAnalysis } from '../score';

/** Flame Shock as the Elemental module declares it — `sim/shaman/shocks.go`. */
const FLAME_SHOCK: Dot = { durationMs: 30_000, tickMs: 3000, ticks: 10, hastedTicks: true, rollsOver: true };
const FS_AURA: Aura = { key: 'flame-shock', name: 'Flame Shock', ids: [8050], kind: 'debuff', durationMs: 30_000 };

const load = (name: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;

const analysed = (name: string): Analysis & ElementalAuditResult =>
	analyse(load(name)) as Analysis & ElementalAuditResult;

const unbroken = load('unbroken');
const cleave = load('cleave');
const phased = load('phased');

const ticksOf = (dataset: FightDataset) =>
	dotTickSnapshotsBySpawn(dataset.events, FS_AURA, dataset.fight.startTime, dataset.actor.id);

/** The raw periodic damage events, so `amount` and `hitType` can be read without going through the model. */
const rawTicks = (dataset: FightDataset) =>
	dataset.events
		.filter(isDamage)
		.filter((e) => e.abilityGameID === 8050 && e.tick === true && e.sourceID === dataset.actor.id);

/** The press at `t`, to the millisecond, so an assertion names the press it is about. */
const pressAt = (el: Analysis & ElementalAuditResult, t: number): FlameShockPress => {
	const press = el.flameShock.presses.find((p) => p.t === t);
	if (press === undefined) throw new Error(`no Flame Shock press at ${t}`);
	return press;
};

/**
 * The waste share, **off the audit rather than off the scorecard** — see the twin of this helper in
 * `flameShockClearcasting.test.ts` for the whole argument.
 *
 * In short: what this file asserts is that crediting a justified refresh moves the *attribution*, and
 * reading that through `metric.value` made it hostage to whether the metric was graded. `cleave` has two
 * refreshes, which is under `MIN_GRADED_SAMPLE`, so the scorecard now declines it and would have handed
 * this a zero for an attribution that had not moved at all.
 */
const wasteOf = (el: Analysis & ElementalAuditResult): number => {
	const fs = el.flameShock;
	return ((fs.refreshes - fs.windowed - fs.ascPrep - fs.snapshotGain) / fs.refreshes) * 100;
};

describe('the instrument: what one dot tick says about the application it came from', () => {
	/**
	 * The field exists on every tick of every committed pull, so nothing downstream needs a fallback.
	 *
	 * 346 is 98 + 134 + 114 across the three, and it is the same 114 `ticks.test.ts` already counts on
	 * `phased` — a tick count that moved would break both files, which is the point of pinning it twice.
	 */
	it('carries an unmitigated amount on all 346 Flame Shock ticks of the three pulls', () => {
		const all = [unbroken, cleave, phased].flatMap((d) => [...ticksOf(d).values()].flat());
		expect(all).toHaveLength(346);
		expect(all.filter((tick) => tick.unmitigatedAmount === null)).toHaveLength(0);
	});

	/**
	 * The reason `amount` cannot answer this question, on the one application the whole file rests on.
	 *
	 * `unbroken`'s application at 28 628 ran sixteen ticks. Every one of them reports the same
	 * `unmitigatedAmount`, 19 245, and six of them were crits — so `amount` reads 21 015, 21 016 and
	 * 55 376 inside a single unchanging snapshot. Read off `amount`, a "mean tick damage before against
	 * after" would be measuring the crit roll.
	 */
	it('holds still across one application while the raw amount does not', () => {
		const app = (ticksOf(unbroken).get('308:-') ?? []).filter((tick) => tick.t > 28_628 && tick.t <= 56_032);
		expect(app).toHaveLength(16);
		expect(new Set(app.map((tick) => tick.unmitigatedAmount))).toEqual(new Set([19_245]));

		const t0 = unbroken.fight.startTime;
		const raw = rawTicks(unbroken).filter((e) => e.timestamp - t0 > 28_628 && e.timestamp - t0 <= 56_032);
		expect(raw).toHaveLength(16);
		expect(raw.filter((e) => e.hitType === 2)).toHaveLength(6);
		expect(new Set(raw.map((e) => e.amount))).toEqual(new Set([21_015, 21_016, 55_376]));
	});

	/** Six distinct snapshots over the pull — one per application — against twenty-five raw amounts. */
	it('takes one value per application over the whole pull, where the raw amount takes twenty-five', () => {
		const ticks = ticksOf(unbroken).get('308:-') ?? [];
		expect(ticks).toHaveLength(98);
		expect(new Set(ticks.map((tick) => tick.unmitigatedAmount)).size).toBe(6);
		expect(new Set(rawTicks(unbroken).map((e) => e.amount)).size).toBe(25);
	});

	/**
	 * Why the ticks are bucketed by spawn, measured rather than argued.
	 *
	 * `cleave` puts a second dot on an add (spawn `478:1`) at 40 269 while the boss (`470:-`) is carrying
	 * one. Between the boss's presses at 29 777 and 57 499 the boss's own application ticks twenty times
	 * at 1 330ms; the pooled stream has twenty-nine ticks in the same stretch and reads 902ms, because
	 * the add's ticks land between the boss's. Every verdict downstream of that number would be invented.
	 */
	it('reads the cadence per spawn, because pooling two spawns invents one', () => {
		const bySpawn = ticksOf(cleave);
		expect([...bySpawn.keys()].sort()).toEqual(['470:-', '478:1']);
		expect(bySpawn.get('470:-')).toHaveLength(120);
		expect(bySpawn.get('478:1')).toHaveLength(14);

		const boss = dotSnapshotIn(bySpawn.get('470:-') ?? [], 29_777, 57_499, FLAME_SHOCK);
		expect(boss?.ticks).toBe(20);
		expect(boss?.cadenceMs).toBeCloseTo(1329.7, 1);

		const pooled = [...bySpawn.values()].flat().sort((a, b) => a.t - b.t);
		const wrong = dotSnapshotIn(pooled, 29_777, 57_499, FLAME_SHOCK);
		expect(wrong?.ticks).toBe(29);
		expect(wrong?.cadenceMs).toBeCloseTo(902.3, 1);
	});

	/**
	 * An application the fight cut short gets no reading at all.
	 *
	 * `cleave`'s last press lands at 259 722 and the pull ends; the application it made got one tick, so
	 * there is no interval to measure and null is the only honest answer. A caller has to fall through to
	 * whatever it would have concluded without a snapshot, never treat null as "no change".
	 */
	it('refuses an application the fight cut short', () => {
		const ticks = ticksOf(cleave).get('470:-') ?? [];
		expect(ticks.filter((tick) => tick.t > 259_722)).toHaveLength(1);
		expect(dotSnapshotIn(ticks, 259_722, Number.POSITIVE_INFINITY, FLAME_SHOCK)).toBeNull();
	});
});

describe('the sim’s own reason to refresh Flame Shock early', () => {
	const el = { unbroken: analysed('unbroken'), cleave: analysed('cleave'), phased: analysed('phased') };

	/**
	 * The three `unbroken` refreshes the old audit faulted and the list wanted.
	 *
	 * 28 628 replaced a 13 529-per-tick application at 1 730ms with a 19 245 one at 1 728ms; 140 025
	 * replaced 19 784 at 2 252ms with 20 159 at 1 730ms. Both clear 10% by a wide margin, and the second
	 * one clears it almost entirely on cadence — see the per-millisecond test below.
	 *
	 * 83 852 is the third, and it arrived here from `windowed` rather than from `early`: the tick count
	 * shows two ticks owed where the declared remaining time read one, so the press needs its snapshot to
	 * excuse it after all. It is +56.2%, which is not near anything.
	 */
	it('credits the three unbroken refreshes that snapshotted a stronger dot', () => {
		expect(pressAt(el.unbroken, 28_628).kind).toBe('snapshot');
		expect(pressAt(el.unbroken, 28_628).snapshotDeltaPct).toBeCloseTo(0.4244, 3);
		expect(pressAt(el.unbroken, 83_852).kind).toBe('snapshot');
		expect(pressAt(el.unbroken, 83_852).snapshotDeltaPct).toBeCloseTo(0.5615, 3);
		expect(pressAt(el.unbroken, 140_025).kind).toBe('snapshot');
		expect(pressAt(el.unbroken, 140_025).snapshotDeltaPct).toBeCloseTo(0.3267, 3);
		expect(el.unbroken.flameShock.snapshotGain).toBe(3);
	});

	/** And the two that snapshotted a weaker one stay faults, by a margin nothing could round away. */
	it('still faults the two unbroken refreshes that snapshotted a weaker dot', () => {
		expect(pressAt(el.unbroken, 56_032).kind).toBe('early');
		expect(pressAt(el.unbroken, 56_032).snapshotDeltaPct).toBeCloseTo(-0.5246, 3);
		expect(pressAt(el.unbroken, 167_184).kind).toBe('early');
		expect(pressAt(el.unbroken, 167_184).snapshotDeltaPct).toBeCloseTo(-0.4099, 3);
	});

	/**
	 * `cleave` has exactly two refreshes and both are on the boss spawn — one excused, one not.
	 *
	 * The first is `windowed` rather than `snapshot`, and it is the press this whole count exists for: it
	 * went out with 1 784ms of *declared* dot left against a 1 725ms tick, so a duration test faulted it
	 * by 59ms — while its application had landed 16 of the 17 ticks a 1 729.7ms period buys and one tick
	 * was still pending. The 609ms over-statement is exactly the `30 000 − 17 × 1 729.7` that bankers
	 * rounding drops. Its snapshot gain is +42.7%, so the excuse it no longer needs is still measurable,
	 * which is what makes the ladder's ordering testable in the case below.
	 */
	it('splits cleave’s two refreshes', () => {
		expect(el.cleave.flameShock.refreshes).toBe(2);
		expect(pressAt(el.cleave, 29_777).kind).toBe('windowed');
		expect(pressAt(el.cleave, 29_777).ticksLeft).toBe(1);
		expect(pressAt(el.cleave, 29_777).snapshotDeltaPct).toBeCloseTo(0.4268, 3);
		expect(pressAt(el.cleave, 57_499).kind).toBe('early');
		expect(pressAt(el.cleave, 57_499).ticksLeft).toBe(4);
		expect(pressAt(el.cleave, 57_499).snapshotDeltaPct).toBeCloseTo(-0.2331, 3);
		expect(el.cleave.flameShock.snapshotGain).toBe(0);
	});

	/**
	 * The regression anchor: `phased` has one early refresh and it gained nothing.
	 *
	 * 59 530 replaced an 11 807-per-tick application at 1 749ms with an 11 807 one at 1 748ms — the same
	 * snapshot, a hundredth of a percent apart. If this pull's grade moves, the rule is crediting
	 * refreshes on noise.
	 */
	it('leaves phased’s one early refresh exactly where it was', () => {
		const press = pressAt(el.phased, 59_530);
		expect(press.kind).toBe('early');
		expect(press.snapshotDeltaPct).not.toBeNull();
		expect(Math.abs(press.snapshotDeltaPct ?? 1)).toBeLessThan(0.001);
		expect(el.phased.flameShock.snapshotGain).toBe(0);
	});

	/**
	 * **The check that this is the sim's metric and not a plausible neighbour of it.**
	 *
	 * `dotPercentIncrease` divides expected tick damage by the tick period, so the ratio is damage per
	 * millisecond of dot. Two of the seven graded presses invert between the two readings, and the
	 * literals here are the applications' own snapshots rather than anything the delta was computed from:
	 *
	 *   - `unbroken` at 140 025 goes from 19 784 to 20 159 per tick, which is **+1.9%** and would be
	 *     faulted, while the cadence goes from 2 252ms to 1 730ms and the press is **+32.7%** per ms.
	 *   - `cleave` at 57 499 goes from 14 839 to 19 245 per tick, which is **+29.7%** and would be
	 *     credited, while the cadence goes from 1 330ms to 2 249ms and the press is **−23.3%** per ms.
	 */
	it('measures damage per millisecond of dot and not damage per tick', () => {
		const u = ticksOf(unbroken).get('308:-') ?? [];
		const uBefore = dotSnapshotIn(u, 112_878, 140_025, FLAME_SHOCK);
		const uAfter = dotSnapshotIn(u, 140_025, 167_184, FLAME_SHOCK);
		expect(uBefore?.tickAmount).toBe(19_784);
		expect(uAfter?.tickAmount).toBe(20_159);
		expect((uAfter?.tickAmount ?? 0) / (uBefore?.tickAmount ?? 1) - 1).toBeCloseTo(0.019, 3);
		expect(pressAt(el.unbroken, 140_025).snapshotDeltaPct).toBeGreaterThan(0.3);

		const c = ticksOf(cleave).get('470:-') ?? [];
		const cBefore = dotSnapshotIn(c, 29_777, 57_499, FLAME_SHOCK);
		const cAfter = dotSnapshotIn(c, 57_499, 89_164, FLAME_SHOCK);
		expect(cBefore?.tickAmount).toBe(14_839);
		expect(cAfter?.tickAmount).toBe(19_245);
		expect((cAfter?.tickAmount ?? 0) / (cBefore?.tickAmount ?? 1) - 1).toBeCloseTo(0.297, 3);
		expect(pressAt(el.cleave, 57_499).snapshotDeltaPct).toBeLessThan(0);
	});

	/**
	 * A last-tick refresh is not credited twice, and the ladder's order is what stops it.
	 *
	 * `cleave`'s press at 29 777 had one tick still owed, so it is `windowed` — and it also snapshotted a
	 * dot 43% stronger. Both excuses apply; only one may be counted, or `flameShockWaste` subtracts the
	 * same press out of the refreshes twice and can go negative. So `snapshotGain` is counted off the
	 * *kind* and `snapshot` sits after `windowed` in the ladder: this pull's `windowed` is 1, its
	 * `snapshotGain` is 0, and the two together are one press rather than two.
	 *
	 * The case used to be `unbroken`'s press at 83 852, which stopped being `windowed` when the rule
	 * became a count — the same press now proves the *other* half of the ordering, that a press dropping
	 * out of `windowed` falls through to `snapshot` rather than to `early`.
	 */
	it('does not credit a last-tick refresh a second time for its snapshot', () => {
		const press = pressAt(el.cleave, 29_777);
		expect(press.kind).toBe('windowed');
		expect(press.snapshotDeltaPct).toBeGreaterThan(0.1);
		const fs = el.cleave.flameShock;
		expect([fs.windowed, fs.ascPrep, fs.snapshotGain]).toEqual([1, 0, 0]);
		expect(fs.windowed + fs.ascPrep + fs.snapshotGain).toBeLessThanOrEqual(fs.refreshes);
		for (const a of Object.values(el)) {
			const audit = a.flameShock;
			expect(audit.snapshotGain).toBe(audit.presses.filter((p) => p.kind === 'snapshot').length);
			expect(audit.windowed).toBe(audit.presses.filter((p) => p.kind === 'windowed').length);
		}
	});

	/** Seven graded early presses across the three pulls, three of which clear the sim's 10%. */
	it('grades seven early presses across the three pulls and clears three of them', () => {
		const early = Object.values(el).flatMap((a) =>
			a.flameShock.presses.filter((p) => p.kind === 'early' || p.kind === 'snapshot'),
		);
		expect(early).toHaveLength(7);
		expect(early.filter((p) => p.kind === 'snapshot')).toHaveLength(3);
		// None of the seven sits anywhere near the threshold, so no verdict here turns on the third
		// decimal of a cadence: the closest is phased's 0.01% and the next is unbroken's 32.7%.
		expect(early.map((p) => p.snapshotDeltaPct).every((d) => d !== null && Math.abs(d - 0.1) > 0.05)).toBe(true);
	});
});

describe('what crediting a justified refresh changes in the grade', () => {
	const el = { unbroken: analysed('unbroken'), cleave: analysed('cleave'), phased: analysed('phased') };

	/**
	 * `flameShockWaste` on all three, and the third one is the regression anchor.
	 *
	 * `unbroken` was 66.67% (four of six refreshes faulted) and is 33.33% (two of six). `cleave` was
	 * 100% (two of two) and is 50% (one of two). `phased` was and remains 25% (one of four), because its
	 * one early refresh gained 0.01%.
	 */
	it('halves the waste on the two pulls with a justified refresh and leaves phased alone', () => {
		expect(wasteOf(el.unbroken)).toBeCloseTo(33.33, 2);
		expect(wasteOf(el.cleave)).toBeCloseTo(50, 2);
		expect(wasteOf(el.phased)).toBeCloseTo(25, 2);
	});

	/** No section grade flips: 33.33% and 50% are both still past the 30% `ok` band, and 25% is inside it. */
	it('flips no section grade', () => {
		expect(scoreAnalysis(el.unbroken).sections['flameShock']?.grade).toBe('bad');
		expect(scoreAnalysis(el.cleave).sections['flameShock']?.grade).toBe('bad');
		expect(scoreAnalysis(el.phased).sections['flameShock']?.grade).toBe('ok');
	});

	/**
	 * `gcdUtilisation` charges the same presses the Flame Shock section faults, which is the whole point
	 * of the shared predicate — two parts of one report must not disagree about one press.
	 *
	 * `wastedGcds` is the faulted refreshes plus the Searing Totem clips, and the two are asserted apart
	 * so that neither can absorb a change in the other. `cleave` is the pull with a clip: one totem
	 * pressed over a healthy one, so its 2 is one refresh and one totem. `unbroken` is 2 refreshes and
	 * no totem, `phased` 1 and none. The old predicate charged 4, 2 and 1 refreshes respectively.
	 */
	it('charges gcdUtilisation the same presses the section faults', () => {
		for (const a of Object.values(el)) {
			const faulted = a.flameShock.presses.filter(
				(p) => p.remainingMs !== null && !p.windowed && !p.ascPrep && p.kind !== 'snapshot',
			).length;
			expect(a.cpm.wastedGcds).toBe(faulted + a.searingTotem.clipped);
		}
		expect(el.unbroken.searingTotem.clipped).toBe(0);
		expect(el.cleave.searingTotem.clipped).toBe(1);
		expect(el.phased.searingTotem.clipped).toBe(0);
		expect(el.unbroken.cpm.wastedGcds).toBe(2);
		expect(el.cleave.cpm.wastedGcds).toBe(2);
		expect(el.phased.cpm.wastedGcds).toBe(1);
	});
});
