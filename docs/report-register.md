# Report register: how this project's copy is written

Sender-side register block for the analyzer's user-facing strings: verdicts, scorecards, section
prose, the graded sentences in `src/locales/en/report.json`.

**This is the only register record this project keeps.** An earlier one measured the _receiver_ side
from 18,889 words of third-party MoP guide prose across 12 pages and 6 authors; it was removed on
2026-08-28, because this project does not ground its copy standard in other people's writing. What
follows measures the _sender_: how this project's author writes report copy, from 326 words across
11 pieces and one author. Smaller evidence, and it is this project's own.

**Where this lives, and why here.** It was captured as `card/report-register.md` under
`.unslop/voice/analyzer/`, and that directory is ignored: it holds personal writing samples, briefs
harvested from unrelated projects, and third-party guide text that is not this repository's to
publish. The rules and their evidence are a different kind of thing, and `docs/conventions.md` cites
them, so they are tracked here: a citation a clone cannot open is a rule nobody can check. The working
directory keeps its own copy for the agent that loads it. **If the two ever disagree, this one is
the record.**

**Register class:** peer-to-peer technical, authoritative, second person. The reader came for a
verdict and the fix behind it.

---

## Provenance

**Corpus: 11 short reader-facing pieces, 326 words**, plus 4 passages rewritten during A/B voice
calibration. Every rule below either held across every piece in the corpus or is quoted verbatim
from it.

> **Correction, 2026-08-29, and it retracts a correction made the same day.** An earlier note here
> said the corpus was machine-written. That was wrong, and §9 is the disproof: the pieces contain
> `it's` for the possessive, `a Elixir` for `an`, and `you accidentally overwritten` for `overwrote`.
> No model produces those. The corpus is human.
>
> **What is machine-written is this file.** The corpus is 326 words; the rules derived from it run to
> ten sections, and they were derived by a model reading absence as intent. That is the failure mode
> to watch for here, and it has now produced one rule that inverted the author's actual voice — see
> §6, where "write expanded by default" was read off a corpus too small to contain a contraction and
> then enforced against copy that contracts 95 times.
>
> **So the bar below is not a formality, and the audit under it is the file's real index.** A rule
> the shipped copy corroborates stands on the corroboration. A rule resting only on a habit of 326
> words is an observation, and this file may not enforce one.

**The measured profile of that corpus is `low_confidence`.** At 326 words and 11 sentences of prose,
its rhythm and punctuation statistics are noise, and they are deliberately not reproduced here.
What survives is what repeated, and the quotations.

**Read the retraction notes.** Five rules below record a claim that was made and then killed. Three
were killed by a later sample; two were killed by checking the rule against the shipped copy it would
govern. They are kept because a corpus this small invites over-fitting, and the retractions are the
evidence that it happened, five times, in one file. Do not re-derive a killed rule.

**The evidence bar this file now holds itself to.** A rule needs more than absence from 326 words.
Either the corpus shows the author working to avoid the thing, or the copy this rule would govern
corroborates it. The em dash cleared that bar and was enforced across both locale files; "no
semicolons" and "digits, always" did not, and would have broken 735 correct spots between them.

**Tooling.** The scanners referenced below ship with the `unslop` skill, which is vendored and
gitignored; `skills-lock.json` is tracked and pins its source and hash, so a contributor can
reinstall it and run the same gates.

---

## The corroboration audit

Every rule in this file, measured against the 1,787 strings of `report.json` and `ui.json` on
2026-08-29. **`enforced` means the shipped copy corroborates it. `observed` means it held across 326
words and nothing else, which is not enough to hold anyone to.**

| §   | Rule                                      | Shipped copy says                                   | Standing                                                 |
| --- | ----------------------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| 1   | Two-sentence shape, "held in 5 of 5"      | 39% of prose strings are two sentences, 44% are one | **observed** — the commonest shape, not the required one |
| 2   | `managed to` is the praise marker         | **0 uses**                                          | **observed**                                             |
| 2   | Exclamation point live in praise          | **0 uses**                                          | **observed**                                             |
| 3   | Hedge the observation (`You seem to`)     | **0 uses**                                          | **observed**                                             |
| 4   | Authority is an external system           | `the Sim` / `the rotation` in 18 strings            | **enforced**                                             |
| 4   | `proves`, never `suggests`                | **0 uses of `proves`**                              | **observed**                                             |
| 5   | Never first person                        | **0 first-person tokens in 1,787 strings**          | **enforced**                                             |
| 6   | ~~Expanded by default~~                   | **95 strings contract**                             | **retracted**, see §6                                    |
| 7   | No em dash                                | 1 remaining                                         | **enforced**, with the caveat below                      |
| 8   | `TEB`, `RoRo`, `SEF`, `CD` never expanded | **0 uses of any of the four**                       | **observed**                                             |
| 8   | `GCD`, `DPS`, `AoE` never expanded        | 20 strings                                          | **enforced**                                             |
| 9   | Author's grammar habits, do not emit      | 0 instances emitted                                 | **enforced**                                             |

