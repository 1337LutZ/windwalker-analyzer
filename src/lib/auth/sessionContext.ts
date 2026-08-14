// The shape of "who is signed in", shared by the provider that fills it and the hook that reads it.

import { createContext } from 'react';

export type SessionStatus =
	/**
	 * The first render only. `sessionStorage` does not exist while Astro prerenders this island, so a
	 * token can only be read after hydration, and a UI that assumed "signed out" before then would
	 * flash a sign-in prompt at someone who is already signed in.
	 */
	| 'unknown'
	/** Leaving for WarcraftLogs, or exchanging the code it sent back. */
	| 'signing-in'
	| 'signed-in'
	| 'signed-out';

/**
 * Which of the two ways in produced the token.
 *
 * They are the same session afterwards and everything downstream treats them identically. The origin
 * is kept because it is worth *saying*: one is an account that granted this app access, the other is
 * a credential the visitor made and pasted, and "sign out" means a different thing to each.
 */
export type TokenSource = 'oauth' | 'manual';

export interface Session {
	/** The access token, or null. Passed to the API client; never rendered. */
	token: string | null;
	/** Where the token came from. Null exactly when there is no token. */
	source: TokenSource | null;
	status: SessionStatus;
	/** Why the last attempt failed, written for the visitor. Null when nothing has gone wrong. */
	error: string | null;
	/**
	 * The OAuth client id this browser signs in with, or null until one is set.
	 *
	 * It sits on the session because it gates the sign-in button and outlives it: unlike the token,
	 * it survives signing out and closing the tab. Not a secret — PKCE publishes it — so unlike the
	 * token it is safe to render, and the setup form does render it back.
	 */
	clientID: string | null;
	saveClientID: (id: string) => void;
	forgetClientID: () => void;
	signIn: () => void;
	/** The other way in: a token the visitor generated themselves and pasted. */
	signInWithToken: (token: string) => void;
	signOut: () => void;
}

/** Null means "no provider above this", which `useSession` turns into a developer-facing throw. */
export const SessionContext = createContext<Session | null>(null);
