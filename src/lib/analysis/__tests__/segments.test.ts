// The segments are a partition with labels on it, and the two halves fail in different ways.
//
// The **partition** is an invariant every downstream sum leans on — a scorecard split per segment has
// to add back up to the whole-pull one — so it is asserted structurally on every input this file can
// think of, including the degenerate ones, rather than spot-checked on a fixture.
//
// The **labels** are a tuning question, and the property that makes them tunable at all is
// *monotonicity*: the segment count must never rise as the floor rises. Greedy absorption of short runs
// fails exactly that (Spoils of Pandaria came out 15s = 4, 20s = 1, 25s = 1, 30s = 2 segments), which is
// why hysteresis is the algorithm. That is asserted over generated series rather than one hand-picked
// case, because a hand-picked case is what the greedy version passed.
//
// The one fixture assertion is Galakras, and it earns its brittleness: the plan published a measured
// twelve-section cut of that pull from a scratchpad prototype, and reproducing it boundary for boundary
// is the only evidence available in-tree that this is the same algorithm. The fourteen-pull reference
// figures — 84 contact segments with 22 mixed at an 8s floor — cannot be checked here; six Siege pulls
// are committed, not fourteen.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
	type FightSegment,
	SEGMENT_FLOOR_MS,
	SEGMENT_MIXED_SHARE,
	type SegmentOptions,
	segmentPull,
	type SegmentTimeline,
} from '../segments';

type Point = readonly [number, number];

/** The tree's own two clocks: `ENGAGED_GAP_MS` and `SpecThresholds.targetWindowMs`, so downtime cuts at 10s. */
const CLOCKS = { contactGapMs: 15_000, windowMs: 5000 } as const;

const cut = (points: readonly Point[], durationMs: number, over: Partial<SegmentOptions> = {}): SegmentTimeline =>
	segmentPull(points, durationMs, { ...CLOCKS, ...over });

/** Every invariant that does not depend on what the series said — asserted on every timeline this file builds. */
const partitions = (timeline: SegmentTimeline, durationMs: number): void => {
	const { segments } = timeline;
	if (durationMs <= 0) {
		expect(segments).toEqual([]);
		return;
	}

	expect(segments.length).toBeGreaterThan(0);
	expect(segments[0]?.startMs).toBe(0);
	expect(segments[segments.length - 1]?.endMs).toBe(durationMs);

	for (const [i, segment] of segments.entries()) {
		expect(segment.index).toBe(i);
		expect(segment.endMs).toBeGreaterThan(segment.startMs);
		const previous = segments[i - 1];
		if (previous !== undefined) expect(segment.startMs).toBe(previous.endMs);

		// The count ledger is the segment's own clock, redistributed: if it did not sum back the segment
		// would be publishing time it never held, and every per-count figure read off it would be wrong.
		const ledger = Object.values(segment.msByCount).reduce((sum, ms) => sum + ms, 0);
		expect(ledger).toBe(segment.endMs - segment.startMs);
	}
};

/**
 * A deterministic pseudo-random step series, in the shape `targetCounts` emits.
 *
 * Seeded rather than random: a monotonicity failure has to be reproducible from the seed alone, and a
 * property test that cannot be replayed is a flake generator. Counts run 0–6 so both the downtime cut and
 * all three contact modes get exercised, and adjacent duplicates are left in — the real series records one
 * point per change, but this module must not depend on that.
 */
const generated = (seed: number): { points: Point[]; durationMs: number } => {
	let state = ((seed * 48_271) % 2_147_483_647) + 1;
	const next = (): number => {
		state = (state * 48_271) % 2_147_483_647;
		return state / 2_147_483_647;
	};

	const durationMs = 60_000 + Math.floor(next() * 400_000);
	const moments = new Set<number>();
	for (let i = 0; i < 1 + Math.floor(next() * 60); i += 1) moments.add(Math.floor(next() * durationMs));
	const points = [...moments].sort((a, b) => a - b).map((t): Point => [t, Math.floor(next() * 7)]);
	return { points, durationMs };
};

