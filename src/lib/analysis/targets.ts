// How many enemies were being hit, moment by moment.
//
// Every other read of "how many targets was this" in the report is a whole-pull average — the share
// of damage that landed on one enemy — and an average cannot say that a five-minute pull was one
// target for four minutes and six adds for one. These two functions are the per-moment answer, and
// they know nothing about which spec is asking: a hit is a time and an enemy.
//
// And the question before that one, which the counts are only as good as: *which* enemies deserve to be
// counted. That is `spawnLives` and `isJudgeableTarget` at the top of the file.

import { instanceKey, isDamage, type WclEvent } from '~/lib/events';

import type { Interval } from './intervals';
import { valueAtOrBefore } from './search';

/**
 * WarcraftLogs' `hitType` for a blow the unit was **immune** to. Read off real events, never guessed.
 *
 * The number matters more than it looks: a wrong constant here does not fail, it silently matches
 * nothing and the fix below quietly does nothing at all. So it was established by counting, over the
 * three committed Iron Juggernaut datasets — `windwalker/__fixtures__/dataset-ironJuggernaut.json`,
 * `elemental/__fixtures__/phased.json` and `elemental/__fixtures__/unbroken.json`, all anonymous
 * reports of the same encounter:
 *
 *  - In the Windwalker dataset, 1155 damage events carry hit types `{0:31, 1:587, 2:407, 4:9, 5:9,
 *    6:71, 8:9, 10:32}`. Every one of the 32 type-10 events has `amount: 0`.
 *  - Of those 32, **27 target actor 236, `Crawler Mine`** — and all 27 events that actor ever receives
 *    are type 10. Nine distinct `targetInstance` values, so every mine spawn on the pull, without
 *    exception, returned nothing but this.
 *  - The other 5 are five consecutive Fists of Fury ticks on the **boss** at 71.3s–74.3s, out of the
 *    1026 hits the boss took. The boss went immune for a phase and was killed anyway.
 *  - `phased.json` repeats it: all 6 of its type-10 events land on `Crawler Mine`, six spawns, every
 *    one of them wholly immune. `unbroken.json` has 25, of which 18 land on seven wholly-immune mine
 *    spawns and 7 on a unit that also took real damage.
 *
 * Amount alone cannot stand in for it: type 0 (miss) and type 8 also carry `amount: 0`, and 17 plain
 * type-1 hits do too. The field is `hitType` and the value is 10.
 */
const IMMUNE_HIT_TYPE = 10;

/**
 * What the log knows about one enemy spawn that decides whether it deserves to be judged at all.
 *
 * **The rule is about the unit, not the event, and that is a decision rather than a detail.** A single
 * immune hit is a phase, and the fixtures prove it: the Iron Juggernaut itself returns five immune
 * Fists of Fury ticks in the middle of a pull that kills it. Dropping those five *events* would punch
 * a hole in the contact clock while the player was demonstrably attacking the boss — and would still
 * leave the boss counted, so it buys nothing. A unit that has **only ever** returned immune is the
 * different fact: nothing the player can press will ever land on it, so it is not a target, it never
 * was one, and it cannot pad a fan-out count or host a dot.
 *
 * A unit that was immune for a phase and killable later therefore stays a target for the whole pull.
 * Carving its immune phase out would be a separate change with its own question — whether that phase
 * is downtime or disregarded — and the pull's own contact clock already answers it.
 */
export interface SpawnLife {
	/** Every hit landed on this spawn came back immune, so nothing the player presses can touch it. */
	immune: boolean;
	/**
	 * How long the log can see this spawn in the fight.
	 *
	 * Measured **from the first hit the player landed on it** — the first moment the log proves the unit
	 * was reachable, and the earliest a dot could have gone on it. Not from its spawn: the events query
	 * is scoped to the player as source (`fightEvents.graphql`), so an encounter add's arrival is not in
	 * the stream at all. Measured **to its last hit**, for the same reason — all three committed Iron
	 * Juggernaut datasets carry zero `death` events for an enemy NPC, so a death is not available to
	 * measure to either.
	 *
	 * Except where the fight stops first: a spawn still being hit within one target window of the end of the
	 * pull had no observable end, so its life runs to the fight's end instead. That is what makes a mob
	 * still alive when the fight stops trivially qualify, rather than being scored on the accident of when
	 * the player last swung at it.
	 */
	lifetimeMs: number;
}

