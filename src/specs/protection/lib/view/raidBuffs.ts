// Which raid buffs this spec brings, for the roster the report draws.
//
// A paladin brings two of the group and neither is optional: Blessing of Kings is the +5% stats buff
// and Blessing of Might is the mastery one. `selfProvided` is what lets the section say "you brought
// this" rather than listing it as something the raid happened to have.

import type { RaidBuffEffect } from '~/lib/analysis/raidBuffs';

export const RAID_BUFF_EFFECTS: readonly RaidBuffEffect[] = [
	// Blessing of Kings, `sim/paladin/paladin.go`'s `AddRaidBuffs` — the +5% stats buff, and the
	// paladin is its commonest source rather than one of several.
	{ key: 'stats', iconId: 20217, selfProvided: true },
	// Blessing of Might: the mastery buff, and the same call registers it.
	{ key: 'mastery', iconId: 19740, selfProvided: true },
];
