// Rule 5 of the user's six (plan §80): the Primal Fire Elemental at 100% uptime during Bloodlust.
//
// **What the committed pulls can and cannot exercise, because §80 asked before the rule was built and
// the answer is not the one it guessed.** It guessed the rule might be *unmeasurable* here. It is
// measurable on all three — the talent is taken, the haste cooldown went out, and the share is a real
// ratio of two real spans — and it reads a flat **100.00%** on every one of them with no variance
// whatsoever. That is a different problem from unmeasurable and a worse one, because a metric that
// cannot separate two pulls still moves their grades: at weight 1 it took `phased` to exactly the 75%
// `good` line and `cleave` over the 45% one. The arithmetic is in `score.ts`' `WEIGHTS`; the weight is
// zero because of it.
//
// The flat reading is structural rather than three players getting it right. A Fire Elemental summoned
// before the bell owns the first minute of the pull, a raid lusts on the pull, and a minute contains
// forty seconds. So the fault side of this rule is carried on synthetic pulls below, every one of them
// a real fixture with named events moved or removed — never a threshold lowered until something fired.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import { resolveBands, type TargetModeChoice } from '~/lib/view/targetMode';
import type { Metric, MetricRule } from '~/lib/score';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '../index';
import { scoreAnalysis, THRESHOLDS, WEIGHTS, weightsFor } from '../score';

const FIXTURES = ['phased', 'unbroken', 'cleave'] as const;

const PRIMAL_ELEMENTALIST = 117_013;
const FIRE_ELEMENTAL_CAST = 2894;
/** The buff a summon applies — not the id it is cast under. See `firePrepull.test.ts`. */
const FIRE_ELEMENTAL_BUFF = 118_291;
/**
 * The haste-cooldown group, as one effect under five ids.
 *
 * The same list `lib/game/shared.ts` declares as the `bloodlust` aura, restated here because these
 * tests move and delete its events by id. Three of the five are live in the test set — Heroism on
 * `phased`, Bloodlust on `unbroken`, Time Warp on `cleave` — which is what makes "strip the haste
 * cooldown" a per-fixture operation rather than a per-spell one.
 */
const HASTE_IDS = new Set([2825, 32_182, 80_353, 90_355, 146_555]);

