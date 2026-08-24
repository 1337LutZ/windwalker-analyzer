import type { Metric } from '~/lib/score/model';

/**
 * The domain a metric's scale is drawn over.
 *
 * A share is out of 100 whatever this pull did, so its scale is honest at 0–100 and a reader can
 * compare two of them by eye. Everything else is open-ended — a count of potions, seconds at a
 * ceiling — and has no natural ceiling to draw, so the domain comes from the numbers themselves with
 * headroom past whichever is largest. That headroom is what stops a value sitting exactly on the right
 * edge and reading as "off the end of the scale" when it is merely the biggest number present.
 */
function domainOf(metric: Metric): number {
	if (metric.unit === 'percent') return 100;
	const reach = Math.max(metric.value, metric.good, metric.ok);
	// A floor, so a rule whose numbers are all zero — "never let this happen" — still has a scale to sit
	// on rather than dividing by nothing.
	return Math.max(reach * 1.25, 1);
}

/** The three zones, in the order they are drawn left to right, as shares of the domain. */
function zonesOf(metric: Metric): Array<readonly [grade: 'good' | 'ok' | 'bad', width: number]> {
	const max = domainOf(metric);
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

const ZONE: Record<'good' | 'ok' | 'bad', string> = {
	good: 'bg-[color-mix(in_oklch,var(--color-good)_26%,var(--color-surface))]',
	ok: 'bg-[color-mix(in_oklch,var(--color-brew)_26%,var(--color-surface))]',
	bad: 'bg-[color-mix(in_oklch,var(--color-miss)_26%,var(--color-surface))]',
};

const MARK: Record<'good' | 'ok' | 'bad', string> = {
	good: 'bg-good',
	ok: 'bg-brew',
	bad: 'bg-miss',
};

/**
 * One metric against its own bands: where the lines sit, and where this pull landed between them.
 *
 * **The bands are the thing being drawn, and the value is a mark on them.** Every graded number in
 * this report is a comparison against two thresholds, and until now the reader was shown only the
 * result of that comparison — a letter, and a sentence naming the target. That tells them they missed;
 * it does not tell them *by how much*, which is the difference between a metric worth opening and one
 * worth a glance. A pull at 76.7% against a 95% target and one at 94.8% are both `bad` and are not the
 * same problem.
 *
 * **A washed zone and a solid mark**, which is the same pairing the charts use for a band and a bar:
 * the zones are the rule and are drawn at a quarter strength so they read as ground, and the mark is
 * this pull and is drawn at full. The mark takes the grade's own tone, so it agrees with the letter
 * beside it rather than restating it in a different colour.
 *
 * Unmeasurable metrics do not reach here — a scale with no mark on it is a picture of a rule nobody
 * was held to, and `Scorecard` says so in words instead.
 */
export default function BandScale({ metric }: { metric: Metric }) {
	const max = domainOf(metric);
	const at = Math.max(0, Math.min(100, (metric.value / max) * 100));

	return (
		<div className="relative h-3.5" aria-hidden="true">
			<div className="absolute inset-x-0 top-1 flex h-1.5 overflow-hidden rounded-sm">
				{zonesOf(metric)
					.filter(([, width]) => width > 0.01)
					.map(([grade, width]) => (
						<div key={grade} className={`h-full ${ZONE[grade]}`} style={{ width: `${width}%` }} />
					))}
			</div>
			{/* Ringed in the card's own surface so the mark stays visible where it sits on the join between
			    two zones, which is exactly where a metric that only just missed will put it. */}
			<div
				className={`absolute top-0 h-3.5 w-[3px] -translate-x-[1.5px] rounded-sm ring-2 ring-surface ${MARK[metric.grade]}`}
				style={{ left: `${at}%` }}
			/>
		</div>
	);
}
