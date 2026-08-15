// A resource bar, reconstructed from the samples WarcraftLogs staples onto ordinary events.
//
// Named for energy because that is what this report reads, but nothing below knows what energy is:
// every function takes a power type and answers about that bar. Chi (12) reads the same way.
//
// The whole file rests on one fact that took a long time to find. `resourcechange` events are NOT
// the curve — MoP logs one only when something other than passive regen moves a bar, which on a
// five-minute Windwalker pull is around twenty events, all Energizing Brew ticks. The curve is
// `classResources`, an array stapled onto casts, damage and heals, and it is absent unless the
// events query passes `includeResources: true`. With the flag, roughly two thirds of a pull's
// events carry it; without it, none do. Replayed against WarcraftLogs' own energy graph the samples
// reproduced it point for point on two reference pulls, with nothing interpolated.
//
// Which means the resolution here is the sampling rate and not a continuous measurement, and every
// number this file produces has to be read that way — see `medianGapMs` and `p99GapMs`, which exist
// so the report can say so rather than imply a precision it does not have.

import { abilityIdOf, classResourcesOf, isResourceChange, resourceActorOf, type WclEvent } from '~/lib/events';

import { median } from './format';
import { mergeIntervals, overlapMs, unionMs, type Interval } from './intervals';

/**
 * WoW's power types, as `ClassResource.type` reports them.
 *
 * Game-wide numbering rather than spec knowledge — a rogue's energy is 3 as well — so it lives with
 * the reader rather than in a spec file, next to the code that would otherwise carry a bare `3`.
 */
export const POWER_TYPE = { energy: 3, chi: 12 } as const;

/**
 * How long a stretch the regen rate is measured over.
 *
 * Measured over a *span* of several readings rather than between one adjacent pair, and that is not
 * a refinement — the adjacent-pair version reported no rate at all on real data. Readings land about
 * 400ms apart, and at 10 energy a second a 400ms gap is four points give or take the bar's own
 * rounding, which is a rate anywhere between 7 and 12; raising the floor past that threw away every
 * pair a log actually contains. Walking forward until a full second has passed keeps every reading
 * usable and puts the rounding error under a tenth.
 *
 * The ceiling is there because the longer a span runs, the better the odds that something the log
 * did not sample moved the bar inside it, and a span that straddles one is not measuring regen.
 */
const RATE_SPAN_MS = { min: 1000, max: 4000 } as const;

/** Below this many usable spans the median is noise, and the rate is reported as unknown instead. */
const MIN_RATE_SPANS = 20;

/** One reading of one resource bar, fight-relative. */
export interface ResourceSample {
	t: number;
	/**
	 * The bar at this instant, *before* the event spent anything — `cost` is charged after the
	 * reading. Treating it as post-spend puts every cast a full ability cost too high, which turns
	 * spending energy into sitting on it.
	 */
	amount: number;
	/** The ceiling as the game had it here, so a talent that widens the bar needs no inference. */
	max: number;
	/** What this event took out of the bar. Zero for the events that only observed it. */
	cost: number;
}

/** Time at the cap over one stretch of the pull, and what it cost. */
export interface ResourceCapSplit {
	cappedMs: number;
	/** Against the length of this stretch, not of the whole pull. */
	pct: number;
	/**
	 * Regen that arrived on a full bar and evaporated, in resource points. Null when no rate could
	 * be measured, because an invented rate would turn an unknown into a confident number.
	 */
	wasted: number | null;
}

export interface ResourceBar {
	/** How many readings the curve was built from. Zero means the query never asked for them. */
	sampleCount: number;
	/** The ceiling the log reported. 0 when there were no samples. */
	max: number;
	/**
	 * Points per second the bar refilled at, measured from the samples themselves.
	 *
	 * Not a constant, and not taken from one: MoP scales a monk's energy regen with haste, so the
	 * true rate moves with every proc and every Bloodlust. This is the pull's typical rate, which is
	 * the honest thing to multiply a duration by.
	 */
	regenPerSec: number | null;
	/** Every stretch the bar was provably full, merged and in time order. */
	capped: Interval[];
	/** Median gap between readings — the shortest cap this can see at all. */
	medianGapMs: number;
	/** 99th percentile gap. A cap that opened and closed inside one of these is invisible here. */
	p99GapMs: number;
	/** The whole pull. */
	whole: ResourceCapSplit;
	/**
	 * The stretches the player was in contact with the target.
	 *
	 * This is the only one of the three that describes a decision. You cannot spend energy on a boss
	 * you cannot reach, so a bar that fills during an intermission is the fight's doing and not the
	 * player's — and charging them for it is exactly the kind of invented fault this report refuses.
	 */
	engaged: ResourceCapSplit;
	/** Everything else: the run-up, intermissions, the tail after a death. Reported, never graded. */
	downtime: ResourceCapSplit;
}

