// Turns one analysis into a scorecard: a grade per metric, a grade per section, one overall.
//
// Pure and total. Every metric that cannot be measured in a given pull is marked rather than
// defaulted, because a pull with no Re-Origination procs has not failed to snapshot them — and copy
// that says "0 of 0 caught, poor" about a fight that never offered the chance is worse than silence.

import type { Analysis, TargetMode } from '~/lib/types';

import type { Grade, Metric, Scorecard, SectionScore } from './model';
import { GRADE_ORDER, gradeOf, worst } from './model';
import type { MetricKey } from './thresholds';
import { THRESHOLDS, weightsFor } from './thresholds';

/** Percentage of `part` in `whole`, or null when there is nothing to take a share of. */
function share(part: number, whole: number): number | null {
	return whole > 0 ? (part / whole) * 100 : null;
}

function metric(key: MetricKey, value: number | null, context?: string): Metric {
	const threshold = THRESHOLDS[key];
	// An unmeasurable metric is parked at `ok` so it neither flatters nor punishes the overall
	// verdict; `unmeasurable` is what the copy keys off to say nothing at all about it.
	return {
		key,
		...threshold,
		value: value ?? 0,
		unmeasurable: value === null,
		grade: value === null ? 'ok' : gradeOf(threshold, value),
		// Omitted rather than set to undefined, so a metric with no variant carries no key at all and the
		// scorecards in the fixtures stay the shape they were captured in.
		...(context === undefined ? {} : { context }),
	};
}

/**
 * Builds a section from the metrics that decide it and the ones that merely describe it.
 *
 * A section is as good as its weakest *primary* metric — several weak signals on the same
 * behaviour should not average each other into looking acceptable.
 */
function section(primary: Metric[], secondary: Metric[] = []): SectionScore {
	const metrics = [...primary, ...secondary];
	const decided = primary.filter((m) => !m.unmeasurable);
	return {
		metrics,
		primary,
		unmeasurable: metrics.every((m) => m.unmeasurable),
		grade: decided.length === 0 ? 'ok' : worst(decided.map((m) => m.grade)),
	};
}

const POINTS: Record<Grade, number> = { good: 1, ok: 0.5, bad: 0 };

/**
 * The whole-pull verdict.
 *
 * A weighted mean rather than the worst grade: one weak metric out of seven is a thing to mention,
 * not a reason to call the pull bad, and `worst` would have called every pull in the test set bad.
 * Unmeasurable metrics drop out entirely — they do not silently count as half marks.
 */
function overall(metrics: Metric[], weights: Record<MetricKey, number>): Grade {
	const measured = metrics.filter((m) => !m.unmeasurable);
	if (measured.length === 0) return 'ok';

	let points = 0;
	let total = 0;
	for (const m of measured) {
		const weight = weights[m.key as MetricKey] ?? 1;
		points += POINTS[m.grade] * weight;
		total += weight;
	}
	// A metric can carry weight zero — see `snapshotDepth` in `thresholds` — so a pull whose only
	// measurable metric is one of those has nothing to average and must say so rather than divide by
	// nothing.
	if (total === 0) return 'ok';
	const pct = (points / total) * 100;
	return pct >= 75 ? 'good' : pct >= 45 ? 'ok' : 'bad';
}

/**
 * Grades one pull.
 *
 * Section keys match the report's section ids, so a component asks for its own verdict by the name
 * it already has.
 */
