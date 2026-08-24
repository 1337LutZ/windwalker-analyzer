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
import { describe, expect, it } from 'vitest';

import type { Analysis, FightDataset, WclEvent } from '~/lib/types';
import { analyseCore, type Handles, type SpecConfig } from '~/lib/analysis/analyseCore';
import { capturedAnalyses, rawFixtures } from '~/lib/analysis/fixtures';
import { unionMs } from '~/lib/analysis/intervals';
import { countAt, intervalsAtLeast, type TargetCountPoint } from '~/lib/analysis/targets';
import { defaultSettings } from '~/lib/settings/model';
import { bandsInPull, resolveBands } from '~/lib/view/targetMode';
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
 * The two series held against each other, on every pull the tree commits.
 *
 * **This block used to be titled "the two series on every committed raw-event fixture", and it asserted
 * that they coincide on all five of those under a docstring headed "why none of the above moves a
 * committed number". Both halves have gone stale, and *how* they went stale is why this guard is shaped
 * the way it is.** The old docstring named its own failure mode exactly — "this is the test that would go
 * red if a fixture were ever recaptured off a pull that fans out with the wind" — and then the 2026-08-24
 * re-capture landed: `cleave`'s Tiger Palm sample moved from 2 presses to 4, that pull read as
 * single-target moved from ungraded to `good`, `mixed`'s figure moved 73.9% → 72.0%. Nothing here went
 * red, because the sweep looked only at the five **raw** fixtures while the re-capture rewrote the six
 * **captured** ones. A guard whose population excludes its own subject cannot fire.
 *
 * So the population is every Windwalker pull the tree holds — six captures and one raw dataset —
 * discovered through `lib/analysis/fixtures` rather than listed, for the reason that module argues at
 * length: a listed set has to be edited by whoever commits the next fixture, and that is the same person
 * who would forget.
 *
 * **The four Elemental pulls are deliberately not swept here.** That spec declares no
 * `aplTargetCountExclude`, so its two series are one array by construction, and
 * `specs/elemental/lib/__tests__/bandedClocks.test.ts` already asserts precisely that over all four of
 * them — *"reads one count series under both edges, because this spec excludes nothing from the ladder's"*
 * — as the tripwire for the day that spec does declare one. A second copy of that claim here would be the
 * copy nobody updates, and this file used to be it. Eleven committed pulls: seven held here, four there.
 *
 * **What is asserted is an invariant, not a pinned pair of numbers.** `aplTargetHits` is
 * `multiTargetHits.filter(notOwnAreaDamage)` — a subset of one hit list, run through the same
 * `targetCounts` at the same window — and `targetCounts` answers "distinct spawns hit in the trailing
 * window", which is monotone in its input. So at every instant the ladder's count is **at most** the
 * evidence one: *the ladder can never see an enemy the evidence did not.* That direction survives any
 * edit to the exclusion list and holds on any spec, which is worth more than the figures three pulls
 * happen to carry today. The figures below are pinned only as far as it takes to show the invariant is
 * not one array compared with itself.
 */