/**
 * Every enemy spawn the player touched, with the two facts `isJudgeableTarget` reads.
 *
 * Taken over the player's *whole* damage stream — pets folded in, periodic ticks included — because
 * the question is "can anything this player does land on that unit", and the widest evidence is the
 * honest answer to it. That is deliberately a wider set of events than the landed-hit list this
 * verdict is then applied to.
 *
 * Keyed by spawn and not by actor id, for the reason `TargetHit.instance` exists: WarcraftLogs hands
 * ten simultaneous adds one `targetID`, so an id-level verdict is a verdict about an enemy *kind*.
 */
export function spawnLives(
	events: readonly WclEvent[],
	t0: number,
	endMs: number,
	windowMs: number,
): Map<string, SpawnLife> {
	const seen = new Map<string, { immune: boolean; firstMs: number; lastMs: number }>();
	for (const e of events) {
		if (!isDamage(e) || e.targetID === undefined) continue;
		const key = instanceKey(e.targetID, e.targetInstance);
		const t = e.timestamp - t0;
		const immune = e.hitType === IMMUNE_HIT_TYPE;
		const rec = seen.get(key);
		if (rec === undefined) seen.set(key, { immune, firstMs: t, lastMs: t });
		else {
			// `&&`, so one hit that landed is enough to make the unit a target for the whole pull.
			rec.immune = rec.immune && immune;
			rec.firstMs = Math.min(rec.firstMs, t);
			rec.lastMs = Math.max(rec.lastMs, t);
		}
	}
	const lives = new Map<string, SpawnLife>();
	for (const [key, rec] of seen) {
		const seenTo = rec.lastMs + windowMs >= endMs ? endMs : rec.lastMs;
		lives.set(key, { immune: rec.immune, lifetimeMs: Math.max(0, seenTo - rec.firstMs) });
	}
	return lives;
}

/**
 * Whether a spawn deserves to be judged — the one predicate, with both of its clauses.
 *
 * One function rather than two filters, because the two questions are the same question. An immune
 * unit is never a target; a unit that died moments after it arrived is not a target *for a dot*. Both
 * are "does this thing deserve to be graded against", and splitting them into separate filters is how
 * the report ends up applying one and not the other — which is exactly what `ignoredMultiTargetActorIDs`
 * further up the same seam already had to be consolidated to prevent.
 *
 * `minLifetimeMs` is left out by every caller asking the plain question: is this a target at all. Only
 * a dot's reader passes it, because only a dot cares how long the unit was going to be there.
 *
 * An unknown spawn is not judgeable. A spawn with no hits on it is not something the player was
 * fighting, so there is nothing to grade and no honest grade to give.
 */
export function isJudgeableTarget(life: SpawnLife | undefined, opts: { minLifetimeMs?: number } = {}): boolean {
	if (life === undefined || life.immune) return false;
	return opts.minLifetimeMs === undefined || life.lifetimeMs > opts.minLifetimeMs;
}

/** One landed hit: when it landed, and on whom. */
export interface TargetHit {
	t: number;
	target: number;
	/**
	 * Which *copy* of that actor, when the log says.
	 *
	 * WarcraftLogs gives one actor id to an NPC *type*, so every Kor'kron Ironblade stood in front of a
	 * monk on Galakras arrives as the same `target` and they are told apart only by this. Counting on
	 * `target` alone therefore does not count enemies, it counts enemy *kinds*: on the Galakras kill in
	 * `a:6MhZgjyAknFWrYfK` that is 13 against the 45 spawns the player actually landed a hit on, and
	 * every read of "how many things am I fighting" downstream inherited the smaller number.
	 *
	 * Optional because not every caller has one to give — a report old enough not to carry the field,
	 * and the Storm, Earth and Fire audit's `contactHits`, which asks *which* enemy an actor stood on
	 * and wants the id its per-target lanes are labelled with. A hit with no instance buckets as
	 * itself, which is exactly what this did before the field existed.
	 */
	instance?: number;
}

/** One enemy spawn, as a map key: the actor id plus which copy of it this is. */
const spawnOf = (hit: TargetHit): string => `${hit.target}:${hit.instance ?? '-'}`;

/**
 * A step in the count series: from `t` until the next point, this many distinct enemies were being
 * damaged.
 *
 * The same `[t, value]` pair the resource curves carry, because the ladder in `lib/spec/apl.ts` reads
 * those with one binary search (`valueAt`) and a second series in a second shape would need a second
 * reader that could disagree with it.
 */
