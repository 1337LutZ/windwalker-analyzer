# wcl-analyzer

How the analyzer project works, where the multi-spec migration stands, and how to continue it from a
fresh session. **Load this skill before doing any work in this repository.**

## What this is

A static, browser-only WarcraftLogs analyzer for Mists of Pandaria Classic. The visitor pastes a report
code + fight + player; the browser calls the WCL API directly (the token never leaves the client) and
`analyse()` produces an `Analysis` object that React components render. Astro static build, deployed to
Cloudflare Pages. Charts are **ApexCharts** via `react-apexcharts` — not Recharts.

Originally Windwalker Monk only. It is now genuinely three specs: **Windwalker Monk**, **Elemental
Shaman** and **Protection Paladin**, sharing one engine.

## References

Deeper procedure lives beside this file rather than in it, so a session loads what the task needs.

| File                              | Read it before                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `references/spec-gcd-analysis.md` | asking whether a metric measures the player or the boss, proposing or defending a threshold pair, or quoting a variance figure |

Two sibling skills carry the rest: **`gcd-reference`** for refreshing `src/generated/reference.json`
(the product half of the same machinery), and **`tone-of-voice`** for anything a reader sees.

## Repository layout

The shape that matters: a generic engine under `src/lib/`, per-spec code under `src/specs/<spec>/`, and
shared UI under `src/components/`. Nothing in `src/lib/` may import a spec (see "Leaks" below).

- `src/lib/events/` — event model + narrowing guards (`isCast`, `isDamage`, `isAuraApply`…) and
  `instanceKey(targetID, targetInstance)` — enemy _spawn_ identity, which anything per-enemy must key on.
- `src/lib/game/` — `model.ts` (Ability/Aura/GameData), `registry.ts` (id→object index, throws on dup
  key/id), `shared.ts` (`SHARED_ABILITIES`/`SHARED_AURAS`: racials, consumables, item effects — both
  specs merge these), `resources.ts`, `classes.ts`.
- `src/lib/analysis/` — the generic primitives. `analyseCore.ts` (`SpecConfig`, `Handles`,
  `analyseCore`), `auras.ts` (`auraWindows`, `auraLevels`, `levelAt`, `uptimePct`, `auraDrops`,
  `SELF_EVENT_MS`=250, `DROP_MS`=1000), `stacks.ts` (`trackStackBank`, `pairDrainsToWindows`,
  `overflowIfHeld`), `counters.ts` (`counterWindows`, `atCapWindows`), `search.ts`
  (`lastIndexAtOrBefore`, `valueAtOrBefore`, `stampAtOrBefore`), `intervals.ts` (`mergeIntervals`,
  `unionMs`, `overlapMs`, `complementOf`, `intersect` — **complete; do not add a sixth**), `targets.ts`
  (`targetCounts`, `countAt`, `intervalsAtLeast`, `overlapPoints`), `casts.ts`, `cooldowns.ts`,
  `damage.ts`, `energy.ts`, `engagement.ts`, `gear.ts`, `raidBuffs.ts`, `links.ts`, `format.ts`.
- `src/lib/score/` — `model.ts` (`Grade`, `Threshold`, `Metric`, `gradeOf`, `worst`) and `build.ts`
  (`sharePct`, `metricOf`, `section`, `overall`). Thresholds and weights stay per-spec.
