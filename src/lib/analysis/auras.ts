import {
	abilityIdOf,
	isAuraApply,
	isAuraRefresh,
	isAuraRemove,
	isCast,
	isStackChange,
	type WclEvent,
} from '~/lib/events';
import type { Aura } from '~/lib/game/model';
import type { Window } from '~/lib/types';
import { overlapMs, unionMs, type Interval } from './intervals';

/**
 * Aura events stamped this close to a cast are treated as belonging to that cast.
 *
 * A buff the cast itself applies is logged 0–2 ms *before* the cast event, so reading the buff clock
 * "at the cast" — or even strictly before it — returns the buff this very press just refreshed, and
 * every press then scores a full duration remaining. The first run of the Tiger Palm metric called
 * 15 of 33 presses wasted; with this guard the real answer was 0.
 */
export const SELF_EVENT_MS = 250;

/**
 * The shortest gap in an aura worth calling a drop.
 *
 * One global. Below that it is refresh jitter — the log stamping a remove a few hundred milliseconds
 * before the reapply that replaced it — and jitter reported as a drop is a fault the pull did not
 * have. Every reader of a dot's downtime wants the same threshold, so it lives beside the walk that
 * produces the windows rather than inside whichever spec asked first.
 */
export const DROP_MS = 1000;

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
 * `openOnRefresh` is for the case where a refresh arrives with *nothing* open, which the default
 * behaviour throws away. An aura cannot be refreshed unless it is already there, so such an event is
 * proof the aura was up and the apply that started it never reached this stream — WarcraftLogs emits
 * this constantly for a debuff re-applied to an enemy it is already on. Off by default because for a
 * buff it would also invent a window count: `procs` and `comboBreaker` count these windows as procs,
 * and an orphan refresh would become an extra proc nobody got. On by default is wrong; on where the
 * caller measures *coverage* rather than counts is right. Measured on one Galakras pull, the
 * discarded refreshes were 42.3 seconds of Rising Sun Kick uptime.
 *
 * The window opens at the refresh rather than back-dated to when the aura must have gone up, so it
 * under-states rather than invents.
 *
 * `openAtPull` is the mirror image, for the aura that was **already running when the fight began**.
 * A fight-scoped event query returns only what happened inside the fight, so a buff applied before
 * the pull leaves nothing behind but its own `removebuff` — no apply, no cast, nothing to pair it
 * with — and the default behaviour throws that away exactly as it throws away an orphan refresh. The
 * standing example is a pre-pull potion, which is ordinary play: measured on a:6MhZgjyAknFWrYfK
 * fight 16, six of the raid's players show a bare `removebuff` of Virmen's Bite between 21.9s and
 * 24.8s and no apply of it at all, while every potion drunk *inside* those same fights carries the
 * full apply + cast + remove triple.
 *
 * Two things make that an inference rather than a guess, and both are enforced here:
 *
 *   - **Nothing may have opened the aura earlier in the stream.** An apply, a refresh or a `cast`
 *     under one of the aura's own ids all prove the opening was logged, so a later unpaired removal
 *     is something else and is dropped as before. `cast` is included because it is the event the
 *     rule is actually written against and because it costs nothing to be independent of WarcraftLogs
 *     always emitting the apply beside it.
 *   - **The removal must land inside the aura's own duration.** An aura running at `t0` cannot
 *     survive past `t0 + durationMs`, so a bare removal after that was never a pre-pull application.
 *     An aura with no declared duration therefore never qualifies — the bound cannot be checked, and
 *     an unbounded version of this rule would fire on any orphan removal anywhere in a pull. Across
 *     the three anonymous reports 288 bare removals of Virmen's Bite (25s) all land between 18.5s and
 *     25.0s, and not one falls outside the bound.
 *
 * The window runs from `t0` to the removal and is marked `preexisting`, which is `truncated`'s
 * opposite number: the *start* is the pull rather than an event. Clamping rather than back-dating is
 * the same under-stating direction the refresh case takes — `end - durationMs` recovers when it was
 * really applied, and that belongs to the caller that knows what it is looking at.
 *
 * Off by default, and for a sharper reason than `openOnRefresh` is. This only means anything for an
 * aura short enough that "it was up at the pull" is a fact about the pull. A flask runs an hour, so
 * the bound never bites and the recovered application time comes back at fifty-odd minutes before the
 * bell — a true statement about nothing. Measured: six bare removals of Mad Hozen Elixir in the same
 * reports land 42.6s to 166.0s *into* their fights and read as drunk 57 to 59 minutes before them.
 *
 * A window still open when the fight ends is closed at `fightEnd` and marked `truncated`.
 */
