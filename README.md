# windwalker-analyzer

A static web page that reads one WarcraftLogs pull for a **Mists of Pandaria Windwalker monk** and
tells you where the damage went and what the log says you did wrong. Sign in, paste a report URL,
pick the pull, pick the player. It fetches that fight from the WarcraftLogs API **in your browser**
and renders the analysis. Nothing is uploaded, stored or shared.

The scope is deliberately one spec on one game version. MoP Classic reports live on
`classic.warcraftlogs.com`, and that host is hardcoded — there is no game-version picker, because
there is nothing else this app knows how to read. Point it at a retail log and it will not find the
report.

It answers a fairly narrow set of questions:

- **Damage** — per-ability totals, share, crit rate, and which abilities were never cast at all
  (autoattacks, trinket and enchant procs).
- **Casts** — casts per minute per ability, GCD utilisation, median and worst gaps.
- **Lost casts** — cooldown drift converted into whole casts you could have had.
- **Tigereye Brew** — how many stacks each brew consumed, brews fired below cap, stacks binned by
  capping out, and what was left banked when the boss died.
- **Re-Origination snapshots** — for each proc, how late in the window the brew snapshotted it,
  which stat the proc returned, whether it repeated the previous stat, and which procs landed
  back-to-back so the second one was partly wasted.
- **Rising Sun Kick** — debuff uptime against engaged time, asked at each moment of the enemy you
  were actually hitting rather than of one target for the whole pull, plus every drop with a
  timestamp.
- **Fists of Fury and Tiger Palm** — channel placement against the sim's rotation, and whether the
  Tiger Power buff was refreshed on time or on a wasted cast.
- **Miss ledger** — every fault above, in one timestamped list, each row linking back to the moment
  in the log.

If the player you pick never cast Tigereye Brew, the page **refuses to render a report** and says so.
Classic logs report `specID` as 0, so a brew cast is the only proof of spec available — and a
Windwalker report drawn for a Brewmaster would be a page of zeroes that reads like a verdict on
someone playing their own spec correctly.

## Your API token stays in your browser

This is the part worth being precise about, because you are pasting a credential into a web page.

- **There is no backend.** The site is a folder of static files on Cloudflare Pages — HTML, JS, CSS.
  There is no server of ours, no API route, no serverless function, no database and no analytics.
  There is nowhere for the token to be sent even if the code wanted to.
- **One third party is contacted: Wowhead.** Two things come from `wow.zamimg.com`, their asset
  host — the same place the wowsims simulator gets them:
  - **Icons.** Every spell, item, gem and enchant icon on the page.
  - **Their tooltip widget** (`widgets/power.js`), which is what makes an item icon in the gear
    section hoverable. Without it an icon is a picture with no name: a combat log reports an item as
    a bare id, so what a piece actually _is_ can only come from Wowhead.

  This is the only third-party script on the page. It is deferred, so it never delays the report,
  and hovering an item tells Wowhead that someone looked at that item.

  **We do not hand them your token or your report code — but we cannot stop them taking either.**
  That distinction used to be missing here, and it is the one that matters. `power.js` is injected by
  us and runs as first-party script in this origin, which means `sessionStorage` is exactly as
  readable to it as to our own code; the token not appearing in the page's HTML was never what
  protected it, because reading it was never a DOM operation. The Content-Security-Policy does not
  help, either: it _names_ Wowhead's host so the widget can load at all, and a policy cannot un-trust
  a script it has been told to trust. What is true is that nothing in our code passes them either
  value, and our code is short enough to check.

  If you would rather not extend that trust, an ad blocker will drop both the icons and the tooltips,
  and the report is fully readable without them — every number the report argues from is rendered by
  us, not by them.

- **The token goes to exactly one place.** It is used only as an `Authorization: Bearer` header on
  requests to `https://classic.warcraftlogs.com/api/v2/user`. It is never written into a URL, never
  logged, and never attached to anything else.
- **It is never displayed back to you.** The input is a password field that is emptied the instant
  the token is accepted; after that the page only knows that a token exists, and there is no view in
  it that can render the value.
- **It is held in `sessionStorage`, not `localStorage`,** so it dies when you close the tab even if
  you forget about it — and signing out clears it, and the report with it, at once.
- **One thing does outlive the tab, and it is not a credential:** your API client id, in
  `localStorage` under `wcl.clientId`. PKCE publishes that id in the address bar of every sign-in —
  it is public by design — so it is kept to save you re-pasting it, and it is safe to show on screen.
  Your client _secret_ is never asked for, and the field refuses anything that is not a client id.

You do not have to take that on faith. In descending order of effort:

