import { instanceKey, isDamage, type WclEvent } from '~/lib/events';
import { baseEncounterID, HEROIC_DIFFICULTY } from './rankingExclusions';

// The two Siege parsing rules that are conditions on a *unit over the pull* rather than on its name,
// evaluated against the log instead of transcribed into a table.
//
// `rankingExclusions.ts` carries the eleven rules that are a name and a verdict, and its header explains
// in as many words why these two are not among them: "Both are evaluated over the fight, and neither is
// expressible as a static row." That is still true, and this file does not contradict it — it is the
// module that header was pointing at. Nothing here is keyed by NPC name; each rule is a walk over the
// stream that ends in a set of spawns.
//
// ## What the article says, and the exact words each rule is built from
//
//   - **Paragons of the Klaxxi** — "damage done to any Paragon that heals to full is excluded".
//   - **Garrosh Hellscream** — "damage done to adds that don't die is removed".
//
// Both quotes are already in `rankingExclusions.ts`' header, transcribed there from the WarcraftLogs
// article the whole ruleset comes from. They are repeated rather than imported because a rule and the
// sentence it implements drifting apart is the failure this codebase writes comments to prevent.
//
// ## The one fact here that is inferred rather than read
//
// **Whether either rule is heroic-only is not known, and both are gated to heroic anyway.** The header
// next door records that `heroicOnly` is read off whether a sentence opens with the article's bolded
// "On Heroic:", and neither quote above was transcribed with that marker — which is not evidence of its
// absence, because the marker was never the part being transcribed. So the gate is taken from the
// neighbours instead: every other Siege rule on *both* of these encounters is heroic-only, and gating
// wrongly in that direction changes nothing on a Normal pull while the other direction would strike
// damage on pulls the ruleset may never have been talking about. Changing less is the safe half of an
// unknown. Whoever reads the article next can settle it; until then this paragraph is the honest state.

/** Paragons of the Klaxxi, base id — see `baseEncounterID` for why the base and not the registration. */
export const PARAGONS_ENCOUNTER = 1593;

/** Garrosh Hellscream, base id. */
export const GARROSH_ENCOUNTER = 1623;

/**
 * The share of its pool a unit has to reach for the climb to read as "healed to full".
 *
 * Not 1. Health arrives as a sample on a damage event rather than as a reading taken when the heal
 * landed, so the first sample after a Paragon tops off is already a hit or two into the next attempt on
 * it — measured across the nine Paragons of `protection/__fixtures__/paragons.json`, the tops-off
 * samples land at 0.978 to 1.000. A threshold of 1 would see one of the eleven real heals in that pull.
 */
export const FULL_HEALTH_FRACTION = 0.97;

/**
 * How far health has to climb between two samples before the climb reads as a heal at all.
 *
 * Guards the one false positive this walk can produce: a unit sitting near full while absorbs and
 * rounding move the sample a fraction either way. Every real regen in the reference pull clears this by
 * an order of magnitude — the eleven of them climb between 0.053 and 0.477 of the pool in one step.
 */
export const HEAL_STEP_FRACTION = 0.02;

/** Which sentence struck a spawn. Carried so a reader is never left to infer it from the encounter. */
export type ConditionalRule = 'healsToFull' | 'neverDies';

/** One spawn the ruleset strikes, and how much of its life goes with it. */
export interface StruckSpawn {
	targetID: number;
	targetInstance: number | undefined;
	rule: ConditionalRule;
	/**
	 * Damage landed at or before this timestamp is struck; damage after it counts.
	 *
	 * **`healsToFull` is bounded and `neverDies` is not**, and the difference is the two sentences rather
	 * than a convenience. A Paragon that heals to full undoes the damage *it has taken so far* — the pull
	 * that eventually killed it landed after the last top-off, and striking that too would delete the work
	 * that actually finished the unit. An add that never dies undoes all of it, because there is no later
	 * stretch to keep: the whole life ended with the unit still standing.
	 *
	 * So this is the timestamp of the **last** heal to full, not the first. A Paragon topped off four times
	 * is one that wasted four attempts and completed the fifth.
	 */
	throughMs: number;
}

/**
 * The spawns struck by a rule that had to be read off the pull, keyed by `instanceKey`.
 *
 * Empty for every encounter but two, and empty on those two whenever the evidence the rule needs is not
 * in the dataset. **An empty map means "no rule fired", never "the rules were checked and cleared"** —
 * the `neverDies` half in particular cannot run at all without enemy deaths, and says so by returning
 * nothing rather than by concluding that nothing died.
 *
 * @param isEnemy Whether an actor is an enemy NPC at all. Load-bearing on the `neverDies` half and not a
 *   tidiness check: the fetched stream is the player's own and carries the damage they **took** as well as
 *   the damage they dealt, so a rule that only asked "not a boss" answered yes for every raider who was
 *   hit and never died. That read 10 struck units on the Garrosh pull where there is 1.
 * @param isBoss Whether an actor is one the *report* calls a boss, from its master data. Both rules need
 *   the boss/add split and neither may guess at it: on Paragons the nine bosses **are** the Paragons and
 *   the two non-bosses (`Blood`, `Hungry Kunchong`) are not, so `subType` is the ruleset's own word for
 *   "Paragon" and no gameID has to be transcribed for it; on Garrosh the same field is what keeps the
 *   boss out of a rule about adds.
 */
