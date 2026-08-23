# Audience register: WoW players (MoP Classic, PvE)

Receiver-side register block for content written to World of Warcraft players — sim output, analyzer reports, rotation notes, spec writeups.

**This is not a personal voice profile.** Sections 8 to 13 of `SKILL.md` remain `[not captured]`. This file records how the _audience_ is addressed, not how the author talks. Output written with this file plus the universal layer is still voice-neutral.

**Register class:** peer-to-peer technical. Not corporate, not casual-chatty. The reader is assumed competent and impatient — they came for a number or a decision, not an introduction.

---

## Provenance

**Corpus (2026-08-23): 12 Wowhead MoP Classic guide pages, 18,889 words of body prose, 6 authors, 6 specs.** Overview + rotation page for each spec.

| spec                      | author         | words |
| ------------------------- | -------------- | ----- |
| Balance Druid             | Exesian        | 3,710 |
| Protection Paladin (tank) | WaltherLeopold | 3,596 |
| Fury Warrior              | shoop          | 3,411 |
| Elemental Shaman          | Woah           | 3,006 |
| Beast Mastery Hunter      | Neteyes        | 2,647 |
| Windwalker Monk           | Babylonius     | 2,519 |

URLs follow `wowhead.com/mop-classic/guide/classes/<class>/<spec>/` + `dps-overview-pve`, `dps-rotation-cooldowns-abilities-pve` (tank specs use `tank-` instead of `dps-`). Raw prose not retained — patterns leave the material, the text does not.

**Read the author-spread column, not just the rate.** A marker used by 6/6 authors is a genre property. One used by 1/6 at a high rate is that author's habit, and copying it imports a stranger's voice. This distinction is the main thing the 12-page corpus buys, and it overturned four calls made against an earlier 2-author sample.

---

## 1. What the corpus measured

Rates per 100,000 words. **auth** = how many of the 6 authors use it at all.

### Genre markers — used by every author

| marker                                              | rate | auth |
| --------------------------------------------------- | ---- | ---- |
| negative contractions (`isn't`, `won't`, `doesn't`) | 1545 | 6/6  |
| imperative `Cast X` / `Use X` lines                 | 1275 | 6/6  |
| `you`                                               | 1651 | 6/6  |
| `your`                                              | 1164 | 6/6  |
| numeric digits                                      | 1847 | 6/6  |
| `N seconds`                                         | 449  | 6/6  |
| `N%`                                                | 370  | 6/6  |
| `rotation`                                          | 344  | 6/6  |
| `strong` / `stronger` / `strength`                  | 312  | 6/6  |
| `it's`                                              | 264  | 6/6  |
| `priority`                                          | 248  | 6/6  |
| `very`                                              | 243  | 6/6  |
| `single-target`                                     | 232  | 6/6  |
| `you can`                                           | 217  | 6/6  |
| `burst`                                             | 201  | 6/6  |
| `can be`                                            | 190  | 6/6  |
| `powerful`                                          | 142  | 6/6  |
| `AoE`                                               | 121  | 6/6  |
| `always`                                            | 100  | 6/6  |
| `opener`                                            | 100  | 6/6  |
| `great`                                             | 79   | 6/6  |
| `you need to`                                       | 58   | 6/6  |
| `multi-target`                                      | 52   | 6/6  |
| `usage`                                             | 52   | 6/6  |
| `generally`                                         | 42   | 6/6  |

### Author tics — do NOT adopt

| marker            | rate | auth    | whose                |
| ----------------- | ---- | ------- | -------------------- |
| `us`              | 127  | **1/6** | Exesian, all 24      |
| `area damage`     | 26   | **1/6** | Woah, all 5          |
| `sustained`       | 21   | **1/6** | WaltherLeopold       |
| `typically`       | 15   | **1/6** | WaltherLeopold       |
| `priority damage` | 10   | 1/6     | Woah                 |
| `in order to`     | 10   | 1/6     | Exesian              |
| `excellent`       | 10   | 1/6     | Woah                 |
| `mostly`          | 31   | 2/6     | Woah 5 of 6          |
| `niche`           | 31   | 2/6     | Woah, WaltherLeopold |

### Rare but present — the corrections

An earlier 2-author sample reported these at zero. They are not zero. **Do not write "the genre never says X" from a small sample.**

