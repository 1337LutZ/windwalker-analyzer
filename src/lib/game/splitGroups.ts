import { engagedWindows } from '~/lib/analysis/engagement';
import { type Interval, unionMs } from '~/lib/analysis/intervals';
import { isDamage, type WclEvent } from '~/lib/events';

import { baseEncounterID } from './rankingExclusions';

// Pulls where the raid split up, and the player being read was not on the main group.
//
// Every other figure in this report describes one player against one pull, and takes for granted that
// the pull the encounter is and the pull *they* fought are the same thing. On three Siege bosses they
// are routinely not. The raid divides, one part walks away from the boss, and the half of the fight
// that half of the raid had is a different fight — different targets, different counts, long stretches
// of nothing to hit. Nothing downstream is wrong about that pull; it is measured correctly and it is
// describing an encounter the reader did not have.
//
// **So this names the split and never corrects for it.** No clock is moved, no damage is struck, no
// count is adjusted. The report says what it detected, once, above the grades, and the reader takes it
// from there. Correcting would mean inventing the pull they would have had on the main group, which is
// not in the log.
//
// ------------------------------------------------------------------------ what each of the three is
//
//   - **Galakras** sends squads up the two towers while the rest hold the gate against add waves. Up
//     there it is a short climb and one captain; down below it is a wave every ninety seconds.
//   - **Kor'kron Dark Shaman** can be fought with Haromm and Kardris pulled apart, a group on each.
//     For anyone in one of those groups the pull is single-target from the first global.
//   - **Siegecrafter Blackfuse** puts a team on the conveyor belt, killing the weapons before they
//     deploy. They barely touch the boss, and most of their pull is spent waiting for the next one.
//
// ------------------------------------------------------- the two shapes a rule can take
//
// Two, because the evidence is two different things. The tower and the belt each have **enemies only
// the away group can reach**, so the rule is a set of game ids and the question is whether this player
// hit any of them. The Dark Shaman split has no such enemy — both groups fight a boss — so the rule is
// about **how the player's damage divided between the two**.
//
// ------------------------------------------------------- what the geometry says, and why it is here
//
// The rules below are game ids and nothing else. The coordinates are what established that the ids are
// sound, measured on `a:6MhZgjyAknFWrYfK` fight 10 and `a:kgt1BMqf3QrybpJR` fight 12 through the `x`,
// `y` pairs `analysis/replay.ts` reads off the same stream, at 100 units to the yard:
//
//   - The Galakras courtyard is a tight blob around (4836, 1413). The monk who fought Lieutenant
//     Krugruk stood at (4853, 1362) to do it and went to (4803, 1459) for Master Cannoneer Dagryn —
//     54 and 57 yards out, up a tower, through a door. Nobody cleaves that by accident.
//   - **Korgra the Snake and High Enforcer Thranok sound like tower bosses and are not.** Both were
//     killed from inside the courtyard blob, by a player whose track never leaves y 1404–1421 for the
//     whole pull. They are wave leaders. A tower rule built on the four named elites instead of the
//     two real captains would fire on most of the raid, which is the trap this paragraph is for.
//   - On the split Dark Shaman pull the two bosses are simply in different places: Kardris at
//     (4383, 1592) while Haromm is at (4410, 1692), a hundred yards apart and staying there.
//
// **None of that geometry is read at runtime**, deliberately. A distance between two coordinates knows
// nothing about the wall between them — `replay.ts` states that rule where the scale is defined — so it
// is evidence for the ids and never a test.

/** Which split this is. Encounter-specific names, because the rules are encounter-specific. */
export type SplitGroupKind = 'towerRuns' | 'belt' | 'splitPair';

/**
 * Enemies only the away group can reach, by encounter and game id.
 *
 * Written as base ids and matched through `baseEncounterID`, for the reason `multiTargetActors.ts`
 * records beside its own list: a rule written `51601` is strict-equal against the Classic registration
 * and silently matches nothing on a retail or re-released report.
 */
