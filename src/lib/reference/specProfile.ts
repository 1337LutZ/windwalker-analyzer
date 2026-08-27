// One spec's grading profile, assembled from the committed reference table.
//
// `lib/score/profile.ts` says how a line is resolved; `lib/reference/table.ts` holds what was measured.
// This is the join, and it is the only place a spec's `gcdUtilisation` learns that Immerseus is not
// Malkorok.
//
// **Assembled rather than declared, which is the whole point.** A hand-written profile per spec would
// be forty-two numbers copied out of a JSON file by hand, going stale the first time a sweep ran. This
// reads the table, so `node scripts/build-reference-tables.mjs` is the only thing that ever changes a
// grading line — and a spec registered next year gets a profile the day its first sweep lands, with no
// code written for it at all.

import type { MetricProfile, Resolved, SpecScoreProfile, Threshold, UseCase } from '~/lib/score';
import { resolveThreshold } from '~/lib/score';
import { encounterIdForName, referenceFor } from './table';

/**
 * What a simulator playing the rotation perfectly reaches on a stationary dummy.
 *
 * **These are bounds, never targets, and the caveat is carried rather than remembered.** A patchwerk
 * dummy has no encounter script: nothing submerges, nobody has to move, and the fight lasts exactly as
 * long as the run says. So a ceiling says what the *rotation* can do, and the distance from it to a real
 * pull is the encounter plus the player, in unknown proportions.
 *
 * They are here rather than in the reference table because they did not come from WarcraftLogs. The
 * table is measured kills; this is `wowsimcli`. Two provenances, two homes.
 *
 * ***The spread is the argument against a shared line.*** 7.79 points separate these three before a
 * human is involved — a caster's global scales with haste and Lightning Bolt is castable indefinitely,
 * while a monk's global is pinned at 1000ms and gated by energy regen, so 413 of 413 sampled Windwalker
 * gaps opened below the cost of a Jab. The same number on two specs is measuring two different things.
 */
const CEILINGS: Readonly<Record<string, { value: number; runs: number; seedSpread?: readonly [number, number] }>> = {
	windwalker: { value: 91.56, runs: 24, seedSpread: [88.03, 93.92] },
	protection: { value: 96.3, runs: 24 },
	elemental: { value: 99.35, runs: 24 },
};

/**
 * Encounters where this figure is not a reading of the rotation, by **base** id.
 *
 * Measured rather than judged: median contact share is 77.7% on Immerseus, 82.7% on Galakras and 85.0%
 * on Norushen, against 94% or better on the other eleven. All three take the player out of contact by
 * design — a submerge, tower duty, an orb phase — so the denominator is the encounter's doing and a
 * share taken over it describes the fight rather than the player.
 *
 * **Spec-independent, and that is deliberate.** A submerge stops a monk and a shaman alike. If a future
 * sweep finds a fight that is unmeasurable for one spec and fine for another, this becomes a per-spec
 * list and gains a reason saying which spec and why — but inventing that shape before the evidence
 * exists would be the same unevidenced move the reference table was built to replace.
 */
const SUPPRESSED = [1602, 1622, 1624] as const;

const SUPPRESSION_REASON =
	'this encounter takes the player out of contact by design, so the clock the figure divides by is the fight rather than the rotation';

/**
 * The profile for one spec, or `null` when no sweep has covered it.
 *
 * `null` is a real answer and callers must handle it: a spec with no reference grades against its own
 * fixed lines exactly as it did before, which is what keeps adopting this additive.
 */
export function scoreProfileFor(specKey: string): SpecScoreProfile | null {
	const reference = referenceFor(specKey);
	if (reference === null || reference.fallback === null) return null;

	const ceiling = CEILINGS[specKey];
	const gcdUtilisation: MetricProfile = {
		higherIsBetter: true,
		useCases: {
			// The control. Resolves to whatever the spec's own table says, so a report on this arm is
			// byte-for-byte the report that shipped before any of this existed.
			legacy: { good: { anchor: 'absolute', offset: 0 }, ok: { anchor: 'absolute', offset: 0 } },
			// `good` is *about as well as the best manage on this fight*, `ok` is *about what a pull on
			// this fight looks like*. Not p75/p25 — see `lib/score/profile.ts` on why an anchor is not a
			// curve, and why a curve here would re-invent the parse percentile.
			encounter: { good: { anchor: 'p90', offset: 0 }, ok: { anchor: 'p50', offset: 0 } },
			// The cross-spec reading: the same distance below each spec's own ceiling. Useful for asking
			// "is this line even reachable", which is the question that retired Elemental's 95.
			ceiling: { good: { anchor: 'ceiling', offset: -5 }, ok: { anchor: 'ceiling', offset: -12 } },
		},
		encounters: Object.fromEntries(
			Object.entries(reference.encounters).map(([encounterID, cell]) => [
				Number(encounterID),
				{ n: cell.n, p50: cell.p50, p90: cell.p90 },
			]),
		),
		fallback: { n: reference.fallback.n, p50: reference.fallback.p50, p90: reference.fallback.p90 },
		...(ceiling === undefined
			? {}
			: {
					ceiling: {
						value: ceiling.value,
						source: 'wowsims' as const,
						runs: ceiling.runs,
						seedSpread: ceiling.seedSpread ?? ([ceiling.value, ceiling.value] as const),
						caveat: 'a patchwerk dummy has no encounter script, so this is a bound and not a target',
					},
				}),
		suppress: [{ encounterIDs: SUPPRESSED, reason: SUPPRESSION_REASON }],
	};

	return { spec: specKey, metrics: { gcdUtilisation } };
}

/**
 * Which question the report's grading lines answer, today.
 *
 * **One constant, so the switch is one edit and one diff.** `legacy` is what shipped before the
 * reference table existed and is kept reachable — a reader comparing an old report against a new one
 * needs a way to ask what the old lines said, and the byte-identity test that justified wiring any of
 * this in grades through it.
 */
export const USE_CASE: UseCase = 'encounter';

/**
 * The two lines this pull grades `gcdUtilisation` against, resolved from its own encounter.
 *
 * Returns `null` when the spec has no reference, which is the caller's signal to leave its own table
 * alone. Every spec that has never been swept therefore grades exactly as it always did.
 */
export function resolveGcdFor(
	specKey: string,
	encounterName: string | null | undefined,
	absolute: Threshold,
	useCase: UseCase = USE_CASE,
): Resolved | null {
	const profile = scoreProfileFor(specKey);
	if (profile === null) return null;
	const encounterID = encounterIdForName(encounterName) ?? undefined;
	return resolveThreshold(profile, 'gcdUtilisation', absolute, { encounterID, useCase });
}
