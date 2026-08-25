// One player's pull, fetched and read.
//
// This is the expensive one — a report query, a damage table and several pages of events — so it
// never runs off a selection changing. It runs off a request: a `{ code, fightID, playerName }`
// triple that someone explicitly asked for. That triple is also what makes the report on screen a
// fact about a named pull rather than about whatever the pickers happen to say, which is how
// `ReportFlow` can tell that they have moved off it and drop the report they no longer describe.
//
// TanStack Query does not replace the progress callback, it wraps it. The page count is not known
// until the last page says so, so the only thing that can report how far along the fetch is, is the
// fetch — `onProgress` feeds a piece of state here and the query owns everything else.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import '~/lib/i18n';

import type { AnalysisSettings } from '~/lib/settings';
import type { SpecDefinition } from '~/lib/spec';
import type { Analysis, FightDataset } from '~/lib/types';
import {
	WclClient,
	fetchFightDataset,
	readCredits,
	recordAnalysisCost,
	recordCredits,
	type FetchProgress,
} from '~/lib/wcl';

export interface AnalysisRequest {
	code: string;
	fightID: number;
	playerName: string;
}

export interface FightAnalysisResult {
	analysis: Analysis | null;
	error: unknown;
	isFetching: boolean;
	/** Null unless a fetch is actually in flight for the current request. */
	progress: FetchProgress | null;
}

/**
 * The query caches the *dataset*, and the analysis is derived from it outside the query.
 *
 * That split is what makes the settings usable. Changing a threshold has to re-read the fight, but
 * it must not re-fetch it: the events are already here, and every refetch spends WarcraftLogs API
 * points against the reader's own hourly budget. Keying the query on the settings would have made
 * a slider cost a report.
 */
export function useFightAnalysis(
	token: string | null,
	request: AnalysisRequest | null,
	settings: AnalysisSettings,
	spec: SpecDefinition,
): FightAnalysisResult {
	const { t } = useTranslation('ui');
	const queryKey = ['wcl', 'fight-analysis', request?.code, request?.fightID, request?.playerName];
	const key = queryKey.join('|');

	// Stamped with the request it belongs to: a fetch abandoned when someone asked for a different
	// pull can still deliver one last progress callback, and it must not caption the new one.
	const [progress, setProgress] = useState<{
		key: string;
		value: FetchProgress;
	} | null>(null);

	const query = useQuery<FightDataset>({
		queryKey,
		queryFn: async () => {
			setProgress({
				key,
				value: { phase: 'report', message: t('progress.report') },
			});
			// What this pull costs, watched rather than assumed. Every request the fetch makes reports
			// `pointsSpentThisHour` back, so the figure before the first one and the figure after the
			// last one bracket the whole run — and their difference is what an analysis of *this* fight
			// cost, which is the only honest divisor for "how many more pulls fit". A constant cannot be
			// right for both: the event stream pages, so a nine-minute pull costs more than a short one.
			//
			// Null before means nothing has been fetched yet on this token, so there is nothing to
			// subtract from and the run goes unmeasured rather than measured wrongly.
			const before = readCredits().credits?.spent ?? null;
			const dataset = await fetchFightDataset(new WclClient({ token: token!, onCredits: recordCredits }), {
				code: request!.code,
				fightID: request!.fightID,
				playerName: request!.playerName,
				onProgress: (value) => setProgress({ key, value }),
			});
			const after = readCredits().credits?.spent ?? null;
			if (before !== null && after !== null) recordAnalysisCost(after - before);

			// Reading the fight is synchronous and takes long enough to be felt, so yield once and let
			// the bar reach its last step before the main thread is blocked.
			setProgress({
				key,
				value: {
					phase: 'done',
					events: dataset.events.length,
					message: t('progress.fight'),
				},
			});
			await new Promise((resolve) => setTimeout(resolve, 0));

			return dataset;
		},
		enabled: token !== null && request !== null,
		// A finished pull's events cannot change, so asking for the same one twice is free.
		staleTime: Infinity,
		gcTime: Infinity,
		retry: false,
	});

	// Re-read when the fight changes or a threshold does, and at no other time: reading a long pull is
	// synchronous and blocks the main thread, so it must not run on every unrelated render. The spec
	// owns the reading — `analyse` is the engine's entry point in the registry.
	const analysis = useMemo(
		() => (query.data === undefined ? null : spec.analyse(query.data, settings)),
		[query.data, settings, spec],
	);

	return {
		analysis,
		error: query.error,
		isFetching: query.isFetching,
		progress: query.isFetching && progress?.key === key ? progress.value : null,
	};
}
