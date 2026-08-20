import { describe, expect, it, vi } from 'vitest';
import type { WclEvent } from '~/lib/events';
import type { Aura } from '~/lib/game/model';
import type { Interval } from '../intervals';
import {
	DROP_MS,
	SELF_EVENT_MS,
	auraDrops,
	auraLevels,
	auraTimeline,
	auraWindows,
	levelAt,
	remainingAtCast,
	remainingIn,
	uptimePct,
} from '../auras';

const T0 = 500;

/** One id, one meaning: the plain case. */
const TIGER_POWER: Aura = {
	key: 'tiger-power',
	name: 'Tiger Power',
	ids: [125359],
	kind: 'buff',
	durationMs: 20000,
	refreshRestarts: true,
	appliedBy: 'tiger-palm',
};

/**
 * Three ids for one trinket, because the id says which stat was handed back. Reading only one of
 * them is what undercounted a monk's 15 procs as 12.
 */
const RE_ORIGINATION: Aura = {
	key: 're-origination',
	name: 'Re-Origination',
	ids: [139117, 139120, 139121],
	kind: 'buff',
	durationMs: 10000,
	variants: { 139117: 'Crit', 139120: 'Mastery', 139121: 'Haste' },
};

const RSK_DEBUFF: Aura = {
	key: 'rising-sun-kick-debuff',
	name: 'Rising Sun Kick',
	ids: [130320],
	kind: 'debuff',
	durationMs: 15000,
	appliedBy: 'rising-sun-kick',
};

/** Fight-relative ms in, report-relative event out — the offset the engine works in. */
function ev(t: number, type: string, id = TIGER_POWER.ids[0]!): WclEvent {
	return { timestamp: T0 + t, type, abilityGameID: id, targetID: 1 };
}

