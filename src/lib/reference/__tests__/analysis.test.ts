// The research harness, on the one property it exists to protect: that it refuses to answer.
//
// `scripts/gcd-analysis.mjs` ships nothing. Its output is read by a person or an agent deciding whether
// a metric measures the player — so unlike its sibling `build-reference-tables.mjs`, a fault here does
// not re-grade a report. It does something worse and quieter: it produces a confident number that gets
// written into a plan, an artifact and a docblock, and nothing downstream ever contradicts it.
//
// That is not hypothetical. The first run of this script reported that the *player* explained 79.5% of
// `gcdUtilisationPct` — an appealing figure, and the exact opposite of the project's finding. It was an
// artefact: 96 players across 139 pulls, so the term had nearly as many levels as there were
// observations and fitting it explained most of the spread by arithmetic. Every test below exists
// because of that half hour.
//
// **The guard is the feature, so the guard is what is tested.** Three of these five assert that a pool
// which cannot answer the question gets `usable: false` rather than a plausible percentage. A harness
// that silently degrades is worse than no harness, because it is trusted.

import { describe, expect, it } from 'vitest';

import {
	MIN_ENCOUNTERS_PER_PLAYER,
	PARSE_BANDS,
	analyseSpec,
	distributionOf,
	fairnessOf,
	printSpec,
	varianceSplit,
} from '../../../../scripts/gcd-analysis.mjs';

/**
 * A pull that clears every gate, so each test can spoil exactly one thing.
 *
 * The gate fields are carried even though most tests never look at them: `analyseSpec` runs `gateOf`
 * before it counts anything, so a fixture missing `isSpec` is silently an empty pool and every
 * assertion below it passes vacuously.
 */
const pull = (over: Record<string, unknown> = {}) => ({
	spec: 'windwalker',
	player: 'A',
	encounterID: 1595,
	encounterName: 'Immerseus',
	value: 80,
	rankPercent: 99,
	isSpec: true,
	kill: true,
	difficulty: 4,
	durationMs: 300_000,
	contactShare: 0.95,
	...over,
});

/**
 * The split's shape once it has agreed to answer.
 *
 * The script is `.mjs` and ships no types, so TypeScript infers a union across its two return shapes and
 * every field of the answering one reads as possibly-undefined. Narrowing once here — through an
 * assertion that also *checks* `usable`, so the cast can never be silently wrong — beats a non-null
 * operator on twelve lines.
 */
interface Split {
	crossed: number;
	subset: number;
	byPlayer: { encounter: number; player: number };
	playerFirst: { player: number; encounter: number };
	byBand: { encounter: number; band: number };
}

const answered = (pulls: ReturnType<typeof pull>[]): Split => {
	const split = varianceSplit(pulls);
	expect(split.usable).toBe(true);
	return split as unknown as Split;
};

const capture = (fn: () => void): string[] => {
	const lines: string[] = [];
	const log = console.log;
	console.log = (line: string) => lines.push(line);
	try {
		fn();
	} finally {
		console.log = log;
	}
	return lines;
};

describe('the degrees-of-freedom guard', () => {
	/**
	 * The regression test for the bug that produced this file. Every player appears exactly once, so
	 * `player` has as many levels as there are rows and would fit the data perfectly — 100% explained,
	 * and meaningless. The right answer is a refusal.
	 */
	it('refuses a pool where every player appears once', () => {
		const pulls = Array.from({ length: 60 }, (_, i) =>
			pull({ player: `P${i}`, encounterID: 1595 + (i % 14), value: 60 + (i % 30) }),
		);
		expect(varianceSplit(pulls).usable).toBe(false);
	});

	/** Two crossed players is not a design either — one of them is the whole contrast. */
	it('refuses fewer than two players who cover the raid', () => {
		const pulls = [
			...Array.from({ length: 14 }, (_, i) => pull({ player: 'solo', encounterID: 1595 + i, value: 60 + i })),
			...Array.from({ length: 40 }, (_, i) => pull({ player: `P${i}`, encounterID: 1595 + (i % 14) })),
		];
		const split = varianceSplit(pulls);
		expect(split.usable).toBe(false);
		expect(split.crossed).toBe(1);
	});

	/** A pool with no spread at all has nothing to decompose, and dividing by it would be a NaN. */
	it('refuses a pool where every pull reads the same', () => {
		const pulls = Array.from({ length: 60 }, (_, i) =>
			pull({ player: `P${i % 4}`, encounterID: 1595 + (i % 14), value: 80 }),
		);
		expect(varianceSplit(pulls).usable).toBe(false);
	});
});

