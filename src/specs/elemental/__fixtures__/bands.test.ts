// What the Elemental's seven band declarations and its sample floor actually do to the three
// committed pulls.
//
// Beside the fixtures because that is what these are tests of. A declaration is one line in
// `THRESHOLDS` and would pass any unit test written around the mechanism while changing nothing on a
// real pull — the defect this project has already shipped once, and the reason the assertions here are
// per fixture, at all three readings, and two-sided: the pulls a declaration moves, the pulls it
// deliberately does not, and the grades that moved with it.
//
// **One thing these tests are careful not to claim.** `MetricRule.bands` nulls a metric only when the
// intersection with the pull's own bands is *empty*. `cleave` resolves to `[1, 2, 3, 4]`, so on the
// mixed pull the user reported every declaration below intersects non-empty and every clock is still
// graded end to end. What moves `cleave` under its own detected reading is the *sample floor*, not a
// band. The clock-cutting half lives in `specs/elemental/lib/index.ts` and is not in this change; see
// the note above `THRESHOLDS`.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { GRADE_ORDER, type Metric } from '~/lib/score';
import { countAt } from '~/lib/analysis/targets';
import { resolveBands, type TargetModeChoice } from '~/lib/view/targetMode';
import { analyse } from '~/specs/elemental/lib';
import { scoreAnalysis, weightsFor } from '~/specs/elemental/lib/score';

const fixture = (name: string): Analysis & ElementalAuditResult =>
	analyse(JSON.parse(readFileSync(resolve(import.meta.dirname, `${name}.json`), 'utf8')) as FightDataset) as Analysis &
		ElementalAuditResult;

const ALL = ['phased', 'unbroken', 'cleave'] as const;

/** One pull's card, read the way a reader with that switch position would see it. */
const card = (name: string, choice: TargetModeChoice) => {
	const analysis = fixture(name);
	return scoreAnalysis(analysis, resolveBands(analysis.targets, choice));
};

const metrics = (name: string, choice: TargetModeChoice): Metric[] =>
	Object.values(card(name, choice).sections).flatMap((s) => s.metrics);

const metric = (name: string, choice: TargetModeChoice, key: string): Metric | undefined =>
	metrics(name, choice).find((m) => m.key === key);

/**
 * The summary panel's three cards, ranked the way `Takeaways` ranks them.
 *
 * A mirror of that component's own sort rather than a call into it: the component needs an i18n
 * provider, a spec context and a rendered tree, and what is under test here is which metrics reach it
 * rather than how they are drawn. Kept in step by using the same two inputs the component uses — the
 * card's sections and `weightsFor(view)` — so a metric that leaves the card leaves this list too.
 */
function panel(name: string, choice: TargetModeChoice): string[] {
	const analysis = fixture(name);
	const view = resolveBands(analysis.targets, choice);
	const weights = weightsFor(view);
	const shortfall = (m: Metric) => {
		const band = Math.abs(m.good - m.ok);
		return band === 0 ? 0 : (m.higherIsBetter ? m.ok - m.value : m.value - m.ok) / band;
	};
	return Object.values(scoreAnalysis(analysis, view).sections)
		.flatMap((s) => s.metrics)
		.filter((m) => !m.unmeasurable && m.grade !== 'good' && (weights[m.key as keyof typeof weights] ?? 0) > 0)
		.sort(
			(a, b) =>
				GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade) ||
				(weights[b.key as keyof typeof weights] ?? 0) - (weights[a.key as keyof typeof weights] ?? 0) ||
				shortfall(b) - shortfall(a),
		)
		.slice(0, 3)
		.map((m) => m.key);
}

/** The seven rules that declare a scope, and the six that deliberately do not. */
const BANDED = [
	'flameShockUptime',
	'flameShockWaste',
	'flameShockMultiDot',
	'flameShockSnapshots',
	'earthShockGood',
	'searingTotemUptime',
	'lightningShieldOvercap',
] as const;
const UNBANDED = [
	'gcdUtilisation',
	'searingTotemOverlaps',
	'fireElementalPrepull',
	'lightningShieldFellOff',
	'thunderstormMissed',
	'shamanisticRageMissed',
] as const;