**The em dash is the one row that cannot corroborate itself.** Both locale files were rewritten _by_
that rule, so counting the result and calling it evidence is circular. It is kept enforced on the
other half of the bar — the corpus shows active avoidance, three calibration rewrites restructuring a
sentence rather than take one — and this note is here so nobody upgrades it on the strength of the
count it produced.

**Five of thirteen rows are `observed`.** That is the expected yield from 326 words and is not a
failure of the file; it is the file working. What would be a failure is enforcing one of them.

---

## 1. The two-sentence shape (fault and explanatory copy)

**Observed, not required — see the audit.** Held in 5 of the first 5 corpus pieces, and the shipped
copy is 39% two-sentence against 44% one-sentence, so this is the commonest shape rather than the
form a string has to take. Praise, disagreement and argument each have their own.

1. State the fault or the fact. Second person. Number attached, no preamble.
2. Explain the mechanism or give the fix, opening with a signpost or an imperative.

> You missed your Rune of Re-Origination window by 200ms. Be aware that sometimes the aura can end
> up to 400ms early which makes you miss the snapshot.

> You forgot to refresh Flame Shock within the optimal window. This means your Earth Shock will
> also slowly be delayed from it's optimal window.

Signposts in use: `This is`, `This means`, `which means`, `Be aware that`, `To circumvent this`.
Sentence 2 is an imperative in 2 of 5: `Plan around`, `announce`, `Be aware`.

## 2. Praise inverts the shape

Fault copy leads with the fault and follows with the mechanism. **Praise leads with the evidence and
closes on a short verdict graded to that evidence, and offers no fix at all.**

> You managed to snapshot 7/7 Rune of Re-Origination procs, and all within the 1s GCD leeway.
> Perfect play, nothing to improve here.

> Touch of Karma managed to reflect 100% of your health 4x this fight. Perfect planning!

> You managed to hit the elixir window 6/7 times. That's solid.

- `managed to` in 3 of 3, the strongest praise marker in the corpus — **and it appears in none of the
  1,787 shipped strings.** Observed, not enforced. Credit the difficulty rather than flatter the
  player; whether you do it in these words is open.
- **The verdict is graded to the evidence.** It is not a fixed formula:

  | Evidence                 | Verdict                                  |
  | ------------------------ | ---------------------------------------- |
  | `7/7`, within tolerance  | `Perfect play, nothing to improve here.` |
  | `100% of your health 4x` | `Perfect planning!`                      |
  | `6/7`                    | `That's solid.`                          |

  A flawless count earns `Perfect ...`. A near miss earns `That's solid`, which is warm, brief and
  emphatically not `Perfect`. Match the register to the number. Do not inflate a 6/7.

- Evidence first, always with a count: `7/7`, `4x`, `100%`, `1s`. Ratios, multipliers and
  percentages all appear; pick whichever states the achievement most directly.
- Subject is the player _or_ the ability: `You managed to snapshot`, `Touch of Karma managed to
reflect`. Fault copy always opens on `You`; praise does not have to.
- **Exclamation points are live in praise, sparingly.** `Perfect planning!` is the only `!` in 3301
  words of this author's prose, and it sits on the strongest result of the three. The shipped copy
  carries **none**, so this permits rather than requires: never outside praise, never more than one,
  and a praise string without one is not missing anything.
- Never append advice to praise. Either close the door explicitly (`nothing to improve here`) or
  stop at the verdict.

## 3. Disagreement: hedge the observation, never the correction

> You seem to prioritize Earth Shock before Flame Shock, allowing FS to drop for small periods.
> The rotation is exactly the opposite, you prioritize keeping FS up because it generates Lava
> Surge procs.

This is the one place the corpus hedges, and it hedges precisely one half of the sentence. **One
instance in 326 words and none in the shipped copy: observed, not enforced.** What survives the bar
is the split itself, which is a sound rule wherever the report does infer intent — hedge what you
infer, never what you measure, and never the correction.