const FIXTURES = ['cleave', 'mixed', 'poor', 'strong', 'waves', 'weave'] as const;

/**
 * The ladder's series off a committed fixture — `aplCounts`, falling back to `counts` as `bandsInPull` does.
 *
 * `aplCounts` rather than `counts` because that is what the prototype measured: on Galakras the two
 * disagree by about 300ms at two of the five downtime boundaries (the evidence series counts an enemy the
 * Rushing Jade Wind exclusion drops), and the published trace matches the ladder's series exactly.
 */
const fixtureSeries = (name: string): { points: Point[]; durationMs: number } => {
	const raw = JSON.parse(
		readFileSync(resolve(import.meta.dirname, `../../../specs/windwalker/__fixtures__/${name}.json`), 'utf8'),
	) as {
		durationMs: number;
		targets: { counts: { points: Point[] }; aplCounts?: { points: Point[] } };
	};
	return { points: raw.targets.aplCounts?.points ?? raw.targets.counts.points, durationMs: raw.durationMs };
};

const lengthOf = (segment: FightSegment): number => segment.endMs - segment.startMs;

describe('the partition', () => {
	it('tiles the pull on a series that opens late and closes early', () => {
		// The series starts at the first landed hit and its last point can be a window past the pull, so
		// neither end of the partition comes from the series itself.
		const timeline = cut(
			[
				[12_000, 2],
				[40_000, 4],
				[95_000, 0],
			],
			90_000,
		);
		partitions(timeline, 90_000);
	});

	it('tiles the pull on an empty series, which is a player who damaged nothing', () => {
		const timeline = cut([], 300_000);
		partitions(timeline, 300_000);
		expect(timeline.segments).toHaveLength(1);
		expect(timeline.segments[0]?.mode).toBe('idle');
		expect(timeline.segments[0]?.msByCount).toEqual({ 0: 300_000 });
	});

	it('tiles the pull on a single-point series', () => {
		partitions(cut([[12_000, 3]], 60_000), 60_000);
		partitions(cut([[0, 1]], 3000), 3000);
	});

	it('has nothing to partition on a pull of no length', () => {
		partitions(cut([[0, 1]], 0), 0);
	});

	it('tiles the pull on a hundred generated series, at three floors each', () => {
		for (let seed = 1; seed <= 100; seed += 1) {
			const { points, durationMs } = generated(seed);
			for (const floorMs of [0, SEGMENT_FLOOR_MS, 45_000]) partitions(cut(points, durationMs, { floorMs }), durationMs);
		}
	});

	it('tiles every committed Siege pull', () => {
		for (const name of FIXTURES) {
			const { points, durationMs } = fixtureSeries(name);
			partitions(cut(points, durationMs), durationMs);
		}
	});
});

/**
 * The property greedy absorption fails, and the whole reason the boundary rule is hysteresis.
 *
 * A floor that does not move the segment count in one direction cannot be tuned or explained, and two
 * implementations of the same idea would disagree about the same pull. The measured failure, from the
 * scratchpad prototype's greedy pass:
 *
 * ```
 * Spoils of Pandaria    15s = 4    20s = 1    25s = 1    30s = 2
 * Kor'kron Dark Shaman  15s = 2    20s = 1    25s = 2    30s = 2
 * ```
 */
