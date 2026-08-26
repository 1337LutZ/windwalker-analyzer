// Which raid buffs a Protection Paladin's damage rests on, and which of them are theirs to bring.
//
// Both fields are judgements about a spec rather than facts about the game — see `RaidBuffEffect`.
// `selfProvided` is the one that misleads if it is wrong: it turns "the raid did not have this" into
// "you failed to press this", and a paladin is the spec most exposed to getting it backwards, because
// it is the commonest source of two of the seven groups.
//
// Six of the seven. Spell power is the one left out, and it is left out on the same terms the
// Windwalker leaves out stamina: nothing a Protection Paladin presses scales from it, so a row for it
// would be one nobody can act on.
//
// **Stamina stays out on that test and only that test, which is worth stating because the obvious
// stronger reason is false here.** On the Windwalker it is fair to say stamina moves no figure on the
// page. On this spec it moves one: `Target.MaxHealth()` is what caps Vengeance
// (`sim/core/vengeance.go:106`), and it is the live Health stat rather than a constant, so anything
// adding stamina raises the ceiling the Vengeance section draws. The row would still be one nobody can
// act on — a raid either has the buff or does not — but the copy that justifies leaving it out has to
// say the narrow thing rather than the wide one.

import type { RaidBuffEffect } from '~/lib/analysis/raidBuffs';

export const RAID_BUFF_EFFECTS: readonly RaidBuffEffect[] = [
	// Blessing of Kings, and the paladin's own press — `sim/core/buffs.go` takes it as a provider of the
	// all-stats group. A gap here is genuinely this player's, which is what `selfProvided` claims.
	{ key: 'stats', iconId: 20217, selfProvided: true },
	// Blessing of Might, the same argument: the paladin brings the mastery buff. Grace of Air and
	// Roar of Courage supply the same group, so a pull can have it without the paladin having pressed
	// anything — the row still reads as theirs to fix, because it is theirs to bring.
	{ key: 'mastery', iconId: 19740, selfProvided: true },
	// Horn of Winter: the commonest source of attack power, which is what every strike here scales
	// from and which no paladin brings.
	{ key: 'attackPower', iconId: 57330, selfProvided: false },
	// Melee haste, and on this spec it is the odd one of the six: it swings the weapon faster and moves
	// no cooldown at all. Sanctity of Battle reads `TotalMeleeHasteMultiplier`, which this buff does not
	// touch — see `lib/analysis/haste`, which spends a paragraph on the distinction. So the row belongs
	// here for the autoattacks and for nothing else.
	{ key: 'meleeHaste', iconId: 55610, selfProvided: false },
	// Crit, which every one of these strikes can take.
	{ key: 'crit', iconId: 116781, selfProvided: false },
	// Spell haste, for Holy Wrath and Consecration.
	{ key: 'spellHaste', iconId: 24907, selfProvided: false },
];