/**
 * Every reading of one bar belonging to one actor, in time order.
 *
 * `resourceActor` is **an index, not an actor id** — measured against a real log, it is only ever 1
 * or 2, and it says which end of the event the bars belong to: 1 the source, 2 the target. Comparing
 * it to an actor id looks obviously right and silently matches nothing, which is exactly what it did
 * here: every pull came back with zero samples and an energy section that rendered its empty state
 * while the payload was full of readings.
 *
 * So the actor is identified from the end `resourceActor` points at. That also keeps a summon's bars
 * out of the curve: a pet's damage is sourced by the pet, so its readings resolve to the pet.
 *
 * Comes back empty — not wrong, empty — when the events were fetched without `includeResources:
 * true`, which is the other failure mode the caller has to be able to see.
 */
export function resourceSamples(
	events: readonly WclEvent[],
	powerType: number,
	actorID: number,
	t0: number,
): ResourceSample[] {
	const out: ResourceSample[] = [];
	for (const e of events) {
		const side = resourceActorOf(e);
		// 1 is the source's bars, 2 the target's. Anything else is a shape this does not understand,
		// and a guess about whose energy it is would be worse than dropping the reading.
		const owner = side === 1 ? e.sourceID : side === 2 ? e.targetID : undefined;
		if (owner !== actorID) continue;
		const bar = classResourcesOf(e)?.find((r) => r.type === powerType);
		// A bar with no ceiling cannot say whether it is full, and is dropped rather than defaulted.
		if (bar === undefined || !Number.isFinite(bar.amount) || !(bar.max > 0)) continue;
		out.push({ t: e.timestamp - t0, amount: bar.amount, max: bar.max, cost: bar.cost ?? 0 });
	}
	// Stable, so two readings on the same millisecond keep the log's own order — which is what makes
	// the pre-spend reading of a cast sit before the damage that cast produced.
	return out.sort((a, b) => a.t - b.t);
}

/**
 * The stretches the bar was demonstrably full.
 *
 * Deliberately the conservative rule: a gap counts only when the reading that opens it is full, the
 * reading that closes it is full, and the opening event spent nothing. The third clause is the one
 * that matters. A cast reads the bar *before* paying for itself, so a full reading with a cost on
 * it means the bar dropped a millisecond later and whatever refilled it did so unwatched — crediting
 * that whole gap as time at the cap would charge a player for the moment they spent.
 *
 * The bias is therefore towards under-reporting, which is the right way round for a number the
 * report is going to describe as a fault. What it cannot see is a bar that filled and was spent
 * entirely between two readings; at three samples a second that is a fraction of a global, and the
 * report says so rather than pretending otherwise.
 */
export function cappedIntervals(samples: readonly ResourceSample[]): Interval[] {
	const out: Interval[] = [];
	for (let i = 1; i < samples.length; i++) {
		const a = samples[i - 1];
		const b = samples[i];
		if (a === undefined || b === undefined) continue;
		if (b.t <= a.t) continue;
		if (a.amount < a.max || b.amount < b.max) continue;
		if (a.cost > 0) continue;
		out.push([a.t, b.t]);
	}
	return mergeIntervals(out);
}

/**
 * How fast the bar refilled, measured from the samples rather than assumed.
 *
 * Over a span the bar moves by `regen × dt` minus everything spent inside it, and every spend is on
 * a reading as its `cost` — so a span whose ends are both known gives a rate directly. Each reading
 * opens a span and the walk carries the costs along until a full second has passed.
 *
 * A span is abandoned the moment a reading inside it comes back full: a bar at the ceiling is
 * throwing regen away, so the gain across it is clipped and the span would report a rate lower than
 * the truth. Same for a span that starts full, and for one whose bar went *down* overall, which
 * means something the log did not sample spent from it.
 *
 * The median rather than a total: Energizing Brew adds 10 a second on top of regen for six seconds
 * at a time, and a handful of those windows would drag a sum-based rate up by a tenth across the
 * whole pull. They cannot move the middle of a distribution of several hundred spans.
 *
 * The answer is a *typical* rate and not a constant. MoP scales a monk's energy regen with haste, so
 * the true rate moves with every proc and every Bloodlust, and no single number describes the pull.
 */
