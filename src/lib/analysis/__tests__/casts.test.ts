import { describe, expect, it } from 'vitest';
import type { WclEvent } from '~/lib/events';
import type { GameData } from '~/lib/game/model';
import { createRegistry } from '~/lib/game/registry';
import { buildCastTable, castSeries, channelTickTimes, measureChannels } from '../casts';

const ME = 7;
const T0 = 1000;

/**
 * A miniature spec: one button the game splits per weapon, one channel whose ticks log as casts, and
 * one cooldown. Everything these tests are about is a relationship between ids, so they go through a
 * real registry rather than a stub.
 */
const DATA: GameData = {
	abilities: [
		{
			key: 'jab',
			name: 'Jab',
			castIds: [115687, 115695],
			onGcd: true,
			gate: 'chi',
		},
		{
			key: 'fists-of-fury',
			name: 'Fists of Fury',
			castIds: [113656],
			damageIds: [117418],
			onGcd: true,
			gate: 'conditional',
			cooldownMs: 25000,
			channel: { tickId: 117418, baseMs: 4000 },
		},
		{
			key: 'rising-sun-kick',
			name: 'Rising Sun Kick',
			castIds: [107428],
			onGcd: true,
			gate: 'cooldown',
			cooldownMs: 8000,
		},
	],
	auras: [],
};

const registry = createRegistry(DATA);

function cast(t: number, id: number, sourceID = ME): WclEvent {
	return {
		timestamp: T0 + t,
		type: 'cast',
		abilityGameID: id,
		sourceID,
		targetID: 99,
	};
}

describe('castSeries', () => {
	it('merges the ids of one button into a single series', () => {
		// Jab logs a different id per weapon type. Keyed by id, one button reads as two half-counted
		// ones — and a monk who swapped weapons mid-fight loses casts from both.
		const series = castSeries([cast(0, 115687), cast(1000, 115695), cast(2000, 115687)], ME, T0, registry);

		expect([...series.keys()]).toEqual(['jab']);
		expect(series.get('jab')?.count).toBe(3);
		expect(series.get('jab')?.times).toEqual([0, 1000, 2000]);
	});

	it('refuses to count a channel tick as a press', () => {
		// Every Fists of Fury tick logs a `cast` of its own id: counted, 12 channels became 71 casts.
		const events = [cast(0, 113656), cast(1000, 117418), cast(2000, 117418), cast(3000, 117418)];
		const series = castSeries(events, ME, T0, registry);

		expect(series.get('fists-of-fury')?.count).toBe(1);
		expect([...series.keys()]).toEqual(['fists-of-fury']);
	});

	it('keeps presses the registry does not model, under their raw id', () => {
		// Trinkets, racials and potions are real presses even though no analysis hangs off them.
		const series = castSeries([cast(0, 126734), cast(500, 107428)], ME, T0, registry);

		expect(series.get('#126734')).toMatchObject({
			count: 1,
			id: 126734,
			ability: null,
		});
		expect(series.get('rising-sun-kick')?.ability?.name).toBe('Rising Sun Kick');
	});

	it('ignores casts by anyone else', () => {
		const series = castSeries([cast(0, 107428, 99), cast(1000, 107428)], ME, T0, registry);
		expect(series.get('rising-sun-kick')?.count).toBe(1);
	});
});

describe('buildCastTable', () => {
	const series = castSeries(
		[cast(0, 107428), cast(8000, 107428), cast(1000, 115687), cast(126734, 126734)],
		ME,
		T0,
		registry,
	);
	const rows = buildCastTable(series.values(), {
		activeMs: 60000,
		nameOf: (id) => `#${id}`,
	});

	it('takes name, gate, cooldown and GCD cost from the ability', () => {
		const rsk = rows.find((r) => r.name === 'Rising Sun Kick');
		expect(rsk).toMatchObject({
			count: 2,
			gate: 'cooldown',
			cooldownSec: 8,
			onGcd: true,
			cpm: 2,
		});
	});

	it('gives a chi-gated button no cooldown, so nothing can score it on one', () => {
		expect(rows.find((r) => r.name === 'Jab')).toMatchObject({
			gate: 'chi',
			cooldownSec: null,
		});
	});

	it("falls back to the caller's names for an unmodelled press and assumes it cost no global", () => {
		expect(rows.find((r) => r.name === '#126734')).toMatchObject({
			gate: 'other',
			onGcd: false,
		});
	});

	it('sorts busiest first', () => {
		expect(rows[0]?.count).toBe(2);
	});
});

describe('channelTickTimes / measureChannels', () => {
	const events = [
		cast(0, 113656),
		cast(100, 117418),
		cast(1100, 117418),
		cast(2100, 117418),
		cast(3100, 117418),
		cast(30000, 113656),
		cast(30100, 117418),
		cast(31100, 117418),
	];

	it('finds the ticks by the id the ability declares', () => {
		expect(channelTickTimes(events, registry.ability('fists-of-fury'), ME, T0)).toEqual([
			100, 1100, 2100, 3100, 30100, 31100,
		]);
	});

	it('has no ticks to find for an ability that is not a channel', () => {
		expect(channelTickTimes(events, registry.ability('rising-sun-kick'), ME, T0)).toEqual([]);
	});

	it('measures each channel from its own ticks rather than assuming one global', () => {
		const starts = castSeries(events, ME, T0, registry).get('fists-of-fury')?.times ?? [];
		const ticks = channelTickTimes(events, registry.ability('fists-of-fury'), ME, T0);
		const channels = measureChannels(starts, ticks);

		expect(channels).toEqual([
			{ start: 0, ticks: 4, channelMs: 4100 },
			{ start: 30000, ticks: 2, channelMs: 2100 },
		]);
	});
});
