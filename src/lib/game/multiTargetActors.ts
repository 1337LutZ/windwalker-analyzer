// NPCs whose damage is not evidence that the pull had another enemy worth turning towards.
//
// **Game truth rather than one spec's opinion, which is why this is here and not in a spec.** It began
// in `specs/windwalker/lib/index.ts` as a Windwalker constant, and the second spec that needed it — the
// Protection Paladin, whose engine config used to declare `ignoredMultiTargetActors: () => new Set()`,
// a stub that read as unfinished — could only have got at it by importing another spec's lib, which
// nothing in this tree does. `game/rankingExclusions.ts` is the neighbour to read for the same shape:
// encounter-keyed rules about NPC types, written in `gameID`s and resolved into a report's own actor
// numbers at the point of use.

/**
 * NPCs that do not count as useful multi-target damage, by encounter and game id.
 *
 * ## The Automated Shredder, and the two different reasons it is on this list
 *
 * Siegecrafter Blackfuse (encounter 51601) spawns Automated Shredders (gameID 71591) that carry a **90%
 * damage reduction against everyone who is not tanking them**. That is the whole of the Windwalker's
 * reason: a monk whose Rushing Jade Wind is clipping three Shredders is not fighting three enemies in
 * any sense the rotation cares about, and counting them turned the pull's own report into two answers —
 * the wind read as a four-target button in one section while the section beside it called the pull
 * single-target. Both readers take this list now; see `ignoredMultiTargetActorIDs`.
 *
 * **A tank is the exception to the damage reduction, and it is not an exception to this list. Read this
 * paragraph before deciding the rule is wrong for tanks, because that is the conclusion it exists to
 * head off.** A Protection Paladin really can hurt a Shredder, and the log says so plainly: on the
 * Blackfuse kill in `a:9XYKBd34HLVqQA8D` (fight 50) the debuff **Electrostatic Charge** (143385) fires
 * 96 times, and 23 of those land on the Paladin — actor 29, the same tank the five committed Protection
 * captures were taken from. So the mechanic is live and the tank is inside it.
 *
 * What does *not* follow is that the pull was multi-target for them. **They are on the Shredder alone,
 * killing it with a single-target rotation, precisely because nobody else can touch it.** A Shredder
 * that raised the count would push that stretch into the cleave or area band and the report would then
 * expect area buttons the player was right not to press — a fault invented out of a mechanic the player
 * handled correctly. Being able to hit an add is not the same as having several things worth cleaving,
 * and the count is a reading of the second.
 *
 * So the exclusion is right for both specs and right for different reasons, and the tank's reason is
 * the one that is easy to get backwards. None of the five committed Protection captures is a Blackfuse
 * pull and none of them carries 143385 at all, so nothing in the fixture tree exercises this — the
 * evidence is the report named above and this comment is where it lives.
 *
 * ## Two ids that are not Electrostatic Charge
 *
 * Named because they sit next to it and would each look like a plausible correction: 145154 is
 * Electromagnetic Barrier, which fires **zero** times on that kill, and 54735 is Electromagnetic Pulse.
 * Neither is the debuff above.
 */
export const IGNORED_MULTI_TARGET_ACTORS = [
	{
		encounterID: 51601,
		gameID: 71591,
		name: 'Automated Shredder',
		reason: '90% damage reduction for non-tanks; a tank fights one alone, which is not a pack',
	},
] as const;

/**
 * The list above resolved to this report's actor ids.
 *
 * One function rather than one filter per reader, because the report has more than one number about
 * "how many enemies was this" and they have to agree. The per-moment target count applied the list;
 * Rushing Jade Wind's fan-out — a *different* count, over the same damage events — did not, so on a
 * pull full of Automated Shredders the report could call the wind a four-target button in one section
 * while the section beside it said the pull was single-target. Both readers take this set now, and so
 * does the damage table's fan-out column.
 *
 * `gameID` is the NPC's own id in the game's data and is stable across reports; `id` is the report's
 * local actor number and is not, which is why the list is written in the first and matched into the
 * second here.
 *
 * **Every spec hands this to `SpecConfig.ignoredMultiTargetActors`, and a spec that wanted to differ
 * would have to say what it was differing about.** The seam is per spec because a rule of this kind
 * could be — a body one spec can meaningfully fight and another cannot is a real possibility — but the
 * one rule on the list today is not that, and the docblock above is why.
 */
export function ignoredMultiTargetActorIDs(
	encounterID: number | undefined,
	enemyNPCs: readonly { id: number; gameID?: number | null }[] | undefined,
): Set<number> {
	return new Set(
		(enemyNPCs ?? [])
			.filter((npc) =>
				IGNORED_MULTI_TARGET_ACTORS.some((rule) => rule.encounterID === encounterID && rule.gameID === npc.gameID),
			)
			.map((npc) => npc.id),
	);
}
