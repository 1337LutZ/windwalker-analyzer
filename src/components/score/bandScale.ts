// The geometry a metric's scale is drawn on: how wide the track is, and where the rule's lines fall.
//
// Extracted from `BandScale` when the compare page needed a second mark on the same track. One
// domain, one set of zones, two callers — because the moment two components work out a scale for
// themselves is the moment two marks can be drawn against different ones and the picture starts
// lying about which pull is further along.

import type { Metric } from '~/lib/score/model';

/**
 * The domain a metric's scale is drawn over, given every value that has to fit on it.
 *
 * **The values are a list, and that is the whole reason this takes an argument at all.** A share is
 * out of 100 whatever the pull did, and a rule with a lid is drawn to its lid, so those two answer
 * without looking. Everything else is open-ended — a count of potions, seconds at a ceiling — and has
 * no natural end to draw, so the domain comes from the numbers themselves with headroom past
 * whichever is largest. With one mark that is the pull's own value. With two it has to be both, or
 * the larger of them sits off the end of a track sized for the smaller.
 *
 * The headroom is what stops a value sitting exactly on the right edge and reading as "off the end of
 * the scale" when it is merely the biggest number present.
 */
export function domainOf(metric: Metric, values: readonly number[]): number {
	if (metric.unit === 'percent') return 100;
	// A rule with a lid is drawn to the lid, so a pull that reached it fills the bar. Two potions out of
	// the two a pull allows was drawing at 80%: the headroom below is for open-ended counts, and adding a
	// quarter past a number nothing can exceed leaves the best possible reading short of the end.
	if (metric.ceiling !== undefined) return metric.ceiling;
	const reach = Math.max(...values, metric.good, metric.ok);
	// A floor, so a rule whose numbers are all zero — "never let this happen" — still has a scale to sit
	// on rather than dividing by nothing.
	return Math.max(reach * 1.25, 1);
}

/** The three zones, in the order they are drawn left to right, as shares of the domain. */
export function zonesOf(metric: Metric, max: number): Array<readonly [grade: 'good' | 'ok' | 'bad', width: number]> {
	const at = (value: number) => Math.max(0, Math.min(100, (value / max) * 100));
	// Higher-is-better runs bad → ok → good; lower-is-better is the same three the other way round. The
	// zones are the *rule*, not this pull: what moves between two pulls of one metric is the marker.
	return metric.higherIsBetter
		? [
				['bad', at(metric.ok)],
				['ok', at(metric.good) - at(metric.ok)],
				['good', 100 - at(metric.good)],
			]
		: [
				['good', at(metric.good)],
				['ok', at(metric.ok) - at(metric.good)],
				['bad', 100 - at(metric.ok)],
			];
}

/** Where a value sits on a track of this width, clamped to it. */
export function markAt(value: number, max: number): number {
	return Math.max(0, Math.min(100, (value / max) * 100));
}

/**
 * The three grade zones, mixed into `--color-tint-base` rather than into the surface.
 *
 * **A verdict colour has to look the same to every reader, and mixing into the surface stopped it.**
 * Every surface in `global.css` is `color-mix(… var(--spec-primary) N%, <base>)`, so it carries the
 * reading spec's own hue: the Windwalker's is green, and a rose `bad` mixed into it came out orange
 * while the same declaration read rose on the Elemental. `--color-tint-base` is that same ground with
 * the spec taken out, which is what it exists for — its docstring in `global.css` names this failure and
 * `Scorecard` has always used it. These three were the ones that never got the message.
 *
 * The distinction worth keeping is which colours *should* follow the spec. `--color-band-*` mixes into
 * the surface on purpose and is measured against both grounds: a band is drawn *on* the surface and has
 * to win against it, so it is right for it to be tuned per spec. A grade is not drawn against anything
 * in particular — it is a judgement, and a judgement that changes hue depending on who is reading is
 * simply a different judgement.
 */
export const ZONE: Record<'good' | 'ok' | 'bad', string> = {
	good: 'bg-[color-mix(in_oklch,var(--color-good)_26%,var(--color-tint-base))]',
	ok: 'bg-[color-mix(in_oklch,var(--color-brew)_26%,var(--color-tint-base))]',
	bad: 'bg-[color-mix(in_oklch,var(--color-miss)_26%,var(--color-tint-base))]',
};

export const MARK: Record<'good' | 'ok' | 'bad', string> = {
	good: 'bg-good',
	ok: 'bg-brew',
	bad: 'bg-miss',
};
