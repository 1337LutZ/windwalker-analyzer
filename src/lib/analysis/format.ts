// The arithmetic that happens before a number is printed: rounding and the one statistic the engine
// needs. Turning a number into display text is not this file's job — that lives in `~/lib/format`,
// built on `Intl` and constructed once, and `fmtClock` below is only the old name for it.

export { formatClock as fmtClock } from '~/lib/format';

/** One decimal place. Every "seconds" figure in the analysis is rounded through this. */
export function r1(v: number): number {
	return Math.round(v * 10) / 10;
}

/** Upper median: for an even count this takes the higher of the two middle values. */
export function median(xs: readonly number[]): number {
	if (!xs.length) return 0;
	const sorted = [...xs].sort((a, b) => a - b);
	return sorted[Math.floor(xs.length / 2)] ?? 0;
}
