# sim-apl-drift

How this repository notices that wowsims changed a priority list, and what to do when it has.

## The problem it solves

Every rotation section is drawn from a ladder in `src/specs/<spec>/lib/apl.ts`, and every one of those
ladders was written **by hand from a wowsims APL**. That is a copy of somebody else's list, living in
another repository, on another release cycle.

When the original changes, nothing here breaks. The rotation still renders, every test still passes, and
the section is quietly wrong about what to press. Nothing else in the tree would ever say so.

## The pieces

| file                                      | what it is                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `scripts/sim-apl.mjs`                     | the parser: flattens an `.apl.json` to the casts it attempts. No network.                               |
| `scripts/build-sim-apl.mjs`               | fetches `wowsims/mop@master`, writes `src/generated/sim-apl.json`. `--check` reports drift and exits 1. |
| `src/lib/spec/simApl.ts`                  | typed reader, so nothing else imports the JSON                                                          |
| `src/specs/__tests__/simAplDrift.test.ts` | the alarm: each ladder against the snapshot                                                             |
| `.github/workflows/sim-apl-refresh.yml`   | Tuesdays 05:00 UTC and on dispatch; opens a pull request                                                |

```bash
node scripts/build-sim-apl.mjs           # refresh the snapshot
node scripts/build-sim-apl.mjs --check   # is it stale? costs a dozen API requests
```

It costs nothing beyond GitHub API requests against a public repository. `GITHUB_TOKEN` only lifts the
rate limit from 60 an hour to 1,000.

## What the snapshot is, and what it is not

**It is a projection.** The sim's APL is a program — named groups, value variables, strict sequences, item
swaps, conditions nested several levels deep. The snapshot flattens all of that to the order casts are
attempted, per file, with the group each came from.

That makes it useless as a rotation and exactly right as an alarm. Two rungs that differ only by condition
collapse to one spell here, so **it cannot tell you that the _reason_ for a rung changed** — only that a
spell was added, dropped, or moved.

Hidden rows — the sim's elixir and weapon-swap toggles — are kept in the snapshot with a flag and dropped
from the spell set. The drop is visible rather than assumed.

## Two things the first run found

**The sim calls Rising Sun Kick 130320; this repository calls it 107428.** Both are "Rising Sun Kick" in
the spell map. WarcraftLogs reports the monk's press as 107428 and every event the analyser reads carries
that id, so the ladder is keyed on it. `ALIASES` in the drift test holds the pair; without it the rung
reads as missing from the sim for ever.

**`wowsims/mop@master` has no `default.apl.json` for the Protection paladin.** Only `horridon`,
`iron_juggernaut` and `sha`, all fight-specific, and all of them cast Crusader Strike rather than Hammer of
the Righteous. So Protection's `53595` rung has no single-target list to be checked against, and it sits in
`LADDER_ONLY` as an open question rather than a settled exemption. This is also why the harness **lists the
directory instead of assuming a filename** — the obvious guess was wrong on the first spec it was tried on.

## When the alarm fires

The drift test fails in two directions, and they mean different things.

**A ladder rung the sim no longer casts.** The worst kind: the section tells a reader to press something
the current model does not. Check whether the spell was renamed, re-numbered, or genuinely dropped.

**A spell the sim casts that nothing here classifies.** Decide which it is:

- a new rung — update `lib/apl.ts` and the rotation prose
- a cooldown, raid buff, racial, stance or talent sibling — add it to the right group in `SIM_ONLY` with
  the reason. `apl.ts` gives the standing argument: cooldowns are decisions about a cooldown rather than
  about which filler global to press, and each is already judged by a section of its own.

**A red pull request from this job is a successful run.** The workflow deliberately does not gate on the
suite — it opens the pull request either way and puts the failure in the body. Opening nothing because the
alarm went off would be the one unrecoverable mistake it could make.

## Adding a spec

The directory is derived from the registry: `ui/<classKey>/<specName>/apls`, lower-cased. A spec registered
next year is picked up with no edit — the same way the reference sweep picks it up. Two things do need an
edit, and both fail loudly rather than silently:

- `LADDERS` in `simAplDrift.test.ts` names its three imports by hand, because `SpecDefinition` does not
  carry its spec's APL yet. When `apl` joins the definition this becomes a walk of `SPECS`.
- A spec whose APLs the sim does not have gets an empty entry and a `note`, and the drift test fails on
  "has a snapshot to compare against" rather than passing vacuously.
