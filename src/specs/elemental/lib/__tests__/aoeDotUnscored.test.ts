// Nothing on the Elemental card grades the dot above two enemies, and this file is why that stands.
//
// Every Flame Shock rule in `THRESHOLDS` stops at band 2. `flameShockUptime` is `bands: [1, 2]`,
// `flameShockWaste` is `[1]`, `flameShockMultiDot` is `[2]` and `flameShockSnapshots` is `[1]` — so on a
// pull that spends 226.1s of 560.3s at three enemies or more, **no metric on the card has anything to say
// about the dot across those 226.1 seconds.** The ladder grades band 3 and band 4 perfectly well; the
// scorecard does not reach them.
//
// The argument that put the hole there is on record at `flameShockUptime` in `score.ts`: `aoe.apl.json`
// carries **no Lava Burst rung at all**, so the cascade the 95%/85% bar is derived from — a dropped dot
// costing far more than the global that would have replaced it — does not exist above two enemies, and a
// 95% clock is not the aoe list's rule stated in percent. That argument is about the *bar* and it still
// holds. What changed underneath it is the *button*: since `021ff53` the band-3 branch of the
// `flame-shock` rung reads Breath of the Hydra off `combatantinfo` instead of assuming it, so
// `aoe.apl.json` rung 1 — `auraIsKnown(138898) AND not(dotIsActive(8050))` — genuinely does demand Flame
// Shock at three enemies and up, on the pull that wears the trinket. The question stopped being *whether*
// and became *whose*.
//
// So this file measures what a band-3+ dot metric would have to be built on, and pins the four things that
// say it cannot be built yet. It is a negative result and it is asserted rather than asserted-away, for
// the reason `bandedClocks.test.ts` gives about the free pass this whole effort could otherwise create: a
// hole nobody wrote down is indistinguishable from a hole nobody noticed.
//
//  1. **The demand is gear-gated, not count-gated.** Exactly one committed pull is asked for the dot at
//     band 3+, and it is not the pull with the most enemies. `cleave` peaks at **thirteen** and spends
//     82.8s at three or more, and the aoe list asks its shaman for Flame Shock **zero** times there,
//     because that shaman wears Kardris' Toxic Totem where `addsThenBoss`' wears Breath of the Hydra.
//  2. **One pull is the whole sample, and the reader's own override cannot make a second.** Forcing
//     `phased` and `unbroken` to band 3 or band 4 produces no Flame Shock demand either — the gate is the
//     kit and not the count, so the counterfactual walk that normally manufactures a second observation
//     has nothing to manufacture it from. Thresholds drawn from one observation are not thresholds.
//  3. **The value would be chosen rather than measured.** Over the one clock available — 226 113ms — the
//     two dot readings the audit already publishes differ by **61.6 points**: 6.39% scoped to the primary
//     (which on this pull is untargetable for its first 442 of 560 seconds) and 68.00% taken as the union
//     across all nine enemies (which credits a dot ticking on an add the player left two minutes ago).
//     The aoe rung asks for neither: `not(dotIsActive(8050))` is about the enemy in front of the player,
//     and the audit's own split between `fsRemainingAt` and `fsMerged` is exactly this fork. A metric
//     whose number is decided by which of two published readings it happens to call is not a measurement.
//  4. **The demand count is a cadence, not a decision count.** The rung sits at priority 1 of a five-rung
//     list, so it claims *every* global the dot is down: 121 demands fall in **41 runs**, the longest
//     **fifteen consecutive globals** — one lapse charged fifteen times. At band 4 it claims **75.0%** of
//     the band's globals, which is over the 72% share this repo already refused once, in as many words,
//     when the band-2 `maxDots` reading was measured and dropped as "a bigger error than the one being
//     fixed" (see `FS_CLEAVE_OVERLAP_MS` in `../apl.ts`).
//
// And a fifth, structural: **the audit publishes no clock a band-3+ share could be taken over.** Both
// halves of the dot's ratio are cut with `gradedSpans` in `index.ts`, so `scoredMs` is contact time *less*
// the band-3+ stretches — asserted below as an exact identity on all four pulls — and `contactUptimeMs`
// lives inside it by construction. A band-3+ metric needs the same pair cut the other way, published from
// `index.ts`, before `score.ts` has anything to read.
//
// **What can and cannot go red here**, since a file pinning a *hole* has no behaviour to have changed.
// The measurements are derivations off four sources — the ladder's verdicts, the counts series, the gear
// array and the timeline lanes — and none of them is the scorecard, so each is a second opinion rather
// than a restatement. Four failures were run and are worth naming, two against the production change this
// file exists to forbid and two against a deliberately wrong derivation, which is the technique
// `flameShockBand.test.ts` uses for the same reason:
//
//  - `flameShockUptime` widened to `bands: [1, 2, 3, 4]` — the tempting close, which closes nothing
//    because `MetricRule.bands` cuts no clock. *`flameShockUptime: expected [ 3, 4 ] to deeply equal []`*.
//  - `flameShockMultiDot` widened to `[2, 3, 4]` — the other tempting close, stretching the band-2 rule
//    upward instead. *`flameShockMultiDot: expected [ 3, 4 ] to deeply equal []`*.
//  - `HYDRA_ITEM_IDS` narrowed to the base id `94521`, the mistake that constant's own docblock in
//    `../apl.ts` warns about, since the fixture wears an upgrade step. *`expected [] to deeply equal
//    [ 'addsThenBoss' ]`*, and the gradable-pull count with it.
//  - `banderFor` read once per pull off `counts.max` instead of per moment — the collapse
//    `lib/score/bands.ts` exists to stop. *`expected [ 'addsThenBoss', 'cleave' ] to deeply equal
//    [ 'addsThenBoss' ]`* and *`expected { globals: +0, demands: +0 } to deeply equal { globals: 179,
//    demands: 82 }`*.
//
// The one red **not** available from inside this lane is the interesting one: reverting `021ff53`'s gear
// read would put `cleave` in the asked set and not in the wearing set, which is exactly what the first
// assertion below is for. That rung lives in `../apl.ts`, and `021ff53`'s own message records the figure
// it would restore — 40 of `cleave`'s 58 Flame Shock skips were band-3-or-4 presses charged against a rung
// that list never offered its shaman.

