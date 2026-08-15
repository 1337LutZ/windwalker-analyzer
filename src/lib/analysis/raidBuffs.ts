// The raid buffs a Windwalker's damage actually depends on, grouped by *effect* rather than by
// spell.
//
// Grouping is the whole point. Five classes bring the same +10% attack power, four bring the same
// +5% critical strike, and a report with a row per spell is a report that cannot answer the only
// question worth asking — "did I have it". `sim/core/buffs.go` is organised the same way, by the
// exclusive-effect category each buff registers into (`makeExclusiveBuff` →
// `aura.NewExclusiveEffect(stat.StatName()+"Buff", …)`), and that grouping is copied here rather
// than invented: two providers of one effect do not stack in the sim, so two providers in the log
// are one row.
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

interface Effect {
	/** Locale key under `raidBuffs.effects`, and the row's React key. */
	key: string;
	/**
	 * The spell whose icon stands for the whole effect when the log did not say which provider it
	 * was. Chosen as the one a Windwalker is most likely to recognise — their own where they have
	 * one, the commonest raid source otherwise.
	 */
	iconId: number;
	/** True when a Monk supplies this effect themselves, which makes a gap in it the player's own. */
	selfProvided: boolean;
	providers: Provider[];
}

/**
 * The effects, and every spell the simulator accepts as supplying each.
 *
 * Every id and every grouping below is read out of the checked-out wowsims-mop tree rather than
 * from memory, because "which buffs matter" is exactly the kind of thing that is remembered wrong:
 *
 *   - the five stat/AP/haste/crit/mastery groups and their members are the `if raidBuffs.X` blocks
 *     of `applyBuffEffects`, sim/core/buffs.go:92-197, in that function's own order;
 *   - the multipliers quoted in the copy are the `StatConfig` values beside them.
 *
 * The ids are the simulator's `ActionID{SpellID: …}`, which is the id the *caster* presses. That is
 * the same number WarcraftLogs logs on the buffed player for every provider checked against three
 * real Mists pulls — with exactly one exception, Legacy of the Emperor, whose cast id (115921) and
 * applied-aura id (117666) differ, so both are listed. Where a provider's aura id turns out to
 * differ elsewhere the effect reads "not reported" rather than a wrong number, which is the safe
 * direction: this report would rather say nothing than invent a fault.
 */