export function regenPerSecond(samples: readonly ResourceSample[]): number | null {
	const rates: number[] = [];
	for (let i = 0; i < samples.length; i++) {
		const a = samples[i];
		if (a === undefined || a.amount >= a.max) continue;

		let spent = a.cost;
		for (let j = i + 1; j < samples.length; j++) {
			const b = samples[j];
			if (b === undefined) break;
			const dt = b.t - a.t;
			if (dt > RATE_SPAN_MS.max) break;
			if (b.amount >= b.max) break;
			if (dt >= RATE_SPAN_MS.min) {
				// `b`'s own cost is deliberately not carried: its reading is taken before it spends.
				const gained = b.amount - (a.amount - spent);
				if (gained > 0) rates.push(gained / (dt / 1000));
				break;
			}
			spent += b.cost;
		}
	}
	return rates.length >= MIN_RATE_SPANS ? median(rates) : null;
}

/**
 * The whole reading of one bar: how long it sat full, split by whether anything could have been
 * spent on it.
 *
 * `engaged` is the caller's — `engagedWindows` over the player's own landed hits — because what
 * counts as contact is a question about the fight, not about the resource. Everything outside those
 * windows is downtime by construction, which includes the run-up before the first hit and the tail
 * after the last, and neither is a stretch anyone chose to sit capped through.
 */
export function trackResourceBar(
	samples: readonly ResourceSample[],
	durationMs: number,
	engaged: readonly Interval[],
): ResourceBar {
	const capped = cappedIntervals(samples);
	const regenPerSec = regenPerSecond(samples);

	// Merged before use: `overlapMs` sums its ranges rather than unioning them, so an overlapping
	// pair would count its shared milliseconds twice and could report more engaged capping than there
	// was capping at all.
	const engagedMerged = mergeIntervals(engaged);
	const engagedMs = unionMs(engagedMerged);
	const downtimeMs = Math.max(0, durationMs - engagedMs);

	const cappedMs = unionMs(capped);
	const cappedEngagedMs = capped.reduce((sum, [start, end]) => sum + overlapMs(start, end, engagedMerged), 0);
	// By subtraction rather than by measuring the complement, so the two halves cannot fail to add up
	// to the whole in front of a reader who is going to check.
	const cappedDowntimeMs = Math.max(0, cappedMs - cappedEngagedMs);

	const split = (ms: number, of: number): ResourceCapSplit => ({
		cappedMs: ms,
		pct: of > 0 ? (ms / of) * 100 : 0,
		wasted: regenPerSec === null ? null : Math.round(regenPerSec * (ms / 1000)),
	});

	const gaps: number[] = [];
	for (let i = 1; i < samples.length; i++) {
		const a = samples[i - 1];
		const b = samples[i];
		if (a !== undefined && b !== undefined) gaps.push(b.t - a.t);
	}
	const sortedGaps = [...gaps].sort((x, y) => x - y);

	return {
		sampleCount: samples.length,
		max: samples.reduce((m, s) => Math.max(m, s.max), 0),
		regenPerSec,
		capped,
		medianGapMs: median(gaps),
		p99GapMs: percentile(sortedGaps, 0.99),
		whole: split(cappedMs, durationMs),
		engaged: split(cappedEngagedMs, engagedMs),
		downtime: split(cappedDowntimeMs, downtimeMs),
	};
}

/** Nearest-rank percentile over an already-sorted list. */
function percentile(sorted: readonly number[], p: number): number {
	if (sorted.length === 0) return 0;
	const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
	return sorted[rank] ?? 0;
}

/**
 * Chi thrown away, press by press.
 *
 * Chi has to be tracked forward rather than read off, because the log reports it asymmetrically:
 * measured on a real pull, a chi *spender* carries an exact pre-spend reading (`Blackout Kick` with
 * `{amount: 4, max: 4, cost: 2}`) while a *generator* carries only the energy it paid — a Jab reports
 * 40 energy and says nothing about the chi it returned. So there is no reading to compare a gain
 * against at the moment the gain happens.
 *
 * The walk: hold a running count, add what each generator returns, subtract what each spender costs,
 * and overwrite the count with the real number every time a reading appears. Every spender is a
 * resync, so an error cannot accumulate for long — and until the first reading arrives the count is
 * unknown and nothing is claimed.
 *
 * Overflow is the excess: three chi in hand, a Jab worth two, a cap of four, one wasted.
 */
