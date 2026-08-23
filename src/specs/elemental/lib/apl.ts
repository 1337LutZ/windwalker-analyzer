import { type AplRule, ladderEntries } from '~/lib/spec/apl';

/**
 * The Elemental priority list, declared for the audit engine.
 *
 * The engine (`lib/spec/apl.ts`) walks whatever ladder it is handed; this file is that list — the
 * rules, the buttons they mean, the constants the conditions are cut from — plus everything about
 * the transcription that a future reader needs to check it.
 *
 * ## The list being transcribed
 *
 * `wowsims-mop/ui/shaman/elemental/apls/p5.apl.json` — the tier-16 list, not `default.apl.json`.
 * The `// N` comments give the index into that file's `priorityList`; conditions that the APL
 * writes as `valueVariables` are named in the comments the way the file names them.
 *
 * ## What this deliberately does not model
 *
 * The list transcribed here is the *filler ladder* — the entries that decide what an on-GCD global
 * is spent on. Everything else is excluded on purpose, each for its own reason:
 *
 * - **Skull Banner** (1, 2), **Stormlash Totem** (3, 4), **Bloodlust** (5), **Berserking** (6),
 *   **Blood Fury** (11), **Jade Serpent Potion** (10): raid cooldowns, racials and consumables.
 *   They cost no global this ladder arbitrates (the first two are off-GCD, and the ladder only ever
 *   sees on-GCD presses), and the banner is a raid-coordination call rather than a personal one.
 * - **Ascendance** (14, 15): an off-GCD cooldown with two explicit rules — the opener (`currentTime
 *   <= 5s` with Flame Shock remaining over 15s) and the tier-16 two-piece window (the Elemental
 *   Discharge debuff 144999 with at least 10s left). It is judged by the cooldowns section, which
 *   has the room a per-press verdict would not.
 * - **Elemental Mastery** (9): an off-GCD talent cooldown, synced with Ascendance; the cooldowns
 *   section's business.
 * - **Fire Elemental** (19, prepull), **Earth Elemental** (21): pets. Fire Elemental is the
 *   cooldowns section's business; Earth Elemental's own rule opens in end-of-fight terms
 *   (`remainingTime <= 62s`), so a drift verdict would call the sim's own plan a fault. Its other two
 *   branches are graded per press by its own section, which has the room to say that one of them ends
 *   at another player's cooldown and cannot be read.
 * - **Flame Shock's snapshot refreshes** (7, 12): the two Flame Shock rules above the filler — the
 *   proc-window reapplies (`Flame Shock Rules`) and the refresh just before Ascendance (`Flame
 *   Shock Refresh Prior to Ascendance`). They are judged by the Flame Shock section, which reads
 *   the proc windows and the dot's own measured tick window against them; the ladder carries
 *   only the keep-it-up half of the story (see the `flame-shock` rung below).
 * - **Flame Shock's tick-window refresh** (16): `multidot(8050, maxDots: 1, maxOverlap:
 *   dotTickFrequency(8050))` under `dotRemainingTime(8050) < dotTickFrequency(8050)`. Read off the
 *   file, because this module used to call it "the multi-target Flame Shock rule" and it is not one:
 *   **`maxDots` is 1**, so the action never leaves the unit it is aimed at. It is a refresh window
 *   measured in ticks rather than seconds, and the `flame-shock` rung below carries it as
 *   `FS_KEEP_UP_MS`. The list with a genuine second dot is `cleave.apl.json`, not this one — see the
 *   next section.
 *
 * ## The other two lists, and where they disagree with this one
 *
 * The sim ships three Elemental presets, and this ladder is one ordered list with `bands` per rung —
 * so it can express *which* rungs a target count has and cannot express a different *order* per count.
 * Where the two shapes collide the preset is the authority and the departure is written down here
 * rather than left for the next reader to rediscover:
 *
 * - **`cleave.apl.json`** (two targets), eighteen rungs. Its fillers run Lava Burst-on-Lava-Surge →
 *   **Searing Totem** → Flame Shock → Lava Burst → Elemental Blast → Earth Shock → Chain Lightning →
 *   Lightning Bolt. So Searing Totem sits *above* Flame Shock, Lava Burst, Elemental Blast and Earth
 *   Shock there and *below* all four in p5 (index 20). **Not modelled, and it cannot be**: one list
 *   has one order. The cost is bounded and measured, and banding the rung to `[1, 2]` shrank it rather
 *   than fixed it: on `cleave`'s natural walk `searing-totem` took **5** skips when the rung stood in
 *   every band and takes **1** now (the earlier "4" here was its forced-band-1 figure, not its natural
 *   one). Band 2 is the only band the ordering conflict can occur in. Its Unleash Elements rung is also a
 *   different rule, `Unleashed Fury known AND Lava Surge active` rather than p5's
 *   `not(Ascendance active)` — **modelled now**, on the rung's own `state.band` branch, because that was a
 *   dropped term and not an inexpressible one — and it carries **no Lava Beam at all**.
 * - **`aoe.apl.json`** (three or more), and it is five rungs long: `autocastOtherCooldowns`, Flame
 *   Shock, the potion, Lava Beam, Chain Lightning. **No Earth Shock, no Lava Burst, no Elemental
 *   Blast, no Searing Totem, no Unleash Elements** — and no Lightning Bolt either. All five of the named
 *   rungs are now banded `[1, 2]`, one reason each written beside the rung, and this is plan §64's item 3.
 *
 *   **The list's own first rung does not quietly supply them.** `autocastOtherCooldowns` casts the
 *   character's registered *major cooldowns* and nothing else (`sim/core/apl_actions_casting.go:500`,
 *   `getFirstReadyMCD`), and the shaman registers exactly eight: Bloodlust, Fire Elemental Totem,
 *   Ascendance, Earth Elemental Totem, Shamanistic Rage, Elemental Mastery, Ancestral Swiftness and
 *   Stormlash Totem (`AddMajorCooldown` in `sim/shaman/`). None of the five is one of them, so the aoe
 *   list's omission is total rather than delegated — which is the fact that makes banding them out a
 *   transcription rather than a reading.
 *
 *   **Why banding out is right here and was not right for Lava Beam.** A rung outside its band is
 *   *absent* from the list at that press, so the press falls through to whatever the list does want —
 *   and from three targets up that is always a real rung. Lava Beam's condition is `Ascendance active`
 *   and Chain Lightning's is `not active`, so exactly one of the two claims every global at bands 3
 *   and 4. An Earth Shock at five targets is therefore faulted **against Chain Lightning**: the sim's
 *   own answer, and a sentence a reader can act on. That is a different thing from the unattributable
 *   fault a button with no rung at *any* band produces. Lava Beam *is* banded `[3, 4]`, and this
 *   paragraph used to read as though that would create such a fault at two targets; it does not, because
 *   the two-target beam is faulted against Lava Burst — see the rung. The bottom rung stays unbanded for
 *   the mirror-image reason: `aoe.apl.json` has no Lightning Bolt, but the walk can never reach it there,
 *   so banding it would declare a gate that changes nothing.
 *
 *   **One residual, and its direction is named rather than left to be discovered.** A rung's band is
 *   stamped at the press instant, and Searing Totem is a sixty-second commitment — 39 ticks of 1.52s
 *   (`sim/shaman/fire_totems.go:40-41`, `:66`). On a pull that swings counts, a totem dropped during a
 *   brief three-target spike is now faulted although most of its ticks land in single-target time. That
 *   is the same class of question §41 flagged for `SEF_SECOND_TARGET_MS` — a duration no band can
 *   express — and it is the one place this change could over-fault rather than under-fault. Measured, it
 *   bites nothing today: all seven Searing Totem presses in the three committed fixtures are at bands 1
 *   and 2, and not one of them changed either its verdict or the rung it was charged against. It is the
 *   rung's *demand* that moved, not its own presses' verdicts.
 *
 *   **And the sim's AoE fire totem is not this one, which is why the omission is not a preset slip.**
 *   Searing Totem's dot is applied to `sim.Encounter.ActiveTargetUnits[0]`, one unit
 *   (`sim/shaman/fire_totems.go:62-63`), while **Magma Totem (8190)** carries `SpellFlagAoE`, `IsAOE:
 *   true` and `CalcPeriodicAoeDamage` (`:76`, `:91`, `:101`). The two share the fire totem slot and
 *   deactivate each other, and `aoe.apl.json` presses **neither** — after the prepull Fire Elemental
 *   that slot has no rung anywhere in that list. So banding 3599 out of bands 3 and 4 says only what the
 *   sim says, that the single-target totem is not the AoE list's totem. It also leaves a real gap
 *   standing: **8190 is on no rung and in no `ROTATION` row**, so a player who drops Magma Totem at five
 *   targets is graded against Chain Lightning. Closing that needs the ability registry, not this file.
 * - **Flame Shock is a different rule in each of the three**, and the `flame-shock` rung below is
 *   banded accordingly. See `FS_CLEAVE_OVERLAP_MS`.
 * - **Lava Beam is banded `[3, 4]`, and `cleave.apl.json` having no Lava Beam rung is only half of why.**
 *   Band 2 used to be here as this report's own reading against a game mechanic the sim does not model:
 *   Ascendance *replaces* Chain Lightning on the bars (`elemental/lava_beam.go` gates the spell on
 *   `AscendanceAura.IsActive()`, and nothing gates Chain Lightning off), so the sim's cleave preset can
 *   keep pressing 421 through the window while a real player at two targets cannot, and banding the beam
 *   to `[3, 4]` looked like it would leave a two-target Ascendance beam with no rung. It did not, because
 *   the rung it was given **could not be reached**: inside Ascendance `lava-burst` is never on cooldown,
 *   and `flame-shock` at band 2 and `lava-burst` split the dot clock at the same 2000ms, so one of the two
 *   claims every band-2 global before the walk gets this far. A declared rung no press can reach is the
 *   same defect as no rung — this file's own words — so band 2 came off. The full proof, and why Lava
 *   Burst is the *right* thing to fault a two-target beam against, is on the rung.
 *
 * ## What the ladder reads instead of bars
 *
 * The Windwalker ladder is written in units of energy and chi; this one reads no bar at all — its
 * currency is the Flame Shock dot, Lightning Shield's stack counter, and the buttons' own clocks.
 * The audit passes `barsRequired: false`, so the engine's `null` gate (no resources, no walk)
 * does not apply. The three resources the rules do read are:
 *
 * - the Flame Shock dot's remaining time on the primary target (`dotRemainingTime` in the APL),
 * - Lightning Shield's stack count (`auraNumStacks(324)` — the Earth Shock rule's test),
 * - cooldown clocks for buttons that are not rungs — Ascendance's, which the Earth Shock and
 *   Flame Shock rules read (`spellTimeToReady(114049)`).
 *
 * ## Where the numbers come from
 *
 * Cooldowns and durations are read from the Go sim rather than from memory:
 * `sim/shaman/unleash_elements.go` (15s), `sim/shaman/elemental/lavaburst.go` (8s; Lava Surge and
 * Ascendance reset it), `sim/shaman/elemental_blast.go` (12s), `sim/shaman/ascendance.go` (180s).
 * Lava Burst's cast time is 2s (`elemental/lavaburst.go`), which is the number its condition is
 * written in.
 */

