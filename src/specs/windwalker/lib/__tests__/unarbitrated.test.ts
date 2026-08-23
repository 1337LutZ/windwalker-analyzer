// The two buttons this ladder hands to another section, and the four it still charges to a rung.
//
// All six are pressed on this pull now. Touch of Death was the one press missing, and it was missing for
// a stated reason that no longer holds: a synthetic press of it is the only evidence anywhere that it is
// charged at all — it is pressed in none of the six captured pulls and nowhere in the raw fixture either.
//
// `UNARBITRATED` in `../apl.ts` is a declaration, and a declaration on its own does nothing: the walk
// only reads it because `../index.ts` passes it to `aplAudit` as `AplInputs.unarbitrated`. Those are two
// edits in two files and the previous lane recorded exactly how they come apart —
// `analysis/__tests__/ladderCoverage.test.ts` reads the declaration and never the wiring, so a spec that
// published `UNARBITRATED` and forgot to pass it would sweep green while every press went on being
// faulted. This file is the other half. It runs `analyse` end to end and reads the verdicts off
// `analysis.apl`, so unwiring the input turns it red and leaves that sweep untouched.
//
// The Elemental's equivalent guard is a per-fixture `offList` column in
// `analysis/__tests__/fixtureCoverage.test.ts`, and it is not available here: that file re-analyses raw
// `FightDataset`s, and this spec's only raw fixture carries no `classResources` at all — so its audit is
// `null` by the bars gate and its row on that grid is `null` too. The six pulls under `__fixtures__` are
// captured `Analysis` output, which means their `apl` block is frozen at whatever the engine said the day
// they were written and no code change can move it. Hence a synthetic pull, built to reach the one thing
// a real fixture cannot show either way.
//
// ## What is actually being distinguished
//
// `off-list` has two arms and they mean opposite things, which is why every assertion below reads
// `reason` and not just `verdict`:
//
//   reason: a section id   the list does not arbitrate this button, and that section does
//   reason: null           the list arbitrated it and wanted none of it — the walk's fall-through
//
// This ladder reaches the second arm on its own, unlike the Elemental's: its rungs cost energy and chi,
// so a press off an empty bar falls past every one of them. Both arms therefore have to appear on the
// same pull for the test to be about the difference rather than about the column, and the Blackout Kick
// at the end is there to produce the second one.
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import type { AplPress } from '~/lib/spec/apl';
import type { FightDataset } from '~/lib/types';
import { analyse } from '../index';
import { UNARBITRATED } from '../apl';

const T0 = 1_000_000;
const END = T0 + 120_000;
const ME = 5;
const BOSS = 20;

const TIGER_POWER = 125_359;
const SEF = 137_639;
const KARMA = 122_470;
const LEG_SWEEP = 119_381;
const EXPEL_HARM = 115_072;
const SERPENT_KICK = 101_545;
const RISING_SUN_KICK = 107_428;
const BLACKOUT_KICK = 100_784;
const TOUCH_OF_DEATH = 115_080;

/**
 * Energy and chi as the log staples them on, so the audit has bars to walk.
 *
 * `3` and `12` are WarcraftLogs' own power types and not the simulator's — see `WCL_POWER_TYPE` in
 * `analysis/energy.ts`, where the two numberings and the absence of a rule joining them are argued. The
 * sim's values (2 and 14) sample nothing, and sampling nothing here reads as a pull with no bars, which
 * the audit answers with `null` rather than with a failure.
 */
const bars = (energy: number, chi: number) => ({
	resourceActor: 1,
	classResources: [
		{ type: 3, amount: energy, max: 100 },
		{ type: 12, amount: chi, max: 4 },
	],
});

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent =>
	({
		timestamp: T0 + t,
		type,
		abilityGameID: id,
		sourceID: ME,
		targetID: BOSS,
		...extra,
	}) as WclEvent;

/**
 * Twenty-five readings a second apart, climbing ten a second and resetting every eight.
 *
 * `regenPerSecond` needs twenty usable spans before it will name a rate, and the rate is not decoration:
 * with it unknown `timeToEnergyCapSec` is null, the Fists of Fury rung answers `unknown`, and the walk
 * short-circuits there instead of reaching the rungs this test is about. Every reading is below the
 * ceiling, because one at the cap abandons the span it opens — which is what the reset is for rather than
 * a bar that really behaves this way. It measures 10 a second, which is the point of it.
 */
const regenSamples: WclEvent[] = Array.from({ length: 25 }, (_, i) =>
	e(30_000 + i * 1000, 'damage', 1, { amount: 100, ...bars(10 + (i % 8) * 10, 1) }),
);

