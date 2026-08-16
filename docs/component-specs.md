# Component specs

Behaviour that is easy to get subtly wrong, written down so it is built once. General rules live in
[conventions.md](./conventions.md).

## FightSelector

Picks the pull to analyse. A raid night is 20–40 pulls with the same bosses repeated, so a flat list
is both long and hard to read — the shape of the data is _encounters_, each with one or more attempts.

**Group by encounter.** One row per boss, in pull order, not one row per pull.

**Default to the kill.** Almost nobody wants to analyse a wipe, and when they do it is deliberate.
Each encounter group pre-selects its kill. If an encounter has no kill, select its longest attempt —
the closest thing to a full pull — and label it as a wipe so the choice is never silently wrong.

**Wipes are behind an expander,** not hidden. Collapsed, a group shows the boss, the selected pull's
duration and its result. Expanded, it lists every attempt with duration and wipe percentage so a
specific attempt can be chosen. Use the Base UI `Collapsible` (or `Accordion`) so keyboard and ARIA
come for free.

**No scrollbar.** The selector must never grow its own scrolling box. Grouping is what makes this
possible: collapsed groups turn ~30 rows into ~12, which fits. The page scrolls; the component does
not. A nested scroll region on a phone traps the gesture and is why this is called out.

Selection state is a single fight id. Expanding a group must not change the selection — expanding is
inspection, choosing is a separate act.

Mobile: full-width rows, 44px minimum tap targets, duration and result on their own line rather than
crushed onto one.

## PlayerSelector

Picks which Windwalker to analyse — and usually should not appear at all.

**Only render it when the chosen fight has more than one Windwalker.** One is the common case; asking
someone to pick from a list of one is a pointless step. With exactly one, select silently and show
who was chosen as plain text, not a control. With none, do not render an empty picker — say the fight
has no Windwalker and let them pick a different pull.

**Detect the spec before fetching events.** `Report.playerDetails(fightIDs: [n])` returns players
already grouped into `tanks` / `healers` / `dps`, each with `type` (class) and `specs[].spec`.
Filter to `type === 'Monk' && specs[].spec === 'Windwalker'`. Verified against a real report: it
returns `a Windwalker` under `dps` and `a Brewmaster` under `tanks`,
so it separates monk specs correctly.

This matters because it is **one cheap query, before the expensive part**. The event fetch is several
pages for a long pull; discovering only afterwards that the selected player is a Brewmaster wastes
all of it. `playerDetails` also solves what `combatantinfo` cannot — Classic reports `specID` as `0`,
so the event stream itself cannot name a spec.

`playerDetails` returns `JSON` in the schema, so its shape is hand-narrowed at the client boundary
like the damage table, not generated.

Keep the Tigereye Brew check as a **post-fetch guard**, not the primary detection: if a player
somehow reaches the engine with no brew cast, still refuse rather than render a page of zeroes.
Belt and braces, cheap to keep.

## StickySelectionBar

Once a report, fight and player are chosen, that choice is context the reader needs while looking at
the analysis — but the pickers themselves are only needed once. When the selection block scrolls out
of view, collapse it into a sticky bar at the top.

**Base UI `Toolbar`.** `Toolbar.Root` with `Toolbar.Button`s and `Toolbar.Separator`. The point of
using it rather than a styled `div` is the behaviour that comes with it: the ARIA `toolbar` role and
roving focus, so the bar is one tab stop and arrow keys move between its controls instead of the bar
adding four stops to every keyboard user's journey through the page.

**Appears only when both are true:** a full selection exists, and the selection block is out of view.
It must never appear during setup — while someone is still choosing, the real controls are on screen
and a duplicate summary is noise.

**Detect with an `IntersectionObserver`** on a sentinel element at the bottom of the selection block.
Do not listen to `scroll` and compare offsets: that runs on every frame and gets the answer wrong as
soon as layout shifts under it.

**Content, in one line:**

- encounter name and pull result (kill, or wipe with its percentage)
- the player, shown only when the fight had more than one Windwalker — otherwise it is noise, for the
  same reason the PlayerSelector hides itself
- a **Change** button that scrolls the selection block back into view and moves focus into it

Truncate the encounter name with `text-overflow: ellipsis` rather than wrapping; the bar is one line
at every width.

**Layout.** `position: sticky; top: 0` with a `surface` background, a bottom `line` border and a
backdrop blur, above the charts in stacking order. Keep it slim — it costs vertical space on a phone
permanently, so one row, 44px targets, no second line.

Give section headings `scroll-margin-top` equal to the bar's height, so in-page jumps do not land
under it.

**Motion.** Fade or slide in over ~150ms, and none at all under `prefers-reduced-motion` — a bar that
animates on every scroll reversal is worse than one that simply appears.

## Auth surface — two ways in

Both paths produce the same session and are treated identically once a token exists:

```ts
{ token: string, source: 'oauth' | 'manual' }
```

**Primary: Sign in with Warcraft Logs.** The PKCE flow in [wcl-oauth.md](./wcl-oauth.md). This is the
default and the visually prominent option, because it works for someone who has never heard of the
API: they log in on WarcraftLogs' own page and come back signed in.

**Secondary: paste an access token.** For people who already generate their own. Keep it available
but out of the way — a Base UI `Collapsible` labelled something like "Advanced: use your own access
token", collapsed by default. It is not a lesser path, just a rarer one, so it stays one click away
rather than hidden.

Both obey the same rules: `sessionStorage` only, dies with the tab, never rendered back as readable
text (`value=""` on the input after submit), never logged, never in a URL.

### Two token kinds, two endpoints

