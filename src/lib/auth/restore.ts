// What a page load makes of the token the last one left behind.
//
// This is the whole of "stay signed in across a refresh", and it is a pure function over storage so
// that the behaviour can be pinned without a browser. `SessionProvider` does the reacting; every
// *decision* is here.
//
// The rule it enforces is one thing: a restored session has to be one that can actually spend a
// request. `sessionStorage` keeps whatever it was handed, forever, with no idea that a token has a
// clock on it — so a tab left open past the token's `exp` used to come back from a reload saying
// "Signed in", and then failed the first query with a 401 that told the reader to sign in again. It
// announced a session it did not have. Reading `exp` here is what stops that, and it is the only
// place in this app where `expired` is allowed to *decide* anything.
//
// **It is still a guess, and it is deliberately the weaker half of a pair.** The signature is never
// checked and never could be (`token.ts` says why), so `exp` is a claim the token makes about itself
// and WarcraftLogs is the only authority on whether it is honoured. That cuts one way only: an `exp`
// in the past is trusted to refuse, because acting on it early costs a silent re-authorize and acting
// on it late costs a lie. An `exp` in the future is trusted for nothing at all — the 401 path in
// `lib/wcl/client.ts` remains the backstop, because a token can be revoked, or the clock can be
// wrong, and neither shows up in the payload.

import type { TokenSource } from './sessionContext';
import { readToken, type StoredToken } from './storage';
import { inspectToken } from './token';

/**
 * Why there is no session to restore, when there is none.
 *
 * The two are not the same event and must not be treated as one. `none` is an ordinary first visit —
 * there is nothing to say and nothing to recover. `expired` is a session this tab *had*: the visitor
 * signed in, and the only thing that went wrong is time. That is the one case worth spending an
 * automatic re-authorize on, and the one case worth saying something about.
 */
export type NoSessionReason = 'none' | 'expired';

export interface Restored {
	/** The token to carry on with, or null when there is not one worth carrying. */
	session: StoredToken | null;
	/** Null exactly when `session` is not. */
	reason: NoSessionReason | null;
	/**
	 * Where the expired token had come from. Null unless `reason` is `expired`.
	 *
	 * Kept because the two sources want different handling and the token is about to be dropped, which
	 * takes the answer with it. An expired sign-in is worth renewing automatically. An expired *pasted*
	 * token is not: the reader chose to bring their own credential, and quietly bouncing them through
	 * the authorize screen would swap it for one they did not ask for.
	 */
	expiredSource: TokenSource | null;
}

/**
 * The stored session, if there is one worth having.
 *
 * `now` is injectable for the same reason `inspectToken`'s is: expiry that can only be tested by
 * waiting is expiry that does not get tested.
 */
export function restoreSession(now: number = Date.now()): Restored {
	const held = readToken();
	if (held === null) return { session: null, reason: 'none', expiredSource: null };
	// `expired` is false for a payload that would not decode, which is the right way round: a token
	// this app cannot read is not a token it may throw away. WarcraftLogs can read it.
	if (inspectToken(held.token, now).expired) {
		return { session: null, reason: 'expired', expiredSource: held.source };
	}
	return { session: held, reason: null, expiredSource: null };
}
