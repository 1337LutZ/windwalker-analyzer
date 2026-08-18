import { describe, expect, it } from 'vitest';
import type { Ability } from '~/lib/game/model';
import { cooldownDrift } from '../cooldowns';
import type { Interval } from '../intervals';

const WHOLE_FIGHT: Interval[] = [[0, 120000]];
const FIGHT_MS = 120000;

/** An 8s cooldown the priority list presses on cooldown: the only shape drift is meaningful for. */
const RISING_SUN_KICK: Ability = {
	key: 'rising-sun-kick',
	name: 'Rising Sun Kick',
	castIds: [107428],
	onGcd: true,
	gate: 'cooldown',
	cooldownMs: 8000,
};

/** No cooldown at all: its ceiling is the chi economy, so it must never be scored on drift. */
const JAB: Ability = {
	key: 'jab',
	name: 'Jab',
	castIds: [115687, 115695],
	onGcd: true,
	gate: 'chi',
};

/** A 25s cooldown that is never played off it — graded against conditions, never against time. */
const FISTS_OF_FURY: Ability = {
	key: 'fists-of-fury',
	name: 'Fists of Fury',
	castIds: [113656],
	onGcd: true,
	gate: 'conditional',
	cooldownMs: 25000,
	channel: { tickId: 117418 },
};

