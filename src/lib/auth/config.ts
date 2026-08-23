// Where the OAuth flow points, and the one public value it needs.
//
// PKCE has no secret, so the client id is public on purpose — the redirect-URI allow-list on the
// registered client is what stops another site spending it.
//
// It is not committed, and not a build-time variable either. WarcraftLogs meters its API **per
// client**, so a single id baked into this deployment would pool every visitor's request budget into
// one quota and starve everybody the moment the app saw real traffic. A build variable cannot fix
// that: one build serves every visitor, so it can only ever carry one id. So the id is per-browser
// runtime configuration — each visitor registers their own client and pastes its id in, and it lives
// in `localStorage` beside the rest of their setup.

import { i18n } from '~/lib/i18n';
import { WCL_HOST } from '~/lib/wcl/endpoint';

import { readClientID } from './storage';

/** The shell copy, off the instance: no component here either. See `wcl/client.ts` for the reasoning. */
const t = (key: string, values?: Record<string, unknown>): string => i18n.t(key, { ns: 'ui', ...values });

// The `www` host serves these endpoints too, and the WarcraftLogs docs describe them there. They are
// taken from the `classic` host instead for two reasons, both load-bearing:
//
// 1. The production CSP is `connect-src 'self' https://classic.warcraftlogs.com`. The token exchange
//    is a `fetch`, so on `www` the browser would block it — the app's own privacy claim would break
//    its own sign-in. Widening the CSP to a second host would weaken the claim to buy nothing.
// 2. It sidesteps the open question in docs/wcl-oauth.md about whether a token issued by `www` is
//    accepted by `classic`. A token minted by the host that will be asked to honour it cannot fail
//    that way.
//
// Only the exchange is subject to the CSP; `connect-src` does not govern the authorize redirect,
// which is a top-level navigation. Both are pointed at one host anyway so there is one thing to
// change if WarcraftLogs turns out to serve OAuth only from `www`.
export const WCL_AUTHORIZE_URL = `https://${WCL_HOST}/oauth/authorize`;
export const WCL_TOKEN_URL = `https://${WCL_HOST}/oauth/token`;

/** Where someone goes to register the client this app cannot work without. */
export const WCL_CLIENTS_URL = 'https://www.warcraftlogs.com/api/clients/';

/**
 * WarcraftLogs issues client ids as UUIDs, and the check exists for one specific mistake.
 *
 * The registration page shows the id and the client **secret** side by side, and the secret is the
 * more eye-catching of the two. This app has no use for a secret, must never be given one, and
 * would store whatever it was handed — so a paste that is not UUID-shaped is refused with an
 * explanation rather than saved and left to fail as a confusing sign-in error later.
 *
 * A courtesy check on shape, not a validity check. Only WarcraftLogs can say whether an id is real.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeClientID(value: string): boolean {
	return UUID_SHAPE.test(value.trim());
}

/**
 * The client id this browser signs in with.
 *
 * Throws rather than returning null because every caller is mid-flow and has no way to continue —
 * the UI checks for a configured id before offering the button, so reaching here without one is a
 * bug, not a visitor's mistake.
 */
export function requireClientID(): string {
	const id = readClientID();
	if (id === null) {
		throw new Error(t('errors.signIn.noClientId', { url: WCL_CLIENTS_URL }));
	}
	return id;
}

/**
 * Where WarcraftLogs sends the visitor back to.
 *
 * Derived from the address bar rather than written down, because the same build is served from
 * GitHub Pages and from `astro dev` on localhost, and a hard-coded origin makes one of the two
 * impossible to sign in to. The query string is dropped so the value is stable across the round
 * trip: the URL the callback lands on carries `?code=…`, and the exchange has to present the exact
 * `redirect_uri` the authorize step used.
 */
export function redirectUri(): string {
	const { origin, pathname } = window.location;
	// The trailing slash is not cosmetic. WarcraftLogs matches redirect_uri byte for byte and reports
	// a mismatch as `invalid_client` — "Client authentication failed" — which reads as though the
	// client id were wrong or unregistered, so it sends you hunting in entirely the wrong place.
	// Verified against the real client: `…/windwalker-analyzer` serves the consent form, while
	// `…/windwalker-analyzer/` is a 401.
	//
	// Both spellings reach this app (Astro serves either, and `import.meta.env.BASE_URL` carries a
	// trailing slash for a configured `base`), so normalise to the registered form: no trailing
	// slash, except at the site root where the slash *is* the path.
	const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
	return `${origin}${path}`;
}
