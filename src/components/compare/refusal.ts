import type { MetricGap } from '~/lib/compare';

/**
 * Why a pair has no number, in the wording each reason calls for.
 *
 * A table rather than an interpolated key, because `i18n/__tests__/keys.test.ts` finds a key by
 * reading the source for quoted key paths. A key assembled from a variable is a key that guard cannot
 * see, and it would report every one of these as copy nothing reads.
 *
 * Shared, because two places say it now: the ranked chart's cards and the detail row below them. Two
 * copies of a five-way mapping is two chances for one of them to answer a refusal with the wrong
 * sentence.
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

/** The copy key for a gap that carries no number, and the pull its sentence names. */
export function refusalOf(gap: MetricGap, players: { a: string; b: string }): { key: string; player: string } {
	const player = gap.whySide === 'a' ? players.a : players.b;
	if (gap.why === 'missing') return { key: REFUSAL.missing, player };
	if (gap.why === 'exempt') {
		return { key: gap.whySide === null ? REFUSAL.notAskedEither : REFUSAL.notAsked, player };
	}
	return { key: gap.whySide === null ? REFUSAL.unmeasurableBoth : REFUSAL.unmeasurable, player };
}
