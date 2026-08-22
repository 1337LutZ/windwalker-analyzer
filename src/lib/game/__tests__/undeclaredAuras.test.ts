// The third failure mode: an id the log puts on the player that **nothing declares**.
//
// There are three shapes an aura can go missing in, and until this file there were guards for two:
//
// | shape                       | guard                                        |
// | --------------------------- | -------------------------------------------- |
// | declared, never fires       | `analysis/__tests__/fixtureCoverage.test.ts` |
// | declared, fires, not drawn  | both specs' `lib/__tests__/drawnAuras.test.ts` |
// | **fires, never declared**   | **this file**                                |
//
// The second guard cannot be widened into the third, and the reason is structural rather than a matter
// of effort: it sweeps `registry.auraById(...)` and drops what it cannot resolve, so it asks "of the
// auras this spec models, which are drawn". An id nothing models is not in its domain.
//
// **Skull Banner is what that hole cost.** 114206 goes up on all four committed pulls — 4 applications
// on `phased`, 2 on `unbroken`, 4 on `cleave`, 3 on `dataset-ironJuggernaut`, apply and remove in equal
// numbers each time. It is a twenty-percent crit-*damage* window from another player's three-minute
// raid cooldown, which is a real multiplier on the audited player's damage. It was named in the
// Elemental's `EXTRA_NAMES`, so the cast-coverage ledger was satisfied; it was never declared, so the
// drawn-aura sweep could not see it; and it was drawn nowhere, so the report simply did not mention it.
// It passed every check in the repository while being absent. 146046 was the same shape, and a reader
// found that one too.
//
// **One file for both specs, and one ledger.** The ids below are overwhelmingly *not* spec knowledge —
// another priest's absorb and Iron Juggernaut's drill land on a monk and on a shaman identically — so a
// per-spec copy of this ledger would be two lists sharing forty entries and drifting. That is the
// mistake `analysis/drawnAuras.ts` was written to undo, and its module doc records what a second copy
// cost the first time. Where a spec genuinely differs the sweep carries it: `IdSweep` pairs each pull
// with its own spec's `declares`, which is how 120676 can be declared on one spec and ledgered on the
// other without either claim being written twice.
//
// **What the ledger is for.** Not to make this pass. Most of what a 25-man raid puts on a player is
// somebody else's healing, somebody else's defensive and the boss's own debuffs, and none of that is a
// gap — a damage audit that drew a row for Rejuvenation would be worse, not better. The entries say
// which of those it is, in the words of the thing itself, so that the *next* id to appear here is read
// rather than waved through. The entries marked as gaps are not classifications at all and say so;
// they name the file that has to change and go the moment it does, which `declaredLedgerIds`
// enforces.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	auraIdsPutOnPlayer,
	declaredLedgerIds,
	staleLedgerIds,
	unmodelledAuraIds,
	type IdSweep,
} from '~/lib/analysis/drawnAuras';
import { RAID_BUFF_NAMES } from '~/lib/analysis/raidBuffs';
import type { Registry } from '~/lib/game/registry';
import type { FightDataset } from '~/lib/types';
import { registry as elemental } from '~/specs/elemental/lib';
import { registry as windwalker } from '~/specs/windwalker/lib';

