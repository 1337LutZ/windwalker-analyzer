# Project conventions

The rules this codebase is held to. They exist so that a change made by someone new looks like the
code already here, and so the decisions below do not get re-litigated in every review.

## Scope

Mists of Pandaria Classic. One API host, `classic.warcraftlogs.com`. **Two specs: Windwalker Monk and
Elemental Shaman.**

This section used to say "one spec, nothing else" and "do not add a `SpecDefinition` indirection". That
was the right instinct at the time and it is no longer the shape of the code: the second spec arrived,
and `SpecDefinition` is how it arrived. The rule it was protecting still stands, so here it is in the
form that survived contact with a second spec.

**The seam is `SpecDefinition`, and it is the only one.** A spec is one entry in
`src/lib/spec/registry.ts` plus one folder under `src/specs/`. Everything a caller needs about _a_ spec
hangs off its definition — `analyse`, `identify`, `score`, `weightsFor`, `wasteTone`, `settings`,
`colors`, `gcdMs`. Two files may name a specific spec: `registry.ts` and
`src/components/report/specSections.tsx`, which are the join points. Nothing else in `src/lib/` or
`src/components/` may, and

```
grep -rn "from '~/specs/" src/components src/lib --include=*.ts --include=*.tsx \
  | grep -v "specSections\|spec/registry\|__tests__"
```

is how you check. A hit is a leak: a spec-agnostic path that is secretly the shortest route to one
spec's engine, which compiles against one spec while reading as though it takes any.

**Still do not add an `Instance` union or a `switch` on expansion "for later".** One host, and the
second spec cost nothing in that direction — it needed a registry, not a matrix.

**And the original warning has a corollary worth more than the rule.** The expensive part of adding the
second spec was not the abstraction; it was the copying. Machinery that is genuinely class-agnostic got
re-implemented per spec — a stack walker, three interval helpers, four binary searches, the scorecard
builders, a chart skeleton written four times — and several copies carried the numbers while dropping
the comment that justified them, so the reasoning survived in exactly one place and never the copy.
Two of those copies re-introduced bugs the original's own comment existed to prevent. Before writing a
second version of anything, look for the first: `src/lib/analysis/`, `src/lib/score/`,
`src/components/charts/`.

## One component per file

A file exports **one** component, named the same as the file. A file that grows a second component
becomes a folder:

```
components/primitives/         not  components/primitives.tsx
  Section.tsx
  StatTile.tsx
  Bar.tsx
  DataGrid.tsx
  index.ts                     re-exports, so imports stay short
```

The `index.ts` barrel is for import ergonomics only. Never put logic in it.

Hooks follow the same rule: one hook per file under `hooks/`, named `useThing.ts`.

## Libraries — use these, do not hand-roll

| need                       | use                                                 | never                                                |
| -------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| interactive UI primitives  | `@base-ui/react`                                    | a hand-built modal, popover, select, tabs or tooltip |
| forms, settings, options   | `react-hook-form`                                   | ad-hoc `useState` per field                          |
| fetching, caching, retries | `@tanstack/react-query`                             | `useEffect` + `useState` fetch triples               |
| charts and timelines       | `apexcharts` via `react-apexcharts`                 | hand-built SVG charts                                |
| dates and durations        | `date-fns`                                          | manual `Date` maths                                  |
| numbers, percents          | `Intl.NumberFormat` behind helpers in `lib/format/` | inline `toFixed` scattered through JSX               |

Base UI is headless, which is the point: it brings the keyboard handling, focus trapping and ARIA
wiring, and Tailwind brings every pixel of the look. A modal that is not a Base UI `Dialog` is a
modal that will be missing focus management.

`Intl` needs no dependency, but it does need to be centralised — a formatter constructed inside a
render is rebuilt on every pass, and inconsistent digit settings across a page look like a bug.
Construct them once in `lib/format/` and export functions.

## Styling

Tailwind v4, **dark only**. There is no light theme and no toggle.

