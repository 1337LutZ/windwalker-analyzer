// The two band questions, and the series each of them now reads.
//
// `targetSeries.test.ts` beside this file establishes the split: `analyseCore` builds the live enemy
// count twice, as `targetPoints` (every landed hit — the **evidence** series) and as `aplTargetPoints`
// (the same hits less the spec's own area damage, per `aplTargetCountExclude` — the **ladder's**), and
// the rule the split follows is that a question about **which rung of the priority list applied** reads
// the ladder's series while a question about **whether there was an enemy there** reads the evidence
// one. That file closes with a note that two live consumers broke the rule and that neither could be
// fixed from there, because nothing on `Analysis` carried the ladder's series:
//
//   - `view/targetMode.bandsInPull` — which bands a metric is scored at, via `resolveBands`.
//   - the Windwalker's `tigerPalmShare` — which narrows a press sample by band.
//
// `TargetSummary.aplCounts` is what closes it, and this file is what shows the closing did something.
// It is the same synthetic Windwalker pull, in the same matched pair — one pull whose only fan-out is
// Rushing Jade Wind, one differing in exactly one token, the ability id on the area damage — with Tiger
// Palm presses added on both sides of the wave so the press sample has something to be narrowed.
//
// **What the direction is, and why `tigerPalmShare` is the one worth the fixture.** Read off the
// evidence series, a press made while the wind was fanning into a pack falls out of the sample
// altogether — numerator and denominator — so a monk who clipped a healthy Tiger Power right through an
// add wave has those presses *excused*, and the metric grades whatever is left. That is the direction
// that flatters, and the pull below makes it 0% waste graded `good` against 50% graded `bad` off one set
// of events. `bandsInPull` errs the other way — it judges more — which is why it is argued rather than
// merely fixed; the argument is in its docstring and the second `describe` here is what pins the claim
// that argument rests on.
//
// The trap the sibling file documents applies here too and is the reason the adds take real damage:
// `landedHits` drops a spawn that never took any, so an immune add is absent from **both** series and
// cannot separate them.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis, FightDataset, WclEvent } from '~/lib/types';
import { analyseCore, type Handles, type SpecConfig } from '~/lib/analysis/analyseCore';
import { defaultSettings } from '~/lib/settings/model';
import { bandsInPull, resolveBands } from '~/lib/view/targetMode';
import { analyse as analyseElemental } from '~/specs/elemental/lib';
import { analyse as analyseWindwalker, WW_SETTINGS, WW_SPEC } from '~/specs/windwalker/lib';
import { scoreAnalysis } from '~/specs/windwalker/lib/score';

const T0 = 300_000;
const DURATION = 60_000;
const MONK = 5;
const BOSS = 20;
const ADD = 40;
const ADD2 = 41;

const RJW_CAST = 116_847;
/** The one damage id `WW_SPEC.aplTargetCountExclude` reaches, through `rushing-jade-wind`. */
const RJW_DAMAGE = 148_187;
/** Spinning Crane Kick: the same fan-out, the same instants, and *not* excluded. The control. */
const SCK_DAMAGE = 107_270;
const RSK_CAST = 107_428;
const TIGER_PALM_CAST = 100_787;
const TIGER_POWER = 125_359;
const TEB_BANK = 1_247_279;

/** The wave runs 3s–30s at one hit a second, so a `>= 2` stretch has room to be longer than a window. */
const WAVE_FROM = 3000;
const WAVE_TO = 30_000;

/**
 * The three presses made while the wind was fanning, and the three made after it stopped.
 *
 * Tiger Power goes up at 1s and is never refreshed, so it lapses at 21s: the first three presses are
 * `wasted` (a healthy buff clipped, no Combo Breaker) and the last three are `apply` (the buff had
 * gone). So the *whole-pull* share is 3 of 6, and which of the two readings is used decides how much of
 * that sample survives — nothing else about the pull does.
 *
 * Six rather than four because `MIN_GRADED_SAMPLE` is three: with two presses on either side, the
 * narrower reading would fall under the floor and go ungraded, and "the metric vanished" is a weaker
 * demonstration than "the metric said the opposite". Both readings here clear the floor and are graded.
 */
