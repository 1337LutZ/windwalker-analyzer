// The raid buffs an Elemental Shaman's damage rests on, and the three the shaman brings themselves.
//
// A view module for the same reason `timelineBanks` beside it is one: which effects a report draws is
// a claim about a spec. Before this file the claim was the Monk's — six rows chosen for a Windwalker,
// an icon picked as "the one a Windwalker is most likely to recognise" and a `selfProvided` that named
// two monk buttons — and the Elemental report drew all of it unchanged. Providers stay shared, because
// which spells supply an effect is a fact about the game.
//
// One row dropped, one row added, and `selfProvided` inverted almost completely. Every claim below is
// read out of the checked-out wowsims-mop tree, with the line, because this is the section whose
// mistakes read as accusations.

import type { RaidBuffEffect } from '~/lib/analysis/raidBuffs';

/**
 * The six, in reading order: the three that move every cast, then crit, then the flat rating, then the
 * one that reaches the shaman only through the pets.
 *
 * **`spellPower` is the row that was missing.** `{stats.SpellPower, 1.10, true}`, `sim/core/buffs.go`
 * — the broadest multiplier on an Elemental's damage, and there was no row for it to be absent from,
 * because the roster had been built for a spec that gains nothing from it.
 *
 * **`attackPower` is the row that is dropped,** and it is the only one. It is a multiplier on the AP
 * *stat*, the shaman's own spells do not scale from it, and the pets do not inherit it either —
 * `fireElementalStatInheritance` hands a pet `ownerStats[SpellPower]` for every spec but Enhancement
 * (`sim/shaman/fire_elemental_pet.go:165-175`). Elemental's own EP list carries no attack power
 * (`ui/shaman/elemental/sim.ts`). Dead on both paths, so a row for it is a fault its reader cannot fix.
 *
 * **`meleeHaste` stays, and the reason it stays is the general lesson.** The shaman does not swing —
 * `AutoSwingMelee: false`, `sim/shaman/elemental/elemental.go:44-47` — and the buff touches only
 * `PseudoStats.MeleeSpeedMultiplier`, which was very nearly enough to drop this row too. It is still
 * wrong, because **stat scaling and pseudo-stat inheritance are separate paths and a buff has to be
 * cleared on both**: a pet with `HasDynamicMeleeSpeedInheritance` multiplies its own melee speed by its
 * owner's and stays synced to it (`sim/core/pet.go:333-350`), all three of this spec's pets set that
 * flag (`fire_elemental_pet.go:42`, `earth_elemental_pet.go:31`, `lightning_elemental.go:29`, the last
 * being the T16 4-piece guardian), and they swing (`fire_elemental_pet.go:63`). It also explains what
 * looks like a bug in the sim's own UI: `ui/shaman/elemental/sim.ts` carries
 * `includeBuffDebuffInputs: [AttackSpeedBuff]`, force-adding the melee-haste picker past a stat gate
 * that would have hidden it, because the gate tests the *player's* stats and knows nothing about the
 * pet path.
 *
 * **The trap in `selfProvided`, and it is worth naming so nobody "corrects" this back.** All three
 * `true`s below are *absent* from `ui/shaman/elemental/presets.ts`. That is not the shaman doing
 * without them: `Raid.GetRaidBuffs` walks every player's `AddRaidBuffs` and turns them on
 * unconditionally (`sim/core/raid.go:254-266`), so the presets file has no reason to list what the
 * class always brings. Deriving these from the presets alone produces three false negatives, and a
 * `selfProvided` that is wrong in that direction reads "the raid did not have this" when the truth is
 * "you failed to press this" — or the reverse.
 *
 * **`crit` pays this spec twice** — every provider grants `SpellCritPercent` as well as
 * `PhysicalCritPercent` (`sim/core/buffs.go:403-449`), and the pets inherit crit as
 * `max(|PhysicalCritPercent|, |SpellCritPercent|)` (`fire_elemental_pet.go:165-168`).
 */
export const RAID_BUFF_EFFECTS: readonly RaidBuffEffect[] = [
	// Blessing of Kings: the commonest source, and the shaman brings none of this group.
	{ key: 'stats', iconId: 20217, selfProvided: false },
	// Burning Wrath 77747 — `Shaman.AddRaidBuffs`, `sim/shaman/shaman.go:230-231`.
	{ key: 'spellPower', iconId: 77747, selfProvided: true },
	// Elemental Oath 51470 — `ElementalShaman.AddRaidBuffs`, `sim/shaman/elemental/elemental.go:65`. A
	// passive talent aura with no player cast, so only an `applybuff` will ever appear for it.
	{ key: 'spellHaste', iconId: 51470, selfProvided: true },
	// Leader of the Pack: the commonest source, and likewise a passive with no cast to log.
	// 24932 and not 17007: the raid-wide aura, not the druid's own — see the crit group in
	// `lib/analysis/raidBuffs.ts` for the counts that settle which is which.
	{ key: 'crit', iconId: 24932, selfProvided: false },
	// Grace of Air 116956 — the other half of `Shaman.AddRaidBuffs`, `sim/shaman/shaman.go:230-231`.
	{ key: 'mastery', iconId: 116956, selfProvided: true },
	// Last, because it is the one this spec is paid for only at second hand — see the note above.
	{ key: 'meleeHaste', iconId: 55610, selfProvided: false },
];
