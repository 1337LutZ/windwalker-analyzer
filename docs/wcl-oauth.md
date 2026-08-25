# WarcraftLogs OAuth — the PKCE code flow

Transcribed from <https://www.warcraftlogs.com/api/docs> (read 2026-08-13) so the implementation has
a written reference and does not drift on someone's recollection.

## The site moved: what every existing user has to do, once

The analyser is served from **`https://mop-log-analyzer.pages.dev/`** — one site for every spec,
where there used to be `windwalker-analyzer.pages.dev` and `elemental-analyzer.pages.dev`.

**Add that exact string, trailing slash included, to your own WarcraftLogs client.** Nothing else
about your client changes: the id is the same, the tokens are the same, and the entries already on it
can stay. Redirect URIs are comma-separated, so this is an addition rather than a replacement, and it
takes about as long as pasting one line.

Until you do, sign-in fails with `invalid_client` — "Client authentication failed" — and that message
is wrong about the cause. It reads as though the id were unregistered. The id is fine; the URI the
app sends is one your client has never seen. _The redirect URI must match exactly_, below, includes a
single request that separates the two cases, so this does not have to be guessed at.

**Signing in on an old host is not a fallback, because it no longer works at all.** Both old hosts 301
to the new one, and a 301 breaks the round trip in two independent places. A callback cannot land on
a host that redirects, so the browser is carried on to the new origin with the `?code=` in hand. And
the verifier and `state` that the exchange needs were written into the _old_ origin's
`sessionStorage`, which the new origin cannot read — so the code that did arrive cannot be spent
either. This is the one part of the move that fails outright rather than degrading, which is why it
is at the top of this file rather than in the migration notes at the bottom.

**One entry covers every route.** `redirectUri()` is anchored at the build's own root rather than
following the address bar, so `/monk/windwalker` and `/shaman/elemental` send the same URI that `/`
does. That is what keeps a registration good as the site grows: a URI that trailed the route would
need a fresh registration from every user for every route added.

The app renders the exact string it will send, with a copy button. Copy that rather than any line
written here.

## Why PKCE and not the other two flows

WarcraftLogs offers three flows. Only one of them fits a static site:

| flow               | endpoint         | private reports | needs a client secret |
| ------------------ | ---------------- | --------------- | --------------------- |
| Client credentials | `/api/v2/client` | **no**          | yes                   |
| Authorization code | `/api/v2/user`   | yes             | yes                   |
| **PKCE code flow** | `/api/v2/user`   | yes             | **no**                |

In WarcraftLogs' own words:

> The APIs under **/api/v2/user** can be accessed using this flow. The PKCE code flow is used from
> applications (e.g., browser-based apps) that are not able to securely access a client secret, so a
> code challenge/verifier is used instead.

That is exactly this app: it is served from Cloudflare Pages with no backend, so it can never hold a
secret. Client credentials would also be wrong on its own terms — it cannot read private logs, and a
personal log is precisely what someone wants analysed.

## Registering the client — every user, once

**Not** a repo-owner task. WarcraftLogs rate-limits per client, so a shared client id would pool
every visitor's request budget into a single quota. Each person registers their own and pastes the id
into the app; see the ClientIdSetup spec in component-specs.md.

1. Log in to Warcraft Logs.
2. Go to the client management page: <https://www.warcraftlogs.com/api/clients/> and click
   **Create Client**.
3. Enter a client name. It is shown on the authorization screen when signing in.
4. Enter the redirect URI. Multiple are comma-separated; escape commas inside a single URI.
   - production: `https://mop-log-analyzer.pages.dev/`
   - local dev: `http://localhost:4321/`

   **The trailing slash is part of the match, and whether there is one depends on the path.**
   Matching is byte-exact. Both of these are served at the root of their domain, where the slash
   _is_ the path and has to be there. On a site served under a path prefix — a GitHub project site,
   say — the opposite holds: verified against the real client, `…/windwalker-analyzer` serves the
   consent screen and `…/windwalker-analyzer/` is a 401. The app renders the exact string it will
   send, with a copy button, so this never has to be retyped — copy that rather than any line here.

5. Tick **Public Client**, which is what allows PKCE, then click Create.

