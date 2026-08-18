import type { Ability } from '~/lib/game/model';
import { overlapMs, type Interval } from './intervals';

export interface DriftWindow {
	start: number;
	end: number;
	/** Length of the window clipped to the live ranges — the part that counts. */
	ms: number;
}

export interface CooldownDrift {
	driftMs: number;
	lostCasts: number;
	/** Time the ability sat ready before the first cast, reported and never charged. */
	openerMs: number;
	/** Time it sat ready after the last one, likewise. */
	tailMs: number;
	/** Idle stretches worth reporting, longest first. */
	windows: DriftWindow[];
}

/**
 * Time a cooldown sat ready and unused, converted to casts.
 *
 * The ability comes in whole rather than as a bare number of milliseconds because the first question
 * is not "how long is the cooldown" but "does this button have one that holding is a mistake". Only
 * a `cooldown`-gated ability is scored: a resource-gated button has no cooldown to drift against,
 * and putting a drift figure on Jab or Rushing Jade Wind — both energy, both chi generators —
 * produces the same fabricated indictment as "13 of 89 possible casts". Anything else comes back as
 * all zeroes.
 *
 * Two exclusions keep the number honest, and both are returned separately rather than folded in:
 *
 * - `live` clips every window to the stretches the target was engaged, so an intermission the player
 *   could do nothing about is not charged as a mistake — against the whole fight instead, one 30s
 *   untargetable phase alone invented four lost casts.
 * - Only the gaps *between* casts count. The stretch before the first cast is opener noise (prepull
 *   casts, running in, the pull timer) and the stretch after the last one is the boss dying on a
 *   cooldown that was coming back anyway. Charging either invents mistakes: on one log the tail
 *   alone was a phantom 39s of Chi Brew.
 *
 * A third exclusion is `minWindowMs`, and it is the reader's rather than this function's: a wait no
 * longer than it is a press that landed late, not a cooldown that was held, and it is dropped whole.
 * Whole, and not shortened — a longer wait is still charged from the moment the button came back, so
 * widening the window forgives short waits without ever discounting a long one. The report passes the
 * clamped setting on every call; the default here is `COOLDOWN_LEEWAY.default` restated so that a
 * direct caller gets the behaviour the report ships rather than a stricter one nothing uses.
 */
export function cooldownDrift(
	times: readonly number[],
	ability: Ability,
	live: readonly Interval[],
	durationMs: number,
	minWindowMs = 1500,
): CooldownDrift {
	const nothing: CooldownDrift = {
		driftMs: 0,
		lostCasts: 0,
		openerMs: 0,
		tailMs: 0,
		windows: [],
	};
	const cooldownMs = ability.gate === 'cooldown' ? (ability.cooldownMs ?? 0) : 0;
	const first = times[0];
	if (first === undefined || cooldownMs <= 0) return nothing;

	const idle: Interval[] = [];
	let ready = first + cooldownMs;
	for (const t of times.slice(1)) {
		if (t > ready) idle.push([ready, t]);
		ready = t + cooldownMs;
	}

	const windows = idle
		.map(([start, end]) => ({
			start,
			end,
			ms: overlapMs(start, end, live),
		}))
		.filter((w) => w.ms > minWindowMs)
		.sort((a, b) => b.ms - a.ms);
	const driftMs = windows.reduce((sum, w) => sum + w.ms, 0);

	return {
		driftMs,
		lostCasts: Math.floor(driftMs / cooldownMs),
		openerMs: overlapMs(0, first, live),
		tailMs: overlapMs(Math.min(ready, durationMs), durationMs, live),
		windows,
	};
}
