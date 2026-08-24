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
// before the pull owns the first minute of it, a raid lusts on the pull, and a minute contains
// forty seconds. So the fault side of this rule is carried on synthetic pulls below, every one of them
// a real fixture with named events moved or removed — never a threshold lowered until something fired.
//
// **A fourth fixture has since landed — `addsThenBoss.json` — and it does not change that.** It is the
// first committed pull this rule *declines* on, because its raid lusted seven minutes in rather than on the
// pull, so the fault side is still carried on synthetics. What it does add is the refusal path exercised on
// a captured log instead of a built one; see `says nothing about the pull whose raid lusted seven minutes
// in`.
//
// **The weight is now 1 and the rule has a band, and the paragraph above is kept as written because it is
// still the reason the fixtures cannot exercise the fault side.** What changed is the two arguments the
// zero rested on. The first was that a glyphed player is capped however well they play, so faulting one
// would be a false positive; the user has ruled the other way — *"you never want to glyph your fele for
// damage. Having a 2nd FEle earlier is almost always worse due to less procs available"* — so the glyphed
// pull is a pull to fault and there is no exemption to build. The second was the flatness, and the
// flatness was the binary: `ok: 100` printed *"pressed one second late"* and *"never pressed it at all"*
// in the same colour. `ok: 95` is two seconds of a forty-second window, and the arms of it are pinned in
// `the band, and where it was cut` below. The headlines the weight moved are pinned in
// `what the weight costs the three committed cards`, at all three readings rather than the default one.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import { resolveBands, type TargetModeChoice } from '~/lib/view/targetMode';
import type { Metric, MetricRule } from '~/lib/score';
import { rawFixtures } from '~/lib/analysis/fixtures';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '../index';
import { scoreAnalysis, THRESHOLDS, WEIGHTS, weightsFor } from '../score';

/**
 * **Deliberately three, and this is the reason on the line.** The three pulls this rule *measures* on —
 * the ones whose raid lusted on the pull, so there is a graded clock and a real share of it. The fourth
 * committed pull, `addsThenBoss`, is the one the rule **declines**: its Heroism opens at 438 207 ms, the
 * graded clock is empty, and the metric comes back unmeasurable. Sweeping it into these five loops would
 * assert a 100.00% share on the pull whose whole point is that there is no share to take — see `says
 * nothing about the pull whose raid lusted seven minutes in`.
 *
 * The two halves are a partition of the fixture directory rather than two lists, and `every committed pull
 * is on one side of the rule` below is what makes a fifth fixture pick a side instead of landing in
 * neither. That is the hole a bare literal leaves: this file is *about* which pulls the rule can speak on,
 * so a new pull nobody classified is the one thing it must not miss.
 */
const FIXTURES = ['phased', 'unbroken', 'cleave'] as const;