import { describe, expect, it } from 'vitest';

import { type Interval, intersect, mergeIntervals, unionMs } from '~/lib/analysis/intervals';
import { rawFixtures } from '~/lib/analysis/fixtures';
import type { Analysis, ElementalAuditResult, Window } from '~/lib/types';

import { analyse } from '../index';
import { scoreAnalysis, THRESHOLDS } from '../score';

type El = Analysis & ElementalAuditResult;

/** Every raw Elemental pull, found rather than listed — the shape `flameShockBand.test.ts` sets. */
const FIXTURES = rawFixtures('elemental').map(({ name }) => name.replace(/\.json$/, ''));

const analysed = new Map<string, El>();
const fx = (name: string): El => {
	const hit = analysed.get(name);
	if (hit !== undefined) return hit;
	const found = rawFixtures('elemental').find((fixture) => fixture.name === `${name}.json`);
	if (found === undefined) throw new Error(`no raw Elemental fixture ${name}`);
	const el = analyse(found.dataset) as El;
	analysed.set(name, el);
	return el;
};

/**
 * Breath of the Hydra, by item id — the base and its four upgrade steps.
 *
 * A second copy, deliberately, and `lib/spec/__tests__/aoeFlameShockGear.test.ts` keeps a third for the
 * same reason: the list in `../apl.ts` is not exported, and a test that imported the production constant
 * would be asking the rung whether it agrees with itself. `addsThenBoss.json`'s shaman wears **96455**,
 * the heroic Throne of Thunder id, so a list carrying only the base id would pass this file vacuously.
 */
const HYDRA_ITEM_IDS: readonly number[] = [94_521, 95_711, 96_083, 96_455, 96_827];

const toIntervals = (windows: readonly Window[]): Interval[] => windows.map((w) => [w.start, w.end]);

/** The `>= 3` count series, off the array the shield's chart greys — the reader's own view of the pull. */
const aoe = (a: El): Interval[] => toIntervals(a.lightningShield.aoeWindows);
const contact = (a: El): Interval[] => (a.timeline?.contactSegments ?? []) as Interval[];
/** Band-3+ time the player was demonstrably in the fight for — the only clock such a metric could use. */
const aoeContact = (a: El): Interval[] => intersect(contact(a), aoe(a));

/** The band a moment was read at, off the counts series rather than off any verdict. */
const banderFor = (a: El): ((t: number) => 1 | 2 | 3 | 4) => {
	const points = (a.targets?.counts?.points ?? []) as Array<[number, number]>;
	return (t) => {
		let count = 0;
		for (const [at, c] of points) {
			if (at > t) break;
			count = c;
		}
		return count <= 1 ? 1 : count === 2 ? 2 : count <= 5 ? 3 : 4;
	};
};

