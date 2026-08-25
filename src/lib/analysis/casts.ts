import { abilityIdOf, isBeginCast, isCast, type WclEvent, instanceKey } from '~/lib/events';
import type { Ability } from '~/lib/game/model';
import type { Registry } from '~/lib/game/registry';
import type { CastRow } from '~/lib/types';
import { median, r1 } from './format';

/**
 * One press: when it happened, and the enemy spawn it was *aimed at*.
 *
 * The target is separate from "the enemy the player was hitting around then", and for a button that
 * can be aimed the difference is the whole question. A deliberate second dot on an add is aimed at the
 * add while every hit either side of it lands on the boss, so a press graded against the *hit* enemy
 * is graded against the wrong one. `spawn` is `instanceKey`-shaped for that reason: WarcraftLogs gives
 * one actor id to an NPC type, so the id alone cannot tell two adds apart.
 *
 * Both fields are optional because a cast event need not name a target — a self-buff names none, and
 * a press whose target the log omits must read as "cannot say" rather than as the player's current
 * enemy.
 */
export interface CastPress {
	/**
	 * When the press *landed* — the instant the `cast` event fired and the spell took effect.
	 *
	 * For an instant press this is also when it was decided; for a cast-time spell the two are up to
	 * ~2.5s apart, and `begin` is the other one. Read this one only for a question about the effect:
	 * what the hit did, what the snapshot took, when the dot went on. Anything grading the *choice*
	 * wants `begin` — see the note there.
	 */
	t: number;
	/**
	 * When the press was *committed* — the `begincast` that opened it, or `t` for an instant.
	 *
	 * The decision instant, and the one almost every judgement wants. A two-second cast judged at `t`
	 * is judged on what the player knew two seconds after they chose, which is not the thing being
	 * graded: by then the proc they were reacting to may have expired, the dot they were refreshing may
	 * have fallen off, and the resource they spent has already been deducted. The priority list decides
	 * at `begin`.
	 *
	 * Equal to `t` whenever the log gives no usable `begincast`, which covers every instant press (both
	 * events land in the same millisecond) and a cast whose `begincast` was never paired. Never after
	 * `t`, so `[begin, t]` is always a well-formed interval and a consumer may treat it as the press's
	 * own span.
	 */
	begin: number;
	target?: number;
	instance?: number;
	/** `instanceKey(target, instance)`, or null where the event named no target. */
	spawn: string | null;
}

export interface CastSeries {
	/** The button pressed, when the registry models the id behind these events. */
	ability: Ability | null;
	/** Series key: the ability's key, or `#<id>` for a press nothing models. */
	key: string;
	/** A representative spell id — the first one seen, since one button can log several. */
	id: number;
	count: number;
	/** Fight-relative instants each press *landed*, in log order — `CastPress.t`. */
	times: number[];
	/**
	 * Fight-relative instants each press was *committed*, in log order — `CastPress.begin`.
	 *
	 * Parallel to `times` and element-for-element with it, so a consumer that had `times[i]` can move
	 * to the decision instant without also having to move to `presses`. Identical to `times` for a spec
	 * of instants, which is why this barely touches the Windwalker.
	 */
	beginTimes: number[];
	/**
	 * The same presses with their aimed target, in the same order as `times`.
	 *
	 * Parallel to `times` rather than replacing it: `times` has many readers that want nothing but the
	 * clock, and widening them all to reach `.t` would be churn for no gain.
	 */
	presses: CastPress[];
}

export interface CastDurations {
	/** How long each completed cast took, keyed `<ability id>:<landing time>`. */
	durations: Map<string, number>;
	/**
	 * The `begincast`s no `cast` ever completed, by raw ability id — a press that started and was
	 * interrupted.
	 *
	 * The leftovers of the pairing rather than a second walk over the events, which is the only way the
	 * two can be guaranteed to agree: a cancel is exactly a `begincast` this function did not consume.
	 */
	cancelled: Map<number, number[]>;
}