describe('auraWindows', () => {
	it('pairs apply with remove and reports fight-relative times', () => {
		expect(auraWindows([ev(1000, 'applybuff'), ev(11000, 'removebuff')], TIGER_POWER, T0, T0 + 60000)).toEqual([
			{ start: 1000, end: 11000, id: 125359, variant: undefined },
		]);
	});

	it('ignores auras this one does not claim', () => {
		const events = [ev(0, 'applybuff', 139117), ev(1000, 'applybuff'), ev(2000, 'removebuff')];
		expect(auraWindows(events, TIGER_POWER, T0, T0 + 60000).map((w) => [w.start, w.end])).toEqual([[1000, 2000]]);
	});

	it('does not open a second window for a re-application', () => {
		// WarcraftLogs emits refreshbuff for a re-cast, so one pair can span two applications.
		const events = [ev(0, 'applybuff'), ev(5000, 'refreshbuff'), ev(28700, 'removebuff')];
		expect(auraWindows(events, TIGER_POWER, T0, T0 + 60000).map((w) => [w.start, w.end])).toEqual([[0, 28700]]);
	});

	it('closes a window still open at the end of the fight and says so', () => {
		const [window] = auraWindows([ev(50000, 'applybuff')], TIGER_POWER, T0, T0 + 60000);
		expect(window).toMatchObject({
			start: 50000,
			end: 60000,
			truncated: true,
		});
	});

	it('handles a debuff falling off with no apply in the fetched range', () => {
		expect(auraWindows([ev(1000, 'removedebuff', 130320)], RSK_DEBUFF, T0, T0 + 60000)).toEqual([]);
	});

	it('reads applydebuff/removedebuff the same way as the buff pair', () => {
		const events = [ev(1000, 'applydebuff', 130320), ev(9000, 'removedebuff', 130320)];
		expect(auraWindows(events, RSK_DEBUFF, T0, T0 + 60000).map((w) => [w.start, w.end])).toEqual([[1000, 9000]]);
	});

	describe('an aura whose id encodes a variant', () => {
		it('reports one window per id, labelled with the variant', () => {
			const events = [
				ev(1000, 'applybuff', 139120),
				ev(11000, 'removebuff', 139120),
				ev(30000, 'applybuff', 139117),
				ev(40000, 'removebuff', 139117),
			];
			expect(auraWindows(events, RE_ORIGINATION, T0, T0 + 60000)).toEqual([
				{ start: 1000, end: 11000, id: 139120, variant: 'Mastery' },
				{ start: 30000, end: 40000, id: 139117, variant: 'Crit' },
			]);
		});

		it("does not let one variant close another variant's window", () => {
			// Tracked with a single open-state, the Crit removal at 10s would close the Mastery
			// window opened at 0s and the Haste proc would vanish entirely.
			const events = [
				ev(0, 'applybuff', 139120),
				ev(1000, 'applybuff', 139117),
				ev(10000, 'removebuff', 139117),
				ev(11000, 'removebuff', 139120),
			];
			expect(auraWindows(events, RE_ORIGINATION, T0, T0 + 60000)).toEqual([
				{ start: 0, end: 11000, id: 139120, variant: 'Mastery' },
				{ start: 1000, end: 10000, id: 139117, variant: 'Crit' },
			]);
		});

		it('returns the windows in time order however the ids interleave', () => {
			const events = [
				ev(20000, 'applybuff', 139121),
				ev(30000, 'removebuff', 139121),
				ev(1000, 'applybuff', 139120),
				ev(11000, 'removebuff', 139120),
			];
			expect(auraWindows(events, RE_ORIGINATION, T0, T0 + 60000).map((w) => w.variant)).toEqual(['Mastery', 'Haste']);
		});
	});

	/**
	 * The aura that was already running when the fight began.
	 *
	 * Shaped on the case it was written for: a pre-pull potion on a:6MhZgjyAknFWrYfK fight 16, where
	 * the whole of it inside the fight is a `removebuff` at 24706ms and the potion runs 25s — so it
	 * went down 294ms before the pull. The default walk throws that event away, which is why the
	 * `cleave` fixture carried only the in-fight potion for as long as it did.
	 */
	describe('an aura that was already up at the pull', () => {
		const POTION: Aura = { key: 'virmens-bite', name: "Virmen's Bite", ids: [105697], kind: 'buff', durationMs: 25000 };

		it('drops the orphan removal unless asked', () => {
			expect(auraWindows([ev(24706, 'removebuff', 105697)], POTION, T0, T0 + 200000)).toEqual([]);
		});

		it('opens the window at the pull and marks it', () => {
			expect(auraWindows([ev(24706, 'removebuff', 105697)], POTION, T0, T0 + 200000, { openAtPull: true })).toEqual([
				{ start: 0, end: 24706, preexisting: true, id: 105697, variant: undefined },
			]);
		});

		it('leaves an ordinary pair alone and does not mark it', () => {
			// The other potion in that same pull, drunk inside the fight. Both windows on one lane, and only
			// the first of them is an inference.
			const events = [
				ev(24706, 'removebuff', 105697),
				ev(60134, 'applybuff', 105697),
				ev(60135, 'cast', 105697),
				ev(85140, 'removebuff', 105697),
			];
			expect(auraWindows(events, POTION, T0, T0 + 200000, { openAtPull: true })).toEqual([
				{ start: 0, end: 24706, preexisting: true, id: 105697, variant: undefined },
				{ start: 60134, end: 85140, id: 105697, variant: undefined },
			]);
		});

		it('refuses a removal the aura could not still have been running for', () => {
			// One millisecond past its own duration. A buff up at the pull cannot outlive `t0 + durationMs`,
			// so this is something else — and the bound is the whole reason the inference is arithmetic.
			expect(auraWindows([ev(25000, 'removebuff', 105697)], POTION, T0, T0 + 200000, { openAtPull: true })).toEqual([]);
		});

		it('refuses an aura with no declared duration, because the bound cannot be checked', () => {
			const unbounded: Aura = { ...POTION, durationMs: undefined };
			expect(auraWindows([ev(1000, 'removebuff', 105697)], unbounded, T0, T0 + 200000, { openAtPull: true })).toEqual(
				[],
			);
		});

		it('refuses a removal that follows a press of the same id', () => {
			// The `poor` fixture's monk, who drank at +92ms rather than before the bell: the apply and the
			// cast are both in the fight, so the removal 25s later pairs with them and infers nothing.
			const events = [ev(88, 'applybuff', 105697), ev(92, 'cast', 105697), ev(25094, 'removebuff', 105697)];
			expect(auraWindows(events, POTION, T0, T0 + 200000, { openAtPull: true })).toEqual([
				{ start: 88, end: 25094, id: 105697, variant: undefined },
			]);
		});

		it('refuses a second orphan removal on the same id', () => {
			// A pull cannot start twice, so only the leading orphan can be the pull's own.
			const events = [ev(1000, 'removebuff', 105697), ev(2000, 'removebuff', 105697)];
			expect(auraWindows(events, POTION, T0, T0 + 200000, { openAtPull: true })).toEqual([
				{ start: 0, end: 1000, preexisting: true, id: 105697, variant: undefined },
			]);
		});

		/**
		 * Why this is opt-in, in the one shape that shows why it has to be.
		 *
		 * A battle elixir runs an hour, so its own duration bounds nothing and the recovered application
		 * time comes back in negative minutes. Measured: the `weave` fixture's monk cancels Monk's Elixir
		 * at 10.2s by drinking Elixir of the Rapids in the same millisecond, and reading that as a
		 * pre-pull consumable would date it 59.8 minutes before the pull.
		 */
		it('would date an hour-long elixir before the pull, which is why a flask is not asked', () => {
			const elixir: Aura = {
				key: 'monks-elixir',
				name: "Monk's Elixir",
				ids: [105688],
				kind: 'buff',
				durationMs: 3_600_000,
			};
			const [window] = auraWindows([ev(10230, 'removebuff', 105688)], elixir, T0, T0 + 129531, { openAtPull: true });
			expect(window).toMatchObject({ start: 0, end: 10230, preexisting: true });
			// The number that reading would produce, and the reason nothing asks for it.
			expect(10230 - (elixir.durationMs ?? 0)).toBe(-3_589_770);
		});
	});
});

