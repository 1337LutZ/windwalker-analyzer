// Shared game objects: the consumables, racials and item effects that belong to no one spec.
//
// A spec merges these into its own lists — `{ abilities: [...SHARED_ABILITIES, ...ABILITIES], auras:
// [...SHARED_AURAS, ...AURAS] }` — so a trinket proc or a flask press is defined once and drawn for
// every spec that wears it. Nothing here is a tier set bonus or a class button: those are the spec's
// own, and anything with a relationship to a spec ability (`consumedBy`, `applies` onto a spec button)
// stays in the spec where the link can resolve.
//
// `createRegistry` validates keys and ids, so a shared entry that collides with a spec entry throws —
// which is exactly the guard that keeps a spec from silently redefining something moved here.

import type { Ability, Aura } from './model';

export const SHARED_ABILITIES: Ability[] = [
	// ------------------------------------------------------------------ racials
	// The racial on-use buttons, shared because any class can be any race. All are off-GCD and never
	// scored (`gate: 'other'`); the two with a buff window declare the aura they put up.
	{
		key: 'blood-fury',
		name: 'Blood Fury',
		// Orc: +spell power / attack power for 15s — `sim/core/racials.go` (RegisterTemporaryStatsOnUseCD).
		castIds: [33697],
		onGcd: false,
		gate: 'other',
		cooldownMs: 120_000,
		applies: ['blood-fury'],
	},
	{
		key: 'berserking',
		name: 'Berserking',
		// Troll: +20% cast and attack speed for 10s — `sim/core/racials.go:309`.
		castIds: [26297],
		onGcd: false,
		gate: 'other',
		cooldownMs: 180_000,
		applies: ['berserking'],
	},
	{
		key: 'arcane-torrent',
		name: 'Arcane Torrent',
		// Blood Elf: a resource burst that logs a different id per resource — monk 129597, mana 28730,
		// energy 25046, runic 50613, rage 69179, focus 80483 — `sim/core/racials.go:18`. Instant, no
		// buff window; the ids are here so the press is named on any class.
		castIds: [129597, 28730, 25046, 50613, 69179, 80483],
		onGcd: false,
		gate: 'other',
		cooldownMs: 120_000,
	},

	// --------------------------------------------------------------- the tinker
	{
		key: 'synapse-springs',
		name: 'Synapse Springs',
		// The engineering glove tinker, registered as enchant 4898 in `sim/common/mop/enchants.go:216` —
		// `RegisterTemporaryStatsOnUseCD(…, ActionID{SpellID: 126734})`, a 1-minute cooldown behind the
		// shared offensive-trinket timer. The buff it puts up logs under a different id *per stat granted*
		// (96228/96229/96230), which is why the aura is declared apart — see it for why there are three.
		castIds: [126734],
		onGcd: false,
		gate: 'other',
		onUse: true,
		applies: ['synapse-springs'],
	},

	// ------------------------------------------------------- flasks and elixirs
	// The flask and the battle elixirs that get swapped for it, one technique and not several items.
	// A battle elixir cancels a flask — they share the `FlaskVsBattleElixir` exclusive category — so
	// pressing an elixir trades the flask's stat for the elixir's. All off-GCD, so they cost nothing.
	{
		key: 'flask-of-spring-blossoms',
		name: 'Flask of Spring Blossoms',
		castIds: [105689],
		onGcd: false,
		gate: 'other',
		onUse: true,
	},
	{
		key: 'elixir-of-the-rapids',
		name: 'Elixir of the Rapids',
		castIds: [105684],
		onGcd: false,
		gate: 'other',
		onUse: true,
	},
	{
		key: 'mad-hozen-elixir',
		name: 'Mad Hozen Elixir',
		castIds: [105682],
		onGcd: false,
		gate: 'other',
		onUse: true,
	},
	{
		key: 'monks-elixir',
		name: "Monk's Elixir",
		castIds: [105688],
		onGcd: false,
		gate: 'other',
		onUse: true,
	},
	{
		key: 'healthstone',
		name: 'Healthstone',
		// `registerConjuredCD` in `sim/core/consumes.go:372` — conjured item 5512, on the shared conjured
		// timer. It heals and does nothing else, which is why it declares no aura: there is no buff
		// window to draw and the press is the whole event.
		castIds: [6262],
		onGcd: false,
		gate: 'other',
		onUse: true,
	},
];

