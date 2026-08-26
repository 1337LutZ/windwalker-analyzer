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

import type { Analysis, FightDataset, TargetSummary, WclEvent } from '~/lib/types';
import { analyseCore, type Handles, type SpecConfig } from '~/lib/analysis/analyseCore';
import { capturedAnalyses, rawFixtures } from '~/lib/analysis/fixtures';
import { unionMs } from '~/lib/analysis/intervals';
import { countAt, intervalsAtLeast, type TargetCountPoint } from '~/lib/analysis/targets';
import { defaultSettings } from '~/lib/settings/model';
import { bandsInPull, resolveBands } from '~/lib/view/targetMode';
import { PROTECTION_SETTINGS, PROTECTION_SPEC } from '~/specs/protection/lib';
import { analyse as analyseWindwalker, WW_SETTINGS, WW_SPEC } from '~/specs/windwalker/lib';
import { scoreAnalysis } from '~/specs/windwalker/lib/score';

/**
 * The three readings both halves of this file take, at module scope so the two specs' blocks cannot
 * answer the same question two ways.
 *
 * They were local to the Windwalker block until the Protection arm at the foot needed them. A second
 * copy is what `docs/conventions.md` says goes stale — and here it would go stale in the worst
 * direction, with two blocks each asserting an invariant against its own definition of the invariant.
 */

/** Every instant either series samples, and what each of them answers there. */
const readingsOf = (targets: TargetSummary): Array<[t: number, evidence: number, ladder: number]> => {
	const evidence = targets.counts.points;
	const ladder = targets.aplCounts?.points ?? [];
	const evidenceAt = countAt(evidence);
	const ladderAt = countAt(ladder);
	return [...new Set([...evidence, ...ladder].map(([t]) => t))]
		.sort((a, b) => a - b)
		.map((t) => [t, evidenceAt(t), ladderAt(t)]);
};

/** `[t, evidence, ladder]` at the first instant the two readings part company, or `undefined`. */
const firstDisagreement = (analysis: Analysis): [number, number, number] | undefined =>
	readingsOf(analysis.targets!).find(([, evidence, ladder]) => evidence !== ladder);

