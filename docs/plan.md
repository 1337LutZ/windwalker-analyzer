# Multi-spec plan

Active plan for the `feature/multi-spec` worktree. Check items off as they land; delete this file when everything is done. Every step ends with a **Validate** line — run it and check the box before the step counts as done.

## 0 — Generic shared game-object module

- [x] `src/lib/game/shared.ts` exporting `SHARED_ABILITIES` + `SHARED_AURAS`.
- [x] Each spec merges: `{ abilities: [...SHARED_ABILITIES, ...ABILITIES], auras: [...SHARED_AURAS, ...AURAS] }`.
- [x] Abilities: Blood Fury `33697`, Berserking `26297`, Arcane Torrent (`129597`/`28730`/`25046`/…), flasks (`105689`, `76085`–`76088`), elixirs (`105684`, `105682`, `105688`, `76075`), Healthstone `6262`.
- [x] Auras: non-tier item effects (Unerring Vision `138963`+`138786`, Breath of the Hydra `138898`, Cha-Ye's `139133`, Wrath of the Darkspear `146184`, Tempus Repit `137590`, Re-Origination `139117/139120/139121`, Vicious `148903`, Ferocity `148896`, Capacitance `137596`, Flurry of Xuen `146194`, Essence of Yu'lon `148008`, Synapse Springs `96228`) + racial/flask/elixir buff auras.
- [x] Keep per-spec: tier set bonuses (T14/T15/T16) and anything with a spec relationship.
- [x] Validate: `npm run check` (registry throws on dup key/id) + `npm test` + regenerate `spells.json` (0 unresolved).

## 1 — GCD fix (measure from log)

- [x] Add `castTimeMs?: number` to `Ability` (Lightning Bolt 2500, Lava Burst 2000, Elemental Blast 2000).
- [x] Measure effective GCD = median gap between consecutive on-GCD cast starts (instant-prev only), floored at 1000ms, capped at `spec.gcdMs`.
- [x] `gcdSlots = activeMs / effectiveGCD`; `occupiedMs = Σ max(effectiveGCD, measured cast duration)` per on-GCD cast (channels at measured length).
- [x] Validate: rpM9JRABYcvPFbjL f16 → GCD ≈ 1038ms, utilisation ≈ 93% (was 116%), CPM target > actual.

## 2 — Generic Bloodlust/Time Warp/Heroism + Berserking shading

- [x] Core detection of Bloodlust group (`2825/32182/80353/90355/146555`) + Berserking (`26297`), exposed as `analysis.timeline.hasteWindows` / `berserkingWindows`.
- [x] `CastTimeline` reads the generic field; Berserking = subtly lighter band.
- [x] Unify the Windwalker Energizing Brew audit onto the same source: `hasteWindows`/`berserkingWindows` moved ahead of `spec.audit(h)` and published on `Handles`, so the audit reads the core's single walk instead of repeating it.
- [x] Validate: rpM9JRABYcvPFbjL f16 carries Bloodlust (2825) + Berserking (26297) windows; castTimeline tests updated to the generic field and pass.

## 3 — Summary Lightning Shield as a row with stack labels

- [x] Drop the separate `ResourceTrack` from the Elemental `PullTimeline`.
- [x] Draw Lightning Shield as a row in `LanesTimeline` from `analysis.lightningShield.points`.
- [x] Charge level as `dataLabels`-style numbers (the `FightTimeline` mechanism), thinned by `minLabelGapMs`.
- [x] Validate: `npm run check` + `npm test` (911) + `npm run build`.

## 4 — Flame Shock "dot down" intermission-aware + multi-target

- [x] "Down" = complement of `up` minus `analysis.timeline.contactSegments`, for every buff/debuff we track and score.
- [x] Multi-target: when 2 targets are up, keep Flame Shock on both (the APL cleave rule) — Dark Shaman is the reference encounter. Added `flameShockMultiDot` metric (secondary-target dot uptime over multi-target time) + KPI tile + takeaway.
- [x] Validate: `npm run check` + `npm test` (911) + `npm run build`.

## 5 — Lava Burst

- [x] Skip punishing surges that expired during an intermission (a surge now counts as wasted only if it ran out while the player was in contact).
- [x] Table lists only wasted (missed) surges.
- [x] Validate: `npm run check` + `npm test` (911) + `npm run build`.

## 6 — Earth Shock: explain the reason

- [x] Reason per non-good press: "Below 7 stacks", "Flame Shock under 6s", "Ascendance ready within 6s", "T16 2P Proc up" (joined when several fail).
- [x] Table shows bad presses only.
- [x] Rename the `early` KPI → `belowFull` ("Below full stacks").
- [x] Validate: `npm run check` + `npm test` (911).

## 7 — Lightning Shield legend

- [x] Merge the three red bands (fellOff/overcap/badSpend) into one red legend entry.
- [x] Validate: `npm run check` + `npm test` (911).

## 8 — Stormlash label

- [x] `stormlash.key.totem` "A totem" → "Placed".
- [x] Validate: `npm test` (i18n key resolves).

## 9 — On-use items & active spells → buff windows

- [x] `applies`/`appliedBy` for Astral Shift `108271` (8s), Spiritwalker's Grace `79206` (15s), Ancestral Guidance `108281` (10s).
- [x] Dampen Harm `122278` (45s), Diffuse Magic `122783` (6s).
- [x] Flask/elixir/racial buffs from step 0. Zen Meditation stays press-only.
- [x] Validate: `npm run check` (registry validates the links) + `npm test` (911) + spell map regenerated (0 unresolved).

## 10 — Mana Resource section

