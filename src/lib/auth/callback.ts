// Step 2 of the flow: the landing back from WarcraftLogs.

import { exchangeCode } from './exchange';
import { rememberToken, takeAuthorization } from './storage';

/** Everything WarcraftLogs may add to the redirect URI, and everything that must not stay in it. */
const CALLBACK_PARAMS = ['code', 'state', 'error', 'error_description', 'error_uri'] as const;

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
function stripCallbackParams(): void {
	const url = new URL(window.location.href);
	for (const key of CALLBACK_PARAMS) url.searchParams.delete(key);
	const query = url.searchParams.toString();
	window.history.replaceState(window.history.state, '', `${url.pathname}${query ? `?${query}` : ''}${url.hash}`);
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
		stripCallbackParams();
		throw new Error('That sign-in did not start in this tab, so it was refused. Start it again from this page.');
	}

	if (refusal !== null) {
		stripCallbackParams();
		throw new Error(
			refusal === 'access_denied'
				? 'You cancelled the sign-in at WarcraftLogs. Nothing was shared.'
				: (refusalDetail ?? `WarcraftLogs would not authorize this app (${refusal}).`),
		);
	}
	if (code === null) {
		stripCallbackParams();
		throw new Error(
			'WarcraftLogs sent this page back without an authorization code, so there is nothing to exchange.',
		);
	}

	// Stripped before the exchange, not after: the exchange is a network round trip, and for its whole
	// length the code would otherwise be sitting in the address bar of a page the visitor can see,
	// copy and share.
	stripCallbackParams();

	const token = await exchangeCode({ code, verifier: pending.verifier });
	rememberToken({ token, source: 'oauth' });
	return token;
}