- `src/lib/spec/` — `registry.ts` (`SPECS`, `getSpec`, `findSpecForClass`, `DEFAULT_SPEC`,
  `SpecDefinition`), `apl.ts` (the whole ladder engine: `aplAudit(inputs, ladder)`, `ladderEntries`,
  `Band`), `index.ts` (re-exports the registry only — it must not export one spec's engine).
- `src/lib/types.ts` — `AnalysisCore`, `SpecAuditResult` (the Windwalker shape),
  `ElementalAuditResult`, `Analysis = AnalysisCore & SpecAuditResult`. Both specs' audit types live here.
- `src/lib/settings/model.ts` — `SettingSchema` + clamps. **Six** reader-owned settings across the two
  specs: `snapshotLeewayMs`, `tigerPalmRefreshMs`, `cooldownLeewayMs` (WW) and `flameShockRefreshMs`,
  `lightningShieldOvercapMs`, `searingTotemRefreshMs` (Elemental).
- `src/specs/windwalker/` and `src/specs/elemental/` — each with `lib/` (`index.ts` = GameData +
  registry + `<spec>Audit(h)` + thin `analyse()`, plus `apl.ts` and `score.ts`),
  `components/{charts,sections}/`, and `__fixtures__/`.
- `src/components/` — `Report.tsx`, `report/specSections.tsx` (the per-spec section registries and the
  `resourceSection` factory), `charts/` (`ApexChart`, `WindowTracks`, `ResourceChart`, `ResourceTrack`,
  `LanesTimeline`, `capped.ts`, `resourceCurve.ts`, `timelineOrder.ts`, `tones.ts`), `sections/`
  (`Resource`, `PaceTiles`, `CastLog`, `PriorityLadder`, `Takeaways`, `MissLedger`, `GearSetup`…).
- `docs/plan.md` — **the live plan.** Read it before starting; it is the working record of what is done,
  what is deliberately _not_ being done, and why.

## Where the work happens

**On `main`, in the main checkout** — `/home/lutz/personal/windwalker-analyzer`.

The `feature/multi-spec` worktree that carried this migration is **gone**: the branch is fully merged
(PR #4, `5b71994`) and the worktree was removed. Any instruction elsewhere to work in
`.claude/worktrees/multi-spec` is stale. Branch off `main` for new work.

One consequence worth knowing: in that worktree `.claude/skills` was a _symlink_, so `oxfmt` skipped
it. In the main checkout it is a real directory, so **this file is inside the format gate** — run
`npx oxfmt .claude/skills/` after editing it or `npm run check` fails.

## Commands

Node 24 is required — the default shell node is 20.19.4 and Astro refuses it:

```
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"
npm run check && npm test && npm run build
```

`npm run check` = astro check + tsc + oxlint + oxfmt. Current baseline: **3304 tests pass, 11 skipped**
across 232 files, check 0 errors, build clean. All three must be green after every step.

**Prefix every verification command with `RTK_DISABLED=1`.**

An `rtk` wrapper intercepts commands here and compresses their output. One of its behaviours is
measured, reproducible and dangerous: a vitest **suite-level** failure — a file that fails to _load_,
e.g. a TDZ `ReferenceError` or a missing import — renders as `PASS (0) FAIL (0)`, which is
indistinguishable from success. It has already hidden 24 broken test files while reporting a clean run,
and hidden a stale render-guard file behind a "PASS". `RTK_DISABLED=1` bypasses it; `--reporter=json
--outputFile` is belt-and-braces.

A second claim once made here — that `diff` reported "Files are identical" for files that differed —
is **not reproducible**, with or without the wrapper. It happened once; a stale cached result is the
likelier explanation than a systematic mis-summary. Prefer `md5sum`/`cmp` for equality anyway, but the
reproducible hazard is the vitest one.

## Conventions

- **Comment the _why_, with measured evidence**, naming the reference report the measurement came from.
  Match the existing density. **Never strip a comment when moving code** — the recurring failure mode in
  this repo's history is a copy that carries the numbers and drops the reasoning, leaving the
  justification alive in exactly one place, and never the copy.
- Grade with `gradeOf`/`worst`; **null ≠ 0** — "cannot say" is a real answer and must not render as a
  zero or a bad grade.
- Single source of truth: a lane is the same window array the metric was measured from. Two passes that
  must agree are a bug.
- Settings arrive from `localStorage`/text fields: every clamp total, never NaN, and absent ≠ 0.
- Spec refusal: `identify(h)` false → the UI refuses to render rather than guessing.
- Tailwind v4, **dark only**, semantic tokens from `styles/global.css` (`brew`, `rune`, `kick`, `miss`,
  `lust`, `track`…). No raw hex. Body copy 16px minimum; dense tables may reach 14px.
- Charts: never put column labels in SVG text — they scale down and collide at phone widths.

## Fixtures — two kinds, and the difference matters

`src/specs/*/__fixtures__/` holds **two different things**, and confusing them produces verification
that proves nothing:

| kind                        | files                                                                        | what it exercises                                                                           |
| --------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **pre-analysed `Analysis`** | `windwalker/{strong,poor,mixed,cleave,waves,weave}.json`                     | the _render_ path only — components, `useReportCopy`, the scorecard computed at render time |
| **raw `FightDataset`**      | `windwalker/dataset-ironJuggernaut.json`, `elemental/{phased,unbroken}.json` | `analyse()` actually runs — the audit itself                                                |

**A render hash taken from the pre-analysed fixtures is invariant under any change to a spec's
`lib/index.ts`.** An audit refactor "verified" against them has been verified against nothing. Use
`specs/*/lib/__tests__/pull{,s}.test.ts` for audit changes; they assert real figures rather than hashes,
so a failure names what moved.

Fixture rules:

- **Anonymous reports only** (`a:` codes, every player `Player (N)`). Never a named player's log.
- Pretty-printed to match the existing ones (~380–670 KB each is normal here).
- A raw dataset **must include the enemy NPCs in `actors`**. `analyseCore` builds `enemyIDs` from
  `actors.filter(a => a.type === 'NPC')`, so a dataset without them yields an empty contact clock and
  every contact-scoped figure silently reads zero.

Reference pulls in use: `a:qHRAFwdGzaB6MPYC` #14 (Elemental, carries a real boss submerge at
142.3–192.5s), `a:xB3kh7v9pF2AHRtq` #16 (Elemental, one unbroken dot window all pull),
`a:6MhZgjyAknFWrYfK` #12 (Windwalker) and #10 (Galakras — the multi-add pull the `instanceKey` comment
measures its 17.4s claim on).