describe('monotonicity in the floor', () => {
	const FLOORS = Array.from({ length: 41 }, (_, i) => i * 1000);

	it('never produces more segments as the floor rises, over two hundred generated series', () => {
		for (let seed = 1; seed <= 200; seed += 1) {
			const { points, durationMs } = generated(seed);
			const counts = FLOORS.map((floorMs) => cut(points, durationMs, { floorMs }).segments.length);
			for (const [i, count] of counts.entries()) {
				const previous = counts[i - 1];
				if (previous !== undefined) {
					expect(
						count,
						`seed ${seed}: floor ${FLOORS[i]}ms gave ${count} against ${previous} at ${FLOORS[i - 1]}ms`,
					).toBeLessThanOrEqual(previous);
				}
			}
		}
	});

	it('never produces more segments as the floor rises, on every committed Siege pull', () => {
		for (const name of FIXTURES) {
			const { points, durationMs } = fixtureSeries(name);
			const counts = FLOORS.map((floorMs) => cut(points, durationMs, { floorMs }).segments.length);
			expect(counts, name).toEqual([...counts].sort((a, b) => b - a));
		}
	});
});

describe('dominance and the mixed label', () => {
	it('names the segment after the mode that held the most of it, not the one it entered in', () => {
		// Enters `single` — that is the first thing to hold the floor — and then spends three quarters of
		// itself at four enemies. Labelling it `single` is how an earlier draft reported Norushen as a 139s
		// single-target section that is 35% single.
		const [segment] = cut(
			[
				[0, 1],
				[10_000, 4],
			],
			40_000,
			{ floorMs: 40_000 },
		).segments;
		expect(segment?.mode).toBe('aoe');
		expect(segment?.dominance).toBeCloseTo(0.75, 10);
	});

	it('calls a segment mixed when its winner falls under the share, and still reports the winner`s number', () => {
		// 12s single against 8s aoe: the winner holds 0.60, under 0.70.
		const [segment] = cut(
			[
				[0, 1],
				[12_000, 3],
			],
			20_000,
			{ floorMs: 20_000 },
		).segments;
		expect(segment?.mode).toBe('mixed');
		expect(segment?.dominance).toBeCloseTo(0.6, 10);
		// Not a blend and not zero — the reader has to see how close the call was, and that it was single
		// that nearly carried it. `medianEnemies` and the ledger say what it actually was.
		expect(segment?.medianEnemies).toBe(1);
		expect(segment?.msByCount).toEqual({ 1: 12_000, 3: 8000 });
		expect(segment?.bands).toEqual([1, 3]);
	});

	it('names a segment that lands exactly on the share', () => {
		// 14s of 20s is 0.70 exactly. The floor is "held for", so the boundary is inclusive on both.
		const [segment] = cut(
			[
				[0, 1],
				[14_000, 3],
			],
			20_000,
			{ floorMs: 20_000 },
		).segments;
		expect(segment?.mode).toBe('single');
		expect(segment?.dominance).toBeCloseTo(SEGMENT_MIXED_SHARE, 10);
	});

	it('counts time at no enemy against every mode rather than for single', () => {
		// A 5s zero run inside a contact window is absorbed — it is under the 10s downtime cut — but it is
		// not single-target play, and `modeOf(0)` being 1 is the exact fault §3a exists to fix. The label
		// survives; the claim behind it is weakened from 1.00 to 0.75, and the ledger shows why.
		const [segment] = cut(
			[
				[0, 1],
				[15_000, 0],
			],
			20_000,
			{ floorMs: 20_000 },
		).segments;
		expect(segment?.mode).toBe('single');
		expect(segment?.dominance).toBeCloseTo(0.75, 10);
		expect(segment?.msByCount).toEqual({ 0: 5000, 1: 15_000 });
		// And band 1 is claimed for the fifteen seconds that earned it, not for the five that did not.
		expect(segment?.bands).toEqual([1]);
	});

	it('reports a share of 1 for an idle segment and claims no band at all', () => {
		const [segment] = cut([], 60_000).segments;
		expect(segment?.mode).toBe('idle');
		expect(segment?.dominance).toBe(1);
		expect(segment?.bands).toEqual([]);
		expect(segment?.medianEnemies).toBe(0);
	});
});

