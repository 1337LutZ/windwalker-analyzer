import { useTranslation } from 'react-i18next';

import type { MetricGap } from '~/lib/compare';
import i18n from '~/lib/i18n/config';

import CompareScale from '../score/CompareScale';
import PullKey from './PullKey';
import { reading } from '../score/reading';

/**
 * Why a pair has no number, in the wording each reason calls for.
 *
 * A table rather than an interpolated key, because `i18n/__tests__/keys.test.ts` finds a key by
 * reading the source for quoted key paths. A key assembled from a variable is a key that guard cannot
 * see, and it would report every one of these as copy nothing reads.
 */
const REFUSAL = {
	missing: 'compare.metric.missing',
	unmeasurable: 'compare.metric.unmeasurable',
	unmeasurableBoth: 'compare.metric.unmeasurableBoth',
	// Spelled `notAsked` rather than `exempt`, and the key name is the reason: `exempt` is our word for
	// a decision about scope, `readerVoice.test.ts` holds it to five key names nobody reads, and the
	// copy under it says "not asked" anyway. Two spellings of one idea is one too many.
	notAsked: 'compare.metric.notAsked',
	notAskedEither: 'compare.metric.notAskedEither',
} as const;

/**
 * One metric, on both pulls: what each of them read, and how far apart that is.
 *
 * **A row that cannot be compared says so and draws nothing.** The alternative was a scale with one
 * mark on it, which is a picture of a comparison that did not happen — and worse, the reader would
 * have taken the missing mark for a zero. The three reasons are kept apart because they are three
 * different facts: the log declined, the rule did not apply, or the scorecard has no such rule.
 */
export default function MetricRow({ gap, players }: { gap: MetricGap; players: { a: string; b: string } }) {
	const { t } = useTranslation('report');
	const key = `summary.takeaways.metric.${gap.key}.label`;
	const label = i18n.exists(key) ? t(key) : gap.key;

	if (gap.bands === null || gap.a === null || gap.b === null) {
		const named = gap.whySide === 'a' ? players.a : players.b;
		const which =
			gap.why === 'missing'
				? REFUSAL.missing
				: gap.why === 'exempt'
					? gap.whySide === null
						? REFUSAL.notAskedEither
						: REFUSAL.notAsked
					: gap.whySide === null
						? REFUSAL.unmeasurableBoth
						: REFUSAL.unmeasurable;
		return (
			<li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
				<span className="text-sm text-ink-2">{label}</span>
				<span className="text-sm text-muted">{t(which, { player: named })}</span>
			</li>
		);
	}

	return (
		<li className="flex flex-col gap-1.5 py-2.5">
			<span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<span className="text-sm text-ink-2">{label}</span>
				{/* Both readings, always first pull then second, each wearing its own mark. Two bare
				    numbers side by side would leave the reader matching them to the dots below by
				    position, which is exactly the guess this page exists to remove. */}
				<span className="flex items-baseline gap-3 tabular font-mono text-sm text-ink">
					<PullKey side="a">{reading(gap.a, t)}</PullKey>
					<PullKey side="b">{reading(gap.b, t)}</PullKey>
				</span>
			</span>
			<CompareScale a={gap.a} b={gap.b} />
		</li>
	);
}