/** The rules this ladder models, in priority order. */
export type ELE_AplRuleKey =
	| 'unleash-elements'
	| 'flame-shock'
	| 'lava-burst'
	| 'elemental-blast'
	| 'earth-shock'
	| 'searing-totem'
	| 'lava-beam'
	| 'chain-lightning'
	| 'lightning-bolt';

/** Cast ids, as the log records them and the cast table keys on them. */
const ID = {
	unleashElements: 73680,
	flameShock: 8050,
	lavaBurst: 51505,
	elementalBlast: 117014,
	earthShock: 8042,
	searingTotem: 3599,
	lightningBolt: 403,
	chainLightning: 421,
	lavaBeam: 114074,
	ascendance: 114049,
	// Not rungs and never will be — the three on-GCD buttons `UNARBITRATED` below declares off this
	// ladder. Here rather than as literals down there for the reason this map exists: one place in this
	// module knows a cast id.
	stormlashTotem: 120668,
	fireElemental: 2894,
	earthElemental: 2062,
} as const;

/**
 * The window in which Flame Shock is pressed to keep the dot from dropping.
 *
 * Not a number the sim names — the p5 list's own Flame Shock rules are the snapshot reapplies
 * (priority 7, `Flame Shock Rules`) and the Ascendance prep (priority 12), both of which this
 * ladder leaves to the Flame Shock section. The keep-it-up reading is this report's, on the same
 * grounds the section argues for its refresh window: Flame Shock is a snapshot dot and an Elemental
 * player never lets it drop, whichever build the p5 list was tuned for.
 */
