import { abilityIdOf, isCast, type WclEvent } from '~/lib/events';
import type { Ability } from '~/lib/game/model';
import type { Registry } from '~/lib/game/registry';
import type { CastRow } from '~/lib/types';
import { median, r1 } from './format';

export interface CastSeries {
	/** The button pressed, when the registry models the id behind these events. */
	ability: Ability | null;
	/** Series key: the ability's key, or `#<id>` for a press nothing models. */
	key: string;
	/** A representative spell id — the first one seen, since one button can log several. */
	id: number;
	count: number;
	/** Fight-relative cast times, in log order. */
	times: number[];
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
): Map<string, CastSeries> {
	const out = new Map<string, CastSeries>();
	for (const e of events) {
		if (!isCast(e) || e.sourceID !== sourceID) continue;
		const id = abilityIdOf(e);
		if (id === null || registry.isChannelTick(id)) continue;

		const ability = registry.abilityByCastId(id) ?? null;
		const key = ability?.key ?? `#${id}`;
		const rec = out.get(key) ?? { ability, key, id, count: 0, times: [] };
		rec.count++;
		rec.times.push(e.timestamp - t0);
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
	/** WarcraftLogs' active time for the player: CPM against it is the fair read. */
	activeMs: number;
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
	const activeMin = opts.activeMs / 60000;
	return [...series]
		.map((c) => ({
			id: c.id,
			name: c.ability?.name ?? opts.nameOf(c.id),
			count: c.count,
			// Nothing is known about an unmodelled press, and the off-GCD assumption is the safe one:
			// counting a trinket as a global would inflate GCD utilisation past what was pressed.
			onGcd: c.ability?.onGcd ?? false,
			gate: c.ability?.gate ?? 'other',
			cpm: activeMin > 0 ? c.count / activeMin : 0,
			cooldownSec: c.ability?.cooldownMs ? c.ability.cooldownMs / 1000 : null,
			...gapStats(c.times),
			times: c.times,
		}))
		.sort((a, b) => b.count - a.count);
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
