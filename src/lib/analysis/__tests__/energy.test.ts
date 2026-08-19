// Synthetic samples throughout, for the reason gear.test.ts uses synthetic gear: the cases this
// module exists to get right — a cap that straddles an intermission, a full bar read a millisecond
// before the cast that empties it — either do not appear in a committed fixture or appear once, and
// a test that can only assert what one real pull happened to contain is not a test of the rule.

import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import { RESOURCE_TYPE } from '~/lib/game/resources';

import { cappedIntervals, regenPerSecond, resourceSamples, trackResourceBar, wclPowerTypeOf } from '../energy';
import type { ResourceSample } from '../energy';

const T0 = 100_000;
const ME = 5;

/**
 * An event carrying an energy bar, as `includeResources: true` returns one.
 *
 * `resourceActor` is an *index*, not an actor id — measured against real logs it is only ever 1 (the
 * bars belong to the event's source) or 2 (the target). These tests originally built it as an actor
 * id, which is the assumption the extractor was written against, so twenty-six of them passed while
 * the feature returned zero samples on every real pull. The builder now produces the shape the API
 * actually sends, and `actor` names whose bars the event is carrying.
 */
const sampled = (
	t: number,
	amount: number,
	over: { cost?: number; max?: number; actor?: number; chi?: number } = {},
): WclEvent =>
	({
		timestamp: T0 + t,
		type: 'cast',
		abilityGameID: 100787,
		sourceID: over.actor ?? ME,
		resourceActor: 1,
		classResources: [
			{
				type: wclPowerTypeOf(RESOURCE_TYPE.energy),
				amount,
				max: over.max ?? 100,
				...(over.cost === undefined ? {} : { cost: over.cost }),
			},
			// Chi rides along on the same array, which is the shape that would let a careless read
			// answer with the wrong bar.
			{ type: wclPowerTypeOf(RESOURCE_TYPE.chi), amount: over.chi ?? 2, max: 4 },
		],
	}) as unknown as WclEvent;

/** A sample as the extractor produces one, for the pure functions downstream of it. */
const s = (t: number, amount: number, cost = 0, max = 100): ResourceSample => ({ t, amount, max, cost });

describe('resourceSamples', () => {
	it('reads the asked-for bar and not whichever came first in the array', () => {
		const out = resourceSamples([sampled(0, 73, { chi: 3 })], wclPowerTypeOf(RESOURCE_TYPE.energy), ME, T0);
		expect(out).toEqual([{ t: 0, amount: 73, max: 100, cost: 0 }]);
		expect(resourceSamples([sampled(0, 73, { chi: 3 })], wclPowerTypeOf(RESOURCE_TYPE.chi), ME, T0)[0]?.amount).toBe(3);
	});

	it('makes timestamps fight-relative', () => {
		expect(resourceSamples([sampled(4200, 40)], wclPowerTypeOf(RESOURCE_TYPE.energy), ME, T0)[0]?.t).toBe(4200);
	});

	/** A pet's bar is not the player's, and `sourceID` is not the field that says whose it is. */
	it('takes the bar belonging to the actor asked about', () => {
		const events = [sampled(0, 10, { actor: 99 }), sampled(1000, 60)];
		expect(resourceSamples(events, wclPowerTypeOf(RESOURCE_TYPE.energy), ME, T0).map((x) => x.amount)).toEqual([60]);
	});

	/**
	 * The failure this whole feature was hiding behind: without `includeResources: true` not one
	 * event carries a bar, and the result has to be empty rather than a curve of zeroes.
	 */
	it('comes back empty when the events carry no resources at all', () => {
		const bare = { timestamp: T0, type: 'cast', sourceID: ME, abilityGameID: 100787 } as WclEvent;
		expect(resourceSamples([bare], wclPowerTypeOf(RESOURCE_TYPE.energy), ME, T0)).toEqual([]);
	});

	it('keeps the cost, which is what makes the reading pre-spend', () => {
		expect(
			resourceSamples([sampled(0, 100, { cost: 40 })], wclPowerTypeOf(RESOURCE_TYPE.energy), ME, T0)[0]?.cost,
		).toBe(40);
	});
});