- **The observation is hedged**: `You seem to prioritize`. The analyzer is reading intent off a log
  and says so. Fault copy, which reads a fact off a log, never hedges: `You forgot to`, `You
missed`, `You pressed`.
- **The correction is not hedged**: `The rotation is exactly the opposite`. Flat, no softener, no
  `I think`, no `you may want to`.
- **Authority is the rotation, not the author.** The correction appeals to the priority list as an
  external fact.
- Consequence rides along with the observation as a participle: `allowing FS to drop for small
periods`.
- Closes on the mechanism with `because`: `because it generates Lava Surge procs`.
- Comma splice in the correction, as elsewhere: `exactly the opposite, you prioritize`.

Disagreement gets four clauses where fault copy gets two. The extra room goes to the correction and
its reason, not to softening the opening.

### The concession variant

> You have 100% uptime on Searing Totem, but you accidentally overwritten your Fire Elemental 10
> seconds early. This was during Bloodlust, thus a major DPS loss.

A second shape for the same job. Open by granting what the player got right, pivot on `but`, then
state the fault and rank its severity against the fight context.

- The concession is specific and measured (`100% uptime on Searing Totem`), never a generic
  softener. It is a real finding that happens to be good.
- Severity is judged against context, not in the abstract: `This was during Bloodlust, thus a major
DPS loss`. The second clause is elliptical, no verb.
- `thus` appears here, and it is evidence the formal register is live in this author's own prose.
  A voice-calibration game leaned toward plain connectives (`But`, `So`, `Also`) at only 0.57
  confidence, which this outweighs. Do not strip a `thus` that reads naturally.

## 4. Argument: lead with the authority

> The Sim proves that weaving back to your Flask when TEB has less than 1 second left is ideal.
> You're swapping back at 5 seconds or earlier which is suboptimal play.

Argument and disagreement do the same job from opposite ends. **Disagreement leads with what the
player did; argument leads with the rule and measures the player against it.**

1. State the rule and name what establishes it: `The Sim proves that`.
2. State the player's behaviour against that rule, with the number: `at 5 seconds or earlier`.
3. Flat verdict, no hedge: `which is suboptimal play`.

- **Authority is always an external system**, never the author: `The Sim proves`, `The rotation is
exactly the opposite`. First person appears nowhere in 326 words. There is no `I think`, no `in my
experience`, no appeal to the writer's judgement anywhere in the corpus.
- `proves` is not softened to `suggests` or `indicates`. When the Sim settles it, say so. The word
  itself appears in no shipped string, so take the instruction and not the vocabulary: **naming the
  authority is enforced** — `the Sim` or `the rotation` in 18 strings — while `proves` is observed.
- The verdict names the play, not the player: `suboptimal play`, not `you played badly`.

## 5. Certainty: authoritative, and the authority is sourced

**Project ruling, 2026-08-28: uncertainty-hedging is deliberately out of scope.** The analyzer
analyzes and advises, so copy is worded with certainty. The nearest published style match is the
`unslop` skill's `expert-human` preset, and **two of its rules must be overridden here**:

| `expert-human` says                                                                          | This register does                                                                                      |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| "Speaks from experience": `The best executives I've worked with`, `Three startups I advised` | Never first person. Authority is the Sim, the rotation, the log. Zero first-person tokens in 326 words. |
| Uses em dashes in its own examples                                                           | Zero em dashes in 12 pieces. Restructure the sentence instead.                                          |

What carries over: make claims rather than hedge them (`This works`, not `This might work`),
assertion then evidence then implication, numbers and names over generalities, no throat-clearing,
no credential-announcing.

**Certainty here is earned, not asserted.** Every confident claim in the corpus names what settles
it: `The Sim proves that`, `The rotation is exactly the opposite`, `This was during Bloodlust, thus
a major DPS loss`. That is what keeps it clear of the `unsupported rhetorical certainty` defect. A
bare confident assertion with nothing behind it is still a defect, and this ruling does not license
one.

**The one surviving hedge.** `You seem to prioritize Earth Shock` is not uncertainty about the
verdict. It hedges an inference about the _player's intent_, which the log cannot show, while the
correction after it is flat. Keep that split: hedge what you are inferring, never what you are
measuring, and never the recommendation.

## 6. Contractions: rare, not absent

Two genuine contractions in 326 words across 11 pieces:

| Piece    | Contraction                                    | Clause      |
| -------- | ---------------------------------------------- | ----------- |
| praise   | `That's solid.`                                | verdict     |
| argument | `You're swapping back at 5 seconds or earlier` | observation |

