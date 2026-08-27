// Where a grading line comes from, and the two properties that make the mechanism safe to wire in.
//
// The first is that `legacy` is a **control**: a metric resolved through this module on that use-case
// must produce the spec's own two numbers, unchanged, so a tree wired through the resolver and left on
// `legacy` grades exactly as it did before. That is what lets the wiring land as a provable no-op
// rather than as a change reviewers have to take on trust.
//
// The second is that a **gap in the reference set is never silently a grade**. A profile asking for an
// encounter's p90 on a pull the table has no row for, and no fallback either, falls back to the spec's
// own line *and says so*. The failure this prevents is a report that grades a pull against four other
// pulls and prints the letter as though it were drawn from four hundred.

import { describe, expect, it } from 'vitest';

import type { MetricProfile, SpecScoreProfile } from '../profile';
import { gradeAgainst, resolveThreshold } from '../profile';
import type { Threshold } from '../model';

/** The Windwalker's real line, which is what the `legacy` arm has to reproduce. */
const ABSOLUTE: Threshold = { good: 85, ok: 75, higherIsBetter: true };

/**
 * Two real encounters, and they are the pair the whole module exists for: measured over 400 heroic
 * kills, Immerseus and Malkorok are 24.6 points apart for the same spec.
 */
const GCD: MetricProfile = {
	higherIsBetter: true,
	useCases: {
		legacy: { good: { anchor: 'absolute', offset: 0 }, ok: { anchor: 'absolute', offset: 0 } },
		encounter: { good: { anchor: 'p90', offset: 0 }, ok: { anchor: 'p50', offset: 0 } },
		ceiling: { good: { anchor: 'ceiling', offset: -5 }, ok: { anchor: 'ceiling', offset: -12 } },
	},
	encounters: {
		1602: { n: 11, p50: 60.74, p90: 68.1 },
		1595: { n: 9, p50: 88.93, p90: 91.2 },
	},
	fallback: { n: 114, p50: 80.71, p90: 88.35 },
	ceiling: {
		value: 91.56,
		source: 'wowsims',
		runs: 24,
		seedSpread: [88.03, 93.92],
		caveat: 'a patchwerk dummy has no encounter script, so this is a bound and not a target',
	},
	suppress: [
		{
			encounterIDs: [1602],
			reason: 'Immerseus submerges, so the contact clock is the fight rather than the rotation',
		},
	],
};

const PROFILE: SpecScoreProfile = { spec: 'windwalker', metrics: { gcdUtilisation: GCD } };

const resolve = (useCase: 'legacy' | 'encounter' | 'ceiling', encounterID?: number) =>
	resolveThreshold(PROFILE, 'gcdUtilisation', ABSOLUTE, { encounterID, useCase });

describe('the control arm', () => {
	/** The property the whole wiring step rests on. */
	it('reproduces the spec’s own numbers exactly, on every encounter', () => {
		for (const encounterID of [1602, 1595, 9999, undefined]) {
			const got = resolve('legacy', encounterID);
			expect([got?.good, got?.ok], `encounter ${encounterID}`).toEqual([85, 75]);
		}
	});

	/** And says so, rather than borrowing a reference row's sentence. */
	it('tells the reader the line is fixed', () => {
		expect(resolve('legacy', 1602)?.basis).toBe('a fixed target, the same on every encounter');
	});

	/**
	 * **The control does not suppress**, which is deliberate rather than an oversight. `legacy` exists
	 * to reproduce the old report, and the old report graded Immerseus. A control arm that quietly
	 * withheld a letter would not be a control.
	 */
	it('grades the encounters the old report graded', () => {
		expect(resolve('legacy', 1602)?.suppressed).toBeUndefined();
	});
});

describe('a line anchored on the encounter', () => {
	it('reads the encounter’s own row', () => {
		const immerseus = resolve('encounter', 1602);
		expect([immerseus?.good, immerseus?.ok]).toEqual([68.1, 60.74]);
		const malkorok = resolve('encounter', 1595);
		expect([malkorok?.good, malkorok?.ok]).toEqual([91.2, 88.93]);
	});

	/**
	 * The point of the exercise, stated as an assertion: the same pull is `bad` on one fight and `good`
	 * on the other under a fixed line, and correct on both under this one.
	 */
	it('grades a 64% pull as the fight it was on', () => {
		expect(gradeAgainst(resolve('legacy', 1602)!, 64)).toBe('bad');
		expect(gradeAgainst({ ...resolve('encounter', 1602)!, suppressed: undefined }, 64)).toBe('ok');
		expect(gradeAgainst(resolve('encounter', 1595)!, 64)).toBe('bad');
	});

	it('names the row and its sample size for the reader', () => {
		expect(resolve('encounter', 1602)?.basis).toBe('the best pulls on this encounter, from 11 pulls');
	});

	/** An encounter with no row of its own is answered by the spec-wide distribution, labelled as such. */
	it('falls back to every encounter, and says which it used', () => {
		const got = resolve('encounter', 9999);
		expect([got?.good, got?.ok]).toEqual([88.35, 80.71]);
		expect(got?.basis).toBe('the best pulls on every encounter, from 114 pulls');
	});

	/** A pull with no encounter at all takes the same fallback rather than throwing. */
	it('answers a pull whose encounter is unknown', () => {
		expect(resolve('encounter', undefined)?.good).toBe(88.35);
	});
});

