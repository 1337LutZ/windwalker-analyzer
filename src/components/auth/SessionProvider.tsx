import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
	SessionContext,
	beginAuthorize,
	cleanToken,
	clear,
	completeSignIn,
	forgetClientID as dropClientID,
	hasCallbackParams,
	readClientID,
	readToken,
	rememberClientID,
	rememberToken,
	type Session,
	type SessionStatus,
	type StoredToken,
	type TokenSource,
} from '~/lib/auth';

function readMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : 'Signing in to WarcraftLogs failed.';
}

/**
 * Owns the signed-in state for the whole island.
 *
 * Two things happen on mount and they are deliberately ordered. A token already in `sessionStorage`
 * means this is an ordinary reload of a signed-in tab. A `?code=` in the address bar means this is
 * the landing back from WarcraftLogs and there is an exchange to finish — which is checked
 * synchronously, so the first paint says "signing in" rather than "signed out" and then flickering.
 *
 * Neither can run during Astro's prerender: `sessionStorage` and `window.location` do not exist
 * there, which is why nothing is read in a lazy state initialiser.
 *
 * A pasted token is the third way this state gets filled, and the only synchronous one: there is
 * nothing to exchange and nobody to ask, so it goes straight to signed-in. What it produces is the
 * same session as the sign-in button's, marked with where it came from.
 *
 * The client id rides along here because it gates the sign-in button and has to be reactive: setting
 * it must light that button up without a reload. It is read on mount for the same reason the token
 * is — `localStorage` does not exist during Astro's prerender either.
 */
export default function SessionProvider({ children }: { children: ReactNode }) {
	const [token, setToken] = useState<string | null>(null);
	const [source, setSource] = useState<TokenSource | null>(null);
	const [status, setStatus] = useState<SessionStatus>('unknown');
	const [error, setError] = useState<string | null>(null);
	const [clientID, setClientID] = useState<string | null>(null);

	useEffect(() => {
		setClientID(readClientID());
		const held = readToken();
		const settle = (next: StoredToken | null) => {
			setToken(next?.token ?? null);
			setSource(next?.source ?? null);
			setStatus(next !== null ? 'signed-in' : 'signed-out');
		};

		if (!hasCallbackParams()) {
			settle(held);
			return;
		}

		setStatus('signing-in');
		let live = true;
		completeSignIn()
			.then((fresh) => {
				if (!live) return;
				setError(null);
				settle(fresh !== null ? { token: fresh, source: 'oauth' } : held);
			})
			.catch((cause: unknown) => {
				if (!live) return;
				// A failed exchange leaves a half-finished sign-in in storage; nothing here is worth
				// keeping, and a stale verifier is a thing to be replayed against.
				clear();
				setError(readMessage(cause));
				settle(null);
			});
		return () => {
			live = false;
		};
	}, []);

	const signIn = useCallback(() => {
		setError(null);
		setStatus('signing-in');
		// The success path never resolves — the tab navigates to WarcraftLogs and this code is gone.
		// Only the failure path (an unregistered client, or no crypto) comes back here.
		beginAuthorize().catch((cause: unknown) => {
			setError(readMessage(cause));
			setStatus(token !== null ? 'signed-in' : 'signed-out');
		});
	}, [token]);

	/**
	 * The pasted-token path. Whether the token is any good is WarcraftLogs' call, not ours — the form
	 * above refuses only what it can prove is wrong (nothing pasted, or an `exp` already past), and
	 * anything else is stored and allowed to fail against the real API with a real message.
	 */
	const signInWithToken = useCallback((raw: string) => {
		const cleaned = cleanToken(raw);
		if (cleaned === '') return;
		rememberToken({ token: cleaned, source: 'manual' });
		setError(null);
		setToken(cleaned);
		setSource('manual');
		setStatus('signed-in');
	}, []);

	const saveClientID = useCallback((id: string) => {
		const trimmed = id.trim();
		if (trimmed === '') return;
		rememberClientID(trimmed);
		setClientID(trimmed);
		setError(null);
	}, []);

	const forgetClientID = useCallback(() => {
		dropClientID();
		setClientID(null);
	}, []);

	/** Signing out drops the token and keeps the client id: the id is setup, not the session. */
	const signOut = useCallback(() => {
		clear();
		setToken(null);
		setSource(null);
		setStatus('signed-out');
		setError(null);
	}, []);

	const session = useMemo<Session>(
		() => ({
			token,
			source,
			status,
			error,
			clientID,
			saveClientID,
			forgetClientID,
			signIn,
			signInWithToken,
			signOut,
		}),
		[token, source, status, error, clientID, saveClientID, forgetClientID, signIn, signInWithToken, signOut],
	);

	return <SessionContext value={session}>{children}</SessionContext>;
}
