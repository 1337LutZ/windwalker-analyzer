// The raid buffs a player's damage actually depends on, grouped by *effect* rather than by spell.
//
// Grouping is the whole point. Five classes bring the same +10% attack power, four bring the same
// +5% critical strike, and a report with a row per spell is a report that cannot answer the only
// question worth asking — "did I have it". `sim/core/buffs.go` is organised the same way, by the
// exclusive-effect category each buff registers into (`makeExclusiveBuff` →
// `aura.NewExclusiveEffect(stat.StatName()+"Buff", …)`), and that grouping is copied here rather
// than invented: two providers of one effect do not stack in the sim, so two providers in the log
// are one row.
//
// **Which effects matter is a fact about a spec; which spells supply one is a fact about the game.**
// Only the second is in this module. `EFFECTS` below is every effect the simulator groups and every
// spell it accepts as a source, and `readRaidBuffs` measures all of them. A spec then declares the
// ones its own damage rests on — `SpecDefinition.raidBuffEffects`, written in its own
// `lib/view/raidBuffs.ts` — and `narrowRaidBuffs` at the bottom is where the two meet.
//
// That seam is not decoration. This section reports **gaps**, so an effect a spec cannot use becomes
// a fault its reader cannot fix: for six rows and two specs, an Elemental Shaman was being told to
// chase a multiplier on attack power, and had no row at all for the +10% spell power that is the
// largest single multiplier on their damage.
//
// What this module will not do is grade. It reports what the log carried and says plainly when the
// log carried nothing, because those are different facts and the difference is the point — see
// `NOT REPORTED` below.

import { abilityIdOf, isAuraApply, isAuraEvent, isCombatantInfo, isDeath, type WclEvent } from '~/lib/events';
import type { Aura } from '~/lib/game/model';
import type { RaidBuffRow, RaidBuffSummary } from '~/lib/types';

import { auraWindows, toIntervals } from './auras';
import { mergeIntervals, unionMs, type Interval } from './intervals';

/** One spell that supplies an effect: the id WarcraftLogs logs on the buffed player, and its name. */
interface Provider {
	id: number;
	name: string;
}

/** One of the simulator's exclusive-effect categories, and every spell that registers into it. */
interface EffectGroup {
	/** Locale key under `raidBuffs.effects`, and the row's React key. */
	key: string;
	providers: Provider[];
}

/**
 * What one spec declares about one effect: that its damage rests on it, which icon stands for it, and
 * whether the spec supplies it itself.
 *
 * Both fields are judgements about a spec rather than facts about the game, which is why they are
 * declared per spec and not in the table below. They used to be fields of that table with one spec's
 * answers written into them — `iconId` documented as "the one a Windwalker is most likely to
 * recognise", `selfProvided` as "true when a Monk supplies this effect themselves" — so the second
 * spec to be added read the first spec's report card.
 *
 * `selfProvided` is the one that actually misleads a reader, and it inverts almost completely between
 * the two specs the app ships. Wrong, it turns "the raid did not have this" into "you failed to press
 * this" — the fabricated indictment the rest of this module is built to avoid.
 */
export interface RaidBuffEffect {
	/** An effect key from `EFFECTS`. `RAID_BUFF_EFFECT_KEYS` is the list, and a test holds specs to it. */
	key: string;
	/**
	 * The spell whose icon stands for the whole effect when the log did not say which provider it was.
	 *
	 * The one *this spec's* reader is most likely to recognise: their own press where they have one, the
	 * commonest raid source otherwise.
	 */
	iconId: number;
	/** True when this spec supplies the effect itself, which makes a gap in it the player's own. */
	selfProvided: boolean;
}

