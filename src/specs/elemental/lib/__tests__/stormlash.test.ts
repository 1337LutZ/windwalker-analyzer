// Stormlash Totem: the raid's placements read together, and the overlaps that are the section's point.
//
// The buff does not stack, so a totem laid on top of a running one is a totem wasted — which is a fact
// about the *raid*, not about this player. It comes out of `raidStormlash`, a separate fetch, and the
// two committed pulls do not carry it: both shamans placed a totem (`120668` at 1.6s on
// `a:qHRAFwdGzaB6MPYC` #14 and at 31.0s on `a:xB3kh7v9pF2AHRtq` #16) and both report
// `{ shamans: [], overlaps: [], totems: 0 }`, because the field was never fetched into the fixture.
// So the raid view is synthetic here, and the real pulls are used for the one thing they can answer:
// the player's own totem on the timeline, which comes off their cast list rather than off the raid's.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '../index';

const STORMLASH = 120_668;

const fx = (name: string): Analysis & ElementalAuditResult => {
	const dataset = JSON.parse(
		readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'),
	) as FightDataset;
	return analyse(dataset) as Analysis & ElementalAuditResult;
};

describe('a pull whose raid-wide placements were never fetched', () => {
	const el = fx('phased');

	/**
	 * The section reads `raidStormlash` and nothing else, so with the field absent it says nothing —
	 * rather than falling back to the player's own casts, which would draw a one-shaman raid and let a
	 * reader conclude nobody else brought a totem.
	 */
	it('says nothing about the raid rather than guessing', () => {
		expect(el.stormlash).toEqual({ shamans: [], overlaps: [], totems: 0 });
	});

	/**
	 * The player's own totem is still on the timeline, off their cast list and the buff's fixed ten
	 * seconds. This lane and the raid section answer different questions and are drawn from different
	 * sources on purpose.
	 */
	it('still draws the player’s own totem', () => {
		expect(el.timeline?.lanes.find((l) => l.key === 'stormlash-totem')?.windows).toEqual([
			{ start: 1620, end: 11_620 },
		]);
	});
});

// ------------------------------------------------------------------ synthetic

const T0 = 900_000;
const DURATION = 60_000;
const ME = 4;
const OTHER = 6;
const BOSS = 13;

const LIGHTNING_BOLT = 403;
const LAVA_BURST = 51_505;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

const contact: WclEvent[] = Array.from({ length: DURATION / 5000 + 1 }, (_, i) =>
	e(i * 5000, 'damage', LIGHTNING_BOLT, { targetID: BOSS, targetInstance: 1, amount: 1000, hitType: 1 }),
);

/** One placement, as the raid-wide fetch returns it: an absolute stamp and the shaman who laid it. */
const placed = (t: number, sourceID?: number): WclEvent => ({
	timestamp: T0 + t,
	type: 'cast',
	abilityGameID: STORMLASH,
	...(sourceID === undefined ? {} : { sourceID }),
	targetID: -1,
});

/**
 * Six placements from three shamans, arranged around the four things the overlap walk has to get right.
 *
 *   me     0s, 20s
 *   other  55s, 5s, 10s  — deliberately out of order, to prove the per-shaman sort
 *   nobody 52s          — a placement the actor list cannot name
 *
 * Concurrency: two totems from 5s (mine and the first of theirs) through 15s, via 10s where my totem
 * expires exactly as their second one lands. Then one apiece until 52s, and two again from 55s to the
 * end of the pull.
 */
const raidStormlash: WclEvent[] = [
	placed(0, ME),
	placed(20_000, ME),
	placed(55_000, OTHER),
	placed(5000, OTHER),
	placed(10_000, OTHER),
	placed(52_000),
];