- [x] "Empty" mode for the generic `Resource` component (no capping shade, red when zero), added to the Elemental section list.
- [x] Validate: `npm run check` + `npm test` (911) + `npm run build`.

## 11–12 — Earth / Fire Elemental sections

- [x] Earth Elemental: used, within APL requirements (`remaining ≤ 62s`).
- [x] Fire Elemental: used, within APL requirements, prepull when Heroism pressed on pull.
- [x] Validate: `npm run check` + `npm test` (911) + `npm run build`.

## 13 — Timeline ends at the fight end

- [x] Clamp estimated cast+duration windows (Searing Totem, Fire Elemental, Stormlash) to `duration` via `untilFightEnd`.
- [x] Validate: `npm run check` + `npm test` (911 pass); clamp provably ends a 60s totem at `duration` (`[t, min(t+60000, duration)]`).

## 14 — Searing Totem uptime vs Fire Totem exclusivity

- [x] One Fire totem slot, modelled once. Both window sets now come out of a single walk over the Searing Totem and Fire Elemental cast lists in time order, each placement closing whatever the slot held — so the two can never overlap, a totem is cut short where the elemental takes the slot, and a re-press after an elemental is no longer read as clipping a totem that was not there. `searingTotem.feWindows` is published for the graph, and the lanes + APL inputs read the same walk instead of re-deriving the elemental's minute a second and third time.
- [x] Not shown: `SearingTotemUptime` drops the elemental's stretch from the "down" band and draws it as its own `track`-toned row (`searingTotem.track.elemental`), so the gap reads as the slot being taken rather than as a rendering fault.
- [x] Not scored: `uptimePct` is measured against `scoredMs` — engaged time less every Fire Elemental window — with the numerator over the same clock, so the ratio cannot exceed 100%.
- [x] Confirmed against the APL rules: priority 20 gates the totem on `!fire-elemental && !searing-totem`, and the sim is the reason — `registerSearingTotemSpell` calls `FireElemental.Disable`, `registerFireElementalTotem` deactivates the Searing Totem dot.
- [x] Fixed in passing, in the block being rewritten: `late` compared a fight-relative press time against the absolute `fightEnd`, so no placement was ever late on any log. Now against `duration`.
- [x] Validate: rpM9JRABYcvPFbjL f16 (Iron Juggernaut, Peremptor) — Fire Elemental at 2.6s, Searing Totems at 62.0s and 122.6s. `feWindows` = `[2577, 62037]`, cut short by the totem press that killed the elemental; `scoredMs` = 124 440ms against an engaged clock of 183 900ms, so the elemental's 59 460ms is out of the denominator exactly as asked. Uptime reads 96.4% where the old denominator gave 65.3% for the same play. The overlap fault still fires (`feOverlaps` = 1).
- [x] Validate: `npm run check` (0 errors) + `npm test` (922 pass) + `npm run build`. New unit coverage in `src/specs/elemental/lib/__tests__/searingTotem.test.ts` — the first tests the Elemental audit has had.

## 15 — Deploy pipeline for Elemental

- [x] `.github/workflows/cloudflare-elemental.yml` — the second pipeline, `elemental-analyzer` / `PUBLIC_SPEC=elemental` / `https://elemental-analyzer.pages.dev`. A push to `main` now publishes both sites from the same commit through two independent runs.
- [x] Refactored rather than copied: every step moved to `.github/workflows/deploy-cloudflare.yml`, a `workflow_call` reusable workflow taking `project_name`, `spec` and `site_url`; `cloudflare.yml` became `cloudflare-windwalker.yml`, a thin caller over it — named for its spec rather than its host, so neither of the two reads as the default and the other as an afterthought. Not a matrix — a matrix is one run publishing both, so a re-run re-publishes both, one failure marks the other red, and the two share a concurrency group. Two callers, two runs, two queues (`cloudflare-pages-<spec>`).
- [x] `site_url` is a required input, not derived: `astro.config.mjs` defaults to the Windwalker domain. Worth knowing that a wrong value there is currently **latent** — `base` is empty on Pages, so asset URLs are root-relative and nothing in the emitted HTML names the host. It stops being latent the moment a canonical link, `og:url` or sitemap is added.
- [x] `deploy.yml` (the manual GitHub Pages fallback) takes a `spec` choice input, defaulting to `windwalker`. It still publishes one site whichever is picked — a GitHub project site is `/<repo>/` and there is one repo — and says so.
- [x] Guard test in `src/lib/spec/__tests__/registry.test.ts`: the `spec:`/`PUBLIC_SPEC:` values are read back out of the workflow files and every one must resolve through `getSpec`. `DEFAULT_SPEC` falls back to `SPECS[0]` when the key does not resolve, so without this a typo deploys a site branded and behaving as the wrong spec with nothing in the pipeline going red.
- [x] `README.md` and `.env.example` updated: the per-spec deploy table, the reusable-workflow rationale, and how to add a third spec's site.
- [x] Validate: all five workflow files parse (`yaml.safe_load`), and the wiring is asserted — both callers point at the reusable workflow, pass exactly its required inputs, pass `secrets: inherit`, and hold distinct concurrency groups, project names, specs and URLs.
- [x] Validate: `PUBLIC_SPEC` is per-project and genuinely reaches the build. `PUBLIC_SPEC=windwalker npm run build` → `<title>Windwalker Monk analyzer (alpha)</title>`; `PUBLIC_SPEC=elemental npm run build` → `<title>Elemental Shaman analyzer (alpha)</title>` — from the process environment, over a local `.env` that says otherwise, which is the precedence the workflow relies on.

## Steps 16–21 — extract the spec-agnostic machinery

Audit of the multi-spec diff, looking for mechanics that are class-agnostic but were implemented once
per spec. Measured across the whole branch (`a441fd4` → working tree: 184 files, +11 650 / −3 648).