const AWAY_SETS = [
	{
		kind: 'towerRuns',
		/** Galakras. */
		encounterID: 1622,
		/**
		 * The two tower captains, one per tower — and only those two.
		 *
		 * `72353` Dragonmaw Flameslinger was the obvious third and is deliberately absent. It is a tower
		 * add, but it shoots down into the courtyard and ranged answer it from there: on
		 * `a:6MhZgjyAknFWrYfK` fight 10 the same monk hits Flameslingers at 1:01, long before their first
		 * tower run at 2:30. An id that fires from both sides of the door is not evidence about which side
		 * the player was on.
		 */
		gameIDs: [
			72357, // Lieutenant Krugruk
			72356, // Master Cannoneer Dagryn
		],
	},
	{
		kind: 'belt',
		/** Siegecrafter Blackfuse. */
		encounterID: 1601,
		/**
		 * The weapons riding the conveyor, before Blackfuse deploys them.
		 *
		 * The `Activated` and `Overcharged` forms of the same weapons are **not** here: those are the ones
		 * that made it onto the platform, and killing them is the main group's job. The prefix is the whole
		 * distinction, and it is the difference between the belt team and everybody else.
		 */
		gameIDs: [
			71606, // Deactivated Missile Turret
			71751, // Deactivated Laser Turret
			71694, // Deactivated Electromagnet
			71790, // Disassembled Crawler Mines
		],
	},
] as const;

/**
 * Encounters fought as two bosses, and the pair.
 *
 * One entry, and the shape earns itself on the second: Fallen Protectors is three and Paragons is nine,
 * and neither is a split in this sense — the raid moves through them together. A pair is the case where
 * *both halves of the raid are on a boss* and neither half can see the other's.
 */
const BOSS_PAIRS = [
	{
		kind: 'splitPair',
		/** Kor'kron Dark Shaman. */
		encounterID: 1606,
		gameIDs: [
			71859, // Earthbreaker Haromm
			71858, // Wavebinder Kardris
		],
	},
] as const;

/**
 * How much of the player's damage has to land on the away set before the pull is called one.
 *
 * **0.10, sitting in an 83-point empty band.** Measured over the Windwalker in the committed anonymous
 * reports, belt duty is not a matter of degree — a monk is on the belt or is not:
 *
 * ```
 *   a:6MhZgjyAknFWrYfK  f38  100.0%   f39  100.0%   f40    0.0%
 *   a:YBQzrcgVJnAj7NMP  f38   83.0%   f39  100.0%   f40  100.0%   f41  100.0%
 *   a:kgt1BMqf3QrybpJR  f38    0.0%   f39    0.0%
 *   a:XkDQJHaztfnCd9Yj  f41    0.0%   f42    0.0%
 * ```
 *
 * Every pull is 0, or 83 and up. The same monk appears on both sides of the gap — `a:6MhZ`'s went to the
 * belt for two wipes and to the boss for the kill — which is the point: this is a fact about the pull and
 * never about the player.
 *
 * A threshold rather than mere presence, because presence is one stray hit.
 */
export const AWAY_SHARE = 0.1;

/**
 * How long the away set has to be held, across the whole pull, before an excursion is claimed.
 *
 * **5 000 ms.** Three real Galakras runs are committed and they are 11.4s, 18.3s and 25.4s — the short
 * one is the Protection Paladin of `protection/galakras.json`, who went up for Master Cannoneer Dagryn
 * at 4:40 and was back down by 4:51. Every player who stayed in the courtyard lands no hit at all on
 * either captain, so the floor only has to sit under the shortest real climb and over a stray tag.
 *
 * **The stray tag is a measured thing and not a hypothetical.** That same Paladin puts *one* hit into
 * Lieutenant Krugruk at 2:16, four minutes from their only run and two and a half from the other tower.
 * It is the reason a single-hit window is dropped before any of this is asked: counting it would have
 * reported two tower runs to a player who made one, and the copy leads with that count.
 *
 * The towers take this gate and not `AWAY_SHARE`, because a run is twenty seconds of a seven-minute pull
 * and the captains are barely 1% of the damage in it. The run still happened, and what proves it is that
 * the player was up there at all. The belt is the other way round — a belt team's pull *is* the belt — so
 * it takes the share and this would tell it nothing.
 */
export const AWAY_RUN_MS = 5000;

