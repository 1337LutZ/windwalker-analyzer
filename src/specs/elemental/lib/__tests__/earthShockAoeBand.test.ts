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

import { describe, expect, it } from 'vitest';

import { rawFixtures } from '~/lib/analysis/fixtures';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { LADDER_ENTRIES } from '../apl';
import { analyse } from '../index';
import { scoreAnalysis } from '../score';

/**
 * Every raw Elemental pull, found rather than listed, and the analysis memoised.
 *
 * The literal this replaced was `['unbroken', 'phased', 'cleave']`, and this file's whole subject is the
 * band an Earth Shock press was made at — so the pull that spends 73.73% of itself above one enemy is
 * precisely the one it needed and precisely the one it never ran. The prose below said "all five exempt
 * presses are on `cleave`" and "the other two pulls never leave two targets", both of which were claims
 * about a three-name list rather than about the directory.
 */
type Fixture = string;
const FIXTURES: Fixture[] = rawFixtures('elemental').map(({ name }) => name.replace(/\.json$/, ''));

const analysed = new Map<string, Analysis & ElementalAuditResult>();
const fx = (name: Fixture): Analysis & ElementalAuditResult => {
	const hit = analysed.get(name);
	if (hit !== undefined) return hit;
	const found = rawFixtures('elemental').find((fixture) => fixture.name === `${name}.json`);
	if (found === undefined) throw new Error(`no raw Elemental fixture ${name}`);
	const el = analyse(found.dataset) as Analysis & ElementalAuditResult;
	analysed.set(name, el);
	return el;
};

const wastePct = (name: Fixture): number | null => {
	const metric = scoreAnalysis(fx(name)).sections['earthShock']?.metrics.find((m) => m.key === 'earthShockWaste');
	if (metric === undefined) throw new Error('earthShockWaste is not on the scorecard');
	return metric.value;
};

/** The presses a band list had no opinion about — the exemption this whole file is about. */
const exemptOf = (name: Fixture) => fx(name).earthShock.presses.filter((p) => p.good === null);

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
			for (const press of fx(name).earthShock.presses) {
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
		// 32 / 5 over the three pulls this loop used to run on. `addsThenBoss` alone contributes 20 judged and
		// 23 exempt — more exempt presses than the whole rest of the directory has presses outside the bands
		// — which is what "the fixture set is discovered" buys on a file whose entire subject is the band.
		expect([inside, outside]).toEqual([52, 28]);
		// Both sides non-vacuous on every pull that can have them, stated per pull rather than as a total a
		// single fixture could carry alone.
		expect(Object.fromEntries(FIXTURES.map((name) => [name, exemptOf(name).length]))).toEqual({
			addsThenBoss: 23,
			cleave: 5,
			phased: 0,
			unbroken: 0,
		});
	});

	/**
	 * The exemption's own denominator, published so the tile, the verdict sentence, the summary tile and
	 * the scorecard cannot each count a different set.
	 */
	it('publishes a judged count that is the presses less the unjudged ones', () => {
		for (const name of FIXTURES) {
			const audit = fx(name).earthShock;
			expect(audit.judged, name).toBe(audit.presses.filter((p) => p.good !== null).length);
			expect(audit.good, name).toBe(audit.presses.filter((p) => p.good === true).length);
			expect(audit.good, name).toBeLessThanOrEqual(audit.judged);
		}
		// Keyed rather than positional, so a fifth pull fails here instead of joining a list nobody re-reads.
		expect(Object.fromEntries(FIXTURES.map((name) => [name, fx(name).earthShock.judged]))).toEqual({
			addsThenBoss: 20,
			cleave: 7,
			phased: 12,
			unbroken: 13,
		});
	});
});

