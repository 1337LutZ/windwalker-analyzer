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
// **And the sweep has two halves, of which one arrived late.** For most of this file's life it read the
// auras the log put *on* the player and nothing else, so an id the player wrote onto an **enemy** could
// not reach the ledger at all — the same hole, one level down, and `essence-of-yulon` (146198) is the id
// that proved it: 13, 18 and 16 applications across the three Elemental pulls, no lane, no entry, and
// no guard in the family able to say so. The enemy half is filtered by **source** as well as target, so
// what it adds is the player's own three ids rather than every raider's debuff on the boss; the
// measurement and the argument are on `SWEPT` and on `enemyAuraEvents`.
//
// **Skull Banner is what that hole cost.** 114206 goes up on all eight committed pulls — 4 applications
// on `phased`, 2 on `unbroken`, 4 on `cleave`, 6 on `addsThenBoss`, 3 on `dataset-ironJuggernaut`, 4 on
// `idle`, 4 on `sections` and 7 on `uncounted`, apply and remove in equal numbers on all but the last,
// where a banner was still up at the kill. It is a twenty-percent crit-*damage* window from another player's three-minute
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

import { describe, expect, it } from 'vitest';

import {
	auraIdsPutOnEnemies,
	auraIdsPutOnPlayer,
	declaredLedgerIds,
	mergeCounts,
	staleLedgerIds,
	unmodelledAuraIds,
	type IdSweep,
} from '~/lib/analysis/drawnAuras';
import { rawFixture, rawFixtures } from '~/lib/analysis/fixtures';
import { RAID_BUFF_NAMES } from '~/lib/analysis/raidBuffs';
import type { Registry } from '~/lib/game/registry';
import type { FightDataset } from '~/lib/types';
import { registry as elemental } from '~/specs/elemental/lib';
import { registry as windwalker } from '~/specs/windwalker/lib';

/**
 * Every pull in the repository that carries raw events, with the spec that analyses it.
 *
 * **Found rather than listed, and the listing was a hole in this guard family.** This was four literal
 * names, while `analysis/__tests__/fixtureCoverage.test.ts` walked the fixture directories — so a newly
 * committed pull was swept by that guard the moment it landed and by this one never. A guard that cannot
 * see a new pull is the same failure as a guard that draws nothing, and it is the failure this file
 * exists to catch one level down.
 *
 * The six pre-analysed Windwalker fixtures are still absent, and now by classification rather than by
 * omission: they have no `events` array at all — the capture harness writes `analyse()`'s output rather
 * than its input — so `rawFixtures` files them as captures and hands back none of them. `fixtures.ts`
 * throws on a `.json` that answers to neither shape, which is what keeps "no raw events" from arriving
 * here as an empty sweep.
 */
const SPEC_REGISTRIES: Array<[string, Registry]> = [
	['elemental', elemental],
	['windwalker', windwalker],
];

const PULLS: Array<[string, FightDataset, Registry]> = SPEC_REGISTRIES.flatMap(([spec, registry]) =>
	rawFixtures(spec).map(
		({ name, dataset }) => [`${spec}/${name}`, dataset, registry] as [string, FightDataset, Registry],
	),
);

/**
 * The raid-buff roster counts as declaring an id, and it is the one exemption that is not a ledger
 * entry.
 *
 * `analysis/raidBuffs.ts` models the buffs a player's *damage* rests on by effect rather than by spell
 * — `EFFECTS`, copied from the simulator's own exclusive-effect categories — and `readRaidBuffs`
 * measures every one of them on the player's own stream. So Battle Shout, Moonkin Aura and Legacy of
 * the White Tiger are modelled and drawn; they are simply modelled *there* rather than in a spec's
 * registry, because two providers of one effect are one row. Seventeen of the ids the four pulls this
 * was written against carry are covered by it, and writing seventeen ledger entries saying "see raidBuffs.ts" would be a
 * copy of `EFFECTS` that could drift from it. Read through `RAID_BUFF_NAMES`, which is `EFFECTS`'
 * own second reading and not a second list.
 */
const modelled = (registry: Registry, id: number): boolean =>
	registry.auraById(id) !== undefined || RAID_BUFF_NAMES.has(id);