/**
 * Every effect the simulator groups, and every spell it accepts as supplying each.
 *
 * In `applyBuffEffects`' own order — attack power, melee haste, spell power, spell haste, crit,
 * mastery, all-stats (sim/core/buffs.go:95-186) — so the two can be read side by side. That is not the
 * order any report draws: a spec's own `raidBuffEffects` decides that, and neither spec the app ships
 * puts attack power first.
 *
 * Every id and every grouping below is read out of the checked-out wowsims-mop tree rather than from
 * memory, because "which buffs matter" is exactly the kind of thing that is remembered wrong:
 *
 *   - the seven groups and their members are the `if raidBuffs.X` blocks of `applyBuffEffects`;
 *   - the multipliers quoted in the copy are the `StatConfig` values beside them.
 *
 * The ids are the simulator's `ActionID{SpellID: …}`, which is the id the *caster* presses. That is
 * the same number WarcraftLogs logs on the buffed player for every provider checked against three
 * real Mists pulls — with exactly one exception, Legacy of the Emperor, whose cast id (115921) and
 * applied-aura id (117666) differ, so both are listed. Where a provider's aura id turns out to
 * differ elsewhere the effect reads "not reported" rather than a wrong number, which is the safe
 * direction: this report would rather say nothing than invent a fault.
 */
/**
 * Exported for one guard only — `__tests__/raidBuffIcons.test.ts` asserts every provider here resolves
 * in the generated spell map. Nothing else should read it: the shared pass builds a row per group and
 * `narrowRaidBuffs` is what a spec's section calls.
 */