| marker            | count | auth | earlier claim                                   |
| ----------------- | ----- | ---- | ----------------------------------------------- |
| `however`         | 6     | 4/6  | "formal connectors entirely absent" — **wrong** |
| `fantastic`       | 5     | 3/6  | "0" — wrong                                     |
| `incredible`      | 4     | 3/6  | "0" — wrong                                     |
| `it is important` | 3     | 2/6  | "0" — wrong                                     |
| `keep in mind`    | 2     | 2/6  | "0" — wrong                                     |
| `note that`       | 2     | 2/6  | "0" — wrong                                     |
| `amazing`         | 1     | 1/6  | "0" — wrong                                     |
| `insane`          | 1     | 1/6  | "0" — wrong                                     |
| `rule of thumb`   | 1     | 1/6  | not checked                                     |

### Genuinely absent — 0 across all 18,889 words, all 6 authors

`moreover` · `furthermore` · `additionally` · `essentially` · `basically` · `utilize`/`utilise` · `leverage` · `robust` · `delve` · `seamless` · `worth noting` · `awesome` · **`I`** · `placement` · `application` · `if anything` · `what was wrong` · `bell` · `on the table` · `in the same breath` · `bread and butter` · `low-hanging` · `out of the gate` · `go-to`

Six of those absences are load-bearing for the analyzer's copy work and are quoted in `docs/tone-of-voice-migration.md`: `bell`, `on the table`, `in the same breath`, `placement`, `application`, `if anything`.

---

## 2. Person — and an explicit override of `SKILL.md` §7

**`I` appears zero times in 18,889 words, across all six authors.** This is the strongest single finding in the corpus.

- `you` 1651, `your` 1164 — the reader is the subject of nearly every advice sentence.
- `we` 349 and `our` 269, **6/6 authors** — editorial first-person plural is genre-normal, meaning _the guide_ or _players of this spec_ ("our great utility stays untouched"). An earlier sample called this "rare"; it is not.
- `us` 127 but **1/6 authors** — Exesian only. An author tic, not a genre marker.

### ⚠ `SKILL.md` §7 and `person-density.py` are wrong for this register

§7 assigns **I** to the opening, the method block and the what-did-not-work block, and states that too little first person is the more common failure. That is guidance for personal long-form — an essay, a blog post, a piece published under someone's name. **It does not apply to writing addressed to a player about their own gameplay**, and the corpus is unambiguous: six independent authors wrote 18,889 words of exactly this genre with zero first-person singular.

**The script actively fails correct copy.** Verified against a clean four-sentence report draft:

```
!! I-density problems:
  - no author present: zero first-person words...
  - opening carries no author... The hook is the one block that should be I-led
```

`--strict` exits 1 on that draft. An agent that runs it as a gate and "fixes" the failures will insert an author into a report that must not have one.

**So, for this register:**

- **Do not run `person-density.py` as a gate.** Its I-density ceiling (under 20% sentence-initial) is fine and will never trip here; its zero-first-person and no-author-in-the-opening failures are inverted for this genre and must be ignored.
- **The correct target is zero `I`, and second person throughout.**
- Where a project also bans editorial `we`/`us`/`our` — as `windwalker-analyzer` does, because a report describes a pull rather than being a party to it — that is a **house override tightening the genre**, not a genre rule. Record it as such.

---

## 3. Sentence shape

Measured over 860 prose sentences (priority-list lines excluded):

|                   | corpus       | `SKILL.md` §1 target |
| ----------------- | ------------ | -------------------- |
| median            | **18** words | 11–14                |
| mean              | 20.6         | —                    |
| past 25 words     | **24.7%**    | ~15%                 |
| 10 words or under | 15.0%        | —                    |
| longest           | 81           | —                    |

Per author — and note the spread, because one author drags the average:

| author         | median | >25w      |
| -------------- | ------ | --------- |
| Woah           | **24** | **49.1%** |
| Babylonius     | 19     | 27.2%     |
| Neteyes        | 18     | 24.8%     |
| shoop          | 18     | 17.5%     |
| Exesian        | 17     | 22.3%     |
| WaltherLeopold | 17     | 21.7%     |

Excluding Woah, the genre clusters at **median 17–19, 17–27% past 25**. Woah is the outlier, not the standard. An earlier 2-author sample that was half Woah reported the genre at "median 21, 38.6% past 25" — inflated.

**The universal layer still wins.** §1 targets a median of 11–14; the genre runs 17–19 and is the weaker writing for it. What to take instead:

- **Keep** the habit of stating the reason inside the same sentence as the claim. §1 asks for this too.
- **Keep** the paired-contrast construction — strength then caveat, one breath, joined by `but` or `while`.
- **Drop** the length. Same constructions, cut toward the §1 median.

