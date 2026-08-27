import type { Metric } from '~/lib/score/model';

import { domainOf, markAt, MARK, ZONE, zonesOf } from './bandScale';

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
 *
 * The geometry lives in `bandScale.ts`, shared with the compare page's two-mark version of this. One
 * pull and two pulls have to be drawn on the same domain or the two pictures disagree about where a
 * threshold is.
 */
export default function BandScale({ metric }: { metric: Metric }) {
	const max = domainOf(metric, [metric.value]);
	const at = markAt(metric.value, max);

	return (
		<div className="relative h-3.5" aria-hidden="true">
			<div className="absolute inset-x-0 top-1 flex h-1.5 overflow-hidden rounded-sm">
				{zonesOf(metric, max)
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