The headline is the one the reader named: **Tigereye Brew and Lightning Shield are the same stacking
counter** — accumulates to a cap (20 / 7), spent whole by a press, wastes generation at the ceiling,
can be lost unspent. One correction to the framing, from reading the code: the Elemental _does_ reuse
the shared chart primitive (`LightningShield.tsx:8` imports `ResourceChart`). The misses sit either
side of it — below, `src/lib/analysis/stacks.ts` is a documented shared bank walker the Windwalker
uses and Lightning Shield ignores; above, there is no `stackCounterSection` factory to match the
`resourceSection` one that already exists.

What the audit found, ranked:

| duplicated thing                                             | copies | similarity                      | shared version that already exists              |
| ------------------------------------------------------------ | ------ | ------------------------------- | ----------------------------------------------- |
| `score.ts` helpers (`sharePct`/`metric`/`section`/`overall`) | 2      | **identical sans comments**     | none; `src/lib/score/` is the home              |
| `LADDER_ENTRIES`                                             | 2      | **differs by 3 tokens**         | belongs beside `AplRule` in `spec/apl.ts`       |
| `FlameShockUptime` ↔ `SearingTotemUptime`                    | 2      | 0.904 — 110/135 lines identical | —                                               |
| rangeBar chart skeleton                                      | **8**  | 62–110 identical lines each     | — (documented once, `DebuffTimeline.tsx:19-58`) |
| the stack counter, drawn                                     | **4**  | —                               | `ResourceChart` + `resourceCurve` + `capped`    |
| "time at the ceiling", computed                              | **4**  | —                               | `cappedOf` (`capped.ts:18`)                     |
| binary search over a step series                             | **4**  | line-for-line                   | `levelAt` (`auras.ts:271`)                      |
| stack-level walk                                             | 2      | —                               | `trackStackBank` (`stacks.ts:55`)               |
| interval complement (`downWindows`)                          | 2      | line-for-line                   | `complementOf` (`intervals.ts:42`)              |
| overlap sweep (Stormlash)                                    | 2      | line-for-line                   | `intervalsAtLeast` (`targets.ts:135`)           |

`complementOf`, `intervalsAtLeast` and `uptimePct` are each imported into the very file that
re-implements them. `charts/index.ts` exports none of the resource-chart seam, which is a large part
of why it kept being missed.

**Six defects came in with the copies**, and two of them are the exact trap the original's own
comment warns about. These are fixed in step 16, because the same lines are already open:

| where                                          | what                                                                                                                                                              | effect                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `elemental/lib/index.ts:644`                   | buckets on `targetID` alone; WW buckets on `instanceKey(targetID, targetInstance)` and its comment records that not doing so "discarded 17.4 seconds of coverage" | Flame Shock uptime under-reports on multi-instance pulls |
| `elemental/lib/index.ts:1112`                  | drop ledger loses the "longest gap is the intermission" exclusion, thresholds on `GCD_MS` not `DROP_MS`                                                           | invents misses on phased fights                          |
| `FlameShockUptime:66`, `SearingTotemUptime:75` | widen every span; the original gates on `DROP_MS` because widening everything "painted 206s of red on a track whose real total was 120s"                          | uptime tracks overstate the red                          |
| `specSections.tsx:338`                         | Elemental handed `wasteTone: () => null`                                                                                                                          | its only resource bar is silently ungraded               |
| `LightningShield.tsx:59`                       | `badSpends` has no metric in `elemental/lib/score.ts`                                                                                                             | a fault the report shows but never scores                |
| `FlameShockDepth.tsx:122`                      | `narrow ? 'seconds into the dot' : 'seconds into the dot'` — both branches identical                                                                              | cosmetic, but an unambiguous copy tell                   |

A pattern worth naming: **every copy carries the numbers and drops the comment that justified them.**
The reasoning survives in exactly one place, and it is never the copy.

Scope: high-value extractions only. Deliberately **out** — the press-table section template (≈45
lines × 9 elemental sections), the near-identical section pairs at 0.78–0.88, the nine hand-written
`Miss` mappers, the six duplicated threshold constants, the verbatim `cooldownLeewayMs` setting, and
`Rotation.tsx` (two genuinely different designs, not duplication).

**The bar for every step below: the Windwalker report comes out byte-identical.** Two halves, because
the fixtures only cover one. _Render_ — the six committed fixtures are pre-analysed `Analysis`
objects (`fx()` at `components/__tests__/reportHeader.test.ts:11`), so hash each through
`renderToStaticMarkup(Report)` before starting and re-check after every step. _Audit_ — fixtures
cannot re-derive audits, so changes under `src/lib/` are checked by re-analysing the two anonymous
reports the calibration sweep names, `a:YBQzrcgVJnAj7NMP` and `a:6MhZgjyAknFWrYfK`, hashing
`JSON.stringify(analyse(dataset))` per Windwalker kill. Anonymous reports only.

## 16 — Delete the re-implementations, adopt the originals

Elemental-side only; no Windwalker code touched; each provable by inspection.

