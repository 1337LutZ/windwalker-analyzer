// The report selection, mirrored into this app's own URL.
//
// So a refresh, a bookmark or a pasted link comes back to the same pull instead of an empty form.
// Only the selection goes in — report code, fight and player. **Never the token.** A URL is the most
// leaked string in a browser: it lands in history, in bookmarks, in a screenshot of the address bar,
// and in the `Referer` header of the next request. The token lives in `sessionStorage` and stays
// there.
//
// `replaceState`, not `pushState`: picking a fight is not navigation, and pushing would bury the
// page the reader arrived from under a stack of near-identical entries that the back button then has
// to be pressed through.

import { useCallback, useEffect, useState } from 'react';

export interface UrlSelection {
	code: string | null;
	fightID: number | null;
	player: string | null;
}

const EMPTY: UrlSelection = { code: null, fightID: null, player: null };

const PARAM = { code: 'report', fight: 'fight', player: 'player' } as const;

function parse(search: string): UrlSelection {
	const params = new URLSearchParams(search);
	const code = params.get(PARAM.code);
	const fight = params.get(PARAM.fight);
	const player = params.get(PARAM.player);
	return {
		code: code !== null && code !== '' ? code : null,
		fightID: fight !== null && /^\d+$/.test(fight) ? Number(fight) : null,
		player: player !== null && player !== '' ? player : null,
	};
}

/**
 * Reads the selection out of the address bar once, on mount.
 *
 * Once, deliberately: after the first render the app's own state is the truth and the URL is a
 * mirror of it. Watching the URL as well would let a write race the read and fight the user's next
 * click.
 */
export function useInitialUrlSelection(): UrlSelection {
	// `window` does not exist during Astro's prerender, so this cannot be a lazy initialiser.
	const [initial, setInitial] = useState<UrlSelection>(EMPTY);
	useEffect(() => setInitial(parse(window.location.search)), []);
	return initial;
}

/** Writes the selection back, dropping the keys that are not set rather than writing empty ones. */
export function useUrlSelectionWriter(): (selection: UrlSelection) => void {
	return useCallback((selection: UrlSelection) => {
		const url = new URL(window.location.href);
		const set = (key: string, value: string | null) => {
			if (value === null || value === '') url.searchParams.delete(key);
			else url.searchParams.set(key, value);
		};
		set(PARAM.code, selection.code);
		set(PARAM.fight, selection.fightID === null ? null : String(selection.fightID));
		set(PARAM.player, selection.player);
		// `URL` percent-encodes for us, which matters: anonymous reports name players `Player (17)`,
		// and the parentheses and space have to survive the round trip.
		window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
	}, []);
}

/**
 * Whether a URL-supplied selection should be analysed without the reader pressing anything.
 *
 * Pulled out of the component so the decision is testable on its own: it is the difference between a
 * shared link restoring a *form* and restoring a *report*, and every guard in it exists to stop a
 * different wrong behaviour.
 */
export function shouldAutoRun(state: {
	/** Whether a report came from the URL at all. Nothing auto-runs from ordinary use. */
	fromUrl: boolean;
	/** Already run once — this must never fire twice for one link. */
	alreadyRan: boolean;
	signedIn: boolean;
	code: string | null;
	fightID: number | null;
	playerName: string | null;
	/** The Windwalkers this fight actually has, once they are known. */
	roster: readonly string[];
}): boolean {
	if (!state.fromUrl || state.alreadyRan || !state.signedIn) return false;
	if (state.code === null || state.fightID === null || state.playerName === null) return false;
	// The roster has to have loaded and to contain the name. A stale link naming someone who was not
	// in this pull would otherwise request a player the report cannot produce, and the failure would
	// arrive as an error about something the reader never chose.
	return state.roster.includes(state.playerName);
}

export const __test = { parse };
