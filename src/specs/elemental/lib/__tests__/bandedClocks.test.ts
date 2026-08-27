// The four graded clocks drop the stretches no list had a rule for, and an empty clock refuses to grade.
//
// This is the half of the band exemption that changes a number, and until it landed the other half
// presented as band-aware while forgiving nothing. `MetricRule.bands` nulls a metric only when the band
// intersection comes out **empty** — a pull that never visited the rule's bands at all — so on the mixed
// pull the whole exercise is about it does nothing: `cleave` resolves to `[1, 2, 3, 4]`, every declaration
// intersects non-empty, and every clock carried on grading add-wave time exactly as before.
// `lib/score/bands.ts` says as much in its own words: "Nothing here decides *how much* of a clock to cut."
//
// So the cut is the audit's, and there are two claims to pin:
//
//   1. **Both halves of every ratio are cut with the same array.** Clipping a numerator and not its
//      denominator is how a percentage above 100 happens, and `flameShock.uptimePct` has already produced
//      one that way — the 100.21% its own docblock dissects at length.
//   2. **An empty clock says "cannot say" rather than grading.** `0ms` of overcap over `0ms` of gradable
//      time is a perfect zero against a `good: 0` threshold — the best mark on the card, handed to exactly
//      the pull the exemption just excused. That is the free pass this whole effort would otherwise have
//      *created*, and no proxy catches it: `maxStacks > 0` is true of such a pull, because the shield was
//      up and counting the whole way through.
//
// `phased` and `unbroken` never exceed one enemy, so every assertion about them here is a no-change guard
// and is labelled as one.
//
// **`cleave` used to be "the only committed fixture with band-3+ time", and it is not any more.**
// `addsThenBoss.json` peaks at nine enemies with 73.73% of the pull at two or more, so it carries band-3
// and band-4 presses too — and it is the better half of the pair, because `cleave` holds one shape for its
// whole 263 s while `addsThenBoss` runs add waves out to 503 s and then a boss-only tail. The loops below
// are derivations rather than pinned figures, so they now run over both; the per-pull literals beside them
// are still `cleave`'s and are still labelled as its own.
//
// **The fourth clock is shaped differently from the other three and has its own describe block.**
// `flameShockMultiDot` declares `bands: [2]` and not `[1, 2]`, so `gradedSpans` is a *ceiling* over a clock
// that already carried a floor: the cut is `intersect(multiTargetWindows, gradedSpans)` — the core's `>= 2`
// series less its `>= 3` one — and what survives is band 2 and nothing else. Two count series and not one,
// which is the piece of arithmetic that needed pinning; the committed fixtures cannot isolate it, so two
// hand-built pulls do.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { complementOf, type Interval, intersect, unionMs } from '~/lib/analysis/intervals';
import { intervalsAtLeast } from '~/lib/analysis/targets';
import type { WclEvent } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset, Window } from '~/lib/types';

import { rawFixtures } from '~/lib/analysis/fixtures';
import { analyse, ELEMENTAL_SPEC } from '../index';
import { scoreAnalysis } from '../score';

/**
 * Every raw Elemental pull, found rather than listed.
 *
 * **This was `['phased', 'unbroken', 'cleave']` with a three-entry `Record` built eagerly beside it**, and
 * the seven loops below all swept it. Every one of them is a derivation — the audit's published clock
 * against the clock rebuilt from the arrays the chart reads — so they are exactly the assertions a fourth
 * pull should be asked, and exactly the ones a literal list stopped asking the day `addsThenBoss.json`
 * landed. The pinned figures beside them stay per-pull literals, because those are facts about one log.
 */
const FIXTURES = rawFixtures('elemental').map(({ name }) => name.replace(/\.json$/, ''));

