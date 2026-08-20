import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';

import { intervalsAtLeast, isJudgeableTarget, overlapPoints, spawnLives, targetCounts } from '../targets';

/**
 * The per-moment target count, pinned at the shapes that decide whether a pull reads as an add fight.
 *
 * The window is the whole design, so both of its edges are asserted: a hit entering it, and a hit
 * ageing out of it. A count that only ever rose would call every pull that ever saw two enemies a
 * multi-target pull for the rest of its length.
 */
describe('targetCounts', () => {
	const WINDOW = 5000;

	it('counts a second enemy from the moment it is hit and drops it when the first ages out', () => {
		expect(
			targetCounts(
				[
					{ t: 0, target: 1 },
					{ t: 1000, target: 2 },
				],
				WINDOW,
			),
		).toEqual([
			[0, 1],
			[1000, 2],
			[5000, 1],
			[6000, 0],
		]);
	});

	/** Two hits on one enemy are one target, and the later hit keeps it counted after the first expires. */
	it('does not count the same enemy twice', () => {
		expect(
			targetCounts(
				[
					{ t: 0, target: 1 },
					{ t: 1000, target: 1 },
				],
				WINDOW,
			),
		).toEqual([
			[0, 1],
			[6000, 0],
		]);
	});

	it('emits a point only where the answer changes', () => {
		const points = targetCounts(
			Array.from({ length: 6 }, (_, i) => ({ t: i * 500, target: 1 })),
			WINDOW,
		);
		expect(points).toEqual([
			[0, 1],
			[7500, 0],
		]);
	});

	/**
	 * The one that survived longest, because nothing here was asking it.
	 *
	 * WarcraftLogs gives one actor id to an NPC *type*, so every Kor'kron Ironblade standing on a monk
	 * arrives as the same `target` and they are told apart only by `targetInstance`. Counting on the id
	 * alone therefore counts enemy *kinds* and calls all ten of them one enemy — measured on the
	 * Galakras kill in `a:6MhZgjyAknFWrYfK`, 13 ids against the 45 spawns the player actually hit.
	 * Everything reading this series inherited the smaller number: the multi-target share, the detected
	 * mode, and the band the priority ladder judges every press at.
	 */
	it('counts two live copies of one NPC as two enemies, not one', () => {
		expect(
			targetCounts(
				[
					{ t: 0, target: 1, instance: 1 },
					{ t: 1000, target: 1, instance: 2 },
				],
				WINDOW,
			),
		).toEqual([
			[0, 1],
			[1000, 2],
			[5000, 1],
			[6000, 0],
		]);
	});

	/** The other half of it: one spawn hit twice is one enemy, however many copies share its id. */
	it('does not count one spawn twice because a sibling shares its id', () => {
		expect(
			targetCounts(
				[
					{ t: 0, target: 1, instance: 3 },
					{ t: 1000, target: 1, instance: 3 },
				],
				WINDOW,
			),
		).toEqual([
			[0, 1],
			[6000, 0],
		]);
	});

	/**
	 * A caller with no instance to give — an old report, or the Storm, Earth and Fire audit, which wants
	 * the actor id its per-target lanes are labelled with — gets one bucket per id, exactly as before
	 * the field existed. Checked against real logs: no target in the reference reports ever mixes an
	 * absent instance with a numbered one, so the two forms never describe the same spawn.
	 */
	it('buckets a hit with no instance on its id alone', () => {
		expect(
			targetCounts(
				[
					{ t: 0, target: 1 },
					{ t: 1000, target: 1 },
				],
				WINDOW,
			),
		).toEqual([
			[0, 1],
			[6000, 0],
		]);
	});

	it('has nothing to say about a pull with no hits', () => {
		expect(targetCounts([], WINDOW)).toEqual([]);
	});

	it('does not care what order the hits arrive in', () => {
		const shuffled = targetCounts(
			[
				{ t: 1000, target: 2 },
				{ t: 0, target: 1 },
			],
			WINDOW,
		);
		expect(shuffled).toEqual([
			[0, 1],
			[1000, 2],
			[5000, 1],
			[6000, 0],
		]);
	});
});

describe('intervalsAtLeast', () => {
	it('runs each stretch from the point that reached the count to the one that did not', () => {
		expect(
			intervalsAtLeast(
				[
					[0, 1],
					[1000, 2],
					[5000, 1],
					[6000, 0],
				],
				2,
				10_000,
			),
		).toEqual([[1000, 5000]]);
	});

	/** A count still up when the series ends runs to the end of the pull, which is the caller's number. */
	it('closes an open stretch at the end of the pull', () => {
		expect(
			intervalsAtLeast(
				[
					[0, 1],
					[4000, 3],
				],
				2,
				12_000,
			),
		).toEqual([[4000, 12_000]]);
	});

	it('finds nothing in a series that never reached the count', () => {
		expect(intervalsAtLeast([[0, 1]], 2, 10_000)).toEqual([]);
	});
});