/**
 * Both halves of the stream, added — the auras the log put **on** the player and the auras the player
 * put **on an enemy**.
 *
 * **The second half was unreachable, not merely unswept.** `auraIdsPutOnPlayer` scopes to
 * `targetID === actor.id`, so an id the player writes onto a boss could not appear here however many
 * pulls carried it, and the third failure mode had the same hole the drawn-aura guards did: an aura
 * accounted for nowhere, passing every check in the repository. `essence-of-yulon` (146198) was the one
 * that proved it — 13, 18 and 16 applications on the three Elemental pulls with no lane and no entry —
 * and it reached this ledger by no route at all until the sweep gained its other half.
 *
 * **Measured before it was widened, because a ledger nobody can maintain is worse than a hole.** The
 * enemy half is filtered by source as well as by target (`enemyAuraEvents` argues that), and what it
 * costs is three ids across the whole repository: 115798 on all three Elemental pulls, 115804 and 124280
 * on the Windwalker's. A *target-only* reading is the version that would not have been worth writing —
 * every other raider's debuff on the boss and every boss mechanic on every add, classified by hand.
 */
const SWEPT: Array<{ key: string; sweep: IdSweep }> = PULLS.map(([key, dataset, registry]) => ({
	key,
	sweep: {
		ids: mergeCounts(auraIdsPutOnPlayer(dataset), auraIdsPutOnEnemies(dataset)),
		declares: (id) => modelled(registry, id),
	},
}));

const sweeps: IdSweep[] = SWEPT.map((entry) => entry.sweep);

/**
 * One reading per pull, keyed by pull.
 *
 * Keyed and not positional, because discovery decides the order and a pinned array would then be read
 * against whichever pull happened to sort into that slot. A new fixture arrives as a named extra key
 * rather than as a length mismatch, which is the difference between a failure that says what to write
 * down and one that says a number moved.
 */
