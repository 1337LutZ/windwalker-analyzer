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
`src/components/charts/`, `src/components/rotation/`.

The rotation folder is the most recent instance and the clearest one. Three specs answered "how is a
priority list drawn" three ways — a flowchart filed under the Windwalker, a hand-rolled column of
bordered cards under the Elemental, and nothing at all under the Protection — so the third spec had
nothing to reach for and the second had a drawing that could not show a fork. The chart is shared now,
and the copy convention with it: every rung of every spec reads `rotation.entry.<key>.{name,test,why}`
with `rotation.gate.<key>` for its chip, and the argument for that choice is in
`src/lib/view/rotationFlow.ts`.

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
scroll.** 320 is an SE 1st gen, a split-view pane, and a 390 phone at 120% text zoom. Two of those three
are measured and the third is argued from the shape of the code — see _What the sweep does not measure_
below, because a rule you cannot check is a rule that quietly stops being true.

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
`white-space: nowrap`, because `truncate` hiding text is the point of `truncate`. Exclude `.sr-only`
for the same reason: it is a 1px box that hides its text on purpose, and at 768 and above — where the
`md:` tables render and each one carries a `<caption class="sr-only">` — leaving it in reports 9 to 11
phantom clips per fixture, of 176 to 1345px each. A sweep that cries wolf on every width is as useless
as one that measures nothing, because you stop reading it.

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

### What the sweep does not measure

**It answers _clips_ and _scrolls_. It does not answer _overlaps_, and neither does anything else.** No
test can: the suite runs under `environment: 'node'` with no jsdom and no browser, so a component test
renders to an HTML string, and a string has no boxes. Nothing in the repo runs the sweep either — it is
a page you write, read once and delete.

Overlap is the third of the three that is hardest to eyeball, so the reason it is left unmeasured has to
be better than "it is hard". It is this: **normal flow cannot overlap.** Two boxes only land on top of
each other if one of them is taken out of flow or displaced, and in this tree that is a countable set.

- **One negative margin in the whole of `src/`**: `-mb-1.5` on a gate pill in
  `specs/windwalker/components/rotation/FlowNode.tsx`. Every other `-m…-` a grep turns up is
  `scroll-mt-14`, a scroll anchor, which moves nothing on screen.
- **One transform outside a chart that _places_ anything**: the `-translate-x-1/2 -translate-y-1/2`
  that centres `primitives/DialogShell.tsx`. This bullet used to say "one transform outside a chart"
  full stop, which was wrong as a list while right as an argument, and a reviewer checking the list is
  the person the bullet is for. There are six more, and every one of them turns a glyph on its own
  centre or scales a box by a percent or two in place: the disclosure chevrons in
  `report/SectionNav.tsx` (`rotate-90`/`rotate-0`), `report/FightSelector.tsx`,
  `auth/ClientIdPanel.tsx` and `auth/ManualTokenForm.tsx` (all `rotate-180`), the press feedback on
  `sections/CastLog.tsx` (`scale-[0.99]`) and `DialogShell`'s own enter/exit `scale-[0.98]`. A rotation
  about the centre of a 12px box and a 1% scale cannot reach a sibling, so none of them adds a way for
  two boxes to land on top of each other — which is the claim this section is making. Find them with

  ```
  grep -rnE '(translate|rotate|scale|skew)-' src --include=*.tsx --include=*.ts | grep -v __tests__
  ```

  and the chart internals it also returns — `charts/CastTimeline.tsx`, `charts/ResourceTrack.tsx` and
  the `rotate-45` diamonds in `specs/windwalker/…/rotation/FlowChart.tsx` and `FlowNode.tsx` — are the
  exempt set named in the bullet below.

- **`absolute` / `fixed` in ten files, and they divide cleanly.** Six are chart internals —
  `charts/CastTimeline.tsx`, `charts/ResourceTrack.tsx`, `charts/TrackLabels.tsx`,
  `charts/ScrollableTrack.tsx`, `charts/ApexChart.tsx` and `specs/windwalker/…/rotation/FlowChart.tsx` —
  where marks are placed by `left: <pct>` along a shared track and **two marks on top of each other is
  the drawing, not a defect**: presses a second apart are supposed to look a second apart. The other
  four exist to cover what is behind them — the item level badge and gem strip in
  `primitives/ItemIcon.tsx`, the modals in `primitives/DialogShell.tsx` and `sections/CastLog.tsx`, and
  the `fixed` bar in `report/StickySelectionBar.tsx`.

So a pairwise bounding-rect intersection pass over `/preview` — which the sweep could run for nothing,
since it already walks every element's rect for the clipping check — **is red on every fixture from its
first run, and every hit is intended.** Exempting the chart subtrees and the overlays to quiet it leaves
it looking at a flow layout, which is the thing that cannot overlap. That is the same "cries wolf"
failure the paragraph above names, reached from the other side: a sweep whose every finding is by design
is as useless as one that finds nothing.

