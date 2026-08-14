// The exact `redirect_uri` this app will send, as a string that can be shown to the visitor.
//
// It has to be state set after mount rather than a value read during render: `window.location` does
// not exist while Astro prerenders this island, and it is the address bar — not a constant — that
// decides the answer, because the same build is served from GitHub Pages and from `astro dev`.

import { useEffect, useState } from 'react';

import { redirectUri } from '~/lib/auth';

/** Null on the prerender and the first paint; the URI from then on. */
export function useRedirectUri(): string | null {
	const [uri, setUri] = useState<string | null>(null);
	useEffect(() => setUri(redirectUri()), []);
	return uri;
}
