// Vengeance: the attack power a tank is paid for being hit, and the ceiling their own health puts on it.
//
// Every tank in Mists has this and no other spec does, so the module is generic on purpose — a Blood
// Death Knight or a Protection Warrior needs the same five inputs and gets the same audit back.
// Nothing below names a class. What the caller supplies is a stamina, an attack power multiplier and
// whatever health buffs the raid put on the player; what it gets back is the attack power curve, the
// ceiling under it, and how long the two touched.
//
// -------------------------------------------------------------------- the rule
//
// From `sim/core/vengeance.go`, which is one function and worth reading whole:
//
//   - **It is a proc on damage taken**, `CallbackOnSpellHitTaken | CallbackOnPeriodicDamageTaken`
//     (`vengeance.go:30`), and only from an NPC (`vengeance.go:35`). Player damage grants nothing.
//   - **It reads pre-mitigation, pre-outcome damage** — `result.PostArmorDamage / result.ArmorMultiplier`
//     (`vengeance.go:40`) — so the tank's own damage reductions divide back out and do not cost them
//     attack power. Weakened Blows, Demoralizing Banner and Demoralizing Shout are each divided out
//     by name (`vengeance.go:42-55`) because they reduce the blow without reducing the Vengeance.
//   - **The gain is 1.8% of that raw damage** (`VengeanceScaling = 0.018`, `vengeance.go:10`),
//     multiplied by 2.5 for anything armour does not mitigate (`vengeance.go:67-69`). The constant
//     carries the comment "Might be reverted to 0.015 in a later patch", so it is the value this
//     build of the sim uses rather than a fact about every version of the patch.
//   - **It accumulates against a decaying carry**, not from zero: a new blow adds its gain to
//     `stacks × remaining / 20s` (`vengeance.go:78-80`), where the aura runs 20 seconds
//     (`vengeance.go:20`). So the carried value falls linearly with the time since the last blow —
//     one second without being hit takes a twentieth of it — and the buff simply expires 20 seconds
//     after the last hit.
//   - **There is a ramp-up floor.** If the accumulated value is under half the equilibrium the
//     current blow implies, it is lifted to that half (`vengeance.go:95-103`). This is what makes a
//     tank's attack power jump on the first swing they eat rather than climbing from nothing, and it
//     is visible in every capture here: the reference pulls open at 69,282 attack power and are past
//     385,000 by 1.4 seconds.
//   - **It is granted as flat attack power**, one point per stack (`vengeance.go:24`,
//     `BonusPerStack: stats.Stats{stats.AttackPower: 1}`), and it is blocked before the pull
//     (`BlockPrepull`, `vengeance.go:127`) — which is what makes the pull's opening reading a
//     Vengeance of exactly zero, and this module leans on that.
//
// -------------------------------------------------------------------- the cap
//
// **The cap is maximum health, and the reader who said so was right.** `vengeance.go:106` is
// `newVengeance = min(newVengeance, result.Target.MaxHealth())`, and `MaxHealth()` is not a constant:
// `sim/core/health.go:36-38` returns `hb.unit.stats[stats.Health]`, the live stat. So anything that
// adds to that stat raises the cap for as long as it holds, and the two raid health buffs do exactly
// that through `UpdateMaxHealth` (`sim/core/health.go:91-92`, `AddStatsDynamic(stats.Health, …)`):
// Rallying Cry takes `MaxHealth() * 0.2` at the moment it lands (`sim/core/buffs.go:1076-1078`), and
// the tanks' own buttons do the same — Last Stand `MaxHealth() * 0.3`
// (`sim/warrior/protection/last_stand.go:21-22`), Vampiric Blood `MaxHealth() * 0.15`
// (`sim/death_knight/blood/vampiric_blood.go:38-39`), Fortifying Brew 20%
// (`sim/monk/fortifying_brew.go:25`).
//
// So **the cap moves during a pull**, and on all three captured Protection pulls it does: Rallying
// Cry lands 10, 7 and 4 times, holding a fifth more ceiling for 100s, 70s and 40s respectively.
// `capWindows` reports those rather than averaging them away.
//
// Each buff snapshots its bonus off the pool *as it stood when it landed*, so two overlapping buffs
// compound off each other and sit a little above the flat product of their multipliers. Measured
// during the Touch of Karma work at about 1.6% at worst; with one buff, as on every pull here, there
// is nothing to compound and the product is exact.
//
// ------------------------------------------------------- why the curve is read
//
// None of the arithmetic above is reproduced here, and that is the point. Every event fetched with
// `includeResources: true` carries the player's `attackPower` beside their `hitPoints` and `armor`,
// about fourteen times a second on a real pull, so the curve is a **measurement** and the sim is only
// consulted for the ceiling to draw under it. Reconstructing Vengeance from damage taken would import
// the ramp-up estimator and its four open TODOs (`vengeance.go:71`, `:73`, `:86`, `:94`) into a report
// that has the answer already.
//
// What the log does *not* carry is the Vengeance aura itself: 84839 appears zero times in all three
// Protection captures. Attack power is the only handle there is.

