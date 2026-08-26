// The Protection Paladin's half of the analysis: what the core cannot know, and nothing else.
//
// Ported from `nspietz/prot-pala-analyzer`, whose measurements this spec is built on — the spell
// table, the priority ladder, the haste model and the boss rules are all theirs. What is *not* ported
// is their engine: `measure.ts` there is 1,668 lines computing a `FightMeasure`, and fifteen of that
// shape's fields are fields `AnalysisCore` already produces. The globals figure is our `gcdSlots`, the
// holy power bar is a `ResourceBarAudit`, the buttons are the cast table and `lostCasts`. So this file
// is the remainder: the three things a Protection report says that no generic audit can.
//
// **Haste is the denominator, not a stat.** Sanctity of Battle (25956) turns melee haste into cooldown
// reduction on every generator plus Shield of the Righteous, and into a shorter global on top. The
// second half needs nothing from the model — `analyseCore` measures `effectiveGcd` off the median gap
// between presses, and on a hasted pull that median *is* the hasted global. The first half is what
// `cooldownAt` below is for.
//
// **A stun is not a lost global.** `lib/analysis/enforced` holds the boss rules; this spec is the
// first consumer of them, and the three numbers it produces are kept apart rather than netted: what
// the fight enforced, and what is left over for the player. Neither is subtracted from the other,
// which is the fork's rule and the reason the section can be read at all.

import { enforcedDowntime, type EnforcedDowntime } from '~/lib/analysis/enforced';
import { executeWindows } from '~/lib/analysis/execute';
import { buildHasteCurve, checkHaste, SEAL_OF_INSIGHT_HASTE, type HasteCurve } from '~/lib/analysis/haste';
import { analyseCore, type Handles, type SpecConfig } from '~/lib/analysis/analyseCore';
import { aplAudit, ALL_BANDS, type AplAudit, type AplInputs, type Band } from '~/lib/spec/apl';
import { damageByTarget } from '~/lib/analysis/damage';
import { ignoredMultiTargetActorIDs } from '~/lib/game/multiTargetActors';
import { readExternals } from '~/lib/analysis/externals';
import { readGear, readTalents } from '~/lib/analysis/gear';
import { readVengeance, vengeanceBar } from '~/lib/analysis/vengeance';
import { auraWindows, raidScoped, toIntervals } from '~/lib/analysis/auras';
import { raidSourceLanes } from '~/lib/analysis/raidCasters';
import { abilityIdOf, eventsOn, instanceKey, isAuraEvent, type WclEvent } from '~/lib/events';
import { mergeIntervals, unionMs, type Interval } from '~/lib/analysis/intervals';
import { defaultSettings, type AnalysisSettings, type SettingSchema } from '~/lib/settings';
import { CLASS_COLOR } from '~/lib/game/classes';
import { SECONDARY_RESOURCE_TYPE } from '~/lib/game/resources';
import type { Ability, Aura } from '~/lib/game/model';
import type { Analysis, AuraLane, FightDataset, ProtectionAudit, Window } from '~/lib/types';

import { GCD_MS, registry } from './data';
import { CONSECRATION_DOT_MS, EXECUTE_HEALTH_PCT, LADDER, UNARBITRATED } from './apl';

export { PROTECTION, registry } from './data';

/**
 * The trailing window a target count is taken over, and the two shares that read it.
 *
 * The Windwalker's numbers, unchanged, and deliberately so: nothing measured says a tank's fan-out
 * reads differently, and inventing three constants for a spec whose report does not yet grade on
 * target count would be three numbers nobody could defend.
 */
const TARGET_WINDOW_MS = 5000;
const MULTI_TARGET_SHARE_PCT = 33;
const SINGLE_TARGET_SHARE_PCT = 66;

/** A gap this long in damage to the primary target means it went untargetable. */
const ENGAGED_GAP_MS = 15_000;

/**
 * How close two differently-identified presses have to be to be the same press.
 *
 * Fifty milliseconds, the same as both other specs, and it does a different job here: Hammer of the
 * Righteous logs its cleave as a second cast in the same millisecond, which `echoCastIds` already
 * removes. This is the backstop for the pairs nobody has named yet.
 */
const SAME_PRESS_MS = 50;

const POTION_SLOTS = 2;
const POTION_CATEGORY_CD_MS = 60_000;

/**
 * Abilities whose cooldown only matters while the boss was up.
 *
 * Hammer of Wrath is the one that has to be here: it is an execute, available only under 20% health,
 * so its idle time outside that window is not a button anybody was holding.
 */
const NEEDS_TARGET: ReadonlySet<string> = new Set(['hammer-of-wrath']);

/**
 * Names for ids the model deliberately does not carry.
 *
 * Melee is the whole list for now, and it is here rather than in the table because an auto-attack has
 * no button behind it — the same reason both other specs name it here.
 */
const EXTRA_NAMES: Record<number, string> = {
	1: 'Melee',
	// Somebody else's totem, attributed to whoever it fires off. Named so a reader looking for it in the
	// damage table finds a name rather than a number, and so it does not read as this spec's own.
	120_687: 'Stormlash',
	// The legendary cloak's proc, under the buff 137596.
	137_597: 'Lightning Strike',
};

/** No press this spec makes costs a global the model does not already know about. */
const EXTRA_GLOBALS: Record<number, number> = {};

export const PROTECTION_SETTINGS: SettingSchema[] = [
	{
		key: 'cooldownLeewayMs',
		tKey: 'settings.prot.cooldown',
		// One global at this spec's own floor, and a global here is a second rather than a second and a
		// half — Sanctity of Battle takes it to 1.0s from 50% haste upwards, which is every geared pull.
		// A whole wait is forgiven rather than a slice off a longer one.
		default: 1000,
		min: 1000,
		max: 2000,
		step: 250,
	},
];

/**
 * Whether this player was actually playing Protection.
 *
 * A spent holy power, and it is the fork's own rule: no Protection Paladin finishes a pull without
 * spending one, and every figure in this report is built on a Protection ladder. Running it over a
 * Retribution parse would print confident numbers about a rotation nobody played.
 *
 * Shield of the Righteous rather than holy power generation, because a Retribution paladin generates
 * holy power too — the shield is the Protection spender and nothing else casts it.
 */
const identify = (h: Handles): boolean => h.castCount(registry.ability('shield-of-the-righteous')) > 0;

/**
 * The pull's haste curve, built from the two things the dataset carries.
 *
 * The rating comes off `combatantinfo` through the gear reader, and the Bloodlust windows off the
 * player's own aura stream. Both are already fetched; nothing here costs a request.
 */