/**
 * The Stormlash overlap, and the two cases the hand-written boundary sweep it replaced got wrong.
 *
 * Measured against the old sweep rather than assumed: it handled the plain cases correctly, and got
 * exactly two things wrong. An overlap still running when the pull ended was emitted with the
 * window's own expiry — `{5000, 30000}` on a 20 000 ms pull — and two windows sharing one instant
 * produced a zero-length overlap the section then drew as a band. `intervalsAtLeast` clamps the tail;
 * `overlapPoints` drops the empty window.
 */
describe('overlapPoints', () => {
	const overlaps = (windows: Array<[number, number]>, endMs: number) =>
		intervalsAtLeast(overlapPoints(windows), 2, endMs);

	it('counts the running depth of overlapping windows', () => {
		expect(
			overlapPoints([
				[0, 10],
				[5, 15],
			]),
		).toEqual([
			[0, 1],
			[5, 2],
			[10, 1],
			[15, 0],
		]);
	});

	it('finds the stretch two windows shared', () => {
		expect(
			overlaps(
				[
					[0, 10_000],
					[6000, 16_000],
				],
				20_000,
			),
		).toEqual([[6000, 10_000]]);
	});

	/** Not a case the old sweep got wrong — kept so a rewrite cannot break what already worked. */
	it('closes an overlap when both windows end on the same instant', () => {
		expect(
			overlaps(
				[
					[0, 10_000],
					[4000, 10_000],
				],
				20_000,
			),
		).toEqual([[4000, 10_000]]);
	});

	/** Defect one: the old sweep returned `{5000, 30000}` here, longer than the 20s pull. */
	it('clamps an overlap still open at the end of the pull', () => {
		expect(
			overlaps(
				[
					[0, 30_000],
					[5000, 30_000],
				],
				20_000,
			),
		).toEqual([[5000, 20_000]]);
	});

	it('does not read two windows that merely touch as overlapping', () => {
		expect(
			overlaps(
				[
					[0, 10_000],
					[10_000, 20_000],
				],
				20_000,
			),
		).toEqual([]);
	});

	it('reports nothing for a lone window, and nothing for none', () => {
		expect(overlaps([[0, 10_000]], 20_000)).toEqual([]);
		expect(overlaps([], 20_000)).toEqual([]);
	});

	/** Defect two: the old sweep emitted `{5000, 5000}`, a band with no width. */
	it('drops a zero-length window rather than counting it as an opening', () => {
		expect(
			overlaps(
				[
					[5000, 5000],
					[0, 10_000],
				],
				20_000,
			),
		).toEqual([]);
	});

	it('holds one point per instant when several edges land together', () => {
		// Three totems opening at once must read as a depth of three, never as a dip through one and two.
		expect(
			overlapPoints([
				[0, 10],
				[0, 10],
				[0, 10],
			]),
		).toEqual([
			[0, 3],
			[10, 0],
		]);
	});
});

/**
 * Which enemies deserve to be counted, which is the question `targetCounts` is only as good as.
 *
 * Both clauses of one predicate, and the synthetic halves of the two real cases: a unit that has only
 * ever returned immune (the Crawler Mines on Iron Juggernaut), and a unit that arrived and died before a
 * dot on it could pay for the global that applied it. `spawnLives` reads the log's own outcome off
 * `hitType`, so the value 10 is asserted here as well as commented — a wrong constant there would not
 * fail, it would silently match nothing.
 */