describe('the reported bug, on the pull it was reported from', () => {
	/**
	 * **The reported bug, and what each half of the fix did to it.**
	 *
	 * `cleave` is an encounter with add waves and then a boss, and when it was reported its three summary
	 * cards were all about the Flame Shock dot: `flameShockUptime`, `flameShockMultiDot`, `flameShockWaste`.
	 *
	 * **The seven band declarations moved none of them**, and this test was written in that state to say
	 * so — a declaration nulls a metric only when the intersection with the pull's own bands comes out
	 * *empty*, and `cleave` visits all four bands, so every rule intersected non-empty and every clock was
	 * still graded end to end. That assertion has now gone red, which is exactly what it was for.
	 *
	 * **What moved it was the clock cut**, in `specs/elemental/lib/index.ts`: one `gradedSpans`, both
	 * halves of each ratio intersected with it, 82 858ms of this pull's 263 233ms. Two consequences reach
	 * this panel, and they are worth telling apart:
	 *
	 *   - `flameShockUptime` stays, and stays `bad`. Its clock lost the add waves and the figure went from
	 *     72.30% to 83.90% — a real improvement, and still 1.1 points under the 85% `ok` line. The dot was
	 *     dropped on the boss too, and the exemption does not hide that.
	 *   - `flameShockWaste` **leaves**, and not by exemption. Cutting the clocks let `shareOf`'s sample
	 *     floor be applied to it, and this pull made two Flame Shock refreshes all fight — under
	 *     `MIN_GRADED_SAMPLE`, so the metric now declines instead of grading a 50% that was one press. Its
	 *     place on the panel goes to `lightningShieldOvercap`, which is a genuine fault on its own clock.
	 *
	 * So two of the three cards are still the dot, which is the honest outcome: `flameShockMultiDot` reads
	 * 16.64% and cutting its clock too was measured at 18.73% — see its threshold. That card is a real
	 * fault rather than an artefact, and the report should keep saying so.
	 */
	it('replaces one of cleave three Flame Shock cards once the clocks are cut', () => {
		expect(resolveBands(fixture('cleave').targets, 'auto').bands).toEqual([1, 2, 3, 4]);
		expect(panel('cleave', 'auto')).toEqual(['flameShockUptime', 'flameShockMultiDot', 'lightningShieldOvercap']);
		expect(card('cleave', 'auto').overall).toBe('bad');
		// Still not one `exempt` among them: this pull visits every band, so the declarations remain inert
		// here and the whole of the movement above is the clock. That is the claim this file began with and
		// it is still true — it is only the panel that moved.
		for (const key of BANDED) expect(metric('cleave', 'auto', key)?.exempt, key).toBeUndefined();
		// And the metric that left did so by refusing, not by grading well.
		expect(metric('cleave', 'auto', 'flameShockWaste')?.unmeasurable).toBe(true);
		expect(metric('cleave', 'auto', 'flameShockUptime')?.value).toBeCloseTo(83.899, 3);
	});

	/**
	 * And the shape of the third of those cards, which is the one press this whole exercise is about.
	 *
	 * `cleave` made **two** Flame Shock refreshes all fight. One was excused. The other — the whole of its
	 * 50%, and the worst grade on the card — was pressed at 57 499ms with **four** enemies up, where
	 * `aoe.apl.json` rung 1 refuses to refresh a live dot at all and not one of p5's three excuses is on
	 * the list. So the number is a fault by a stricter rule than the one it was measured against, taken
	 * off a denominator of two, where the only reachable values are 0, 50 and 100.
	 *
	 * The audit facts rather than the metric, deliberately: `MIN_GRADED_SAMPLE` is owed on this row and is
	 * not paid here — see the note at the metric for the two assertions in another lane's files that hold
	 * it — and a test written against the grade would have to be rewritten when it lands. These two facts
	 * do not change either way.
	 */
	it('grades cleave’s dot economy off one press made at four enemies', () => {
		const el = fixture('cleave');
		expect(el.flameShock.refreshes).toBe(2);
		const at = countAt(el.targets?.counts.points ?? []);
		const faulted = el.flameShock.presses.filter((press) => press.kind === 'early');
		expect(faulted).toHaveLength(1);
		expect(at(faulted[0]!.t)).toBe(4);
	});
});