const IN_WAVE = [8000, 12_000, 16_000] as const;
const AFTER_WAVE = [42_000, 44_000, 46_000] as const;

/**
 * Energy and chi on the presses, for the reason `immuneTargets.test.ts` gives: `aplAudit` returns null
 * rather than an empty audit for a log with no bars, and `resourceActor: 1` means "the source's".
 */
const bars = (energy: number, chi: number): Record<string, unknown> => ({
	resourceActor: 1,
	classResources: [
		{ amount: energy, max: 100, type: 3 },
		{ amount: chi, max: 4, type: 12 },
	],
});

const ev = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: MONK,
	targetID: MONK,
	...extra,
});

/**
 * One pull whose only second and third targets are reached by area damage, with the ability id as the
 * parameter — and six Tiger Palms, three inside the fan-out and three outside it.
 *
 * The Tiger Palms emit no damage of their own, deliberately: a hit on the boss would put the boss back
 * into the ladder's series mid-wave and the premise below would be reading 1 instead of 0. Both are band
 * 1 and nothing downstream would move, but the fixture is easier to trust when the number it asserts is
 * the number the exclusion produces rather than one press away from it.
 */
const dataset = (areaDamageID: number, code: string): FightDataset => {
	const fight = {
		id: 3,
		name: 'Iron Juggernaut',
		encounterID: 51_600,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: T0 + DURATION,
	};
	// Three enemies, not two: bands 2 and 3 are different answers and a two-target pull cannot tell which
	// of them the evidence series reached.
	const wave: WclEvent[] = [];
	for (let t = WAVE_FROM; t <= WAVE_TO; t += 1000) {
		wave.push(ev(t, 'damage', areaDamageID, { targetID: BOSS, amount: 5000, hitType: 1 }));
		wave.push(ev(t, 'damage', areaDamageID, { targetID: ADD, targetInstance: 1, amount: 4000, hitType: 1 }));
		wave.push(ev(t, 'damage', areaDamageID, { targetID: ADD2, targetInstance: 1, amount: 4000, hitType: 1 }));
	}
	return {
		code,
		fight,
		actor: { id: MONK, name: 'Bigdogmo', type: 'Player' },
		actors: [
			{ id: MONK, name: 'Bigdogmo', type: 'Player' },
			{ id: BOSS, name: 'Iron Juggernaut', type: 'NPC', subType: 'Boss' },
			{ id: ADD, name: 'Assault Bot', type: 'NPC', subType: 'NPC' },
			{ id: ADD2, name: 'Assault Bot', type: 'NPC', subType: 'NPC' },
		],
		events: [
			// The Tigereye Brew bank, which is what `WW_SPEC.identify` reads to call this a Windwalker.
			ev(500, 'applybuffstack', TEB_BANK, { stack: 1 }),
			ev(1500, 'applybuffstack', TEB_BANK, { stack: 2 }),
			// Tiger Power up at 1s and never refreshed, so it lapses at 21s — which is what makes the three
			// presses inside the wave clips of a healthy buff and the three after it applications.
			ev(1000, 'applybuff', TIGER_POWER),
			// A single-target press before the wave, so both series have one-enemy time to be counted at.
			ev(1000, 'cast', RSK_CAST, { targetID: BOSS, ...bars(100, 2) }),
			ev(1000, 'damage', RSK_CAST, { targetID: BOSS, amount: 9000, hitType: 1, ...bars(100, 2) }),
			ev(2500, 'cast', RJW_CAST, bars(100, 3)),
			...wave,
			...[...IN_WAVE, ...AFTER_WAVE].map((t) => ev(t, 'cast', TIGER_PALM_CAST, { targetID: BOSS, ...bars(100, 1) })),
			// And one landed hit after the wave, so the pull does not end inside it and the closing edge is
			// measured rather than clamped by the kill.
			ev(40_000, 'cast', RSK_CAST, { targetID: BOSS, ...bars(100, 2) }),
			ev(40_000, 'damage', RSK_CAST, { targetID: BOSS, amount: 9000, hitType: 1, ...bars(100, 2) }),
		],
		table: {
			fight: {
				...fight,
				enemyNPCs: [
					{ id: BOSS, gameID: 68_078 },
					{ id: ADD, gameID: 68_079 },
					{ id: ADD2, gameID: 68_079 },
				],
			},
			damageDone: {
				entries: [
					{
						name: 'Bigdogmo',
						id: MONK,
						type: 'Monk',
						itemLevel: 553,
						total: 100_000,
						activeTime: DURATION,
						abilities: [{ guid: areaDamageID, name: 'Area', total: 100_000 }],
					},
				],
			},
		},
	} as unknown as FightDataset;
};

