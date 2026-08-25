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

Two tests guard all of this and both must stay green: `lib/i18n/__tests__/keys.test.ts` fails if a
component asks for a key that does not exist (a missing key renders as its own key path rather than
throwing, so nothing else would catch it), and `specs/windwalker/lib/__tests__/score.test.ts` asserts the
thresholds actually separate three real captured pulls — a grading scheme that paints every log the
same colour passes any test written around it and tells a reader nothing.

**How the copy is meant to sound is written down, and half of it is tracked.**
`docs/audience-wow-players.md` is the audience register, measured from 18,889 words of Wowhead MoP
guide prose across 12 pages and 6 authors: the guides this report's readers already read. Read it
before writing a string, and read the author-spread column, because a marker used by one author of
six is that writer's tic rather than the genre. Sections 8–13 of it are deliberately
`[not captured]` — there is no personal voice profile here and the output is voice-neutral on
purpose. Never fill a blank slot with a guess.

`docs/labels-and-figures.md` is tracked beside it and is the narrower rule: a label that names a number
is read as one phrase with it, so its form follows the figure's shape rather than the voice. A
percentage takes an instruction; a count or a duration takes a noun naming what is counted. Getting it
wrong reads as a wrong figure rather than as bad writing, which is why it is written down at all —
`components/sections/Scorecard.tsx` cites it and `scorecard.test.ts` guards it.

The other half is `.claude/skills/tone-of-voice/SKILL.md`, the universal layer — the rules that stop
prose reading as machine-made — and **it is ignored by `.gitignore`, so a clone does not have it.**
That is deliberate: it is a procedure an agent loads while working in this checkout, not an artifact
the repository ships. The consequence is the thing to know. Every `SKILL.md §n` in this file and in
`readerVoice.test.ts` is **provenance for a rule that is stated in full where it is cited** — where
the rule is overridden, the override and its reason are here; where it is kept, the rule is here.
None of them is an instruction to go and open a file. The measurements are the opposite, because a
number cannot be restated without becoming a claim nobody can check, which is why the corpus itself
is tracked in `docs/` and the procedure is not. See the note in `.gitignore`, and the same split in
`docs/item-effect-sweep.md`.

**Second person throughout. Never `we`, `us`, `our` or `I`.** A report describes a pull; it is not a
party to it. Banning `I` only matches the genre — six independent authors wrote 18,889 words of
exactly this kind of writing with zero first-person singular. Banning editorial `we`/`our` is this
project's own tightening, and the reason has to sit next to the rule or it will be relaxed: all six
of those authors use it freely (349 and 269 per 100k). "One use drained its pool completely, which
tells us the pool's size" is the shape to watch for — a narrator in a sentence that only needed a
number.

**The em-dash stays, and that is an override of both halves of the standard.** `SKILL.md` §15 bans
it outright. The audience corpus has six in 18,889 words, none of them a spaced appositive pair, two
authors using none at all — where these writers interrupt a sentence to define a term they reach for
parentheses. This repo's copy carries them in about a fifth of its prose sentences — the
census below prints the exact count, and is the only place in this file that does. They are kept because they earn it here: an appositive defines a
measurement inside the sentence that used it, where a following sentence would put the definition
after the claim it was needed for. Record it as
an override and not as genre support — an honest override survives the next reviewer and a false
claim does not. **Ceiling of two in one sentence.** A sentence that wants three is two sentences.

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

As of the Protection report gaining its Externals section, it prints 1517 leaves, 734 prose,
23,438 words; median 27, p75 43, p90 64, p95 77, p99 97, max 160; longest 9% carry 24%; report.json 665
prose leaves, 1,152 sentences, median 17, 227 past 25 (19.7%), 273 em-dashes in 236 sentences (20.5%);
51 / 22 / 1 / 2 on the quote lines.

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
expansion. That is the entire domain, and it is what the audience's own writers do: no sport,
cooking, money, machinery or weather picture appears anywhere in the corpus. "In the last second
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
of someone describing a pull. `if anything`, `what was wrong`, `placement` and `application` are all
at zero across the corpus. **Labels are exempt** — a value in a table cell, an axis label or a KPI
tile is not a sentence, so "First application" and "Late placement" stay noun phrases. That is what a
label is.

**`AoE`, not `area damage`.** `AoE` runs 121 per 100k across all six corpus authors; `area damage`
runs 26 and every instance is one author's. It is a habit, not a sense distinction — an earlier
two-author sample read it as one and was wrong. The related terms are safe in the same way:
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
reads unglossed — the corpus never marks one up either.

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
