// WarcraftLogs' own Siege of Orgrimmar parsing rules, as a lookup — and the second decision each one
// needs before this report may read it.
//
// ## Where this comes from
//
// One article, published by WarcraftLogs on 3 June 2026, the day before the raid opened. It is served
// on two hosts and the two copies are byte-identical:
//
//   - https://articles.classic.warcraftlogs.com/news/siege-of-orgrimmar-on-warcraft-logs
//   - https://www.archon.gg/classic-mop/articles/news/siege-of-orgrimmar-on-warcraft-logs
//
// Archon is WarcraftLogs' articles platform rather than a third party rewriting them, which is why
// the second URL is not a weaker citation than the first. The Wowhead write-up is downstream of both
// and introduces its copy with "Warcraft Logs said:". Every `npc` string below is transcribed from
// that article, apostrophes and plurals included; every `heroicOnly` is read off whether its sentence
// opens with the article's bolded "On Heroic:".
//
// ## What is deliberately *not* here
//
// The article carries four other kinds of rule, and none of them can be a row in a table keyed by NPC:
//
//   - **"Removed from ASP"** — Immerseus, Norushen, Sha of Pride, Galakras and Spoils of Pandaria. All
//     Star Points is a ranking-eligibility fact about the whole encounter ("it no longer gives points,
//     and the boss no longer contributes to the Best Perf. Avg"), not a statement about any NPC. It
//     must never reach a target count, and a table keyed by NPC has no honest shape for it.
//   - **Pull conditions** — Nazgrim's "you need to reset Nazgrim to despawn Orgrimmar Faithful", and
//     the raid-wide "bringing trash into bosses is not allowed". These are rules about how the pull was
//     performed. A lookup that pretended to answer them would be encoding a condition it cannot check.
//   - **Conditions on the unit rather than its name** — Paragons' "damage done to any Paragon that
//     heals to full is excluded" and Garrosh's "damage done to adds that don't die is removed". Both are
//     evaluated over the fight, and neither is expressible as a static row. They are left out rather
//     than approximated: an approximation here would silently delete a real add wave.
//   - **Re-attribution, which is a third category** — "Amber Scorpion damage is reattributed to an NPC",
//     and the same treatment for Tricks of the Trade, Stormlash Totem and Skull Banner. The damage is
//     not removed, it moves to a different actor. Nothing in this file changes who dealt a hit, so
//     re-attribution needs no row here; it would need one only in a module that builds damage totals.
//     Galakras' "healing done to NPCs does not count" is likewise not about damage at all.
//
// ## Why the key is an encounter and a name, and what that costs
//
// The right key would be the NPC's `gameID`, which is stable across reports where the report-local
// actor `id` is not — that is the judgement `IGNORED_MULTI_TARGET_ACTORS` in the Windwalker spec
// already made, and this file follows it. But the ruleset is *written* in names, so a name has to be
// carried too or there is nothing to check the transcription against, and a `gameID` can only be filled
// in for an NPC that actually appeared in a pull somebody measured. Both are carried, `gameID` is
// authoritative where it is present, and the rows where it is `null` are rows nobody has yet seen a
// log of.
//
// **A name-only match is not safe here, and Garrosh proves it inside this very table.** The ruleset
// names `Desecrated Weapon`. The log of the reference pull carries two units: that one (gameID 72154)
// and `Empowered Desecrated Weapon` (gameID 72198), which is the empowered form of the same weapon and
// is therefore covered by the same rule. Nothing about the two *names* says so — an exact match takes
// one and leaves the other, a substring match takes both and would take an unrelated unit that happened
// to share a word — so the pair is carried as two rows keyed on the ids, and the fact that binds them
// is knowledge of the encounter rather than anything a matcher could derive.
//
// Thok is the mirror image, and the one this file cannot fix: the rule names `Starved Yeti`, and the
// reference pull's captive was a `Captive Cave Bat` instead, so the rule as written excludes one of the
// three captives and not the others. Matching by `gameID` where one is known avoids the first trap and
// cannot help with the second — the second is a property of the ruleset, not of the matcher.
//
// The encounter is keyed on the **base** id. Classic re-registers every boss for every re-release with
// an offset that is a multiple of 50000, and Siege has three registrations: Garrosh is `1623` on retail
// SoO, `51623` on classic SoO and `101623` on the classic re-release. `baseEncounterID` collapses all
// three, so a rule written once holds for a report from any of them.

