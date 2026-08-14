// Percentages. `Intl` writes the sign, so no call site has to remember to.

const percentFormat = new Intl.NumberFormat('en-US', {
	style: 'percent',
	maximumFractionDigits: 1,
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