import { isCombatantInfo, resourceActorOf, type WclEvent } from '~/lib/events';
import type { PoolResourceAudit, ResourceCapSplit, ResourceCurve } from '~/lib/types';
import { RESOURCE_TYPE } from '~/lib/game/resources';

import { median, percentile } from './format';
import { maxHealthFrom } from './gear';
import { mergeIntervals, unionMs, type Interval } from './intervals';

/**
 * How long the buff runs from the last blow, in ms — `Duration: time.Second * 20`,
 * `sim/core/vengeance.go:20`.
 *
 * Exported because it is the unit `NEAR_CAP_SHARE` below is derived in, not because anything here
 * counts in it.
 */
export const VENGEANCE_DURATION_MS = 20_000;

/**
 * How close to the ceiling counts as being on it.
 *
 * **Derived from the decay, not picked for roundness.** The carried value going into a blow is
 * `stacks × remaining / 20s` (`sim/core/vengeance.go:79`) over a 20-second aura, which is linear:
 * every second without being hit removes exactly a twentieth — five percent — of whatever the player
 * was holding. So a reading inside five percent of the ceiling is one that was *on* the ceiling
 * within the last second, and a five percent band is one second of decay wide. One second is also
 * about a global, which is the shortest interval a reader can do anything about.
 *
 * The alternative was a percentage chosen to make the figure look reasonable, and this report refuses
 * that everywhere else.
 *
 * **Nothing in the three captured pulls reaches it, and that is reported rather than tuned away.**
 * The share of the cap actually held peaks at 70.8%, 70.9% and 31.2%; the 99th percentile of every
 * reading is 68.0%, 67.8% and 37.1%. So this threshold is a definition awaiting a pull that tests it,
 * not a measurement — which is worth stating plainly, because a constant that has never fired looks
 * identical to one that was validated. Moving it down until a number appears would invent a finding
 * out of a tank who was never capped.
 */
export const NEAR_CAP_SHARE = 0.95;

