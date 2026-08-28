// How much a percentile would wobble on a different draw of the same ladder.
//
// `good` is the ninetieth percentile of a few dozen kills. Read alone it looks exact — 84.67 — and a
// reader comparing two refreshes, or two encounters, has no way to tell a real difference from the
// noise of which pulls happened to be sampled. On the current sample sizes that noise is two to five
// points, which is larger than most of the moves it would be read against.
//
// So the interval travels with the figure. It is computed here rather than in the browser because the
// evidence behind it is four hundred rows and growing: shipping the ledger to a reader to recompute a
// number that only changes when the table does would be a large download for a constant.
//
// **Seeded, so the same evidence always renders the same interval.** A resampled figure that shifted
// every time a page was built — or every time a pull request body was regenerated — would be worse than
// no interval at all, because the wobble it is there to describe would be indistinguishable from its own.

const RESAMPLES = 400;

/** A small deterministic generator. Not for anything that needs to be unguessable. */
export function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** FNV-1a, so a cell's key alone decides its seed and two machines agree. */
export function seedOf(text) {
	let h = 2166136261;
	for (let index = 0; index < text.length; index += 1) {
		h ^= text.charCodeAt(index);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/** Linear-interpolated quantile over an already-sorted array. */
export function quantile(sorted, q) {
	if (sorted.length === 0) return null;
	const at = (sorted.length - 1) * q;
	const lo = Math.floor(at);
	const hi = Math.ceil(at);
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/**
 * Half the width of a 90% bootstrap interval on the `q`th percentile of `values`.
 *
 * Returns null below four values, where a resample says more about the arithmetic than about the
 * ladder — a cell that thin should show its sample size and no interval rather than a confident-looking
 * number nobody should trust.
 */
export function intervalOf(values, key, q = 0.9) {
	if (values.length < 4) return null;
	const rand = mulberry32(seedOf(key));
	const draws = [];
	for (let i = 0; i < RESAMPLES; i += 1) {
		const sample = Array.from({ length: values.length }, () => values[Math.floor(rand() * values.length)]);
		sample.sort((a, b) => a - b);
		draws.push(quantile(sample, q));
	}
	draws.sort((a, b) => a - b);
	return (quantile(draws, 0.95) - quantile(draws, 0.05)) / 2;
}
