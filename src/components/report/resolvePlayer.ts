import type { FightPlayer } from '~/lib/wcl';

/**
 * Which player the report is about, given the roster of the pull and what the reader has chosen.
 *
 * Three candidates in order, and the order is the whole content of this function:
 *
 *   1. **the name the reader picked**, if this pull has someone by that name — so swapping between
 *      encounters keeps reading the same person, which is the point of swapping;
 *   2. the actor the shared link named, so a link to one player's pull opens on them;
 *   3. the first of the roster, because a report about nobody is not a report.
 *
 * Extracted from `ReportFlow` to be testable, and because the reason it is a *chain* is easy to lose:
 * the fight picker used to clear the reader's choice on every change, which made a stale name
 * impossible — and also made "remember who I was reading" impossible. Falling through is what lets
 * the choice survive a pull that person was not in, without surviving into a pull where it is wrong.
 */
export function resolvePlayerName(
	roster: readonly FightPlayer[],
	chosen: string | null,
	linkedSourceID: number | null,
): string | null {
	return (
		roster.find((player) => player.name === chosen)?.name ??
		roster.find((player) => player.id === linkedSourceID)?.name ??
		roster[0]?.name ??
		null
	);
}
