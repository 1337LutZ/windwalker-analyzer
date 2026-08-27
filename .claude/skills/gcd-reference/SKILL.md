---
name: gcd-reference
description: "Refresh src/generated/reference.json — the per-encounter reference distributions every encounter-anchored grading line is drawn from. Covers the three commands (--check, --dry, a real refresh), loading WCL_TOKEN without ever printing it, the band arithmetic that makes a targeted sweep cheap, the gates a pull must clear, the stdout budget, and the one flag that silently deletes two specs' rows. Load before running or editing the reference harness."
user-invocable: true
argument-hint: [check] OR [dry] OR [refresh]
---

# gcd-reference

How to refresh the reference table without rediscovering the procedure. **Read this before running the
harness**; two of the things below are not recoverable by reading the code quickly, and one of them
deletes committed data.

## What the table is for

Every grading line in this tree is two absolute numbers, and measured across 400 heroic Siege kills those
numbers grade the encounter rather than the player: the boss explains **60.0%** of the variance in a
Windwalker's `gcdUtilisationPct` against **8.5%** for the player's parse band. A rank-95 monk on Immerseus
grades `bad` and a rank-27 monk on Malkorok grades `good`, under the same pair of numbers.
`src/lib/score/profile.ts` grades against an encounter's own distribution instead. `src/generated/reference.json`
is where that distribution comes from, and this harness is what builds it.

The output is **committed**, for the same reason `build-spell-map.mjs` commits its map: `npm run build`
must never reach the network, and a derived table in the history makes drift _reviewable_ — a re-run
produces a diff, so a reference that moved shows up in a pull request instead of silently re-grading
every report in the tree.

## The three commands

Run everything with Node 24 on the path (`export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`) and
`RTK_DISABLED=1` in front of anything you intend to believe.

