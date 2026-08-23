# Tone-of-voice migration

Working plan for the reader-voice pass across every user-facing string. Tracked rather than left in a session, because the work is phased, the phases have an order that carries meaning, and the previous three attempts at this complaint each lost what the one before it had learned.

**Status:** planned, not started. **New here? Read "Before you start" below first** — it covers the dirty tree this was planned against, how to load the voice skill, and which sweeps already returned nothing. Do not begin a phase without reading the one before it; Phase 2 and Phase 3 in particular are a red-then-green pair and are meaningless apart.

| #     | Phase                                                         | State         | Ships as                                     |
| ----- | ------------------------------------------------------------- | ------------- | -------------------------------------------- |
| 1     | Record the standard (`docs/conventions.md`, README staleness) | ☐ not started | own PR                                       |
| 2     | Widen the guard vocabulary — **deliberately red**             | ☐ not started | PR with Phase 3, commit 1                    |
| 3     | Fix the copy — green                                          | ☐ not started | PR with Phase 2, commit 2                    |
| 4     | Front-load the two worst verdict families                     | ☐ not started | own PR                                       |
| 4b-i  | The construction + density classes (locale)                   | ☐ not started | own commit                                   |
| 4b-i  | `bell` in source comments (179 sites)                         | ☐ not started | **separate commit**                          |
| 4b-ii | Read-through + density splits, 44 sections                    | ☐ not started | own PR, iterative — **the bulk of the work** |
| 5     | `ui.json` under the guard; centralise auth + errors           | ☐ not started | 5a then 5b, own PR                           |
| 6     | The `WclError` messages                                       | ☐ not started | own PR, needs a design                       |

When a phase lands, tick it and record what it actually found — especially in 4b-ii, whose whole premise is that it will find classes this document does not yet name.

---

# Before you start

Read this section fully. It is written for an agent picking the work up cold.

## 1. The tree was dirty when this plan was written (2026-08-23)

`git status` at planning time showed **another lane in flight, touching the same file this migration edits**:

```
 M src/lib/i18n/__tests__/keys.test.ts
 M src/locales/en/report.json          ← the migration's main file
 M src/specs/elemental/lib/__tests__/{clearcasting,earthShockAoeBand,flameShockBand}.test.ts
 M src/specs/windwalker/components/sections/{RisingSunKick,SnapshotTable}.tsx
 ?? src/specs/windwalker/components/sections/__tests__/zzBYprobe.test.ts
```

The `report.json` changes add `verdict_tooFew` and `verdict_noContact`, and flip `earthShock.verdict_{ok,bad}` from _"the table below"_ to _"the table above"_ — which **overlaps the UI-deixis class below**. `zzBYprobe.test.ts` is a leftover measurement probe of the kind `.gitignore` describes for `probe*.config.mjs`.

**Do not start on top of this.** Establish whether that lane has landed, then re-run every count in this document before trusting one — the numbers were measured against the tree as it stood, and `report.json` has moved since.

## 2. Load the voice skill before writing a single string

The standard lives at `.claude/skills/tone-of-voice/`. **It was untracked at planning time** (`?? .claude/skills/tone-of-voice/`) — Phase 1 tracks it. If it is missing from your checkout, that phase has not landed and you should do it first.

Invoke with the Skill tool, `skill: "tone-of-voice"`, or `/tone-of-voice`. It takes three modes: `audit` (paste content to check), `show` (display the profile), `capture` (build or update it).

Two files matter, and you need both:

- **`SKILL.md`** — the universal layer, sections 1–7. §1 sentence rhythm, §2 banned words, §3 openers, §4 closers, §5 register, §7 person, §15 self-check.
- **`references/audience-wow-players.md`** — the audience register, measured from **18,889 words of Wowhead MoP guide prose across 12 pages and 6 authors**. This is the file that makes the output sound like it is for WoW players rather than merely un-robotic. **Load it for every copy edit in this migration**, and read its author-spread column — a marker used by 1 of 6 authors is that writer's tic, not the genre.

Three rules from the skill that change how you use it:

1. **Sections 8–13 are deliberately `[not captured]`.** There is no personal voice profile. Output is **voice-neutral** by design. Never fill a blank slot with a guess — a guessed voice is worse than an honest generic one.
2. **Run the voice pass LAST, never alone.** De-AI first (banned words, structure), then voice. Reversed, the later pass strips the habits that make the writing specific.
3. **The universal layer is a floor, not a preference.** Where this repo's house style contradicts it, or where the audience corpus contradicts the universal layer, the override must be written down. Five exist so far:
   - **em-dashes** — kept, against both `SKILL.md` §15 and the corpus (6 instances in 18,889 words; the genre uses parentheses)
   - **`very`** — banned, though 6/6 corpus authors use it (243/100k)
   - **`however`** — banned, though 4/6 authors use it
   - **`we`/`our`** — banned, though 6/6 authors use editorial first-person plural (349/269 per 100k). `I` is genre-absent and needs no override.
   - **`bell`** — removed from reader copy _and_ source comments, though it is this codebase's own habit (179 sites)

   An override is only safe while its reason is written next to it. Every one of these looks like a mistake to someone who checks only one of the two sources.

`references/voice-capture.md` and `scripts/person-density.py` are deliberately **not** tracked. The first is an interview procedure for the empty sections.

**⚠ Do not run `person-density.py` as a gate on this repo's copy.** It encodes `SKILL.md` §7, which is written for personal long-form and assigns first person to the opening and method blocks. Verified: a clean four-sentence second-person report draft fails it with _"no author present"_ and _"opening carries no author"_, and `--strict` exits 1. That is **inverted for this genre** — six independent guide authors wrote 18,889 words with zero first-person singular. An agent that runs it as a gate and fixes the failures will insert an author into a report that must not have one. `references/audience-wow-players.md` §2 carries the full override.

**The source corpus is gone, by design.** The Wowhead prose it was measured from was not retained — the skill's own rule is that patterns leave the material and the raw text does not. Every rate you need is baked into `references/audience-wow-players.md`. If you need a new measurement, re-fetch the guides; that file's provenance section names all 12 pages and the URL pattern.

## 3. Repo orientation

| what                 | where                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| all analysis prose   | `src/locales/en/report.json` — 1,182 leaves, both specs, one flat namespace                                                                  |
| all shell prose      | `src/locales/en/ui.json` — 51 leaves, roots `app` `chart` `common` `credits` `selection` `settings` `steps`                                  |
| the sentence builder | `src/hooks/useReportCopy.ts` — `verdict(section, values)` → `t('<section>.verdict', {context: grade})`, grades `good\|ok\|bad\|none\|exempt` |
| the voice guard      | `src/specs/__tests__/readerVoice.test.ts`                                                                                                    |
| key contracts        | `src/lib/i18n/__tests__/keys.test.ts` (missing keys **and** ui orphans), `copyPrefix.test.ts`, `copy.test.ts`, `formatters.test.ts`          |
| the governing doc    | `docs/conventions.md` §"Copy, and how a report says anything" (~line 253)                                                                    |
| render harness       | `src/pages/preview.astro` → `npm run dev`, `/preview`                                                                                        |

