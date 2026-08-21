// A dot's tick cadence, measured off the log instead of declared — and the one rule that reads it.
//
// A dot in this expansion is affected by haste without being affected by duration (see `Dot` in
// `lib/game/model`), so its tick count is a property of the *pull* and not of the spell. Flame Shock
// declares ten three-second ticks; the two committed Elemental fixtures carry it at thirteen,
// seventeen and twenty-two, in the same fight, as the raid's haste cooldowns came and went. Nothing
// declared can be right for all three, so nothing here is declared: the cadence is read back out of
// the tick stream and the tick count is backed out of the cadence.
//
// ## What the ticks actually looked like
//
// Measured on `src/specs/elemental/__fixtures__/phased.json` (`a:qHRAFwdGzaB6MPYC` #14), Flame Shock
// on the boss, 114 periodic damage events. Three plateaus, in order: ~1 348ms for the opener,
// ~1 752ms, then ~2 281ms — which is 3 000ms over a haste multiplier of 2.22, 1.71 and 1.32, the
// shape of Bloodlust and Elemental Mastery dropping off one after the other. Backed out against the
// declared 30s duration those are 22, 17 and 13 ticks, and the log agrees: the application at 2 631
// fired 22 ticks and was removed at 32 291, 22 × 1 348 later.
//
// ## The two intervals that lie, and why this is not a plain mean
//
// Both traps are real readings off that same pull, not hypotheticals.
//
//   - **An interval that spans an absence is not a tick interval.** 151 149 → 195 340 is 44 191ms,
//     across the boss submerging. Haste can only ever *shorten* the interval, so anything longer than
//     the unhasted period is by construction not one period — that is the filter, and it needs no
//     threshold to be tuned. It also stops the walk rather than skipping the interval, because
//     everything before an absence belongs to an application that has already ended.
//   - **A re-application boundary slips under that filter.** 90 170 → 92 817 is 2 647ms, across a
//     removal at 90 171 and a fresh application at 91 059; 120 869 → 123 797 is 2 928ms, the same shape.
//     Both are shorter than the unhasted 3 000ms period, so the filter cannot see them, and a four-
//     sample mean that swallows one reads a fifth of a tick long. So the longest interval of the sample
//     is dropped before the mean is taken — which is why this is a trimmed mean and not a plain one.
//
// The trim changes no verdict on either committed fixture (checked press by press against the plain
// mean: identical), because on both of them the boundary intervals fall outside every sample a graded
// press draws. It is a guard against the sample that would have caught one, held by a unit test rather
// than by a number on those two pulls.
//
// The first interval of an application (from the apply to its first tick) is deliberately *not*
// special-cased: measured, it is a full period either way (2 631 → 3 990 is 1 359ms against a 1 348ms
// cadence), because the tick timer starts at the application.

import type { WclEvent } from '~/lib/events';
import { abilityIdOf, instanceKey, isDamage } from '~/lib/events/guards';
import type { Aura, Dot } from '~/lib/game/model';

import { median } from './format';
import { lastIndexAtOrBefore } from './search';

/** How many consecutive intervals a cadence is measured over, at most. */
export const TICK_SAMPLE = 4;
/** The fewest that can answer at all: one interval is a reading, not a measurement. */
export const TICK_MIN_SAMPLE = 2;

/**
 * Every periodic tick of one dot, in ms since `t0`, bucketed by the spawn that took it.
 *
 * Per **spawn** rather than per target id, for the reason the Elemental audit's dot windows already
 * are: two spawns of one add interleave into a single stream, and an interval measured across the
 * seam belongs to neither of them.
 *
 * `tick === true` is what makes a damage event periodic. Flame Shock's direct hit logs under the same
 * spell id without it, so counting every damage event would put a phantom interval at every
 * application — the same trap a channel's ticks logging as casts sets one file over.
 */
export function dotTicksBySpawn(
	events: readonly WclEvent[],
	aura: Aura,
	t0: number,
	sourceID: number,
): Map<string, number[]> {
	const out = new Map<string, number[]>();
	for (const [key, ticks] of dotTickSnapshotsBySpawn(events, aura, t0, sourceID)) {
		out.set(
			key,
			ticks.map((tick) => tick.t),
		);
	}
	return out;
}

/** One periodic tick of a dot: when it landed, and the reading that identifies the application it came from. */
export interface DotTick {
	/** When it landed, in ms since `t0`. */
	t: number;
	/**
	 * `unmitigatedAmount`: the tick stripped of armour, absorbs, **the crit roll** and **the target's own
	 * damage-taken multipliers** — so it is the application's snapshot in isolation, with no stat model
	 * behind it at all. Null only when the log omitted the field.
	 *
	 * `amount` cannot answer this question. It moves with every crit and with every damage-taken debuff
	 * the raid puts on the target, so it changes tick to tick *inside a single application* — which is
	 * exactly the thing a snapshot reading has to hold still. Measured across the three committed
	 * Elemental fixtures: 346 Flame Shock ticks, none missing the field, and `unbroken`'s 98 ticks take
	 * **6** distinct `unmitigatedAmount` values — one per application — against 25 distinct `amount`s.
	 *
	 * It carries a one-unit rounding wobble (13 529 against 13 530 inside one `cleave` application),
	 * which is why every reading of it below is a median and never a mean.
	 */
	unmitigatedAmount: number | null;
}