**What that leaves you to do.** At 320 the promise this doc can hold you to is _clips_ and _scrolls_, and
the sweep measures both. Overlap is held by the shape of the code, so the thing to check in review is not
a number — it is whether a change **adds to the list above**. A new `absolute`, a new negative margin or
a new transform outside a chart is where an overlap at 320 would come from, and it earns the extra look.
Anything laid out in flow does not.

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

**The tool is called the `analyzer`.** One noun, one spelling, z — `app.title` renders it at the top of
every page and a sentence underneath must not contradict the heading. Verbs stay British: analyse,
analysed, analysis. Never "this report" or "this page" for the thing doing the work.

**A refusal carries no figure.** Everything else in this report argues from numbers. A sentence saying
the analysis cannot stand behind a pull must not: the reader has just been told the verdict is void, and
a measurement invites them to argue with its size — _is 43 seconds really enough to spoil this?_ —
instead of reading it. Measure it, record it on the finding, print it in the research script, and keep
it out of the sentence.

**A refusal says what it cannot do, then what is still worth reading.** Two sentences. The first names
what the player was doing and the consequence; the second offers what the findings are still good for
and where the tool stops. Fill in the blanks and stop:

> You were assigned _belt duty_, so the analysis can't score you properly for optimal performance. You
> can use these findings to improve your _belt play_, but the analyzer is not optimised for this.

**A family of findings in one slot shares its closing sentence.** Different facts open differently and
close identically. Three callouts written separately read as three voices — one naming the tool, one
pointing at a chart, one reciting a percentage — and a reader meets exactly one of them, so the
inconsistency is invisible until somebody reads all three.

`specs/__tests__/readerVoice.test.ts` gates the first two: no `analyser`, and no `{{` in a family listed
in `REFUSAL_FAMILIES`.

Two tests guard all of this and both must stay green: `lib/i18n/__tests__/keys.test.ts` fails if a
component asks for a key that does not exist (a missing key renders as its own key path rather than
throwing, so nothing else would catch it), and `specs/windwalker/lib/__tests__/score.test.ts` asserts the
thresholds actually separate three real captured pulls — a grading scheme that paints every log the
same colour passes any test written around it and tells a reader nothing.

**How the copy is meant to sound is written down.** `docs/report-register.md` is the record: how
this project's copy is written, captured 2026-08-28 from 11 short reader-facing pieces the author
wrote, plus 4 passages the same author rewrote by hand during voice calibration. It carries the
two-sentence fault-then-mechanism shape, praise that grades its verdict to the evidence and never
appends advice, disagreement that hedges the observation but never the correction, argument that
leads with the Sim or the rotation as the authority, and no first person anywhere. Read it before
writing a string.

It was extracted from a gitignored working directory (`.unslop/voice/analyzer/`, which holds
personal writing samples) so that this file cites a path a clone has, and it is the record if the
two ever disagree.

**An earlier audience register was removed on 2026-08-28.** It measured 18,889 words of third-party
MoP guide prose across 12 pages and 6 authors, and several rules below were argued against it. This
project no longer grounds its copy standard in other people's writing. Where a rule below once cited
that corpus, it now stands as a project decision or on `docs/report-register.md`, and the change is
noted at the rule. Nothing was relaxed; only the justification moved.

**Abbreviations a contributor meets in the code.** Reader-facing shorthand is tabled in
`docs/report-register.md`; this is the engineering set, which appears in source and comments and was
defined nowhere until now.

| Short  | Expansion             | Where                                                  |
| ------ | --------------------- | ------------------------------------------------------ |
| `APL`  | action priority list  | `src/specs/*/lib/apl.ts` and the `apl` skill, 116 uses |
| `WCL`  | Warcraft Logs         | the fetch and parse layer, 105 uses                    |
| `GCD`  | global cooldown       | 311 uses in `src/`, and 7 in shipped copy              |
| `DoT`  | damage over time      | 7 uses, mostly Flame Shock handling                    |
| `RPPM` | real procs per minute | proc-rate model, `docs/item-effect-sweep.md`           |
| `ICD`  | internal cooldown     | proc gating                                            |
| `AP`   | attack power          | scaling maths                                          |

Stat names are written in full and capitalised in copy — Haste, Crit, Mastery, Expertise, Agility —
and are not abbreviated to `AP`/`SP` outside code.

`docs/labels-and-figures.md` is tracked beside it and is the narrower rule: a label that names a number
is read as one phrase with it, so its form follows the figure's shape rather than the voice. A
percentage takes an instruction; a count or a duration takes a noun naming what is counted. Getting it
wrong reads as a wrong figure rather than as bad writing, which is why it is written down at all —
`components/sections/Scorecard.tsx` cites it and `scorecard.test.ts` guards it.