/**
 * How lopsided the two bosses have to be before the pull reads as split.
 *
 * **0.90, in a band 32 points wide.** Ten Windwalkers were measured through the app's own fetch, and the
 * two populations do not touch. Seven who cleaved both bosses hold **50.3 to 62.0%** on the one they
 * favoured — a cleave leans, and that is all it does. Three whose group had a boss to itself hold **94.0,
 * 95.9 and 99.0%**. A split pull does not lean, it lands.
 *
 * **A lopsided raid does not make a lopsided player, which is what the ten samples are really for.** Two
 * of the seven were on pulls where most of the raid was split — nineteen of twenty-three lopsided on one
 * of them — and those two monks still came out at 61.2% and 55.1%, because they cleaved the pair while
 * everybody around them held one. The rule is about the player it is reading and nothing else, and a
 * threshold set from raid-wide shapes would have called both of them split.
 *
 * Across a raid the shape is bimodal and unmistakable — one such pull divides its twenty-three damage
 * dealers into twelve at 0–17% and eleven at 93–99%, with nobody in between — while a stacked pull piles
 * them all on 40–60%.
 *
 * **What this cannot tell apart, and does not claim to.** A player who stayed on one boss all pull while
 * the raid cleaved both is indistinguishable from one whose group had a boss to itself, because a single
 * player's stream holds no evidence about where the *other* boss was. Both readings mean the same thing
 * for the grade — this was a single-target pull for them — so the copy says what was measured and lets
 * the reader supply which of the two it was.
 */
export const PAIR_SHARE = 0.9;

/**
 * How long a gap in the away set's damage ends one run and starts the next.
 *
 * `engagedWindows`' own default, and the same 15 000 the contact clock breaks on. The two Galakras tower
 * runs are two and a half minutes apart and the four belt trips on `a:6MhZgjyAknFWrYfK` fight 39 are 30s
 * to 65s apart, so nothing measured is near the line; the value is inherited rather than chosen because a
 * second opinion about when contact breaks is the thing worth not having.
 */
const RUN_GAP_MS = 15_000;

/** What the report found, and the evidence it found it on. */
export interface SplitGroup {
	kind: SplitGroupKind;
	/**
	 * For `towerRuns` and `belt`, the share of the player's damage that landed on the away set. For
	 * `splitPair`, the share of their damage to the two bosses that went to the one they held.
	 */
	share: number;
	/**
	 * The stretches the away set was being hit in, fight-relative and in time order.
	 *
	 * Never empty for those two, and never zero-length: a lone hit is a tag rather than a trip and is
	 * dropped before the finding is made at all.
	 *
	 * Empty for `splitPair`, which is a whole-pull fact rather than an excursion. For the other two it is
	 * the excursion itself, and the count of them is what the copy leads with — "two tower runs" is the
	 * shape of that pull in three words.
	 */
	windows: Interval[];
	/** `windows` totalled. Zero for `splitPair`. */
	awayMs: number;
	/**
	 * The boss the player held, for `splitPair`. Null for the other two, which have no one enemy to name.
	 *
	 * Resolved through the caller's own actor names rather than from the table above, so the report says
	 * what the log calls it — `enemyNPCs` carries ids and no name at all.
	 */
	name: string | null;
}

/** Everything the rules read. An object rather than six positions, following `conditionalExclusions`. */
export interface SplitGroupInput {
	encounterID: number | undefined;
	/**
	 * The fight's enemies, as `reportFights.graphql` returns them.
	 *
	 * **An entry missing its `gameID` is not on this list at all** — `normaliseFight` drops it, which
	 * `rankingExclusions.ts` records beside its own resolver. So a body the log knows and the fight list
	 * does not is invisible to every rule here. Measured on the two committed belt pulls, what falls
	 * through that hole is a handful of nil-damage hits on turret ids the list has no `gameID` for, so no
	 * share here moves; it is written down because the hole is real and the next rule may sit over it.
	 */
	enemyNPCs: readonly { id: number; gameID?: number | null }[] | undefined;
	/** The player's own stream, as fetched. */
	events: readonly WclEvent[];
	/**
	 * Whether a source id is this player or one of their pets — `analyseCore`'s own `mine`.
	 *
	 * **Load-bearing, and the pets are the reason.** Storm, Earth and Fire is a Windwalker's cleave: the
	 * spirits are separate actors that carry the monk's damage onto a *second* target. Reading only the
	 * player's own hits therefore makes a stacked Dark Shaman pull look split — measured on the four
	 * anonymous ones, the monk's own body sits at 75–93% of one boss while the spirits hold the other, and
	 * a rule gated at 90% fires on a pull where the two bosses never moved more than twenty yards apart.
	 * With the pets counted the same four read 50.3–62.0%, which is what a cleave looks like.
	 */
	mine: (sourceID: number | undefined) => boolean;
	/** Report-relative ms of the pull's first moment, so the windows come back fight-relative. */
	fightStartMs: number;
	/** The report's own actor names. Only `splitPair` asks, and it may answer null. */
	nameOf: (actorID: number) => string | null;
}