function curveFor(h: Handles): HasteCurve {
	const lust = h.hasteWindows.map((w) => ({ start: w.start, end: w.end }));
	return buildHasteCurve(h.gear.hasteRating ?? null, lust, SEAL_OF_INSIGHT_HASTE);
}

/**
 * The buttons whose gaps say nothing about haste, and why each one is out.
 *
 * `checkHaste` reads the shortest gap between two presses of a button as a *measurement* of that
 * button's cooldown, which holds only while haste is the sole thing that moves it. Two of this spec's
 * haste-scaled buttons have something else on them and both fail loudly rather than subtly:
 *
 *   - **Avenger's Shield.** Grand Crusader (85416) resets the cooldown outright, and the reset is not
 *     rare — the shortest gap on all three committed pulls is a second or two against a nine-and-a-
 *     half-second cooldown, and 14 of 27, 12 of 43 and 20 of 61 gaps come back faster than the model
 *     allows. Left in, it is the worst row on every pull and the check reports nothing but itself.
 *   - **Hammer of Wrath.** Not a proc, but the same shape of problem from the other end: it is an
 *     execute, so its gaps outside twenty percent health are the boss's health bar rather than a
 *     cooldown. Nine and thirteen gaps on the two pulls that reach an execute, most of them minutes
 *     long. It happens to pass — worst margins of +21ms and −1ms — and passing on evidence that could
 *     not have failed is not a check.
 *
 * The builders are the opposite case and stay: Crusader Strike and Hammer of the Righteous share one
 * timer, so their presses arrive **merged** under one key below rather than as two buttons each of
 * which looks like it came back impossibly fast.
 */
const CHECK_EXCLUDES: ReadonlySet<string> = new Set(['avengers-shield', 'hammer-of-wrath']);

/**
 * The press streams the haste check is run over: one entry per cooldown, not per button.
 *
 * The merge is the whole reason this is a function rather than a comprehension. `sharesCooldownWith`
 * names a pair, and a pair read as two buttons produces two rows that are both wrong — a Hammer of the
 * Righteous three seconds after a Crusader Strike is that shared timer coming back on schedule, and
 * counted under either key alone it reads as the other button returning in no time at all. Keyed by
 * whichever half of the pair sorts first so the choice does not depend on table order.
 */
function checkPresses(h: Handles): Array<{ ability: Ability; times: number[] }> {
	const merged = new Map<string, { ability: Ability; times: number[] }>();
	for (const ability of registry.abilities) {
		if (ability.hasteScaled !== true || CHECK_EXCLUDES.has(ability.key)) continue;
		const partner = ability.sharesCooldownWith;
		const key = partner === undefined ? ability.key : [ability.key, partner].sort()[0]!;
		const entry = merged.get(key) ?? { ability: registry.ability(key), times: [] };
		entry.times.push(...h.castTimes(ability));
		merged.set(key, entry);
	}
	return [...merged.values()];
}

/**
 * The same curve, built from a dataset instead of from the handles.
 *
 * Two callers and one arithmetic. `cooldownAt` runs *before* the handles exist — it is what the cast
 * tables are built with — so it cannot take the route above, and a second reading of the same three
 * terms is exactly the kind of duplication that comes apart later. `WeakMap` rather than a module
 * variable so a second dataset in the same tab cannot be handed the first one's haste.
 */
const CURVES = new WeakMap<FightDataset, HasteCurve>();

function curveForDataset(dataset: FightDataset): HasteCurve {
	const cached = CURVES.get(dataset);
	if (cached !== undefined) return cached;

	const t0 = dataset.fight.startTime;
	const own = eventsOn(dataset.events, dataset.actor.id);
	const lust = auraWindows(own, registry.aura('bloodlust'), t0, dataset.fight.endTime, {
		openAtPull: true,
	}).map((w) => ({ start: w.start, end: w.end }));

	const curve = buildHasteCurve(
		readGear(dataset.events, dataset.actor.id).hasteRating ?? null,
		lust,
		SEAL_OF_INSIGHT_HASTE,
	);
	CURVES.set(dataset, curve);
	return curve;
}

/**
 * The globals the pull had room for, and the three ways one can go unpressed.
 *
 * **None of the three is subtracted from another**, which is the fork's rule and worth keeping
 * verbatim: a reader is owed the total *and* how much of it anybody could have done something about.
 * Netting them produces one number that hides which kind of fault it describes.
 */
function globalsOf(h: Handles, enforced: EnforcedDowntime): ProtectionAudit['globals'] {
	const available = h.gcdSlots;
	const pressed = h.onGcdCasts;
	const missed = Math.max(0, available - pressed);

	// The enforced stretches, cut to the time the player was actually in the fight — a rule that runs
	// past the kill is not seconds anybody could have pressed in.
	const inPull: Interval[] = [[0, h.duration]];
	const enforcedMs = unionMs(
		enforced.windows.map(([start, end]): Interval => [Math.max(start, 0), Math.min(end, h.duration)]),
	);

	/**
	 * The globals the fight took, **measured** rather than priced.
	 *
	 * The room inside the enforced windows, less the presses actually made in them. That subtraction is
	 * the whole of it and it is not a refinement: the first version of this priced the windows in
	 * globals and clamped the result at the gap, and on the Paragons capture that read *98 of 98
	 * globals taken by the fight, 0 left for the player* — a pull with 329 presses graded flawless
	 * because the arithmetic could not see that 93 presses happened **inside** those windows.
	 *
	 * A window with presses in it is a window the player could act in, whatever the rule says about the
	 * mechanic, and the press stream is the only thing that can say so. That is the same evidence the
	 * `lockout` rules were measured with in the first place — this just applies it per pull instead of
	 * trusting the table.
	 *
	 * Floored at nought: more presses inside a window than the window had room for means the window is
	 * not costing the player anything, not that the fight owes them globals.
	 *
	 * **And capped at the gap, which is a presentation rule rather than a measurement.** The two sides
	 * are counted on different clocks — `available` divides WarcraftLogs' own *active* time, which
	 * already excludes much of a stretch where the player was not attacking — so the room a window
	 * removes can genuinely exceed the gap it explains. On the Paragons capture that is 138 globals of
	 * enforced downtime against 98 missed, and a sentence reading "the encounter accounts for 138 of
	 * those 98" is nonsense whatever the arithmetic behind it. The cap says what the report can support:
	 * the fight covers the whole gap. `enforcedMs` beside it is uncapped and is the measurement.
	 */
	const roomInside = Math.floor(enforcedMs / h.effectiveGcd);
	const pressedInside = h.marks.filter(
		(mark) => mark.onGcd && enforced.windows.some(([start, end]) => mark.t >= start && mark.t < end),
	).length;
	const enforcedGlobals = Math.min(missed, Math.max(0, roomInside - pressedInside));

	return {
		available,
		pressed,
		missed,
		enforcedMs,
		enforcedGlobals,
		/**
		 * What is left when the fight's own share is taken off: the player's half of the gap.
		 *
		 * Floored at nought for one case that is real rather than defensive — an encounter whose windows
		 * cover more room than the pull's own gap. `missed` stays whole either way; it is the *share*
		 * that is taken off, and the report prints both.
		 */
		missedFree: Math.max(0, missed - enforcedGlobals),
		gcdMs: h.effectiveGcd,
		measuredMs: unionMs(inPull),
	};
}