/** The multi-target share of contact time, off whichever series is handed in. */
const shareOf = (points: readonly TargetCountPoint[], durationMs: number): number => {
	const contact = unionMs(intervalsAtLeast(points, 1, durationMs));
	return contact > 0 ? (unionMs(intervalsAtLeast(points, 2, durationMs)) / contact) * 100 : 0;
};

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

	const readings = (analysis: Analysis) => readingsOf(analysis.targets!);

	const disagreements = (analysis: Analysis) =>
		readings(analysis).filter(([, evidence, ladder]) => evidence !== ladder);

	/**
	 * The pulls whose two series genuinely part company, in `NAMES` order — named once because two tests
	 * below ask different questions of the same partition.
	 *
	 * Written out rather than derived from `disagreements`, and that is the point: the test immediately
	 * below computes the partition and asserts it *equals* this, so this literal is the claim and not a
	 * shortcut to it. A test that filtered its own population would be asking whether pulls that disagree
	 * disagree.
	 */
	const DIVERGENT = ['cleave.json', 'strong.json', 'waves.json', 'idle.json', 'sections.json'];

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
		// Four raw pulls now rather than one, and the three that arrived are the reason this whole file
		// stopped being a claim about synthetic events. See the partition below.
		expect(RAW.map(({ name }) => name)).toEqual([
			'dataset-ironJuggernaut.json',
			'idle.json',
			'sections.json',
			'uncounted.json',
		]);
		expect(NAMES).toHaveLength(10);
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
	 * Five of the ten genuinely disagree and five coincide, and the partition is the assertion: a change
	 * that pointed `aplTargetPoints` back at `targetPoints` would satisfy every domination check above
	 * and fail here, which is the regression this whole file exists to catch. The coinciding five are
	 * asserted point for point rather than only at the sampled instants — on those pulls the two arrays
	 * really are equal, and the weaker statement would hide a series that had merely gone flat.
	 *
	 * **The three that arrived are the first time the exclusion had anything to remove on a raw pull, and
	 * that is the correction worth reading rather than the count going 3 → 5.** `aplTargetCountExclude` is
	 * one key, `rushing-jade-wind`, and `dataset-ironJuggernaut.json`'s monk never talented it — so for
	 * every raw fixture in the tree the two series were *the same array*, and the three pulls that
	 * disagreed were all synthetic or captured. The exclusion was being asserted against events written to
	 * exercise it. `sections.json` presses the wind 33 times and `idle.json` 9, both into real packs, and
	 * both now part company with the evidence series: 62 sampled instants disagree on the first and 49 on
	 * the second, against `cleave`'s 61.
	 *
	 * `uncounted.json` is the control and it earns its place in the coinciding half honestly: 63 hits on
	 * 14 separate `Living Corruption` spawns, a pull with plenty of fan-out — and **zero** Rushing Jade
	 * Wind presses, so the exclusion has nothing to take and the two series are identical point for point.
	 * That is the pairing the synthetic fixture at the top of this file was built to fake, arriving off a
	 * real log.
	 *
	 * The five opening disagreements are quoted in full so "they differ" is a number rather than a
	 * boolean. They are facts about five logs and will move if those logs are re-captured; that is a
	 * finding to re-read, not a regression — and it is the read the old docstring predicted and never got
	 * to make, because it was watching the wrong five files.
	 */
	it('disagrees on five of the ten and coincides on five, which is what makes the invariant a claim', () => {
		expect(WW_SPEC.aplTargetCountExclude).toEqual(['rushing-jade-wind']);
		const differ = NAMES.filter((name) => disagreements(pull(name)).length > 0);
		expect(differ).toEqual(DIVERGENT);
		for (const name of NAMES.filter((n) => !differ.includes(n))) {
			const targets = pull(name).targets;
			expect(targets?.aplCounts?.points, name).toEqual(targets?.counts.points);
		}
		// `[t, evidence, ladder]` at the first instant the two readings part company on each pull.
		expect(disagreements(pull('cleave.json'))[0], 'cleave').toEqual([2475, 4, 0]);
		expect(disagreements(pull('strong.json'))[0], 'strong').toEqual([12_492, 5, 1]);
		expect(disagreements(pull('waves.json'))[0], 'waves').toEqual([6903, 5, 4]);
		expect(disagreements(pull('idle.json'))[0], 'idle').toEqual([32_851, 2, 1]);
		expect(disagreements(pull('sections.json'))[0], 'sections').toEqual([9329, 5, 3]);
	});

	/**
	 * `bandsInPull`'s own claim, now checkable on pulls where it could fail.
	 *
	 * Its docblock rests on "it costs no exemption on anything in the tree", and until the re-capture that
	 * was a statement about fixtures on which the two series were the same array — true, and empty. It is
	 * neither now: five of the ten hand the two readings genuinely different numbers and still resolve to
	 * the same band set, because `bandOf` floors at 1 and both series reach 4 on each of them. So this is
	 * a fact about five real pulls rather than a tautology, and it is the assertion that would go red the
	 * day a divergence is deep enough to cost a band — at which point the swap stops being free and
	 * `bandsInPull`'s argument needs re-reading rather than its result being trusted.
	 *
	 * It survived the two Windwalker pulls that press the wind for real, which is the first time the claim
	 * was asked of a divergence off a raw log. `sections` reaches 7 on the evidence series and 6 on the
	 * ladder's, `idle` reaches 11 and 6 — the widest gap in the tree — and both still band identically,
	 * because `bandOf` caps at 4 and both readings clear it.
	 */
	it('answers the same band set under either reading, on all ten', () => {
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
	 * Non-vacuous exactly where it matters: on the five divergent pulls the same derivation off the
	 * *ladder's* series gives a different answer, so this cannot pass by the two series being one. The
	 * gap is 88.3% → 74.6% on `cleave`, 13.1% → 11.8% on `strong`, 73.0% → 68.2% on `waves`, 66.6% →
	 * 62.3% on `sections` and 37.6% → 34.5% on `idle`.
	 *
	 * **It still moves no mode, and `idle.json` is the pull that shows how little room is left.** All five
	 * land the same side of the Windwalker's 33% threshold — but the four before it clear it by 30 points
	 * or miss it by 20, where `idle`'s ladder reading is **1.5 points** above the line against the
	 * evidence reading's 4.6. That is the same latency the old note called latent rather than live, with a
	 * real number under it for the first time: one more wind-covered add wave on a pull like this one and
	 * the two series answer different whole-pull modes. This is the assertion that would say so.
	 */
	it('keeps the published mode share on the evidence series, which the ladder’s would now move', () => {
		for (const name of NAMES) {
			const analysis = pull(name);
			const targets = analysis.targets!;
			expect(unionMs(intervalsAtLeast(targets.counts.points, 2, analysis.durationMs)), name).toBe(
				targets.multiTargetMs,
			);
			expect(shareOf(targets.counts.points, analysis.durationMs), name).toBeCloseTo(targets.multiTargetPct, 10);
		}
		for (const name of DIVERGENT) {
			const analysis = pull(name);
			expect(shareOf(analysis.targets!.aplCounts!.points, analysis.durationMs), name).not.toBeCloseTo(
				analysis.targets!.multiTargetPct,
				1,
			);
		}
		// The five gaps, so the sentence above is executed rather than asserted in prose.
		expect(shareOf(pull('cleave.json').targets!.aplCounts!.points, pull('cleave.json').durationMs)).toBeCloseTo(
			74.62,
			1,
		);
		expect(shareOf(pull('strong.json').targets!.aplCounts!.points, pull('strong.json').durationMs)).toBeCloseTo(
			// 11.75 before the 2026-08-25 re-capture, and the gap against the evidence series widened with
			// it rather than closing: 12.21 there against 10.82 here.
			10.82,
			1,
		);
		expect(shareOf(pull('waves.json').targets!.aplCounts!.points, pull('waves.json').durationMs)).toBeCloseTo(68.2, 1);
		expect(shareOf(pull('sections.json').targets!.aplCounts!.points, pull('sections.json').durationMs)).toBeCloseTo(
			62.3,
			1,
		);
		expect(shareOf(pull('idle.json').targets!.aplCounts!.points, pull('idle.json').durationMs)).toBeCloseTo(34.49, 1);
		// And none of the five crosses the threshold, so no published mode is one series away from moving.
		for (const name of DIVERGENT) {
			const analysis = pull(name);
			const threshold = analysis.targets!.thresholdPct;
			expect(shareOf(analysis.targets!.aplCounts!.points, analysis.durationMs) >= threshold, name).toBe(
				analysis.targets!.multiTargetPct >= threshold,
			);
		}
	});
});

