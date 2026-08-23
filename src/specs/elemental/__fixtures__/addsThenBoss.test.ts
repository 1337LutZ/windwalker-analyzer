// What `addsThenBoss.json` is, and the three questions it is the only committed pull that can answer.
//
// Beside the fixture because these are tests *of the fixture*, in the same sense `bands.test.ts` is: a
// pull is committed for a shape, and a shape nothing asserts is a shape a re-capture can quietly lose.
// Every guard that sweeps the fixture directory reads this pull now — `analysis/__tests__/
// fixtureCoverage.test.ts`, `game/__tests__/undeclaredAuras.test.ts` and
// `game/__tests__/sharedFixtures.test.ts` all found it through `~/lib/analysis/fixtures` with no wiring
// — but every one of those asks a question of *all* the pulls. None of them says why this one is here.
//
// **The pull.** Galakras, heroic 25 (difficulty 4), a kill, 560.3s, from the anonymous report
// `a:bXz16PxwV9pAWL8k`. The audited player is the report's actor 8, an Elemental shaman in Throne of
// Thunder kit — no Siege tier at all, which is itself load-bearing below.
//
// **What it closes, and what it does not.** Three blockers were hoped for and it closes two:
//
//   1. *An adds-then-boss regime.* Yes, and it is the only pull that has one. Measured below.
//   2. *A `combatantinfo` carrying Breath of the Hydra.* Yes — item 96455, nine proc windows. This is
//      the trinket `lib/apl.ts` reads as **owned** at three targets and up on every pull, having had
//      none that could show otherwise.
//   3. *Elemental Mastery, or a held cooldown.* **Neither.** The talent is 108283 Echo of the Elements
//      on this shaman as on the other three, and `lostCasts` holds Ascendance and the Fire Elemental,
//      both of which `components/sections/gates.ts` judges on placement — so `hasHeldCooldowns` is
//      still false on all four pulls and the cooldown-drift section still renders on nothing. Asserted
//      as a negative below, because a claim that a fixture *cannot* answer something is exactly the
//      claim that rots: the next Elemental pull committed should fail these two and delete them.
//
// The fourth thing it brought was not asked for: it is the first fixture with `phases` and the first
// with `raidStormlash`, so two more fields of `FightDataset` are non-empty somewhere in the suite.

import { describe, expect, it } from 'vitest';

import { rawFixture, rawFixtures } from '~/lib/analysis/fixtures';
import { heldCooldowns } from '~/specs/elemental/components/sections/gates';
import { analyse } from '~/specs/elemental/lib';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

const dataset = rawFixture('elemental', 'addsThenBoss.json');
const analysis = analyse(dataset) as Analysis & ElementalAuditResult;

/** Report-relative ms from the pull's own start, which is the basis `phases` and the count points share. */
const duration = dataset.fight.endTime - dataset.fight.startTime;

/**
 * `targets` is optional on `Analysis`, and a pull that had lost it would make every count below read as
 * a passing zero rather than as a failure. Thrown rather than defaulted, for that reason.
 */
const targetsOf = (pull: Analysis): NonNullable<Analysis['targets']> => {
	const targets = pull.targets;
	if (targets === undefined) throw new Error('the pull carries no `targets`, so nothing below is measuring anything');
	return targets;
};

/**
 * How long the pull ran with the player able to reach only one enemy, counted back from the last hit.
 *
 * `targets.counts.points` is a step function of "how many distinct enemies the player hit inside
 * `targetWindowMs`", so the last point above one is the moment the multi-target regime ended and
 * everything after it is boss-only. Negative when the last such point sits past the fight's own end,
 * which is what a pull that finishes on adds looks like — see `cleave` below.
 */
const bossOnlyTailMs = (pull: Analysis, pullDuration: number): number => {
	const lastMulti = [...targetsOf(pull).counts.points].reverse().find(([, count]) => count > 1);
	return lastMulti === undefined ? pullDuration : pullDuration - lastMulti[0];
};