const load = (name: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;

/**
 * One analysed pull, **memoised** — and the memo is what makes the sweep affordable.
 *
 * The `Record` this replaced parsed and analysed three fixtures at module load whether a test wanted them
 * or not. Sweeping four means one of them is the 4.4 MB `addsThenBoss.json`, and seven loops over it would
 * re-parse the file dozens of times; `bands.test.ts` hit the same wall and got *faster* for memoising.
 * Nothing here mutates an analysis, so one instance per pull is safe.
 */
const cache = new Map<string, Analysis & ElementalAuditResult>();
const fx = (name: string): Analysis & ElementalAuditResult => {
	const hit = cache.get(name);
	if (hit !== undefined) return hit;
	const analysis = analyse(load(name)) as Analysis & ElementalAuditResult;
	cache.set(name, analysis);
	return analysis;
};

const toIntervals = (windows: readonly Window[]): Interval[] => windows.map((w) => [w.start, w.end]);

/**
 * The graded stretches, re-derived in the test off two arrays the analysis publishes for other reasons.
 *
 * Deliberately **not** read back off a field the audit exposes for this purpose: an assertion whose two
 * sides both come from the thing under test passes whatever that thing says. `contactSegments` is the
 * timeline's own array and `lightningShield.aoeWindows` is the one the chart greys, so this reconstructs
 * the clock from the reader's view of the pull and then demands the audit agree.
 *
 * It also degenerates the right way, which is what makes it a signature rather than a renumbering: with
 * no AoE stretches `complementOf` is the whole pull and this collapses to `unionMs(contactSegments)` —
 * exactly the assertion this file's predecessors made, so the two single-target fixtures are pinned to
 * the identical figure before and after the change.
 */
const gradedContact = (a: Analysis & ElementalAuditResult): Interval[] =>
	intersect(a.timeline?.contactSegments ?? [], complementOf(toIntervals(a.lightningShield.aoeWindows), a.durationMs));

describe('the graded clocks drop the stretches three or more enemies were up', () => {
	/**
	 * Flame Shock's denominator, derived rather than pinned.
	 *
	 * `cleave` loses 82 758ms of a 261 572ms clock — the 82 858ms exempt array less the 100ms of it that
	 * fell outside the contact clock anyway. That is the *trimmed* exemption: `fbc4963` cut a window of
	 * trailing boss-only time off the end of every add wave, worth 27 011ms, so any figure quoted for this
	 * before that commit is 109 869ms and does not describe this behaviour.
	 */
	it('measures the dot over contact time less the AoE stretches', () => {
		for (const name of FIXTURES) {
			expect(fx(name).flameShock.scoredMs, name).toBe(unionMs(gradedContact(fx(name))));
		}
		// And the figure itself, so a derivation that quietly went to zero on both sides cannot pass.
		// 82 758 and not the 82 858 of the exempt array: 100ms of it lies outside the contact clock, which
		// was already dropping that stretch for its own reason. Subtracting the array's whole length here
		// would be the double-count `intersect` exists to avoid.
		expect(fx('cleave').flameShock.scoredMs).toBe(261_572 - 82_758);
		// The two single-target pulls: unchanged, because there is nothing to drop. Non-vacuous — both
		// carry a real clock, and `phased`'s is 32.7s short of its engaged time for a different reason.
		expect(fx('phased').flameShock.scoredMs).toBe(206_557);
		expect(fx('unbroken').flameShock.scoredMs).toBe(181_775);
	});

	/**
	 * The totem's denominator, which had two exempt causes composed into it already and now has three.
	 * The Fire Elemental's window and the intermissions were always out; the add waves are the new one.
	 */
	it('measures the totem over contact time less the elemental and less the AoE stretches', () => {
		for (const name of FIXTURES) {
			const audit = fx(name).searingTotem;
			const slotFree = complementOf(toIntervals(audit.feWindows), fx(name).durationMs);
			expect(audit.scoredMs, name).toBe(unionMs(intersect(gradedContact(fx(name)), slotFree)));
		}
		// `phased` and `unbroken` unchanged — no-change guards, and both are well clear of zero.
		expect(fx('phased').searingTotem.scoredMs).toBe(150_310);
		expect(fx('unbroken').searingTotem.scoredMs).toBe(125_314);
	});

	/**
	 * The shield's clock, and the only one of the three whose length had no published field at all before
	 * this. The array was published, the overcap was measured inside it, and the length — the one number
	 * that can tell "nothing to fault" from "nothing judged" — was not.
	 *
	 * **Contact is the second cut, and it arrived late.** This clock read the aoe complement alone while
	 * the two beside it were already narrowed to the stretches the player was hitting something, so a
	 * shaman with no enemy in range was charged for a shield they had nothing to spend — Earth Shock needs
	 * a target. Nothing argued for the difference; it is the oldest of the three clocks and was simply
	 * never revisited. Found on the Galakras kill `a:yCp2XW1mYqbDjhwJ` fight 17, where it was worth 18.4%,
	 * 43.9%, 65.1% and 7.5% of four Elemental shamans' overcap.
	 */
	it('publishes the length of the clock the overcap was measured inside', () => {
		for (const name of FIXTURES) {
			const a = fx(name);
			expect(a.lightningShield.gradedMs, name).toBe(unionMs(gradedContact(a)));
		}
		expect(fx('cleave').lightningShield.gradedMs).toBe(178_814);
		// Contact time rather than the whole pull on the two that never leave one enemy, which is the half
		// of the change these two carry: their aoe array is empty, so every millisecond dropped here is a
		// millisecond with nothing in range.
		expect(fx('phased').lightningShield.gradedMs).toBe(206_557);
		expect(fx('unbroken').lightningShield.gradedMs).toBe(181_775);
		expect(fx('phased').lightningShield.gradedMs).toBeLessThan(fx('phased').durationMs);
		expect(fx('unbroken').lightningShield.gradedMs).toBeLessThan(fx('unbroken').durationMs);
	});

	/**
	 * **One array, not three.** The dot's clock, the totem's and the shield's are all cut by the same
	 * derivation, and the shield's exempt array is the one the chart greys — so a reader shown a grey
	 * stretch on one section is looking at time all three denominators refused. Three copies of
	 * `complementOf(aoeWindows, duration)` would be three chances for one to drift, which is the identity
	 * `exemptTrack.test.ts` enforces a level out from here, among the charts.
	 */
	it('cuts all three clocks with the same stretches', () => {
		const a = fx('cleave');
		const exempt = toIntervals(a.lightningShield.aoeWindows);
		// The shield's clock and the dot's are now the same derivation — contact less the add waves — so
		// they are equal rather than nested, and the totem's is that narrowed once more by the elemental's
		// window. Equality is the stronger statement and the one that would break first if either grew a
		// cut of its own.
		expect(a.lightningShield.gradedMs).toBe(a.flameShock.scoredMs);
		expect(a.searingTotem.scoredMs).toBeLessThan(a.flameShock.scoredMs);
		// Both are strictly inside the aoe complement, which is what the contact cut buys over it.
		expect(a.lightningShield.gradedMs).toBeLessThan(a.durationMs - unionMs(exempt));
		// And no clock retains a single millisecond of exempt time.
		expect(unionMs(intersect(gradedContact(a), exempt))).toBe(0);
	});
});

describe('both halves of every ratio are cut with the same array', () => {
	/**
	 * The property the 100.21% bug was, stated as a test: a share whose numerator was clipped by one array
	 * and whose denominator was clipped by another is free to exceed 100%, and a band cut applied to one
	 * half only is that same defect with a new cause.
	 */
	it('keeps every uptime a real share of its own published clock', () => {
		for (const name of FIXTURES) {
			const { flameShock, searingTotem } = fx(name);
			expect(flameShock.contactUptimeMs, name).toBeLessThanOrEqual(flameShock.scoredMs);
			expect((flameShock.contactUptimeMs / flameShock.scoredMs) * 100, name).toBe(flameShock.uptimePct);
			expect(flameShock.uptimePct, name).toBeLessThanOrEqual(100);

			expect(searingTotem.uptimeMs, name).toBeLessThanOrEqual(searingTotem.scoredMs);
			expect((searingTotem.uptimeMs / searingTotem.scoredMs) * 100, name).toBe(searingTotem.uptimePct);
			expect(searingTotem.uptimePct, name).toBeLessThanOrEqual(100);
		}
	});

	/**
	 * And the numerator really did move — the half it would be easy to leave behind, and the one whose
	 * omission the percentage would not reveal until it crossed 100.
	 *
	 * On `cleave` the dot's numerator loses 39 088ms — from 189 111 to 150 023 — which is the dot that was
	 * up while three or more enemies were being hit. Less than the 82 758ms the denominator lost, and that
	 * asymmetry is the finding rather than a discrepancy: through the add waves this player's dot was up
	 * for 47% of the time against 72% over the pull as a whole, which is exactly why the old figure read
	 * those stretches as the pull's largest fault.
	 */
	it('moves the numerator as well as the denominator on the pull that has AoE time', () => {
		expect(fx('cleave').flameShock.contactUptimeMs).toBe(150_023);
		// The two single-target pulls keep theirs to the millisecond — no-change guards.
		expect(fx('phased').flameShock.contactUptimeMs).toBe(202_842);
		expect(fx('unbroken').flameShock.contactUptimeMs).toBe(181_775);
	});
});

// -------------------------------------------------------- the clock cut at both ends

/**
 * The band-2 clock, rebuilt from the reader's two published series rather than read off the field it is
 * asserting.
 *
 * `targets.counts.points` *is* the core's `targetPoints` — the series the target-count chart draws — and
 * `lightningShield.aoeWindows` is the array the sections grey. So this reconstructs "two enemies up, and
 * not three" out of what a reader can see and then demands the audit agree with it, rather than dividing
 * one of the audit's numbers by another.
 *
 * **It degenerates the right way, which is what makes it a signature rather than a renumbering.** With no
 * AoE stretches `complementOf` is the whole pull and this collapses to
 * `unionMs(intervalsAtLeast(points, 2, durationMs))` — the core's `multiTargetMs`, which is exactly what
 * this field used to be. Every pull with a second target and no third therefore keeps its old figure to
 * the millisecond, which is the property `immuneTargets.test.ts` pins at 55 000ms from the other side.
 */
const bandTwo = (a: Analysis & ElementalAuditResult): Interval[] =>
	intersect(
		intervalsAtLeast(a.targets?.counts.points ?? [], 2, a.durationMs),
		complementOf(toIntervals(a.lightningShield.aoeWindows), a.durationMs),
	);

describe('the second dot is measured over band 2 alone', () => {
	/**
	 * **The premise the whole block rests on, and the one nothing here used to assert: the Elemental's two
	 * target-count series are the same array.**
	 *
	 * `mdGraded` is `intersect(multiTargetWindows, gradedSpans)`, and it is the only expression in the spec
	 * that reads *both* series at once — the floor off `targetPoints` (the **evidence** series, every landed
	 * hit) and the ceiling off `aplTargetPoints` (the **ladder's**, the same hits less the spec's own area
	 * damage). `e9a001a` wrote down why that pairing is right rather than mixed up: a question about which
	 * rung of the priority list applied reads the ladder's series, a question about whether there was an
	 * enemy there reads the evidence one, and this clock asks one of each — was there a second target to dot
	 * (evidence), and was the list still asking for a second dot (ladder). The expression's own docblock
	 * carries the argument at length; this is the fact that makes it currently untestable.
	 *
	 * Because Elemental declares no `aplTargetCountExclude`, `aplTargetPoints` *is* `targetPoints`, so no
	 * fixture and no hand-built pull in this file can tell the pairing from either single-series reading.
	 * Every figure below is therefore silent on which series each edge came off — and the day this spec
	 * excludes an ability, `mdGraded` starts straddling two genuinely different arrays with nothing going
	 * red. **This is that tripwire.** When it fails, the exclusion is real and `mdGraded` in `lib/index.ts`
	 * needs re-reading against the rule above before its figures are believed; the pattern for separating
	 * the two series is `lib/analysis/__tests__/targetSeries.aplBands.test.ts`.
	 *
	 * `cleave` at thirteen enemies is the strong half: this is two populated series agreeing point for
	 * point, not two empty ones.
	 */
	it('reads one count series under both edges, because this spec excludes nothing from the ladder\u2019s', () => {
		expect(ELEMENTAL_SPEC.aplTargetCountExclude).toBeUndefined();
		expect(fx('cleave').targets?.counts.max).toBe(13);
		for (const name of FIXTURES) {
			const targets = fx(name).targets;
			expect(targets?.aplCounts?.points, name).toEqual(targets?.counts.points);
			expect(targets?.aplCounts?.max, name).toBe(targets?.counts.max);
		}
	});

	/**
	 * The denominator, derived and then pinned so a derivation that quietly went to zero on both sides
	 * cannot pass.
	 *
	 * `cleave` loses the **whole** 82 858ms exempt array, not a part of it, and that exactness is a finding
	 * rather than a coincidence: every millisecond the ladder read as three-or-more enemies was also a
	 * millisecond the damage series read as two-or-more, so the two edges nest and the subtraction is
	 * clean. The dot's own clock lost 82 758ms of its 82 858 for want of 100ms of contact; this one has no
	 * contact term to lose it to.
	 */
	it('measures the second dot over the time two enemies were up, less the AoE stretches', () => {
		for (const name of FIXTURES) {
			expect(fx(name).flameShock.multiTargetMs, name).toBe(unionMs(bandTwo(fx(name))));
		}
		// 148 865ms was the whole band-2-or-more clock and the figure this field used to publish.
		expect(unionMs(intervalsAtLeast(fx('cleave').targets?.counts.points ?? [], 2, fx('cleave').durationMs))).toBe(
			148_865,
		);
		expect(fx('cleave').flameShock.multiTargetMs).toBe(148_865 - 82_858);
		// The exempt array nests inside the band-2-or-more clock, which is why the line above subtracts all
		// of it rather than the part that overlapped.
		const exempt = toIntervals(fx('cleave').lightningShield.aoeWindows);
		expect(
			unionMs(
				intersect(intervalsAtLeast(fx('cleave').targets?.counts.points ?? [], 2, fx('cleave').durationMs), exempt),
			),
		).toBe(unionMs(exempt));
		// No-change guards: neither single-target pull ever reaches two enemies, so there was never a clock
		// here to cut and there is none now.
		expect(fx('phased').flameShock.multiTargetMs).toBe(0);
		expect(fx('unbroken').flameShock.multiTargetMs).toBe(0);
	});

	/**
	 * And the numerator came off the same array, which on this pull is 12 407ms of the secondary's dot that
	 * was up while three or more enemies were being hit.
	 */
	it('cuts the second dot itself with the same array', () => {
		expect(fx('cleave').flameShock.multiDotUptimeMs).toBe(24_769 - 12_407);
		for (const name of FIXTURES) {
			const { flameShock } = fx(name);
			expect(flameShock.multiDotUptimeMs, name).toBeLessThanOrEqual(flameShock.multiTargetMs);
			expect(flameShock.multiDotUptimePct, name).toBeLessThanOrEqual(100);
		}
		// A real share of its own published clock, on the one fixture that has one.
		expect((fx('cleave').flameShock.multiDotUptimeMs / fx('cleave').flameShock.multiTargetMs) * 100).toBe(
			fx('cleave').flameShock.multiDotUptimePct,
		);
	});

	/**
	 * The figure itself, before and after, because a correctness change with no verdict behind it is the
	 * easiest kind to lose.
	 *
	 * 16.64% to 18.73% and still `bad` — as is the section. That is the honest outcome: the player dotted
	 * the secondary for under a fifth of the time two enemies were up whichever way the stretch is counted,
	 * so the undotted second target is a real fault and not an artefact of a clock that ran too long.
	 *
	 * **The pull's own letter is `ok` and no longer `bad`, and that is not this change.** It moved when
	 * `fireElementalHasteUptime` was priced at 1 — `cleave` goes 42.31% of 13 points to 46.43% of 14 and
	 * clears the 45% line, on a rule this player passed. The arithmetic and the argument are in
	 * `score.ts`' `WEIGHTS`. The three assertions above are the ones this test is about, and they are
	 * unmoved; the headline is pinned underneath them so that it cannot drift unremarked either.
	 */
	/**
	 * The subject of the percentage: **every judgeable enemy that is not the primary**, not one chosen id.
	 *
	 * The rung this grades is `cleave.apl.json`'s ninth, `maxDots: 2` — keep the dot on *a* second target.
	 * It was measured against `secondaryID`, the second-busiest enemy by landed hit count, and on a wave
	 * fight that is whatever soaks the most Chain Lightning and Earthquake splash rather than the caster a
	 * shaman spends a global dotting.
	 *
	 * **`addsThenBoss` is the pull that shows it and the reason this guard exists at all.** It is the one
	 * committed fixture with a multi-add wave, and it read **18.72%** against a 174.7s band-2 clock while
	 * the union across every judgeable non-primary body reads **61.02%** — the same dots, the same clock,
	 * a different subject. Nothing in the suite pinned that figure, so the defect was invisible here and
	 * had to be found on an uncommitted log.
	 *
	 * **`cleave` is the control and does not move**: it has exactly one other enemy, so the union over all
	 * of them and the busiest one of them are the same array. A change that moved `cleave` would be
	 * changing what the metric means rather than which enemies it reads.
	 *
	 * The lifetime floor is applied **per spawn and not per enemy id**, which is the distinction
	 * `DotWindows` spends its docblock on: ten Kor'kron under one id are ten bodies, and an id that spans
	 * the pull through eight adds that each lived ten seconds must not inherit a lifetime none of them
	 * had. Asserted below by the count of spawns the floor drops.
	 */
	it('measures the second dot against every judgeable enemy, not the busiest one', () => {
		expect(+fx('addsThenBoss').flameShock.multiDotUptimePct.toFixed(2)).toBe(61.02);
		expect(fx('addsThenBoss').flameShock.multiDotUptimeMs).toBe(106_624);
		// Non-vacuity: the clock is long and the figure is well clear of both edges, so this is a reading
		// rather than a zero or a saturation.
		expect(fx('addsThenBoss').flameShock.multiTargetMs).toBe(174_748);
		// The control. One other enemy, so the two readings coincide and this figure is unchanged.
		expect(+fx('cleave').flameShock.multiDotUptimePct.toFixed(2)).toBe(18.73);
	});

	it('reads 18.73% on the mixed pull and still faults it', () => {
		expect(+fx('cleave').flameShock.multiDotUptimePct.toFixed(2)).toBe(18.73);
		const card = scoreAnalysis(fx('cleave'));
		const md = card.sections['flameShock']?.metrics.find((m) => m.key === 'flameShockMultiDot');
		expect(md?.value).toBe(fx('cleave').flameShock.multiDotUptimePct);
		expect(md?.unmeasurable).toBe(false);
		expect(md?.grade).toBe('bad');
		expect(card.sections['flameShock']?.grade).toBe('bad');
		// `bad` and not the `ok` this read before `gcdUtilisation`'s lines went to 95/90: this pull fills
		// 89.18% of its globals, which the old 80/65 pair called `good` and the new one calls `bad`. The
		// claim here is the dot's, and it is unchanged — the two lines above are what this test is about.
		// **`ok` since the tier-16 remaining check stopped reading a merged window's end.** That check
		// charged nearly every shock taken inside a long Elemental Discharge run — see `dischargeExpiry` —
		// and dropping the false faults lifts this pull's Earth Shock letter and the headline with it.
		expect(card.overall).toBe('ok');
	});

	/**
	 * The two single-target pulls read "cannot say", and for two reasons at once rather than one.
	 *
	 * They already did — `bands: [2]` against a pull that never leaves band 1 is an empty intersection, so
	 * `metricOf` was refusing them on the declaration alone. What changes is that the clock now agrees:
	 * `multiTargetMs` is published as the graded length and arrives at zero, so the refusal no longer rests
	 * on the band table being right about a pull. Both guards, one answer.
	 */
	it('says nothing about the second dot on a pull that never had a second target', () => {
		for (const name of ['phased', 'unbroken'] as const) {
			const md = scoreAnalysis(fx(name)).sections['flameShock']?.metrics.find((m) => m.key === 'flameShockMultiDot');
			expect(md, name).toBeDefined();
			expect(md?.unmeasurable, name).toBe(true);
			expect(md?.gradedMs, name).toBe(0);
		}
	});
});

// ------------------------------------------------------------ the empty clock

const T0 = 500_000;
const DURATION = 200_000;
const ME = 5;
const ADDS = [21, 22, 23];

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

/**
 * A pull spent entirely at three enemies — the case no committed fixture holds and the one every band
 * declaration in the table is a claim about.
 *
 * Three declared adds, each taking a hit every two seconds from the first event to the last, so the
 * APL target count never drops below three and `aoeWindows` covers the pull end to end. The shield is
 * driven to its ceiling early and left there, which under the old reading is 190-odd seconds of overcap
 * and the worst `lightningShieldOvercap` in the suite; under the new one there is no clock to measure it
 * in at all.
 *
 * Not a fixture, because no anonymous report we hold is shaped like this, and the point of the pull is
 * a shape rather than a player.
 */
const allAoeEvents: WclEvent[] = [
	...Array.from({ length: DURATION / 2000 + 1 }, (_, i) =>
		ADDS.map((add) => e(i * 2000, 'damage', 421, { targetID: add, amount: 5000, hitType: 1 })),
	).flat(),
	// The shield up before the pull, then eight Lightning Bolts to drive Rolling Thunder to the ceiling,
	// and nothing that ever spends it.
	...Array.from({ length: 7 }, (_, i) => e(1000 + i * 1000, 'applybuffstack', 324, { stack: i + 2 })),
	// One Lava Burst, so the pull reads as an Elemental at all — see `looksElemental`.
	e(500, 'cast', 51505, { targetID: ADDS[0] }),
];

const allAoe = analyse({
	code: 'aoe123',
	fight: {
		id: 1,
		name: 'Galakras',
		encounterID: 1622,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: T0 + DURATION,
	},
	actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
	actors: [
		{ id: ME, name: 'Sparkstorm', type: 'Player' },
		...ADDS.map((id) => ({ id, name: `Kor'kron Ironblade ${id}`, type: 'NPC' as const })),
	],
	events: allAoeEvents,
	table: {
		fight: {
			id: 1,
			name: 'Galakras',
			encounterID: 1622,
			kill: true,
			difficulty: 4,
			size: 25,
			startTime: T0,
			endTime: T0 + DURATION,
			enemyNPCs: ADDS.map((id) => ({ id, gameID: 72249 })),
		},
		damageDone: {
			entries: [
				{
					name: 'Sparkstorm',
					id: ME,
					type: 'Shaman',
					itemLevel: 553,
					total: 1_515_000,
					activeTime: DURATION,
					abilities: [{ guid: 421, name: 'Chain Lightning', total: 1_515_000 }],
				},
			],
		},
	},
}) as Analysis & ElementalAuditResult;

describe('a pull with no gradable stretch says so instead of grading it good', () => {
	/** The premise, asserted rather than assumed: this pull really is band 3 or more throughout. */
	it('is a pull spent wholly at three or more enemies', () => {
		expect(allAoe.targets?.counts?.max).toBeGreaterThanOrEqual(3);
		expect(unionMs(toIntervals(allAoe.lightningShield.aoeWindows))).toBe(allAoe.durationMs);
	});

	/**
	 * Every one of the three clocks is empty — which is the arithmetic that makes the guard reachable.
	 * Before the cut, two of these three were the full pull and only the shield's was zero.
	 */
	it('has an empty clock on all three banded readings', () => {
		expect(allAoe.lightningShield.gradedMs).toBe(0);
		expect(allAoe.flameShock.scoredMs).toBe(0);
		expect(allAoe.searingTotem.scoredMs).toBe(0);
	});

	/**
	 * **And the score refuses it rather than rewarding it.** This is the assertion the whole of step 2 is
	 * for: the shield sat at its ceiling for the entire pull and was never once spent, so the *fault* is
	 * as large as a fault can be — and yet `overcapMs` is zero, because none of that time was in a clock
	 * anything graded. Read as a value it is a flawless pull. Read with its clock it is a pull nobody
	 * looked at.
	 *
	 * `maxStacks > 0` is the guard this replaces and it is true here — the shield reached seven — which is
	 * why "was the thing present" was never the question.
	 */
	it('marks the shield overcap unmeasurable rather than good', () => {
		const shield = scoreAnalysis(allAoe).sections['lightningShield'];
		const overcap = shield?.metrics.find((m) => m.key === 'lightningShieldOvercap');
		expect(overcap).toBeDefined();
		expect(allAoe.lightningShield.maxStacks).toBeGreaterThan(0);
		expect(overcap?.unmeasurable).toBe(true);
		expect(overcap?.grade).not.toBe('good');
	});

	/** The same refusal on the other two banded clocks, for the same reason. */
	it('marks the dot and the totem clocks unmeasurable rather than perfect', () => {
		const card = scoreAnalysis(allAoe);
		const uptime = card.sections['flameShock']?.metrics.find((m) => m.key === 'flameShockUptime');
		const totem = card.sections['searingTotem']?.metrics.find((m) => m.key === 'searingTotemUptime');
		expect(uptime?.unmeasurable).toBe(true);
		expect(totem?.unmeasurable).toBe(true);
	});

	/**
	 * And the second dot, where the free pass ran the *other* way — this pull was being accused rather
	 * than excused, which is the worse of the two failures.
	 *
	 * Three adds throughout and no Flame Shock anywhere in the log, so the secondary's dot is empty. Over
	 * the core's `>= 2` clock — the whole pull, since three enemies are always two — that is 0% of a
	 * multi-dot rule the running list does not contain, graded `bad` and reported as one of the pull's
	 * faults. Over band 2 there is no clock at all, and the honest answer is that nothing here was asked.
	 */
	it('says nothing about the second dot on a pull with no two-target stretch', () => {
		// The premise: two-or-more covers the whole pull, so this is a cut and not an absence.
		expect(unionMs(intervalsAtLeast(allAoe.targets?.counts.points ?? [], 2, allAoe.durationMs))).toBe(
			allAoe.durationMs,
		);
		expect(allAoe.flameShock.multiTargetMs).toBe(0);
		const md = scoreAnalysis(allAoe).sections['flameShock']?.metrics.find((m) => m.key === 'flameShockMultiDot');
		expect(md?.unmeasurable).toBe(true);
		expect(md?.gradedMs).toBe(0);
	});
});

// ------------------------------------------------- band 2 and band 3 in one pull

/**
 * The arithmetic this task turns on, built rather than measured: one pull that spends part of itself at
 * two enemies and part at three, with the secondary's dot placed wholly inside one of the two.
 *
 * No committed fixture can isolate it. `cleave` has both bands but its dot is scattered across them, so
 * moving 12 407ms of numerator is consistent with several different cuts; `phased` and `unbroken` have no
 * second target at all. So the two pulls below are the same events with the dot moved, and between them
 * they pin both edges of the clock separately:
 *
 *   - **the dot inside the add wave only** — the whole numerator is exempt time, so the reading is 0% of a
 *     real band-2 clock. Under the old cut it was 36% of a clock that ran through the add wave.
 *   - **the dot outside the add wave only** — the numerator is untouched and the denominator shrinks, so
 *     the figure *rises*, 25.81% to 42.78%. This is the direction the `cleave` figure moved.
 *
 * The band-3 stretch is `[60 000, 120 000 + one global]` and both dots are placed clear of that boundary
 * by two seconds, so neither numerator depends on where the trailing trim lands. The denominator does, and
 * is asserted against `aoeWindows` rather than a literal for that reason.
 */
const B0 = 900_000;
const B_DURATION = 200_000;
const B_ME = 3;
const B_BOSS = 30;
const B_SECOND = 31;
const B_THIRD = 32;
const FLAME_SHOCK = 8050;

const bev = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: B0 + t,
	type,
	abilityGameID: id,
	sourceID: B_ME,
	targetID: B_ME,
	...extra,
});

