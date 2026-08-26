import { mergeIntervals, type Interval } from './intervals';

import type { DamageEvent } from '~/lib/events';

/**
 * When the pull held something an execute button could be pressed on.
 *
 * Here rather than in a spec because health is not a class: every execute in the game is the same
 * predicate over the same two fields, and the only thing that varies is the fraction. Hammer of Wrath
 * is the first caller — `sim/paladin/hammer_of_wrath.go:49-50` gates it on `sim.IsExecutePhase20()` and
 * on nothing else, so a ladder that transcribed its rung as written would demand the button from the
 * pull's first global.
 *
 * ## What is measured, and the one place it departs from the simulator
 *
 * The sim has one target and asks whether *it* is below the threshold. A log has many, and a press this
 * report is judging has no target until it lands — so "was there something to execute" is the closest
 * question that can actually be answered, and it is the one answered here: the window is open while
 * **any enemy the player damaged** is under the fraction.
 *
 * **The direction of that departure is worth naming, because it can invent a fault either way.** Opening
 * the window too widely makes the rung want the button and charges the presses below it; closing it too
 * early makes a real execute press fall past its own rung to whatever is under it. Neither is safe, so
 * the reading is the true one — the union is what "you had something in range" means on a pull with adds,
 * and the alternative, gating on the report's primary enemy, calls an add pull's whole execute phase shut.
 *
 * ## Why a window and not a threshold read at the press
 *
 * A health reading exists only on an event, and events are not evenly spaced: a stretch with no damage
 * carries no reading at all. Read pointwise, a press in such a stretch would answer "no reading, so no"
 * — which is not caution, it is the specific claim that the boss healed back up. Windows carry the last
 * reading forward to the enemy's own last event, which is what a health bar does.
 *
 * ## What an empty result means, and why the caller needs `readable` beside it
 *
 * A pull whose enemies never dropped below the fraction and a pull whose events carry no health at all
 * both produce no windows, and they are opposite facts: the first says the execute never opened, the
 * second says nobody can say. `readable` is the difference, and a caller handing these to the APL engine
 * has to publish both — a rung that read "no window" as "not in execute" on an unreadable log would
 * silence nothing and quietly invent every fault below it.
 */
export interface ExecuteWindows {
	/** The stretches at least one damaged enemy spent under the fraction, merged and in order. */
	windows: readonly Interval[];
	/**
	 * Whether the stream carried any enemy health at all.
	 *
	 * False is "this log cannot say", which is a different answer from an empty `windows` and the reason
	 * this field exists. See the note above.
	 */
	readable: boolean;
}

/**
 * A reading that describes an **enemy** rather than the player.
 *
 * `maxHitPoints` is 100 on every event describing a player — see `ResourceSampled.hitPoints` — so the
 * pool is what separates the two, and the cut is at any pool larger than a percentage could be. Written
 * as `> 100` rather than `>= 1000` because 100 is exactly the value the player-side convention uses and
 * anything above it is an absolute number; a rounder threshold would be a guess dressed as a constant.
 */
const isEnemyReading = (event: DamageEvent): boolean =>
	event.hitPoints !== undefined && event.maxHitPoints !== undefined && event.maxHitPoints > 100;

/**
 * Reads the execute windows off a pull's damage stream.
 *
 * `pct` is the fraction of maximum health, as a percentage — 20 for the Paladin's execute. `t0` and
 * `durationMs` put the result on the fight-relative clock every other window set in this tree is on.
 *
 * The per-enemy walk keys on `resourceActor` and not on `targetID`, and they are usually the same number
 * and sometimes not: `resourceActor` names whose bars the event carries, which on a pull with pets is the
 * distinction the field exists to make. Reading the bar off the wrong actor would put the boss's health
 * on a totem's clock.
 */
export function executeWindows(
	damageEvents: readonly DamageEvent[],
	pct: number,
	t0: number,
	durationMs: number,
): ExecuteWindows {
	const byActor = new Map<number, Array<[number, number]>>();
	for (const event of damageEvents) {
		if (!isEnemyReading(event)) continue;
		const actor = event.resourceActor;
		if (actor === undefined) continue;
		const at = event.timestamp - t0;
		if (at < 0 || at > durationMs) continue;
		const share = (100 * (event.hitPoints ?? 0)) / (event.maxHitPoints ?? 1);
		const readings = byActor.get(actor);
		if (readings === undefined) byActor.set(actor, [[at, share]]);
		else readings.push([at, share]);
	}
	if (byActor.size === 0) return { windows: [], readable: false };

	const spans: Interval[] = [];
	for (const readings of byActor.values()) {
		readings.sort((a, b) => a[0] - b[0]);
		// The first reading under the fraction opens the window and the enemy's own last reading closes
		// it. Not the first reading *back over* the fraction, deliberately: a boss that heals above the
		// execute line is a real mechanic and a rare one, while a reading that jumps back up because the
		// next event describes a fresh spawn of the same actor id is the ordinary case on an add pull.
		// Closing at the last reading is the answer that does not turn a respawn into a shut execute.
		const opened = readings.find(([, share]) => share <= pct);
		const last = readings[readings.length - 1];
		if (opened === undefined || last === undefined) continue;
		spans.push([opened[0], Math.max(opened[0], last[0])]);
	}
	return { windows: mergeIntervals(spans), readable: true };
}