export const EFFECTS: EffectGroup[] = [
	{
		// +10% attack power — `{stats.AttackPower, 1.1, true}`, sim/core/buffs.go:306-352. Ten, not the
		// five it is often quoted as; the multiplier is read off the simulator, not recalled.
		//
		// A multiplier on the *stat*, and pets do not inherit it — `fireElementalStatInheritance` hands a
		// pet `ownerStats[SpellPower]` for every spec but Enhancement
		// (sim/shaman/fire_elemental_pet.go:165-175). Both paths dead is what makes this the one row a
		// caster genuinely gains nothing from, and the only one the Elemental's list leaves out.
		key: 'attackPower',
		providers: [
			{ id: 57330, name: 'Horn of Winter' },
			{ id: 19506, name: 'Trueshot Aura' },
			{ id: 6673, name: 'Battle Shout' },
		],
	},
	{
		// +10% melee and ranged attack speed — `registerExclusiveMeleeHaste(aura, 1.10)`,
		// sim/core/buffs.go:359-395. It multiplies `PseudoStats.MeleeSpeedMultiplier` and nothing else,
		// so it is auto-attack speed and never a cast, a tick or an energy bar.
		//
		// It is still not a melee-only row, and the reason generalises: **stat scaling and pseudo-stat
		// inheritance are separate paths, and a buff has to be cleared on both before it is called
		// irrelevant.** A pet with `HasDynamicMeleeSpeedInheritance` multiplies its own melee speed by
		// its owner's and stays synced to it, inheriting `MeleeSpeedMultiplier` and
		// `AttackSpeedMultiplier` both (sim/core/pet.go:333-350). All three of the Elemental's pets set
		// that flag — fire_elemental_pet.go:42, earth_elemental_pet.go:31, lightning_elemental.go:29 —
		// and they swing (`AutoSwingMelee: true`, fire_elemental_pet.go:63). So a shaman who never lands
		// a white hit is paid by this anyway, through the pets, and the row is on their list.
		key: 'meleeHaste',
		providers: [
			{ id: 55610, name: 'Unholy Aura' },
			{ id: 128432, name: 'Cackling Howl' },
			{ id: 128433, name: "Serpent's Swiftness" },
			{ id: 113742, name: "Swiftblade's Cunning" },
			{ id: 30809, name: 'Unleashed Rage' },
		],
	},
	{
		// +10% spell power — `{stats.SpellPower, 1.10, true}`, sim/core/buffs.go:124-136, and the four
		// providers at :494-513. The caster's counterpart of the attack-power row above, and it was
		// simply absent: this section held six rows chosen for a Monk, for whom spell power buys nothing,
		// so the broadest multiplier on an Elemental's damage had no row to be missing from.
		//
		// Arcane Brilliance and Still Water are in this group *and* in the crit group below, which is the
		// simulator and not a duplication: one `makeExclusiveBuff` call registers +10% spell power and
		// +5% crit at once, into two separate exclusive categories.
		key: 'spellPower',
		providers: [
			// 1459 is "Arcane Brilliance" in Mists and this name is deliberate, even though WarcraftLogs
			// labels the id "Arcane Intellect" — that is the *modern* spell's name backfilled onto the id by
			// a client the site reads from a later expansion. A reader looking at a MoP pull saw Arcane
			// Brilliance in their buff frame, so the report says Arcane Brilliance. Do not "fix" this to
			// match what the WCL tables print.
			{ id: 1459, name: 'Arcane Brilliance' },
			{ id: 126309, name: 'Still Water' },
			{ id: 77747, name: 'Burning Wrath' },
			{ id: 109773, name: 'Dark Intent' },
		],
	},
	{
		// +5% spell haste — `registerExclusiveSpellHaste(aura, 0.05)`, sim/core/buffs.go:458-486. It
		// calls `MultiplyCastSpeed` (sim/core/unit.go:531), which sets `unit.CastSpeed` and stops there.
		//
		// For a caster that is the whole of it and it needs no argument. For a Monk it needed one, because
		// the usual reason given is wrong: spell haste does NOT move a Windwalker's energy regeneration
		// in this simulator. `energyBar.EnergyRegenPerSecond()` is `10.0 * hasteRatingMultiplier *
		// energyRegenMultiplier` (sim/core/energy.go:97-98), `hasteRatingMultiplier` is rebuilt from
		// `stats.HasteRating` alone (sim/core/energy.go:189) and `energyRegenMultiplier` only moves
		// through `MultiplyResourceRegenSpeed`, which this buff never calls. What it buys a Monk is the
		// channel: Fists of Fury is a `Dot` with `AffectedByCastSpeed: true` and
		// `HasteReducesDuration: true` (sim/monk/ww_fists_of_fury.go:61-62), as is Spinning Crane Kick
		// (sim/monk/spinning_crane_kick.go:76), so five percent off the channel is five percent of that
		// time handed back to the rest of the priority list.
		key: 'spellHaste',
		providers: [
			{ id: 24907, name: 'Moonkin Aura' },
			{ id: 49868, name: 'Mind Quickening' },
			{ id: 51470, name: 'Elemental Oath' },
		],
	},
	{
		// +5% critical strike — and both kinds of it. Every provider registers
		// `{stats.PhysicalCritPercent, 5, false}` *and* `{stats.SpellCritPercent, 5, false}` in one
		// `makeExclusiveBuff` call, sim/core/buffs.go:403-449, which is the whole reason this row belongs
		// to a caster as much as to a melee. It was documented here as physical crit alone.
		//
		// The last two are not a mistake and not padding. In this simulator Arcane Brilliance and Still
		// Water register that crit pair alongside their spell power (sim/core/buffs.go:494-508) and so
		// land in the same exclusive category as Leader of the Pack. A player reading a 5.4 tooltip would
		// not expect a mage to cover this; the model this whole project is built against says they do,
		// and leaving them out would let the report announce a missing buff the simulator considers
		// present — a fabricated fault, which is the one thing it must never print.
		key: 'crit',
		providers: [
			// Two ids for one druid, and the raid-wide one was the missing half. **24932 is the aura the raid
			// gets**: 2,086 applications across 51 of 77 player-report pairs on three anonymous 25H nights.
			// **17007 is the druid's own self-aura** — 58 applications, 3 pairs of 77. The simulator declares
			// only 17007 (`sim/core/buffs.go:406`) and this file followed it, so the row measured the buff for
			// the three druids and reported it absent for the 48 other players who demonstrably had it.
			//
			// `phased.json` carries ability 24932 twice. The fixture was writing the id the model did not
			// declare, which is a gap the committed data could have caught and nothing was asking it to.
			{ id: 24932, name: 'Leader of the Pack' },
			{ id: 17007, name: 'Leader of the Pack' },
			{ id: 90309, name: 'Terrifying Roar' },
			{ id: 24604, name: 'Furious Howl' },
			{ id: 116781, name: 'Legacy of the White Tiger' },
			{ id: 1459, name: 'Arcane Brilliance' },
			{ id: 126309, name: 'Still Water' },
		],
	},
	{
		// +3000 mastery rating — `MasteryRaidBuffStrength`, sim/core/buffs.go:12 and 289-300. Flat
		// rating, not a percentage, which is why it is the one row whose worth depends on the reforge.
		key: 'mastery',
		providers: [
			{ id: 93435, name: 'Roar of Courage' },
			// Both, for the same reason as Leader of the Pack above, and at much lower confidence: the log
			// writes **127830** (3 applications, one report) and never 128997, which the sim declares. Three
			// witnesses settle which id the game writes and settle nothing else, so both stay.
			{ id: 127830, name: 'Spirit Beast Blessing' },
			{ id: 128997, name: 'Spirit Beast Blessing' },
			{ id: 19740, name: 'Blessing of Might' },
			{ id: 116956, name: 'Grace of Air' },
		],
	},
	{
		// +5% Strength, Agility and Intellect — `makeExclusiveAllStatPercentBuff(…, 1.05)`,
		// sim/core/buffs.go:178-190 and 224-239. One buff, three stats, so every spec takes something
		// from it and takes a different thing: Agility is a Windwalker's attack power and their crit,
		// Intellect is an Elemental's spell power and theirs.
		key: 'stats',
		providers: [
			{ id: 20217, name: 'Blessing of Kings' },
			{ id: 1126, name: 'Mark of the Wild' },
			{ id: 115921, name: 'Legacy of the Emperor' },
			// The aura id the same spell lands on the raid as. Observed on a real pull where the monk
			// cast it and 115921 never appeared in the stream at all — without this the Monk's own buff
			// reads as never applied, which is the exact fabricated fault this report refuses to print.
			{ id: 117666, name: 'Legacy of the Emperor' },
			{ id: 90363, name: 'Embrace of the Shale Spider' },
		],
	},
];

