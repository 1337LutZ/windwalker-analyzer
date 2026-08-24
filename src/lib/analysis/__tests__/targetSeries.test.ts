// The two target-count series, and which question each one answers.
//
// `analyseCore` builds a live count of "how many enemies was the player damaging" twice:
//
//   - `targetPoints`    — every landed hit. The **evidence** series.
//   - `aplTargetPoints` — the same hits less the spec's own area damage, per `aplTargetCountExclude`.
//     The **ladder's** series.
//
// Four things read the first (`multiTargetWindows`, the contact clock, the detected mode, and the
// published `targets.counts`) and two read the second (`aplTargetCountAt`, which bands every rung of
// the priority list, and `aoeWindows`, which is what the Elemental's graded clocks are cut with). An
// audit found the split and nothing saying why.
//
// **When this file was written, no committed fixture could tell the two series apart. That is no longer
// true, and the sentence that used to stand here is retracted rather than quietly edited.** The three
// facts it rested on all still hold: only the Windwalker declares an exclusion; the one Windwalker
// fixture the engine runs from raw events (`__fixtures__/dataset-ironJuggernaut.json`) is a single-target
// pull containing zero Rushing Jade Wind damage, so the two series are byte-identical on it; and every
// Elemental fixture is on a spec that declares no exclusion at all, which makes them identical by
// construction. What changed is the population. The 2026-08-24 re-capture wrote `targets.aplCounts` into
// the six captured Windwalker pulls, and on three of them — `cleave`, `strong` and `waves` — the two
// series carry different numbers at the same instant. `cleave` opens the divergence 2 475ms in, where the
// target-count section draws four enemies and the ladder was handed none.
//
// So separating the series is no longer this file's alone, and the guard that holds one against the other
// on every committed pull is the second block of `targetSeries.aplBands.test.ts`. What is still this
// file's alone is the **matched pair**: no real pull arrives with a copy of itself differing in exactly
// one token, so nothing but the fixture below can show that the *exclusion* — and not the add, the wave
// shape or the window — is what moved the figure.
//
// The fixture is a synthetic Windwalker pull whose **only** fan-out is the wind. It is deliberately built as a matched pair that differs in exactly one token — the ability
// id on the area damage — so that "the exclusion did this" is demonstrated rather than asserted. Every
// figure below is different between the two series on the wind pull and identical on the control.
//
// What this file is for is the *next* reader, the one who notices two series where one would do. Reading
// either series into the other's consumers is what it fails on, and the failure text names the figure
// that moved.
//
// The rule the split follows: a question about **which rung of the priority list applied** reads the
// ladder's series, and a question about **whether there was an enemy there** reads the evidence one.
//
// When this file was written, two live consumers broke that rule and could not be fixed from here,
// because nothing on `Analysis` carried the ladder's series. **Both are fixed now** — `TargetSummary`
// gained `aplCounts`, and `view/targetMode`'s `bandsInPull` and the Windwalker's `tigerPalmShare` read
// it. `targetSeries.aplBands.test.ts` holds that fixture and the per-fixture coincidence check, and it
// is where a band question belongs; this file stays the one that separates the two series at all.
//
// The measurement that closed it is worth keeping, because it is the one this file could not make:
// read off the evidence series, a Tiger Palm pressed while the wind was fanning left the sample
// **entirely**, numerator and denominator, so a pull with three wasted presses scored **0% and `good`**
// where the ladder's series scores **50% and `bad`**. The direction was excusing, which is the
// direction that matters.
import { describe, expect, it } from 'vitest';

import type { FightDataset, WclEvent } from '~/lib/types';
import { analyseCore, type Handles, type SpecConfig } from '~/lib/analysis/analyseCore';
import { defaultSettings } from '~/lib/settings/model';
import { WW_SETTINGS, WW_SPEC } from '~/specs/windwalker/lib';

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
const TEB_BANK = 1_247_279;

/** The wave runs 3s–30s at one hit a second, so a `>= 2` stretch has room to be longer than a window. */
const WAVE_FROM = 3000;
const WAVE_TO = 30_000;

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
 * One pull whose only second target is reached by area damage, with the ability id as the parameter.
 *
 * The add takes **real** damage rather than an immune zero: `landedHits` drops a spawn that never took
 * any, so an immune add cannot separate the series — it is absent from both. That is why the mines in
 * `immuneTargets.test.ts` cannot do this job, and it is the trap to avoid in any later variant of this
 * fixture.
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
	// Three enemies, not two, and the third one is what makes `aoeWindows` reachable: that series is the
	// `>= 3` one, so a two-target pull cannot tell which count it was built from.
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
			// A single-target press before the wave, so both series have one-enemy time to be counted at.
			ev(1000, 'cast', RSK_CAST, { targetID: BOSS, ...bars(100, 2) }),
			ev(1000, 'damage', RSK_CAST, { targetID: BOSS, amount: 9000, hitType: 1, ...bars(100, 2) }),
			ev(2500, 'cast', RJW_CAST, bars(100, 3)),
			...wave,
			// And one after it, so the pull does not end inside the wave and the closing edge is measured
			// rather than clamped by the kill.
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
 * Both readings of one pull: what the report published, and what the ladder was handed.
 *
 * The APL series is on `Handles` and on nothing else — no field of `Analysis` carries it — so the only
 * honest way to read it is the way the ladder does, through the audit hook. Wrapping `WW_SPEC.audit`
 * rather than substituting a stub keeps this the *real* spec: an exclusion this spec stopped declaring
 * would show up here as the two series agreeing.
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

const ms = (windows: readonly (readonly [number, number])[]): number =>
	windows.reduce((total, [start, end]) => total + (end - start), 0);

