import { useTranslation } from 'react-i18next';

import type { ComparabilityNote, NoteKind } from '~/lib/compare';
import { formatHumanDuration } from '~/lib/format';

import { Callout } from '../primitives';

/**
 * One key per reason, written out.
 *
 * A table rather than an interpolated key, because `i18n/__tests__/keys.test.ts` finds a key by
 * reading the source for quoted key paths. A key built from a variable is invisible to it, and every
 * one of these would be reported as copy nothing reads.
 */
const NOTE: Record<NoteKind, string> = {
	encounter: 'compare.note.encounter',
	difficulty: 'compare.note.difficulty',
	outcome: 'compare.note.outcome',
	duration: 'compare.note.duration',
	bands: 'compare.note.bands',
	itemLevel: 'compare.note.itemLevel',
};

/**
 * What makes these two pulls unequal, said before anything is compared.
 *
 * **Nothing below is suppressed because of a note.** Two pulls of different bosses are still worth
 * putting side by side, and refusing to draw the comparison would be a worse answer than drawing it
 * and naming what to discount. That is the posture the rest of the report already takes towards a
 * number it cannot stand behind: say what is known, say what is not, and never quietly average the
 * two.
 *
 * Amber rather than rose. These are caveats about what the figures mean, not errors — a comparison of
 * two different encounters is a thing a reader may well have asked for on purpose.
 */
export default function ComparabilityNotes({ notes }: { notes: readonly ComparabilityNote[] }) {
	const { t } = useTranslation('report');
	if (notes.length === 0) return null;

	return (
		<Callout tone="brew" title={t('compare.note.title')}>
			<ul className="m-0 flex list-disc flex-col gap-1.5 pl-5">
				{notes.map((note) => (
					<li key={note.kind}>
						{t(NOTE[note.kind], {
							// A duration reaches the sentence as a written length rather than as a number of
							// milliseconds: the copy names two pulls, and "535191" is not what either of them was.
							a: note.kind === 'duration' ? formatHumanDuration(Number(note.a)) : note.a,
							b: note.kind === 'duration' ? formatHumanDuration(Number(note.b)) : note.b,
						})}
					</li>
				))}
			</ul>
		</Callout>
	);
}