/**
 * A placeholder icon for a row nobody has claimed yet: the first provider listed, and nothing more.
 *
 * Every row a report draws gets its icon from the spec's own `RaidBuffEffect`, so this is only ever
 * read on a measured row that no spec asked for. It exists because `RaidBuffRow.iconId` is a required
 * field of the shared analysis type, not because a spec-neutral pass has an opinion about which of
 * five classes a reader recognises. A group is never empty — the type would allow it, the table does
 * not — and 0 is the honest answer if one ever were, since `SpellIcon` draws a placeholder for an id
 * it cannot resolve.
 */
function iconFor(effect: EffectGroup): number {
	return effect.providers[0]?.id ?? 0;
}

/**
 * Each effect's key and the provider ids under it, for the test that holds every spec's declaration
 * against this module.
 *
 * Two ways a `RaidBuffEffect` can be wrong that only a check by *name* catches. A key with no group
 * here measures nothing and drops out of the report silently — the one failure this seam can have. And
 * an `iconId` that is not a provider of the effect it stands for draws the wrong spell beside a row,
 * which nothing rendering the section would notice either.
 */
export const RAID_BUFF_PROVIDER_IDS: ReadonlyMap<string, readonly number[]> = new Map(
	EFFECTS.map((effect): [string, readonly number[]] => [effect.key, effect.providers.map((p) => p.id)]),
);

/** The effect keys a spec may declare — the keys of `RAID_BUFF_PROVIDER_IDS`, so the two cannot drift. */
export const RAID_BUFF_EFFECT_KEYS: readonly string[] = [...RAID_BUFF_PROVIDER_IDS.keys()];

/**
 * Every id the roster above can name, and the spell behind it.
 *
 * Some of these are a player's own presses — Legacy of the Emperor, Legacy of the White Tiger, Burning
 * Wrath — and the cast timeline draws presses. A raid buff does no damage, so it never reaches the
 * damage table the engine's `nameOf` falls back to, and those rows drew as a bare `#115921` until this
 * existed.
 *
 * A second *reading* of `EFFECTS` and emphatically not a second copy of it. The ids are settled above,
 * once, beside the reasoning that settled them — which is what keeps Legacy of the Emperor's two ids
 * (cast 115921, applied aura 117666, the one mismatch in the roster) from being restated somewhere
 * they could drift apart. Add a provider up there and it is named everywhere by that alone.
 */
