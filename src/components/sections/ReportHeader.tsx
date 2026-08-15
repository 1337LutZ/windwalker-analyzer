import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import { gradeClass } from '../primitives/grade';

import { difficultyLabel } from '../format';

/**
 * The verdict's rule, in the report's own colour vocabulary: `kick` for a pull that held together,
 * `brew` for one that leaked, `miss` for one that did not.
 *
 * The colour only reinforces the sentence — the words carry the judgement on their own, so nothing
 * is lost to a reader who cannot separate the three hues.
 */

/** Which pull this is, who it belongs to, how it went, and what the report is about to argue. */
export default function ReportHeader({ analysis }: { analysis: Analysis }) {
	const { t, card } = useReportCopy(analysis);
	// The analysis already carries the mode's name as the zone gave it, so the header needs no table
	// and no second query — just the one entry, keyed by the id it belongs to.
	const difficultyNames = analysis.difficultyName === null ? {} : { [analysis.difficulty]: analysis.difficultyName };

	return (
		<header>
			<p className="m-0 mb-3 font-mono text-sm font-medium tracking-[0.16em] uppercase text-muted">
				{analysis.encounter} &middot; {difficultyLabel(analysis.difficulty, analysis.size, difficultyNames)} &middot;{' '}
				{analysis.kill ? 'kill' : 'wipe'} &middot; {formatClock(analysis.durationMs)}
			</p>
			{/* The anchor the contents list jumps to. The summary has no heading of its own — the report
			    title *is* its heading — so it borrows this one rather than growing a second, redundant
			    line above it. `scroll-mt-14` matches the sticky bar, as on every section heading. */}
			<h1
				id="summary-heading"
				className="scroll-mt-14 m-0 font-mono text-[28px] leading-[1.05] font-semibold tracking-[-0.02em] text-balance text-ink sm:text-[34px] md:text-[38px]"
			>
				{analysis.player}
			</h1>
			{/* The only line that answers "how did this pull go", so it is set as a verdict rather than as
			    a caption: brightest ink, above body size, and a rule in the grade's own colour. Everything
			    below it is detail that this sentence has already framed. */}
			<p
				className={`mt-4 mb-0 max-w-[56ch] border-l-2 pl-4 text-lg leading-snug font-semibold text-balance text-ink sm:text-xl ${gradeClass('border', card.overall)}`}
			>
				{t(`overall.${card.overall}`)}
			</p>
			<p className="mt-4 mb-0 max-w-[64ch] leading-relaxed text-ink-2">
				{t('header.intent')} {t('header.source')}
			</p>
		</header>
	);
}