export const SHARED_AURAS: Aura[] = [
	// -------------------------------------------------------------- racial buffs
	{
		key: 'blood-fury',
		name: 'Blood Fury',
		ids: [33697],
		kind: 'buff',
		durationMs: 15_000,
		appliedBy: 'blood-fury',
	},
	{
		key: 'berserking',
		name: 'Berserking',
		ids: [26297],
		kind: 'buff',
		durationMs: 10_000,
		appliedBy: 'berserking',
	},
	{
		key: 'bloodlust',
		// Named for the effect rather than for any one spell: the log names whichever was cast and the
		// rotation's condition does not care which. `variants` is what says which it actually was.
		name: 'Bloodlust',
		/**
		 * The raid's haste cooldown, whichever class brought it.
		 *
		 * The APL writes this condition as `auraIsInactive(2825, tag: -1)`, and in wowsims a tag of -1
		 * means "any source" rather than "Bloodlust specifically" — the whole shared-exclusion group is
		 * one effect as far as the rotation is concerned. A log names whichever spell was cast, so all
		 * five ids have to be here or a raid with a mage instead of a shaman reads as having no haste
		 * cooldown at all. Names confirmed against the 5.4 client data the sim ships.
		 */
		ids: [2825, 32182, 80353, 90355, 146555],
		variants: {
			2825: 'Bloodlust',
			32182: 'Heroism',
			80353: 'Time Warp',
			// The Beast Mastery hunter's pet, and the label was the *later* name for it. A 5.4 log writes
			// "Ancient Hysteria" (44 applications across three 25H raid nights); "Primal Rage" is what the
			// same id became afterwards. The id was right and the word a reader would see was not.
			90355: 'Ancient Hysteria',
			146555: 'Drums of Rage',
		},
		kind: 'buff',
	},
	{
		key: 'skull-banner',
		name: 'Skull Banner',
		/**
		 * The Warrior's raid cooldown: **+20% critical strike damage** for ten seconds, every three
		 * minutes. `SkullBannerAura`'s `OnGain` multiplies `PseudoStats.CritDamageMultiplier` by 1.2 and
		 * `OnExpire` divides it back — `sim/core/buffs.go:1153-1176`, with `SkullBannerDuration` and
		 * `SkullBannerCD` at :1121-1122.
		 *
		 * **Shared rather than a spec's, for the same reason Bloodlust is.** It is pressed by somebody
		 * else and lands on the whole raid, and what it multiplies is crit *damage* — which every spec in
		 * this repository deals, and every spec that could be added to it. Declaring it in one spec's
		 * list would be declaring it for one of the two players it was measured on.
		 *
		 * **114206, and 114207 must never be written here.** `sim/core/buffs.go:1118` is `var
		 * SkullBannerActionID = ActionID{SpellID: 114206}` and the aura registers under that same number;
		 * 114207 occurs exactly once in the simulator's repository, at
		 * `ui/core/components/inputs/buffs_debuffs.ts:108`, as the icon the buff picker draws. The log
		 * agrees with the sim and not with the picker: 114206 lands on the player on all four committed
		 * pulls — 4 applications on `phased`, 2 on `unbroken`, 4 on `cleave`, 3 on
		 * `dataset-ironJuggernaut`, each matched by a removal — and 114207 appears on none of them. Plan
		 * §51a recorded that split, and declaring the UI id is the exact shape that produced the retired
		 * 144998: a handle the game never writes, wired to five readers, silent through fifty-three green
		 * tests.
		 *
		 * No `appliedBy`, on the same terms as Bloodlust: the press belongs to another actor, so there is
		 * no button of this player's for it to point at.
		 */
		ids: [114206],
		kind: 'buff',
		durationMs: 10_000,
	},

	// ---------------------------------------------------------- the tinker buff
	{
		key: 'synapse-springs',
		name: 'Synapse Springs',
		/**
		 * Pressed, so it is a lane that merges onto its own press row. Not the 126734 the simulator uses
		 * for both halves: the tinker's button and the buff it puts up are different ids in a Classic log.
		 *
		 * **Three ids, not one, and the original measurement could not have seen that.** The tinker grants
		 * *your highest* of Strength, Agility or Intellect (`sim/common/mop/enchants.go:216` —
		 * `GetHighestStatType`), and the game writes a different id per stat. This said "96228, always the
		 * buff. Measured on the reference pulls" — and it was, on pulls whose players were all monks, for
		 * whom the answer is always agility. Three 25H raid nights across ~75 gear sets write 96228 Agi
		 * 2,072 · 96229 Str 1,246 · **96230 Int 3,068**, and 96230 is the *most* common of the three.
		 *
		 * The consequence was live: all three committed Elemental fixtures press 126734 and none of them
		 * could draw the buff it put up, because a shaman's highest stat is intellect and 96230 was not
		 * declared. `variants` says which stat it landed as, on the same terms as Re-Origination below.
		 */
		ids: [96228, 96229, 96230],
		variants: { 96228: 'Agility', 96229: 'Strength', 96230: 'Intellect' },
		kind: 'buff',
		durationMs: 10_000,
		appliedBy: 'synapse-springs',
	},

	// ------------------------------------------------------ trinkets, meta, cloak
	// The non-tier item effects: gear procs that fire on their own and belong to no spec. Almost all are
	// a `buff` in the game's sense, and the timeline's proc/buff split is made further down, not here.
	//
	// "None of them touches the enemy" used to be part of that sentence and it was only true by
	// omission: `essence-of-yulon` below is an enemy **debuff**, and a Buffs sweep is structurally
	// incapable of finding one — which is exactly how a proc on all three Elemental fixtures went
	// undeclared. An item effect being a debuff is not a special case, it is a `kind`.
	{
		key: 'unerring-vision',
		name: 'Unerring Vision of Lei-Shen',
		// "Perfect Aim", four seconds of guaranteed crit — item 94524, `itemEffects[0].buffId` in
		// `assets/database/db.json`, and `UnerringVisionBuffId` in `sim/common/mop/trinkets_phase_3_52.go:13`.
		// **This is the trinket's only effect.** It has no `stackingAura` in `db.json`, no second id in the
		// sim, and no counter. A key called `unerring-vision-stacks` used to claim otherwise; the id it held
		// was 138786, which is Wushoolay's, and it says so now under `wushoolays-lightning` below.
		ids: [138963],
		kind: 'buff',
		durationMs: 4_000,
	},
	{
		/**
		 * *** Wushoolay's Final Choice's proc window. The entry is this long because the *simulator's* own
		 * priority list will send a reader here looking for a ten-stack counter, and there is not one. ***
		 *
		 * The key read `unerring-vision-stacks` until `7319f15`, with `name: 'Unerring Vision of Lei-Shen
		 * (stacking)'` and `maxStacks: 10` beside it, and every part of that except the id was wrong about
		 * something. The id was always the only half that named a real aura.
		 *
		 * **138786 is not Unerring Vision's.** It is Wushoolay's Final Choice's proc window — `db.json` item
		 * 94513, `itemEffects[0]`: buff "Wushoolay's Lightning", ten seconds, `maxCumulativeStacks: 1`. It
		 * does not stack, and three 25H raid nights write 45 non-stacking applications of it. Its ten-stack
		 * counter is a **separate** id, 138788 "Electrified" (`stackingAura.buffId`), declared as
		 * `wushoolays-lightning-stacks` below. So the retired `maxStacks: 10` was not a number on the wrong
		 * id, it was a number the game never writes for this id at all.
		 *
		 * **And Unerring Vision has no counter.** `db.json` items 94524/95814/96186/96558/96930 each carry
		 * exactly one effect, 138963, with no `stackingAura`; `sim/common/mop/trinkets_phase_3_52.go:13`
		 * carries the same single id. There was no aura for the old key to have been named after.
		 *
		 * **The part worth keeping is where the confusion came from, because the sim is not wrong on its own
		 * terms.** `ui/shaman/elemental/apls/p5.apl.json`'s "Flame Shock Rules" asks for
		 * `auraNumStacks(138786) >= 10`, and inside the sim that holds: the *hand-written* Wushoolay's
		 * override (`trinkets_phase_3_52.go:99-108`) puts the stacks on 138786 and the payload on 138790 —
		 * the inversion described on the stacking-trinket block below. A log writes the window and the
		 * counter as separate ids, so the same condition cannot hold there. Transcribing it named the wrong
		 * trinket and then asked a non-stacking id for ten stacks.
		 *
		 * **Where the two sources disagree about which id is the payload and which the tracker, `db.json`
		 * was right five times out of five** — the per-trinket counts are on the stacking-trinket block
		 * below, and `game/__tests__/shared.test.ts`'s sim-only list is the guard that keeps a declaration
		 * from reaching for the Go file again.
		 *
		 * Anything that wants the ten stacks reads `wushoolays-lightning-stacks`, the aura that can reach
		 * them: `WUSHOOLAYS_STACKS` in `specs/elemental/lib/index.ts` builds one of the Flame Shock
		 * snapshot audit's three trigger windows off it, and the ledgers in
		 * `lib/analysis/__tests__/fixtureCoverage.test.ts` and
		 * `specs/elemental/lib/__tests__/snapshots.test.ts` name it too. Nothing resolves this key by the
		 * old name any more, so it is free to say what it holds.
		 */
		key: 'wushoolays-lightning',
		name: "Wushoolay's Lightning",
		ids: [138786],
		kind: 'buff',
		durationMs: 10_000,
	},
	{
		key: 'breath-of-hydra',
		name: 'Breath of the Hydra',
		ids: [138898],
		kind: 'buff',
	},
	{
		key: 'chayes',
		name: "Cha-Ye's Essence of Brilliance",
		ids: [139133],
		kind: 'buff',
	},
	{
		key: 'wrath-of-darkspear',
		name: 'Wrath of the Darkspear',
		// Black Blood of Y'Shaarj's proc **window** — `db.json` item 102310 `itemEffects[0]`, ten seconds,
		// no `maxCumulativeStacks`. The `maxStacks: 10` that used to sit here was on the wrong id: the
		// counter is 146202, declared as `wrath-of-darkspear-stacks` below. Three raid nights write 1,424
		// applications of this and 15,707 of the counter, which is the ratio you would expect of a window
		// against a per-second tick inside it.
		ids: [146184],
		kind: 'buff',
		durationMs: 10_000,
	},
	{
		key: 'tempus-repit',
		name: 'Tempus Repit',
		// Sinister Primal Diamond (item 95347), 30% spell haste — `sim/common/mop/metagems.go:133`. The
		// trigger beside it (137592) is a hidden marker the game does not write; only the buff is here.
		ids: [137590],
		kind: 'buff',
		durationMs: 10_000,
	},
	{
		key: 'fortitude',
		name: 'Fortitude',
		// Indomitable Primal Diamond (item 95344), the defensive meta gem: 20% damage taken reduction for
		// fifteen seconds — `sim/common/mop/metagems.go:179`. Declared for the same reason as the other two
		// primal diamonds, so a tank's or a poorly-gemmed player's head slot is named rather than blank.
		ids: [137593],
		kind: 'buff',
		durationMs: 15_000,
	},
	{
		key: 're-origination',
		name: 'Re-Origination',
		// Rune of Re-Origination converts your two lowest secondary stats into twice as much of your
		// highest, and logs a *different aura per stat gained*. Which one you get depends on what else
		// was up at the proc, so a single fight can mix all three. Mapping confirmed two ways: the DBC
		// effect order and `sim/common/mop/trinkets_phase_3_52.go`.
		ids: [139117, 139120, 139121],
		variants: { 139117: 'Crit', 139120: 'Mastery', 139121: 'Haste' },
		kind: 'buff',
		durationMs: 10_000,
	},
	{
		key: 'vicious',
		name: 'Vicious',
		// Haromm's Talisman, the agility half of the pair of Siege multistrike trinkets —
		// `sim/common/mop/trinkets_phase_4_54.go:363-367`.
		ids: [148903],
		kind: 'buff',
	},
	{
		key: 'ferocity',
		name: 'Ferocity',
		// Sigil of Rampage, the agility cleave trinket — `sim/common/mop/trinkets_phase_4_54.go:739-743`.
		ids: [148896],
		kind: 'buff',
	},
	{
		key: 'expanded-mind',
		name: 'Expanded Mind',
		/**
		 * Purified Bindings of Immerseus — `db.json` item 102293 `itemEffects[0]`, twenty seconds behind a
		 * 115-second internal cooldown at a 15% chance.
		 *
		 * **Found by asking the fixtures the other question.** The coverage ledger asks "which declared
		 * aura never fires"; this id is the opposite hole — an id the committed pulls *carry* that nothing
		 * declared. All three Elemental fixtures write it (5, 4 and 4 applications), and no sweep of the
		 * declarations could have noticed, in exactly the way `combatantinfo`'s pre-pull aura list held
		 * Leader of the Pack while the raid-buff row read the buff absent.
		 *
		 * Its `itemEffects[1]` sibling, 146051 "Amplification", is deliberately not here: it is one of the
		 * hidden marker auras the game does not write.
		 */
		ids: [146_046],
		kind: 'buff',
		durationMs: 20_000,
	},
	{
		key: 'dextrous',
		name: 'Dextrous',
		// Assurance of Consequence, the agility trinket of the same family — `db.json` item 102292
		// `itemEffects[1]`. Its "Readiness" sibling (146019) is a hidden marker and is not declared.
		ids: [146_308],
		kind: 'buff',
		durationMs: 20_000,
	},
	{
		key: 'titanic-restoration',
		name: 'Titanic Restoration',
		// Prismatic Prison of Pride, the third of the family — `db.json` item 102299 `itemEffects[1]`.
		ids: [146_314],
		kind: 'buff',
		durationMs: 20_000,
	},
	{
		key: 'toxic-power',
		name: 'Toxic Power',
		// Kardris' Toxic Totem, the intellect half of the pair of Siege multistrike trinkets — `db.json`
		// item 102300 `itemEffects[1]`, ten seconds. The sibling of `vicious` above, and the reason to have
		// it is not symmetry: it fires on **all three** committed Elemental fixtures (9, 12 and 10 events)
		// and had nowhere to land.
		ids: [148906],
		kind: 'buff',
		durationMs: 10_000,
	},
	{
		key: 'tenacious',
		name: 'Tenacious',
		// Fusion-Fire Core, the strength cleave trinket — `db.json` item 102295 `itemEffects[1]`, fifteen
		// seconds. The strength sibling of `ferocity` above.
		ids: [148899],
		kind: 'buff',
		durationMs: 15_000,
	},
	{
		key: 'juju-madness',
		name: 'Juju Madness',
		// Bad Juju, the agility half of the Throne of Thunder proc trinkets whose intellect halves
		// (`breath-of-hydra`, `chayes`) were already here — `db.json` item 94523 `itemEffects[0]`.
		ids: [138938],
		kind: 'buff',
		durationMs: 10_000,
	},
	{
		key: 'rampage',
		name: 'Rampage',
		// Primordius' Talisman of Rage, the strength trinket of the same tier — `db.json` item 94519. Five
		// stacks and no separate counter: unlike the five window/counter pairs below, this one really does
		// carry its own stacks on the one id that logs.
		ids: [138870],
		kind: 'buff',
		durationMs: 10_000,
		maxStacks: 5,
	},
	{
		key: 'eye-of-brutality',
		name: 'Eye of Brutality',
		// Gaze of the Twins, the crit trinket of the same tier — `db.json` item 94529. Twenty seconds,
		// three stacks, again on the one id.
		ids: [139170],
		kind: 'buff',
		durationMs: 20_000,
		maxStacks: 3,
	},

	// -------------------------------------- the stacking trinkets: window + counter
	/**
	 * Five Throne of Thunder / Siege trinkets that log **two** auras each, and the pairing is the whole
	 * declaration: a *window* that opens once per proc, and a *counter* inside it that gains a stack on a
	 * fixed period. Reading only one of the two gets a different question's answer — the window says how
	 * often the trinket fired, the counter says how much stat it was actually worth.
	 *
	 * *** Taken from `assets/database/db.json` (`itemEffects[].buffId` and `.stackingAura.buffId`), and
	 * NOT from the sim's hand-written Go, which inverts the pair for every one of them. *** The Go
	 * override splits each trinket into a "visible payload" aura and a "hidden tracker", and across three
	 * 25H raid nights the payload fires **zero** times and the tracker is the id the game writes: 138790/0
	 * against 138786/45, 138758/0 against 138759/102, 146311/0 against 146310/683, 146183/0 against
	 * 146184/1,424, 138849/0 against 138856/275. Two of those overrides carry comments saying they exist
	 * for APL compatibility rather than for log fidelity, which is the same hazard as the retired 144998:
	 * a number written for the rotation language that the game never emits. `db.json` gets all five right.
	 *
	 * **And that finding is guarded, not only written down here.** All five payload ids are in the
	 * sim-only list in `game/__tests__/shared.test.ts` — the one suite there whose list does not come from
	 * these declarations — so re-inverting any pair from the Go file fails a named test instead of quietly
	 * emptying a lane. Which is the whole difference from the 144998 failure: that id was declared with a
	 * sim citation beside it and measured nothing for as long as nothing asked.
	 */
	{
		key: 'blades-of-renataki',
		name: 'Blades of Renataki',
		// Renataki's Soul Charm (agility), `db.json` item 94512.
		ids: [138756],
		kind: 'buff',
		durationMs: 10_000,
	},
	{
		key: 'blades-of-renataki-stacks',
		name: 'Blades',
		// The counter inside the window above: one stack per second to ten, each worth its own agility.
		ids: [138737],
		kind: 'buff',
		durationMs: 10_000,
		maxStacks: 10,
	},
	{
		key: 'feathers-of-fury',
		name: 'Feathers of Fury',
		// Fabled Feather of Ji-Kun (strength), `db.json` item 94515.
		ids: [138759],
		kind: 'buff',
		durationMs: 10_000,
	},
	{
		key: 'feathers-of-fury-stacks',
		name: 'Mighty',
		ids: [138760],
		kind: 'buff',
		durationMs: 10_000,
		maxStacks: 10,
	},
	// Wushoolay's Final Choice's own window is the one gap in this block, and it is an accident of
	// placement rather than an omission: 138786 is declared above, under the key `wushoolays-lightning`,
	// in the block for trinkets that log a single aura. The wrong name is what put it there — the sweep
	// re-keyed it off `unerring-vision-stacks` without moving the entry — and the reason is given at
	// length on that entry.
	{
		key: 'wushoolays-lightning-stacks',
		name: 'Electrified',
		// The counter the sim's APL means when the p5 Flame Shock rule asks for `auraNumStacks(138786) >=
		// 10`: in the sim 138786 *is* the counter, because the Go override put the stacks on the window's
		// id. In a log the two are separate and this is the one that reaches ten.
		ids: [138788],
		kind: 'buff',
		durationMs: 10_000,
		maxStacks: 10,
	},
	{
		key: 'cruelty',
		name: 'Cruelty',
		// Skeer's Bloodsoaked Talisman (strength), `db.json` item 102308.
		ids: [146285],
		kind: 'buff',
		durationMs: 10_000,
	},
	{
		key: 'cruelty-stacks',
		name: 'Cruel',
		// **Twenty**, not ten, and on a 500ms period rather than a second — `db.json` item 102308
		// `stackingAura.maxCumulativeStacks: 20`, `stackPeriodMs: 500`. The only one of the five pairs that
		// is not a ten-stack counter, which is exactly why the cap is data and not a literal at the reader.
		ids: [146293],
		kind: 'buff',
		durationMs: 10_000,
		maxStacks: 20,
	},
	{
		key: 'wrath-of-darkspear-stacks',
		name: 'Wrath',
		// Black Blood of Y'Shaarj's counter — `db.json` item 102310 `stackingAura.buffId`, ten stacks on a
		// one-second period. The id the `maxStacks: 10` on `wrath-of-darkspear` above was reaching for.
		ids: [146202],
		kind: 'buff',
		maxStacks: 10,
	},
	{
		key: 'restless-agility',
		name: 'Restless Agility',
		// Ticking Ebon Detonator, `db.json` item 102311 — and **no pair**: twenty stacks on the one id that
		// logs, with no `stackingAura` beside it. The sim's 146311 payload is the sixth inversion and fires
		// zero times. Declared as a single aura because that is what the game has, not for want of looking.
		ids: [146310],
		kind: 'buff',
		durationMs: 10_000,
		maxStacks: 20,
	},
	{
		key: 'cloudburst',
		name: 'Cloudburst',
		// Horridon's Last Gasp, `db.json` item 94514 — a healer's mana return, five stacks, one id. Here
		// rather than omitted because it is confirmed logged (275 applications) and a shared item effect
		// belongs to no spec; it will simply never fire for a damage spec.
		ids: [138856],
		kind: 'buff',
		durationMs: 10_000,
		maxStacks: 5,
	},

	// --------------------------------------------------------------- the meta gems
	{
		key: 'capacitance',
		name: 'Capacitance',
		// The Capacitive Primal Diamond (item 95346): stacks to five, then spends the whole stack on a
		// Lightning Strike — `sim/common/mop/metagems.go:69-79`. A counter, not a plain buff. The payload
		// is a *damage* id and so belongs to no aura: 137597 normally, and **141004** for a hunter
		// (`metagems.go:48`), which nothing declared until `charts/hidden.ts` learned the second one.
		ids: [137596],
		kind: 'buff',
		durationMs: 60_000,
		maxStacks: 5,
	},

	// --------------------------------------------------------- the legendary cloaks
	{
		key: 'flurry-of-xuen',
		name: 'Flurry of Xuen',
		// `sim/common/mop/cloaks_phase_4_54.go:133-136` registers this aura for Fen-Yu, Fury of Xuen (item
		// 102248) — three seconds during which the cloak throws its own strikes. `db.json` gives the same
		// id to Gong-Lu, Strength of Xuen (102249), so the two melee cloaks are one effect here. The
		// strikes land under 147891, or **149276** for a hunter (`cloaks_phase_4_54.go:111`), and both are
		// damage ids rather than auras.
		ids: [146194],
		kind: 'buff',
		durationMs: 3_000,
	},
	{
		key: 'essence-of-yulon',
		name: "Essence of Yu'lon",
		/**
		 * The caster legendary cloak, Xing-Ho, Breath of Yu'lon (item 102246) — and the one item effect
		 * here that is **not a buff**. The proc lands as a debuff on the enemy and burns it: all three
		 * committed Elemental fixtures carry `applydebuff 146198` on their bosses (11+2, 18, 16 with
		 * refreshes) and the ignite's own damage id 148008 alongside it (101, 102 and 106 events).
		 *
		 * A Buffs sweep cannot see this, which is how an id this busy stayed undeclared: it is invisible in
		 * `dataType: Buffs` and heavy in `dataType: Debuffs, hostilityType: Enemies`. Four seconds from
		 * `db.json` item 102246; the ignite is four one-second ticks in
		 * `sim/common/mop/cloaks_phase_4_54.go:33-45`, which is the same window seen from the other side.
		 */
		ids: [146198],
		kind: 'debuff',
		durationMs: 4_000,
	},
	{
		key: 'spirit-of-chi-ji',
		name: 'Spirit of Chi-Ji',
		// Jina-Kang, Kindness of Chi-Ji (item 102247), the tank cloak — ten seconds, `db.json`
		// `itemEffects[0]`. The third of the three cloak procs, declared so the family is complete.
		ids: [146200],
		kind: 'buff',
		durationMs: 10_000,
	},

	// ----------------------------------------------- weapon and cloak enchant procs
	{
		key: 'windsong',
		name: 'Windsong',
		/**
		 * The weapon enchant (4441), and the plainest `variants` case in the file: **one** effect that
		 * grants crit, haste or mastery at random and writes a different id for each — 104423 haste,
		 * 104509 crit, 104510 mastery, twelve seconds, all three named just "Windsong" in the client data
		 * (`db.json` enchant 4441 `enchantEffects[]`, and `sim/common/mop/enchants.go:21-35`).
		 *
		 * Declaring one of the three would have read as "this player's enchant procced a third as often".
		 * The trigger id beside them (104561) is not here: it is a marker the game does not write.
		 */
		ids: [104423, 104509, 104510],
		variants: { 104423: 'Haste', 104509: 'Crit', 104510: 'Mastery' },
		kind: 'buff',
		durationMs: 12_000,
	},
	{
		key: 'dancing-steel',
		name: 'Dancing Steel',
		/**
		 * The melee weapon enchant (4444) — and **the one place where both the sim and `db.json` are
		 * wrong about the id**, which is why it is a single number and not the pair they describe.
		 *
		 * Both name 118334 (agility) and 118335 (strength): `sim/common/mop/enchants.go:172` and `db.json`
		 * enchant 4444. Neither appears anywhere in the 1,317 distinct friendly ids of three 25H raid
		 * nights. What the game writes is **120032**, 13,024 applications, and the committed Windwalker
		 * fixture carries 28 events of it (12 applies, 6 refreshes, 10 removes) under a source of -1, the
		 * way a weapon enchant does.
		 *
		 * So the unlogged pair is deliberately absent rather than included "for completeness": an id the
		 * game never writes is the 144998 failure, and two of them would make this lane measure a third of
		 * nothing. The consequence of the omission is that the stat granted is not readable off the log —
		 * the one id covers both halves of `GetHighestStatType`.
		 */
		ids: [120032],
		kind: 'buff',
		durationMs: 12_000,
	},
	{
		key: 'jade-spirit',
		name: 'Jade Spirit',
		// The caster weapon enchant (4442), twelve seconds of intellect — `db.json` enchant 4442, and
		// `sim/common/mop/enchants.go:115`. Fires on all three committed Elemental fixtures (26, 19 and 11
		// events) and had nowhere to land. The sim's second aura on the same id is the sub-25%-mana spirit
		// half, which is a tag on 104993 rather than an id of its own.
		ids: [104993],
		kind: 'buff',
		durationMs: 12_000,
	},
	{
		key: 'rivers-song',
		name: "River's Song",
		// The dodge weapon enchant (4446) — seven seconds, two stacks, `db.json` enchant 4446. Defensive,
		// so it is counted rather than scored, like the flasks above.
		ids: [116660],
		kind: 'buff',
		durationMs: 7_000,
		maxStacks: 2,
	},
	{
		key: 'lightweave',
		name: 'Lightweave',
		// Lightweave Embroidery, the tailoring cloak enchant — intellect for fifteen seconds, `db.json`
		// enchants 3722/4115/4892 (all three ranks write the same buff id). Fires on two of the three
		// committed Elemental fixtures (10 and 7 events).
		ids: [125487],
		kind: 'buff',
		durationMs: 15_000,
	},
	{
		key: 'swordguard-embroidery',
		name: 'Swordguard Embroidery',
		// The melee half of the same tailoring pair — attack power for fifteen seconds, `db.json` enchants
		// 3730/4118/4894.
		ids: [125489],
		kind: 'buff',
		durationMs: 15_000,
	},
	{
		key: 'lord-blastingtons',
		name: "Lord Blastington's Scope of Doom",
		// The engineering ranged scope (enchant 4699) — agility for ten seconds, `db.json` enchant 4699.
		ids: [109085],
		kind: 'buff',
		durationMs: 10_000,
	},
];