1. **Watch it.** Open DevTools → Network and run an analysis. The requests are the page's own assets
   from `pages.dev`, POSTs to `classic.warcraftlogs.com`, and icons plus the tooltip widget from
   `wow.zamimg.com` (with Wowhead's own tooltip lookups once you hover an item). Search the request
   list for your token: it appears in the `Authorization` header of those POSTs and nowhere else —
   no query string, no beacon, and nothing on the Wowhead requests.
2. **Check the storage.** DevTools → Application → Storage. `sessionStorage` holds `wcl.token` and a
   label saying where it came from; `localStorage` holds `wcl.clientId` and nothing else. There are
   no cookies, and closing the tab empties the session half.
3. **Check the policy.** View source on the deployed page: it ships a Content-Security-Policy meta
   tag that denies everything by default and then names a host per directive. `connect-src` is
   `'self' https://classic.warcraftlogs.com https://nether.wowhead.com` — three hosts, and the third
   is there because Wowhead's tooltip widget fetches item data from it. Without it the widget loads,
   binds and then reports "No response from server", which is what it did here until it was noticed.

   Be clear about what that policy does and does not buy you, because the honest version is narrower
   than the one this section used to give. It stops a request going to a host that is not on the
   list, and your browser enforces that rather than our code. It does **not** stop the tooltip widget
   reading your token. `wow.zamimg.com/widgets/power.js` is loaded by us and runs as first-party
   script in this origin, so `sessionStorage` is as readable to it as to anything we wrote — being
   absent from the page's HTML was never the thing protecting it. A policy cannot un-trust a script
   it has been told to trust, and no arrangement of directives changes that while the widget is on
   the page.

   So the accurate claim is: we never hand Wowhead the token or the report code, the code that talks
   to WarcraftLogs is one short method you can read, and the host list is short enough to check. What
   is not claimed is that a third party is prevented from looking. If you would rather not extend
   that trust, the widget only supplies item _names_ on hover — blocking `wow.zamimg.com` in your own
   browser costs you those and nothing else. (The policy is production-only; `astro dev` needs its
   own websocket.)

4. **Read it.** This repo is the site. Every network call in the app goes through one method,
   `#graphql` in `src/lib/wcl/client.ts` — that is the only place a request leaves the page, and it
   is short enough to read in a minute. The build that publishes it is `.github/workflows/deploy.yml`,
   and its run log names the commit it built; nothing is uploaded by hand.

Two honest caveats. A WarcraftLogs token is a credential: anyone holding it can read whatever your
WarcraftLogs account can read, so treat it like a password and regenerate it if it leaks. And
verifying the source is not the same as verifying the deployed bundle — if that distinction matters
to you, clone the repo and run it locally, which is a supported path and not a workaround.

## Signing in

You need a WarcraftLogs account, and — once, before the first sign-in — your own API client.

### Register your client

**This cannot be done for you, and that is not laziness.** WarcraftLogs meters its API per client.
A client id shipped with this app would give every visitor a share of one hourly budget, and the
first busy evening would exhaust it for everybody. Your own client gives you a budget nobody else
spends. It takes about a minute.

1. Go to <https://www.warcraftlogs.com/api/clients/> and click **Create Client**.
2. Name it anything. You will see the name on the consent screen when you sign in.
3. For the redirect URL, **copy the one the app shows you** — it renders the exact string it will
   send, with a copy button, next to this field. Matching is byte-exact, and a trailing slash is
   enough to break it — and at the root of a domain the slash _is_ the path, so it belongs there.
   (For reference: `https://windwalker-analyzer.pages.dev/`, or `http://localhost:4321/` if you are
   running it yourself.)
4. Tick **Public Client**. That is what allows PKCE, which is how a page with no backend signs you
   in without ever holding a secret.
5. Paste the **client ID** back into the app. Not the client secret — this app has no use for one,
   and the field will refuse it.

If sign-in comes back **"Client authentication failed"** or `invalid_client`, the redirect URL is
the thing to check, not the id. That error is what a URL mismatch looks like, and it names the wrong
culprit.

### Then sign in

Click **Sign in with WarcraftLogs**. You log in on WarcraftLogs' own page, it asks whether to let the
analyser read your logs, and you land back here signed in. This page never sees your password, and
what comes back is an access token that reads your private and archived reports as well as public
ones.

### Or bring your own token

If you already mint tokens, paste one under **Advanced: use your own access token**. Both kinds work:

```sh
curl -u '<client-id>:<client-secret>' \
  -d grant_type=client_credentials \
  https://www.warcraftlogs.com/oauth/token
```

A client-credentials token like that one reads **public, unarchived** reports only, so it is routed
to `/api/v2/client` and the page says as much. Worth knowing: a private report does not come back
refused, it comes back **not found** — identical to a mistyped code. A user token goes to
`/api/v2/user`, which is the endpoint that can read archived reports, and most reports older than a
few months are archived.

Tokens expire. When requests start coming back `401`, sign in again.

## Running it locally

Node 24 — the version is pinned in `.nvmrc`, so `nvm use` picks it up.

```sh
nvm use          # Node 24
npm install
npm run dev      # http://localhost:4321/windwalker-analyzer
npm run check    # astro check + tsc --noEmit
npm test         # vitest
npm run build    # static site into dist/
npm run preview  # serve dist/ as it will be served in production
```

The dev server serves under the `/windwalker-analyzer` base path, same as production, so links and
asset URLs behave identically in both.

### Environment

Environment is read two ways, and only one of them reads `.env`:

- **`PUBLIC_SPEC`** — the registry key of the spec a build defaults to — is read by the app as
  `import.meta.env.PUBLIC_SPEC`, Astro's `.env`-loaded channel. A local `.env` re-points
  `npm run dev` at another spec; the registered keys are `windwalker` and `elemental`.
- **`SITE_URL` and `BASE_PATH`** are read by `astro.config.mjs` from the real process environment
  (`process.env`), **not** from `.env` — export them in the shell instead (`SITE_URL=… npm run build`).

Copy `.env.example` to `.env` for the documented templates. `.env` is gitignored, so none of this
reaches CI — the deploy reads its environment from the workflow files, not from here.

## Deployment

Pushing to `main` publishes **both** sites from the same commit, through two independent runs:

| Workflow                                      | Cloudflare project    | `PUBLIC_SPEC` | URL                                     |
| --------------------------------------------- | --------------------- | ------------- | --------------------------------------- |
| `.github/workflows/cloudflare-windwalker.yml` | `windwalker-analyzer` | `windwalker`  | `https://windwalker-analyzer.pages.dev` |
| `.github/workflows/cloudflare-elemental.yml`  | `elemental-analyzer`  | `elemental`   | `https://elemental-analyzer.pages.dev`  |

Both are thin callers over `.github/workflows/deploy-cloudflare.yml`, which holds every step: `npm ci`,
`npm run check`, `npm test`, then `npm run build` and `wrangler pages deploy dist`. A build that fails
any check is not published. Pull requests run `.github/workflows/ci.yml`, which is the same commands.

One reusable workflow rather than two copies, because a copy is where the two drift and only one of
them would keep getting the fixes. Not a matrix over the two specs either: a matrix is one run
publishing both, so a re-run from the Actions tab re-publishes both, one failure marks the other red,
and the two would share a concurrency group — the queueing this repo went out of its way to get right
for a single site. Two callers, two runs, two queues (`cloudflare-pages-<spec>`).

The gates are deliberately spec-independent: `npm run check` and `npm test` cover every registered
spec in one pass, so a change that breaks the Elemental audit blocks the Windwalker deploy too. They
are one codebase and one report engine.

A new host has to be registered with WarcraftLogs as a redirect URI in its own right — OAuth redirects
back to `window.location` and WarcraftLogs matches the registered URI byte for byte, so sign-in on an
unregistered host fails with a message that blames the client id.

`site_url` is a required input of the shared workflow rather than a default worth trusting, because
`astro.config.mjs` defaults to the Windwalker domain. Today a wrong value there is latent rather than
broken: `base` is empty on Pages, so every asset URL is root-relative and nothing in the emitted HTML
names the host. It stops being latent the moment anything canonical is emitted — a `<link rel=
"canonical">`, an `og:url`, a sitemap — and a required input is cheaper than finding that out later.

Both go through `npm run`, never `npx <tool>`. `npx` downloads a tool that is not a declared
dependency, so CI can silently run a different version from the one on your machine — which is how
the first deploy failed, on a file that was correctly formatted locally.

It needs two repository secrets, under Settings → Secrets and variables → Actions:

| Secret                  | Where it comes from                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare dashboard → My Profile → API Tokens, template **Edit Cloudflare Workers**, or a custom token with the _Cloudflare Pages: Edit_ permission |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages, shown in the right-hand sidebar                                                                              |

Both projects share those two secrets — one Cloudflare account — which is what `secrets: inherit` in
each caller says.

The Pages project is created by the workflow if it does not exist, so a fresh account needs no
dashboard visit — only the two secrets. Each site's name and URL live in one place, the `with:` block
of its caller workflow; nothing about a project name is hardcoded in the shared steps.

To add a third spec's site: register the spec in `src/lib/spec/registry.ts`, then copy
`cloudflare-elemental.yml`, changing the four values in it (workflow name, concurrency group,
`project_name`, `spec`, `site_url`). `src/lib/spec/__tests__/registry.test.ts` reads the `spec:` values
back out of the workflow files and fails if one is not a key the registry answers — `DEFAULT_SPEC`
falls back to the first spec when `PUBLIC_SPEC` does not resolve, so a typo would otherwise deploy a
site that is branded and behaves as the wrong spec, with nothing in the pipeline going red.

If you would rather create it by hand, make it a **Direct Upload** project: the workflow uploads a
build it made itself, and a Git-connected project would build the site a second time on Cloudflare's
side.

Wrangler is a pinned dependency and is invoked directly rather than through
`cloudflare/wrangler-action`. The action looks for a local wrangler, rejects what it finds, and
installs its own — measured: 3.90.0, against a current 4.x.

The workflow deletes `src/pages/preview.astro` before building. That page is a development harness
that renders committed fixtures, and removing it also removes the only import of that data, so none
of it is bundled into the published site. It stays available in `npm run dev`.

The spec a deployment serves is set by `PUBLIC_SPEC`, passed down from the caller's `spec:` input, and
the registry's `DEFAULT_SPEC` reads it: the settings schema, the sections and the page branding all
follow the pinned spec. Every build still ships every spec's code, and the URL's own `?spec=` wins at
runtime — so a visitor handed an Elemental link on the Windwalker host still gets an Elemental report.
The pinning decides the default and the branding, not what is available.

`site` and `base` come from the `SITE_URL` and `BASE_PATH` environment variables, defaulting to the
Cloudflare Pages domain at its root. `.github/workflows/deploy.yml` publishes to GitHub Pages
instead and sets both, because a project site there is served under `/<repo>/` and an unprefixed
build 404s every asset. It is manual-only (`workflow_dispatch`): two hosts publishing the same
commit means two live copies, and only one of them can hold the redirect URI registered with
WarcraftLogs. It takes a `spec` choice input, defaulting to `windwalker` — but it publishes **one**
site whichever you pick, because a GitHub project site is `/<repo>/` and there is one repo, so a run
for Elemental replaces whatever it published last. Cloudflare is the path that serves both at once.

These are read from the workflow's own environment — a `.env` file never reaches the CI build
(see _Running it locally → Environment_).

**Moving the site means re-registering the redirect URI.** OAuth redirects back to
`window.location`, and WarcraftLogs matches it byte for byte; a URL that is not registered fails as
`invalid_client`, which reads as though the client id were wrong. See `docs/wcl-oauth.md`.

## Project layout

```
src/lib/game/            the game-object model: Ability, Aura, Gate, and the registry that indexes them
src/lib/analysis/        spec-agnostic primitives — auras, stacks, intervals, cooldowns, casts, damage
src/lib/spec/windwalker  the one spec: which ids mean what, and the analyse() that returns an Analysis
src/lib/wcl/             the WarcraftLogs GraphQL client; #graphql is the only request in the app
src/lib/types.ts         shared contract: the combat-log event union and the Analysis result
src/components/          the flow (token, report, fight, player) and the report shell
src/components/charts/   the visualisations, each taking an Analysis
src/layouts/ src/pages/  Astro shell — one page, the app itself is client-side
src/styles/global.css    the dark-only palette, as Tailwind v4 @theme tokens
src/generated/           API types, generated from schema/wcl.graphql — not hand-edited
schema/wcl.graphql       the WarcraftLogs schema, vendored so builds need no token
.github/workflows/       CI on pull requests, a Cloudflare Pages deploy per spec on main
```

Abilities and auras are modelled as objects with relationships rather than as loose spell-id
constants, and looked up through the registry — `abilityByCastId`, `auraById`, `variantOf`,
`isChannelTick`. That is what stops a channel tick being counted as a cast, or one of Re-Origination's
per-stat aura ids being silently dropped, which is where the bugs in this kind of code live. The
analysis primitives stay spec-agnostic because that is what makes them testable, not because a second
spec is planned.

The one type that is hand-written rather than generated is the combat-log event. `Report.events`
returns `[JSON]` in the WarcraftLogs schema, so codegen cannot describe it; it is a discriminated
union on `type` with narrowing helpers instead.

## Limitations

- **The energy-cap condition cannot be checked.** The Windwalker priority gates several casts —
  Fists of Fury above all — on "would this run me into an energy cap". That condition is **not
  recoverable from a WarcraftLogs report.** The log emits resource values on far too few events to
  reconstruct a continuous energy trace between them, and interpolating one would mean inventing the
  regen rate, the haste at that instant, and every Energizing Brew tick in between. So the analyser
  marks those casts unjudged rather than guessing: a channel reported as clean here may still have
  overcapped, and the report says so where it matters. Everything reported as a fault is a fault the
  log actually proves.
- Only Windwalker, only Mists of Pandaria, only `classic.warcraftlogs.com`.
- It reads one pull. It does not model gear, simulate alternatives, or compare you to rankings.
- It sees what the log recorded. A missing debuff on a target that was never in range looks the same
  as a missed cast.
