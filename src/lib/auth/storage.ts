// Everything the sign-in flow has to remember, and the only place it is written down.
//
// `sessionStorage`, never `localStorage`, never a cookie: it is scoped to this tab and dies with it,
// so a shared or public machine forgets the token without the visitor having to remember to. The
// verifier and state have to survive a full page navigation to WarcraftLogs and back, which rules
// out React state and a module variable — storage is what a redirect leaves standing.
//
// The client id is the one exception, and it is `localStorage` on purpose. It is not a credential —
// PKCE publishes it, which is the whole point of the flow — so nothing leaks by keeping it, while
// making someone re-register or re-paste an id every tab would be hostile for no security gain. The
// token is the secret; the id is configuration. They are stored differently because they *are*
// different, and `clear()` below reflects that: signing out forgets the secret, not the setup.
//
// **"I have to sign in again on every refresh" is not an argument for `localStorage`, and it was
// measured rather than argued.** `sessionStorage` survives a reload — it is cleared when the tab
// closes, not when the page navigates — so a token written here is still here after F5, and
// `restoreSession` picks it back up. Reloading a signed-in tab was checked against the running app
// and comes back signed in. What the complaint actually was: an *expired* token was being restored
// and announced as a live session, and a failed callback was wiping a good one. Both are fixed where
// they were broken, and neither is a storage problem.
//
// So the trade `localStorage` would buy is still refused, and now for a stated price: it would turn
// the blast radius of any XSS on this page from "the attacker can use the session while the page is
// open" into "the attacker keeps a working credential for as long as it lives", and it would leave a
// WarcraftLogs token on a shared machine for the next person. What it would buy is a session that
// survives a new tab and a browser restart. That is a real convenience and it is deliberately not
// taken: there is no refresh token to rotate away from a thief (see `exchange.ts`), so a leaked token
// is good until it expires on WarcraftLogs' clock, and nothing in this app can revoke it. A tab-lived
// secret is the mitigation. Signing in again in a new tab is the cost, and it is a click.

import type { TokenSource } from './sessionContext';

// Storage is not guaranteed to exist. `localStorage`/`sessionStorage` throw outright — not return
// null — when site data is blocked, when the page is in a sandboxed iframe, and when a quota is
// full. Two of the reads below run inside `SessionProvider`'s mount effect and the writes run inside
// click handlers, and there is no error boundary in this app: an unguarded throw from either takes
// the whole island down and leaves a blank page. A browser that will not remember a sign-in should
// cost the *remembering*, not the app, so every access goes through these two.
//
// `lib/settings/storage.ts` guards the same API for the same reason.
function read(store: () => Storage, key: string): string | null {
	try {
		return store().getItem(key);
	} catch {
		return null;
	}
}

function write(store: () => Storage, key: string, value: string | null): void {
	try {
		if (value === null) store().removeItem(key);
		else store().setItem(key, value);
	} catch {
		// Not remembered past this page. Whatever was just decided still holds for this render.
	}
}

const session = (): Storage => sessionStorage;
const local = (): Storage => localStorage;

const VERIFIER_KEY = 'wcl.pkce.verifier';
const STATE_KEY = 'wcl.pkce.state';
/**
 * The selection the visitor arrived with, carried across the sign-in.
 *
 * WarcraftLogs matches `redirect_uri` byte for byte, so the report and fight cannot ride back in
 * the URL — see the note in `config.redirectUri`. They are stashed here instead, for the same
 * reason the verifier is: once the tab navigates to the consent screen there is no JavaScript
 * left alive to remember anything.
 */
const RETURN_KEY = 'wcl.pkce.return';
const TOKEN_KEY = 'wcl.token';
const SOURCE_KEY = 'wcl.token.source';
const CLIENT_ID_KEY = 'wcl.clientId';
/**
 * That this tab has already spent its one automatic re-authorize.
 *
 * WarcraftLogs issues no refresh token, so the only way to renew an expired session without asking
 * the visitor to retype anything is to send them back through the authorize screen — which, against a
 * live WarcraftLogs session and a client they have already granted, returns them here with a new code
 * and no interaction. That is a *navigation*, and a navigation that can fail is a navigation that can
 * loop: land, find the token expired, leave, come back no better off, leave again.
 *
 * This is the fuse. One attempt per tab, spent before the tab navigates away — so the failure case
 * costs one wasted round trip and then shows the sign-in button, rather than trapping the page in a
 * redirect it cannot escape. A sign-in that works clears it, so a session that ages out later in the
 * same tab is still allowed its own silent renewal.
 */