describe('a declared scope is not asked of a pull outside it', () => {
	/**
	 * The reading that can produce an empty intersection: a reader who says "read this whole pull as
	 * multi-target" is saying the single-target and two-target lists were not what was running.
	 *
	 * All seven banded rules, every fixture. `unbroken` is the one that shows this is an exemption and
	 * not a pass — it wastes a third of its refreshes and misses eight of thirteen shocks, and it comes
	 * back unasked rather than forgiven.
	 */
	it('exempts every banded rule on a forced multi-target reading', () => {
		for (const name of ALL) {
			for (const key of BANDED) {
				const m = metric(name, 'multi', key);
				expect(m?.exempt, `${name}/${key}`).toBe(true);
				expect(m?.unmeasurable, `${name}/${key}`).toBe(true);
				expect(m?.grade, `${name}/${key}`).not.toBe('good');
			}
		}
	});

	/**
	 * And the headline refuses to be a headline over what is left: 5 of 22 points, all of them habit
	 * metrics and a pre-pull press, which is under `MIN_JUDGED_WEIGHT_SHARE`.
	 *
	 * One of the three moves letter as well as meaning: `cleave` graded `bad` on that reading before and
	 * now parks at `ok`. The other two already read `ok`, and what changed for them is that the `ok` is
	 * now marked `judged.unmeasurable` — the value the report reads to say "cannot say" rather than
	 * printing a middling grade. A letter that stays put while its meaning inverts is the case a test on
	 * `overall` alone would have missed.
	 */
	it('stops printing a whole-pull verdict over five of twenty-two points', () => {
		for (const name of ALL) {
			expect(card(name, 'multi').judged, name).toEqual({ measured: 5, total: 22, unmeasurable: true });
			expect(card(name, 'multi').overall, name).toBe('ok');
		}
		expect(panel('cleave', 'multi')).toEqual(['lightningShieldFellOff']);
		expect(panel('phased', 'multi')).toEqual([]);
	});

	/**
	 * `bands: [2]` on the multi-dot rule is the only declaration in the table with a hole in the middle,
	 * and this is it doing work at both edges of the hole.
	 *
	 * Below it there is no second target and the metric already declined; above it the list stops asking
	 * for a second dot. So on a pull read as one enemy the reason changes from "the log cannot say" to
	 * "the list did not ask", and on `cleave` — which really did spend 148 865ms at two or more — reading
	 * it as single-target now exempts the rule rather than grading 16.6% against it.
	 */
	it('asks for a second dot at two enemies and at no other count', () => {
		for (const name of ALL) expect(metric(name, 'single', 'flameShockMultiDot')?.exempt, name).toBe(true);
		expect(metric('cleave', 'auto', 'flameShockMultiDot')?.exempt).toBeUndefined();
		expect(metric('cleave', 'auto', 'flameShockMultiDot')?.grade).toBe('bad');
	});

	/**
	 * What that costs the headline, stated rather than left as a side effect: two of `cleave`'s
	 * twenty-two points leave the denominator when it is read as single-target, and the letter does not
	 * move with them.
	 *
	 * The 16.6% multi-dot uptime used to be charged to a pull the reader had just declared was fought at
	 * one enemy — a rule about spreading the dot, applied to a reading with nothing to spread to. It is now
	 * unasked. The name of this test is kept from when that was the whole story; the letter has since moved,
	 * and it moved for the reason below rather than for this one.
	 *
	 * **11 of 22 and not 13**, which is two changes and not one. The multi-dot rule's two points leave
	 * because the reader declared one enemy — that is this test's own subject. `flameShockWaste`'s two leave
	 * for a different reason entirely: cutting the graded clocks let `shareOf`'s sample floor apply, and this
	 * pull's two refreshes are under it, so the metric declines at every reading rather than grading a 50%
	 * decided by one press. 11 of 22 is exactly half, and `MIN_JUDGED_WEIGHT_SHARE` is read `>=`, so the
	 * letter still prints — the tie judges rather than refusing, which is the boundary this pull now sits
	 * precisely on.
	 *
	 * **And the letter is `ok`, up from `bad`.** This is the one letter the whole exercise moves on a
	 * committed fixture, so the arithmetic is written out rather than left to be re-derived. Before, over
	 * 13 points: the dot's uptime `bad` at weight 3, the waste `bad` at 2, Earth Shock `bad` and the shield's
	 * overcap `bad` at 1 each, the totem `ok` at 1, its overlaps and the pre-pull `good` at 1 each, the
	 * shield's fall-off `ok` at 1, globals `good` at 2 — 5.0 of 13, which is 38% and under the 45% line.
	 * After, over 11: the waste's two points are gone and the totem's uptime has crossed to `good` on its own
	 * cut clock, giving 5.5 of 11, which is exactly 50%.
	 *
	 * Both halves of that are the intended change and neither is a threshold being flattered: the totem
	 * genuinely was up for 88.5% of the time a list asked for one, and the waste genuinely cannot be graded
	 * off two presses. What the reader now sees on this pull is a fair `ok` over a smaller, honest
	 * denominator instead of a `bad` half of whose weight was add-wave time.
	 */
	it('drops the spreading rule from a pull read as single-target and lifts its letter', () => {
		expect(card('cleave', 'single').judged).toEqual({ measured: 11, total: 22, unmeasurable: false });
		expect(card('cleave', 'single').overall).toBe('ok');
	});
});