## Building a fixture with the `wcl` CLI

The CLI lives in the sibling repo (`/home/lutz/personal/claude-wcl-parser`, `node_modules/.bin/wcl`).
Three traps, each of which has already produced a wrong conclusion:

- **`--type debuffs --source N` returns the debuffs _on_ that actor, not the ones it applied.** A dot the
  player put on an enemy is not in it. Fetch `--type all` and filter locally, or the audit reads 0%
  uptime and you will conclude the log lacks the data.
- **`--ability` is ignored under `--type all`.** Filter locally.
- **`wcl actors` returns friendlies only.** NPCs come from `wcl report`'s masterData.

## Leaks — shared code must not name one spec

`src/components/report/specSections.tsx` and `src/lib/spec/registry.ts` are the legitimate join points
and may import both specs. Everything else in `src/lib/` and `src/components/` must not name one. Tests
are exempt — a test may import a spec to test against it. Check with:

```
grep -rn "from '~/specs/" src/components src/lib --include=*.ts --include=*.tsx \
  | grep -v "specSections\|spec/registry\|__tests__"
```

**Expect exactly one hit today:** `src/components/sections/CastLog.tsx` imports the Windwalker
`CastTimeline`. That is the known open item below, not a new regression — a clean run of this grep means
it has been closed and this paragraph is stale.

Per-spec behaviour belongs on `SpecDefinition` (`identify`, `score`, `weightsFor`, `wasteTone`,
`settings`, `colors`, `gcdMs`) or in the section/chart registries — never imported into shared code from
one spec's module.

## Three deliberate near-duplications — do not "fix" these

1. **`counters.ts` vs `charts/capped.ts`.** `cappedOf`/`emptiedOf` walk _pairs of adjacent readings_ and
   need both at the ceiling — correct for a bar the log only _samples_ (energy, mana), where what
   happened between two readings is unknown. `atCapWindows` walks _stretches_, for a counter that moves
   on events and holds a level until the next one. On a counter series the pair walk misses nearly
   everything, because the reading after a counter sits at its cap is the spend that emptied it: one
   reading at the cap, never two. Unifying them moves every energy and chi figure in the report.
2. **`levelAt` vs `search.ts`.** `levelAt` compares `start < at` and then checks the stretch's `end`,
   because an aura that expired before `t` has no level at `t`. The `search.ts` helpers are `<= t`.
   Folding `levelAt` in changes every boundary answer.
3. **`auraDrops`' two modes.** Given a contact clock it charges a gap only for the part the player was
   present for; without one it forgives the single largest gap as "the intermission". The heuristic is
   kept for the Windwalker, which prints the figure it forgave — but it is dangerous, because on a
   single-phase pull the one real drop a player made _is_ the largest gap, and the ledger goes silent
   about exactly the mistake it exists to report. Pass `away` wherever a contact clock exists.

`counters.ts` takes **stretches, not points**, for the same reason as (1): a counter aura's series has
gaps, so inferring a stretch's end from the next entry's start runs a 3-second window at the ceiling
across a 40-second absence. That was a real bug caught in review.

## A trap that has cost a red deploy

**Never hoist a build variable onto a workflow-level `env:`.** It reaches every step, the test gate
included, and vitest puts the whole process environment onto `import.meta.env` — so a value meant for
`npm run build` is read by the suite as well. Scope it to the build step, which is the only thing that
needs it.

What that cost, measured: the deploy used to pin each site to one spec with `PUBLIC_SPEC`, set job-wide.
`DEFAULT_SPEC` then resolved to the pinned spec _inside the test run_, the component suites rendered
committed Windwalker fixtures through it, and the Elemental deploy failed 96 tests across 18 files on
the tell-tale `expected 1500 to be 1000` (Elemental's `gcdMs` against Windwalker's). The Windwalker
deploy passed through the same bug by pure coincidence — `windwalker` is `SPECS[0]`, so pinning it picks
exactly what the fallback would have chosen. One of two sites was red for that reason.

`PUBLIC_SPEC` itself is gone: one build serves every spec by route, so nothing pins a spec and that
exact failure cannot recur. `SITE_URL` is the only build variable left, and hoisting it would break
nothing today — `astro check` would read it and set `site`, and vitest never loads `astro.config.mjs`.
It is scoped to the build step anyway, because the reason a gate must not see a build variable was never
that this particular one bites.