export function auraWindows(
	events: readonly WclEvent[],
	aura: Aura,
	t0: number,
	fightEnd: number,
	{ openOnRefresh = false, openAtPull = false }: { openOnRefresh?: boolean; openAtPull?: boolean } = {},
): AuraWindow[] {
	const ids = new Set(aura.ids);
	const open = new Map<number, number>();
	const out: AuraWindow[] = [];
	const variantOf = (id: number): string | undefined => aura.variants?.[id];
	// Ids whose opening this stream has already witnessed, in any form. Only `openAtPull` reads it,
	// and it is what keeps the inference to the *leading* orphan: a pull cannot have started twice.
	const opened = new Set<number>();
	// Zero when the aura declares none, which makes the bound below refuse every candidate.
	const durationMs = aura.durationMs ?? 0;

	for (const e of events) {
		const id = abilityIdOf(e);
		if (id === null || !ids.has(id)) continue;

		if (isAuraApply(e) || (openOnRefresh && isAuraRefresh(e))) {
			if (!open.has(id)) open.set(id, e.timestamp);
			opened.add(id);
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
			} else if (openAtPull && !opened.has(id) && e.timestamp - t0 < durationMs) {
				out.push({
					start: 0,
					end: e.timestamp - t0,
					preexisting: true,
					id,
					variant: variantOf(id),
				});
				opened.add(id);
			}
		} else if (isAuraRefresh(e) || isCast(e)) {
			// Neither opens a window — a refresh moves nothing, and a cast is a press rather than an aura
			// event — but both are proof that this aura's opening happened inside the fight, which is the
			// one thing the pre-pull inference above must not be allowed to contradict.
			opened.add(id);
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
	/**
	 * True when this stretch was already running at the pull and its opening was never logged.
	 *
	 * Only ever on the first stretch, and it is the difference between "applied at 0:00" and "was
	 * already up" — which a caller counting *how many times the aura went up* has to be able to tell
	 * apart. See the pre-fight inference in `auraLevels`.
	 */
	preexisting?: boolean;
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
	// Set once, by the pre-fight inference below, and consumed by the first stretch that closes.
	let preexisting = false;

	// Closes the stretch that was running and starts the next one. Only a *change* is a boundary, so a
	// stack event landing on the level it already held draws no seam.
	const moveTo = (next: number, at: number) => {
		if (next === level) return;
		if (level > 0) {
			out.push({ start: since, end: at, level, ...(preexisting ? { preexisting: true } : {}) });
			preexisting = false;
		}
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
				preexisting = true;
			}
			moveTo(e.stack, at);
		}
	}

	// Both flags can ride on one stretch: an aura already up at the pull and still up at the kill was
	// never seen to open *or* close, and a caller counting either end has to be told about both.
	if (level > 0) {
		out.push({
			start: since,
			end: fightEnd - t0,
			level,
			truncated: true,
			...(preexisting ? { preexisting: true } : {}),
		});
	}
	return out;
}

/**
 * The level a stacking aura held at a press, as `auraLevels` recorded it.
 *
 * Read at `t - guardMs`, deliberately: the change the press caused is stamped at — or, more often, a
 * millisecond *before* — the press itself. Earth Shock and its Fulmination are the standing case —
 * the Lightning Shield drain logs one millisecond ahead of the cast that caused it — and reading the
 * drain as already done turned a full seven-stack shield into a one-stack one. The guard is the same
 * `SELF_EVENT_MS` window `remainingAtCast` uses, for the same reason: the press's own aura events are
 * the one thing the question "what did the press see" must be blind to.
 *
 * Null before the first stretch (no reading yet) and null across a gap (the aura was down), which
 * are different facts from "held one stack".
 */
