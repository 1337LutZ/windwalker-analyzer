// What two pulls of one spec differ by, and where they cannot be differenced at all.
//
// The whole model rests on one thing already being true: `Metric` carries its own thresholds, its own
// unit and its own direction, so two metrics of one key can be compared without anything here knowing
// what the metric measures. Nothing in this folder names a spec, an ability or a mechanic.
//
// **The refusals are the design, not the edge cases.** A pull that could not answer a question and a
// pull that was never asked it are both common, and both produce a row with no number on it. Folding
// either into a zero would put a difference on screen that the logs do not support, which is the one
// failure this whole report exists to avoid.

import type { Gate } from '~/lib/game/model';
import type { Grade, Judged, Metric } from '~/lib/score/model';
import type { Band } from '~/lib/spec/apl';
import type { AbilityDamage, CastRow, TargetMode } from '~/lib/types';

/** Which of the two pulls. `a` is the one named first, everywhere, in every figure. */
export type Side = 'a' | 'b';

/**
 * Why a pair of metrics has no difference to report.
 *
 * Three reasons and not one, because they call for three different sentences. `missing` is a metric
 * one scorecard has and the other does not, which within a single spec means one of them was captured
 * before the rule existed. `unmeasurable` is the log declining to answer. `exempt` is the rule not
 * applying at the target counts that pull was fought at, which is the reading `Metric.exempt` and the
 * existing `metric.notAsked` copy already carry.
 */
export type Incomparable = 'missing' | 'unmeasurable' | 'exempt';

export interface MetricGap {
	/** The metric key both sides were looked up under, and the i18n key stem for its label. */
	key: string;
	a: Metric | null;
	b: Metric | null;
	/**
	 * The distance between the two values, in bands, signed so that positive means A is ahead.
	 *
	 * Null when the pair is not comparable. Bands rather than the metric's own unit because this is
	 * the number the ranked chart sorts on, and a share, a count of potions and a clock in seconds
	 * have no common scale. The per-metric figure a reader actually reads stays in its own unit, on
	 * its own track.
	 */
	bands: number | null;
	/** Who is ahead by more than `TIE_BANDS`. Null when the two are level, or not comparable. */
	leader: Side | null;
	/** Set when `bands` is null, and never otherwise. */
	why: Incomparable | null;
	/**
	 * Which pull the refusal is about, when only one of them refuses.
	 *
	 * Null when both do. The difference matters to the sentence: "not asked of B" names something
	 * about B's pull, and "neither pull could answer this" names something about the metric.
	 */
	whySide: Side | null;
}

export interface SectionGap {
	/** The section key, as the spec's scorecard spells it. Also its i18n stem. */
	key: string;
	/** Every metric the section holds, in the scorecard's own order, comparable or not. */
	metrics: MetricGap[];
	/**
	 * The widest comparable gap in the section, signed. Null when nothing in it compares.
	 *
	 * **Only a sort key and an emptiness test.** It is deliberately not drawn: the chart plots every
	 * metric as its own dot, so there is no aggregate on screen to defend. It orders the rows, because
	 * the section holding the single biggest disagreement is where a reader should start, and it says
	 * whether the section has anything to draw at all.
	 *
	 * The widest rather than the mean, which is the rule `SectionScore.grade` and `headroom` both
	 * follow. A mean would let a metric the two pulls tied on pull the row down the list past the one
	 * they are furthest apart on.
	 */
	bands: number | null;
}

/**
 * One ability's damage, on both sides.
 *
 * Compared by **share of each player's own total**, never by the raw number. Two pulls of different
 * length produce different totals for identical play, so a difference in `total` is mostly a
 * difference in how long the boss lived.
 */
export interface AbilityGap {
	id: number;
	name: string;
	/** Null when this ability did no damage in that pull at all. */
	a: AbilityDamage | null;
	b: AbilityDamage | null;
	/**
	 * The gap in percentage points of each player's own damage, positive when A's share is larger.
	 *
	 * A side that never landed the ability counts as zero here, and that is a real reading rather than
	 * a guess: the ability is absent from `damage.abilities` because it dealt no damage, which is a
	 * measured zero. The null on `a` or `b` above is for the *label*, so the table can say the button
	 * was never pressed instead of printing a nought that looks like a bad one.
	 */
	sharePoints: number;
	/** True when either side reports it as such. Passives and utility are listed apart from the rest. */
	passive: boolean;
	utility: boolean;
}

/** One ability's press rate, on both sides. Casts per minute is already length-normalised. */
export interface CastGap {
	id: number;
	name: string;
	a: CastRow | null;
	b: CastRow | null;
	/** Casts per minute, positive when A pressed it more often. An absent side counts as zero. */
	cpm: number;
	/**
	 * What holds the button back, when both sides agree on it.
	 *
	 * It is what explains a gap rather than decorating it: a cooldown-gated button's rate difference is
	 * drift, and a resource-gated one's is throughput. Null when only one side pressed the ability, so
	 * the column stays empty rather than asserting one pull's gate over a press the other never made.
	 */
	gate: Gate | null;
}

/** Everything about one pull that frames the comparison rather than being compared by it. */
export interface PullFraming {
	player: string;
	code: string;
	fightID: number;
	encounter: string;
	difficultyName: string | null;
	kill: boolean;
	durationMs: number;
	itemLevel: number | null;
	/** WarcraftLogs' own parse percentile. The one figure here that ranks the pull against everyone. */
	rankPercent: number | null;
	dps: number;
	cpm: number;
	gcdUtilisationPct: number;
	/** The target counts this pull was read at, which is what decides whether a banded rule applied. */
	bands: readonly Band[] | null;
	mode: TargetMode | null;
	overall: Grade;
	/** The weight the verdict was taken over. Without it a reader assumes the whole spec was judged. */
	judged: Judged | undefined;
}

/**
 * What makes the pair unequal in a way no figure below it can correct for.
 *
 * Nothing is suppressed because of a note. The reader is told what to discount, which is the same
 * posture the rest of the report takes towards a number it cannot stand behind.
 */
export type NoteKind = 'encounter' | 'difficulty' | 'outcome' | 'duration' | 'bands' | 'itemLevel';

export interface ComparabilityNote {
	kind: NoteKind;
	/** The two values the sentence names, already in the shape its interpolation wants. */
	a: string | number;
	b: string | number;
}

/**
 * How the comparable metrics fell out, in four buckets that add up to every metric offered.
 *
 * `incomparable` is a bucket of its own and is never folded into `level`. Two pulls neither of which
 * could answer a question have not tied on it.
 */
export interface Tally {
	a: number;
	b: number;
	level: number;
	incomparable: number;
}

export interface Comparison {
	a: PullFraming;
	b: PullFraming;
	notes: ComparabilityNote[];
	tally: Tally;
	/** Scorecard order, which is the report's own editorial order. The ranked chart sorts a copy. */
	sections: SectionGap[];
	abilities: AbilityGap[];
	casts: CastGap[];
}