The other half was `.claude/skills/tone-of-voice/SKILL.md`, the universal layer — the rules that stop
prose reading as machine-made. **That skill has been removed (2026-08-28), and every `SKILL.md §n`
citation in this file and in `readerVoice.test.ts` now points at a file nothing has.** This costs
less than it sounds, and the reason was recorded before the removal: each `§n` is **provenance for a
rule that is stated in full where it is cited** — where the rule is overridden, the override and its
reason are here; where it is kept, the rule is here. None of them was ever an instruction to go and
open a file, so they survive as history rather than as dangling pointers. Do not chase one; read the
rule beside it.

What replaced it is executable rather than advisory. The universal layer's job — catching prose that
reads as machine-made — is now done by the `unslop` skill's scanners (`banned_phrase_scan.py`,
`structure_scan.py`, `readability_metrics.py`), which fail loudly instead of asking to be remembered.
`unslop` is vendored and gitignored by the same rule the old skill was, with `skills-lock.json`
tracked so a clone can reinstall it.

The measurements are the opposite of procedure, because a number cannot be restated without becoming
a claim nobody can check, which is why `docs/report-register.md` is tracked and the procedure is
not. See the note in `.gitignore`, and the same split in `docs/item-effect-sweep.md`.

**Second person throughout. Never `we`, `us`, `our` or `I`.** A report describes a pull; it is not a
party to it. `docs/report-register.md` §4 measures the same thing from this project's own writing:
zero first-person tokens in 326 words, and authority carried by the Sim or the rotation rather than
by a narrator. Banning editorial `we`/`our` goes further than that record can prove, so it stands as
a project decision, and the reason has to sit next to the rule or it will be relaxed: a report
describes a pull to a reader, and a narrator in it is a person the reader did not ask about. "One
use drained its pool completely, which tells us the pool's size" is the shape to watch for — a
narrator in a sentence that only needed a number.

**The em-dash is retired from reader-facing copy, and that reverses a standing override.**
This file used to keep it against both halves of the standard, on the argument that an appositive
defines a measurement inside the sentence that used it. `docs/report-register.md` §7 records that
this project's author does not use one in their own prose, restructuring the sentence instead, and
on 2026-08-28 that record won: all 288 in `src/locales/en/report.json` and all 24 in `ui.json` were removed, along with the
two in component code that assembled copy (`StatTile`'s label/caption join and `FlameShockDepth`'s
reason row, both now commas). The census above prints 1, which is the lone `—` in
`energizingBrew.cells.noReadings`: a table's no-value glyph, not prose, exempt by the same rule that
exempts labels in `docs/labels-and-figures.md`. The dash stays available in source comments and in
this file, where no reader meets it, and there it is still bounded. **Ceiling of two in one sentence.** Nothing reaches three today, and a sentence that wants three is two sentences; `proseDashes.test.ts` reads that ceiling out of this paragraph and enforces it over every docblock in the tree.

**The ceiling reaches the docblocks too, and "nothing reaches three today" was only ever measured
against the copy.** Most of this repository's prose is in comments rather than in `report.json`, written
in the same voice by the same hands, and the reason the override gives — an appositive defines a
measurement inside the sentence that used it — is an argument about explanatory prose, which is what a
docblock is. Measured across 461 source files and about 23,800 comment sentences, **six reached three or
four**: `FlameShockUptime.tsx`, `ascendance.ts`, `index.ts` twice, `score.ts` and `RushingJadeWind.tsx`.
Each is two sentences now, or has one pair turned into parentheses. `src/__tests__/proseDashes.test.ts`
is the gate, and it reads the ceiling out of the sentence above rather than carrying its own copy of it.

**Sentence rhythm is a target, not a gate.** Measured across the prose leaves of `report.json` —
counting only strings of eight words or more, since a header, a chip and a table cell are not
sentences — the median is 17 words and about a fifth run past 25; the census below prints both exactly. `SKILL.md` §1 asks for a median of
11 to 14 with about 15% past 25. Write new copy to that; let the existing copy converge as sections
are touched. No gate, because a gate's honest floor is today's number, which makes it a budget rather
than a standard, and because it could not tell a 40-word sentence that earns its length from one that
does not.

**"Write new copy to that" did not hold, and the eleven strings written after this paragraph are the
evidence.** Measured with the block below, they came in at a median of 22 against the 17 of the file
they joined — one of them a single 54-word sentence — so the copy written to the standard was worse
than the copy the standard was written about. Nine were split rather than cut, and the pool now reads
median 11 with nothing past 25. **Splitting, not trimming, is what moved it**: every one of the nine
was carrying an argument that a shorter sentence would have dropped — a refusal to call one brew good
or bad, three snapshot facts a single sentence had been collapsing, a "no fault here" clause the
un-zeroed arms had been printing as "0 times". A sentence you cannot shorten without weakening is a
result, not a failure; the target is a short median with a long tail, and capping everything at 25
would have produced the uniform rhythm this file bans elsewhere.

**Every locale number in this document comes out of one block, and it is this one.** They used to come
out of four separate measurements taken on four different days, which is how the em-dash count above
was 270 against a tree holding 257, and how the density census further down was still describing the
copy as it stood before "split the longest notes" landed. One block, run from the repo root, so the
next reader re-runs the whole set rather than the one number they came to check:

