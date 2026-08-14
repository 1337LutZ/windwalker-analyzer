import { describe, expect, it } from 'vitest';

import { formatGap } from '../duration';

/**
 * This exists because the report told a reader their brew went out "0s too late".
 *
 * The near-miss detection had found a real one — 21ms after the proc expired — and every place that
 * printed it rounded to one decimal of seconds, so the number said no gap at all while the sentence
 * around it insisted there was one. The chart tooltip, the miss ledger and the section prose all
 * said it, because all three formatted the same way.
 */
describe('formatGap', () => {
	it('keeps a gap too small for a decimal of seconds', () => {
		expect(formatGap(21)).toBe('21ms');
		expect(formatGap(99)).toBe('99ms');
	});

	it('uses seconds once there are seconds to show', () => {
		expect(formatGap(717)).toBe('0.7s');
		expect(formatGap(1500)).toBe('1.5s');
	});

	/** The exact regression: a real miss must never read as no miss. */
	it('never renders a real gap as zero', () => {
		expect(formatGap(21)).not.toBe('0s');
		expect(formatGap(4)).not.toBe('0s');
	});
});
