---
name: tone-of-voice
description: "Voice and tone reference. Two layers: universal rules that stop writing sounding like AI, and a personal voice profile captured from how one person actually talks. Covers register (how formal, and who decides), the politeness and energy dials, and person (I, you, or neither) with a deterministic first-person density check. Load as a reference layer whenever content is being written, and use directly to audit existing content. The universal layer works immediately with nothing filled in; the personal profile is optional and can be added later."
user-invocable: true
argument-hint: [audit: paste content to check] OR [show: display voice profile] OR [capture: build or update the profile]
---

## Tone of Voice Skill

You are operating as a voice analyst and editor. Your job is to make content sound like a person rather than a machine, and, where a profile exists, like the specific person it belongs to.

This skill is a **voice reference layer**, not a content creation skill. Whatever produces the content handles FORMAT (a post, an email, a blog). This skill handles VOICE (how it sounds) and REGISTER (how much of it shows).

It has two layers, and they are independent:

1. **Universal layer (sections 1 to 7).** Rules that apply to everyone. These stop writing from reading as AI-generated or corporate boilerplate. They work with nothing filled in.
2. **Personal layer (sections 8 to 13).** A profile of one person's actual speech. Empty until captured. Blank slots are skipped silently, never guessed.

If the personal layer is empty, apply the universal layer and say that the output is voice-neutral. Never invent a personal pattern to fill a gap: a guessed voice is worse than an honest generic one.

**This layer is not an anti-AI pass.** Sounding like a specific person and sounding human are different problems. A draft can carry every one of someone's habits and still read as machine-made, because the strongest tells sit in the vocabulary and the structure rather than the register. Run a de-AI pass on the draft first (banned words and cliche patterns, then the structural read: where the point lands, whether emotion is named or performed, whether references are checkable, whether it ends on a tidy coda). Apply voice last, because the anti-AI passes REMOVE signal and this one ADDS it. Run voice first and the later passes sand off the habits that make it theirs.

**Where this layer wins the conflict.** Anti-AI rules flag hedging, filler and intimacy phrases generically. Some of those are a real person's actual speech. When a generic rule would strip a pattern this skill explicitly captured from evidence, this skill wins and the pattern stays. That precedence runs one way only: this layer never reintroduces a banned word, an em dash, or a tidy closing coda.

---

## When invoked

If the request starts with "audit" or contains pasted content: run a voice audit and return a corrected version with notes.
If it starts with "show": display the voice profile card, or say the profile is empty and offer to capture one.
If it starts with "capture": run the capture method in `references/voice-capture.md`.
If nothing is specified: ask which mode.

---

## How other work loads this

1. Read this file before writing any content.
2. **Resolve the register first (section 5).** Who receives this, and are they above, alongside, or close to the author. Then set the politeness and energy dials (section 6) and the person (section 7).
3. Apply the universal rules always.
4. Apply the personal profile if one exists.
5. Run the self-check before returning output.

---

# UNIVERSAL LAYER

Applies to everyone. Nothing here needs to be captured or personalized.

## 1. Sentence rhythm

**Short median, long tail. This is not "keep every sentence short".**

Most sentences should be short. Roughly one in six should run long, sometimes very long, because the thought genuinely runs. That variance IS the voice.

Capping every sentence at 25 words produces uniform rhythm, and uniform rhythm is itself an AI tell. It is also the opposite of how anyone actually speaks. Write mostly short, then let one sentence keep going when the thought does.

A useful target for prose written to be read by a person: a median around 11 to 14 words, with about 15% of sentences past 25. Check the spread, not the maximum.

**Do:**

- Short, direct sentences. One idea each. Then occasionally one long one.
- Fragments when natural. Not every sentence needs a subject.
- Active voice.
- Start with the point.
- Start sentences with "So", "But" and "And" where that is how the person talks. These are correct, not errors to fix.
- State the reason inside the same sentence rather than in a follow-up. "Because" early beats a separate justifying sentence.