const byPull = <T>(read: (sweep: IdSweep) => T): Record<string, T> =>
	Object.fromEntries(SWEPT.map(({ key, sweep }) => [key, read(sweep)]));

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

	// -------------------------------------------------------- the player's own
	// Off-rotation presses and passives. All are named in the Elemental's `EXTRA_NAMES` where they are
	// casts, so the press is labelled; what is not modelled is the buff window, and none of these
	// windows says anything about the rotation.
	546: "Water Walking: the player's own out-of-combat convenience, a ten-minute buff that does nothing in a fight.",
	2645: "Ghost Wolf: the player's own travel form. Off-rotation, and named as a press in EXTRA_NAMES.",
	30823:
		"Shamanistic Rage: the player's own off-GCD mana-and-mitigation press. Named in EXTRA_NAMES and priced at 0 in EXTRA_GLOBALS — one of the three presses on that list genuinely off the global, with Bloodlust and Totemic Projection. This line used to call it the only one; StartRecoveryTime says three.",
	54861:
		'Nitro Boosts: the engineering boot tinker — +150% run speed for 5s (aura 171, DBC), no stat and no damage. The glove tinker is declared because it grants a stat; this one has nothing to draw.',
	// The food buff. A flat +300 to one primary stat for an hour (aura 29, DBC), so it is part of the
	// stat baseline the whole pull is measured on rather than an event in it — two ids because two
	// players ate differently: 104275 grants Agility, 104277 Intellect.
	104275:
		'Well Fed (Agility): the food buff, +300 to a primary stat for an hour. A stat baseline, not an event on the timeline.',
	104277:
		'Well Fed (Intellect): the food buff, +300 to a primary stat for an hour. A stat baseline, not an event on the timeline.',
	// The flask and the elixir, which are the same class of thing as the food buff above and are filed
	// the same way: a stat the player carried for the whole pull, part of the baseline every figure in
	// the report is measured on rather than a window inside it. Four, four and five apply/remove pairs
	// across the three Windwalker pulls, because a monk who dies re-drinks. What would make either of
	// them a gap is a section that graded *whether* they were up, and there is none — `potions.ts` grades
	// the one consumable with a press worth timing, and neither of these has a timing.
	105684:
		'Elixir of the Rapids: the haste elixir (DBC aura 189, rating mask 0xE0000). A stat baseline, not an event on the timeline, and nothing here grades whether one was drunk.',
	105689:
		'Flask of Spring Blossoms: the agility flask (DBC aura 29, stat 1). A stat baseline, not an event on the timeline, and nothing here grades whether one was drunk.',
	// The Monk's own defensive and utility windows, all four named as presses in the Windwalker's
	// `EXTRA_NAMES` and none of them modelled — that table argues each one, off `StartRecoveryTime` and
	// off the fact that not one produces a `damage` event on any committed pull. What is unmodelled is the
	// buff window, and the same argument disposes of it: a heal, a taunt, a movement blink and an
	// engineering toy have nothing a damage audit can coach.
	115176:
		"Zen Meditation: the player's own damage-reduction channel. Named as a press in the Windwalker's EXTRA_NAMES and off the global (StartRecoveryTime 0); the eight apply/remove pairs off one cast are the raid members and puddles it covered, not eight presses.",
	116841:
		"Tiger's Lust: the player's own movement cooldown, which also clears a root. Named as a press in the Windwalker's EXTRA_NAMES; the window says where the monk went and nothing about what the rotation wanted.",
	126389:
		'Goblin Glider: the engineering cloak toy, a fall-speed buff. One press on one pull, off the global, no damage and no stat — there is nothing for a lane to draw.',
	// The Monk melee passive, and the busiest undeclared id in the whole set — 150 events on
	// `sections.json` alone, almost all of them `refreshbuff` as the pack around the monk changes size.
	// +5% parry per nearby attacker to a ceiling of three (DBC aura 47, base 5, `CumulativeAura` 3).
	// Purely defensive, and the thing a reader would actually want out of it — how many enemies were in
	// melee range — is drawn already, as the target-count series.
	116033:
		'Sparring: the Monk passive granting +5% parry per nearby melee attacker, stacking to three (DBC aura 47). Defensive, and the enemy count it keys off is already drawn as the target-count series.',
	// The execute-window marker, and it is the one entry in this group with a real claim to being a gap —
	// which is why it says so rather than being waved through. It goes up when a target the monk is on
	// drops below 10% health, which is exactly the condition `touch-of-death` is declared `conditional`
	// for: the ability's own note says availability is a health threshold rather than a cooldown, so
	// drift against it would be fiction. This aura is the log's own record of when that threshold was
	// met, so a "how many of the offered executes were taken" figure could be built on it. Nothing builds
	// one, and until something does there is no lane for it to be missing from.
	121125:
		'Death Note: the marker that goes up when a target is inside the Touch of Death execute window. Not a gap in the aura model — the press is declared as `touch-of-death` with `gate: conditional`, and nothing in the report yet asks how many offered executes were taken. The id to reach for if something does.',
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
	48504: healing("Living Seed, the stored heal a resto druid's crit leaves on its target"),
	51945: healing("Earthliving, the proc on a resto shaman's heal"),
	61295: healing('Riptide'),
	// Sourced by another player on `idle.json`, which is the half of the classification that decides it:
	// a discipline priest's mastery leaves this on whoever they healed, and it is the *healer's* aura on
	// this monk rather than anything the monk did.
	77613: healing("Grace, the stacking healing-received buff a discipline priest's heals leave on their target"),
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

	// ------------------------------------ the player's own, put on the enemy
	// The class the sweep could not reach until it gained its enemy half. Two of the three are the
	// expansion's shared raid debuffs, which the player happens to be a provider of; the third is the
	// damage half of a press this spec already models.
	//
	// Weakened Blows is applied by this shaman's Earth Shock, exactly and only: 12, 13 and 12
	// applications against 12, 13 and 12 Earth Shocks on `phased`, `unbroken` and `cleave`, every one of
	// them inside 300ms of the press. The windows the log gives it run from 1ms to 9 936ms, far short of
	// its 30s, because a shared debuff belongs to whoever applied it last and the raid's other providers
	// keep taking it over — which is the plainest possible statement that this is not the player's aura
	// to draw.
	115798:
		"Weakened Blows: the raid's shared -10% physical-damage-dealt debuff, applied here by the player's own Earth Shock. It changes what the raid's melee take and nothing about this caster's damage; the model declares no raid debuff, and the log's own windows show the raid's other providers overwriting it seconds later.",
	// Applied by Rising Sun Kick — every one of the 18 applications lands 1-2ms after a 107428 cast. The
	// press is modelled and so is the debuff that grades it (`rising-sun-kick-debuff`, 130320); this is
	// the other, healing-side debuff the same kick carries.
	115804:
		"Mortal Wounds: the raid's shared -25% healing-received debuff, applied here by the player's own Rising Sun Kick. A healing debuff in a damage audit — the kick's own damage-taken debuff is declared as `rising-sun-kick-debuff` and drawn, and this is the half nothing here measures.",
	// Modelled, as damage rather than as an aura: `specs/windwalker/lib/index.ts:627` declares
	// `damageIds: [124280]` on the press, and `karma.test.ts` reads the row off the damage table under
	// that id. The window a reader wants is the absorb on the player, which is `touch-of-karma` (122470),
	// declared and drawn.
	124280:
		"Touch of Karma: the redirected-damage half of the press, on the enemy. Modelled as damage (`specs/windwalker/lib/index.ts:627` declares `damageIds: [124280]`) and drawn as the `touch-of-karma` lane off the absorb's own id 122470 — an aura row here would restate that row under a second number.",
	// **The four the three new Windwalker pulls added to this class, and they are all crowd control or a
	// second reading of something modelled.** `dataset-ironJuggernaut.json` is one enemy that never needs
	// interrupting, taunting or stunning, so the whole class was invisible until a pull with adds arrived.
	//
	// 123586 is the shape to check first, because it is the one that could have been a gap: the id is
	// already declared as `flying-serpent-kick`'s `damageIds`, and on `idle.json` and `sections.json` its
	// only events *are* damage. `uncounted.json` is the pull where the same id also arrives as a debuff —
	// two apply/remove pairs on `Living Corruption` and Malkorok — which is the kick's snare rather than a
	// second damage source. Modelled as damage, drawn from there, and an aura row would restate it.
	116189:
		"Provoke: the taunt debuff, applied by the player's own Provoke (115546, named in the Windwalker's EXTRA_NAMES). Five presses, five applications, every one on a Living Corruption — a Windwalker pulling adds off the raid, which is a thing to notice about the pull and not a rotation figure the model can grade.",
	116709:
		"Spear Hand Strike: the silence the interrupt leaves on its target. Both the interrupt's ids are named as presses in the Windwalker's EXTRA_NAMES (116705 and 116709); nothing here counts interrupts, and a lane for a 2s lockout on an add would say less than the press already does.",
	120086:
		"Fists of Fury: the stun the channel puts on everything it hits. The channel is modelled — `castIds: [113656]` with a `channel`, damage under 117418 — and its self-aura is ledgered under 113656 above. Every one of the 78 `damage` events under this id across the three pulls lands for **zero**, immune or missed, because it is the stun's application and not a second damage source.",
	123586:
		'Flying Serpent Kick: the snare the kick leaves on what it passed through. Modelled as damage — `specs/windwalker/lib/index.ts` declares `damageIds: [123586]` on `flying-serpent-kick` — and the button is `utility: true` there because nobody presses it for the numbers, so there is nothing an aura row could add.',

	// ------------------------------------------------------------ the encounters
	144218: bossMechanic('Borer Drill', 'Iron Juggernaut'),
	144459: bossMechanic('Laser Burn', 'Iron Juggernaut'),
	144498: bossMechanic('Explosive Tar', 'Iron Juggernaut'),
	144918: bossMechanic('Cutter Laser', 'Iron Juggernaut'),
	143856: bossMechanic('Superheated', 'Siegecrafter Blackfuse'),
	144466: bossMechanic('Magnetic Crush', 'Siegecrafter Blackfuse'),
	// The two `addsThenBoss.json` brought, and the first encounter this ledger has seen that has an add
	// phase: both come off the tower assault rather than off Galakras herself. 147029 is the Flameslinger
	// pool the player stood in; 147705 is the Dragonmaw Tidal Shaman's cloud.
	147029: bossMechanic('Flames of Galakrond', 'Galakras'),
	147705: bossMechanic('Poison Cloud', 'Galakras'),
	// **Two encounters this ledger had never seen, and the ninth id is a third's.** Immerseus and
	// Malkorok arrive with `idle.json` and `uncounted.json`; `sections.json` is Galakras again and adds
	// only the archers' volley, which is the shape to expect from a second pull on a known boss.
	//
	// Immerseus is five ids because the fight is two halves and the player takes something in both.
	// 143297 and 143459 come off the `Environment` actor, 143460 and 143579 off Immerseus himself. The
	// one worth reading is 143524: it arrives as a debuff *and* as two `resourcechange` events restoring
	// 9464 mana each, both of which the log stamps `waste: 9464` — an energy user being handed a mana
	// return. Filed as the encounter's own like the rest, because a boss handing out a resource this
	// class does not have is still the boss's business and not the model's.
	143297: bossMechanic('Sha Splash', 'Immerseus'),
	143459: bossMechanic('Sha Residue', 'Immerseus'),
	143460: bossMechanic('Sha Pool', 'Immerseus'),
	143524: bossMechanic('Purified Residue', 'Immerseus'),
	143579: bossMechanic('Sha Corruption', 'Immerseus'),
	// Malkorok's three. 143919 is sourced by a `Living Corruption` rather than by Malkorok — 18
	// applications from the adds this pull was fetched for — and it is filed under the encounter all the
	// same: an add is the encounter's. 142861 is the healing-absorb field, and it is the busiest single
	// id on that pull with 164 `healabsorbed` events against two applications.
	142861: bossMechanic('Ancient Miasma', 'Malkorok'),
	142913: bossMechanic('Displaced Energy', 'Malkorok'),
	143919: bossMechanic('Languish', 'Malkorok'),
	146765: bossMechanic('Flame Arrows', 'Galakras'),
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
	 * above by having no ids to fail on. Read off the committed streams: 46 to 62 distinct aura ids land
	 * on the player or on what the player was hitting, across the eight pulls.
	 *
	 * Four of those were 42, 48, 53 and 53 before the sweep gained its enemy half, and the +4 on each is
	 * the measurement rather than a coincidence — see the pin below, which is the same fact split out so a
	 * regression names the half that broke. `addsThenBoss` arrived after the widening and its enemy half
	 * is **five** rather than four, which is the pin's own subject: two of its five are raid buffs the
	 * player's totems put on the encounter's friendly NPCs.
	 *
	 * The three Windwalker pulls span the range on their own — `idle` 62, `sections` 50, `uncounted` 46 —
	 * and the order is not the one the fixture names suggest. `sections.json` is the longest pull in the
	 * tree at 437s and reads *fewer* ids than the 255s Immerseus one, because a count of distinct ids is
	 * a count of how many different things touched the player and not of how long they were touched: 150
	 * of `sections`' aura events are one id, `Sparring` refreshing as the pack around the monk changes.
	 */
	it('really does sweep eight pulls with dozens of ids each', () => {
		expect(byPull((sweep) => sweep.ids.size)).toEqual({
			'elemental/addsThenBoss.json': 49,
			'elemental/cleave.json': 57,
			'elemental/phased.json': 46,
			'elemental/unbroken.json': 52,
			'windwalker/dataset-ironJuggernaut.json': 57,
			'windwalker/idle.json': 62,
			'windwalker/sections.json': 50,
			'windwalker/uncounted.json': 46,
		});
	});

	/**
	 * And the enemy half is not empty on any pull, pinned as ids rather than as a count.
	 *
	 * **The specific trap.** The assertion above adds the two halves, so the enemy half could go to zero
	 * — a target filter that stopped matching, `actors` losing its `type` field and taking every target
	 * into the friendly set — and the total would fall by four, which reads as a fixture change rather
	 * than as a blind guard. The whole class was invisible for exactly this shape of reason once already.
	 *
	 * Named ids and not sizes, because the *identity* is the finding: 8050 Flame Shock, 144999 Elemental
	 * Discharge and 146198 Essence of Yu'lon are declared, 115798 Weakened Blows is ledgered, and on the
	 * Windwalker's pull 122470/128531/130320 are declared against 115804 and 124280 ledgered. 118297 is
	 * *not* here on `cleave` and that is the source filter working: the Fire Elemental's Immolate is the
	 * pet's press, not the player's.
	 *
	 * 144999 is *not* on `addsThenBoss` and that is gear rather than a filter: the T16 two-piece writes
	 * that debuff, and this shaman is in Throne of Thunder kit with no Siege tier at all.
	 */
	it('really does read an enemy half on every pull, and only what the player sourced', () => {
		expect(
			Object.fromEntries(
				PULLS.map(([key, dataset]) => [key, [...auraIdsPutOnEnemies(dataset).keys()].sort((a, b) => a - b)]),
			),
		).toEqual({
			// **Five, and two of them are raid buffs.** 51470 Elemental Oath and 77747 Burning Wrath are this
			// shaman's own totem buffs, landing on the Alliance Vanguard, the Demolitions Expert and the
			// Demolitions Assistant — Galakras' *friendly* NPCs, 92 and 2 applications of them. That is
			// `enemyAuraEvents` behaving exactly as its docstring says it will: it excludes what the log
			// positively declares friendly, which is players and their pets, so an allied NPC is "not known
			// to be friendly" and lands here. The reading is deliberate and stays — requiring proof of
			// enemyhood would empty the half on any report with a short actor list, which is the blindness
			// this family exists to catch — but this is the first pull to show what it costs, and it is the
			// reason the name of the half is wider than the word "enemies". Both ids are declared, so
			// nothing new is unaccounted for; what a future reader should not do is add a hostility filter
			// on the strength of these two rows, because WCL's `masterData.actors` carries no hostility
			// field for an NPC to be filtered on.
			'elemental/addsThenBoss.json': [8050, 51_470, 77_747, 115_798, 146_198],
			'elemental/cleave.json': [8050, 115_798, 144_999, 146_198],
			'elemental/phased.json': [8050, 115_798, 144_999, 146_198],
			'elemental/unbroken.json': [8050, 115_798, 144_999, 146_198],
			'windwalker/dataset-ironJuggernaut.json': [115_804, 122_470, 124_280, 128_531, 130_320],
			// **The Windwalker's enemy half was five ids of a one-enemy pull, and this is what it looks like on
			// pulls with adds.** Everything the monk had ever put on an enemy was a debuff its own press
			// applies to whatever it was already hitting; a fight with things to interrupt, taunt and stun adds
			// the crowd control, and all four of those ids are new to the ledger — 116189 Provoke, 116709 Spear
			// Hand Strike, 120086 Fists of Fury's stun and 123586 Flying Serpent Kick's snare.
			//
			// Two rows here are the friendly-NPC reading again, and this is the second encounter to show it —
			// which is what turns the paragraph above from a story about Galakras into a property of the half.
			// 115176 on `idle` is Zen Meditation covering a *Contaminated Puddle*, and 116781/117666 on
			// `sections` are the monk's own Legacy raid buffs landing on the Dragonmaw Tidal Shamans' allies.
			// All three are declared or raid-buff ids, so nothing is unaccounted for; the point is that
			// "not known to be friendly" keeps meaning what its docstring says.
			//
			// `uncounted` is the short row at five and it is not a smaller pull: it is the one whose monk
			// pressed no Fists of Fury stun that stuck and no Touch of Karma at all, so what is left is the two
			// modelled debuffs, Mortal Wounds, and the two ids Provoke and the kick added.
			'windwalker/idle.json': [115_176, 115_804, 120_086, 122_470, 124_280, 128_531, 130_320],
			'windwalker/sections.json': [115_804, 116_709, 116_781, 117_666, 120_086, 122_470, 124_280, 128_531, 130_320],
			'windwalker/uncounted.json': [115_804, 116_189, 123_586, 128_531, 130_320],
		});
	});

	/**
	 * **A guard that sweeps nothing passes, so this plants one and checks it is caught.**
	 *
	 * The three ids the widening actually found are all accounted for now, which means every assertion
	 * above would stay green if `enemyAuraEvents` silently stopped reading. Planting an id no registry
	 * declares onto an enemy is the only way to show the mechanism rather than its current answer, and it
	 * is done on a shallow copy so no fixture is touched.
	 *
	 * Two directions, because either alone is satisfiable by accident: the planted id is reported against
	 * the real ledger, and a ledger entry for it silences that report. The `sourceID` is the audited
	 * player's, which is the filter being exercised — the companion below plants the same id from somebody
	 * else and shows it is *not* picked up.
	 */
	it('catches an undeclared debuff the player puts on an enemy', () => {
		const dataset = rawFixture('elemental', 'phased.json');
		// A real application of the spec's own dot, which is a known-good "player onto an enemy" event — so
		// each copy below differs from a swept event in the ability id alone, and in the second case the source.
		const onEnemy = dataset.events.find(
			(e) => e.type === 'applydebuff' && e.abilityGameID === 8050 && e.sourceID === dataset.actor.id,
		);
		if (onEnemy === undefined) throw new Error('phased.json no longer applies 8050 to anything');
		const raidmate = dataset.actors.find((a) => a.type === 'Player' && a.id !== dataset.actor.id);
		if (raidmate === undefined) throw new Error('phased.json has no second player to source from');
		const planted: FightDataset = {
			...dataset,
			events: [
				...dataset.events,
				{ ...onEnemy, abilityGameID: 999_001 },
				{ ...onEnemy, abilityGameID: 999_002, sourceID: raidmate.id },
			],
		};
		const sweep: IdSweep = {
			ids: mergeCounts(auraIdsPutOnPlayer(planted), auraIdsPutOnEnemies(planted)),
			declares: (id) => modelled(elemental, id),
		};
		expect(unmodelledAuraIds([sweep], LEDGER)).toEqual([999_001]);
		expect(unmodelledAuraIds([sweep], { ...LEDGER, 999_001: 'planted' })).toEqual([]);
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
		const phased = rawFixture('elemental', 'phased.json');
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
		// look. It has now fired for real twice, which is the handoff working rather than a theory about it:
		// declaring 61316 Dalaran Brilliance in `raidBuffs.ts` turned this red naming that id, and
		// declaring 16246 Clearcasting in the Elemental's model turned it red naming that one. Each time,
		// deleting the entry is what closed it. The remaining gap entries are live in the same way — when
		// this fails naming one of them, the model gained it and its entry is what to delete.
		expect(declaredLedgerIds(LEDGER, sweeps)).toEqual([]);
	});
});