- [x] `score.ts` helpers → `src/lib/score/build.ts` (`sharePct`, `metricOf`, `section`, `overall`). Only `metric`'s binding to the spec's own `THRESHOLDS` stays per-spec, as a one-line closure — `metricOf` takes the threshold table as an argument, which is the whole reason it can be shared.
- [x] `LADDER_ENTRIES` → `ladderEntries()` + `LadderEntry<K>` beside `AplRule` in `src/lib/spec/apl.ts`, generic over the key type. Both specs are now one line.
- [x] The fourth binary search → **new `src/lib/analysis/search.ts`**. This plan said "→ `levelAt`", which was wrong: `levelAt` compares `start < at` and then checks the stretch's `end`, so it answers a different question and folding it in would have changed it. The shared primitive is the `<= t` index search — `lastIndexAtOrBefore` / `valueAtOrBefore` / `stampAtOrBefore` — and it deletes **three** hand-rolled loops: `valueAt` in `spec/apl.ts`, `countAt` in `analysis/targets.ts`, and `ascendanceReadyInSec`. `levelAt` is left alone, and now says why.
- [x] `downWindows` → `complementOf(toIntervals(levelWindows(lsLevels)), duration)`. Safe because `auraLevels` only ever emits stretches at level 1 or above, so every stretch is an up-period and the complement is exactly the down time.
- [x] Stormlash boundary sweep → `intervalsAtLeast(overlapPoints(...), 2, duration)`, with `overlapPoints` added beside `intervalsAtLeast` in `targets.ts`.
- [x] `uptimePct` and the open-coded union → the shared `uptimePct` / `unionMs`.
- [x] Deleted the no-op alias `levelsOf`; its three call sites read `auraLevels` directly.
- [x] `stacks < MAX` computed once (`badSpends`, with `belowFull` counting from it); the cap read from `LIGHTNING_SHIELD.maxStacks` rather than the module constant beside it.
- [x] Hoist the repeated `auraWindows` walks → a memoised `selfWindows(aura)` reader keyed on the registry key. Sixteen calls over nine auras collapse to nine walks. The `openAtPull` call keeps its own line: that option changes what the walk _means_, so it must not share a cache entry with the plain reading of the same aura.
- [x] **`instanceKey` bucketing** — `dotWindowsOnTarget` now buckets per spawn and merges across them. `instanceKey` moved to `~/lib/events/guards.ts`, deleting a _third_ copy (it was defined identically in `analyseCore.ts` and the Windwalker lib). Pinned by `elemental/lib/__tests__/flameShockDot.test.ts`, which had to be synthetic because the reference pull carries no Flame Shock dot events at all. **Verified against the old walk rather than assumed:** it reported `[{0, 30000}, {60000, 90000}]` — 60s, 50% uptime — where the enemy actually carried 80s and 66.7%. Twenty seconds discarded on a two-spawn pull.
- [x] **The intermission exclusion** → extracted as `auraDrops(windows, dropMs)` in `~/lib/analysis/auras.ts`, returning `{ drops, intermissionMs }` from one walk. Both of the Windwalker's rules now live in one place, and the Windwalker was rewired onto it first and proved byte-identical before the Elemental adopted it. The Elemental's ledger had neither rule: it thresholded on `GCD_MS` and forgave nothing, so every phase break read as a dropped dot.
- [x] **The `DROP_MS` widening gate** → applied to both Elemental uptime charts, carrying across the measured reasoning (widening every sliver "painted about 206 seconds of red on a track whose real total is 120"). `DROP_MS` moved to `~/lib/analysis/auras.ts` beside `SELF_EVENT_MS`, since the threshold is about aura jitter and not about monks; the Windwalker re-exports it until step 20 moves `DebuffTimeline`.
- [x] **The `narrow` ternary** → `'seconds into the dot'` / `'seconds held into the dot'`, matching the shape it was copied from.
- [x] `wasteTone` → done in step 21, where it belonged: it is a `SpecDefinition` change, not an Elemental audit one.
- [x] The ungraded `badSpends` → **correct as it stands, now documented.** A shock under the ceiling
      already fails one of `earthShockGood`'s four conditions, so it has cost a graded metric in the Earth
      Shock section already; grading it again here would mark one mistake down twice. The section shows the
      table and no grade on the tile — the row is the evidence, the verdict lives where the press is
      judged. The review read the missing grade as an oversight; a comment in `index.ts` now says why it is
      not.
- [x] **Decided:** `fellOff` keeps its leading gap. On the reference pull it is zero either way, and a shield genuinely absent at the start _is_ a fault — unlike the Tigereye bank's tail, where ending full is damage not taken rather than a buff never applied.
- [x] Validate: `npm run check` (0 errors) + `npm test` (945 pass, +19 new) + `npm run build`. **Windwalker render byte-identical across all six fixtures** — which covers `score.ts` too, since the scorecard is rendered. **Elemental audit byte-identical** on the reference pull.

### Corrections to this plan's own premises, found while implementing

- **The reference pull was the wrong player.** Step 14 validated against `rpM9JRABYcvPFbjL` f16 / **Peremptor**, who is _Enhancement_ — zero Lava Bursts, so `identify` refuses the pull outright. The Fire-totem-slot logic step 14 changed is shared across shaman specs, so its conclusion still stands, but the Elemental guard is now **Delaria** (actor 47, 77 Lava Bursts) in the same fight.
- **Lightning Shield is pre-applied, and that breaks step 18's assumption.** On the reference pull the shield logs 73 `applybuffstack` and **no `applybuff`**: `points` starts `[0, 6]`, a six-charge shield inferred at t=0. That inference is `auraLevels`', and `trackStackBank` does not have it. Step 18 must carry it across or the first six charges vanish.
- **Flame Shock cannot be measured on this log.** Its dot events are absent from the report's debuff table (the whole fight carries 390 debuff events; this player has one), so `flameShock.uptimePct` reads 0. The `instanceKey` fix has to be pinned by a unit test rather than by this pull.
- **The Stormlash sweep's defects were not the ones this plan claimed.** Measured against the old implementation rather than reasoned about: it closed the same-instant case correctly. Its two real faults were an overlap still running at the kill emitted with the totem's own expiry — `{5000, 30000}` on a 20 000 ms pull — and a zero-length overlap for two totems sharing an instant. Both are now pinned in `targets.test.ts`.
- Stormlash and the snapshot windows need `raidStormlash` and item-proc data the reconstructed dataset does not carry, so they are covered by unit tests rather than by the real-log guard.

