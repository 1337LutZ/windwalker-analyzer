// Where a grading line comes from, when a fixed number cannot be fair.
//
// Every threshold in this tree is two absolute numbers — `gcdUtilisation` is `good 85 / ok 75` for the
// Windwalker whatever the pull was. Measured across 400 heroic Siege kills, that is not a reading of
// the player:
//
//   Windwalker gcdUtilisation, under good 85 / ok 75
//     Immerseus   p25 57.33   p50 60.74   p90 ~68     every pull grades `bad`
//     Malkorok    p25 87.22   p50 88.93   p90 ~91     every pull grades `good`
//
// The encounter explains **60.0%** of the variance in that figure and the player's parse band **8.5%**,
// so a rank-95 monk on Immerseus is graded `bad` for playing the fight as well as anyone ever has. The
// same shape holds on Elemental (52.3% / 12.4%) and much less on Protection (38.4% / 30.4%), which is
// why Protection is the one spec whose grade this module is least urgently needed for.
//
// This module does not change how a metric is graded. `metricOf` still does that, against a
// `Threshold` of two numbers — what changes is where those two numbers come from.
//
// ------------------------------------------------------------------ what an anchor is, and is not
//
// **An anchor is not a curve, and the distinction is the whole design.** Anchoring `good` at an
// encounter's *p75* and `ok` at its *p25* would be self-calibrating and would need no judgement at
// all — and it would fail a quarter of every raid by construction, improve nobody's grade when the
// group improves, and re-invent the parse percentile the report already prints beside the player's
// name. A second, noisier ranking is not worth a module.
//
// So `good` is the encounter's **p90** and `ok` its **p50**: *about as well as the best manage on this
// fight*, and *about what a pull on this fight looks like*. Both still move with the reference table,
// but they are claims about the fight's ceiling rather than about the population's middle.
//
// ------------------------------------------------------------------ the reference is not the truth
//
// The table is pooled across the whole parse ladder, rank 0 to 100, for sample stability — most cells
// hold six to twelve pulls, which is enough for a median and thin for a quantile. That thinness is
// **published rather than hidden**: `Resolved.basis` names the row and its sample size, the report
// prints it beside the grade, and a reader who sees "reference p90 68.1 (n=11)" can weigh the letter
// themselves. A grade drawn from four pulls that does not say so is the failure this field exists to
// prevent.

import type { Grade, Threshold } from './model';
import { gradeOf } from './model';

/**
 * Which question the lines are answering.
 *
 * **`legacy` is not a deprecation, it is the control.** It resolves every line to the absolute number
 * the spec's `THRESHOLDS` already carries, so a tree wired through this module but left on `legacy`
 * grades byte-for-byte as it did before — which is what makes the wiring provable rather than merely
 * reviewed. It stays after the default moves, because a reader comparing against an old report needs a
 * way to ask what the old lines said.
 */
export type UseCase = 'legacy' | 'encounter' | 'ceiling';

/**
 * What a line is measured from.
 *
 * `absolute` is the number written in the spec's table. `p50` and `p90` are the encounter's own
 * reference row. `ceiling` is what a simulator playing the rotation perfectly reaches on a dummy —
 * a **bound**, never an expectation, because a patchwerk dummy has no encounter script.
 */
export type Anchor = 'absolute' | 'p50' | 'p90' | 'ceiling';

/** One grading line: an anchor plus an offset in the metric's own unit. */
export interface Line {
	anchor: Anchor;
	/**
	 * Added to the anchor, in the metric's unit, and **signed the way the metric reads**.
	 *
	 * Not flipped for a `higherIsBetter: false` metric. A `-5` is five units lower on the scale
	 * whichever direction is better, so an offset can be read off the page without first working out
	 * which way the rule counts. `resolveThreshold` does no sign arithmetic at all.
	 */
	offset: number;
}

/**
 * One encounter's reference distribution for one metric.
 *
 * `n` travels with the numbers rather than beside them, because the two are only meaningful together —
 * see the module header on why thinness is published.
 */
export interface EncounterRef {
	n: number;
	p50: number;
	p90: number;
}

/**
 * A perfect-play bound, and where it came from.
 *
 * **Provenance is required, not documentation.** The three ceilings this tree holds — Windwalker 91.56,
 * Protection 96.30, Elemental 99.35 — differ by 7.79 points before a human is involved, which is the
 * hardest available argument against sharing a line across specs. A number that load-bearing may not
 * sit in a table without saying where it came from and what it cannot be used for.
 */
export interface Ceiling {
	value: number;
	source: 'wowsims';
	runs: number;
	/** Across the run's seeds, so a single-pull comparison can be read against real spread. */
	seedSpread: readonly [number, number];
	/** Why this is a bound and not a target. */
	caveat: string;
}

/**
 * An encounter this metric must not be graded on, and why.
 *
 * Three Siege fights take the player out of contact by design — measured median contact share of
 * 77.7% on Immerseus, 82.7% on Galakras and 85.0% on Norushen, against 94% or better everywhere else.
 * A figure over a denominator the encounter shrank is not a reading of the rotation.
 *
 * **The figure still prints; only the letter is withheld.** That is the same distinction
 * `docs/conventions.md` draws between `verdict_bad` and `verdict_none`, and the reason `reason` is
 * required here: a suppressed grade that cannot say why reads as a number the report lost confidence
 * in for no stated cause.
 */
export interface Suppression {
	/** Base encounter ids — compare with `baseEncounterID`, never the raw id. */
	encounterIDs: readonly number[];
	reason: string;
}

