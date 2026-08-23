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
// **Skull Banner is what that hole cost.** 114206 goes up on all five committed pulls — 4 applications
// on `phased`, 2 on `unbroken`, 4 on `cleave`, 6 on `addsThenBoss`, 3 on `dataset-ironJuggernaut`, apply
// and remove in equal numbers each time. It is a twenty-percent crit-*damage* window from another player's three-minute
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
	48504: healing("Living Seed, the stored heal a resto druid's crit leaves on its target"),
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
	 * above by having no ids to fail on. Read off the committed streams: 46, 49, 52, 57 and 57 distinct
	 * aura ids land on the player or on what the player was hitting, across the five pulls.
	 *
	 * Four of those were 42, 48, 53 and 53 before the sweep gained its enemy half, and the +4 on each is
	 * the measurement rather than a coincidence — see the pin below, which is the same fact split out so a
	 * regression names the half that broke. `addsThenBoss` arrived after the widening and its enemy half
	 * is **five** rather than four, which is the pin's own subject: two of its five are raid buffs the
	 * player's totems put on the encounter's friendly NPCs.
	 */
	it('really does sweep five pulls with dozens of ids each', () => {
		expect(byPull((sweep) => sweep.ids.size)).toEqual({
			'elemental/addsThenBoss.json': 49,
			'elemental/cleave.json': 57,
			'elemental/phased.json': 46,
			'elemental/unbroken.json': 52,
			'windwalker/dataset-ironJuggernaut.json': 57,
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

	/** Measured on the player, apply and remove in equal numbers on every pull. */
	it('fires on all five committed pulls', () => {
		expect(byPull((sweep) => sweep.ids.get(114_206))).toEqual({
			'elemental/addsThenBoss.json': 12,
			'elemental/cleave.json': 8,
			'elemental/phased.json': 8,
			'elemental/unbroken.json': 4,
			'windwalker/dataset-ironJuggernaut.json': 6,
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
