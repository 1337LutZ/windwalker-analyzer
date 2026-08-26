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

/**
 * A 12s cooldown behind a **2s cast** — the only shape that can tell the two clocks apart, and the
 * only one either spec declares (the `elemental-blast` entry in `specs/elemental/lib/index.ts`, named
 * rather than numbered — the line citation this replaced had rotted by 74 lines). Every other
 * cooldown-gated button in this report is an instant, where the commit and the landing are the same
 * millisecond and nothing below could see a difference.
 */
const ELEMENTAL_BLAST: Ability = {
	key: 'elemental-blast',
	name: 'Elemental Blast',
	castIds: [117014],
	onGcd: true,
	castTimeMs: 2000,
	gate: 'cooldown',
	cooldownMs: 12_000,
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

	/**
	 * A window closes at the **commit** and opens at the **completion**, and the asymmetry is the whole
	 * point — see the docblock on `cooldownDrift` for the argument.
	 *
	 * Every case here is built from a *pair* of clocks that a real log would produce for a 2s cast: the
	 * landings and the begincasts two seconds ahead of them. The independent fact each one is anchored on
	 * is what perfect play looks like, not the arithmetic of the function: a button pressed the instant it
	 * came back has drifted by nothing, and a metric that says otherwise is broken however consistently
	 * it says it.
	 */
	describe('on a cast-time cooldown', () => {
		it('charges nothing when every cast was committed the instant the button came back', () => {
			// Flawless play on a 12s cooldown behind a 2s cast: commit at 0, land at 2s, the cooldown
			// starts there and is back at 14s, commit again at 14s. Seven casts, no held button.
			const commits = [0, 14000, 28000, 42000, 56000, 70000, 84000];
			const landings = commits.map((t) => t + 2000);
			const drift = cooldownDrift(landings, ELEMENTAL_BLAST, WHOLE_FIGHT, FIGHT_MS, 1500, commits);
			expect(drift.windows).toEqual([]);
			expect(drift.driftMs).toBe(0);
			expect(drift.lostCasts).toBe(0);
		});

		it('charges a held button only up to the moment the next press was committed', () => {
			// Ready at 14s, committed at 48s, landed at 50s. 34s was spent not pressing it; the last two
			// seconds were spent pressing it, and charging those says the cast itself was the mistake.
			const drift = cooldownDrift([2000, 50000], ELEMENTAL_BLAST, WHOLE_FIGHT, FIGHT_MS, 1500, [0, 48000]);
			expect(drift.windows).toEqual([{ start: 14000, end: 48000, ms: 34000 }]);
			expect(drift.driftMs).toBe(34000);
			expect(drift.lostCasts).toBe(2);
		});

		it('ends the opener at the first commit, not at the first landing', () => {
			// The button stopped sitting unused when the player started casting it.
			const drift = cooldownDrift([30000], ELEMENTAL_BLAST, WHOLE_FIGHT, FIGHT_MS, 1500, [28000]);
			expect(drift.openerMs).toBe(28000);
		});

		it('keeps the tail on the completion clock, because that is when the last cooldown started', () => {
			// The other end is not symmetric and must not be made so: a cooldown starts when the cast
			// *lands*, so the button in this pull came back at 50s + 12s and sat there to the end of the pull.
			const drift = cooldownDrift([2000, 50000], ELEMENTAL_BLAST, WHOLE_FIGHT, FIGHT_MS, 1500, [0, 48000]);
			expect(drift.tailMs).toBe(58000);
		});

		it('falls back to the landings when no commit clock is supplied', () => {
			// The contract a caller with one clock relies on: `specs/windwalker/lib/index.ts` passes five
			// arguments for Xuen, and its spec declares no `castTimeMs` at all, so the landings *are* the
			// commits there. Omitting the clock must therefore mean "they are the same", not "guess".
			const landings = [2000, 50000];
			expect(cooldownDrift(landings, ELEMENTAL_BLAST, WHOLE_FIGHT, FIGHT_MS, 1500)).toEqual(
				cooldownDrift(landings, ELEMENTAL_BLAST, WHOLE_FIGHT, FIGHT_MS, 1500, landings),
			);
		});

		it('is identical on an instant however the clock is passed', () => {
			// The claim that no committed figure moves, asserted rather than reasoned: for a button with no
			// cast time the two clocks are one, so every figure in this file is clock-independent.
			const times = [0, 20000, 24000, 60000];
			expect(cooldownDrift(times, RISING_SUN_KICK, WHOLE_FIGHT, FIGHT_MS, 1500, times)).toEqual(
				cooldownDrift(times, RISING_SUN_KICK, WHOLE_FIGHT, FIGHT_MS),
			);
		});
	});
});

/**
 * A cooldown that moves with haste, which is a thing no spec in this repository had until Protection.
 *
 * Sanctity of Battle turns melee haste into cooldown reduction, so `Ability.cooldownMs` is the value
 * at no haste and the value on no real pull. The curve answers at the moment of the *press*, because
 * the game arms a cooldown when the button goes out — a press before Bloodlust runs its full length
 * and one inside it does not.
 */