const fixture = (spec: string, file: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../specs/${spec}/__fixtures__/${file}.json`), 'utf8'));

/**
 * Every pull in the repository that carries raw events, with the spec that analyses it.
 *
 * The six pre-analysed Windwalker fixtures are absent because they have no `events` array at all —
 * the capture harness writes `analyse()`'s output rather than its input — which that spec's
 * `drawnAuras.test.ts` asserts rather than works around.
 */
const PULLS: Array<[string, FightDataset, Registry]> = [
	['elemental/phased', fixture('elemental', 'phased'), elemental],
	['elemental/unbroken', fixture('elemental', 'unbroken'), elemental],
	['elemental/cleave', fixture('elemental', 'cleave'), elemental],
	['windwalker/ironJuggernaut', fixture('windwalker', 'dataset-ironJuggernaut'), windwalker],
];

/**
 * The raid-buff roster counts as declaring an id, and it is the one exemption that is not a ledger
 * entry.
 *
 * `analysis/raidBuffs.ts` models the buffs a player's *damage* rests on by effect rather than by spell
 * — `EFFECTS`, copied from the simulator's own exclusive-effect categories — and `readRaidBuffs`
 * measures every one of them on the player's own stream. So Battle Shout, Moonkin Aura and Legacy of
 * the White Tiger are modelled and drawn; they are simply modelled *there* rather than in a spec's
 * registry, because two providers of one effect are one row. Seventeen of the ids these four pulls
 * carry are covered by it, and writing seventeen ledger entries saying "see raidBuffs.ts" would be a
 * copy of `EFFECTS` that could drift from it. Read through `RAID_BUFF_NAMES`, which is `EFFECTS`'
 * own second reading and not a second list.
 */
const modelled = (registry: Registry, id: number): boolean =>
	registry.auraById(id) !== undefined || RAID_BUFF_NAMES.has(id);

const sweeps: IdSweep[] = PULLS.map(([, dataset, registry]) => ({
	ids: auraIdsPutOnPlayer(dataset),
	declares: (id) => modelled(registry, id),
}));

// ---------------------------------------------------------------- the ledger
//
// One builder per class of thing rather than one string per id: the reason is a property of the class
// and writing it forty times would be forty chances to write it differently. What is per-id is the
// *classification* and the spell's own name, which is the judgement being recorded.

/** Healing this player was given, or an aura — or a lockout — that somebody's heal left on them. */
const healing = (spell: string): string =>
	`${spell}: healing another player put on this one. This is a damage audit and measures none of it, deliberately — a row per incoming heal would push the rotation's own rows off a long pull.`;

/** Somebody else's defensive or utility cooldown, landing on the raid and on this player with it. */
const raidDefensive = (spell: string): string =>
	`${spell}: another player's defensive or utility cooldown, landing raid-wide. It changed what the player survived and nothing about what the rotation wanted.`;

/** The encounter's own debuff. */
const bossMechanic = (spell: string, boss: string): string =>
	`${spell}: ${boss}'s own debuff on the player. Boss mechanics are the encounter's, not the model's; nothing here declares an ability of theirs.`;

/** The lockout the raid haste cooldown leaves behind. */
const lustLockout = (spell: string): string =>
	`${spell}: the lockout the raid haste cooldown leaves behind. It says only that \`bloodlust\` has already been up, which is declared, drawn and measured on its own.`;

const LEDGER: Record<number, string> = {
	// ------------------------------------------------- gaps, not classifications
	// The entries below marked as gaps are the finding rather than a filing. Each names the file that
	// has to change and dies the moment it does: `declaredLedgerIds` fails naming the id, which is the
	// handoff.

	// The Elemental's own +20% Elemental-school damage buff, and by far the largest thing this sweep
	// found. `sim/shaman/talents_elemental.go:143-190` registers Clearcasting as a 2-stack, 15s aura on
	// spell id 16246 that attaches `SpellMod_DamageDone_Pct` +0.2 for the Elemental school (and again
	// for Earthquake) alongside its -25% power cost, triggered on any crit from the elemental spell mask
	// and consumed a stack per cast. 728 events across the three Elemental pulls — the busiest id in the
	// whole sweep. `elemental/lib/index.ts:903` names it "Elemental Focus" so the damage table can
	// label the row, and that is the only thing in the repository that knows the number exists.
	16246:
		'Clearcasting: NOT MODELLED, and it is a damage multiplier. The Elemental Focus proc — +20% Elemental-school damage, 2 stacks, 15s, consumed per cast (sim/shaman/talents_elemental.go:143). Needs an aura in specs/elemental/lib/index.ts; this entry goes when it has one.',

	// -------------------------------------------------------- the player's own
	// Off-rotation presses and passives. All are named in the Elemental's `EXTRA_NAMES` where they are
	// casts, so the press is labelled; what is not modelled is the buff window, and none of these
	// windows says anything about the rotation.
	546: "Water Walking: the player's own out-of-combat convenience, a ten-minute buff that does nothing in a fight.",
	2645: "Ghost Wolf: the player's own travel form. Off-rotation, and named as a press in EXTRA_NAMES.",
	30823:
		"Shamanistic Rage: the player's own off-GCD mana-and-mitigation press. Named in EXTRA_NAMES, and the only press on that list genuinely off the global.",
	54861:
		'Nitro Boosts: the engineering boot tinker — +150% run speed for 5s (aura 171, DBC), no stat and no damage. The glove tinker is declared because it grants a stat; this one has nothing to draw.',
	// The food buff. A flat +300 to one primary stat for an hour (aura 29, DBC), so it is part of the
	// stat baseline the whole pull is measured on rather than an event in it — two ids because two
	// players ate differently: 104275 grants Agility, 104277 Intellect.
	104275:
		'Well Fed (Agility): the food buff, +300 to a primary stat for an hour. A stat baseline, not an event on the timeline.',
	104277:
		'Well Fed (Intellect): the food buff, +300 to a primary stat for an hour. A stat baseline, not an event on the timeline.',
	// -10% damage taken for 6s while Lightning Shield is below three charges (aura 87, school mask 127,
	// DBC). Purely defensive: it is not in the simulator at all, and the charge bank the rotation does
	// care about is drawn already, as `lightning-shield` above the rows.
	142912:
		'Glyph of Lightning Shield: a defensive glyph, -10% damage taken for 6s (DBC aura 87). Not in the simulator, and the charge count it keys off is already drawn as the shield bank.',
	// The channel's own self-aura, under the same id the press logs. It is modelled — as a *cast*:
	// `specs/windwalker/lib/index.ts:534` declares `castIds: [113656]` with a `channel`, and the
	// timeline draws the channel from that plus its tick stream. An aura window on the same id would
	// restate the row beside it.
	113656:
		"Fists of Fury: the channel's own self-aura, on the same id the press logs. Modelled as a cast with a `channel` (specs/windwalker/lib/index.ts:534) and drawn from that — an aura here would restate the row.",

	// ------------------------------------------- the lust lockout, all three ids
	57723: lustLockout('Exhaustion'),
	57724: lustLockout('Sated'),
	80354: lustLockout('Temporal Displacement'),

	// ------------------------------------- a raid buff outside the damage roster
	// `raidBuffs.ts` carries the effects the *simulator* groups, which are the ones a player's damage
	// rests on. Stamina is not one of them, so this has no row to be missing from and no gap to report.
	21562:
		"Power Word: Fortitude: +stamina raid-wide. Outside the simulator's damage roster, so `raidBuffs.ts` groups no effect for it.",

	// ---------------------------------------- other players' defensives and utility
	31821: raidDefensive('Devotion Aura'),
	76577: raidDefensive('Smoke Bomb'),
	97463: raidDefensive('Rallying Cry'),
	106898: raidDefensive('Stampeding Roar'),
	115213: raidDefensive('Avert Harm'),
	145629: raidDefensive('Anti-Magic Zone'),

	// -------------------------------------------------------- healing received
	17: healing('Power Word: Shield'),
	774: healing('Rejuvenation'),
	6788: healing('Weakened Soul, the lockout Power Word: Shield leaves behind'),
	25771: healing('Forbearance, the lockout a Lay on Hands leaves behind'),
	41635: healing('Prayer of Mending'),
	44203: healing('Tranquility'),
	47753: healing("Divine Aegis, the absorb a priest's mastery adds to a heal"),
	48438: healing('Wild Growth'),
	51945: healing("Earthliving, the proc on a resto shaman's heal"),
	61295: healing('Riptide'),
	64844: healing('Divine Hymn'),
	77489: healing("Echo of Light, the trickle a priest's mastery adds to a heal"),
	81782: healing('Power Word: Barrier'),
	86273: healing("Illuminated Healing, the absorb a paladin's mastery adds to a heal"),
	105284: healing("Ancestral Vigor, the maximum-health buff a resto shaman's heals leave behind"),
	114163: healing('Eternal Flame'),
	114908: healing('Spirit Shell'),
	119523: healing("Healing Stream Totem, another shaman's"),
	119611: healing('Renewing Mist'),
	126154: healing('Lightwell Renew'),
	145441: healing("Yu'lon's Barrier, a healer's legendary cloak absorbing for them"),

	// ------------------------------------------------------------ the encounters
	144218: bossMechanic('Borer Drill', 'Iron Juggernaut'),
	144459: bossMechanic('Laser Burn', 'Iron Juggernaut'),
	144498: bossMechanic('Explosive Tar', 'Iron Juggernaut'),
	144918: bossMechanic('Cutter Laser', 'Iron Juggernaut'),
	143856: bossMechanic('Superheated', 'Siegecrafter Blackfuse'),
	144466: bossMechanic('Magnetic Crush', 'Siegecrafter Blackfuse'),
};

describe('every aura the log puts on the player is modelled or ledgered', () => {
	it('leaves no id unaccounted for on any committed pull', () => {
		expect(unmodelledAuraIds(sweeps, LEDGER)).toEqual([]);
	});

	/**
	 * Not vacuous, and the numbers are the fixtures' own.
	 *
	 * The failure this guards against is the sweep quietly reading nothing — a `targetID` that stopped
	 * matching, an `events` array that went missing on a re-capture — which would satisfy the assertion
	 * above by having no ids to fail on. Read off the committed streams: 42, 48, 53 and 53 distinct
	 * aura ids land on the player across the four pulls.
	 */
	it('really does sweep four pulls with dozens of ids each', () => {
		expect(sweeps.map((sweep) => sweep.ids.size)).toEqual([42, 48, 53, 53]);
	});

	/**
	 * And it counts every kind of evidence, which an apply-only sweep would not.
	 *
	 * The same blind spot both `drawnAuras.test.ts` files exist to record: 118291's only event on all
	 * three Elemental pulls is a bare `removebuff` when the pre-pulled Fire Elemental expires, and 324
	 * reaches the sweep through `applybuffstack` and nothing else. Narrowing this reading would drop
	 * ids from the sweep, so the ledger would still be satisfied and the guard would be blind — which
	 * is the shape of failure this whole file exists to catch.
	 */
	it('sees the ids whose only evidence is a removal or a stack change', () => {
		const phased = fixture('elemental', 'phased');
		expect(auraIdsPutOnPlayer(phased).get(118_291)).toBe(1);
		expect(auraIdsPutOnPlayer(phased, ['applied', 'refreshed', 'stacked']).has(118_291)).toBe(false);
		expect(auraIdsPutOnPlayer(phased).get(324)).toBe(86);
		expect(auraIdsPutOnPlayer(phased, ['applied', 'refreshed', 'removed']).has(324)).toBe(false);
	});

	it('keeps the ledger honest — nothing excused that no longer fires, nothing excused that is now modelled', () => {
		// A reason for an id that stopped appearing is a reason nobody will ever check again.
		expect(staleLedgerIds(LEDGER, sweeps)).toEqual([]);
		// And the other direction, which is the one that matters for the gap entries above: an entry
		// saying "nothing declares this yet" that outlives the declaration tells the next reader not to
		// look. It has fired for real once already — declaring 61316 Dalaran Brilliance in `raidBuffs.ts`
		// turned this red naming that id, and deleting its entry is what closed it, which is the handoff
		// working. When it fails naming 16246, the model gained that one and its entry is what to delete.
		expect(declaredLedgerIds(LEDGER, sweeps)).toEqual([]);
	});
});

describe('Skull Banner, the id this guard was written for', () => {
	/**
	 * **114206 and not 114207.** `sim/core/buffs.go:1118` is `var SkullBannerActionID = ActionID{SpellID:
	 * 114206}`, and `SkullBannerAura` at :1153 registers the buff under the same number; 114207 appears
	 * once in that repository, in `ui/core/components/inputs/buffs_debuffs.ts:108`, as the icon the buff
	 * picker draws. The log agrees with the sim: 114206 appears on all four committed pulls and 114207
	 * on none of them. Declaring the UI id is the exact mistake that produced the retired 144998 — a
	 * handle the game never writes, wired to five readers, silent through fifty-three green tests.
	 */
	it('is declared under the id the log writes, not the one the buff picker draws', () => {
		expect(elemental.aura('skull-banner').ids).toEqual([114_206]);
		expect(windwalker.aura('skull-banner').ids).toEqual([114_206]);
		expect(elemental.auraById(114_207)).toBeUndefined();
		for (const sweep of sweeps) expect(sweep.ids.has(114_207)).toBe(false);
	});

	/** Measured on the player, apply and remove in equal numbers on every pull. */
	it('fires on all four committed pulls', () => {
		expect(sweeps.map((sweep) => sweep.ids.get(114_206))).toEqual([8, 4, 8, 6]);
	});

	/**
	 * A crit-damage window, which is why it belongs in the shared model beside Bloodlust rather than in
	 * a spec: `SkullBannerAura`'s `OnGain` multiplies `PseudoStats.CritDamageMultiplier` by 1.2 and
	 * `OnExpire` divides it back (`sim/core/buffs.go:1153-1176`), and that is a multiplier on any
	 * class's damage. Ten seconds, on a three-minute cooldown — `SkullBannerDuration` and
	 * `SkullBannerCD` at :1121-1122.
	 */
	it('declares the ten seconds the simulator gives it', () => {
		expect(elemental.aura('skull-banner').durationMs).toBe(10_000);
		expect(elemental.aura('skull-banner').kind).toBe('buff');
	});
});