/**
 * How far an exclusion reaches — *the question the ruleset does not answer*.
 *
 * WarcraftLogs removes these NPCs from **damage rankings**, so nobody can pad a parse on them. That
 * is not the same question as "was the player fighting more than one thing", and conflating the two
 * would rewrite the shape of a fight rather than clean it up:
 *
 *   - `'damage'` — leaves the damage attribution only. The NPC is a real body the player was engaged
 *     with, and the rotation was right to treat the pull as multi-target while it was up. Excluding it
 *     from the *count* would call an add wave single-target.
 *   - `'both'` — leaves the count as well. The player was never fighting this unit: the hits are
 *     splash, and each one buys a full target window of elevated count it did not earn.
 *
 * `null` is a real value and not a hole to be filled in later: it means nobody has evidence either way,
 * and an unset row is honest where a guessed one silently changes a reading.
 *
 * There is no `'count'`-only member, because no rule in this ruleset produces one — every entry here
 * begins life as a damage-ranking exclusion. The union would be widened by a rule that does.
 */
export type ExclusionReach = 'damage' | 'both';

/** One NPC the Siege ruleset removes from damage rankings, and this report's reading of what that means. */
export interface RankingExclusion {
	/** The encounter's **base** id — compare with `baseEncounterID(fight.encounterID)`, never raw. */
	encounterID: number;
	/** The encounter's name as the ruleset heads it, for reading the table rather than for matching. */
	encounter: string;
	/** The NPC's name exactly as the ruleset writes it. Not a safe key on its own — see the header. */
	npc: string;
	/** The NPC's stable game id, where a measured pull carried it. `null` where no log has shown it. */
	gameID: number | null;
	/** True when the rule's sentence opens with the article's "On Heroic:". */
	heroicOnly: boolean;
	/** Whether this leaves the damage attribution only, or the target count too. `null` when undecided. */
	reach: ExclusionReach | null;
	/** Why `reach` is what it is, in terms of something measured rather than something assumed. */
	evidence: string;
}

/**
 * The difficulty id Mists of Pandaria Classic gives Heroic.
 *
 * Read off the zone rather than assumed: every committed fixture that carries `difficultyNames` gives
 * `{ 3: 'Normal', 4: 'Heroic' }`, and every Siege pull in the reference report `a:6MhZgjyAknFWrYfK`
 * reports `difficulty: 4`. A pull whose difficulty is anything else is not Heroic, and the heroic-only
 * rows below do not apply to it.
 */
export const HEROIC_DIFFICULTY = 4;

/** The offset Classic re-registers a boss by, once per re-release. */
const CLASSIC_ENCOUNTER_OFFSET = 50_000;

/**
 * The encounter id with the Classic re-registration offset taken off.
 *
 * `1623`, `51623` and `101623` are all Garrosh Hellscream — retail SoO, classic SoO, and the classic
 * re-release — and a rule written against one of them has to hold for the other two.
 */
export function baseEncounterID(encounterID: number): number {
	return encounterID % CLASSIC_ENCOUNTER_OFFSET;
}

/**
 * Every NPC the Siege of Orgrimmar ruleset names, with the reach decided per row.
 *
 * ## The test each `reach` was decided by
 *
 * The evidence is one anonymous heroic-25 clear, `a:6MhZgjyAknFWrYfK` — fourteen kills in one night,
 * measured on the Windwalker whose damage stream the target series is built from, with the pet's
 * damage taken out exactly as `analyseCore` takes it out. Two facts are read off each unit:
 *
 *   - **Aimed presses.** Melee auto-attacks, Tiger Palm, Blackout Kick, Rising Sun Kick, Jab. A monk
 *     cannot auto-attack a unit it has not targeted, so one of these is proof the player chose it.
 *     Rushing Jade Wind, Spinning Crane Kick, Chi Wave and proc damage are **not** presses in this
 *     sense: they are centred on the monk and pick nothing.
 *   - **Contact span per spawn.** First hit to last, per spawn. A spawn held longer than one target
 *     window (5s, `TARGET_WINDOW_MS`) is a body the rotation had time to react to; a spawn touched
 *     inside one window never was.
 *
 * A row is `'both'` only where **neither** fact is present and the encounter's own structure agrees.
 * Where the two disagree — nothing aimed at it, but spawns held well past a window — the row is left
 * `null`, because that disagreement is a real finding and picking a side would invent one.
 */
