// The raid buffs a Windwalker's damage rests on, and the two the monk brings themselves.
//
// A view module for the same reason `timelineBanks` next door is one: which effects a report draws is
// a claim about a spec, and it used to be written into the shared roster in `lib/analysis/raidBuffs`
// — six rows chosen for a Monk, an `iconId` documented as "the one a Windwalker is most likely to
// recognise" and a `selfProvided` documented as "true when a Monk supplies this themselves". The
// second spec to be added read all of it as though it were about them.
//
// Which spells supply an effect stays shared, because that is a fact about the game rather than about
// a spec. Only these three answers are the Monk's.

import type { RaidBuffEffect } from '~/lib/analysis/raidBuffs';

/**
 * The six, in the order the section draws them: the broadest first, then the four the raid supplies,
 * then the one whose worth depends on the reforge.
 *
 * Deliberately six and not seven — the +10% spell power group is left out, and it is the only group
 * this spec skips. A Windwalker's abilities scale from attack power (`sim/monk/monk.go`), so a row for
 * spell power would be a gap the reader could do nothing about, which is the one thing this section
 * must not print. `raidBuffs.excluded_windwalker` says so in the report rather than leaving the
 * absence to be noticed.
 *
 * `selfProvided` is true for exactly two, and both are read off the simulator rather than the tooltip:
 * `sim/monk/monk.go:170-172` sets `LegacyOfTheEmperor` in `AddRaidBuffs`, and
 * `sim/monk/windwalker/windwalker.go:55-58` adds `LegacyOfTheWhiteTiger`. Those are the two rows the
 * section is allowed to call the player's own, and the reason it is worth being exact: a wrong `true`
 * turns "the raid did not have this" into "you failed to press this".
 */
export const RAID_BUFF_EFFECTS: readonly RaidBuffEffect[] = [
	// Legacy of the Emperor's *cast* id, which is what the reader pressed. The applied-aura id (117666)
	// is in the shared provider list because the log uses it; an icon is a picture of the button.
	{ key: 'stats', iconId: 115921, selfProvided: true },
	// Horn of Winter: the commonest source of the attack-power buff, and no monk brings it.
	{ key: 'attackPower', iconId: 57330, selfProvided: false },
	{ key: 'meleeHaste', iconId: 55610, selfProvided: false },
	{ key: 'spellHaste', iconId: 24907, selfProvided: false },
	{ key: 'crit', iconId: 116781, selfProvided: true },
	{ key: 'mastery', iconId: 116956, selfProvided: false },
];