export const RAID_BUFF_NAMES: ReadonlyMap<number, string> = new Map(
	EFFECTS.flatMap((effect) => effect.providers.map((provider): [number, string] => [provider.id, provider.name])),
);

/** The shortest stretch without a buff worth naming, matching the debuff section's own floor. */
const GAP_MS = 1000;

/** One provider's own instance of an effect: the same spell from two casters is two of these. */
interface Instance {
	provider: Provider;
	/** Report actor id of the caster, or -1 when the log did not name one. */
	source: number;
	/** True when this instance was already running at the pull. */
	fromPull: boolean;
}

/**
 * The auras `combatantinfo` says were on the player at the pull, as `id:source` keys.
 *
 * This is the single most valuable thing in the fetched stream for this section and it costs
 * nothing: the events query is already `dataType: All` filtered to the player, and one
 * `combatantinfo` comes back inside it carrying the pull snapshot — the same event `readGear`
 * reads for equipment.
 *
 * It is not, however, complete. On a captured pull the monk's own Legacy of the Emperor was
 * provably up at the pull (it has a `removebuff` at 73s and no preceding apply) and is simply
 * absent from this list. So it proves presence and never absence, which is precisely why the
 * classification below refuses to turn silence into a zero.
 */
function pullAuras(events: readonly WclEvent[], actorID: number): Set<string> {
	const info = events.find((e) => isCombatantInfo(e) && e.sourceID === actorID);
	const out = new Set<string>();
	if (info === undefined || !isCombatantInfo(info) || info.auras === undefined) return out;
	for (const aura of info.auras) {
		if (typeof aura.ability === 'number') out.add(`${aura.ability}:${aura.source ?? -1}`);
	}
	return out;
}

/**
 * The windows one provider instance was up for, as if the log had been complete.
 *
 * All the window logic stays in `auraWindows`; the only thing done here is to hand it a synthetic
 * `applybuff` stamped at the pull when the instance is known to have started before it. That is
 * what the log would have contained had the buff gone out a millisecond into the pull, and it is
 * the difference between reporting a buff that was up all night and reporting it as never applied:
 * WarcraftLogs emits no `applybuff` for anything cast before the pull, so a raid that buffs in the
 * usual place — before the pull — produces a stream in which the correct answer is invisible.
 */
function instanceWindows(
	events: readonly WclEvent[],
	instance: Instance,
	aura: Aura,
	t0: number,
	fightEnd: number,
): Interval[] {
	const own = events.filter((e) => (e.sourceID ?? -1) === instance.source);
	const seeded: WclEvent[] = instance.fromPull
		? [{ type: 'applybuff', timestamp: t0, abilityGameID: instance.provider.id, sourceID: instance.source }, ...own]
		: own;
	return toIntervals(auraWindows(seeded, aura, t0, fightEnd));
}

/**
 * Every provider instance of one effect that the log says anything at all about.
 *
 * An instance is a `(spell, caster)` pair rather than just a spell, because two hunters running
 * Trueshot Aura log two overlapping lives of one id. Pairing those apply→remove events as a single
 * stream lets one hunter's removal close the other's window and reports a drop that never happened
 * — measured on a real pull, that turned a buff which was up for the whole fight into 69% uptime.
 * Tracked apart and unioned, the survivor covers the gap, which is what actually occurred.
 */
