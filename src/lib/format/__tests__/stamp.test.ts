import { describe, expect, it } from 'vitest';

import { formatClock, formatClockFixed, formatStamp } from '../duration';

/**
 * The tooltip clock, which is the coarse one plus the digits the log actually has.
 *
 * The pair is asserted together on purpose: `formatClock` still owns the axes, the tables and the
 * prose, and the whole reason `formatStamp` exists is that a tooltip is the one place a reader is
 * asking exactly when. If somebody ever merges the two, these fall over rather than quietly widening
 * every table column in the report.
 */
describe('formatStamp', () => {
	it('carries the milliseconds the clock drops', () => {
		expect(formatStamp(83_456)).toBe('01:23.456');
		expect(formatClock(83_456)).toBe('1:23');
	});

	/** Three digits, always — a ragged fraction is what makes a monospace value column crooked. */
	it('pads to three digits so every stamp is the same width', () => {
		expect(formatStamp(5000)).toBe('00:05.000');
		expect(formatStamp(5007)).toBe('00:05.007');
		expect(formatStamp(5070)).toBe('00:05.070');
	});

	/**
	 * The two halves of a Spear Hand Strike land 2ms apart, and a weave's ordering is decided inside a
	 * 1ms band. One decimal renders both pairs as one number, which is the fact the reader came for.
	 */
	it('separates events a tenth of a second could not', () => {
		expect(formatStamp(61_002)).not.toBe(formatStamp(61_000));
	});

	/** Floors on the same value the clock floors, so the two can never name different seconds. */
	it('never rounds a moment into the next second', () => {
		expect(formatStamp(83_999)).toBe('01:23.999');
		expect(formatStamp(-5)).toBe('00:00.000');
	});

	/**
	 * The width is the point of the padding, and the boundary it protects is ten minutes: a scrubber
	 * whose readout is `9:58` at one moment and `10:02` the next moves every control beside it.
	 * `formatClock` deliberately does not do this — it labels things that sit still.
	 */
	it('holds one width across the ten-minute boundary, where the loose clock does not', () => {
		expect(formatClockFixed(598_000)).toBe('09:58');
		expect(formatClockFixed(602_000)).toBe('10:02');
		expect(formatClockFixed(598_000)).toHaveLength(formatClockFixed(602_000).length);
		expect(formatClock(598_000)).toBe('9:58');
		expect(formatClock(598_000)).not.toHaveLength(formatClock(602_000).length);
	});

	/** The stamp is the fixed clock plus the log's own three digits, so the two cannot drift apart. */
	it('builds the stamp on the fixed clock', () => {
		expect(formatStamp(83_456).startsWith(formatClockFixed(83_456))).toBe(true);
	});
});