const events: WclEvent[] = [
	// Up for the whole pull, so the Tiger Palm refresh rung reads a clock rather than answering `unknown`
	// and poisoning every press below it.
	e(0, 'applybuff', TIGER_POWER, { targetID: ME }),
	// The Tigereye Brew bank, which is what `WW_SPEC.identify` looks for. Nothing below reads it; without
	// it the core reports `isSpec: false` for a pull that is plainly a Windwalker's.
	e(0, 'applybuff', 1_247_279, { targetID: ME }),
	e(1000, 'applybuffstack', 1_247_279, { targetID: ME, stack: 5 }),
	e(500, 'damage', RISING_SUN_KICK, { amount: 5000, ...bars(60, 3) }),
	...regenSamples,
	// One press each of the two declared buttons and of three of the four that stay faults. The fourth is
	// Touch of Death, and it is pressed at the very end of the pull rather than here — see below.
	e(60_000, 'cast', SEF, bars(80, 3)),
	e(62_000, 'cast', KARMA, bars(80, 3)),
	e(64_000, 'cast', LEG_SWEEP, bars(80, 3)),
	e(66_000, 'cast', EXPEL_HARM, bars(80, 3)),
	e(68_000, 'cast', SERPENT_KICK, bars(80, 3)),
	// The fall-through. Rising Sun Kick goes on its eight-second cooldown, and two seconds later a
	// Blackout Kick is pressed on one chi and an empty bar — which every rung above it either cannot be
	// paid for or does not want, so the walk runs off the bottom of the ladder. `reason: null`.
	e(80_000, 'cast', RISING_SUN_KICK, bars(0, 3)),
	e(82_000, 'cast', BLACKOUT_KICK, bars(0, 1)),
	e(100_000, 'damage', RISING_SUN_KICK, { amount: 5000, ...bars(40, 2) }),
	/**
	 * Touch of Death, 500ms before the pull ends, on three chi and a full bar.
	 *
	 * The fourth button that stays a fault, and the only one of the four whose press has to be *placed*
	 * rather than merely made: it is the one entry that is a gap in the ladder rather than a button off
	 * it, so the press worth pinning is one the sim's list actually wanted. Priority 3's `spellCanCast`
	 * resolves to `(hasGlyph || GetChi() >= 3) && GetRemainingDuration() <= 1s` in
	 * `sim/monk/touch_of_death.go:40-42`, and this press satisfies both halves — three chi, and 500ms of
	 * the 120-second pull left. So the verdict below is not a press the list had no use for being charged
	 * for a global; it is the press the list asked for, charged as a priority mistake, which is the fault
	 * `apl.ts` keeps on purpose and states its reasons for at length.
	 *
	 * `bars(100, 3)` and not the 80 the earlier presses carry: the reading at 100_000 is 40 energy and the
	 * pull's measured regen is 10 a second, so 19.5 seconds later the bar is at the cap. A reading that
	 * contradicted the rate would be a second, quieter change to this pull — `regenPerSecond` is measured
	 * across the whole log, and a pair of off-rate samples added here once dragged it far enough to flip
	 * the Fists of Fury rung and take the Blackout Kick fall-through below with it.
	 */
	e(119_500, 'cast', TOUCH_OF_DEATH, bars(100, 3)),
];

const dataset: FightDataset = {
	code: 'unarb1',
	fight: {
		id: 1,
		name: 'Galakras',
		encounterID: 1622,
		kill: true,
		difficulty: 4,
		size: 10,
		startTime: T0,
		endTime: END,
	},
	actor: { id: ME, name: 'Bigdogmo', type: 'Player' },
	actors: [
		{ id: ME, name: 'Bigdogmo', type: 'Player' },
		{ id: BOSS, name: 'Galakras', type: 'NPC' },
	],
	events,
	table: {
		fight: {
			id: 1,
			name: 'Galakras',
			encounterID: 1622,
			kill: true,
			difficulty: 4,
			size: 10,
			startTime: T0,
			endTime: END,
			enemyNPCs: [{ id: BOSS, gameID: 72249 }],
		},
		damageDone: {
			entries: [
				{
					name: 'Bigdogmo',
					id: ME,
					type: 'Monk',
					itemLevel: 553,
					total: 10_000,
					activeTime: 100_000,
					abilities: [{ guid: RISING_SUN_KICK, name: 'Rising Sun Kick', total: 10_000 }],
				},
			],
		},
	},
};

const audit = analyse(dataset).apl;
const pressOf = (id: number): AplPress => {
	const found = audit?.presses.find((p) => p.pressed === id);
	if (found === undefined) throw new Error(`no press of ${id} in the audit — the synthetic pull changed shape`);
	return found;
};

