# Labels that sit beside a figure

Copy rule for every string that names a number the reader is looking at: summary card rows, stat tiles, table headers, chart legends.

**Where this lives, and why here rather than with the skill it was written for.** It was written as `references/labels-and-figures.md` under `.claude/skills/tone-of-voice/`, and that directory was ignored: the skill was an authoring aid for an agent working in this checkout, not something the repository ships. This is the same split `docs/report-register.md` describes, and for the same reason — `src/components/sections/Scorecard.tsx` cites this rule in the docblock that enforces it, and a citation a clone cannot open is a rule nobody can check. The skill directory kept its own copy for the agent that loaded it. **That skill was removed on 2026-08-28, so this is now the only copy** — which is the outcome the split turned out to guard against.

**Why it is a rule at all.** A label next to a number is read as one phrase, not as two things, so the label's grammatical form has to suit the _shape_ of the figure. When it does not, the reader misreads the **number** rather than the words. That is what separates this from ordinary copy polish: every other wording defect looks like bad writing, and this one looks like bad data.

Derived from fixing it across `windwalker-analyzer`'s summary cards on 2026-08-25, where thirteen of twenty-three rows were wrong at once.

---

## The rule

**The label carries the noun. The figure carries the count.**

| Figure shape         | Example | Label form                    | Why                                                                   |
| -------------------- | ------- | ----------------------------- | --------------------------------------------------------------------- |
| Percentage of a goal | `83.9%` | An instruction is fine        | The number is plainly a share of the thing being asked for            |
| Bare count of faults | `1`     | A noun naming what is counted | An instruction leaves the reader guessing what the number counts      |
| Count over a sample  | `6/18`  | A noun naming the numerator   | A bare ratio under an instruction reads as a score, not a fault count |
| Duration             | `21.9s` | A noun naming the state       | An instruction implies the seconds are the _doing_, not the failing   |
| Average or rate      | `9.5`   | A noun naming the unit        | Nothing in the number says what it averages                           |

The instruction is not lost when it leaves the label. It belongs in the section's own copy, which is where a reader goes for what to _do_. A label's job is to say what they are looking at.

---

## The two failure modes, both found in one pass

**1. A ratio under an imperative reads as a grade.**

`Stop overwriting Tiger Power — 6/18` looks like six out of eighteen, which looks like a bad score. It is actually six presses too many out of eighteen taken. Same number, opposite reading.

The tempting fix is to change the number so the label survives: show `18/12`, presses made over presses needed, and let the gap be the fault. **That was tried here and reverted.** It asks the reader to subtract before they know what they are looking at, and it hides the measured thing in the space between two numbers. Fix the label, keep the number.

**2. The label describes an action while the figure measures its opposite.**

`Spend the shield — 21.9s` — those seconds are time spent _at_ the cap, which is time not spending it. `Spend fuller brews — 9.5` — that is the average stacks a brew consumed, not an answer to the instruction. Both read as the inverse of what they measure, and both are invisible in review because the label and the figure are each defensible alone.

---

## The check

Read the label and the figure aloud as a single phrase.

- If it needs a silent "but" — _"Keep the shield up… but 1"_ — the label is an instruction and the figure is a fault count. Use the noun.
- If it needs arithmetic before it means anything, the number is wrong, not the label.
- If it parses as a school grade when it is a count of mistakes, the label is missing its noun.

`Keep the dot up — 83.9%` survives this. `Shield drops — 1` survives it. `Keep the shield up — 1` does not.

---

## Length

Two or three words is the target, and the noun is usually the whole label. `Wasted refreshes` beats `Refreshes that wasted the dot`, which was itself a correction of `Stop overwriting the dot` — the middle version said the right thing at three times the length it needed.

Keep a qualifier only where the bare noun would be ambiguous **on the card it sits on**. `Wasted Tiger Palm casts` keeps one because a monk has several things worth calling a cast; `Wasted refreshes` drops one because a refresh on the Flame Shock card can only be the dot's.

---

## Worked corrections

| Was                                   | Now                        | Figure  |
| ------------------------------------- | -------------------------- | ------- |
| `Refreshes that wasted the dot`       | `Wasted refreshes`         | `7/9`   |
| `Casts that wasted Tiger Power`       | `Wasted Tiger Palm casts`  | `6/18`  |
| `Catch the procs`                     | `Procs caught`             | `8/13`  |
| `Spend the shocks right`              | `Good shocks`              | `10/20` |
| `Spend fuller brews`                  | `Stacks per brew`          | `9.5`   |
| `Wait for the tenth stack`            | `Brews spent early`        | `1`     |
| `Keep the summons apart`              | `Overlapping summons`      | `0`     |
| `Keep the shield up`                  | `Shield drops`             | `1`     |
| `Spend the shield`                    | `Time at full charge`      | `21.9s` |
| `Press Thunderstorm when you are dry` | `Dry without Thunderstorm` | `9.6s`  |
| `Put Shamanistic Rage down`           | `Shamanistic Rage missed`  | `1`     |
| `Summon before the pull`              | `Pre-pull summon`          | `1/1`   |
| `Drink both potions`                  | `Potions drunk`            | `2/2`   |

Untouched in the same pass, because their figures are percentages and an instruction reads correctly against a share: `Keep the dot up`, `Fill the globals`, `Keep the kick rolling`, `Dot the second target`, `Keep the totem ticking`, `Cover the haste cooldown`, `Stop overflowing the bank`. `Karma wasted` and `Snapshot depth` were already nouns.

---

## The line under the figure

The same reasoning governs the target line the card prints beneath a row, and it fails in both directions.

- A **lid**: `Drink both potions — target 2 or more`, when two is every potion a pull allows. That one cannot be inferred — nothing in a threshold says whether a `good` of 2 is a bar or a cap — so it is declared as `MetricRule.ceiling`.
- A **floor**: `Time at full charge — target 0s or less`, which asks for a duration there is no such thing as. That one needs no declaring, because every lower-is-better rule here counts a fault and none of them goes below nothing.

Either way the line names the number and stops. The reader is being told where the line is, not invited past it.

---

## Guarding it

No type can catch any of this, and a test pinning the literal string is worse than none — it lets someone revert a label to an instruction while the test stays green, which is how the defect shipped the first time. Assert the **property**: the label names what is counted, and is not phrased as an instruction.

```ts
expect(label).toMatch(/wasted/i);
expect(label).not.toMatch(/^Stop /);
```

`src/components/sections/__tests__/scorecard.test.ts` holds these, alongside the two target-line cases.
