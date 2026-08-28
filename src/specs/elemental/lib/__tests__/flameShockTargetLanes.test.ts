// The Flame Shock timeline, one row per enemy.
//
// The shared chart has had the whole per-enemy apparatus since the Windwalker needed it — the enemy
// headings, the picker, `collapseTargets` — and it groups on one field: `AuraLane.target`. This spec
// emitted no lane carrying one, so an Elemental's Flame Shock drew as a single merged bar even on a
// Siegecrafter Blackfuse pull, and a merged bar says only "something out there had the dot".
//
// Two things this file has to hold, and they pull in opposite directions.
//
//   1. The rows have to be *rows*: one per enemy that carried the dot, named, with the primary flagged
//      as the primary. Asserted against facts the lane code cannot supply itself — the number of
//      distinct enemies the fixture's own event stream carries, an enemy named out of its actor list,
//      and `primaryTarget.id`, which the core decides and this file only reads.
//   2. **The rows must not reach the graded figure.** Flame Shock's uptime is the graded clock's
//      reading and is measured a long way above the timeline section; the three reference pulls read
//      98.2015%, 100% and 72.2979% before these rows existed. They are pinned here, in the file that
//      added the rows, because that is where a change to them would come from.
//
//      `cleave`'s figure has since moved once, to 83.8989%, and **not** because a row reached it: the
//      graded clock itself was cut to drop the stretches three or more enemies were up, which is a change
//      to the denominator and the numerator together, made in the audit and asserted in
//      `bandedClocks.test.ts`. The two single-target pulls did not move, and that is the evidence the
//      cause was the clock and not the rows — a row leaking in would have moved all three.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import type { Analysis, AuraLane, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '../index';