```python
# python3 - <<'EOF'
import json, re
leaves = []
for f in ('report', 'ui'):
    d = json.load(open(f'src/locales/en/{f}.json'))
    def walk(n, p):
        if isinstance(n, str): leaves.append((f, p, n))
        elif isinstance(n, dict):
            for k, v in n.items(): walk(v, f'{p}.{k}' if p else k)
    walk(d, '')
words = lambda v: len(v.split())
prose = [(f, p, v) for f, p, v in leaves if words(v) >= 8]

# per-string density, both files
L = sorted(words(v) for f, p, v in prose)
n, total = len(L), sum(L)
pct = lambda k: L[int(n * k)]
top = L[int(n * .91):]
print(f'both files: {len(leaves)} leaves, {n} prose, {total} words')
print('  words/string — median', L[n//2], 'p75', pct(.75), 'p90', pct(.90),
      'p95', pct(.95), 'p99', pct(.99), 'max', L[-1])
print(f'  longest 9% carry {100*sum(top)/total:.0f}% of prose words')

# sentences and punctuation, report.json only
rep = [v for f, p, v in leaves if f == 'report']
rp = [v for f, p, v in prose if f == 'report']
S = [s for v in rp for s in re.split(r'(?<=[.!?])\s+', re.sub(r'\{\{[^}]*\}\}', 'X', v)) if s.strip()]
past = sum(1 for s in S if words(s) > 25)
em = sum(1 for s in S if '—' in s)
print(f'report.json: {len(rp)} prose leaves, {len(S)} sentences')
print(f'  median {sorted(words(s) for s in S)[len(S)//2]} words,'
      f' {past} past 25 ({100*past/len(S):.1f}%)')
print(f'  em-dashes {sum(v.count("—") for v in rep)},'
      f' in {em} sentences ({100*em/len(S):.1f}%)')
for name, ch in (('straight apostrophe', "'"), ('curly apostrophe', '’'),
                 ('straight double', '"'), ('curly double', '“”')):
    print(f'  {name}: {sum(1 for v in rep if any(c in v for c in ch))} strings')
# EOF
```

**This is the one place in this file that carries these figures, and that is deliberate.** They were
restated in three passages and the three drifted apart: the em-dash count read 270 here, 257 in the
tree and 240 in `readerVoice.test.ts`, and the density tail went stale against a commit that split the
longest strings. A measurement written down four times is four things to update and three that will
not be. The arguments above now cite this block instead of repeating it, which is the same rule the
copy itself follows — say it once, outside the arms.

<!-- census:figures — every number in the paragraph below is asserted against this tree by
     src/lib/i18n/__tests__/conventionsCensus.test.ts. Re-run the block above and paste the whole set
     back inside these two comments; changing one figure by hand only moves the drift somewhere else. -->

As of the fight-audit split, it prints 1781 leaves, 845 prose, 26,266
words; median 27, p75 41, p90 61, p95 70, p99 102, max 158; longest 9% carry 23%; report.json 767 prose
leaves, 1,361 sentences, median 16, 242 past 25 (17.8%), 1 em-dash in 0 sentences (0.0%);
72 / 30 / 1 / 2 on the quote lines.

Eight leaves and three sentences, the smallest block to move this census in some time: six column
headings, a table caption and one line of prose, added when the Method section's per-encounter figures
grew a give-or-take beside each fight. Headings are one or two words, so they lift the leaf count without
touching the median string length or any of the percentiles — which is what a table of labels should do
to a corpus, and a useful contrast with the rotation pass above it.

Two leaves and no prose at all in the pass after that: `app.toCompare` and `app.toReport`, the header
link each of a spec's two pages carries to the other. Both are three-word button labels, so they lift the
leaf count and touch neither the prose count nor any percentile — the same signature the table of column
headings above has, and the reason the two counts are kept apart. The pair also has to stay spelled out
at the call site rather than reached through the function that picks the address, because `keys.test.ts`
reads copy off a literal inside `t('…')` and would have deleted both as copy nothing asks for.

One leaf and thirteen words in the pass after that, when the analysis mode joined the target mode on the
sticky bar. The block control's hint is split around a link and cannot be reused by a popup that closes on
the next click, so the menu states the same choice in one unlinked sentence of its own. That is the whole
cost of the control: both triggers name themselves out of copy that already existed — `targets.label` was
already "Target mode", which is what the bar now shows where the row can afford it — so a second menu
arrived for one string.

Five leaves and no net words in the pass after it: the analysis mode's two buttons, its label, and a
sentence split in two around a link. The first draft of that sentence was two hints of about forty words
each, one per mode, spelling out what each reading does to the report. They were replaced by one line that
names the choice and links the word `Parsing` to the article the exemptions are transcribed from. The five
leaves are what a control costs; the word count came back to where it started, because a reader who can
follow a rule to its source does not also need it paraphrased.