Everything else expands where a contraction would fit: `others will not eat your damage`, not
`won't`. `you will now also have`, not `you'll`.

**Retraction, third and final: "write expanded by default" is dead.** It had already been wrong
twice — "zero contractions, every opportunity declined" until the praise pieces, then "contractions
appear only in praise verdicts" until an argument piece put one in an observation clause. The third
correction kills the rule rather than narrowing it, and the evidence is the copy it governs: **95
shipped strings contract.** The rule failed the bar at the top of this file and was enforced anyway,
against a corpus of 326 words in which a contraction had no room to appear. Expanding on that
authority is also the single most reliable tell that prose was generated, so the rule was teaching
the defect this file exists to catch.

**Write the contraction wherever speech would take one.** `can't`, `doesn't`, `you're`. Expand only
where the full form carries weight the short one loses, which is rare and is a decision about that
sentence rather than a default. Nothing enforces this in either direction, deliberately: the last
thing this rule should acquire is a scanner counting apostrophes.

The table above is kept as a record of what the corpus contained, and it is no longer evidence of
anything about how this project should sound.

A measured `contraction_rate` on this corpus reads about 0.012 and overstates it. Two of the four
apostrophe tokens are the possessive `it's` (see §9), which are not contractions.

In longer verdict prose the same author contracts every time (`doesn't`, `isn't`, `would've`). The
split tracks length and purpose, not mood.

**The guide-writing note that used to sit here was the tell, and it was read backwards.** It said to
expect the expanded form to look stiff against guide prose, and to hold the rule anyway. The
observation was right and the instruction was wrong: prose about this game is ordinarily contracted
because that is how people write, and a corpus that declined every contraction was not a house style
worth defending.

## 7. Never

- **Em dashes.** 0 across all 12 pieces, and 3 calibration rewrites restructured sentences
  specifically to avoid one. This is the only rule here standing on active avoidance rather than on
  absence, which is what carried it over the bar; the shipped count cannot corroborate it, because
  the shipped copy was rewritten by it. See the audit. `docs/conventions.md` separately allows the em dash in _this
  repository's_ prose as a deliberate override for appositive definitions; that override is about
  the report's own copy standard, and this line records what the author's own writing does.
- **Exclamation points**, outside praise. See §2.

Parentheses are used, for glosses only: `Elixir of Rapids (Haste)`.

**Semicolons and question marks were on this list and have been taken off it.** They were here on the
strength of "0 in the corpus", and that is not the same kind of evidence as the em dash above. The
dash has 0 across 12 pieces _and_ three rewrites in which the author restructured a sentence rather
than use one: absence plus active avoidance. Semicolons and question marks have only absence, in 326
words, where neither would be expected to appear anyway.

Shipped copy settles it against them. `report.json` and `ui.json` carry **45 semicolons**, every one
joining balanced parallel clauses, which is the register's own contrast shape: _"Catching the procs
matters most; catching them late matters less."_ They carry **3 question marks**, each the correct
form for its job: a decision-tree fork heading (`Do you have the Rune of Re-Origination?`), the
question a section states it asks, and a disclosure trigger the reader clicks (`What happens when you
sign in?`). Enforcing the rule would have damaged all 48.

**The standard this sets.** Absence in a 326-word corpus is not a prohibition. A mark goes on the
Never list when the corpus shows the author working to avoid it, or when shipped copy corroborates.
Two of the three retractions below were caught the same way, one piece at a time; this one was caught
by checking the rule against the copy it would govern before enforcing it.

## 8. Vocabulary and numbers

- Game verbs for player actions: `You pressed`, `You popped`, `You forgot to`, `RoRo can proc`.
- Slash compounds: `Haste/Crit`.
- **Numbers.** In this author's own short strings: digits with the unit attached. `200ms`, `400ms`,
  `1s`, `10 seconds`, `100%`, `4x`, `7/7`, `6/7`, `10 TEB Mastery`. Two exceptions in 11 pieces, both
  explicable: `Fifteen seconds` opens a sentence, and `zero damage` is emphasis rather than
  measurement.

  **This is not the shipped-copy rule, and an earlier version of this line said it was.** "Digits,
  always" was written from about fifteen numbers in 326 words. `report.json` and `ui.json` carry
  **687 spelled-number tokens**, and they are not sloppiness: the copy distinguishes a measured
  quantity from a threshold read as a word, and does it consistently. `brew.verdict_short_other`
  holds both in one sentence: _"averaging {{avg, decimal}} of 10 stacks. {{short}} of them went out
  with the bank under ten."_ `10 stacks` is the figure; `under ten` is the rule being described.
  Prose that names a mechanic spells it (`a thirty-second snapshot dot`, `a seven-charge counter`);
  prose that reports a measurement uses digits.

  **Retractions, both recorded because a 326-word corpus invites them.** An earlier reading claimed
  measurements took digits while rhetorical counts were spelled out; `10 seconds early` killed that.
  The replacement, "digits always", then failed against 687 tokens of shipped copy. Neither survived
  contact with more evidence.