The rules already on the books that this migration enforces rather than invents: _"No English sentence belongs in a component"_ (`conventions.md:255`), _"Numbers in sentences go through the JSON"_, _"Pluralise with `count`"_, _"Ability names stay out of the locale"_ (`:288`), _"Never hard-code a finding into report prose"_ (`:297`), and _"The comments in the engine are load-bearing"_ (`:245`).

## 4. Re-measuring — every number in this document

Numbers here were measured on 2026-08-23 and `report.json` has changed since. Re-run before relying on any of them. This snippet is the base every measurement used:

```python
# python3 - <<'EOF'   (run from the repo root)
import json, re, collections
leaves = []
for f in ('report', 'ui'):
    d = json.load(open(f'src/locales/en/{f}.json'))
    def walk(n, p):
        if isinstance(n, str): leaves.append((f, p, n))
        elif isinstance(n, dict):
            for k, v in n.items(): walk(v, f'{p}.{k}' if p else k)
    walk(d, '')
# prose only — excludes headers, chips and table cells
prose = [(p, v) for f, p, v in leaves if len(v.split()) >= 8]
L = sorted((len(v.split()), p, v) for p, v in prose)
print(len(leaves), 'leaves;', len(prose), 'prose')
print('words/string — median', L[len(L)//2][0], 'p90', L[int(len(L)*.9)][0], 'max', L[-1][0])
# EOF
```

From that base: sentence-length stats split on `(?<=[.!?])\s+` with `{{…}}` normalised to one token; the boilerplate scan splits each string on `[.;—]` and counts clauses of ≥7 words appearing in more than one key; the idiom and construction sweeps are `re.search` over each leaf. The guard's own `prose()` helper strips placeholders the same way — reuse it rather than writing a third stripper.

## 5. Do not re-discover these

Each cost a sweep and returned nothing. They are recorded so the next lane does not spend the same time:

- **Stock clutter is absent.** Zero `in order to`, `due to the fact that`, `a number of`, `the majority of`, `what this means is`, `each and every`, `is able to`, expletive `there is… that`, `begin to`, double hedges. A fluff-word phase would find 8 strings total.
- **AI vocabulary is absent.** Zero §2 banned words, zero formal connectors, zero `I`.
- **The economic family** (`bought`, `pays`, `costs`, `spent`, `worth` — 160 strings) and the mana `starved`/`strained` family (21) are **in-domain and correct**. They will dominate any naive sweep. Not findings.
- **The em-dash is ruled, not pending.** 240 instances, kept.
- **`oxfmt` does not bind string edits.** See Non-constraints.
- **A source-scanning voice linter was considered and rejected.** Reasoning under Explicitly out of scope.

## 6. Done means

A phase is done when: its own verification block passes; `npm run check` and `npm test` are green; the status table at the top is ticked with a one-line note of what it actually found; and any new class discovered is written into `docs/conventions.md` **and** added to this document, so the next agent inherits it. Phase 4b-ii in particular is expected to find classes this plan does not name — recording them is part of the work, not overhead.

---

## Context