const FS_KEEP_UP_MS = 3000;

/** Lava Burst's cast time, in the units the sim writes it — 2s (`elemental/lavaburst.go`). */
const LAVA_BURST_CAST_MS = 2000;

/** The `Flame Shock Refresh Prior to Ascendance` rule's own threshold: `dotRemainingTime < 16s`. */
const FS_ASC_PREP_MS = 16000;

/**
 * What the Flame Shock rung becomes above one target, and it is **two** changes rather than a relaxed
 * threshold.
 *
 * At two targets the whole of `cleave.apl.json`'s Flame Shock is rung 9,
 * `multidot(8050, maxDots: 2, maxOverlap: 2s)`, and at three or more the whole of `aoe.apl.json`'s is
 * rung 1, `auraIsKnown(138898) AND not(dotIsActive(8050))`. Neither list carries p5's snapshot
 * reapplies (7) or its Ascendance prep (12), so **the Ascendance-prep clause is a band-1 rule** and
 * applying it above one target was this ladder asking for a press the sim's own list never asks for.
 * Measured on `cleave`: 67 presses were graded as skips against Flame Shock before this and 59 after,
 * with `phased` and `unbroken` — and every `aplForced[1]` walk — unmoved.
 *
 * **Two halves of those two rules are unreadable, and they fail in opposite directions.** Written down
 * because the next reader will want to know which way the remaining error points:
 *
 * - `maxDots: 2` puts the dot on a *second* enemy, and the ladder has no reader for "how many engaged
 *   enemies carry Flame Shock" — `auraRemainingAt` answers for the one enemy the press was aimed at
 *   (that is the whole reason it exists) and `auras['flame-shock']` is the union, which cannot count.
 *   So band 2 **under-**demands Flame Shock: a press the sim would have made for a bare second target
 *   reads as a skip. Closing it needs a per-press dot count on `AplInputs`, which is
 *   `lib/spec/apl.ts` plus the wiring in `elemental/lib/index.ts`.
 * - `auraIsKnown(138898)` is Breath of the Hydra, and the band-3 branch **reads the kit for it** — this
 *   is the half that is no longer a departure. It used to resolve to *owned* on every pull, which was a
 *   constant standing in for a question no input could ask, and the leniency was defended on the ground
 *   that the alternative was worse: a player without the trinket is never asked for Flame Shock at three
 *   targets, so every Flame Shock they press there has no rung and is a fault whatever they did. That
 *   cost is real and is now paid rather than avoided — the same disposal Earth Shock takes above three
 *   targets, and for the same reason: a press the sim's own list refuses is a choice the player made, and
 *   faulting it against Chain Lightning is more honest than excusing every pull to spare the pulls that
 *   deserve the excuse. The gear read is `AplInputs.equippedItems`, filled from the `combatantinfo`
 *   `gear.ts` already parses, and `null` there is `'unknown'` rather than "not owned".
 *
 *   **It is `auraIsKnown` that was doing two jobs, and only one of them is this.** The two ids the
 *   Elemental presets test through that verb are 117012 and 138898: the Unleashed Fury *talent* on rung 0
 *   of p5 and of `cleave.apl.json`, and this *trinket*. One verb, two different questions, answered by
 *   two different fields of the same `combatantinfo` — the talent list and the gear array — which is why
 *   the input added for this is item ids and not a set of "known auras" that would have to hold both.
 *
 *   **And the talent half is now read off the talent list too**, which is the second and last of the two
 *   jobs. It used to be `AplRule.talent` alone — the rung gated on the log showing the button *pressed* —
 *   and that was a proxy in the same species as the trinket constant, failing in the obvious direction: a
 *   shaman who took Unleashed Fury and never got round to the button read as a shaman who took something
 *   else, and every rung below was then walked against a list they did not have. `readTalents` reads the
 *   same `combatantinfo` and `index.ts` already asks it for Primal Elementalist, so the real answer was
 *   one field away. It arrives as `AplInputs.knownTalents` with the rungs naming their row through
 *   `talentId` — a second input and not an entry in the gear set, because a set holding a talent row and
 *   an item id together would be the sim's conflation copied rather than closed. See
 *   `UNLEASHED_FURY_TALENT_ID`.
 *
 *   **The two halves dispose of a missing `combatantinfo` differently, and that is deliberate.** The kit
 *   reads `'unknown'` there; the tree falls back to the press. A trinket that never procs leaves no trace
 *   in an event stream, so a gear-less log genuinely cannot say — but a talent's own button is in the cast
 *   list, which is the evidence the proxy always ran on. The strict arm was implemented and measured
 *   before it was dropped: with `combatantinfo` stripped from the four committed pulls it silenced
 *   88% of `unbroken`'s globals, because this ladder's top rung is a talent-gated cooldown that an
 *   un-pressed pull reads as permanently ready. Full numbers at `AplInputs.knownTalents`.
 *
 * The 2s is the preset's own `maxOverlap`, not a tuned number, and the band-3 branch is written as
 * `remaining <= 0` because that is what `not(dotIsActive)` means on a clock.
 */
const FS_CLEAVE_OVERLAP_MS = 2000;

