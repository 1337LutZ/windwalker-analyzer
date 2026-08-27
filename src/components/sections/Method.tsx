import { useReportCopy } from '~/hooks/useReportCopy';
import type { Analysis } from '~/lib/types';

import { useSpec } from '~/components/report/specContext';

import { Note, Prose, Section } from '../primitives';

import ReferenceNote from './ReferenceNote';

/** What the numbers were measured against, and the three things the log cannot answer. */
export default function Method({ analysis }: { analysis: Analysis }) {
	const { t } = useReportCopy(analysis);
	// Two of the three notes are facts about one spec's own log, and this section is shared, so both
	// were being read out to every Elemental reader: the resource note named Energy, which an Elemental
	// does not have, and the spec note said the report confirmed the spec by "a Tigereye Brew cast",
	// which no shaman ever makes. The mechanism is the one `app.intro` and the raid-buff sentences
	// already use — an i18next context off `spec.key`, resolving `method.energy_windwalker` against
	// `method.energy_elemental` — rather than a second component or a flag on the analysis.
	const spec = useSpec();

	return (
		<Section id="method" title={t('method.title')}>
			<Prose>{t('method.intent')}</Prose>
			{/* Three separate notes rather than one paragraph: each is a different limit on a different
			    number, and a reader checking one claim should not have to read past the other two. */}
			<div className="mt-4 flex flex-col gap-2.5">
				<Note>{t('method.engaged')}</Note>
				<Note>{t('method.energy', { context: spec.key })}</Note>
				<Note>{t('method.spec', { context: spec.key })}</Note>
				{/* Fourth note, and the only one that is about data rather than about a limit: where the
				    grading lines came from, and when they were last refreshed. It is generic — the block
				    reads the registry's own spec key and says so plainly when no sweep has covered it. */}
				<ReferenceNote analysis={analysis} />
			</div>
		</Section>
	);
}