describe('a haste-scaled cooldown', () => {
	/** A 9s cooldown at 50% haste is a 6s one, and the drift has to be measured against the 6. */
	const HOLY_WRATH: Ability = {
		key: 'holy-wrath',
		name: 'Holy Wrath',
		castIds: [119_072],
		onGcd: true,
		gate: 'cooldown',
		cooldownMs: 9000,
		hasteScaled: true,
	};

	/**
	 * The claim that keeps every committed capture where it is: passing nothing changes nothing.
	 *
	 * Both existing specs declare no `cooldownAt`, so this is the path all ten of their captures take,
	 * and it has to be the same arithmetic it was before the parameter existed.
	 */
	it('is the declared number when no curve is passed', () => {
		const times = [0, 12_000, 30_000];
		expect(cooldownDrift(times, HOLY_WRATH, WHOLE_FIGHT, FIGHT_MS)).toEqual(
			cooldownDrift(times, HOLY_WRATH, WHOLE_FIGHT, FIGHT_MS, 1500, times, undefined),
		);
	});

	/**
	 * A flat curve and no curve agree, which is what makes the two paths one rule rather than two.
	 *
	 * Worth asserting rather than reasoning about: the `lostCasts` arithmetic genuinely differs between
	 * them — one divides the total drift, the other prices each window and sums — and they must land on
	 * the same number wherever the cooldown does not move.
	 */
	it('agrees with the flat case when the curve does not move', () => {
		const times = [0, 20_000, 44_000];
		expect(cooldownDrift(times, HOLY_WRATH, WHOLE_FIGHT, FIGHT_MS, 1500, times, () => 9000)).toEqual(
			cooldownDrift(times, HOLY_WRATH, WHOLE_FIGHT, FIGHT_MS),
		);
	});

	/**
	 * The finding the whole feature is for: a hasted pull is not idle where the base number says it is.
	 *
	 * Two presses 7s apart, on a button whose base cooldown is 9s. Read against the base the button was
	 * never even ready, so there is no drift and the press looks early. Read at 50% haste the cooldown
	 * is 6s, the button sat ready for a second, and the pull is described correctly.
	 */
	it('finds drift the base number cannot see', () => {
		const times = [0, 7_000];
		const flat = cooldownDrift(times, HOLY_WRATH, WHOLE_FIGHT, FIGHT_MS, 500);
		const hasted = cooldownDrift(times, HOLY_WRATH, WHOLE_FIGHT, FIGHT_MS, 500, times, () => 6000);

		expect(flat.driftMs).toBe(0);
		expect(hasted.windows).toEqual([{ start: 6000, end: 7000, ms: 1000 }]);
		expect(hasted.driftMs).toBe(1000);
	});

	/**
	 * And the other direction, which is the one that would invent a fault rather than miss one.
	 *
	 * A button pressed on a 6s cooldown, graded against 9s, reads as a player pressing something that
	 * was not available — the drift walk cannot say that, so what it does instead is charge the *next*
	 * gap with three seconds of idle time that never happened. The curve removes it.
	 */
	it('stops the base number inventing idle time between presses', () => {
		const times = [0, 6_000, 12_000, 18_000];
		const flat = cooldownDrift(times, HOLY_WRATH, WHOLE_FIGHT, FIGHT_MS, 500);
		const hasted = cooldownDrift(times, HOLY_WRATH, WHOLE_FIGHT, FIGHT_MS, 500, times, () => 6000);

		// Pressed exactly on the hasted cooldown three times over: nothing was ever idle.
		expect(hasted.driftMs).toBe(0);
		expect(hasted.lostCasts).toBe(0);
		// The flat reading agrees on the drift, and only because every press is *early* against 9s —
		// which is the half of the error that hides. What it gets wrong is the tail: it believes the
		// button was still on cooldown for three seconds it had actually come back in, and forgives
		// three seconds of idle time at the end of the pull that really happened.
		expect(hasted.tailMs - flat.tailMs).toBe(3000);
	});

	/**
	 * The curve is asked at the press, not at the question — so Bloodlust only shortens what it covers.
	 *
	 * A pull with the lust up for its first forty seconds: the press at 0s stamps a 4.6s cooldown and
	 * the press at 50s stamps the base 6s. A model that asked once and applied one answer to the pull
	 * would be wrong in one direction or the other for most of it.
	 */
	it('asks the curve at the press rather than once for the pull', () => {
		const lustUntil = 40_000;
		const curve = (t: number) => (t < lustUntil ? 4600 : 6000);
		const times = [0, 10_000, 50_000, 62_000];
		const drift = cooldownDrift(times, HOLY_WRATH, WHOLE_FIGHT, FIGHT_MS, 500, times, curve);

		// 0 + 4.6s ready, pressed at 10s: 5.4s idle under the lust. 10s + 4.6s ready, pressed at 50s:
		// 35.4s idle. 50s + 6s ready, pressed at 62s: 6s idle, priced at the un-lusted cooldown.
		expect(drift.windows.map((w) => w.ms)).toEqual([35_400, 6_000, 5_400]);
		// Each window priced at the cooldown that was running when it opened: 35400/4600 = 7, 6000/6000
		// = 1, 5400/4600 = 1. Nine, where dividing the 46.8s total by either number alone gives ten or
		// seven.
		expect(drift.lostCasts).toBe(9);
	});

	/** A curve that answers nonsense falls back to the declared number rather than dividing by zero. */
	it('refuses a curve that answers zero', () => {
		const times = [0, 30_000];
		expect(cooldownDrift(times, HOLY_WRATH, WHOLE_FIGHT, FIGHT_MS, 500, times, () => 0)).toEqual(
			cooldownDrift(times, HOLY_WRATH, WHOLE_FIGHT, FIGHT_MS, 500),
		);
	});
});