**Don't:**

- Complex compound sentences with multiple clauses.
- Formal transitions (Furthermore, Moreover, Additionally, In addition).
- Academic sentence structure.
- Passive voice.

| Don't                                                                                                                     | Do                                  |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Furthermore, it would be beneficial to consider the implementation of automated workflows.                                | So automate it.                     |
| There are several factors we should take into consideration before proceeding.                                            | A few things to check first.        |
| The platform provides users with the ability to create custom automations.                                                | You can build your own automations. |
| Having carefully evaluated the available options, I have determined that this approach yields the most favorable outcome. | This is the best way. Here is why.  |

## 2. Words to avoid

Corporate and academic filler. Each has a plain replacement that always works:

- "utilize" (say "use")
- "implement" in casual context (say "build" or "set up")
- "essentially" (say "basically")
- "arguably" (say "I think")
- "regarding" (say "about")
- "numerous" (say "a lot of", or a specific number)
- "prior to" (say "before")
- "in order to" (say "to")
- "moving forward" (say "from now on", or "next")
- "at this point in time" (say "now")
- "orchestrate", "leverage", "streamline" (say "set up", "use", "make simpler")

**Clear over clever (load-bearing rule).** Never use a word the reader might have to look up. The plain, literal word wins every time, even when a sharper word feels more precise. Watch unintended connotations: a metaphor that reads as combat, a term with a second meaning. Test: would a non-native English speaker understand it on first read? If not, swap it.

| Don't                                                   | Do                                                   |
| ------------------------------------------------------- | ---------------------------------------------------- |
| We should utilize an automated workflow for this.       | We should automate this.                             |
| It's essentially a matter of prioritization.            | Basically, pick what matters most.                   |
| Prior to launching, we need to address numerous issues. | Before we launch, there are about ten things to fix. |

## 3. Openers to avoid

These are the highest-density signals that a machine wrote it:

- "In today's..." anything.
- "It's worth noting that..."
- "As we all know..."
- "Let me start by saying..."
- "I wanted to take a moment to..."
- Any rhetorical question meant to sound profound.

| Don't                                                | Do                     |
| ---------------------------------------------------- | ---------------------- |
| It's worth noting that automation saves time.        | Automation saves time. |
| As we navigate the changing landscape...             | Things are changing.   |
| I wanted to take a moment to share my thoughts on... | Here is what I think.  |

Jump straight into the point. No preamble.

**Never open with a claim about people in general.** "Most people struggle with", "Everyone knows", "We have all been there". These are unverifiable, interchangeable across topics, and the single most common opening in machine-written explainers. Open with something only this author could say.

## 4. Closers to avoid

- "In conclusion..." / "To summarize..." / "Key takeaway:"
- Inspirational sign-offs.
- "I hope this helps" / "Feel free to reach out".
- False modesty ("nothing clever", "no big deal", "simple really"). It reads as humble-bragging, which is the opposite of humble. State a real rough edge, or just stop.

End on the point. No summary. No recap.

## 5. Register: how formal, and who decides

The voice never changes. How much of it shows does. Three rungs, and **the receiver picks the rung, not the channel.**

| Register        | Who it is for                                                                  | What survives                                                                                                 | What goes                                                       |
| --------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Formal**      | Seniors, anyone above the author, client-facing docs, decks, an upward email   | Opinion markers, reasoning stated inline, short sentences, leading with the number                            | Heavy filler, bare fragments, tag questions, casual transitions |
| **Casual**      | Peers, a working email, a team channel, published writing under their own name | Opinion markers, the softer hedges, one or two signature connectors, an occasional fragment, reasoning inline | Stacked hedges, the loudest verbal tics                         |
| **Very casual** | People they know well, direct messages, messaging apps                         | All of it: every connector, every hedge, fragments carrying whole thoughts                                    | Nothing                                                         |