export const SIEGE_RANKING_EXCLUSIONS: readonly RankingExclusion[] = [
	{
		encounterID: 1598,
		encounter: 'The Fallen Protectors',
		npc: 'Despair Spawn',
		gameID: 71_712,
		heroicOnly: true,
		reach: 'damage',
		evidence:
			'196 hits across 7 spawns, no aimed press among them, but four of the seven were held in contact for 28.7s, 27.1s, 17.1s and 16.2s — three to six target windows each. Bodies the rotation had every reason to react to. Dropping it from the count would move band 4 by -13.7pp of contact.',
	},
	{
		encounterID: 1598,
		encounter: 'The Fallen Protectors',
		npc: 'Desperation Spawn',
		gameID: 71_993,
		heroicOnly: true,
		reach: 'damage',
		evidence:
			'275 hits across 6 spawns including 54 aimed presses, 42 of them melee auto-attacks. Deliberately fought, and not arguable.',
	},
	{
		encounterID: 1606,
		encounter: 'The Dark Shamans',
		npc: 'Darkfang',
		gameID: 71_921,
		heroicOnly: true,
		reach: 'damage',
		evidence:
			"85 hits on a single spawn across an unbroken 25.0s — five target windows on one body. The encounter's own pet: WarcraftLogs removes it so a parse cannot be padded on it, which is a different question from whether the monk was fighting two things. Dropping it from the count would move band 3 by +12.0pp and band 4 by -12.5pp.",
	},
	{
		encounterID: 1606,
		encounter: 'The Dark Shamans',
		npc: 'Bloodclaw',
		gameID: 71_923,
		heroicOnly: true,
		reach: 'damage',
		evidence: '97 hits on a single spawn across an unbroken 28.3s, alongside Darkfang. The same judgement.',
	},
	{
		encounterID: 1606,
		encounter: 'The Dark Shamans',
		npc: 'Foul Slimes',
		gameID: 71_825,
		heroicOnly: true,
		reach: null,
		evidence:
			'*** The two readings disagree, so this one is not decided. *** 47 hits across 22 spawns, no aimed press, and the longest spawn held for 1.15s — every one of them inside a single target window, which is the splash signature. But 36 of the 47 are Rushing Jade Wind, and a monk pressing an area button into twenty-two bodies is doing the thing a multi-target band exists to recommend. Dropping it from the count takes the pull\'s peak from 10 to 4 and band 4 from 19.0% to 12.5% of contact, so the choice is not cheap either way. Also note the ruleset writes the plural; the log actor is "Foul Slime".',
	},
	{
		encounterID: 1595,
		encounter: 'Malkorok',
		npc: 'Living Corruption',
		gameID: 71_644,
		heroicOnly: true,
		reach: 'damage',
		evidence:
			"*** Decided 'both' on the reference clear, and narrowed on a second pull of the same boss. *** On `a:6MhZgjyAknFWrYfK`: 28 hits across 11 spawns, not one aimed press, and eight of the eleven touched once for a contact span of zero — the splash signature, and the row read 'both' on it. `uncounted.json` (`a:XkDQJHaztfnCd9Yj` fight 29, the same boss and difficulty) holds the first half and breaks the second: still zero aimed presses of 115 hits across 20 bodies, but **four of the twenty were in contact for longer than one 5 000ms target window** — 7 646ms, 6 998ms, 6 220ms and 5 153ms — and one still is at 5 153ms with the pet's damage taken out. This table's own header calls a spawn held past a window \"a body the rotation had time to react to\" and allows 'both' *\"only where **neither** fact is present\"*, so the second pull disallows it. 'damage' rather than `null` because the surviving half is the 'damage' condition: a body the player was engaged with, whose hits should not pad a parse and whose presence the count is right to see. Measured in `game/__tests__/exclusionEvidence.test.ts`.",
	},
	{
		encounterID: 1599,
		encounter: 'Thok the Bloodthirsty',
		npc: "Kor'kron Jailer",
		gameID: 71_658,
		heroicOnly: false,
		reach: 'damage',
		evidence:
			"157 hits on one spawn across a contiguous 39.6s, including 60 aimed presses of which 42 are melee auto-attacks. Eight target windows on one body. And the arithmetic says the same thing from the other side: dropping the Jailer from the count moves Thok's multi-target share *up*, from 11.7% to 13.5%, because most of those 39.6s were spent on the Jailer alone — a count exclusion would remove contact time from the denominator rather than remove a second enemy.",
	},
	{
		encounterID: 1599,
		encounter: 'Thok the Bloodthirsty',
		npc: 'Starved Yeti',
		gameID: null,
		heroicOnly: false,
		reach: null,
		evidence:
			"Absent. Thok's captive on the reference pull was a Captive Cave Bat (gameID 73522), which the ruleset does not name at all, so the rule excludes one of the three captives and no log here shows the Yeti's shape. Left unset rather than assumed to match the Jailer beside it.",
	},
	{
		encounterID: 1593,
		encounter: 'Paragons of the Klaxxi',
		npc: 'Amber Parasites',
		gameID: null,
		heroicOnly: true,
		reach: null,
		evidence: 'Absent from the reference pull. No evidence either way.',
	},
	{
		encounterID: 1593,
		encounter: 'Paragons of the Klaxxi',
		npc: 'Blood',
		gameID: 71_542,
		heroicOnly: true,
		reach: 'both',
		evidence:
			'13 hits across 3 spawns, no aimed press, longest contact span 2.1s — every spawn inside one target window. Ten of the thirteen are Spinning Crane Kick landing on whatever stood in it. Dropping it takes the pull off band 4 entirely (1.5% of contact) and its peak from 5 to 3.',
	},
	{
		encounterID: 1623,
		encounter: 'Garrosh Hellscream',
		npc: 'Desecrated Weapon',
		gameID: 72_154,
		heroicOnly: true,
		reach: 'damage',
		evidence:
			'36 hits across 2 spawns and no aimed press — but the two spawns were held for 15.3s and 7.3s, three and one and a half target windows, and the Desecrated Weapon is a unit the raid is required to destroy. Sustained contact and encounter structure agree, so this is a body. The log carries the empowered form of the same weapon beside it, which has a row of its own.',
	},
	{
		encounterID: 1623,
		encounter: 'Garrosh Hellscream',
		npc: 'Empowered Desecrated Weapon',
		gameID: 72_198,
		heroicOnly: true,
		reach: 'damage',
		evidence:
			"The empowered form of `Desecrated Weapon`, so the ruleset's rule for that weapon covers it — the two are one unit in the encounter, and the article names the type rather than each spawn state. Reach follows its own row for the same reason it was chosen there: this is a body the raid is required to destroy, not splash. Only 3 hits on the reference pull, which on its own would argue the other way; the encounter structure is what decides it, and the same argument was already accepted for the unempowered form on 36.",
	},
	{
		encounterID: 1623,
		encounter: 'Garrosh Hellscream',
		npc: 'Manifestation of Rage',
		gameID: null,
		heroicOnly: true,
		reach: null,
		evidence: 'Absent from the reference pull. No evidence either way.',
	},
	{
		encounterID: 1623,
		encounter: 'Garrosh Hellscream',
		npc: "Minion of Y'Shaarj",
		gameID: 72_272,
		heroicOnly: true,
		reach: 'both',
		evidence:
			'11 hits across 3 spawns inside a single five-second window at 348-353s of a 535s pull, no aimed press, two of the three touched once for a contact span of zero. One target window of elevated count bought by nothing.',
	},
];