The word count fell by 29 in the same pass, and the reason is worth keeping. The dialog's opening
paragraph had grown to four sentences describing its own picture — what the bars were cut at, what a wide
middle meant, how thin the thinnest cell was — most of which the table beneath it already said in
columns. It says what ok and good are and when the figures were refreshed. Prose that narrates an
adjacent table is the most reliable kind of bloat this corpus grows, because each sentence looked
justified when it was added.

**The em-dash count did not move at all, and that is the interesting row.** It is 292 either side,
across 55 more sentences, so the share carrying one fell from 20.5% to 19.6% — the new copy was written
without reaching for the mark, and the ceiling of two per sentence is the reason. The straight
apostrophe line is the other visible move, 62 to 72: the Paladin's own buttons are Avenger's Shield and
Light's Hammer, and the ten new strings that name them follow `priority.rule.*`, which already spells
both with the straight mark.

The same pass renamed the Elemental's `rotation.rule.*` onto `rotation.entry.*` without touching a
word of it, so the migration itself is worth nothing on any line here.

Two further blocks landed alongside that one and are counted here for the first time. The **compare
page** added a `compare` family to `report.json` and nine shell keys to `ui.json` — 55 leaves and 592
words, the largest single addition either file had taken. The **elixir weave** added a section of its
own: a heading, an intent paragraph, three tile labels, four chart keys, the two-branch findings and a
HOW TO card for the monk who has never done it.

**Neither moved the em-dash share in the direction a reader would guess, and for the reason the
paragraph above gives.** Both were written under the ceiling of two per sentence, so the count barely
moves while the sentence total climbs, and the share falls out of the denominator rather than out of
any decision about voice.

Thirteen leaves and 105 words in the pass that put the pull's geometry behind a button. The **fight
replay** is one `summary.shape.replay` family: a button, a dialog title and its opening line, the label
over the mode chip, a clock, a scale, four control names, a chart description, a note and a line for the
pull that has no track to play. Nine of the thirteen are one or two words — the labels a control needs —
and only four are prose, which is why the leaf count moves three times as far as the prose count and the
median string length does not move at all. It is the same shape the per-encounter table made two passes
above: a corpus takes on labels far more cheaply than it takes on sentences. The thirteenth is `Close`,
and it arrived a step later than the rest: the dialog went full-screen, which takes the backdrop away, and
a dialog with nothing to click past has to carry its own way out. Two more followed on the same terms —
`You`, which names the dot on the map, and one sentence for the pull that held a single shape the whole
way and therefore draws no chart. That last one is the only prose in the family after the note, and it is
the pass's one real reminder that a section which refuses to draw still has to say something. `At` is the
thirteenth and the shortest string in the family — one word, labelling the clock on a hovered mark — and
it arrived when the map stopped using the browser's own tooltip and started drawing the report's. Three
more came with the red mark on a body the player hit — a label and the two words it takes — and one
sentence was added to the note, which is the only string in the family to have grown twice. Both times
for the same reason: the map keeps learning to say something a reader would otherwise have to infer from
a colour. The last two are the playback speed's label and the `{{rate}}×` its four switches are drawn
from — two leaves for a control with four positions, which is what a formatted label buys over four
spelled-out ones. The note took its third sentence in the same pass — the ring around the player — and
that is what moved p95 by a word: it is now the second-longest string in the family, and the family is
small enough for one sentence to shift a percentile.

**The note is the one long string, and it is long on purpose.** A replay that draws a dot where the log
last saw someone invites two wrong readings — that a missing enemy was not there, and that a short
distance means the player could reach it. Both are answered in that one sentence rather than left to a
reader to discover, which is the trade this corpus makes every time a picture can be misread: the caption
carries the caveat, and the picture stays uncluttered.

No new leaves at all in the pass after that, and fifty-seven words: three existing strings grew a clause
when the exemption moved from the raw three-or-more count onto the pull's own segments. Each of the three
AoE notes had to stop saying "the ones with three or more enemies up", because the greyed stretches now
include the ones no single count held long enough to name. That is the signature of a _meaning_ change
rather than a feature: the leaf count is flat, the prose count is flat, and p99 moves seven words because
three of the corpus's longest strings each took one more clause.

Two words and nothing else in the pass after that, which is the smallest this census has ever moved.
An unslop rewrite of `ui.json` repaired two defects and both cost a word: `app.moved.body` said the
analyser "serves both" its addresses when `src/specs/` holds three, and `app.intro_protection` read
"the attack power being hit paid you", which parses as a noun phrase until "paid" forces the sentence
open again. No leaf, percentile or em-dash figure moves, because neither repair added a clause. It is
the one shape this census can show that a feature never makes: prose changing without the corpus
growing.

