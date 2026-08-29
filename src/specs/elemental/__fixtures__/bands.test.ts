// What the Elemental's seven band declarations and its sample floor actually do to the four
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
import { rawFixtures } from '~/lib/analysis/fixtures';
import { countAt } from '~/lib/analysis/targets';
import { resolveBands, type TargetModeChoice } from '~/lib/view/targetMode';
import { analyse } from '~/specs/elemental/lib';
import { scoreAnalysis, THRESHOLDS, weightsFor } from '~/specs/elemental/lib/score';

// Memoised, which the three-fixture version did not need to be. Every `card`, `metric` and `panel` call
// below re-reads and re-analyses, and `addsThenBoss.json` is 4.4MB — the loops in this file would parse it
// dozens of times. Read-only here: nothing in the file mutates a dataset or an analysis.
const analysed = new Map<string, Analysis & ElementalAuditResult>();
const fixture = (name: string): Analysis & ElementalAuditResult => {
	const memo = analysed.get(name);
	if (memo !== undefined) return memo;
	const el = analyse(
		JSON.parse(readFileSync(resolve(import.meta.dirname, `${name}.json`), 'utf8')) as FightDataset,
	) as Analysis & ElementalAuditResult;
	analysed.set(name, el);
	return el;
};

/**
 * Every raw pull this spec has committed, discovered rather than listed.
 *
 * **This was `['phased', 'unbroken', 'cleave']`.** When `addsThenBoss.json` was committed, every loop in
 * this file went on visiting three pulls, and the test below that claims *"has no pull that can test the
 * snapshot rule at all"* went on passing while the pull that can had been sitting in this directory. A
 * literal fixture list in the file that grades fixtures is the same defect the sweeps in
 * `lib/analysis/fixtures.ts` were written to close, and it fails in the silent direction: nothing goes
 * red, the new pull is simply not looked at.
 */
const ALL = rawFixtures('elemental').map(({ name }) => name.replace(/\.json$/, ''));

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

/**
 * The eight rules that declare a scope, and the eleven that deliberately do not.
 *
 * **Both lists are checked against `THRESHOLDS` rather than only iterated**, because the version of this
 * guard that only iterated them was blind in the direction it claimed to cover. Its own docblock said "the
 * next declaration added to one of these six fails here" — and it could not, because a rule added to the
 * table and to neither list is simply never visited. `fireElementalHasteUptime` proved it: rule 5 landed
 * unbanded, the count in this comment went stale, and nothing went red.
 *
 * So the partition is asserted first: every key in `THRESHOLDS` appears in exactly one of the two lists.
 * A new rule then fails here on the day it is declared, whichever way it is declared, which is what the
 * old comment was promising.
 */
