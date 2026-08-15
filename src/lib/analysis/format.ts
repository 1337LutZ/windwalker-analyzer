// The arithmetic that happens before a number is printed: rounding and the one statistic the engine
// needs. Turning a number into display text is not this file's job — that lives in `~/lib/format`,
// built on `Intl` and constructed once, and `fmtClock` below is only the old name for it.

export { formatClock as fmtClock } from '~/lib/format';

/**
 * One decimal place, for figures measured in seconds.
 *
 * This is a claim about the *data*, not about display: WarcraftLogs stamps events to the millisecond
 * but the quantities built out of them — a channel's length, a gap between presses — are not
 * meaningfully resolved past a tenth, and carrying the extra digits would invite a reader to compare
 * two numbers on noise.
 *
 * Percentages deliberately do NOT go through this or anything like it. There is no resolution limit
 * to assert about a ratio, and how many decimals to show is a display question that
 * `Intl.NumberFormat` already answers in one place — see `lib/format/percent.ts`. Rounding them here
 * as well would fix the precision at the wrong end of the pipeline, and silently cap what the
 * formatter is allowed to show.
 */
export function r1(v: number): number {
	return Math.round(v * 10) / 10;
}

/** Upper median: for an even count this takes the higher of the two middle values. */
export function median(xs: readonly number[]): number {
	if (!xs.length) return 0;
	const sorted = [...xs].sort((a, b) => a - b);
	return sorted[Math.floor(xs.length / 2)] ?? 0;
}