/**
 * The raid's +10% attack power buff, and the reason a Vengeance ceiling cannot be read off the health
 * pool alone.
 *
 * Battle Shout, Horn of Winter and Trueshot Aura are one effect with three ids — `sim/core/buffs.go`
 * declares all three as `{stats.AttackPower, 1.1, true}` (`:311`, `:321`, `:340`), the `true` being
 * `IsMultiplicative` (`StatConfig`, `buffs.go:20-24`), which lands as
 * `NewDynamicMultiplyStat(stats.AttackPower, 1.1)` (`buffs.go:27`). They do not stack: each is an
 * exclusive effect on the same `AttackPower%Buff` key.
 *
 * **It multiplies the Vengeance too.** Vengeance is a flat contribution to the same `stats.AttackPower`
 * (`vengeance.go:24`) and the cap is applied to the Vengeance value *before* that stat is assembled
 * (`vengeance.go:106`), so a capped tank under this buff shows `1.1 × maxHealth` of Vengeance-derived
 * attack power rather than `maxHealth`. Ignoring it would draw a ceiling nine percent too low and
 * report every pull as closer to its cap than it was.
 *
 * **Confirmed against the log to the unit.** A Paladin's attack power is `250 + 2 × Strength` —
 * `sim/paladin/paladin.go:166` is `AddStatDependency(stats.Strength, stats.AttackPower, 2)` and the
 * class's base is `CharacterLevel*3.0 - 20` (`sim/core/base_stats.go:137`). With this buff over it,
 * the three Protection captures predict a zero-Vengeance attack power of 69,282, 69,282 and 72,332,
 * and the opening reading of each pull is 69,282, 69,282 and 72,332 — a difference of zero on all
 * three. That is the strength arithmetic and the multiplier both, checked in one shot.
 */
export const AP_RAID_BUFF_IDS: readonly number[] = [6673, 57330, 19506];
export const AP_RAID_BUFF_MULTIPLIER = 1.1;

/** One reading of the player's attack power, in fight-relative ms. */
export interface AttackPowerSample {
	t: number;
	attackPower: number;
}

/**
 * A stretch where something raised the ceiling, and what it raised it to.
 *
 * Named rather than merely sized, because "the cap moved" is a fact about somebody else's cooldown
 * and a reader is owed which one.
 */
export interface CapWindow {
	start: number;
	end: number;
	/** Maximum health over this stretch, after the buffs that overlap it. */
	cap: number;
	/** The buffs that raised it, in the order given. */
	names: string[];
}

/** A health buff as this module needs it: how much it adds, and when it was up. */
export interface HealthBuffWindows {
	name: string;
	/** `1.2` for Rallying Cry — the pool multiplier, not the bonus. */
	multiplier: number;
	windows: ReadonlyArray<{ start: number; end: number }>;
}

export interface VengeanceAudit {
	/** Readings the curve was built from. Zero means the fetch never asked for resources. */
	samples: number;
	/** Median gap between readings — the shortest stretch at the cap this can see at all. */
	medianGapMs: number;
	/** 99th percentile gap. A cap reached and lost inside one of these is invisible here. */
	p99GapMs: number;
	/**
	 * Attack power with no Vengeance on it — the pull's own zero, read off it.
	 *
	 * Null when the log carried no readings before the player was first hit *and* no readings at all.
	 */
	baseAttackPower: number | null;
	/** What the raid's attack power buff multiplied the whole stat by: 1.1, or 1 when it was absent. */
	attackPowerMultiplier: number;
	/** Maximum health with no health buff on it, from stamina. Null when the log reported no stamina. */
	maxHealth: number | null;
	/** The cap at rest, and the highest it reached. Equal when nothing raised it. */
	restingCap: number | null;
	peakCap: number | null;
	/** The stretches something raised it, merged and in time order. */
	capWindows: CapWindow[];
	/** How long the pull spent under a raised cap. */
	capRaisedMs: number;
	/** The readings, for the chart. `max` is the highest ceiling the pull reached — see `vengeanceAudit`. */
	curve: ResourceCurve;
	/** The pull's highest attack power, and what share of the cap it was holding at that moment. */
	peak: {
		at: number;
		attackPower: number;
		/** The Vengeance half of it, in the same multiplied units the log reports. */
		vengeance: number;
		/** That as a share of the cap in force at `at`, 0–1. Null when the cap is unknown. */
		shareOfCap: number | null;
	} | null;
	/** The stretches held at or within `NEAR_CAP_SHARE` of the cap, merged and in time order. */
	nearCap: Interval[];
	nearCapMs: number;
	/** That as a share of the pull, 0–100. */
	nearCapPct: number;
}