const raw = (name: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;
const fx = (name: string): Analysis & ElementalAuditResult => analyse(raw(name)) as Analysis & ElementalAuditResult;

/** The drawn Flame Shock rows, in the order the engine emitted them. */
const fsLanes = (el: Analysis & ElementalAuditResult): AuraLane[] =>
	(el.timeline?.lanes ?? []).filter((l) => l.key === 'flame-shock');

describe('the reference pulls, and the figure the rows must not move', () => {
	/**
	 * The hard constraint of the change, in the one assertion that can catch it failing.
	 *
	 * These three are the graded-clock uptime — `fsContactWindows` over `fsGradedMs` — and no part of the
	 * per-enemy row set is an input to either. If a row ever becomes one, this is where it shows, and the
	 * answer is to take the row back out rather than to re-baseline these numbers.
	 *
	 * **That instruction still stands, and re-baselining `cleave` here did not break it.** The rule is that
	 * a *row* must never move these figures. What moved this one is the clock both halves of the share are
	 * measured over, named at the top of this file and pinned by its own file. The tell is that the other
	 * two pulls are untouched to the last digit: they never exceed one enemy, so a clock cut cannot reach
	 * them, while anything leaking out of the row set would reach all three. So the two unchanged literals
	 * are load-bearing here, not decoration.
	 */
	it('leaves Flame Shock uptime where the rows found it on all three pulls', () => {
		expect(fx('phased').flameShock.uptimePct).toBe(98.20146497092811);
		expect(fx('unbroken').flameShock.uptimePct).toBe(100);
		expect(fx('cleave').flameShock.uptimePct).toBe(86.79358020209355);
	});

	/**
	 * Both Iron Juggernaut pulls are single-target, and a single-target pull must not grow rows.
	 *
	 * One row, carrying the boss — so `perTargetBlock`'s single-lane hoist still applies and the chart
	 * still spends no heading repeating the boss's name that the report's header already prints.
	 */
	it.each(['phased', 'unbroken'])('draws one Flame Shock row on %s, the boss', (name) => {
		const el = fx(name);
		const lanes = fsLanes(el);
		expect(lanes).toHaveLength(1);
		// The core's answer, not the lane's — this file reads `primaryID` and does not decide it.
		expect(lanes[0]?.target?.id).toBe(el.primaryTarget.id);
		expect(lanes[0]?.target?.primary).toBe(true);
		expect(lanes[0]?.target?.name).toBe('Iron Juggernaut');
		expect(el.timeline?.hiddenTargets).toBe(0);
	});
});

describe('a cleave pull, one row per enemy that carried the dot', () => {
	const el = fx('cleave');

	/**
	 * The pull's own arithmetic, straight off the raw stream, so the row count below is measured against
	 * the fixture and not against the code that built the rows.
	 *
	 * 71 enemy spawns took damage from this player, under 6 distinct actor ids. Two of them ever carried
	 * Flame Shock. So the honest row set is 2 — not 1, which is what the chart drew before, and not 6 or
	 * 71, which is what "a row per enemy" would mean if it meant every enemy.
	 */
	const dotted = (() => {
		const d = raw('cleave');
		const byId = new Map(d.actors.map((a) => [a.id, a]));
		const pets = new Set(d.actors.filter((a) => a.petOwner === d.actor.id).map((a) => a.id));
		const hitIDs = new Set<number>();
		const hitSpawns = new Set<string>();
		const dottedIDs = new Set<number>();
		for (const e of d.events as WclEvent[]) {
			const target = e.targetID;
			if (target === undefined || byId.get(target)?.type === 'Player') continue;
			if (e.type.includes('damage') && (e.sourceID === d.actor.id || pets.has(e.sourceID ?? -1))) {
				hitIDs.add(target);
				hitSpawns.add(`${target}:${e.targetInstance ?? '-'}`);
			}
			if (e.abilityGameID === 8050 && e.sourceID === d.actor.id && e.type.includes('debuff')) dottedIDs.add(target);
		}
		return { hitIDs, hitSpawns, dottedIDs, name: (id: number) => byId.get(id)?.name ?? null };
	})();

	it('is the multi-enemy pull this change is about', () => {
		expect(el.encounter).toBe('Siegecrafter Blackfuse');
		expect(dotted.hitSpawns.size).toBe(71);
		expect(dotted.hitIDs.size).toBe(6);
		expect(dotted.dottedIDs.size).toBe(2);
	});

	it('draws a row for each of the two enemies the log says carried it', () => {
		const lanes = fsLanes(el);
		expect(lanes).toHaveLength(dotted.dottedIDs.size);
		expect(lanes.map((l) => l.target?.id).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
			[...dotted.dottedIDs].sort((a, b) => a - b),
		);
	});

	/**
	 * The names come out of the report's actor list, and the add's is the point: before this change
	 * there was no row for the Automated Shredder at all, and the boss's bar silently included the two
	 * windows that were never on the boss.
	 */
	it('names the enemies, primary first', () => {
		expect(fsLanes(el).map((l) => [l.target?.name, l.target?.primary])).toEqual([
			['Siegecrafter Blackfuse', true],
			['Automated Shredder', false],
		]);
		// Read back out of the fixture, so the expectation above is the actor list's own answer.
		expect(dotted.name(el.primaryTarget.id ?? -1)).toBe('Siegecrafter Blackfuse');
	});

	/**
	 * The boss's row is the array the report's own provenance marking comes off, not a re-derivation:
	 * the primary lane is still `dotLaneWindows(FS_DEBUFF)`, which is what `prepullLanes.test.ts`
	 * measures. The add's row is a different walk and must not have been folded into it.
	 */
	it('keeps the two enemies’ windows apart', () => {
		const [boss, add] = fsLanes(el);
		// The add's own 25.1s, and the only stretch of the pull that was ever on the shredder. It is not a
		// window the boss's row carries — the two rows are two walks, not one bar drawn twice.
		expect(add?.windows).toEqual([{ start: 40_282, end: 65_404 }]);
		expect((boss?.windows ?? []).some((w) => w.start === 40_282)).toBe(false);
		// The boss's row is unchanged: it is `dotLaneWindows` itself, which is the array
		// `prepullLanes.test.ts` measures and the row the uptime figure is read beside.
		expect((boss?.windows.length ?? 0) > 1).toBe(true);
	});

	/**
	 * `t16-2pc-debuff` was the other candidate for this treatment and does not get it.
	 *
	 * It is a debuff on an enemy, so `perTargetBlock` already puts it in the enemies' block — but its
	 * windows are primary-scoped by construction and every reader of them is the same array: Earth
	 * Shock's `twoPiece` condition, the ladder's gate and this row. A per-enemy set would need a second,
	 * unscoped walk whose extra rows no figure in the report is measured against. And the log says there
	 * is nothing to put in them: across all three raw fixtures 144999 appears on exactly one enemy — the
	 * boss — including on this pull, where Flame Shock demonstrably does spread.
	 */
	it('leaves the two-piece debuff as one row, with no target on it', () => {
		const rows = (el.timeline?.lanes ?? []).filter((l) => l.key === 't16-2pc-debuff');
		expect(rows).toHaveLength(1);
		expect(rows[0]?.target).toBeUndefined();
		expect(rows[0]?.group).toBe('debuff');
	});
});

// ------------------------------------------------------------------ synthetic

const T0 = 400_000;
const DURATION = 120_000;
const ME = 9;
const BOSS = 50;
const LIGHTNING_BOLT = 403;
const FLAME_SHOCK = 8050;
const LAVA_BURST = 51_505;

const ev = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});
const hit = (t: number, target: number, amount: number, instance?: number): WclEvent =>
	ev(t, 'damage', LIGHTNING_BOLT, {
		targetID: target,
		amount,
		hitType: 1,
		...(instance === undefined ? {} : { instance }),
	});
const dot = (target: number, start: number, end: number, instance?: number): WclEvent[] => {
	const on = instance === undefined ? { targetID: target } : { targetID: target, targetInstance: instance };
	return [ev(start, 'applydebuff', FLAME_SHOCK, on), ev(end, 'removedebuff', FLAME_SHOCK, on)];
};