interface Press {
	decidedAt: number;
	wanted: string | null;
	verdict: string;
}
const pressesOf = (a: El): Press[] => ((a.apl as unknown as { presses?: Press[] } | null)?.presses ?? []) as Press[];
const forcedPressesOf = (a: El, band: 3 | 4): Press[] =>
	((a as unknown as { aplForced?: Record<string, { presses?: Press[] } | null> }).aplForced?.[String(band)]?.presses ??
		[]) as Press[];

/** The globals at three enemies or more where the aoe list wanted Flame Shock and nothing else. */
const aoeDotDemands = (a: El): Press[] => {
	const band = banderFor(a);
	return pressesOf(a).filter((p) => band(p.decidedAt) >= 3 && p.wanted === 'flame-shock');
};

const ownsHydra = (a: El): boolean => (a.gear?.slots ?? []).some((slot) => HYDRA_ITEM_IDS.includes(slot.id));

/** Every enemy's Flame Shock lane, unioned — the widest honest reading of "the dot was up somewhere". */
const laneUnion = (a: El): Interval[] =>
	mergeIntervals(
		(a.timeline?.lanes ?? [])
			.filter((lane) => lane.key === 'flame-shock')
			.flatMap((lane) => lane.windows.map((w) => [w.start, w.end] as Interval)),
	);

describe('what the aoe list asks of Flame Shock above two enemies', () => {
	it('asks exactly the same thing at three enemies as at nine, because it is one branch', () => {
		// `aoe.apl.json` covers three or more, and the rung reads `state.band >= 3` — so bands 3 and 4 are
		// not two rules with two thresholds, they are one rule. Put to the reader's own forced walks, which
		// judge the identical press list at a fixed count: every pull's band-3 and band-4 answers agree
		// press for press, on the verdict and on the rung named.
		for (const name of FIXTURES) {
			const three = forcedPressesOf(fx(name), 3).map((p) => `${p.wanted ?? '-'}:${p.verdict}`);
			const four = forcedPressesOf(fx(name), 4).map((p) => `${p.wanted ?? '-'}:${p.verdict}`);
			expect(three, name).toEqual(four);
			// Non-vacuous: every pull has a forced walk with presses in it.
			expect(three.length, name).toBeGreaterThan(100);
		}
		// And the demand itself is the same figure at both bands on the one pull that carries any — 159 of
		// its 408 globals, 15 followed and 144 skipped, identically at three enemies and at nine.
		const forcedDemands = (band: 3 | 4): number =>
			forcedPressesOf(fx('addsThenBoss'), band).filter((p) => p.wanted === 'flame-shock').length;
		expect(forcedDemands(3)).toBe(159);
		expect(forcedDemands(4)).toBe(159);
	});

	it('asks it only of a shaman wearing Breath of the Hydra, so the discriminator is the kit', () => {
		// **Two independent sources, and the finding is that they agree.** The left-hand set comes off the
		// ladder's verdicts; the right-hand set comes off `combatantinfo`'s gear array. Neither reads the
		// other, and a rung that had gone back to assuming the trinket would put `cleave` in the first set
		// and not the second.
		const asked = FIXTURES.filter((name) => aoeDotDemands(fx(name)).length > 0);
		const wearing = FIXTURES.filter((name) => ownsHydra(fx(name)));
		expect(asked).toEqual(['addsThenBoss']);
		expect(wearing).toEqual(['addsThenBoss']);
		expect(asked).toEqual(wearing);
		// The id itself, so a gear read that silently returned an empty kit could not pass the pair above.
		expect((fx('addsThenBoss').gear?.slots ?? []).map((s) => s.id).filter((id) => HYDRA_ITEM_IDS.includes(id))).toEqual(
			[96_455],
		);
		// **And the count is not the discriminator, which is the half worth stating.** `cleave` reaches
		// *thirteen* enemies — four more than `addsThenBoss` — and spends 82.8s of its 263.2s at three or
		// more, and the aoe list asks its shaman for the dot not once across all of it.
		expect(fx('cleave').targets?.counts.max).toBe(13);
		expect(fx('addsThenBoss').targets?.counts.max).toBe(9);
		expect(unionMs(aoeContact(fx('cleave')))).toBe(82_758);
		expect(aoeDotDemands(fx('cleave'))).toHaveLength(0);
	});

	it('claims three globals in four at band 4, which is the over-demand shape this repo already refused', () => {
		const a = fx('addsThenBoss');
		const band = banderFor(a);
		const share = (b: 3 | 4): { globals: number; demands: number } => {
			const inBand = pressesOf(a).filter((p) => band(p.decidedAt) === b);
			return { globals: inBand.length, demands: inBand.filter((p) => p.wanted === 'flame-shock').length };
		};
		expect(share(3)).toEqual({ globals: 179, demands: 82 });
		expect(share(4)).toEqual({ globals: 52, demands: 39 });
		// 75.0% at band 4. The band-2 `maxDots` reading was measured at 72% of its band's globals and
		// dropped for it — "a bigger error than the one being fixed, pointing the other way" — and this is
		// the same rung class, one band up, three points worse.
		expect(share(4).demands / share(4).globals).toBeCloseTo(0.75, 3);
		expect(share(4).demands / share(4).globals).toBeGreaterThan(0.72);
		// **And the count is a cadence rather than a tally of decisions.** The rung is priority 1 of five,
		// so it claims every consecutive global the dot is down: 121 demands in 41 runs, the longest 15.
		const runs: number[] = [];
		let run = 0;
		for (const p of pressesOf(a).filter((q) => band(q.decidedAt) >= 3)) {
			if (p.wanted === 'flame-shock') run += 1;
			else if (run > 0) {
				runs.push(run);
				run = 0;
			}
		}
		if (run > 0) runs.push(run);
		expect(runs.reduce((sum, n) => sum + n, 0)).toBe(121);
		expect(runs).toHaveLength(41);
		expect(Math.max(...runs)).toBe(15);
	});
});

