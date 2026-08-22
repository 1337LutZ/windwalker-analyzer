// One timeline row per Stormlash totem and per Skull Banner, and the walk they both come out of.
//
// **The claim under test is "per instance", and the failure it replaces was "per pull".** Stormlash had a
// single merged row built from the player's own casts, so a pull where four shamans staggered their totems
// drew one bar and said "a totem was up here" — the weaker claim, and the one that hides exactly the fact
// `stormlashOverlaps` puts a number on. Skull Banner had no row at all: 114206 is declared in
// `game/shared.ts`, goes up on every committed pull from a warrior's three-minute raid cooldown, and was
// drawn nowhere.
//
// **Anchored on each fixture's own event stream**, not on a remembered figure. Every count below was read
// off the raw `applybuff`/`removebuff` pairs for the two ids first and the audit second, and the first two
// tests re-derive the counts from the stream so a fixture that changes cannot leave a stale number here
// passing.
//
// **Nothing here is a graded figure and that is the constraint rather than a remark.** `stormlash.totems`
// and `stormlash.overlaps` come off `raidStormlash` — a separate fetch no committed fixture carries — and
// they still read `{ shamans: [], overlaps: [], totems: 0 }` on all three pulls, which the last describe
// asserts alongside the rows to prove the two readings stayed independent through the lift.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { RAID_SOURCE_LANES, windowsBySource } from '~/lib/analysis/raidCasters';
import { raidScoped } from '~/lib/analysis/auras';
import type { WclEvent } from '~/lib/events';
import type { Analysis, AuraLane, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '../index';

const STORMLASH_BUFF = 120_676;
const SKULL_BANNER = 114_206;

const FIXTURES = ['phased', 'unbroken', 'cleave'] as const;

const load = (name: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;

const fx = (name: string): Analysis & ElementalAuditResult => analyse(load(name)) as Analysis & ElementalAuditResult;

/** The drawn rows for one buff, in the order the engine emitted them. */
const rowsFor = (el: Analysis, key: string): AuraLane[] =>
	(el.timeline?.lanes ?? []).filter((lane) => lane.key === key);

/** How many times the log put an id on the player, straight off the fixture's stream. */
const appliedToPlayer = (dataset: FightDataset, id: number): number =>
	dataset.events.filter((e) => e.abilityGameID === id && e.type === 'applybuff' && e.targetID === dataset.actor.id)
		.length;

describe('a row per instance, counted against the fixture’s own stream', () => {
	/**
	 * The count that used to be one, whatever the pull did.
	 *
	 * `unbroken` and `cleave` each carry four totems on this shaman from four different shamans and drew a
	 * single bar for the player's own; `phased` carries two. Re-derived from the stream rather than
	 * written down, so the assertion cannot outlive the fixture.
	 */
	it('draws one Stormlash row per totem the player was given', () => {
		const counts = FIXTURES.map((name) => {
			const dataset = load(name);
			return {
				name,
				rows: rowsFor(analyse(dataset), 'stormlash-totem').length,
				applications: appliedToPlayer(dataset, STORMLASH_BUFF),
			};
		});
		// Not vacuous: every pull really does put more than one totem on this shaman.
		for (const c of counts) expect(c.applications, c.name).toBeGreaterThan(1);
		expect(counts.map((c) => c.rows)).toEqual(counts.map((c) => c.applications));
		expect(counts.map((c) => c.rows)).toEqual([2, 4, 4]);
	});

	/**
	 * The buff that had no row at all, now one per banner.
	 *
	 * Four, two and four — the same numbers `game/shared.ts` cites for the declaration, measured
	 * independently here off the stream.
	 */
	it('draws one Skull Banner row per banner the player was given', () => {
		const counts = FIXTURES.map((name) => {
			const dataset = load(name);
			return {
				name,
				rows: rowsFor(analyse(dataset), 'skull-banner').length,
				applications: appliedToPlayer(dataset, SKULL_BANNER),
			};
		});
		for (const c of counts) expect(c.applications, c.name).toBeGreaterThan(0);
		expect(counts.map((c) => c.rows)).toEqual(counts.map((c) => c.applications));
		expect(counts.map((c) => c.rows)).toEqual([4, 2, 4]);
	});

	/**
	 * **Per instance and not per caster**, which is the difference a count alone cannot show.
	 *
	 * `cleave` has two warriors banner twice each. Grouping by caster would draw two rows for four
	 * banners and hide the second pair; grouping by instance draws four, and the two rows that share a
	 * caster are the evidence that the row is the banner rather than the warrior.
	 */
	it('gives a caster who pressed twice two rows, not one', () => {
		const rows = rowsFor(fx('cleave'), 'skull-banner');
		expect(rows).toHaveLength(4);
		expect(new Set(rows.map((r) => r.source?.id)).size).toBe(2);
		// Each row is exactly one instance — one window, and the windows do not overlap between the two
		// presses of one caster.
		expect(rows.map((r) => r.windows.length)).toEqual([1, 1, 1, 1]);
		expect(rows.map((r) => [r.source?.id, r.windows[0]?.start, r.windows[0]?.end])).toEqual([
			[52, 2814, 13_243],
			[46, 14_299, 24_568],
			[52, 184_448, 194_721],
			[46, 203_392, 213_744],
		]);
	});
});

describe('whose row it is', () => {
	/**
	 * The caster is the player who pressed the button, not the object the log named as the source.
	 *
	 * Every one of these buffs is applied by a summon — the totem, the banner — so `sourceID` on the
	 * event is a pet. On `phased` the Stormlash applications come from actors 39 and 70, both `Pet`
	 * entries, and a row labelled `Pet (39)` names nothing a reader can act on. `petOwner` resolves them
	 * to 2 (this shaman) and 7.
	 */
	it('names the caster and not their totem', () => {
		const dataset = load('phased');
		const sources = new Set(
			dataset.events
				.filter((e) => e.abilityGameID === STORMLASH_BUFF && e.targetID === dataset.actor.id)
				.map((e) => e.sourceID),
		);
		// The premise: the log really does credit these to pets rather than to players.
		expect([...sources]).toEqual([39, 70]);
		for (const id of sources) expect(dataset.actors.find((a) => a.id === id)?.type).toBe('Pet');

		expect(rowsFor(analyse(dataset), 'stormlash-totem').map((r) => r.source)).toEqual([
			{ id: 2, name: 'Player (2)' },
			{ id: 7, name: 'Player (7)' },
		]);
	});

	/**
	 * The player's own leads its buff's block, and the rest run in clock order.
	 *
	 * The analogue of the primary enemy leading the per-enemy block: it is the one row on the chart whose
	 * timing the reader chose. `unbroken` is the pull that shows both halves — this shaman's totem is the
	 * *third* of four chronologically and is drawn first, and the other three keep their own order.
	 */
	it('leads with the player’s own instance, then runs chronologically', () => {
		const rows = rowsFor(fx('unbroken'), 'stormlash-totem');
		expect(rows.map((r) => [r.source?.id, r.windows[0]?.start])).toEqual([
			[2, 31_142],
			[3, 10_025],
			[5, 20_959],
			[47, 43_224],
		]);
	});

	/**
	 * A caster row is not an enemy row, and the field says so.
	 *
	 * `target` means "enemy" everywhere it is read — `perTargetBlock` sinks a lane carrying one into the
	 * per-enemy block at the foot of the chart, and the picker offers it as an enemy to tick. A caster
	 * arriving in that field would read as a victim, which is why `source` exists rather than being
	 * folded into it.
	 */
	it('carries a source and never a target', () => {
		for (const name of FIXTURES) {
			for (const key of ['stormlash-totem', 'skull-banner']) {
				for (const row of rowsFor(fx(name), key)) {
					expect(row.target, `${name}/${key}`).toBeUndefined();
					expect(row.group, `${name}/${key}`).toBe('buff');
					expect(row.windows, `${name}/${key}`).toHaveLength(1);
				}
			}
		}
	});
});

describe('the raid-wide stream, narrowed to the player', () => {
	/**
	 * **The narrowing is the whole correctness of this, not tidiness.**
	 *
	 * The fight's event stream carries these buffs going out to *everybody*: `phased` has 38 Stormlash
	 * applications on it, one of which is on this shaman. A walk that bucketed all 38 by caster would
	 * report one caster with 38 instances and look like it had worked — 38 rows for a pull with two
	 * totems on the player.
	 */
	it('draws what landed on the player, not what the raid received', () => {
		const dataset = load('phased');
		const all = dataset.events.filter((e) => e.abilityGameID === STORMLASH_BUFF && e.type === 'applybuff');
		expect(all).toHaveLength(38);
		expect(all.filter((e) => e.targetID === dataset.actor.id)).toHaveLength(2);
		expect(rowsFor(analyse(dataset), 'stormlash-totem')).toHaveLength(2);
	});
});

describe('the shared walk, on the two shapes it has to serve', () => {
	const T0 = 500_000;
	const PULL = 60_000;
	const e = (t: number, type: string, id: number, sourceID: number | undefined, targetID: number): WclEvent => ({
		timestamp: T0 + t,
		type,
		abilityGameID: id,
		...(sourceID === undefined ? {} : { sourceID }),
		targetID,
	});

	/**
	 * A stream of placements: one event per instance, and the instance's own duration closes it.
	 *
	 * This is the shape the Elemental's Stormlash *audit* is built on and the reason the lift could not
	 * simply reuse `auraWindows` — a raid-wide `Casts` fetch has no aura events in it at all. Two totems
	 * from one caster inside the hold are two instances and must not collapse; the last is laid with
	 * eight seconds of fight left and is clamped to the kill rather than running past its own axis.
	 */
	it('closes a placement at its own duration, clamped to the pull', () => {
		const placements = raidScoped([
			e(0, 'cast', 120_668, 4, -1),
			e(5000, 'cast', 120_668, 4, -1),
			e(52_000, 'cast', 120_668, undefined, -1),
		]);
		expect(windowsBySource(placements, [120_668], { t0: T0, pullMs: PULL, holdsMs: 10_000 })).toEqual([
			{
				source: 4,
				windows: [
					{ start: 0, end: 10_000 },
					{ start: 5000, end: 15_000 },
				],
			},
			// A placement whose source the log did not carry buckets under -1 rather than being dropped.
			{ source: -1, windows: [{ start: 52_000, end: PULL }] },
		]);
	});

	/**
	 * A stream of applications: the log's own apply/remove pair wins over the declared duration.
	 *
	 * This is the shape both timeline rows come out of, and the removal is the truth — a banner the raid
	 * moved out of range of came off early, and the declared ten seconds would have drawn a bar past it.
	 * A removal with no application in front of it is a buff that went up before the event window opened
	 * and is left alone rather than being given an invented start.
	 */
	it('closes an application where the log says it came off', () => {
		const stream = raidScoped([
			// The orphan removal: nothing opened it, so nothing closes.
			e(500, 'removebuff', SKULL_BANNER, 8, 1),
			e(1000, 'applybuff', SKULL_BANNER, 9, 1),
			e(4000, 'removebuff', SKULL_BANNER, 9, 1),
			// Somebody else's copy of the same buff, on somebody else.
			e(1000, 'applybuff', SKULL_BANNER, 9, 2),
			// A refresh is not a second instance, exactly as it is not in `auraWindows`.
			e(20_000, 'applybuff', SKULL_BANNER, 9, 1),
			e(22_000, 'refreshbuff', SKULL_BANNER, 9, 1),
			e(55_000, 'applybuff', SKULL_BANNER, 9, 1),
		]);
		expect(windowsBySource(stream, [SKULL_BANNER], { t0: T0, pullMs: PULL, holdsMs: 10_000, onTarget: 1 })).toEqual([
			{
				source: 9,
				windows: [
					{ start: 1000, end: 4000 },
					// Never removed, so it runs its declared hold...
					{ start: 20_000, end: 30_000 },
					// ...and this one would have, but the pull ended first.
					{ start: 55_000, end: PULL },
				],
			},
		]);
	});
});

describe('the cap, and what happens past it', () => {
	const T0 = 900_000;
	const PULL = 200_000;
	const ME = 4;
	const BOSS = 13;
	const CASTERS = 8;

	/**
	 * Eight banners on one pull, which a 25-man raid can genuinely field.
	 *
	 * One apiece from eight different warriors, ten seconds each and well clear of one another, so the
	 * only thing deciding how many rows there are is the cap.
	 */
	const banners: WclEvent[] = Array.from({ length: CASTERS }, (_, i) => [
		{
			timestamp: T0 + 10_000 + i * 20_000,
			type: 'applybuff',
			abilityGameID: 114_206,
			sourceID: 100 + i,
			targetID: ME,
		},
		{
			timestamp: T0 + 20_000 + i * 20_000,
			type: 'removebuff',
			abilityGameID: 114_206,
			sourceID: 100 + i,
			targetID: ME,
		},
	]).flat();

	const contact: WclEvent[] = Array.from({ length: PULL / 5000 + 1 }, (_, i) => ({
		timestamp: T0 + i * 5000,
		type: 'damage',
		abilityGameID: 403,
		sourceID: ME,
		targetID: BOSS,
		targetInstance: 1,
		amount: 1000,
		hitType: 1,
	}));

	const dataset: FightDataset = {
		code: 'ele-banners',
		fight: {
			id: 9,
			name: 'Iron Qon',
			encounterID: 1662,
			kill: true,
			difficulty: 4,
			size: 25,
			startTime: T0,
			endTime: T0 + PULL,
		},
		actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
		actors: [
			{ id: ME, name: 'Sparkstorm', type: 'Player' },
			{ id: BOSS, name: 'Iron Qon', type: 'NPC', subType: 'Boss' },
			...Array.from({ length: CASTERS }, (_, i) => ({
				id: 100 + i,
				name: `Banner ${i}`,
				type: 'Pet',
				subType: 'Pet',
				petOwner: 200 + i,
			})),
			...Array.from({ length: CASTERS }, (_, i) => ({ id: 200 + i, name: `Warrior ${i}`, type: 'Player' })),
		],
		events: [...contact, ...banners],
		table: {
			fight: {
				id: 9,
				name: 'Iron Qon',
				encounterID: 1662,
				kill: true,
				difficulty: 4,
				size: 25,
				startTime: T0,
				endTime: T0 + PULL,
				enemyNPCs: [{ id: BOSS, gameID: 68_078 }],
			},
			damageDone: {
				entries: [
					{
						name: 'Sparkstorm',
						id: ME,
						type: 'Shaman',
						itemLevel: 553,
						total: 41_000,
						activeTime: PULL,
						abilities: [{ guid: 403, name: 'Lightning Bolt', total: 41_000 }],
					},
				],
			},
		},
	};

	const el = analyse(dataset);

	/**
	 * The cap decides what is drawn by default and nothing else — the same judgement `FS_TARGET_LANES`
	 * makes about enemies, and for the same reason: the rows an unbounded count pushes off the screen are
	 * the player's own rotation.
	 */
	it('draws the cap and carries the rest rather than dropping them', () => {
		const drawn = rowsFor(el, 'skull-banner');
		expect(drawn).toHaveLength(RAID_SOURCE_LANES);
		const spare = (el.timeline?.hiddenLanes ?? []).filter((l) => l.key === 'skull-banner');
		expect(spare).toHaveLength(CASTERS - RAID_SOURCE_LANES);
		// `lanes` ++ `hiddenLanes` is the full set in the order the cap cut it at, so nothing is lost and
		// the two halves concatenate back into one chronological run.
		expect([...drawn, ...spare].map((l) => l.windows[0]?.start)).toEqual(
			Array.from({ length: CASTERS }, (_, i) => 10_000 + i * 20_000),
		);
	});

	/**
	 * `hiddenTargets` stays a count of **enemies**.
	 *
	 * It feeds a caption that says "more enemies carried the debuff", so counting a raid-buff instance in
	 * it would have the chart telling the reader about adds that do not exist. The overflow is carried in
	 * `hiddenLanes` and counted nowhere.
	 */
	it('does not count a caster as a hidden enemy', () => {
		expect(el.timeline?.hiddenTargets ?? 0).toBe(0);
	});
});

describe('the lift did not touch the section’s own numbers', () => {
	/**
	 * `totems` and `overlaps` are read from `raidStormlash`, and the rows are read from the buff on the
	 * player. Two sources, two questions, and the per-caster bucket is now shared between them — so the
	 * one thing worth asserting after the lift is that sharing it did not cross the two.
	 *
	 * No committed fixture carries the placement fetch, so all three still say nothing about the raid
	 * while drawing rows for what the raid actually gave the player. `stormlash.test.ts`' synthetic pull
	 * is where `totems` and `overlaps` themselves are pinned, and it passes unchanged.
	 */
	it('still says nothing about the raid on a pull that never fetched it, while drawing the rows', () => {
		for (const name of FIXTURES) {
			const el = fx(name);
			expect(el.stormlash, name).toEqual({ shamans: [], overlaps: [], totems: 0 });
			expect(rowsFor(el, 'stormlash-totem').length, name).toBeGreaterThan(0);
		}
	});
});