const SILENT_KEY = 'wcl.silentRetry';

export interface PendingAuthorization {
	verifier: string;
	state: string;
	/** The query the visitor arrived with, so a shared report link survives the round trip. */
	search?: string;
}

/** A token and where it came from, which is what a reload has to restore to describe itself right. */
export interface StoredToken {
	token: string;
	source: TokenSource;
}

export function rememberAuthorization({ verifier, state, search }: PendingAuthorization): void {
	write(session, VERIFIER_KEY, verifier);
	write(session, STATE_KEY, state);
	// Only when there is something to carry, so a plain sign-in leaves no key behind.
	if (search !== undefined && search !== '') write(session, RETURN_KEY, search);
}

/**
 * Reads the pending sign-in and removes it in the same breath. A verifier is single-use, and one
 * left behind is one a second callback could be replayed against.
 */
export function takeAuthorization(): PendingAuthorization | null {
	const verifier = read(session, VERIFIER_KEY);
	const state = read(session, STATE_KEY);
	const search = read(session, RETURN_KEY);
	write(session, VERIFIER_KEY, null);
	write(session, STATE_KEY, null);
	write(session, RETURN_KEY, null);
	if (verifier === null || state === null) return null;
	return search === null ? { verifier, state } : { verifier, state, search };
}

export function readToken(): StoredToken | null {
	const token = read(session, TOKEN_KEY);
	if (token === null) return null;
	// Anything that is not the pasted-token marker is a sign-in: the source is a label, and guessing
	// it wrong must never be the reason a perfectly good token is thrown away on reload.
	return {
		token,
		source: read(session, SOURCE_KEY) === 'manual' ? 'manual' : 'oauth',
	};
}

export function rememberToken({ token, source }: StoredToken): void {
	write(session, TOKEN_KEY, token);
	write(session, SOURCE_KEY, source);
}

/**
 * Drops the token and nothing else.
 *
 * Narrower than `clear()` on purpose, and the difference is the whole point of having both. `clear()`
 * is a sign-out: it also takes the pending verifier and state, because a sign-out ends any sign-in in
 * flight. This one is for a token that has been *found dead* — expired on its own `exp`, or refused as
 * a 401 — where a sign-in may well be the very next thing to happen and its verifier must survive.
 *
 * A dead token is worth removing rather than leaving to be restored on the next load: a stored corpse
 * is what made a reload announce a session that could not spend a single request.
 */
export function forgetToken(): void {
	write(session, TOKEN_KEY, null);
	write(session, SOURCE_KEY, null);
}

/** True once this tab has spent its one automatic re-authorize. See `SILENT_KEY`. */
export function silentRetryUsed(): boolean {
	return read(session, SILENT_KEY) !== null;
}

/** Spent *before* the tab navigates away, because after it there is nothing left to record it. */
export function markSilentRetry(): void {
	write(session, SILENT_KEY, '1');
}

/** A sign-in that worked earns the tab its fuse back, for whenever this token ages out in turn. */
export function clearSilentRetry(): void {
	write(session, SILENT_KEY, null);
}

/**
 * The OAuth client this browser signs in with, or null when nobody has registered one yet.
 *
 * Every visitor registers their own: WarcraftLogs rate-limits per client, so one shared id would
 * pool every visitor's request budget into a single quota.
 */
export function readClientID(): string | null {
	const id = read(local, CLIENT_ID_KEY);
	return id !== null && id.trim() !== '' ? id.trim() : null;
}

export function rememberClientID(id: string): void {
	write(local, CLIENT_ID_KEY, id.trim());
}

export function forgetClientID(): void {
	write(local, CLIENT_ID_KEY, null);
}

/** Signing out, and every failure path. One call has to leave nothing behind, or it is not a sign-out. */
export function clear(): void {
	write(session, VERIFIER_KEY, null);
	write(session, STATE_KEY, null);
	write(session, TOKEN_KEY, null);
	write(session, SOURCE_KEY, null);
	write(session, SILENT_KEY, null);
}
