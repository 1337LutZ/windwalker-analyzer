// The tick cadence read off a real pull, the tick count backed out of it, and the two intervals that
// would have got both wrong.
//
// The cadence numbers here are not chosen; they are measured. `a:qHRAFwdGzaB6MPYC` #14 (the committed
// `phased` fixture) carries 114 Flame Shock ticks on the boss, and the intervals between them sit on
// three plateaus as the raid's haste cooldowns fall off one after the other. Every assertion against
// that pull names the interval it came from, so a change to the derivation shows up as a number that
// moved rather than as a test that went red.
//
// The synthetic cases are the ones the fixture cannot hold: a dot with no ticks yet, a sample of one,
// the exact boundary of the window, and the two declarations the model refuses.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import { createRegistry } from '~/lib/game/registry';
import type { Aura, Dot } from '~/lib/game/model';
import type { FightDataset } from '~/lib/types';

import { dotTicksBySpawn, inLastTickWindow, tickWindowAt, TICK_MIN_SAMPLE, TICK_SAMPLE } from '../ticks';

/** Flame Shock as the Elemental module declares it: ten three-second ticks — `sim/shaman/shocks.go`. */
const FLAME_SHOCK: Dot = { durationMs: 30_000, tickMs: 3000, ticks: 10, hastedTicks: true, rollsOver: true };
const FS_AURA: Aura = { key: 'flame-shock', name: 'Flame Shock', ids: [8050], kind: 'debuff', durationMs: 30_000 };

const phased = JSON.parse(
	readFileSync(resolve(import.meta.dirname, '../../../specs/elemental/__fixtures__/phased.json'), 'utf8'),
) as FightDataset;

const ticksOf = (dataset: FightDataset): number[] => {
	const bySpawn = dotTicksBySpawn(dataset.events, FS_AURA, dataset.fight.startTime, dataset.actor.id);
	const only = [...bySpawn.values()];
	expect(only).toHaveLength(1);
	return only[0] ?? [];
};

describe('reading a dot’s ticks off a pull', () => {
	const ticks = ticksOf(phased);

	/**
	 * 114 periodic hits, and **not** the 123 damage events the spell id carries.
	 *
	 * Flame Shock's direct hit logs under the same id without `tick`, once per application — nine of
	 * them here. Counting every damage event would put a phantom interval at every application, which
	 * is precisely the interval the cadence must not see.
	 */
	it('takes the periodic ticks and leaves the direct hits alone', () => {
		const all = phased.events.filter((e: WclEvent) => e.abilityGameID === 8050 && e.type === 'damage');
		expect(all).toHaveLength(123);
		expect(ticks).toHaveLength(114);
		expect(ticks[0]).toBe(3990);
		expect(ticks.at(-1)).toBe(257_571);
	});

	/**
	 * The three plateaus, each measured at a press that fell inside it.
	 *
	 * ~1 348ms for the opener (Bloodlust and Elemental Mastery both up: 3 000 / 2.22), ~1 748ms with one
	 * of them gone (3 000 / 1.72) and ~2 275ms with neither (3 000 / 1.32). The declared cadence is
	 * 3 000ms and the pull never once ran at it.
	 */
	it('measures the cadence in force at an instant, not the declared one', () => {
		expect(tickWindowAt(ticks, 32_326, FLAME_SHOCK).cadenceMs).toBeCloseTo(1348.7, 1);
		expect(tickWindowAt(ticks, 59_530, FLAME_SHOCK).cadenceMs).toBeCloseTo(1748.3, 1);
		expect(tickWindowAt(ticks, 222_607, FLAME_SHOCK).cadenceMs).toBeCloseTo(2275, 1);
		expect(tickWindowAt(ticks, 32_326, FLAME_SHOCK).samples).toBe(TICK_SAMPLE);
	});

	/**
	 * The tick count backed out of each of those, against the count the log actually fired.
	 *
	 * The application at 2 631 was removed at 32 291 having fired every tick in between: 22 of them,
	 * which is what `round(30 000 / 1 348.7)` says. The 1 748ms plateau gives 17 and the 2 275ms one 13,
	 * and the application at 121 512 — removed at 151 149 with no refresh in between — fired 13.
	 *
	 * Declared, the answer would have been 10 on all three.
	 */
	it('backs the tick count out of the cadence, and the log agrees', () => {
		expect(tickWindowAt(ticks, 32_326, FLAME_SHOCK).ticks).toBe(22);
		expect(ticks.filter((t) => t > 2631 && t <= 32_291)).toHaveLength(22);

		expect(tickWindowAt(ticks, 59_530, FLAME_SHOCK).ticks).toBe(17);

		expect(tickWindowAt(ticks, 222_607, FLAME_SHOCK).ticks).toBe(13);
		expect(ticks.filter((t) => t > 121_512 && t <= 151_149)).toHaveLength(13);
	});

	/**
	 * The 44 191ms hole where the boss submerged (151 149 → 195 340) is not a tick interval.
	 *
	 * The first press after it, at 193 052, has no tick of its own application to look back on, so the
	 * sample stops at the hole and cannot be filled — which reports the base period with `samples: 0`
	 * rather than a cadence of eleven seconds. Read at 202 175, three ticks later, it measures again on
	 * the three intervals that exist (2 283, 2 288, 2 264) and stops at the hole rather than taking a
	 * fourth — three samples, not four, which is the sample being truncated where it should be.
	 */
	it('refuses to measure across a hole in the stream', () => {
		const across = tickWindowAt(ticks, 195_340, FLAME_SHOCK);
		expect(across.samples).toBe(0);
		expect(across.cadenceMs).toBe(3000);
		const after = tickWindowAt(ticks, 202_175, FLAME_SHOCK);
		expect(after.samples).toBe(3);
		expect(after.cadenceMs).toBeCloseTo(2273.5, 1);
	});
});

