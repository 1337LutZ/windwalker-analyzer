// The Windwalkers in one pull.
//
// This is the cheap query that runs before the expensive one. `playerDetails` costs a single point
// and answers the only question that decides whether the several pages of events are worth
// fetching at all — and on a Classic log it is the only thing that can answer it, because
// `combatantinfo` reports `specID` as 0 there, so the event stream cannot name a spec.

import { useQuery } from '@tanstack/react-query';

import { WclClient, recordCredits, type FightPlayer } from '~/lib/wcl';

/**
 * WarcraftLogs' own spelling for the one class and spec this app reads. They are the strings the
 * API returns in `type` and `specs[].spec`, not names of ours, so they are matched exactly.
 */
const CLASS = 'Monk';
const SPEC = 'Windwalker';

export function useFightPlayers(token: string | null, code: string | null, fightID: number | null) {
	return useQuery<FightPlayer[]>({
		queryKey: ['wcl', 'fight-players', code, fightID],
		queryFn: async () => {
			const players = await new WclClient({
				token: token!,
				onCredits: recordCredits,
			}).fetchPlayerDetails(code!, fightID!);
			return players.filter((player) => player.playerClass === CLASS && player.specs.includes(SPEC));
		},
		enabled: token !== null && code !== null && fightID !== null,
		// The roster of a finished pull is fixed, so flipping between two fights refetches neither.
		staleTime: Infinity,
		retry: false,
	});
}
