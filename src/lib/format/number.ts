// Numbers as the report prints them. Constructed once at module scope — see the note in
// `duration.ts` for why that is not an optimisation but a correctness rule.

const compactFormat = new Intl.NumberFormat('en-US', {
	notation: 'compact',
	maximumFractionDigits: 1,
});

const integerFormat = new Intl.NumberFormat('en-US', {
	maximumFractionDigits: 0,
});

const decimalFormat = new Intl.NumberFormat('en-US', {
	maximumFractionDigits: 1,
});

/**
 * A damage total at a glance: `12345678` → `12.3M`, `265432` → `265k`. For figures whose magnitude
 * is the point and whose last digits are noise.
 *
 * `Intl` writes thousands as an uppercase `K`, which is lowercase everywhere this genre of tool
 * writes it — and the KPI tiles used to hand-roll `formatInteger(value / 1000) + 'k'` precisely to
 * get that, which left a tile and the sentence under it spelling the same number two ways. Millions
 * keep the uppercase `M`, which is the convention in both places.
 */
export function formatCompact(value: number): string {
	return compactFormat.format(value).replace(/K$/, 'k');
}

/** A whole number with thousands separators: `222222` → `222,222`. */
export function formatInteger(value: number): string {
	return integerFormat.format(value);
}

/** One decimal, with a trailing `.0` dropped: `9.25` → `9.3`, `4` → `4`. */
export function formatDecimal(value: number): string {
	return decimalFormat.format(value);
}
