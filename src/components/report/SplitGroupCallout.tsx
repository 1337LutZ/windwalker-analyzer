import { useTranslation } from 'react-i18next';

import type { SplitGroup, SplitGroupKind } from '~/lib/game/splitGroups';

import { Callout } from '../primitives';

/**
 * One key per split, written out.
 *
 * A table rather than an interpolated key, for the reason `ComparabilityNotes` gives beside its own:
 * `i18n/__tests__/keys.test.ts` finds a key by reading the source for quoted key paths, and a key
 * built from a variable is invisible to it — every one of these would be reported as copy nothing
 * reads, and a typo in one would reach a reader as its own key.
 */
const COPY: Record<SplitGroupKind, string> = {
	towerRuns: 'splitGroup.towerRuns',
	belt: 'splitGroup.belt',
	splitPair: 'splitGroup.splitPair',
};

/**
 * What the raid did to this pull, said before any of it is graded.
 *
 * **Nothing below is suppressed because of it, and no figure moves.** A belt team's four minutes of
 * nothing to hit are real, and a report that quietly credited them back would be describing a pull
 * nobody had — the same posture `ComparabilityNotes` takes towards two unequal pulls, and the one the
 * rest of this report takes towards any number it cannot stand behind. Say what happened, then let the
 * figures say what they say.
 *
 * Above both mode controls rather than beside them, because it is the fact those two choices are made
 * under: a reader deciding whether to force single target on a Dark Shaman pull wants to know first
 * that they only ever fought one of the two.
 *
 * Amber rather than rose. Going up the tower is not a mistake and neither is taking belt duty — these
 * are jobs somebody was given, and the callout exists so the grades are read with that in hand.
 */
export default function SplitGroupCallout({ split }: { split: SplitGroup | null | undefined }) {
	const { t } = useTranslation('report');
	if (!split) return null;

	return (
		<Callout tone="brew" title={t('splitGroup.title')}>
			<p className="m-0">
				{t(COPY[split.kind], {
					// The excursion count, and i18next's plural selector in the same value: one tower run and
					// four belt trips are different sentences rather than one sentence with a bracketed `(s)`.
					count: split.windows.length,
					// `percent` divides by a hundred, so the share arrives as 0-100 like every other one.
					share: split.share * 100,
					away: split.awayMs,
					// Only `splitPair` names an enemy, and only when the report's actor list could name it —
					// the context arm is what the sentence falls back to rather than an empty `{{name}}`.
					...(split.name === null ? { context: 'unnamed' } : { name: split.name }),
				})}
			</p>
		</Callout>
	);
}
