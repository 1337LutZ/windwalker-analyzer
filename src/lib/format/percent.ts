// Percentages. `Intl` writes the sign, so no call site has to remember to.

/**
 * Two decimals, and `maximumFractionDigits` rather than `minimum`, so a whole number stays whole.
 *
 * One decimal was hiding differences the report argues about. Uptimes and catch rates cluster in the
 * nineties, where a tenth of a point is several seconds of a pull, and two figures a hair apart were
 * printing identical — which reads as a rendering fault rather than as a close result.
 *
 * Nothing upstream rounds these: every `…Pct` on the `Analysis` is stored as the full quotient, so
 * the extra digit is a digit the analysis actually has rather than noise invented at the last step.
 */
const percentFormat = new Intl.NumberFormat('en-US', {
	style: 'percent',
	maximumFractionDigits: 2,
});

/** A fraction as a percentage: `0.918` → `91.8%`. */
export function formatPercent(fraction: number): string {
	return percentFormat.format(fraction);
}

/**
 * A figure the analysis already stores out of a hundred: `91.8` → `91.8%`. Every `…Pct` field on
 * the `Analysis` is that shape, and dividing one twice is a silent way to print `0.9%`.
 */
export function formatPercentValue(value: number): string {
	return percentFormat.format(value / 100);
}
