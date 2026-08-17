// Rushing Jade Wind, read off a finished analysis.
//
// A view module rather than an engine audit: the clock and press count are arithmetic over measurements
// `analyse()` already published. Target fan-out is published with the damage rows because it requires
// the original damage events; this module only selects the Rushing Jade Wind row.
//
// ## One clock
//
// The clock is built once as a set of contact segments. A press outside contact is not included in the
// section's press count.

import { intersect, unionMs, type Interval } from '~/lib/analysis/intervals';
import { gradeOf, type Grade } from '~/lib/score';
import type { AplAudit } from '~/lib/spec/apl';
import type { Analysis } from '~/lib/types';

import { excludedButtons, pressedButtons } from './rotationFlow';

/** The button's cast id, which is also the buff's — the lane key and the ladder both key on it. */
export const RJW_CAST_ID = 116_847;
const RJW_DAMAGE_ID = 148_187;

/** Invoke Xuen: the other half of the level-90 talent row, and the usual proof the wind was not taken. */
const INVOKE_XUEN_ID = 123_904;

const RJW_CHOICE_THRESHOLD = { good: 90, ok: 70, higherIsBetter: true } as const;

/**
 * Whether the wind was on this monk's bar, as far as a log can say.
 *
 * Three states and not two, because the difference between the last two is the difference between a
 * fact and an accusation. `not-taken` is positive evidence — a button that cannot share a bar with
 * this one was pressed — and `unknown` is the honest answer for a pull that simply never shows it,
 * which is indistinguishable from a player who took the talent and forgot the button. The rule is
 * `excludedButtons`', not this module's; only the naming of *which* sibling proved it is decided here.
 */
export type JadeWindTalent =
	| { state: 'taken' }
	| { state: 'not-taken'; instead: 'invokeXuen' | 'spinningCraneKick' }
	| { state: 'unknown' };

/** RJW's measured clock and target fan-out. */
export interface JadeWindMeasurement {
	/** The clock: the union of the contact segments, or the pull when an older analysis carries none. */
	measuredMs: number;
	uptimeMs: number;
	uptimePct: number;
	/** Presses made inside that clock. */
	presses: number;
	/** Average distinct targets hit by one Rushing Jade Wind damage tick. */
	averageTargetsHit: number | null;
}

/**
 * The priority list's verdict on this button, taken from the ladder rather than re-derived.
 *
 * Both directions, because they are different mistakes: `followed`/`skipped` count presses of the
 * wind and say whether the list wanted that global spent on it, while `wanted` counts globals the
 * list wanted the wind at and something else was pressed. A pull can and does score badly on both —
 * `strong` presses it at nine globals the list wanted elsewhere while passing it over at thirty-two.
 */
export interface JadeWindLadder {
	followed: number;
	skipped: number;
	/** Presses the ladder judged at all: `followed + skipped`, with `unknown` and `off-list` left out. */
	judged: number;
	wanted: number;
	/** Moments where the priority list made Rushing Jade Wind the available choice. */
	opportunities: number;
	/** RJW presses whose priority could not be determined. */
	unknown: number;
	/** RJW presses made when no ladder rule wanted it. */
	offList: number;
	/** Decision adherence, excluding unknown presses. */
	choiceRate: number | null;
	/** Grade for the decision adherence card. */
	choiceGrade: Grade | null;
}

export interface JadeWindReading {
	talent: JadeWindTalent;
	/**
	 * Null when the analysis carries no cast timeline, so the buff's windows cannot be read at all.
	 * Distinct from a measurement of zero, which is what a talented monk who never pressed it would be.
	 */
	measured: JadeWindMeasurement | null;
	/** Null when the ladder did not run — no resource readings, or an analysis captured before it existed. */
	ladder: JadeWindLadder | null;
}