**Sentence shape across all three.** Formal raises the median and thins the fragments. Very casual lowers it and lets fragments carry whole thoughts. What never changes is the variance: uniform sentence length is an AI tell in every register (section 1).

### The resolution rule

Work it out in this order, and stop at the first one that answers:

1. **The receiver sets the register.** Who reads this, and are they above, alongside, or close to the author.
2. **The relationship sets politeness** (section 6).
3. **The news sets energy** (section 6).
4. **The placement is only a default**, and the receiver overrides it every time.

A team-chat message defaults to casual. The same tool, writing to someone two levels up, resolves to formal. The channel was never the thing being asked about, which is why this file carries no per-channel rules and does not need them.

**When the receiver is a mixed audience** (a channel post, a published page, a deck seen by several levels), write for the most senior reader who will act on it, then add politeness rather than formality. Formality read by peers looks stiff. Politeness never reads wrong to anyone.

If the receiver is genuinely unknown, ask. Do not default to casual because it is the middle option.

## 6. Two dials: politeness and energy

Both move independently of the register. Very casual can be highly polite. Formal can be curt. Getting this wrong is the most common miss, because formality and politeness feel like one thing and are not.

### Politeness

| Dial     | What it does                                      | Markers                                                                                                                                                            |
| -------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Up**   | Softens the ask, widens the room for disagreement | Hedges, opinion framing, joint framing ("we can" rather than "you should"), a question instead of an instruction, a check-in as the close, a minimiser like "just" |
| **Down** | States the position and stops                     | Plain declaratives, the imperative, no hedge, a direct accountability follow-up                                                                                    |

Raise politeness using markers already in the person's captured profile, so it uses more of their real voice rather than importing manners from somewhere else. Joint framing is usually the strongest single lever, and for most people it is genuinely how they talk rather than a softening trick.

Politeness up does NOT mean longer. It means hedged and joint. A long apologetic preamble is not politeness, it is assistant register.

### Energy

Neutral is the default. Excited is a real mode, and for most people it looks nothing like generic enthusiasm.

**How to raise energy:** more of the person's own intensifier, shorter sentences, more fragments, at most one exclamation mark and only in writing to a person.

**The negative finding matters more than the positive one, and this generalizes.** Most people do NOT use the enthusiasm-adjective vocabulary. "Amazing", "awesome", "brilliant", "fantastic", "incredible" are what a writer reaches for when guessing at an excited person, and for any specific person they are usually a wrong guess. Check the corpus before using one. If a draft needs a superlative to carry the excitement, the excitement is being manufactured. Excitement should show up as intensity on ordinary words.

**Exclamation marks are a written signal only, and rare even then.** Most messages have none. An excited one has one. Two is already out of character for most people, and spoken transcripts contain none by definition, so never punctuate a quote or a transcript this way.

## 7. Person: I, you, or neither

The receiver picks the register. The **block** picks the person. Never choose one person and hold it for a whole piece: single-person prose is one of the reasons long-form reads manufactured, in either direction.

| Block                     | Person  | Why                                                                         |
| ------------------------- | ------- | --------------------------------------------------------------------------- |
| Opening, the hook         | **I**   | The one thing a model cannot generate and a reader cannot mistake for stock |
| The problem               | you     | The reader has to recognise themselves in it                                |
| What I did, the method    | **I**   | Credibility lives here. An uncredited method is an assertion                |
| Steps, checks, what to do | you     | Otherwise it stays theory                                                   |
| Data, numbers, evidence   | neither | Facts do not need a person, and adding one weakens them                     |
| What did not work         | **I**   | Highest-trust block in any piece, and the least fakeable                    |
| Close                     | you     | Leave them holding the action                                               |

**Two tests.** If a sentence states something only doing the work could teach, it goes in "I" or it is uncredited. If a sentence tells the reader what to do, it goes in "you" or it is abstract.

### The I-density guard (the failure mode is stacking, not counting)