/**
 * Breath of the Hydra, by **item** id — the base and its four upgrade steps.
 *
 * `aoe.apl.json` rung 1 opens `auraIsKnown(138898)`, and 138898 is the trinket's proc buff. The rung is
 * not asking whether it fired: `auraIsKnown` is answered off the auras *registered* on the unit, and a
 * trinket registers its proc when it is equipped, so the question the log has to answer is "was this
 * trinket in the kit". `combatantinfo`'s gear array answers that on its own, with no proc required —
 * which is why this list is item ids and why nothing here reads the 138898 windows. A pull where the
 * trinket was worn and never fired still owns it, and reading the proc would call that pull unequipped.
 *
 * **All five, because a fixture wears an upgraded id rather than the base one**: `addsThenBoss.json`'s
 * shaman carries **96455**, the heroic Throne of Thunder id, three upgrade steps above 94521. Sourced
 * the way `game/__tests__/sharedFixtures.test.ts` sources its own gear table — the simulator's
 * `assets/database/db.json`, `items[].itemEffects[].buffId === 138898` — and that test carries the same
 * five under `breath-of-hydra`. **The two copies cannot see each other**, which is a real seam and is
 * recorded rather than hidden: there is no non-test home in this repo for "which items grant which
 * effect", `lib/game/shared.ts` keeping aura ids only. `lib/spec/__tests__/aoeFlameShockGear.test.ts`
 * pins this copy against the committed kits instead, in both directions.
 */
const BREATH_OF_HYDRA_ITEM_IDS: readonly number[] = [94_521, 95_711, 96_083, 96_455, 96_827];

/**
 * The two level-90 rows this ladder gates a rung on, as **talent** ids — the other half of that split.
 *
 * `p5.apl.json` rung 0 and `cleave.apl.json` rung 1 both open `auraIsKnown(117012)`, and rung 17 is
 * `Elemental Blast Talented`. Neither is asking whether an aura went up in the pull: they ask what the
 * player brought, which `combatantinfo`'s talent list answers outright. That list is a different field
 * of the same event `BREATH_OF_HYDRA_ITEM_IDS` above reads the gear array of, which is why these are a
 * second input (`AplInputs.knownTalents`) rather than entries in a shared "known auras" set — one set
 * holding a talent row and an item id would be the sim's own conflation, copied into this seam.
 *
 * **Written out rather than taken off the rung's cast id, because the two only sometimes agree.** The
 * level-90 tier is Unleashed Fury (117012), Primal Elementalist (117013) and Elemental Blast (117014),
 * and the tier's ids are what `combatantinfo` carries — all four committed pulls name **117013**, which
 * `index.ts`' `PRIMAL_ELEMENTALIST_TALENT_ID` already reads the same field for. Elemental Blast casts
 * under its own row number; Unleash Elements does not. It is a baseline 73680 button whose *damage* the
 * Unleashed Fury row is taken for, so a gate read off `id` would ask whether the player had a spell
 * every shaman has, and would answer `true` for a shaman who took Primal Elementalist.
 *
 * What this replaces on both rungs is `talent: true` alone, which gated them on the log showing the
 * button pressed. That is sound only one way round — a press proves the talent, silence proves nothing —
 * so a shaman who took Unleashed Fury and never got round to the button was walked down a list missing
 * its top rung. A log carrying the talent list now answers both directions outright; a log carrying none
 * is left on the press exactly as it was. See `AplInputs.knownTalents`.
 */
const UNLEASHED_FURY_TALENT_ID = 117_012;
const ELEMENTAL_BLAST_TALENT_ID = 117_014;

/** Ascendance coming back within this — the `spellTimeToReady(114049) >= 6s` of the Earth Shock rule. */
const ES_ASC_HOLD_SEC = 6;

/**
 * What Earth Shock's rung becomes at **two** targets, taken from `cleave.apl.json` rung 13.
 *
 * That rung is the whole rule there and it is a *different* rule, not a relaxed one:
 *
 * ```
 * auraNumStacks(324) >= 6  AND  dotRemainingTime(8050) >= 8s  AND  dotRemainingTime(8050) >= 8s
 * ```
 *
 * Six stacks rather than seven, an **eight**-second dot floor rather than six — the multi-target floor
 * is higher — and neither the Ascendance hold nor the two-piece clause appears at all. The single-target
 * list's `spellTimeToReady(114049) >= 6s` and `not(auraIsActive(144998))` have no counterpart here, so
 * the rung asks two questions at band 2 and four at band 1.
 *
 * **`dotRemainingTime >= 8s` is stated twice in the preset**, verbatim, and that is a redundant term in
 * the source rather than a slip in this transcription — read off the file. It is written once here
 * because `x >= 8 AND x >= 8` is `x >= 8`. Nobody should "fix" this into two different numbers on the
 * assumption that the second one was meant to be something else.
 *
 * **And above two targets there is no rung at all**, which used to be a documented departure and is now
 * the declaration: `aoe.apl.json` has no Earth Shock, so the rung is `bands: [1, 2]`. This is the row
 * §64's own per-metric table already called exempt at bands 3–4 ("no rung exists, so there is nothing to
 * be good against"), and the reason survives contact with a real player's bars: Earth Shock is a
 * single-target shock spending a stack counter that nothing in the aoe list spends, it is on the bar at
 * every count, and no window swaps it out. So a shock at five targets is a choice the player made and
 * the sim's list refuses — and it is now faulted against Chain Lightning rather than left unattributable.
 */
const ES_CLEAVE_STACKS = 6;
const ES_CLEAVE_FS_MIN_MS = 8000;

type ELE_AplRule = AplRule & { key: ELE_AplRuleKey };

/**
 * The ladder, in the sim's evaluation order, with the conditions taken off the p5 list.
 *
 * The exclusions above are the reason the ordering looks sparse: entries 1–6, 8–12, 14–16, 19 and
 * 21 fall between these, and every one of them is documented in the module doc.
 */
