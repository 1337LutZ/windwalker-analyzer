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

import { URL_RESTORED_EVENT } from '~/lib/auth';

/**
 * One pull's address: which report, which pull in it, whose.
 *
 * Named as a shape rather than spelled out twice, because the compare page carries two of them and
 * the second must be parsed and written by the same three rules as the first. A `player` that survives
 * percent-encoding, a `fightID` that must be digits, an empty string that is not a value.
 */
export interface UrlPull {
	code: string | null;
	fightID: number | null;
	player: string | null;
}

export interface UrlSelection extends UrlPull {
	/**
	 * The second pull, for the compare page. Null on every address that names one.
	 *
	 * Null rather than a triple of nulls, so that "this link is a comparison" is a question with an
	 * answer instead of three questions that have to agree. A compare link naming only its first pull
	 * is still a compare link, and it seeds one slot and leaves the other empty.
	 */
	second: UrlPull | null;
	/**
	 * The registry's own key, from the query — what `getSpec` reads.
	 *
	 * **Read-only now, and only for the links that predate the routes.** The path names the spec today
	 * (`/monk/windwalker`), so nothing writes this key any more and the report page does not consult it
	 * either. It is still parsed because `/?report=…&spec=elemental` is the address bar this app had
	 * for its whole life so far, and those links are in other people's histories: `SpecPicker` reads it
	 * and forwards such a link to the route it names.
	 */
	spec: string | null;
}

/**
 * The part of the selection this app writes back.
 *
 * The spec is not in it, and it is `Omit`ted rather than left optional so that a caller passing one is
 * a compile error rather than a value silently dropped — which is the shape the bug would take if the
 * path and the query ever disagreed about which spec a report belongs to.
 */
export type WrittenSelection = Omit<UrlSelection, 'spec' | 'second'> & { second?: UrlPull | null };

const EMPTY: UrlSelection = { code: null, fightID: null, player: null, spec: null, second: null };

/**
 * The query keys, first pull and second.
 *
 * The second pull's keys are the first's with a `2` on them, and they are **additive**: every link
 * ever shared names the first pull under the keys it always used, so a report link opened today is
 * read exactly as it was before the compare page existed. A scheme that packed both pulls into one
 * key would have been shorter and would have broken all of them.
 */
const PARAM = { code: 'report', fight: 'fight', player: 'player', spec: 'spec' } as const;
const PARAM2 = { code: 'report2', fight: 'fight2', player: 'player2' } as const;

function pullFrom(params: URLSearchParams, keys: { code: string; fight: string; player: string }): UrlPull {
	const code = params.get(keys.code);
	const fight = params.get(keys.fight);
	const player = params.get(keys.player);
	return {
		code: code !== null && code !== '' ? code : null,
		fightID: fight !== null && /^\d+$/.test(fight) ? Number(fight) : null,
		player: player !== null && player !== '' ? player : null,
	};
}

function parse(search: string): UrlSelection {
	const params = new URLSearchParams(search);
	const spec = params.get(PARAM.spec);
	const second = pullFrom(params, PARAM2);
	return {
		...pullFrom(params, PARAM),
		spec: spec !== null && spec !== '' ? spec : null,
		// A second pull exists when the address says anything at all about one. Any one of the three
		// keys is enough: a compare link whose second slot was never filled in still opens the compare
		// page with the first slot seeded, which is what half a comparison looks like.
		second: second.code !== null || second.fightID !== null || second.player !== null ? second : null,
	};
}

/**
 * Reads the selection out of the address bar once, on mount — and once more if a sign-in puts one
 * there.
 *
 * Once, deliberately: after the first render the app's own state is the truth and the URL is a
 * mirror of it. Watching the URL as well would let a write race the read and fight the user's next
 * click.
 *
 * The sign-in is the one exception, and it is not watching — it is a single announcement from
 * `stripCallbackParams`, made only when there was something to put back. It exists because the
 * ordering is fixed and unhelpful: effects run child-first, so this read happens *before* the
 * provider above it restores the query, and what it sees on a callback is the bare `?code=` URL.
 * Someone who followed a shared link and signed in got their report code, fight and player back in
 * the address bar and an empty form under it.
 *
 * Neither order can miss it. Restore first and the mount read already sees the finished URL; mount
 * first and the announcement brings the second read. Both land before the token does, so the form
 * below — which only renders once signed in — is built from the right value rather than corrected
 * into it.
 */
export function useInitialUrlSelection(): UrlSelection {
	// `window` does not exist during Astro's prerender, so this cannot be a lazy initialiser.
	const [initial, setInitial] = useState<UrlSelection>(EMPTY);
	useEffect(() => {
		const read = () => setInitial(parse(window.location.search));
		read();
		window.addEventListener(URL_RESTORED_EVENT, read);
		return () => window.removeEventListener(URL_RESTORED_EVENT, read);
	}, []);
	return initial;
}

/**
 * The address bar this selection asks for: the keys that are set written, the keys that are not
 * dropped rather than written empty.
 *
 * **`url.hash` is carried through, and that is load-bearing.** The fragment is a different owner's
 * property — `useSectionAnchor` writes which section the reader is at — and this writer fires
 * whenever the pickers resolve, which on a shared link is *after* that fragment was already there.
 * Reassembling without it would silently drop the section from every link that also named a player.
 *
 * Pulled out of the hook so that survival is a testable claim rather than a line to be read
 * carefully.
 */
function nextHref(href: string, selection: WrittenSelection): string {
	const url = new URL(href);
	const set = (key: string, value: string | null) => {
		if (value === null || value === '') url.searchParams.delete(key);
		else url.searchParams.set(key, value);
	};
	set(PARAM.code, selection.code);
	set(PARAM.fight, selection.fightID === null ? null : String(selection.fightID));
	set(PARAM.player, selection.player);
	// **Written on every call, including as absences.** A caller that names no second pull is a page
	// about one pull, and leaving a stale `report2` in the address would make its link open a
	// comparison the reader is not looking at.
	const second = selection.second ?? null;
	set(PARAM2.code, second?.code ?? null);
	set(PARAM2.fight, second?.fightID === undefined || second.fightID === null ? null : String(second.fightID));
	set(PARAM2.player, second?.player ?? null);
	// **Dropped, not written.** The path names the spec now, so writing it here would put it in the
	// address twice — and two spellings of one fact can disagree, whether by a hand-edited link or by
	// an old `?spec=` outliving the route it was migrated to. Only one of the two chose the page, so
	// the other one goes.
	set(PARAM.spec, null);
	// `URL` percent-encodes for us, which matters: anonymous reports name players `Player (17)`,
	// and the parentheses and space have to survive the round trip.
	return `${url.pathname}${url.search}${url.hash}`;
}

/** Writes the selection back, dropping the keys that are not set rather than writing empty ones. */
export function useUrlSelectionWriter(): (selection: WrittenSelection) => void {
	return useCallback((selection: WrittenSelection) => {
		window.history.replaceState(null, '', nextHref(window.location.href, selection));
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

export const __test = { parse, nextHref };