| command                                           | costs                              | when it is the right one                                                                                                                                                                                                          |
| ------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/build-reference-tables.mjs --check` | nothing, no token                  | "is the committed table stale?" It rebuilds a table from `.reference-cache/pulls.json` and prints only the cells that differ — and nothing at all when the table is current, exit 0. This is the one to put in front of a review. |
| `node scripts/build-reference-tables.mjs --dry`   | nothing, no token                  | "what would a refresh do?" Two lines: how many specs across fourteen encounters, and where the cache lives. Use it to confirm the roster picked up a spec you just registered.                                                    |
| `node scripts/build-reference-tables.mjs`         | **thousands of API points, hours** | an actual refresh. Only when the table is genuinely stale, or a spec has been added, or a metric's reading changed.                                                                                                               |

`--check` says nothing when there is nothing to say, so a silent run is a pass rather than a failure to
run. Confirm with `echo $?`.

### The flag that deletes data

**`--spec=<key>` narrows the write, not just the sweep.** A `--spec=elemental` refresh replaces
`.reference-cache/pulls.json` with elemental-only pulls and then writes `src/generated/reference.json`
from _those pulls and that one-spec roster_ — so the Windwalker's and the Protection paladin's rows are
gone from the committed table, silently, and the diff looks like a successful refresh.

Use `--spec=` with `--dry` and `--check` freely. For a real refresh treat it as **a way to try the
machinery on one spec**, never as a way to update one spec's rows: either sweep everything, or restore
the other specs' rows from git afterwards and check the diff names only the spec you meant.

## Loading the token

```bash
set -a; . ./.env; set +a
[ -n "$WCL_TOKEN" ] && echo ok
```

That is the whole check. **Never `echo`, `cat`, `printf`, `env | grep`, or otherwise print `WCL_TOKEN`,
and never commit it** — not into a script, not into a test, not into a shell one-liner that ends up in a
transcript. `[ -n "$WCL_TOKEN" ] && echo ok` establishes that it is loaded without revealing a byte of it,
and that is the only confirmation anyone needs. `.env` is gitignored; keep it that way.

The harness reads `WCL_TOKEN` from the environment in two places — the script's rankings queries and the
runner's `WclClient` — and neither ever writes it anywhere.

## Why the sweep is cheap: the band arithmetic

A row's position in `characterRankings` **is** its `rank` — page 2 row 1 is rank 101, page 3 row 1 is rank
201 — and WarcraftLogs' own `rankPercent` is exactly `100 × (1 − rank/totalParses)`, floored. So a
percentile is not something to page toward and hope for: one screen per encounter gives `totalParses`, and
after that every band is reachable on the first request, by computing which list positions fall inside it
and asking for precisely those pages. Measured hit rate across the two sweeps that established this:
**143 of 143**. `rowsForBand` does the arithmetic in integers on purpose — written the readable way,
`1 - 90/100` is `0.09999999999999998` and the top of every band loses a row, which is a systematically
missing sample at the exact edge the band is defined by. **Do not page and hope**, and do not "fetch a few
hundred and filter": both cost an order of magnitude more points for a worse spread.

The bands are the whole ladder — `[0,50] [50,75] [75,90] [90,101]` — because a reference pooled only from
top parses would answer "how does this compare to the best", which is a ranking the report already prints.
Pooled across the ladder it answers "what does this fight cost", which is what a grading line needs; the
line is then anchored at the distribution's p90 rather than its middle, so `good` still means good play.

## The gates

A pull informs a cell only if it clears all of `GATES`, and each gate caught something real:

- **`requireIsSpec`** — the analyser's own `identify` hook, **never** WarcraftLogs' spec label. Seventeen
  ranked players across six sweeps were a different spec than the site labelled them; one was ranked
  Protection on three pulls while casting Divine Storm and Templar's Verdict.
- **`requireKill`** and **`difficulty: 4`** — rankings return heroic kills, but a cached dataset from
  elsewhere might not be one.
- **`minRaidSize: 24`** — applied during candidate selection, off the rankings row.
- **`minDurationMs: 120_000`** — below two minutes a handful of presses moves the figure a full point.
- **`minContactShare: 0.5`** — the share of the pull the player was in reach for.

**Deaths are annotated, not excluded, and that reverses an earlier instruction on purpose.** The reason
given for excluding them was that the contact clock ends at death. It does not: `engagedWindows` splits on
a gap longer than `ENGAGED_GAP_MS` and resumes at the next hit, so a resurrected player gets their
remaining time back — one measured pull died at 59s of 336s and still read 94.86% contact. Excluding costs
twelve honest pulls to catch one, and the two sweeps' samples disagree about even the sign of the effect.
**The contact-share gate is what actually catches the unfair pull**: a rank-0 kill read 94.52%
`gcdUtilisationPct` off 32.7s of contact on a 260s fight, and it is `contactShare`, not the death count,
that rejects it. `deaths` still travels on every swept pull so the question can be re-asked from
`pulls.json` without re-fetching anything.

## The output budget

This harness is run by agents as often as by people, so its output is a budget rather than an afterthought:

- **stdout is one line per cell** — fourteen encounters × the specs asked for — whatever the sample size. A
  full three-spec refresh prints 42 lines and a header, never a line per pull.
- `--check` prints only the cells that drifted, and nothing when the table is current.
- Per-pull detail goes **to disk**, and the path is reported once. It is never printed.
- Failures print a count and one example, not a list.
- The runner's own progress goes to **stderr**, one heartbeat per fifty jobs, because the script runs it
  with stdout ignored.
- **The dataset cache makes a re-run free.** Every fetched pull is written to
  `.reference-cache/datasets/<code>_<fightID>_<player>.json` and read back before any fetch is attempted,
  so a second pass over the same plan spends no API points and needs no token at all.

`src/lib/reference/__tests__/harness.test.ts` asserts the line budget, so an edit that starts printing
per-pull rows fails rather than quietly costing a reader ten thousand tokens.

## A new spec is swept without an edit

Nothing in the harness names a spec. `SpecDefinition` already carries the two strings WarcraftLogs wants —
`classKey` is documented as "WarcraftLogs' own class spelling, exactly as the API returns it" and
`specName` as "WarcraftLogs' own spec spelling" — so the script reads its roster out of
`src/lib/spec/registry.ts`, and the runner reaches each spec's engine through `getSpec(job.spec).analyse`.
**Register a spec and it is swept the next time this runs**, with no edit in `scripts/` and none in
`src/lib/reference/`. Confirm with `--dry`, which prints the roster size. `harness.test.ts` pins the claim
by parsing a fourth, invented spec out of a doctored registry.

## The two halves, and the file between them

The script cannot run `analyse()` — that is TypeScript importing through the `~/` alias and pulling `?raw`
GraphQL documents, and a plain `.mjs` under `node` resolves neither. The `.ts` must not import the `.mjs`
either, because `tsc --noEmit` covers `**/*`. So the two halves talk through files, and the split is:

| owns                                       | what                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `scripts/build-reference-tables.mjs`       | the roster, the band arithmetic, candidate selection, the gates, the table maths, drift detection, all reporting |
| `src/lib/reference/sweep.ts`               | one job → one measured pull: fetch (or read the cache), `analyse()`, derive the fields                           |
| `src/lib/reference/__tests__/sweep.run.ts` | the process the script spawns; reads `jobs.json`, writes `pulls.json` and `failures.json`                        |

Everything under `.reference-cache/` is gitignored:

```
.reference-cache/jobs.json      { metric, specs, jobs }  written by the script
.reference-cache/pulls.json     SweptPull[]              written by the runner, read back to build the table
.reference-cache/failures.json  jobs that produced no pull, and why
.reference-cache/datasets/      one fetched FightDataset per (report, fight, player)
```

`pulls.json` is **replaced** by each refresh, not merged, which is deliberate: every pull in a published
cell was then measured by today's engine, and a stale row measured by last month's is exactly the drift
`--check` exists to catch rather than to absorb. The datasets accumulate, so replacing costs nothing.

The runner **skips itself unless `REFERENCE_SWEEP` is set**. `vitest.config.ts` includes
`src/**/__tests__/**/*.ts`, so without that guard an ordinary `npm test` on a contributor's laptop would
fetch a thousand combat logs. It costs the suite exactly one skipped test; the rest of the tests in that
file run always, cover the pure half of `sweep.ts`, and each one runs with `globalThis.fetch` replaced by
a counter that refuses and asserts the count is nought. If you change that file, keep both properties.

## Two traps that have cost real time

Both are silent — neither is a type error, because `Analysis`' `timeline` is optional all the way down.

- **`analysis.cpm.inContactMs` is not a field.** Reading it yields `undefined`, and a contact share
  computed from it is `NaN`, which sorts, compares and averages without complaining. The contact clock is
  `unionMs(analysis.timeline.contactSegments)` (`unionMs` from `~/lib/analysis/intervals`), and
  `contactShare` is that over `analysis.durationMs`. **Union, not sum** — the segments can overlap, and a
  sum pushes the share past 1.
- **Press marks are at `timeline.casts`, not `timeline.marks`.** Same object, same silent `undefined`.

Two more worth knowing when adding a field to a swept pull:

- **`rankPercent` comes off the fetched dataset, never off `predictedRankPercent`.** The two are recorded
  side by side so the band arithmetic can be re-checked; they agree to ±1 in practice, so a copy would
  never look wrong from downstream.
- **`encounterID` on a pull is the job's base id, not the dataset's raw one.** Iron Juggernaut arrives from
  the API as `51600` where the job says `1600`, and `profile.ts` keys its table by base id.

## What a real refresh costs

There is no point estimate in the harness, and this is arithmetic rather than a measurement: `TARGET_N` is
40 and `BANDS` has four entries, so a full three-spec sweep plans on the order of **3 × 14 × 40 ≈ 1,700
jobs**. `ASSUMED_ANALYSIS_COST` puts the report/actors/damage-table/events part of one pull at 5 points, and
the sweep also pays for enemy deaths, raid Stormlash and the rank query — so call it high single digits per
pull, **well over ten thousand points**, against an hourly budget. Budget it in hours, and expect the
hourly limit rather than the harness to be what paces it.

The honest way to size your own run is to sweep **one spec first** (`--spec=`, understanding the warning
above), watch what it actually spends, and multiply. A cold full sweep is a decision, not a step.

## Verifying a refresh

```bash
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"
RTK_DISABLED=1 npx tsc --noEmit
RTK_DISABLED=1 npx vitest run          # the reference tests are in the ordinary suite
RTK_DISABLED=1 npx oxlint && RTK_DISABLED=1 npx oxfmt --check
RTK_DISABLED=1 node scripts/build-reference-tables.mjs --check   # silent = current
git diff --stat src/generated/reference.json
```

Read the diff. A cell whose `n` went up and whose `p50` moved by a tenth is a bigger sample; a cell whose
`p90` moved by five points with the same `n` is something else, and is worth finding out about before it
re-grades every report on that encounter.

## Current state

`src/generated/reference.json` **does not exist yet** and no sweep has been run from this tree, so
`--check` currently passes vacuously — an empty cache builds an empty table, and an empty table has drifted
from nothing. `src/lib/score/profile.ts` is written and tested but is not yet wired to read the file. The
first real sweep is what turns both of those from true statements into stale ones; update this section when
it happens.