**A deliberate compression pass, and the first entry here that removed prose rather than adding it.**
The 45 `intent` strings were rewritten to fold their teaching sentence into the rule it supported:
542 words out of the file, the leaf count untouched because no key moved. It shows up in three rows
at once — p75, p90 and p95 all fall a word or three, while the median holds at 27 and `max` does not
move at all, because the cut came out of the long middle rather than off either end. The em-dash
count falls with it, 304 to 288, for the reason the row above gives: the clauses that carried the
dashes were the ones folded away.

**Three cuts were reverted by tests rather than by judgement, and that is the useful part.**
`casts.intent` had to keep "the time you spent on a target" because a figure elsewhere reads
"31.6 casts per minute of the time you spent on a target" and the two are quoted against each other.
`lightningShield.intent` had to keep "both are hard numbers and not preferences" verbatim, because a
softened version would still satisfy the assertion that names seven and six. `fistsOfFury.intent`
lost the word "priority" from "priority list" and immediately tripped the guard against naming this
project's own model to a reader. Compression finds the copy that other copy depends on, and only the
guards know where it is.

**A sweep for length across both files, and the row to read is `max`.** Fifty long strings were
rewritten to fold their explanatory half into the rule it supported: the `intent` family, the rotation
list's `why` rungs, the settings hints, the sampling notes and the per-boss measurement notes. It took
about 1,100 words out. `max` falls 204 to 191 and p99 falls 117 to 110, which is the shape a length
pass makes: the longest strings lose most, the median does not move at all, and the leaf count cannot
move because no key was added or removed.

**The yield was 4 to 22 percent, not the 35 to 45 the pass set out to find, and that is the finding.**
The `intent` family gave 22%: those strings opened with a teaching sentence that could fold into the
rule underneath it. The per-boss `fight.note.*` records gave 4%, because what looks like length there
is a list of measurements a rejected rule was argued against, and the settings hints gave 4% because
they are rules with their numbers attached. What remains in this corpus after the scaffolding comes
out is facts, and the only way past that figure is to delete some. That is a product decision about how
much the report explains, not a copy edit, and it is not recorded here as one.

**A second sweep, run against four decisions rather than a target percentage, and it cleared the bar
the first one could not.** The first pass asked for 35 to 45 percent and returned 4 to 22, because what
was left after the scaffolding was facts. So the question was put back as four choices about which
_kinds_ of fact to drop: the reasoning behind each settings default, the comparison clause on each
rotation rung, the mechanism behind each sampling caveat, and what to do with the per-boss audit
records. Three were cut; the fourth is going behind a disclosure rather than being deleted, because the
evidence for a rejected lockout rule is the only thing that makes the rule checkable.

The hints and caveats gave 31%, the rotation rungs 19%. Together with the first pass the corpus is down
about 1,700 words, and the median finally moves: 27 to 26, with p75 43 to 41 and p95 74 to 71. The
first sweep only touched the tail; this one reached the middle, which is what dropping a category of
content does rather than tightening sentences.

**One term collision was settled as a side effect.** `energy.resolution` said WarcraftLogs "stamps a
reading onto events rather than onto a clock", where its three sibling strings all said "timer" and
every other `clock` in the file is the i18next format token two keys away. The rewrite replaced the
clause, and `readerVoice.test.ts`'s model-word census caught the word going quiet and now records why.

**Seven leaves added on purpose, and `max` falls 191 to 158 because of it.** Six per-boss notes
carried their own measurement inline: the pull counts, the press rates either side of a window, the
comparison that rejected a candidate rule. That evidence is what makes a lockout decision checkable
later, so it was not cut. It moved to a `fight.audit.*` family behind a `<details>` in `FightRules`,
with `fight.auditTrigger` as the summary, and the note above it keeps the verdict alone.

This is the one entry here where the leaf count rising is the improvement. `immerseus` went from 191
words in front of every reader to 45, with the other 146 one click away; p99 falls 110 to 102 and the
longest string in the tree is now 158 rather than 191. Nothing was deleted. Prefer this shape over
cutting whenever the length is evidence rather than scaffolding: the page gets shorter and the
argument stays.

The straight-apostrophe line is the one that did move: 71 to 74, from a single contraction appearing
three times. Worth knowing which line a family lands on, and this one lands there because a refusal is
the place the corpus talks to the reader most directly — _can't_, not _cannot_.

<!-- /census:figures -->

**Those figures are checked now rather than trusted, because "re-run it" was an instruction and
instructions do not run.** Every copy edit moves them, they moved twice during the pass that wrote
them, and they had drifted a fourth time before the commit that split the nine long strings: they read
1,064 sentences and 258 em-dashes against a tree already holding 1,077 and 262, with not a word of that
commit's copy touched. `src/lib/i18n/__tests__/conventionsCensus.test.ts` extracts the block above,
runs it, and compares every figure in the paragraph, so the fifth drift is a red suite rather than a
line nobody re-read. **It gates this document's accuracy, not the copy** — the refusal three paragraphs
up still stands, and the test has no opinion about what the median should be, only about what this
file says it is. Sentence stats
split on `(?<=[.!?])\s+` with `{{…}}` normalised to one token, which
is why the block substitutes `X` for a placeholder rather than dropping it — a dropped placeholder
merges the two words either side of it into one. `readerVoice.test.ts` has a `prose()` helper that
strips placeholders for a different purpose (vocabulary matching, where the substitution must _not_ be
a word); reuse that one there rather than writing a third stripper, and this one here.

