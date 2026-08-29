# Every deliberate refusal to judge

An inventory of the rules that **exempt, withhold, suppress, refuse or narrow** what this report grades.
Gathered by walking the tree rather than by memory; every row carries its `file:line`, its constant, and
the reasoning the code itself gives.

It exists because these rules are the report's most valuable and least visible property. A metric that
grades is easy to find — it has a threshold and a card. A metric that _declines_ to grade leaves no mark
on the page, and the argument for why it declined lives in one docblock that nothing links to. Six of the
faults this project has shipped and fixed were verdicts invented about something the player could not
have done; the rules below are what was learned each time.

Two words are kept strictly apart everywhere, and the distinction is the spine of the whole design:

- **`exempt`** — the question was not asked at this target count. _An add wave is not a pull that failed
  to multi-dot._
- **`unmeasurable`** — the question was asked and the log could not answer.

`lib/score/model.ts:158-165` and `components/sections/Scorecard.tsx:78-91` both spell this out, and
`lib/compare/gap.ts:71` tests `exempt` **before** `unmeasurable` so a band exemption is never reported as
"the log could not say".

---

## The shape of it

```
                         WCL EVENTS
                             │
   ① TARGET / SPAWN FILTERS        a body leaves the evidence
   IMMUNE_HIT_TYPE 10 ▸ isJudgeableTarget ▸ minLifetimeMs 20 000
   ignoredMultiTargetIDs ▸ uncountedIDs(reach:'both') ▸ friendlyIDs
                             │  landedHits / targetPoints / aplTargetPoints
   ② CLOCK CUTS                    a second leaves the denominator
   contact ∖ enforced ▸ gradedSpans = ¬aoeWindows ▸ fsGraded ▸ stScored
   shieldSpans ▸ mdGraded (band 2, both edges) ▸ dischargeScoredMs
   graces: DROP_MS 1000 · leewayMs · SEGMENT_FLOOR_MS 8000
                             │  Measured{ value, gradedMs, sampleSize, part }
   ③ PER-PRESS "CANNOT SAY"        a press leaves the numerator
   EarthShockPress.good = null (bands 3–4) ▸ FlameShockPress.judged
   AscendanceReason ×5 → grade 'none' ▸ couldSnapshot ▸ unholdable
                             │
   ④ metricOf()                    lib/score/build.ts:162
   exempt ← gradedBands(rule, viewBands(view)).length === 0
   thin   ← gradedMs <= 0  OR  sampleSize < MIN_GRADED_SAMPLE (3)
   → unmeasurable: true · grade parked at 'ok' · exempt?: true
                             │
   ⑤ ENCOUNTER      ⑥ section()            ⑦ overallOf()
   1602/1622/1624   worst over DECIDED     unmeasurable weight drops out
   → 'suppressed'   PRIMARIES only         MIN_JUDGED_WEIGHT_SHARE 0.5
                             │
   ⑧ PRESENTATION
   silent() ▸ neverAsked() ▸ weight 0 ▸ TIE_BANDS 0.25 ▸ copy arms
```

---

## 1 · The single gate — `lib/score/build.ts`

Everything above funnels into `metricOf`, and it withholds a letter for exactly two reasons.