export function levelAt(levels: readonly AuraLevel[], t: number, guardMs = SELF_EVENT_MS): number | null {
	const at = t - guardMs;
	let lo = 0;
	let hi = levels.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const stretch = levels[mid];
		if (stretch === undefined) break;
		if (stretch.start < at) {
			found = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	if (found === -1) return null;
	const stretch = levels[found];
	// `end >= at` rather than trusting `start < at` alone: a stretch that ended before `at` means the
	// aura was down at `at`, and its last level is not the level that held there.
	return stretch !== undefined && stretch.end >= at ? stretch.level : null;
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

/** A stretch an aura was absent for: when it fell off, and for how long. */
export interface AuraGap {
	t: number;
	ms: number;
}

/**
 * The gaps between an aura's windows that count as drops, with the fight's own interruptions excluded.
 *
 * **Anything below `dropMs` is refresh jitter**, not a drop — the log stamping a remove a few hundred
 * milliseconds before the reapply that replaced it. That rule always applies.
 *
 * How the intermission is excluded depends on whether the caller can prove one happened:
 *
 * **Given `away`, the exclusion is evidence-based.** Each gap is charged only for the part of it the
 * player was actually in contact — `ms` comes back as that exposed time, not the raw gap — so a dot
 * missing while the boss is untargetable costs nothing and a dot missing while it is right there
 * costs all of it. This is the honest reading and it is what a caller should pass whenever it has a
 * contact clock. Measured on `a:qHRAFwdGzaB6MPYC` #14: four gaps of 36ms, 888ms, 643ms and 41 914ms,
 * where the long one carries only 529ms of contact and is correctly forgiven for being the boss's
 * submerge, while the same rule would still report a 20s hole taken with the boss in reach.
 *
 * **Without `away`, the single longest gap is treated as the intermission.** A heuristic, kept for the
 * Windwalker, which grew up on it and prints the figure it forgave. It under-reports by one on a fight
 * with two intermissions, which is why the caller keeps every window in its output and filters only
 * this list. Excluded by *position* rather than by value: two gaps of identical length are not
 * far-fetched, because these are quantised to the aura's own apply and expire stamps, and filtering on
 * `ms !== longest` threw away *both*, forgiving a real drop because an unrelated one matched its
 * length.
 *
 * The heuristic is the dangerous one and it is why `away` exists. It forgives the largest gap
 * *unconditionally* — so on a single-phase pull, the one real drop a player made is the largest gap
 * there is, and the ledger goes silent about it. That is exactly what happened when the Elemental's
 * Flame Shock ledger was first moved onto this function.
 *
 * `windows` must be sorted and disjoint — merge it first. Overlapping input yields negative gaps,
 * which come back as no drops and a nonsense `intermissionMs` rather than an error.
 */
export function auraDrops(
	windows: readonly Interval[],
	dropMs = DROP_MS,
	away?: readonly Interval[],
): { drops: AuraGap[]; intermissionMs: number } {
	const gaps: AuraGap[] = [];
	for (let i = 1; i < windows.length; i += 1) {
		const prev = windows[i - 1];
		const cur = windows[i];
		if (prev && cur) gaps.push({ t: prev[1], ms: cur[0] - prev[1] });
	}

	if (away !== undefined) {
		const drops: AuraGap[] = [];
		let forgiven = 0;
		for (const gap of gaps) {
			const absent = overlapMs(gap.t, gap.t + gap.ms, away);
			const exposed = gap.ms - absent;
			forgiven += absent;
			// Charged for the exposed time, and judged on it too: a 42-second hole with half a second of
			// contact in it is half a second of fault, which is below the jitter floor and says nothing.
			if (exposed > dropMs) drops.push({ t: gap.t, ms: exposed });
		}
		return { drops, intermissionMs: forgiven };
	}

	let longestAt = -1;
	gaps.forEach((g, i) => {
		if (longestAt === -1 || g.ms > (gaps[longestAt]?.ms ?? -1)) longestAt = i;
	});
	return {
		drops: gaps.filter((g, i) => g.ms > dropMs && i !== longestAt),
		// The gap that was taken out, so a caller can print what it forgave rather than re-deriving it
		// from a second walk and risking a different answer.
		intermissionMs: longestAt === -1 ? 0 : (gaps[longestAt]?.ms ?? 0),
	};
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