/**
 * The split this player was on, or null for the ordinary case of a pull fought together.
 *
 * **Null is the answer for every encounter but three, and for most pulls on those three too.** It is not
 * a refusal and nothing downstream should read it as one: it means the raid stayed together, or that this
 * encounter has no way to come apart that anyone would want flagged.
 *
 * Damage-over-time ticks are dropped from every reading here. A DoT keeps landing on an enemy the player
 * has walked away from, which is the same argument `DamageEvent.tick` carries for the contact clock, and
 * a tower run measured through one would run until the boss died.
 */
export function detectSplitGroup(input: SplitGroupInput): SplitGroup | null {
	const { encounterID, enemyNPCs, events, mine, fightStartMs, nameOf } = input;
	if (encounterID === undefined) return null;
	const here = baseEncounterID(encounterID);

	const landed = events.filter(
		(e): e is WclEvent => isDamage(e) && e.tick !== true && mine(e.sourceID) && e.targetID !== undefined,
	);
	if (landed.length === 0) return null;

	const away = AWAY_SETS.find((rule) => baseEncounterID(rule.encounterID) === here);
	if (away !== undefined) {
		const ids = actorIDsFor(enemyNPCs, away.gameIDs);
		const hits = landed.filter((e) => e.targetID !== undefined && ids.has(e.targetID));
		if (hits.length === 0) return null;
		// A window of no length is one hit, and one hit is a tag rather than a trip — `AWAY_RUN_MS`
		// carries the pull it was measured on. Dropped before the count as well as before the clock,
		// because the count is what both sentences lead with.
		const windows = engagedWindows(
			hits.map((e) => e.timestamp - fightStartMs),
			RUN_GAP_MS,
		).filter(([from, to]) => to > from);
		if (windows.length === 0) return null;
		const awayMs = unionMs(windows);
		const share = totalOf(hits) / totalOf(landed);
		// One gate each, and the asymmetry is the encounters rather than an inconsistency. See
		// `AWAY_RUN_MS`, which is where the pair of them is argued.
		if (away.kind === 'belt' ? share < AWAY_SHARE : awayMs < AWAY_RUN_MS) return null;
		return { kind: away.kind, share, windows, awayMs, name: null };
	}

	const pair = BOSS_PAIRS.find((rule) => baseEncounterID(rule.encounterID) === here);
	if (pair !== undefined) {
		const sides = pair.gameIDs.map((gameID) => {
			const ids = actorIDsFor(enemyNPCs, [gameID]);
			const hits = landed.filter((e) => e.targetID !== undefined && ids.has(e.targetID));
			return { total: totalOf(hits), actorID: hits[0]?.targetID ?? null };
		});
		const both = sides.reduce((sum, side) => sum + side.total, 0);
		if (both === 0) return null;
		const held = sides.reduce((most, side) => (side.total > most.total ? side : most));
		const share = held.total / both;
		if (share < PAIR_SHARE) return null;
		return {
			kind: pair.kind,
			share,
			windows: [],
			awayMs: 0,
			name: held.actorID === null ? null : nameOf(held.actorID),
		};
	}

	return null;
}

/** The report's own actor numbers for a set of game ids — the same resolution every rule table needs. */
function actorIDsFor(
	enemyNPCs: readonly { id: number; gameID?: number | null }[] | undefined,
	gameIDs: readonly number[],
): Set<number> {
	return new Set(
		(enemyNPCs ?? []).filter((npc) => npc.gameID != null && gameIDs.includes(npc.gameID)).map((npc) => npc.id),
	);
}

/** Damage dealt, overkill included — the same `amount ?? 0` every other total in the engine is built on. */
function totalOf(events: readonly WclEvent[]): number {
	return events.reduce((sum, e) => sum + (isDamage(e) ? (e.amount ?? 0) : 0), 0);
}