Use the semantic tokens from `src/styles/global.css` — `bg`, `surface`, `raised`, `line`, `ink`,
`ink-2`, `muted`, `brew`, `rune`, `kick`, `miss`, `track`, `band-warn`, `band-ok`. Do not introduce a
raw hex value: the palette was checked for colour-blind separation and contrast against a dark
ground, and an eyeballed addition silently breaks that.

Colour is named for what it _means_ — `brew`, `rune`, `kick`, `miss` — not for what it looks like, so
that a mechanic's colour stays consistent everywhere it appears.

Changing an accent means re-checking two numbers, not judging by eye:

1. **Contrast against `bg`** — at least 4.5:1, and aim well past it. A value that only just clears
   the threshold reads as washed out even though it technically passes.
2. **Colour-blind separation across all pairs** — the accents appear together in charts, so run
   `validate_palette.js "<hexes>" --mode dark --pairs all`. The obvious bright green/red pairing
   collapses to 4.6 ΔE under deuteranopia, which is why `kick` is teal.

## Type

Body copy is **16px minimum**. Below that it is a readability problem before it is a style choice,
and an input under 16px makes iOS zoom the page on focus.

Dense tables may drop to 14px (`text-sm`) and no further. If a table only fits by going smaller than
that, the table is wrong for the viewport — reflow it into cards instead, which is the rule above.

Do not use font size alone to express hierarchy. Weight, colour (`ink` / `ink-2` / `muted`) and
spacing carry it too, and they do not cost legibility.

## Layout

Mobile first, and genuinely: check **320px, 360px, 390px, 768px and 1440px** before calling anything
done.

The floor used to be 390px and that was the wrong number. A sweep of every section of every fixture at
exactly 390 came back clean, and 15px narrower an enchant's name was being _destroyed_ — 7px of it at
375, 22px at 360, 62px at 320, cut off inside an `overflow-hidden` grid with no scrollbar and nothing to
say it had gone. 390 was not a safe floor with margin under it; it was the exact width at which the
layout stopped being broken. 375 is an iPhone SE and a 12/13 mini, 360 is the commonest Android width
there is, and any 390 device is a 375 device the moment a classic scrollbar or a larger text setting
takes its 15px. So 360 is the narrowest width the design is _composed_ for, and **320 is a hard floor:
below 360 a layout may fold further than it does at 390, but at 320 nothing may clip, overlap or
scroll.** 320 is an SE 1st gen, a split-view pane, and a 390 phone at 120% text zoom.

**Headless screenshots lie about narrow viewports.** `chrome --headless --window-size=390,844` renders
at a wider layout viewport and clips the image, which is visually indistinguishable from horizontal
overflow — it will send you hunting for a bug that is not there. Measure instead: load the app in an
iframe of the target width from a same-origin page, so the layout viewport genuinely is that width, and
read the geometry from inside it.

**Read it per element, not per section.** `scrollWidth` against `clientWidth` is nearly blind to the
defect that actually matters. A section whose card grid is `overflow-hidden` reported `clientW === 343
=== scrollW` while a child inside it stuck 6px out and 7px of an enchant's name was being cut off: the
ancestor swallowed the overflow, so the page did not scroll and the section did not measure wide. **A
silent clip is worse than a visible overflow** — the reader cannot tell truncation-by-design from
content a layout bug destroyed. So walk every element, compare its bounding rect against its container's,
and separately flag every `overflow-x: hidden|clip` box whose `scrollWidth` exceeds its `clientWidth`.
Skip subtrees under an `overflow-x: auto|scroll` ancestor — a wide table or timeline is _supposed_ to
scroll inside its own container — and do not flag a box that is `text-overflow: ellipsis` +
`white-space: nowrap`, because `truncate` hiding text is the point of `truncate`.

Point it at **`/preview`**, not at the landing page: that is the only route that renders a real report
without a WarcraftLogs token, and it now carries both specs — four stored Windwalker analyses and three
Elemental pulls analysed at build time — so one pass over its fixture picker reaches every section
either spec ships, in both target readings: `cleave` is the only entry that detects multi-target, so it
is the only one that draws the per-target lanes. (`src` is relative to `BASE_PATH`: empty on the Pages
builds, `/<repo>/` on a GitHub Pages one.)

