// What the three committed Protection pulls actually read, and what each figure is evidence of.
//
// `data.test.ts` beside this pins the haste *model* — the rating conversion, the capped reduction, the
// cooldown floors the author measured it against. This pins the **pulls**: the numbers the Haste
// section prints, from `analyse()` end to end, so that a change anywhere between `combatantinfo` and
// `HasteMeasure` moves a figure here rather than moving a figure on the page quietly.
//
// **All three are the same character in the same kit**, and that is worth stating before any of it is
// read as a sample: one `combatantinfo`, 19,352 melee haste rating, five bosses in one week. So the
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
const galakras = pull('galakras.json');
const spoils = pull('spoils.json');

const ALL: Array<[string, Pull]> = [
	['garrosh', garrosh],
	['paragons', paragons],
	['fallenProtectors', fallenProtectors],
	['galakras', galakras],
	['spoils', spoils],
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
	it('reads 19,352 melee haste rating off every capture', () => {
		for (const [name, analysis] of ALL) {
			expect(analysis.haste.rating, name).toBe(19_352);
			expect(analysis.haste.assumed, name).toBe(false);
		}
	});

	/**
	 * The three terms, and the one that crosses the line.
	 *
	 * 19,352 rating is 45.53% — **short of the breakpoint on its own**, and a 1,031ms global with it. The
	 * seal's five percent over the top is what reaches 52.81% and puts the pull on the 1,000ms floor. That
	 * is the whole argument for the section's terms table being cumulative rather than a column of
	 * multipliers: the reader needs to see which term crossed, and no per-term figure says it.
	 */
	it('reaches the breakpoint on the seal rather than on the gear', () => {
		const fromRating = hasteFromRating(19_352);
		expect(fromRating).toBeCloseTo(1.4553, 4);
		expect(fromRating).toBeLessThan(GCD_FLOOR_HASTE);

		const base = fromRating * SEAL_OF_INSIGHT_HASTE;
		expect(base).toBeCloseTo(1.5281, 4);
		expect(base).toBeGreaterThan(GCD_FLOOR_HASTE);
		// 2.81 percentage points past 50%, which is the figure the breakpoint tile prints.
		expect((base - GCD_FLOOR_HASTE) * 100).toBeCloseTo(2.81, 2);

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
	 * 52.81% × 1.3 is 98.65% melee haste, which is nearly twice what the global's cap can spend — so
	 * the modelled global under Bloodlust is the same 1,000ms it was without it. Every one of the forty
	 * seconds is bought in *cooldowns* instead, which is exactly the claim the section makes in prose and
	 * the reason the terms table prints a global column that does not move on its last row.
	 *
	 * All three pulls carry one full Bloodlust and no more. The three durations differ by tens of
	 * milliseconds because they are measured off the aura's own apply and removal.
	 */
	it('doubles the haste under Bloodlust and does not move the global', () => {
		for (const [name, analysis] of ALL) {
			expect(analysis.haste.underLust, name).toBeCloseTo(1.9865, 4);
			expect(analysis.haste.gcdMsUnderLust, name).toBe(GCD_FLOOR_MS);
			// One 40s cooldown per pull, to the tens of milliseconds the log stamps it at.
			expect(analysis.haste.lustMs, name).toBeGreaterThan(39_900);
			expect(analysis.haste.lustMs, name).toBeLessThan(40_100);
		}
		expect(fallenProtectors.haste.lustMs).toBe(40_009);
		expect(garrosh.haste.lustMs).toBe(39_998);
		expect(paragons.haste.lustMs).toBe(39_979);
		expect(galakras.haste.lustMs).toBe(39_994);
		expect(spoils.haste.lustMs).toBe(40_000);
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
			// Within a global's own hundredth of the modelled 1,000ms on all five, and the spread across
			// them is 7ms — which is what a measurement looks like against a constant.
			expect(analysis.measuredGcd.medianMs, name).toBeGreaterThanOrEqual(1_005);
			expect(analysis.measuredGcd.medianMs, name).toBeLessThanOrEqual(1_015);
			expect(analysis.globals.gcdMs, name).toBe(GCD_FLOOR_MS);
		}
		expect(fallenProtectors.measuredGcd.medianMs).toBe(1_009);
		expect(garrosh.measuredGcd.medianMs).toBe(1_007);
		expect(paragons.measuredGcd.medianMs).toBe(1_006);
		expect(fallenProtectors.measuredGcd.samples).toBe(150);
		expect(paragons.measuredGcd.samples).toBe(354);
		expect(garrosh.measuredGcd.samples).toBe(432);
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
	 * *** The check still reads every pull as faster than the model, and the margins are now small. ***
	 *
	 * This block previously recorded three causes measured on a different capture of this spec, and the
	 * re-capture settles which of them were about the model and which were about that log. The worst
	 * margin across five pulls is now **238ms**, against 2,146ms before. The old headline — Fallen
	 * Protectors' Judgment at −2,146ms — was the log stamping four presses inside 53ms after 3.4s of
	 * silence, and it does not survive a different recording of the same encounter. It was a property of
	 * that capture rather than of the spec.
	 *
	 * What does survive is the real limitation: `HasteCurve.cooldownMsAt` prices a cooldown at the press,
	 * because `sim/core/cast.go` stamps `spell.CD.Set(sim.CurrentTime + cd)` once and never revisits it,
	 * while the game rescales a cooldown that is already running when Bloodlust lands. That is what the
	 * remaining margins are made of, and it is why this is recorded rather than fixed.
	 *
	 * **And the evidence now runs in both directions**, which it could not before. Galakras reads its
	 * builders 64ms *slower* than the model and Spoils 14ms slower — a button pressed a little late,
	 * which is what an ordinary pull looks like. A model that was simply too generous could not produce
	 * rows on both sides of its own prediction.
	 */
	it('reports every pull as faster than the model, with margins inside a quarter second', () => {
		for (const [name, analysis] of ALL) {
			expect(analysis.haste.check?.verdict, name).toBe('faster');
			// No pull misses by as much as a global any more. The bound is the finding: a return to
			// multi-second margins would mean either the curve or the capture had changed.
			expect(analysis.haste.check?.worstMs ?? 0, name).toBeGreaterThan(-250);
		}

		// The worst margin on each pull and the button it belongs to — the row the section leads with.
		const worst = (analysis: Pull) => [analysis.haste.check?.rows[0]?.key, analysis.haste.check?.worstMs];
		expect(worst(fallenProtectors)).toEqual(['crusader-strike', -74]);
		expect(worst(garrosh)).toEqual(['holy-wrath', -222]);
		expect(worst(paragons)).toEqual(['judgment', -238]);
	});

	/**
	 * The rows that agree, which are most of them and are why the ones that do not are readable.
	 *
	 * A haste-scaled cooldown's floor is visible in the press stream: the shortest gap between two
	 * presses of a button *is* that cooldown wherever the player pressed it on cooldown once. At 1.5281
	 * the builders are modelled at 2,945ms, and across the five captures the observed floor runs 2,747 /
	 * 2,871 / 2,925 / 2,959 / 3,009 — straddling the prediction rather than sitting under it.
	 *
	 * Spoils is the tightest at 14ms over 55 gaps, and it is the strongest single piece of evidence on
	 * the page that the divisor the whole report scales by is the right one.
	 */
	it('lands the builders within a few percent of the model, on both sides of it', () => {
		const builders = (analysis: Pull) => analysis.haste.check?.rows.find((row) => row.key === 'crusader-strike');
		expect(builders(spoils)).toMatchObject({ samples: 55, observedMs: 2959, predictedMs: 2945, deltaMs: 14 });
		expect(builders(galakras)).toMatchObject({ samples: 31, observedMs: 3009, predictedMs: 2945, deltaMs: 64 });
		expect(builders(garrosh)).toMatchObject({ samples: 107, observedMs: 2925, predictedMs: 2945, deltaMs: -20 });
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