describe('cappedIntervals', () => {
	it('spans two full readings', () => {
		expect(cappedIntervals([s(0, 100), s(1000, 100)])).toEqual([[0, 1000]]);
	});

	it('says nothing about a bar that was not full at both ends', () => {
		expect(cappedIntervals([s(0, 100), s(1000, 60)])).toEqual([]);
		expect(cappedIntervals([s(0, 60), s(1000, 100)])).toEqual([]);
	});

	/**
	 * The rule that keeps this from charging a player for the moment they spent.
	 *
	 * A cast reads the bar *before* paying for itself, so a full reading with a cost on it means the
	 * bar emptied a millisecond later. Whatever refilled it did so between readings, unwatched, and
	 * crediting the whole gap would report a player who spent on cooldown as one who sat capped.
	 */
	it('does not credit the gap after a reading that spent something', () => {
		expect(cappedIntervals([s(0, 100, 40), s(1000, 100)])).toEqual([]);
	});

	it('merges consecutive full stretches into one', () => {
		expect(cappedIntervals([s(0, 100), s(500, 100), s(1200, 100)])).toEqual([[0, 1200]]);
	});

	/** Two readings on the same millisecond bound no interval, and must not produce a zero-length one. */
	it('ignores a pair with no time between them', () => {
		expect(cappedIntervals([s(0, 100), s(0, 100)])).toEqual([]);
	});

	/** The ceiling comes off each sample, so a bar that widens mid-pull is judged against its own max. */
	it('reads full against the max on the sample, not against a remembered one', () => {
		expect(cappedIntervals([s(0, 100, 0, 100), s(1000, 100, 0, 130)])).toEqual([]);
		expect(cappedIntervals([s(0, 130, 0, 130), s(1000, 130, 0, 130)])).toEqual([[0, 1000]]);
	});
});

describe('regenPerSecond', () => {
	/** Ten a second, sampled every second, with a spend on the way through to prove `cost` is used. */
	const steady = (): ResourceSample[] => {
		const out: ResourceSample[] = [];
		let amount = 20;
		for (let i = 0; i < 40; i++) {
			// Spend on every fourth reading, so the bar sawtooths instead of climbing to the cap where
			// the rate would stop being measurable at all.
			const cost = i % 4 === 3 ? 40 : 0;
			out.push(s(i * 1000, amount, cost));
			amount = Math.min(100, amount - cost + 10);
		}
		return out;
	};

	it('measures the refill rate off the samples', () => {
		expect(regenPerSecond(steady())).toBeCloseTo(10, 5);
	});

	/**
	 * The regression that made this function worth rewriting.
	 *
	 * Real logs sample about 400ms apart, and an earlier version measured between adjacent readings
	 * only and refused any gap under half a second — which on real data was every gap there was, so
	 * it reported no rate at all and the energy figure downstream silently became null. Spans are
	 * walked forward to a full second instead, which keeps every reading usable.
	 */
	it('measures a rate from readings closer together than the span it needs', () => {
		const dense: ResourceSample[] = [];
		let amount = 20;
		for (let i = 0; i < 200; i++) {
			const cost = i % 10 === 9 ? 40 : 0;
			dense.push(s(i * 400, amount, cost));
			amount = Math.min(100, amount - cost + 4);
		}
		expect(regenPerSecond(dense)).toBeCloseTo(10, 1);
	});

	/** A span that runs through a full bar measures clipped regen, and must not be counted. */
	it('abandons a span that touches the cap', () => {
		const pinned = Array.from({ length: 40 }, (_, i) => s(i * 1000, 100));
		expect(regenPerSecond(pinned)).toBeNull();
	});

	/** Too few pairs is an unknown, not a guess — an invented rate becomes an invented energy total. */
	it('refuses to answer from a handful of readings', () => {
		expect(regenPerSecond([s(0, 20), s(1000, 30), s(2000, 40)])).toBeNull();
		expect(regenPerSecond([])).toBeNull();
	});

	/**
	 * Energizing Brew adds 10 a second on top of regen for six seconds at a time. A sum-based rate
	 * would carry that into every second of the pull; the median cannot be moved by a few pairs.
	 */
	it('is not dragged up by a burst of extra energy', () => {
		const samples = steady();
		// Six seconds of doubled income in the middle of the pull.
		for (let i = 20; i < 26; i++) {
			const sample = samples[i];
			if (sample) sample.amount = Math.min(sample.max, sample.amount + (i - 19) * 10);
		}
		expect(regenPerSecond(samples)).toBeCloseTo(10, 0);
	});
});