## 16b — Act on the code review of step 16

A high-effort review of the step-16 extraction. It found one regression I introduced and showed one of
my verification claims was hollow. Both are fixed; the rest are small.

- [x] **The regression.** `auraDrops` forgave the single largest gap _unconditionally_, so on a
      single-phase pull the one real drop a player made — being the largest gap there is — vanished from
      the ledger. `auraDrops` now takes an optional `away` clock: a gap is charged only for the part of it
      the player was in contact for, and `ms` comes back as that exposed time. The Elemental passes
      `complementOf(contact, duration)`. The Windwalker keeps the longest-gap heuristic, which it grew up
      on and whose figure it prints, and now says so.
      Measured on `a:qHRAFwdGzaB6MPYC` #14: gaps of 36ms, 888ms, 643ms and 41 914ms, where the long one
      carries 529ms of contact against 41.4s of absence. Same answer as the heuristic gave — now for the
      right reason, and a 20s hole taken in contact would still be reported.
- [x] **My "byte-identical, proved" claim was hollow for the audit path.** The guard read pre-analysed
      `Analysis` fixtures and rendered them; it never called `analyse`, so its hashes were invariant under
      any change to a spec's `lib/index.ts`. It did cover the render path and the scorecard — so the
      `score.ts` extraction was genuinely proved — but not `auraDrops`, `instanceKey` or `search.ts`.
      Replaced by real guards (below) and renamed to `_renderGuard.local.test.ts` with a docstring saying
      exactly what it does and does not prove.
- [x] `auraDrops` had no test at all. Now 11, covering both modes: empty and single-window input, two
      gaps of identical length (excluded by position, not value), the single-phase hazard itself, and the
      reference pull's four real gaps.
- [x] The `DROP_MS` widening gate was applied to the **up** rows as well as the fault rows, so a genuine
      sub-second window — a dot on a dying add, a totem re-laid at once — rendered sub-pixel and vanished.
      `span()` now takes a `widen` flag; only the fault rows opt out.
- [x] `intervalsAtLeast`' docstring had been orphaned above `overlapPoints`, leaving the function the
      tail-clamping fix depends on undocumented. Moved back.
- [x] `selfWindows` closed over `fightEnd` declared seven lines below it — a TDZ `ReferenceError` waiting
      for anyone who inserted a call between them, invisible to `tsc` and `oxlint`. `fightEnd` hoisted.
- [x] The memo handed out a live mutable `Window[]` shared by five sections, and the declared type threw
      away the `id`/`variant` the walk had already resolved. Now `readonly AuraWindow[]`.
- [x] `search.ts` was missing from the `~/lib/analysis` barrel — the exact omission that lets the next
      caller hand-roll a fifth copy of the loop. Exported.
- [x] `LIGHTNING_SHIELD.maxStacks ?? LIGHTNING_SHIELD_MAX_STACKS` was unreachable code implying the two
      could disagree, in a line whose comment claimed one definition. Fallback dropped.
- [x] A docstring in my own test said 70s where the assertion said 80s.
- [ ] **Deferred, deliberately: `fsMerged` is the union across spawns, and feeds per-press rules.** Right
      for the uptime figure and the lane; loose for the Earth Shock `fsLow` reason and the ladder, where an
      Earth Shock pressed while a _different_ spawn carries the dot reads as "dot up". The Windwalker
      splits these (`rskByInstance` vs `rskByTarget`); the Elemental has only the union. Tightening it
      needs a "which spawn was the player on at `t`" walk over the core's `landedHits` keys and moves Earth
      Shock's grade and the ladder's verdicts — a behaviour change with its own verification, not a review
      fix. Documented in place so nobody reads it as intended. **Its own step when you want it.**

### Real fixtures, and the guards that need them

The reader supplied two anonymous Elemental pulls; a Windwalker one was taken from the report the
calibration sweep already names. All three are raw `FightDataset`s, so `analyse` actually runs — which is
what the pre-analysed fixtures could never do. Every player in them is `Player (N)`.

| fixture                                               | pull                             | why it exists                                                                                                                                                                  |
| ----------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `elemental/__fixtures__/phased.json`                  | `a:qHRAFwdGzaB6MPYC` #14, 258.3s | The boss submerges 142.3-192.5s, so the dot legitimately falls off. Catches a ledger that reports that as a drop, _and_ one that forgives it merely for being the largest gap. |
| `elemental/__fixtures__/unbroken.json`                | `a:xB3kh7v9pF2AHRtq` #16, 184.4s | One dot window for the whole pull — 1 apply, 6 refreshes — so it exercises `openOnRefresh`. Two Earth Shocks spent below the ceiling, so the bad-spend path is live.           |
| `windwalker/__fixtures__/dataset-ironJuggernaut.json` | `a:6MhZgjyAknFWrYfK` #12, 190.3s | The first Windwalker guard that runs the audit.                                                                                                                                |

- [x] `elemental/lib/__tests__/pulls.test.ts` (11 assertions) and `windwalker/lib/__tests__/pull.test.ts`
      (7) assert real figures rather than hashes — a hash says something moved, these say what.
- [x] Fixtures are pretty-printed to match the existing ones: 661KB, 571KB and 665KB against the largest
      pre-existing at 630KB.
- [x] Validate: `npm run check` (0 errors) + `npm test` (**974 pass**, +26) + `npm run build`. Render
      unchanged against the step-16 baseline across all six Windwalker fixtures.

