import { useReportCopy } from '~/hooks/useReportCopy';
import type { Analysis } from '~/lib/types';

import { BrewBank } from '../charts';
import { Note, Prose, Section } from '../primitives';

/** The bank counter over the pull, sharing its clock with the timeline above it. */
export default function BrewBankTimeline({ analysis }: { analysis: Analysis }) {
	const { brew } = analysis;
	const { t, card, verdict } = useReportCopy(analysis);

	// Cap waste is one of the two metrics behind the section's grade, so its clause reads the metric
	// rather than the section: a pull can spend full brews every time and still sit at the cap.
	const cap = card.sections.brew?.metrics.find((m) => m.key === 'brewCapWaste');

	// `uses` is what the graded sentence counts, so a pull that never spent a brew asks for the `none`
	// variant directly instead of trusting the section grade — stacks wasted at the cap keep the
	// section measurable, and the average of zero brews is not a thing to report.
	const spent = brew.uses > 0;

	const summary = [
		spent ? verdict('brew', { count: brew.uses, avg: brew.avgConsumed }) : t('brew.verdict', { context: 'none' }),
		// `count`, not `wasted`: the sentence has singular and plural forms, and i18next selects them
		// off `count` alone. One stack lost at the cap is reachable, so "1 stacks" was too.
		cap && !cap.unmeasurable ? t('brew.cap', { context: cap.grade, count: brew.wastedAtCap }) : null,
		// An empty bank is only worth praising when brews were actually going out; on a pull with none
		// it would be congratulating a bank that never filled.
		brew.bankAtEnd > 0 ? t('brew.bankLeft', { count: brew.bankAtEnd }) : spent ? t('brew.bankLeftNone') : null,
	]
		.filter(Boolean)
		.join(' ');

	return (
		<Section id="bank" title={t('brew.title')}>
			<Prose>{t('brew.intent')}</Prose>
			<div className="mt-5">
				{brew.bankTimeline.length > 0 ? <BrewBank analysis={analysis} /> : <Note>{t('empty.section')}</Note>}
			</div>
			<div className="mt-5">
				<Prose>{summary}</Prose>
			</div>
		</Section>
	);
}