/** Every raw Elemental pull, found rather than listed — the denominator `FIXTURES` is three of. */
const ALL_FIXTURES = rawFixtures('elemental').map(({ name }) => name.replace(/\.json$/, ''));

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
	 * **What the weight costs the three committed cards, at all three readings and not only the default
	 * one.** A weight change moves `overallOf` by construction, so the price is pinned as the nine cards a
	 * reader can actually reach rather than the three the switch happens to be on.
	 *
	 * Measured both ways on one tree rather than differenced across two runs:
	 *
	 * ```
	 *                          weight 0 / ok 100        weight 1 / ok 95
	 *   phased    auto     73.08% of 13  ok        75.00% of 14  good
	 *   phased    single   73.08% of 13  ok        75.00% of 14  good
	 *   phased    multi   100.00% of  5  ok       100.00% of  6  ok
	 *   unbroken  auto     61.54% of 13  ok        64.29% of 14  ok
	 *   unbroken  single   61.54% of 13  ok        64.29% of 14  ok
	 *   unbroken  multi   100.00% of  5  ok       100.00% of  6  ok
	 *   cleave    auto     42.31% of 13  bad       46.43% of 14  ok
	 *   cleave    single   50.00% of 11  ok        54.17% of 12  ok
	 *   cleave    multi    90.00% of  5  ok        91.67% of  6  ok
	 * ```
	 *
	 * Two headlines move: `phased` onto **exactly** the 75% `good` line at `auto` and `single`, and
	 * `cleave` over the 45% one at `auto`. The three `multi` cells read 100%, 100% and 90% and still print
	 * `ok` at both weights, because 6 of 19 is under `MIN_JUDGED_WEIGHT_SHARE` — a reading whose headline is
	 * a refusal, and one this pin would have been blind to had it only asked `auto`.
	 *
	 * The metric itself is `good` and the section is `good` in all nine cells at both weights, which is the
	 * other half of what makes the table above the *whole* difference.
	 */
	it('what the weight costs the three committed cards, at every reading', () => {
		const cards = FIXTURES.flatMap((name) => {
			const el = fx(name);
			return (['auto', 'single', 'multi'] as const).map((choice) => {
				const view = resolveBands(el.targets, choice);
				const card = scoreAnalysis(el, view);
				// Not vacuous, and not only at `auto`: the metric really is on the card and really is graded
				// `good` at every reading, so the mean below moved for the weight and nothing else.
				expect(metricOn(el, choice), `${name}/${choice}`).toMatchObject({
					value: 100,
					grade: 'good',
					unmeasurable: false,
				});
				expect(card.sections['fireElemental']?.grade, `${name}/${choice}`).toBe('good');
				const { judged } = card;
				expect(judged, `${name}/${choice}`).toBeDefined();
				return `${name}/${choice} ${card.overall} ${judged?.measured}/${judged?.total}`;
			});
		});
		expect(cards).toEqual([
			'phased/auto good 14/19',
			'phased/single good 14/19',
			'phased/multi ok 6/19',
			'unbroken/auto ok 14/19',
			'unbroken/single ok 14/19',
			'unbroken/multi ok 6/19',
			'cleave/auto ok 14/19',
			'cleave/single ok 12/19',
			'cleave/multi ok 6/19',
		]);
		expect(WEIGHTS.fireElementalHasteUptime).toBe(1);
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
		// 73.04%, which is `bad` under `ok: 95` and would be `bad` under any band a glyphed summon could
		// reach — see `no glyphed summon can reach the band` below. The slot walk's 100% is the reading
		// this rule refuses; that is what the assertion above is for.
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
	 * **And the same refusal on a captured pull rather than a built one.**
	 *
	 * `addsThenBoss.json` is the fourth Elemental fixture and the first one this rule declines on. Its raid
	 * lusted at 438 207ms — seven minutes in, on the boss after the add phase — so there is no on-pull haste
	 * cooldown, the graded clock is empty and the metric refuses. Every other refusal in this file is built
	 * by moving or deleting events; this one is what a real log does, which is the difference between
	 * "the guard works" and "the guard fires".
	 *
	 * It is also the one committed pull where the two rules' reader-facing pair can be read off a real
	 * fight: `fireElementalPrepull` at `ok` (the elemental was not out at the pull — its first press is at
	 * 173 290ms) beside this rule saying nothing at all. Neither calls the pull a mistake, which is the
	 * whole of the reconciliation seen from the fixtures.
	 *
	 * **This is new coverage of behaviour that did not change, so it cannot be shown to fail against the
	 * old weight or the old band — DELIBERATE NO-CHANGE GUARD.** The refusal is `gradedMs <= 0` and it
	 * predates both. What is new is the fixture that reaches it.
	 */
	it('says nothing about the pull whose raid lusted seven minutes in', () => {
		const el = fx('addsThenBoss');
		expect(el.timeline?.hasteWindows?.[0]).toMatchObject({ start: 438_207, variant: 'Heroism' });
		expect(el.fireElemental.prepull).toBe(false);
		expect(el.fireElemental.presses[0]?.t).toBe(173_290);
		expectSilence(el, 'addsThenBoss');
		// The pair, on a real pull: a half-mark for the pre-pull and silence for the window. Not a fault on
		// either side, and the section says so.
		const card = scoreAnalysis(el, resolveBands(el.targets, 'auto'));
		expect(card.sections['fireElemental']?.metrics.map((m) => `${m.key}=${m.unmeasurable ? 'unm' : m.grade}`)).toEqual([
			'fireElementalPrepull=ok',
			'fireElementalHasteUptime=unm',
		]);
		expect(card.sections['fireElemental']?.grade).toBe('ok');
	});

	/**
	 * *** The guard the literal `FIXTURES` could not be: every committed pull is on one side of the rule.
	 * ***
	 *
	 * `FIXTURES` is deliberately three — the pulls the rule measures on — and a deliberate list has one
	 * failure mode, which is a fixture that belongs on neither side and is asked by nobody. That is what
	 * happened when `addsThenBoss.json` landed: it should have been the declining case from the day it was
	 * committed, and the five loops over the three-name literal went on being green without it.
	 *
	 * So the partition is derived rather than assumed. Measured, not named: a pull is on the measured side
	 * exactly when the metric has a graded clock, and `FIXTURES` has to be that set. A fifth fixture fails
	 * here and says which side it belongs on.
	 */
	it('puts every committed pull on one side of the rule, measured rather than listed', () => {
		const measured: string[] = [];
		const declined: string[] = [];
		for (const name of ALL_FIXTURES) ((metricOn(fx(name))?.gradedMs ?? 0) > 0 ? measured : declined).push(name);
		expect(measured.sort()).toEqual([...FIXTURES].sort());
		expect(declined).toEqual(['addsThenBoss']);
		// Not vacuous: the whole committed set is accounted for and neither half is empty.
		expect(measured.length + declined.length).toBe(ALL_FIXTURES.length);
	});

	/**
	 * A cooldown that went out at a minute in is *"a different tactical situation and is not read as the
	 * pull's"* — `ascendanceSync`'s own words for the same narrowing, and here it is the availability
	 * guard. This player's summon may simply not be up at 61 777ms, and no log states when a five- or
	 * three-minute cooldown that was spent before the pull comes back. Faulting them for the raid's timing
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
				expect(weightsFor(resolveBands(el.targets, choice)).fireElementalHasteUptime, choice).toBe(1);
			}
		}
	});

	/**
	 * The line itself, so moving it again has to be argued rather than typed. `good` stays the absolute the
	 * user's sentence names; `ok` is 95, which on a forty-second window is two seconds. The whole argument
	 * is on the `THRESHOLDS` entry.
	 */
	it('grades the full mark as an absolute and cuts the band at two seconds of the window', () => {
		expect(THRESHOLDS.fireElementalHasteUptime).toEqual({
			good: 100,
			ok: 95,
			higherIsBetter: true,
			// The rule says what the number *is* as well as where its lines sit, so a scale can place it and
			// copy can suffix it without reading the unit back out of an i18n string. See `MetricRule.unit`.
			unit: 'percent',
			// And that 100 is a lid rather than a bar, so the card names the line instead of writing it as
			// "100% or better" — a share no pull can beat. See `MetricRule.ceiling`.
			ceiling: 100,
		});
	});
});