describe('the buttons the Windwalker ladder does not arbitrate', () => {
	// Not a formality. Everything below reads `analysis.apl`, and this spec does not pass
	// `barsRequired: false` — so a pull whose bars the audit cannot read comes back `null` and every
	// assertion after this one would be skipped by an optional chain rather than failed.
	it('audits at all, so the verdicts below are real', () => {
		expect(audit).not.toBeNull();
		expect(audit?.presses.length).toBeGreaterThan(0);
	});

	it('hands a Storm, Earth and Fire press to the section that judges it', () => {
		const press = pressOf(SEF);
		expect(press.verdict).toBe('off-list');
		expect(press.wanted).toBeNull();
		expect(press.reason).toBe('sef');
	});

	it('hands a Touch of Karma press to the section that judges it', () => {
		const press = pressOf(KARMA);
		expect(press.verdict).toBe('off-list');
		expect(press.wanted).toBeNull();
		expect(press.reason).toBe('karma');
	});

	/**
	 * The other half of the claim, and the half that stops `off-list` being an amnesty.
	 *
	 * These three are on the GCD, are pressed on real pulls, and are in no part of the simulator's
	 * Windwalker list — so there is no rule to transcribe for them and no section or clock anywhere in
	 * this report that judges them either. A declaration would name nowhere. They stay charged to the rung
	 * the list would have spent the global on, which is the simulator's own answer to what it should have
	 * been, and `ladderCoverage.test.ts` carries the argument for each on its ledger.
	 */
	it('still charges the three buttons nothing else judges to a rung', () => {
		for (const id of [LEG_SWEEP, EXPEL_HARM, SERPENT_KICK]) {
			const press = pressOf(id);
			expect(press.verdict, `${id} verdict`).toBe('skipped');
			expect(press.wanted, `${id} wanted a rung`).not.toBeNull();
		}
	});

	/**
	 * The fourth charged button, and the one whose charge is a gap rather than a judgement.
	 *
	 * The other three are off the sim's Windwalker list altogether, so charging them to the rung the list
	 * would have spent the global on is the best answer available. This one is *priority 3 of that list*,
	 * and the press below is one the list positively wanted — three chi, 500ms of the pull left, both
	 * halves of `touch_of_death.go:40-42` satisfied. It is charged anyway, because the ladder has no rung
	 * for it, and `apl.ts` argues at length for why: the condition is expressible arithmetically
	 * (`state.pullMs - state.t`, and chi) but `GetRemainingDuration` is the sim's stand-in for execute
	 * range, and on a wipe the stand-in and the thing it stands for have nothing to do with each other.
	 *
	 * Both fields are asserted, and both are load-bearing in opposite directions. `skipped` rather than
	 * `off-list` is what stops the tidiest available fix — adding 115080 to `UNARBITRATED` — from landing
	 * silently: it would read as "not a rotational button" about the top press of the list this ladder
	 * transcribes, and there is no section anywhere in this report that judges Touch of Death to point at
	 * instead. `wanted` being a real rung is what stops the other fix, a rung of its own, from landing
	 * without the argument being reopened: with one, this press reads `followed` and names itself.
	 */
	it('charges the Touch of Death press the sim list asked for to a filler rung', () => {
		const press = pressOf(TOUCH_OF_DEATH);
		expect(press.verdict).toBe('skipped');
		expect(press.wanted).toBe('tiger-palm-refresh');
		expect(press.reason ?? null).toBeNull();
	});

	/**
	 * The fall-through, so the column is not the whole of what is being asserted above.
	 *
	 * A press this ladder really did arbitrate and wanted none of — one chi and an empty bar, so every
	 * rung above is either unwanted or unaffordable. Same verdict as the two declared presses, opposite
	 * meaning, and `reason` is the only field that says which.
	 */
	it('leaves the walk own fall-through unnamed', () => {
		const press = pressOf(BLACKOUT_KICK);
		expect(press.verdict).toBe('off-list');
		expect(press.wanted).toBeNull();
		expect(press.reason ?? null).toBeNull();
	});

	/**
	 * The declaration's own shape, checked here rather than only in the generic sweep.
	 *
	 * `ladderCoverage.test.ts` asserts that every declared id is an on-GCD button of this spec and that
	 * every value names something; what it cannot see from there is that the walk agreed. Two entries and
	 * two delegated presses on this pull, so a third entry appearing silently is a failure rather than a
	 * thing nothing notices.
	 */
	it('delegates exactly what the ladder declares and nothing else', () => {
		expect(Object.keys(UNARBITRATED).map(Number).sort()).toEqual([KARMA, SEF].sort((a, b) => a - b));
		const delegated = (audit?.presses ?? []).filter((p) => p.verdict === 'off-list' && p.reason !== null);
		expect(delegated.map((p) => p.pressed).sort((a, b) => a - b)).toEqual([KARMA, SEF].sort((a, b) => a - b));
	});
});
