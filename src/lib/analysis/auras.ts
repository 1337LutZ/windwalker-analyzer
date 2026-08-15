import { abilityIdOf, isAuraApply, isAuraRefresh, isAuraRemove, isStackChange, type WclEvent } from '~/lib/events';
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

/** A stretch over which a stacking aura held one constant level. Level 0 is never emitted. */
export interface AuraLevel {
	start: number;
	end: number;
	/** Stacks held across the stretch. For a counter aura this is the thing being counted. */
	level: number;
	/** True when the fight ended before the aura did, the same sense `Window.truncated` carries. */
	truncated?: boolean;
}

/**
 * A stacking aura read as a *level over time* rather than as apply→remove pairs.
 *
 * `auraWindows` above answers "was it up", and for most auras that is the whole question. It is not
 * the question a counter aura asks. Storm, Earth and Fire logs one id — 137639 — whose stack count
 * **is** the number of spirits out, and a second spirit arrives as `applybuffstack stack: 2` with no
 * second `applybuff` behind it. `auraWindows` classes the four stack event types as neither an apply
 * nor a removal and drops them, so on such a log it cannot see the second spirit at all — and, worse,
 * cannot see the *first* one either whenever the opening apply happened before the pull.
 *
 * That is not hypothetical. Measured on a:YBQzrcgVJnAj7NMP fight 15, where the monk placed a spirit
 * before the pull and the fight's first aura event is therefore `applybuffstack stack: 2` at 6.1s:
 * `auraWindows` returns a single window opening at 2:49.8, and the two minutes and forty-three
 * seconds a spirit was demonstrably out — its pet swinging from 2.6s — simply are not in it.
 *
 * The walk itself is the ordinary one:
 *   - an apply sets the level to 1, a removal to 0;
 *   - every stack event carries the level that *remains*, so it is assigned rather than added;
 *   - a refresh moves nothing, for the reason `auraWindows` gives.
 *
 * **A stack event with no window open means the aura was already running when the fight began**, and
 * the stretch is opened at `t0` rather than at the event. A stack change cannot fire on an aura that
 * is not applied, so this is arithmetic and not a guess: `applybuffstack stack: n` says one landed on
 * top of `n - 1` that were already there. On the pull above that infers exactly one spirit before
 * 6.1s, which is exactly the one pet found swinging there. The level is floored at 1 because that
 * inference is only ever "at least one was out" — the direction that cannot invent a spirit.
 *
 * A stretch still open when the fight ends runs to `fightEnd`, the same as a window does.
 */
export function auraLevels(events: readonly WclEvent[], aura: Aura, t0: number, fightEnd: number): AuraLevel[] {
	const ids = new Set(aura.ids);
	const out: AuraLevel[] = [];
	let level = 0;
	let since = 0;

	// Closes the stretch that was running and starts the next one. Only a *change* is a boundary, so a
	// stack event landing on the level it already held draws no seam.
	const moveTo = (next: number, at: number) => {
		if (next === level) return;
		if (level > 0) out.push({ start: since, end: at, level });
		level = next;
		since = at;
	};

	for (const e of events) {
		const id = abilityIdOf(e);
		if (id === null || !ids.has(id)) continue;
		const at = e.timestamp - t0;

		if (isAuraApply(e)) moveTo(1, at);
		else if (isAuraRemove(e)) moveTo(0, at);
		else if (isStackChange(e)) {
			// The pre-fight inference. `since` stays at 0 because the level it opens was already being
			// held when the pull started; only the level itself is read off this event.
			if (level === 0) {
				const gained = e.type === 'applybuffstack' || e.type === 'applydebuffstack';
				level = Math.max(1, gained ? e.stack - 1 : e.stack + 1);
				since = 0;
			}
			moveTo(e.stack, at);
		}
	}

	if (level > 0) out.push({ start: since, end: fightEnd - t0, level, truncated: true });
	return out;
}

/**
 * The stretches an aura held at least `atLeast` stacks, as windows.
 *
 * Adjacent stretches are joined, so a level walking 2 → 1 without ever reaching 0 reads as one
 * continuous window at a threshold of 1 — which is the claim "a spirit was out" actually makes.
 */
export function levelWindows(levels: readonly AuraLevel[], atLeast = 1): Window[] {
	const out: Window[] = [];
	for (const l of levels) {
		if (l.level < atLeast) continue;
		const last = out[out.length - 1];
		// Joining carries the later stretch's truncation with it: what matters to a reader is whether the
		// *window* was still open at the last event, not which of the levels inside it was.
		if (last !== undefined && last.end === l.start) {
			last.end = l.end;
			if (l.truncated === true) last.truncated = true;
		} else out.push({ start: l.start, end: l.end, ...(l.truncated === true ? { truncated: true } : {}) });
	}
	return out;
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