describe('why no metric is built on it', () => {
	it('has one gradable pull, and the reader cannot force a second', () => {
		// The natural walks give one pull. So do the forced ones — and that is the part that closes the
		// door, because forcing a band is the counterfactual that normally manufactures a second reading of
		// a band-gated rule. It cannot here: the gate is the kit, and no override changes what the shaman
		// was wearing. `phased` and `unbroken` are `counts.max === 1` and cannot reach band 3 naturally;
		// forced there they are still asked nothing, so there is no second observation to be had.
		for (const name of FIXTURES) {
			const naturally = aoeDotDemands(fx(name)).length;
			const forced = forcedPressesOf(fx(name), 3).filter((p) => p.wanted === 'flame-shock').length;
			expect(naturally > 0, `${name} natural`).toBe(ownsHydra(fx(name)));
			expect(forced > 0, `${name} forced`).toBe(ownsHydra(fx(name)));
		}
		// Named, so the control pair is on the line beside its figures: the two single-target pulls carry
		// `counts.max === 1` and no band-3+ contact at all, and their forced band-3 walks are empty of this
		// rung rather than merely unreachable.
		for (const name of FIXTURES.filter((n) => (fx(n).targets?.counts.max ?? 1) === 1)) {
			expect(unionMs(aoe(fx(name))), name).toBe(0);
			expect(
				forcedPressesOf(fx(name), 3).filter((p) => p.wanted === 'flame-shock'),
				name,
			).toHaveLength(0);
		}
	});

	it('offers two readings of the one available clock 61.6 points apart, and the rung asks for neither', () => {
		const a = fx('addsThenBoss');
		const clock = aoeContact(a);
		// The clock a band-3+ share would be taken over: 226.1s, every millisecond of it inside contact.
		expect(unionMs(clock)).toBe(226_113);
		expect(unionMs(aoe(a))).toBe(226_113);
		// Reading one: the dot on the *primary*, which is the enemy the pull is named for and which this
		// log leaves untargetable for its first 442 of 560 seconds. 14 448ms — 6.39%.
		const primary = unionMs(intersect(mergeIntervals(toIntervals(a.flameShock.windows)), clock));
		expect(primary).toBe(14_448);
		// Reading two: the union across every one of the nine enemies' lanes, which credits a dot still
		// ticking on an add the player walked away from. 153 766ms — 68.00%.
		const anywhere = unionMs(intersect(laneUnion(a), clock));
		expect(anywhere).toBe(153_766);
		const spread = (anywhere - primary) / unionMs(clock);
		expect(spread * 100).toBeCloseTo(61.6, 1);
		// The number a metric would report is therefore the scope it picked, not the play it saw. Both
		// readings are the audit's own and both are right about their own question — `fsRemainingAt` grades
		// a press against the enemy being hit, `fsMerged` draws the row — and `not(dotIsActive(8050))` is
		// the first of those, which is the one the audit does not publish a *clock* for.
		expect(primary / unionMs(clock)).toBeLessThan(0.07);
		expect(anywhere / unionMs(clock)).toBeGreaterThan(0.67);
	});

	it('publishes no clock a band-3+ share could be taken over, on any of the four pulls', () => {
		// The identity, exact and on every pull: the dot's graded denominator **is** contact time less the
		// band-3+ stretches. Two sources again — `scoredMs` is the audit's, the right-hand side is rebuilt
		// from the timeline's contact array and the shield chart's AoE array — so this is the audit being
		// made to agree with the reader's view rather than with itself.
		for (const name of FIXTURES) {
			const a = fx(name);
			expect(a.flameShock.scoredMs, name).toBe(unionMs(contact(a)) - unionMs(aoeContact(a)));
			// And the numerator lives inside it, so there is no band-3+ dot time published anywhere on the
			// section for a metric to divide.
			expect(a.flameShock.contactUptimeMs, name).toBeLessThanOrEqual(a.flameShock.scoredMs);
		}
		// The two multi-target pulls' figures, so a derivation that had gone to zero on both sides cannot
		// pass: `addsThenBoss` loses 226 113ms of a 552 420ms contact clock and `cleave` 82 758ms of
		// 261 572ms. The single-target pair loses nothing, which is what says the cut found the add waves.
		expect(fx('addsThenBoss').flameShock.scoredMs).toBe(552_420 - 226_113);
		expect(fx('cleave').flameShock.scoredMs).toBe(261_572 - 82_758);
		expect(fx('phased').flameShock.scoredMs).toBe(206_557);
		expect(fx('unbroken').flameShock.scoredMs).toBe(181_775);
	});
});