describe('remainingIn / uptimePct', () => {
	const windows = [
		{ start: 0, end: 10000 },
		{ start: 20000, end: 25000 },
	];

	it('reports the time left on the covering window', () => {
		expect(remainingIn(6000, windows)).toBe(4000);
		expect(remainingIn(15000, windows)).toBe(0);
	});

	it('measures uptime against the whole fight', () => {
		expect(uptimePct(windows, 30000)).toBe(50);
		expect(uptimePct(windows, 0)).toBe(0);
	});

	/**
	 * The backstop, and the fact that it does not keep quiet.
	 *
	 * 15s of windows against a 10s denominator is the shape that printed 100.21% on the Elemental's
	 * Flame Shock tile: a numerator measured over a span the denominator does not cover. A silent clamp
	 * would have hidden that for a second time, so the out-of-range input is reported and the caller's
	 * arithmetic is what gets fixed. Asserted rather than trusted, because a warning nobody checks is
	 * the same as no warning.
	 */
	it('clamps a numerator wider than its denominator, loudly', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		try {
			expect(uptimePct(windows, 10000)).toBe(100);
			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn.mock.calls[0]?.[0]).toContain('not measured over the same span');
		} finally {
			warn.mockRestore();
		}
	});

	/** Exactly full is not out of range, and must not warn. */
	it('says nothing when the windows exactly fill the denominator', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		try {
			expect(uptimePct([{ start: 0, end: 10000 }], 10000)).toBe(100);
			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});
});

describe('auraTimeline', () => {
	it('keeps applies, refreshes and removals, in order, and nothing else', () => {
		const events = [
			ev(0, 'applybuff'),
			ev(500, 'cast'),
			ev(5000, 'refreshbuff'),
			ev(9000, 'damage'),
			ev(12000, 'removebuff'),
		];
		expect(auraTimeline(events, TIGER_POWER, T0)).toEqual([
			{ t: 0, up: true },
			{ t: 5000, up: true },
			{ t: 12000, up: false },
		]);
	});
});

