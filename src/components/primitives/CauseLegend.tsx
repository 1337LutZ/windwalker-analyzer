import { useTranslation } from 'react-i18next';

import type { JudgmentCause } from '~/lib/types';

import CauseTag from './CauseTag';

/**
 * The tag vocabulary, under the table that spends it.
 *
 * A tag is only worth drawing if the reader knows what it asks of them, and the takeaway is the half a
 * one-word badge cannot carry: `Raid` reads as an excuse until it says *communicate cooldowns* beside
 * it. Drawn from the same copy the badge reads, so the legend cannot name a tag the rows do not use or
 * word one differently.
 *
 * Only the tags a table actually drew. A legend listing six when the pull produced two is a legend
 * teaching a reader vocabulary they are not looking at, which is what `ChartKey`'s own docblock warns
 * about from the other direction.
 */
export default function CauseLegend({ causes }: { causes: readonly JudgmentCause[] }) {
	const { t } = useTranslation('report');
	const shown = ORDER.filter((cause) => causes.includes(cause));
	if (shown.length === 0) return null;
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
			{shown.map((cause) => (
				<span key={cause} className="inline-flex items-center text-sm text-muted">
					<CauseTag cause={cause} />
					{t(`cause.${cause}.takeaway`)}
				</span>
			))}
		</div>
	);
}

/**
 * Reading order, and it is the report's own: what you can fix first, what nobody can fix last.
 *
 * Fixed here rather than taken from the order the rows happened in, so two pulls of the same fight draw
 * the same legend and a reader learns one sequence.
 */
const ORDER: readonly JudgmentCause[] = ['player', 'rotation', 'raid', 'build', 'fight', 'log'];