### One more finding worth keeping in view

Building the fixtures surfaced a trap in the tooling, not the code: `wcl events --type debuffs --source N`
returns the debuffs _on_ that actor, not the ones it applied to enemies. My first Elemental dataset was
built that way and reported `flameShock.uptimePct` of 0 — which I nearly recorded as "Flame Shock cannot be
measured on this log". It can; the events live in the full stream and have to be filtered locally.

## 17-18 — One "time at the ceiling", and one set of counter derivations

These merged. Once the decision was "extract the derivations, keep both walkers", step 17's leeway _is_
one of those derivations, so doing them apart would have meant writing the same block twice.

- [x] New `src/lib/analysis/counters.ts`: `counterWindows(stretches, holds, leewayMs)` and
      `atCapWindows(stretches, cap, leewayMs)`. The Elemental's hand-rolled ceiling walk is gone.
- [x] **Not folded into `cappedOf`, and the reason matters.** `cappedOf` walks _pairs of adjacent
      readings_ and needs both ends at the ceiling — the right conservative reading for a bar the log
      merely _samples_, since what happened between two readings is unknown. A counter is not sampled: it
      moves on events and a level holds until the next one, so on that series the pair walk misses nearly
      everything, because the reading _after_ a counter sits at its cap is the spend that emptied it. One
      reading at the cap, never two. Unifying them would have quietly moved every energy and chi figure in
      the Windwalker report. Two functions, and `counters.ts` opens with a paragraph saying why.
- [x] **A bug in my own first draft, caught before it shipped.** The helper originally took a `[t, level]`
      point series and inferred each stretch's end from the next entry's start. A counter _aura_ has gaps —
      the shield falls off and the next entry is seconds later — so that would have run a 3-second window
      at the ceiling across a 40-second absence. It takes stretches now, which is what `AuraLevel` already
      is.
- [x] Validate: old and new algorithms compared directly on both Elemental fixtures — **identical window
      lists**, 40 441ms / 10 windows on `phased` and 23 387ms / 7 on `unbroken`. Both figures are now
      pinned in `pulls.test.ts`, so the derivation cannot drift back out.
- [x] Trimmed to what is used: `atZeroWindows` and `stretchesFromPoints` were written, found to have no
      caller, and deleted rather than left as speculative exports.
- [ ] Chi Brew's own `cappedMs`/`cappedWindows` walk (`windwalker/lib/index.ts`) is a third instance of
      this shape. Left alone: it is on the sampled-bar side of the split above, so folding it in needs the
      same before/after proof and would move Windwalker numbers if it came out even slightly different.

## 19 — `stackCounterSection` — **not built, deliberately**

- [x] **The real fix here was the `ChartKey` collision.** `ResourceChart` keyed its legend entries by
      `band.tone`, so two bands of one tone collided on the React key and a caller wanting to name two
      faults in the same red _could not_. Now keyed by the legend, which is what actually distinguishes one
      entry from another. Windwalker render verified identical after the change.
- [x] **The factory does not pay for itself, and building it would be the mistake this plan was written to
      avoid.** Measured rather than assumed: of `BrewBankTrack`'s 80 lines, everything in its
      `ResourceChart` call is spec-specific — tone, legend, both bands, every field of the aria label. The
      genuinely shared surface between it and `LightningShield`'s inline chart is _four_ lines: the
      `resourceCurveFromPoints` memo and a null guard. A wrapper over four lines that still made every
      caller pass tone, legend, bands and label would be an indirection with negative return, and
      `docs/conventions.md` is explicit about not adding abstractions for that.
- [x] **And un-merging the Elemental's fault bands would revert a decision already taken.** The review read
      the merged red band as a workaround for the collision; step 7 of this plan shows it was deliberate
      ("Merge the three red bands into one red legend entry"). The collision fix removes the _constraint_
      without touching that editorial call — splitting them is now possible and remains the reader's choice.
- [x] The duplication the audit actually measured in this mechanic was in the _audit_ — two walkers and two
      sets of derivations — and steps 16-18 removed it. What is left is two section shells, which this plan
      already listed as an accepted cost.

## 20 — One up/down/away track chart

- [x] New `src/components/charts/WindowTracks.tsx`. Takes a variable list of rows — `{ label, tone,
windows, lengthLabel, widen? }` — so a caller can draw two rows or four. `ROW_HEIGHT = 36`,
      `CHROME = 92` and `minimumSpan` now exist once, with the full explanation of why 92 must match the
      pull timeline exactly.
- [x] Five callers: `DebuffTimeline` (moved into `specs/windwalker/components/charts/`),
      `FlameShockUptime`, `SearingTotemUptime`, the new `StormlashTotems` (lifted out of the Stormlash
      _section_, which was the only section in either spec building an Apex chart in-file), and
      `SpiritLanes`. 755 → 679 lines.
- [x] The `widen` distinction is preserved and now documented as a **per-row data fact** rather than an
      accident: `DebuffTimeline`'s rows are contact-scoped and fragment hard (`strong`: 75 up spans,
      median 0.44s), so unconditional widening inflates its green from 467s to 524s on a 535s pull. The
      Elemental up rows are whole aura windows and must _not_ be gated, which is the review fix from 16b.
- [x] **One deliberate Windwalker render change, approved.** `weave` only; the other five fixtures are
      byte-identical and the markup length is unchanged. The old chart hardcoded
      `height: 3 * ROW_HEIGHT + CHROME` regardless of how many rows had data; `weave`'s away row is empty,
      so 200px was divided among 2 categories and drew them at **54px against a pull timeline at 36px** —
      exactly the failure that constant's own docstring warns about. `WindowTracks` reserves height per
      non-empty row.