describe('spawnLives and isJudgeableTarget', () => {
	const WINDOW = 5000;
	const END = 200_000;
	const hit = (t: number, target: number, instance: number | undefined, hitType: number): WclEvent => ({
		type: 'damage',
		timestamp: t,
		sourceID: 1,
		targetID: target,
		...(instance === undefined ? {} : { targetInstance: instance }),
		abilityGameID: 100,
		hitType,
		amount: hitType === IMMUNE ? 0 : 1000,
	});
	const HIT = 1;
	const IMMUNE = 10;

	it('marks a spawn immune only when every hit on it came back immune', () => {
		const lives = spawnLives(
			[
				// The mine: three hits, all immune.
				hit(1000, 9, 1, IMMUNE),
				hit(2000, 9, 1, IMMUNE),
				hit(3000, 9, 1, IMMUNE),
				// The boss: immune for a phase in the middle of a pull it loses anyway.
				hit(1000, 8, undefined, HIT),
				hit(71_000, 8, undefined, IMMUNE),
				hit(72_000, 8, undefined, IMMUNE),
				hit(150_000, 8, undefined, HIT),
			],
			0,
			END,
			WINDOW,
		);
		expect(lives.get('9:1')?.immune).toBe(true);
		expect(lives.get('8:-')?.immune).toBe(false);
		expect(isJudgeableTarget(lives.get('9:1'))).toBe(false);
		expect(isJudgeableTarget(lives.get('8:-'))).toBe(true);
	});

	/**
	 * Two copies of one actor id, one immune and one not — which is why the verdict is keyed by spawn.
	 * An id-level answer is an answer about an enemy *kind*, and WarcraftLogs hands ten simultaneous adds
	 * one `targetID`.
	 */
	it('reaches its verdict per spawn rather than per actor id', () => {
		const lives = spawnLives([hit(1000, 9, 1, IMMUNE), hit(1000, 9, 2, HIT)], 0, END, WINDOW);
		expect(isJudgeableTarget(lives.get('9:1'))).toBe(false);
		expect(isJudgeableTarget(lives.get('9:2'))).toBe(true);
	});

	it('is not a target at all when the player never hit it', () => {
		expect(isJudgeableTarget(spawnLives([], 0, END, WINDOW).get('9:1'))).toBe(false);
	});

	/**
	 * The lifetime clause, both directions. 30 seconds of life still scores; 5 seconds does not, and the
	 * threshold is exclusive — "lived *more than* 20 seconds".
	 */
	it('scores a second target that lived long enough and refuses one that did not', () => {
		const lives = spawnLives(
			[
				hit(10_000, 9, 1, HIT),
				hit(40_000, 9, 1, HIT), // 30s
				hit(10_000, 9, 2, HIT),
				hit(15_000, 9, 2, HIT), // 5s
				hit(10_000, 9, 3, HIT),
				hit(30_000, 9, 3, HIT), // exactly 20s
			],
			0,
			END,
			WINDOW,
		);
		expect(lives.get('9:1')?.lifetimeMs).toBe(30_000);
		expect(lives.get('9:2')?.lifetimeMs).toBe(5000);
		expect(isJudgeableTarget(lives.get('9:1'), { minLifetimeMs: 20_000 })).toBe(true);
		expect(isJudgeableTarget(lives.get('9:2'), { minLifetimeMs: 20_000 })).toBe(false);
		expect(isJudgeableTarget(lives.get('9:3'), { minLifetimeMs: 20_000 })).toBe(false);
		// The plain question ignores lifetime entirely: the five-second add was still a target.
		expect(isJudgeableTarget(lives.get('9:2'))).toBe(true);
	});

	/**
	 * A unit still being hit when the bell goes has no observable end, so its life runs to the pull's
	 * end rather than to the accident of when the player last swung at it. Without this, a mob alive at
	 * the finish is scored on its last hit and can fail a threshold it never had a chance to clear.
	 */
	it('runs a spawn still being hit at the bell to the end of the pull', () => {
		const lives = spawnLives([hit(180_000, 9, 1, HIT), hit(196_000, 9, 1, HIT)], 0, END, WINDOW);
		// Last hit 196s, one window short of the 200s end, so the life is 200s - 180s and not 16s.
		expect(lives.get('9:1')?.lifetimeMs).toBe(20_000);
		// And one that stopped being hit well before the bell is measured to its last hit.
		const early = spawnLives([hit(10_000, 9, 1, HIT), hit(26_000, 9, 1, HIT)], 0, END, WINDOW);
		expect(early.get('9:1')?.lifetimeMs).toBe(16_000);
	});

	/**
	 * Fight-relative, like every other timestamp in the engine: `t0` comes off before anything else.
	 *
	 * Asserted through the bell clamp on purpose, because that is the only place it can be caught. A
	 * lifetime is a *difference*, so `t0` cancels out of it and a test that only checks the span passes
	 * whether the subtraction happened or not — one was written that way here first. The clamp is the
	 * one comparison against an absolute number (`endMs`), so leaving `t0` in makes a spawn hit at 180s
	 * of a 200s pull read as ending before it began, and the lifetime collapses to zero.
	 */
	it('measures against the fight clock rather than the report clock', () => {
		const lives = spawnLives([hit(280_000, 9, 1, HIT), hit(296_000, 9, 1, HIT)], 100_000, END, WINDOW);
		expect(lives.get('9:1')?.lifetimeMs).toBe(20_000);
	});
});
