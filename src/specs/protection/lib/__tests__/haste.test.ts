// What the three committed Protection pulls actually read, and what each figure is evidence of.
//
// `data.test.ts` beside this pins the haste *model* — the rating conversion, the capped reduction, the
// cooldown floors the author measured it against. This pins the **pulls**: the numbers the Haste
// section prints, from `analyse()` end to end, so that a change anywhere between `combatantinfo` and
// `HasteMeasure` moves a figure here rather than moving a figure on the page quietly.
//
// **All three are the same character in the same kit**, and that is worth stating before any of it is
// read as a sample: one `combatantinfo`, 20,314 melee haste rating, three bosses in one week. So the
// spread below is a spread of *encounters* and never of gear, and nothing here supports a claim about
// what a Protection Paladin generally runs at.
//
// The pull that would falsify most of this is one under the breakpoint. There is none — see the last
// block, which asserts the absence rather than leaving it to be assumed.

import { describe, expect, it } from 'vitest';

import { rawFixture, rawFixtures } from '~/lib/analysis/fixtures';
import { GCD_FLOOR_HASTE, GCD_FLOOR_MS, hasteFromRating, SEAL_OF_INSIGHT_HASTE } from '~/lib/analysis/haste';
import { analyse } from '~/specs/protection/lib';
import type { Analysis, ProtectionAudit } from '~/lib/types';

type Pull = Analysis & ProtectionAudit;

const pull = (name: string): Pull => analyse(rawFixture('protection', name)) as Pull;

const garrosh = pull('garrosh.json');
const paragons = pull('paragons.json');
const fallenProtectors = pull('fallenProtectors.json');

const ALL: Array<[string, Pull]> = [
	['garrosh', garrosh],
	['paragons', paragons],
	['fallenProtectors', fallenProtectors],
];

describe('the haste every committed pull was played at', () => {
	/**
	 * One rating, three pulls, and the equality is the point rather than a convenience.
	 *
	 * `readGear` takes `hasteMelee` off the pull's own `combatantinfo`, and three fights captured off one
	 * character in one raid week have to agree. If they ever stop agreeing, either a fixture was
	 * re-captured from somebody else or the gear reader changed what it reads — and both of those want
	 * to be found here rather than in a section whose numbers moved for no stated reason.
	 */
	it('reads 20,314 melee haste rating off all three', () => {
		for (const [name, analysis] of ALL) {
			expect(analysis.haste.rating, name).toBe(20_314);
			expect(analysis.haste.assumed, name).toBe(false);
		}
	});

	/**
	 * The three terms, and the one that crosses the line.
	 *
	 * 20,314 rating is 47.80% — **short of the breakpoint on its own**, and a 1,015ms global with it. The
	 * seal's five percent over the top is what reaches 55.19% and puts the pull on the 1,000ms floor. That
	 * is the whole argument for the section's terms table being cumulative rather than a column of
	 * multipliers: the reader needs to see which term crossed, and no per-term figure says it.
	 */
	it('reaches the breakpoint on the seal rather than on the gear', () => {
		const fromRating = hasteFromRating(20_314);
		expect(fromRating).toBeCloseTo(1.478, 3);
		expect(fromRating).toBeLessThan(GCD_FLOOR_HASTE);

		const base = fromRating * SEAL_OF_INSIGHT_HASTE;
		expect(base).toBeCloseTo(1.5519, 4);
		expect(base).toBeGreaterThan(GCD_FLOOR_HASTE);
		// 5.19 percentage points past 50%, which is the figure the breakpoint tile prints.
		expect((base - GCD_FLOOR_HASTE) * 100).toBeCloseTo(5.19, 2);

		for (const [name, analysis] of ALL) {
			expect(analysis.haste.fromRating, name).toBeCloseTo(fromRating, 10);
			expect(analysis.haste.classMultiplier, name).toBe(SEAL_OF_INSIGHT_HASTE);
			expect(analysis.haste.base, name).toBeCloseTo(base, 10);
			expect(analysis.haste.gcdMs, name).toBe(GCD_FLOOR_MS);
		}
	});

	/**
	 * Bloodlust, and the reason it buys no globals on any of these pulls.
	 *
	 * 55.19% × 1.3 is 101.74% melee haste, which is more than twice what the global's cap can spend — so
	 * the modelled global under Bloodlust is the same 1,000ms it was without it. Every one of the forty
	 * seconds is bought in *cooldowns* instead, which is exactly the claim the section makes in prose and
	 * the reason the terms table prints a global column that does not move on its last row.
	 *
	 * All three pulls carry one full Bloodlust and no more. The three durations differ by tens of
	 * milliseconds because they are measured off the aura's own apply and removal.
	 */
	it('doubles the haste under Bloodlust and does not move the global', () => {
		for (const [name, analysis] of ALL) {
			expect(analysis.haste.underLust, name).toBeCloseTo(2.0174, 4);
			expect(analysis.haste.gcdMsUnderLust, name).toBe(GCD_FLOOR_MS);
			// One 40s cooldown per pull, to the tens of milliseconds the log stamps it at.
			expect(analysis.haste.lustMs, name).toBeGreaterThan(39_900);
			expect(analysis.haste.lustMs, name).toBeLessThan(40_100);
		}
		expect(fallenProtectors.haste.lustMs).toBe(39_999);
		expect(garrosh.haste.lustMs).toBe(40_025);
		expect(paragons.haste.lustMs).toBe(39_987);
	});

	/**
	 * *** The second reading of the global, and the reason it is taken off `measuredGcd` and not off
	 * `globals.gcdMs`. ***
	 *
	 * The model says 1,000ms from the rating and the seal. The pulls' own presses fell a median 1,010ms
	 * apart — ten milliseconds, on 194, 328 and 468 gaps, on three different encounters. Two
	 * measurements of one number, arrived at from opposite ends, agreeing to one percent of a global.
	 *
	 * `globals.gcdMs` could not have made that check. It is `analyseCore`'s `effectiveGcd`, which is
	 * `max(GCD_MIN_MS, min(median, spec.gcdMs))` — and this spec declares `gcdMs` as the floor, so the
	 * floor and the cap are the same number and the published figure is 1,000ms on every pull whatever
	 * the presses did. Asserted here in both directions so the distinction cannot be quietly collapsed
	 * back: the clamped figure is identical across three pulls, the raw one is a measurement.
	 */
	it('measures the global off the presses within ten milliseconds of the model', () => {
		for (const [name, analysis] of ALL) {
			expect(analysis.haste.gcdMs, name).toBe(1000);
			expect(analysis.measuredGcd.medianMs, name).toBe(1010);
			expect(analysis.globals.gcdMs, name).toBe(GCD_FLOOR_MS);
		}
		expect(fallenProtectors.measuredGcd.samples).toBe(194);
		expect(paragons.measuredGcd.samples).toBe(328);
		expect(garrosh.measuredGcd.samples).toBe(468);
	});
});