function instancesOf(effect: EffectGroup, events: readonly WclEvent[], atPull: ReadonlySet<string>): Instance[] {
	const ids = new Map(effect.providers.map((p) => [p.id, p]));
	const found = new Map<string, Instance>();

	// Anything the pull snapshot named, whether or not it went on to log a single event.
	for (const [id, provider] of ids) {
		for (const key of atPull) {
			if (!key.startsWith(`${id}:`)) continue;
			const source = Number(key.slice(key.indexOf(':') + 1));
			found.set(key, { provider, source, fromPull: true });
		}
	}

	// Then everything the fight itself logged. An instance whose first event is a refresh or a
	// removal was necessarily already running — neither can happen to an aura that is not up — which
	// is the second, independent proof that a buff predates the pull. Both are needed: the snapshot
	// misses auras that are provably up, and a buff that never drops logs no events at all.
	//
	// Aura events only, and the guard is load-bearing rather than defensive. The stream also carries
	// the `cast` that *applies* one of these, under the caster's id — Legacy of the Emperor logs a
	// `cast` of 115921 at the player — and a cast is not an apply, so the "anything that is not an
	// apply was already running" rule reads it as proof the buff predated the pull. That handed one
	// real pull a phantom instance covering the whole fight and hid a genuine 6.5-second gap.
	for (const e of events) {
		if (!isAuraEvent(e)) continue;
		const id = abilityIdOf(e);
		if (id === null) continue;
		const provider = ids.get(id);
		if (provider === undefined) continue;
		const source = e.sourceID ?? -1;
		const key = `${id}:${source}`;
		if (found.has(key)) continue;
		found.set(key, { provider, source, fromPull: !isAuraApply(e) });
	}

	return [...found.values()];
}

/**
 * Which raid buffs were on the player, one row per effect the simulator groups.
 *
 * **Spec-neutral, and one step short of what a report draws.** Every group in `EFFECTS` gets a row,
 * because this runs inside the shared engine pass, which knows the spec's model but not the spec's
 * registry entry — `narrowRaidBuffs` is the second step, and the section calls it with the spec's own
 * `raidBuffEffects`. Two fields of `RaidBuffRow` therefore cannot be answered here and are filled
 * mechanically for the declaration to replace: `iconId` is the first provider listed, and
 * `selfProvided` is false, since "can this spec cast it" is not a question the stream can answer.
 * `selfGaps` on the summary is 0 for the same reason. `notReported` is honest but counts groups a
 * given spec may not draw, so the section takes its own from the narrowed rows.
 *
 * Takes the whole fetched stream, the way `readGear` does, and narrows it here: the aura work wants
 * only what landed *on* this player, while `combatantinfo` is addressed to them as its source and
 * would be filtered away by the same pass. Narrowing matters — the stream also carries the monk's
 * own Legacy of the Emperor landing on nine other raiders, and letting one of those removals close
 * this player's window would report a drop that happened to somebody else.
 *
 * NOT REPORTED, and why it is not zero. An effect nothing in the log speaks to comes back
 * `notReported`, never as 0% uptime. The two are different claims and only one of them is provable:
 * a buff applied before the pull that never falls off emits no event whatsoever for the entire
 * fight, and the pull snapshot that would otherwise settle it is demonstrably incomplete. Printing
 * a zero there would tell a player their raid dropped a buff that was up all night, which is the
 * fabricated indictment this report exists to avoid. Silence is reported as silence.
 *
 * Uptime is measured against the whole pull, not against engaged time — the opposite of the Rising
 * Sun Kick section, and deliberately. That section excludes intermissions because a debuff cannot
 * be held on a boss nobody can reach, so the drop is the fight's doing rather than the player's.
 * Nothing of the sort applies here: Horn of Winter stays up perfectly well while the boss is
 * untargetable, so every second of the pull is a second the buff could have been running and the
 * pull is the honest denominator.
 */