describe('trackResourceBar', () => {
	/**
	 * The split the whole audit turns on: ten seconds at the cap, half of it while the player was in
	 * contact with the target and half of it through an intermission they could do nothing about.
	 */
	it('splits time at the cap into engaged and downtime', () => {
		const samples = [s(0, 100), s(10_000, 100)];
		const bar = trackResourceBar(samples, 20_000, [[0, 5000]]);

		expect(bar.whole.cappedMs).toBe(10_000);
		expect(bar.engaged.cappedMs).toBe(5000);
		expect(bar.downtime.cappedMs).toBe(5000);
	});

	/** Each half is a share of its own stretch, not of the pull — that is what makes them comparable. */
	it('measures each half against the time that half lasted', () => {
		const bar = trackResourceBar([s(0, 100), s(10_000, 100)], 20_000, [[0, 5000]]);
		expect(bar.whole.pct).toBeCloseTo(50, 5);
		// 5s capped out of the 5s engaged.
		expect(bar.engaged.pct).toBeCloseTo(100, 5);
		// 5s capped out of the 15s that was not engaged.
		expect(bar.downtime.pct).toBeCloseTo(33.3, 1);
	});

	/** The two halves must add up to the whole in front of a reader who is going to check. */
	it('never loses or invents milliseconds between the halves', () => {
		const bar = trackResourceBar([s(0, 100), s(4000, 100), s(9000, 100)], 30_000, [
			[1000, 2000],
			[5000, 20_000],
		]);
		expect(bar.engaged.cappedMs + bar.downtime.cappedMs).toBe(bar.whole.cappedMs);
	});

	/**
	 * With no engaged windows at all — a pull where the player never landed a hit on the target —
	 * every second at the cap is downtime, and none of it is a fault.
	 */
	it('charges nothing to the player when they were never engaged', () => {
		const bar = trackResourceBar([s(0, 100), s(10_000, 100)], 20_000, []);
		expect(bar.engaged.cappedMs).toBe(0);
		expect(bar.engaged.pct).toBe(0);
		expect(bar.downtime.cappedMs).toBe(10_000);
	});

	/** Overlapping engaged windows must not let the engaged half exceed the whole. */
	it('survives engaged windows that overlap each other', () => {
		const bar = trackResourceBar([s(0, 100), s(10_000, 100)], 10_000, [
			[0, 8000],
			[2000, 10_000],
		]);
		expect(bar.engaged.cappedMs).toBe(10_000);
		expect(bar.downtime.cappedMs).toBe(0);
	});

	it('reports the ceiling and the sample count off the samples themselves', () => {
		const bar = trackResourceBar([s(0, 40, 0, 130), s(1000, 50, 0, 130)], 1000, []);
		expect(bar.max).toBe(130);
		expect(bar.sampleCount).toBe(2);
	});

	/** Wasted energy is a rate times a duration, so an unmeasurable rate has to yield null, not zero. */
	it('declines to convert time into energy without a measured rate', () => {
		const bar = trackResourceBar([s(0, 100), s(10_000, 100)], 10_000, [[0, 10_000]]);
		expect(bar.regenPerSec).toBeNull();
		expect(bar.engaged.wasted).toBeNull();
	});

	it('converts time at the cap into energy once a rate is measurable', () => {
		const samples: ResourceSample[] = [];
		let amount = 20;
		for (let i = 0; i < 40; i++) {
			const cost = i % 4 === 3 ? 40 : 0;
			samples.push(s(i * 1000, amount, cost));
			amount = Math.min(100, amount - cost + 10);
		}
		// Ten seconds pinned at the cap, tacked on after the measurable stretch.
		samples.push(s(50_000, 100), s(60_000, 100));

		const bar = trackResourceBar(samples, 60_000, [[0, 60_000]]);
		expect(bar.regenPerSec).toBeCloseTo(10, 5);
		expect(bar.engaged.cappedMs).toBe(10_000);
		expect(bar.engaged.wasted).toBe(100);
	});

	/**
	 * The resolution the report has to state. These are properties of how the bar was read, not of
	 * the pull, and a section that quoted a cap time without them would imply a continuous measurement.
	 */
	it('reports the sampling gaps it was measured at', () => {
		const bar = trackResourceBar([s(0, 50), s(400, 55), s(800, 60), s(3000, 70)], 3000, []);
		expect(bar.medianGapMs).toBe(400);
		expect(bar.p99GapMs).toBe(2200);
	});

	it('answers safely for a log that carried no samples', () => {
		const bar = trackResourceBar([], 100_000, [[0, 100_000]]);
		expect(bar.sampleCount).toBe(0);
		expect(bar.max).toBe(0);
		expect(bar.whole.cappedMs).toBe(0);
		expect(bar.medianGapMs).toBe(0);
		expect(bar.p99GapMs).toBe(0);
	});
});
