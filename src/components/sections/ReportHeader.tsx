import { useTranslation } from 'react-i18next';

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
	// The outcome words live in `ui`, not `report`: the fight picker shows the same three strings
	// before a report exists, and two copies drifted apart once already.
	const { t: tUi } = useTranslation('ui');
	// The analysis already carries the mode's name as the zone gave it, so the header needs no table
	// and no second query — just the one entry, keyed by the id it belongs to.
	const difficultyNames = analysis.difficultyName === null ? {} : { [analysis.difficulty]: analysis.difficultyName };
	// How much of what the spec asks for the letter above was actually taken over. Absent on a scorecard
	// captured before the field existed and on any spec that has not adopted it, and an absent
	// denominator prints nothing rather than a guessed one.
	const judged = card.judged;
	/**
	 * Whether the report has a reading of the pull at all.
	 *
	 * `overallOf` parks the grade at `ok` when too little of the weight survived to make the letter a
	 * claim, which is the right thing for the arithmetic to do and the wrong thing to print: "some parts
	 * were solid and others lost damage" is a confident sentence about a pull the report could barely
	 * read. So the flag beside the grade decides the wording, and the rule loses its colour with it —
	 * amber down the side of a refusal reads as a middling verdict, which is the claim being withdrawn.
	 */
	const cannotSay = judged?.unmeasurable === true;

	return (
		<header>
			<p className="m-0 mb-3 font-mono text-sm font-medium tracking-[0.16em] uppercase text-muted">
				{analysis.encounter} &middot; {difficultyLabel(analysis.difficulty, analysis.size, difficultyNames)} &middot;{' '}
				{tUi(analysis.kill ? 'common.kill' : 'common.wipe')} &middot; {formatClock(analysis.durationMs)}
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
			    below it is detail that this sentence has already framed.

			    The denominator goes inside the same rule rather than somewhere below it, because the two
			    lines are one claim — a grade, and how much of the pull it was drawn over. A reader who gets
			    no further than the top of the report has to be able to tell a `good` over ten thirteenths of
			    the weight from a `good` over all of it, and anywhere else on the page is a place to hunt. */}
			<div className={`mt-4 max-w-[56ch] border-l-2 pl-4 ${gradeClass('border', cannotSay ? null : card.overall)}`}>
				<p className="m-0 text-lg leading-snug font-semibold text-balance text-ink sm:text-xl">
					{cannotSay ? t('overall.none') : t(`overall.${card.overall}`)}
				</p>
				{/* Printed on every pull, including the ones judged in full. A line that appeared only when the
				    reckoning was short would be indistinguishable from a line that was never built, and "judged
				    on all of it" is only readable as reassurance if it is said. */}
				{judged === undefined ? null : (
					<p className="mt-2 mb-0 font-mono text-sm leading-snug text-muted">
						{t('summary.judged', {
							context: judged.unmeasurable ? 'partial' : undefined,
							measured: judged.measured,
							total: judged.total,
						})}
					</p>
				)}
			</div>
		</header>
	);
}