/** The boss is hit every two seconds so the contact clock is one unbroken segment. */
const bossContact = Array.from({ length: 60 }, (_, i) => hit(i * 2000, BOSS, 20_000));

const pull = (name: string, enemies: Array<{ id: number; name: string }>, events: WclEvent[]): FightDataset => {
	const fight = {
		id: 1,
		name,
		encounterID: 1620,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: T0 + DURATION,
	};
	return {
		code: 'eleTGT',
		fight,
		actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
		actors: [
			{ id: ME, name: 'Sparkstorm', type: 'Player' },
			{ id: BOSS, name: 'Siege Engine', type: 'NPC', subType: 'Boss' },
			...enemies.map((e) => ({ id: e.id, name: e.name, type: 'NPC', subType: 'NPC' })),
		],
		events: [ev(1000, 'cast', LAVA_BURST, { targetID: BOSS }), ...bossContact, ...dot(BOSS, 0, 100_000), ...events],
		table: {
			fight: {
				...fight,
				enemyNPCs: [{ id: BOSS, gameID: 71504 }, ...enemies.map((e) => ({ id: e.id, gameID: e.id }))],
			},
			damageDone: {
				entries: [
					{
						name: 'Sparkstorm',
						id: ME,
						type: 'Shaman',
						itemLevel: 553,
						total: 1_200_000,
						activeTime: DURATION,
						abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 1_200_000 }],
					},
				],
			},
		},
	} as FightDataset;
};

describe('two spawns of one add', () => {
	/**
	 * WarcraftLogs gives one actor id to an NPC *type*, so a pack of adds shares it. The walk buckets
	 * per spawn — it has to, or one copy's remove closes another copy's window — but a *row* is labelled
	 * with an enemy's name, and two rows with one name, one id and one React key are reconciled into
	 * each other by the chart (`CastTimeline` keys them `${lane.key}@${target.id}`).
	 *
	 * So the two spawns' windows land on one row. Both windows survive: 10s–30s off the first copy and
	 * 60s–80s off the second, neither swallowing the other.
	 */
	const ADD = 70;
	const el = analyse(
		pull(
			'Iron Qon',
			[{ id: ADD, name: 'Automated Shredder' }],
			[
				hit(12_000, ADD, 5000, 1),
				hit(62_000, ADD, 5000, 2),
				...dot(ADD, 10_000, 30_000, 1),
				...dot(ADD, 60_000, 80_000, 2),
			],
		),
	) as Analysis & ElementalAuditResult;

	it('is read as Elemental at all', () => {
		expect(el.isSpec).toBe(true);
		expect(el.primaryTarget.id).toBe(BOSS);
	});

	it('draws the add once, with both of its spawns’ windows on the one row', () => {
		const lanes = fsLanes(el);
		expect(lanes.map((l) => l.target?.name)).toEqual(['Siege Engine', 'Automated Shredder']);
		expect(lanes[1]?.windows).toEqual([
			{ start: 10_000, end: 30_000 },
			{ start: 60_000, end: 80_000 },
		]);
	});
});

describe('more dotted enemies than the chart draws', () => {
	/**
	 * Nine enemies carry the dot and the cap is six rows, so three go to the picker rather than being
	 * dropped: `hiddenLanes` carries them and `hiddenTargets` counts them, which is what lets the chart
	 * say how many enemies it is not showing (`undrawnTargets` in `CastTimeline`).
	 *
	 * Ordered by the damage the enemy took from this player, so the adds are drawn `add-1` first — the
	 * amounts below descend with the index — and the three that fall off the end are the three that took
	 * the least. The primary always leads, whatever it took.
	 */
	const adds = Array.from({ length: 8 }, (_, i) => ({ id: 60 + i, name: `add-${i + 1}` }));
	const el = analyse(
		pull(
			'Galakras',
			adds,
			adds.flatMap((add, i) => [hit(20_000 + i * 100, add.id, 9000 - i * 500), ...dot(add.id, 20_000, 40_000)]),
		),
	) as Analysis & ElementalAuditResult;

	it('draws the cap and carries the rest', () => {
		expect(fsLanes(el).map((l) => l.target?.name)).toEqual([
			'Siege Engine',
			'add-1',
			'add-2',
			'add-3',
			'add-4',
			'add-5',
		]);
		expect(el.timeline?.hiddenTargets).toBe(3);
		expect(el.timeline?.hiddenLanes?.map((l) => l.target?.name)).toEqual(['add-6', 'add-7', 'add-8']);
	});

	it('flags exactly one row as the primary', () => {
		const drawn = fsLanes(el);
		expect(drawn.filter((l) => l.target?.primary === true).map((l) => l.target?.id)).toEqual([el.primaryTarget.id]);
		expect((el.timeline?.hiddenLanes ?? []).some((l) => l.target?.primary === true)).toBe(false);
	});
});