The resulting **client_id is public** — that is the point of PKCE, and why it is safe to keep in the
browser's `localStorage` and to show on screen. It is still not committed to this repo, because it is
per-user rather than per-app: the redirect-URI allow-list is what protects it, and the rate limit is
what makes sharing one a bad idea. The client _secret_ this page also shows is for the other flows —
this app must never hold it.

## The flow

**1. Authorize.** Redirect the browser to the authorize URI with:

| parameter               | value                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `client_id`             | the developer's client ID                                                              |
| `code_challenge`        | base64url of SHA-256 of the verifier: trailing `=` removed, `+/` → `-_`, no whitespace |
| `code_challenge_method` | `S256`                                                                                 |
| `state`                 | a semi-random blob returned to the callback                                            |
| `redirect_uri`          | where the user lands after approving or denying                                        |
| `response_type`         | `code`                                                                                 |

> Both the state and the code verifier should be stored in the session so that the callback can
> retrieve them.

**2. Callback.** WarcraftLogs sends the user back to `redirect_uri` with `state` and `code`. Compare
`state` against the stored value before doing anything else — that check is what makes the callback
proof against a forged request.

**3. Exchange.** POST to the token URI:

| parameter       | value                                                          |
| --------------- | -------------------------------------------------------------- |
| `client_id`     | the developer's client ID                                      |
| `code_verifier` | the random 43–128 character string from the session (RFC 7636) |
| `redirect_uri`  | the same one used to obtain the authorization                  |
| `grant_type`    | `authorization_code`                                           |
| `code`          | the code from the callback                                     |

No secret, no `Authorization` header.

## Verified for this app

- `OPTIONS https://www.warcraftlogs.com/oauth/token` and the `classic.` host both answer `204` with
  `access-control-allow-origin` reflecting the requesting origin and `access-control-allow-methods:
POST`. The exchange can therefore run in the browser, which is what makes a backend-free build
  possible at all.
- The MoP data itself is queried from `https://classic.warcraftlogs.com/api/v2/user`, which returns
  the same permissive CORS headers.

## The redirect URI must match exactly — including the trailing slash

Verified against the real client, and it costs hours if you do not know it:

| redirect_uri sent                                                   | authorize response        |
| ------------------------------------------------------------------- | ------------------------- |
| `http://localhost:4321/windwalker-analyzer` (exactly as registered) | **200**, the consent form |
| `http://localhost:4321/windwalker-analyzer/` (one extra `/`)        | **401** `invalid_client`  |

There is no normalisation. A trailing slash, a differing case, or a stray query string makes it a
different URI.

**The error is actively misleading.** A redirect mismatch reports `invalid_client` — "Client
authentication failed" — which reads as _the client id is wrong or unregistered_, sending you off to
re-check the id, the host, and whether the client exists. It is worth confirming the id independently
before believing that message: post to the token URI with a deliberately bogus `code`. A registered
client answers `invalid_grant` ("Cannot validate the provided authorization code"); an unknown one
answers `invalid_client`. That single request separates "wrong id" from "wrong redirect URI".

So when building the authorize URL, send the registered string byte for byte. Astro's
`import.meta.env.BASE_URL` carries a trailing slash for a configured `base`, so it must be stripped
before use — the naive `origin + BASE_URL` is exactly the broken variant above.

Every environment needs its own registered entry, comma-separated on the client:

- local dev: `http://localhost:4321/`
- production: `https://mop-log-analyzer.pages.dev/`
- the GitHub Pages fallback, if it is ever published: `https://1337lutz.github.io/windwalker-analyzer`

The production entry has now changed twice, and for different reasons. It changed once when the site
moved to Cloudflare Pages, which serves at the domain root rather than under a repo path, and the
trailing slash arrived with it. It changed again when two spec-pinned sites became one build serving
every spec by route, which is the move at the top of this file and the one that costs every existing
user a minute. An entry for a host you no longer serve from is harmless and can be left; a missing
one fails as `invalid_client`, which reads as though the client id were wrong.

The fallback entry has no trailing slash, and that is not an inconsistency: it is served under a path
prefix, where the slash is not part of the path, and the table above measured that difference against
the real client.

## Confirmed against the real client

- The client id is registered and PKCE is accepted: the token URI answers `invalid_grant` for a bogus
  code rather than `invalid_client`.
- The authorize URI serves the consent form on both `www.` and `classic.` hosts when the redirect URI
  matches, so the user grants access there in the normal way.