describe('remainingAtCast', () => {
	// The trap: a cast that refreshes a buff logs that refresh 0–2 ms *before* its own cast event, so
	// reading the buff clock at the cast returns the answer the cast itself just wrote.
	const events = [ev(0, 'applybuff'), ev(19998, 'refreshbuff')];
	const timeline = auraTimeline(events, TIGER_POWER, T0);
	const castAt = 20000;

	it('ignores the aura event the cast itself produced', () => {
		// The buff was two milliseconds from dropping, which is exactly when the press is correct.
		expect(remainingAtCast(timeline, castAt, TIGER_POWER)).toBe(0);
	});

	it('reads a full duration without the guard — which is the bug it exists to stop', () => {
		// 15 of 33 presses were reported wasted this way before the guard went in; the real answer
		// was 0.
		expect(remainingAtCast(timeline, castAt, TIGER_POWER, 0)).toBe(19998);
	});

	it('still ignores an event right at the edge of the guard', () => {
		const edge = auraTimeline([ev(0, 'applybuff'), ev(castAt - SELF_EVENT_MS, 'refreshbuff')], TIGER_POWER, T0);
		expect(remainingAtCast(edge, castAt, TIGER_POWER)).toBe(0);
	});

	it('counts a refresh that happened well before the cast', () => {
		const earlier = auraTimeline([ev(0, 'applybuff'), ev(5000, 'refreshbuff')], TIGER_POWER, T0);
		// Refreshed at 5s for 20s, so a press at 10s clipped 15s of a healthy buff.
		expect(remainingAtCast(earlier, 10000, TIGER_POWER)).toBe(15000);
	});

	it('reports nothing left once the aura came off', () => {
		const dropped = auraTimeline([ev(0, 'applybuff'), ev(8000, 'removebuff')], TIGER_POWER, T0);
		expect(remainingAtCast(dropped, 10000, TIGER_POWER)).toBe(0);
	});

	it('reports nothing before the aura was ever applied', () => {
		expect(remainingAtCast(timeline, 0, TIGER_POWER)).toBe(0);
	});

	it('invents no remaining time for an aura with no declared duration', () => {
		const undated: Aura = { key: 'x', name: 'X', ids: [1], kind: 'buff' };
		const line = auraTimeline(
			[
				{
					timestamp: T0,
					type: 'applybuff',
					abilityGameID: 1,
					targetID: 1,
				},
			],
			undated,
			T0,
		);
		expect(remainingAtCast(line, 5000, undated)).toBe(0);
	});
});

describe('levelAt', () => {
	const LIGHTNING_SHIELD: Aura = {
		key: 'lightning-shield',
		name: 'Lightning Shield',
		ids: [324],
		kind: 'buff',
		maxStacks: 7,
	};

	function stack(t: number, type: string, n: number): WclEvent {
		return { timestamp: T0 + t, type, abilityGameID: 324, sourceID: 1, targetID: 1, stack: n };
	}

	it('reads the shield before a drain the press itself caused', () => {
		// Earth Shock logs its Fulmination drain one millisecond *before* the cast that caused it, so
		// sampling the counter at the cast reads a shield that has already been emptied — 1 instead of
		// the 7 the press actually spent.
		const levels = auraLevels(
			[stack(35534, 'applybuffstack', 7), stack(36622, 'removebuffstack', 1)],
			LIGHTNING_SHIELD,
			T0,
			T0 + 40000,
		);
		expect(levelAt(levels, 36623)).toBe(7);
	});

	it('reads the shield before a drain that shares the cast timestamp', () => {
		const levels = auraLevels(
			[stack(22628, 'applybuffstack', 7), stack(22998, 'removebuffstack', 1)],
			LIGHTNING_SHIELD,
			T0,
			T0 + 40000,
		);
		expect(levelAt(levels, 22998)).toBe(7);
	});

	it('reads the level that actually held away from any press', () => {
		const levels = auraLevels([stack(1000, 'applybuffstack', 3)], LIGHTNING_SHIELD, T0, T0 + 40000);
		expect(levelAt(levels, 2000)).toBe(3);
	});

	it('returns null when the aura was down at the press', () => {
		const levels = auraLevels(
			[stack(1000, 'applybuffstack', 2), { timestamp: T0 + 2000, type: 'removebuff', abilityGameID: 324, targetID: 1 }],
			LIGHTNING_SHIELD,
			T0,
			T0 + 40000,
		);
		expect(levelAt(levels, 5000)).toBeNull();
	});
});