| line   | constant                        | withholds                                             | the code's reasoning                                                                                                                                                                                                                                              |
| ------ | ------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:40`  | `MIN_GRADED_SAMPLE = 3`         | any share over fewer than three events                | "At `whole` of 1 the only reachable values are 0 and 100… Neither scale has an interior, so the middle band is unreachable, and every grade such a metric can produce is one event away from a different one." Three is "the first denominator with an interior". |
| `:53`  | `Measured.gradedMs`             | a metric whose clock came out `<= 0`                  | "Zero grades nothing."                                                                                                                                                                                                                                            |
| `:74`  | `shareOf(part, whole)`          | applies the sample floor automatically                | "a floor of three milliseconds means nothing" for a count.                                                                                                                                                                                                        |
| `:89`  | `gradedOver(value, gradedMs)`   | applies the clock floor automatically                 | "what makes 'no stretch of this pull was gradable' reach the score at all, rather than arriving disguised as a perfect zero."                                                                                                                                     |
| `:103` | `MIN_CONTACT_SHARE = 0.5`       | whole-pull figures on a pull the player was barely in | "a figure measured over a third of a fight is a reading of that third, however the rest of the fight went."                                                                                                                                                       |
| `:137` | `presentEnough`                 | `gcdUtilisation` on low-contact pulls                 | "_**The defect this closes is that a pull the player was barely present for scores best.**_" A rank-0 Iron Juggernaut kill with two deaths read **94.52%** off 32.7s of contact on a 260s fight.                                                                  |
| `:171` | `exempt`                        | a metric whose bands never meet the pull's            | "The pull never entered the rule's bands, so the rule was never asked of it."                                                                                                                                                                                     |
| `:172` | `thin`                          | empty clock **or** thin sample                        | "`0ms of overcap` measured over `0ms` grades `good` if only the value is looked at — a free pass, and a worse answer than the honest 'cannot say', because it is a _reward_ handed to the pulls the exemption just excused."                                      |
| `:175` | `grade: 'ok'` when refused      | the letter                                            | "parked at `ok` so it neither flatters nor punishes the overall verdict."                                                                                                                                                                                         |
| `:210` | `section(primary, secondary)`   | secondaries from the section letter                   | "A section is as good as its weakest _primary_ metric — several weak signals on the same behaviour should not average each other into looking acceptable."                                                                                                        |
| `:254` | `MIN_JUDGED_WEIGHT_SHARE = 0.5` | the whole-pull letter under half the weight           | "past it the verdict is drawn from a minority of what the spec weighs, and a minority reading should not be printed as a whole-pull one." Read `>=`: exactly half is enough.                                                                                      |
| `:282` | `overallOf`                     | unmeasurable metrics from **both** halves             | "they do not silently count as half marks."                                                                                                                                                                                                                       |

Supporting shape in `lib/score/model.ts`: `Grade` has no fourth "cannot say" level (`:24` — "not a worse
verdict than `bad` nor a better one than `good` — it is not on the scale at all"); `Metric.gradedMs`
(`:138`) is "the field that keeps an exemption from becoming a free pass"; `Metric.exempt` (`:165`) says
"the question was not asked".

---

## 2 · Band scoping — which target counts a rule is a claim about

Rarer than you would guess: **9 declarations across three specs.**

**Elemental** (`specs/elemental/lib/score.ts`), 8 of 19 rules:
`flameShockUptime` `[1,2]` `:948` · `flameShockWaste` `[1]` `:990` · `lavaSurgeWaste` `[1,2]` `:1024` ·
`flameShockMultiDot` `[2]` `:1065` · `earthShockWaste` `[1,2]` `:1085` · `elementalDischargeUptime`
`[1,2]` `:1107` · `searingTotemUptime` `[1,2]` `:1138` · `lightningShieldOvercap` `[1,2]` `:1389`.
(Every line number in this list was stale before this entry was added; they are re-read here.)

`lavaSurgeWaste` is the one of the eight whose band cut is in the **numerator only**: the share it grades
is the surges the player threw away over _every_ proc the fight handed out, because a proc an add wave
forgave is still a free cast that was offered. What the cut decides there is the sample gate rather than
the denominator (`LavaBurstAudit.judged`), which is what keeps the rule from grading a clean `good` on a
pull whose every proc the exemption excused. That failure mode is §4's, one file along.

The reasoning is the same shape each time — the aoe list does not contain the rung:

> "`aoe.apl.json` … carries **no Lava Burst rung at all**, so the cascade a dropped dot costs does not
> exist above two enemies. A 95% clock is not that rule stated in percent."

`flameShockMultiDot` is the only entry with a hole in the middle: excluded at band 1 because there was no
second target, and at band 3+ because the list stops asking.

**Windwalker** — one: `tigerPalmWaste` `[1]` (`score.ts:801`). "This is the _only_ threshold in this table
that gets a band, and the test the others fail is one sentence: the resource or the opportunity has to
exist differently at different target counts."

**Protection** — none, by design (`score.ts:1-19`): "this grades two things, and only two, because they
are the two whose lines can be defended… Everything else the report measures is described rather than
judged."

A declaration alone often changes nothing — `cleave` visits every band, so it intersects non-empty. The
narrowing that bites is a **counter** beside it: `tigerPalmShare`, `EarthShockAudit.judged`,
`unjudgedRefreshes`.

---

## 3 · Clock cuts — seconds removed from a denominator

Twenty of them. The load-bearing one is Elemental's `gradedSpans = complementOf(aoeWindows, duration)`
(`index.ts:2303`), hoisted once and shared by five clocks, with `gradedContact` (its intersection with
the contact clock) hoisted beside it for the three that wanted both:

> "**each cuts both halves of its own ratio with this same array.** Clipping a numerator and not its
> denominator is how a percentage above 100 happens."

| where                 | cut                                          | measured effect                                                                                                                  |
| --------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `analyseCore.ts:1008` | `contact ∖ unavoidableWindows(enforced)`     | "_**A stun is not a missed global, and until now every spec but one was charged for it.**_"                                      |
| `analyseCore.ts:1301` | `aoeWindows` trimmed by one trailing window  | 28 378ms of `cleave`'s exempt total was boss-only time being forgiven; 109 869 → 82 858 ms                                       |
| `elemental:2419`      | `fsGraded`                                   | `cleave` dot uptime 72.30% → **83.90%** — "still `bad`… the point of the cut was never to make the number pass"                  |
| `elemental:3024`      | `mdGraded`, band 2 with an edge at both ends | clock 148 865 → 66 007 ms                                                                                                        |
| `elemental:3664`      | `shieldSpans`                                | on four shamans in one Galakras kill: 18.4%, 43.9%, 65.1%, 7.5% of the overcap clock was time with nothing to spend on           |
| `elemental:4063`      | `stScored` — three exempt causes composed    | 78.72% → **88.50%**, `ok` → `good`                                                                                               |
| `protection:253`      | `enforcedGlobals`                            | "a pull with 329 presses graded flawless because the arithmetic could not see that 93 presses happened **inside** those windows" |

Graces, all with measured justification: `DROP_MS = 1000` (`auras.ts:67`, "refresh jitter… reported as a
drop is a fault the pull did not have"), `SELF_EVENT_MS = 250` (`:57`, "The first run of the Tiger Palm
metric called 15 of 33 presses wasted; with this guard the real answer was 0"), `SEGMENT_FLOOR_MS = 8000`
(`segments.ts:84`, swept: "4s… too short — `MIN_GRADED_SAMPLE` is 3, and 4s is three globals"),
`counterWindowsIn`'s leeway restarted per segment (`counters.ts:69`, worth 4 500ms on `cleave`).

`auraDrops` (`auras.ts:485`) forgives **the single longest gap** without an `away` array — "on a
single-phase pull, the one real drop a player made is the largest gap there is, and the ledger goes
silent about it."

---

## 4 · Encounter suppression

`lib/reference/specProfile.ts:52` — `SUPPRESSED = [1602, 1622, 1624]` (Immerseus, Galakras, Norushen),
applied to `gcdUtilisation` alone:

> "Measured rather than judged: median contact share is 77.7% on Immerseus, 82.7% on Galakras and 85.0%
> on Norushen, against 94% or better on the other eleven. All three take the player out of contact by
> design."

Spec-independent on purpose — "A submerge stops a monk and a shaman alike." **The figure still prints;
only the letter is withheld** (`profile.ts:106`), and the `legacy` arm does not suppress at all
(`:225`) because "`legacy`'s whole claim is that it makes no judgements".

`lib/analysis/enforced.ts` carries 7 lockout rules across 3 of 14 Siege encounters — "**Downtime is
excused only when the fight enforces it.** Not when it is hard, not when the boss is moving… Berserker
Stance on Nazgrim is not an excuse for anything." One rule is marked `dodgeable` and therefore **refuses**
the exemption: "A stun that lands because the player stood in it is a play, and crediting it would pay
for the mistake." Eleven encounters carry empty rule lists — "a different statement from absence".

Only Protection takes enforced credit. Windwalker and Elemental "grade their idle time with no excuses".

---

## 5 · Target and spawn filters

`IMMUNE_HIT_TYPE = 10` (`targets.ts:44`) was established by counting, not guessed: "all 27 events that
actor ever receives are type 10." The rule is about the **unit, not the event** (`:61`) — a unit immune
for a phase and killable later stays a target for the whole pull.

`isJudgeableTarget` (`:202`) drops immune units always, and short-lived ones when a caller passes a
lifetime. Elemental sets `FS_SECOND_TARGET_LIFETIME_MS = 20_000` — two thirds of the dot's own duration,
where the global pays itself back:

> "It cuts both ways… charging them for the omission invents a fault they could not have avoided — and
> crediting the _application_ is just as wrong. Below this bar the report says nothing either way."

And one place deliberately **omits** the filter (`elemental:2953`): the wasted-global count over secondary
applications, because "the adds the filter drops are exactly the ones a wasted global was most likely
spent on. Applying it would hide the finding."

Also here: `IGNORED_MULTI_TARGET_ACTORS` (Blackfuse Shredders — "a tank fights one alone, which is not a
pack"), the `SIEGE_RANKING_EXCLUSIONS` rows that reach the enemy count (§6 below has the whole ruleset),
friendly-target exclusion (`analyseCore.ts:1082` — "the second-busiest 'enemy' was actor 1, a friendly
paladin"), and `aplTargetCountExclude` for a spec's own area damage.

---

## 6 · The Siege of Orgrimmar ruleset — the only refusals written by someone else

Every other section on this page is a judgement this codebase made. This one is a transcription.
WarcraftLogs published its Siege parsing rules in a single article on **3 June 2026**, the day before the
raid opened, and `lib/game/rankingExclusions.ts` is that article as a lookup.

The article is served on two hosts, byte-identical:

- `articles.classic.warcraftlogs.com/news/siege-of-orgrimmar-on-warcraft-logs`
- `www.archon.gg/classic-mop/articles/news/siege-of-orgrimmar-on-warcraft-logs`

The file's header is explicit that the second is not the weaker citation — "Archon is WarcraftLogs'
articles platform rather than a third party rewriting them". The Wowhead write-up is downstream of both
and introduces its copy with "Warcraft Logs said:".

### The keying, and what it costs

Rules are keyed by **encounter + NPC**, with `gameID` authoritative wherever a pull has supplied one and
the transcribed `npc` string carried alongside it — because "the ruleset is _written_ in names, so a name
has to be carried too or there is nothing to check the transcription against".

`baseEncounterID` (`:121`) reduces the id modulo 50000. Classic re-registers every boss for every
re-release, and Siege has three registrations: Garrosh is `1623` on retail, `51623` on classic, `101623`
on the re-release. One rule, written once, holds for all three. `HEROIC_DIFFICULTY = 4` gates the eleven
rows whose sentence opens with the article's bolded "On Heroic:".

**A name-only match is not safe, and Garrosh proves it inside the table itself.** The ruleset names
`Desecrated Weapon`; the log carries that unit (72154) and `Empowered Desecrated Weapon` (72198), which
is the empowered form of the same weapon and so falls under the same rule. Nothing about the two names
says that — an exact match takes one and leaves the other, a substring match takes both and would take
anything else sharing a word — so both are carried as rows keyed on their ids, and what binds them is
knowledge of the encounter rather than anything a matcher could derive. Thok is the mirror image, and the
one the table cannot fix — the rule names `Starved Yeti`, the reference pull's
captive was a `Captive Cave Bat`, "so the rule as written excludes one of the three captives and not the
others. Matching by `gameID` avoids the first trap and cannot help with the second."

### The thirteen rows, and the three values of `reach`

| encounter         | NPC                   | gameID | heroic | `reach`    |
| ----------------- | --------------------- | ------ | ------ | ---------- |
| Fallen Protectors | Despair Spawn         | 71712  | ✓      | `damage`   |
| Fallen Protectors | Desperation Spawn     | 71993  | ✓      | `damage`   |
| Dark Shamans      | Darkfang              | 71921  | ✓      | `damage`   |
| Dark Shamans      | Bloodclaw             | 71923  | ✓      | `damage`   |
| Dark Shamans      | Foul Slimes           | 71825  | ✓      | `null`     |
| Malkorok          | Living Corruption     | 71644  | ✓      | `damage`   |
| Thok              | Kor'kron Jailer       | 71658  | —      | `damage`   |
| Thok              | Starved Yeti          | —      | —      | `null`     |
| Paragons          | Amber Parasites       | —      | ✓      | `null`     |
| Paragons          | Blood                 | 71542  | ✓      | **`both`** |
| Garrosh           | Desecrated Weapon     | 72154  | ✓      | `damage`   |
| Garrosh           | Manifestation of Rage | —      | ✓      | `null`     |
| Garrosh           | Minion of Y'Shaarj    | 72272  | ✓      | **`both`** |

- **`both`** (2 rows) — the damage does not count _and_ the body does not raise the enemy count. Reserved
  for units where "the player was never fighting this unit: the hits are splash". Blood: 13 hits across 3
  spawns, no aimed press, longest contact 2.1s, ten of the thirteen Spinning Crane Kick.
- **`damage`** (7 rows) — struck from the damage, **kept in the count**. "An add whose damage is
  discounted was still a body in front of the player, and the rotation had to deal with it." The Kor'kron
  Jailer is the clearest: 157 hits over a contiguous 39.6s, 60 aimed presses, 42 of them melee.
- **`null`** (4 rows) — "a real value and not a hole to be filled in later: it means nobody has evidence
  either way". Foul Slimes is `null` because the two readings genuinely disagree, and the row says so in
  the file: `*** The two readings disagree, so this one is not decided. ***`

There is no `'count'`-only member "because no rule in this ruleset produces one — every entry here begins
life as a damage-ranking exclusion".

Living Corruption is the one row that has already moved. It read `both` on the reference clear; a second
pull of the same boss (`uncounted.json`) held four of twenty bodies past a target window, and the table's
own bar for `both` — "only where **neither** fact is present" — disallowed it. It is `damage` now, "and
this pull publishes a peak of three enemies where it published one".

### The four rule kinds that are not rows, and the two that became code

The article carries four other kinds of rule, and "none of them can be a row in a table keyed by NPC":

1. **Removed from All Star Points** — Immerseus, Norushen, Sha of Pride, Galakras, Spoils. A
   ranking-eligibility fact about a whole encounter, not a statement about any NPC.
2. **Pull conditions** — Nazgrim's Orgrimmar Faithful reset, and "bringing trash into bosses is not
   allowed". Rules about how the pull was performed. "A lookup that pretended to answer them would be
   encoding a condition it cannot check."
3. **Conditions on the unit rather than its name** — Paragons' "damage done to any Paragon that heals to
   full is excluded", Garrosh's "damage done to adds that don't die is removed".
4. **Re-attribution** — Amber Scorpion, Tricks of the Trade, Stormlash Totem, Skull Banner. "The damage is
   not removed, it moves to a different actor", so nothing here needs a row.

**The third kind is now implemented**, in `lib/game/conditionalExclusions.ts` — not as rows but as two
walks over the log:

- **Paragons — "any Paragon that heals to full".** Read off the health samples the player's own damage
  events carry, which is the only enemy-side health reading in the dataset. A Paragon is the report's own
  `subType: 'Boss'`, which means no gameID had to be transcribed: on the reference kill the nine bosses
  _are_ the nine Paragons, and `Blood` and `Hungry Kunchong` are not. Six of the nine top off at least
  once. The strike is bounded at the **last** top-off, not the first — the damage after it is the damage
  that finished the unit — and it removes **17.75% of that pull's damage**, the largest single exclusion
  in this codebase.
- **Garrosh — "adds that don't die".** An add the player damaged with no death of its own. It finds
  exactly one spawn on the committed kill: actor 515 instance 2, gameID **72198** — the
  `Empowered Desecrated Weapon`, which the static table now carries a row for in its own right. The two
  mechanisms reach it on different grounds: the row because the ruleset's rule for the weapon covers its
  empowered form, this rule because the add was still standing at the end, which is a property of the
  pull rather than of the article. Without `enemyDeaths` in the
  dataset the walk returns nothing rather than concluding nothing died: "every add on the pull would read
  as a survivor, which is the widest possible strike rather than the safest one."

Both are gated to heroic, and that gate is **inferred rather than read**: neither quote was transcribed
with the "On Heroic:" marker, so the gate is taken from the neighbours — every other Siege rule on both
encounters is heroic-only — on the grounds that "changing less is the safe half of an unknown".

### What a struck hit actually costs, and the measurement that says "almost nothing"

`excludedDamageActorIDs` (`:352`) is the reader `reach: 'damage'` never had. For as long as
`uncountedActorIDs` was the only consumer, the seven `damage` rows were **inert** — the field said
WarcraftLogs strikes the damage and nothing in this codebase struck anything.

Struck hits are now taken out of the **contact clock** and nothing else. `damageEvents` is deliberately
not filtered, so a struck add still raises the target count and still puts the pull in the band its adds
earned — which is exactly what the `reach` rows argue for. Those rows are an argument about the _count_;
what they never argued is that the same hits should be the evidence a stretch of pull gets _graded_ on.

**And the honest measurement is that this changes nothing on any pull we hold.** Four committed fixtures
carry strikes, 878 landed hits between them, and the contact clock is identical to the millisecond before
and after:

| fixture                            | struck hits | contact before | contact after |
| ---------------------------------- | ----------- | -------------- | ------------- |
| `windwalker/uncounted.json`        | 63          | 209 935 ms     | 209 935 ms    |
| `protection/fallenProtectors.json` | 100         | 179 898 ms     | 179 898 ms    |
| `protection/garrosh.json`          | 52          | 474 526 ms     | 474 526 ms    |
| `protection/paragons.json`         | 663         | 377 853 ms     | 377 853 ms    |

`engagedWindows` only splits a window on a gap longer than `ENGAGED_GAP_MS` — fifteen seconds — and on
every one of these pulls the struck hits are interleaved with kept hits far more tightly than that. The
exemption fires only where a player spends more than fifteen seconds on struck units _and nothing else_,
which is the Thok-shaped pull (39.6s alone on a Jailer) that is not in the fixture tree.

So the cost is real but currently unpaid, and the reason is structural: **nothing in the score reads
damage amounts.** Damage reaches the letter through the enemy count, through the contact clock, and
through nothing else. A ruleset that removes damage therefore has almost no surface to act on here, and
saying so is more useful than a number that moved.

---

## 7 · Per-press "cannot say"

`EarthShockPress.good: boolean | null` (`types.ts:3105`) — null at bands 3 and 4, because the aoe list has
no Earth Shock rung. "Read it as 'cannot say', never as 'fine': `press.good === false` is the fault
ledger's test and `!press.good` is not."

`FlameShockPress.judged` is band 1 only (`elemental:2829`) — band 2's rung "carries neither p5's snapshot
reapply nor its Ascendance prep… The excuse set is wrong in _both_ directions at band 2."

Five `AscendanceReason` members (`ascendance.ts:461`) each give a press `grade: 'none'` — "a pull that
never offered the chance has not failed to take it."

Windwalker's proc classifications do the same work: `SNAPSHOT_STACK_FLOOR = 4` ("**The sim does not
contain this rule**… it only ever _excuses_ procs, so it can never invent a fault"), `unholdable`,
`couldSnapshot`, `redundant`, `wastedProtecting`.

---

## 8 · Refusals that are not `metricOf`'s

**Weight zero — measured, shown, uncounted.** Six metrics: `snapshotDepth`, `weaveEarly`,
`weaveLateReturn`, `karmaEmpty`, `karmaCapShare`, and Protection's `externalsMissed` /
`hasteToBreakpoint`. `snapshotDepth`'s reason is the sharpest: "The pull that missed six of its eight
chances is the one this rule praises for its timing."

**Sample floors deliberately _not_ applied** — `snapshotDepth` and `brewStacks` (`windwalker:297`,
`:374`): "**The floor's own argument does not reach a mean.**… A declaration that presents as a control
and controls a sixth of the set is the failure this project has already shipped twice."

**`bad` unreachable by design** — `fireElementalPrepull {good:1, ok:0}` (`elemental:1123`): "Three of this
audit's bugs so far were faults invented by charging a player for something they could not have done, and
a `bad` band here would have been the fourth."

**A refusal reversed** — `lightningShieldFellOff`'s `NEVER_UP` (`elemental:509`): a shield never worn is
graded at the bottom of the scale rather than refused, because "refusing also _paid_ — the pull left
`overallOf`'s denominator two points lighter and came out `good` overall."

**Presentation** — `Scorecard.tsx` hides a fault-counting row at zero (`silent()`, only where `good` is
zero) and an exempt row entirely (`neverAsked()`), while keeping merely-unmeasurable rows because "'we
asked and the pull could not answer' is information a reader can act on."

**Comparison** — `TIE_BANDS = 0.25` (`compare/gap.ts:26`): "what it must not be is zero, which would
report a leader on every metric where two players differ in the sixth decimal place." Across 146 metric
pairs, not one is called level while the two pulls hold different grades.

**Measured and published but never graded** — `badSpends` ("Grading it a second time here would mark one
mistake down twice"), `earlyThunderstorms`, Lava Burst with the dot down, Storm/Earth/Fire, potion
timing, Clearcasting, and the whole Rotation section of each spec.

---

## Counts

|                                           |                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Shared metric-refusal gates               | 20                                                                                              |
| Band declarations on scored rules         | 8 — 7 Elemental, 1 Windwalker, 0 Protection                                                     |
| Distinct clock cuts                       | 20                                                                                              |
| Encounter suppressions                    | 3 ids for `gcdUtilisation`; 7 enforced rules over 3 of 14 encounters (1 refused as `dodgeable`) |
| Siege ruleset rows                        | 13 — 7 `damage`, 2 `both`, 4 `null` (undecided); 11 heroic-only                                 |
| Siege rules evaluated over the pull       | 2 — Paragons' heal-to-full, Garrosh's adds-that-don't-die                                       |
| Siege rule kinds deliberately not encoded | 2 of 4 — ASP removal and pull conditions (re-attribution needs no row)                          |
| Per-press null verdicts                   | 5 `AscendanceReason` + `EarthShockPress.good` + `FlameShockPress.judged` + 4 proc classes       |
| Metrics at weight 0                       | 6                                                                                               |