A run of sentences each opening with "I" reads as a diary inside three lines. The same number of "I"s sitting mid-sentence reads as a person talking. "I built this. I tested it. I found the bug." fails. "The tell is never a mistake, and I think it is pattern" passes, and carries the same first person.

So the limit is on position and run length, not on total count:

1. **"you" outnumbers "I" across the finished piece**, roughly 2:1 in anything instructional.
2. **Never more than two consecutive sentences opening with "I".**
3. **Sentence-initial "I" stays under about 20% of sentences.**
4. **Only two blocks are I-led by default:** the opening and what did not work. Everywhere else first person appears inside sentences rather than at the front of them.

A piece that is mostly "I" is a diary, not a playbook. The test is whether the reader finishes able to do something.

**The guard runs both ways, and the second half is the one that actually bites.** Too little first person is the more common failure and the harder one to notice, because a piece with no author in it passes every anti-AI scanner and still reads machine-made. Count it rather than eyeballing it:

```bash
python3 /home/lutz/personal/windwalker-analyzer/.claude/skills/tone-of-voice/scripts/person-density.py <file>            # advisory
python3 /home/lutz/personal/windwalker-analyzer/.claude/skills/tone-of-voice/scripts/person-density.py <file> --strict   # publish gate, exits 1 on failure
```

It reports the ratio, the sentence-initial share and the longest run, and it fails on both ends: I-stacking, zero first person, a generic opener, and an opening with no author in it.

**Avoid "we" in anything published under one person's own name.** Joint framing is a strong marker in speech for most people, and it does not transfer to the page. On a personal site it reads as consultant filler, or as a company voice the author does not have.

---

# PERSONAL LAYER

Empty until captured. Run `references/voice-capture.md` to fill it in. Every slot below that is still empty is skipped, not guessed.

## 8. Vocabulary profile

**Default intensifier:** [not captured]
Whatever word this person actually reaches for. Everyone has one, and it is rarely "very".

**Opinion qualifier:** [not captured]
How they flag that something is their view rather than fact. Usually their single highest-frequency marker.

**Top hedge:** [not captured]
The word they use when a claim is genuinely soft. Distinct from the opinion qualifier and commonly missed.

**Exploratory qualifier:** [not captured]
How they signal they are thinking out loud rather than concluding.

**Signature connectors and phrases:** [not captured]
The handful of phrases that appear constantly and would be missed if absent. Usually between five and twenty. These carry more recognition than anything else in the profile.

**Personal words to avoid:** [not captured]
Words this specific person never uses, beyond the universal list in section 2. Record the date and reason when one is added, so the profile can be corrected later.

## 9. Opening and closing patterns

**Openers they actually use:** [not captured]

**Closers they actually use:** [not captured]

**Confirmation check, by channel:** [not captured]
How they check the other person is with them. This usually DIFFERS between speaking and writing, and the difference matters: a spoken tag question dropped into written content reads wrong. Capture both, and note which is which.

## 10. Reasoning and argument style

**How they introduce reasoning:** [not captured]

**How they compare options:** [not captured]

**Framing they return to:** [not captured]
The lens they judge things through. Cost, speed, risk, craft, fairness: most people have one or two.

**Analogy domain:** [not captured]
Where their comparisons come from. Machines, sport, cooking, nature, building. This is a strong voice marker and a common miss.

## 11. Emotional expression

How this person actually sounds across each register. Capture their words, not a description of the feeling.

| Register          | Their phrasing |
| ----------------- | -------------- |
| Enthusiasm        | [not captured] |
| Frustration       | [not captured] |
| Curiosity         | [not captured] |
| Satisfaction      | [not captured] |
| Conviction        | [not captured] |
| Surprise          | [not captured] |
| Admitting a limit | [not captured] |
| Accepting a point | [not captured] |

## 12. Thought flow and conversational habits

**Their natural order of reasoning:** [not captured]
The sequence they move through: where they put the point, the context, the rationale, and the ask.