/**
 * The rule for one NPC on one pull, or `undefined` when the ruleset says nothing about it.
 *
 * `difficulty` is taken rather than inferred, because several rows are heroic-only and the fixtures all
 * record it. `gameID` wins where the caller has one and the row has one; otherwise the names must match
 * exactly, with the caveats in the header.
 */
export function rankingExclusionFor(
	encounterID: number | undefined,
	difficulty: number | undefined,
	npc: { name?: string | null; gameID?: number | null },
): RankingExclusion | undefined {
	if (encounterID === undefined) return undefined;
	const base = baseEncounterID(encounterID);
	return SIEGE_RANKING_EXCLUSIONS.find((rule) => {
		if (rule.encounterID !== base) return false;
		if (rule.heroicOnly && difficulty !== HEROIC_DIFFICULTY) return false;
		if (rule.gameID !== null && npc.gameID != null) return rule.gameID === npc.gameID;
		return rule.npc === npc.name;
	});
}

/**
 * The table above resolved to this report's actor ids — *the enemies that must not raise the count*.
 *
 * ## What it answers, and the one thing it deliberately does not
 *
 * One question only: **which bodies leave the counted enemy series**. `reach` is the whole of the
 * decision and it is already made, per row, against a measured pull:
 *
 *   - `'both'` — in the set. The player was never fighting this unit, so each stray hit buying a
 *     target window of elevated count is the count lying about the pull.
 *   - `'damage'` — **not** in the set, and that is the interesting half. WarcraftLogs still strikes the
 *     damage out, but the add was a body the rotation was right to react to; dropping it from the count
 *     would report an add wave as single-target, which is a worse reading than the one it replaces.
 *   - `null` — not in the set. An undecided row is a row with no evidence either way, and the safe
 *     reading of "nobody has measured this" is to change nothing. It is not a `'both'` awaiting paperwork.
 *
 * Nothing here removes damage from anything. The ruleset's own effect on rankings is WarcraftLogs'
 * business; this is only the second decision the header argues for, applied.
 *
 * ## Why a `Set` of report-local ids, and not of `gameID`s
 *
 * Same reason `ignoredMultiTargetActorIDs` in the Windwalker spec returns one: the rules are written in
 * `gameID`s, which are stable across reports, and every reader downstream holds a damage event whose
 * `targetID` is the report's *local* actor number, which is not. The match happens here, once, so that
 * the several numbers this report prints about "how many enemies was this" cannot resolve the same table
 * two ways and disagree — the failure that comment records having already happened once.
 *
 * ## What `enemyNPCs` actually carries, and the row it therefore cannot reach
 *
 * `reportFights.graphql` asks an `enemyNPCs` entry for `id` and `gameID` and for no name, and
 * `normaliseFight` then drops any entry missing either — so on the list `analyseCore` holds, **the name
 * fallback never fires**. That is fine today and is asserted rather than assumed: every row whose
 * `gameID` is `null` is also `reach: null`, so nothing decided is out of reach. It stops being fine the
 * moment a row is decided without a `gameID`, which is why `name` is accepted here at all — a caller
 * holding the report's `actors` can name a unit the fight list cannot, and passing it costs nothing.
 *
 * `difficulty` is taken rather than inferred for the same reason `rankingExclusionFor` takes it: most
 * rows are heroic-only, Thok's is not, and a pull records which it was.
 */