describe('what deliberately does not move', () => {
	/**
	 * **A no-change guard, labelled.** `phased` and `unbroken` never exceed one enemy — `counts.max` is 1
	 * on both — so their detected reading and a forced single-target reading are the same set, and no
	 * band declaration can separate them. This is the population fact that makes the forced-multi tests
	 * above the only ones a declaration can speak to.
	 */
	it('cannot be separated on the two pulls that never leave one enemy', () => {
		for (const name of ['phased', 'unbroken'] as const) {
			expect(fixture(name).targets?.counts.max, name).toBe(1);
			expect(resolveBands(fixture(name).targets, 'auto').bands, name).toEqual([1]);
			expect(card(name, 'auto')).toEqual(card(name, 'single'));
		}
	});

	/**
	 * The six rules with no band, still asked of every pull at every reading — including the reading that
	 * exempts the other seven.
	 *
	 * This is the half that keeps "the exception applies globally" from meaning "an add fight is not
	 * graded". A pool that empties, a shield that falls off, a global that goes unfilled, a totem placed
	 * under the elemental and a summon that was not out at the bell are all the same fault at one enemy
	 * and at thirteen.
	 *
	 * **Cannot go red against the old behaviour**, because before this change no rule in the table had a
	 * band and nothing was exempt anywhere. What it pins is the shape of the table going forward: the next
	 * declaration added to one of these six fails here, which is where the argument for it belongs.
	 */
	it('keeps asking the six rules that are not about a list', () => {
		for (const name of ALL) {
			for (const choice of ['auto', 'single', 'multi'] as const) {
				for (const key of UNBANDED) {
					expect(metric(name, choice, key)?.exempt, `${name}/${choice}/${key}`).toBeUndefined();
				}
			}
		}
	});

	/**
	 * `searingTotemOverlaps` specifically, because an earlier plan asked for it to be exempt at band 3+
	 * and this is the ruling against that.
	 *
	 * A totem pressed under the Fire Elemental bought nothing at any target count — the elemental owns
	 * the fire-totem slot — so the fault is a slot fact rather than a list fact. Graded on all three
	 * pulls at all three readings, and `good` on all of them, so the ruling costs nothing measurable
	 * today: the three committed pulls placed seven totems and none of them under the elemental.
	 *
	 * **Cannot go red against the old behaviour**, for the same reason as the guard above: this is the
	 * decision *not* to declare, and the old behaviour is the same absence. It is here so that the plan
	 * that asked for `bands: [1, 2]` here cannot be quietly carried out later without a red test and an
	 * argument.
	 */
	it('grades a totem under the elemental at every count', () => {
		for (const name of ALL) {
			for (const choice of ['auto', 'single', 'multi'] as const) {
				const m = metric(name, choice, 'searingTotemOverlaps');
				expect(m?.unmeasurable, `${name}/${choice}`).toBe(false);
				expect(m?.value, `${name}/${choice}`).toBe(0);
			}
			expect(fixture(name).searingTotem.feOverlaps, name).toBe(0);
		}
	});

	/**
	 * **A guard that cannot be shown either way on what we hold, stated as such.**
	 *
	 * `flameShockSnapshots` is the heaviest rule in the table and its declaration is untestable here: all
	 * three pulls audit `refreshed: 0, missed: 0`, because none of them ever wore a trigger and an int
	 * proc at the same moment. So the metric is unmeasurable at every reading before and after, `shareOf`
	 * refuses a denominator of zero the same way `sharePct` did, and the first fixture with a live
	 * snapshot window will be the first evidence for either half.
	 */
	it('has no pull that can test the snapshot rule at all', () => {
		for (const name of ALL) {
			const audit = fixture(name).snapshots;
			expect(audit.refreshed + audit.missed, name).toBe(0);
			expect(metric(name, 'auto', 'flameShockSnapshots')?.unmeasurable, name).toBe(true);
			expect(metric(name, 'auto', 'flameShockSnapshots')?.sampleSize, name).toBe(0);
		}
	});
});