describe('what the pulls own presses say about that haste', () => {
	/**
	 * The buttons the check is run over, and the two it is not.
	 *
	 * Five rows on every pull, from six haste-scaled buttons: the two builders arrive merged under one
	 * key because they share a timer, and Avenger's Shield and Hammer of Wrath are excluded outright —
	 * see `CHECK_EXCLUDES` for the measured reason each one is out. Hammer of Wrath is the interesting
	 * absence, because it *passes* when left in: it is out for having no evidence rather than for
	 * failing, which is a distinction a row count would hide.
	 */
	it('times five cooldowns per pull, with the builders merged into one', () => {
		for (const [name, analysis] of ALL) {
			const keys = (analysis.haste.check?.rows ?? []).map((row) => row.key).sort();
			expect(keys, name).toEqual([
				'consecration',
				'crusader-strike',
				'holy-wrath',
				'judgment',
				'shield-of-the-righteous',
			]);
			expect(keys, name).not.toContain('hammer-of-the-righteous');
			expect(keys, name).not.toContain('avengers-shield');
		}
	});

	/**
	 * *** The check finds every pull faster than the model, and none of the three reasons is the model
	 * being wrong about haste. ***
	 *
	 * This is the finding the cross-check exists to surface, and it is recorded here rather than fixed,
	 * because two of the three causes are outside what `HasteCurve` claims to model and the third is
	 * outside what a combat log can be trusted for. `checkHaste`'s own docstring says a gap shorter than
	 * the prediction "is proof the model is wrong"; on real Siege logs that claim is too strong, and
	 * these are the counter-examples.
	 *
	 *   1. **A cooldown that was already running when Bloodlust landed.** `HasteCurve.cooldownMsAt` asks
	 *      at the press, because `sim/core/cast.go` stamps `spell.CD.Set(sim.CurrentTime + cd)` once and
	 *      never revisits it. The game did revisit it. Paragons presses a builder at 7,887ms with
	 *      Bloodlust arriving at 8,580ms: stamped at the press it is due back at 10,787ms, and it was
	 *      pressed again at 10,261ms. Recomputed the way a live rescale would — 693ms of a 2,900ms
	 *      cooldown spent, then the remaining 76.1% run at the Bloodlust cooldown of 2,231ms — it is due
	 *      at 10,278ms. **Seventeen milliseconds.** The same arithmetic explains Garrosh's worst row to
	 *      21ms: Judgment pressed at 250,482ms with Bloodlust at 252,671ms is due at 253,962ms rescaled
	 *      against an observed 253,983ms, where the stamped model says 254,348ms.
	 *   2. **The log stamping a run of presses together.** Fallen Protectors emits Judgment at 50,629ms,
	 *      Shield of the Righteous at 50,634ms, Holy Wrath at 50,653ms and Hammer of the Righteous at
	 *      50,682ms — four presses in 53ms, after 3.4s of nothing — and both of the pull's failing rows
	 *      start inside that burst. Nothing about haste produces a Judgment 1,720ms after a Judgment; the
	 *      cooldown is six seconds and the fastest any haste in this expansion makes it is 3.0s.
	 *   3. **Twenty-five milliseconds of tolerance is tight for a spender.** Shield of the Righteous
	 *      misses by 26ms on Paragons and 30ms on Garrosh against a 967ms cooldown — three percent, on
	 *      the one button in the table pressed off the global.
	 *
	 * What the check does *not* find is any evidence against the haste itself: the builders on Garrosh
	 * are 10ms off a 2,900ms prediction over 141 gaps, and Holy Wrath is inside 40ms on two of three
	 * pulls. The model is right about the haste and incomplete about when a cooldown is priced.
	 */
	it('reports every pull as faster than the model, from the three causes named above', () => {
		for (const [name, analysis] of ALL) {
			expect(analysis.haste.check?.verdict, name).toBe('faster');
		}

		// The worst margin on each pull, and which button it belongs to — the row the section leads its
		// sentence with. Pinned so a change to the curve, the merge or the tolerance moves a number here.
		const worst = (analysis: Pull) => [analysis.haste.check?.rows[0]?.key, analysis.haste.check?.worstMs];
		expect(worst(fallenProtectors)).toEqual(['judgment', -2146]);
		expect(worst(garrosh)).toEqual(['judgment', -365]);
		expect(worst(paragons)).toEqual(['crusader-strike', -526]);
	});

	/**
	 * The rows that agree, which are most of them and are the reason the ones that do not are readable.
	 *
	 * A haste-scaled cooldown's floor is visible in the press stream, so the shortest gap between two
	 * presses of a button *is* that cooldown wherever the player pressed it on cooldown once. At 1.5519
	 * the builders are modelled at 2,900ms and Garrosh's tightest of 141 gaps is 2,890ms — ten
	 * milliseconds, which is the same order as the 1ms and 11ms the model's author measured across nine
	 * reference kills. It is the strongest single piece of evidence on the page that the divisor the
	 * whole report scales by is the right one.
	 */
	it('lands the builders within ten milliseconds on the longest pull', () => {
		const builders = garrosh.haste.check?.rows.find((row) => row.key === 'crusader-strike');
		expect(builders).toMatchObject({ samples: 141, observedMs: 2890, predictedMs: 2900, deltaMs: -10 });
	});
});