export type TargetCountPoint = [t: number, count: number];

/**
 * Distinct enemies damaged in the trailing `windowMs`, sampled at every moment the answer changes.
 *
 * A trailing window rather than an instant, because an instant is always one: a monk hits one enemy
 * per swing and per global, so "how many targets is this" asked at a millisecond answers one however
 * many enemies are stood in front of them. The window is what turns a sequence of single hits back
 * into the fact that three enemies were being cycled.
 *
 * Points are emitted only where the count changes, and both edges of the window are sampled — every
 * hit, and every moment a hit ages out — so a count that decays to zero says so at the millisecond it
 * does rather than at the next hit, whenever that is.
 */
export function targetCounts(hits: readonly TargetHit[], windowMs: number): TargetCountPoint[] {
	const sorted = [...hits].sort((a, b) => a.t - b.t);
	if (sorted.length === 0) return [];

	// Every moment the answer can change: a hit entering the window, or the oldest one leaving it.
	const moments = [...new Set(sorted.flatMap((h) => [h.t, h.t + windowMs]))].sort((a, b) => a - b);

	// Counted rather than a set of keys: the same enemy hit twice inside one window is one target, and
	// the second hit must not remove it when the first ages out.
	//
	// Keyed by spawn and not by actor id — see `TargetHit.instance`. This is the map the whole count
	// hangs off, so keying it on the id alone was not a rounding error: it collapsed every add of one
	// kind into a single enemy, and the band the priority ladder judges each press at is read off here.
	const live = new Map<string, number>();
	let entered = 0;
	let left = 0;
	const out: TargetCountPoint[] = [];

	for (const t of moments) {
		while (entered < sorted.length) {
			const hit = sorted[entered];
			if (hit === undefined || hit.t > t) break;
			const spawn = spawnOf(hit);
			live.set(spawn, (live.get(spawn) ?? 0) + 1);
			entered++;
		}
		while (left < entered) {
			const hit = sorted[left];
			// Half-open on the old side: a hit exactly `windowMs` back has stopped counting, which is what
			// makes the series fall to zero at the end of a pull rather than one hit short of it.
			if (hit === undefined || hit.t > t - windowMs) break;
			const spawn = spawnOf(hit);
			const seen = (live.get(spawn) ?? 0) - 1;
			if (seen > 0) live.set(spawn, seen);
			else live.delete(spawn);
			left++;
		}
		const count = live.size;
		if (out[out.length - 1]?.[1] !== count) out.push([t, count]);
	}
	return out;
}

/**
 * A reader for the count at a moment, as a step function.
 *
 * The last point at or before `t`, never an interpolation — the series *is* a step function, and a
 * value between two points is a count nobody was ever fighting. Binary search rather than a scan
 * because the priority ladder asks this once per press, and the same shape as `valueAt` in
 * `spec/apl.ts` for the resource curves.
 *
 * Zero before the first point, which is correct rather than a fallback: the series opens at the first
 * landed hit, and before it the player was fighting nothing.
 */
export function countAt(points: readonly TargetCountPoint[]): (t: number) => number {
	// Zero rather than null before the first reading: nothing counted yet is a count of zero, unlike a
	// resource curve where "not sampled" is not "empty".
	return (t) => valueAtOrBefore(points, t) ?? 0;
}

/**
 * The running count of how many of `windows` were open, as a step series.
 *
 * Feeds `intervalsAtLeast` so "where were at least N of these up at once" is one call rather than a
 * hand-written boundary sweep. The Elemental's Stormlash audit wrote that sweep out longhand, and it
 * got two things wrong that `intervalsAtLeast` already handles: an overlap still open when the pull
 * ended was emitted with the window's own expiry rather than clamped to the fight, reporting a
 * stretch longer than the pull it was measured over; and two windows sharing one instant produced a
 * zero-length overlap, which the section then drew as a band.
 *
 * Closes are ordered before opens at the same instant, so two windows that merely touch — one ending
 * where the next begins — never read as overlapping.
 */