/**
 * ## The lust that did not go out on the pull
 *
 * The clock used to be "the haste cooldown that opened inside the opener, and no other", with the
 * availability guard as its stated reason: at the pull nothing has consumed the summon yet, so it was
 * there for the taking. Sound for the pulls it covers, and silent on every other one — and a raid that
 * lusts late is the common case rather than the exception.
 *
 * Found on Galakras, where the lust lands at 383s of a 443s pull. The shaman summoned at 385s and the
 * pet ran to the end of the fight, covering 38 of the lust's 40 seconds, and the card said "not
 * measured". None of the three committed fixtures can show it: all three lust on the pull, so all three
 * are unchanged by this and none of them exercises the path.
 *
 * The gate is now the fact the proxy stood for — could this player have had the pet standing through it —
 * which is true two ways and false one way, and all three are below.
 */
describe('a haste cooldown that came later', () => {
	/**
	 * `phased` with its lust moved out to 150s, which is past the five-minute summon on neither side: the
	 * only press is the pre-pull one, so by 150s the cooldown has not come back and the pet is long gone.
	 * That is the pull the old guard was written for and it stays unasked.
	 */
	const lustAt = (at: number, extra: (t0: number) => WclEvent[] = () => []) =>
		run(
			edited('phased', (events, t0) => [
				...events.map((e) => (HASTE_IDS.has(e.abilityGameID ?? -1) ? { ...e, timestamp: e.timestamp + at } : e)),
				...extra(t0),
			]),
		);

	it('still says nothing when the summon was neither up nor ready', () => {
		// 150s out: the pre-pull pet expired at 20s and the five-minute cooldown does not return until 300.
		const el = lustAt(150_000);
		expect(el.fireElemental.hasteUptime).toEqual({ gradedMs: 0, coveredMs: 0 });
		expect(metricOn(el)).toMatchObject({ unmeasurable: true });
	});

	/**
	 * The Galakras shape: the lust is late, the cooldown has come back, and the player presses into it.
	 * Moved to 310s so the five-minute cooldown is genuinely up rather than nearly up, and the summon is
	 * pressed one second after the lust arrives.
	 */
	it('grades a late lust the player could have covered, and does', () => {
		const el = lustAt(
			310_000,
			(t0) =>
				[
					{ timestamp: t0 + 312_777, type: 'cast', abilityGameID: FIRE_ELEMENTAL_CAST, sourceID: 2, targetID: -1 },
					{ timestamp: t0 + 312_777, type: 'applybuff', abilityGameID: FIRE_ELEMENTAL_BUFF, sourceID: 2, targetID: 2 },
					{ timestamp: t0 + 372_777, type: 'removebuff', abilityGameID: FIRE_ELEMENTAL_BUFF, sourceID: 2, targetID: 2 },
				] as WclEvent[],
		);
		// The window is the real one moved bodily, so its length is unchanged and the coverage is the
		// arithmetic: the lust arrives at 311 777 and the pet lands one second later.
		expect(el.fireElemental.hasteUptime.gradedMs).toBe(40_008);
		expect(el.fireElemental.hasteUptime.coveredMs).toBe(39_008);
		expect(metricOn(el)).toMatchObject({ unmeasurable: false });
		// Inside the two-second band the arms below are cut against, so a one-second press is `ok` here for
		// the same reason it is on the pull.
		expect(metricOn(el)?.grade).toBe('ok');
	});

	/**
	 * And the other way to have it: **already standing when the lust arrives, and the cooldown not back.**
	 *
	 * This is the arm the readiness check alone would miss. The summon goes out at 300s, the moved lust
	 * arrives at 305s, and five seconds later the five-minute cooldown is nowhere near ready — so a gate
	 * asking only "could they press it now" would refuse a pull whose pet is visibly standing through the
	 * whole window. A pre-pull summon cannot be stretched to make this case: `auraWindows` caps an
	 * inferred pre-pull window at the pet's own duration, which is correct and is why the press is here.
	 */
	it('grades a late lust the pet was already standing through, cooldown or no', () => {
		const el = lustAt(
			303_223,
			(t0) =>
				[
					{ timestamp: t0 + 300_000, type: 'cast', abilityGameID: FIRE_ELEMENTAL_CAST, sourceID: 2, targetID: -1 },
					{ timestamp: t0 + 300_000, type: 'applybuff', abilityGameID: FIRE_ELEMENTAL_BUFF, sourceID: 2, targetID: 2 },
					{ timestamp: t0 + 360_000, type: 'removebuff', abilityGameID: FIRE_ELEMENTAL_BUFF, sourceID: 2, targetID: 2 },
				] as WclEvent[],
		);
		// The lust runs 305 000 to 345 008 and the pet stands 300 000 to 360 000, so it covers all of it.
		expect(el.fireElemental.hasteUptime).toEqual({ gradedMs: 40_008, coveredMs: 40_008 });
		expect(metricOn(el)).toMatchObject({ unmeasurable: false, grade: 'good' });
	});
});