export interface MetricProfile {
	higherIsBetter: boolean;
	useCases: Readonly<Record<UseCase, { good: Line; ok: Line }>>;
	/** Keyed by **base** encounter id. */
	encounters?: Readonly<Record<number, EncounterRef>>;
	/** The spec-wide distribution, for an encounter the table has no row for. */
	fallback?: EncounterRef;
	ceiling?: Ceiling;
	suppress?: readonly Suppression[];
}

export interface SpecScoreProfile {
	spec: string;
	metrics: Readonly<Record<string, MetricProfile>>;
}

/**
 * Two numbers `metricOf` can grade against, plus what they were drawn from.
 *
 * `basis` is not a debug string. It is rendered beside the grade — see the module header — so it is
 * written for a reader rather than for a log.
 */
export interface Resolved extends Threshold {
	basis: string;
	/** Set when the figure must be shown without a letter. */
	suppressed?: string;
}

/** The reference row a metric resolves against on this encounter, and how it was reached. */
function referenceFor(
	profile: MetricProfile,
	encounterID: number | undefined,
): { ref: EncounterRef; where: string } | null {
	const row = encounterID === undefined ? undefined : profile.encounters?.[encounterID];
	if (row !== undefined) return { ref: row, where: `this encounter` };
	if (profile.fallback !== undefined) return { ref: profile.fallback, where: `every encounter` };
	return null;
}

/**
 * One line's number, or null when the anchor has nothing to read.
 *
 * **A missing anchor answers null rather than falling back to the absolute.** A profile asking for the
 * encounter's p90 on a metric with no reference table is a declaration error, and quietly grading it
 * against the old fixed line would hide that for as long as nobody compared two reports.
 */
function lineValue(
	line: Line,
	profile: MetricProfile,
	absolute: Threshold,
	which: 'good' | 'ok',
	ref: EncounterRef | null,
): number | null {
	switch (line.anchor) {
		case 'absolute':
			return absolute[which] + line.offset;
		case 'p50':
			return ref === null ? null : ref.p50 + line.offset;
		case 'p90':
			return ref === null ? null : ref.p90 + line.offset;
		case 'ceiling':
			return profile.ceiling === undefined ? null : profile.ceiling.value + line.offset;
	}
}

/**
 * The two lines this metric is graded against on this pull.
 *
 * Resolution is **use-case → metric → encounter → fallback**, and every step that had to settle for
 * less says so in `basis`.
 *
 * Returns `null` when the spec's profile does not carry this metric at all, which is the caller's
 * signal to use the spec's own `THRESHOLDS` row unchanged. That is what keeps this module additive:
 * a metric nobody has written a profile for grades exactly as it always did.
 */
export function resolveThreshold(
	profile: SpecScoreProfile,
	metric: string,
	absolute: Threshold,
	ctx: { encounterID?: number; useCase: UseCase },
): Resolved | null {
	const rule = profile.metrics[metric];
	if (rule === undefined) return null;

	const lines = rule.useCases[ctx.useCase];
	const reference = referenceFor(rule, ctx.encounterID);
	const ref = reference?.ref ?? null;

	const good = lineValue(lines.good, rule, absolute, 'good', ref);
	const ok = lineValue(lines.ok, rule, absolute, 'ok', ref);
	// A profile that cannot produce its own lines falls all the way back to the spec's table rather
	// than refusing to grade — the pull is not at fault for a gap in a reference set.
	if (good === null || ok === null) {
		return {
			good: absolute.good,
			ok: absolute.ok,
			higherIsBetter: rule.higherIsBetter,
			basis: `the spec's own line — no reference for this pull`,
		};
	}

	// **`legacy` does not suppress, and that is what keeps it a control rather than a third reading.**
	// The old report graded Immerseus; an arm that reproduced its numbers but withheld its letters would
	// answer a different question from the one it exists to answer, and the byte-identity check that
	// justifies wiring this module in at all would have nothing to compare against. Withholding a grade
	// is a judgement about the encounter, and `legacy`'s whole claim is that it makes no judgements.
	const suppression =
		ctx.useCase === 'legacy'
			? undefined
			: rule.suppress?.find((entry) => ctx.encounterID !== undefined && entry.encounterIDs.includes(ctx.encounterID));

	return {
		good,
		ok,
		higherIsBetter: rule.higherIsBetter,
		basis: basisOf(lines, reference, rule),
		...(suppression === undefined ? {} : { suppressed: suppression.reason }),
	};
}

/** What the reader is told the lines were drawn from. */
function basisOf(
	lines: { good: Line; ok: Line },
	reference: { ref: EncounterRef; where: string } | null,
	rule: MetricProfile,
): string {
	if (lines.good.anchor === 'absolute') return `a fixed target, the same on every encounter`;
	if (lines.good.anchor === 'ceiling') {
		const runs = rule.ceiling?.runs ?? 0;
		return `perfect play in the simulator, over ${runs} runs`;
	}
	if (reference === null) return `the spec's own line — no reference for this pull`;
	const label = lines.good.anchor === 'p90' ? 'the best pulls' : 'a typical pull';
	return `${label} on ${reference.where}, from ${reference.ref.n} ${reference.ref.n === 1 ? 'pull' : 'pulls'}`;
}

/**
 * Grade a value against a resolved pair, honouring suppression.
 *
 * A thin convenience over `gradeOf`, and the only place suppression turns into an absent grade — so a
 * caller cannot forget it by reading `good`/`ok` off `Resolved` and comparing them itself.
 */
export function gradeAgainst(resolved: Resolved, value: number): Grade | null {
	return resolved.suppressed === undefined ? gradeOf(resolved, value) : null;
}