- **Abbreviations, two behaviours, both observed.** Community shorthand for items and procs is never
  expanded: `RoRo`, `TEB`, `CD`, `SEF`. A full ability name is spelled out on first mention in a
  piece and abbreviated after: `prioritize Earth Shock before Flame Shock, allowing FS to drop`.
  Each appears once, so treat this as observed rather than settled.

### The abbreviations themselves

Every abbreviation the author used across the corpus, with what it expands to. **This table exists
because the rule above is dangerous without it**: "never expanded, the reader knows" is only safe
while someone can still say what the letters mean, and nothing else in the repository records that.

| Short  | Expansion              | Uses | Where the expansion is attested                                  | In shipped copy |
| ------ | ---------------------- | ---- | ---------------------------------------------------------------- | --------------- |
| `TEB`  | Tigereye Brew          | 4    | Used against `Tigereye Brew` in full in the calibration rewrites | no              |
| `RoRo` | Rune of Re-Origination | 2    | One piece writes it in full, another abbreviates it              | no              |
| `FS`   | Flame Shock            | 2    | Expanded in the same sentence that abbreviates it                | no              |
| `SEF`  | Storm, Earth & Fire    | 2    | Written in full in the author's own task briefs                  | no              |
| `CD`   | cooldown               | 2    | `Fortifying Brew available as CD`                                | no              |
| `GCD`  | global cooldown        | 1    | `within the 1s GCD leeway`                                       | **yes**, 7 uses |
| `DPS`  | damage per second      | 2    | `one of your main DPS abilities`, `a major DPS loss`             | **yes**, 2 uses |

Two more are already in shipped copy without appearing in the voice corpus, and belong in the same
table so the list is the whole set a reader can meet:

| Short | Expansion            | In shipped copy  |
| ----- | -------------------- | ---------------- |
| `AoE` | area of effect       | **yes**, 17 uses |
| `NPC` | non-player character | **yes**, 1 use   |

And the tier-set pair, adopted on 2026-08-29 with the cause-tag pass. Reader-facing copy writes the set
and the bonus together and never spells either out:

| Short | Expansion               | In shipped copy  |
| ----- | ----------------------- | ---------------- |
| `T15` | tier 15, the Throne set | **yes**, 1 use   |
| `T16` | tier 16, the Siege set  | **yes**, 11 uses |
| `2P`  | two-piece set bonus     | **yes**, 8 uses  |
| `4P`  | four-piece set bonus    | **yes**, 2 uses  |

Written as `T16 2P` and `T15 4P`, never `tier-16 two-piece` and never a bare `two-piece`. The decision
is the user's, taken while the judgment labels were being cut to a tag and a phrase: the old spelling
cost eight words of a ten-word label, and a raider reads the short form everywhere else they meet it.

Two more were supplied by the author rather than found in the corpus. They are recorded because the
pair is a **disambiguation convention** and losing one half of it makes both ambiguous:

| Short | Expansion      | Ability in shipped copy  |
| ----- | -------------- | ------------------------ |
| `LvB` | Lava Burst     | `Lava Burst`, 21 uses    |
| `LB`  | Lightning Bolt | `Lightning Bolt`, 6 uses |

`LvB` exists so `LB` can mean Lightning Bolt without collision. Neither short form appears anywhere
in `src/` or `docs/` today, and neither should be introduced into shipped copy on the strength of
this table. They are here so that a reader who meets them in a brief, a commit message or an issue
can resolve them.

**One spelling to watch.** The author writes the Windwalker cooldown as `Storm, Earth & Fire`, and
that is the expansion recorded above. The codebase writes the ability name `Storm, Earth, and Fire`
in 24 places in `src/`, which is the in-game spelling. Use the in-game spelling in shipped copy and
in code; the ampersand form is shorthand register, not the ability's name. The ability does not
currently appear in `src/locales/` at all.