describe('a line anchored on perfect play', () => {
	it('offsets from the simulator’s own figure', () => {
		const got = resolve('ceiling', 1595);
		expect([got?.good?.toFixed(2), got?.ok?.toFixed(2)]).toEqual(['86.56', '79.56']);
	});

	/** The number is load-bearing enough that the reader is told where it came from. */
	it('says it came from the simulator, and over how many runs', () => {
		expect(resolve('ceiling', 1595)?.basis).toBe('perfect play in the simulator, over 24 runs');
	});
});

describe('an encounter the figure cannot be read on', () => {
	it('carries the reason rather than a bare flag', () => {
		expect(resolve('encounter', 1602)?.suppressed).toContain('submerges');
	});

	/** Suppression withholds the letter and nothing else — the figure is still the figure. */
	it('withholds the grade while keeping the lines', () => {
		const got = resolve('encounter', 1602)!;
		expect(gradeAgainst(got, 68.5)).toBeNull();
		expect(got.good).toBe(68.1);
	});

	it('leaves every other encounter graded', () => {
		expect(gradeAgainst(resolve('encounter', 1595)!, 92)).toBe('good');
	});
});

describe('what the resolver refuses to invent', () => {
	/**
	 * A metric nobody has written a profile for resolves to `null`, which is the caller's signal to use
	 * the spec's own table untouched. That is what makes this module additive: adopting it for one
	 * metric does not oblige every other metric to have a reference table.
	 */
	it('answers null for a metric it does not carry', () => {
		expect(resolveThreshold(PROFILE, 'flameShockUptime', ABSOLUTE, { useCase: 'encounter' })).toBeNull();
	});

	/**
	 * **A profile with no reference at all does not quietly grade against the old fixed line.** It
	 * grades against it and *says* so, which is the difference between a fallback and a silent one.
	 */
	it('falls back audibly when the anchor has nothing to read', () => {
		const bare: SpecScoreProfile = {
			spec: 'test',
			metrics: {
				gcdUtilisation: { higherIsBetter: true, useCases: GCD.useCases },
			},
		};
		const got = resolveThreshold(bare, 'gcdUtilisation', ABSOLUTE, { encounterID: 1602, useCase: 'encounter' });
		expect([got?.good, got?.ok]).toEqual([85, 75]);
		expect(got?.basis).toBe(`the spec's own line — no reference for this pull`);
	});

	/** The same is true of a ceiling anchor on a profile that measured no ceiling. */
	it('falls back audibly when no ceiling was measured', () => {
		const bare: SpecScoreProfile = {
			spec: 'test',
			metrics: { gcdUtilisation: { higherIsBetter: true, useCases: GCD.useCases, fallback: GCD.fallback } },
		};
		expect(resolveThreshold(bare, 'gcdUtilisation', ABSOLUTE, { useCase: 'ceiling' })?.good).toBe(85);
	});
});

describe('offsets', () => {
	/**
	 * An offset is signed the way the metric reads and is **not** flipped for a rule that counts down.
	 * Asserted on both directions from one profile, because the alternative — flipping inside the
	 * resolver — is invisible at the declaration site and reads correctly right up until it doesn't.
	 */
	it('adds, whichever direction is better', () => {
		const down: SpecScoreProfile = {
			spec: 'test',
			metrics: {
				missed: {
					higherIsBetter: false,
					useCases: {
						legacy: { good: { anchor: 'absolute', offset: 0 }, ok: { anchor: 'absolute', offset: 0 } },
						encounter: { good: { anchor: 'p50', offset: -2 }, ok: { anchor: 'p90', offset: -2 } },
						ceiling: { good: { anchor: 'ceiling', offset: 0 }, ok: { anchor: 'ceiling', offset: 0 } },
					},
					fallback: { n: 40, p50: 12, p90: 20 },
				},
			},
		};
		const got = resolveThreshold(
			down,
			'missed',
			{ good: 10, ok: 18, higherIsBetter: false },
			{
				useCase: 'encounter',
			},
		);
		expect([got?.good, got?.ok, got?.higherIsBetter]).toEqual([10, 18, false]);
	});
});