/**
 * How many enemies get a Weakened Blows row before the rest are folded away.
 *
 * Six, matching the Windwalker's `RSK_TARGET_LANES` and the Elemental's `FS_TARGET_LANES`, and for the
 * reason their docblocks give: it is a property of how tall a chart reads rather than of how a pull is
 * measured, so it is a constant here and not a setting. **Nothing graded reads it** — it decides which
 * rows are drawn and which are behind the chart's own picker, and the enemies past it are kept rather
 * than dropped.
 *
 * Protection reaches it more often than either of the other two. The five committed captures put the
 * debuff on 21, 10, 7, 7 and 5 separate enemies, so four of the five overflow six and the picker is
 * reachable on real data rather than only in principle — `spoils.json` alone folds fifteen away.
 */
const WEAKENED_BLOWS_LANES = 6;

/** The Protection half of the analysis, from the handles and nothing else. */
function protectionAudit(h: Handles): ProtectionAudit {
	const curve = curveFor(h);
	const own = eventsOn(h.events, h.actor.id);

	/**
	 * The rows the timeline draws above the presses.
	 *
	 * Nine declared and six drawn: Divine Purpose, Bastion of Power and Shield of Glory open no window on
	 * any of the five committed captures, so they fall out on `windows.length > 0` rather than being
	 * listed conditionally. An empty row costs a line of chart to say a talent was not taken.
	 *
	 * **This spec has no `drawnAuras.test.ts`, and that gap is now reachable rather than moot.** Both
	 * other specs run one — "every aura the log put on the player has somewhere to be drawn, or a stated
	 * reason not to" — and it could say nothing here while the audit published `lanes: []`, because the
	 * honest answer for every aura was the same one. With rows to compare against, the sweep would have
	 * something to find; it needs a ledger of deliberate absences to go with it, which is the next lane's
	 * work rather than this one's.
	 *
	 * Split by what a reader is asking of each. A `buff` is something the player turned on and can be
	 * held responsible for; a `proc` is something that happened to them and is read for whether they
	 * spent it. Grand Crusader is the clearest case of the second — it resets Avenger's Shield, so its
	 * row is only interesting beside the press row under it, which is also why the summary timeline
	 * leaves it out and the cast log keeps it (`view/timelineBanks.ts`, `SUMMARY_ROW_NAMES`).
	 */
	const lane = (aura: Aura, group: 'buff' | 'proc' | 'debuff', windows: readonly Window[]): AuraLane => ({
		key: aura.key,
		name: aura.name,
		id: aura.ids[0] ?? 0,
		group,
		/**
		 * A copy that keeps the window's **provenance** on the way to the chart.
		 *
		 * `{ start, end }` alone is what the Elemental's own lane builder records having shipped first:
		 * `preexisting` and `truncated` are what tell a bar the log proved both ends of from one that was
		 * inferred, the chart reads them, and rebuilding each window from two of its fields throws both
		 * away with no type able to catch it — a narrower object still satisfies an optional field.
		 * Spread only when true, so a lane carrying neither serialises exactly as it did before.
		 */
		windows: windows.map((w) => ({
			start: w.start,
			end: w.end,
			...(w.preexisting === true ? { preexisting: true } : {}),
			...(w.truncated === true ? { truncated: true } : {}),
		})),
	});

	/**
	 * The player's aura events bucketed by ability id, once.
	 *
	 * **Because the sweep below asks about seventy auras and the answer for sixty-four is "nothing".**
	 * Built the obvious way — `auraWindows(own, aura)` per aura — that is seventy full passes over the
	 * player's stream, 685,000 event visits on the Garrosh capture to find the 3,093 events that are
	 * auras at all, and it measured at 13.9ms of a 38.5ms analysis. One pass to bucket and a lookup per
	 * aura is the same answer for 0.7ms.
	 *
	 * It matters beyond the analysis being fast: `useFightAnalysis` re-runs the whole thing whenever a
	 * setting changes, synchronously, so this was a third of the cost of every drag of the cooldown
	 * slider.
	 */
	const auraEventsById = new Map<number, WclEvent[]>();
	for (const event of own) {
		if (!isAuraEvent(event)) continue;
		const id = abilityIdOf(event);
		if (id === null) continue;
		const bucket = auraEventsById.get(id);
		if (bucket === undefined) auraEventsById.set(id, [event]);
		else bucket.push(event);
	}

	/**
	 * The same row built from the player's own aura stream, which is where every buff and proc below lives.
	 *
	 * `openAtPull` is what makes a buff already up when the pull started draw from the start rather than
	 * from its first refresh. It matters most for the ones that are never *cast* during a fight —
	 * Righteous Fury and the seal are on before the boss is pulled, and without it they draw either
	 * nothing or a bar beginning at some arbitrary reapplication.
	 *
	 * Handed only its own aura's events rather than the whole stream — see `auraEventsById`. The walk
	 * filters on `aura.ids` itself, so a pre-filtered slice is the same input with the misses removed;
	 * re-sorted because concatenating per-id buckets does not preserve the stream's own order, which
	 * every window walk depends on.
	 */
	const eventsFor = (aura: Aura): WclEvent[] =>
		aura.ids.length === 1
			? (auraEventsById.get(aura.ids[0] ?? 0) ?? [])
			: aura.ids.flatMap((id) => auraEventsById.get(id) ?? []).sort((a, b) => a.timestamp - b.timestamp);

	const selfLane = (aura: Aura, group: 'buff' | 'proc'): AuraLane =>
		lane(
			aura,
			group,
			auraWindows(eventsFor(aura), aura, h.t0, h.fight.endTime, {
				openAtPull: true,
				pullAuras: h.pullAuras,
				// A refresh with no application before it is an aura that was already up. Ancestral Vigor is
				// the case: on `fallenProtectors` it carries 110 events and **every one is a `refreshbuff`**,
				// because a healer put it on before the pull and it never dropped. `openAtPull` cannot reach
				// it — `combatantinfo` does not list it — so without this the aura fires all pull and draws
				// nothing, which is precisely what the sweep beside this file exists to catch.
				openOnRefresh: true,
			}),
		);

	/**
	 * **Every declared aura the player carried, not a hand-picked handful.**
	 *
	 * The first version of this named nine auras it thought were interesting, and a reader immediately
	 * found what that costs: Synapse Springs is declared, fires on real pulls, and drew no bar anywhere,
	 * along with most of the rest of the table. A list of interesting auras is a list somebody has to
	 * keep, and the way it fails is silent — the aura is declared, the model knows its name and its
	 * duration, and the chart simply never asks for it.
	 *
	 * So the rule is inverted: every aura in the registry gets a lane, and anything left out is left out
	 * here, by name, with a reason. That is the shape `drawnAuras.test.ts` enforces on the other two
	 * specs — which Protection still has no version of, and which is exactly the guard that would have
	 * caught the nine-aura list.
	 */
	/**
	 * The raid cooldowns somebody else presses, drawn **one row per caster** rather than merged.
	 *
	 * The same treatment the Elemental gives them, and generic for the reason a reader gave: these are
	 * raid buffs and every spec should show them the same way. Merged into one row they answer only "was
	 * it up", which loses the question a reader is asking at this grain — two warriors staggering their
	 * banners cover twice the pull, and one warrior pressing twice does not. `raidSourceLanes` resolves
	 * a pet to its owner, so two totems from one shaman stay one row.
	 *
	 * Off the raid-scoped stream, because the caster is somebody else: the player-scoped walk knows the
	 * buff landed and cannot say who sent it.
	 */
	const RAID_SOURCE_AURAS = ['stormlash-totem', 'skull-banner'];
	const raidLanes = raidSourceLanes(
		raidScoped(h.events),
		registry.auras.filter((aura) => RAID_SOURCE_AURAS.includes(aura.key)),
		{ t0: h.t0, pullMs: h.duration, actorID: h.actor.id, actors: h.actors },
	);

	const LANE_ABSENT = new Map<string, string>([
		// Drawn per caster instead — see `RAID_SOURCE_AURAS`. A merged row would say the buff was up and
		// lose which of two warriors put it there, which is the whole question at this grain.
		...RAID_SOURCE_AURAS.map((key): [string, string] => [key, 'drawn per caster']),
		// Drawn as the Vengeance bar itself, above the presses — see `extraResources`. A second row saying
		// the same stack was up would be the same measurement twice.
		['vengeance', 'drawn as its own resource bar'],
		// One row per enemy, built below with a `target` so the chart can group them behind its picker.
		['weakened-blows', 'drawn per enemy below'],
		// On the boss rather than on the player: `auraWindows` over the player's own stream finds nothing,
		// and a lane read off the raid stream would be a different measurement wearing this row's name.
		['censure', 'a debuff this spec puts on the enemy'],
		['execution-sentence', 'a debuff this spec puts on the enemy'],
	]);

	/** Procs are read for whether they were spent; everything else for whether it was up. */
	const PROC_AURAS = new Set(['grand-crusader', 'divine-purpose', 'bastion-of-power', 'shield-of-glory']);

	const buffLanes = registry.auras
		.filter((aura) => !LANE_ABSENT.has(aura.key))
		.map((aura) => selfLane(aura, PROC_AURAS.has(aura.key) ? 'proc' : 'buff'))
		// An aura the pull never carried has no window to draw, and an empty row costs a line to say that
		// the player did not have it. The seals are the common case: one is up all pull and the other two
		// never appear.
		.filter((row) => row.windows.length > 0);

	/**
	 * Weakened Blows, one row per enemy that carried it — and the reason this spec has a target lane at
	 * all.
	 *
	 * The debuff is the Paladin's own, applied by the builders, so its rows are a picture of how many
	 * bodies the player was actually working through. Ordered by the damage that enemy took from this
	 * player, the same currency `primaryID` is chosen in, so the row order agrees with the report's own
	 * answer to "which enemy was this pull about" rather than offering a second one. Time carrying the
	 * debuff was the alternative and it ranks a tagged-and-abandoned add above the one the player killed.
	 *
	 * Past the cap the enemies are kept rather than dropped: `hiddenLanes` is what the chart's own
	 * picker offers, and a reader who wants the seventh add can only be given it if it survived here.
	 *
	 * ## Three filters, two of which move a number on the committed captures
	 *
	 *   - **Bucketed per `(targetID, targetInstance)` and merged per enemy afterwards.** WarcraftLogs
	 *     hands one actor id to an NPC *type*, so a pass keyed on `targetID` alone gives `auraWindows`
	 *     several spawns' applies and removes interleaved into one stream, where each remove closes
	 *     whichever window happens to be open and every apply arriving while one is open is dropped.
	 *     The Windwalker's Rising Sun Kick walk records 17.4 seconds of coverage lost to exactly this
	 *     and `dotWindowsBySpawn` in the Elemental argues it at length. **It is not hypothetical here:**
	 *     the debuff's events name 21, 10, 8, 7 and 7 enemy ids across the five captures but 72, 10,
	 *     10, 1 and 1 spawn keys, and 217 of `spoils.json`'s 286 debuff events carry an instance
	 *     number. Keyed on the id alone that pull draws **496.0s** of debuff where the spawns say
	 *     536.4s, and `garrosh.json` 162.7s against 166.6s.
	 *   - **A friendly is not an enemy, however it got hit.** `analyseCore` drops a hit on a target the
	 *     log positively declares a `Player` or a `Pet` from every count it publishes, and a drawn row
	 *     the enemy count refuses to see would be a second answer to "how many things were there".
	 *     `garrosh.json` is the pull that makes it real: three of its eight debuffed bodies are actors
	 *     16, 20 and 46 — raiders the boss had taken, which the Paladin then had to hit — and the
	 *     block goes from eight rows to five with them out.
	 *   - **`e.sourceID === h.actor.id`.** Weakened Blows is a shared debuff — a warrior's Thunder Clap
	 *     and a monk's Keg Smash write the same 115798 — so a row labelled "this Paladin's" has to say
	 *     so rather than inherit it from how the events were fetched. Measured, it removes nothing: all
	 *     840 of the debuff's events across the five captures are already sourced to actor 29, because
	 *     the fetch is scoped to this player. That is a fact about these captures and not about the
	 *     mechanic, which is the whole reason the filter is written down.
	 *
	 * **`openOnRefresh` is deliberately not passed**, which is where this parts company with the
	 * Windwalker's walk. There it recovers 42.3 seconds, because a refresh arriving with nothing open is
	 * proof the debuff was up and the application that started it never reached the stream. Here the
	 * source filter above already means every application this walk can see is one it also saw start:
	 * the five captures carry 22, 10, 9, 7 and 4 refreshes and **not one of them is an orphan**, so the
	 * option is worth exactly 0.0s on every committed pull. Turning it on would be a switch nothing in
	 * the tree could tell had been thrown.
	 *
	 * A fourth copy of the same bucket-and-merge is not what this should be, and the docblock says so
	 * rather than pretending otherwise: the Windwalker has one inline (`rskByInstance`) and the Elemental
	 * has `dotWindowsBySpawn`, and the two differ only in the fields they publish. The shared walk
	 * belongs in `lib/analysis/auras.ts` beside `auraWindows`, and moving it there is a change to two
	 * specs' measured figures rather than to this lane's drawing — so it is named here as the next
	 * lane's work instead of being smuggled into this one.
	 */
	const weakenedBlows = (() => {
		const aura = registry.aura('weakened-blows');
		const ids = new Set(aura.ids);
		// Written the way `analyseCore` writes it, and for the reason it gives: an id absent from the
		// actor list is *unknown* rather than friendly, so what is excluded is what the log positively
		// declared, never everything it failed to declare an enemy.
		const friendly = new Set(h.actors.filter((a) => a.type === 'Player' || a.type === 'Pet').map((a) => a.id));
		const bySpawn = new Map<string, { target: number; spawn: WclEvent[] }>();
		for (const event of h.events) {
			const id = abilityIdOf(event);
			if (id === null || !ids.has(id) || !isAuraEvent(event)) continue;
			if (event.sourceID !== h.actor.id) continue;
			const target = event.targetID;
			if (target === undefined || friendly.has(target)) continue;
			const key = instanceKey(target, event.targetInstance);
			const bucket = bySpawn.get(key);
			if (bucket) bucket.spawn.push(event);
			else bySpawn.set(key, { target, spawn: [event] });
		}
		// Walked per spawn, kept per enemy: two copies of an add carrying the debuff at once is the enemy
		// covered, not twice covered, and `mergeIntervals` is what says so. The union is also the only
		// honest reading of a row labelled with one name.
		const perTarget = new Map<number, Interval[]>();
		for (const { target, spawn } of bySpawn.values()) {
			const spans = mergeIntervals(toIntervals(auraWindows(spawn, aura, h.t0, h.fight.endTime)));
			const gathered = perTarget.get(target);
			if (gathered) gathered.push(...spans);
			else perTarget.set(target, [...spans]);
		}

		const damage = damageByTarget(h.damageEvents);
		// The report's actor list is the only thing that can name an enemy — `enemyNPCs` carries ids and
		// gameIDs and no names. An id it cannot answer for stays null and the chart labels it as an
		// unnamed enemy carrying that id, which is the truth; a row named after the wrong add is worse.
		const named = (id: number): string | null => h.actors.find((actor) => actor.id === id)?.name ?? null;
		const rows = [...perTarget]
			.map(([id, spans]) => ({
				id,
				name: named(id),
				damage: damage.get(id) ?? 0,
				windows: mergeIntervals(spans).map(([start, end]): Window => ({ start, end })),
			}))
			// An enemy whose only trace is a stray event has no window to draw, and an empty row costs a
			// line to say that the add existed.
			.filter((row) => row.windows.length > 0)
			.sort((a, b) => b.damage - a.damage || (a.windows[0]?.start ?? 0) - (b.windows[0]?.start ?? 0));

		const toLane = (row: (typeof rows)[number]): AuraLane => ({
			...lane(aura, 'debuff', row.windows),
			target: { id: row.id, name: row.name, primary: row.id === h.primaryID },
		});
		return {
			drawn: rows.slice(0, WEAKENED_BLOWS_LANES).map(toLane),
			hidden: rows.slice(WEAKENED_BLOWS_LANES).map(toLane),
		};
	})();
	// --------------------------------------------------------------------------------------- the ladder
	/**
	 * Consecration's dot as windows, because at this spec's haste it is not the same clock as its cooldown.
	 *
	 * The rung reads `NOT dotIsActive(26573)`, and a transcription that leaned on readiness instead would
	 * be right only at zero haste: the cooldown is inside Sanctity of Battle's mask and the dot is not —
	 * nine ticks of one second, `sim/paladin/protection/consecration.go:44-45` — so at the 50% this spec
	 * targets the button returns in six seconds while the ground is still burning for another three.
	 *
	 * Built from the player's own presses rather than from the ticks, and the two are not the same
	 * measurement: a tick stream says where the damage landed, and a re-cast *replaces* the ground effect
	 * rather than stacking with it, so a window is a press and the nine seconds after it, clipped by the
	 * next press. Ticks would have to be grouped back into runs to say the same thing, and a pull whose
	 * Consecration hit nothing — every add dead, the boss out of reach — would come back with no dot at
	 * all when the ground was plainly lit.
	 *
	 * **No `present` gate on the rung that reads this**, unlike every other condition in the ladder. The
	 * windows come from the player's own cast list, which the log always carries, so an empty set is the
	 * real answer "you never pressed it" and not "the log could not say" — and the honest reading of that
	 * answer is that the list wanted the button, which is exactly what `active` returning false produces.
	 */
	const consecrationDot = ((): Window[] => {
		const ability = registry.ability('consecration');
		const presses = h
			.castTimes(ability)
			.slice()
			.sort((a, b) => a - b);
		return presses.map((at, index) => ({
			start: at,
			end: Math.min(at + CONSECRATION_DOT_MS, presses[index + 1] ?? h.duration, h.duration),
		}));
	})();

	/**
	 * When the pull held something in execute range, and whether it could be asked at all.
	 *
	 * Hammer of Wrath's rung is written unconditionally in every preset because the *spell* carries the
	 * gate. See `lib/analysis/execute.ts` for what is measured and for the one place it departs from the
	 * simulator's single target.
	 *
	 * **Two keys and not one**, which is the whole reason `readable` exists: an empty window set and an
	 * unreadable stream are opposite facts, and the engine's `present` reads both as "never went up". So
	 * the readability travels as its own full-pull window and the rung asks that one first. Without it a
	 * log with no enemy health would answer "not in execute" at every global and charge the two Sacred
	 * Shield rungs and the level-90 talents underneath with faults nobody could check.
	 */
	const execute = executeWindows(h.damageEvents, EXECUTE_HEALTH_PCT, h.t0, h.duration);

	/**
	 * The aura windows the ladder's conditions read, by the key each rung names.
	 *
	 * Off the lanes the audit already built rather than re-walked, so the ladder and the timeline cannot
	 * disagree about when a proc was up. `laneWindows` is a lookup into that same list; an aura the pull
	 * never carried is simply absent, which is what makes `present` mean "went up at some point".
	 */
	const laneWindows = (key: string): readonly Window[] | undefined => buffLanes.find((row) => row.key === key)?.windows;
	const aplAuras: AplInputs['auras'] = {
		...(laneWindows('avenging-wrath') === undefined ? {} : { 'avenging-wrath': laneWindows('avenging-wrath') }),
		...(laneWindows('grand-crusader') === undefined ? {} : { 'grand-crusader': laneWindows('grand-crusader') }),
		...(laneWindows('holy-avenger') === undefined ? {} : { 'holy-avenger': laneWindows('holy-avenger') }),
		...(laneWindows('sacred-shield') === undefined ? {} : { 'sacred-shield': laneWindows('sacred-shield') }),
		'consecration-dot': consecrationDot,
		'execute-window': execute.windows.map(([start, end]) => ({ start, end })),
		// The readability flag, as a window covering the pull — see `execute` above.
		'enemy-health-read': execute.readable ? [{ start: 0, end: h.duration }] : [],
	};

	const aplInputs: AplInputs = {
		casts: h.marks,
		// Neither bar, and neither is a stub: both holy power spenders are off the GCD for this spec, so
		// no rung on this ladder is paid for from a bar and `affordable` never consults one. `barsRequired`
		// below is the same statement to the engine.
		energy: { max: 0, points: [] },
		chi: { max: 0, points: [] },
		regenPerSec: 0,
		gcdMs: GCD_MS,
		pullMs: h.duration,
		auras: aplAuras,
		fofChannelSec: 0,
		targetsAt: h.aplTargetCountAt,
		// The tree, for the five talent-gated rungs — and Sanctified Wrath is the reason it is read rather
		// than inferred: that rung's button is Judgment, which every Paladin has, so the press proxy can
		// never answer it. See `TALENT` in `./apl`.
		knownTalents: readTalents(h.events, h.actor.id),
		// The first ladder in this tree whose cooldowns move, and the reason the engine gained a clock.
		// Memoised through `curve`, which the audit already built: `cooldownDrift` asks the same question
		// per press and rebuilding the curve for each would walk the Bloodlust stream a few dozen times.
		cooldownMsAt: (id, at) => {
			const ability = registry.abilityByCastId(id);
			return ability === undefined ? 0 : curve.cooldownMsAt(ability, at);
		},
		barsRequired: false,
		unarbitrated: UNARBITRATED,
	};
	const apl = aplAudit(aplInputs, LADDER);
	const aplForced: Partial<Record<Band, AplAudit | null>> = {};
	for (const band of ALL_BANDS) {
		aplForced[band] = aplAudit({ ...aplInputs, forceBand: band }, LADDER);
	}

	const enforced = enforcedDowntime({
		encounterID: h.fight.encounterID,
		events: h.events,
		actorID: h.actor.id,
		phases: h.phases,
		t0: h.t0,
		endTime: h.fight.endTime,
		durationMs: h.duration,
	});

	return {
		/**
		 * The curve's own three terms, with the pull's presses asked whether they agree.
		 *
		 * `buildHasteCurve` leaves `check` null because it has no press stream to look at, and this is the
		 * first caller in the tree that has one. The spread rather than a mutation because `HasteMeasure`
		 * is the curve's, not ours — `cooldownAt` hands the same memoised curve to every drift figure on
		 * the page, and an audit that reached in and set a field on it would be editing the thing the cast
		 * table was built from.
		 */
		haste: { ...curve.measure, check: checkHaste(curve, checkPresses(h)) },
		measuredGcd: h.measuredGcd,
		globals: globalsOf(h, enforced),
		/**
		 * The two fields `analyseCore` reads back off an audit, rather than merges blindly.
		 *
		 * `wastedGcds` is nought and is a claim rather than a placeholder: it is the count of presses
		 * that occupied a global and bought nothing, and the Windwalker can say that of a Tiger Palm
		 * because the same global had a strictly better press available on the same terms. Nothing in a
		 * Protection rotation is that — every generator returns holy power, so a press the ladder
		 * wanted elsewhere still bought something, and charging it as wasted would double-count what
		 * the priority ledger already says about it.
		 *
		 * `channelSec` is nought because this spec channels nothing.
		 */
		cpm: { wastedGcds: 0, channelSec: 0 },
		/**
		 * No fault ledger yet, and empty rather than absent because the shape is the seam.
		 *
		 * The ledger lists what the *sections* found, one row per kind with a link back to the moment,
		 * and this spec's two sections find nothing itemisable: a globals count is a total and an
		 * enforced window is the encounter's rather than the player's. The rows arrive with the priority
		 * ledger, which is the first thing here that can point at a press and say what was wrong with it.
		 */
		misses: [],
		/**
		 * The priority list run against the pull, press by press, and the same walk forced to each band.
		 *
		 * See `./apl` for the list, what it excludes and why, and the two windows the log is asked for.
		 * `aplForced` is precomputed for the reason the other two specs precompute theirs: the inputs —
		 * the aura windows, the cast marks, the haste curve — are not on `Analysis`, so answering the
		 * reader's target-count override in the browser would mean shipping the engine to the client.
		 */
		apl,
		aplForced,
		/**
		 * The presses, and the rows drawn above them.
		 *
		 * `marks` straight through — the core built them and this audit decorates none of them. The lanes
		 * beside them are new: this field shipped as `lanes: []`, which drew the press rows and nothing
		 * above them, and an empty lane list is what `drawnAuras.test.ts` exists to argue with. Every aura
		 * the pull puts on the player wants a row or a stated reason.
		 *
		 * `hiddenLanes` and `hiddenTargets` are written only where there are any, so a pull whose enemies
		 * all fit under the cap serialises exactly as it did before. They are the chart's picker rather
		 * than a second measurement: `lanes` ++ `hiddenLanes` is the full per-enemy set in the order the
		 * cut left it in.
		 */
		timeline: {
			casts: h.marks,
			lanes: [...buffLanes, ...raidLanes.drawn, ...weakenedBlows.drawn],
			...(weakenedBlows.hidden.length + raidLanes.hidden.length === 0
				? {}
				: {
						hiddenLanes: [...raidLanes.hidden, ...weakenedBlows.hidden],
						hiddenTargets: weakenedBlows.hidden.length,
					}),
		},
		fight: {
			encounter: enforced.profile?.name ?? null,
			noteKey: enforced.profile?.noteKey ?? null,
			rules: enforced.rules.map(({ rule, windows, ms }) => ({
				key: rule.key,
				name: rule.name,
				basis: rule.basis,
				source: rule.source,
				evidence: rule.evidence,
				windows: windows.map(([start, end]) => ({ start, end })),
				ms,
			})),
			enforcedMs: enforced.ms,
		},
		/**
		 * Vengeance, read rather than modelled: the log carries the player's attack power on most
		 * events, so the curve is a measurement and the simulator is consulted only for the ceiling.
		 *
		 * Rallying Cry is the one health buff these pulls carry and it lands on all three, so the
		 * ceiling genuinely moves — see `capWindows`. Ancestral Vigor is passed too because a healer
		 * who happened to bring it would move it the same way, and its absence here is a fact about
		 * these captures rather than about the mechanic.
		 */
		vengeance: readVengeance({
			events: h.events,
			actorID: h.actor.id,
			t0: h.t0,
			durationMs: h.duration,
			stamina: h.gear.stamina,
			healthBuffs: [
				{
					name: registry.aura('rallying-cry').name,
					multiplier: 1.2,
					windows: auraWindows(own, registry.aura('rallying-cry'), h.t0, h.fight.endTime),
				},
				{
					name: registry.aura('ancestral-vigor').name,
					multiplier: 1.1,
					windows: auraWindows(own, registry.aura('ancestral-vigor'), h.t0, h.fight.endTime),
				},
			],
		}),
		/**
		 * The externals the raid could have put on this tank, and which of them landed.
		 *
		 * `raidScoped` is written out here rather than left implicit, because the walk behind it buckets by
		 * caster and that is meaningless on a stream narrowed to one actor. The stream is the player's own
		 * fetch, which is exactly why the brand matters: it carries every actor that touched this player,
		 * so it answers "who put this on me" honestly and cannot answer "who put this on anyone else" at
		 * all. See the module header for what follows from that.
		 *
		 * `fight.friendlyPlayers` and not `h.actors`: the first is the twenty-five who were in this pull,
		 * the second is the thirty-nine who were in the report. Gating on the second would offer this raid
		 * cooldowns from people who had logged off.
		 */
		externals: readExternals(raidScoped(h.events), {
			t0: h.t0,
			pullMs: h.duration,
			actorID: h.actor.id,
			actors: h.actors,
			friendlyPlayers: h.fight.friendlyPlayers ?? [],
		}),
	};
}