const BANDED = [
	'flameShockUptime',
	'flameShockWaste',
	'flameShockMultiDot',
	'earthShockWaste',
	'elementalDischargeUptime',
	'searingTotemUptime',
	'lightningShieldOvercap',
	// The surge's own rung is `bands: [1, 2]` because `aoe.apl.json` carries no Lava Burst rung at all, so
	// a proc that expired inside an add wave was never a press to make. The audit cuts the denominator to
	// the same pair, which is why the declaration here and the number are one reading rather than two.
	'lavaSurgeWaste',
] as const;
const UNBANDED = [
	'gcdUtilisation',
	'searingTotemOverlaps',
	'fireElementalPrepull',
	'lightningShieldFellOff',
	'thunderstormMissed',
	'shamanisticRageMissed',
	'fireElementalHasteUptime',
	// Ascendance's four, and none of them takes a band. The button is on the bar at every target count and
	// the priority list presses it from the same two entries however many enemies are up — a rule about
	// *when* a cooldown goes down is not a rule a target count can exempt.
	'ascendanceOpener',
	'ascendanceIntoHaste',
	'ascendanceBanner',
	'ascendanceLatePresses',
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
	 * halves of each ratio intersected with it, 129 456ms of this pull's 263 233ms once the exemption moved
	 * onto the pull's own segments. Two consequences reach this panel, and they are worth telling apart:
	 *
	 *   - `flameShockUptime` **leaves, and it took two changes to get there.** The first cut took the figure
	 *     from 72.30% to 83.90% — a real improvement, and still 1.1 points under the 85% `ok` line, so the
	 *     card stayed. Moving the exemption from the raw three-or-more count to the segmentation took it to
	 *     86.79% over 132 216ms, past that line, and the card goes with it. The dot was dropped on the boss
	 *     too and neither cut hides that; what the second one stopped charging is the dot's state through
	 *     the stretches this pull was fought as AoE, where no list asks for it.
	 *   - `flameShockWaste` **leaves**, and not by exemption. Cutting the clocks let `shareOf`'s sample
	 *     floor be applied to it, and this pull made two Flame Shock refreshes all fight — under
	 *     `MIN_GRADED_SAMPLE`, so the metric declines instead of grading a 50% that was one press. Its
	 *     place on the panel goes to `lightningShieldOvercap`, which is a genuine fault on its own clock.
	 *     The sample is now **one**, not two, for the reason the test below this one gives: the second of
	 *     those refreshes was made at four enemies and is no longer counted. The refusal is the same; what
	 *     it is a refusal about is not.
	 *
	 * So one of the three cards is still the dot, and it is the one that should be: `flameShockMultiDot`
	 * read 16.64% before any cut, 18.73% under the count-derived exemption and 35.54% over the 34 783ms of
	 * genuine two-target time the segments leave it. Three readings of one habit, each over a shorter and
	 * more honest clock than the last, and every one of them `bad`. That card is a real fault rather than
	 * an artefact, and the report should keep saying so.
	 *
	 * `elementalDischargeUptime` takes the third place at 65.57% against a 90/80 pair — the tier-16 debuff's
	 * own uptime, a fault on a clock the exemption cut but did not create.
	 *
	 * **The letter under those three cards is now `ok` and not `bad`, and the cards did not move with it.**
	 * It moved when `fireElementalHasteUptime` was priced at 1: 42.31% of 13 points becomes 46.43% of 14,
	 * over the 45% line, on a rule this player passed — the argument, and the objection it had to answer,
	 * are on `score.ts`' `WEIGHTS`. The panel is asserted first here for that reason. This pull's three
	 * faults are unchanged and rule 5 is not among them; what changed is the mean they are averaged into.
	 */
	it('replaces one of cleave three Flame Shock cards once the clocks are cut', () => {
		expect(resolveBands(fixture('cleave').targets, 'auto').bands).toEqual([1, 2, 3, 4]);
		// **`gcdUtilisation` leads the panel and no card is the dot's uptime any more.** Two of the three
		// are unrelated to the clock cut: `gcdUtilisation`'s lines went from 80/65 to 95/90 and this pull
		// fills 89.18% of its globals, and `elementalDischargeUptime` is the tier-16 debuff at 65.57%.
		// `lightningShieldOvercap` is no longer among them — 14 275ms over the segmented clock is `ok`,
		// where 21 864ms over the counted one was `bad`.
		expect(panel('cleave', 'auto')).toEqual(['gcdUtilisation', 'flameShockMultiDot', 'elementalDischargeUptime']);
		// **`ok` since the tier-16 remaining check stopped reading a merged window's end.** That check
		// charged nearly every shock taken inside a long Elemental Discharge run — see `dischargeExpiry` —
		// and dropping the false faults lifts this pull's Earth Shock letter and the headline with it.
		expect(card('cleave', 'auto').overall).toBe('ok');
		// Still not one `exempt` among them: this pull visits every band, so the declarations remain inert
		// here and the whole of the movement above is the clock. That is the claim this file began with and
		// it is still true — it is only the panel that moved.
		for (const key of BANDED) expect(metric('cleave', 'auto', key)?.exempt, key).toBeUndefined();
		// And the metric that left did so by refusing, not by grading well.
		expect(metric('cleave', 'auto', 'flameShockWaste')?.unmeasurable).toBe(true);
		// And the metric that left the panel did so by *passing*, which is the other way off a panel and the
		// one this second cut produced: 86.79% is over the 85% `ok` line rather than 1.1 under it.
		expect(metric('cleave', 'auto', 'flameShockUptime')?.value).toBeCloseTo(86.794, 3);
		expect(metric('cleave', 'auto', 'flameShockUptime')?.grade).toBe('ok');
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
	 * The audit facts rather than the metric, deliberately: what the scorecard does with them is the next
	 * test's subject, and these two do not change either way.
	 *
	 * **And the press is out of the sample now, which is the last line here.** `FlameShockPress.judged` is
	 * false on it — the audit's own record that this press was made at a count `flameShockWaste`'s rule
	 * does not exist at — so the 50% above is a number the report no longer produces from it.
	 */
	it('grades cleave’s dot economy off one press made at four enemies', () => {
		const el = fixture('cleave');
		expect(el.flameShock.refreshes).toBe(2);
		const at = countAt(el.targets?.counts.points ?? []);
		const faulted = el.flameShock.presses.filter((press) => press.kind === 'early');
		expect(faulted).toHaveLength(1);
		expect(at(faulted[0]!.t)).toBe(4);
		expect(faulted[0]!.judged).toBe(false);
	});

	/**
	 * **The numerator per band, measured on the only pull that visits more than one band.**
	 *
	 * `bands: [1]` on the rule could not do this and this file's own opening paragraph says why: an
	 * intersection nulls a metric only when it comes out *empty*, and `cleave` resolves to `[1, 2, 3, 4]`.
	 * So the declaration was a control that controlled nothing, which this project has shipped once and
	 * fixed once. What narrows the sample is the audit — `FlameShockPress.judged` per press, counted out at
	 * `flameShock.unjudgedRefreshes` and `unjudgedWaste` — and this is that cut at the three pulls.
	 *
	 * **`cleave` separates and the other two deliberately do not.** Its two refreshes were made at one
	 * enemy and at four, so one of them is graded and the other is the faulted press the test above names.
	 * `phased` and `unbroken` never exceed one enemy: every refresh they made is judged, and both read
	 * exactly what they read before the cut — 25% `ok` off four, 33.33% `bad` off six.
	 *
	 * **What `cleave` does not do is start grading, and that is the finding rather than a shortfall.** One
	 * judged refresh is under `MIN_GRADED_SAMPLE` and two already were, so this pull refused before and
	 * refuses after; no metric here changes whether it grades, so no pull's graded count moves and
	 * `overall()` keeps its denominator (10 of 14 on all three, before and after). The floor is not lowered
	 * to keep a number on the page — at n=1 the reachable values are 0 and 100 and at n=2 they are 0, 50
	 * and 100, so neither scale has the interior most pulls belong in. What moved is the ground: the sample
	 * is one press the rule was about, where it was two presses of which one was at four enemies.
	 *
	 * The sample is asserted as a **derivation** and not as a pinned 1: it is the refreshes at one enemy,
	 * read off the same count series the audit reads. Drop the band clause from that expression and it
	 * gives 2 — the denominator this row was graded off before, and the 50% is `1/2`.
	 */
	it('narrows the dot economy sample to the refreshes a list asked the question at', () => {
		const el = fixture('cleave');
		const at = countAt(el.targets?.counts.points ?? []);
		const refreshes = el.flameShock.presses.filter((press) => press.remainingMs !== null);
		expect(refreshes).toHaveLength(2);
		const atOneEnemy = refreshes.filter((press) => at(press.t) <= 1);
		expect(atOneEnemy).toHaveLength(1);
		const fs = el.flameShock;
		expect(fs.unjudgedRefreshes).toBe(refreshes.length - atOneEnemy.length);
		expect(fs.unjudgedWaste).toBe(refreshes.filter((press) => at(press.t) > 1 && press.kind === 'early').length);
		expect([fs.unjudgedRefreshes, fs.unjudgedWaste]).toEqual([1, 1]);
		// The graded pair the metric is handed, and the pull-wide one the section prints, side by side: one
		// press of two faulted over two refreshes becomes none of one over one.
		expect(fs.refreshes - fs.windowed - fs.ascPrep - fs.snapshotGain).toBe(1);
		expect(fs.refreshes - fs.windowed - fs.ascPrep - fs.snapshotGain - fs.unjudgedWaste).toBe(0);
		const cleaveMetric = metric('cleave', 'auto', 'flameShockWaste');
		expect(cleaveMetric?.sampleSize).toBe(1);
		expect(cleaveMetric?.unmeasurable).toBe(true);

		// The two single-target pulls: nothing leaves the sample, because nothing was ever above one enemy.
		for (const [name, judged, waste, value, grade] of [
			['phased', 4, 1, 25, 'ok'],
			['unbroken', 6, 2, 33.333, 'bad'],
		] as const) {
			const single = fixture(name).flameShock;
			expect([single.refreshes, single.unjudgedRefreshes, single.unjudgedWaste], name).toEqual([judged, 0, 0]);
			expect(
				single.refreshes - single.windowed - single.ascPrep - single.snapshotGain - single.unjudgedWaste,
				name,
			).toBe(waste);
			const m = metric(name, 'auto', 'flameShockWaste');
			expect(m?.sampleSize, name).toBe(judged);
			expect(m?.unmeasurable, name).toBe(false);
			expect(m?.value, name).toBeCloseTo(value, 3);
			expect(m?.grade, name).toBe(grade);
		}
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
	 * And the headline refuses to be a headline over what is left: 6 of 19 points, all of them habit
	 * metrics and the summon's two rules, which is under `MIN_JUDGED_WEIGHT_SHARE`.
	 *
	 * One of the first three moves letter as well as meaning: `cleave` graded `bad` on that reading before
	 * and now parks at `ok`. The other two already read `ok`, and what changed for them is that the `ok` is
	 * now marked `judged.unmeasurable` — the value the report reads to say "cannot say" rather than
	 * printing a middling grade. A letter that stays put while its meaning inverts is the case a test on
	 * `overall` alone would have missed.
	 *
	 * **5 of 22 when this was written and 6 of 19 now**, because `fireElementalHasteUptime` was priced at 1
	 * and it is one of the rules that survives this reading — it declares no bands, so a pull read wholly
	 * as multi-target still owes it an answer. 6 of 19 is 26%, further under the floor than 5 of 22 was, so
	 * the refusal this test is about is if anything more firmly the answer than before.
	 *
	 * **`addsThenBoss` measures five and not six, and the missing one is `searingTotemOverlaps`.** That
	 * pull places no Searing Totem at all, so the `windows.length > 0` guard in front of that metric
	 * refuses it — a refusal that has nothing to do with bands and survives every reading. 5 of 19 is 22%,
	 * further under the floor still, so it makes the same point one notch harder rather than a different
	 * one. Written per pull, because a flat `toEqual` here is how the fourth pull's five would have been
	 * read as a regression rather than as a fact about its rotation.
	 *
	 * **`addsThenBoss` measures three now, and the two that left are `gcdUtilisation`'s.** That pull is
	 * Galakras, one of the three encounters `lib/reference/specProfile.ts` suppresses this metric on —
	 * tower duty takes the player out of contact by design, measured median contact share 82.7% against
	 * 94% or better on the other eleven, so the clock the figure divides by is the fight rather than the
	 * rotation. A suppressed metric is `unmeasurable`, so its two points leave the denominator at *every*
	 * reading, this one included. 3 of 24 is 12.5%, further under `MIN_JUDGED_WEIGHT_SHARE` again, and the
	 * refusal this test is about is unchanged. The other three pulls are unaffected: `cleave` is Blackfuse
	 * and the two Iron Juggernaut pulls are graded against their own reference rows, so all three still
	 * measure eleven.
	 */
	it('stops printing a whole-pull verdict over six of twenty-three points', () => {
		// **Eleven of twenty-four now, and the five that arrived are Ascendance's.** None of the four takes a
		// band, so a pull read wholly as multi-target still owes an answer on all of them — the same reason
		// `fireElementalHasteUptime` survives this reading. 11 of 24 is 46%, still under
		// `MIN_JUDGED_WEIGHT_SHARE`, so the refusal this test is about is unchanged. `addsThenBoss` stayed at
		// five because every one of its Ascendance presses came back refused, which is a fact about that
		// pull's own rotation rather than about the reading — and it is three now because Galakras suppresses
		// `gcdUtilisation` as well, which is a fact about the encounter rather than about either.
		const measured: Record<string, number> = { addsThenBoss: 3 };
		for (const name of ALL) {
			expect(card(name, 'multi').judged, name).toEqual({
				measured: measured[name] ?? 11,
				total: 26,
				unmeasurable: true,
			});
			expect(card(name, 'multi').overall, name).toBe('ok');
		}
		// Two cards at this reading and not one, for the same reason as above: `gcdUtilisation` is one of the
		// six metrics a `multi` card still measures, and 89.18% is a shortfall where 89.18% against 80/65 was
		// not. The line it falls short of has moved and the card has not: the fixed 95/90 became Blackfuse's
		// own p90/p50 of 95.01/92.32, over the five kills the reference holds for that fight, and 89.18% is
		// under both. The whole-pull letter is unmoved — the six are still under the floor.
		// `ascendanceLatePresses` has left this panel: `cleave`'s late press was pressed where the AoE list
		// was in force, so it is exempt rather than faulted and the metric reads zero. That is the exemption
		// working on the pull it was written for — a card telling a shaman to hold Ascendance for a proc the
		// list he was playing never buys.
		expect(panel('cleave', 'multi')).toEqual(['gcdUtilisation', 'lightningShieldFellOff']);
		// **`phased`'s panel was empty, then held two, and holds one again — and the middle state is the one
		// that was wrong.** `gcdUtilisation` earned a card at 94.44% only because the fixed `good` line was
		// 95, half a point above it, on every fight in the tier. Iron Juggernaut's own p90 is 94.16 over the
		// four kills the reference holds for it, so this pull is fractionally *above* the best that reference
		// has seen on this fight and grades `good` — and `panel` shows no card for a `good` metric. What is
		// left is `ascendanceLatePresses`, which was always the real fault here and was always ranked above
		// it: this pull's second Ascendance found too little Elemental Discharge to pair with, on a rule no
		// reading exempts. This is the Elemental's first `good` on this metric on any committed pull.
		expect(panel('phased', 'multi')).toEqual(['ascendanceLatePresses']);
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
	 * **12 of 19 and not 14**, which is two changes and not one. The multi-dot rule's two points leave
	 * because the reader declared one enemy — that is this test's own subject. `flameShockWaste`'s two leave
	 * for a different reason entirely: cutting the graded clocks let `shareOf`'s sample floor apply, and this
	 * pull's two refreshes are under it, so the metric declines at every reading rather than grading a 50%
	 * decided by one press.
	 *
	 * **This read 11 of 22 — exactly half — until `fireElementalHasteUptime` was priced at 1, and the loss
	 * of that coincidence is worth naming.** The old note leaned on it: 11 of 22 is the `>=` tie, so the
	 * letter printed by the narrowest possible margin and this pull was the live proof that
	 * `MIN_JUDGED_WEIGHT_SHARE` judges rather than refuses on a tie. Rule 5 declares no bands and survives
	 * every reading, so both sides gained a point: 12 of 19 is 52% and clears the floor outright. The tie
	 * case now has no committed pull sitting on it, and if it is to stay pinned it needs one of its own.
	 *
	 * **And the letter is `ok`, up from `bad`.** The arithmetic is written out rather than left to be
	 * re-derived. Before the declarations, over 13 points: the dot's uptime `bad` at weight 3, the waste
	 * `bad` at 2, Earth Shock `bad` and the shield's overcap `bad` at 1 each, the totem `ok` at 1, its
	 * overlaps and the pre-pull `good` at 1 each, the shield's fall-off `ok` at 1, globals `good` at 2 —
	 * 5.0 of 13, which is 38% and under the 45% line. After, over 12: the waste's two points are gone, the
	 * totem's uptime has crossed to `good` on its own cut clock, and rule 5 adds a `good` at 1 — 6.5 of 12,
	 * which is 54.17%.
	 *
	 * Both halves of that are the intended change and neither is a threshold being flattered: the totem
	 * genuinely was up for 88.5% of the time a list asked for one, and the waste genuinely cannot be graded
	 * off two presses. What the reader now sees on this pull is a fair `ok` over a smaller, honest
	 * denominator instead of a `bad` half of whose weight was add-wave time.
	 */
	it('drops the spreading rule from a pull read as single-target and lifts its letter', () => {
		// Seventeen of twenty-four: the twelve this test was written on, plus Ascendance's five, which no
		// reading exempts. The narrowing this test is about — the spreading rule leaving a single-target
		// reading — is the gap between this and the nineteen `auto` measures.
		expect(card('cleave', 'single').judged).toEqual({ measured: 19, total: 26, unmeasurable: false });
		// **`ok`, and it has been round the houses.** It read `ok` before any of this, `bad` once
		// `gcdUtilisation` went to 95/90, and `ok` again now that Ascendance's four rules are on the card:
		// this pull's opener is clean on all three of the demands made of it and only its second press is
		// faulted, so the section adds four points of `good` weight against one of `bad`.
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
	 * The seven rules with no band, still asked of every pull at every reading — including the reading that
	 * exempts the other seven.
	 *
	 * This is the half that keeps "the exception applies globally" from meaning "an add fight is not
	 * graded". A pool that empties, a shield that falls off, a global that goes unfilled, a totem placed
	 * under the elemental and a summon that was not out at the pull are all the same fault at one enemy
	 * and at thirteen.
	 *
	 * **Cannot go red against the old behaviour**, because before this change no rule in the table had a
	 * band and nothing was exempt anywhere. What it pins is the shape of the table going forward — and the
	 * partition test above is what makes that promise keepable: this loop only visits what the lists name,
	 * so on its own it could never have caught a rule added to neither.
	 */
	it('accounts for every rule in the table, so neither list can go stale', () => {
		// The half the old guard could not do. `BANDED` and `UNBANDED` are hand-written, so a rule declared
		// in `THRESHOLDS` and named in neither was never visited by the loop below — which is how rule 5
		// landed unbanded with this file still saying "six". Asserted as a partition, both directions, so a
		// new rule fails here whichever way it is declared.
		const declared = Object.keys(THRESHOLDS).sort();
		const listed = [...BANDED, ...UNBANDED].sort();
		expect(listed).toEqual(declared);
		// And they must not overlap: two sorted lists of equal content would also satisfy the line above if
		// one key appeared in both and another in neither.
		expect(BANDED.filter((k) => (UNBANDED as readonly string[]).includes(k))).toEqual([]);
	});

	it('keeps asking the seven rules that are not about a list', () => {
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
	 * the fire-totem slot — so the fault is a slot fact rather than a list fact. Graded on the three pulls
	 * that place a totem at all, at all three readings, and `good` on every one of them, so the ruling
	 * costs nothing measurable today: those three placed seven totems (2, 2 and 3) and none of them under
	 * the elemental.
	 *
	 * **`addsThenBoss` places none, and it is asserted as a refusal rather than skipped.** Zero presses
	 * means `searingTotem.windows` is empty, and the guard in front of the metric returns null — so the
	 * declaration being tested here is not what makes it unmeasurable on that pull, and the metric's
	 * `feOverlaps` of 0 is a true zero over an empty clock rather than a clean sheet. This is the
	 * distinction the whole `Measured` mechanism exists for, and pinning it here is what stops a later
	 * reader from citing that pull as a fourth `good`.
	 *
	 * **Cannot go red against the old behaviour**, for the same reason as the guard above: this is the
	 * decision *not* to declare, and the old behaviour is the same absence. It is here so that the plan
	 * that asked for `bands: [1, 2]` here cannot be quietly carried out later without a red test and an
	 * argument.
	 */
	it('grades a totem under the elemental at every count', () => {
		let graded = 0;
		for (const name of ALL) {
			const el = fixture(name);
			const placed = el.searingTotem.presses.length > 0;
			for (const choice of ['auto', 'single', 'multi'] as const) {
				const m = metric(name, choice, 'searingTotemOverlaps');
				expect(m?.unmeasurable, `${name}/${choice}`).toBe(!placed);
				expect(m?.value, `${name}/${choice}`).toBe(0);
				// Never exempt, on any pull: this rule declares no bands, which is the ruling.
				expect(m?.exempt, `${name}/${choice}`).toBeUndefined();
				if (placed) graded++;
			}
			expect(el.searingTotem.feOverlaps, name).toBe(0);
		}
		// Three pulls at three readings, so the loop above is not a set of nine refusals.
		expect(graded).toBe(9);
		expect(fixture('addsThenBoss').searingTotem.presses).toEqual([]);
		expect(ALL.map((name) => fixture(name).searingTotem.presses.length).reduce((a, b) => a + b, 0)).toBe(7);
	});

	/**
	 * **The heaviest rule in the table, measured on the one pull that can say anything about it — and the
	 * two independent reasons it still refuses, told apart.**
	 *
	 * This test was called *"has no pull that can test the snapshot rule at all"* and asserted
	 * `refreshed + missed === 0` and `sampleSize === 0` across `ALL`. Both halves of that were false as
	 * soon as `addsThenBoss.json` was committed, and neither went red, because `ALL` was a literal list
	 * of the three pulls that predate it. The claim that survived on a false premise was *"none of them
	 * ever wore a trigger and an int proc at the same moment"*: that pull's shaman wears both.
	 *
	 * ## What is actually there, per pull
	 *
	 * `phased`, `unbroken` and `cleave` open **no window at all**. Nobody on those three wears a trigger
	 * — Wushoolay's Final Choice and Black Blood of Y'Shaarj are the only two the audit builds a trigger
	 * series from — so `snapshotWindows` is empty and the denominator is genuinely nothing.
	 *
	 * `addsThenBoss` opens **six**, every one of them off `uvls-stacks`:
	 *
	 *   - the counter (138788, "Electrified") reaches **ten stacks thirteen times**, each of those a
	 *     window about a second wide before the whole set falls off;
	 *   - the int-proc side is Breath of the Hydra (138898, **nine** windows) and Tempus Repit (137590,
	 *     **sixteen**); Cha-Ye's is not worn. Six of the thirteen trigger windows overlap one of those,
	 *     and it is the overlap the p5 rung actually asks about;
	 *   - **five of the six opened with the dot down.** The primary is on a tower for the first seven
	 *     minutes and `flameShock.windows` is the single span `[442 020, 560 218]`, so the five windows at
	 *     16 025, 26 834, 163 224, 265 710 and 418 471ms were never chances to refresh anything. The audit
	 *     counts them as neither caught nor missed, which is the `inWindow(window.start, fsMerged)` line —
	 *     and that is the right call, not a gap: a window the dot was down through is not a window the
	 *     player declined;
	 *   - the sixth, at 532 012ms, was **caught** — the press at 532 772ms with 8 320ms of dot left.
	 *
	 * So the audit reads `refreshed: 1, missed: 0` and `shareOf` hands over `1/1`.
	 *
	 * ## Which blocker stops it, because they are not the same one
	 *
	 * `metricOf` has two independent refusals in play here and the difference is the whole finding:
	 *
	 *   - on the three empty pulls the denominator is **zero**, so `sharePct` returns null *and*
	 *     `sampleSize` is under the floor. Either alone would refuse.
	 *   - on `addsThenBoss` the denominator is **one**. There is a real share — 100% — and what refuses
	 *     it is `MIN_GRADED_SAMPLE` alone, asserted against the constant below rather than against a
	 *     literal 3.
	 *
	 * And it is **not** the band declaration on any of the four: `bands: [1]` exempts only on an empty
	 * intersection, and this pull resolves to `[1, 2, 3, 4]`. `exempt` is asserted absent so a later
	 * reader cannot mistake the refusal for the declaration doing work.
	 *
	 * ## What a fixture would have to have
	 *
	 * **Not "several proc windows" — this pull has six.** Three windows *with the dot already up* is the
	 * bar, and this pull has one. Stated because it is the sentence a reader consults before going
	 * looking, and the old one pointed at the wrong shortfall.
	 */
	it('reads the snapshot windows the log offered, on the one pull that has any', () => {
		const claimable = (name: string): number[] => {
			const el = fixture(name);
			return el.snapshots.windows
				.filter((w) => el.flameShock.windows.some((dot) => w.start >= dot.start && w.start <= dot.end))
				.map((w) => w.start);
		};

		// The three that predate the fourth: no window, so no denominator either way.
		for (const name of ['phased', 'unbroken', 'cleave'] as const) {
			const el = fixture(name);
			expect(el.snapshots.windows, name).toEqual([]);
			expect([el.snapshots.refreshed, el.snapshots.missed], name).toEqual([0, 0]);
		}

		// And the fourth, which has six windows, one of them claimable, and that one caught.
		const adds = fixture('addsThenBoss');
		expect(adds.snapshots.windows.map((w) => w.start)).toEqual([16_025, 26_834, 163_224, 265_710, 418_471, 532_012]);
		expect([...new Set(adds.snapshots.windows.map((w) => w.source))]).toEqual(['uvls-stacks']);
		expect(adds.flameShock.windows).toEqual([{ start: 442_020, end: 560_218 }]);
		expect(claimable('addsThenBoss')).toEqual([532_012]);
		expect([adds.snapshots.refreshed, adds.snapshots.missed]).toEqual([1, 0]);
		// Caught, not merely uncounted: the refresh inside the window, with the dot it went into.
		expect(
			adds.flameShock.presses
				.filter((press) => press.remainingMs !== null && press.t >= 532_012 && press.t <= 533_006)
				.map((press) => [press.t, press.kind, press.remainingMs]),
		).toEqual([[532_772, 'snapshot', 8320]]);
		// No fault printed for any of the five the dot was down through.
		expect(adds.misses.filter((miss) => miss.kind.startsWith('Snapshot'))).toEqual([]);

		// **The metric this block used to end on is gone.** `flameShockSnapshots` graded the share of
		// claimable windows caught, was unmeasurable on all four committed pulls at every reading, and
		// carried the heaviest weight on the card while never deciding anything. It went with the Snapshots
		// section: the proc windows are the dot's own payoff and `FlameShock` already draws them. What
		// stays asserted above is the *analysis* — the windows, the claimable one, the refresh inside it —
		// because that is a reading of the log rather than a verdict on the player.
	});
});

describe('the denominator travels with the verdict', () => {
	/**
	 * `overallOf` rather than `overall`, so a `good` over half the spec cannot print as a whole-pull one.
	 *
	 * Under its own reading `cleave` judges **14** of 19 and the two single-target pulls judge 14 — they
	 * never offered a second target, a snapshot window or a mana reading, and `flameShockMultiDot` is now
	 * unasked on them rather than merely unanswerable. `addsThenBoss` judges **15**, off a different set:
	 * it gains `flameShockWaste` and `shamanisticRageMissed`, and loses `searingTotemOverlaps` and the
	 * summon's haste, which is worth stating because a count over a different set is exactly what a
	 * bare total hides. Both lists are asserted below rather than described. All four are above `MIN_JUDGED_WEIGHT_SHARE`, so every real pull we hold keeps its
	 * grade, which is the claim that floor was chosen to make.
	 *
	 * **`addsThenBoss` is the one that moved, and it moved by keeping a rule it used to drop.** It never
	 * laid a Searing Totem, and `searingTotemUptime` used to refuse on that — a `windows.length > 0` clause
	 * in front of the percentage — so a pull that got the habit wholly wrong left the numerator instead of
	 * being marked down for it. The percentage is nought over 226.9s the audit had already ruled gradable,
	 * which is a reading rather than an absence, so the rule is answered and the point is collected. Its
	 * sibling `searingTotemOverlaps` still declines, and honestly: no press was laid under the elemental
	 * because no press was laid at all.
	 *
	 * `cleave` was 15 of 22 when the declarations landed and 13 of 22 after them: `flameShockWaste` carries
	 * weight 2 and left the denominator, because cutting the graded clocks let `shareOf`'s sample floor apply
	 * and this pull made only two Flame Shock refreshes. **That is the honest direction for it to move** —
	 * the two points were being spent on a 50% that one press decided — but it is a real narrowing of what
	 * the header can claim.
	 *
	 * Both sides then gained one when `fireElementalHasteUptime` was priced at 1, on the three pulls held
	 * then: it declares no bands and it is measurable on every one of those, so it enters the offered
	 * weight and the judged weight together. It is *not* measurable on `addsThenBoss`, whose raid lusted at
	 * 438 207ms — that pull pays the offered weight and does not collect the judged half. 14 of 19 is 61%,
	 * so the grade still prints — and the *share* barely moved, which is the point of reading this as a
	 * fraction rather than a count.
	 *
	 * **`addsThenBoss` moved again, from 15 to 13, and the two points are `gcdUtilisation`'s.** That pull is
	 * Galakras, and Galakras is one of the three encounters `lib/reference/specProfile.ts` suppresses this
	 * metric on: tower duty takes the player out of contact by design — measured median contact share 82.7%
	 * against 94% or better on the other eleven — so the clock the figure divides by is the fight rather
	 * than the rotation, and the report prints the 83.38% without a letter. This is the *fourth* rule that
	 * pull pays offered weight for and collects nothing on, and the only one refused by the encounter rather
	 * than by the pull's own rotation, which is worth keeping distinct in a file about denominators. 13 of
	 * 24 is 54%, still over `MIN_JUDGED_WEIGHT_SHARE`, so the header still prints a grade and the claim this
	 * test makes is unchanged. The other three keep nineteen: Blackfuse and Iron Juggernaut are graded
	 * against their own reference rows and neither is suppressed.
	 */
	it('publishes what each pull was judged on', () => {
		for (const name of ALL) {
			// Nineteen of twenty-four on the three pulls whose Ascendance presses could be judged, and thirteen
			// on `addsThenBoss`, which pays the four new rules' offered weight and collects none of it — its
			// opener came back `nothing-to-hit` and every later press `no-two-piece-evidence`. The same shape
			// `fireElementalHasteUptime` already had on that pull, and for a similar reason. Two more of its
			// points are `gcdUtilisation`'s, suppressed because the pull is Galakras — see the note above.
			expect(card(name, 'auto').judged, name).toEqual({
				measured: name === 'addsThenBoss' ? 14 : 21,
				total: 26,
				unmeasurable: false,
			});
		}
		// Not the same fourteen. Named so that the equal count above cannot be read as an equal set.
		const unmeasurableOn = (name: string): string[] =>
			metrics(name, 'auto')
				.filter((m) => m.unmeasurable)
				.map((m) => m.key)
				.sort();
		// Ascendance's four join the list on this pull and on no other, which is the same asymmetry
		// `fireElementalHasteUptime` already shows here: the opener came back `nothing-to-hit` and every
		// later press `no-two-piece-evidence`, so all four rules are offered and none is collected.
		// `gcdUtilisation` joins for a different reason and the difference is the point of naming the set
		// rather than counting it: the other six are refused by this pull's rotation, and that one is
		// refused by the *encounter* — Galakras is suppressed for this metric, on every spec and every
		// reading, because it takes the player out of contact by design.
		expect(unmeasurableOn('addsThenBoss')).toEqual([
			'ascendanceBanner',
			'ascendanceIntoHaste',
			'ascendanceLatePresses',
			'ascendanceOpener',
			// The shaman on this pull writes no 144999 at all, so the tier-16 debuff's clock is empty and the
			// metric is refused rather than scored nought — the set gate, doing the job it was put at the
			// audit for. It is the only one of the four pulls without the two-piece.
			'elementalDischargeUptime',
			'fireElementalHasteUptime',
			'gcdUtilisation',
			'searingTotemOverlaps',
			'thunderstormMissed',
		]);
		expect(unmeasurableOn('cleave')).toEqual(['flameShockWaste', 'shamanisticRageMissed', 'thunderstormMissed']);
	});

	/**
	 * **The free pass this file documented is now closed, and this still pins how far out of reach it is on
	 * what we hold.**
	 *
	 * `lightningShieldOvercap` grades a clock the audit cuts, and on a pull with no band-1-or-2 stretch at
	 * all that clock is empty, where `0ms of overcap over 0ms` grades `good`. The guard is
	 * `gradedOver(overcapMs, gradedMs)` and `gradedMs` is now a published field, so the refusal happens.
	 *
	 * It still cannot be *exercised* here: all four pulls spend most of themselves at one or two enemies,
	 * so the graded clock is 258 304ms, 184 448ms, 180 375ms and 334 148ms — `addsThenBoss` reaches nine
	 * enemies and is still 61% of its own length inside band 1 or 2. So this test keeps its original job — it
	 * records that no committed pull reaches the hazard, which is how a later reader tells an untested
	 * guard from an absent one. The pull that does reach it is synthetic and lives in
	 * `lib/__tests__/bandedClocks.test.ts`, which is where the refusal itself is asserted.
	 */
	it('has no pull whose shield clock the exemption could empty', () => {
		for (const name of ALL) {
			const el = fixture(name);
			const aoeMs = el.lightningShield.exemptWindows.reduce((total, w) => total + (w.end - w.start), 0);
			expect(el.durationMs - aoeMs, name).toBeGreaterThan(0);
			expect(metric(name, 'auto', 'lightningShieldOvercap')?.unmeasurable, name).toBe(false);
		}
	});
});
