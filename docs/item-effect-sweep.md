# The item-effect sweep, in three tiers

Every trinket, enchant, gem, meta-gem and legendary-cloak proc id this analyzer derives from the
simulator, sorted by **what a real log says about it** — and, where a log says nothing, by _why_.

This document exists because plan §51a's own tier-3 list was never written down. That section names
about seven of roughly seventy derived-but-unconfirmed ids, defers "the rest" and eleven "honest gaps"
to _"the lane's report"_, and that report is not in the repository. So the plan cites a list nobody
could check, while §51's own box warns against precisely the mistake the list was supposed to prevent:
treating **absent from every fixture** as **wrong**.

The tiers are kept apart on purpose. Collapsing tier 2 into tier 3 is how a real effect gets deleted;
collapsing tier 3 into tier 2 is how `144998` survived — declared, wired to five readers, measuring
nothing, silent through fifty-three green tests.

Citations here are files and symbols, never line numbers. This repository's line references have
rotted by tens of lines under concurrent edits; three in one commit had drifted by 74.

---

## The instrument, and what it cannot rule out

**Read this before reading a single zero below.**

### What was used here

|      |                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logs | The **four committed raw fixtures**: `elemental/{cleave,phased,unbroken}.json` and `windwalker/dataset-ironJuggernaut.json`. Four players, three of them the same shaman's kit. |
| Gear | Each pull's own `combatantinfo` — eighteen slots, the item id in each, its gems, and the slot's `permanentEnchant`.                                                             |
| Sim  | `wowsims-mop` at `49588f62b`: `sim/**/*.go` for the Go declarations and `assets/database/db.json` for the client data.                                                          |

Everything asserted below was either measured on those four event streams or derived by reading those
two sources. Nothing was fetched from WarcraftLogs for this document.

### What §51a used, and whether the repo can confirm it

§51a reports three anonymous 25H Siege raid nights — `a:xB3kh7v9pF2AHRtq`, `a:qHRAFwdGzaB6MPYC`,
`a:6MhZgjyAknFWrYfK` — at ~75 gear sets, 1,317 distinct friendly ids plus 217 enemy debuff ids, for
~86 of 9,000 API points.

**That claim is attested in the repository in two committed places, and it is not reproducible from
it.** The module doc of `lib/game/__tests__/shared.test.ts` states the instrument in those words, and
`lib/game/shared.ts` carries its per-effect counts throughout — 13,024 Dancing Steel applications,
`0 against 45 / 102 / 683 / 1,424 / 275` for the five inverted payloads, `2,072 · 1,246 · 3,068` for
the tinker's three stat ids, 818 for Re-Origination, 44 for Ancient Hysteria. But there is no cached
query, no fixture, no script and no test behind any of those numbers. **Every one of them is unguarded
prose.** They are recorded here as _inherited_, labelled as such at each use, and they are not mine.

So: the wide instrument is **documented but not reproducible**. I did not re-run it and this document
does not inherit its coverage.

### The ceiling of the instrument I did use

**What it can rule out.** For the **eleven** gear effects the four players demonstrably equipped, a
declaration on a number the game does not write is now impossible to hold quietly: `equipped` and
`fires` are asserted as one biconditional in `lib/game/__tests__/sharedFixtures.test.ts`
(`GEAR_SOURCES`, _"fires on exactly the pulls that equipped it"_). That is the entire class of thing a
log can falsify, and it is closed on the gear these fixtures own.

**What it cannot rule out — and this is most of the list.** The four gear sets between them hold
**two** distinct trinket pairs, **two** meta gems, **two** legendary cloaks and **four** distinct
weapon/cloak enchants. Every tier-2 entry below is an effect _none of them wore_. Those ids are not
weakly tested by this instrument; they are **untested**. A zero against them carries no information
about the declaration at all.

**Two things it is structurally blind to.**

- **The glove tinker.** `combatantinfo` reports one `permanentEnchant` per slot, and on all four pulls
  the hand slot reports 4433 (Superior Mastery). Synapse Springs is enchant 4898 on the same item and
  has nowhere in the event to go — so the gear reading says "no tinker" on four pulls that all press 126734. Pinned as its own test, _"cannot see the glove tinker, which four pulls demonstrably had"_.
- **Damage ids.** An effect whose only footprint is a damage event is invisible to any aura sweep. This
  is what resolves gap 1 below, and it is trap #2 of §51a's own two traps, one table over.

**Four players is not seventy-five.** Where a statement below needs the wide instrument, it says so.

---

## Tier 1 — confirmed present in a committed fixture

Counts are **events carrying the id, scoped to the audited actor** (`sourceID` or `targetID`), in the
order `cleave · phased · unbroken · dataset-ironJuggernaut`. Actor-scoped because these streams carry
eleven to twenty ids per pull belonging to other raiders; an unscoped count would credit this player
with somebody else's identical trinket.

### The gear effects — thirteen ids across twelve declarations