export function chiWasted(
	events: readonly WclEvent[],
	actorID: number,
	t0: number,
	gainOf: (abilityID: number) => number | undefined,
): Array<{ t: number; wasted: number }> {
	const out: Array<{ t: number; wasted: number }> = [];
	let chi: number | null = null;
	let max = 0;

	for (const e of events) {
		if (e.type !== 'cast') continue;
		const side = resourceActorOf(e);
		const owner = side === 1 ? e.sourceID : side === 2 ? e.targetID : undefined;
		if (owner !== actorID) continue;

		const bar = classResourcesOf(e)?.find((r) => r.type === POWER_TYPE.chi);
		// A reading is the truth, whatever the walk believed a moment ago.
		if (bar !== undefined && Number.isFinite(bar.amount) && bar.max > 0) {
			chi = bar.amount;
			max = bar.max;
		}

		const gain = gainOf(abilityIdOf(e) ?? 0) ?? 0;
		if (gain > 0 && chi !== null && max > 0) {
			const wasted = Math.max(0, chi + gain - max);
			if (wasted > 0) out.push({ t: e.timestamp - t0, wasted });
			chi = Math.min(max, chi + gain);
		}

		// The spend, applied after the reading it was measured before.
		if (bar !== undefined && chi !== null) chi = Math.max(0, chi - (bar.cost ?? 0));
	}

	return out;
}

/**
 * The chi the player actually had at each press, reconstructed rather than sampled.
 *
 * **Why this has to exist.** WarcraftLogs stamps a chi reading onto a *spender* and onto nothing
 * else: measured on a real pull, 178 of 1049 casts carried one, and every single one of them was a
 * Blackout Kick, a Rising Sun Kick, a Tiger Palm or a Fists of Fury — the four buttons that pay chi.
 * Generators carry only energy. So the chi curve has a median gap of 2.4 seconds against energy's
 * 0.19, and reading it with a plain "last value at or before `t`" hands a caller the chi the player
 * held two globals ago. That is not a rounding error: it made the priority ladder flag roughly half
 * of every player's presses, because a Jab at 1 chi read as a Jab at 3.
 *
 * **Why it can be reconstructed exactly.** The sparse readings are the *useful* ones. A spender
 * reports its bar before paying, and reports its own cost with it, so every spend is known precisely.
 * Between two spends only gains happen, and those come from two places: the flat returns in the
 * caller's table (Jab, Spinning Crane Kick, Rushing Jade Wind), and the `resourcechange` events the
 * log emits for Chi Brew and Power Strikes — which carry the amount outright. Nothing else moves the
 * bar. A press with no reading and no gain is a free Combo Breaker proc, which costs nothing and so
 * changes nothing.
 *
 * `gainOf` must therefore *not* cover the abilities that emit a `resourcechange`, or their chi is
 * counted twice.
 *
 * Returns one entry per cast, in time order, holding the chi available at the moment of that press —
 * before it pays for itself. Entries before the first reading are omitted: until the log says what
 * the bar held, the walk is guessing, and a guessed chi is exactly what this function exists to stop.
 */
export function chiAtCasts(
	events: readonly WclEvent[],
	actorID: number,
	t0: number,
	gainOf: (abilityID: number) => number | undefined,
): { points: Array<[number, number]>; max: number; readings: number; predicted: number; exact: number } {
	const points: Array<[number, number]> = [];
	let chi: number | null = null;
	let max = 0;
	// How often the walk's prediction matched the next reading it was checked against. Carried out so a
	// caller can state the accuracy rather than assert it — see `chiAtCasts` in the engine.
	let predicted = 0;
	let exact = 0;
	let readings = 0;

	for (const e of events) {
		const side = resourceActorOf(e);
		const owner = side === 1 ? e.sourceID : side === 2 ? e.targetID : undefined;
		if (owner !== actorID) continue;

		// A gain the log states outright — Chi Brew, Power Strikes. Applied whole; the bar's own ceiling
		// clamps it, and `waste` on the event is what the overflow audit reads.
		if (isResourceChange(e) && e.resourceChangeType === POWER_TYPE.chi) {
			const gained = e.resourceChange ?? 0;
			if (chi !== null && gained > 0) chi = Math.min(max, chi + gained);
			continue;
		}

		if (e.type !== 'cast') continue;
		const bar = classResourcesOf(e)?.find((r) => r.type === POWER_TYPE.chi);

		if (bar !== undefined && Number.isFinite(bar.amount) && bar.max > 0) {
			readings += 1;
			// Score the walk before overwriting it: this is the only place the reconstruction can be
			// checked against ground truth, and a caller that cannot state its own accuracy should not be
			// grading presses with it.
			if (chi !== null) {
				predicted += 1;
				if (chi === bar.amount) exact += 1;
			}
			chi = bar.amount;
			max = bar.max;
		}

		if (chi !== null) points.push([e.timestamp - t0, chi]);

		// The spend, applied after the reading it was measured before. Known only from the reading, which
		// is fine: a press that pays chi is exactly the press that carries one.
		if (bar !== undefined && chi !== null) chi = Math.max(0, chi - (bar.cost ?? 0));

		const gain = gainOf(abilityIdOf(e) ?? 0) ?? 0;
		if (gain > 0 && chi !== null && max > 0) chi = Math.min(max, chi + gain);
	}

	return { points, max, readings, predicted, exact };
}