describe('the two series on every committed pull', () => {
	/**
	 * One directory read each, at collection.
	 *
	 * `readFixtures` deliberately does not cache, and it parses **every** file in the folder per call —
	 * seven files and about 3.5 MB for this spec. So these are read once here and shared, and the one raw
	 * pull is analysed lazily below. Nothing in this block mutates an analysis.
	 */
	const CAPTURED = capturedAnalyses('windwalker');
	const RAW = rawFixtures('windwalker');
	const NAMES = [...CAPTURED, ...RAW].map(({ name }) => name);

	const analysed = new Map<string, Analysis>();
	const pull = (name: string): Analysis => {
		const captured = CAPTURED.find((fixture) => fixture.name === name);
		if (captured !== undefined) return captured.analysis;
		const memo = analysed.get(name);
		if (memo !== undefined) return memo;
		const raw = RAW.find((fixture) => fixture.name === name);
		if (raw === undefined) throw new Error(`no Windwalker fixture named ${name}`);
		const analysis = analyseWindwalker(raw.dataset);
		analysed.set(name, analysis);
		return analysis;
	};

	/** Every instant either series samples, and what each of them answers there. */
	const readings = (analysis: Analysis): Array<[t: number, evidence: number, ladder: number]> => {
		const evidence = analysis.targets?.counts.points ?? [];
		const ladder = analysis.targets?.aplCounts?.points ?? [];
		const evidenceAt = countAt(evidence);
		const ladderAt = countAt(ladder);
		return [...new Set([...evidence, ...ladder].map(([t]) => t))]
			.sort((a, b) => a - b)
			.map((t) => [t, evidenceAt(t), ladderAt(t)]);
	};

	const disagreements = (analysis: Analysis) =>
		readings(analysis).filter(([, evidence, ladder]) => evidence !== ladder);

	/**
	 * The population itself, because a sweep over nothing passes.
	 *
	 * `fixtures.ts` makes this argument for the aura guards and it applies here identically: discovery is
	 * what stops a newly committed pull from being swept by one guard and never by another, and the only
	 * thing that can go wrong with discovery is finding nothing.
	 */
	it('sweeps every Windwalker pull the tree holds, found rather than listed', () => {
		expect(CAPTURED.map(({ name }) => name)).toEqual([
			'cleave.json',
			'mixed.json',
			'poor.json',
			'strong.json',
			'waves.json',
			'weave.json',
		]);
		expect(RAW.map(({ name }) => name)).toEqual(['dataset-ironJuggernaut.json']);
		expect(NAMES).toHaveLength(7);
	});

	/**
	 * The invariant, per pull. One `it` each rather than one loop, because the pull's name in the title is
	 * what a reader needs when it fails.
	 *
	 * A violation here is not a figure that moved: it is the two series having stopped being a list and a
	 * filter of it, at which point neither the ladder's guards nor the target-count section's mean what
	 * they say and the docblocks on both sides are describing a relationship that no longer exists.
	 */
	for (const name of NAMES) {
		it(`never counts an enemy the evidence series did not, on ${name}`, { timeout: 120_000 }, () => {
			const targets = pull(name).targets;
			expect(targets, name).toBeDefined();
			// Non-vacuity first: two empty series dominate each other, and a pull that stopped producing
			// counts at all would otherwise satisfy every assertion in this block silently.
			expect(targets?.counts.points.length, name).toBeGreaterThan(0);
			expect(targets?.aplCounts?.points.length, name).toBeGreaterThan(0);
			expect(
				readings(pull(name)).filter(([, evidence, ladder]) => ladder > evidence),
				name,
			).toEqual([]);
			// Which the published pair has to agree with, since it is a maximum over the same series.
			expect(targets?.aplCounts?.max, name).toBeLessThanOrEqual(targets!.counts.max);
		});
	}

	/**
	 * What keeps the invariant from being one array compared with itself.
	 *
	 * Three of the seven genuinely disagree and four coincide, and the partition is the assertion: a
	 * change that pointed `aplTargetPoints` back at `targetPoints` would satisfy every domination check
	 * above and fail here, which is the regression this whole file exists to catch. The coinciding four
	 * are asserted point for point rather than only at the sampled instants — on those pulls the two
	 * arrays really are equal, and the weaker statement would hide a series that had merely gone flat.
	 *
	 * The three opening disagreements are quoted in full so "they differ" is a number rather than a
	 * boolean. They are facts about three logs and will move if those logs are re-captured; that is a
	 * finding to re-read, not a regression — and it is the read the old docstring predicted and never got
	 * to make, because it was watching the wrong five files.
	 */
	it('disagrees on three of the seven and coincides on four, which is what makes the invariant a claim', () => {
		expect(WW_SPEC.aplTargetCountExclude).toEqual(['rushing-jade-wind']);
		const differ = NAMES.filter((name) => disagreements(pull(name)).length > 0);
		expect(differ).toEqual(['cleave.json', 'strong.json', 'waves.json']);
		for (const name of NAMES.filter((n) => !differ.includes(n))) {
			const targets = pull(name).targets;
			expect(targets?.aplCounts?.points, name).toEqual(targets?.counts.points);
		}
		// `[t, evidence, ladder]` at the first instant the two readings part company on each pull.
		expect(disagreements(pull('cleave.json'))[0], 'cleave').toEqual([2475, 4, 0]);
		expect(disagreements(pull('strong.json'))[0], 'strong').toEqual([12_492, 5, 1]);
		expect(disagreements(pull('waves.json'))[0], 'waves').toEqual([6903, 5, 4]);
	});

	/**
	 * `bandsInPull`'s own claim, now checkable on pulls where it could fail.
	 *
	 * Its docblock rests on "it costs no exemption on anything in the tree", and until the re-capture that
	 * was a statement about fixtures on which the two series were the same array — true, and empty. It is
	 * neither now: `cleave`, `strong` and `waves` hand the two readings genuinely different numbers and
	 * still resolve to the same band set, because `bandOf` floors at 1 and both series reach 4 on each of
	 * them. So this is a fact about three real pulls rather than a tautology, and it is the assertion that
	 * would go red the day a divergence is deep enough to cost a band — at which point the swap stops
	 * being free and `bandsInPull`'s argument needs re-reading rather than its result being trusted.
	 */
	it('answers the same band set under either reading, on all seven', () => {
		for (const name of NAMES) {
			const targets = pull(name).targets;
			expect(bandsInPull(targets), name).not.toBeNull();
			const { aplCounts: _dropped, ...evidenceOnly } = targets!;
			expect(bandsInPull(targets), name).toEqual(bandsInPull(evidenceOnly));
		}
	});

	/**
	 * The other direction, and the half no guard held before: the **published** figures stay on the
	 * evidence series.
	 *
	 * `multiTargetMs` and `multiTargetPct` are what the target-count section prints and what `detected`
	 * and the whole-pull mode are derived from, and `analyseCore` takes both halves of that ratio off
	 * `targetPoints` deliberately — a share whose numerator and denominator came off different series is
	 * how a percentage above 100 happens. Rebuilt here from the array the chart draws and then demanded of
	 * the published field, so the two sides of the assertion are not one number.
	 *
	 * Non-vacuous exactly where it matters: on the three divergent pulls the same derivation off the
	 * *ladder's* series gives a different answer, so this cannot pass by the two series being one. The
	 * gap is 88.3% → 74.6% on `cleave`, 13.1% → 11.8% on `strong` and 73.0% → 68.2% on `waves`, and it
	 * moves no mode — all three land the same side of the Windwalker's 33% threshold. Latent, therefore,
	 * rather than live; the day one of them straddles it, this is where it shows.
	 */
	it('keeps the published mode share on the evidence series, which the ladder’s would now move', () => {
		const shareOf = (points: readonly TargetCountPoint[], durationMs: number): number => {
			const contact = unionMs(intervalsAtLeast(points, 1, durationMs));
			return contact > 0 ? (unionMs(intervalsAtLeast(points, 2, durationMs)) / contact) * 100 : 0;
		};
		for (const name of NAMES) {
			const analysis = pull(name);
			const targets = analysis.targets!;
			expect(unionMs(intervalsAtLeast(targets.counts.points, 2, analysis.durationMs)), name).toBe(
				targets.multiTargetMs,
			);
			expect(shareOf(targets.counts.points, analysis.durationMs), name).toBeCloseTo(targets.multiTargetPct, 10);
		}
		for (const name of ['cleave.json', 'strong.json', 'waves.json']) {
			const analysis = pull(name);
			expect(shareOf(analysis.targets!.aplCounts!.points, analysis.durationMs), name).not.toBeCloseTo(
				analysis.targets!.multiTargetPct,
				1,
			);
		}
		// The three gaps, so the sentence above is executed rather than asserted in prose.
		expect(shareOf(pull('cleave.json').targets!.aplCounts!.points, pull('cleave.json').durationMs)).toBeCloseTo(
			74.62,
			1,
		);
		expect(shareOf(pull('strong.json').targets!.aplCounts!.points, pull('strong.json').durationMs)).toBeCloseTo(
			11.75,
			1,
		);
		expect(shareOf(pull('waves.json').targets!.aplCounts!.points, pull('waves.json').durationMs)).toBeCloseTo(68.2, 1);
		// And none of the three crosses the threshold, so no published mode is one series away from moving.
		for (const name of ['cleave.json', 'strong.json', 'waves.json']) {
			const analysis = pull(name);
			const threshold = analysis.targets!.thresholdPct;
			expect(shareOf(analysis.targets!.aplCounts!.points, analysis.durationMs) >= threshold, name).toBe(
				analysis.targets!.multiTargetPct >= threshold,
			);
		}
	});
});