/**
 * How long each completed cast took, and which `begincast`s never completed at all.
 *
 * A cast-time spell logs a `begincast` when it starts and a `cast` when it completes; an instant press
 * logs only the `cast`. Pair each completed cast with the `begincast` that opened it to measure the
 * cast time, and treat a `begincast` no `cast` ever follows as a cancel. Keyed per ability id and
 * matched most-recent-first, because starting a second cast of the same spell cancels the first — the
 * log never says so, it just starts the next `begincast`.
 *
 * This measurement used to live inline in `analyseCore`, where it fed the GCD walk and nothing else,
 * while `castSeries` two hundred lines above it never looked at `begincast` at all. That is precisely
 * how the two came to disagree by a whole cast time: the GCD maths anchored occupancy at the commit
 * and every consumer of the cast series was reading the landing. One copy, both callers.
 */
export function measureCastDurations(
	events: readonly WclEvent[],
	sourceID: number,
	t0: number,
	registry: Registry,
): CastDurations {
	/** Wider than any cast in either spec, so a `begincast` this stale is a cancel and not a pairing. */
	const MAX_CAST_MS = 5000;
	/**
	 * Under this a press is an instant, not a cast.
	 *
	 * An instant press logs its `begincast` and `cast` in the same millisecond — occasionally a hair
	 * apart — and calling that a cast time would put a meaningless bar on the chart and pull a cancel's
	 * median toward zero. It also means `begin === t` for an instant, which is what makes the two
	 * instants collapse harmlessly on a spec of instants.
	 */
	const MIN_CAST_MS = 100;
	const beginByAbility = new Map<number, number[]>();
	const durations = new Map<string, number>();
	for (const e of events) {
		if (e.sourceID !== sourceID) continue;
		const id = abilityIdOf(e);
		if (id === null) continue;
		const t = e.timestamp - t0;
		if (isBeginCast(e)) {
			const stack = beginByAbility.get(id) ?? [];
			stack.push(t);
			beginByAbility.set(id, stack);
		} else if (isCast(e)) {
			if (registry.isChannelTick(id)) continue;
			const stack = beginByAbility.get(id);
			if (stack === undefined) continue;
			const begin = stack.length > 0 ? stack[stack.length - 1] : undefined;
			if (begin !== undefined && t - begin <= MAX_CAST_MS) {
				stack.pop();
				// Keyed by id *and* time, not time alone — an instant press lands in the same millisecond
				// as the cast that finished before it, and one key would hand it that cast's time.
				if (t - begin >= MIN_CAST_MS) durations.set(`${id}:${t}`, t - begin);
			}
		}
	}
	// Whatever is still on a stack was never completed. Empty stacks are dropped so a caller can read
	// the map's size as "how many buttons were cancelled" without filtering it first.
	const cancelled = new Map<number, number[]>();
	for (const [id, stack] of beginByAbility) {
		if (stack.length > 0) cancelled.set(id, stack);
	}
	return { durations, cancelled };
}

/**
 * Cast events grouped by the ability they belong to.
 *
 * Grouped through the registry rather than by raw id or by name, because the log is not one id per
 * button in either direction. Jab logs a different id per weapon type, so keying by id splits one
 * button in two and halves its cast count; a channel's ticks each log a `cast` under the tick id and
 * share the channel's *name*, so keying by name turned twelve Fists of Fury into seventy-one casts.
 * `registry.isChannelTick` is what drops those ticks — a tick is not a press.
 *
 * Ids the registry does not model are still counted, under a `#<id>` key: trinkets, racials and
 * potions are real presses and belong in the cast table even though no analysis hangs off them.
 */