**Read the shipped-copy column before adopting any of these.** Only `AoE`, `GCD`, `DPS` and `NPC`
are in `src/locales/en/report.json` today. `TEB`, `RoRo`, `FS`, `SEF` and `CD` are how the author
writes to an agent or to another player, not how this report currently addresses its reader, and
this record does not license introducing them. Spelling `Tigereye Brew` in full in a verdict remains
correct. If the shorthand is ever adopted in shipped copy, that is a separate decision and belongs in
`docs/conventions.md`.

### A general WoW glossary was reviewed and deliberately not imported

Five third-party glossaries sit in the gitignored working directory: two wiki-derived terminology
files, Wowhead's Classic glossary, a slang list scraped with its site navigation still attached, and
a small table. Together they hold roughly 660 terms, 293 of them abbreviation-shaped.

**They were checked against this repository and not brought in.** Four reasons, and the first is the
one that decides it:

1. Almost none apply. Testing all 293 against `src/locales/`, `docs/` and the voice corpus returns
   four genuine matches: `AoE`, `DPS`, `NPC` and `CD`. The rest are vanilla-Classic raid shorthand
   (`BWL`, `AQ`, `ZG`, `BRD`), social slang (`AFK`, `BRB`, `LFG`) or auction-house terms. This
   analyzer covers Siege of Orgrimmar in MoP Classic and emits none of them.
2. Their definitions are someone else's prose, complete with wiki footnotes and `wowhead.com` links.
   Importing them republishes third-party writing.
3. One of them is Wowhead's own glossary, and this project deliberately stopped grounding its copy
   standard in Wowhead content on 2026-08-28.
4. A glossary of terms the copy never uses is a maintenance liability, not a reference. It invites a
   later contributor to reach for `OOM` or `BRB` because the repository appeared to bless them.

The abbreviations this project actually uses are the tables above, plus the engineering set in
`docs/conventions.md`. If a new one enters shipped copy, add it here with its expansion rather than
importing a list.

## 9. Grammar: observed, not reproduced

The author writes possessive `it's` (2 of 2 opportunities: `from it's optimal window`, `Plan around
it's use`), `a Elixir` where `an` belongs, and a past participle for a simple past (`you
accidentally overwritten`, where `overwrote` belongs).

**Recorded as an observed habit. Do not emit it.** Write `its`, `an`, `overwrote`. Author's
decision, 2026-08-28: the samples stay verbatim, the output is corrected, because this copy ships to
players and reads as a bug in the tool rather than as voice.

## 10. What the tooling gets wrong here

`voice_card.py --coverage`, from the `unslop` skill, scores `praise`, `disagreement` and `argument`
as `count: 0, covered: false` on this corpus. Its classifier is lexical: it looks for `disagree`,
`however`, `instead`, `not convinced`, `push back`, and this author corrects with `exactly the
opposite` and praises with `Perfect play`. **Sections 2, 3 and 4 are written from verbatim evidence
and the classifier is wrong. Do not let a regenerated coverage matrix delete them.**

`voice_score.py` composites against this corpus are not interpretable. At these lengths, and against
an impostor pool drawn from generic business prose, the number tracks document length rather than
authorship. Judge voiced output with `banned_phrase_scan.py`, `structure_scan.py` and
`readability_metrics.py`, which do work.

## 11. Uncovered

`anecdote`, which report copy is unlikely to need. Nothing else in the taxonomy is missing.

---

## Changelog

- **2026-08-28** Captured. 11 pieces, 326 words, plus 4 calibration rewrites. Extracted here from
  `.unslop/voice/analyzer/card/report-register.md` so `docs/conventions.md` cites a path a clone
  has. Three rules carry retraction notes (contractions twice, number formatting once) because a
  326-word corpus invites over-fitting and it happened three times during capture.
- **2026-08-28** The third-party guide corpus that had backed the receiver-side register was removed
  from the repository, and the cross-references to it here went with it. No rule in this file changed;
  it never rested on that corpus.
- **2026-08-29** The em dash was retired from reader-facing copy on the strength of §7, and
  `src/__tests__/proseDashes.test.ts` gained a gate that holds both locale files to it. Auditing the
  rest of §7 and §8 against that same copy retired two rules instead of enforcing them: "no semicolons
  or question marks" (45 and 3 correct uses in shipped copy) and "digits, always" (687 spelled tokens).
  Two literal-string test pins were converted to property assertions in the same pass, because they had
  been failing shorter copy that satisfied the rule they were protecting.
