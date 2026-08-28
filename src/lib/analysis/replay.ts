// Where the player and the bodies they hit actually stood, sampled across the pull.
//
// **The coordinates are already paid for.** `wcl/fightEvents.graphql` has asked for
// `includeResources: true` since the energy bar needed it, and the resource block WarcraftLogs
// returns alongside `classResources` and `hitPoints` carries `x`, `y`, `facing` and `mapID` as well.
// Measured on a live Siege pull through this repo's own query shape — `dataType: All`, scoped to one
// `sourceID` — 711 of 1018 events came back with a position on them. So this module costs no request,
// no point and no query change; it reads fields the fetch was already discarding.
//
// **Two actors out of one stream, told apart by `resourceActor`.** The index is 1 for the event's
// source and 2 for its target — `analysis/energy.ts` argues that at length and this module inherits
// the reading. A `cast` at index 1 is the player's own position; a `damage` at index 2 is the position
// of the body they hit. That second half is why this can draw enemies at all out of a stream scoped to
// one player: the enemy is never the source of anything here, and is still in every damage event.
//
// **A body, not a kind** — the same key `targets.ts` cuts spawns on. WarcraftLogs hands ten
// simultaneous adds one `targetID` and separates them only by `targetInstance`, so a track keyed on
// the actor id would collapse a wave into one wandering dot.
//
// Nothing here grades anything, and no distance is compared against a range. This is the pull's
// geometry as recorded; what a reader is allowed to conclude from a distance is a question this module
// deliberately does not answer — see the note on `UNITS_PER_YARD`.

import { isCast, isDamage, type WclEvent } from '~/lib/events';

/**
 * The scale WarcraftLogs reports coordinates at, calibrated rather than assumed.
 *
 * Measured off a Siege of Orgrimmar pull by taking each ability's caster-to-target distance at the
 * moment it landed: the 40-yard spells (Frostbolt, Auto Shot, Incinerate) top out at ~3 700 units and
 * the melee buttons at 550–1 100, which puts a yard at 100 units and leaves the boss hitbox in the
 * difference. The value is not published by the API and this is the only place it is written down.
 *
 * **A distance in yards is not a statement about reachability.** Line of sight, tower floors and the
 * gate are all invisible to a coordinate pair, so a range test built on this would call an add through
 * a wall reachable. Frames are in yards because a reader can hold a yard; no rule in this repo may
 * branch on one.
 */
export const UNITS_PER_YARD = 100;

/**
 * How often the track is sampled.
 *
 * One second, which is the resolution the rest of the report's timelines are read at and fine enough
 * that a player crossing a room reads as a walk rather than a jump. A 400-second pull is 400 frames;
 * at two coordinates for the player and a handful of bodies, the whole track is smaller than the cast
 * list it ships beside.
 */
export const REPLAY_STEP_MS = 1000;

/**
 * How stale a sample may be before a frame reports no position.
 *
 * Six seconds either side. A player who stops pressing buttons does not stop existing, and the last
 * position they logged is the best available answer for the gap — but only for so long: past this the
 * honest answer is that the stream does not say, and a dot frozen for forty seconds is a claim the log
 * never made. The same window applies to a body between the hits that reveal it.
 */
const STALE_MS = 6000;

/** One enemy body's position at a frame. */
export interface ReplayFoe {
	/** `targetID:targetInstance` — the key `SpawnRecord` uses, so the two can be joined. */
	key: string;
	/**
	 * What to call it on screen.
	 *
	 * Carried per body rather than looked up by the drawing, because the report's actor table is a fact
	 * about the *fetch* and this track is a fact about the pull: a component holding an analysis has no
	 * route back to the names, and threading one there to label a dot would put the whole actor list
	 * behind a tooltip. The empty string is a body the actor table did not name, which the drawing shows
	 * as the bare key rather than as an unlabelled mark.
	 */
	name: string;
	x: number;
	y: number;
}

/** The pull at one instant: where the player was, and every body they were trading with. */
export interface ReplayFrame {
	/** Fight-relative milliseconds. */
	ms: number;
	/** The player's position in yards, or null where the stream has nothing near enough to say. */
	self: readonly [number, number] | null;
	foes: readonly ReplayFoe[];
}

/** The whole track, with the box it fits in so a drawing can scale without walking every frame. */
export interface ReplayTrack {
	stepMs: number;
	/** Yards, and inclusive. Empty pulls do not produce a track at all, so this is always real. */
	bounds: { minX: number; maxX: number; minY: number; maxY: number };
	/** The map the positions are on. Every frame of a pull shares one; a pull that spans two is dropped. */
	mapID: number;
	frames: readonly ReplayFrame[];
}

/** A position sample on one actor's timeline, before it is resampled onto frames. */
interface Sample {
	ms: number;
	x: number;
	y: number;
}

/** Whether an event carries a resource block with a position in it. */
function positionOf(e: WclEvent): { actor: number; x: number; y: number } | null {
	const { resourceActor, x, y } = e as WclEvent & { resourceActor?: number; x?: number; y?: number };
	if (resourceActor === undefined || x === undefined || y === undefined) return null;
	return { actor: resourceActor, x, y };
}