const load = (name: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;

const run = (dataset: FightDataset): Analysis & ElementalAuditResult =>
	analyse(dataset) as Analysis & ElementalAuditResult;

const fx = (name: string): Analysis & ElementalAuditResult => run(load(name));

/** The metric as a reader would see it on the card, at whichever reading the switch is on. */
const metricOn = (el: Analysis & ElementalAuditResult, choice: TargetModeChoice = 'auto'): Metric | undefined =>
	scoreAnalysis(el, resolveBands(el.targets, choice)).sections['fireElemental']?.metrics.find(
		(m) => m.key === 'fireElementalHasteUptime',
	);

/** A fixture with its events rewritten. Every synthetic below is one of these and nothing else. */
const edited = (name: string, rewrite: (events: WclEvent[], t0: number) => WclEvent[]): FightDataset => {
	const dataset = load(name);
	return { ...dataset, events: rewrite([...dataset.events], dataset.fight.startTime) };
};

/** The one on-pull haste window the rule grades over, read off the engine rather than written down. */
const hasteWindow = (el: Analysis & ElementalAuditResult) => el.timeline?.hasteWindows?.[0];

describe('what the committed pulls can say about rule 5', () => {
	/**
	 * The premise, per fixture, re-derived from the log rather than asserted: the talent is in the
	 * `combatantinfo` list, and there is a haste cooldown that opened on the pull.
	 *
	 * Both halves are the reason the metric grades at all, so a fixture recaptured from a shaman who took
	 * Unleashed Fury instead, or from a raid that lusted late, fails here rather than silently turning the
	 * rule into a refusal further down.
	 */
	it.each(FIXTURES)('%s took Primal Elementalist and was lusted on the pull', (name) => {
		const dataset = load(name);
		const info = dataset.events.find((e) => e.type === 'combatantinfo' && e.sourceID === dataset.actor.id);
		const talents = (info as { talents?: { id: number }[] } | undefined)?.talents;
		expect(talents, name).not.toBeUndefined();
		expect(
			talents?.map((t) => t.id),
			name,
		).toContain(PRIMAL_ELEMENTALIST);

		const el = run(dataset);
		// "On the pull" is `isOpener`, 5 250ms. All three are inside the first two seconds.
		expect(hasteWindow(el)?.start, name).toBeLessThan(5250);
	});

	/**
	 * The clock is that window's own length, and the covered figure fills it exactly.
	 *
	 * The expected numbers come off `timeline.hasteWindows` rather than being written out, so this pins
	 * the *relationship* — the graded clock is the haste cooldown, and the summon covered all of it —
	 * instead of three literals that would have to be renumbered whenever a fixture is recaptured. The
	 * literals are in the block below, where being literal is the point.
	 */
	it.each(FIXTURES)('%s grades over the haste cooldown and the summon covers all of it', (name) => {
		const el = fx(name);
		const window = hasteWindow(el);
		const lengthMs = window === undefined ? -1 : window.end - window.start;
		expect(el.fireElemental.hasteUptime.gradedMs, name).toBe(lengthMs);
		expect(el.fireElemental.hasteUptime.coveredMs, name).toBe(lengthMs);
		expect(metricOn(el), name).toMatchObject({ value: 100, grade: 'good', unmeasurable: false });
	});

	/**
	 * **The finding, as three literals: a flat 100.00% and forty seconds of clock on every pull.**
	 *
	 * Written out rather than derived, because what this test is for is the *absence of variance*. Three
	 * different haste spells, three different pre-pull expiries, three different pull lengths, and one
	 * number. §80 asked whether a fixture could exercise this rule; the answer is that all three can and
	 * none of them distinguishes anything, which is why the weight below is zero and why every fault case
	 * in this file is synthetic.
	 */
	it('reads the same 100.00% on all three, off three different haste spells', () => {
		const measured = FIXTURES.map((name) => {
			const el = fx(name);
			const window = hasteWindow(el);
			return {
				spell: window?.variant,
				gradedMs: el.fireElemental.hasteUptime.gradedMs,
				coveredMs: el.fireElemental.hasteUptime.coveredMs,
			};
		});
		expect(measured).toEqual([
			{ spell: 'Heroism', gradedMs: 40_008, coveredMs: 40_008 },
			{ spell: 'Bloodlust', gradedMs: 40_005, coveredMs: 40_005 },
			{ spell: 'Time Warp', gradedMs: 40_006, coveredMs: 40_006 },
		]);
	});

	/**
	 * And the price of that: nothing. Pinned as the three cards a reader sees, so raising the weight
	 * cannot be done without this going red and naming what it moved.
	 *
	 * **Red against a weight of 1**, measured rather than predicted: `phased` 73.08% of 13 becomes 75.00%
	 * of 14 and the headline goes `ok` to `good`; `cleave` 42.31% of 13 becomes 46.43% of 14 and goes
	 * `bad` to `ok`. Two of three headlines bought with a rule neither player could have failed.
	 */
	it('costs the three committed cards nothing, because it is weighted at zero', () => {
		const cards = FIXTURES.map((name) => {
			const el = fx(name);
			const card = scoreAnalysis(el, resolveBands(el.targets, 'auto'));
			// Not vacuous: the metric really is on the card and really is graded on all three.
			expect(metricOn(el), name).toMatchObject({ grade: 'good', unmeasurable: false });
			return { overall: card.overall, ...card.judged };
		});
		// The cards first and the weight second, deliberately: under a weight of 1 this is the assertion
		// that goes red, and its failure text names the headline that moved rather than a table entry.
		expect(cards).toEqual([
			{ overall: 'ok', measured: 13, total: 22, unmeasurable: false },
			{ overall: 'ok', measured: 13, total: 22, unmeasurable: false },
			{ overall: 'bad', measured: 13, total: 22, unmeasurable: false },
		]);
		expect(WEIGHTS.fireElementalHasteUptime).toBe(0);
	});
});

describe('the fault, on pulls built to commit it', () => {
	/**
	 * A summon that expired halfway through the lust — the plain failure, and the one a player can
	 * actually make by pre-pulling too early.
	 *
	 * `phased`'s elemental leaves one bare `removebuff` at 57 259ms and its Heroism runs 1 777 → 41 785.
	 * Moving the expiry to 20 000 leaves the pet standing for 18 223 of those 40 008ms — the expiry less
	 * the cooldown's start, which is the whole arithmetic — and 45.55% is not 100%.
	 */
	it('faults a summon that came off inside the haste cooldown', () => {
		const el = run(
			edited('phased', (events, t0) =>
				events.map((e) =>
					e.abilityGameID === FIRE_ELEMENTAL_BUFF && e.type === 'removebuff' ? { ...e, timestamp: t0 + 20_000 } : e,
				),
			),
		);
		// Still recovered as a pre-pull window, because 20 000 is inside the summon's own minute.
		expect(el.fireElemental.prepull).toBe(true);
		expect(el.fireElemental.hasteUptime).toEqual({ gradedMs: 40_008, coveredMs: 20_000 - 1777 });
		expect(metricOn(el)).toMatchObject({ value: (18_223 / 40_008) * 100, grade: 'bad', unmeasurable: false });
	});

	/**
	 * **The numerator is the aura's windows and not the Fire totem slot's, and this is the pull where the
	 * two disagree.**
	 *
	 * The slot walk stamps every placement with the *declared* sixty seconds, and Glyph of Fire Elemental
	 * Totem halves that with nothing in the log to say so — `feDeclaredDurationMs` in `index.ts` spells out
	 * that the glyph can only ever be refuted, never confirmed. So a glyphed player's slot window claims
	 * thirty seconds the pet was not standing for.
	 *
	 * Built as exactly that pull: `phased` with its pre-pull expiry replaced by an in-fight press at
	 * 1 000ms whose buff comes off at 31 000. The slot walk gives `[1000, 61 000]`, which **contains the
	 * whole 1 777 → 41 785 cooldown** and would read 100%; the aura gives `[1000, 31 000]` and 29 223ms of
	 * it. Both spans are asserted, so the test says which reading is in use rather than only what it
	 * produced.
	 */
	it('measures the pet the log witnessed, not the sixty seconds the press declares', () => {
		const el = run(
			edited('phased', (events, t0) => [
				...events.filter((e) => e.abilityGameID !== FIRE_ELEMENTAL_BUFF),
				{ timestamp: t0 + 1000, type: 'cast', abilityGameID: FIRE_ELEMENTAL_CAST, sourceID: 2, targetID: -1 },
				{ timestamp: t0 + 1000, type: 'applybuff', abilityGameID: FIRE_ELEMENTAL_BUFF, sourceID: 2, targetID: 2 },
				{ timestamp: t0 + 31_000, type: 'removebuff', abilityGameID: FIRE_ELEMENTAL_BUFF, sourceID: 2, targetID: 2 },
			]),
		);
		expect(el.fireElemental.prepull).toBe(false);
		// The declared-duration reading, which is what the slot walk publishes and what this rule refuses
		// to divide by. It swallows the cooldown whole.
		expect(el.searingTotem.feWindows).toEqual([{ start: 1000, end: 61_000 }]);
		expect(el.fireElemental.hasteUptime).toEqual({ gradedMs: 40_008, coveredMs: 31_000 - 1777 });
		expect(metricOn(el)).toMatchObject({ grade: 'bad' });
	});
});

describe('the three ways this rule declines, and none of them is a full mark', () => {
	/**
	 * **The free-pass shape, refused.** Every case here has an empty clock, and the thing that must never
	 * happen is that an empty clock reads 100% — a `good` handed to exactly the pulls the rule was not
	 * entitled to ask. `metricOf` nulls on `gradedMs <= 0`, so `unmeasurable` is the answer and `value`
	 * parks at 0 without being a reading.
	 */
	const expectSilence = (el: Analysis & ElementalAuditResult, label: string) => {
		expect(el.fireElemental.hasteUptime, label).toEqual({ gradedMs: 0, coveredMs: 0 });
		expect(metricOn(el), label).toMatchObject({ unmeasurable: true, grade: 'ok' });
		// The claim that matters: not a hundred, and not a zero being graded either.
		expect(metricOn(el)?.value, label).not.toBe(100);
	};

	/**
	 * A shaman who took something else on the level-90 row has no Primal Fire Elemental to have 100% of,
	 * so the rule was never asked of them — §80's own gate. Built by dropping 117013 out of the real
	 * talent list, so the only difference from the graded reading above is the talent itself.
	 */
	it('says nothing about a pull that did not take Primal Elementalist', () => {
		const el = run(
			edited('phased', (events) =>
				events.map((e) =>
					e.type === 'combatantinfo'
						? {
								...e,
								talents: ((e as { talents?: { id: number }[] }).talents ?? []).filter(
									(t) => t.id !== PRIMAL_ELEMENTALIST,
								),
							}
						: e,
				),
			),
		);
		expect(el.fireElemental.prepull).toBe(true);
		expectSilence(el, 'talent dropped');
	});

	/**
	 * And nothing about a log that carried no talent list at all, which is a different fact from "did not
	 * take it" and must not be rendered as a choice the player made. `readTalents` answers three ways;
	 * two of them are silence and only one is a `false`.
	 */
	it('says nothing about a pull whose log carried no talent list', () => {
		const el = run(edited('phased', (events) => events.filter((e) => e.type !== 'combatantinfo')));
		expectSilence(el, 'no combatantinfo');
	});

	/**
	 * A raid that brought no haste cooldown has offered no stretch to grade. **This is the case the free
	 * pass would have been handed to**, because the summon was out for the whole first minute and a naive
	 * reading of "was it up when it mattered" says yes.
	 */
	it('says nothing about a pull with no haste cooldown at all', () => {
		const el = run(edited('phased', (events) => events.filter((e) => !HASTE_IDS.has(e.abilityGameID ?? -1))));
		expect(el.timeline?.hasteWindows ?? []).toEqual([]);
		expectSilence(el, 'no haste');
	});

	/**
	 * A cooldown that went out at a minute in is *"a different tactical situation and is not read as the
	 * pull's"* — `ascendanceSync`'s own words for the same narrowing, and here it is the availability
	 * guard. This player's summon may simply not be up at 61 777ms, and no log states when a five- or
	 * three-minute cooldown that was spent before the bell comes back. Faulting them for the raid's timing
	 * is the "charged the player for something they could not have done" shape this audit has shipped four
	 * times.
	 *
	 * Built by moving `phased`'s Heroism whole, so the window still exists and is still forty seconds — it
	 * is only its start that has left the opener.
	 */
	it('says nothing about a haste cooldown that did not go out on the pull', () => {
		const el = run(
			edited('phased', (events) =>
				events.map((e) => (HASTE_IDS.has(e.abilityGameID ?? -1) ? { ...e, timestamp: e.timestamp + 60_000 } : e)),
			),
		);
		// The window is intact and well past the summon's own minute, so a rule reading every cooldown
		// would have found 0% here and faulted the pull.
		expect(el.timeline?.hasteWindows?.[0]).toMatchObject({ start: 61_777, end: 101_785 });
		expectSilence(el, 'late haste');
	});
});

describe('the scope this rule deliberately does not declare', () => {
	/**
	 * **No band, and this cannot go red against the old behaviour — it is the decision not to declare
	 * one.** DELIBERATE NO-CHANGE GUARD.
	 *
	 * A band says "this figure means nothing at these target counts", and there is no count at which a
	 * standing Primal Fire Elemental means nothing: it is a pet that hits whatever is in front of it, the
	 * haste that makes its window worth aiming at is raid-wide, and no rung of any of the three priority
	 * lists would rather the fire totem slot were empty. The opportunity exists identically however many
	 * enemies are up, which is the shape of argument the table's unbanded rules share.
	 *
	 * Asked at all three readings on all three pulls, including the `multi` reading that exempts seven of
	 * the other rules, so the next declaration added here fails a test and has to bring an argument.
	 */
	it('is asked of every pull at every reading', () => {
		// `MetricRule` rather than the literal type `THRESHOLDS` infers, so this reads the *declaration* —
		// `bands` is optional on the rule and absent from this entry, and the widening is what lets the
		// assertion be about that rather than about what TypeScript already knows.
		const rule: MetricRule = THRESHOLDS.fireElementalHasteUptime;
		expect(rule.bands).toBeUndefined();
		for (const name of FIXTURES) {
			const el = fx(name);
			for (const choice of ['auto', 'single', 'multi'] as const) {
				const m = metricOn(el, choice);
				expect(m?.exempt, `${name}/${choice}`).toBeUndefined();
				expect(m?.unmeasurable, `${name}/${choice}`).toBe(false);
				expect(weightsFor(resolveBands(el.targets, choice)).fireElementalHasteUptime, choice).toBe(0);
			}
		}
	});

	/**
	 * The absolute grades binary, which is the user's sentence and not a line chosen near it. "100%
	 * uptime" names no middle, so `good` and `ok` are the same number and there is nothing between them —
	 * the same two-sided shape rules 1 and 2 grade with, whose `AscendancePressVerdict` has no third band
	 * either. Here so that softening it to a range has to be argued rather than typed.
	 */
	it('leaves no band between meeting it and not', () => {
		expect(THRESHOLDS.fireElementalHasteUptime).toEqual({ good: 100, ok: 100, higherIsBetter: true });
	});
});