const EFFECTS: Effect[] = [
	{
		// +5% Strength, Agility and Intellect — `makeExclusiveAllStatPercentBuff(…, 1.05)`,
		// sim/core/buffs.go:224-239. Agility is a Windwalker's attack power and their crit, so this is
		// the broadest of the six.
		key: 'stats',
		iconId: 115921,
		selfProvided: true,
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
	{
		// +10% attack power — `{stats.AttackPower, 1.1, true}`, sim/core/buffs.go:306-352. Ten, not the
		// five it is often quoted as; the multiplier is read off the simulator, not recalled.
		key: 'attackPower',
		iconId: 57330,
		selfProvided: false,
		providers: [
			{ id: 57330, name: 'Horn of Winter' },
			{ id: 19506, name: 'Trueshot Aura' },
			{ id: 6673, name: 'Battle Shout' },
		],
	},
	{
		// +10% melee and ranged attack speed — `registerExclusiveMeleeHaste(aura, 1.10)`,
		// sim/core/buffs.go:359-395. It multiplies `PseudoStats.MeleeSpeedMultiplier` and nothing else,
		// so for a Windwalker it is auto-attack damage; it does *not* touch energy — see below.
		key: 'meleeHaste',
		iconId: 55610,
		selfProvided: false,
		providers: [
			{ id: 55610, name: 'Unholy Aura' },
			{ id: 128432, name: 'Cackling Howl' },
			{ id: 128433, name: "Serpent's Swiftness" },
			{ id: 113742, name: "Swiftblade's Cunning" },
			{ id: 30809, name: 'Unleashed Rage' },
		],
	},
	{
		// +5% spell haste — `registerExclusiveSpellHaste(aura, 0.05)`, sim/core/buffs.go:458-486.
		//
		// It is worth being exact about why this is in a *damage* report, because the usual reason
		// given for it is wrong. Spell haste does NOT move a Windwalker's energy regeneration in this
		// simulator: `energyBar.EnergyRegenPerSecond()` is `10.0 * hasteRatingMultiplier *
		// energyRegenMultiplier` (sim/core/energy.go:97-98), `hasteRatingMultiplier` is rebuilt from
		// `stats.HasteRating` alone (sim/core/energy.go:189) and `energyRegenMultiplier` only moves
		// through `MultiplyResourceRegenSpeed`, which this buff never calls — it calls
		// `MultiplyCastSpeed` (sim/core/unit.go:531), which sets `unit.CastSpeed` and stops there.
		//
		// What it does buy is the channel: Fists of Fury is a `Dot` with `AffectedByCastSpeed: true`
		// and `HasteReducesDuration: true` (sim/monk/ww_fists_of_fury.go:61-62), as is Spinning Crane
		// Kick (sim/monk/spinning_crane_kick.go:76). Five percent off the channel is five percent of
		// that time handed back to the rest of the priority list.
		key: 'spellHaste',
		iconId: 24907,
		selfProvided: false,
		providers: [
			{ id: 24907, name: 'Moonkin Aura' },
			{ id: 49868, name: 'Mind Quickening' },
			{ id: 51470, name: 'Elemental Oath' },
		],
	},
	{
		// +5% critical strike — `{stats.PhysicalCritPercent, 5, false}`, sim/core/buffs.go:403-449.
		//
		// The last two are not a mistake and not padding. In this simulator Arcane Brilliance and Still
		// Water register `PhysicalCritPercent` +5 alongside their spell power (sim/core/buffs.go:494-508)
		// and so land in the same exclusive category as Leader of the Pack. A player reading a 5.4
		// tooltip would not expect a mage to cover this; the model this whole project is built against
		// says they do, and leaving them out would let the report announce a missing buff the simulator
		// considers present — a fabricated fault, which is the one thing it must never print.
		key: 'crit',
		iconId: 116781,
		selfProvided: true,
		providers: [
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
		iconId: 116956,
		selfProvided: false,
		providers: [
			{ id: 93435, name: 'Roar of Courage' },
			{ id: 128997, name: 'Spirit Beast Blessing' },
			{ id: 19740, name: 'Blessing of Might' },
			{ id: 116956, name: 'Grace of Air' },
		],
	},
];

/**
 * Every id the roster above can name, and the spell behind it.
 *
 * Two of these are the Monk's own presses — Legacy of the Emperor and Legacy of the White Tiger — and
 * the cast timeline draws presses. A raid buff does no damage, so it never reaches the damage table
 * the engine's `nameOf` falls back to, and both rows drew as a bare `#115921` until this existed.
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
function instancesOf(effect: Effect, events: readonly WclEvent[], atPull: ReadonlySet<string>): Instance[] {
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
 * Which raid buffs were on the player, one row per effect.
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
				iconId: effect.iconId,
				providers: [],
				notReported: true,
				uptimeMs: 0,
				uptimePct: 0,
				fromPull: false,
				byPlayer: false,
				selfProvided: effect.selfProvided,
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
			iconId: effect.iconId,
			// The spells actually seen, deduplicated: two hunters are one Trueshot Aura to a reader.
			providers: [...new Set(instances.map((i) => i.provider.name))],
			notReported: false,
			uptimeMs,
			uptimePct: duration > 0 ? (uptimeMs / duration) * 100 : 0,
			fromPull: instances.some((i) => i.fromPull),
			byPlayer: instances.some((i) => i.source === actorID),
			selfProvided: effect.selfProvided,
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
		selfGaps: rows.filter((r) => r.selfProvided && !r.notReported && r.gaps.length > 0).length,
	};
}