describe('the denominator travels with the verdict', () => {
	/**
	 * `overallOf` rather than `overall`, so a `good` over half the spec cannot print as a whole-pull one.
	 *
	 * Under its own reading `cleave` judges **13** of 22 and the two single-target pulls judge 13 — they
	 * never offered a second target, a snapshot window or a mana reading, and `flameShockMultiDot` is now
	 * unasked on them rather than merely unanswerable. All three are above `MIN_JUDGED_WEIGHT_SHARE`, so
	 * every real pull we hold keeps its grade, which is the claim that floor was chosen to make.
	 *
	 * `cleave` was 15 when the declarations landed and is 13 now: `flameShockWaste` carries weight 2 and has
	 * left the denominator, because cutting the graded clocks let `shareOf`'s sample floor apply and this
	 * pull made only two Flame Shock refreshes. **That is the honest direction for it to move** — the two
	 * points were being spent on a 50% that one press decided — but it is a real narrowing of what the
	 * header can claim, and 13 of 22 is 59%, so the grade still prints.
	 */
	it('publishes what each pull was judged on', () => {
		expect(card('cleave', 'auto').judged).toEqual({ measured: 13, total: 22, unmeasurable: false });
		for (const name of ['phased', 'unbroken'] as const) {
			expect(card(name, 'auto').judged, name).toEqual({ measured: 13, total: 22, unmeasurable: false });
		}
	});

	/**
	 * **The free pass this file documented is now closed, and this still pins how far out of reach it is on
	 * what we hold.**
	 *
	 * `lightningShieldOvercap` grades a clock the audit cuts, and on a pull with no band-1-or-2 stretch at
	 * all that clock is empty, where `0ms of overcap over 0ms` grades `good`. The guard is
	 * `gradedOver(overcapMs, gradedMs)` and `gradedMs` is now a published field, so the refusal happens.
	 *
	 * It still cannot be *exercised* here: all three pulls spend most of themselves at one or two enemies,
	 * so the graded clock is 258 304ms, 184 448ms and 180 375ms. So this test keeps its original job — it
	 * records that no committed pull reaches the hazard, which is how a later reader tells an untested
	 * guard from an absent one. The pull that does reach it is synthetic and lives in
	 * `lib/__tests__/bandedClocks.test.ts`, which is where the refusal itself is asserted.
	 */
	it('has no pull whose shield clock the exemption could empty', () => {
		for (const name of ALL) {
			const el = fixture(name);
			const aoeMs = el.lightningShield.aoeWindows.reduce((total, w) => total + (w.end - w.start), 0);
			expect(el.durationMs - aoeMs, name).toBeGreaterThan(0);
			expect(metric(name, 'auto', 'lightningShieldOvercap')?.unmeasurable, name).toBe(false);
		}
	});
});
