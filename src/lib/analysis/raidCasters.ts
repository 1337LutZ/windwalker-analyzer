// Raid-wide buffs, read by *who cast them* rather than as one bar the player either had or did not.
//
// Stormlash Totem and Skull Banner are the same shape of thing and the report was treating them as two
// different shapes. Both are pressed by somebody else, land on the whole raid, and do not stack — so the
// only question worth asking about either is *coordination*: how many were up, whose, and did two of them
// sit on top of each other. A single merged row cannot answer any of that. It says "a totem was up here",
// which is the weaker claim, and it hides exactly the fact the Elemental's `stormlashOverlaps` already
// measures.
//
// **This module is the per-caster bucket the Elemental audit used to own.** It walked `raidStormlash` into
// a `Map<sourceID, Window[]>` inline, published `shamans` off it, and the timeline drew a merged lane over
// the top. Lifted here it takes any set of ids and any raid-wide stream, which is what makes the second
// buff free and the second spec free with it: nothing below knows what a shaman is.
//
// **What it will not do is grade.** A window here is what the log said, clamped to the pull. Whether two
// of them overlapping is a fault is the spec's question — `intervalsAtLeast` over these windows is how the
// Elemental asks it — and whether a row is worth drawing is the chart's.

import { abilityIdOf, isAuraApply, isAuraRemove, isCast } from '~/lib/events';
import type { Aura } from '~/lib/game/model';
import type { Actor, AuraLane, LaneSource, Window } from '~/lib/types';

import type { RaidEvents } from './auras';

/** One caster's windows for one aura, in time order. */
export interface CasterWindows {
	/** The `sourceID` the events carried, or `-1` where the log carried none. */
	source: number;
	windows: Window[];
}

/**
 * Windows per caster for one raid-wide aura, off a stream that interleaves every actor.
 *
 * **`RaidEvents` by declaration, and that is the point of the brand** (`11032bc`). A walk that buckets by
 * *caster* is meaningless on a stream already narrowed to one actor — it would answer with a single bucket
 * and look like it had worked — so the widening a caller does to get here has to be written down at the
 * call site rather than happen by accident. The Elemental hands over `raidStormlash` and the whole fight's
 * stream; both are branded where they are named.
 *
 * **The opener is a placement or an application, because the two buffs log differently and both are
 * wanted.** Stormlash arrives as a `cast` per totem from a raid-wide fetch that has no aura events in it
 * at all, and its window is then the totem's fixed lifetime. Skull Banner arrives as `applybuff` on the
 * player from the banner, and its window is the apply/remove pair the log really carried. One walk covers
 * both: an opener opens, a removal closes the oldest window that caster still has open, and anything left
 * open at the end runs its `holdsMs` or to the kill, whichever comes first.
 *
 * `refreshbuff` is neither, exactly as it is in `auraWindows`: a re-application of a running buff is not a
 * second instance of it, and counting one would put a row on the chart for a totem nobody laid.
 *
 * **`onTarget` is not optional decoration — it is what stops a raid-wide stream being counted 25 times.**
 * The fight's event stream carries these buffs going out to *everybody*: `elemental/__fixtures__/phased`
 * has 38 applications of one shaman's totem across the raid, of which one is on the player. Bucketing all
 * 38 by caster gives one caster and 38 "instances". A caller drawing what the player *had* passes their
 * own actor id; the Stormlash placement fetch passes nothing, because a placement has no target.
 *
 * Fight-relative throughout, and clamped to `pullMs` at both ends of the reason `untilFightEnd` exists: a
 * totem laid with five seconds of fight left does not run its full ten, and a bar past the end of the axis
 * is a bar the chart cannot draw honestly.
 *
 * Callers come back in first-seen caster order — the order the stream introduced them — with each caster's
 * own windows sorted by start, because a fetch may page them out of order.
 */
export function windowsBySource(
	events: RaidEvents,
	ids: readonly number[],
	{
		t0,
		pullMs,
		holdsMs,
		onTarget,
	}: {
		t0: number;
		pullMs: number;
		/** How long one instance runs when the log never says it came off. Absent: to the kill. */
		holdsMs?: number;
		/** Only events landing on this actor. Omit for a stream of placements, which land on nobody. */
		onTarget?: number;
	},
): CasterWindows[] {
	const wanted = new Set(ids);
	// Built at the *opener* rather than at the close, so the map's insertion order is the order the stream
	// introduced each caster and a window's place in its list is the order it opened in. Closing into a
	// second map would have ordered the callers by whoever expired first, which is not a fact about them.
	const byCaster = new Map<number, Window[]>();
	// The windows each caster still has running, oldest first. A list and not one slot: two totems from one
	// shaman inside ten seconds are two instances, and the second must not overwrite the first.
	const running = new Map<number, Window[]>();

	for (const e of events) {
		const id = abilityIdOf(e);
		if (id === null || !wanted.has(id)) continue;
		if (onTarget !== undefined && e.targetID !== onTarget) continue;
		// `-1` for a source the log did not carry, which is still an instance worth drawing — it buckets
		// under an id nothing can name rather than being dropped or credited to somebody.
		const source = e.sourceID ?? -1;
		const at = e.timestamp - t0;
		if (isCast(e) || isAuraApply(e)) {
			const window: Window = { start: at, end: holdsMs === undefined ? pullMs : Math.min(at + holdsMs, pullMs) };
			const opened = byCaster.get(source);
			if (opened === undefined) byCaster.set(source, [window]);
			else opened.push(window);
			const pending = running.get(source);
			if (pending === undefined) running.set(source, [window]);
			else pending.push(window);
		} else if (isAuraRemove(e)) {
			// The oldest still-running window of this caster's, mutated in place — it is the same object the
			// list above holds. A removal with nothing in front of it is a buff that went up before the event
			// window opened, and is left alone rather than being given an invented start.
			const closing = running.get(source)?.shift();
			if (closing !== undefined) closing.end = Math.max(closing.start, Math.min(at, pullMs));
		}
	}

	return [...byCaster].map(([source, windows]) => ({
		source,
		windows: [...windows].sort((a, b) => a.start - b.start),
	}));
}