describe('the downtime cut', () => {
	// `contactGapMs - windowMs`: a count point falls to zero one window after the last hit that fed it, so
	// a zero run of 10 000ms is a hit gap of 15 000ms — the same break `engagedWindows` uses.
	const OVER_MS = CLOCKS.contactGapMs - CLOCKS.windowMs;

	it('leaves a zero run exactly at the threshold inside its neighbour', () => {
		const timeline = cut(
			[
				[0, 1],
				[10_000, 0],
				[10_000 + OVER_MS, 1],
			],
			60_000,
			{ floorMs: 30_000 },
		);
		expect(timeline.segments).toHaveLength(1);
		expect(timeline.segments[0]?.mode).toBe('single');
		// Absorbed, not deleted: the ten seconds are still on the ledger.
		expect(timeline.segments[0]?.msByCount).toEqual({ 0: 10_000, 1: 50_000 });
	});

	it('cuts a zero run one millisecond over the threshold into its own segment', () => {
		const timeline = cut(
			[
				[0, 1],
				[10_000, 0],
				[10_001 + OVER_MS, 1],
			],
			60_000,
			{ floorMs: 30_000 },
		);
		expect(timeline.segments.map((s) => [s.mode, s.startMs, s.endMs])).toEqual([
			['single', 0, 10_000],
			['idle', 10_000, 20_001],
			['single', 20_001, 60_000],
		]);
	});

	it('does not put downtime through the mode floor, so a short idle segment survives a long one', () => {
		// Downtime is cut at the contact gap and the modes at their own floor, deliberately: Galakras' 14s
		// and 12s idle sections are spans the contact clock already excludes from every graded denominator,
		// and running them through a 30s mode floor would hand them back to the rotation they interrupted.
		const timeline = cut(
			[
				[0, 1],
				[10_000, 0],
				[22_000, 1],
			],
			60_000,
			{ floorMs: 30_000 },
		);
		expect(timeline.segments.map((s) => s.mode)).toEqual(['single', 'idle', 'single']);
		expect(lengthOf(timeline.segments[1] as FightSegment)).toBe(12_000);
	});

	it('reads a pull with no contact at all as idle however short it is', () => {
		// The short-run rule is "absorbed into its neighbour", and this run has no neighbour on either
		// side. `modeOf(0)` would call it single-target, which is the fault, and no relabel could save it.
		const timeline = cut([], 4000);
		expect(timeline.segments.map((s) => s.mode)).toEqual(['idle']);
	});
});

/**
 * Purity — the share of each segment's time actually at the mode on its label.
 *
 * Two assertions, and the first is the stronger one because it holds on any input: the relabel is what
 * makes a named segment's purity a *guarantee* rather than an average that happened to come out well.
 * Before it, at a 15s floor, the scheme was 71% pure across the raid and produced things like a 139s
 * `single` section that was 35% single.
 *
 * The aggregate is measured against the plan's raid-wide baselines — 81% raw and 92% honest at the 8s
 * floor, over all fourteen Siege pulls. Only six are committed, and they read 88% and 95%, so this asserts
 * the baseline as a floor rather than pinning the local number.
 */