/** Every two seconds, so the count series is one unbroken stretch per enemy rather than a flicker. */
const hits = (fromMs: number, toMs: number, target: number): WclEvent[] =>
	Array.from({ length: Math.floor((toMs - fromMs) / 2000) + 1 }, (_, i) =>
		bev(fromMs + i * 2000, 'damage', 403, { targetID: target, amount: 1000, hitType: 1 }),
	);

const dot = (target: number, fromMs: number, toMs: number): WclEvent[] => [
	bev(fromMs, 'applydebuff', FLAME_SHOCK, { targetID: target }),
	bev(toMs, 'removedebuff', FLAME_SHOCK, { targetID: target }),
];

/**
 * The boss is hit for the whole pull and the second enemy for the first 150s, so band 2 runs from the
 * start; the third enemy is hit from 60s to 120s and nothing else, so band 3 is one stretch in the middle.
 */
const twoBands = (secondDot: WclEvent[]): Analysis & ElementalAuditResult =>
	analyse({
		code: 'bands2',
		fight: {
			id: 1,
			name: 'Dark Shaman',
			encounterID: 1623,
			kill: true,
			difficulty: 4,
			size: 25,
			startTime: B0,
			endTime: B0 + B_DURATION,
		},
		actor: { id: B_ME, name: 'Sparkstorm', type: 'Player' },
		actors: [
			{ id: B_ME, name: 'Sparkstorm', type: 'Player' },
			// `subType: 'Boss'` pins the primary, so "the busiest enemy that is not the primary" is a
			// question with one answer rather than a tie decided by hit order.
			{ id: B_BOSS, name: 'Wavebinder Kardris', type: 'NPC', subType: 'Boss' },
			{ id: B_SECOND, name: 'Earthbreaker Haromm', type: 'NPC', subType: 'NPC' },
			{ id: B_THIRD, name: 'Foul Slime', type: 'NPC', subType: 'NPC' },
			{ id: 4, name: 'Someone Else', type: 'Player' },
		],
		events: [
			...hits(0, 198_000, B_BOSS),
			...hits(0, 150_000, B_SECOND),
			...hits(60_000, 120_000, B_THIRD),
			...dot(B_BOSS, 0, 198_000),
			...secondDot,
			// One Lava Burst, so the pull reads as an Elemental at all — see `looksElemental`.
			bev(500, 'cast', 51_505, { targetID: B_BOSS }),
		],
		table: {
			fight: {
				id: 1,
				name: 'Dark Shaman',
				encounterID: 1623,
				kill: true,
				difficulty: 4,
				size: 25,
				startTime: B0,
				endTime: B0 + B_DURATION,
				enemyNPCs: [
					{ id: B_BOSS, gameID: 71_454 },
					{ id: B_SECOND, gameID: 71_859 },
					{ id: B_THIRD, gameID: 71_858 },
				],
			},
			damageDone: {
				entries: [
					{
						name: 'Sparkstorm',
						id: B_ME,
						type: 'Shaman',
						itemLevel: 553,
						total: 300_000,
						activeTime: B_DURATION,
						abilities: [{ guid: 403, name: 'Lightning Bolt', total: 300_000 }],
					},
				],
			},
		},
	}) as Analysis & ElementalAuditResult;