export function uncountedActorIDs(
	encounterID: number | undefined,
	difficulty: number | undefined,
	enemyNPCs: readonly { id: number; gameID?: number | null; name?: string | null }[] | undefined,
): Set<number> {
	return new Set(
		(enemyNPCs ?? [])
			.filter((npc) => rankingExclusionFor(encounterID, difficulty, npc)?.reach === 'both')
			.map((npc) => npc.id),
	);
}

/**
 * The actors whose **damage** the ruleset strikes — every decided row, not just the counted ones.
 *
 * The companion to `uncountedActorIDs` above, and the two answer different questions on purpose. That one
 * asks "did this body raise the enemy count", which only `reach: 'both'` does. This one asks "does this
 * damage count", which is the condition **every** decided row begins life as: the header says so — *"every
 * entry here begins life as a damage-ranking exclusion"* — so `'damage'` and `'both'` are both in, and
 * `null` is out for the reason it is out everywhere, that an undecided row has no evidence either way.
 *
 * **This is the reader `reach: 'damage'` was written for and did not have.** For as long as
 * `uncountedActorIDs` was the only consumer, the seven `'damage'` rows were inert: the field said
 * WarcraftLogs strikes the damage and nothing in this codebase struck anything. The evidence written into
 * those rows was an argument about the *count*, and it still stands — a body held in contact for 39.6s was
 * a body the rotation had to answer. What it never argued is that the damage should pad a reading.
 */
export function excludedDamageActorIDs(
	encounterID: number | undefined,
	difficulty: number | undefined,
	enemyNPCs: readonly { id: number; gameID?: number | null; name?: string | null }[] | undefined,
): Set<number> {
	return new Set(
		(enemyNPCs ?? [])
			.filter((npc) => {
				const reach = rankingExclusionFor(encounterID, difficulty, npc)?.reach;
				return reach === 'damage' || reach === 'both';
			})
			.map((npc) => npc.id),
	);
}
