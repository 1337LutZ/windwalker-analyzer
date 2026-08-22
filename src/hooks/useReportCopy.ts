// The one thing every report section needs: the copy, already pointed at this pull's verdict.
//
// Sections do not choose their own wording and do not hold a threshold. They ask for a verdict by
// section name and pass the numbers; which of the three variants comes back is decided by
// `lib/score` and written in `locales/`. That is what stops a sentence describing one log's pattern
// from being hard-coded onto every later report — the failure this whole layer exists to prevent.

import { useCallback, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import '~/lib/i18n';
import type { BandView, Grade, Scorecard } from '~/lib/score';
import type { SpecDefinition } from '~/lib/spec';
import type { Analysis } from '~/lib/types';

import { useSpec } from '~/components/report/specContext';
import { ScoreViewContext } from '~/components/report/scoreViewContext';

/**
 * Neither of the last two is a grade, and they are not each other either.
 *
 * `none` means the pull could not answer the question — the log is silent, or there was too little of
 * it to read. `exempt` means the question was never asked: every rule the section is made of belongs
 * to target counts this pull is not being read at, so there is nothing here that went ungraded. An add
 * wave has not failed to keep a single-target filler honest, and a reader who is shown "cannot say"
 * for that is being told the report tried and could not, which is not what happened.
 *
 * Both sit beside the three grades rather than among them, for the reason `Grade`'s own note gives:
 * neither is worse than `bad` nor better than `good`, so neither belongs on the scale.
 */
export type CopyGrade = Grade | 'none' | 'exempt';

export interface ReportCopy {
	/** Raw translator, for keys that are not verdicts (titles, intents, captions). */
	t: ReturnType<typeof useTranslation>['t'];
	card: Scorecard;
	/**
	 * This section's grade, or one of the two non-grades: `none` when nothing in it could be measured,
	 * `exempt` when nothing in it was asked of this pull. See `CopyGrade`.
	 */
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
	 * Whether one metric's own scope excludes the reading, by its key — the question was not asked of this
	 * pull, as opposed to asked and unanswerable.
	 *
	 * The distinction `toneOf` cannot make and must not: it returns `null` for a metric with no threshold,
	 * for one the log could not answer, and for one nothing asked, because all three have to *look* the
	 * same — an uncoloured tile. What the copy beside the tile has to say about them is not the same at
	 * all. "We could not read this" is a hedge about the log; "nothing asked this of you" is a fact about
	 * the pull, and only the second one has a number sitting next to it that the reader will otherwise
	 * take as judged.
	 *
	 * Searched across every section rather than by section name, for the reason `toneOf` gives: metric
	 * keys are unique across a scorecard, so the first match is the only match. False for a key no
	 * scorecard holds, which is the same answer as "nothing exempted it".
	 */
	unasked: (key: string) => boolean;
	/**
	 * The graded sentence for a section: `t('<section>.verdict', { context: <grade> })`.
	 *
	 * Values are interpolated, so a verdict can name the numbers that produced it. Pass `count` when
	 * the sentence needs plural agreement — i18next resolves context and plural together, which is
	 * why the keys are `verdict_good_one` / `verdict_good_other` where both matter.
	 *
	 * Five arms rather than four: `verdict_exempt` is the sentence for a pull the section's rules were
	 * never a claim about, and it is a different sentence from `verdict_none` rather than a politer one.
	 * "We could not tell" and "this did not apply to you" are not the same admission, and only one of
	 * them is a hedge about the log.
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
 * thresholds — and the reading changes both which of the spec's rules were asked of the pull and how
 * it weighs the answers. The inner map is small and bounded by the number of specs times the number of
 * readings a reader can produce (three), and it still hangs off the analysis, so a report's cards are
 * still collected with the report.
 *
 * Keyed on the view's *contents* and not on the view object, which is the whole reason this takes a
 * string apart rather than using a second `WeakMap`: `resolveBands` returns a fresh object per call,
 * so identity would miss every time and the memo above it would score the pull once per section again.
 * Both halves of the reading are in the key, because both reach the card — the bands decide which
 * rules applied and the mode decides what their answers are worth.
 */
function scorecardFor(analysis: Analysis, spec: SpecDefinition, view: BandView): Scorecard {
	let byView = CARDS.get(analysis);
	if (byView === undefined) {
		byView = new Map();
		CARDS.set(analysis, byView);
	}
	const key = `${spec.key}:${view.bands?.join(',') ?? 'all'}:${view.mode ?? 'none'}`;
	const known = byView.get(key);
	if (known !== undefined) return known;
	const card = spec.score(analysis, view);
	byView.set(key, card);
	return card;
}

export function useReportCopy(analysis: Analysis): ReportCopy {
	const { t } = useTranslation('report');
	// Read rather than passed: every section already calls this hook, so the spec and the reading
	// arrive without thirty signatures having to carry them.
	const spec = useSpec();
	const view = useContext(ScoreViewContext);
	const card = useMemo(() => scorecardFor(analysis, spec, view), [analysis, spec, view]);

	const gradeOf = useCallback(
		(section: string): CopyGrade => {
			const score = card.sections[section];
			if (score === undefined) return 'none';
			if (!score.unmeasurable) return score.grade;
			// Not measurable, and not *asked*: every metric in the section is outside its own target-count
			// scope on this reading, so the section has no grade because this is not the pull those rules
			// were ever a claim about. `every` rather than `some` — a section holding one exempt metric
			// beside one the log simply could not answer has not been excused, and saying so would
			// overclaim in the one direction this whole mechanism exists to avoid.
			// `length > 0` because `[].every()` is true: a section with no metrics at all has not been
			// excused from anything, and there is nothing to read an exemption off.
			return score.metrics.length > 0 && score.metrics.every((metric) => metric.exempt === true) ? 'exempt' : 'none';
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

	const unasked = useCallback(
		(key: string): boolean => {
			for (const score of Object.values(card.sections)) {
				const metric = score.metrics.find((m) => m.key === key);
				if (metric) return metric.exempt === true;
			}
			return false;
		},
		[card],
	);

	const verdict = useCallback(
		(section: string, values: Record<string, unknown> = {}) => {
			const grade = gradeOf(section);
			// An exempt section falls back to its plain "cannot say" wording where it has none of its own,
			// because i18next resolves a missing context to the bare `<section>.verdict` — which no section
			// has — and renders the key itself at the reader. Only `tigerPalm` declares bands today, so every
			// other section would print `flameShock.verdict` the day one of its rules gains a scope. A key
			// list is i18next's own fallback and keeps the context mechanism for the four that use it.
			if (grade === 'exempt') return t([`${section}.verdict_exempt`, `${section}.verdict_none`], values);
			return t(`${section}.verdict`, { context: grade, ...values });
		},
		[t, gradeOf],
	);

	return { t, card, gradeOf, toneOf, unasked, verdict };
}