**The debt that trailed it is paid, and that was worth re-measuring rather than assuming.** What used to
stand here — roughly 18 test files implicitly assume `DEFAULT_SPEC` is the Windwalker, so the suite
cannot run under an Elemental pin at all — is no longer true. Measured on this tree,
`RTK_DISABLED=1 PUBLIC_SPEC=elemental npx vitest run` returns totals identical to an unpinned run, down
to the passing count: the pin adds nothing. Exactly two test files still import `DEFAULT_SPEC`, and
both say something true under either pin by construction:

- `src/lib/spec/__tests__/registry.test.ts` reads it only as `expect(SPECS).toContain(DEFAULT_SPEC)`,
  which is a claim about the fallback rather than about which spec it landed on.
- `src/components/__tests__/landingCopy.test.ts` reads it as _the value under test_ — the landing page
  must name the build's own spec and no other — and pairs every positive assertion with a cross-spec
  exclusion, so it says something different, and true, under each pin.

Every other file that mentions `DEFAULT_SPEC` does so in a comment explaining why it names
`getSpec('windwalker')` instead. Re-check with `grep -rn "import .*DEFAULT_SPEC" src` rather than
grepping for the bare identifier, which is mostly comments.

## Migration status

Phases 1–3 of the original plan are complete: the engine is extracted (`analyseCore` + `Handles` +
`SpecConfig`), the registry and UI are spec-parameterised, and Elemental Shaman ships as the second spec
with its own audits, APL, score thresholds, sections and fixtures.

Work now follows **`docs/plan.md`**, steps 0–22. Steps 0–21 are done or explicitly closed with a stated
reason; step 22 ("Validate the whole of it") is the remaining gate. Worth knowing:

- One deploy, one site: `cloudflare.yml`, a thin caller over a reusable `deploy-cloudflare.yml` taking
  `project_name`/`site_url`, publishing the `mop-log-analyzer` Pages project. It serves every spec by
  route — `/monk/windwalker`, `/shaman/elemental`, a splash at `/` — so there is no `PUBLIC_SPEC` and
  no per-spec project. The two old projects, `windwalker-analyzer` and `elemental-analyzer`, 301 to it
  from a hand-uploaded `_redirects` stub; CI does not build them, so that is a dashboard job and the
  exact steps are in README → Deployment.
- **The host moved, and it costs every existing user a minute.** The redirect URI is matched byte for
  byte against one registered on each visitor's _own_ WarcraftLogs client, so everybody has to add
  `https://mop-log-analyzer.pages.dev/` or sign-in fails as `invalid_client`, an error that blames
  their client id instead. The old hosts 301, and a callback cannot land on a redirect, so signing in
  there is dead rather than degraded. `docs/wcl-oauth.md` opens with the migration note.
- **Known red, and expected:** `src/lib/spec/__tests__/registry.test.ts` scrapes every `.yml` under
  `.github/workflows` for `spec:`/`PUBLIC_SPEC:` values and asserts it finds `windwalker` and
  `elemental`. No workflow names a spec any more, so the scrape comes back empty and the "so a rename
  cannot quietly empty this test" case fails on `expected 0 to be greater than 0`. Only that one case
  fails: `resolves every one of them` passes vacuously over the empty list, which is exactly the hole
  the emptiness guard exists to plug. The guard belongs over the routes now; replacing it is the
  routing work's job, and weakening it to pass is not.
- A large extraction pass removed duplicated machinery: the `score.ts` helpers, `LADDER_ENTRIES`, three
  hand-rolled binary searches, `instanceKey` (which had been defined three times), the
  `complementOf`/`intervalsAtLeast`/`uptimePct` re-implementations, the counter derivations, the
  up/down/away track chart (now `charts/WindowTracks.tsx`, five callers), and the duplicated `toneOf` +
  DPS/CPM/GCD tiles (now `useReportCopy.toneOf` and `sections/PaceTiles.tsx`).
- Open items live in `docs/plan.md` rather than here, so there is one list. The largest two:
  `CastTimeline` still reads both spec shapes through `as unknown as` casts and wants a
  `spec.timelineBanks(analysis)` seam; and the Elemental's `fsMerged` is a union across enemy spawns,
  which is right for the uptime figure but loose for the per-press rules that also read it.

## Update protocol

At the end of each work session, refresh this file and `docs/plan.md`. This skill is the durable record a
fresh session starts from — if it says something the code no longer does, fix it here rather than working
around it. Every factual claim above was verified against the tree when written; re-verify before
relying on a count or a line number.