- [x] Validate: `npm run check` + `npm test` + `npm run build` green; render diff isolated to `weave` and
      attributed by rebuilding the tree with the other lane's changes reverted.

### Where this plan was wrong about step 20

- **"eight places" overcounted.** There are four true up/down/away skeletons. The other rangeBar charts
  share `baseChart`/`timeAxis` but not this shape — different rows, tones, icons and bands, and
  `SpiritLanes` is deliberately on a 24px pitch.
- The proposed `{ tone, windows, labelKey }` + `copyPrefix` interface does not fit and was not used:
  Stormlash's rows are named from the log (`shaman.name ?? '#id'`), not from copy, and the tooltip's
  length wording differs per row _within_ one chart. Resolved `label` + `lengthLabel` carry the text, and
  `WindowTracks` holds no sentences at all.
- The Elemental copies never "dropped" the sliver filter — they have no away row, which was the only row
  it ever applied to.

## 21 — Close the spec leaks, and export the seam

- [x] `wasteTone` onto `SpecDefinition`, and `Resource` now reads it from `SpecContext` instead of taking
      it as a prop — so the shared section list can no longer name one spec's scoring module in order to
      build another spec's bars. The Elemental got a real `wasteTone` (10%/25%, far more forgiving than the
      monk's 2%/5%, because mana is not the constraint an Elemental's rotation runs into).
- [x] `src/lib/spec/index.ts` no longer re-exports one spec's engine.
- [x] `toneOf` deduplicated onto `useReportCopy` as the tile-level counterpart of `gradeOf(section)`; the
      three shared DPS/CPM/GCD tiles extracted to `src/components/sections/PaceTiles.tsx`, carrying the
      Windwalker's justifying comments (the Elemental copy had dropped them). Both `KpiTiles` now use it;
      the Windwalker's went 108 → 72 lines and the Elemental's to 50.
- [x] `FightTimeline` and `CastsPerMinute` moved into `specs/windwalker/components/`; barrels reconciled.
- [x] New `src/lib/i18n/__tests__/copyPrefix.test.ts` for the template-literal `t()` keys, mutation-tested
      (deleting `mana.summary` and adding `chi.captoin` both fail with named output). Also found that
      `keys.test.ts` was only walking `src/components` + `src/hooks`, so every literal key under
      `src/specs/*/components` — most of the report, after steps 19-20 — was unchecked. One line fixed it.
- [x] Validate: `npm run check` (0 errors) + `npm test` (**979 pass**) + `npm run build`. Windwalker
      render unchanged by this step.

### Where this plan was wrong about step 21

- **`src/lib/spec/index.ts` had no consumers to route.** All 13 importers of `~/lib/spec` already took
  only `SpecDefinition`/`SPECS`/`getSpec`/`DEFAULT_SPEC`. Removing the re-export closed a shortcut nobody
  had taken yet.
- **"the Elemental's only resource bar is silently ungraded"** was true only in the sense that it shows no
  graded tile. `Resource` early-returns for mana (chart + prose + note, no `StatTiles`), so
  `wasteTone: () => null` was never actually called. Moving it onto `SpecDefinition` therefore changes no
  pixels today — it closes the seam. Worth knowing: Vite resolved the missing export to `undefined`
  rather than throwing, so tests passed while `tsc` failed.
- `SpecDefinition` is at `registry.ts:37-78`, not `33-62`.

### `CastLog` / `CastTimeline` — deferred, with a recommendation