A tone-of-voice skill was installed at `.claude/skills/tone-of-voice/` — a universal anti-AI-prose layer plus an audience register block measured from 18,889 words of Wowhead MoP guide prose across 12 pages and 6 authors (the guides this report's readers already read). The task was to analyse this repo's user-facing text and plan a migration toward that standard.

**The first finding was that there is very little AI vocabulary to migrate.** Measured across the 524 prose leaves of `src/locales/en/report.json` (927 sentences; headers, chips and table cells excluded):

|                                                  | measured           | SKILL.md §1 target | Wowhead genre  |
| ------------------------------------------------ | ------------------ | ------------------ | -------------- |
| median sentence                                  | 17 words           | 11–14              | 18             |
| past 25 words                                    | 22.4%              | ~15%               | 24.7%          |
| §2 banned vocabulary                             | **0**              | 0                  | —              |
| formal connectors (however/moreover/furthermore) | **0**              | 0                  | 6 (`however`)  |
| `I`                                              | **0%**             | —                  | 0              |
| `we`/`our`                                       | 0.2% of sentences  | editorial only     | editorial only |
| `you`/`your`                                     | 34.2% of sentences | dominant           | dominant       |

The copy overshoots the length target but beats its own genre by a wide margin, and there is no captured personal voice profile (SKILL.md sections 8–13 are deliberately `[not captured]`), so a wholesale rewrite would move specific, good copy toward a **voice-neutral** target. That is the argument against blind volume, and it still holds.

**But "clean of the tells we grepped for" was too generous a verdict.** Reviewing this plan, three defects were named in a few minutes that every automated sweep had passed: _"before the bell"_, _"what, if anything, was wrong with its placement"_, and _"press it as the bar reaches the line"_. All three are **constructions, not vocabulary** — a metaphor, a hedged interrupter with a nominalization, and a widget standing in for a game cue. No word list finds any of them, and the classes documented below were found only by going looking once a human named the first one.

The structural conclusion, which sets the shape of this plan: **the defect classes are unbounded, so the guard lists are a ratchet and not the deliverable.** The deliverable is Phase 4b-ii, a section-by-section read-through, with the classes below as its checklist and the expectation that it finds more.

**What the measurement found that is worth more than the tone work:**

1. **A correctness bug.** `casts.verdict_bad` appends _"Nearly a third of the pull produced nothing useful."_ to every bad grade. `gcdUtilisation` bands are `good: 85, ok: 75` (`src/specs/windwalker/lib/score.ts:390`), so `bad` is anything under 75% — at 40% used, the sentence claims a third while the number printed beside it in the same sentence says 60%. This is `docs/conventions.md:297`'s own named bug ("a sentence describing one log's pattern as 'bimodal' once printed on every later report regardless of its data") shipped again, in the sentence a section is judged by.
2. **Seven `verdict_*` families open with 60+ identical characters across good/ok/bad.** Worst two verified: `lightningShield.verdict_*_noOvercap` diverges at character **354**, `searingTotem.verdict_*_noUptime` at **292**. A player graded red reads sixty words of method — _"…is not measured on this reading — switch the reading with the control at the top of the page if you want it counted"_ — before one word about their pull. §1 "start with the point" and §15.12 "could anyone else have written this" failing together.
3. **`MODEL_WORDS` is evadable by one word.** It contains `the list`; `summary.takeaways.metric.energizingBrewRjw.fix` says _"the priority list allows this combination"_ and passes while in scope of the sweep.

---

# The construction classes

## Idiom — metaphor reaching outside the game

The audience register file §5 measured the analogy domain as **cross-class comparison only**: no sport, cooking, machinery, money or weather pictures anywhere in 18,889 words of the readers' own guide prose, across all 6 authors. A vocabulary grep finds words; it cannot find a figure of speech. Swept all 1,235 leaves against ~45 idiom patterns. Three families hit, 11 strings:

| idiom                                   | strings | corpus rate          |
| --------------------------------------- | ------- | -------------------- |
| `the bell` (before / at / when it went) | **8**   | **0**, all 6 authors |
| `on the table`                          | 2       | **0**                |
| `in the same breath`                    | 1       | **0**                |

What the corpus says instead: _"Use Virmen's Bite before pull"_, _"can safely be cast before pulling"_. Plain — and this repo already uses it. `summary.takeaways.metric.fireElementalPrepull.fix` says _"was not out when the pull started"_ and _"in the last second before the bell"_ in adjacent sentences. Same referent, two registers, one string. **That internal inconsistency is the strongest argument in the class**, stronger than the register point.

`bell` is a pervasive authorial habit rather than a slip: **179 uses outside the locale** — `src/specs/*/lib` 102, `src/lib` 38, `src/specs/*/components` 12, `src/components` 6, and 20 in `docs/plan.md` — every one a comment, docblock or test-prose line, and none in `README.md`, `CONTRIBUTING.md` or `docs/conventions.md`. **Decision: fix all of them, comments included.** `docs/plan.md` is excluded (gitignored scratchpad, no reader).

## Audit register — hedged interrupters and nominalizations

From `fistsOfFury.caption`: _"Every Fists of Fury channel and what, if anything, was wrong with its placement"_. Two defects in one line — a hedged mid-sentence interrupter (`what, if anything,`) and a nominalization standing in for a verb (`its placement` for _where you put it_). This is the register of an audit form, not of someone describing a pull.

Corpus rates: `if anything` **0**, `what was wrong` **0**, `placement` **0**, `application` **0**, `usage` **2** — and both `usage` hits are section _headings_, not body prose.

Swept: hedged interrupters = **1 string**; nominalization nouns = **10 strings**. Clean at zero: `the fact that`, `in terms of`, `with respect to`, passive `was …ed by`, expletive `there is/are … that`.

**Labels are not defects.** `docs/conventions.md` and the register file §3 both rule that a value in a table cell, an axis label or a KPI tile is not a sentence. `flameShock.state.apply` (_"First application"_), `searingTotem.state.fresh` (_"Fresh placement"_) and `searingTotem.state.late` (_"Late placement"_) stay as noun phrases — that is what a label is.

**Five to fix**, where a nominalization replaces a verb inside a real sentence: `fistsOfFury.caption`, `fistsOfFury.energyCaveat`, `searingTotem.caption`, `sef.lanes.chartLabel`, `flameShock.snapshotNote`.

## UI deixis used as an in-game cue

From `summary.takeaways.metric.thunderstormMissed.fix`: _"…press it as the bar reaches the line"_. The player's cue in game is a mana percentage; the bar and the line are **this report's own furniture**. The same string already carries the real cue — _"at or under 15% mana"_ — then tells you to watch a chart instead.

Swept: 137 strings carry UI deixis (`the bar`, `the line`, `the chart`, `the tiles`, `above`, `below`, `the control`), 54 of them inside a sentence that also carries an action verb. **Almost all are legitimate.** _"The table below says what was short on each one"_ and _"switch the reading with the control at the top of the page"_ are report navigation, telling the reader where to look. Correct, and they stay.

The rule that separates them: **UI deixis is correct for navigation, wrong as an in-game cue.** A sentence telling the player what to press names the game state, not the widget.

Three strings fail it:

- `summary.takeaways.metric.thunderstormMissed.fix` — _"press it as the bar reaches the line"_ → press it at 15%.
- `mana.verdict_ok` — _"Press Thunderstorm the moment the bar reaches {{starved, percent}}"_ → the moment you hit `{{starved, percent}}`.
- `mana.verdict_bad` — same construction; also in the Phase 3 list for `simply`.

## Paraphrased jargon

Instruction taken: _"area damage"_ → _"AoE"_. Four strings — `energizingBrew.recommendation.body`, `summary.takeaways.metric.energizingBrewRjw.fix`, `rotation.notes.jadeWind`, `jadeWind.intent`.

**This entry previously argued against the general rule. That argument was wrong and is withdrawn.** It rested on a 4-page, 2-author corpus in which one author — Woah, the Elemental guide — supplied half the words and all five `area damage` hits, which made his habit look like a sense distinction ("`AoE` names the mode, `area damage` names the output").

On the 12-page, 6-author corpus the split is unambiguous:

| term          | rate     | authors                     |
| ------------- | -------- | --------------------------- |
| `AoE`         | 121/100k | **6 of 6**                  |
| `area damage` | 26/100k  | **1 of 6** — Woah, all five |

`AoE` is the genre term in both senses. `area damage` is one writer's tic. **Adopt the general rule:** `AoE` throughout, and `docs/conventions.md` records it plainly rather than as a sense distinction. Related genre terms, all 6/6: `single-target` 232, `burst` 201, `multi-target` 52; `cleave` 79 at 4/6.

This is the clearest example in the plan of why the author-spread column exists — see `references/audience-wow-players.md` §1.

## Density — over-answering, not clutter

The class that cuts the most reading, and the one where the obvious diagnosis is wrong.

**Stock clutter is absent.** Swept all 1,235 leaves for the usual padding and found **zero** of: `in order to`, `due to the fact that`, `in the event that`, `for the purpose of`, `a number of`, `the majority of`, `a variety of`, `what this means is`, `the reason is`, `it is the case that`, `each and every`, `first and foremost`, `is able to`, `has the ability to`, expletive `there is/are … that`, `begin to`, `in a … way`, double hedges (`may possibly`). The only hits worth anything: 5 light-verb phrases (`makes a press`, `makes a use`), 1 removable `that`, 2 removable relative clauses. Most `rather` hits are legitimate `X rather than Y` contrasts. **A fluff-word sweep will come back empty — do not spend a phase on one.**

**The bloat is structural.** Measured over the 618 prose leaves (19,578 words):

|               | words   |
| ------------- | ------- |
| median string | 25      |
| p75           | 41      |
| p90           | 63      |
| p95           | 82      |
| p99           | 116     |
| longest       | **196** |

**27% of all prose words sit in 9% of the strings.** The 60 longest carry 5,317 words. By section: `rotation` 2,235w, `flameShock` 1,203w, `summary` 994w, `castLog` 978w, `mana` 958w.

The defect in those long strings is **one string answering several questions the reader never asked together**, not padding. Diagnosed concretely:

- **`flameShock.snapshotNote` (196w)** does five jobs: glosses two UI column names, states the priority rule, teaches the four things that make a dot stronger, explains the Clearcasting division, then cross-references the Snapshots section. Four of those are separate strings or deferrable.
- **`earthShock.intent` (156w)** is a three-case rule table — one enemy, one enemy with a tier-16 proc, two enemies — written as prose. Rule tables belong in tables.
- **`lavaBurst.note` (160w)** states the same timing point three times in different words: _"settled when the cast goes out"_, _"it is the completion that decides the row"_, _"the two charges are not the same charge"_.
- **`rotation.economy` (97w) is the counter-example and the model.** Seven sentences, short median, every clause load-bearing, no restatement. Long because the subject is, not because the writing is. **Do not shorten it.** Length alone is not the signal.

**Repeated boilerplate, which is pure duplicated reading.** Identical clauses shipped across sibling strings:

| clause                                                                                | ships in                  |
| ------------------------------------------------------------------------------------- | ------------------------- |
| _"switch the reading with the control at the top of the page if you want it counted"_ | **8 strings**             |
| _"a stretch that looks busier there is the haste, not a change of plan"_              | 6                         |
| _"the dot was up for every second you had something to hit, across X casts"_          | 4                         |
| _"X brews spent, averaging X of 10 stacks"_                                           | 4 (+3 in the `_one` arms) |
| _"the report was simply not given the numbers"_                                       | 3                         |

The ×8 clause is ~15 words of identical instruction printed eight times. Say it once, outside the grade arms — which is the same fix as Phase 4's front-loading, arrived at from the other direction.

**The rules to write into `docs/conventions.md`:**

1. **One string answers one question.** If it glosses a column _and_ states a rule _and_ teaches a mechanic, it is three strings, and two of them are probably `intent` or a tooltip.
2. **Never restate a claim in different words inside one string.** Say it in the strongest form once.
3. **A rule with cases is a table, not a paragraph.**
4. **Boilerplate shared by grade arms is said once, outside the arms.** A clause in 8 strings is a clause in the wrong place.
5. **Cut the sentence that defends the method to a reader who has not objected.** Method exposition belongs in the `method.*` keys, which exist for it.
6. **Length is not the signal — job count is.** `rotation.economy` at 97 words is correct; `flameShock.snapshotNote` at 196 is four strings.

**Target, not a gate:** no prose string past ~120 words without a stated reason, and the p90 down from 63. Applied as sections are touched in 4b-ii, not as a sweep.

## The contraction gap — the largest measured register distance

Found only once the corpus reached 6 authors, because contractions are a rate, not a word, and a 2-author sample was too small to trust one.

|                                                    | repo locale | corpus        | ratio    |
| -------------------------------------------------- | ----------- | ------------- | -------- |
| negative contractions (`isn't`, `didn't`, `won't`) | **9**/100k  | **1545**/100k | **170×** |
| `it's`                                             | 0           | 264           | —        |
| `you're` / `you'll` / `you've`                     | 0           | 116           | —        |
| expanded negatives (`is not`, `does not`)          | 656         | —             | —        |
| `it is`                                            | 353         | —             | —        |

**The repo's 22,093 words of copy contain two contractions**, both in short KPI tiles (`priority.kpi.unknown` = "Can't tell", `earthElemental.kpi.unknown` = "Your log can't say"). Every one of the six guide authors contracts heavily. There is **no house rule** requiring the expanded forms — `docs/conventions.md` and `CONTRIBUTING.md` say nothing about it, so this is habit rather than policy.

This is the single biggest measurable distance between the repo's register and its audience's, and it is what makes otherwise-good copy read formal.

**Recommendation: contract in body prose, and leave the deliberate emphases alone.** `is not counted against you` reads as a considered ruling and should stay expanded where the verdict is the point; `the report was not given the numbers` is plain narration and takes `wasn't`. The rule is _contract unless the full form is carrying weight_ — the opposite of the current default.

**This needs a decision before 4b-ii**, because it touches a large share of the prose and reverses a habit rather than fixing defects. It is not in any phase's scope until then.

Advice frames, measured the same way: the repo's bare-imperative rate (1095/100k) matches the genre's (1275/100k) closely, so that half is already right. What the repo never uses is the second-person modal frame — `you can` 36/100k against the corpus's 217, and `you need to` / `you want to` / `you should` all at **zero** against 58 / 52 / 26. Worth a look during the read-through, not a sweep.

## Deliberately NOT a class

The economic family — `bought`, `pays`, `costs`, `spent`, `worth` — is **160 strings** and is not a defect: the game itself has costs and spending, so _"the press bought nothing"_ is in-domain and consistently applied. Same for the mana `starved`/`strained` family (21 strings), ordinary WoW parlance. Neither is touched. Anyone re-running a sweep will hit these first; they are not findings.

---

## Locked decisions

- **Em-dash: keep — but the justification is narrower than first written.** 240 in `report.json`, 19.7% of prose sentences, ceiling of 2 with nothing at 3. They do genuine appositive work: defining a measurement mid-sentence, where a following sentence would put the definition after the claim that needed it. It is house punctuation, present in `ui.json`, the README, every code comment and `readerVoice.test.ts`'s own prose, and a 240-instance sweep against a rule the repo breaks in every file is theatre.

  **What the 12-page corpus added:** the genre barely uses em-dashes at all — **6 in 18,889 words**, none of them a spaced appositive pair, two authors using none. Where these writers interrupt a sentence to define a term they use **parentheses** (317/100k, up to 750/100k for one author) or a colon (179/100k). So this is an override of `SKILL.md` §15 **and** of the audience corpus, not a register-native choice. Record it that way in `docs/conventions.md` — an honest override survives the next reviewer; a false claim of genre support does not. The `≥3` test still goes in.

- **Sentence length: documented target, no gate.** Record the measured numbers so they bind new copy; let the file converge as sections are touched. A gate's honest floor is today's number, which makes it a budget, and it cannot tell a 40-word sentence that earns it from one that does not.
- **README: fix the factual staleness, leave the prose.** It measures clean (median 17, zero banned vocabulary) and passes §15.12 harder than any file in the repo — `README.md:99-103` and `326-328` are a self-correction and a named past failure, the two least fakeable moves in the standard. A rewrite would destroy value.
- **Auth + error strings: centralise.** `docs/conventions.md:255` already says, in bold, _"No English sentence belongs in a component."_ ~561 words across 7 files in `src/components/auth/` violate it. The strings themselves are good — this is enforcement of an existing rule, and it brings them under the guard **by construction** instead of by building a scanner.
- **Idiom guard: written rule plus the known literals.** Not a list pretending to be complete.

## Explicitly out of scope

- **~418 game-data `name:` fields** in `src/lib/game/shared.ts` and both spec libs. `docs/conventions.md:288` rules ability names stay out of the locale (WCL returns them localised in `masterData`; a second table would drift). The register file §6 independently forbids paraphrasing them. Identifiers, not copy.
- **A source-scanning voice test.** `src/specs/*/lib/apl.ts` alone has 31 lines matching `rule|condition|Prior to`, every one a code identifier or a load-bearing comment — and `docs/conventions.md:245` opens _"The comments in the engine are load-bearing."_ A scanner needs a comment stripper, a JSX-text extractor and an ignore list for `src/generated/`, `**/__tests__/**`, `lib/apl.ts`, `preview.astro`. That is a linter, guarding ~29 strings Phase 5 moves under the guard anyway.
- **The other 5 identical-prefix verdict families**, beyond the worst 2. ~20 more assertions, each a deliberate no-change guard needing a decision rather than a replace.
- **A full §1 length migration.** Priced: of the 172 leaves holding a 25+ word sentence, 57 are pinned by a test literal, 22 are in the exempt `rotation` section, 12 are method notes — leaving 94 editable. Renegotiating 57 deliberate assertions to move a median from 17 to 14 is the over-large migration this plan exists to avoid.
- `src/generated/wcl-schema.ts` (codegen, carries WCL's own prose), `docs/plan.md` (gitignored, no reader).

## Non-constraints — verified, do not plan around these

- **`oxfmt` does not bind string edits.** 391 lines of `report.json` already exceed `printWidth: 120`, longest 1,062; oxfmt does not wrap JSON string values. A string-value edit changes one line and `--check` stays green. **Adding a nested key can** reflow layout — run `npx oxfmt src/locales/en/ui.json` before committing Phase 5.
- **The 265 exact-string assertions barely bind this work.** Only **one** pins a string Phases 2–3 edit: `src/specs/elemental/components/sections/__tests__/mana.test.ts:71`. `src/components/auth/` has no `__tests__` directory and no test anywhere greps its copy.
- **`person-density.py` must NOT be run as a gate here — it fails correct copy.** Verified: a clean four-sentence second-person report draft trips _"no author present: zero first-person words"_ and _"opening carries no author… The hook is the one block that should be I-led"_, and `--strict` exits 1. That is `SKILL.md` §7 guidance for personal long-form essays, and it is **inverted for this genre** — six independent guide authors wrote 18,889 words with zero first-person singular. An agent that runs the script as a gate and "fixes" the failures will insert an author into a report that must not have one. Its underlying claim — person is the load-bearing axis, check it deterministically — is taken as the `AUTHOR_WORDS` list in Phase 2 instead. See `references/audience-wow-players.md` §2 for the full override.

---

# Worked examples

One per class, so the read-through has a calibration reference rather than a rule list. Every "before" is a live string.

**1. Correctness — `casts.verdict_bad`**

> **Before:** Of the globals available in this pull, you spent `{{used}}` on a press that achieved something, at `{{cpm}}` casts per minute of the time you spent on a target. **Nearly a third of the pull produced nothing useful.**
> **After:** You spent `{{used}}` of your globals on a press that achieved something, at `{{cpm}}` casts per minute of your time on target.

The magnitude claim is false below ~67% and `bad` starts at 75%. The grade colours it; the percent is in the sentence. Also drops the preamble — start with the point.

**2. AI opener + contraction — `mana.early_one`**

> **Before:** …It is not counted against you anywhere in this report, but **it is worth knowing the trade:** the press takes a global, so on a pool that **did not** need it you swapped a Lightning Bolt for mana you already had.
> **After:** …Nothing here counts it against you, but the press still took a global — on a pool that **didn't** need it, you swapped a Lightning Bolt for mana you already had.

**3. Audit register — `fistsOfFury.caption`**

> **Before:** Every Fists of Fury channel and **what, if anything, was wrong with its placement**
> **After:** Every Fists of Fury channel, and where each one went wrong

**4. UI deixis as cue — `summary.takeaways.metric.thunderstormMissed.fix`**

> **Before:** …It is free, hands back 15% of your maximum, and at that mana your next Lava Burst may not go out at all — **press it as the bar reaches the line.**
> **After:** …**It's** free and hands back 15% of your maximum, and at that mana your next Lava Burst might not go out at all. **Press it at 15%.**

The cue is a mana number the player can see in game. The bar and the line are ours.

**5. Idiom — `summary.takeaways.metric.flameShockMultiDot.fix`**

> **Before:** …A second target that stays undotted is **free damage left on the table.**
> **After:** …The gap is damage the second dot would have done.

**6. Author voice — `karma.capSummary_one`** (fix `_other` in the same commit)

> **Before:** One use drained its pool completely, which **tells us** the pool's size: `{{health}}` health.
> **After:** One use drained its pool completely, which **puts the pool at** `{{health}}` health.

**7. Terminology — `energizingBrew.recommendation.body`** (fix its `energizingBrewRjw.fix` twin together)

> **Before:** Bloodlust or Time Warp **was active** while Rushing Jade Wind **was selected**, but Energizing Brew **was not used** there. The rotation allows this combination, and the extra energy is valuable for **area damage**.
> **After:** Bloodlust or Time Warp was up with Rushing Jade Wind talented, but you **didn't press** Energizing Brew. The rotation allows both together, and the extra energy is worth most in **AoE**.

**8. Nominalization in a caption — `searingTotem.caption`**

> **Before:** Every Searing Totem **placement**, what the previous totem still had on it, and what the press bought
> **After:** Every Searing Totem you dropped, what the last one still had left, and what the press bought

**9. Density — `flameShock.snapshotNote` (196w)**

Not a trim. Count the jobs: it glosses two UI column names, states the priority rule, teaches the four things that make a dot stronger, explains the Clearcasting division, then cross-references the Snapshots section. Keep the column gloss where the columns are, keep the rule in the section that grades it, and let the mechanic teaching go to `intent` — which is the key that exists for it. The cross-reference is one clause, not a sentence.

**Counter-example — `rotation.economy` (97w).** Long, and correct. Seven sentences, short median, every clause load-bearing, no restatement. **Do not shorten it.** If a proposed edit would also "improve" this string, the rule being applied is length, and length is the wrong rule.

---

# Phases

## Phase 1 — Record the standard. No behaviour change.

`.gitignore:33-36` names `docs/conventions.md` and `.claude/skills/wcl-analyzer/SKILL.md` as _"the durable records"_, which settles both where this goes and that a tracked skill is an accepted form here.

- `git add .claude/skills/tone-of-voice/SKILL.md` and `references/audience-wow-players.md`. Leave `references/voice-capture.md` and `scripts/person-density.py` untracked — the first is an interview procedure for sections deliberately left empty, the second has nothing to measure.
- **`docs/conventions.md`**, appended to §"Copy, and how a report says anything" (~line 253), in the voice of the surrounding file:
  - The person rule: second person, never `we`/`us`/`I` — a report describes a pull, it is not a party to it.
  - The guard lists and why they differ in scope (see Phase 2).
  - **The em-dash override**, stated as an override, with the ceiling of 2 and why the appositive earns its place.
  - The sentence-rhythm target _with today's measured numbers_ (median 17 → target 11–14; 22.4% past 25 → ~15%), plus the command to re-measure. A target, not a gate.
  - **The analogy domain**: comparisons come from inside the game or from another spec's mechanics. Not sport, cooking, money, machinery or weather.
  - **UI deixis is for navigation, never a cue.**
  - **No hedged interrupters; a verb beats a nominalization** in a sentence. Labels exempt.
  - **`AoE` vs `area damage`**: the sense distinction, `AoE` as default.
  - **The six density rules** (one string, one question; no restatement; cases go in a table; shared boilerplate said once outside the grade arms; no unprompted method defence; **job count is the signal, not length**), with the measured distribution (median 25w, p90 63, p99 116, max 196; 27% of prose in 9% of strings) and `rotation.economy` named as the 97-word counter-example that is correct as it stands. **Also record that a stock-clutter sweep returns zero**, so nobody spends a phase on one.
  - A pointer to `.claude/skills/tone-of-voice/` for the register and to `readerVoice.test.ts` as the mechanical half — **stating plainly that the lists catch vocabulary and cannot catch constructions**, and that every class above was found by reading, not grepping.
- **`README.md`** — line 8 (_"deliberately one spec on one game version"_) and line 334 (_"Only Windwalker, only Mists of Pandaria"_) contradict lines 223–260, which document `elemental-analyzer`, `cloudflare-elemental.yml` and `PUBLIC_SPEC=elemental`; line 270 points at `src/lib/spec/windwalker/`, now `src/specs/windwalker/`. Plus line 13: _"a fairly narrow set of questions"_ → _"a narrow set of questions"_.

**Verify:** `npx oxfmt --check docs/conventions.md README.md`. `npm test` untouched. `grep -rn "narrow set of questions" src` returns nothing.

**Risk:** none material.

## Phase 2 — Widen the guard vocabulary. Deliberately red.

One file: **`src/specs/__tests__/readerVoice.test.ts`**.

**Guard first, copy second, and the order carries information.** The file's own rule (lines 29–33) is that widening vocabulary and widening coverage are two changes, _"because doing both at once would make it impossible to say which of them a red run came from."_ The corollary: fixing copy first gives a green run that proves nothing — you cannot tell a list that catches the defect from a list with a typo in it. The matcher is new code (`MODEL_WORDS` uses bare `includes()`; the new lists need `\b` anchoring), and this file exists because `earthShock.verdict_good` survived every green run when an alternation matched neither a `.` nor an end-of-string.

**Separate lists, not a merge. The exemptions decide it.** `MODEL_WORDS` is surrounded by four carve-outs (`WINDWALKER_METHOD_KEYS`, `SHARED_METHOD_KEYS`, `REFERENCE_SECTIONS` covering ~120 `rotation` strings, `REFERENCE_READER_KEYS`) because naming the model is _sometimes correct_ — a section whose job is printing the priority list cannot be forbidden from calling it a list. None of that transfers: no section's job requires "it is worth noting". Merging would hand a permanent pass on AI vocabulary to 120 `rotation` strings, and one of the hits (`rotation.entry.tigerPalmProc.why`) is inside that exemption.

|                 | `MODEL_WORDS`                                 | `AI_WORDS` / `AUTHOR_WORDS` / `OFF_DOMAIN`      |
| --------------- | --------------------------------------------- | ----------------------------------------------- |
| a red run means | internal jargon reached a reader              | the copy does not sound like a player           |
| matcher         | `includes()` — `judg` catches judge/judgement | `\b`-anchored — `very` must not fire on `every` |
| scope           | four scoped lists + exemptions + closure test | **whole file, unscoped, no exemptions**         |
| files           | `report.json` (+ `ui.json` in Phase 5)        | both, from the start                            |

Changes:

- Extract `leaves(file)`; rename `LOCALE` → `REPORT` (one reader), add `UI` and `uiStrings()`. `localeStrings()` keeps its name and signature so all 14 call sites are untouched. `violations()` left byte-identical so the 8 `expect(violations(...)).toEqual([])` sites are untouched.
- `AI_WORDS` — openers (`worth noting`, `worth knowing`), filler (`simply`, `very`, `quite`, `fairly`, `arguably`, `significantly`, `crucial`), connectors (`moreover`, `furthermore`, `additionally`), enthusiasm (`amazing`, `awesome`, `insane`, `incredible`), register words (`delve`, `leverage`, `robust`, `seamless`, `utilize`, `unlock`, `elevate`, `ultimately`, `in conclusion`).
- `AUTHOR_WORDS` = `['we','us','our','ours',"we're","let's",'I']`. `I` catches nothing today and is pinned as prophylactic, in the same sense and for the same reason as `exempt` in `MODEL_WORDS`.

  **Document `we`/`our` here as a house tightening, not a genre rule.** The corpus is emphatic that `I` never appears (0 in 18,889 words, 6/6 authors) — that half is genre. But editorial `we`/`our` runs 349/269 per 100k across **all six** authors, so banning it is this project's own stricter line: a report describes a pull rather than being a party to it. `us` is the one that is also an outlier within the genre — 127/100k from a single author. Anyone who later checks the corpus will find `we` everywhere, so the reason for the ban has to sit next to the list or it will be relaxed.

- **Two `AI_WORDS` entries need the same treatment.** `very` (243/100k, **6/6 authors**) and `however` (6 uses, 4/6) are genre-_present_, not genre-absent. They stay banned because `SKILL.md` §1–§2 is a floor and the copy is better without them — but say so plainly, because an earlier draft of the register file claimed both were at zero and that correction should not have to be made a second time.
- `OFF_DOMAIN` — the four found literals (`bell`, `on the table`, `in the same breath`, `if anything`), **with a docstring saying plainly that a four-phrase list cannot catch the next metaphor** and that the durable half is the written rule in `docs/conventions.md`. `\bbell\b` needs no exemption: ability names come from WCL `masterData`, never the locale.
- `boundary()`, the patterns, `matching()`, and a `describe('no string in either locale sounds machine-written')` block with **both non-vacuity tests** — one asserting every listed word fires on a synthetic sentence (a typo'd entry greens the block silently and forever), one asserting the anchoring holds (`every press` must not match).
- The em-dash ceiling test (`≥3` → empty). Prophylactic; says so.

**Verify:** `npx vitest run src/specs/__tests__/readerVoice.test.ts` goes **red** with a known census — 11 AI-vocabulary strings in `report.json` (`mana.early_one`, `mana.early_other`, `mana.verdict_bad`, `mana.none`, `energy.none`, `chi.none`, `misses.none`, `xuen.none`, `gear.none`, `casts.verdict_good`, `rotation.entry.tigerPalmProc.why`), zero in `ui.json`, 3 author strings (`karma.capSummary_one`, `karma.capSummary_other`, `settings.intent`), zero em-dash. **The red output is the census.**

**Risk:** CI blocks a red PR, so Phases 2 and 3 are **one PR, two commits**. The real risk is a _wrong_ red from an unmeasured word — re-run the probe before extending any list.

## Phase 3 — Fix the copy. Green.

**`src/locales/en/report.json`** — in-place string edits, no structural change.

_The correctness bug — do this first, it is the highest-value item in the plan:_

- `casts.verdict_bad` — delete _"Nearly a third of the pull produced nothing useful."_ The grade carries the claim and the percent is in the same sentence. Do not substitute another magnitude word; derive or omit, per `docs/conventions.md:297`.
- `casts.verdict_good` — _"Very little went unused."_ → _"Almost nothing went unused."_ (`very` is idiomatic here, but an exemption for an idiom is a hole in a list that has none, and the reword loses nothing.)

_The tell-based defects:_

- `mana.early_one` / `_other` — drop the announcement: _"…is not counted against you anywhere in this report. The press takes a global, though, so on a pool that did not need it you swapped a Lightning Bolt for mana you already had."_ The reason belongs in the same sentence as the claim (§1); the announcement is what made it two.
- `src/components/auth/SignInPanel.tsx:70` (_"The catch worth knowing:"_) — Phase 5, with the rest of that file.
- `README.md:13` — Phase 1.

_The `simply` batch — one sentence cloned four times, plus three singles:_

- `energy.none`, `chi.none`, `mana.none`, `gear.none`: drop `simply`. The four stay identical to each other, which is the point of them being clones.
- `misses.none`, `xuen.none`, `mana.verdict_bad`. **`mana.verdict_bad` is the one pinned string** — update `src/specs/elemental/components/sections/__tests__/mana.test.ts:71` in the same commit.

_Author voice:_

- `karma.capSummary_one` / `_other` — _"which tells us the pool's size"_ → _"which puts the pool at"_. **Both arms together**; fixing one twin is this repo's documented recurring failure (`readerVoice.test.ts:393`).
- `ui.json` `settings.intent` — _"or that the log cannot tell us"_ → _"or that the log does not record"_. Also more precise: the log does not withhold, it lacks the events.

_Dead and weak strings:_

- `summary.takeaways.metric.energizingBrewRjw.fix` — three problems in one clause: `the priority list` (evades `MODEL_WORDS` by one word), `especially valuable`, and `RJW` unexpanded.
- `energizingBrew.recommendation.body` — its twin, saying the same thing differently. **Fix both or neither.**
- `summary.takeaways.metric.flameShockMultiDot.fix` — _"free damage left on the table"_: cliché, and every sibling `.fix` says something specific.
- `summary.takeaways.metric.brewCapWaste.fix` — _"You can brew earlier to avoid overflow."_ Interchangeable, visibly weaker than its siblings.
- `jadeWind.choice.value` — `"Non-optimal"`: a bare label of our own model, and `optimal` is at zero across the audience corpus.
- `rotation.entry.tigerPalmProc.why` — read and reword. Inside the `MODEL_WORDS` exemption, which is exactly the case the new lists are built for.
- `src/components/report/describeFailure.ts:57` — `'Something went wrong'`. The only dead string in the error surface; Phase 5.

**Verify:** guard green → `npx vitest run src/specs/elemental/components/sections/__tests__/mana.test.ts` → `npm test` → `npm run check`. **Read the `simply` edits aloud rather than sed-ing them** — in _"may simply not be the one you took"_ it is arguably doing softening work, and deleting it makes the sentence blunter. Correct direction, but a judgement.

**Risk:** low, quantified — one assertion. The `*.none` arms render only when a log carried no data, so the guard and the key-existence lists are their only verification.

## Phase 4 — Front-load the two worst verdict families.

**`src/locales/en/report.json`**, six strings:

- `lightningShield.verdict_{good,ok,bad}_noOvercap` — 354 shared characters
- `searingTotem.verdict_{good,ok,bad}_noUptime` — 292 shared characters

Move the reader's own result to the front of each; leave the method clause (_"not measured on this reading — switch the reading with the control at the top of the page"_) behind it. Same content, same em-dashes, different order.

**Verify:** `npm test`. Expect reds in `src/specs/elemental/components/sections/__tests__/` — `lightningShieldAoeNote.test.ts` (4), `stormlashTable.test.ts` (7), `unaskedVerdict.test.ts` (16), `copyAgainstTheRule.test.ts` (5). Then `npm run dev` → `/preview`, Elemental `phased`/`unbroken`/`cleave`.

**Risk:** the worst of the copy phases. ~20 assertions, and **every one is a deliberate no-change guard — each needs a decision, not a find-and-replace.** Read the assertion's surrounding comment first; several pin a specific past bug.

## Phase 4b — The construction sweep, and the read-through.

The part no list can do. Two halves, and the second is the real deliverable.

### 4b-i — the named classes, mechanically

| class                                       | strings                   | change                                             |
| ------------------------------------------- | ------------------------- | -------------------------------------------------- |
| idiom: `the bell`                           | **8 locale + 179 source** | → _the pull_. Mapping below.                       |
| idiom: `on the table`, `in the same breath` | 3                         | say the specific thing instead                     |
| audit register                              | 5 (labels excluded)       | drop `what, if anything,`; verb for nominalization |
| UI deixis as game cue                       | 3                         | name the game state, not the widget                |
| paraphrased jargon                          | 4                         | `area damage` → `AoE` in the mode sense            |
| density: repeated boilerplate               | 8 + 6 + 4 + 4 + 3         | say it once, outside the grade arms                |
| density: light verbs, removable `that`      | 8                         | `makes a press` → `presses`; drop `that`           |

**The `bell` mapping — per-site, not a global replace.** `CONTRIBUTING.md` §"Do not 'simplify' the traps" makes comments load-bearing and requires a failing test before _removal_; this is rewording, not removal, so the two are compatible — but the 179 comment sites carry explanatory weight and must keep it. Ten distinct constructions:

| construction                                         | →                                       |
| ---------------------------------------------------- | --------------------------------------- |
| `before the bell` (largest group)                    | `before the pull`                       |
| `at the bell` / `not out at the bell`                | `at the pull`                           |
| `when the bell went` / `the bell rang`               | `when the pull started`                 |
| `running / up at the bell`                           | `running at the pull`                   |
| `the opening bell`                                   | `the pull`                              |
| `pressing on the bell` / `lands exactly on the bell` | `on the pull`                           |
| `predates the bell` / `behind the bell`              | `predates the pull` / `behind the pull` |
| `measured from the bell`                             | `measured from the pull`                |
| `whatever the bell found`                            | rewrite — no clean swap                 |

**Ship the source-comment half as its own commit.** 179 comment edits across ~40 files touches no behaviour, but it will conflict with any concurrent branch and it buries the reader-visible locale change in the same diff.

### 4b-ii — the read-through

44 sections, one at a time, against a checklist: the classes above, plus the six density rules, plus §1 rhythm, plus §15.12 (_"could anyone else have written this"_, asked **per section** rather than per file). Sequence by what a reader hits first and hardest: `overall` → `summary.takeaways` → the graded `verdict_*` families → `intent` and `why` prose → captions and labels.

**The density work is the bulk of this phase, and it is a split-and-defer job, not a trim.** Start with the 60 longest strings — 27% of all prose in 9% of the strings — and for each one count the jobs before counting the words. `flameShock.snapshotNote` (196w), `earthShock.intent` (156w), `lavaBurst.note` (160w), `flameShock.multiDotNote` (135w), `earthElemental.intent` (135w) and `rotation.notes.jadeWind` (119w) are the named starting set. Splitting a string means new keys, so each one lands with its reader in the same commit or `keys.test.ts` reds. And re-read `rotation.economy` first as the calibration: 97 words, correct, not a target.

**Log each new class into `docs/conventions.md` as it is named**, and add its literal to `OFF_DOMAIN` where it has one. This is the phase that finds the sixth class. Budget it as real work, not a pass.

**Verify:** `grep -rni '\bbell\b' src --include=*.ts --include=*.tsx --include=*.astro | grep -vi bellow` → only intended survivors; a `python3` sweep over both locale files per class → empty; `npm test`; then the preview harness.

## Phase 5 — `ui.json` under the guard; centralise auth and errors.

**5a — the coverage half, alone.** Add the `ui.json` `MODEL_WORDS` scope with its own `UI_ROOTS` closure list (verified roots: `app`, `chart`, `common`, `credits`, `selection`, `settings`, `steps`). **Green on the first run** — all 51 leaves already pass `MODEL_WORDS`. A coverage-only commit that moves no copy, which is the shape the file's discipline asks for, and it converts the docstring's hand-made claim about `ui.json` into an asserted one.

**5b — the migration.** New roots `auth`, `errors`, `progress`; all three added to `UI_ROOTS` (a visible edit, which is the point).

- **7 files in `src/components/auth/`** (`ClientIdPanel`, `ClientIdSetup`, `ManualTokenForm`, `SessionProvider`, `SignInButton`, `SignInPanel`, `TokenHelp`) — add `useTranslation('ui')`, replace literals. None currently import it.
  - `SignInPanel.tsx:70` — the sentence wraps a `<strong>`, so it needs **two keys around the emphasis**. There is no `<Trans>` anywhere in this repo and adding the dependency is worse than a slightly split sentence.
  - `SignInPanel.tsx:53` and `:93` — the identical `Callout title` ternary, twice. One pair of keys read from both sites. The orphan hunt makes this **mandatory**: two keys with identical values is dead copy.
  - `ClientIdSetup.tsx:143` (~250 chars) and `TokenHelp.tsx:24` (~260 chars) — the long bodies. Move, then reread under the guard; strings this long are where rhythm goes wrong and neither has ever been read by one.
- **`describeFailure.ts`** — not a component, no hook. **Pass `t` in as a parameter**: few callers, keeps it pure and testable. Fix the `'Something went wrong'` fallback while moving it.
- **The 3 duplicated progress strings** — `fetchFight.ts:91,112`, `useFightAnalysis.ts:70,97`, `ReportFlow.tsx:427` → 3 keys, 4 sites.
- **Gear slot labels** duplicated between `GearSetup.tsx:115-124` and `lib/analysis/gear.ts` — labels, not sentences, and the convention is about sentences. One exported array with one home; the locale is optional here.
- **~9 JSX prose nodes** — `SnapshotDepth.tsx:398,408-430`, `ReportFlow.tsx:371,407`, `AbilityDamage.tsx:152`, `DataGrid.tsx:77` → `report.json` or `ui.json` by which namespace their component reads.

**Verify:** `npx vitest run src/lib/i18n/__tests__/keys.test.ts` (both directions — missing keys _and_ the ui orphan hunt) → the guard (**may go red; that is the phase working**) → `npm test` → `npm run check` → `npm run dev` and click through signed out, a public-only token, and a deliberately bad report code.

**Risk:**

- **The orphan hunt is strict** (`keys.test.ts` §"shell copy with no reader"): every new leaf must be literally asked for by a quoted key path. Add keys and readers in one commit.
- **Namespace detection** — `keys.test.ts:151-158` decides a file's namespace from `useTranslation('ui')` and reds if a `t('auth.…')` call is attributed to `report`. If a component reads both, use the established `const { t: tUi } = useTranslation('ui')` pattern (the `UI_RENAMED` branch).
- **`describeFailure.ts` signature change** touches callers — `astro check` and `tsc --noEmit` catch it. Compile risk, not runtime.
- **No safety net on auth.** Zero existing tests means zero assertions to update _and_ zero to catch a regression. Worth a thin `src/components/auth/__tests__/signInPanel.test.ts` — `renderToStaticMarkup` over the three branches, following `previewRoute.test.ts`'s `createElement` pattern to stay in `.ts`. ~40 lines, and the only _new_ machinery in this plan.
- **Adding nested keys can reflow `ui.json`** — run `npx oxfmt src/locales/en/ui.json` before committing.

## Phase 6 — The `WclError` messages. Needs a design.

The 16 `new WclError(...)` messages in `src/lib/wcl/client.ts` (lines 166, 247, 256, 263, 270, 277, 292, 297, 315, 320, 322, 345, 354, 394, 425, 456) and 5 in `src/lib/auth/{callback,exchange}.ts`.

Last and separate **not** because of size but because it is a design decision rather than a move: a `WclError` message is built at the failure site with the failing detail interpolated in, and `describeFailure.ts:11` documents that the message is _"passed through untouched"_. Moving them needs a key-per-`kind`-per-call-site design plus interpolation for the runtime detail. Bundling it into Phase 5 makes an unreviewable PR; doing it after means the naming convention is already set.

On merit these strings are **good** — `client.ts:265` (_"a client-credentials token reads public logs only, and a report private to another account is off limits to any token but that account's own"_) is among the best copy in the repo. Two exceptions to handle while moving: `client.ts:279` (_"Nothing is wrong on your side"_ — reassurance-shaped, assistant register) and `client.ts:356` (60+ words with a conditional clause concatenated on, two sentences pretending to be one string).

**Also deferred here, with the reason on the record:** the miss-ledger `kind`/`detail` templates at `src/specs/windwalker/lib/index.ts:3072-3158` and `src/specs/elemental/lib/index.ts:3852-3878`. Reader-facing prose built by interpolation mid-pipeline, pinned by `src/specs/windwalker/lib/__tests__/castClocks.test.ts:138,206`, and needing real `count` plurals to move correctly.

---

# Verification

Per copy-changing phase, in order:

```bash
# 1. The guard alone — red (Phase 2) then green (Phase 3).
npx vitest run src/specs/__tests__/readerVoice.test.ts

# 2. The key contracts. Phase 5's real gate: missing keys AND the ui orphan hunt.
npx vitest run src/lib/i18n/__tests__/keys.test.ts src/lib/i18n/__tests__/copyPrefix.test.ts

# 3. The tests pinning the strings being touched.
npx vitest run src/specs/elemental/components/sections/__tests__/mana.test.ts   # Phase 3
npx vitest run src/specs/elemental/components/sections/__tests__/               # Phase 4

# 4. Everything — a string edit can move a toContain two directories away.
npm test

# 5. Static gates. astro check catches an unresolved import; oxfmt --check catches
#    the one thing a JSON edit can break: object layout after a key add.
npm run check

# 6. The prose, with eyes on it.
npm run dev     # → http://localhost:4321/preview

# 7. Last — the only thing that exercises preview.astro's build-time analyse().
npm run build
```

**Limit of the preview harness, worth knowing before trusting it.** `src/pages/preview.astro` renders six fixtures (Windwalker `mixed`/`poor`/`strong`/`weave` as stored analyses; Elemental `phased`/`unbroken`/`cleave` analysed at build time) and shows **only the verdict arms those six pulls reach**. `mana.early_*` renders when `mana.earlyThunderstorms > 0` (`Mana.tsx:271`) and no fixture is known to reach it; the `*.none` arms render only for logs carrying no data. That is a property of fixture-driven rendering, not a defect — it is why the guard is the primary check and the page is the sanity check. To assert reachability rather than eyeball it, follow `src/specs/elemental/__fixtures__/previewRoute.test.ts`.

# Blast radius

| Phase                                            | Files changed                                  | Tests broken                                                                                                      |
| ------------------------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1 standard + README                              | 3 + 2 tracked skill files                      | 0                                                                                                                 |
| 2 guard lists                                    | 1                                              | **1, intentionally red**                                                                                          |
| 3 copy fixes (~16 strings)                       | 2 locale + 1 test                              | 1 assertion (`mana.test.ts:71`)                                                                                   |
| 4 front-load 2 families                          | 1 locale                                       | ~20 assertions in 4 files, **each a decision**                                                                    |
| 4b-i constructions (23 locale strings)           | 1 locale                                       | re-run `npm test`                                                                                                 |
| 4b-i `bell` in source comments                   | ~40 files, 179 sites                           | 0 — comments only. **Own commit.**                                                                                |
| 4b-ii read-through + density splits, 44 sections | 1 locale + the components reading any new keys | unknown by construction; **splitting a string adds keys, so `keys.test.ts` and the orphan hunt gate every split** |
| 5 `ui.json` coverage + centralise                | ~12                                            | `keys.test.ts` both directions; guard may red                                                                     |
| 6 `WclError`                                     | ~3                                             | design-dependent                                                                                                  |

Phases 2+3 ship as **one PR, two commits** — CI blocks a red PR, and the commit pair reads as one argument.
