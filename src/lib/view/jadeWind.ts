// Rushing Jade Wind, read off a finished analysis.
//
// A view module rather than an engine audit, and for the same reason `rotationFlow` is one: every
// number here is arithmetic over measurements `analyse()` already published, and none of it is a new
// reading of the event stream. The aura windows are the buff lane the engine builds from
// `auraWindows(selfEvents, RUSHING_JADE_WIND, …)`, the contact segments are the ones Rising Sun Kick
// is graded against, the press times are the ability's own `CastRow.times`, and the regen rate is the
// energy audit's measured median. Deriving them here rather than adding a field means the section
// works on every committed fixture instead of on the ones captured after it — and it means nothing in
// `spec/windwalker.ts` had to move.
//
// It is a module rather than a `useMemo` inside the section because the ceiling argument below is the
// substance of the section, and an argument that cannot be asserted is an argument that quietly
// stops being true.
//
// ## The denominator, which is the whole difficulty
//
// Rushing Jade Wind's dot lasts six seconds and its cooldown is six seconds, re-armed to whatever is
// left of the dot (`spell.CD.Set(sim.CurrentTime + remainingDuration)` in `registerRushingJadeWind`).
// So at every instant the button is either spinning or ready, and the *cooldown's* possible uptime is
// 100% of any stretch anybody cares to measure. A tile reading "53% of a possible 100%" is
// arithmetically true and grades nothing — nobody falls short of that ceiling by accident.
//
// What actually rations the button is the energy bar, and that is measurable rather than assumed:
// 40 energy every six seconds is 6.67 a second, against a *measured* regen of 12.3–13.5 across the
// six committed fixtures. So continuous coverage costs about half of every point a pull produces —
// 52.4%, 52.5% and 51.7% on the three fixtures that took the talent, computed per pull from that
// pull's own rate rather than from a number written down here. That is the figure the section prints
// beside the uptime, because it is the one that says what the ceiling would have cost the rest of the
// rotation.
//
// It is deliberately *not* folded into the uptime as a corrected ceiling. Doing that would mean
// deciding how much of the bar Jab, Tiger Palm and the chi spenders are entitled to, and no such
// budget exists in the sim or in the priority list. The list's one energy test on this button —
// `Energy: Time to Cap <= 1s` on entry 31 — is an overflow guard on the bottom rung and not a share
// of the bar, so there is still nothing here to borrow a ceiling from. An invented budget dressed as
// a ceiling is exactly the fabricated standard this report refuses everywhere else, so the price is
// stated and the judgement is left to the priority list.
//
// ## One clock
//
// Every figure here is a fraction of contact time, numerator and denominator alike, and structurally
// so: the clock is built once as a set of segments, the denominator is that set's union and the
// numerator is an intersection with it. A press outside contact cannot be counted against a ceiling
// measured inside it, which is the mismatch that has produced a wrong number in this report five
// times over.

import { intersect, unionMs, type Interval } from '~/lib/analysis/intervals';
import { RJW_COOLDOWN_MS, RJW_ENERGY_COST, type AplAudit } from '~/lib/spec/apl';
import type { Analysis } from '~/lib/types';

import { excludedButtons, pressedButtons } from './rotationFlow';

/** The button's cast id, which is also the buff's — the lane key and the ladder both key on it. */
export const RJW_CAST_ID = 116_847;

/** Invoke Xuen: the other half of the level-90 talent row, and the usual proof the wind was not taken. */
const INVOKE_XUEN_ID = 123_904;

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

/** Everything measured on the contact clock. */
export interface JadeWindMeasurement {
	/** The clock: the union of the contact segments, or the pull when an older analysis carries none. */
	measuredMs: number;
	uptimeMs: number;
	uptimePct: number;
	/** Presses made inside that clock — the same stretch the ceiling below is counted over. */
	presses: number;
	/** What the cooldown had room for over it. Floored: a ceiling of 85.9 presses is one nobody can hit. */
	possiblePresses: number;
	spentEnergy: number;
	ceilingEnergy: number;
	/**
	 * Energy the pull's own regen produced over the same clock, and the two shares taken against it.
	 *
	 * Null rather than zero when the log carried too few resource readings to measure a rate — the
	 * same refusal `EnergyAudit.regenPerSec` makes, for the same reason. A rate taken from memory
	 * would turn an unknown into a confident number, and this one is the section's whole argument.
	 */
	incomeEnergy: number | null;
	spentSharePct: number | null;
	ceilingSharePct: number | null;
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
	const possiblePresses = Math.floor(measuredMs / RJW_COOLDOWN_MS);

	const regenPerSec = analysis.energy?.regenPerSec ?? null;
	const incomeEnergy = regenPerSec === null ? null : (regenPerSec * measuredMs) / 1000;
	const spentEnergy = presses * RJW_ENERGY_COST;
	const ceilingEnergy = possiblePresses * RJW_ENERGY_COST;
	const share = (energy: number): number | null =>
		incomeEnergy === null || incomeEnergy <= 0 ? null : (energy / incomeEnergy) * 100;

	return {
		measuredMs,
		uptimeMs,
		uptimePct: measuredMs > 0 ? (uptimeMs / measuredMs) * 100 : 0,
		presses,
		possiblePresses,
		spentEnergy,
		ceilingEnergy,
		incomeEnergy,
		spentSharePct: share(spentEnergy),
		ceilingSharePct: share(ceilingEnergy),
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
	return {
		followed,
		skipped,
		judged: followed + skipped,
		wanted: apl.skippedBy.filter((s) => s.id === RJW_CAST_ID).reduce((sum, s) => sum + s.count, 0),
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