/**
 * Every reading of the player's attack power, in time order.
 *
 * Reads the same field `resourceSamples` in `./energy` does its work through — WarcraftLogs staples a
 * resource block onto ordinary casts, damage and heals — but off the top level of the event rather
 * than out of `classResources`. Attack power is not a bar: it sits beside `hitPoints`, `armor` and
 * `spellPower` as a stat snapshot, one field, no ceiling of its own.
 *
 * `resourceActor` is **an index and not an actor id** — 1 means the resources belong to the event's
 * source, 2 to its target — and comparing it to an actor id matches nothing at all. That mistake cost
 * the energy audit a release; it is not repeated here.
 *
 * A reading of zero is dropped rather than believed. Nobody at level 90 has no attack power, so a zero
 * is the log declining to fill the field — the same guard `readStamina` in `./gear` applies, and for
 * the same reason. Comes back empty, not wrong, when the events were fetched without
 * `includeResources: true`.
 */
export function attackPowerSamples(events: readonly WclEvent[], actorID: number, t0: number): AttackPowerSample[] {
	const out: AttackPowerSample[] = [];
	for (const e of events) {
		const side = resourceActorOf(e);
		const owner = side === 1 ? e.sourceID : side === 2 ? e.targetID : undefined;
		if (owner !== actorID) continue;
		// Read the way `classResourcesOf` reads its own field: the payload carries it, the event type
		// does not declare it, and a runtime check is what makes the cast sound. Kept local rather than
		// promoted to `lib/events/guards` because Vengeance is the only thing that has ever wanted it.
		const raw: unknown = (e as { attackPower?: unknown }).attackPower;
		if (typeof raw !== 'number' || !(raw > 0)) continue;
		out.push({ t: e.timestamp - t0, attackPower: raw });
	}
	// Stable, so two readings on one millisecond keep the log's own order.
	return out.sort((a, b) => a.t - b.t);
}

/**
 * Whether the raid's +10% attack power buff was on the player, as a multiplier over the whole stat.
 *
 * Read off `combatantinfo`'s aura list rather than off the event stream, because that is where it
 * actually appears: it is a permanent raid buff applied before the pull, so it produces no `applybuff`
 * inside the fight and a stream-only read finds nothing. Both reference reports carry Battle Shout and
 * Trueshot Aura in that list at the pull.
 *
 * Returns 1 when the list says nothing. That is the conservative direction: a ceiling computed without
 * the multiplier is nine percent *lower*, so a pull whose buff went unseen reads as closer to its cap
 * than it was, never further. The overstatement is visible; a silently inflated ceiling would not be.
 *
 * The three ids do not stack — one exclusive effect, three spells — so this is a presence test and
 * never a product.
 */
export function attackPowerBuffMultiplier(pullAuraIds: ReadonlySet<number>): number {
	return AP_RAID_BUFF_IDS.some((id) => pullAuraIds.has(id)) ? AP_RAID_BUFF_MULTIPLIER : 1;
}

/**
 * The spell ids `combatantinfo` says were already on the player when the pull started.
 *
 * `raidBuffs` builds a set of the same list keyed `id:source`, because it cares who cast what. This
 * one wants the bare id, and the two are not worth folding together over that.
 *
 * Proves presence and never absence — the list is known to omit auras that were demonstrably up — so
 * the only thing that reads it here treats a miss as "no multiplier", which understates the ceiling
 * rather than inflating it.
 */
export function pullAuraIds(events: readonly WclEvent[], actorID: number): Set<number> {
	const info = events.find((e) => isCombatantInfo(e) && e.sourceID === actorID);
	const out = new Set<number>();
	if (info === undefined || !isCombatantInfo(info) || info.auras === undefined) return out;
	for (const aura of info.auras) if (typeof aura.ability === 'number') out.add(aura.ability);
	return out;
}