export function castSeries(
	events: readonly WclEvent[],
	sourceID: number,
	t0: number,
	registry: Registry,
	/**
	 * Cast lengths from `measureCastDurations`, which is what lets each press carry its commit instant.
	 *
	 * Optional so that a caller with no interest in the distinction — a test naming three instants, say
	 * — need not build one, and omitting it is not a silent downgrade: with no durations every `begin`
	 * equals its `t`, which is the correct answer for an instant and the honest one for a caller that
	 * did not supply the evidence.
	 */
	durations?: ReadonlyMap<string, number>,
): Map<string, CastSeries> {
	const out = new Map<string, CastSeries>();
	for (const e of events) {
		if (!isCast(e) || e.sourceID !== sourceID) continue;
		const id = abilityIdOf(e);
		// A channel tick and an echo are both logged as casts and neither is a press. Skipped together,
		// because the alternative is the same for both: an id nothing models becomes a `#88263` row in
		// the cast table, and a reader is shown a button that does not exist.
		if (id === null || registry.isChannelTick(id) || registry.isEchoCast(id)) continue;

		const ability = registry.abilityByCastId(id) ?? null;
		const key = ability?.key ?? `#${id}`;
		const rec = out.get(key) ?? { ability, key, id, count: 0, times: [], beginTimes: [], presses: [] };
		rec.count++;
		const t = e.timestamp - t0;
		// `t` when nothing measured a cast time: an instant press, or a cast whose `begincast` the log
		// never paired. Never later than `t`, so `[begin, t]` is always a well-formed span.
		const begin = t - (durations?.get(`${id}:${t}`) ?? 0);
		rec.times.push(t);
		rec.beginTimes.push(begin);
		rec.presses.push({
			t,
			begin,
			...(e.targetID === undefined ? {} : { target: e.targetID }),
			...(e.targetInstance === undefined ? {} : { instance: e.targetInstance }),
			spawn: e.targetID === undefined ? null : instanceKey(e.targetID, e.targetInstance),
		});
		out.set(key, rec);
	}
	return out;
}

export function gapStats(times: readonly number[]): {
	medianGapSec: number;
	longestGapSec: number;
} {
	const gaps = times.slice(1).map((t, i) => t - (times[i] ?? t));
	return {
		medianGapSec: r1(median(gaps) / 1000),
		longestGapSec: r1(Math.max(0, ...gaps) / 1000),
	};
}

export interface CastTableOptions {
	/**
	 * The player's own contact clock — `unionMs(contact)` in `analyseCore`, the time they were in a
	 * position to press something. Not WarcraftLogs' `activeTime`, which is what this was.
	 *
	 * **Not an independent choice of clock — it has to be whichever one `cpm.totalCpm` uses.** These rows
	 * are the same count of presses cut per ability, and two things join the two figures at the hip: the
	 * suite asserts Σ of the on-GCD rows' `cpm` equals `totalCpm` (two code paths, so it fails the moment
	 * one side moves alone), and `CastsPerMinute.tsx` multiplies a row's rate back by this same span to
	 * print a cast count. Both moved onto contact in the change that moved `totalCpm`; the reasoning is
	 * at that field's own line in `analyseCore`.
	 *
	 * Named `contactMs` rather than left as `activeMs` on purpose. A caller that has only WarcraftLogs'
	 * span can still pass it and get a defensible number, but it will no longer be able to do so without
	 * noticing which clock the parameter is asking for — that silence is exactly how the two figures
	 * ended up on different clocks in the first place.
	 */
	contactMs: number;
	/** Names for ids the registry does not model, usually taken from the damage table. */
	nameOf(id: number): string;
}

/**
 * Per-ability cast rows, busiest first.
 *
 * Deliberately carries no "N of M possible" figure. That number ignores when the boss was
 * targetable, when the fight ended and every condition the priority list puts on a button; each row
 * reports the `gate` the ability declares instead, and cooldown drift answers the same question in a
 * way the log can support.
 */
export function buildCastTable(series: Iterable<CastSeries>, opts: CastTableOptions): CastRow[] {
	const contactMin = opts.contactMs / 60000;
	return [...series]
		.map((c) => ({
			id: c.id,
			name: c.ability?.name ?? opts.nameOf(c.id),
			count: c.count,
			// Nothing is known about an unmodelled press, and the off-GCD assumption is the safe one:
			// counting a trinket as a global would inflate GCD utilisation past what was pressed.
			//
			// Safe for a trinket and catastrophic for a rotational button, and this default cannot tell
			// them apart — so it is paired with `unmodelledPresses` below rather than trusted alone.
			// Chain Lightning was missing from the Elemental registry through 53 tests: every press was
			// labelled off-GCD here and skipped by the core's GCD walk, which read 56.02% utilisation on
			// a pull that filled 90.81% of its globals, and reported 15.7% of the damage as though no
			// cast had produced it. The default was right; the silence around it was the bug.
			onGcd: c.ability?.onGcd ?? false,
			gate: c.ability?.gate ?? 'other',
			cpm: contactMin > 0 ? c.count / contactMin : 0,
			cooldownSec: c.ability?.cooldownMs ? c.ability.cooldownMs / 1000 : null,
			// Cadence off the commit instants, not the landings: "how often did they press this" is a
			// question about presses. Landing-to-landing folds each press's own cast bar into the gap
			// before it, and because a cast bar shortens with haste it folds in haste too — so the same
			// rotation read a different cadence under Bloodlust than outside it. Commit-to-commit is the
			// interval the player actually chose. Identical on an instant button.
			...gapStats(c.beginTimes),
			// Left as the landing instants deliberately. This array is published on `Analysis`, and
			// `CastTimeline` back-computes the bar's left edge from it as `t - castTimeMs`; re-pointing it
			// would shift every icon on the chart by a cast bar and reinterpret every stored analysis.
			times: c.times,
		}))
		.sort((a, b) => b.count - a.count);
}