export function conditionalExclusions({
	encounterID,
	difficulty,
	events,
	enemyDeaths,
	isEnemy,
	isBoss,
}: {
	encounterID: number | undefined;
	difficulty: number | undefined;
	events: readonly WclEvent[];
	/** Absent where the fetch predates the enemy-deaths query — a real state, and not an empty list. */
	enemyDeaths: readonly WclEvent[] | undefined;
	isEnemy: (actorID: number) => boolean;
	isBoss: (actorID: number) => boolean;
}): Map<string, StruckSpawn> {
	const struck = new Map<string, StruckSpawn>();
	if (encounterID === undefined) return struck;
	if (difficulty !== HEROIC_DIFFICULTY) return struck;
	const base = baseEncounterID(encounterID);
	if (base === PARAGONS_ENCOUNTER) return healsToFull(events, isBoss);
	if (base === GARROSH_ENCOUNTER) return neverDies(events, enemyDeaths, isEnemy, isBoss);
	return struck;
}

/**
 * Paragons whose health climbed back to full, and the moment each of them last did it.
 *
 * Read off the health samples the player's own damage events carry, which is the only enemy-side health
 * reading in the dataset: the fetch asks for enemy **deaths** and the player's own stream, so an enemy
 * heal event is not there to be found. `events/model.ts` says what the pair means — absolute for an
 * enemy, a percentage for a player — and the fraction below is right for either.
 *
 * About one damage event in eight carries no health at all. That is not a gap to be filled: a missing
 * sample simply is not a reading, and the walk carries the previous fraction forward rather than
 * treating an absent field as a change.
 */
function healsToFull(events: readonly WclEvent[], isBoss: (actorID: number) => boolean): Map<string, StruckSpawn> {
	const struck = new Map<string, StruckSpawn>();
	const previous = new Map<string, number>();
	for (const event of events) {
		if (!isDamage(event)) continue;
		const { targetID, hitPoints, maxHitPoints } = event;
		if (targetID === undefined || !isBoss(targetID)) continue;
		if (hitPoints === undefined || maxHitPoints === undefined || maxHitPoints <= 0) continue;
		const key = instanceKey(targetID, event.targetInstance);
		const fraction = hitPoints / maxHitPoints;
		const before = previous.get(key);
		previous.set(key, fraction);
		if (before === undefined) continue;
		if (fraction - before < HEAL_STEP_FRACTION || fraction < FULL_HEALTH_FRACTION) continue;
		struck.set(key, {
			targetID,
			targetInstance: event.targetInstance,
			rule: 'healsToFull',
			throughMs: event.timestamp,
		});
	}
	return struck;
}

/**
 * Adds the player damaged that carry no death of their own.
 *
 * **Refuses to answer without the deaths, rather than answering "none died".** A dataset with no
 * `enemyDeaths` is one where every add on the pull would read as a survivor, which is not a cautious
 * reading of the rule but its exact inverse — the widest possible strike, handed out by a fetch that
 * simply predates the query. `SpawnRecord.deathMs` carries the same warning for the same reason.
 *
 * A fight that ends with an add alive is the rule's own case and not an edge of it: the raid killed the
 * boss and the add went with the encounter, so the damage put into it bought nothing the ruleset counts.
 */
function neverDies(
	events: readonly WclEvent[],
	enemyDeaths: readonly WclEvent[] | undefined,
	isEnemy: (actorID: number) => boolean,
	isBoss: (actorID: number) => boolean,
): Map<string, StruckSpawn> {
	const struck = new Map<string, StruckSpawn>();
	if (enemyDeaths === undefined) return struck;
	const died = new Set(
		enemyDeaths
			.filter((event) => event.targetID !== undefined)
			.map((event) => instanceKey(event.targetID as number, event.targetInstance)),
	);
	for (const event of events) {
		if (!isDamage(event)) continue;
		const { targetID } = event;
		if (targetID === undefined || !isEnemy(targetID) || isBoss(targetID)) continue;
		const key = instanceKey(targetID, event.targetInstance);
		if (died.has(key) || struck.has(key)) continue;
		struck.set(key, {
			targetID,
			targetInstance: event.targetInstance,
			rule: 'neverDies',
			throughMs: Number.POSITIVE_INFINITY,
		});
	}
	return struck;
}

/**
 * Whether a landed hit is one the ruleset strikes, given the map above.
 *
 * The time bound is `<=` for the reason `StruckSpawn.throughMs` gives: the sample that *shows* a Paragon
 * at full is itself a hit into the attempt that was undone.
 */
export function isStruckHit(
	struck: ReadonlyMap<string, StruckSpawn>,
	targetID: number | undefined,
	targetInstance: number | undefined,
	timestamp: number,
): boolean {
	if (targetID === undefined || struck.size === 0) return false;
	const row = struck.get(instanceKey(targetID, targetInstance));
	return row !== undefined && timestamp <= row.throughMs;
}