export const LADDER: readonly ELE_AplRule[] = [
	{
		// 0 — `Unleashed Fury Talented and not(auraIsActive(114049))`. A talent-gated 15s cooldown
		// pressed whenever it is back, with Ascendance the one thing that waits. On the GCD, so it is
		// a filler-slot press and a ladder rung rather than a cooldown-section ability.
		//
		// **`bands: [1, 2]`, and the reason is in the buff's own spell mask rather than in a judgement
		// about AoE.** `aoe.apl.json` has no Unleash Elements rung. Unleash Flame's damage mod covers
		// `SpellMaskLavaBurst | SpellMaskFlameShock | SpellMaskFireNova | SpellMaskElementalBlast` at
		// +30% (`sim/shaman/unleash_elements.go:11`, `:32-36`), and the Unleashed Fury talent it is
		// pressed for multiplies Lightning Bolt by 1.3, Lava Burst by 1.1 and **everything else by 1.0**
		// (`sim/shaman/talents.go:201-208`). Chain Lightning and Lava Beam are in neither mask, and from
		// three targets up they are the only buttons the aoe list presses. So the press costs a global
		// and buffs nothing that global's list will cast.
		//
		// **And band 2 is a different rule, not p5's.** `cleave.apl.json` rung 1 is
		// `auraIsKnown(117012) AND auraIsActive(77762, includeReactionTime)` — the Unleashed Fury talent
		// *and Lava Surge up* — where p5 rung 0 is the talent and `not(auraIsActive(114049))`. This module
		// used to name that departure in the `cleave.apl.json` bullet above and leave it unmodelled, which
		// was a dropped term rather than an inexpressible one: two rungs below already switch lists on
		// `state.band`, and `lava-surge` is in the ladder's own aura set (the rung below reads it for
		// `readyWhen`). Left as p5's rule the rung **over**-demanded the button at two targets — it wanted
		// Unleash Elements at every global the walk could reach it on, Ascendance aside, where the preset
		// wants it only inside a Lava Surge window.
		//
		// The talent gate is the same `auraIsKnown(117012)` in both lists, so it does not move — and it is
		// now read off the talent list rather than off a press: see `UNLEASHED_FURY_TALENT_ID`. That
		// changes nothing on the four committed pulls, which all name 117013 and none of which carries a
		// 73680 press, so the rung is closed before and after; the separation is shown against a synthetic
		// pull in `multiTargetRungs.test.ts` rather than pinned off a fixture.
		key: 'unleash-elements',
		id: ID.unleashElements,
		chiCost: 0,
		energyCost: 0,
		talent: true,
		talentId: UNLEASHED_FURY_TALENT_ID,
		cooldownMs: 15000,
		bands: [1, 2],
		// `cleave.apl.json` rung 1 at two targets, `p5.apl.json` rung 0 at one. Read off `state.band`, this
		// rule's own per-press count, so the rung switches lists at the press rather than for the pull —
		// the same shape the `flame-shock` and `earth-shock` rungs below use.
		condition: (state, auras) => (state.band === 2 ? auras.active('lava-surge') : !auras.active('ascendance')),
	},
	{
		// 7 and 12 are the snapshot half of Flame Shock and belong to the Flame Shock section; the
		// keep-it-up half is the rung below — the dot is the list's currency and is never allowed to
		// drop. The Ascendance prep (12, first branch: no Elemental Mastery, `spellTimeToReady(114049)
		// < 2s`, `dotRemainingTime < 16s`) is transcribed because it is pure clock reading; the second
		// branch's Elemental Mastery condition is a talent check and stays with the section.
		//
		// **And all of that is the band-1 rule.** Neither of the other two presets carries either Flame
		// Shock rule above, and both replace it with one of their own — see `FS_CLEAVE_OVERLAP_MS`. The
		// condition reads `state.band`, this rule's own per-press count, so the rung switches lists at
		// the press rather than for the pull.
		key: 'flame-shock',
		id: ID.flameShock,
		chiCost: 0,
		energyCost: 0,
		condition: (state, auras, cooldowns) => {
			const remaining = auras.remainingMs('flame-shock');
			// `aoe.apl.json` rung 1, both halves: `auraIsKnown(138898) AND not(dotIsActive(8050))`. Cast it
			// when the dot is not up and never to refresh one that is — and only for a shaman who owns
			// Breath of the Hydra, which is what the `auraIsKnown` half asks. Read off the kit rather than
			// off the proc: see `BREATH_OF_HYDRA_ITEM_IDS`.
			//
			// **The dot is asked first, and the order is load-bearing** even though `AND` does not care.
			// The trinket half is the one that can be unreadable, and a rung another term has already
			// refused is not a rung the walk should stop at: answering `'unknown'` there would silence every
			// press below Flame Shock on a gear-less log at bands 3 and 4, including every press whose own
			// rung was perfectly readable. So the unreadable term is only reached when it is the term that
			// decides.
			if (state.band >= 3) {
				if (remaining > 0) return false;
				const kit = state.equippedItems;
				// No `combatantinfo`, so the pull cannot say what was worn — which is not "did not own it".
				// `'unknown'` is what the walk does with a rung it cannot read, and either alternative is a
				// claim: reading silence as unequipped faults a press the list may well have wanted, and
				// reading it as owned is the constant this whole rung was written to stop making.
				if (kit === null) return 'unknown';
				return BREATH_OF_HYDRA_ITEM_IDS.some((id) => kit.has(id));
			}
			// `cleave.apl.json` rung 9: the multidot's `maxOverlap`, and nothing else.
			if (state.band === 2) return remaining <= FS_CLEAVE_OVERLAP_MS;
			return remaining <= FS_KEEP_UP_MS || (cooldowns.readyInSec(ID.ascendance) <= 2 && remaining < FS_ASC_PREP_MS);
		},
	},
	{
		// 13 — `dotRemainingTime(8050) > spellCastTime(51505)`: Lava Burst only while the dot it is
		// gated on still outlives its cast. Its 8s cooldown is not a bare clock: Lava Surge (77762)
		// and Ascendance each reset it, and the ladder reads those resets off the auras rather than
		// calling the player's press a skip.
		//
		// **`bands: [1, 2]`: `aoe.apl.json` carries no Lava Burst rung at all** — not a relaxed one,
		// none. `cleave.apl.json` is the opposite and that is what makes the omission a judgement rather
		// than a thin preset: it carries *two* Lava Burst rungs and puts the Lava-Surge one (rung 7)
		// above Searing Totem, Flame Shock, Elemental Blast and Earth Shock, so the sim's own view of
		// this button steps *up* at two targets and to zero at three. The spell is single-target — one
		// `spell.CalcDamage(sim, target, …)` on the action's own unit, plus an overload on the same unit
		// (`sim/shaman/elemental/lavaburst.go:69-85`) — it is on the bar at every count, and no window
		// swaps it away, so nothing here is a bar the sim cannot see. Measured: 5 of `cleave`'s 43 Lava
		// Bursts move from `followed` to `skipped`, every one against Chain Lightning.
		key: 'lava-burst',
		id: ID.lavaBurst,
		chiCost: 0,
		energyCost: 0,
		cooldownMs: 8000,
		bands: [1, 2],
		readyWhen: (auras) => auras.active('lava-surge') || auras.active('ascendance'),
		condition: (_state, auras) => auras.remainingMs('flame-shock') > LAVA_BURST_CAST_MS,
	},
	{
		// 17 — `Elemental Blast Talented`, and nothing else: a talent-gated 12s cooldown pressed
		// whenever it is back.
		//
		// **`bands: [1, 2]`: not in `aoe.apl.json`, and rung 0 of that list does not supply it either.**
		// `autocastOtherCooldowns` casts registered major cooldowns only, and Elemental Blast is not one
		// (see the module doc's list of the eight that are). It is a single-target nuke with an
		// eight-second stat buff (`sim/shaman/elemental_blast.go:22-26`, `:42`), on the bar at every
		// count.
		//
		// **This gate moves no committed figure, and that is said rather than implied.** The rung is only
		// demanded of a player whose talent list names row 117014, and all four committed pulls name
		// 117013 instead — so the rung charges 0 skips at all four bands, both before this was read off
		// the log and after. The gate is shown to separate against a synthetic pull instead; see
		// `multiTargetRungs.test.ts`.
		//
		// **`talentId` is the cast id here and is still written out.** Elemental Blast is one of the two
		// level-90 rows that casts under its own talent number, and Unleash Elements above is the other
		// case: 73680 on the bar, row 117012 in the list. Defaulting either to `id` would make the
		// coincidence look like the rule.
		key: 'elemental-blast',
		id: ID.elementalBlast,
		chiCost: 0,
		energyCost: 0,
		talent: true,
		talentId: ELEMENTAL_BLAST_TALENT_ID,
		cooldownMs: 12000,
		bands: [1, 2],
		condition: () => true,
	},
	{
		// 18 — `Earth Shock Rules`, first branch (the tier-16 two-piece branch is excluded and
		// documented at the top): `dotRemainingTime(8050) >= 6s`, `auraNumStacks(324) >= 7`,
		// `spellTimeToReady(114049) >= 6s`, `not(auraIsActive(144998))`.
		//
		// The Ascendance hold is why Earth Shock waits: the shock timer is shared with Flame Shock
		// (`shocks.go`), so an Earth Shock in the six seconds before Ascendance's prep refresh would
		// leave the timer busy when the list wants the refresh to land. The 144998 clause excludes the
		// two-piece play entirely — under the proc the list spends Earth Shock on the debuff's tail
		// instead, and this ladder grades neither branch of that trade.
		//
		// The stack reading defaults to the ceiling when the log never carried the aura: the sim
		// opens the fight with the shield at seven stacks (`sim/shaman/lightning_shield.go`), so a
		// silent log is read at the sim's own opening state rather than as an unreadable bar.
		//
		// **And at two targets none of the above applies** — `cleave.apl.json` rung 13 is a different
		// rule with two terms, transcribed in the condition below. **Above two there is no rule at all**,
		// hence `bands: [1, 2]`. See `ES_CLEAVE_STACKS` for both halves.
		key: 'earth-shock',
		id: ID.earthShock,
		chiCost: 0,
		energyCost: 0,
		bands: [1, 2],
		condition: (state, auras, cooldowns) => {
			const stacks = auras.stacks('lightning-shield');
			// Two targets is `cleave.apl.json` rung 13 and nothing else — see `ES_CLEAVE_STACKS`. Read off
			// `state.band`, which is this rule's own per-press count, so the rung switches lists at the
			// press rather than for the pull.
			if (state.band === 2) {
				if (stacks !== null && stacks < ES_CLEAVE_STACKS) return false;
				return auras.remainingMs('flame-shock') >= ES_CLEAVE_FS_MIN_MS;
			}
			if (stacks !== null && stacks < 7) return false;
			if (auras.remainingMs('flame-shock') < 6000) return false;
			if (cooldowns.readyInSec(ID.ascendance) < ES_ASC_HOLD_SEC) return false;
			if (auras.active('t16-2pc-debuff')) return false;
			return true;
		},
	},
	{
		// 20 — `Fire Elemental is not active`: Searing Totem only while no Fire Elemental is up and
		// no totem is already ticking. Both halves are read off windows the audit builds from casts,
		// because neither is an aura a log is guaranteed to carry.
		//
		// **`bands: [1, 2]`, and this is the one of the five whose absence from `aoe.apl.json` needed the
		// sim read rather than the list read.** Searing Totem is the *single-target* fire totem — its dot
		// goes on `sim.Encounter.ActiveTargetUnits[0]`, one unit — and **Magma Totem (8190)** is the AoE
		// one, `SpellFlagAoE` and `CalcPeriodicAoeDamage`. The aoe list presses neither, so the omission
		// is not "no fire totem belongs here"; it is "this is not the totem". Banding it out therefore
		// states only what the sim states, and leaves 8190's missing rung as the named gap it is. Full
		// citations, plus the sixty-second-commitment residual this trades for, in the module doc.
		//
		// **Its `cleave.apl.json` ordering conflict is untouched by this** and could not be touched by it:
		// that list puts Searing Totem *above* Flame Shock, Lava Burst, Elemental Blast and Earth Shock
		// while p5 puts it below all four, and one ordered list cannot hold both orders. The band gate
		// narrows *where* the departure applies, not the departure — on `cleave`'s natural walk it costs 1
		// skip now, at band 2, rather than the 5 it cost while the rung stood in every band.
		key: 'searing-totem',
		id: ID.searingTotem,
		chiCost: 0,
		energyCost: 0,
		bands: [1, 2],
		condition: (_state, auras) => !auras.active('fire-elemental') && !auras.active('searing-totem'),
	},
	// The two multi-target fillers, and **they do not come from the p5 list** — that list is
	// single-target and contains neither. `ui/shaman/elemental/apls/cleave.apl.json` ends
	// `… → Chain Lightning (421) → Lightning Bolt (403)`, and `aoe.apl.json` ends
	// `… → Lava Beam (114074) → Chain Lightning (421)`. So the order below is both files' order, and
	// the band gates are what the two files *are*: rungs the single-target list omits are rungs that
	// exist from two targets up.
	//
	// Without them the ladder priced every one of these presses as a fault it could not name. Measured
	// on `cleave` before this: 70 Chain Lightning and 11 Lava Beam presses, all `skipped`, **81 of the
	// pull's 126 skips.** A button with no rung can never be graded as correct, so the section was
	// reporting 64% of its faults on the only add fight in the fixtures against buttons it did not know
	// existed. The registry side of this was fixed in step 40 (`618169c`); the rotation side was not.
	{
		// Chain Lightning's replacement while Ascendance is up, not a priority above it:
		// `sim/shaman/elemental/lava_beam.go` gates the spell itself on `ele.AscendanceAura.IsActive()`,
		// so outside that window it is not on the bars at all.
		//
		// **`replacedBy` is the wrong tool for this**, which is worth saying because it looks like the
		// right one. That field asks `seen.has(id)` — whether the player ever pressed the replacement —
		// which models a talent or a glyph swapping a button permanently. Ascendance swaps this one for
		// fifteen seconds at a time — the aura's own duration in `sim/shaman/ascendance.go`, not the forty
		// this comment used to claim — so the relation is per-press and belongs in the conditions: this rung
		// wants the window, and Chain Lightning's rung below refuses it.
		//
		// Measured on `cleave`: 11 presses, **11 of them inside an Ascendance window**, every one at
		// band 4.
		//
		// **`bands: [3, 4]`, and band 2 came off because no press could ever reach it.** The rung used to
		// be `[2, 3, 4]`, and this module argued band 2 as its own reading rather than a transcription:
		// Ascendance *replaces* Chain Lightning on the bars, so a two-target beam would otherwise be a
		// button with no rung, and "a button with no rung can never be graded as correct" is the defect
		// these two rungs exist to remove. The reading was right about the bars and wrong about the walk.
		// The rung was unreachable at band 2, provably and not merely unobserved, and by this file's own
		// standard that is the same defect wearing a band:
		//
		//  - this rung's condition at band 2 requires `ascendance` active;
		//  - inside that window `lava-burst`'s `readyWhen` is true, so its 8s cooldown never gates it —
		//    the sim agrees, `sim/shaman/ascendance.go:91-95` attaches a `SpellMod_Cooldown_Multiplier` of
		//    -1 to `SpellMaskLavaBurst` for the whole aura, so Lava Burst has *no* cooldown in Ascendance
		//    rather than one reset entry point;
		//  - `flame-shock` at band 2 wants the global when the dot reads `<= FS_CLEAVE_OVERLAP_MS` and
		//    `lava-burst` wants it when the same dot reads `> LAVA_BURST_CAST_MS`, and those two are the
		//    *same* 2000ms — the pair is a complementary partition of the dot clock, so one of them claims
		//    every band-2 global no matter what the dot reads.
		//
		// So at two targets in Ascendance the walk stops at Flame Shock or Lava Burst every time, and it
		// stops there for the right reason: `cleave.apl.json` carries no Lava Beam and puts both Lava Burst
		// rungs above Chain Lightning, so **Lava Burst is the sim's own answer** at that press. A two-target
		// beam is now faulted against a named rung the preset really has, which is the standard the five
		// narrowed rungs above are held to, rather than against a rung that was declared and unreachable.
		//
		// Measured: the change moves **no verdict and no `wanted` key on any of the four fixtures**, which
		// is the point rather than a weakness — an unreachable band cannot move anything, and that is what
		// made it worth removing. `multiTargetRungs.test.ts` proves the unreachability by construction from
		// the two thresholds, so the day either of them stops being 2000ms the proof fails loudly instead
		// of the band quietly reopening.
		key: 'lava-beam',
		id: ID.lavaBeam,
		chiCost: 0,
		energyCost: 0,
		bands: [3, 4],
		condition: (_state, auras) => auras.active('ascendance'),
	},
	{
		// Unconditional in the cleave list — the whole gate is the target count, which is the band.
		//
		// Measured on `cleave`: 70 presses at bands 1:8, 2:10, 3:12, 4:40. **The eight at band 1 stay
		// faults, and that is the point** — a single-target Chain Lightning is a real mistake, and a
		// rung that admitted it at every count would have replaced 81 unattributable faults with 81
		// excuses. The one press the log places inside an Ascendance window is almost certainly the
		// cast-finish timestamp of step 47 rather than a cast the game allowed.
		key: 'chain-lightning',
		id: ID.chainLightning,
		chiCost: 0,
		energyCost: 0,
		bands: [2, 3, 4],
		condition: (_state, auras) => !auras.active('ascendance'),
	},
	{
		// 22 — the unconditional filler. Everything above it wanted nothing.
		key: 'lightning-bolt',
		id: ID.lightningBolt,
		chiCost: 0,
		energyCost: 0,
		condition: () => true,
	},
];