/**
 * The analysis, plus the `Handles` the ladder was handed — so the published field can be checked
 * against the series it is supposed to be a copy of rather than against a second opinion of it.
 *
 * Wrapping `WW_SPEC.audit` rather than substituting a stub keeps this the *real* spec: an exclusion this
 * spec stopped declaring would show up here as the two series agreeing.
 */
const both = (areaDamageID: number, code: string) => {
	let handles: Handles | undefined;
	const spec: SpecConfig = {
		...WW_SPEC,
		audit: (h) => {
			handles = h;
			return WW_SPEC.audit(h);
		},
	};
	const analysis = analyseCore(dataset(areaDamageID, code), defaultSettings(WW_SETTINGS), spec);
	if (handles === undefined) throw new Error('the spec audit never ran, so there is no APL series to read');
	return { analysis, handles };
};

/** The pull's own Tiger Palm metric, as a reader with the detection would see it. */
const tigerPalm = (analysis: Analysis) => {
	const card = scoreAnalysis(analysis, resolveBands(analysis.targets, 'auto'));
	const metric = card.sections['tigerPalm']?.metrics.find((m) => m.key === 'tigerPalmWaste');
	if (metric === undefined) throw new Error('the Tiger Palm section carried no tigerPalmWaste metric');
	return metric;
};