/**
 * The audit, from a log rather than from readings — the entry point a spec calls.
 *
 * The split is the one `./energy` keeps between `resourceSamples` and `trackResourceBar`: one half
 * knows how WarcraftLogs shapes an event and the other half does arithmetic on numbers. A spec wants
 * both and should not have to assemble them, and a test wants the second half on its own.
 *
 * `healthBuffs` is the caller's because *which* buffs can raise a tank's pool is a question about that
 * tank. Every spec passes the raid's two — Rallying Cry and Ancestral Vigor, both in `lib/game/shared`
 * — and a spec with a button of its own adds it: Last Stand at 1.3, Vampiric Blood at 1.15,
 * Fortifying Brew at 1.2.
 */
export function readVengeance({
	events,
	actorID,
	t0,
	durationMs,
	stamina,
	healthBuffs = [],
}: {
	events: readonly WclEvent[];
	actorID: number;
	t0: number;
	durationMs: number;
	/**
	 * `GearSummary.stamina`, straight off `combatantinfo`. Null when the log reported none, and
	 * `undefined` on a fixture captured before the field was read — `maxHealthFrom` treats both the
	 * same way, so the width is here rather than at every call site.
	 */
	stamina: number | null | undefined;
	healthBuffs?: readonly HealthBuffWindows[];
}): VengeanceAudit {
	// The first blow the player took, which is what separates the readings that state their own attack
	// power from the ones with Vengeance on top. Not filtered to enemy sources: a friendly-sourced hit
	// on a tank is vanishingly rare and taking the earlier of the two only ever *narrows* the window
	// this trusts, which cannot inflate the base.
	const firstHit = events.find((e) => e.type === 'damage' && e.targetID === actorID && e.sourceID !== actorID);

	return vengeanceAudit({
		samples: attackPowerSamples(events, actorID, t0),
		durationMs,
		firstDamageTakenAt: firstHit === undefined ? Infinity : firstHit.timestamp - t0,
		maxHealth: maxHealthFrom(stamina),
		attackPowerMultiplier: attackPowerBuffMultiplier(pullAuraIds(events, actorID)),
		healthBuffs,
	});
}

/**
 * The whole reading: the attack power curve, the ceiling under it, and where the two met.
 *
 * **`baseAttackPower` is the pull's own zero-Vengeance reading, taken from the log.** Vengeance is
 * blocked before the pull (`BlockPrepull`, `sim/core/vengeance.go:127`) and only an NPC's blow starts
 * it, so every reading at or before the first hit the player takes has a Vengeance of exactly zero and
 * states the player's attack power on its own. The lowest of those is taken, which handles a
 * Strength trinket that happened to be up for some of them.
 *
 * Deriving it instead of reading it would need a per-class Strength-to-attack-power dependency and a
 * base attack power table, which is precisely the spec knowledge this module is trying not to hold.
 * Reading it is also *more* accurate: it captures whatever flask, food and Blessing the player
 * actually had, none of which a formula would know about.
 *
 * **The residual drift is measured and small.** The player's own attack power moves during a pull as
 * Strength procs come and go — across these three captures the readings with no Vengeance on them
 * span about 9,000 points — against a ceiling of roughly 1.27 million. That is 0.7%, and it moves the
 * curve and the ceiling in the same direction, so it very nearly cancels in the share. It is far
 * inside the five percent band `NEAR_CAP_SHARE` draws.
 *
 * **`curve.max` is the ceiling at its highest, not at rest**, and `curve.ceiling` is where it actually
 * was. The scalar scales the chart's y-axis, so taking the highest is what keeps the curve inside its
 * own axis for the whole pull; the step series beside it is the limit in force at each moment, which
 * is what `cappedOf` compares against and what `ResourceTrack` draws. Both are needed and they are not
 * the same number on any pull carrying a health buff — which is all three committed captures.
 *
 * `capWindows` stays as well, because a shaded stretch and a drawn ceiling answer different questions:
 * the line says what the limit was, the shading says *who raised it*, and only the second can name
 * Rallying Cry.
 *
 * Falls back to the samples' own peak when there is no stamina to compute a ceiling from, so a log
 * with no `combatantinfo` still draws its attack power rather than nothing.
 */