/**
 * The gap ledger both specs' dot sections are built on.
 *
 * It has two modes and the difference between them is not cosmetic: without a contact clock it
 * forgives the *largest* gap unconditionally, which on a single-phase pull is the one real drop the
 * player made. That is a live hazard, so both modes are pinned here.
 */
describe('auraDrops', () => {
	const iv = (...pairs: Array<[number, number]>): Interval[] => pairs;

	describe('without a contact clock — the longest-gap heuristic', () => {
		it('has nothing to say about an empty or single window', () => {
			expect(auraDrops(iv())).toEqual({ drops: [], intermissionMs: 0 });
			expect(auraDrops(iv([0, 10_000]))).toEqual({ drops: [], intermissionMs: 0 });
		});

		it('forgives the longest gap and reports the rest', () => {
			const { drops, intermissionMs } = auraDrops(iv([0, 10_000], [40_000, 50_000], [55_000, 60_000]));
			// Gaps are 30s and 5s: the 30s is written off, the 5s is reported.
			expect(intermissionMs).toBe(30_000);
			expect(drops).toEqual([{ t: 50_000, ms: 5000 }]);
		});

		/** The hazard, stated as a test: one drop on a one-phase pull is the longest gap there is. */
		it('reports nothing at all when the only gap is the longest one', () => {
			expect(auraDrops(iv([0, 30_000], [50_000, 120_000]))).toEqual({ drops: [], intermissionMs: 20_000 });
		});

		it('drops exactly one of two gaps of identical length, not both', () => {
			const { drops } = auraDrops(iv([0, 1000], [6000, 7000], [12_000, 13_000]));
			// Both gaps are 5s. Excluding by value would forgive both; excluding by position forgives one.
			expect(drops).toHaveLength(1);
			expect(drops[0]?.ms).toBe(5000);
		});

		it('ignores sub-threshold jitter', () => {
			// Gaps of 900ms and 800ms: the longer is forgiven as the "intermission", the other is jitter.
			expect(auraDrops(iv([0, 1000], [1900, 3000], [3800, 5000])).drops).toEqual([]);
		});
	});

	describe('with a contact clock — evidence-based', () => {
		/**
		 * The reference pull, `a:qHRAFwdGzaB6MPYC` #14. Four gaps — 36ms, 888ms, 643ms and 41 914ms —
		 * against contact of `[[1012, 142282], [192534, 257821]]`. Three are jitter; the long one carries
		 * 529ms of contact against 41.4s of absence, and is the boss submerging.
		 */
		it('forgives a gap the player was away for, and says how much it forgave', () => {
			const windows = iv([2631, 32_291], [32_327, 90_171], [91_059, 120_869], [121_512, 151_149], [193_063, 258_263]);
			const away = iv([0, 1012], [142_282, 192_534], [257_821, 258_304]);
			const { drops, intermissionMs } = auraDrops(windows, DROP_MS, away);
			expect(drops).toEqual([]);
			expect(intermissionMs).toBe(41_385);
		});

		/** And the case the heuristic hid: the same 20s hole, taken with the boss in reach. */
		it('reports a gap the player was present for, however large', () => {
			const { drops, intermissionMs } = auraDrops(iv([0, 30_000], [50_000, 120_000]), DROP_MS, iv());
			expect(drops).toEqual([{ t: 30_000, ms: 20_000 }]);
			expect(intermissionMs).toBe(0);
		});

		it('charges only the exposed part of a partly-covered gap', () => {
			// A 20s gap with 15s of it spent out of contact leaves 5s of fault.
			const { drops, intermissionMs } = auraDrops(iv([0, 10_000], [30_000, 40_000]), DROP_MS, iv([10_000, 25_000]));
			expect(drops).toEqual([{ t: 10_000, ms: 5000 }]);
			expect(intermissionMs).toBe(15_000);
		});

		it('still ignores jitter that happened in full contact', () => {
			expect(auraDrops(iv([0, 10_000], [10_900, 20_000]), DROP_MS, iv()).drops).toEqual([]);
		});
	});
});