describe('the band questions on a pull whose extra targets are reached only by the spec’s own area damage', () => {
	const wind = both(RJW_DAMAGE, 'wind-only');

	/**
	 * The premise, and the one assertion every other one below is worthless without: the two series
	 * genuinely disagree on this pull, and the published `aplCounts` is the ladder's and not a second
	 * copy of the evidence.
	 *
	 * **Zero, not one, mid-wave**, and that is the measurement rather than a rounding of it: the wave is
	 * nothing but wind damage, so once the opening Rising Sun Kick has aged out of the trailing window the
	 * ladder's series has no hits in it at all. `bandOf(0)` is 1, so the ladder spends the wave in its
	 * single-target branch — the exclusion working as declared, not failing.
	 */
	it('publishes the ladder’s series beside the evidence one, and they disagree', () => {
		expect(wind.analysis.targets?.counts.max).toBe(3);
		expect(wind.analysis.targets?.aplCounts?.max).toBe(1);
		// The published field is the series the ladder banded on, point for point — not a recomputation of
		// it that could drift, and not the evidence series under a second name.
		expect(wind.analysis.targets?.aplCounts?.points).not.toEqual(wind.analysis.targets?.counts.points);
		const published = wind.analysis.targets?.aplCounts?.points ?? [];
		const ladderAt = (t: number): number | undefined => [...published].reverse().find(([at]) => at <= t)?.[1];
		for (const t of [15_000, ...IN_WAVE]) {
			expect(ladderAt(t), `ladder at ${t}`).toBe(wind.handles.aplTargetCountAt(t));
			expect(wind.handles.aplTargetCountAt(t), `ladder at ${t}`).toBe(0);
		}
		// And the evidence series says three at the same instants, which is what the report draws.
		const evidence = wind.analysis.targets?.counts.points ?? [];
		for (const t of [15_000, ...IN_WAVE]) {
			expect([...evidence].reverse().find(([at]) => at <= t)?.[1], `evidence at ${t}`).toBe(3);
		}
	});

	/**
	 * `bandsInPull`, the first of the two consumers.
	 *
	 * The ladder never left band 1, so the set is `[1]`. Off the evidence series it would be `[1, 3]` —
	 * which is what the same call returns when the field is taken away, asserted below rather than
	 * described, because "the old reading" is only worth naming if it is shown.
	 */
	it('reads the bands a metric is scored at off the ladder’s series', () => {
		expect(bandsInPull(wind.analysis.targets)).toEqual([1]);
		expect(resolveBands(wind.analysis.targets, 'auto').bands).toEqual([1]);
		// The evidence reading, reached by handing over a summary with no `aplCounts` — exactly the shape
		// every fixture captured before the field existed arrives in, which is also why the fallback has to
		// be `counts` and not the empty series.
		const { aplCounts: _dropped, ...evidenceOnly } = wind.analysis.targets!;
		expect(bandsInPull(evidenceOnly)).toEqual([1, 3]);
	});

	/**
	 * `bandsInPull`'s swap costs no exemption, which is the claim its docstring rests on.
	 *
	 * The Windwalker's only banded rule is `tigerPalmWaste`'s `bands: [1]`, and band 1 is in both sets —
	 * `bandOf(0)` is 1, so a stretch the exclusion empties still reports it. So the narrower set cannot
	 * empty an intersection here, and the metric is graded under either reading. This is the assertion
	 * that keeps the argument honest: if a future rule declares a band the ladder's series can miss, this
	 * is where the trade-off stops being free.
	 */
	it('leaves the intersection non-empty under either reading, so nothing is exempted by the swap', () => {
		const { aplCounts: _dropped, ...evidenceOnly } = wind.analysis.targets!;
		expect(bandsInPull(wind.analysis.targets)).toContain(1);
		expect(bandsInPull(evidenceOnly)).toContain(1);
		expect(tigerPalm(wind.analysis).unmeasurable).toBe(false);
	});

	/**
	 * `tigerPalmShare`, the second consumer, and the direction that matters.
	 *
	 * Six presses, three of them clips of a healthy Tiger Power. The ladder's series bands the whole pull
	 * at 1, so all six are the sample and the share is the honest 50%. The evidence series bands the wave
	 * at 3, so the three presses made in it — and every one of the pull's wasted presses is one of them —
	 * leave the sample, and what is left is three applications with nothing wrong: 0%, `good`, on a pull
	 * where half the filler was thrown away.
	 *
	 * That is the excusing direction, and it is asserted as presses rather than as a count: which three
	 * left, that they are exactly the wasted ones, and that the share and the grade move with them.
	 */
	it('keeps the presses made under the spec’s own area damage in the sample', () => {
		const metric = tigerPalm(wind.analysis);
		expect(wind.analysis.filler.casts).toBe(6);
		expect(wind.analysis.filler.wasted).toBe(3);
		// Every wasted press is one of the three made inside the fan-out, so the two readings differ by the
		// whole of the numerator. Stated off the audit rather than assumed from the timings.
		expect(wind.analysis.filler.castList.filter((p) => p.reason === 'wasted').map((p) => p.t)).toEqual([...IN_WAVE]);
		expect(wind.analysis.filler.castList.filter((p) => p.reason === 'apply').map((p) => p.t)).toEqual([...AFTER_WAVE]);
		// The whole sample, and the honest share of it.
		expect(metric.sampleSize).toBe(6);
		expect(metric.value).toBeCloseTo(50, 5);
		expect(metric.grade).toBe('bad');
	});

	/**
	 * The same pull under the old reading, and the failure text is the point of this test.
	 *
	 * Not a re-derivation of the assertion above from the same value: this scores the *same analysis* with
	 * the ladder's series removed from it, which is precisely what `tigerPalmShare` saw before `aplCounts`
	 * existed. Three presses survive, none of them wasted, and the metric grades `good`.
	 */
	it('would drop them, and grade the pull good, off the evidence series', () => {
		const { aplCounts: _dropped, ...evidenceOnly } = wind.analysis.targets!;
		const old = tigerPalm({ ...wind.analysis, targets: evidenceOnly });
		expect(old.sampleSize).toBe(3);
		expect(old.value).toBe(0);
		expect(old.grade).toBe('good');
		// The whole of the movement in one line: same events, same six presses, opposite verdict.
		expect(tigerPalm(wind.analysis).grade).toBe('bad');
	});

	/**
	 * The control, and the half that makes the pair a measurement.
	 *
	 * Identical events at identical instants under an ability the exclusion does not name. The two series
	 * now agree, so both readings of both consumers agree with each other — `[1, 3]` either way, and the
	 * three presses in the wave excused either way. So the divergence on the wind pull is the exclusion's
	 * doing and nothing else's: not the add, not the wave shape, not the window, and not the presses.
	 */
	it('agrees with the ladder when the fan-out is an ability the exclusion does not name', () => {
		const control = both(SCK_DAMAGE, 'control');
		expect(control.analysis.targets?.aplCounts?.points).toEqual(control.analysis.targets?.counts.points);
		expect(bandsInPull(control.analysis.targets)).toEqual([1, 3]);
		// The published evidence series is the same on both pulls — the two reports differ only in what the
		// ladder was told, which is the claim of the pair in one line.
		expect(control.analysis.targets?.counts.points).toEqual(wind.analysis.targets?.counts.points);
		// And the metric moves back to the flattering reading, because on this pull it is the honest one:
		// the ladder really did see three enemies, so a Tiger Palm pressed there was not the press the
		// single-target filler rule asked about.
		const metric = tigerPalm(control.analysis);
		expect(control.analysis.filler.wasted).toBe(3);
		expect(metric.sampleSize).toBe(3);
		expect(metric.value).toBe(0);
	});
});