function talentOf(analysis: Analysis): JadeWindTalent {
	const pressed = pressedButtons(analysis.casts);
	if (pressed.has(RJW_CAST_ID)) return { state: 'taken' };
	if (!excludedButtons(pressed).has(RJW_CAST_ID)) return { state: 'unknown' };
	// Which sibling proved it, for the copy alone. The *decision* above is the shared rule's; this only
	// picks which of the two sentences names the right button back.
	return { state: 'not-taken', instead: pressed.has(INVOKE_XUEN_ID) ? 'invokeXuen' : 'spinningCraneKick' };
}

function measure(analysis: Analysis): JadeWindMeasurement | null {
	// The buff lane, not a per-target one: `target` is absent on every buff and present on the debuff
	// lanes, several of which share a key.
	const lane = analysis.timeline?.lanes.find((l) => l.key === 'rushing-jade-wind' && l.target === undefined);
	if (lane === undefined) return null;

	// Built once, and both halves read off it. `contactSegments` is absent only on an analysis captured
	// before it existed, where the whole pull is the honest fallback for both — falling back on the
	// denominator alone would divide a whole-pull numerator by a contact clock.
	const clock: Interval[] = analysis.debuff.contactSegments?.map(([start, end]): Interval => [start, end]) ?? [
		[0, analysis.durationMs],
	];
	const measuredMs = unionMs(clock);
	const uptimeMs = unionMs(
		intersect(
			lane.windows.map((w): Interval => [w.start, w.end]),
			clock,
		),
	);

	const times = analysis.casts.find((c) => c.id === RJW_CAST_ID)?.times ?? [];
	const presses = times.filter((t) => clock.some(([start, end]) => t >= start && t <= end)).length;
	const averageTargetsHit =
		analysis.damage.abilities.find((ability) => ability.id === RJW_DAMAGE_ID)?.averageTargetsHit ?? null;

	return {
		measuredMs,
		uptimeMs,
		uptimePct: measuredMs > 0 ? (uptimeMs / measuredMs) * 100 : 0,
		presses,
		averageTargetsHit,
	};
}

/**
 * The ladder's two counts, filtered to this button by cast id rather than by rule key.
 *
 * By id deliberately: the list carries the wind twice — entry 17 promoted above Rising Sun Kick from
 * two enemies up, entry 31 near the bottom on an overflow guard — and naming both keys here would be a
 * second copy of the ladder's own rule set, free to fall out of step with it the day a third entry
 * appears. `skippedBy` publishes the id for exactly this kind of reader.
 */
function ladderOf(apl: AplAudit | null | undefined): JadeWindLadder | null {
	if (apl === null || apl === undefined) return null;
	const own = apl.presses.filter((p) => p.pressed === RJW_CAST_ID);
	const followed = own.filter((p) => p.verdict === 'followed').length;
	const skipped = own.filter((p) => p.verdict === 'skipped').length;
	const unknown = own.filter((p) => p.verdict === 'unknown').length;
	const offList = own.filter((p) => p.verdict === 'off-list').length;
	const wanted = apl.skippedBy.filter((s) => s.id === RJW_CAST_ID).reduce((sum, s) => sum + s.count, 0);
	const scored = followed + skipped + offList + wanted;
	const choiceRate = unknown > 0 || scored === 0 ? null : (followed / scored) * 100;
	return {
		followed,
		skipped,
		judged: followed + skipped,
		wanted,
		opportunities: followed + wanted,
		unknown,
		offList,
		choiceRate,
		choiceGrade: choiceRate === null ? null : gradeOf(RJW_CHOICE_THRESHOLD, choiceRate),
	};
}

/**
 * The whole reading.
 *
 * `apl` is passed in rather than taken off the analysis because the reader's target-count override
 * chooses between five precomputed walks, and that choice is `bandForMode`'s — the section and
 * `PriorityLadder` have to make it the same way or they would print two verdicts on the same presses.
 */
export function readJadeWind(analysis: Analysis, apl: AplAudit | null | undefined): JadeWindReading {
	const talent = talentOf(analysis);
	return {
		talent,
		// Only measured for a monk who had the button. Running the arithmetic on a pull that proves the
		// talent was not taken would produce a truthful 0% that reads as a fault.
		measured: talent.state === 'taken' ? measure(analysis) : null,
		ladder: ladderOf(apl),
	};
}