/**
 * How many rows one raid buff may take before the rest go behind the cap.
 *
 * The same number and the same judgement as `FS_TARGET_LANES` / `RSK_TARGET_LANES`: past half a dozen rows
 * of one thing the block stops being read and starts being scrolled, and the rows this pushes off the
 * screen are the player's own rotation. A 25-man raid can field four shamans and three warriors, and the
 * two buffs together would then be seven rows before a single press is drawn.
 *
 * The cap decides what is drawn *by default* and nothing else — the instances past it travel out as
 * `hidden` and into `timeline.hiddenLanes`, so nothing is discarded and the chart can still be asked.
 */
export const RAID_SOURCE_LANES = 6;

/**
 * One timeline row per instance of each raid buff the player was actually given.
 *
 * **Per instance, not per caster, and that is the whole request.** Two shamans dropping totems three
 * seconds apart is two rows a reader can see stacking; one merged row hides it, and one row per *caster*
 * hides a shaman who laid two. So a caster with three totems gets three rows, sharing the aura's key and
 * separated by their `source` — which is the same arrangement the per-enemy debuff rows already use, with
 * the field that means "enemy" left alone.
 *
 * **The caster is the player, not the object the log named.** Every one of these buffs is applied by a
 * summon: Stormlash by the totem the shaman placed, Skull Banner by the banner the warrior planted. The
 * `sourceID` on the event is therefore a pet, and a row labelled `Pet (39)` names nothing a reader can
 * act on. `petOwner` resolves it back to whoever pressed the button; a source the actor list cannot answer
 * for keeps its own id and a null name, which the chart then draws with the aura's name alone rather than
 * inventing a caster.
 *
 * The player's own first — the analogue of the primary enemy leading its block, and the one row on the
 * chart whose timing they chose — then chronologically, which is what makes a staircase of staggered
 * totems read as one.
 *
 * `auras` is whatever the spec models of this list. A spec that has not declared one simply has no rows
 * for it, which is why this takes resolved auras rather than keys: the mechanism is here and the question
 * of which buffs a report draws stays with the spec that draws them.
 */
export function raidSourceLanes(
	events: RaidEvents,
	auras: readonly Aura[],
	{ t0, pullMs, actorID, actors }: { t0: number; pullMs: number; actorID: number; actors: readonly Actor[] },
): { drawn: AuraLane[]; hidden: AuraLane[] } {
	const casterOf = (source: number): LaneSource => {
		const object = actors.find((a) => a.id === source);
		const ownerID = object?.petOwner ?? null;
		const owner = ownerID === null ? undefined : actors.find((a) => a.id === ownerID);
		return { id: owner?.id ?? source, name: owner?.name ?? object?.name ?? null };
	};

	const drawn: AuraLane[] = [];
	const hidden: AuraLane[] = [];
	for (const aura of auras) {
		const instances = windowsBySource(events, aura.ids, {
			t0,
			pullMs,
			holdsMs: aura.durationMs,
			onTarget: actorID,
		})
			.flatMap(({ source, windows }) => {
				const caster = casterOf(source);
				return windows.map((window) => ({ caster, window, own: caster.id === actorID }));
			})
			.sort((a, b) => Number(b.own) - Number(a.own) || a.window.start - b.window.start);

		for (const [i, { caster, window }] of instances.entries()) {
			// `group: 'buff'` by construction rather than off `aura.kind`: something another player cast on
			// the raid is a buff, and calling one a debuff would sink it into the per-enemy block at the foot
			// of the chart — which is where rows about *enemies* go.
			const row: AuraLane = {
				key: aura.key,
				name: aura.name,
				id: aura.ids[0] ?? 0,
				group: 'buff',
				windows: [window],
				source: caster,
			};
			(i < RAID_SOURCE_LANES ? drawn : hidden).push(row);
		}
	}
	return { drawn, hidden };
}