describe('Skull Banner, the id this guard was written for', () => {
	/**
	 * **114206 and not 114207.** `sim/core/buffs.go:1118` is `var SkullBannerActionID = ActionID{SpellID:
	 * 114206}`, and `SkullBannerAura` at :1153 registers the buff under the same number; 114207 appears
	 * once in that repository, in `ui/core/components/inputs/buffs_debuffs.ts:108`, as the icon the buff
	 * picker draws. The log agrees with the sim: 114206 appears on all five committed pulls and 114207
	 * on none of them. Declaring the UI id is the exact mistake that produced the retired 144998 — a
	 * handle the game never writes, wired to five readers, silent through fifty-three green tests.
	 */
	it('is declared under the id the log writes, not the one the buff picker draws', () => {
		expect(elemental.aura('skull-banner').ids).toEqual([114_206]);
		expect(windwalker.aura('skull-banner').ids).toEqual([114_206]);
		expect(elemental.auraById(114_207)).toBeUndefined();
		for (const sweep of sweeps) expect(sweep.ids.has(114_207)).toBe(false);
	});

	/**
	 * Measured on the player, apply and remove in equal numbers on every pull.
	 *
	 * Eight pulls now. The three that arrived read 8, 8 and 13, and `uncounted`'s **13 is odd**, which is
	 * the first time that has happened and is worth reading rather than rounding: the last of its seven
	 * applications lands at 201 682 ms and is never removed, because the boss died 9.6s later and inside
	 * the window. So this is a pin on the *sweep* rather than on the fixtures — it counts every kind of
	 * evidence, and an unclosed window is exactly the case `drawnAuras.ts`' "evidence, not application"
	 * argument exists for, one banner short of the pre-pull `removebuff` it was originally written about.
	 */
	it('fires on all eight committed pulls', () => {
		expect(byPull((sweep) => sweep.ids.get(114_206))).toEqual({
			'elemental/addsThenBoss.json': 12,
			'elemental/cleave.json': 8,
			'elemental/phased.json': 8,
			'elemental/unbroken.json': 4,
			'windwalker/dataset-ironJuggernaut.json': 6,
			'windwalker/idle.json': 8,
			'windwalker/sections.json': 8,
			'windwalker/uncounted.json': 13,
		});
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