**A figure quoted in two files is two figures, so the second copy is gone.** `readerVoice.test.ts`
used to carry its own em-dash count in the comment above `keeps the em-dash under the ceiling the
house style was granted`, taken on its own day by its own method — it read 240 while this file read
270 and the tree held 257. Asking whoever re-ran the block to re-run it against that comment too was
the same instruction that failed here four times. The comment now says "about a fifth" and points at
the paragraph above, which is the only place either number lives.

**Comparisons come from inside the game.** Another ability, another spec's mechanic, another
expansion. That is the entire domain: no sport, cooking, money, machinery or weather picture belongs
in a report. Project decision, and the reason is that a reader who has to decode a metaphor before
reading a number has been charged for nothing. "In the last second
before the bell" is the standing failure, and the argument against it is not the register point but
the string it lives in — `summary.takeaways.metric.fireElementalPrepull.fix` also says "was not out
when the pull started". Same referent, two registers, one string.

**UI deixis is for navigation, never for a cue.** "The table below says what was short on each one"
is correct: it tells the reader where to look. "Press it as the bar reaches the line" is not — the
player's cue in game is a mana percentage, and the bar and the line are this report's own furniture.
A sentence that tells someone what to press names the game state, not the widget.

**No hedged interrupters, and a verb beats a nominalization.** "Every Fists of Fury channel and what,
if anything, was wrong with its placement" carries one of each: a hedge wedged into the middle of the
sentence, and a noun sitting where a verb belongs. That is the register of an audit form rather than
of someone describing a pull. `if anything`, `what was wrong`, `placement` and `application` are
banned by project decision. **Labels are exempt** — a value in a table cell, an axis label or a KPI
tile is not a sentence, so "First application" and "Late placement" stay noun phrases. That is what a
label is.

**`AoE`, not `area damage`.** `AoE` is the term players use for both senses, the mode and the output,
and `area damage` is not. Project decision. An earlier reading treated the two as a sense
distinction, mode versus output, and that was wrong. The related terms are safe in the same way:
`single-target`, `multi-target` and `burst` are used by all six.

**Density: the bloat is structural, and a fluff sweep will come back empty.** Verified across every
leaf in both files — zero `in order to`, `due to the fact that`, `a number of`, `the majority of`,
`what this means is`, `each and every`, `is able to`, `begin to`, zero expletive `there is … that`,
zero double hedges. Do not spend a pass hunting padding; there is none. What there is instead is one
string answering several questions the reader never asked together. The shape of it is a median around 25 words with a
tail past 90, and roughly a quarter of all prose words sitting in the longest 9% of the strings. The
census block under **Sentence rhythm** prints the exact distribution; it is not restated here.
It used to read p99 119, longest 196, 26% in the top 9%, and the tail is where it went stale: the
measurement predates `Split the longest notes by the jobs in them, not by their length`, which is the
commit that cut exactly that tail. The rules below are what the measurement is for, and they did not
move. Six follow from it:

1. **One string answers one question.** If it glosses a column _and_ states a rule _and_ teaches a
   mechanic, it is three strings, and two of them are probably `intent` or a tooltip.
2. **Never restate a claim in different words inside one string.** Say it in the strongest form once.
3. **A rule with cases is a table, not a paragraph.**
4. **Boilerplate shared by grade arms is said once, outside the arms.** A clause that ships in eight
   strings is a clause in the wrong place.
5. **Cut the sentence that defends the method to a reader who has not objected.** Method exposition
   belongs in the `method.*` keys, which exist for it.
6. **Job count is the signal, not length.** `rotation.economy` is 97 words and correct as it stands:
   seven sentences, short median, every clause load-bearing, nothing restated. It is long because its
   subject is. Do not shorten it — if an edit aimed at another string would also "improve" that one,
   the rule being applied is length, and length is the wrong rule.

**Rule 4 is about the reader, not about the file, and reading it the other way undoes the
front-loading.** Exactly one grade arm renders, so a clause that appears in all three of `verdict_good`
`_ok` `_bad` is not something anybody reads twice — and when that clause is the reader's own number, it
is there because every arm has to open on it. What rule 4 catches is the clause a reader meets twice
**on one page**: the seventeen words of "switch the reading with the control at the top of the page"
that nine strings ended on, which a multi-target reading printed in five sections at once. Count pages,
not keys. Two families were deferred to a split on the key count alone and neither pays — `brew`'s
"{{count}} brews spent, averaging {{avg}} of 10 stacks" and `flameShock`'s "The dot was up for every
second you had something to hit" are the front-loaded result, and `castLog.lust.note_*` differs by spec
in the middle of a sentence, where three keys assembled into one sentence is worse than the repetition.