describe('purity', () => {
	it('guarantees every named segment holds at least the share its name claims', () => {
		for (let seed = 1; seed <= 200; seed += 1) {
			const { points, durationMs } = generated(seed);
			for (const segment of cut(points, durationMs).segments) {
				if (segment.mode === 'idle') expect(segment.dominance).toBe(1);
				else if (segment.mode === 'mixed') expect(segment.dominance).toBeLessThan(SEGMENT_MIXED_SHARE);
				else
					expect(segment.dominance, `seed ${seed} segment ${segment.index}`).toBeGreaterThanOrEqual(
						SEGMENT_MIXED_SHARE,
					);
			}
		}
	});

	it('clears the measured raid baseline across the committed Siege pulls', () => {
		let totalMs = 0;
		let atLabelMs = 0;
		let honestMs = 0;
		for (const name of FIXTURES) {
			const { points, durationMs } = fixtureSeries(name);
			for (const segment of cut(points, durationMs).segments) {
				// Contact segments only. The sweep the 8s floor was chosen from counts these and not the
				// downtime sections, which no floor governs — 42 contact segments at 15s plus the fourteen
				// downtime ones is the 56 the per-boss table adds up to.
				if (segment.mode === 'idle') continue;
				const length = lengthOf(segment);
				totalMs += length;
				atLabelMs += segment.dominance * length;
				// A `mixed` segment claims no mode, so it cannot be wrong about one. That is the difference
				// between the 81% the labels are pure to and the 92% they are honest to.
				honestMs += segment.mode === 'mixed' ? length : segment.dominance * length;
			}
		}
		expect(atLabelMs / totalMs).toBeGreaterThanOrEqual(0.81);
		expect(honestMs / totalMs).toBeGreaterThanOrEqual(0.92);
	});
});

/**
 * The plan's published Galakras cut, reproduced from the committed fixture.
 *
 * This is the only in-tree evidence that this module is the algorithm the fourteen-pull sweep measured:
 * the trace below was produced by a scratchpad prototype that is not committed, and every boundary in it
 * comes back to a tenth of a second.
 *
 * ```
 *   0.0→ 44.9 single(45s)  44.9→ 62.1 IDLE(17s)   62.1→ 99.3 aoe(37s)   99.3→117.7 IDLE(18s)
 * 117.7→146.3 aoe(29s)    146.3→160.3 IDLE(14s)  160.3→199.9 aoe(40s)  199.9→226.2 IDLE(26s)
 * 226.2→270.7 aoe(45s)    270.7→282.4 IDLE(12s)  282.4→380.0 aoe(98s)  380.0→434.2 single(54s)
 * ```
 *
 * **The boundaries are reproduced; five of the seven labels are not, and that is the dominance relabel
 * working rather than a disagreement.** That trace predates it and names each section after the mode it
 * entered in; measured, four of those `aoe` sections hold their winner at 0.39–0.61 and are `mixed` here.
 * Which is the finding the relabel exists for — at this floor the labels were 71% pure across the raid.
 */
describe('Galakras, against the plan`s measured cut', () => {
	it('finds the encounter`s structure without being told what the fight is', () => {
		const { points, durationMs } = fixtureSeries('waves');
		const timeline = cut(points, durationMs, { floorMs: 15_000 });
		const tenths = (ms: number): number => Math.round(ms / 100) / 10;

		expect(timeline.segments.map((s) => [tenths(s.startMs), tenths(s.endMs)])).toEqual([
			[0, 44.9],
			[44.9, 62.1],
			[62.1, 99.3],
			[99.3, 117.7],
			[117.7, 146.3],
			[146.3, 160.3],
			[160.3, 199.9],
			[199.9, 226.2],
			[226.2, 270.7],
			[270.7, 282.4],
			[282.4, 380],
			[380, 434.2],
		]);

		// Twelve sections of which five are downtime — the per-boss figure the plan records for this pull.
		expect(timeline.segments.filter((s) => s.mode === 'idle')).toHaveLength(5);
		// Five add waves and a boss-alone finish, derived from a series of numbers.
		expect(timeline.segments[11]?.mode).toBe('single');
		expect(timeline.segments[11]?.dominance).toBe(1);
	});

	it('resolves the same pull into eleven contact sections at the 8s floor', () => {
		const { points, durationMs } = fixtureSeries('waves');
		const timeline = cut(points, durationMs);
		expect(timeline.floorMs).toBe(SEGMENT_FLOOR_MS);
		expect(timeline.segments.filter((s) => s.mode !== 'idle')).toHaveLength(13);
		// The downtime cut is untouched by the mode floor, so the same five sections stand.
		expect(timeline.segments.filter((s) => s.mode === 'idle')).toHaveLength(5);
	});
});