export function vengeanceAudit({
	samples,
	durationMs,
	firstDamageTakenAt,
	maxHealth,
	attackPowerMultiplier,
	healthBuffs = [],
}: {
	samples: readonly AttackPowerSample[];
	durationMs: number;
	/** When an NPC first hit the player, in fight-relative ms. `Infinity` when they never did. */
	firstDamageTakenAt: number;
	/** From `maxHealthFrom(gear.stamina)` in `./gear`. Null when the log reported no stamina. */
	maxHealth: number | null;
	attackPowerMultiplier: number;
	healthBuffs?: readonly HealthBuffWindows[];
}): VengeanceAudit {
	const gaps: number[] = [];
	for (let i = 1; i < samples.length; i++) {
		const a = samples[i - 1];
		const b = samples[i];
		if (a !== undefined && b !== undefined) gaps.push(b.t - a.t);
	}
	const sortedGaps = [...gaps].sort((x, y) => x - y);

	const beforeFirstHit = samples.filter((s) => s.t <= firstDamageTakenAt);
	// The pull's zero. Falls back to the whole pull's minimum when nothing was sampled before the first
	// blow — which is a floor on the true base, since Vengeance only ever adds, so it can overstate the
	// Vengeance held and never understate it.
	const pool = beforeFirstHit.length > 0 ? beforeFirstHit : samples;
	const baseAttackPower = pool.length === 0 ? null : Math.min(...pool.map((s) => s.attackPower));

	const buffWindows = healthBuffs.flatMap((buff) =>
		buff.windows.map((w) => ({ start: w.start, end: w.end, multiplier: buff.multiplier, name: buff.name })),
	);
	const capWindows = capWindowsOf(buffWindows, maxHealth);
	const restingCap = maxHealth;
	const peakCap = maxHealth === null ? null : capWindows.reduce((highest, w) => Math.max(highest, w.cap), maxHealth);

	// The cap in force at an instant, in the multiplied units the log reports attack power in. A window
	// is half-open at neither end: a buff is up on the millisecond it lands and on the one it falls off.
	const capAt = (t: number): number | null => {
		if (maxHealth === null) return null;
		const covering = capWindows.filter((w) => w.start <= t && t <= w.end);
		return covering.length === 0 ? maxHealth : Math.max(...covering.map((w) => w.cap));
	};
	const highestCeiling =
		peakCap === null || baseAttackPower === null ? null : baseAttackPower + attackPowerMultiplier * peakCap;
	/**
	 * The ceiling as a step series, built from the cap windows rather than sampled.
	 *
	 * One entry at the pull's start for the resting ceiling, then one at each edge of every window that
	 * raised it — the value being whatever `capAt` says is in force from that instant, so overlapping
	 * buffs resolve to the highest exactly as they do everywhere else in this module. Adjacent entries
	 * holding the same level are dropped: a series that repeats itself draws the same line and makes a
	 * reader look for a change that did not happen.
	 *
	 * Omitted entirely when nothing moved the ceiling, so a curve with a fixed limit carries the scalar
	 * alone and every consumer behaves as it did before the field existed.
	 */
	const ceilingSteps: Array<[number, number]> = [];
	if (baseAttackPower !== null && maxHealth !== null && capWindows.length > 0) {
		// `w.end + 1` and not `w.end`, because `capAt` treats a window as closed at both ends — the buff is
		// up on the millisecond it falls off. Sampling at `w.end` would therefore read the raised ceiling
		// and the series would never come back down.
		const edges = [0, ...capWindows.flatMap((w) => [w.start, w.end + 1])].sort((a, b) => a - b);
		for (const t of edges) {
			const cap = capAt(t);
			if (cap === null) continue;
			const level = baseAttackPower + attackPowerMultiplier * cap;
			const previous = ceilingSteps[ceilingSteps.length - 1];
			if (previous !== undefined && previous[1] === level) continue;
			ceilingSteps.push([t, level]);
		}
	}

	const curve: ResourceCurve = {
		max: highestCeiling ?? samples.reduce((widest, s) => Math.max(widest, s.attackPower), 0),
		points: samples.map((s): [number, number] => [s.t, s.attackPower]),
		...(ceilingSteps.length > 0 ? { ceiling: ceilingSteps } : {}),
	};

	const peakSample = samples.reduce<AttackPowerSample | null>(
		(best, s) => (best === null || s.attackPower > best.attackPower ? s : best),
		null,
	);
	const peak =
		peakSample === null
			? null
			: {
					at: peakSample.t,
					attackPower: peakSample.attackPower,
					vengeance: baseAttackPower === null ? peakSample.attackPower : peakSample.attackPower - baseAttackPower,
					shareOfCap: shareAt(peakSample, baseAttackPower, attackPowerMultiplier, capAt(peakSample.t)),
				};

	// Both ends of a gap have to be near the ceiling for the time between them to count, which is the
	// same conservative rule `cappedIntervals` in `./energy` applies to a bar: one reading proves an
	// instant, a pair proves the stretch between them. A pull that touched the cap between two readings
	// and left again is invisible, and `p99GapMs` is what says how wide that blind spot is.
	const intervals: Interval[] = [];
	for (let i = 1; i < samples.length; i++) {
		const a = samples[i - 1];
		const b = samples[i];
		if (a === undefined || b === undefined || b.t <= a.t) continue;
		if (!isNearCap(a, baseAttackPower, attackPowerMultiplier, capAt(a.t))) continue;
		if (!isNearCap(b, baseAttackPower, attackPowerMultiplier, capAt(b.t))) continue;
		intervals.push([a.t, b.t]);
	}
	const nearCap = mergeIntervals(intervals);
	const nearCapMs = unionMs(nearCap);

	return {
		samples: samples.length,
		medianGapMs: median(gaps),
		p99GapMs: percentile(sortedGaps, 0.99),
		baseAttackPower,
		attackPowerMultiplier,
		maxHealth,
		restingCap,
		peakCap,
		capWindows,
		capRaisedMs: unionMs(capWindows.map((w): Interval => [w.start, w.end])),
		curve,
		peak,
		nearCap,
		nearCapMs,
		nearCapPct: durationMs > 0 ? (nearCapMs / durationMs) * 100 : 0,
	};

	function shareAt(
		sample: AttackPowerSample,
		base: number | null,
		multiplier: number,
		cap: number | null,
	): number | null {
		if (base === null || cap === null || cap <= 0) return null;
		return (sample.attackPower - base) / (multiplier * cap);
	}

	function isNearCap(sample: AttackPowerSample, base: number | null, multiplier: number, cap: number | null): boolean {
		const share = shareAt(sample, base, multiplier, cap);
		return share !== null && share >= NEAR_CAP_SHARE;
	}
}