describe('the pull it was committed for', () => {
	it('is the Galakras kill the report names', () => {
		expect(dataset.code).toBe('a:bXz16PxwV9pAWL8k');
		expect(dataset.fight).toMatchObject({ id: 20, name: 'Galakras', encounterID: 51_622, kill: true, difficulty: 4 });
		expect(duration).toBe(560_261);
		expect(dataset.actor).toEqual({ id: 8, name: 'Player (8)', type: 'Player' });
	});

	/**
	 * *** The property no other committed pull has: the regime ends, and there is a boss to spend the
	 * rest of the fight on. ***
	 *
	 * This is what the mixed-mode complaint was actually about, and it was never measurable here. The
	 * three older pulls are the two failure modes of trying: `phased` and `unbroken` never leave one
	 * enemy, so nothing about a multi-target reading can be observed on them at all; `cleave` is
	 * genuinely multi-target and **interleaves adds to its last hit** — its final point above one enemy
	 * sits 3.8s *past* the end of the fight, because the count window outlives the pull. So `cleave` has
	 * no boss-only tail to measure, not a short one, and every number tuned on it was tuned on a pull
	 * whose regime never resolves.
	 *
	 * Here it resolves once and stays resolved: first point above one enemy at 9.0s, last at 503.3s, and
	 * then 56.9s of Galakras alone. Asserted as the comparison rather than as one number, because the
	 * fact worth keeping is the *contrast* — a re-capture that shortened this pull to its add phase would
	 * still pass a bare `> 0`.
	 */
	it('is the only pull with a boss-only tail, and cleave is the reason that is worth saying', () => {
		expect(bossOnlyTailMs(analysis, duration)).toBe(56_941);

		const tails = Object.fromEntries(
			rawFixtures('elemental').map(({ name, dataset: pull }) => [
				name,
				bossOnlyTailMs(analyse(pull) as Analysis, pull.fight.endTime - pull.fight.startTime),
			]),
		);
		// `cleave` is negative — it ends on adds — and the two Iron Juggernaut pulls are their whole
		// length, because a pull that never sees two enemies is trivially boss-only throughout and so
		// cannot be the fixture for this question either.
		expect(tails['cleave.json']).toBeLessThan(0);
		expect(tails['phased.json']).toBe(258_304);
		expect(tails['unbroken.json']).toBe(184_448);
	});

	/**
	 * And the tail is not the phase boundary, which is the trap in reading `phases` as the regime.
	 *
	 * WarcraftLogs puts Stage Two at 435.4s, and the adds outlive it by 67.9s: the tower waves already
	 * on the ground keep the player above one enemy well into the boss phase. So a section that shaded
	 * "multi-target" by phase would call 68 seconds of this pull single-target that the player spent
	 * cleaving. The count points are the regime; the phases are the encounter.
	 */
	it('reaches its boss-only tail 68s after WarcraftLogs says the boss phase began', () => {
		expect(dataset.phases).toEqual([
			{ id: 1, startTime: 8_239_073, name: 'Stage One: Bring Her Down!', isIntermission: false },
			{ id: 2, startTime: 8_674_475, name: 'Stage Two: Galakras', isIntermission: false },
		]);
		const stageTwo = dataset.phases![1]!.startTime - dataset.fight.startTime;
		expect(stageTwo).toBe(435_402);
		expect(duration - bossOnlyTailMs(analysis, duration) - stageTwo).toBe(67_918);
	});

	/** 73.73% multi-target over nine enemies at the widest — a real cleave pull, not a boss with two adds. */
	it('spends three quarters of itself above one enemy', () => {
		expect(targetsOf(analysis).counts.max).toBe(9);
		expect(targetsOf(analysis).multiTargetMs).toBe(400_861);
		expect(targetsOf(analysis).multiTargetPct).toBeCloseTo(73.73, 2);
		expect(targetsOf(analysis).detected).toBe('multi');
		// Not the widest pull in the set, and it does not need to be: `cleave` reaches thirteen. What this
		// one has is an end to the regime, which is a different property from a bigger count.
		expect(targetsOf(analysis).counts.max).toBeLessThan(13);
	});
});

describe('the trinket the priority ladder was guessing at', () => {
	/**
	 * *** Breath of the Hydra, worn and firing, for the first time in the fixture set. ***
	 *
	 * `docs/plan.md` §98 argued the band-3 Flame Shock gate unmeasurable because "138898 appears zero
	 * times in every fixture", and `elemental/lib/apl.ts` resolves `auraIsKnown(138898)` to **owned** for
	 * exactly that reason: a player without the trinket would otherwise never be asked for Flame Shock at
	 * three targets, so every press they made there would be a fault whatever they did. The assumption is
	 * still in the code — reading the trinket for real is plan §64 item 4 — but it is no longer
	 * unfalsifiable, which is the whole of what this fixture buys.
	 *
	 * Item **96455**, the heroic Throne of Thunder id; the base 94521 is three upgrade steps below it and
	 * `game/__tests__/sharedFixtures.test.ts` carries all five variants. Aura 138898 opens nine windows.
	 */
	it('is in the kit and in the stream', () => {
		const info = dataset.events.find((event) => (event as { type?: string }).type === 'combatantinfo') as {
			gear: Array<{ id: number }>;
			talents: Array<{ id: number }>;
		};
		const worn = info.gear.map((slot) => slot.id);
		expect(worn).toContain(96_455); // Breath of the Hydra
		expect(worn).toContain(96_413); // Wushoolay's Final Choice, the other trinket and also a first
		// The three older pulls all wear the same two Siege trinkets; neither is here.
		expect(worn).not.toContain(104_426);
		expect(worn).not.toContain(104_544);

		const windows = (id: number): number =>
			dataset.events.filter(
				(event) =>
					(event as { abilityGameID?: number }).abilityGameID === id &&
					(event as { type?: string }).type === 'applybuff',
			).length;
		expect(windows(138_898)).toBe(9); // breath-of-hydra
		expect(windows(138_786)).toBe(13); // wushoolays-lightning
	});

	/**
	 * And the reason 144999 is missing from this pull's enemy-aura half, pinned where a reader will look
	 * for it: the T16 two-piece writes that debuff and this shaman has no Siege tier.
	 *
	 * Worth an assertion rather than a comment because it is the one way the two facts could come apart.
	 * If a future re-capture picked a different player on the same fight, `undeclaredAuras.test.ts` would
	 * go red on a list of ids with no explanation attached; this says which half moved.
	 */
	it('wears no Siege tier, which is why its enemy-aura half has no T16 two-piece debuff', () => {
		const setIds = (
			dataset.events.find((event) => (event as { type?: string }).type === 'combatantinfo') as {
				gear: Array<{ setID?: number }>;
			}
		).gear.flatMap((slot) => (slot.setID === undefined ? [] : [slot.setID]));
		expect(setIds).toEqual([]);
		expect(dataset.events.some((event) => (event as { abilityGameID?: number }).abilityGameID === 144_999)).toBe(false);
	});
});