describe('cooldownDrift', () => {
	it('reports nothing for an ability that was never cast', () => {
		expect(cooldownDrift([], RISING_SUN_KICK, WHOLE_FIGHT, FIGHT_MS)).toEqual({
			driftMs: 0,
			lostCasts: 0,
			openerMs: 0,
			tailMs: 0,
			windows: [],
		});
	});

	it('charges nothing when every cast went out on cooldown', () => {
		const drift = cooldownDrift([0, 8000, 16000, 24000], RISING_SUN_KICK, WHOLE_FIGHT, FIGHT_MS);
		expect(drift.driftMs).toBe(0);
		expect(drift.lostCasts).toBe(0);
	});

	it('converts the idle time between casts into lost casts', () => {
		// Ready at 8s, pressed at 28s: 20s of drift, which is two whole 8s cooldowns.
		const drift = cooldownDrift([0, 28000], RISING_SUN_KICK, WHOLE_FIGHT, FIGHT_MS);
		expect(drift.driftMs).toBe(20000);
		expect(drift.lostCasts).toBe(2);
		expect(drift.windows).toEqual([{ start: 8000, end: 28000, ms: 20000 }]);
	});

	it('scores nothing for a button with no cooldown to drift against', () => {
		// A 60s hole between two Jabs is the chi economy, not a held cooldown. "13 of 89 possible
		// Rushing Jade Winds" is the same fabricated indictment, which is why gate decides this.
		expect(cooldownDrift([0, 60000, 120000], JAB, WHOLE_FIGHT, FIGHT_MS)).toEqual({
			driftMs: 0,
			lostCasts: 0,
			openerMs: 0,
			tailMs: 0,
			windows: [],
		});
	});

	it('scores nothing for a conditional ability even though it has a cooldown', () => {
		// Fists of Fury has a 25s cooldown and is deliberately never played off it.
		const drift = cooldownDrift([0, 90000], FISTS_OF_FURY, WHOLE_FIGHT, FIGHT_MS);
		expect(drift.driftMs).toBe(0);
		expect(drift.lostCasts).toBe(0);
		expect(drift.windows).toEqual([]);
	});

	describe('only between casts', () => {
		it('excludes the opener: the stretch before the first cast is prepull noise', () => {
			const drift = cooldownDrift([30000, 38000], RISING_SUN_KICK, WHOLE_FIGHT, FIGHT_MS);
			expect(drift.openerMs).toBe(30000);
			expect(drift.driftMs).toBe(0);
			expect(drift.lostCasts).toBe(0);
			expect(drift.windows).toEqual([]);
		});

		it('excludes the tail: the boss died on a cooldown that was coming back anyway', () => {
			const drift = cooldownDrift([0, 8000], RISING_SUN_KICK, WHOLE_FIGHT, FIGHT_MS);
			expect(drift.tailMs).toBe(104000); // 120s fight, ready again at 16s
			expect(drift.driftMs).toBe(0);
			expect(drift.lostCasts).toBe(0);
		});

		it('does not let the tail run past the end of the fight', () => {
			// Last cast at 118s: the cooldown is still down when the fight ends at 120s.
			expect(cooldownDrift([0, 118000], RISING_SUN_KICK, WHOLE_FIGHT, FIGHT_MS).tailMs).toBe(0);
		});

		it('keeps opener and tail out of the drift even when both dwarf it', () => {
			// 40s of opener, one real 12s hole between the casts, 60s of tail. Folding the ends in
			// would report thirteen lost casts for a pull that lost one.
			const drift = cooldownDrift([40000, 60000], RISING_SUN_KICK, WHOLE_FIGHT, FIGHT_MS);
			expect(drift.openerMs).toBe(40000);
			expect(drift.tailMs).toBe(52000);
			expect(drift.driftMs).toBe(12000);
			expect(drift.lostCasts).toBe(1);
			expect(drift.windows).toEqual([{ start: 48000, end: 60000, ms: 12000 }]);
		});
	});

	describe('only while the boss was targetable', () => {
		it('clips the idle stretch to the engaged windows', () => {
			// Ready at 20s and pressed at 60s, but the boss was untargetable for 30s of that.
			const engaged: Interval[] = [
				[0, 20000],
				[50000, 120000],
			];
			const drift = cooldownDrift([12000, 60000], RISING_SUN_KICK, engaged, FIGHT_MS);
			expect(drift.driftMs).toBe(10000);
			expect(drift.lostCasts).toBe(1);
			// Charged against the whole fight instead, the intermission alone would invent four more.
			expect(cooldownDrift([12000, 60000], RISING_SUN_KICK, WHOLE_FIGHT, FIGHT_MS).lostCasts).toBe(5);
		});

		it('charges nothing at all for a hole that was entirely intermission', () => {
			const engaged: Interval[] = [
				[0, 20000],
				[80000, 120000],
			];
			const drift = cooldownDrift([12000, 80000], RISING_SUN_KICK, engaged, FIGHT_MS);
			expect(drift.driftMs).toBe(0);
			expect(drift.lostCasts).toBe(0);
			expect(drift.windows).toEqual([]);
		});

		it('clips the opener and the tail to the engaged windows too', () => {
			// The pull starts at 10s and the boss leaves for good at 100s: neither stretch may be
			// reported as longer than the time the player could actually have pressed anything.
			const engaged: Interval[] = [[10000, 100000]];
			const drift = cooldownDrift([30000, 38000], RISING_SUN_KICK, engaged, FIGHT_MS);
			expect(drift.openerMs).toBe(20000);
			expect(drift.tailMs).toBe(54000); // ready again at 46s, engaged until 100s
		});
	});

	it('drops sub-second windows, which are latency rather than a held cooldown', () => {
		const drift = cooldownDrift([0, 8500, 17000], RISING_SUN_KICK, WHOLE_FIGHT, FIGHT_MS);
		expect(drift.windows).toEqual([]);
		expect(drift.driftMs).toBe(0);
	});

	/**
	 * The window forgives a wait whole and never shortens one, which is the shape the reader's setting
	 * inherits: a press 1.4s late costs nothing, and one 2s late is charged for both seconds rather
	 * than for the half past the window. So widening it can only ever drop short waits — it cannot
	 * quietly discount a long one.
	 */
	it('drops a wait inside the window whole and charges a longer one in full', () => {
		expect(cooldownDrift([0, 9400], RISING_SUN_KICK, WHOLE_FIGHT, FIGHT_MS).driftMs).toBe(0);
		expect(cooldownDrift([0, 10000], RISING_SUN_KICK, WHOLE_FIGHT, FIGHT_MS).driftMs).toBe(2000);
		// And a caller may tighten it back to the one-global reading the report shipped with.
		expect(cooldownDrift([0, 9400], RISING_SUN_KICK, WHOLE_FIGHT, FIGHT_MS, 1000).driftMs).toBe(1400);
	});

	it('orders the windows worst first, so the report can take the top three', () => {
		const drift = cooldownDrift([0, 20000, 24000, 60000], RISING_SUN_KICK, WHOLE_FIGHT, FIGHT_MS);
		expect(drift.windows.map((w) => w.ms)).toEqual([28000, 12000]);
	});

	it('counts lost casts on whole cooldowns only, never on a part of one', () => {
		// 15s of drift on an 8s cooldown is one lost cast and a bit, not 1.875.
		const drift = cooldownDrift([0, 23000], RISING_SUN_KICK, WHOLE_FIGHT, FIGHT_MS);
		expect(drift.driftMs).toBe(15000);
		expect(drift.lostCasts).toBe(1);
	});
});