/**
 * The stretches a health buff was up, coalesced into the cap each one produced.
 *
 * Overlapping buffs multiply, which is the flat reading of the sim's `AddStatsDynamic(stats.Health, …)`
 * — but each buff snapshots its bonus off the pool as it stood when *it* landed
 * (`sim/core/buffs.go:1076`, `bonusHealth = allyUnit.MaxHealth() * 0.2`), so two that overlap compound
 * off each other and the true pool sits slightly above the product. Measured at about 1.6% at worst
 * during the Touch of Karma work, and worth nothing on a pull with one buff, which is every pull
 * captured here.
 *
 * The boundaries are the union of every window's endpoints, so a stretch where a second buff joins a
 * first becomes its own window at its own height rather than being averaged across the pair.
 */
function capWindowsOf(
	buffs: ReadonlyArray<{ start: number; end: number; multiplier: number; name: string }>,
	maxHealth: number | null,
): CapWindow[] {
	if (maxHealth === null || buffs.length === 0) return [];
	const edges = [...new Set(buffs.flatMap((b) => [b.start, b.end]))].sort((a, b) => a - b);
	const out: CapWindow[] = [];
	for (let i = 1; i < edges.length; i++) {
		const start = edges[i - 1];
		const end = edges[i];
		if (start === undefined || end === undefined || end <= start) continue;
		// Sampled at the midpoint, so a window that merely touches another at an endpoint is not counted
		// as overlapping it.
		const mid = (start + end) / 2;
		const active = buffs.filter((b) => b.start <= mid && mid <= b.end);
		if (active.length === 0) continue;
		const cap = active.reduce((pool, b) => pool * b.multiplier, maxHealth);
		const names = [...new Set(active.map((b) => b.name))];
		const last = out[out.length - 1];
		// Coalesced as they are built: two adjacent slices at one height under one set of buffs are one
		// stretch, not one row per edge.
		if (last !== undefined && last.end === start && last.cap === cap && sameNames(last.names, names)) last.end = end;
		else out.push({ start, end, cap, names });
	}
	return out;
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((name, i) => name === b[i]);
}

