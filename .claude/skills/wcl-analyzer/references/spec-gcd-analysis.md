# spec-gcd-analysis

How to ask, for any spec, whether `gcdUtilisation` is measuring the player or the boss — and how to
answer it the same way each time, so two sessions get comparable numbers.

`scripts/gcd-analysis.mjs` is the harness. This file is why it computes what it computes, what its
answers meant the six times it has been run, and the three ways it has been read wrong.

**This is the research half.** Its sibling `gcd-reference` skill covers the _product_ half — building
`src/generated/reference.json`, which is what the app actually grades against. The two share a cache and
a gate list and nothing else. Refreshing the table is a routine chore; running this is a decision.

## The command

```bash
node scripts/gcd-analysis.mjs                              # every registered spec
node scripts/gcd-analysis.mjs --spec=elemental
node scripts/gcd-analysis.mjs --lines=85/75                # what a proposed pair would do
node scripts/gcd-analysis.mjs --from=/path/to/pulls.json   # a set from somewhere else
node scripts/gcd-analysis.mjs --json                       # everything, machine-readable
```

It never touches the network. It reads the committed ledger — `src/generated/reference-pulls.json`, which
is also what the table is built from — so it answers the same way on any checkout, and the first step of a
new question is usually a refresh rather than a new fetch. `.reference-cache/pulls.json` wins when a sweep
has just run locally; `--from` overrides both.

The ledger grows every time the weekly refresh lands, so a run of this a month from now is a run against a
larger pool. Quote the `n` alongside any figure taken from it.

Output is a fixed block per spec — about a dozen lines regardless of sample size. That is a contract,
asserted in `src/lib/reference/__tests__/analysis.test.ts`, because this script is read by agents as
often as by people and a per-pull print is a five-figure token bill nothing else would catch.

## The five readings, and the objection each one answers

**1. The distribution.** min / p25 / median / p75 / p90 / max. The first thing anyone asks and the least
informative thing here. A spec's spread means nothing on its own; every reading below exists because
this one was being over-read.

**2. By parse band.** The same five numbers split grey / blue / purple / orange / pink. The question is
whether a rank-60 pull and a rank-99 pull read differently. On the 355-pull cache, a Windwalker's median
goes 72.2 → 78.2 → 80.5 → 80.2 → 83.3 across the five bands. Eleven points of parse ladder buys eleven
points of _nothing much_, and the orange band sits below purple.

**3. Variance: encounter against player.** The finding that reframed the project, and the reading most
easily faked — see the guard below.

**4. Against the simulator's ceiling.** Windwalker 91.56, Protection 96.30, Elemental 99.35 on a
patchwerk dummy. **7.79 points of spread before a human is involved**, which is the argument against any
shared line across specs: the same number on two specs is measuring two different things. A monk's
global is pinned at 1000ms and gated by energy — 413 of 413 sampled Windwalker gaps opened below the cost
of a Jab — while a caster's scales with haste and Lightning Bolt is castable forever.

**5. The fairness check.** How many rank-95-and-above pulls a candidate pair grades `bad`, and which
encounters they cluster on. **This is the one that changes minds and the one nobody runs.** Under the old
Windwalker 85/75, 11 of 42 elite pulls graded `bad`, on five encounters. Under Elemental's old 95/90, 31
of 83 did. A pair can look healthy against the whole population and still fail a third of the best
players in the game, because the population and the top of it are not the same shape.

Pass `--lines=good/ok` to try a pair. There is deliberately no default: the point is testing a _proposal_,
and a default would invite quoting whatever it happened to be.

## The guard, which is the whole reason this file exists

**Do not run the variance split on a pool of one-off pulls.** It will produce a number and the number
will be an artefact.

The first run of this harness reported that the _player_ explained **79.5%** of `gcdUtilisationPct`. That
is the opposite of the project's finding, it is an appealing result, and it is false. The pool held 96
players across 139 Windwalker pulls — so `player` had nearly as many levels as there were observations,
and fitting it explained most of the spread by arithmetic rather than by signal. Nothing downstream would
ever have contradicted it.

