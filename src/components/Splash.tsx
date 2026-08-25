import MovedNotice from './MovedNotice';
import SpecPicker from './SpecPicker';
import SessionProvider from './auth/SessionProvider';

/**
 * The island root of the two pages that are about no spec: the splash and the 404.
 *
 * `App` is the same thing one page over, and this is deliberately the smaller half of it — no query
 * cache, because nothing here fetches, and no `Analyzer`, because there is no report to build.
 *
 * **The session provider is not decoration, and it is the whole reason this file exists rather than
 * `pages/index.astro` rendering `SpecPicker` directly.** WarcraftLogs matches `redirect_uri` byte for
 * byte against one URI per registered client, so `lib/auth/config.ts` anchors it at this build's
 * **root** and keeps it there however many routes the site grows — a URI that trailed the route would
 * send every visitor who registered the one they were told to into `invalid_client`. The consequence
 * lands here: a sign-in started on `/monk/windwalker` comes back to `/`, so the root is where the
 * `?code=` arrives and the root is what has to spend it. `SessionProvider` is what does that, and
 * `resumeAfterSignIn` inside it carries the tab the last step back to the route the reader left from,
 * with their report, their pull and their section still on it.
 *
 * Without this the exchange never runs on the page it lands on: the reader is returned from
 * WarcraftLogs to a picker, has to choose a spec to get anywhere, and the code they are carrying
 * spends its short life while they read the page.
 *
 * One side effect comes with it and is worth stating rather than discovering. `SessionProvider` also
 * renews an expired session on mount — one silent re-authorize per tab — so a tab that signed in,
 * aged out and then came back to the splash will bounce through WarcraftLogs once and return here
 * signed in. That is the same round trip a route would make, on a page with nothing to spend a token
 * on yet, and it leaves the reader one click from a report instead of two.
 */
export default function Splash({ unknownAddress = false }: { unknownAddress?: boolean }) {
	return (
		<SessionProvider>
			{/* Above the picker, because it is about whether the next click will work at all. Inside the
			    provider so it sits in the same island the code exchange runs in — see `MovedNotice` for
			    why a stored client id is what decides it renders. */}
			<div className="flex flex-col gap-5">
				<MovedNotice />
				<SpecPicker unknownAddress={unknownAddress} />
			</div>
		</SessionProvider>
	);
}