describe('the card, and the pair that has to move together', () => {
	it('bands every Flame Shock rule out of three and four, and cuts the clock the same way', () => {
		// **The declaration, as the property first** — so a *fifth* rule cannot slip past by not being on
		// the list of four below. Every entry in the table that names bands at all stops at 2, which is the
		// whole of "nothing on this card scores band-3+ play that a band-3+ list asks for".
		const declared = Object.entries(THRESHOLDS).flatMap(([key, rule]) =>
			'bands' in rule && rule.bands !== undefined ? [[key, [...rule.bands]] as const] : [],
		);
		expect(declared.length).toBeGreaterThan(4);
		for (const [key, bands] of declared)
			expect(
				bands.filter((b) => b >= 3),
				key,
			).toEqual([]);
		// And the four dot rules by name, so the property above cannot pass by the table losing its bands.
		expect(THRESHOLDS.flameShockUptime.bands).toEqual([1, 2]);
		expect(THRESHOLDS.flameShockWaste.bands).toEqual([1]);
		expect(THRESHOLDS.flameShockMultiDot.bands).toEqual([2]);
		expect(THRESHOLDS.flameShockSnapshots.bands).toEqual([1]);
		// **And the clock, which is the half a widened declaration would leave behind.** `MetricRule.bands`
		// cuts nothing — it only nulls a metric whose band set misses the pull entirely — so widening
		// `flameShockUptime` to `[1, 2, 3, 4]` would leave it grading band-3+ play over a denominator with
		// band-3+ time already removed. The two are asserted side by side so that cannot happen quietly.
		for (const name of FIXTURES) {
			const a = fx(name);
			expect(a.flameShock.scoredMs + unionMs(aoeContact(a)), name).toBe(unionMs(contact(a)));
		}
	});

	it('leaves the judged denominator at 14 of 23 on all four pulls', () => {
		// The hole's size, stated as the thing a reader is actually shown: 23 points of weight offered, 14
		// judged, identically on every committed pull.
		//
		// **And this is the last argument against landing the metric anyway.** `judged.total` is the summed
		// weight of every metric *offered*, and it does not care which bands a pull visited — a new weighted
		// rule raises the denominator on all four cards and can only ever raise the numerator on the one
		// pull wearing the trinket. So three of the four reports would be told they were judged on a smaller
		// share of the card, in exchange for a figure none of them can be given. `build.ts` puts it as the
		// reason `judged` exists at all: a verdict has to say how much of the card it is a verdict on.
		for (const name of FIXTURES) {
			const scored = scoreAnalysis(fx(name));
			expect(scored.judged, name).toEqual({ measured: 14, total: 23, unmeasurable: false });
		}
		// The overalls beside it, so a change that moved a grade without moving the denominator cannot pass
		// here either. Two of the four are the multi-target pulls this file is about.
		expect(Object.fromEntries(FIXTURES.map((name) => [name, scoreAnalysis(fx(name)).overall]))).toEqual({
			addsThenBoss: 'bad',
			cleave: 'ok',
			phased: 'good',
			unbroken: 'ok',
		});
	});
});