/**
 * The ladder as a reference reads it, with its conditions taken off.
 *
 * The report renders the priority list twice — once as a verdict on this pull, once as the list
 * itself — and the second of those used to be a hand-maintained copy of the ladder file. Two lists
 * drift; this one has, in both directions. So the rungs are published from here instead, and a rule
 * added, renamed, reordered or re-banded in `LADDER` moves the reference in the same commit or
 * fails to compile.
 *
 * A projection rather than `LADDER` itself, because a rule carries closures. A view that could reach
 * `condition` would sooner or later call it, and it would have to invent a `State` to do so — a
 * second, fictional pull sitting inside a reference table.
 */
export const LADDER_ENTRIES = ladderEntries(LADDER);

/**
 * The on-GCD buttons this ladder does not arbitrate, each naming the section that judges the press.
 *
 * The three exclusions in this module's doc above that the **walk could not see**. Everything else that
 * doc excludes is off-GCD, and the engine only ever offers a verdict on an on-GCD press, so prose was
 * enough for those. These three are on the GCD as the registry declares them — `stormlash-totem` and
 * `earth-elemental` on `gate: 'other'`, `fire-elemental` on `gate: 'cooldown'` — so before this
 * declaration existed each press was walked down the ladder like any other and charged to whichever
 * filler rung claimed the global. Nine presses across the four committed fixtures, every one a
 * `skipped`: Stormlash 5, Fire Elemental 2, Earth Elemental 2.
 *
 * **The rung it was charged to depended only on the band**, which is the clearest sign the fault was an
 * artefact rather than a reading: the same Fire Elemental press at 479.9s on `addsThenBoss` is a skipped
 * `lightning-bolt` at band 1, a skipped `chain-lightning` at bands 2-4, and a skipped `lava-burst` on the
 * natural walk. A verdict that moves with the target count on a button no list mentions at any count is
 * not a judgement about the press.
 *
 * **And this ladder can reach `off-list` no other way**, which is why the declaration was the whole fix
 * rather than a third of it. The engine's own fall-through — "nothing on the list wanted this global" —
 * needs a bottom rung that can decline, and `lightning-bolt` below is unconditional and unbanded, so the
 * walk always stops somewhere. `offList` was 0 on all four fixtures at all four bands.
 *
 * **Not an amnesty.** Each value names a section this report really has —
 * `components/sections/Stormlash.tsx`, `FireElemental.tsx`, `EarthElemental.tsx` — and travels out on the
 * press as `AplPress.reason`, so an entry here moves a press from one verdict to another rather than
 * excusing it. A button with no rung and no entry here is still a fault, which is what Magma Totem (8190)
 * still is: it belongs to no list at any count, and `analysis/__tests__/ladderCoverage.test.ts` carries
 * that argument on its ledger rather than here.
 */