/**
 * ## The band, and what each of its arms is for
 *
 * Every pull here is `phased` with named events moved or removed, so the haste window is the real one —
 * **1 777 → 41 785ms, forty seconds and eight milliseconds** — and a press at `t` covers `41 785 − t` of
 * it once `t` is past the lust's arrival. That one relationship is what the whole band is cut against, and
 * it is why the arms are stated as press times rather than as percentages.
 */
describe('the band, and where it was cut', () => {
	/** A pull whose only summon is an in-fight press at `at`, standing for `life` from the press. */
	const press = (at: number, life = 60_000) =>
		run(
			edited('phased', (events, t0) => [
				...events.filter((e) => e.abilityGameID !== FIRE_ELEMENTAL_BUFF),
				{ timestamp: t0 + at, type: 'cast', abilityGameID: FIRE_ELEMENTAL_CAST, sourceID: 2, targetID: -1 },
				{ timestamp: t0 + at, type: 'applybuff', abilityGameID: FIRE_ELEMENTAL_BUFF, sourceID: 2, targetID: 2 },
				{ timestamp: t0 + at + life, type: 'removebuff', abilityGameID: FIRE_ELEMENTAL_BUFF, sourceID: 2, targetID: 2 },
			]),
		);

	/** The pre-pull summon `phased` really made, with its one bare expiry moved to `at`. */
	const expiringAt = (at: number) =>
		run(
			edited('phased', (events, t0) =>
				events.map((e) =>
					e.abilityGameID === FIRE_ELEMENTAL_BUFF && e.type === 'removebuff' ? { ...e, timestamp: t0 + at } : e,
				),
			),
		);

	/**
	 * **The defect the band was cut for, and the assertion that goes red without it.**
	 *
	 * Under `ok: 100` every one of these read `bad` — a press a fifth of a second behind the lust and a pull
	 * that never summoned the elemental at all, printed in the same colour. They are not the same mistake
	 * and the card now says so.
	 *
	 * The figures are the window arithmetic and nothing else: 41 785 less the press, over 40 008.
	 */
	it('separates a press behind the lust from a summon that never came', () => {
		const graded = (el: Analysis & ElementalAuditResult) => {
			const m = metricOn(el);
			return `${m?.value.toFixed(3)} ${m?.grade}`;
		};
		expect(graded(press(2000))).toBe('99.443 ok');
		expect(graded(press(3000))).toBe('96.943 ok');
		expect(graded(press(10_000))).toBe('79.447 bad');
		// No summon anywhere in the log, over forty real seconds of haste. The clock is not empty, so this
		// is a graded zero rather than a refusal — see `expectSilence` above for what a refusal looks like.
		const forgot = run(edited('phased', (events) => events.filter((e) => e.abilityGameID !== FIRE_ELEMENTAL_BUFF)));
		expect(forgot.fireElemental.hasteUptime).toEqual({ gradedMs: 40_008, coveredMs: 0 });
		expect(graded(forgot)).toBe('0.000 bad');
	});

	/**
	 * The band is two seconds of the window, so on this pull the boundary is a press at **3 777ms** — the
	 * lust's 1 777 plus two. Asserted from both sides at one millisecond of separation, because a band whose
	 * edge is not pinned is a band that drifts.
	 *
	 * Two seconds is what the pull's own physics can impose on a player whose only lapse is not having
	 * pre-pulled: the lust is itself a cast and lands 0.785–1.777s in on the three pulls we hold, and the
	 * totem pressed as the opening global puts the pet out one cast behind the pull.
	 */
	it('puts the edge of the band two seconds behind the lust', () => {
		expect(metricOn(press(3777))).toMatchObject({ grade: 'ok' });
		expect(metricOn(press(3778))).toMatchObject({ grade: 'bad' });
		// And the edge really is the lust's arrival plus two, not the pull's plus two.
		expect(hasteWindow(press(3777))?.start).toBe(1777);
	});

	/**
	 * **`good` is still containment and nothing less**, which is the half of the user's sentence the band
	 * does not soften. A press that beats the lust reads a flat 100 — the pet was standing before the window
	 * opened — and a press two hundred milliseconds behind it does not.
	 */
	it('keeps the full mark for containment alone', () => {
		expect(metricOn(press(1000))).toMatchObject({ value: 100, grade: 'good' });
		expect(metricOn(press(1777))).toMatchObject({ value: 100, grade: 'good' });
		expect(metricOn(press(1778))).toMatchObject({ grade: 'ok' });
	});

	/**
	 * **The glyph, which is a fault and not a false positive.** *"You never want to glyph your fele for
	 * damage. Having a 2nd FEle earlier is almost always worse due to less procs available."* — so the
	 * player who halved the summon to get it back sooner made a trade that loses damage, and the report
	 * should fault the pull rather than exempt it.
	 *
	 * **This cannot go red against the old behaviour and is not meant to — DELIBERATE NO-CHANGE GUARD.**
	 * `ok: 100` faulted the glyphed pull too, along with everything else short of containment. What is new
	 * is that it is still faulted *now that there is a band to escape into*, which is the thing the user's
	 * ruling asked for and the thing a wider band would have quietly undone.
	 *
	 * **And it is out of reach of the band by construction, not by measurement.** The glyph halves the
	 * summon to thirty seconds; thirty seconds cannot cover more than three quarters of a forty-second
	 * window however it is placed, and three quarters is twenty points below the line. Both placements are
	 * asserted — the glyphed pre-pull, whose expiry lands mid-lust, and the glyphed press — so the ruling
	 * does not rest on one arrangement of it.
	 */
	it('faults every glyphed summon, and no band a glyphed summon could reach would not', () => {
		// A glyphed pre-pull: `phased`'s own expiry, thirty seconds earlier than the log carries it.
		const glyphedPrepull = expiringAt(57_259 - 30_000);
		expect(glyphedPrepull.fireElemental.prepull).toBe(true);
		expect(metricOn(glyphedPrepull)?.value).toBeCloseTo(63.692, 3);
		expect(metricOn(glyphedPrepull)).toMatchObject({ grade: 'bad' });

		const glyphedPress = press(1000, 30_000);
		expect(metricOn(glyphedPress)?.value).toBeCloseTo(73.043, 3);
		expect(metricOn(glyphedPress)).toMatchObject({ grade: 'bad' });

		// The construction, stated as arithmetic rather than as a third fixture: the best a thirty-second
		// summon can do against this forty-second window is 74.99%, and the band is 95.
		const best = (30_000 / 40_008) * 100;
		expect(best).toBeLessThan(THRESHOLDS.fireElementalHasteUptime.ok);
	});

	/**
	 * A pre-pull pressed far too early still fails, and this is the one arm of the band that a *pre-pulled*
	 * pull can reach — so `fireElementalPrepull`'s `good` and this rule's `bad` land on the same pull, which
	 * is the two rules saying different true things rather than disagreeing. It was out at the pull; it left
	 * before the lust did.
	 *
	 * **DELIBERATE NO-CHANGE GUARD** on the grade, for the same reason as the glyph above: 83.04% was `bad`
	 * under `ok: 100` and is `bad` under `ok: 95`. What is new is the pairing asserted underneath it.
	 */
	it('faults a pre-pull made so early the pet leaves inside the lust', () => {
		const el = expiringAt(35_000);
		expect(el.fireElemental.prepull).toBe(true);
		const card = scoreAnalysis(el, resolveBands(el.targets, 'auto'));
		expect(card.sections['fireElemental']?.metrics.map((m) => `${m.key}=${m.grade}`)).toEqual([
			'fireElementalPrepull=good',
			'fireElementalHasteUptime=bad',
		]);
		expect(metricOn(el)?.value).toBeCloseTo(83.041, 3);
	});

	/**
	 * ## *** The reconciliation with `fireElementalPrepull`, pinned rather than only written down ***
	 *
	 * The two rules share a section and both weigh 1, and `fireElementalPrepull` grades a non-pre-pull `ok`
	 * — *explicitly not a fault*, because nothing in one fight's events bounds the cooldown remaining at the
	 * pull at zero. If this rule faulted a pull for the pre-pull absence alone it would be reversing that
	 * ruling, and the section would carry two metrics disagreeing about one press.
	 *
	 * It does not, and the band is why: **the pre-pull absence on its own costs nothing here.** A press that
	 * beats the lust reads this rule's `good`, and a press up to two seconds behind it reads this rule's
	 * `ok` — the same half-mark rule 4 gives. So on the pull rule 4 declines to fault, rule 5 declines with
	 * it, and what rule 5 faults is a summon seconds behind the lust, or one that left inside it, or one
	 * that never came — none of which "the cooldown may still have been down at the pull" explains.
	 *
	 * Asserted as the pair of grades a reader gets on one pull, at every reading, because that is the thing
	 * that must not read as a contradiction.
	 */
	it('never reverses the pre-pull ruling on a prompt in-fight press', () => {
		for (const at of [1000, 1777, 2000, 3000, 3777]) {
			const el = press(at);
			expect(el.fireElemental.prepull, `${at}`).toBe(false);
			for (const choice of ['auto', 'single', 'multi'] as const) {
				const card = scoreAnalysis(el, resolveBands(el.targets, choice));
				const grades = card.sections['fireElemental']?.metrics.map((m) => `${m.key}=${m.grade}`);
				// Rule 4's half-mark for the absence, and rule 5 at the full mark or the same half-mark —
				// never below it. Not a fault on either side, and the section is never `bad`.
				expect(grades?.[0], `${at}/${choice}`).toBe('fireElementalPrepull=ok');
				expect(grades?.[1], `${at}/${choice}`).toMatch(/^fireElementalHasteUptime=(good|ok)$/);
				expect(card.sections['fireElemental']?.grade, `${at}/${choice}`).toBe('ok');
			}
		}
	});
});
