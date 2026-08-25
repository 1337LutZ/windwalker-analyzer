import type { AnalysisRequest } from '~/hooks/useFightAnalysis';

/** What the pickers currently say, with a null for every part that has not resolved yet. */
export interface Selection {
	code: string | null;
	fightID: number | null;
	playerName: string | null;
}

/**
 * Whether the report on screen is about a selection nobody is looking at any more.
 *
 * `ReportInput` already answers this for the code half: it keeps the code the results below belong
 * to and fires `onDiverge` the moment the field stops matching. The fight and the player had no such
 * answer, and the analysis is keyed by all three — so picking a different pull left the previous
 * fight's report standing under the new fight's name, which is exactly the reading that gets one
 * boss's numbers taken for another's.
 *
 * A null request is nothing on screen, so there is nothing to have diverged from. A null *part* of
 * the selection is a picker that has not resolved yet, and with a request already standing that is
 * still not a selection the report can be about: the roster of a freshly chosen pull arrives a round
 * trip after the pull does, and a report left up across that gap is a report under the wrong fight.
 *
 * Pulled out of `ReportFlow` for the same reason `shouldAutoRun` and `resolvePlayerName` were: the
 * decision is one line of comparisons and several paragraphs of consequence, and it should be
 * assertable without a browser.
 */
export function selectionDiverged(request: AnalysisRequest | null, selection: Selection): boolean {
	if (request === null) return false;
	return (
		request.code !== selection.code ||
		request.fightID !== selection.fightID ||
		request.playerName !== selection.playerName
	);
}