/**
 * The position at `ms`, interpolated between the samples either side.
 *
 * Linear rather than nearest, so a dot crossing a room is drawn crossing it. Null outside `STALE_MS`
 * of any sample, which is the whole of this function's caution: a gap in the stream is reported as a
 * gap and never as a stationary actor.
 */
function at(samples: readonly Sample[], ms: number): readonly [number, number] | null {
	const first = samples[0];
	const last = samples[samples.length - 1];
	if (first === undefined || last === undefined) return null;
	if (ms <= first.ms) return first.ms - ms <= STALE_MS ? [first.x, first.y] : null;
	if (ms >= last.ms) return ms - last.ms <= STALE_MS ? [last.x, last.y] : null;

	let lo = 0;
	let hi = samples.length - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		const at = samples[mid];
		if (at !== undefined && at.ms <= ms) lo = mid;
		else hi = mid;
	}
	const a = samples[lo];
	const b = samples[hi];
	if (a === undefined || b === undefined) return null;
	if (ms - a.ms > STALE_MS && b.ms - ms > STALE_MS) return null;
	const span = b.ms - a.ms;
	const f = span > 0 ? (ms - a.ms) / span : 0;
	return [a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f];
}

/**
 * The pull's geometry, or undefined when the stream does not carry any.
 *
 * Undefined is a real answer and the common one on an old capture: `includeResources` predates the
 * committed Windwalker dataset, whose 3 181 events carry no resource block at all. Every reader has to
 * guard on it for the same reason `Analysis.segments` is optional.
 *
 * @param events the player's own stream, in timestamp order
 * @param fightStartMs absolute report time of the pull's start, to make frames fight-relative
 * @param durationMs the pull's length
 * @param nameOf report actor ids to names, so each body can carry its own label
 */
export function buildReplay(
	events: readonly WclEvent[],
	fightStartMs: number,
	durationMs: number,
	nameOf?: ReadonlyMap<number, string>,
): ReplayTrack | undefined {
	if (durationMs <= 0) return undefined;

	const self: Sample[] = [];
	const foes = new Map<string, { name: string; samples: Sample[] }>();
	const maps = new Set<number>();

	for (const e of events) {
		const p = positionOf(e);
		if (p === null) continue;
		const mapID = (e as WclEvent & { mapID?: number }).mapID;
		if (mapID !== undefined) maps.add(mapID);
		const ms = e.timestamp - fightStartMs;
		const x = p.x / UNITS_PER_YARD;
		const y = p.y / UNITS_PER_YARD;

		// Index 1 is the event's source. Casts are the reliable half — a damage event scoped to this
		// player reports the *target's* bars, so index 1 on one is rare and index 2 is the rule.
		if (p.actor === 1 && (isCast(e) || isDamage(e))) {
			self.push({ ms, x, y });
			continue;
		}
		// Index 2 is the target: the body the player hit, which is the only way an enemy's position
		// reaches a stream that never has an enemy as its source.
		if (p.actor === 2 && isDamage(e) && (e.targetID ?? 0) > 0) {
			const key = `${e.targetID}:${e.targetInstance ?? 0}`;
			const track = foes.get(key);
			if (track) track.samples.push({ ms, x, y });
			else foes.set(key, { name: nameOf?.get(e.targetID ?? 0) ?? '', samples: [{ ms, x, y }] });
		}
	}

	if (self.length === 0 && foes.size === 0) return undefined;
	// A pull that changed map is a pull whose coordinates are two different spaces stacked on one plane.
	// Nothing in Siege does it; a transition that did would draw as a teleport, so refuse instead.
	if (maps.size !== 1) return undefined;

	for (const track of foes.values()) track.samples.sort((a, b) => a.ms - b.ms);
	self.sort((a, b) => a.ms - b.ms);

	const frames: ReplayFrame[] = [];
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	const stretch = (x: number, y: number) => {
		minX = Math.min(minX, x);
		maxX = Math.max(maxX, x);
		minY = Math.min(minY, y);
		maxY = Math.max(maxY, y);
	};

	for (let ms = 0; ms <= durationMs; ms += REPLAY_STEP_MS) {
		const here = at(self, ms);
		const bodies: ReplayFoe[] = [];
		for (const [key, track] of foes) {
			const p = at(track.samples, ms);
			if (p === null) continue;
			bodies.push({ key, name: track.name, x: Math.round(p[0]), y: Math.round(p[1]) });
			stretch(p[0], p[1]);
		}
		if (here !== null) stretch(here[0], here[1]);
		frames.push({
			ms,
			self: here === null ? null : [Math.round(here[0]), Math.round(here[1])],
			foes: bodies,
		});
	}

	const mapID = [...maps][0];
	if (!Number.isFinite(minX) || mapID === undefined) return undefined;

	return {
		stepMs: REPLAY_STEP_MS,
		bounds: { minX: Math.floor(minX), maxX: Math.ceil(maxX), minY: Math.floor(minY), maxY: Math.ceil(maxY) },
		mapID,
		frames,
	};
}
