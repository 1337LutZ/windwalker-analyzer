// What is left of the reader's WarcraftLogs hourly budget, ready to render.
//
// Two sources, and the split is the whole design. Nearly every reading arrives for free: each
// document in `lib/wcl` carries `rateLimitData`, so fetching a report list, a roster or a page of
// events reports the budget back at no extra cost, and the number on screen refreshes exactly when
// the reader analyses something. See `lib/wcl/rateLimit.ts` for the measurements.
//
// The exception is the first one. A visitor who has just signed in has fetched nothing, so there is
// nothing to have carried a reading — and the sign-in step is the first place the figure is meant to
// appear. That case, and only that case, spends one point asking directly. It is disabled the moment
// a reading exists, never retried and never refetched, so it happens at most once per session.

import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
	WclClient,
	readCredits,
	readCreditsOnServer,
	recordCredits,
	subscribeCredits,
	viewCredits,
	type CreditsView,
} from '~/lib/wcl';

/**
 * The budget as the UI should state it, or null when there is nothing honest to state.
 *
 * Null covers every case where a figure would be a lie: signed out, signed in but not yet answered,
 * the query refused, the field missing, and a reading old enough that the hour has since turned
 * over. Callers render nothing on null — never a zero, which would read as "you are out" on an app
 * that is working.
 */
export function useApiCredits(token: string | null): CreditsView | null {
	const snapshot = useSyncExternalStore(subscribeCredits, readCredits, readCreditsOnServer);

	useQuery({
		queryKey: ['wcl', 'rate-limit'],
		queryFn: async () => {
			const credits = await new WclClient({ token: token! }).fetchRateLimit();
			recordCredits(credits);
			return credits;
		},
		// The point of the seed is to fill a gap, so it is not asked when there is no gap: a reading
		// already carried in by another request makes this query unnecessary and it never runs.
		enabled: token !== null && snapshot.credits === null,
		// Everything below says the same thing in the four ways TanStack can ask again. Asking again
		// is what would turn one point into a poll, and the free readings keep it current anyway.
		staleTime: Infinity,
		gcTime: Infinity,
		retry: false,
		refetchOnMount: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	// Deliberately not reading the query's `error`. A budget that cannot be read is a display that is
	// not shown, not a failure worth putting in front of someone trying to analyse a log.
	return viewCredits(snapshot);
}
