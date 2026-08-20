// The one thing every report section needs: the copy, already pointed at this pull's verdict.
//
// Sections do not choose their own wording and do not hold a threshold. They ask for a verdict by
// section name and pass the numbers; which of the three variants comes back is decided by
// `lib/score` and written in `locales/`. That is what stops a sentence describing one log's pattern
// from being hard-coded onto every later report — the failure this whole layer exists to prevent.

import { useCallback, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import '~/lib/i18n';
import type { Grade, Scorecard } from '~/lib/score';
import type { SpecDefinition } from '~/lib/spec';
import type { Analysis, TargetMode } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { TargetModeContext } from '~/components/report/targetModeContext';

/** `none` is not a grade — it means the pull could not answer the question at all. */
export type CopyGrade = Grade | 'none';

export interface ReportCopy {
	/** Raw translator, for keys that are not verdicts (titles, intents, captions). */
	t: ReturnType<typeof useTranslation>['t'];
	card: Scorecard;
	/** This section's grade, or `none` when nothing in it could be measured. */
	gradeOf: (section: string) => CopyGrade;
	/**
	 * The grade behind one *metric*, by its key, or null where there is none to show.
	 *
	 * The tile-level counterpart of `gradeOf`, and the distinction is the point: a tile is coloured by
	 * the number it is actually showing rather than by the verdict of the section that happens to
	 * contain it. Null covers two different cases that must look the same — a figure with no threshold
	 * at all (DPS has no target), and one this pull could not answer, where a colour would be the
	 * false verdict the `unmeasurable` flag exists to prevent.
	 *
	 * Searched across every section rather than looked up by a section name, because a KPI row is a
	 * cross-section of the card: the caller has a metric key and no reason to know which section the
	 * scoring module filed it under. Metric keys are unique across a scorecard — they are the keys of
	 * one spec's `THRESHOLDS` table — so the first match is the only match.
	 */
	toneOf: (key: string) => Grade | null;
	/**
	 * The graded sentence for a section: `t('<section>.verdict', { context: <grade> })`.
	 *
	 * Values are interpolated, so a verdict can name the numbers that produced it. Pass `count` when
	 * the sentence needs plural agreement — i18next resolves context and plural together, which is
	 * why the keys are `verdict_good_one` / `verdict_good_other` where both matter.
	 */
	verdict: (section: string, values?: Record<string, unknown>) => string;
}

/**
 * One scorecard per analysis, rather than one per section that asks for copy.
 *
 * Twenty-five components call this hook with the same `analysis`, and a `useMemo` is per component —
 * so scoring the pull was being done twenty-five times for one report. `scoreAnalysis` is documented
 * pure and total, and an `Analysis` is query data never mutated in place, so the object itself is a
 * sound key. A `WeakMap` means a card is collected along with the analysis it describes, so there is
 * nothing to evict and no way to hold a report alive after its own query has gone.
 *
 * It also makes `card` stable by identity across sections, which the memos keyed on it in
 * `Takeaways` and `KpiTiles` were already written as though it were.
 */
const CARDS = new WeakMap<Analysis, Map<string, Scorecard>>();

/**
 * Keyed by analysis, spec *and* reading, because both the spec and the reading change the card.
 *
 * The spec picks the scoring module — a Windwalker pull and an Elemental pull are scored by their own
 * thresholds — and the reading changes how the spec weighs its metrics. The inner map is small and
 * bounded by the number of specs times the number of modes, and it still hangs off the analysis, so a
 * report's cards are still collected with the report.
 */
function scorecardFor(analysis: Analysis, spec: SpecDefinition, mode: TargetMode | null): Scorecard {
	let byMode = CARDS.get(analysis);
	if (byMode === undefined) {
		byMode = new Map();
		CARDS.set(analysis, byMode);
	}
	const key = `${spec.key}:${mode ?? 'auto'}`;
	const known = byMode.get(key);
	if (known !== undefined) return known;
	const card = spec.score(analysis, mode);
	byMode.set(key, card);
	return card;
}

export function useReportCopy(analysis: Analysis): ReportCopy {
	const { t } = useTranslation('report');
	// Read rather than passed: every section already calls this hook, so the spec and the reading
	// arrive without thirty signatures having to carry them.
	const spec = useContext(SpecContext);
	const mode = useContext(TargetModeContext);
	const card = useMemo(() => scorecardFor(analysis, spec, mode), [analysis, spec, mode]);

	const gradeOf = useCallback(
		(section: string): CopyGrade => {
			const score = card.sections[section];
			if (score === undefined || score.unmeasurable) return 'none';
			return score.grade;
		},
		[card],
	);

	const toneOf = useCallback(
		(key: string): Grade | null => {
			for (const score of Object.values(card.sections)) {
				const metric = score.metrics.find((m) => m.key === key);
				if (metric) return metric.unmeasurable ? null : metric.grade;
			}
			return null;
		},
		[card],
	);

	const verdict = useCallback(
		(section: string, values: Record<string, unknown> = {}) =>
			t(`${section}.verdict`, { context: gradeOf(section), ...values }),
		[t, gradeOf],
	);

	return { t, card, gradeOf, toneOf, verdict };
}