---

## 4. Punctuation, and the em-dash correction

| mark             | rate   | note                                         |
| ---------------- | ------ | -------------------------------------------- |
| parentheses      | 317    | **the genre's aside mechanism**              |
| colon            | 179    | second choice for an aside or a list lead-in |
| semicolon        | 37     | rare                                         |
| **em-dash**      | **31** | **6 in the entire corpus**                   |
| exclamation mark | 21     | 4 total                                      |
| question mark    | 10     | 2 total                                      |

**The em-dash is not a feature of this genre.** Six instances in 18,889 words, and none is a spaced appositive pair — all six are unspaced dashes joining two clauses (`…Rogues and Feral Druids—it generates at a rate of 10 per second`). Two authors use none at all.

When these authors interrupt a sentence to define a term, they use **parentheses**: WaltherLeopold 750/100k, Woah 432, Babylonius 317, Exesian 215.

This matters for `windwalker-analyzer`, whose `report.json` carries 240 em-dashes across ~19.7% of prose sentences, mostly as spaced appositive pairs. **That is house style with no genre support.** Keeping it is a legitimate house decision — it does real work, defining a measurement mid-sentence where a following sentence would put the definition after the claim that needed it — but it must be recorded as an override of both `SKILL.md` §15 and this corpus, not as "how the audience writes". The genre's own answer to the same problem is a parenthesis.

---

## 5. The three advice forms

Kept separate, and keeping them separate is what makes the writing usable.

1. **Mechanics — flat declarative, third person, present tense, no hedge.** "Chi is the primary resource of a Windwalker Monk." "Abilities cost 1-3 Chi." Never "you will find that Chi is".
2. **Advice — second person.** `you can` (217, 6/6) is the most common frame, then `you need to` (58, 6/6), `you want to` (52, 4/6), `you should` (26, 3/6). Hedges sit **inside** the advice (`generally`, `often`, `usually`), never appended after it. Prohibitions are blunt: `do not`/`don't` 89, `never` 68, `avoid` 42.
3. **Priority lists — bare imperative, verb first, one action per line.** 1275/100k, every author. "Cast Rising Sun Kick." Conditions attach with `if`: "Cast Earth Shock if at 6 or more Lightning Shield charges." No connective prose between lines.

Do not blend them. A mechanic hedged as advice reads as uncertainty about the game. An imperative used for a mechanic reads as a command the reader cannot follow.

---

## 6. Intensifiers and the framing lens

**`strong` is the default quality word** — 312/100k across strong/stronger/strongest/strength, 6/6 authors. Then `powerful` (142, 6/6) and `great` (79, 6/6).

**`very` is a genre marker, not an absence** — 243/100k, 6/6 authors. An earlier sample called it filler to strip. Both readings are true and they resolve cleanly: it _is_ how these authors write, and `SKILL.md` §1 still strips it, because the universal layer is a floor. Use `strong` without the `very`. Record it as an override, not as a corpus absence.

**Enthusiasm adjectives are rare, not absent.** `fantastic` 5 (3/6), `incredible` 4 (3/6), `amazing` 1, `insane` 1, `awesome` 0. Combined they are ~10/100k against `strong`'s 312. The §6 guidance holds — a superlative that carries the excitement means the excitement is manufactured — but the honest statement is "roughly thirty times rarer than `strong`", not "never used".

**Framing lens, by frequency:**

1. **Damage output and meter position** — the primary axis. Everything resolves to whether it increases damage. For a tank spec (WaltherLeopold), survivability substitutes cleanly into the same slot: `priority` runs 15 uses in his pages alone, the highest of any author.
2. **Situational fit** — `depending on` 68, `niche` 31, `situational` 15, `unless`. Nothing is good in the abstract; it is good against 3+ targets, or on movement-heavy fights, or in Challenge Modes.
3. **Waste avoidance** — overcapping, letting abilities sit off cooldown. Loss is a real cost, not a rounding error.
4. **Effort-to-payoff** — "passive and easy to use", "far from set in stone", "what separates the good from the great".

**Analogy domain: cross-class and cross-expansion comparison, almost exclusively.** New mechanics are explained by pointing at one the reader already knows. "This works the same way as Energy does for Rogues and Feral Druids." "On the surface, Chi may seem similar to other secondary resources, like Holy Power for Paladins." Also compared against Retail and against Cataclysm. **No metaphor from outside the game appears anywhere in 18,889 words** — no sport, cooking, machinery, weather or business picture. Checked explicitly: `bell` 0, `on the table` 0, `in the same breath` 0, `bread and butter` 0, `low-hanging` 0, `out of the gate` 0.

