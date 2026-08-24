// A generator whose yield is conditional, a walk that used to credit it unconditionally — and a log that
// had been telling this report the answer all along.
//
// Written after the fix rather than before it, and written against a fixture set that could not see it:
// `dataset-ironJuggernaut.json` was the tree's only raw Windwalker pull and it contains zero Rushing Jade
// Wind casts, so the behaviour described here was real, reachable from `analyseCore`, and exercised by no
// log — exactly the shape of the three sibling bugs that got into this codebase before it. **That is no
// longer the state.** Three raw pulls have since been committed and two of them press the wind, which is
// what every measurement below is taken off.
//
// The rule: **Rushing Jade Wind pays its chi only at three units or more.** wowsims' `registerRushing-
// JadeWind` guards the refund with `if sim.Environment.ActiveTargetCount() >= 3`. Declared as a flat
// gain, the walk credited a chi to every single-target press.
//
// Why that mattered more than one point of chi: it is a fault pointing the *opposite* way to the one the
// priority ladder makes when it calls a fanned-out wind press off-list. A report carrying both is a report
// where they cancel, and neither is visible.
//
// **The three pulls then said something the sim could not.** WarcraftLogs reports the wind's refund as its
// own `resourcechange`, under ability 129881 rather than under the wind's cast id — and across the raw
// fixtures that id appears beside a wind press and nowhere else: 27 events against 33 presses on
// `sections.json`, 4 against 9 on `idle.json`, and **zero on `uncounted.json`, which presses the wind zero
// times**. So the log names which presses actually paid, and two separate faults could be scored against
// it rather than argued:
//
//   - **The gate was reading a count the wind had been taken out of.** `minTargets` was counted against
//     `triggerTargetCountAt`, which has `aplTargetCountExclude` applied — and for this spec that list is
//     exactly `rushing-jade-wind`. `analyseCore`'s `refundTargetCountAt` is the un-excluded series and its
//     docblock carries the scoring: 7 wrong verdicts of 33 on `sections` against the excluded series' 10.
//   - **The declared gain was credited on top of the event.** `pointsResourceAudit` cuts a gain the log
//     states outright out of the walk's table, but it matched by the press's own id (116847) and the log
//     reports under 129881, so the guard never fired and the wind's chi was counted twice. `ResourceConfig.
//     gains.reportedAs` is the spec naming the id it arrives under.
//
// What the second one cost, on the walk's own ground truth: `chiAtCasts` scores its reconstruction
// against every press that carries a bar reading, so the two models can be compared without appealing to
// the sim at all:
//
//     sections.json (Galakras, 33 wind presses)   exact 99/128 -> 117/128   gained 260 -> 241
//     idle.json     (Immerseus,  9 wind presses)  exact  40/47 ->  43/47    gained  86 ->  83
//     uncounted.json (Malkorok,  0 wind presses)  exact  75/80 unmoved      gained 153 unmoved
//
// **And the gate is now exercised by no committed log**, which is worth stating plainly rather than
// leaving for the next reader to discover. `reportedAs` switches the declared gain off for any pull whose
// log carries a 129881, and all three of these do; what is left for `minTargets` is a pull whose log does
// not, and none is committed. The synthetic walks below are the whole of what holds it — the same position
// this file opened in, arrived at deliberately this time.

import { describe, expect, it } from 'vitest';

import type { FightDataset } from '~/lib/types';
import { rawFixtures } from '~/lib/analysis/fixtures';
import { abilityIdOf, type WclEvent } from '~/lib/events';
import { RESOURCE_TYPE } from '~/lib/game/resources';
import { analyse } from '~/specs/windwalker/lib';

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

/**
 * The premise `reportedAs` rests on, checked against the logs rather than looked up.
 *
 * Nothing in a `resourcechange` names the press that caused it, so the pairing is the claim: 129881 is the
 * wind's refund if and only if it turns up beside wind presses and nowhere else. `uncounted.json` is what
 * makes that a claim rather than a coincidence — 181 presses, plenty of fan-out, and not one wind.
 */
describe("the log's own record of the refund", () => {
	const RAW = rawFixtures('windwalker');
	const CHI = wclPowerTypeOf(RESOURCE_TYPE.chi);
	const RJW_CAST = 116_847;
	const RJW_CHI = 129_881;
	/** Wide enough for the three events the log stamps up to 1.2s after the press they follow. */
	const PAIR_MS = 1500;

	const pull = (name: string): FightDataset => {
		const found = RAW.find((fixture) => fixture.name === name);
		if (found === undefined) throw new Error(`no Windwalker fixture named ${name}`);
		return found.dataset;
	};

	const ownerOf = (e: WclEvent): number | undefined => {
		const side = (e as { resourceActor?: number }).resourceActor;
		return side === 1 ? e.sourceID : side === 2 ? e.targetID : undefined;
	};

	const presses = (d: FightDataset): number[] =>
		d.events
			.filter((e) => e.type === 'cast' && e.sourceID === d.actor.id && abilityIdOf(e) === RJW_CAST)
			.map((e) => e.timestamp - d.fight.startTime);

	const refunds = (d: FightDataset): number[] =>
		d.events
			.filter(
				(e) =>
					e.type === 'resourcechange' &&
					(e as { resourceChangeType?: number }).resourceChangeType === CHI &&
					abilityIdOf(e) === RJW_CHI &&
					ownerOf(e) === d.actor.id,
			)
			.map((e) => e.timestamp - d.fight.startTime);

	it('reports the wind under 129881, beside a wind press and nowhere else', () => {
		expect(presses(pull('sections.json'))).toHaveLength(33);
		expect(refunds(pull('sections.json'))).toHaveLength(27);
		expect(presses(pull('idle.json'))).toHaveLength(9);
		expect(refunds(pull('idle.json'))).toHaveLength(4);
		// The control, and the whole reason the pairing is evidence: a pull with no wind has no 129881.
		expect(presses(pull('uncounted.json'))).toEqual([]);
		expect(refunds(pull('uncounted.json'))).toEqual([]);
		// Every event on both wind pulls follows a press, so none of them is something else wearing the id.
		for (const name of ['sections.json', 'idle.json']) {
			const pressed = presses(pull(name));
			const orphans = refunds(pull(name)).filter((t) => !pressed.some((p) => t >= p - 50 && t <= p + PAIR_MS));
			expect(orphans, name).toEqual([]);
		}
	});

	/**
	 * The double count, in the only currency the walk has: how often it predicted the next reading right.
	 *
	 * Pinned as a pair rather than as one number, because a walk that simply stopped gaining anything would
	 * satisfy the accuracy half on its own. `uncounted.json` sits in the same list as the row that must not
	 * have moved.
	 */
	it("takes the log's word for the refund instead of crediting it twice", () => {
		const chiOf = (name: string) => {
			const audit = analyse(pull(name)).resources?.chi;
			if (audit === undefined || audit.kind !== 'points') throw new Error(`${name} has no chi walk`);
			return { exact: audit.exact, predicted: audit.predicted, gained: audit.curve.gained };
		};
		// 99/128 and 260 while the declared gain was credited on top of the event.
		expect(chiOf('sections.json')).toEqual({ exact: 117, predicted: 128, gained: 241 });
		// 40/47 and 86.
		expect(chiOf('idle.json')).toEqual({ exact: 43, predicted: 47, gained: 83 });
		// Never had a wind to double-count, and is here to say the fix reached nothing it should not have.
		expect(chiOf('uncounted.json')).toEqual({ exact: 75, predicted: 80, gained: 153 });
	});
});
