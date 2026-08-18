// Every boss pull in one report.
//
// Keyed by report code alone. The token is deliberately not part of the key: a query key is a
// long-lived object held in memory by the cache, and the token has exactly one place it is allowed
// to live. Signing out clears the whole cache instead, which is stronger — it drops the data the
// token bought, not just the key that named it.

import { useQuery } from '@tanstack/react-query';

import { WclClient, listReportFights, recordCredits, type ReportFightList } from '~/lib/wcl';

export function useReportFights(token: string | null, code: string | null) {
	return useQuery<ReportFightList>({
		queryKey: ['wcl', 'report-fights', code],
		queryFn: () => listReportFights(new WclClient({ token: token!, onCredits: recordCredits }), code!),
		enabled: token !== null && code !== null,
		// A report that has been uploaded does not change, so a code typed twice costs one fetch.
		staleTime: Infinity,
		// Every failure this can raise is either the token, the code or WarcraftLogs itself, and none
		// of the three is fixed by asking again a second later.
		retry: false,
	});
}
