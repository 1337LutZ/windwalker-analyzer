// The one host this analyser talks to, and the two paths on it.
//
// Mists of Pandaria Classic lives on the `classic` subdomain, and that is the only game version this
// tool reads — there is no instance picker, no host switching and no retail branch to get wrong. A
// report code that does not exist there does not exist for us.
//
// One host, two paths, and that distinction is the whole of it. `/user` and `/client` serve the same
// schema; which one a token may use is decided by how the token was issued, not by which game or
// site it is for. The production CSP names this single host, so choosing between the two paths costs
// it nothing — and must not widen it.

import type { TokenKind } from '~/lib/auth/token';

/** The single WarcraftLogs host. Everything below is derived from it so there is one place to look. */
export const WCL_HOST = 'classic.warcraftlogs.com';

/**
 * The path for a token with an account behind it — the PKCE flow's, and any authorization-code one.
 *
 * It reads public reports and the visitor's own private and archived ones, which is most of what
 * anyone wants analysed, so it is also where a token we could not read at all is sent.
 */
export const WCL_USER_ENDPOINT = `https://${WCL_HOST}/api/v2/user`;

/**
 * The path for a client-credentials token, which reads **public logs only**.
 *
 * Not a lesser endpoint, just a narrower one, and plenty of logs are public. The trap is that a
 * private report queried through it does not come back refused — it comes back *not found*, which
 * reads like a mistyped report code, which is why anyone signed in with one is told so up front.
 */
export const WCL_CLIENT_ENDPOINT = `https://${WCL_HOST}/api/v2/client`;

/**
 * Which path a token of this kind is tried on first.
 *
 * `unknown` goes to `/user`: it is the guess we can afford to be wrong about, since a real error
 * from WarcraftLogs beats a refusal from our own decoder, and the retry below covers the miss.
 */
export function endpointFor(kind: TokenKind): string {
	return kind === 'client' ? WCL_CLIENT_ENDPOINT : WCL_USER_ENDPOINT;
}

/**
 * The other one, for the single retry after an auth failure.
 *
 * Safe in the direction that matters: a user token was verified to answer HTTP 200 on `/client` as
 * well, so degrading is always possible. Scope names can also change under us, and without this a
 * perfectly good token would be stranded on the path our decode picked for it.
 */
export function otherEndpoint(endpoint: string): string {
	return endpoint === WCL_CLIENT_ENDPOINT ? WCL_USER_ENDPOINT : WCL_CLIENT_ENDPOINT;
}

/** Base for deep links back into the log, which is what makes a finding checkable. */
export const WCL_REPORT_BASE = `https://${WCL_HOST}/reports`;
