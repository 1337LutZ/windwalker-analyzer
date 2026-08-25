// Step 1 of the flow: leave for WarcraftLogs.

import { WCL_AUTHORIZE_URL, redirectUri, requireClientID } from './config';
import { challengeFor, createState, createVerifier } from './pkce';
import { rememberAuthorization } from './storage';

/**
 * Sends the browser to WarcraftLogs' own login and consent screen. Nothing after this line runs —
 * the tab is navigating away, and it comes back through `completeSignIn`.
 *
 * The verifier and state are stored *before* the navigation, because after it there is no JavaScript
 * left alive to store anything.
 */
export async function beginAuthorize(): Promise<void> {
	const clientID = requireClientID();
	const verifier = createVerifier();
	const state = createState();
	const challenge = await challengeFor(verifier);

	// Where they are standing goes with them. `redirect_uri` is matched byte for byte by WarcraftLogs
	// and points at this build's root, so neither the route nor a shared link's report and fight can
	// ride back in the URL — signing in from one used to land on a bare page with the selection gone.
	const { pathname, search, hash } = window.location;
	rememberAuthorization({ verifier, state, returnTo: `${pathname}${search}${hash}` });

	const url = new URL(WCL_AUTHORIZE_URL);
	url.searchParams.set('client_id', clientID);
	url.searchParams.set('code_challenge', challenge);
	url.searchParams.set('code_challenge_method', 'S256');
	url.searchParams.set('state', state);
	url.searchParams.set('redirect_uri', redirectUri());
	url.searchParams.set('response_type', 'code');

	window.location.assign(url.toString());
}
