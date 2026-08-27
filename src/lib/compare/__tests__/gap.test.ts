// The arithmetic, and the four ways a pair declines to produce a number.

import { describe, expect, it } from 'vitest';

import { capturedAnalyses } from '~/lib/analysis/fixtures';
import { bandGap, compare, identityFrom, leaderOf, metricGap, TIE_BANDS } from '~/lib/compare';
import { gradeOf, type Metric } from '~/lib/score/model';
import { getSpec } from '~/lib/spec';
import { resolveBands } from '~/lib/view/targetMode';

/** A graded metric, thresholds first, so each test names only what it is actually about. */
function metric(over: Partial<Metric> & Pick<Metric, 'key' | 'value'>): Metric {
	const base = { unit: 'percent' as const, good: 90, ok: 70, higherIsBetter: true, unmeasurable: false };
	const rule = { ...base, ...over };
	return { ...rule, grade: over.grade ?? gradeOf(rule, rule.value) };
}

describe('bandGap', () => {
	it('measures the distance in bands, positive when A is ahead', () => {
		// A band here is 20 points wide, so ten points of share is half of one.
		expect(bandGap(metric({ key: 'k', value: 90 }), metric({ key: 'k', value: 80 }))).toBeCloseTo(0.5);
	});

	it('flips the subtraction where a lower number is the better one', () => {
		const rule = { good: 0, ok: 5, higherIsBetter: false };
		// A wasted four casts and B wasted one, so B is ahead by three fifths of a band.
		const gap = bandGap(metric({ key: 'k', value: 4, ...rule }), metric({ key: 'k', value: 1, ...rule }));
		expect(gap).toBeCloseTo(-0.6);
	});

	it('falls back to the grades where a rule has no band to divide by', () => {
		// `good` and `ok` on the same line: the rule can say whether the two pulls landed differently
		// and nothing finer. Dividing by the width would be a division by zero.
		const rule = { good: 2, ok: 2, higherIsBetter: true };
		expect(bandGap(metric({ key: 'k', value: 2, ...rule }), metric({ key: 'k', value: 0, ...rule }))).toBe(1);
		expect(bandGap(metric({ key: 'k', value: 0, ...rule }), metric({ key: 'k', value: 2, ...rule }))).toBe(-1);
		expect(bandGap(metric({ key: 'k', value: 2, ...rule }), metric({ key: 'k', value: 2, ...rule }))).toBe(0);
	});

	it('negates when the two sides swap', () => {
		const one = metric({ key: 'k', value: 95 });
		const two = metric({ key: 'k', value: 62 });
		expect(bandGap(one, two)).toBeCloseTo(-bandGap(two, one));
	});
});

describe('leaderOf', () => {
	it('leaves a gap inside the tie width without a leader', () => {
		expect(leaderOf(TIE_BANDS / 2)).toBeNull();
		expect(leaderOf(-TIE_BANDS / 2)).toBeNull();
		expect(leaderOf(0)).toBeNull();
	});

	it('names a side past it', () => {
		expect(leaderOf(TIE_BANDS)).toBe('a');
		expect(leaderOf(-TIE_BANDS)).toBe('b');
	});

	it('has no leader for a pair that does not compare', () => {
		expect(leaderOf(null)).toBeNull();
	});
});

describe('metricGap', () => {
	it('reports a gap and its leader when both sides were graded', () => {
		const gap = metricGap('k', metric({ key: 'k', value: 95 }), metric({ key: 'k', value: 60 }));
		expect(gap.bands).toBeCloseTo(1.75);
		expect(gap.leader).toBe('a');
		expect(gap.why).toBeNull();
	});

	it('refuses a metric one side does not hold, and names that side', () => {
		const gap = metricGap('k', null, metric({ key: 'k', value: 60 }));
		expect(gap.bands).toBeNull();
		expect(gap.why).toBe('missing');
		expect(gap.whySide).toBe('a');
	});

	it('refuses where the log could not answer, rather than reading the value anyway', () => {
		// The value on an unmeasurable metric is parked, not measured. Differencing it would put a
		// number on screen that no log supports.
		const gap = metricGap(
			'k',
			metric({ key: 'k', value: 0, unmeasurable: true, grade: 'ok' }),
			metric({ key: 'k', value: 88 }),
		);
		expect(gap.bands).toBeNull();
		expect(gap.why).toBe('unmeasurable');
		expect(gap.whySide).toBe('a');
	});

	it('refuses where one pull was never asked, and keeps that apart from a refusal to measure', () => {
		// An exempt metric is unmeasurable too — `metricOf` sets both, so that the reason survives — and
		// this is the pair that would collapse into the wrong sentence if the general flag won.
		const gap = metricGap(
			'k',
			metric({ key: 'k', value: 91 }),
			metric({ key: 'k', value: 0, exempt: true, unmeasurable: true, grade: 'ok' }),
		);
		expect(gap.why).toBe('exempt');
		expect(gap.whySide).toBe('b');
	});

	it('names no side when both refuse for the same reason', () => {
		const both = metricGap(
			'k',
			metric({ key: 'k', value: 0, unmeasurable: true, grade: 'ok' }),
			metric({ key: 'k', value: 0, unmeasurable: true, grade: 'ok' }),
		);
		expect(both.whySide).toBeNull();
	});

	it('never calls two pulls level on a metric their grades disagree about', () => {
		// The property `TIE_BANDS` is chosen for, asserted over every pairing of the committed captures
		// rather than left as a claim in a docblock. A tie width wide enough to swallow a grade boundary
		// would report agreement the spec's own thresholds deny.
		const spec = getSpec('windwalker')!;
		const pulls = capturedAnalyses('windwalker').map(({ analysis }) => {
			const view = resolveBands(analysis.targets, 'auto', analysis.segments);
			return { analysis, scorecard: spec.score(analysis, view), view };
		});
		let compared = 0;
		for (const [at, one] of pulls.entries()) {
			for (const two of pulls.slice(at + 1)) {
				for (const section of compare(one, two, identityFrom(spec.registry)).sections) {
					for (const gap of section.metrics) {
						if (gap.bands === null || gap.a === null || gap.b === null) continue;
						compared += 1;
						if (gap.a.grade !== gap.b.grade) expect(gap.leader).not.toBeNull();
					}
				}
			}
		}
		// A guard over an empty sweep proves nothing, and six captures over eleven metrics is not a
		// number that should quietly fall to zero.
		expect(compared).toBeGreaterThan(100);
	});

	it('reports the missing side ahead of the unmeasurable one', () => {
		// Both are true of this pair. A reader told only that B could not measure would go looking for
		// a rule that A's scorecard does not carry at all.
		const gap = metricGap('k', null, metric({ key: 'k', value: 0, unmeasurable: true, grade: 'ok' }));
		expect(gap.why).toBe('missing');
	});
});