/**
 * The same two series on the Protection Paladin, which is the second spec in the tree to separate them.
 *
 * **Until `aplTargetCountExclude` was declared on `PROTECTION_SPEC`, `aplCounts` was `counts`** — the
 * same numbers under two names, because the spec had never named any area damage of its own and
 * `analyseCore` therefore had nothing to filter out. The block above says in as many words that four
 * Elemental pulls are held elsewhere *because* that spec declares no exclusion and its two series are
 * one array by construction; this spec has stopped being that case, so it is held here.
 *
 * ## What the exclusion is, and the one button it deliberately leaves in
 *
 * Consecration and Light's Hammer are laid on the ground and tick on whatever stands in them. The press
 * chooses a patch of floor and not a body, so the number of things it reaches is a fact about where the
 * raid happened to be standing — the structural twin of Rushing Jade Wind, whose exclusion the block
 * above is built on. Hammer of the Righteous is not that: its cleave reaches the enemies beside a target
 * the *player* aimed at, and a fan-out the player aimed is the evidence a rung question wants.
 *
 * That last decision is priced rather than assumed, in `hammerOfTheRighteous` below. It is not free —
 * adding it would take `spoils`' ladder share down another 7.3 points and its peak from 11 to 9 — which
 * is the point of pinning it: the button stays in because of what it is, not because it is cheap.
 *
 * ## What moves, and what deliberately does not
 *
 * Consecration's ticks (81297) are the largest single event source a Protection Paladin produces — 719,
 * 544, 500, 352 and 153 damage events across the five captures, first by a wide margin on every one of
 * them — so this is the largest correction of its kind in the tree. The ladder's multi-target share
 * falls on all five, by 39.8 points on `paragons` and 18.4 on `galakras`.
 *
 * **The reader's own figure does not move at all.** `multiTargetPct` and `detected` are taken off the
 * evidence series, and all five pulls read exactly what they read before. That is the split working
 * rather than a limitation of it, and the last test in this block is what executes the claim.
 */