describe('what these fixtures cannot show', () => {
	/**
	 * Asserted rather than assumed, because it is the claim the section's copy is least able to check.
	 *
	 * `haste.summary_short` — the arm that tells a reader haste is still buying them room between
	 * presses — renders on **no committed pull**, so nothing but this test says it is reachable at all.
	 * Whoever commits a Protection fixture under 50% haste should expect this to go red, and should
	 * delete it rather than widen it: at that point the arm has a pull behind it and the sweep that
	 * renders every fixture is what covers it.
	 */
	it('holds no pull under the breakpoint, so the short arm renders on nothing', () => {
		const under = rawFixtures('protection')
			.map(({ name, dataset }) => [name, (analyse(dataset) as Pull).haste.base] as const)
			.filter(([, base]) => base < GCD_FLOOR_HASTE);
		expect(under).toEqual([]);
	});

	/**
	 * And none without a rating, which is the other arm nothing renders.
	 *
	 * `FALLBACK_HASTE` stands in when a pull reports no `combatantinfo`, and `HasteMeasure.assumed` is
	 * what the section reads to caption the rating tile as unreported. Every committed pull carries one,
	 * so that caption is unrendered copy — kept, because a pull fetched from a report WarcraftLogs has
	 * trimmed will reach it, and dropping it would print a confident 0 rating instead.
	 */
	it('holds no pull that reported no rating, so the assumed caption renders on nothing', () => {
		for (const [name, analysis] of ALL) expect(analysis.haste.assumed, name).toBe(false);
	});
});