| id     | key                           | source, and where it is derived from                                                                          | events                 | equipped by               |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------- |
| 96228  | `synapse-springs` (Agility)   | tinker enchant 4898, `sim/common/mop/enchants.go` — `RegisterTemporaryStatsOnUseCD` with `GetHighestStatType` | 0 · 0 · 0 · **7**      | not readable, see ceiling |
| 96230  | `synapse-springs` (Intellect) | same effect, different stat granted                                                                           | **9 · 8 · 6** · 0      | not readable, see ceiling |
| 137590 | `tempus-repit`                | Sinister Primal Diamond, gem 95347 — `sim/common/mop/metagems.go`                                             | **22 · 20 · 15** · 0   | all three Elemental       |
| 137596 | `capacitance`                 | Capacitive Primal Diamond, gem 95346 — `sim/common/mop/metagems.go`                                           | 0 · 0 · 0 · **131**    | Windwalker                |
| 139120 | `re-origination` (Mastery)    | Rune of Re-Origination, item 96546 — `sim/common/mop/trinkets_phase_3_52.go`                                  | 0 · 0 · 0 · **8**      | Windwalker                |
| 146046 | `expanded-mind`               | Purified Bindings of Immerseus, item 104426 — `db.json` `itemEffects[0]`                                      | **5 · 4 · 4** · 0      | all three Elemental       |
| 146194 | `flurry-of-xuen`              | Fen-Yu, item 102248 — `sim/common/mop/cloaks_phase_4_54.go`                                                   | 0 · 0 · 0 · **25**     | Windwalker                |
| 146198 | `essence-of-yulon`            | Xing-Ho, item 102246 — `db.json`; ignite in `cloaks_phase_4_54.go`                                            | **26 · 39 · 37** · 0   | all three Elemental       |
| 148903 | `vicious`                     | Haromm's Talisman, item 105527 — `sim/common/mop/trinkets_phase_4_54.go`                                      | 0 · 0 · 0 · **13**     | Windwalker                |
| 148906 | `toxic-power`                 | Kardris' Toxic Totem, item 104544 — `db.json` `itemEffects[1]`                                                | **9 · 12 · 10** · 0    | all three Elemental       |
| 104993 | `jade-spirit`                 | enchant 4442 — `db.json`, `sim/common/mop/enchants.go`                                                        | **26 · 19 · 11** · 0   | all three Elemental       |
| 120032 | `dancing-steel`               | enchant 4444 — **the logged id, which neither source names**; see tier 3                                      | 0 · 0 · 0 · **28**     | Windwalker, both weapons  |
| 125487 | `lightweave`                  | enchants 3722/4115/4892 — `db.json`                                                                           | **10** · 0 · **7** · 0 | cleave, unbroken          |

`lightweave`'s zero on `phased` is the row worth pausing on. It is not a dry spell: that pull's cloak
carries enchant **4423**, plain Superior Intellect, where the other two carry 4892. Until this
document that zero could only be read as "did not proc" — which is the whole confusion in miniature.

### Not gear, and in the same shared block

| id                   | key            | evidence                                                                                                                                                                                                                                                                                         |
| -------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 26297                | `berserking`   | 6 · 0 · 5 · 0 — troll racial                                                                                                                                                                                                                                                                     |
| 2825 / 32182 / 80353 | `bloodlust`    | 0·0·**45**·0 / 0·**2**·0·0 / **2**·0·0·**1** — three of the five ids confirmed                                                                                                                                                                                                                   |
| 114206               | `skull-banner` | **8 · 8 · 4 · 6** — another player's raid cooldown; `sim/core/buffs.go`. These are the four numbers `undeclaredAuras.test.ts` pins, and the scoping is why: unscoped, the same id reads 12 · 10 · 4 · 12, because Skull Banner lands raid-wide and the streams carry other actors' copies of it. |

### Damage and set ids that bear on the sweep

These are not auras and are correctly declared as none, but they are the log's own answer to something
in tier 3, so they belong here as evidence.

| id              | what it is                                                                                        | events                       |
| --------------- | ------------------------------------------------------------------------------------------------- | ---------------------------- |
| 144999          | the T16 two-piece debuff — **what the game writes where the sim exposes 144998**                  | **20 · 20 · 18** · 0         |
| 145024          | Windwalker T16 four-piece `focus-of-xuen` — **what the game writes where the sim exposes 145022** | 0 · 0 · 0 · **13**           |
| 148008          | `essence-of-yulon`'s ignite, `cloaks_phase_4_54.go`                                               | **101 · 102 · 106** · 0      |
| 147891          | `flurry-of-xuen`'s strikes, `cloaks_phase_4_54.go`                                                | 0 · 0 · 0 · **133**          |
| 137597          | Capacitance's Lightning Strike payout, `metagems.go`                                              | 0 · 0 · 0 · **15**           |
| 120676 / 120687 | Stormlash aura / damage — the split §51a corrected                                                | **8·4·8·4** / **20·9·16·12** |
| 145441          | "Yu'lon's Barrier" — a healer's legendary cloak absorbing for this player                         | **7** · 0 · 0 · 0            |