**An empty state and the verdict under it must not be the same sentence.** Four sections shipped the
pair: `searingTotem.none` and `searingTotem.verdict_none` were both "Searing Totem was never cast in
this pull", printed ten words apart on a pull that never cast it, and `flameShock`'s two differed by one
word — "pressed" against "cast" — which reads as a rendering fault rather than as writing. The table's
empty state says what the _table_ has nothing of ("No presses to list"); the sentence under it says what
the _pull_ did. `earthShock.none` had it right from the start: the table lists only the faults, so its
empty state is "Every Earth Shock went out where it should have."

**A magnitude word inside a graded arm is a claim about the whole band.** This is the honesty rule
below, in the one shape that keeps getting past it. An arm renders across every value its band can take,
so "most", "repeatedly", "almost" and "nearly" have to be true at the band's _worst_ end or they are
false on the page. `casts.verdict_bad` said "Nearly a third of the pull produced nothing useful" on a
band starting at 75% used; `tigerPalm.verdict_bad` said "This happened repeatedly, not just once" on a
band three presses and one wasted press can reach, printing the contradiction nine words apart; and
`earthShock.verdict_bad` said "most went out early" on a band starting at 64% good. Derive the claim or
drop it — the grade already carries the colour. The survivors are listed in `readerVoice.test.ts` with
the arithmetic that earns each one, so adding a fourth is a visible edit.

**A section does not rank itself against the rest of the page.** `ascendance.noneMissed` closed with
"this is the biggest thing to fix on this pull", which is a comparison across every other section, made
by a section that can see none of them — and it can be false, because a pull can also have dropped the
dot or spent 40% of its globals. The ranked list already exists and is derived from the weights: it is
`summary.takeaways`. A section says what its own button did and how much that costs; the order the
reader works in is the summary's job.

**Nothing renders markup, so markup in a string is punctuation the reader has to read.** There is no
markdown pass and no `dangerouslySetInnerHTML` anywhere in the tree: a locale string is handed to
React as text. `flameShockSnapshots.measurable` shipped `*is*` and `method.energy` shipped
`` `classResources` `` and `` `resourcechange` ``, and all three printed their own asterisks and
backticks at a reader. Emphasis is carried by word order, and a WCL field name is jargon this audience
reads unglossed. `docs/report-register.md` §8 records the same habit in this project's own writing:
`RoRo`, `TEB`, `CD` and `SEF` all go unexpanded, because glossing what the reader knows insults them.

**Say the refusal once.** Where the log cannot answer something, the sentence that says so is the
answer; a second sentence saying "the log does not contain enough data to report a figure" adds a
generic restatement to a specific one. `sef.overlapUnknown` and `jadeWind.absent_unknown` both carried
that closer after they had already named exactly what was missing.

**Open, and measured rather than ruled: apostrophes and quotes are split two ways.** `report.json`
holds 50 strings with a straight apostrophe and 25 with a curly one, and **one** string with a straight
double quote against **three** with curly ones. Nothing renders one differently from the other, so
this is a house-style decision nobody has taken; it is recorded here so that whoever takes it does it
in one sweep rather than one string at a time.

**`specs/__tests__/readerVoice.test.ts` is the mechanical half, and it carries two kinds of list on
purpose.** `MODEL_WORDS` — internal jargon that must not reach a reader — is surrounded by carve-outs
(`WINDWALKER_METHOD_KEYS`, `SHARED_METHOD_KEYS`, `REFERENCE_SECTIONS`, `REFERENCE_READER_KEYS`),
because naming the model is sometimes the job: a section whose whole purpose is printing the priority
list cannot be forbidden from calling it a list. The voice lists are the opposite — whole file, both
namespaces, no exemptions, because no section's job requires "it is worth noting". Do not merge them:
a merge would hand a permanent pass on AI vocabulary to the ~120 `rotation` strings that the jargon
carve-outs exempt. They match differently too. `MODEL_WORDS` uses `includes()`, so `judg` catches
judge and judgement; the voice lists are `\b`-anchored, so `very` does not fire inside `every`.

**The lists catch vocabulary. They cannot catch constructions.** A word list finds `simply`. No word
list finds a metaphor, a hedged interrupter, or a widget standing in for a game cue — every class
above was found by reading strings, and the next one will be too. The guard is a ratchet that stops a
fixed defect coming back; the rules here are the standard. When you find a new class, write it down
here first and add the literal to the guard second.

## Honesty in output

Never hard-code a finding into report prose. A sentence describing one log's pattern as "bimodal"
once printed on every later report regardless of its data. Derive the claim from the numbers or omit
it.

Where the log cannot answer something, say so in the UI rather than implying a clean verdict. The
rotation's energy conditions are the standing example: WarcraftLogs emits too few `resourcechange`
events to rebuild an energy curve, so a channel marked "ok" may still have overcapped.
