import type { Ability } from '~/lib/game/model';
import { overlapMs, type Interval } from './intervals';

export interface DriftWindow {
	/** When the button came back: the previous press's completion plus the cooldown. */
	start: number;
	/** When it was pressed again — the **commit**, not the landing. See the note on `cooldownDrift`. */
	end: number;
	/** Length of the window clipped to the live ranges — the part that counts. */
	ms: number;
}

export interface CooldownDrift {
	driftMs: number;
	lostCasts: number;
	/** Time the ability sat ready before the first press was committed, reported and never charged. */
	openerMs: number;
	/** Time it sat ready after the last one landed, likewise. */
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
 * clamped setting on every call; the default here is the `cooldownLeewayMs` entry of `WW_SETTINGS`
 * restated so that a direct caller gets the behaviour the report ships rather than a stricter one
 * nothing uses.
 *
 * ## Two clocks, and which end takes which — **decided**, not open
 *
 * A press has two instants and they are up to 2.5s apart: the `begincast` the player committed at, and
 * the `cast` it landed at (`casts.ts`' `CastPress.begin` and `.t`). The two ends of an idle window take
 * *different* ones, and the asymmetry is the answer rather than an oversight:
 *
 * - **It opens at the previous cast's completion**, because that is when the game starts the cooldown —
 *   `SPELL_CAST_SUCCESS` is the event that arms it. `spec/apl.ts` argues exactly this and keeps
 *   `lastCast` on landings for it: `apl.ts`' `ready()` ("`t` is the decision instant and `lastCast` holds
 *   landing instants, and the asymmetry is deliberate … a spell's cooldown starts when the cast
 *   *completes*") and again where `aplAudit` writes `lastCast` ("The landing, not the commit: a cooldown
 *   starts when the cast completes").
 *
 *   **Confirmed against the simulator rather than taken from `apl.ts`**, which matters because this repo
 *   had three sites asserting the premise and each of them cited the other two. In `wowsims-mop`, a spell
 *   with a cast time takes the hardcast branch at `sim/core/cast.go:178` and is given a `Hardcast` whose
 *   `OnComplete` (`:187`) is what calls `spell.triggerCooldown(sim)` (`:205`); `triggerCooldown` sets
 *   `spell.CD` to `sim.CurrentTime + cd` (`:258-268`), and that callback is fired by a pending action
 *   scheduled at `Hardcast.Expires` = `begincast + castTime` (`sim/core/gcd.go:8-24`). So `sim.CurrentTime`
 *   there is the landing: the cooldown is armed at the landing, as a fact about the game rather than a
 *   choice this file makes. An instant press runs the same two statements inline at `cast.go:241`, where
 *   the two instants coincide anyway.
 * - **It closes at the next press's commit**, because that is when the button stopped sitting unused.
 *   The seconds between committing and landing were spent pressing this very button; charging them says
 *   the cast itself was the mistake.
 *
 * Closing at the landing instead — which this did until the `commits` clock was threaded through — is
 * not a rounding concern but a systematic fabrication, and the flawless pull is the proof. On a 12s
 * cooldown behind a 2s cast, perfect play commits at 0, lands at 2s, is armed until 14s and is
 * committed again at 14s: nothing was held, and yet completion-to-completion charges 2s for every
 * single cast. Seven such casts came out as 12s of drift and **one lost cast on play that lost none**,
 * and the default `minWindowMs` of 1500 cannot forgive it because a 2000ms cast time exceeds it.
 * `__tests__/cooldowns.test.ts` pins that pull at zero.
 *
 * Plan §47 guessed the opposite direction ("understated by one cast time"); that only follows if the
 * cooldown is armed at the `begincast`, on which premise both ends move together and either clock is
 * right whenever the cast time is constant. It is not that premise the game runs, and it is not the one
 * `apl.ts` reads its own cooldowns on.
 *
 * `openerMs` takes the same closing end for the same reason: the button stopped sitting unused when the
 * player started casting it. `tailMs` does *not*, and must not be made symmetric — the last cooldown was
 * armed when the last cast landed, so the tail runs from `last landing + cooldownMs`.
 *
 * **No committed figure moves, measured and not assumed.** The Windwalker declares no `castTimeMs` at
 * all, and 0 of the 394 presses on `dataset-ironJuggernaut` have a `begincast` earlier than their `cast`
 * — so `commits` and `times` are the same array for every one of its buttons, Fists of Fury's channel
 * included. On the Elemental the only cooldown-gated button with a cast time is `elemental-blast`
 * (`castTimeMs: 2000`, `cooldownMs: 12_000`, on its own entry in `specs/elemental/lib/index.ts` — named
 * rather than numbered, because the line citation this replaced had already rotted by 74 lines under the
 * lanes editing that file), a talent nobody in `phased`, `unbroken` or `cleave` took. So this
 * corrects a figure no fixture can show — which is the argument for correcting it now rather than the
 * argument for leaving it: the next spec to declare a cast-time cooldown would have inherited a phantom
 * lost cast per pull with nothing anywhere failing.
 */
export function cooldownDrift(
	times: readonly number[],
	ability: Ability,
	live: readonly Interval[],
	durationMs: number,
	minWindowMs = 1500,
	/**
	 * When each of those presses was *committed* — `CastSeries.beginTimes`, element-for-element with
	 * `times`.
	 *
	 * Defaults to `times`, which is the honest reading for a caller that has only one clock: a spec of
	 * instants logs `begincast` and `cast` in the same millisecond, so the landings *are* the commits.
	 * `specs/windwalker/lib/index.ts`' Xuen call relies on that and is correct without it.
	 */
	commits: readonly number[] = times,
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
	// Indexed rather than `times.slice(1)`, because the closing end of each window comes from the
	// parallel `commits` array and needs the position to find it.
	for (const [i, t] of times.entries()) {
		if (i === 0) continue;
		// Opened at the completion, closed at the commit — see the two-clocks note above.
		const committed = commits[i] ?? t;
		if (committed > ready) idle.push([ready, committed]);
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
		openerMs: overlapMs(0, commits[0] ?? first, live),
		tailMs: overlapMs(Math.min(ready, durationMs), durationMs, live),
		windows,
	};
}