---

## 7. Terminology

- **`AoE`, not `area damage`.** `AoE` 121/100k across **6/6 authors**; `area damage` 26/100k from **Woah alone**. An earlier 2-author sample (half of it Woah's) concluded the two split by sense — mode versus output. **That was wrong**, an artifact of the sample. On six authors `AoE` is the genre term in both senses and `area damage` is one author's habit. Related: `cleave` 79 (4/6), `single-target` 232 (6/6), `multi-target` 52 (6/6), `burst` 201 (6/6).
- **Ability, talent, glyph and item names are capitalised exactly and never paraphrased.** `Rising Sun Kick`, `Tigereye Brew`, `Glyph of Chain Lightning`. Never "the kick" or "the brew ability".
- **Stat and resource names are capitalised**: Agility, Intellect, Haste, Crit, Expertise, Chi, Energy, Mana, Rage, Holy Power.
- **Numbers carry units and are exact**: "10 per second", "+1920 Intellect for 10 seconds on a 60 second cooldown", "up to 7 charges, down from 9 in Cataclysm". Approximation is marked with `~`, never with "roughly a few hundred".
- **Contractions are strongly native** — negative contractions 1545/100k across 6/6 authors, `it's` 264. Writing this register without contractions reads stiff.
- **Jargon is used unglossed**: proc, overcap, cleave, funnel damage, snapshotting, BiS, GCD, off-healing, meters, uptime. The reader knows these. Glossing them insults the register.
- **`usage` is fine** (52/100k, 6/6) despite being a nominalization — mostly as a heading, "Cooldown Usage for X". `placement` and `application` are **0** and are not.
- **Spec shorthand is fine in body text** (`WW Monk`, `Ele Shammy`), mostly in the intro sentence.
- **Sims and logs are the authority, cited in passing**, with no methodology defence.
- **Uncertainty about game internals is stated bluntly, sometimes with a shrug**: "Xuen scales dynamically with your Attack Power, Crit and Haste (kinda)". The parenthesis carries the hedge. Worth keeping — it beats a paragraph of qualification.

---

## 8. What NOT to take from this corpus

- **The template intro.** "Our Overview guide for X covers everything you need to efficiently play at any level of PvE" and "Whether you're new to playing X … or you're an experienced DPS looking to…" appear near-verbatim across all six specs with the class name swapped. SEO framing, and precisely the interchangeable prose `SKILL.md` §15 flags.
- **The sign-off.** "Thanks for reading our class guides! If you have any feedback… feel free to leave a comment" trips §4 twice.
- **Sentence length.** See §3.
- **`very`.** See §6.
- **Any 1/6 author tic.** See the table in §1.
- **Content, opinions and spec calls.** Anything the corpus asserts about the game is data with a date on it, not voice.

---

## 9. Changelog

- **2026-08-23 (revised)** — corpus expanded from 4 pages / 5,525 words / 2 authors to **12 pages / 18,889 words / 6 authors** (Balance Druid, Beast Mastery Hunter, Fury Warrior, Protection Paladin, plus the original Elemental Shaman and Windwalker Monk). Added the author-spread column, which is what separates a genre marker from one writer's habit.

  Five corrections to the earlier version, all caused by the 2-author sample:
  1. **`area damage` is one author's tic**, not a sense-distinguished alternative to `AoE`. `AoE` is the genre term. The earlier "mode versus output" ruling is withdrawn.
  2. **`however` and the enthusiasm adjectives are not zero.** `however` 6 (4/6), `fantastic` 5, `incredible` 4. "Formal connectors entirely absent" was wrong.
  3. **Editorial `we`/`our` is genre-normal** (349/269 per 100k, 6/6), not rare. `us` is Exesian's alone.
  4. **Genre sentence length was overstated** — median 18 and 24.7% past 25, not 21 and 38.6%. The earlier figure was inflated by Woah, who is the corpus outlier at median 24 / 49%.
  5. **The em-dash is near-absent** (6 instances, none an appositive pair). The genre uses parentheses. Any em-dash house style is an override with no genre support.

  Added §2's explicit override of `SKILL.md` §7 and of `person-density.py`, after verifying the script exits 1 on correct second-person copy.

- **2026-08-23 (original)** — created from 4 Wowhead pages (Babylonius, Woah), 5,525 words, single register. Superseded above; kept in this log because two of its calls were repeated downstream before being corrected.