export const PROTECTION_SPEC: SpecConfig = {
	specName: 'Protection',
	registry,
	// The floor rather than the base, and the two are 500ms apart. `analyseCore` caps its measured
	// median at this, and Sanctity of Battle puts every geared pull on the floor — so a cap of 1500
	// here would let a mis-measured median through as a plausible number.
	gcdMs: GCD_MS,
	extraNames: EXTRA_NAMES,
	extraGlobals: EXTRA_GLOBALS,
	/**
	 * A points bar, and the first one in this tree the log reports **in full**.
	 *
	 * Holy power arrives in whole units from a button that was pressed, so its fault is a count — a
	 * return the cap refused — rather than a duration spent full. What makes this bar different from
	 * chi is that every one of its four generators emits a `resourcechange` carrying its own amount and
	 * its own `waste`, so the audit reads the bar rather than rebuilding it. The amounts below are the
	 * fallback for a log that reports nothing, and every one of them is *wrong* on a real pull in two
	 * ways this spec cannot model from a press alone:
	 *
	 *   - **A generator that did not land pays nothing.** Iron Juggernaut, 43 Crusader Strikes, 38 gains
	 *     — five were dodged. The log emits no event for those; a flat table credits them anyway.
	 *   - **Holy Avenger pays three.** Its 18 seconds turn every generator into a triple, and the log
	 *     says so outright (`resourceChange: 3`). The same 98-press pull generated 128, not 98.
	 *
	 * Together they made the walk report 2 wasted where the log's own `waste` sums to none. See
	 * `chiWasted`, which now takes the split.
	 *
	 * `reportedAs` on two of the four, because a Paladin's passives are what pay rather than the button:
	 * Judgment presses under 20271 and is paid by **Judgments of the Wise** (105427), and Avenger's
	 * Shield presses under 31935 and is paid by **Grand Crusader** (98057) — which is also why only
	 * 18 of 28 presses on the Fallen Protectors capture returned anything at all.
	 */
	resources: {
		/**
		 * **Holy power is not in `classResources`**, which is the fact this whole declaration rests on and
		 * the reason the bar is read the way it is. A Protection Paladin's samples there carry mana and
		 * nothing else, so the walk that rebuilds a Windwalker's energy curve finds no bar at all. What the
		 * log carries instead is every *change* to it, as `resourcechange` events — each one naming the
		 * amount, the ceiling (`maxResourceAmount`, 5) and the overflow.
		 *
		 * So the ceiling is read off the events rather than declared: a constant for it existed here and
		 * was never consulted, because the log states it on every gain and a hardcoded 5 could only ever
		 * disagree with that.
		 */
		holyPower: {
			type: SECONDARY_RESOURCE_TYPE.holyPower,
			kind: 'points',
			gains: [
				{ abilityKey: 'crusader-strike', amount: 1 },
				{ abilityKey: 'hammer-of-the-righteous', amount: 1 },
				{ abilityKey: 'judgment', amount: 1, reportedAs: 105_427 },
				{ abilityKey: 'avengers-shield', amount: 1, reportedAs: 98_057 },
			],
		},
	},
	colors: { primary: CLASS_COLOR.paladin },
	thresholds: {
		targetWindowMs: TARGET_WINDOW_MS,
		multiTargetSharePct: MULTI_TARGET_SHARE_PCT,
		singleTargetSharePct: SINGLE_TARGET_SHARE_PCT,
		engagedGapMs: ENGAGED_GAP_MS,
	},
	/**
	 * Vengeance on the cast timeline, above the holy power bar.
	 *
	 * Read off the audit rather than measured again — `audit()` has already built it — and placed first
	 * so it draws as the top lane. The two together are the pull's whole economy from both ends: holy
	 * power is what the player's presses earned, and this is what the fight paid them for standing in
	 * front of it.
	 */
	extraResources: (h, audit) => ({
		vengeance: vengeanceBar((audit as unknown as ProtectionAudit).vengeance),
	}),
	/**
	 * The shared list, and this spec used to answer `() => new Set()` — a stub that read as unfinished
	 * and was very nearly right for the wrong reason.
	 *
	 * The one rule on the list is Siegecrafter Blackfuse's Automated Shredder, which the Windwalker
	 * excludes because a non-tank does 10% damage to it. **A tank is the exception to that reduction and
	 * is not an exception to the rule**, which is the thing worth having written down twice: a Protection
	 * Paladin genuinely can hurt a Shredder and the Electrostatic Charge debuff is the mechanic they do
	 * it under, but they are on it *alone* and killing it with a single-target rotation, because nobody
	 * else can touch it. Counting it would push the pull into the cleave or area band and start expecting
	 * area buttons the player was right not to press. `game/multiTargetActors.ts` carries the evidence
	 * and the full argument; read it before deciding a tank should be counting Shredders.
	 *
	 * No committed Protection capture is a Blackfuse pull, so this resolves to the empty set on all five
	 * and changes no figure in the tree. It changes what the spec *means* by answering nothing.
	 */
	ignoredMultiTargetActors: ignoredMultiTargetActorIDs,
	/**
	 * The two ground effects, kept out of the count the priority ladder bands on.
	 *
	 * **This is the first thing in this spec to consume its own declared area damage, and until it went
	 * in `aplCounts` was `counts` — the same array under two names.** `analyseCore` publishes both
	 * deliberately: `counts` is the evidence series a reader is shown, `aplCounts` is what a band
	 * question has to read, and for a spec declaring nothing here the second says nothing at all.
	 *
	 * ## Why these two and not the third
	 *
	 * Consecration and Light's Hammer are laid on the ground and tick on whatever is standing in them.
	 * Neither chooses a body: the press picks a patch of floor, and the number of things it lands on is
	 * a fact about where the raid happened to be. Counting those ticks as evidence of fan-out lets the
	 * ladder cite the button to itself — "the ground hit four, so the pull is an area pull, so press
	 * more ground" — which is the argument the Windwalker's `aplTargetCountExclude: ['rushing-jade-wind']`
	 * already makes for the wind, in a spec whose own docblock calls it the structural case.
	 *
	 * **Hammer of the Righteous stays in, and it is not a free choice.** Its cleave (88263) reaches the
	 * three enemies beside a target the *player* picked, and a fan-out the player aimed is exactly the
	 * evidence a band question wants. Priced rather than assumed: adding it takes the ladder's
	 * multi-target share on `spoils.json` from 83.5% to 76.2% and its peak from 11 to 9, on
	 * `fallenProtectors.json` from 95.8% to 94.9% — enough to move that pull's whole-pull segment from
	 * `aoe` to `mixed` — and on `garrosh.json` from 8.8% to 7.8%. So leaving it in is worth several
	 * points on the pulls that cleave hardest, and the reason it is worth them is the aiming, not the
	 * size of the number.
	 *
	 * ## What it moves, on the five committed captures
	 *
	 * Consecration's ticks (81297) are the single largest event source the Paladin produces: 719, 544,
	 * 500, 352 and 153 damage events, first by a wide margin on every pull. Light's Hammer (114919)
	 * lands on two of the five and is small beside it.
	 *
	 *     pull                evidence   ladder before   after Consecration   after both   peak
	 *     fallenProtectors      99.9 %          99.9 %              96.8 %        95.8 %    8 → 7
	 *     galakras              52.6 %          52.6 %              34.2 %        34.2 %    5 → 4
	 *     garrosh               15.8 %          15.8 %               8.8 %         8.8 %    8 → 7
	 *     paragons              82.7 %          82.7 %              42.9 %        42.9 %    4 → 3
	 *     spoils                88.1 %          88.1 %              84.7 %        83.5 %   15 → 11
	 *
	 * Light's Hammer moves only the two pulls it was talented on — 96.8 → 95.8 and 84.7 → 83.5 — and it
	 * is declared beside Consecration because it is the same kind of thing rather than because of what
	 * it is worth here.
	 *
	 * **The reader's own figure does not move, and that is the design rather than a limitation.**
	 * `multiTargetPct` and `detected` are taken off `counts`, so all five pulls read what they read
	 * before: four multi, `garrosh` single. What changes is the series a rung is chosen on, and there
	 * it changes a great deal — `paragons` goes from an area pull for four fifths of its length to one
	 * for two fifths, and its segment cut goes from `mixed aoe cleave mixed cleave aoe mixed aoe single
	 * cleave single` to `mixed mixed single mixed single aoe mixed cleave single`.
	 *
	 * **Nothing this spec grades reads either series yet**, which is why this lands as a correction to a
	 * seam rather than as a change to a score: `score.ts` grades two metrics and neither declares
	 * `bands`. The exclusion is right whether or not anything is looking, and the day a rung is graded
	 * it will be graded on a count that Consecration cannot inflate.
	 */
	aplTargetCountExclude: ['consecration', 'lights-hammer'],
	needsTarget: NEEDS_TARGET,
	samePressMs: SAME_PRESS_MS,
	potion: {
		abilityKey: 'potion-of-mogu-power',
		auraKey: 'potion-of-mogu-power',
		slots: POTION_SLOTS,
		categoryCooldownMs: POTION_CATEGORY_CD_MS,
	},
	/**
	 * The first spec to declare one, and the reason the seam exists.
	 *
	 * Memoised per dataset rather than per call. `cooldownDrift` asks once per press, and rebuilding a
	 * curve — which means re-reading `combatantinfo` and re-walking the Bloodlust stream — for every
	 * press of every button would be the whole event list walked a few dozen times over.
	 */
	cooldownAt: (dataset: FightDataset, ability: Ability, t: number): number =>
		curveForDataset(dataset).cooldownMsAt(ability, t),
	identify,
	audit: protectionAudit as unknown as SpecConfig['audit'],
	settings: PROTECTION_SETTINGS,
};

/** The full analysis of one fight for one Protection paladin. */
export function analyse(
	dataset: FightDataset,
	settings: AnalysisSettings = defaultSettings(PROTECTION_SETTINGS),
): Analysis {
	return analyseCore(dataset, settings, PROTECTION_SPEC);
}