**Guarded by:** the counts in the first table are enforced per effect by
`lib/game/__tests__/sharedFixtures.test.ts` — `windowCount` grids for the four Elemental effects,
window counts for `synapse-springs` and `dancing-steel`, `applydebuff` counts for `essence-of-yulon`,
and the new `GEAR_SOURCES` biconditional across all thirteen ids. `114206`'s four counts are pinned in
`lib/game/__tests__/undeclaredAuras.test.ts`. **Not guarded:** the damage-id table above; those
numbers are measured here and nothing asserts them.

---

## Tier 2 — derived, real, and absent from every log we hold

**Every entry here is an effect none of the four players equipped.** That is now a measured statement
and not an assumption: the source item, gem or enchant id of each was checked against all four
`combatantinfo` gear arrays, and none of them appears. So the correct reading of every zero in this
tier is **"not worn"**, and there is not one case in the committed set of an effect that was equipped
and stayed silent.

That is the finding of this tier, and it is what licenses the four never-firing lanes on the Elemental
timeline to keep their written reason.

### Trinkets — Throne of Thunder

| id(s)           | key                                | item                                 | derived from                                                                |
| --------------- | ---------------------------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| 138963          | `unerring-vision`                  | Unerring Vision of Lei-Shen 94524    | `db.json` `itemEffects[0]`; `trinkets_phase_3_52.go` `UnerringVisionBuffId` |
| 138786 · 138788 | `wushoolays-lightning` · `-stacks` | Wushoolay's Final Choice 94513       | `db.json` `itemEffects[0].buffId` / `.stackingAura.buffId`                  |
| 138898          | `breath-of-hydra`                  | Breath of the Hydra 94521            | `db.json` `itemEffects`                                                     |
| 139133          | `chayes`                           | Cha-Ye's Essence of Brilliance 94531 | `db.json` `itemEffects`                                                     |
| 138938          | `juju-madness`                     | Bad Juju 94523                       | `db.json` `itemEffects[0]`                                                  |
| 138870          | `rampage`                          | Primordius' Talisman of Rage 94519   | `db.json`; five stacks on the one id                                        |
| 139170          | `eye-of-brutality`                 | Gaze of the Twins 94529              | `db.json`; three stacks on the one id                                       |
| 138756 · 138737 | `blades-of-renataki` · `-stacks`   | Renataki's Soul Charm 94512          | `db.json` window / counter pair                                             |
| 138759 · 138760 | `feathers-of-fury` · `-stacks`     | Fabled Feather of Ji-Kun 94515       | `db.json` window / counter pair                                             |
| 138856          | `cloudburst`                       | Horridon's Last Gasp 94514           | `db.json`; a healer's mana return, five stacks                              |

### Trinkets — Siege of Orgrimmar

| id(s)           | key                              | item                                | derived from                                    |
| --------------- | -------------------------------- | ----------------------------------- | ----------------------------------------------- |
| 146184 · 146202 | `wrath-of-darkspear` · `-stacks` | Black Blood of Y'Shaarj 102310      | `db.json` window / counter pair                 |
| 146285 · 146293 | `cruelty` · `-stacks`            | Skeer's Bloodsoaked Talisman 102308 | `db.json`; **twenty** stacks on a 500 ms period |
| 146308          | `dextrous`                       | Assurance of Consequence 102292     | `db.json` `itemEffects[1]`                      |
| 146314          | `titanic-restoration`            | Prismatic Prison of Pride 102299    | `db.json` `itemEffects[1]`                      |
| 148899          | `tenacious`                      | Fusion-Fire Core 102295             | `db.json` `itemEffects[1]`                      |
| 148896          | `ferocity`                       | Sigil of Rampage 102302             | `trinkets_phase_4_54.go`                        |
| 146310          | `restless-agility`               | Ticking Ebon Detonator 102311       | `db.json`; twenty stacks, **no** counter aura   |

### Gems, cloaks, enchants

| id(s)                    | key                     | source                                | derived from                                |
| ------------------------ | ----------------------- | ------------------------------------- | ------------------------------------------- |
| 137593                   | `fortitude`             | Indomitable Primal Diamond, gem 95344 | `sim/common/mop/metagems.go`                |
| 146200                   | `spirit-of-chi-ji`      | Jina-Kang 102247                      | `db.json` `itemEffects[0]`                  |
| 104423 · 104509 · 104510 | `windsong`              | enchant 4441                          | `db.json` `enchantEffects[]`; `enchants.go` |
| 116660                   | `rivers-song`           | enchant 4446                          | `db.json`                                   |
| 125489                   | `swordguard-embroidery` | enchants 3730/4118/4894               | `db.json`                                   |
| 109085                   | `lord-blastingtons`     | enchant 4699                          | `db.json`; `enchants_auto_gen.go`           |

### Ids inside a tier-1 effect that this instrument never saw

These are the sharpest thing in this document that **no guard covers**. Each belongs to an effect that
_is_ confirmed in tier 1, so `SILENT_AURAS` cannot see them — that census is keyed per aura, and the
aura fires. Their absence is a property of one player's stat priorities.