describe('the pull whose extra targets are reached only by the spec’s own area damage', () => {
	const wind = both(RJW_DAMAGE, 'wind-only');

	/**
	 * The premise. If this fails, the fixture stopped separating the series and every assertion below is
	 * worthless whatever it says — which is the failure mode this project has already shipped once, a
	 * test whose two sides came off one value.
	 *
	 * **Zero, not one, mid-wave**, and that is the measurement rather than a rounding of it: the wave is
	 * nothing but wind damage, so once the opening Rising Sun Kick has aged out of the trailing window
	 * the ladder's series has no hits in it at all. `bandOf(0)` is 1, so the ladder spends the wave in
	 * its single-target branch — which is the exclusion working as declared, not failing.
	 */
	it('is read as three enemies by the evidence series and as none by the ladder’s', () => {
		expect(wind.analysis.targets?.counts.max).toBe(3);
		// At the wind press itself the Rising Sun Kick 1.5s earlier is still in the window, so the ladder
		// has its one enemy — the boss, and only ever the boss.
		expect(wind.handles.aplTargetCountAt(2500)).toBe(1);
		// Sampled inside the wave. `aplTargetCountAt` is the function every rung of the ladder bands on.
		expect(wind.handles.aplTargetCountAt(15_000)).toBe(0);
		// And the published series — what the report's target-count section draws — says three.
		const published = wind.analysis.targets?.counts.points ?? [];
		const at15s = [...published].reverse().find(([t]) => t <= 15_000);
		expect(at15s?.[1]).toBe(3);
	});

	/**
	 * `multiTargetWindows` is the evidence series' `>= 2`, and this is the number that would vanish.
	 *
	 * 32 000ms rather than the wave's 27 000ms because `targetCounts` is a trailing five-second window:
	 * the count reaches two on the first hit on the add and falls one window after the last.
	 */
	it('gives the second-target evidence a stretch to be measured over', () => {
		expect(ms(wind.handles.multiTargetWindows)).toBe(32_000);
		expect(wind.handles.multiTargetWindows).toHaveLength(1);
		expect(wind.analysis.targets?.multiTargetMs).toBe(32_000);
		// Which is what makes the pull multi-target at all. The Windwalker's threshold is 33%.
		expect(wind.analysis.targets?.detected).toBe('multi');
	});

	/**
	 * The contact clock, and the reason it is the half of the ratio worth pinning.
	 *
	 * 39 000ms: one window from the 1s Rising Sun Kick, the wave, and one window from the 40s press. The
	 * ladder's series sees only the two Rising Sun Kicks, so it would call this 10 000ms.
	 *
	 * `multiTargetPct` is `multiTargetMs / contactMs` and both halves are asserted here, off one series.
	 * Read the APL series into this half alone — the tempting edit, because an exclusion is easiest to
	 * argue for on a denominator — and it is 32 000 over 10 000: 320%. A share of a clock larger than
	 * the clock, which is what a half-moved ratio produces.
	 */
	it('measures the mode share with both halves of the ratio off one series', () => {
		expect(wind.handles.contactMs).toBe(39_000);
		expect(wind.handles.multiTargetMs).toBe(32_000);
		expect(wind.analysis.targets?.multiTargetPct).toBeCloseTo(82.05, 2);
		// Not a clamp: the figure is a real share, so it cannot exceed 100 unless the halves disagree.
		expect(wind.analysis.targets?.multiTargetPct).toBeLessThanOrEqual(100);
	});

	/**
	 * `aoeWindows`, the series' other consumer, and the assertion the committed suite could not make.
	 *
	 * This is the `>= 3` series and the only thing in the engine that reads the *ladder's* count over a
	 * span rather than at an instant. It is empty here, and that is the exclusion working: the ladder
	 * never saw a third enemy, so the aoe branch of the priority list never applied, so there is no
	 * stretch for a graded clock to be cut with.
	 *
	 * Worth stating that this assertion had no equivalent before this file. Swapping `aoeWindows` onto
	 * `targetPoints` at `4b63f99` leaves the whole suite green at 2262 passed — the Elemental declares no
	 * exclusion, so on every committed fixture the two series are the same array, and the Windwalker
	 * (which does declare one) never reads `aoeWindows` at all. The choice was argued in a docblock and
	 * checked by nothing.
	 */
	it('leaves the aoe stretches empty, because the ladder never reached three', () => {
		expect(wind.handles.aoeWindows).toEqual([]);
		// Not vacuous: the same instants under an ability the exclusion does not name do produce one.
		expect(both(SCK_DAMAGE, 'aoe-control').handles.aoeWindows).not.toEqual([]);
	});

	/**
	 * The control, and the half that makes the pair a measurement.
	 *
	 * Identical events at identical instants under an ability the exclusion does not name: every figure
	 * above is unchanged, and the ladder now agrees with the report. So the divergence on the wind pull
	 * is the exclusion's doing and nothing else's — not the add, not the wave shape, not the window.
	 */
	it('agrees with the ladder when the fan-out is an ability the exclusion does not name', () => {
		const control = both(SCK_DAMAGE, 'control');
		expect(control.analysis.targets?.counts.max).toBe(3);
		expect(control.handles.aplTargetCountAt(15_000)).toBe(3);
		expect(ms(control.handles.multiTargetWindows)).toBe(32_000);
		expect(control.handles.contactMs).toBe(39_000);
		// The whole published series, not a sample of it: the two pulls are the same report except for
		// what the ladder was told, which is the claim in one line.
		expect(control.analysis.targets?.counts.points).toEqual(wind.analysis.targets?.counts.points);
	});
});