/**
 * Why none of the above moves a committed number, checked rather than asserted in prose.
 *
 * Every raw-event fixture in the tree is run through its own spec and the two series compared. The
 * Windwalker's one dataset is a single-target Iron Juggernaut pull with no Rushing Jade Wind damage in
 * it at all, and every Elemental fixture is on a spec that declares no `aplTargetCountExclude` — so the
 * two series coincide by construction there and by content on the one that could have differed.
 *
 * This is the test that would go red if a fixture were ever recaptured off a pull that fans out with the
 * wind: the change above would then move real figures, and that is a finding rather than a regression.
 * The band sets are compared too, since `bandsInPull` is the consumer that reads them.
 */
describe('the two series on every committed raw-event fixture', () => {
	const load = (path: string): FightDataset =>
		JSON.parse(readFileSync(resolve(import.meta.dirname, '../../..', path), 'utf8')) as FightDataset;

	const cases: Array<[string, () => Analysis]> = [
		[
			'windwalker/dataset-ironJuggernaut',
			() => analyseWindwalker(load('specs/windwalker/__fixtures__/dataset-ironJuggernaut.json')),
		],
		['elemental/phased', () => analyseElemental(load('specs/elemental/__fixtures__/phased.json'))],
		['elemental/unbroken', () => analyseElemental(load('specs/elemental/__fixtures__/unbroken.json'))],
		['elemental/cleave', () => analyseElemental(load('specs/elemental/__fixtures__/cleave.json'))],
		['elemental/addsThenBoss', () => analyseElemental(load('specs/elemental/__fixtures__/addsThenBoss.json'))],
	];

	for (const [name, run] of cases) {
		it(`coincide on ${name}, so the band questions read the same numbers as before`, { timeout: 120_000 }, () => {
			const targets = run().targets;
			expect(targets, name).toBeDefined();
			// Non-vacuity first: two undefined series are equal to each other, and a fixture that stopped
			// producing counts at all would otherwise pass this whole block silently.
			expect(targets?.counts.points.length, name).toBeGreaterThan(0);
			expect(targets?.aplCounts?.points.length, name).toBeGreaterThan(0);
			expect(bandsInPull(targets), name).not.toBeNull();
			expect(targets?.aplCounts?.points, name).toEqual(targets?.counts.points);
			expect(targets?.aplCounts?.max, name).toBe(targets?.counts.max);
			// Which is the same statement made where it is consumed: the swap is invisible on this fixture.
			const { aplCounts: _dropped, ...evidenceOnly } = targets!;
			expect(bandsInPull(targets), name).toEqual(bandsInPull(evidenceOnly));
		});
	}
});
