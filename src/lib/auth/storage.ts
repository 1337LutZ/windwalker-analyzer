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

import type { TokenSource } from './sessionContext';

const VERIFIER_KEY = 'wcl.pkce.verifier';
const STATE_KEY = 'wcl.pkce.state';
const TOKEN_KEY = 'wcl.token';
const SOURCE_KEY = 'wcl.token.source';
const CLIENT_ID_KEY = 'wcl.clientId';

export interface PendingAuthorization {
	verifier: string;
	state: string;
}

/** A token and where it came from, which is what a reload has to restore to describe itself right. */
export interface StoredToken {
	token: string;
	source: TokenSource;
}

export function rememberAuthorization({ verifier, state }: PendingAuthorization): void {
	sessionStorage.setItem(VERIFIER_KEY, verifier);
	sessionStorage.setItem(STATE_KEY, state);
}

/**
 * Reads the pending sign-in and removes it in the same breath. A verifier is single-use, and one
 * left behind is one a second callback could be replayed against.
 */
export function takeAuthorization(): PendingAuthorization | null {
	const verifier = sessionStorage.getItem(VERIFIER_KEY);
	const state = sessionStorage.getItem(STATE_KEY);
	sessionStorage.removeItem(VERIFIER_KEY);
	sessionStorage.removeItem(STATE_KEY);
	return verifier !== null && state !== null ? { verifier, state } : null;
}

export function readToken(): StoredToken | null {
	const token = sessionStorage.getItem(TOKEN_KEY);
	if (token === null) return null;
	// Anything that is not the pasted-token marker is a sign-in: the source is a label, and guessing
	// it wrong must never be the reason a perfectly good token is thrown away on reload.
	return {
		token,
		source: sessionStorage.getItem(SOURCE_KEY) === 'manual' ? 'manual' : 'oauth',
	};
}

export function rememberToken({ token, source }: StoredToken): void {
	sessionStorage.setItem(TOKEN_KEY, token);
	sessionStorage.setItem(SOURCE_KEY, source);
}

/**
 * The OAuth client this browser signs in with, or null when nobody has registered one yet.
 *
 * Every visitor registers their own: WarcraftLogs rate-limits per client, so one shared id would
 * pool every visitor's request budget into a single quota.
 */
export function readClientID(): string | null {
	const id = localStorage.getItem(CLIENT_ID_KEY);
	return id !== null && id.trim() !== '' ? id.trim() : null;
}

export function rememberClientID(id: string): void {
	localStorage.setItem(CLIENT_ID_KEY, id.trim());
}

export function forgetClientID(): void {
	localStorage.removeItem(CLIENT_ID_KEY);
}

/** Signing out, and every failure path. One call has to leave nothing behind, or it is not a sign-out. */
export function clear(): void {
	sessionStorage.removeItem(VERIFIER_KEY);
	sessionStorage.removeItem(STATE_KEY);
	sessionStorage.removeItem(TOKEN_KEY);
	sessionStorage.removeItem(SOURCE_KEY);
}