describe('the two series on every committed Protection pull', () => {
	const RAW = rawFixtures('protection');
	const SETTINGS = defaultSettings(PROTECTION_SETTINGS);

	/**
	 * One analysis per pull per exclusion list, memoised.
	 *
	 * Four readings of five pulls is twenty passes over a few megabytes of events, and three of the four
	 * are counterfactuals — a spec config that differs from the shipped one in exactly one field, which is
	 * the same matched-pair method the synthetic pulls at the head of this file use. Spread onto
	 * `PROTECTION_SPEC` rather than rebuilt, so nothing else about the spec can drift between the arms.
	 */
	const analysed = new Map<string, Analysis>();
	const pull = (name: string, exclude: readonly string[] = PROTECTION_SPEC.aplTargetCountExclude ?? []): Analysis => {
		const key = `${name}|${exclude.join(',')}`;
		const memo = analysed.get(key);
		if (memo !== undefined) return memo;
		const raw = RAW.find((fixture) => fixture.name === name);
		if (raw === undefined) throw new Error(`no Protection fixture named ${name}`);
		const analysis = analyseCore(raw.dataset, SETTINGS, { ...PROTECTION_SPEC, aplTargetCountExclude: exclude });
		analysed.set(key, analysis);
		return analysis;
	};

	/** The ladder's multi-target share, rebuilt from the array the chart draws rather than read off a field. */
	const ladderShare = (analysis: Analysis): number => shareOf(analysis.targets!.aplCounts!.points, analysis.durationMs);

	const NAMES = RAW.map(({ name }) => name);

	it('sweeps every Protection pull the tree holds, found rather than listed', () => {
		// Five raw datasets and no captures: this spec's harness writes `analyse()`'s input, where the
		// Windwalker's writes its output. `readFixtures` throws on a file that is neither, so an empty
		// captured half here is a fact rather than a silent miss.
		expect(NAMES).toEqual(['fallenProtectors.json', 'galakras.json', 'garrosh.json', 'paragons.json', 'spoils.json']);
		expect(capturedAnalyses('protection')).toEqual([]);
	});

	it('declares the two ground effects and nothing else', () => {
		expect(PROTECTION_SPEC.aplTargetCountExclude).toEqual(['consecration', 'lights-hammer']);
	});

	/**
	 * The invariant the block above states for the Windwalker, asked of this spec's five.
	 *
	 * `aplTargetHits` is `multiTargetHits.filter(notOwnAreaDamage)` and `targetCounts` is monotone in its
	 * input, so the ladder can never see an enemy the evidence did not. It survives any edit to either
	 * exclusion list, which is what makes it worth more than the figures below.
	 */
	for (const name of NAMES) {
		it(`never counts an enemy the evidence series did not, on ${name}`, { timeout: 120_000 }, () => {
			const targets = pull(name).targets;
			expect(targets?.counts.points.length, name).toBeGreaterThan(0);
			expect(targets?.aplCounts?.points.length, name).toBeGreaterThan(0);
			expect(
				readingsOf(targets!).filter(([, evidence, ladder]) => ladder > evidence),
				name,
			).toEqual([]);
			expect(targets?.aplCounts?.max, name).toBeLessThanOrEqual(targets!.counts.max);
		});
	}

	/**
	 * All five genuinely part company, and the counterfactual is what says the divergence is the
	 * exclusion's doing rather than an accident of the walk.
	 *
	 * With the list emptied the two arrays are equal point for point on every pull — the state this spec
	 * shipped in — so the second half of each pair is the whole of the change.
	 */
	it('coincides on all five with the list emptied and on none of them with it declared', () => {
		for (const name of NAMES) {
			const off = pull(name, []);
			expect(off.targets?.aplCounts?.points, `${name} with nothing excluded`).toEqual(off.targets?.counts.points);
			expect(readingsOf(pull(name).targets!).filter(([, e, l]) => e !== l).length, name).toBeGreaterThan(0);
		}
		// `[t, evidence, ladder]` at the first instant the two readings part company on each pull.
		expect(firstDisagreement(pull('fallenProtectors.json')), 'fallenProtectors').toEqual([11_621, 3, 2]);
		expect(firstDisagreement(pull('galakras.json')), 'galakras').toEqual([126_152, 1, 0]);
		expect(firstDisagreement(pull('garrosh.json')), 'garrosh').toEqual([11_429, 7, 1]);
		expect(firstDisagreement(pull('paragons.json')), 'paragons').toEqual([14_280, 3, 2]);
		expect(firstDisagreement(pull('spoils.json')), 'spoils').toEqual([12_446, 3, 2]);
	});

	/**
	 * The Consecration measurement, pinned pull by pull — the reason the exclusion was written.
	 *
	 * Three arms per pull: nothing excluded, Consecration alone, and the shipped pair. Light's Hammer was
	 * talented on two of the five and moves only those two, which is why it is worth a column of its own
	 * rather than being folded into the first number — it is declared because it is the same *kind* of
	 * button as Consecration, not because of what it is worth here.
	 */
	it('takes the ladder’s share down on all five, and Consecration is nearly all of it', () => {
		const arms = (name: string) => ({
			none: ladderShare(pull(name, [])),
			consecration: ladderShare(pull(name, ['consecration'])),
			both: ladderShare(pull(name)),
			peak: [pull(name, []).targets!.aplCounts!.max, pull(name).targets!.aplCounts!.max],
		});

		const fallen = arms('fallenProtectors.json');
		expect(fallen.none).toBeCloseTo(99.9002, 3);
		expect(fallen.consecration).toBeCloseTo(96.7774, 3);
		expect(fallen.both).toBeCloseTo(95.7901, 3);
		expect(fallen.peak).toEqual([8, 7]);

		const galakras = arms('galakras.json');
		expect(galakras.none).toBeCloseTo(52.5887, 3);
		// Light's Hammer was not talented on this pull, nor on the two below it, so the second and third
		// arms are the same number three times over. Stated rather than skipped: a column that is equal on
		// three of five is what tells a reader which of the two buttons is carrying the change.
		expect(galakras.consecration).toBeCloseTo(34.1988, 3);
		expect(galakras.both).toBeCloseTo(34.1988, 3);
		expect(galakras.peak).toEqual([5, 4]);

		const garrosh = arms('garrosh.json');
		expect(garrosh.none).toBeCloseTo(15.7883, 3);
		expect(garrosh.consecration).toBeCloseTo(8.7573, 3);
		expect(garrosh.both).toBeCloseTo(8.7573, 3);
		expect(garrosh.peak).toEqual([8, 7]);

		const paragons = arms('paragons.json');
		expect(paragons.none).toBeCloseTo(82.7353, 3);
		expect(paragons.consecration).toBeCloseTo(42.9313, 3);
		expect(paragons.both).toBeCloseTo(42.9313, 3);
		expect(paragons.peak).toEqual([4, 3]);

		const spoils = arms('spoils.json');
		expect(spoils.none).toBeCloseTo(88.1298, 3);
		expect(spoils.consecration).toBeCloseTo(84.6753, 3);
		expect(spoils.both).toBeCloseTo(83.4867, 3);
		expect(spoils.peak).toEqual([15, 11]);
	});

	/**
	 * Why Hammer of the Righteous is **not** on the list, with the price of leaving it off written down.
	 *
	 * A cleave the player aimed is evidence about the pull; a patch of ground is evidence about where the
	 * raid stood. That is the whole argument, and it is an argument about the button rather than about the
	 * number — so the number is pinned here to stop the next reader assuming the button was left in
	 * because it made no difference. On the pull that cleaves hardest it is worth 7.3 points and two
	 * enemies of peak.
	 */
	it('would take another 7.3 points off spoils if the aimed cleave were excluded too', () => {
		const withCleave = (name: string) => pull(name, ['consecration', 'lights-hammer', 'hammer-of-the-righteous']);
		expect(ladderShare(withCleave('spoils.json'))).toBeCloseTo(76.1723, 3);
		expect(withCleave('spoils.json').targets!.aplCounts!.max).toBe(9);
		expect(ladderShare(withCleave('fallenProtectors.json'))).toBeCloseTo(94.8855, 3);
		expect(ladderShare(withCleave('garrosh.json'))).toBeCloseTo(7.8306, 3);
		// And on the two pulls whose fan-out is all adds and no cleave, it is worth nothing at all.
		expect(ladderShare(withCleave('galakras.json'))).toBeCloseTo(34.1988, 3);
		expect(ladderShare(withCleave('paragons.json'))).toBeCloseTo(42.9313, 3);
	});

	/**
	 * The half the split exists to protect: the published figures stay on the evidence series.
	 *
	 * `multiTargetPct` and `detected` are what the target-count section prints and what the whole-pull
	 * mode is derived from, and `analyseCore` takes both halves of that ratio off `targetPoints`. So the
	 * exclusion may not move any of them, and on four of the five it would move them a long way — the
	 * ladder's reading of `paragons` is 39.8 points below the published one.
	 *
	 * **One of the five would change mode outright.** `paragons` reads 82.7% against a 33% threshold and
	 * stays `multi` either way, but `galakras` at 52.6% would fall to 34.2% — still above the line by 1.2
	 * points, which is the narrowest margin in the tree and the reason this is asserted rather than
	 * assumed.
	 */
	it('keeps the published share and mode on the evidence series', () => {
		for (const name of NAMES) {
			const analysis = pull(name);
			const off = pull(name, []);
			expect(analysis.targets!.multiTargetPct, name).toBe(off.targets!.multiTargetPct);
			expect(analysis.targets!.detected, name).toBe(off.targets!.detected);
			expect(shareOf(analysis.targets!.counts.points, analysis.durationMs), name).toBeCloseTo(
				analysis.targets!.multiTargetPct,
				10,
			);
		}
		expect(NAMES.map((name) => pull(name).targets!.detected)).toEqual(['multi', 'multi', 'single', 'multi', 'multi']);
		// Every one of the five is a genuine divergence at the published figure, so none of the assertions
		// above can be passing by the two series being one array.
		for (const name of NAMES) {
			expect(ladderShare(pull(name)), name).not.toBeCloseTo(pull(name).targets!.multiTargetPct, 1);
		}
	});

	/**
	 * What it costs a reader who opens the target-mode control, which is the one visible consequence.
	 *
	 * `bandsInPull` reads `aplCounts`, so the positions the control offers are the rungs the *ladder* was
	 * handed. On four of the five pulls the set is unchanged; on `paragons` it goes from `[1, 2, 3, 4]` to
	 * `[1, 2, 3]`, because the ladder never sees a fourth enemy once the ground is out of the count. That
	 * is the exclusion doing exactly what it is for — the pull had four bodies in it and the player's own
	 * area damage is what found the fourth.
	 *
	 * Nothing is graded differently by it. This spec's `score.ts` declares no `bands` on either threshold,
	 * so no metric is scoped by this set today; the assertion is here because the day one is, `paragons`
	 * is the pull that will show it.
	 */
	it('narrows the bands paragons visited, and leaves the other four alone', () => {
		expect(bandsInPull(pull('paragons.json').targets)).toEqual([1, 2, 3]);
		expect(bandsInPull(pull('paragons.json', []).targets)).toEqual([1, 2, 3, 4]);
		for (const name of NAMES.filter((n) => n !== 'paragons.json')) {
			expect(bandsInPull(pull(name).targets), name).toEqual([1, 2, 3, 4]);
			expect(bandsInPull(pull(name, []).targets), name).toEqual([1, 2, 3, 4]);
		}
	});
});
