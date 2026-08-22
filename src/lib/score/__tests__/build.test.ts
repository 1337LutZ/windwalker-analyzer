// The three ways a metric can have nothing to say, and the denominator the headline is taken over.
//
// Hand-built rule tables rather than a spec's own, because what is under test here is the mechanism
// and not any spec's numbers: `THRESHOLDS` in either engine is a table of calibrated judgements, and a
// test that pinned one of them would fail the next time somebody recalibrated it for a reason that has
// nothing to do with bands. The band declarations below are the *shapes* the two engines will use —
// a clock only the single-target and cleave lists spend against, and a share counted in presses.

import { describe, expect, it } from 'vitest';

import {
	gradedOver,
	grader,
	metricOf,
	type MetricRule,
	MIN_GRADED_SAMPLE,
	MIN_JUDGED_WEIGHT_SHARE,
	type Metric,
	overall,
	overallOf,
	shareOf,
	sharePct,
} from '../index';

const RULES = {
	/** A clock, lower better, and banded: the shape of Lightning Shield's spending. */
	overcapMs: { good: 0, ok: 5_000, higherIsBetter: false, bands: [1, 2] },
	/** A share counted in presses, lower better: the shape of `flameShockWaste`. */
	wastePct: { good: 10, ok: 25, higherIsBetter: false },
	/** Graded at every band — a resource that exists identically at every target count. */
	uptimePct: { good: 90, ok: 75, higherIsBetter: true },
} as const satisfies Record<string, MetricRule>;

describe('an empty graded clock', () => {
	/**
	 * The planted case, and the live bug it is planted for. `elemental/lib/score.ts` documents it: a
	 * pull with no single-target stretch at all has an empty clock, and `0ms of overcap` over `0ms`
	 * grades `good` — a free pass handed to exactly the pulls an exemption just excused, which is worse
	 * than the bug it was meant to fix.
	 */
	it('cannot say, where the same zero over a real clock is good', () => {
		const empty = metricOf(RULES, 'overcapMs', gradedOver(0, 0));
		expect(empty.unmeasurable).toBe(true);
		expect(empty.gradedMs).toBe(0);
		// The free pass, named: with only the value to go on this graded `good` — the best mark on the
		// card, awarded for a clock that graded nothing.
		expect(empty.grade).not.toBe('good');

		const real = metricOf(RULES, 'overcapMs', gradedOver(0, 42_000));
		expect(real.unmeasurable).toBe(false);
		expect(real.grade).toBe('good');
	});

	/** The guard for the proxy the bug report names: presence is not the same question as gradability. */
	it('does not take the value alone as evidence that anything was graded', () => {
		expect(metricOf(RULES, 'overcapMs', 0).unmeasurable).toBe(false);
		expect(metricOf(RULES, 'overcapMs', gradedOver(0, 0)).unmeasurable).toBe(true);
	});
});

describe('the sample floor', () => {
	/** `0/1` is a `good` off one press, and `1/2` a `bad` off one — the swing the `cleave` pull found. */
	it('declines a share whose denominator is one or two events', () => {
		const one = metricOf(RULES, 'wastePct', shareOf(0, 1));
		expect(one.unmeasurable).toBe(true);
		expect(one.grade).not.toBe('good');
		const two = metricOf(RULES, 'wastePct', shareOf(1, 2));
		expect(two.unmeasurable).toBe(true);
		expect(two.grade).not.toBe('bad');
	});

	it('grades from the third event, and says what it counted', () => {
		const three = metricOf(RULES, 'wastePct', shareOf(0, 3));
		expect(three.unmeasurable).toBe(false);
		expect(three.grade).toBe('good');
		expect(three.sampleSize).toBe(3);
		expect(MIN_GRADED_SAMPLE).toBe(3);
	});

	/**
	 * Deliberate no-change guard: `sharePct` keeps declining only at zero.
	 *
	 * Its callers include shares whose denominator is a span in ms, where a floor of three would mean
	 * three milliseconds and nothing at all. The floor belongs to `shareOf`, which is the form that
	 * knows its whole is a count of events.
	 */
	it('leaves sharePct alone', () => {
		expect(sharePct(0, 1)).toBe(0);
		expect(sharePct(1, 2)).toBe(50);
		expect(sharePct(1, 0)).toBeNull();
	});
});