describe('the split itself', () => {
	/**
	 * Data built so the encounter is the *only* thing that moves the figure: four players, fourteen
	 * bosses, each boss with its own level and every player identical on it. The encounter term must take
	 * nearly all of it, and the player term nearly none.
	 *
	 * Built rather than sampled because a fixture of real pulls would assert what one cache happened to
	 * contain. This asserts the arithmetic, which is the part that can break.
	 */
	it('attributes to the encounter when only the encounter moves', () => {
		const pulls = Array.from({ length: 4 }, (_, p) =>
			Array.from({ length: 14 }, (_, e) => pull({ player: `P${p}`, encounterID: 1595 + e, value: 60 + e * 2 })),
		).flat();
		const split = answered(pulls);
		expect(split.crossed).toBe(4);
		expect(split.byPlayer.encounter).toBeGreaterThan(99);
		expect(split.byPlayer.player).toBeLessThan(1);
	});

	/** And the mirror, so the test above is not passing on a constant. */
	it('attributes to the player when only the player moves', () => {
		const pulls = Array.from({ length: 4 }, (_, p) =>
			Array.from({ length: 14 }, (_, e) => pull({ player: `P${p}`, encounterID: 1595 + e, value: 60 + p * 5 })),
		).flat();
		const split = answered(pulls);
		expect(split.byPlayer.player).toBeGreaterThan(99);
		expect(split.byPlayer.encounter).toBeLessThan(1);
	});

	/**
	 * **Both orders are reported because a real pool is unbalanced, and then they disagree.**
	 *
	 * The pair below is the whole argument for carrying two numbers. A *balanced* design — every player
	 * on every boss — is order-independent, and the two readings come out identical to the decimal; a
	 * ladder pool never looks like that, and there the order chosen moves the headline figure. A caller
	 * quoting one number is quoting a choice, so the script hands over both and the docblock says so.
	 */
	it('gives one answer when every player covers every encounter', () => {
		const pulls = Array.from({ length: 4 }, (_, p) =>
			Array.from({ length: 14 }, (_, e) => pull({ player: `P${p}`, encounterID: 1595 + e, value: 60 + e * 2 + p * 3 })),
		).flat();
		const split = answered(pulls);
		expect(split.byPlayer.encounter).toBeCloseTo(split.playerFirst.encounter, 5);
	});

	it('gives two when coverage is ragged, which is what a ladder pool looks like', () => {
		// P0 clears the raid; the others take the bosses they are good at. The encounter term now carries
		// some of what is really the players' selection of them, and which term collects it depends on
		// which one is fitted first.
		const pulls = [
			...Array.from({ length: 14 }, (_, e) => pull({ player: 'P0', encounterID: 1595 + e, value: 60 + e * 2 })),
			...Array.from({ length: 3 }, (_, p) =>
				Array.from({ length: 6 }, (_, e) =>
					pull({ player: `P${p + 1}`, encounterID: 1595 + e + p, value: 60 + e * 2 + (p + 1) * 7 }),
				),
			).flat(),
		];
		const split = answered(pulls);
		expect(split.byPlayer.encounter).not.toBeCloseTo(split.playerFirst.encounter, 1);
	});

	/** Parse band is the safe second reading — five levels whatever the pool, so no artefact is possible. */
	it('splits by parse band as well, on the same subset', () => {
		const pulls = Array.from({ length: 4 }, (_, p) =>
			Array.from({ length: 14 }, (_, e) =>
				pull({ player: `P${p}`, encounterID: 1595 + e, value: 60 + e * 2, rankPercent: 40 + p * 15 }),
			),
		).flat();
		const split = answered(pulls);
		expect(split.byBand.encounter).toBeGreaterThan(99);
		expect(split.byBand.band).toBeLessThan(1);
		expect(PARSE_BANDS).toHaveLength(5);
	});
});

describe('the fairness check', () => {
	/**
	 * The check that retired two threshold pairs. Nine of ten elite pulls sit under an `ok` of 75, all on
	 * one boss — which is the signature of a line reading the encounter rather than the player, and the
	 * `clusters` half is what makes it visible.
	 */
	it('counts elite pulls a line would fail, and where they pile up', () => {
		const pulls = [
			...Array.from({ length: 9 }, () => pull({ value: 61, encounterName: 'Immerseus' })),
			pull({ value: 90, encounterName: 'Malkorok' }),
			pull({ value: 40, rankPercent: 20, encounterName: 'Immerseus' }),
		];
		const fairness = fairnessOf(pulls, { good: 85, ok: 75 });
		expect(fairness).toMatchObject({ elite: 10, bad: 9, share: 90 });
		expect(fairness?.clusters[0]).toEqual(['Immerseus', 9]);
	});

	/** A pool with nobody at rank 95 cannot answer this, and says so rather than reporting 0 of 0. */
	it('declines when there are no elite pulls', () => {
		expect(fairnessOf([pull({ rankPercent: 40 })], { good: 85, ok: 75 })).toBeNull();
	});
});

describe('the output budget', () => {
	/**
	 * **A fixed block per spec, whatever the sample size.** Same contract as the reference harness and for
	 * the same reason: this is read by agents, and per-pull output is a token bill nothing else would
	 * catch. Five parse bands plus six fixed rows is the ceiling.
	 */
	it('prints a fixed block from a large pool', () => {
		const pulls = Array.from({ length: 500 }, (_, i) =>
			pull({ player: `P${i % 4}`, encounterID: 1595 + (i % 14), value: 60 + (i % 30), rankPercent: i % 101 }),
		);
		const lines = capture(() => printSpec(analyseSpec(pulls, 'windwalker')));
		expect(lines.length).toBeLessThanOrEqual(PARSE_BANDS.length + 6);
		expect(lines.join('\n')).toContain('variance');
	});

	/** And the guard's refusal is one line too, not a paragraph explaining itself. */
	it('prints the refusal on one line', () => {
		const pulls = Array.from({ length: 60 }, (_, i) =>
			pull({ player: `P${i}`, encounterID: 1595 + (i % 14), value: 60 + (i % 30) }),
		);
		const lines = capture(() => printSpec(analyseSpec(pulls, 'windwalker')));
		const refusal = lines.filter((l) => l.includes('not measurable'));
		expect(refusal).toHaveLength(1);
		expect(refusal[0]).toContain(String(MIN_ENCOUNTERS_PER_PLAYER));
	});
});

describe('the distribution', () => {
	it('gives the five-number summary and both tails', () => {
		expect(distributionOf([10, 20, 30, 40, 50])).toMatchObject({ n: 5, min: 10, p50: 30, max: 50 });
	});

	/** An empty set has no summary, and a zero-filled one would be read as a real reading of zero. */
	it('has nothing to say about an empty set', () => {
		expect(distributionOf([])).toBeNull();
	});
});