export function overlapPoints(windows: readonly Interval[]): TargetCountPoint[] {
	const edges: Array<[number, number]> = [];
	for (const [start, end] of windows) {
		if (end <= start) continue;
		edges.push([start, 1], [end, -1]);
	}
	edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

	const out: TargetCountPoint[] = [];
	let count = 0;
	for (const [at, delta] of edges) {
		count += delta;
		// One point per instant: several edges can share a millisecond, and the series has to carry the
		// count *after* all of them or a momentary dip appears that nothing was ever at.
		const last = out[out.length - 1];
		if (last !== undefined && last[0] === at) last[1] = count;
		else out.push([at, count]);
	}
	return out;
}

/**
 * The stretches where the count was at least `min`, closed at `endMs`.
 *
 * The series is a step function, so a stretch runs from the point that reached the count to the next
 * point that did not — and the last one runs to the end of the pull, which is the caller's number
 * rather than this function's guess.
 *
 * **Both edges of a stretch are set by a trailing window, and only one of them is late.**
 * `targetCounts` counts an enemy from the instant it is hit — no lag at all on the opening edge — and
 * drops it a full window after its last hit. So a stretch opens on the hit that made the count and
 * closes `windowMs` after the hit that stopped keeping it. `trimTrailingMs` is for the callers that
 * cannot afford the closing lag.
 */
export function intervalsAtLeast(
	points: readonly TargetCountPoint[],
	min: number,
	endMs: number,
	/**
	 * How much of each stretch's **closing** edge is window lag rather than measurement, for a caller
	 * that must not be handed it. Zero — no trim — for every caller that wants the stretches as the
	 * series states them.
	 *
	 * The number to pass is `windowMs` less whatever grace the caller owes, and that it lands exactly
	 * rather than approximately is the whole reason this is a subtraction: the count can only *fall* at
	 * a moment some hit ages out, which is `hit + windowMs`. So a stretch closed by a fall closes at
	 * exactly `windowMs` past the last hit on the `min`-th enemy — the last moment the count had
	 * evidence for `min` targets — and taking `windowMs - grace` off it lands on `thatHit + grace` to
	 * the millisecond. Measured on `elemental/__fixtures__/cleave.json`, the one committed fixture with
	 * three-target time: seven of its eight three-target stretches close exactly 5 000ms after the last
	 * hit on their third enemy, and the eighth is the one the pull ended inside.
	 *
	 * **Why a caller would want it.** A stretch used to *band a press* wants the lag and must keep it:
	 * the player pressed on what they knew, and a third enemy hit a second ago is still a third enemy.
	 * A stretch used to **exempt** a clock is the other thing — it hands time back with nothing charged,
	 * and a window's worth of that at the end of every add wave is boss-only time forgiven. On `cleave`
	 * that is 34 934ms of the 109 869ms its three-target stretches cover — 31.8% of the exemption — of
	 * which 28 378ms falls after the last hit any add in that stretch ever took. A third of that pull's
	 * exemption is the window rather than the adds.
	 *
	 * **A stretch the pull ended inside is never trimmed**, which is the judgement `spawnLives` already
	 * makes at the fight's end. Its close is `endMs` — the fight stopping, not the count falling — so there is
	 * no lag in it to take off, and cutting one would charge a player for adds that were still up when
	 * the fight ended. `cleave`'s eighth stretch is exactly that: it closes 1 179ms after its third
	 * enemy's last hit because the boss died, and a blind trim would take 3 500ms off a 1 232ms stretch.
	 *
	 * A stretch left with nothing by the trim is dropped, which is the reading of it rather than a
	 * rounding: no moment of it was within the grace of `min`-target contact.
	 */
	trimTrailingMs = 0,
): Interval[] {
	const out: Interval[] = [];
	let open: number | null = null;
	for (const [t, count] of points) {
		if (count >= min && open === null) open = t;
		else if (count < min && open !== null) {
			// Clamped to the pull, not just the still-open stretch. `targetCounts` closes the series with
			// a `[lastHit + windowMs, 0]` point, which is up to a window past the end of the fight — so a
			// stretch closed by that point used to be emitted unclamped, and `contactMs` came out longer
			// than the pull it was measured over.
			const clamped = Math.min(t, endMs);
			// Trimmed only where the count fell inside the pull: at `endMs` the close is the fight ending and not
			// a fall, so it carries no window lag to take off — see `trimTrailingMs`.
			const close = clamped < endMs ? Math.max(open, clamped - trimTrailingMs) : clamped;
			if (close > open) out.push([open, close]);
			open = null;
		}
	}
	if (open !== null && endMs > open) out.push([open, endMs]);
	return out;
}