export const UNARBITRATED: Readonly<Partial<Record<number, string>>> = {
	// A raid cooldown. This module's doc calls the totem off-GCD while the registry declares
	// `onGcd: true`; whichever is right about the game, the log's press occupies a global in this walk, and
	// `Stormlash.tsx` grades it on where the press sits relative to the player's own Ascendance — rule 6's
	// question, which no rung's condition can hold.
	[ID.stormlashTotem]: 'stormlash',
	// "the cooldowns section's business", in the doc's words, and it has two graded rules of its own: the
	// pre-pull summon and the haste window the summon buys.
	[ID.fireElemental]: 'fire-elemental',
	// Its own rule in the p5 list opens in end-of-fight terms (`remainingTime <= 62s`), so a rung would
	// grade the sim's own plan as drift. Judged per press by its own section, which has room to say that
	// one of its branches ends at another player's cooldown and cannot be read.
	[ID.earthElemental]: 'earth-elemental',
};

/**
 * The whole priority list, as the reference reads it — the ladder above plus the off-GCD cooldowns
 * and the Flame Shock rules the ladder deliberately leaves to their own sections.
 *
 * `LADDER` is the on-GCD filler chain the engine walks; the reference has to show the list a player
 * actually follows, which reaches the cooldowns *between* the fillers. Each entry is a row in the
 * Rotation section, in the p5 file's own order, and the condition text is the i18n copy beside it —
 * the same one-line `test` the Windwalker's reference carries.
 */