describe('the intervals that mislead', () => {
	/**
	 * The interval a re-application leaves behind, taken from the pull: 90 170 → 92 817 is 2 647ms,
	 * across a removal at 90 171 and a fresh application at 91 059 (the 55th interval of 113). It is
	 * shorter than the unhasted 3 000ms period, so the plausibility filter cannot see it.
	 *
	 * A plain four-sample mean that swallows it reads 1 974ms — a fifth of a tick out, and enough to
	 * move a verdict on a press whose remaining time sits near the window. Dropping the longest of the
	 * sample reads 1 750.
	 */
	it('drops the longest interval of the sample rather than averaging it in', () => {
		const late = [0, 1750, 3500, 6147, 7897];
		expect(tickWindowAt(late, 7897, FLAME_SHOCK).cadenceMs).toBe(1750);
		expect(tickWindowAt(late, 7897, FLAME_SHOCK).samples).toBe(TICK_SAMPLE);
		// What the mean of the same four would have said.
		expect((1750 + 1750 + 2647 + 1750) / 4).toBeCloseTo(1974.25, 2);
	});

	/** A sample of one interval is a reading, not a measurement, so the base period stands. */
	it('will not measure a cadence off a single interval', () => {
		expect(TICK_MIN_SAMPLE).toBe(2);
		expect(tickWindowAt([0, 1750], 1750, FLAME_SHOCK)).toEqual({ cadenceMs: 3000, samples: 0, ticks: 10 });
		expect(tickWindowAt([0, 1750, 3500], 3500, FLAME_SHOCK).samples).toBe(2);
	});

	/** No ticks at all — a press onto a target that never carried the dot — falls back to the base. */
	it('falls back to the declared schedule when the log cannot answer', () => {
		expect(tickWindowAt([], 5000, FLAME_SHOCK)).toEqual({ cadenceMs: 3000, samples: 0, ticks: 10 });
	});
});

describe('the last tick window', () => {
	const window = tickWindowAt([0, 1750, 3500, 5250, 7000], 7000, FLAME_SHOCK);

	it('is exactly one tick period wide, inclusive', () => {
		expect(window.cadenceMs).toBe(1750);
		expect(inLastTickWindow(1750, window, FLAME_SHOCK)).toBe(true);
		expect(inLastTickWindow(1751, window, FLAME_SHOCK)).toBe(false);
		expect(inLastTickWindow(1, window, FLAME_SHOCK)).toBe(true);
	});

	/** A dot that is already down was not refreshed inside anything — that is a different press. */
	it('does not count a dot that had already fallen off', () => {
		expect(inLastTickWindow(0, window, FLAME_SHOCK)).toBe(false);
	});

	/**
	 * The Warlock exception, enforced rather than commented.
	 *
	 * There is no Warlock spec here yet. When there is, its dots declare `rollsOver: false` and any
	 * attempt to grade one on its tick window stops here instead of quietly calling a refresh a fault.
	 */
	it('refuses a dot that does not roll over', () => {
		const warlock: Dot = { ...FLAME_SHOCK, rollsOver: false };
		expect(() => inLastTickWindow(500, window, warlock)).toThrow(/does not roll over/);
	});

	/** And the other half of the mechanic: a duration-hasted dot has a fixed tick count. */
	it('refuses to back a tick count out of a dot whose duration haste shortens', () => {
		const durationHasted: Dot = { ...FLAME_SHOCK, hastedTicks: false };
		expect(() => tickWindowAt([0, 1750, 3500, 5250], 5250, durationHasted)).toThrow(/duration/);
	});
});

describe('the declaration guard', () => {
	const ability = (dot: Dot) => ({
		abilities: [{ key: 'a', name: 'A', castIds: [1], onGcd: true, gate: 'conditional' as const, dot }],
		auras: [],
	});

	it('accepts three numbers that agree', () => {
		expect(() => createRegistry(ability(FLAME_SHOCK))).not.toThrow();
	});

	/** A mistyped period would otherwise pass as a dot of a different shape entirely. */
	it('refuses a tick count that is not the duration over the period', () => {
		expect(() => createRegistry(ability({ ...FLAME_SHOCK, tickMs: 2000 }))).toThrow(/10 × 2000ms/);
		expect(() => createRegistry(ability({ ...FLAME_SHOCK, ticks: 0 }))).toThrow(/is not its 30000ms duration/);
	});
});
