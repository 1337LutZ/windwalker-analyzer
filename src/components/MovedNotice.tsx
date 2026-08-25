import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { readClientID } from '~/lib/auth';

import CopyField from './primitives/CopyField';
import { useRedirectUri } from '~/hooks/useRedirectUri';

/** That this browser has been told once. Dismissal is the only exit — see the docblock. */
const SEEN_KEY = 'wcl.moved.seen';

/**
 * The one thing a returning reader has to do after the site moved, said before it bites them.
 *
 * **Why a notice and not an error.** The analyser used to live on two hosts, one per spec, and now
 * lives on one. WarcraftLogs matches `redirect_uri` byte for byte against a URI registered on the
 * visitor's *own* client, so a client registered against either old host does not match this one and
 * sign-in fails `invalid_client` — an error `docs/wcl-oauth.md` records as actively misleading, because
 * it reads as a wrong client id and sends the reader off to re-check the id, the host and whether the
 * client exists. Anyone who used the old site will hit it on their next sign-in.
 *
 * It is worse than a failed sign-in on the old hosts, which is why the old hosts cannot carry this
 * message themselves. They 301 here, and a 301 arrives holding `?code=` while the PKCE verifier and
 * `state` sit in the *old* origin's `sessionStorage`, which this origin cannot read. So a sign-in
 * begun there cannot be completed anywhere.
 *
 * **Why a stored client id is the trigger.** Every link the old sites produced pointed at a host that
 * now redirects, and the new address has not been shared, so today every arrival is a redirected
 * reader. That will stop being true, and a banner shown to everyone would then be nagging people who
 * never used the old site about a registration they never made. `wcl.clientId` is in `localStorage` on
 * purpose — it is a preference rather than a credential, per `lib/auth/storage.ts` — so its presence
 * says this browser set the analyser up *before*, which is exactly the population whose registration
 * is now stale. A first-time reader has none and is shown nothing, so this ages out on its own rather
 * than becoming a notice somebody has to remember to delete.
 *
 * **The URI is generated, never written into the copy.** `useRedirectUri` returns what `redirectUri()`
 * will actually send, so the string a reader pastes into WarcraftLogs cannot drift from the string the
 * token request carries. `ClientIdSetup` shows it the same way and for the same reason.
 *
 * **It cannot know when the reader has fixed it**, because nothing here can read their client's
 * registration back. So dismissal is the only exit, and the `invalid_client` message on the sign-in
 * panel is the backstop for anyone who dismissed this and forgot.
 */
export default function MovedNotice() {
	const { t } = useTranslation('ui');
	const uri = useRedirectUri();
	// Both reads are effects rather than lazy initialisers: neither `localStorage` nor `window.location`
	// exists while Astro prerenders this island, and a lazy initialiser runs during that render.
	const [show, setShow] = useState(false);
	useEffect(() => {
		let seen = false;
		try {
			seen = localStorage.getItem(SEEN_KEY) !== null;
		} catch {
			// A browser refusing storage cannot have a stored client id either, so it sees nothing below.
		}
		setShow(!seen && readClientID() !== null);
	}, []);

	if (!show) return null;

	const dismiss = () => {
		setShow(false);
		try {
			localStorage.setItem(SEEN_KEY, '1');
		} catch {
			// Dismissed for this view. A browser that will not remember it will show it again, which is
			// the harmless direction to fail in.
		}
	};

	return (
		<aside
			className="flex flex-col gap-3 rounded-sm border border-line border-l-2 border-l-brew bg-[color-mix(in_oklch,var(--color-brew)_14%,var(--color-tint-base))] p-4"
			aria-labelledby="moved-notice-heading"
		>
			<h2 id="moved-notice-heading" className="m-0 text-base font-semibold text-ink">
				{t('app.moved.title')}
			</h2>
			<p className="m-0 max-w-[64ch] text-sm leading-relaxed text-ink-2">{t('app.moved.body')}</p>
			{/* Null until the effect runs, which is the prerender and the first paint. The row is withheld
			    rather than shown empty, because a copy button that copies nothing is worse than a beat's
			    wait for the one string this notice exists to hand over. */}
			{uri === null ? null : <CopyField label={t('app.moved.uri')} value={uri} />}
			<div>
				<button type="button" onClick={dismiss} className="text-sm text-ink-2 underline hover:text-ink">
					{t('app.moved.dismiss')}
				</button>
			</div>
		</aside>
	);
}