/** Dot on the second enemy only while the third was up: 56 000ms, all of it inside the add wave. */
const dotInWave = twoBands(dot(B_SECOND, 62_000, 118_000));
/** The same 40 000ms of dot moved clear of the wave, before it opens. */
const dotBeforeWave = twoBands(dot(B_SECOND, 10_000, 50_000));

describe('a pull with a band-2 stretch and a band-3 stretch', () => {
	/** The premise, asserted rather than assumed: this pull really does visit both bands and no more. */
	it('is built with two bands and a second target worth dotting', () => {
		expect(dotInWave.targets?.counts.max).toBe(3);
		expect(dotInWave.primaryTarget?.id).toBe(B_BOSS);
		const aoe = toIntervals(dotInWave.lightningShield.aoeWindows);
		expect(aoe).toHaveLength(1);
		expect(aoe[0]?.[0]).toBe(60_000);
		// The close is one measured global past the last three-wide hit, so it lands inside 121 500 — which
		// is what puts both dots below clear of the boundary whatever the global measures.
		expect(aoe[0]?.[1]).toBeGreaterThan(120_000);
		expect(aoe[0]?.[1]).toBeLessThanOrEqual(121_500);
	});

	/**
	 * The denominator, on both pulls, against the identity that makes the cut checkable: the band-2-or-more
	 * clock less the whole exempt array, because the add wave sits inside the stretch the second enemy was
	 * up for.
	 */
	it('grades over the band-2-or-more clock less the add wave', () => {
		for (const [name, a] of [
			['dotInWave', dotInWave],
			['dotBeforeWave', dotBeforeWave],
		] as const) {
			const atLeastTwo = unionMs(intervalsAtLeast(a.targets?.counts.points ?? [], 2, a.durationMs));
			const aoeMs = unionMs(toIntervals(a.lightningShield.aoeWindows));
			expect(atLeastTwo, name).toBe(155_000);
			expect(a.flameShock.multiTargetMs, name).toBe(unionMs(bandTwo(a)));
			expect(a.flameShock.multiTargetMs, name).toBe(155_000 - aoeMs);
			// A real cut and not a rounding: the wave is over a third of the old clock. Bounded rather than
			// pinned, because the exact figure carries the measured global — 93 500ms at the declared 1 500,
			// where the trim is `5 000 - 1 500` and the wave closes at 121 500.
			expect(a.flameShock.multiTargetMs, name).toBeLessThan(95_000);
			expect(a.flameShock.multiTargetMs, name).toBeGreaterThan(93_000);
		}
	});

	/**
	 * **The numerator is cut by the same array.** 56 000ms of dot, every millisecond of it inside the add
	 * wave, and none of it reaches the figure: the second enemy was dotted only while the list had stopped
	 * asking for a second dot. Under the old clock this was 56 000ms over 155 000ms — 36.1% — a figure made
	 * entirely of time band 2 never saw.
	 */
	it('drops a second dot that was only ever up inside the add wave', () => {
		expect(dotInWave.flameShock.multiDotUptimeMs).toBe(0);
		expect(dotInWave.flameShock.multiTargetMs).toBeGreaterThan(0);
		expect(dotInWave.flameShock.multiDotUptimePct).toBe(0);
		// Graded, not refused: there is a band-2 clock, and 0% of it is the answer.
		const md = scoreAnalysis(dotInWave).sections['flameShock']?.metrics.find((m) => m.key === 'flameShockMultiDot');
		expect(md?.unmeasurable).toBe(false);
		expect(md?.grade).toBe('bad');
	});

	/**
	 * **And the denominator alone moves the figure the other way.** The same 40 000ms of dot, placed clear
	 * of the wave, is 25.8% of the old clock and 42-point-something of the band-2 one — the direction
	 * `cleave` moved, for the same reason and with the numerator held fixed to prove it is the denominator
	 * doing the work.
	 */
	it('raises the figure when the dot was up over band 2 and the wave leaves the clock', () => {
		const { multiDotUptimeMs, multiTargetMs, multiDotUptimePct } = dotBeforeWave.flameShock;
		expect(multiDotUptimeMs).toBe(40_000);
		// 25.81% over the old clock, 42.78% over the band-2 one, off the same 40 000ms of dot.
		expect((40_000 / 155_000) * 100).toBeCloseTo(25.81, 2);
		expect(multiDotUptimePct).toBe((multiDotUptimeMs / multiTargetMs) * 100);
		expect(+multiDotUptimePct.toFixed(2)).toBe(42.78);
	});
});