/**
 * Every periodic tick of one dot with the snapshot it carried, bucketed by the spawn that took it.
 *
 * Same stream and same bucketing as `dotTicksBySpawn`, which is built on this — see that function for
 * why the key is a spawn and why `tick === true` is the filter.
 */
export function dotTickSnapshotsBySpawn(
	events: readonly WclEvent[],
	aura: Aura,
	t0: number,
	sourceID: number,
): Map<string, DotTick[]> {
	const ids = new Set(aura.ids);
	const out = new Map<string, DotTick[]>();
	for (const e of events) {
		if (!isDamage(e) || e.tick !== true || e.sourceID !== sourceID) continue;
		const id = abilityIdOf(e);
		if (id === null || !ids.has(id)) continue;
		if (e.targetID === undefined) continue;
		const key = instanceKey(e.targetID, e.targetInstance);
		const tick: DotTick = { t: e.timestamp - t0, unmitigatedAmount: e.unmitigatedAmount ?? null };
		const bucket = out.get(key);
		if (bucket) bucket.push(tick);
		else out.set(key, [tick]);
	}
	for (const bucket of out.values()) bucket.sort((a, b) => a.t - b.t);
	return out;
}

/** The cadence in force at one instant, and the tick count it buys. */
export interface TickWindow {
	/**
	 * The interval between ticks at that instant, in ms — and so the width of the dot's last tick
	 * window, which is the whole reason this is measured.
	 */
	cadenceMs: number;
	/**
	 * How many consecutive intervals it was measured over, 2 to `TICK_SAMPLE`. **Zero means the log
	 * could not answer** and the base period was used instead — a dot with no ticks yet, a press onto
	 * a target that never carried one, a synthetic pull with no periodic damage in it. Reported rather
	 * than hidden, because "the unhasted period" and "measured at the unhasted period" are different
	 * facts about a pull.
	 */
	samples: number;
	/**
	 * The tick count that cadence buys over the dot's base duration, which is the count the pull
	 * actually got. `round`, not `floor`: the game schedules whole ticks and rounds to the nearest, and
	 * the fixture agrees — 30 000 / 1 348 is 22.3 and 22 ticks were logged.
	 */
	ticks: number;
}

/**
 * The dot's tick window at `t`, measured back from the last tick at or before it.
 *
 * Refuses a dot whose duration haste shortens: there the tick count is fixed and a count backed out
 * of a cadence would be an invention. Nothing declares one today, and the refusal is here so that the
 * first thing that does fails loudly instead of quietly.
 */
export function tickWindowAt(tickTimes: readonly number[], t: number, dot: Dot): TickWindow {
	if (!dot.hastedTicks) {
		throw new Error('tickWindowAt: haste shortens this dot’s duration, so its tick count cannot be read off a cadence');
	}
	const base: TickWindow = { cadenceMs: dot.tickMs, samples: 0, ticks: dot.ticks };
	const last = lastIndexAtOrBefore(tickTimes.length, (i) => tickTimes[i] ?? Infinity, t);
	const sample: number[] = [];
	for (let i = last; i > 0 && sample.length < TICK_SAMPLE; i--) {
		const gap = (tickTimes[i] ?? 0) - (tickTimes[i - 1] ?? 0);
		// Longer than the unhasted period, so it spans an absence rather than a tick. Everything before
		// it belongs to an earlier application, which is why this stops rather than skips.
		if (gap > dot.tickMs) break;
		sample.push(gap);
	}
	if (sample.length < TICK_MIN_SAMPLE) return base;
	// The mean of the sample with its longest interval dropped — see the note at the top of the file on
	// the re-application boundary the plausibility filter cannot see. It biases the reading a few ms
	// short of the truth (1 348.7 against a measured 1 348.2 on the fixture's opener, 0.04%), which is
	// far inside the accuracy the verdict needs.
	const trimmed = sample.length > TICK_MIN_SAMPLE ? withoutMax(sample) : sample;
	const cadenceMs = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
	return { cadenceMs, samples: sample.length, ticks: Math.round(dot.durationMs / cadenceMs) };
}

/**
 * Did a reapplication with `remainingMs` left land in the dot's **last tick window**?
 *
 * That is the whole scoring rule. One tick period or less remaining means one tick is still pending,
 * and reapplying there rolls that tick over — the player keeps it *and* gets a full fresh dot, so the
 * global bought the most it could. Reapplying earlier buys the same fresh dot for the same global
 * while more of the old one was still owed, which is what the sim's own priority list means by
 * refreshing "when the dot has less than one tick left".
 *
 * Zero remaining is not in the window: the dot was already down, and putting one back up is a
 * different press with a different name (see `FlameShockPressKind`).
 *
 * **Throws for a dot that does not roll over — Warlock.** The question does not apply there, and a
 * bare `false` would be read as the player having missed the window. See `Dot.rollsOver`.
 */