```html
<iframe id="f" src="/preview" style="width:390px;height:900px"></iframe>
<script>
  f.onload = () =>
    setTimeout(() => {
      const d = f.contentDocument.documentElement;
      out.textContent = `clientW=${d.clientWidth} scrollW=${d.scrollWidth} OVERFLOW=${d.scrollWidth > d.clientWidth}`;
    }, 2000);
</script>
```

Drop it in `public/`, screenshot it at a comfortable desktop size, read the numbers, then delete it.
The same page can list every element wider than the viewport, which names the offender instead of
leaving you to guess. Two details are load-bearing: pass `--hide-scrollbars`, or Chrome's classic
scrollbar makes a 390px iframe measure 375 and you will chase the wrong width; and **prove the
instrument before trusting a clean result** — append a 600px box and a 100px `overflow-x: hidden` box
holding a 400px child, confirm the sweep catches both, then remove them. A sweep that reports "nothing
overflows" because it silently measured nothing is the failure mode here.

When a narrow width needs a layout to fold further than 390 does, bound the change to that width rather
than restyling the common ones: an unconditional `flex-wrap` on a label/value pair breaks on the value's
_max_-content rather than on what fits, which restyled 22–58 folded card rows per fixture at 390 to fix
a 320px overhang. `max-[360px]:flex-wrap` fixes the same overhang and is provably identical at 360, 375,
390, 768 and 1440.

Dense tables must reflow into stacked cards or drop non-essential columns on a narrow viewport.
Horizontal page scroll is a bug. Tap targets are at least 44px.

Charts get one specific warning: **never put column labels in SVG text**. SVG text scales down with
the viewport, so at a phone width 11px labels render around 6px and adjacent columns collide. That
already happened once. Anything with columns is a CSS grid.

## Auth and secrets

The app uses the **PKCE code flow** — see [wcl-oauth.md](./wcl-oauth.md). There is no backend, so
there is nowhere to keep a secret and nothing that could hold one.

- The `client_id` is public — that is what PKCE is for — but it is **not** committed and **not** a
  build variable. WarcraftLogs meters per client, so a shared id pools every visitor into one hourly
  quota, and one build serves every visitor. Each person registers their own and pastes it in.
- The client id is the one thing kept in `localStorage`. It is configuration, not a credential, and
  re-pasting it every tab would be hostile for no security gain. It may be rendered back on screen.
- The client **secret** is for other flows. This app never uses it and must never contain it. The
  client-id field refuses a non-UUID paste for exactly this reason — the registration page shows the
  secret next to the id, and a secret typed into the wrong box would otherwise be stored.
- The access token lives in `sessionStorage` and dies with the tab. Never `localStorage`, never a
  cookie, never a URL query parameter, never a log line, never rendered as readable text.
- The token is sent to `warcraftlogs.com` and to nothing else. A production CSP enforces this rather
  than relying on the README's word.
- **One third party is contacted: `wow.zamimg.com`, for spell icons, images only.** It is pinned to
  `img-src` in the CSP, so no script can reach that host. Icon _names_ and spell names are resolved at
  build time by `scripts/build-spell-map.mjs` into `src/generated/spells.json` — deliberately not at
  runtime, which would add a Wowhead API call per spell from every visitor. If you add a third party,
  the README's privacy section and the in-app `app.privacy` string are both claims about this and
  both have to be corrected in the same change; they were, when the icons went in.

## Game data

