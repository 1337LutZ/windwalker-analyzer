// Step 2 of the flow: the landing back from WarcraftLogs.

import { exchangeCode } from './exchange';
import { rememberToken, takeAuthorization } from './storage';

/** Everything WarcraftLogs may add to the redirect URI, and everything that must not stay in it. */
const CALLBACK_PARAMS = ['code', 'state', 'error', 'error_description', 'error_uri'] as const;

/**
 * Fired once, on `window`, when a sign-in has put the visitor's original query back in the address
 * bar.
 *
 * The selection in the URL is read on mount and then never again — `useInitialUrlSelection` explains
 * why, and that rule is right for every other page load. A callback is the one load where the query
 * arrives *after* the read: effects run child-first, so the flow below the provider has already
 * looked at the address bar by the time the provider gets to restore it, and what it saw was the
 * bare callback URL. So the restore says so rather than leaving anyone to poll for it.
 *
 * Listening is optional in both directions — a listener that registered too late has nothing to miss,
 * because `replaceState` has already happened and a fresh read of the address bar answers the same
 * question. That is what makes this safe regardless of which effect runs first.
 */
export const URL_RESTORED_EVENT = 'wcl:url-restored';

/**
 * True when this page load is a return from the authorize screen.
 *
 * Separate from `completeSignIn` because the answer is needed synchronously: the UI has to show
 * "signing in" on the first paint, not after a promise settles.
 */
export function hasCallbackParams(): boolean {
	const params = new URLSearchParams(window.location.search);
	return params.has('code') || params.has('error');
}

/**
 * Rewrites the address bar to the same page without the callback parameters.
 *
 * An authorization code is single-use and short-lived, but it is still a credential, and one sitting
 * in the address bar is one that gets copied into a bug report or a chat message along with the URL.
 * `replaceState` rather than `pushState` so the back button does not walk into a spent code either.
 */
function stripCallbackParams(restore?: string): void {
	const url = new URL(window.location.href);
	for (const key of CALLBACK_PARAMS) url.searchParams.delete(key);
	// Whatever the visitor arrived with, put back. A shared link carries the report, the fight and
	// the player, and none of it can travel through `redirect_uri` because WarcraftLogs matches that
	// byte for byte — so it was stashed before the tab navigated away and is restored here.
	//
	// The remembered query is applied first and the surviving ones written over it, so a parameter
	// that is somehow in both takes the value this page load actually has. Callback keys are stripped
	// from the remembered copy too: a visitor who hits sign-in while still on a callback URL must not
	// have a spent code handed back to them.
	if (restore !== undefined && restore !== '') {
		const merged = new URLSearchParams(restore);
		for (const key of CALLBACK_PARAMS) merged.delete(key);
		for (const [key, value] of url.searchParams) merged.set(key, value);
		url.search = merged.toString();
	}
	const query = url.searchParams.toString();
	window.history.replaceState(window.history.state, '', `${url.pathname}${query ? `?${query}` : ''}${url.hash}`);
	// Only when something was actually put back. A sign-in started from a bare page changes nothing
	// anyone needs to re-read, and announcing it would ask the flow to re-parse a URL it already has.
	if (restore !== undefined && restore !== '') window.dispatchEvent(new Event(URL_RESTORED_EVENT));
}

/**
 * Finishes a sign-in, and returns the access token.
 *
 * Returns `null` when this page load is not a callback at all, so the caller can treat "nothing to
 * do" as a normal outcome rather than an error.
 */
export async function completeSignIn(): Promise<string | null> {
	const params = new URLSearchParams(window.location.search);
	const code = params.get('code');
	const returnedState = params.get('state');
	const refusal = params.get('error');
	const refusalDetail = params.get('error_description');
	if (code === null && refusal === null) return null;

	// Consumed whatever happens next: single-use, and a stale one is a replay target.
	const pending = takeAuthorization();

	// Before the code is spent and before anything else is read: the state is the only thing standing
	// between this and a callback URL someone else constructed and got clicked.
	if (pending === null || returnedState === null || returnedState !== pending.state) {
		stripCallbackParams(pending?.search);
		throw new Error('That sign-in did not start in this tab, so it was refused. Start it again from this page.');
	}

	if (refusal !== null) {
		stripCallbackParams(pending?.search);
		throw new Error(
			refusal === 'access_denied'
				? 'You cancelled the sign-in at WarcraftLogs. Nothing was shared.'
				: (refusalDetail ?? `WarcraftLogs would not authorize this app (${refusal}).`),
		);
	}
	if (code === null) {
		stripCallbackParams(pending?.search);
		throw new Error('WarcraftLogs sent this page back without an authorization code, so there is nothing to exchange.');
	}

	// Stripped before the exchange, not after: the exchange is a network round trip, and for its whole
	// length the code would otherwise be sitting in the address bar of a page the visitor can see,
	// copy and share.
	stripCallbackParams(pending?.search);

	const token = await exchangeCode({ code, verifier: pending.verifier });
	rememberToken({ token, source: 'oauth' });
	return token;
}

export const __test = { stripCallbackParams };
