import { abilityIdOf, isAuraApply, isAuraRefresh, isAuraRemove, type WclEvent } from '~/lib/events';
import type { Aura } from '~/lib/game/model';
import type { Window } from '~/lib/types';
import { unionMs, type Interval } from './intervals';

/**
 * Aura events stamped this close to a cast are treated as belonging to that cast.
 *
 * A buff the cast itself applies is logged 0–2 ms *before* the cast event, so reading the buff clock
 * "at the cast" — or even strictly before it — returns the buff this very press just refreshed, and
 * every press then scores a full duration remaining. The first run of the Tiger Palm metric called
 * 15 of 33 presses wasted; with this guard the real answer was 0.
 */
export const SELF_EVENT_MS = 250;

/** A window, plus the id that opened it — which is the variant when the aura's ids encode one. */
export interface AuraWindow extends Window {
	/** Which of `aura.ids` this window belongs to. */
	id: number;
	/** `aura.variants[id]`: e.g. which stat a Re-Origination proc converted into. */
	variant?: string;
}

/**
 * Apply→remove pairs for one aura, as fight-relative windows.
 *
 * Each of the aura's ids is tracked separately and the results merged in time order. That is what an
 * aura whose id encodes a variant needs — Re-Origination logs a different id per stat it hands back,
 * and reading only one of them undercounted one monk's 15 procs as 12 — while an aura that is merely
 * logged under several ids still comes back as one stream.
 *
 * A `refreshbuff` inside a running window is deliberately ignored: WarcraftLogs emits no second
 * apply for a re-cast, so one apply→remove pair can span several applications. That makes a window
 * the aura's continuous lifetime, which is not the same thing as the lifetime of what a buff
 * captured — see `snapshotWindowEnd`.
 *
 * A window still open when the fight ends is closed at `fightEnd` and marked `truncated`.
 */
export function auraWindows(events: readonly WclEvent[], aura: Aura, t0: number, fightEnd: number): AuraWindow[] {
	const ids = new Set(aura.ids);
	const open = new Map<number, number>();
	const out: AuraWindow[] = [];
	const variantOf = (id: number): string | undefined => aura.variants?.[id];

	for (const e of events) {
		const id = abilityIdOf(e);
		if (id === null || !ids.has(id)) continue;

		if (isAuraApply(e)) {
			if (!open.has(id)) open.set(id, e.timestamp);
		} else if (isAuraRemove(e)) {
			const start = open.get(id);
			if (start !== undefined) {
				out.push({
					start: start - t0,
					end: e.timestamp - t0,
					id,
					variant: variantOf(id),
				});
				open.delete(id);
			}
		}
	}

	for (const [id, start] of open) {
		out.push({
			start: start - t0,
			end: fightEnd - t0,
			truncated: true,
			id,
			variant: variantOf(id),
		});
	}
	return out.sort((a, b) => a.start - b.start);
}

export function toIntervals(windows: readonly Window[]): Interval[] {
	return windows.map((w) => [w.start, w.end]);
}

export function inWindow(t: number, windows: readonly Window[]): boolean {
	return windows.some((w) => t >= w.start && t <= w.end);
}

/** Time left on whichever window covers `t`, or 0 when none does. */
export function remainingIn(t: number, windows: readonly Window[]): number {
	const w = windows.find((x) => t >= x.start && t <= x.end);
	return w ? w.end - t : 0;
}

export function uptimePct(windows: readonly Window[], durationMs: number): number {
	return durationMs > 0 ? (unionMs(toIntervals(windows)) / durationMs) * 100 : 0;
}

/** One moment an aura went up (applied or refreshed) or came off, fight-relative. */
export interface AuraPoint {
	t: number;
	/** True for an apply or a refresh — both restart the clock — false for a removal. */
	up: boolean;
}

/** Every apply, refresh and removal of one aura, in time order. */
export function auraTimeline(events: readonly WclEvent[], aura: Aura, t0: number): AuraPoint[] {
	const ids = new Set(aura.ids);
	const out: AuraPoint[] = [];
	for (const e of events) {
		const id = abilityIdOf(e);
		if (id === null || !ids.has(id)) continue;
		if (isAuraApply(e) || isAuraRefresh(e)) out.push({ t: e.timestamp - t0, up: true });
		else if (isAuraRemove(e)) out.push({ t: e.timestamp - t0, up: false });
	}
	return out.sort((a, b) => a.t - b.t);
}

/**
 * How much of an aura was left when the player pressed something at `t`, deliberately blind to the
 * aura events that press caused.
 *
 * This is the only honest way to ask "did that cast refresh a buff that was about to drop, or clip a
 * healthy one". The refresh a cast produces is stamped a millisecond or two *before* the cast, so
 * anything looking strictly backwards from `t` reads the answer the cast itself just wrote — see
 * `SELF_EVENT_MS`.
 *
 * An aura with no declared duration cannot be given a remaining time at all, and reads as 0 rather
 * than as an invented full window.
 */
export function remainingAtCast(
	timeline: readonly AuraPoint[],
	t: number,
	aura: Aura,
	guardMs = SELF_EVENT_MS,
): number {
	const durationMs = aura.durationMs ?? 0;
	let expiry = -Infinity;
	for (const point of timeline) {
		if (point.t >= t - guardMs) break;
		expiry = point.up ? point.t + durationMs : point.t;
	}
	return Math.max(0, expiry - t);
}