Spell names, icons and enchants come from the [wowsims-mop](https://github.com/wowsims/mop)
simulator's `assets/database/db.json`, which is the project's source of truth for the game. Two
scripts read it into small committed maps:

- `scripts/build-spell-map.mjs` → `src/generated/spells.json` (id → name, icon)
- `scripts/build-enchant-map.mjs` → `src/generated/enchants.json` (effect id → name, icon, spell id)

**The maps are committed and the build never fetches them.** `npm run build` must not reach the
network: the site deploys from GitHub Actions, and a build that downloaded an 8 MB database could fail
for reasons unrelated to the change being deployed. Committing the output also makes upstream drift
reviewable — regenerating produces a diff, so a renamed spell shows up in a pull request rather than
silently changing what the page says.

Refreshing is a deliberate act, not something a build does:

```sh
node scripts/build-spell-map.mjs --check   # is the committed map behind upstream?
node scripts/build-spell-map.mjs           # refresh it, then review the diff
```

The database models what the _simulator_ models, which is about 40% of the ids a real log contains —
it has no Transcendence, no Zen Meditation, no boss abilities. Wowhead's `mop-classic` tooltip
endpoint fills those in at generation time, so it remains a build-time dependency and cannot be
dropped. Each id is asked for exactly once, ever: entries already in the map are reused.

## The analysis engine

`lib/analysis/` is spec-agnostic pure functions. It must not import the Windwalker spec.

`lib/game/` models abilities and auras as objects with relationships; `specs/windwalker/lib/index.ts`
declares them. Look ids up through the registry — `abilityByCastId`, `auraById`, `variantOf` — rather
than comparing bare numbers, because the registry is what refuses to build when two objects claim the
same id.

**The comments in the engine are load-bearing.** Every one of them marks a case where the obvious
implementation produced a confidently wrong number against a real log: the brew bank drain logged
before its cast, a buff stamped before the ability that applied it, a channel's ticks logged as
casts, an aura window that is not the snapshot's lifetime. Do not "simplify" them away. If one looks
wrong, prove it against a real fight first — every one of them is there because a number disagreed
with reality.

## Copy, and how a report says anything

**No English sentence belongs in a component.** Copy lives in `src/locales/en/`, split into two
namespaces: `report` for the analysis, `ui` for the shell. A section asks for its own wording by
name and passes the numbers.

```tsx
const { t, verdict } = useReportCopy(analysis);
<Prose>{verdict('tigerPalm', { casts, onProc, refresh, wasted })}</Prose>;
```

**Which sentence comes back is decided by `lib/score`, never by the component.** Every graded
section has `verdict_good` / `verdict_ok` / `verdict_bad` / `verdict_none`, and the grade comes from
thresholds in each spec's own `specs/<spec>/lib/score.ts` — each of which carries the reasoning that put it where it
is. This is the enforcement mechanism for the honesty rule below: a component _cannot_ hard-code a
finding, because it never holds a sentence to hard-code.

`verdict_none` is not a fourth grade. It means the pull could not answer the question — no procs
fired, no brew was spent — and a pull that never offered the chance has not failed to take it.

**Numbers in sentences go through the JSON, never through a helper at the call site.** Pass the raw
number and let the copy format it: `{{rate, percent}}`, `{{avg, decimal}}`, `{{seconds, seconds}}`,
`{{ms, clock}}`, `{{n, integer}}`, `{{n, compact}}`. Those formatters are the same `lib/format`
helpers the tiles use, registered on i18next's formatter service. Formatting inside a sentence is
what produced `averaging 9.714285714285714 stacks` next to a tile reading `9.7`.

A value in a table cell, an axis label or a KPI tile is not a sentence — format those with the
helpers directly.

**Pluralise with `count`.** i18next resolves `_one` / `_other`, and combines them with the grade
context (`verdict_bad_other`). Any string with a number in it needs both forms; `1 stacks` shipped
once already.

**Ability names stay out of the locale.** WarcraftLogs returns them localised in `masterData`, and a
second table here would drift from the one the API hands us.

Two tests guard all of this and both must stay green: `lib/i18n/__tests__/keys.test.ts` fails if a
component asks for a key that does not exist (a missing key renders as its own key path rather than
throwing, so nothing else would catch it), and `specs/windwalker/lib/__tests__/score.test.ts` asserts the
thresholds actually separate three real captured pulls — a grading scheme that paints every log the
same colour passes any test written around it and tells a reader nothing.

## Honesty in output

Never hard-code a finding into report prose. A sentence describing one log's pattern as "bimodal"
once printed on every later report regardless of its data. Derive the claim from the numbers or omit
it.

Where the log cannot answer something, say so in the UI rather than implying a clean verdict. The
rotation's energy conditions are the standing example: WarcraftLogs emits too few `resourcechange`
events to rebuild an energy curve, so a channel marked "ok" may still have overcapped.
