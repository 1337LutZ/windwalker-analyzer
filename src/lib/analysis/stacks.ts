import { abilityIdOf, isAuraApply, isAuraRefresh, isAuraRemove, isStackChange, type WclEvent } from '~/lib/events';
import type { Aura } from '~/lib/game/model';
import type { Window } from '~/lib/types';

export interface StackDrain {
	t: number;
	/** Bank immediately before the drain. */
	before: number;
	consumed: number;
}

export interface StackBank {
	drains: StackDrain[];
	/** `[t, stacks]` after every bank event, for plotting. */
	timeline: Array<[number, number]>;
	maxStacks: number;
	/** Stack gains that arrived on a bank already at the cap. */
	wastedAtCap: number;
	/** Stacks still banked when the fight ended — damage never taken. */
	bankAtEnd: number;
}

/**
 * A stacking counter aura read as a running bank.
 *
 * The drain is logged ~1 ms *before* the cast that spent it, so sampling the bank at the cast always
 * reads a bank that has already been emptied. The consumed count comes off the removal instead: a
 * stack removal carries the stacks that *remain*, and a bare remove means the whole bank went.
 *
 * The cap comes off the aura rather than from the caller, because it is the same number that decides
 * whether a lone refresh was a stack the bank had no room for.
 */
export function trackStackBank(events: readonly WclEvent[], aura: Aura, targetID: number, t0: number): StackBank {
	const ids = new Set(aura.ids);
	const cap = aura.maxStacks ?? Infinity;
	const bankEvents = events.filter((e) => {
		const id = abilityIdOf(e);
		return id !== null && ids.has(id) && e.targetID === targetID;
	});

	const drains: StackDrain[] = [];
	const timeline: Array<[number, number]> = [];
	let stacks = 0;
	let maxStacks = 0;
	let wastedAtCap = 0;

	for (const e of bankEvents) {
		const t = e.timestamp - t0;
		if (isAuraApply(e)) {
			stacks = 1;
		} else if (isStackChange(e)) {
			if (e.type === 'applybuffstack' || e.type === 'applydebuffstack') {
				stacks = e.stack;
			} else {
				drains.push({ t, before: stacks, consumed: stacks - e.stack });
				stacks = e.stack;
			}
		} else if (isAuraRefresh(e)) {
			// A gain that actually landed emits its own apply on the same millisecond; a lone refresh
			// at the cap is a stack the bank had no room for.
			const paired = bankEvents.some((x) => x.timestamp === e.timestamp && (isAuraApply(x) || isStackChange(x)));
			if (!paired && stacks >= cap) wastedAtCap++;
		} else if (isAuraRemove(e)) {
			drains.push({ t, before: stacks, consumed: stacks });
			stacks = 0;
		} else {
			// A cast or a damage event under the same id is not bank movement; leave the bank alone
			// and do not plot a point for it.
			continue;
		}
		maxStacks = Math.max(maxStacks, stacks);
		timeline.push([t, stacks]);
	}

	return { drains, timeline, maxStacks, wastedAtCap, bankAtEnd: stacks };
}

export interface PairedDrain extends StackDrain {
	/** The buff window this drain paid for, or null if it opened none. */
	window: Window | null;
	/** True when the drain landed inside a window that was already running — a re-cast. */
	refresh: boolean;
}

/**
 * Match each bank drain to the buff window it bought.
 *
 * Two shapes count as a use. A drain within `openToleranceMs` of a window's start *opened* that
 * window; a drain inside a running one re-cast the buff, which WarcraftLogs records as a
 * `refreshbuff` that pushes the existing window's removal later instead of opening a second one.
 * Seventeen casts legitimately show up as fifteen windows for exactly this reason.
 *
 * Pairing has to be done this way round rather than by looking the window up at the drain's
 * timestamp: the drain lands ~1 ms *before* its own buff's apply, so a `t >= window.start` search
 * misses every window a drain opened and reports nothing snapshotted at all.
 */
export function pairDrainsToWindows(
	drains: readonly StackDrain[],
	windows: readonly Window[],
	openToleranceMs = 1500,
): PairedDrain[] {
	return drains.map((d) => {
		const opened = windows.find((w) => Math.abs(w.start - d.t) < openToleranceMs);
		const inside = windows.find((w) => d.t > w.start && d.t <= w.end);
		return {
			...d,
			window: opened ?? inside ?? null,
			refresh: !opened && !!inside,
		};
	});
}

/**
 * When a snapshot taken at `at` stops being worth anything.
 *
 * The aura window is NOT the snapshot's lifetime. The buff always lasts `aura.durationMs`, but
 * re-casting while it runs emits a `refreshbuff` rather than a new `applybuff`, so a single
 * apply→remove pair can span two applications — 28.7s in one observed case. The aura really was up
 * that whole time; the snapshot was not, because the re-cast freezes current stats afresh and
 * discards what the earlier one held.
 *
 * A snapshot therefore lives until the soonest of the aura's own duration, the next cast, and the
 * aura dropping. Using the raw window credited one proc with 19.6s of overlap against a 15s buff.
 */
export function snapshotWindowEnd(at: number, window: Window, aura: Aura, nextUseAt: number | null): number {
	return Math.min(window.end, at + (aura.durationMs ?? Infinity), nextUseAt ?? Infinity);
}
