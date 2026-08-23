import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { i18n } from '~/lib/i18n';

import {
	SessionContext,
	beginAuthorize,
	cleanToken,
	clear,
	completeSignIn,
	forgetClientID as dropClientID,
	hasCallbackParams,
	readClientID,
	rememberClientID,
	rememberToken,
	type Session,
	type SessionStatus,
	type StoredToken,
	type TokenSource,
} from '~/lib/auth';
// Straight from the modules rather than through the barrel, exactly as `lib/wcl/client.ts` already
// imports `lib/auth/token`. This is the expiry path, and it is new.
import { restoreSession } from '~/lib/auth/restore';
import { clearSilentRetry, forgetToken, markSilentRetry, silentRetryUsed } from '~/lib/auth/storage';

/**
 * A thrown cause as something to show, falling back on the copy when it is not an `Error`.
 *
 * **The instance rather than `useTranslation`, in this one file.** Every string here is read from
 * inside an effect or a promise handler and written into state, never during a render — and a `t`
 * from the hook is a value the mount effect would have to declare as a dependency, which is the one
 * effect in this tree that must never run twice: it consumes the `?code=` in the address bar. So the
 * copy is fetched the same way `lib/wcl/fetchFight.ts` fetches its progress messages.
 *
 * The two expiry messages it sits beside — `auth.failure.expired` and `auth.failure.expiredManual` —
 * are two because there are two fixes. A sign-in is renewed by signing in, and that message is only
 * ever seen when the silent re-authorize was unavailable or could not leave; when it works, the
 * reader gets a signed-in page and no message at all, which is the whole point of it. A pasted token
 * is never renewed automatically, so its message is the only thing that ever says so, and pointing
 * that reader at the sign-in button would be pointing them away from the credential they chose.
 */
function readMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : i18n.t('auth.failure.signIn', { ns: 'ui' });
}

/**
 * Owns the signed-in state for the whole island.
 *
 * Three things can be true on mount and they are deliberately ordered. A token already in
 * `sessionStorage` means this is an ordinary reload of a signed-in tab — `sessionStorage` survives a
 * reload, so that is the common case and not a special one. A `?code=` in the address bar means this
 * is the landing back from WarcraftLogs and there is an exchange to finish — which is checked
 * synchronously, so the first paint says "signing in" rather than "signed out" and then flickering.
 *
 * The third is a stored token that has *expired*, and it is the reason `restoreSession` exists rather
 * than a bare `readToken`. Storage keeps whatever it was given and has no idea a token has a clock on
 * it, so a tab reloaded past its token's `exp` used to come back saying "Signed in" and then fail its
 * first query with a 401 telling the reader to sign in again. Now it is caught on the way in: the dead
 * token is dropped, and the tab spends one automatic re-authorize trying to renew it without asking
 * for anything. `lib/auth/restore.ts` argues why `exp` may be trusted to refuse but never to permit.
 *
 * None of it can run during Astro's prerender: `sessionStorage` and `window.location` do not exist
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
	const [errorIsExpiry, setErrorIsExpiry] = useState(false);
	const [clientID, setClientID] = useState<string | null>(null);

	useEffect(() => {
		const id = readClientID();
		setClientID(id);
		const restored = restoreSession();
		const held = restored.session;
		const settle = (next: StoredToken | null) => {
			setToken(next?.token ?? null);
			setSource(next?.source ?? null);
			setStatus(next !== null ? 'signed-in' : 'signed-out');
		};

		if (!hasCallbackParams()) {
			if (restored.reason !== 'expired') {
				settle(held);
				return;
			}

			// The token is past its own `exp`. Drop it first, whatever happens next: a corpse left in
			// storage is what made the *previous* reload claim a session, and if the re-authorize below
			// fails there must be nothing here for the reload after this one to fall for either.
			forgetToken();
			const expiredMessage =
				restored.expiredSource === 'manual'
					? i18n.t('auth.failure.expiredManual', { ns: 'ui' })
					: i18n.t('auth.failure.expired', { ns: 'ui' });

			// WarcraftLogs issues no refresh token, so this is the closest honest thing: send the tab
			// back through the authorize screen. Against a live WarcraftLogs session and a client the
			// reader has already granted, it returns here with a new code and no interaction — a
			// renewal that costs a flicker instead of a click. It needs a client id to go at all, and
			// one attempt per tab so a refusal cannot become a redirect loop.
			if (restored.expiredSource === 'oauth' && id !== null && !silentRetryUsed()) {
				markSilentRetry();
				setStatus('signing-in');
				beginAuthorize().catch(() => {
					// Could not even leave. Say what happened rather than sitting on "Signing in…".
					setErrorIsExpiry(true);
					setError(expiredMessage);
					settle(null);
				});
				return;
			}

			setErrorIsExpiry(true);
			setError(expiredMessage);
			settle(null);
			return;
		}

		setStatus('signing-in');
		let live = true;
		completeSignIn()
			.then((fresh) => {
				if (!live) return;
				setError(null);
				setErrorIsExpiry(false);
				// A sign-in that landed earns the tab its silent-renewal fuse back, so that this token
				// ageing out later in the same tab is renewed as quietly as this one was.
				if (fresh !== null) clearSilentRetry();
				settle(fresh !== null ? { token: fresh, source: 'oauth' } : held);
			})
			.catch((cause: unknown) => {
				if (!live) return;
				// The pending verifier and state are already gone — `completeSignIn` consumes them
				// before it does anything else, precisely so a stale one cannot be replayed against.
				//
				// So there is nothing left to clear, and `clear()` used to be called here anyway: it
				// took the *token* with it. A callback that fails says nothing about a session this tab
				// already holds, and wiping it turned "that sign-in did not finish" into "you are also
				// signed out now" — a good token destroyed by an unrelated failure. What is held is
				// kept; only the failure is reported.
				setErrorIsExpiry(false);
				setError(readMessage(cause));
				settle(held);
			});
		return () => {
			live = false;
		};
		// Still `[]`, and `t` is deliberately not added to it. This is the one-shot mount read described
		// above; re-running it would replay a sign-in exchange, and `t` is stable for the life of the
		// instance because the app initialises one locale and never switches.
	}, []);

	const signIn = useCallback(() => {
		setError(null);
		setErrorIsExpiry(false);
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
		setErrorIsExpiry(false);
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
		setErrorIsExpiry(false);
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
		setErrorIsExpiry(false);
	}, []);

	const session = useMemo<Session>(
		() => ({
			token,
			source,
			status,
			error,
			errorIsExpiry,
			clientID,
			saveClientID,
			forgetClientID,
			signIn,
			signInWithToken,
			signOut,
		}),
		[
			token,
			source,
			status,
			error,
			errorIsExpiry,
			clientID,
			saveClientID,
			forgetClientID,
			signIn,
			signInWithToken,
			signOut,
		],
	);

	return <SessionContext value={session}>{children}</SessionContext>;
}