describe('a rule outside its bands', () => {
	/** Not graded, and not graded *well*: `exempt` is beside `unmeasurable` so the copy can tell them apart. */
	it('says the question was not asked, on a pull that never left band 3+', () => {
		const m = metricOf(RULES, 'overcapMs', 9_999_999, undefined, { bands: [3, 4], forced: false });
		expect(m.unmeasurable).toBe(true);
		expect(m.exempt).toBe(true);
	});

	/** Cleave stays graded: two targets still spend the charges, so band 2 keeps the rule. */
	it('keeps grading a pull that spent any time in its bands', () => {
		const mixed = metricOf(RULES, 'overcapMs', 9_999_999, undefined, { bands: [1, 2, 3, 4], forced: false });
		expect(mixed.unmeasurable).toBe(false);
		expect(mixed.exempt).toBeUndefined();
	});

	/**
	 * The same mixed pull handed over as a mode instead, and what it costs.
	 *
	 * `'multi'` is one band, so the four minutes this pull spent at one and two targets are not in the
	 * view at all and the rule is exempted outright. Asserted rather than merely documented because it
	 * is the reason the seam takes a `BandView`: the loss is real, it is silent, and it is invisible
	 * from the metric's own end.
	 */
	it('is exempted wholesale when a mixed pull arrives as a mode', () => {
		expect(metricOf(RULES, 'overcapMs', 0, undefined, 'multi').exempt).toBe(true);
		expect(metricOf(RULES, 'overcapMs', 0, undefined, 'single').exempt).toBeUndefined();
	});

	/** A rule that declares no bands is asked of every pull, however many enemies were up. */
	it('never exempts an undeclared rule', () => {
		expect(metricOf(RULES, 'uptimePct', 99, undefined, { bands: [3, 4], forced: false }).unmeasurable).toBe(false);
	});

	/**
	 * No counts, no exemption. Every fixture captured before the counts existed lands here, and the
	 * conservative direction is to judge it — excusing a pull on the strength of a missing field is how
	 * the free pass gets back in.
	 */
	it('judges when nothing said what the pull was', () => {
		expect(metricOf(RULES, 'overcapMs', 0, undefined, null).unmeasurable).toBe(false);
		expect(metricOf(RULES, 'overcapMs', 0).unmeasurable).toBe(false);
	});

	/** `grader` exists so the view is bound once and no metric can be built outside the exemption. */
	it('binds the view for every metric a grader builds', () => {
		const metric = grader(RULES, { bands: [3, 4], forced: false });
		expect(metric('overcapMs', 0).exempt).toBe(true);
		expect(metric('uptimePct', 99).exempt).toBeUndefined();
	});
});

// A metric list shaped like the Elemental scorecard: 22 points of weight, four heavy metrics carrying
// half of it. `judged` is what the two cases below differ in.
const WEIGHTS: Record<string, number> = {
	snapshots: 4,
	uptime: 3,
	multiDot: 3,
	waste: 3,
	globals: 2,
	thunderstorm: 2,
	rage: 1,
	totem: 1,
	overlaps: 1,
	shieldOvercap: 1,
	shieldFellOff: 1,
};

const at = (key: string, grade: Metric['grade'], unmeasurable = false): Metric => ({
	key,
	value: 0,
	good: 0,
	ok: 0,
	higherIsBetter: true,
	grade,
	unmeasurable,
});

describe('the judged denominator', () => {
	it('says how much weight the verdict was actually taken over', () => {
		const all = Object.keys(WEIGHTS).map((key) => at(key, 'good'));
		expect(overallOf(all, WEIGHTS).judged).toEqual({ measured: 22, total: 22, unmeasurable: false });
	});

	/**
	 * The Elemental `cleave` pull as it stands: 15 of 22 points judgeable, and a grade that is still a
	 * grade. The reader is owed the fraction — a `bad` over 15 of 22 is a different claim from one over
	 * all 22 — but 15 is a majority and the verdict stands on it.
	 */
	it('still grades a pull that measured most of its weight', () => {
		const silent = new Set(['snapshots', 'thunderstorm', 'rage']);
		const metrics = Object.keys(WEIGHTS).map((key) => at(key, 'bad', silent.has(key)));
		const { grade, judged } = overallOf(metrics, WEIGHTS);
		expect(judged).toEqual({ measured: 15, total: 22, unmeasurable: false });
		expect(grade).toBe('bad');
	});

	/**
	 * The wholly band-3+ pull the mechanism exists for: 7 of 22 points survive, and every survivor is a
	 * weight-1 habit metric. Each of them passed, so the old arithmetic returns `good` — a headline
	 * about a third of the rotation, printed as a headline about the pull.
	 */
	it('refuses a headline drawn from a minority of the weight', () => {
		const judgeable = new Set(['rage', 'totem', 'overlaps', 'shieldOvercap', 'shieldFellOff', 'globals']);
		const metrics = Object.keys(WEIGHTS).map((key) => at(key, 'good', !judgeable.has(key)));
		const { grade, judged } = overallOf(metrics, WEIGHTS);
		// Not `good`, which is what a mean over the seven surviving points comes to.
		expect(grade).toBe('ok');
		expect(judged).toEqual({ measured: 7, total: 22, unmeasurable: true });
		expect(MIN_JUDGED_WEIGHT_SHARE).toBe(0.5);
	});

	/** Exactly half judges rather than refuses, the same way the grade bands are inclusive at their edges. */
	it('grades at exactly the floor', () => {
		const metrics = [at('a', 'good'), at('b', 'good', true)];
		const { grade, judged } = overallOf(metrics, { a: 1, b: 1 });
		expect(judged).toEqual({ measured: 1, total: 2, unmeasurable: false });
		expect(grade).toBe('good');
	});

	/**
	 * Deliberate no-change guard: the degenerate end this rule generalises.
	 *
	 * Nothing measurable at all used to return `ok` from a clause of its own; it now falls out of the
	 * share test, and both the grade and the silence have to survive that.
	 */
	it('keeps the old answer when nothing at all could be measured', () => {
		const metrics = [at('a', 'good', true), at('b', 'good', true)];
		expect(overall(metrics, { a: 1, b: 1 })).toBe('ok');
		expect(overallOf(metrics, { a: 1, b: 1 }).judged).toEqual({ measured: 0, total: 2, unmeasurable: true });
	});

	/** Deliberate no-change guard: a set of weight-zero metrics still divides by nothing and says so. */
	it('keeps the old answer when every measurable metric carries no weight', () => {
		const metrics = [at('a', 'bad'), at('b', 'bad')];
		expect(overall(metrics, { a: 0, b: 0 })).toBe('ok');
	});
});