export function scoreAnalysis(analysis: Analysis, mode: TargetMode | null = null): Scorecard {
	const { procs, brew, debuff, filler, cpm, karma, potions } = analysis;

	const gcdUtilisation = metric('gcdUtilisation', cpm.gcdSlots > 0 ? cpm.gcdUtilisationPct : null);
	// Against the procs the bank could actually have paid for, not every proc that fired. A pull opens
	// with an empty bank, so the raw count charges players for procs they were never offered.
	const snapshotRate = metric('snapshotRate', share(procs.snapshotted, procs.opportunities));
	// Averaged over caught procs only, so with none caught there is nothing to average.
	const snapshotDepth = metric('snapshotDepth', procs.snapshotted > 0 ? procs.meanDepthPct : null);
	// Graded on every pull that cast it, add fight or not.
	//
	// It used to decline whenever the damage was spread, and that was the honest answer to a broken
	// measurement rather than a judgement about add fights: uptime was taken against a single inferred
	// primary target, which measured as low as 0.6% on a real kill. That 0.6% has since been traced —
	// see `primaryTargetID` — to the inference picking a Sha Puddle over Immerseus; against the boss the
	// same pull reads 93.6%. Both halves are fixed now, and `debuff.engagedUptimePct` asks whether the
	// debuff was on the enemy the player was hitting at each moment, which is a fair question on any
	// pull. Keeping the gate would leave the section silent on exactly the fights it can speak to.
	const rskUptime = metric('rskUptime', debuff.casts > 0 ? debuff.engagedUptimePct : null);
	const tigerPalmWaste = metric('tigerPalmWaste', share(filler.wasted, filler.casts));
	const brewStacks = metric('brewStacks', brew.uses > 0 ? brew.avgConsumed : null);
	// Graded on the stacks that were avoidable, not on every stack the cap refused. A stack lost while
	// holding a brew for a Re-Origination proc, on a proc where holding was the cheaper of the two
	// moves, was correctly spent — charging for it while separately faulting the early brew that would
	// have prevented it left a bank near its cap with no move the report called right. All of them are
	// still reported; only the avoidable ones are graded. `?? 0` because the committed fixtures predate
	// the field and carry `undefined`, which must read as "nothing forgiven" rather than as NaN.
	const avoidableCapWaste = Math.max(0, brew.wastedAtCap - (brew.wastedProtecting ?? 0));
	const brewCapWaste = metric('brewCapWaste', brew.uses > 0 || brew.maxStacks > 0 ? avoidableCapWaste : null);

	// A press that redirected nothing, over the presses taken — never over the presses the cooldown
	// allowed. Holding Touch of Karma through a phase with nothing incoming is the correct play, and
	// billing it as a miss would be the fabricated fault this section exists to refuse.
	const karmaEmpty = metric('karmaEmpty', share(karma.uses.filter((use) => use.reflected === 0).length, karma.casts));
	// Unmeasurable in two different ways, and both have to survive: no presses at all, and presses
	// whose ceiling the pull never demonstrated. `capPerUse` is null in the second case, which is the
	// "cannot say" the section prints rather than a share of a pool nobody measured. `absorbed` is
	// absent on fixtures captured before it existed, and reading it as zero would score those pulls as
	// having returned nothing — so an absent absorb is an unmeasurable metric, not a failing one.
	const karmaCeiling = karma.capPerUse === null || karma.casts === 0 ? null : karma.capPerUse * karma.casts;
	const karmaCapShare = metric(
		'karmaCapShare',
		karmaCeiling === null || karma.absorbed === undefined ? null : share(karma.absorbed, karmaCeiling),
	);

	/**
	 * Potions drunk out of the two the pull allowed.
	 *
	 * Two separate reasons to answer null, and both have to survive as "cannot say" rather than as
	 * zero. `potions` is absent on every committed fixture captured before the audit existed — reading
	 * that as none drunk would score six real pulls as having brought nothing — and `measurable` is
	 * false on a pull too short to have offered both slots, which is the audit's own refusal to answer.
	 */
	const potionsUsed = metric(
		'potionsUsed',
		potions?.measurable === true ? potions.used : null,
		// Which slot to point at, when exactly one went unfilled and the number cannot say which. A pull
		// that drank neither needs no variant — the base wording covers both — and one that drank two
		// never reaches a card at all.
		potions?.measurable === true && potions.used === 1 ? (potions.prePull === null ? 'prepull' : 'combat') : undefined,
	);

	const all = [
		gcdUtilisation,
		snapshotRate,
		snapshotDepth,
		rskUptime,
		tigerPalmWaste,
		brewStacks,
		brewCapWaste,
		karmaEmpty,
		karmaCapShare,
		potionsUsed,
	];

	return {
		overall: overall(all, weightsFor(mode)),
		sections: {
			// Depth is deliberately secondary — see the note on SectionScore.
			snapshots: section([snapshotRate], [snapshotDepth]),
			brew: section([brewStacks, brewCapWaste]),
			casts: section([gcdUtilisation]),
			debuff: section([rskUptime]),
			tigerPalm: section([tigerPalmWaste]),
			// Both primary: an empty press and a press that half-filled are separate faults, and the
			// weaker of the two should carry the section rather than be averaged away by the other.
			karma: section([karmaEmpty, karmaCapShare]),
			// A section with one metric and no section of its own on the page. It is here because the
			// scorecard is the only route into the summary — `Takeaways` walks these sections — and a
			// potion nobody drank is worth a card. The report deliberately grows no section to argue it:
			// the count is a headline tile and its evidence is a bar on the timeline, which is where the
			// card points.
			potions: section([potionsUsed]),
		},
	};
}

export { GRADE_ORDER };