`MIN_ENCOUNTERS_PER_PLAYER = 5` is the guard. The split runs only on players who cover five or more
encounters, and reports `usable: false` when fewer than two qualify. **That refusal is a real answer and
should be reported as one** — on the current cache Elemental has exactly one crossed player, so its split
is _unmeasured_, which is not the same as small.

Read the crossed count and the subset size on every run, before the percentages:

```
variance    encounter 56.85% / player 26.8%  · vs parse band 4.83%  (n=41, 3 crossed players)
```

Three things follow from that line:

- **Prefer the parse-band figure when quoting one number.** Band has five levels whatever the pool, so it
  carries none of the degrees-of-freedom risk that `player` does, and it answers the question a raid lead
  actually asks.
- **Both factor orders are computed because they disagree.** In a balanced design they are identical to
  the decimal; a ladder pool is never balanced, and there the order chosen moves the headline. Quoting one
  is quoting a choice. This is how a 57% becomes a 60% depending on who ran it.
- **The exact figure moves with the pool and is not meant to reproduce.** The published split was 60.0% /
  8.5% off full-clear arms; the 355-pull cache gives 56.9% / 4.8% off a looser bar. Same ordering, same
  conclusion, different pool. What has held across every pool so far is `encounter >> band` — treat that
  as the finding and the decimals as provenance.

## What six runs have established

| spec       | encounter explains                                        | parse band explains | median vs its own ceiling |
| ---------- | --------------------------------------------------------- | ------------------- | ------------------------- |
| Windwalker | ~57–60%                                                   | ~5–9%               | 11.5 below                |
| Elemental  | 52.3% (full-clear arm; unmeasurable on the current cache) | 12.4%               | 11.3 below                |
| Protection | ~38–40%                                                   | ~3–30%              | 15.2 below                |

And the consequence, which is the part worth carrying into any argument about a threshold:

```
Windwalker gcdUtilisation, under the old good 85 / ok 75

  Immerseus   p50 60.95    every pull grades bad
  Malkorok    p50 88.93    every pull grades good      swing 27.98
```

A rank-95 Windwalker on Immerseus was graded `bad` for playing the fight as well as anyone ever has. That
is what the encounter-anchored lines in `src/lib/reference/specProfile.ts` were built to fix.

## Three ways it has been read wrong

**Deaths were excluded, and should not have been.** The stated reason was that the contact clock ends at
death. It does not — `engagedWindows` splits on a gap over `ENGAGED_GAP_MS` and _resumes_, so a
resurrected player gets their remaining time back. One pull died at 59s of 336s and still read 94.86%
contact. Excluding costs about twelve honest pulls to catch one. `GATES.deaths` is `'annotate'`; the
contact-share gate is what actually catches the unfair pull.

**A thin cell is an anecdote with quartiles.** `MIN_CELL = 4`. Cells below it print with their `n` because
a grade still has to come from somewhere, but a _finding_ drawn from four pulls is how a sweep talks
itself into a conclusion the data never had.

**WarcraftLogs' spec label is not trustworthy.** Seventeen ranked players across six sweeps were a
different spec than the site said — one was ranked Protection on three pulls while casting Templar's
Verdict. `GATES.requireIsSpec` uses the analyser's own `identify` hook instead. Any pool assembled outside
the harness needs the same screen.

## Adding a spec

Nothing. `registeredSpecs()` parses `SPECS` out of `src/lib/spec/registry.ts`, and `SpecDefinition`
already carries `classKey` and `specName` — WarcraftLogs' own spellings, which are exactly the two
arguments `characterRankings` wants. A spec registered next year is swept the day it registers and
analysed by the same command, with one exception: **its ceiling is not derivable here.** `CEILINGS` comes
from `wowsimcli`, not from logs, and a spec without one gets every reading except the fourth.