A pasted token can be either kind, and both are usable — they just reach different data. Decode the
JWT payload client-side (split on `.`, base64url-decode the middle segment) to tell them apart and to
produce good errors. **Never verify or trust it**; the API is the only authority. This is a courtesy
check, not a security control.

Verified against a real user token — the payload carries
`aud, jti, iat, nbf, exp, sub, scopes`, with `scopes: ["view-user-profile", "view-private-reports"]`.

| token kind                        | tell                                                           | endpoint         | reaches                        |
| --------------------------------- | -------------------------------------------------------------- | ---------------- | ------------------------------ |
| user (PKCE or authorization code) | `scopes` contains `view-user-profile` / `view-private-reports` | `/api/v2/user`   | public **and** private reports |
| client credentials                | those scopes absent                                            | `/api/v2/client` | public reports only            |

**A client-credentials token is not an error.** Route it to `/api/v2/client` and carry on — plenty of
logs are public and it will analyse them perfectly. Show a persistent, non-blocking notice: _this
token can only read public logs; private reports will come back as not found._ That last clause
matters, because the failure it produces is a "report not found" that looks like a typo rather than
a permissions problem.

**Fall back at runtime, not just on the decode.** Scope names can change and a payload may not decode
at all. If the chosen endpoint returns an auth error, retry once on the other before surfacing
anything. This is safe in the direction that matters: a user token was verified to work on
`/api/v2/client` as well (HTTP 200), so degrading is always possible.

If the payload will not decode, do not block — send it to `/api/v2/user` and let a real error come
back. A malformed-looking token that works beats a working token rejected by our guess.

**Expiry.** `exp` is a Unix timestamp in the payload. If it is past, say the token expired and when,
rather than letting the first query fail with a bare 401.

The PKCE path always yields a user token, so none of this applies to it — the endpoint is `/user` and
the notice never shows.

## ClientIdSetup

**Every user registers their own OAuth client.** This is not a convenience choice — WarcraftLogs
rate-limits by client, so a single shared client id would pool every visitor's requests into one
quota and starve everyone the moment the app saw real traffic. There is no committed default client
id, and adding one would be a bug.

That makes client registration part of onboarding rather than a repo-owner task, so the app has to
carry the visitor through it rather than pointing at a doc and hoping.

**Show the exact redirect URI to paste, with a copy button.** WarcraftLogs matches redirect URIs byte
for byte and reports a mismatch as `invalid_client` — "Client authentication failed" — which reads as
though the id were wrong, sending people to re-check the id they just pasted correctly. Rendering the
exact string, derived from `window.location` and normalised the same way `redirectUri()` normalises
it, removes the whole class of error: they copy what the app will actually send.

Steps to walk through, in the TokenHelp dialog and inline on first run:

1. Open <https://www.warcraftlogs.com/api/clients/> and click Create Client.
2. Any name. It is shown on the consent screen.
3. Paste this redirect URI — _rendered live, with a copy button, not written out in prose_.
4. Tick the PKCE / public-client option.
5. Copy the client id back into the app. **Not** the client secret: this app has no use for one and
   must never be given it.

**Where it is kept.** The client id goes in `localStorage`, deliberately unlike the access token,
which is `sessionStorage` and dies with the tab. The id is not a credential — it is public by
design under PKCE — and making someone re-register or re-paste it every tab would be hostile for no
security gain. The token is the secret; the id is configuration.

Offer a visible "change client id" control, and state plainly that the id is stored locally and is
not sent anywhere except to WarcraftLogs as part of signing in.

**Until an id is set**, the sign-in button explains what is missing and links to this flow rather than
throwing or silently failing. The manual-token path stays available throughout — someone who already
has a token does not need a client at all.

## TokenHelp modal

Explains how to sign in, for someone who has never touched the WarcraftLogs API. Reachable from both
auth paths.

Base UI `Dialog`. It must cover, in plain language:

- that signing in uses WarcraftLogs' own login, and this app never sees a password
- that the token stays in the browser tab and is sent only to `warcraftlogs.com`
- that it is discarded when the tab closes
- a link to <https://www.warcraftlogs.com/api/docs> for the underlying API documentation

Link out with `target="_blank"` and `rel="noopener noreferrer"`. Do not reproduce a token, real or
example, as body text.

## Report sections

**The list lives in `SECTIONS` in `src/components/Report.tsx`, and this page deliberately does not
repeat it.** That array is already read twice — rendered as the report and folded into the sidebar —
and its docstring explains why one list rather than two. Enumerating it here made a third copy: it
was written when there were nine sections, and by the time anyone noticed it was missing nineteen of
the twenty-four, including every ability section. A list that goes stale silently is worse than a
pointer, because it reads as current.

What is stable enough to write down is the shape:

- **Order is editorial, not alphabetical or mechanical.** Each entry carries a comment saying why it
  sits where it does, and several adjacencies are load-bearing — Energizing Brew under Fists of Fury
  because the priority list weighs the two against each other, Chi Brew under the bank it feeds.
- **Grouping is separate from order.** `group` files a section in the sidebar by what a button *is*
  to the player — core, cooldowns, abilities, reference — while the array's order stays the reading
  order the report argues in. The two are allowed to disagree and in places do.
- **A section may decline to appear**, via `when`, and that gate belongs in the array rather than in
  the component: the sidebar is built from the same list, so a component quietly returning `null`
  would leave a link pointing at a heading that was never rendered.
- **Every section that reports a fault must be able to say "nothing to report" without looking
  broken.** A clean pull is a real outcome, not an empty state.
- **Timestamps deep-link into WarcraftLogs at that moment**, so a claim can be checked rather than
  trusted.