const dataset: FightDataset = {
	code: 'ele-sl',
	fight: {
		id: 9,
		name: 'Iron Qon',
		encounterID: 1662,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: T0 + DURATION,
	},
	actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
	actors: [
		{ id: ME, name: 'Sparkstorm', type: 'Player' },
		{ id: OTHER, name: 'Thunderfist', type: 'Player' },
		{ id: BOSS, name: 'Iron Qon', type: 'NPC', subType: 'Boss' },
	],
	events: [...contact, e(500, 'cast', LAVA_BURST, { targetID: BOSS, targetInstance: 1 })],
	raidStormlash,
	table: {
		fight: {
			id: 9,
			name: 'Iron Qon',
			encounterID: 1662,
			kill: true,
			difficulty: 4,
			size: 25,
			startTime: T0,
			endTime: T0 + DURATION,
			enemyNPCs: [{ id: BOSS, gameID: 68_078 }],
		},
		damageDone: {
			entries: [
				{
					name: 'Sparkstorm',
					id: ME,
					type: 'Shaman',
					itemLevel: 553,
					total: 13_000,
					activeTime: DURATION,
					abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 13_000 }],
				},
			],
		},
	},
};

const el = analyse(dataset) as Analysis & ElementalAuditResult;
const { stormlash } = el;
const shaman = (id: number) => stormlash.shamans.find((s) => s.id === id);

describe('the raid’s placements, grouped by who laid them', () => {
	it('counts every totem in the raid, not only the player’s', () => {
		expect(stormlash.totems).toBe(6);
		expect(stormlash.shamans.map((s) => s.id)).toEqual([ME, OTHER, -1]);
	});

	it('names them from the actor list, and admits when it cannot', () => {
		expect(shaman(ME)?.name).toBe('Sparkstorm');
		expect(shaman(OTHER)?.name).toBe('Thunderfist');
		// A placement whose source the log did not carry is still a placement worth drawing: it buckets
		// under -1 with a null name rather than being dropped or credited to somebody.
		expect(shaman(-1)?.name).toBeNull();
		expect(shaman(-1)?.windows).toEqual([{ start: 52_000, end: 62_000 }]);
	});

	/** Each shaman's own windows come back in time order, whatever order the fetch returned them in. */
	it('puts each shaman’s totems in time order', () => {
		expect(shaman(OTHER)?.windows.map((w) => w.start)).toEqual([5000, 10_000, 55_000]);
		expect(shaman(ME)?.windows).toEqual([
			{ start: 0, end: 10_000 },
			{ start: 20_000, end: 30_000 },
		]);
	});
});

describe('the stretches two totems were up at once', () => {
	/**
	 * Two overlaps, and the shape of each is the argument.
	 *
	 * 5s-15s is one stretch and not two. My totem ends at 10s exactly as their second lands, so a walk
	 * that treated each pair of windows separately would report 5s-10s and 10s-15s as two wasted
	 * stretches — and the count on the tile is the number a reader is asked to act on.
	 *
	 * 55s-60s is the clamp. The unnamed shaman's totem runs to 62s and the other's to 65s, so the
	 * overlap between them runs past the kill; `intervalsAtLeast` closes it at the pull instead of
	 * reporting a wasted stretch longer than the fight it happened in.
	 */
	it('reports one stretch per run of two, closed at the kill', () => {
		expect(stormlash.overlaps).toEqual([
			{ start: 5000, end: 15_000 },
			{ start: 55_000, end: DURATION },
		]);
	});

	/**
	 * The moment two totems merely touch is not an overlap.
	 *
	 * My first ends at 10s as their second begins, and my second begins at 20s as their first ends.
	 * Both used to come out as zero-length stretches — a bar the chart still draws at its minimum width,
	 * and a number on the tile nobody could find on the timeline.
	 */
	it('emits nothing where one totem ends as the next begins', () => {
		for (const w of stormlash.overlaps) expect(w.end).toBeGreaterThan(w.start);
		expect(stormlash.overlaps.some((w) => w.start === 20_000 || w.end === 20_000)).toBe(false);
	});

	it('never reports an overlap past the pull', () => {
		for (const w of stormlash.overlaps) expect(w.end).toBeLessThanOrEqual(el.durationMs);
	});
});