export interface RotationEntry {
	/** The i18n key stem under `rotation.rule` — `rotation.rule.<key>.name` / `.condition`. */
	key: string;
	/** The spell whose icon stands for the row. */
	id: number;
	/** Which group the reference files the row under, so the list is scannable. */
	group: 'cooldown' | 'dot' | 'filler';
	/** False for the off-GCD cooldowns, which the ladder never sees but the list still names. */
	onGcd: boolean;
	/** Whether the row is talent-gated, so the reference can say so rather than assume it. */
	talent?: boolean;
}

export const ROTATION: readonly RotationEntry[] = [
	// The off-GCD cooldowns come first in the p5 list, before the fillers they gate.
	{ key: 'unleash-elements', id: 73680, group: 'filler', onGcd: true, talent: true },
	{ key: 'flame-shock-snapshot', id: 8050, group: 'dot', onGcd: true },
	{ key: 'elemental-mastery', id: 16166, group: 'cooldown', onGcd: false },
	{ key: 'jade-serpent-potion', id: 105696, group: 'cooldown', onGcd: false },
	{ key: 'flame-shock-asc-prep', id: 8050, group: 'dot', onGcd: true },
	{ key: 'lava-burst', id: 51505, group: 'filler', onGcd: true },
	{ key: 'ascendance', id: 114049, group: 'cooldown', onGcd: false },
	{ key: 'flame-shock-multidot', id: 8050, group: 'dot', onGcd: true },
	{ key: 'elemental-blast', id: 117014, group: 'filler', onGcd: true, talent: true },
	{ key: 'earth-shock', id: 8042, group: 'filler', onGcd: true },
	{ key: 'fire-elemental', id: 2894, group: 'cooldown', onGcd: true },
	{ key: 'searing-totem', id: 3599, group: 'filler', onGcd: true },
	{ key: 'earth-elemental', id: 2062, group: 'cooldown', onGcd: true },
	// From the cleave and aoe lists rather than p5, which has neither — see the ladder's own note.
	{ key: 'lava-beam', id: 114074, group: 'filler', onGcd: true },
	{ key: 'chain-lightning', id: 421, group: 'filler', onGcd: true },
	{ key: 'lightning-bolt', id: 403, group: 'filler', onGcd: true },
];