describe('what this pull does not close, asserted so it cannot be assumed later', () => {
	/**
	 * Elemental Mastery is 16166 and this shaman did not take it — 108283 Echo of the Elements, the same
	 * choice the other three made. Checked across the whole report before committing: not one of the four
	 * Elemental shamans in it took 16166 on any of its 30 boss pulls, so this log could not have closed
	 * that blocker whichever player or fight was picked.
	 *
	 * `hasElementalMastery` is `talented !== false`, so the section is *hidden* on this pull rather than
	 * rendered empty — which is the gate working, and still no pull that renders it with content.
	 */
	it('did not take Elemental Mastery, so that section still has no pull to render on', () => {
		const info = dataset.events.find((event) => (event as { type?: string }).type === 'combatantinfo') as {
			talents: Array<{ id: number }>;
		};
		expect(info.talents.map((talent) => talent.id)).not.toContain(16_166);
		expect(info.talents.map((talent) => talent.id)).toContain(108_283);
		expect(analysis.elementalMastery.talented).toBe(false);
	});

	/**
	 * And the cooldown-drift ledger is still empty, for a reason worth writing down: this pull *does*
	 * move `lostCasts`. Every older fixture holds Ascendance alone; this one holds Ascendance and the Fire
	 * Elemental, whose 6.6s of drift is the first non-zero drift in the set. Both are in `PLACEMENT_IDS`,
	 * so `heldCooldowns` filters both out and `hasHeldCooldowns` stays false.
	 *
	 * That is the finding rather than a shrug: the ledger is not empty because nothing drifts, it is
	 * empty because every cooldown this spec models is judged on placement somewhere above it. A pull
	 * that fills it needs a shaman who pressed something outside that set — not a longer fight.
	 */
	it('drifts a cooldown for the first time and still fills no held-cooldown ledger', () => {
		expect(analysis.lostCasts.map((row) => [row.id, row.driftSec])).toEqual([
			[114_049, 0],
			[2894, 6.6],
		]);
		expect(heldCooldowns(analysis)).toEqual([]);
	});
});

describe('the two fields of FightDataset nothing else exercises', () => {
	/**
	 * `phases` and `raidStormlash` are optional on `FightDataset` and `undefined` on all three older
	 * fixtures, so both code paths were dead in the suite. They are asserted here because they were
	 * fetched deliberately — `wcl/fetchFight.ts` asks for both on every real fetch, and a fixture that
	 * omitted them would be a shape the app never produces.
	 *
	 * Ten Stormlash placements from five shamans, staggered rather than stacked, which is the only thing
	 * the Stormlash section has ever had to read.
	 */
	it('carries the phase transitions and the raid Stormlash placements', () => {
		expect(dataset.phases).toHaveLength(2);
		expect(dataset.raidStormlash).toHaveLength(10);
		const shamans = new Set(dataset.raidStormlash!.map((event) => (event as { sourceID?: number }).sourceID));
		expect(shamans.size).toBe(5);
		expect(dataset.difficultyNames).toEqual({ 3: 'Normal', 4: 'Heroic' });

		for (const { name, dataset: pull } of rawFixtures('elemental')) {
			if (name === 'addsThenBoss.json') continue;
			expect(pull.phases, name).toBeUndefined();
			expect(pull.raidStormlash, name).toBeUndefined();
		}
	});
});