Neither option this plan offered is the smaller correct fix. Making `CastLog` per-spec duplicates a
70-line wrapper and _keeps_ the leak; `CastTimeline` is already ~90% generic (it reads the registry and
`ROW_ORDERS[spec.key]` off `SpecContext`, and `timelineOrder.ts` already holds both specs' row orders).
Three seams remain: the two `as unknown as` casts want a `spec.timelineBanks(analysis)` member that would
also absorb the `TEB_CAP` import (a bank should carry its own ceiling); `hidden.ts` is imported
unconditionally but is _not_ a bug today, because both its entries are shared item effects — it is
misfiled rather than wrong; then the move. ~1 new `SpecDefinition` member and ~40 lines, but it touches
`CastTimeline.tsx`, a shared chart path and the registry at once, so it wants its own serialized step.

## 22 — Show the intermission on every uptime graph

A reader currently sees a _gap_ where the fight took the target away, and has no way to tell it apart
from a gap the player caused. The scoring already knows the difference — step 4 made "down" the
complement of up minus `contactSegments`, and step 14 took the Fire Elemental's window out of the
Searing Totem denominator — but the picture does not show it. Draw it, faded, so "exempt" is visible
rather than inferred.

Cheap now: `WindowTracks` takes a variable row list, so this is one extra row per chart rather than a
rewrite.

- [ ] Add an intermission row to every uptime/downtime chart that does not have one:
      `FlameShockUptime`, `SearingTotemUptime`, and any track added later. `DebuffTimeline` already has
      its "away" row (`tone: 'muted'`) — that _is_ this concept, so it sets the precedent and the wording.
- [ ] **Pick one tone and use it everywhere.** There are currently two answers in the tree for "this
      stretch was exempt": `DebuffTimeline`'s away row uses `muted`, and `SearingTotemUptime`'s "Fire
      Elemental out" row uses `track`. Both read as faded grey, which is right, but two tokens for one
      meaning is the drift this plan keeps finding. Decide which, and change the other.
- [ ] **Decide whether "exempt" is one concept or two.** They are not obviously the same: an
      intermission is _the fight_ taking the target away, while the Fire Elemental holding the totem slot
      is _the player's own cooldown_ making the dot impossible. Both are exempt from scoring; a reader may
      still want them named differently. If they get one tone, they need two labels.
- [ ] The row must be drawn from the _same_ windows the denominator excluded — `complementOf(contact)` for
      an intermission, `feWindows` for the slot — and not recomputed, or the picture and the percentage
      will disagree about which seconds were forgiven.
- [ ] Order the rows so the exempt band sits behind the argument, not on top of it: up, down, then exempt.
- [ ] `widen: false` on the exempt row. It is a ground, not a mark, and widening a sliver of it would
      claim a phase break the fight did not take.
- [ ] Copy keys per chart, under each section's own prefix, following `searingTotem.track.elemental`.
- [ ] Validate: the render guard will move for the Windwalker only if the `muted`/`track` unification
      touches `DebuffTimeline`; if it does, that is a deliberate re-baseline. The Elemental charts have no
      render guard, so check them in the real app against `phased`, whose submerge at 142.3-192.5s is
      exactly what the new row should draw.

## 23 — "Late Refresh" is three different things

Reported: the Flame Shock press on the pull reads "Late Refresh" when it was the first application.
Confirmed, and it is not one bug but one label doing three jobs.

The audit collapses them (`elemental/lib/index.ts`):

```ts
remainingMs: fsTimeline.length === 0 ? null : remaining > 0 ? remaining : null,
```

and the section turns any `null` into `flameShock.state.late` (`FlameShock.tsx:31,39-40`), which also
sets `faulted`, which bands the row as a warning. So `null` means "no dot was up" and the copy asserts
"you refreshed it late" — three situations, one sentence, one of them an accusation.

Measured on the committed fixtures:

| pull       | press                 | what it actually was                                                                                                                              | shown        |
| ---------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `unbroken` | `t=1553`              | **the first application** — the dot's own window starts at 1553                                                                                   | Late Refresh |
| `phased`   | `t=2630`              | the first application                                                                                                                             | Late Refresh |
| `phased`   | `t=193052`            | re-applied after the **submerge** (142 282-192 534) — the dot expired while the boss was gone                                                     | Late Refresh |
| `phased`   | `t=91058`, `t=121512` | genuinely re-applied with the dot down — but the gaps are 888ms and 643ms, i.e. **below `DROP_MS`**, so the drop ledger already calls them jitter | Late Refresh |

`unbroken` is the sharpest case: a pull with one apply, six clean refreshes and 100% uptime is told it
refreshed late. Nothing on that pull went wrong.

- [ ] Split the states in the audit rather than in the copy. At least: **first application** (no window
      before this press), **re-applied after the fight took the target away**, and **late** (the dot was
      down while the player was in contact). A press below `DROP_MS` of downtime is jitter, not a fault —
      use the same threshold and the same contact clock `auraDrops` now takes, or the ledger and the table
      will disagree about the same instant.
- [ ] Only the third case may set `faulted`. The first two must not band the row as a warning.
- [ ] Copy: `flameShock.state.late` keeps its meaning; the two new states need their own keys. "First
      application" wants no grade at all — it is the opener, not a decision.
- [ ] The same shape almost certainly affects the Windwalker's Tiger Palm / Rising Sun Kick press tables
      and the Elemental's Searing Totem `remainingMs === null` rows. Check them before fixing only this one.
- [ ] Validate: `unbroken` must show **no** faulted Flame Shock press, and `phased` must show the submerge
      re-application as exempt rather than late. Both are assertions to add to `pulls.test.ts`.

## 24 — Validate the whole of it

The steps above each validated their own change. This one asks whether the branch, as a whole, is
right — the question no single step could answer.

- [ ] **Read the diff.** `git diff HEAD` is large and almost none of it has been reviewed by a second pair of eyes. Start with `src/lib/` — the core the two specs now share — and ask of every generalisation whether the Windwalker's behaviour is genuinely unchanged.
- [ ] **A real Windwalker pull, end to end.** The whole point of the shared core is that the Windwalker report did not change. Run one report through the app and compare it against `main`'s output for the same log: the same DPS, the same CPM, the same brew grades, the same miss ledger. Any difference is either a bug or a deliberate improvement that has to be named.
- [ ] **A real Elemental pull, end to end.** `rpM9JRABYcvPFbjL` f16 renders with no console errors, every section drawing, and the numbers sane against WarcraftLogs' own tables. Check the Searing Totem graph in particular: the Fire Elemental row where the elemental was out, and no "down" band under it.
- [ ] **The Elemental audit has almost no tests.** `searingTotem.test.ts` is the only one, added by step 14. Flame Shock, Earth Shock, Lava Burst, Lightning Shield, the snapshots and the two elementals are all unverified by anything but eyes on a report. Decide whether that ships.
- [ ] **`docs/conventions.md` is now wrong.** Its "Scope" section says one spec, one API host, and "do not add a `SpecDefinition` indirection" — which is precisely what this branch did. Rewrite it to describe the seam that now exists, or the next person will follow it back out.
- [ ] **Narrow viewports.** Every new Elemental section and chart at ~390px, per `docs/conventions.md`: measure `scrollWidth` against `clientWidth` in a 390px iframe rather than trusting a headless screenshot.
- [ ] **The two deploys, once.** Run `cloudflare-elemental.yml` from the Actions tab and confirm it creates the `elemental-analyzer` project, publishes, and that sign-in works there — which needs `https://elemental-analyzer.pages.dev` registered with WarcraftLogs as a redirect URI first. The workflows are asserted to be well-formed; nothing has proved they run.
- [ ] Validate: `npm run check` + `npm test` + `npm run build` from a clean `npm ci`, on Node 24 — the version CI uses, and not the one on the PATH here by default.
