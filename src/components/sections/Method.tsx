import { useReportCopy } from '~/hooks/useReportCopy';
import type { Analysis } from '~/lib/types';

import { Note, Prose, Section } from '../primitives';

/** What the numbers were measured against, and the three things the log cannot answer. */
export default function Method({ analysis }: { analysis: Analysis }) {
	const { t } = useReportCopy(analysis);

	return (
		<Section id="method" title={t('method.title')}>
			<Prose>{t('method.intent')}</Prose>
			{/* Three separate notes rather than one paragraph: each is a different limit on a different
			    number, and a reader checking one claim should not have to read past the other two. */}
			<div className="mt-4 flex flex-col gap-2.5">
				<Note>{t('method.engaged')}</Note>
				<Note>{t('method.energy')}</Note>
				<Note>{t('method.spec')}</Note>
			</div>
		</Section>
	);
}