/**
 * The rows of a cast table that no `Ability` claims — the presses this report priced at nothing.
 *
 * The counterweight to the `?? false` above, and the reason it can stay. An unmodelled press costs a
 * spec nothing visible: it occupies no global in `gcdUtilisationPct`, contributes no `onGcdCasts` to
 * `totalCpm`, and its damage is filed under `passive` as though it arrived unbidden. All three of
 * those are correct for a trinket proc and all three are wrong for a filler, and the shared layer
 * cannot tell which it is holding — only the spec knows, and only by declaring it.
 *
 * So the shared layer stops guessing and starts counting. This is the number a spec has to be able to
 * look at: `fixtureCoverage.test.ts` walks it over every committed raw fixture and fails on any id
 * that is neither a modelled ability nor on the spec's own `extraNames` list, so forgetting a button
 * is a red test at fixture-commit time rather than a percentage that quietly reads two thirds of what
 * it should. `pulls.test.ts` pins the per-pull count on top of that, which is what makes a *new*
 * unmodelled press visible on a fixture that already had some.
 *
 * Both halves are needed. The count alone would have been pinned at 92 on the Elemental's
 * multi-target pull and read as normal; the declared list alone would not notice a press appearing on
 * a fixture whose ids were already all accounted for.
 */
export function unmodelledPresses(rows: readonly CastRow[], registry: Registry): CastRow[] {
	return rows.filter((row) => registry.abilityByCastId(row.id) === undefined);
}

export interface Channel {
	start: number;
	ticks: number;
	/** Measured from the tick stream, so haste is already in the number. */
	channelMs: number;
}

export interface ChannelOptions {
	/** Ticks can be stamped a hair before the cast event. */
	leadMs?: number;
	/** Widest a single channel can be, used to stop one channel claiming the next one's ticks. */
	maxMs?: number;
	/** Time the final tick still occupies. */
	tickMs?: number;
}

/**
 * When each of a channel's ticks landed, fight-relative.
 *
 * The tick id comes off the ability rather than from the caller: it is the same number the registry
 * refuses to treat as a cast, so taking both from one place is what keeps `castSeries` and this
 * function from ever disagreeing about which id is the press.
 */
export function channelTickTimes(
	events: readonly WclEvent[],
	ability: Ability,
	sourceID: number,
	t0: number,
): number[] {
	const tickId = ability.channel?.tickId;
	if (tickId === undefined) return [];
	return events
		.filter((e) => isCast(e) && e.sourceID === sourceID && abilityIdOf(e) === tickId)
		.map((e) => e.timestamp - t0);
}

/**
 * How long each channel actually locked the player out.
 *
 * A channel costs several globals, so assuming one GCD per cast understates it — and assuming a base
 * channel time needs a haste value the log does not give up. Measure it from the ticks.
 */
export function measureChannels(
	starts: readonly number[],
	tickTimes: readonly number[],
	{ leadMs = 200, maxMs = 8000, tickMs = 1000 }: ChannelOptions = {},
): Channel[] {
	return starts.map((start) => {
		const ticks = tickTimes.filter((t) => t >= start - leadMs && t <= start + maxMs);
		const last = ticks[ticks.length - 1];
		return {
			start,
			ticks: ticks.length,
			channelMs: last === undefined ? 0 : last - start + tickMs,
		};
	});
}