export function inLastTickWindow(remainingMs: number, window: TickWindow, dot: Dot): boolean {
	if (!dot.rollsOver) {
		throw new Error(
			'inLastTickWindow: this dot does not roll over, so the last tick window is not what grades a refresh',
		);
	}
	return remainingMs > 0 && remainingMs <= window.cadenceMs;
}

/** What one application of a snapshotting dot froze at the instant it went up. */
export interface DotSnapshot {
	/** Its per-tick unmitigated amount: the median of the application's own ticks. */
	tickAmount: number;
	/** Its tick period in ms, measured off the application's own ticks. */
	cadenceMs: number;
	/**
	 * `tickAmount / cadenceMs` — damage per **millisecond of dot**, and not the damage of a tick.
	 *
	 * That is the sim's own combined form, not a refinement of it. `dotPercentIncrease`
	 * (`sim/core/apl_values_dot.go:338-347`) divides `ExpectedTickDamage` by the dot's tick period
	 * (`sim/shaman/shocks.go:96-105`), because Flame Shock snapshots its **cadence** as well as its
	 * damage — `AffectedByCastSpeed: true` at `sim/shaman/shocks.go:79-88`, with `dot.tickPeriod` frozen
	 * at apply (`sim/core/dot.go:81-89`, `:122-146`). More haste at the application means more ticks
	 * inside the same fixed 30s, so a faster application is a stronger one even at identical tick damage.
	 *
	 * The distinction flips verdicts rather than nudging them, measured on the committed fixtures:
	 * `unbroken`'s refresh at 140.03s is **+1.9%** on tick damage and **+32.7%** per millisecond, and
	 * `cleave`'s at 57.50s is **+29.7%** on tick damage and **−23.5%** per millisecond. Reading tick
	 * damage would credit the second and pass over the first, and both answers would be wrong.
	 */
	strength: number;
	/** How many of the application's ticks the reading is over. */
	ticks: number;
}

/**
 * The snapshot the application running in `(from, to]` froze, or null when the log cannot say.
 *
 * `from` and `to` are **presses**, not instants of interest, and that is what makes the reading clean:
 * only one application of a dot can tick on one spawn between two presses at it, so every tick in the
 * half-open segment belongs to the same application and the segment needs no other boundary detection.
 *
 * Two consequences of that, both deliberate:
 *
 *   - **The cadence is the plain mean of the segment's own intervals**, not the trimmed four-sample mean
 *     `tickWindowAt` takes. That trim exists because a walk backwards from an arbitrary instant cannot
 *     see a re-application boundary (see the note at the top of this file); a press-bounded segment
 *     cannot contain one, so trimming here would only throw away accuracy. Reading `unbroken`'s
 *     application at 28.63s: 1 728ms over all fifteen of its intervals against 1 704ms from the first
 *     four trimmed, which is a 1.4% error in a ratio that decides a verdict.
 *   - **Intervals longer than the unhasted period are still dropped.** They span an absence rather than
 *     a tick — the target left, or the dot expired well before the next press — and haste can only ever
 *     shorten a period, so nothing needs tuning to recognise one.
 *
 * Null rather than a guess when the segment carries fewer than `TICK_MIN_SAMPLE` intervals: one
 * interval is a reading and not a measurement, the same floor the rest of this file holds. On the
 * committed fixtures that is one press — `cleave`'s last, at 259.72s, whose application got a single
 * tick before the fight ended. A caller must fall through to whatever it would have concluded without
 * a snapshot reading rather than treat null as "no change".
 */
export function dotSnapshotIn(ticks: readonly DotTick[], from: number, to: number, dot: Dot): DotSnapshot | null {
	const own = ticks.filter((tick) => tick.t > from && tick.t <= to);
	const amounts = own.map((tick) => tick.unmitigatedAmount).filter((a): a is number => a !== null);
	if (amounts.length === 0) return null;
	const intervals: number[] = [];
	for (let i = 1; i < own.length; i++) {
		const gap = (own[i]?.t ?? 0) - (own[i - 1]?.t ?? 0);
		if (gap > dot.tickMs) continue;
		intervals.push(gap);
	}
	if (intervals.length < TICK_MIN_SAMPLE) return null;
	const cadenceMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
	const tickAmount = median(amounts);
	return { tickAmount, cadenceMs, strength: tickAmount / cadenceMs, ticks: own.length };
}

/** The sample with one copy of its largest entry removed. */
function withoutMax(sample: readonly number[]): number[] {
	const at = sample.indexOf(Math.max(...sample));
	return sample.filter((_, i) => i !== at);
}