describe('what it costs, measured on the fixtures that can show it', () => {
	/**
	 * **`cleave`'s five presses, named** — three at band 3 and two at band 4, and each one was being graded
	 * against `p5.apl.json`'s two-piece branch before this. Two of the five read good under that branch and
	 * three read faults (`fsTail` twice, `twoPiece` once), so the change is not one-sided: it removes two
	 * credits as well as three charges. Every one of them was taken at a full shield, which is why
	 * `belowFull` does not move either.
	 *
	 * **The heading used to say "all five, on `cleave`", and it stopped being true without going red.**
	 * `addsThenBoss` exempts 23 — four and a half times as many — and this test could not see them because
	 * it read one pull by name and then asserted the *other two by name* were empty. The emptiness is the
	 * half that matters and it is now gated on the count series rather than on a pair of file names: a pull
	 * exempts an Earth Shock press if and only if it ever exceeds two enemies, which is the rule the ladder
	 * states, and the partition is derived so a fifth fixture has to land on one side of it.
	 */
	it('exempts a press if and only if the pull left the banded counts', () => {
		const exempt = exemptOf('cleave');
		expect(exempt.map((p) => p.t)).toEqual([84_144, 104_984, 208_430, 220_746, 244_241]);
		expect(exempt.map((p) => p.band)).toEqual([4, 4, 3, 3, 3]);
		expect(exempt.map((p) => p.lsStacks)).toEqual([7, 7, 7, 7, 7]);

		// The property the two zeroes were standing in for: a pull that never exceeds two enemies cannot
		// exempt a press, and a pull that does, does. Both directions, over the discovered set.
		for (const name of FIXTURES) {
			const above = (fx(name).targets?.counts.max ?? 1) > 2;
			expect(exemptOf(name).length > 0, `${name} exempts`).toBe(above);
			// And every exempt press really is outside the banded counts — the reason, not just the count.
			for (const press of exemptOf(name)) expect(press.band, `${name} @ ${press.t}`).toBeGreaterThan(2);
		}
		// Pinned so a fifth pull picks a side rather than slipping past the loop above.
		expect(FIXTURES.filter((name) => (fx(name).targets?.counts.max ?? 1) > 2)).toEqual(['addsThenBoss', 'cleave']);
		expect(FIXTURES.filter((name) => (fx(name).targets?.counts.max ?? 1) <= 2)).toEqual(['phased', 'unbroken']);
	});

	/**
	 * **It separates, and only on the pull that has the presses** — §90's requirement, because a declared
	 * exemption that moves no figure is not an exemption.
	 *
	 * Read as waste since the rule was inverted, so these are the shocks that bought nothing: `cleave` was
	 * 6 of 12 = 50% and is 3 of 7 = 42.86%. `unbroken` (61.54%) and `phased` (41.67%) are entirely band 1
	 * and must not move by a thousandth.
	 */
	it('moves every pull that leaves the banded counts and no other', () => {
		expect(wastePct('cleave')).toBeCloseTo(42.857_14, 4);
		expect(fx('cleave').earthShock.good).toBe(4);
		expect(fx('cleave').earthShock.presses).toHaveLength(12);
		// The pull the three-name grid never asked: 43 presses, 23 of them outside the bands, so the metric
		// is over 20 rather than over 43 and this is by far the largest separation the exemption makes.
		expect(wastePct('addsThenBoss')).toBeCloseTo(50, 4);
		expect(fx('addsThenBoss').earthShock.good).toBe(10);
		expect(fx('addsThenBoss').earthShock.presses).toHaveLength(43);

		expect(wastePct('unbroken')).toBeCloseTo(61.538_46, 4);
		expect(wastePct('phased')).toBeCloseTo(41.666_67, 4);

		// The metric is the *un*good count over the *judged* count on every pull, not over the presses — the
		// identity the four figures above are four instances of, so a fifth pull is measured and not listed.
		for (const name of FIXTURES) {
			const audit = fx(name).earthShock;
			expect(wastePct(name), name).toBeCloseTo(((audit.judged - audit.good) / audit.judged) * 100, 9);
		}
	});

	/**
	 * **No grade and no band moves** — a deliberate no-change guard. 57.14% is still under the 65% `ok`
	 * boundary, so the section stays `bad` on every committed pull and the pull grades are where they were.
	 * (`addsThenBoss` is `bad` at the section and `bad` overall, and it too is unmoved by the exemption —
	 * it exempts 23 presses and stays under the boundary on the 20 that are left.) The point
	 * of the change is that the fraction is now over the presses a list had an opinion about; it is not to
	 * make a number look better, and this is the assertion that says so.
	 *
	 * **Two of the three headlines below have since moved, and neither of them moved here.** `phased` is
	 * `good` and `cleave` is `ok` because `fireElementalHasteUptime` was priced at 1: 73.08% of 13 points
	 * becomes 75.00% of 14, and 42.31% of 13 becomes 46.43% of 14. The argument is on `score.ts`' `WEIGHTS`.
	 * They stay pinned as literals rather than being loosened, because a no-change guard that stops naming
	 * a number stops guarding — what it now says is "this exemption moved no letter, and here is every
	 * letter it did not move".
	 *
	 * **`phased` has moved a third time, to `good`, and again not here.** `gcdUtilisation` no longer grades
	 * against one fixed pair per spec: it resolves against the encounter's own p90 and p50 from
	 * `src/generated/reference.json`. Iron Juggernaut's Elemental row is p90 94.16 / p50 91.08 over four
	 * kills, and this pull fills 94.44% of its globals — fractionally above the best that reference has
	 * seen on that fight, so `good` where the flat 95 line said `ok`. It is the first `good` this spec has
	 * scored on this metric on any committed pull; no fixture could reach 95. The Earth Shock exemption is
	 * as untouched by it as by the two moves above.
	 */
	it('changes no section grade and no pull grade — no-change guard', () => {
		for (const name of FIXTURES) expect(scoreAnalysis(fx(name)).sections['earthShock']?.grade, name).toBe('bad');
		// Keyed off the discovered set, so a fifth pull has to have its headline written down here.
		expect(Object.fromEntries(FIXTURES.map((name) => [name, scoreAnalysis(fx(name)).overall]))).toEqual({
			// The four moved once under `gcdUtilisation`'s 95/90 lines, and again when those lines became
			// each encounter's own p90/p50 — never under anything this file changes. The pulls fill 83.38%,
			// 89.18%, 94.44% and 92.87% of their globals; the old 80/65 pair called all four `good`, the
			// flat 95/90 pair called three of them short, and the reference rows call `phased` `good`,
			// `unbroken` `ok`, `cleave` `bad` and `addsThenBoss` nothing at all — Galakras is suppressed.
			addsThenBoss: 'bad',
			cleave: 'bad',
			phased: 'good',
			unbroken: 'ok',
		});
		// And the shield's own ledger is untouched, because all five exempt presses were at the ceiling.
		expect(Object.fromEntries(FIXTURES.map((name) => [name, fx(name).earthShock.belowFull]))).toEqual({
			addsThenBoss: 4,
			cleave: 1,
			phased: 0,
			unbroken: 2,
		});
	});
});