| id     | effect                       | why it never fired here                                                              |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------ |
| 96229  | `synapse-springs` (Strength) | the tinker grants your **highest** stat; neither player is a strength class          |
| 139117 | `re-origination` (Crit)      | the Rune returns your highest secondary; this monk's gear returns Mastery every time |
| 139121 | `re-origination` (Haste)     | same                                                                                 |

The wide instrument saw all three (96229 at 1,246 applications, and 818 across the Rune's three ids) —
**inherited, unguarded.**

### Not gear

| id     | key                            | note                                                                    |
| ------ | ------------------------------ | ----------------------------------------------------------------------- |
| 33697  | `blood-fury`                   | orc racial; neither player is an orc                                    |
| 90355  | `bloodlust` (Ancient Hysteria) | the BM hunter's pet; 44 applications on the wide instrument — inherited |
| 146555 | `bloodlust` (Drums of Rage)    | no raider in these four pulls brought them                              |
| 116616 | Elemental Force, enchant 4443  | **a damage id, not an aura** — see gap 1                                |

**Guarded by:** `SILENT_AURAS` in `lib/analysis/__tests__/fixtureCoverage.test.ts` is the exact census
of declared auras that fire on no committed pull, per spec — it is not an allowlist, so an entry
cannot arrive before its declaration. The new `GEAR_SOURCES` census in
`lib/game/__tests__/sharedFixtures.test.ts` is what adds the _reason_: it pins which pulls equip each
effect, so a fixture arriving with Bad Juju on it fails by name and this table is what to correct.
**Not guarded:** the three id-level rows above, and every inherited count.

---

## Tier 3 — derived and structurally unloggable

Each entry says why the game can never write it. This is the tier `144998` belonged to and was filed
in tier 1 by mistake, which cost a chart lane, an APL gate and a set of windows.

### 3a. The seventy `ExposeToAPL` handles — the list §51a lost

**Why they cannot appear.** `ExposeToAPL` in `sim/core/item_sets.go` does one thing:
`setBonusTracker.ActionID = ActionID{SpellID: spellID}`. The aura it stamps is built by
`makeSetBonusStatusAura` in the same file — a permanent aura labelled `"<Set Name> <N>P"` with
`Duration: NeverExpires`, wrapped in `MakePermanent`, activated at the gear build phase and toggled
only by an item swap. It is the simulator's **"is this set equipped"** boolean, given a spell id purely
so an APL condition can name it. _Equipment is not an event_, so there is nothing for a combat log to
write. Where a set bonus also has a visible buff, the sim registers that separately under its own
`ActionID`.

**The derivation, and it reproduces §51a's number exactly.** `sim/**/*.go` carries **77**
`ExposeToAPL` call sites plus the definition; 76 pass a numeric literal (one, `monk/items.go`, passes
`triggerActionId.SpellID`). Of those 76, **70 appear nowhere else in the Go tree** and 6 do — which is
§51a's "70 ids exist only as `ExposeToAPL` handles", re-derived.

**And zero of them are in an item file.** `grep ExposeToAPL sim/common/` returns nothing. Every handle
belongs to a tier set (75) or a glyph (1). So this sweep's risk was never APL handles at all — which
is what §51a concluded, now confirmed.

**Confirmed twice on committed fixtures, not once.** Both halves of the mechanism are visible in the
repository's own pulls:

| set bonus                              | the sim's handle | events        | what the game writes   | events               |
| -------------------------------------- | ---------------- | ------------- | ---------------------- | -------------------- |
| Shaman T16 2pc (`shaman/items_mop.go`) | **144998**       | 0 · 0 · 0 · 0 | 144999                 | **20 · 20 · 18** · 0 |
| Monk T16 4pc (`monk/items.go`)         | **145022**       | 0 · 0 · 0 · 0 | 145024 `focus-of-xuen` | 0 · 0 · 0 · **13**   |

The Windwalker pair is the stronger of the two, because that player is wearing four pieces of Seven
Sacred Seals (99393, 99395, 99396, 99155) — the set bonus is provably active, its real aura fires
thirteen times, and its handle is still zero.

**None of the seventy appears in any committed fixture.** Nor do the six that are referenced
elsewhere. Measured across all four event streams, all types, unscoped.

| id         | set bonus                                      | citation                                                      |
| ---------- | ---------------------------------------------- | ------------------------------------------------------------- |
| 70762      | White Tiger Battlegear 4P                      | `paladin/items.go`                                            |
| 123077     | Battlegear of the Lost Catacomb 2P             | `death_knight/items.go`                                       |
| 123078     | Battlegear of the Lost Catacomb 4P             | `death_knight/items.go`                                       |
| 123079     | Plate of the Lost Catacomb 2P                  | `death_knight/items.go`                                       |
| 123080     | Plate of the Lost Catacomb 4P                  | `death_knight/items.go`                                       |
| 123086     | Armor of the Eternal Blossom 2P                | `druid/guardian/items.go`                                     |
| 123087     | Armor of the Eternal Blossom 4P                | `druid/guardian/items.go`                                     |
| 123097     | Regalia of the Burning Scroll 2P               | `mage/items.go`                                               |
| 123101     | Regalia of the Burning Scroll 4P               | `mage/items.go`                                               |
| 123102     | White Tiger Vestments 2P                       | `paladin/items.go`                                            |
| 123103     | White Tiger Vestments 4P                       | `paladin/items.go`                                            |
| 123104     | White Tiger Plate 2P                           | `paladin/items.go`                                            |
| 123107     | White Tiger Plate 4P                           | `paladin/items.go`                                            |
| 123108     | White Tiger Battlegear 2P                      | `paladin/items.go`                                            |
| 123114     | Regalia of the Guardian Serpent 2P             | `priest/items.go`                                             |
| 123115     | Regalia of the Guardian Serpent 4P             | `priest/items.go`                                             |
| 123142     | Battleplate of Resounding Rings 2P             | `warrior/items.go`                                            |
| 123144     | Battleplate of Resounding Rings 4P             | `warrior/items.go`                                            |
| 123146     | Plate of Resounding Rings 2P                   | `warrior/items.go`                                            |
| 123147     | Plate of Resounding Rings 4P                   | `warrior/items.go`                                            |
| 123149     | Battlegear of the Red Crane 2P                 | `monk/items.go`                                               |
| 123150     | Battlegear of the Red Crane 4P                 | `monk/items.go`                                               |
| 123157     | Armor of the Red Crane 2P                      | `monk/items.go`                                               |
| 123159     | Armor of the Red Crane 4P                      | `monk/items.go`                                               |
| 131619     | Gladiator's Regalia 4P                         | `mage/items.go`                                               |
| 138126     | Battleplate of the Last Mogu 4P                | `warrior/items.go`                                            |
| **138144** | Regalia of the Witch Doctor 4P                 | `shaman/items_mop.go` — §51a named this one                   |
| 138156     | Regalia of the Exorcist 2P                     | `priest/items.go`                                             |
| 138158     | Regalia of the Exorcist 4P                     | `priest/items.go`                                             |
| 138159     | Battlegear of the Lightning Emperor 2P         | `paladin/items.go`                                            |
| 138164     | Battlegear of the Lightning Emperor 4P         | `paladin/items.go`                                            |
| 138195     | Plate of the All-Consuming Maw 2P              | `death_knight/items.go`                                       |
| 138197     | Plate of the All-Consuming Maw 4P              | `death_knight/items.go`                                       |
| 138216     | Armor of the Haunted Forest 2P                 | `druid/guardian/items.go`                                     |
| 138231     | Fire-Charm Armor 2P                            | `monk/items.go`                                               |
| 138236     | Fire-Charm Armor 4P                            | `monk/items.go`                                               |
| 138238     | Plate of the Lightning Emperor 2P              | `paladin/items.go`                                            |
| 138244     | Plate of the Lightning Emperor 4P              | `paladin/items.go`                                            |
| 138280     | Plate of the Last Mogu 2P                      | `warrior/items.go`                                            |
| 138281     | Plate of the Last Mogu 4P                      | `warrior/items.go`                                            |
| 138291     | Vestments of the Lightning Emperor 2P          | `paladin/items.go`                                            |
| 138292     | Vestments of the Lightning Emperor 4P          | `paladin/items.go`                                            |
| **138315** | Fire-Charm Battlegear 4P (Monk T15 Windwalker) | `monk/items.go` — §51a named this one                         |
| 138316     | Regalia of the Chromatic Hydra 2P              | `mage/items.go`                                               |
| 138347     | Battleplate of the All-Consuming Maw 4P        | `death_knight/items.go`                                       |
| 138376     | Regalia of the Chromatic Hydra 4P              | `mage/items.go`                                               |
| 144436     | Battleplate of the Prehistoric Marauder 2P     | `warrior/items.go`                                            |
| 144441     | Battleplate of the Prehistoric Marauder 4P     | `warrior/items.go`                                            |
| 144502     | Plate of the Prehistoric Marauder 4P           | `warrior/items.go`                                            |
| 144503     | Plate of the Prehistoric Marauder 2P           | `warrior/items.go`                                            |
| 144566     | Plate of Winged Triumph 4P                     | `paladin/items.go`                                            |
| 144580     | Plate of Winged Triumph 2P                     | `paladin/items.go`                                            |
| 144586     | Battlegear of Winged Triumph 2P                | `paladin/items.go`                                            |
| 144593     | Battlegear of Winged Triumph 4P                | `paladin/items.go`                                            |
| 144613     | Vestments of Winged Triumph 4P                 | `paladin/items.go`                                            |
| 144625     | Vestments of Winged Triumph 2P                 | `paladin/items.go`                                            |
| 144879     | Armor of the Shattered Vale 2P                 | `druid/guardian/items.go`                                     |
| 144887     | Armor of the Shattered Vale 4P                 | `druid/guardian/items.go`                                     |
| 144899     | Battleplate of Cyclopean Dread 2P              | `death_knight/items.go`                                       |
| 144907     | Battleplate of Cyclopean Dread 4P              | `death_knight/items.go`                                       |
| 144934     | Plate of Cyclopean Dread 2P                    | `death_knight/items.go`                                       |
| **144998** | Celestial Harmony Regalia 2P                   | `shaman/items_mop.go` — **the id this whole tier exists for** |
| **145003** | Celestial Harmony Regalia 4P                   | `shaman/items_mop.go` — §51a named this one                   |
| **145004** | Battlegear of Seven Sacred Seals 2P            | `monk/items.go` — §51a named this one                         |
| **145022** | Battlegear of Seven Sacred Seals 4P            | `monk/items.go` — §51a named this one; real aura is 145024    |
| **145049** | Armor of Seven Sacred Seals 2P                 | `monk/items.go` — §51a named this one                         |
| 145174     | Regalia of Ternion Glory 2P                    | `priest/items.go`                                             |
| 145179     | Regalia of Ternion Glory 4P                    | `priest/items.go`                                             |
| 145251     | Chronomancer Regalia 2P                        | `mage/items.go`                                               |
| 145257     | Chronomancer Regalia 4P                        | `mage/items.go`                                               |

Seventy rows. The seven in bold are the seven §51a named.

### 3b. The six handles that are referenced elsewhere — and §51a's "one dangerous shape" confirmed

§51a flags exactly one of these as dangerous. **Measured, that is right, and now it is measured
rather than asserted:** five of the six have a second reference that is a _metrics label_ — an energy,
health or death-rune accounting id, or an RPPM proc-manager argument — not a second aura. Only
`138350` is used twice as a real `ActionID`.

| id         | second reference                                                                                    | is it an aura?           |
| ---------- | --------------------------------------------------------------------------------------------------- | ------------------------ |
| 21975      | `rogue/items_mop.go` — `NewEnergyMetrics`                                                           | no, a resource label     |
| 122028     | `paladin/glyphs.go` — the glyph spell's own `ActionID`                                              | the one glyph in the set |
| 138343     | `death_knight/items.go` — `NewSetBonusRPPMProcManager` argument                                     | no                       |
| 144950     | `death_knight/items.go` — `NewDeathRuneMetrics`                                                     | no, a resource label     |
| 145056     | `monk/brewmaster/purifying_brew.go` — `NewHealthMetrics`                                            | no, a heal label         |
| **138350** | `druid/balance/items.go` — the **visible T15 4pc stat buff's** `ActionID`, and the tracker's handle | **yes, both**            |

So `auraIsKnown(138350)` in an APL cannot distinguish "the set is equipped" from "the buff is up".
None of the six appears in any committed fixture.

### 3c. The five inverted stacking-trinket payloads

The sim's hand-written Go overrides split each of five trinkets into a "visible payload" aura and a
"hidden tracker", and the log inverts the pair every time. `db.json` gets all five right.

| trinket                  | Go payload | db.json tracker | wide-instrument counts (**inherited**) | on my four fixtures |
| ------------------------ | ---------- | --------------- | -------------------------------------- | ------------------- |
| Wushoolay's Final Choice | 138790     | 138786          | 0 against 45                           | 0 / 0               |
| Fabled Feather of Ji-Kun | 138758     | 138759          | 0 against 102                          | 0 / 0               |
| Ticking Ebon Detonator   | 146311     | 146310          | 0 against 683                          | 0 / 0               |
| Black Blood of Y'Shaarj  | 146183     | 146184          | 0 against 1,424                        | 0 / 0               |
| Horridon's Last Gasp     | 138849     | 138856          | 0 against 275                          | 0 / 0               |

**Why they cannot appear, derived rather than inherited:** two of the overrides carry comments saying
they exist for **APL compatibility** rather than for log fidelity — a number written for the rotation
language, which is the 144998 hazard restated. Neither of my four fixture players wore any of the five
trinkets, so my instrument adds nothing to the counts; the _structural_ reason is readable in the Go.

### 3d. Ids both sources name that the game does not write

| id(s)           | what the sources say                                                                          | why it cannot appear                                                                                                                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 118334 · 118335 | Dancing Steel agility / strength — named by **both** `enchants.go` and `db.json` enchant 4444 | absent from all 1,317 distinct friendly ids of the wide instrument (**inherited**) and from all four fixtures, on a pull whose player wears enchant 4444 **on both weapons**. The game writes **120032**. This is the only place where the Go _and_ the client data are both wrong. |
| 114207          | Skull Banner                                                                                  | occurs once in the sim repository, in `ui/core/components/inputs/buffs_debuffs.ts`, as the icon the **buff picker** draws. `sim/core/buffs.go` casts and registers 114206. Zero on all four fixtures.                                                                               |

### 3e. Hidden marker and trigger auras

Declared in the sources as effect scaffolding with no player-visible aura. **The "never written" half
of each of these is inherited from the wide instrument** — my four fixtures can only say "absent from
four pulls", which for the ones on unworn items says nothing at all.

| id     | what it is                                                                                | source                                                                 |
| ------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 139116 | "Item - Attacks Proc Highest Rating" — Rune of Re-Origination's **only** `db.json` effect | `db.json` item 94532; 0 against 818 for 139117/120/121 (**inherited**) |
| 146051 | "Amplification" — Purified Bindings' `itemEffects[1]`                                     | `db.json` item 102293                                                  |
| 146019 | "Readiness" — Assurance of Consequence's marker                                           | `db.json` item 102292                                                  |
| 104561 | Windsong's trigger                                                                        | `enchants.go`; `db.json` enchant 4441                                  |
| 137592 | Tempus Repit's trigger                                                                    | `metagems.go`                                                          |

`139116` is worth the emphasis §51a gave it: a mechanical `db.json` import for Rune of Re-Origination
would have imported **only** the marker and reproduced the 144998 failure exactly. The Rune is
equipped on the Windwalker fixture, 139116 fires zero times there, and 139120 fires eight — so this
one is confirmed on gear the repository owns, and is the one row in 3e that is **not** inherited.

**Guarded by:** the `simOnly` list in `lib/game/__tests__/shared.test.ts` is the only assertion family
in this repository whose list does not come from the declarations — it fails if any of 138790, 138758,
146311, 146183, 138849, 118334, 118335, 139116 or 144998 is ever declared again. The window/counter
`pairs` table in the same file pins each id to the **key** it must resolve to, which is what stopped
two silent mutations (Ji-Kun's row pointed at Wushoolay's window; Renataki's and Ji-Kun's counters
swapped). **Not guarded:** the seventy handles of 3a, 114207's provenance, and 104561 / 137592 /
146051 / 146019.

**The gap worth naming:** nothing in this repository asserts anything about the seventy handles. They
cannot be added to `simOnly` speculatively — that list is about ids a declaration might reach for, and
none of these is currently reachable — but a future set-bonus declaration is exactly where the next
144998 comes from, and there is no guard standing there.

---

## The eleven honest gaps

§51a says _"Eleven, listed in full in the lane's report"_ and names three. Below: those three, five
more that §51a states in its body without filing under that heading, and three I could not recover and
have reconstructed. **The reconstructions are labelled and may not be the original eleven.**

### Recovered verbatim from §51a — and gap 1 is now resolved

**1. `116616` Elemental Force reads 0.** §51a: _"either nobody in three rosters used it or its logged
id differs — unresolved and worth one targeted query."_

**RESOLVED, and no query is needed.** That is a false dichotomy with a third answer.
`sim/common/mop/enchants_auto_gen.go` registers enchant 4443 / spell 116616 through
`shared.NewProcDamageEffect` — `MinDmg: 2775, MaxDmg: 3225`, `SpellFlagPassiveSpell`. **Elemental Force
applies no aura at all; it deals damage.** A Buffs sweep reads zero for it _by construction_, which is
§51a's own trap #2 ("a Buffs sweep cannot see an enemy debuff") one table over. It has to be looked for
in `dataType: DamageDone` with `viewBy: Ability` — and under trap #1, a rare damage id on a player with
five busier abilities is exactly what a default `viewBy` truncates away. Separately: enchant 4443
appears on none of the four fixture weapons, so my instrument adds no evidence either way.

**2. No `Healing` table was fetched.** Heal-proc ids sit in tier 2 partly because the sweep did not
look in the right place. Still true; unchanged by this document. Bears on `cloudburst` (138856),
Horridon's Last Gasp — declared here precisely because it is confirmed logged on the wide instrument
and will never fire for a damage spec.

**3. The five-way payload inversion is a strong empirical result with no explanation.** Still true. The
practical answer is the same either way — trust `db.json` — and 3c above adds the one mechanistic clue
in the sources: two of the overrides say in comments that they exist for APL compatibility.

### Recovered from §51a's body, unresolved

**4. `146141` / `146142` "Claw of Burning Anger".** 70 applications and ~397 m damage on the wide
instrument, and **no entry in `sim/` or `db.json`**. Re-verified today: both ids return zero matches in
the Go tree and zero in `db.json`. A real, busy, damaging effect that neither source knows. Nothing can
be derived about it; it can only be measured. Absent from all four fixtures.

**5. `145441` "Yu'lon's Barrier".** 1,032 applications, no occurrence in `sim/`; re-verified absent
from both sources today. **Partly closed since:** it fires 7 times on `cleave` and is now classified in
`lib/game/__tests__/undeclaredAuras.test.ts`'s `LEDGER` as _"a healer's legendary cloak absorbing for
them"_. So the _identity_ is settled and the _derivation_ still is not — `cloaks_phase_4_54.go` models
the damage cloaks and has no absorb variant.

**6. `138350` is both a visible buff and a set tracker's handle.** Confirmed in 3b, and now with the
useful negative result beside it: it is the **only** one of the six double-referenced handles that is
ambiguous in that way. Unresolved as a hazard — an APL check on it still cannot tell the two apart.

**7. The "~40 hidden marker auras of tier 2.2" were never enumerated.** §51a calls them the sweep's
real residual risk and lists four families. **I could not reproduce the figure, and say so rather than
round it.** A strict name filter over `db.json` — `itemEffects[].buffName` starting `"Item -"` or equal
to `Readiness` / `Amplification` / `Multistrike` / `Cleave` — yields **14** distinct marker-named item
buffs (107786, 109866, 109873, 138957, 139116, 139190, 145955, 146019, 146025, 146051, 146059, 146136,
146176, 148233), and `sim/common/mop` carries **14** `"- Trigger"`-named registrations. That is ~28
under the widest defensible reading. The ~40 either used a looser filter or included the class item
files. **Open.**

**8. Trap #1's damage was never bounded.** §51a records that the first pass reported 137597 and 126734
absent because a default `viewBy` truncates each player's `abilities[]` to the top five, and states
that `viewBy: Ability` is mandatory. What it does not say is whether every absence from the first pass
was re-checked under the corrected query. Any id that is _rare_ and on a busy player is in the blast
radius. **Open, and it is the mechanism behind gap 1.**

### Reconstructed, not recovered — labelled as such

**9. The wide instrument never separated "equipped" from "procced".** It counted applications. An item
worn and never procced is indistinguishable there from an item nobody owned, which means its "60 ids
reach tier 1" is a floor and its tier-2 zeros carry less than they look like they carry. **This is the
gap this document closes for the fixture set** — `combatantinfo` answers it directly, and the
`GEAR_SOURCES` biconditional is the closure. It cannot be closed retroactively for the three raid
nights without re-fetching them.

**10. All three raid nights were 25H Siege of Orgrimmar.** The Throne of Thunder trinket family — the
`94xxx` items, ten of the tier-2 rows above — was a tier out of date for those rosters. A zero there is
much weaker evidence than a zero on a Siege trinket, and §51a's counts do not distinguish them.

**11. Enemy-side coverage was never stated.** §51a fetched 217 enemy debuff ids and its trap #2 exists
because two item effects land on the enemy (146198, 144999). Nothing records whether the other enemy
ids were swept for item effects at all, and the one structural blindness in this repository's guard
family is the same shape: three of the four sweeps that are supposed to make a missing row impossible
walk auras put on the **player**.

---

## The two known gaps from the audit, resolved

### `dancing-steel` is in the right list

`GEAR_PROCS` in `specs/windwalker/lib/index.ts`, and that is where it belongs. The spec keeps two
literals with a deliberate distinction — `GEAR_PROCS` is _"the gear's own auras"_, drawn as procs;
`ITEM_USES` is _"the kit the player pressed"_, drawn as buffs, so that the row's tone does not claim
the player chose a proc or was handed a press. Dancing Steel is a weapon enchant that fires on its own
and is never pressed, so it is a proc. `specs/windwalker/lib/__tests__/drawnAuras.test.ts` asserts
`lane.group === 'proc'`, which is the guard.

**Two things about it that no guard covers.** It is a _shared_ declaration consumed through a
_spec-local_ literal, so a third melee spec would have to re-type the key — the same hand-curated-list
hazard that lost both of a reader's trinkets on the Elemental. And nothing in the report _reads_ it:
`GEAR_PROCS`' own comment says so, which is why it went unnoticed for as long as it did — a proc no
metric consumes is a proc only the chart can show.

### The four never-firing lanes' reason is still true, and now for a better reason

`specs/elemental/lib/index.ts` draws `UNERRING_VISION` (138963), `BREATH_OF_HYDRA` (138898), `CHAYES`
(139133) and `WRATH_OF_DARKSPEAR` (146184), all four filtered out by `windows.length > 0`, with the
written reason _"the trinkets these fixtures' players did not wear"_.

**Still true after `cleave.json` was added** (commit `618169c`, the fixture the audit was right to
worry about). Measured two ways:

- All four remain on the Elemental column of `SILENT_AURAS` — zero events on all three pulls.
- **And now the reason itself is measured, not inferred.** None of Unerring Vision of Lei-Shen,
  Breath of the Hydra, Cha-Ye's Essence of Brilliance or Black Blood of Y'Shaarj appears in any of the
  four gear arrays — at any ilvl variant. `cleave` wears the same two trinkets as the other two pulls,
  104544 (Kardris' Toxic Totem) and 104426 (Purified Bindings of Immerseus). So "did not wear" is a
  gear fact, and `GEAR_SOURCES` is the guard that keeps it one.

The plan's open box — _"Decide what to do about the four never-firing lanes — remove them, or say on
the line why a lane that cannot draw is worth declaring"_ — is still open. This document is the answer
to the second half: they are worth declaring because their absence is now attributable to gear rather
than to a wrong id, and `GEAR_SOURCES` fails by name the moment a fixture arrives wearing one.