export function readRaidBuffs(
	events: readonly WclEvent[],
	actorID: number,
	t0: number,
	fightEnd: number,
): RaidBuffSummary {
	const duration = fightEnd - t0;
	const atPull = pullAuras(events, actorID);
	const onPlayer = events.filter((e) => e.targetID === actorID);

	const rows: RaidBuffRow[] = EFFECTS.map((effect): RaidBuffRow => {
		const instances = instancesOf(effect, onPlayer, atPull);

		if (instances.length === 0) {
			return {
				key: effect.key,
				iconId: iconFor(effect),
				providers: [],
				notReported: true,
				uptimeMs: 0,
				uptimePct: 0,
				fromPull: false,
				byPlayer: false,
				selfProvided: false,
				gaps: [],
			};
		}

		const covered = mergeIntervals(
			instances.flatMap((instance) =>
				instanceWindows(
					onPlayer,
					instance,
					// A one-id aura per instance, so `auraWindows` pairs this caster's applies with this
					// caster's removals and nobody else's.
					{ key: effect.key, name: instance.provider.name, ids: [instance.provider.id], kind: 'buff' },
					t0,
					fightEnd,
				),
			),
		);

		// Leading gap included, unlike the debuff section's: a buff that only went out a minute into
		// the pull is the most actionable thing this section can find, and a list that starts at the
		// first application would silently drop it.
		const gaps: Array<{ at: number; seconds: number }> = [];
		let cursor = 0;
		for (const [start, end] of covered) {
			if (start - cursor > GAP_MS) gaps.push({ at: cursor, seconds: (start - cursor) / 1000 });
			cursor = Math.max(cursor, end);
		}
		if (duration - cursor > GAP_MS) gaps.push({ at: cursor, seconds: (duration - cursor) / 1000 });

		const uptimeMs = unionMs(covered);
		return {
			key: effect.key,
			iconId: iconFor(effect),
			// The spells actually seen, deduplicated: two hunters are one Trueshot Aura to a reader.
			providers: [...new Set(instances.map((i) => i.provider.name))],
			notReported: false,
			uptimeMs,
			uptimePct: duration > 0 ? (uptimeMs / duration) * 100 : 0,
			fromPull: instances.some((i) => i.fromPull),
			byPlayer: instances.some((i) => i.source === actorID),
			selfProvided: false,
			gaps: gaps.map((g) => ({ at: g.at, seconds: Math.round(g.seconds * 10) / 10 })),
		};
	});

	return {
		rows,
		// A corpse holds no buffs. Every aura on the player is stripped on death and put back a few
		// seconds after the rez, so a pull with a death in it has a gap in every single row that is
		// nobody's buffing mistake — worth counting so the section can say so rather than letting the
		// reader conclude their raid dropped everything at once.
		deaths: onPlayer.filter((e) => isDeath(e)).length,
		notReported: rows.filter((r) => r.notReported).length,
		// Not `rows.filter(r => r.selfProvided …)`, which would be an assertion whose two sides come from
		// the same hard-coded false. No row above claims a self-provider, so the count is zero by
		// construction; `narrowRaidBuffs` computes the real one once a spec has said what it supplies.
		selfGaps: 0,
	};
}

/**
 * One spec's reading of a measured pull: its own rows, in its own order, with its own two judgements.
 *
 * The other half of the seam described at the top of this module. `readRaidBuffs` measured every
 * effect the simulator groups; this keeps the ones the spec declared, in the order it declared them,
 * and writes the spec's `iconId` and `selfProvided` over the mechanical placeholders. `deaths` is a
 * fact about the pull and passes through; the two counts are recomputed, because a count over rows
 * this spec does not draw is a count of nothing the reader can see.
 *
 * A declared key with no measured row is dropped rather than faked. It can only happen by typo — the
 * keys are `RAID_BUFF_EFFECT_KEYS` — and `lib/spec/__tests__/raidBuffEffects.test.ts` fails on it by
 * name, which is the only place it can be caught loudly: silently drawing a row of zeroes for an
 * effect nothing measured is exactly the fabricated fault this module refuses to print.
 */
export function narrowRaidBuffs(summary: RaidBuffSummary, effects: readonly RaidBuffEffect[]): RaidBuffSummary {
	const measured = new Map(summary.rows.map((row) => [row.key, row]));
	const rows = effects.flatMap((effect): RaidBuffRow[] => {
		const row = measured.get(effect.key);
		return row === undefined ? [] : [{ ...row, iconId: effect.iconId, selfProvided: effect.selfProvided }];
	});

	return {
		rows,
		deaths: summary.deaths,
		notReported: rows.filter((r) => r.notReported).length,
		selfGaps: rows.filter((r) => r.selfProvided && !r.notReported && r.gaps.length > 0).length,
	};
}