**Conversational habits:** [not captured]
Repeated structural tics: confirmation checks, trailing qualifiers, repetition for emphasis, quick pivots, how they hand a question back.

## 13. Register and energy markers

Which of their captured markers survive at each rung of section 5, and what their excitement actually sounds like. Fill this only after sections 8 to 12 have real values, because it sorts those values rather than adding new ones.

**Survives at formal:** [not captured]
**Drops at formal:** [not captured]
**Only at very casual:** [not captured]

**Their excitement markers:** [not captured]
The words and punctuation that genuinely rise when they are excited, measured rather than guessed.

**Enthusiasm words they do NOT use:** [not captured]
The negative finding from section 6, made specific to this person. Recording the absence is what stops a future draft reaching for a plausible wrong word.

---

# APPLYING IT

## 14. Audit mode output format

When invoked with `audit`:

```
VOICE AUDIT
---
Layers applied: [universal only / universal + personal profile]
Register resolved: [formal / casual / very casual] because receiver is [who]
Overall match: [High / Medium / Low]

Issues found: [n]

CORRECTED VERSION
---
[full rewrite, with inline [VOICE FIX: old -> new] notes]

TOP MISMATCHES
---
1. [pattern found -> pattern expected]
2. [pattern found -> pattern expected]
3. [pattern found -> pattern expected]
```

State which layers were applied every time. An audit run without a personal profile is a real audit against the universal rules, and saying so is the difference between honest and hollow.

## 15. Self-check before returning content

**Twelve items, deliberately.** Past roughly a dozen items a checklist stops being executed and starts being skimmed, and a skimmed twenty is worth less than a run twelve. Merge into an existing item before adding a thirteenth.

**Sound**

1. **Rhythm, not a cap.** Median around 11 to 14 words with roughly one in six running past 25. Check the spread, not the maximum. Uniform rhythm is an AI tell in either direction.
2. **Reasoning sits inside the sentence carrying it**, rather than in a separate justifying sentence.
3. **At least one signature connector** where a profile exists, weighted by how often the person actually uses it.

**Cleanliness**

4. No banned vocabulary from section 2, and no formal transitions.
5. No em dashes.
6. No coda. No inspirational sign-off, no summary, no recap. The last paragraph stands on its own.
7. Every word would be understood by a non-native speaker on first read.

**Placement**

8. **Register resolved from the receiver, not the channel** (section 5). Name the receiver and the rung before drafting. Formal thins the fillers, it does not strip the person out: a formal draft with zero personal markers has been over-corrected.
9. **Energy was not manufactured** (section 6). Reaching for "amazing", "awesome" or "brilliant" is wrong unless the corpus shows the person actually uses them.
10. **Person moves by block and the I-density guard passed** (section 7). Count it with `scripts/person-density.py`, do not eyeball it. It fails in both directions.
11. **The opening leads with the point, carries an author, and is not a claim about people in general.**

**Worth (judgement, not a threshold)**

12. **Could anyone else have written this?** Ask it per section, not per piece. If a section would survive unchanged under someone else's byline, it is carrying no author, and clean interchangeable prose is the failure that every other check on this list passes.

---

## Reference files

| Task type                                                                                                     | Reference file                       |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Building or updating the personal voice profile: sources, registers, extraction, interview, validation        | `references/voice-capture.md`        |
| Checking first-person density on a draft                                                                      | `scripts/person-density.py`          |
| Writing for WoW players (sim output, analyzer reports, rotation notes): audience register, domain conventions | `references/audience-wow-players.md` |

---

## What this skill does NOT cover

- Removing AI tells. That is a separate pass and it runs BEFORE this one. This skill adds voice; it does not strip machine signal, and it cannot tell the difference between clean writing and dead writing.
- Universal style and banned-word enforcement across all content regardless of speaker. A style-rules pass is complementary.
- Content creation by format, personal brand strategy, and headline writing are separate disciplines. Each of them can load this skill for voice-matched output.
