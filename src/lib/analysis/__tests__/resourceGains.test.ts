// A generator whose yield is conditional, and the walk that used to credit it unconditionally.
//
// Written after the fix rather than before it, because the fix moved **nothing** on any committed pull
// and the reason is worth pinning: no Windwalker raw fixture in this tree contains a single Rushing
// Jade Wind cast. `dataset-ironJuggernaut.json` is the only one, and it has zero. So the behaviour this
// file describes is real, is reachable from `analyseCore`, and is exercised by no log here — which is
// exactly the shape of the three sibling bugs that got into this codebase before it.
//
// The rule: **Rushing Jade Wind pays its chi only at three units or more.** wowsims' `registerRushing-
// JadeWind` guards the refund with `if sim.Environment.ActiveTargetCount() >= 3`. Declared as a flat
// gain, the walk credited a chi to every single-target press.
//
// Why that mattered more than one point of chi: it is a fault pointing the *opposite* way to the one
// the priority ladder makes when it calls a fanned-out wind press off-list. A report carrying both is a
// report where they cancel, and neither is visible.
//
// **And the log agrees, which is the part worth keeping.** `chiAtCasts` scores its own reconstruction —
// every press carrying a bar reading is a chance to check what the walk believed against what the log
// says — so the two models can be compared without appealing to the sim at all. Measured on the two
// committed pulls that press the wind:
//
//     sections.json (Galakras, 33 presses, 6 under three)   exact 95/128 -> 101/128   gained 266 -> 260
//     idle.json     (Immerseus, 9 presses, 4 under three)   exact 39/47  ->  41/47    gained  89 ->  86
//
// The gate does not merely subtract chi the player never had; it makes the reconstruction **agree with
// the log more often**, on every pull that can tell the two apart. A change that only removed points
// would be an argument; one that raises agreement is a measurement.

import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import { RESOURCE_TYPE } from '~/lib/game/resources';

import { chiAtCasts, wclPowerTypeOf } from '../energy';

const T0 = 100_000;
const ME = 5;
const RJW = 116_847;
const CHI = wclPowerTypeOf(RESOURCE_TYPE.chi);

/** A cast carrying a chi reading, as `includeResources: true` returns one. */
const press = (t: number, id: number, chi: number): WclEvent =>
	({
		timestamp: T0 + t,
		type: 'cast',
		abilityGameID: id,
		sourceID: ME,
		resourceActor: 1,
		classResources: [{ type: CHI, amount: chi, max: 4 }],
	}) as unknown as WclEvent;

/**
 * A cast the log did not sample a bar on — which is where a gain is load-bearing at all.
 *
 * Roughly a third of real casts arrive without `classResources`, and the walk carries its belief
 * across them from the gains and costs it knows. **A press that carries a reading overwrites that
 * belief outright** ("a reading is the truth, whatever the walk believed a moment ago"), so a test
 * that samples every press cannot see a gain go missing — it was measuring the log, not the model.
 * That is the mistake this file's first draft made.
 */
const unsampled = (t: number, id: number): WclEvent =>
	({
		timestamp: T0 + t,
		type: 'cast',
		abilityGameID: id,
		sourceID: ME,
		// Present and no bar, which is the real shape: `resourceActor` says whose bars an event carries,
		// and the walk skips any event that does not name an owner. An unsampled press still names one.
		resourceActor: 1,
	}) as unknown as WclEvent;

/**
 * The lookup `analyseCore` builds, in miniature: one gain, gated on a target count read at the press.
 *
 * `targetsAt` stands in for `triggerTargetCountAt` — the units the press *hit*, damage or not. That is
 * the series the refund fires on, and deliberately not the damage count: a wind spinning through three
 * immune Crawler Mines pays its chi, so a gate read off damage would deny a refund the game gave.
 */
const gateAt =
	(targetsAt: (ms: number) => number, minTargets: number) =>
	(id: number, atMs: number): number | undefined => {
		if (id !== RJW) return undefined;
		return targetsAt(atMs) < minTargets ? undefined : 1;
	};

describe('a gain declared with minTargets is paid only when the press reached it', () => {
	it('pays nothing on a press under the floor, and one on a press at it', () => {
		// One sampled press to give the walk a footing, then two unsampled ones it must reason about.
		// The wind catches two units at 4s and three at 8s, so only the second may bank a point.
		const events = [press(0, RJW, 0), unsampled(4000, RJW), unsampled(8000, RJW)];
		const targetsAt = (ms: number): number => (ms < 8000 ? 2 : 3);

		const walk = chiAtCasts(events, ME, T0, gateAt(targetsAt, 3), CHI);

		expect(walk.points).toEqual([
			[0, 0],
			[4000, 0],
			[8000, 0],
		]);
		// The point lands after the press that earned it, which the next press would read.
		expect(walk.gained).toBe(1);
	});

	it('is the difference between crediting one press and crediting all three', () => {
		const events = [press(0, RJW, 0), unsampled(4000, RJW), unsampled(8000, RJW)];
		const underFloor = (): number => 1;
		const overFloor = (): number => 3;

		const denied = chiAtCasts(events, ME, T0, gateAt(underFloor, 3), CHI);
		const paid = chiAtCasts(events, ME, T0, gateAt(overFloor, 3), CHI);
		const flat = chiAtCasts(events, ME, T0, () => 1, CHI);

		// Three single-target presses bank nothing; three three-target presses bank three.
		expect(denied.gained).toBe(0);
		expect(paid.gained).toBe(3);
		// **The flat model is the old one, and it agrees with the wrong answer.** On a pull the player
		// spent alone with the boss it handed them three chi they never had.
		expect(flat.gained).toBe(paid.gained);
		expect(flat.gained).not.toBe(denied.gained);
	});

	it('reads the count at the press, not once for the pull', () => {
		// A pull that starts single, opens into a pack, and closes single again.
		const events = [press(0, RJW, 0), unsampled(4000, RJW), unsampled(8000, RJW)];
		const targetsAt = (ms: number): number => (ms === 4000 ? 5 : 1);
		const seen: number[] = [];
		const spy = (id: number, atMs: number): number | undefined => {
			seen.push(atMs);
			return gateAt(targetsAt, 3)(id, atMs);
		};

		const walk = chiAtCasts(events, ME, T0, spy, CHI);

		// Every press asked, each about its own moment — a lookup handed only an ability id could not
		// have answered differently for the middle one.
		expect(seen).toEqual([0, 4000, 8000]);
		// And exactly the middle one paid.
		expect(walk.gained).toBe(1);
	});
});
