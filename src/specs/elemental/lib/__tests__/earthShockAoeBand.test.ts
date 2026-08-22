// Earth Shock at three or more enemies: no list has a rule for it, so the section stops answering.
//
// `aoe.apl.json` is five rungs and Earth Shock is not one of them. `0de530e` acted on that on the ladder
// side — `earth-shock` in `apl.ts` became `bands: [1, 2]`, so above two targets the ladder has no Earth
// Shock rung and a shock there is weighed against Chain Lightning. The section's press grading did not
// move with it: `esPresses` branched on `band === 2`, then on the two-piece, then fell through to an
// `else` carrying the **single-target** rule — so a band-3 or band-4 press was faulted for not spending a
// full shield under a list that never asks for the shield to be spent.
//
// That is not a looseness, it is the two halves of one report contradicting each other about one press,
// and the docblock over that branch names the principle it broke: `aplTargetCountAt` is the same reading
// the ladder bands each rung on, so the section and the ladder cannot disagree about which list a press
// was under.
//
// What this file pins: that both halves now say the same thing, that the presses concerned are left
// unjudged rather than credited, that the exemption **separates** on a committed fixture (§90: a declared
// control that changes nothing is not a control), and that the two pulls with no such press do not move.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';

import { LADDER_ENTRIES } from '../apl';
import { analyse } from '../index';
import { scoreAnalysis } from '../score';

const FIXTURES = ['unbroken', 'phased', 'cleave'] as const;
type Fixture = (typeof FIXTURES)[number];

const load = (name: Fixture): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;

const el: Record<Fixture, Analysis & ElementalAuditResult> = {
	unbroken: analyse(load('unbroken')) as Analysis & ElementalAuditResult,
	phased: analyse(load('phased')) as Analysis & ElementalAuditResult,
	cleave: analyse(load('cleave')) as Analysis & ElementalAuditResult,
};

const goodPct = (name: Fixture): number | null => {
	const metric = scoreAnalysis(el[name]).sections['earthShock']?.metrics.find((m) => m.key === 'earthShockGood');
	if (metric === undefined) throw new Error('earthShockGood is not on the scorecard');
	return metric.value;
};

describe('the section and the priority ladder agree about which presses have a rule', () => {
	/**
	 * The ladder's side of it, read off the declaration rather than restated: `earth-shock` is banded to
	 * one and two targets, so at three and four the ladder has no rung for the button at all.
	 */
	it('has no Earth Shock rung above two targets on the ladder', () => {
		const rung = LADDER_ENTRIES.find((entry) => entry.key === 'earth-shock');
		expect(rung).toBeDefined();
		expect(rung?.bands).toEqual([1, 2]);
	});

	/**
	 * And the section's side: **every** press outside those two bands is unjudged, on every pull. Null and
	 * not false — a press nothing had a rule for is a "cannot say", and folding it in with the faults is
	 * the reading the exemption exists to stop.
	 */
	it('leaves every press outside those bands unjudged, and every press inside them judged', () => {
		let outside = 0;
		let inside = 0;
		for (const name of FIXTURES)
			for (const press of el[name].earthShock.presses) {
				if (press.band === 1 || press.band === 2) {
					expect(typeof press.good, `${name} @ ${press.t}`).toBe('boolean');
					inside++;
				} else {
					expect(press.good, `${name} @ ${press.t}`).toBeNull();
					// And no reason is pushed onto it, which is what also keeps it out of the shield's bad-spend
					// ledger: a shock the aoe list never asked to be held cannot be Fulmination thrown away.
					expect(press.reasons, `${name} @ ${press.t}`).toEqual([]);
					outside++;
				}
			}
		expect([inside, outside]).toEqual([32, 5]);
	});

	/**
	 * The exemption's own denominator, published so the tile, the verdict sentence, the summary tile and
	 * the scorecard cannot each count a different set.
	 */
	it('publishes a judged count that is the presses less the unjudged ones', () => {
		for (const name of FIXTURES) {
			const audit = el[name].earthShock;
			expect(audit.judged, name).toBe(audit.presses.filter((p) => p.good !== null).length);
			expect(audit.good, name).toBe(audit.presses.filter((p) => p.good === true).length);
			expect(audit.good, name).toBeLessThanOrEqual(audit.judged);
		}
		expect([el.unbroken.earthShock.judged, el.phased.earthShock.judged, el.cleave.earthShock.judged]).toEqual([
			13, 12, 7,
		]);
	});
});

describe('what it costs, measured on the fixtures that can show it', () => {
	/**
	 * **The five presses, named.** All on `cleave` — three at band 3 and two at band 4 — and each one was
	 * being graded against `p5.apl.json`'s two-piece branch before this. Two of the five read good under
	 * that branch and three read faults (`fsTail` twice, `twoPiece` once), so the change is not one-sided:
	 * it removes two credits as well as three charges. Every one of them was taken at a full shield, which
	 * is why `belowFull` does not move either.
	 */
	it('exempts five presses, all on cleave, and none of them for being a fault', () => {
		const exempt = el.cleave.earthShock.presses.filter((p) => p.good === null);
		expect(exempt.map((p) => p.t)).toEqual([84_144, 104_984, 208_430, 220_746, 244_241]);
		expect(exempt.map((p) => p.band)).toEqual([4, 4, 3, 3, 3]);
		expect(exempt.map((p) => p.lsStacks)).toEqual([7, 7, 7, 7, 7]);
		// The other two pulls never leave two targets, so they have nothing to exempt — which is what makes
		// them the regression anchor for the metric below.
		expect(el.unbroken.earthShock.presses.filter((p) => p.good === null)).toHaveLength(0);
		expect(el.phased.earthShock.presses.filter((p) => p.good === null)).toHaveLength(0);
	});

	/**
	 * **It separates, and only on the pull that has the presses** — §90's requirement, because a declared
	 * exemption that moves no figure is not an exemption.
	 *
	 * `cleave` was 6 of 12 = 50% and is 4 of 7 = 57.14%. `unbroken` (38.46%) and `phased` (58.33%) are
	 * entirely band 1 and must not move by a thousandth.
	 */
	it('moves cleave from 50% to 57.14% and leaves the two single-target pulls alone', () => {
		expect(goodPct('cleave')).toBeCloseTo(57.142_86, 4);
		expect(el.cleave.earthShock.good).toBe(4);
		expect(el.cleave.earthShock.presses).toHaveLength(12);

		expect(goodPct('unbroken')).toBeCloseTo(38.461_54, 4);
		expect(goodPct('phased')).toBeCloseTo(58.333_33, 4);
	});

	/**
	 * **No grade and no band moves** — a deliberate no-change guard. 57.14% is still under the 65% `ok`
	 * boundary, so the section stays `bad` on all three and the pull grades are where they were. The point
	 * of the change is that the fraction is now over the presses a list had an opinion about; it is not to
	 * make a number look better, and this is the assertion that says so.
	 */
	it('changes no section grade and no pull grade — no-change guard', () => {
		for (const name of FIXTURES) expect(scoreAnalysis(el[name]).sections['earthShock']?.grade, name).toBe('bad');
		expect(scoreAnalysis(el.unbroken).overall).toBe('ok');
		expect(scoreAnalysis(el.phased).overall).toBe('ok');
		expect(scoreAnalysis(el.cleave).overall).toBe('bad');
		// And the shield's own ledger is untouched, because all five exempt presses were at the ceiling.
		expect([el.unbroken.earthShock.belowFull, el.phased.earthShock.belowFull, el.cleave.earthShock.belowFull]).toEqual([
			2, 0, 1,
		]);
	});
});
