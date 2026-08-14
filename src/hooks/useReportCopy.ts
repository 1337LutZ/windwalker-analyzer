// The one thing every report section needs: the copy, already pointed at this pull's verdict.
//
// Sections do not choose their own wording and do not hold a threshold. They ask for a verdict by
// section name and pass the numbers; which of the three variants comes back is decided by
// `lib/score` and written in `locales/`. That is what stops a sentence describing one log's pattern
// from being hard-coded onto every later report — the failure this whole layer exists to prevent.

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import '~/lib/i18n';
import type { Grade, Scorecard } from '~/lib/score';
import { scoreAnalysis } from '~/lib/score';
import type { Analysis } from '~/lib/types';

/** `none` is not a grade — it means the pull could not answer the question at all. */
export type CopyGrade = Grade | 'none';

export interface ReportCopy {
	/** Raw translator, for keys that are not verdicts (titles, intents, captions). */
	t: ReturnType<typeof useTranslation>['t'];
	card: Scorecard;
	/** This section's grade, or `none` when nothing in it could be measured. */
	gradeOf: (section: string) => CopyGrade;
	/**
	 * The graded sentence for a section: `t('<section>.verdict', { context: <grade> })`.
	 *
	 * Values are interpolated, so a verdict can name the numbers that produced it. Pass `count` when
	 * the sentence needs plural agreement — i18next resolves context and plural together, which is
	 * why the keys are `verdict_good_one` / `verdict_good_other` where both matter.
	 */
	verdict: (section: string, values?: Record<string, unknown>) => string;
}

export function useReportCopy(analysis: Analysis): ReportCopy {
	const { t } = useTranslation('report');
	const card = useMemo(() => scoreAnalysis(analysis), [analysis]);

	const gradeOf = useCallback(
		(section: string): CopyGrade => {
			const score = card.sections[section];
			if (score === undefined || score.unmeasurable) return 'none';
			return score.grade;
		},
		[card],
	);

	const verdict = useCallback(
		(section: string, values: Record<string, unknown> = {}) =>
			t(`${section}.verdict`, { context: gradeOf(section), ...values }),
		[t, gradeOf],
	);

	return { t, card, gradeOf, verdict };
}
