// Step 2 of the flow: the landing back from WarcraftLogs.

import { i18n } from '~/lib/i18n';

import { normalisePath } from './config';
import { exchangeCode } from './exchange';
import { rememberToken, takeAuthorization } from './storage';

/** The shell copy, off the instance: no component here either. See `wcl/client.ts` for the reasoning. */
const t = (key: string, values?: Record<string, unknown>): string => i18n.t(key, { ns: 'ui', ...values });

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
function stripCallbackParams(returnTo?: string): void {
	const url = new URL(window.location.href);
	for (const key of CALLBACK_PARAMS) url.searchParams.delete(key);
	// The query out of the return target, and only the query. The path is where the tab goes next
	// rather than something to write over this one (`resumeAfterSignIn`), and a fragment put back here
	// would name a section nothing reads: `useSectionAnchor` reads the fragment once, at mount, which
	// happened before this promise did. It travels home with the navigation instead, to a document
	// that reads it on the way in as it always does.
	const restore = returnTo === undefined || returnTo === '' ? '' : new URL(returnTo, url).search;
	// Whatever the visitor arrived with, put back. A shared link carries the report, the fight and
	// the player, and none of it can travel through `redirect_uri` because WarcraftLogs matches that
	// byte for byte — so it was stashed before the tab navigated away and is restored here.
	//
	// The remembered query is applied first and the surviving ones written over it, so a parameter
	// that is somehow in both takes the value this page load actually has. Callback keys are stripped
	// from the remembered copy too: a visitor who hits sign-in while still on a callback URL must not
	// have a spent code handed back to them.
	if (restore !== '') {
		const merged = new URLSearchParams(restore);
		for (const key of CALLBACK_PARAMS) merged.delete(key);
		for (const [key, value] of url.searchParams) merged.set(key, value);
		url.search = merged.toString();
	}
	const query = url.searchParams.toString();
	window.history.replaceState(window.history.state, '', `${url.pathname}${query ? `?${query}` : ''}${url.hash}`);
	// Only when something was actually put back. A sign-in started from a bare page changes nothing
	// anyone needs to re-read, and announcing it would ask the flow to re-parse a URL it already has.
	if (restore !== '') window.dispatchEvent(new Event(URL_RESTORED_EVENT));
}

/** A finished sign-in: the access token, and where the visitor was standing when they started it. */
export interface CompletedSignIn {
	token: string;
	/** Null when the sign-in stashed nowhere to go back to, which leaves the caller on this page. */
	returnTo: string | null;
}

/**
 * Finishes a sign-in, and returns the access token with the target to resume at.
 *
 * Returns `null` when this page load is not a callback at all, so the caller can treat "nothing to
 * do" as a normal outcome rather than an error.
 */
export async function completeSignIn(): Promise<CompletedSignIn | null> {
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
		stripCallbackParams(pending?.returnTo);
		throw new Error(t('errors.signIn.wrongTab'));
	}

	if (refusal !== null) {
		stripCallbackParams(pending?.returnTo);
		throw new Error(
			refusal === 'access_denied'
				? t('errors.signIn.cancelled')
				: (refusalDetail ?? t('errors.signIn.notAuthorized', { refusal })),
		);
	}
	if (code === null) {
		stripCallbackParams(pending?.returnTo);
		throw new Error(t('errors.signIn.noCode'));
	}

	// Held in a local before the address bar is touched, because after the strip below there is
	// nowhere left to read it from: the stored copy went with `takeAuthorization`, and the URL never
	// carried it in the first place.
	const returnTo = pending.returnTo ?? null;

	// Stripped before the exchange, not after: the exchange is a network round trip, and for its whole
	// length the code would otherwise be sitting in the address bar of a page the visitor can see,
	// copy and share.
	stripCallbackParams(pending.returnTo);

	const token = await exchangeCode({ code, verifier: pending.verifier });
	rememberToken({ token, source: 'oauth' });
	return { token, returnTo };
}

/**
 * Sends the tab on to where the sign-in started, when that is not the page it is already on.
 *
 * The callback always lands at this build's root, because that is the one URI registered with
 * WarcraftLogs, so a visitor who signed in from a route has to be carried the last step. The build is
 * static and every route is its own document, which makes that step a real navigation rather than the
 * `replaceState` above: rewriting the address bar alone would hang `/monk/windwalker` over the root
 * page's markup. `replace` rather than `assign`, so the back button reaches the page they started
 * from instead of the one that spent the code.
 *
 * Today it never fires, and that is deliberate: there is only one page, so the target's path is
 * always the path already loaded and the query is already back in the address bar. Trailing slashes
 * are normalised off both sides first, because `/x` and `/x/` are the same document and a visitor who
 * arrived at the slashed spelling comes back from WarcraftLogs at the registered one.
 */
export function resumeAfterSignIn(returnTo: string): void {
	const here = new URL(window.location.href);
	const target = new URL(returnTo, here);
	if (normalisePath(target.pathname) === normalisePath(here.pathname)) return;
	window.location.replace(target.href);
}

export const __test = { stripCallbackParams };