/**
 * The Vengeance reading in the shape the generic resource machinery draws.
 *
 * **Why a `pool` and not a bar of its own kind.** `CastTimeline` derives its lanes from
 * `analysis.resources`, and `ResourceBarAudit` has exactly two arms: a pool that refills on a clock and
 * wastes by the second, and a points bar that arrives in whole units and wastes by the point. Vengeance
 * is neither — it decays — but of the two, a pool is the one whose *drawing* is right: a continuous
 * line under a ceiling, shaded where it sat against it.
 *
 * So the fields that would be a claim about regeneration are refused rather than filled.
 * `regenPerSec` is null, which `lostIn` in `CastTimeline` already reads as "this bar's capped stretches
 * carry a duration and not a cost" — the same treatment chi gets, and for a related reason: what a
 * stretch at the ceiling cost depends on how hard the fight was hitting, which this bar cannot see.
 *
 * `engaged` and `downtime` are nought, and that is a statement rather than a gap. The contact split
 * asks whether there was something to hit, which is the right question for a bar filled by *hitting*
 * and the wrong one for a bar filled by *being hit* — a tank stood in a fire with no target is gaining
 * Vengeance at full rate. `total` carries the real measurement.
 *
 * `max` is rounded because it is printed beside the lane's own label, and a ceiling is a number off a
 * character sheet rather than a float.
 */
export function vengeanceBar(audit: VengeanceAudit): PoolResourceAudit {
	const nil: ResourceCapSplit = { cappedMs: 0, pct: 0, wasted: null };
	return {
		kind: 'pool',
		// The sim numbers the bars it models and attack power is not one of them, so this is `generic`
		// rather than a borrowed enum value — and `resourceColorOf` has no colour for it, which is correct:
		// the drawing side falls back rather than painting this in another resource's palette.
		type: RESOURCE_TYPE.generic,
		curve: { ...audit.curve, max: Math.round(audit.curve.max) },
		max: Math.round(audit.curve.max),
		samples: audit.samples,
		regenPerSec: null,
		medianGapMs: audit.medianGapMs,
		p99GapMs: audit.p99GapMs,
		capped: audit.nearCap.map(([start, end]): [number, number] => [start, end]),
		total: {
			cappedMs: audit.nearCapMs,
			// `nearCapPct` and not the same division again: the audit already holds this share, and two
			// computations of one number are two things that can disagree about which clock it is over.
			pct: audit.nearCapPct,
			wasted: null,
		},
		engaged: nil,
		downtime: nil,
		worst: audit.nearCap
			.map(([start, end]) => ({ at: start, ms: end - start, engaged: true, link: `#vengeance-heading` }))
			.sort((a, b) => b.ms - a.ms)
			.slice(0, 5),
	};
}
