// The spawn-level record: one row per enemy body, and the one number in it that carries a judgement.
//
// Two halves, and they answer different kinds of question. The synthetic half pins the mechanics —
// keying, the range, deaths, the caller's two lookups — on events small enough to read. The fixture
// half is the one this file exists for: `aimedPresses` is the fact that separates a body the player
// fought from one their area damage happened to land on, and `observeSpawns` counts it against an
// ability list the spec hands over rather than against `isAoE`, the per-hit boolean WarcraftLogs
// already stamps on every damage event. That choice is only defensible against a measurement, so the measurement is
// here rather than in a comment: the flag never contradicts the list, and it is far too wide to be it.
//
// A separate file rather than more of `targets.test.ts` on purpose. That file is about *counting*
// enemies over time — `targetCounts`, the window, `intervalsAtLeast` — and its `spawnLives` block is
// the predicate those counts are only as good as. This is the other direction: no counting at all, one
// row per body, published for a reader that has to say *where in the pull* an enemy was. Folding the
// two together would put a fixture load and a spec import into the file that currently needs neither.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { abilityIdOf, isDamage, type DamageEvent, type WclEvent } from '~/lib/events';
import type { FightDataset } from '~/lib/types';
import { registry as wwRegistry } from '~/specs/windwalker';

import { isJudgeableTarget, observeSpawns, spawnLives, spawnRecords } from '../targets';

const WINDOW = 5000;
const END = 200_000;

/** Melee, which no spec models as an ability — there is no button behind it. */
const MELEE = 1;
/** Rushing Jade Wind's damage id: the archetypal button that picks nothing. */
const RJW = 148_187;
const AIMED: ReadonlySet<number> = new Set([MELEE]);

const hit = (
	t: number,
	target: number,
	instance: number | undefined,
	extra: { id?: number; hitType?: number; tick?: boolean } = {},
): WclEvent => ({
	type: 'damage',
	timestamp: t,
	sourceID: 1,
	targetID: target,
	...(instance === undefined ? {} : { targetInstance: instance }),
	abilityGameID: extra.id ?? RJW,
	hitType: extra.hitType ?? 1,
	amount: 1000,
	...(extra.tick === undefined ? {} : { tick: extra.tick }),
});

const died = (t: number, target: number, instance?: number): WclEvent => ({
	type: 'death',
	timestamp: t,
	targetID: target,
	...(instance === undefined ? {} : { targetInstance: instance }),
});

const inputs = (over: Partial<Parameters<typeof spawnRecords>[1]> = {}): Parameters<typeof spawnRecords>[1] => ({
	t0: 0,
	endMs: END,
	windowMs: WINDOW,
	excluded: new Set<number>(),
	...over,
});

/**
 * The walk and one of its reductions, at the call sites that used to hand `spawnRecords` its events.
 *
 * `observeSpawns` is the pass and `spawnRecords` is a reduction of it, so a test naming events has to
 * say both. Written out here rather than at eighteen call sites, and with the aimed set beside the walk
 * where it belongs — it is what the walk counts presses against, and nothing downstream of it reads it.
 */
const recordsOf = (events: readonly WclEvent[], over: Partial<Parameters<typeof spawnRecords>[1]> = {}) =>
	spawnRecords(observeSpawns(events, over.t0 ?? 0, AIMED), inputs(over));

/** The other reduction of the same walk, likewise. `spawnLives` reads no aimed press, hence the empty set. */
const livesOf = (events: readonly WclEvent[], t0: number, endMs: number, windowMs: number) =>
	spawnLives(observeSpawns(events, t0, new Set()), endMs, windowMs);

describe('spawnRecords', () => {
	/**
	 * The whole of step one, in one assertion: `spawnLives` walks first-hit and last-hit per body and
	 * returns a duration, and the range it computed on the way is what a reader trying to section a pull
	 * needs. Two copies of one actor id, because that is the case an id-level record cannot express at
	 * all — WarcraftLogs hands ten simultaneous adds one `targetID`.
	 */
	it('keeps the range spawnLives reduces away, one row per body', () => {
		const records = recordsOf([hit(40_000, 9, 2), hit(10_000, 9, 1), hit(26_000, 9, 1), hit(44_000, 9, 2)]);
		expect(records.map((r) => [r.key, r.firstMs, r.lastMs, r.hits])).toEqual([
			['9:1', 10_000, 26_000, 2],
			['9:2', 40_000, 44_000, 2],
		]);
	});

	/**
	 * Ordered by first contact, whatever order the stream or the `Map` produced.
	 *
	 * Not cosmetic: the reader this record was published for cuts a pull into sections, and a body's
	 * place in the array is the order the pull met them. Insertion order would be the order of the first
	 * *event*, which is the same thing until a stream arrives unsorted, and then it silently is not.
	 */
	it('orders the rows by first contact', () => {
		const records = recordsOf([hit(9000, 8, undefined), hit(1000, 9, 1), hit(5000, 9, 2)]);
		expect(records.map((r) => r.key)).toEqual(['9:1', '9:2', '8:-']);
	});

	/**
	 * The discriminator's mechanics. Four hits on one body, one of them a button that picks a target: the
	 * body was fought once and stood in the wind three times, and those are different facts about it.
	 */
	it('counts an aimed press only for the buttons that pick a target', () => {
		const [record] = recordsOf([hit(1000, 9, 1), hit(2000, 9, 1), hit(2500, 9, 1, { id: MELEE }), hit(3000, 9, 1)]);
		expect(record?.hits).toBe(4);
		expect(record?.aimedPresses).toBe(1);
	});

	/**
	 * A dot goes on ticking on a body the player walked away from, which is the same reason
	 * `engagedWindows` throws ticks out. So a tick under an aimed id is not a press, and a body whose
	 * only aimed evidence is one was never chosen — it inherited a dot from a kick aimed elsewhere.
	 */
	it('refuses a dot tick as a press even under an aimed id', () => {
		const [record] = recordsOf([hit(1000, 9, 1, { id: MELEE, tick: true })]);
		expect(record?.hits).toBe(1);
		expect(record?.aimedPresses).toBe(0);
	});

	/**
	 * `judgeable` is `isJudgeableTarget` and not a second spelling of it — asserted against the map the
	 * dot readers actually take, on the same events. Two predicates that agree today and are written out
	 * twice is exactly the drift `isJudgeableTarget`'s own docblock was consolidated to prevent.
	 */
	it('reaches immune and judgeable through the same predicate the dot readers use', () => {
		const IMMUNE = 10;
		const events = [
			// The mine: every hit came back immune.
			hit(1000, 9, 1, { hitType: IMMUNE }),
			hit(2000, 9, 1, { hitType: IMMUNE }),
			// The boss: immune for a phase in a pull it loses anyway.
			hit(1000, 8, undefined),
			hit(71_000, 8, undefined, { hitType: IMMUNE }),
		];
		const lives = livesOf(events, 0, END, WINDOW);
		for (const record of recordsOf(events)) {
			expect(record.immune).toBe(lives.get(record.key)?.immune);
			expect(record.judgeable).toBe(isJudgeableTarget(lives.get(record.key)));
		}
		expect(recordsOf(events).map((r) => [r.key, r.immune, r.judgeable])).toEqual([
			['8:-', false, true],
			['9:1', true, false],
		]);
	});

	/**
	 * `lastMs` is the last hit and nothing else. `SpawnLife.lifetimeMs` clamps a body still being hit
	 * within a window of the finish to the finish, because it had no observable end — and that clamp is
	 * a judgement about how long the body was judgeable for, not a reading of when it was last touched.
	 * A record that quietly carried the clamped number would make `lastMs - firstMs` and `lifetimeMs`
	 * agree by construction and hide which of the two a caller had asked for.
	 */
	it('reports the last hit unclamped, where the life is clamped to the finish', () => {
		const events = [hit(180_000, 9, 1), hit(196_000, 9, 1)];
		const [record] = recordsOf(events);
		expect(record?.lastMs).toBe(196_000);
		expect(livesOf(events, 0, END, WINDOW).get('9:1')?.lifetimeMs).toBe(20_000);
	});

	/**
	 * A death belongs to a body, not to an actor id — so it is matched on the same `instanceKey` the
	 * record is keyed by, and a death stamped before the player ever touched that key is a *different*
	 * body wearing a reused instance number. Taking it would report a spawn that died before anything
	 * hit it: a negative lifetime, and a section boundary in front of the add that caused it.
	 */
	it('takes a death from the same body, and only one at or after first contact', () => {
		const events = [hit(20_000, 9, 1), hit(30_000, 9, 2)];
		const records = recordsOf(events, { enemyDeaths: [died(5000, 9, 1), died(35_000, 9, 1), died(60_000, 9, 3)] });
		expect(records.map((r) => [r.key, r.deathMs])).toEqual([
			['9:1', 35_000],
			// Instance 2 died never, and instance 3's death belongs to a body the player never hit.
			['9:2', undefined],
		]);
	});

	/**
	 * The deaths are optional and the two absences look alike here, which is the honest reading at this
	 * level: neither an unfetched pass nor a pull where nothing died is evidence that a body survived.
	 * The difference lives at the fetch boundary, where `PhasedFightDataset.enemyDeaths` is required.
	 */
	it('behaves the same whether the deaths were empty or never fetched', () => {
		const events = [hit(20_000, 9, 1)];
		expect(recordsOf(events, { enemyDeaths: [] })).toEqual(recordsOf(events));
		expect(recordsOf(events)[0]).not.toHaveProperty('deathMs');
	});

	/** A stream of the wrong shape records no deaths rather than the timestamps of somebody else's events. */
	it('ignores anything in the death stream that is not a death', () => {
		const records = recordsOf([hit(20_000, 9, 1)], { enemyDeaths: [hit(30_000, 9, 1)] });
		expect(records[0]?.deathMs).toBeUndefined();
	});

	/**
	 * Identity is the caller's to supply and `null` is a real answer. `reportFights.graphql` asks
	 * `enemyNPCs` for `id` and `gameID` and for no name at all, so a row this module invented a name for
	 * would be a name nothing in the report can be checked against.
	 */
	it('names a body only from what the caller passed', () => {
		const records = recordsOf([hit(1000, 9, 1), hit(2000, 8, undefined)], {
			npcs: [{ id: 9, gameID: 71_644, name: 'Living Corruption' }],
		});
		expect(records.map((r) => [r.key, r.gameID, r.name])).toEqual([
			['9:1', 71_644, 'Living Corruption'],
			['8:-', null, null],
		]);
	});

	/**
	 * The ranking table is resolved by the caller and never imported here — the reason
	 * `uncountedActorIDs` exists at all. The set is of report-local actor ids, so it marks the *kind*:
	 * every spawn of an excluded NPC carries the flag, which is what the rule says.
	 */
	it('marks every spawn of an actor id the caller excluded', () => {
		const records = recordsOf([hit(1000, 9, 1), hit(2000, 9, 2), hit(3000, 8, undefined)], {
			excluded: new Set([9]),
		});
		expect(records.map((r) => [r.key, r.excluded])).toEqual([
			['9:1', true],
			['9:2', true],
			['8:-', false],
		]);
	});
});

/**
 * `isAoE`, read defensively.
 *
 * The field is on every damage event WarcraftLogs returns and on none of the ones `lib/events/model`
 * declares — that union carries what a reader has needed, and until this measurement nothing had. It is
 * read here rather than added to the model deliberately: the finding below is that `isAoE` must *not*
 * become an input to `aimedPresses`, and a field sitting on `DamageEvent` is a standing invitation for
 * it to become one. A cross-check belongs in the test that makes the check.
 */
const isAoE = (e: DamageEvent): boolean => (e as DamageEvent & { isAoE?: boolean }).isAoE === true;

/**
 * The buttons a Windwalker cannot press without having picked a target.
 *
 * The same construction as `SINGLE_TARGET_DAMAGE_IDS` in the spec, which is not exported — melee plus
 * the damage ids of the four buttons that reach exactly one enemy. That set was established by counting
 * distinct enemies hit under one id at one timestamp across a Galakras pull: melee, Jab, Tiger Palm,
 * Blackout Kick and Rising Sun Kick reach one every time across 1 178 timestamps, while Rushing Jade
 * Wind reaches five, Flurry of Xuen and the weapon's Multistrike proc three, and Chi Burst two.
 *
 * Built off the registry rather than written out as numbers, so a spec that adds a Jab id — which has
 * happened once, when a real log turned up damage under 115693 — is covered here without an edit.
 */
const AIMED_WW: ReadonlySet<number> = new Set([
	1,
	...['jab', 'tiger-palm', 'blackout-kick', 'rising-sun-kick'].flatMap(
		(key) => wwRegistry.ability(key).damageIds ?? [],
	),
]);

/**
 * The choice `aimedPresses` rests on, measured on the pull rather than argued.
 *
 * `a:6MhZgjyAknFWrYfK`, Iron Juggernaut, heroic 25 — the one committed raw Windwalker dataset, and an
 * anonymous report, which is the only kind that belongs in this repository. It carries the boss and the
 * Crawler Mines and nothing else, which is exactly the shape the question needs: one body the monk
 * fought for three minutes, and nine it never chose at all.
 */
describe('what proves the player chose a body, on the committed pull', () => {
	const dataset = JSON.parse(
		readFileSync(
			resolve(import.meta.dirname, '../../../specs/windwalker/__fixtures__/dataset-ironJuggernaut.json'),
			'utf8',
		),
	) as FightDataset;

	const t0 = dataset.fight.startTime;
	const endMs = dataset.fight.endTime - t0;
	const pets = new Set(dataset.actors.filter((a) => a.petOwner === dataset.actor.id).map((a) => a.id));
	const mine = (id: number | undefined): boolean => id === dataset.actor.id || (id !== undefined && pets.has(id));
	const damage = dataset.events.filter(isDamage).filter((e) => mine(e.sourceID) && e.targetID !== undefined);

	const records = spawnRecords(observeSpawns(damage, t0, AIMED_WW), {
		t0,
		endMs,
		windowMs: 5000,
		excluded: new Set<number>(),
		npcs: dataset.actors.map((a) => ({ id: a.id, name: a.name })),
	});

	const onList = damage.filter((e) => {
		const id = abilityIdOf(e);
		return id !== null && AIMED_WW.has(id);
	});

	/**
	 * Nothing below means anything if the stream or the ability set came out empty, and both have a
	 * failure mode that passes quietly — a registry key that stopped resolving would give an empty set,
	 * and every assertion about "no hit on the list" would then hold vacuously.
	 */
	it('has a stream and a list to measure', () => {
		expect(damage).toHaveLength(1066);
		expect(AIMED_WW.size).toBeGreaterThan(5);
		expect(onList).toHaveLength(496);
	});

	/**
	 * The direction that holds, and the reason `isAoE` is a cross-check rather than a second opinion:
	 * it cannot contradict the list. If it ever does, one of the two is wrong about this spec's buttons
	 * and this is where that is said out loud — which is why the production walk does not carry a
	 * redundant `&& !isAoE` clause that would quietly absorb the disagreement instead.
	 */
	it('never flags a button that picks a target as area damage', () => {
		expect(onList.filter(isAoE)).toEqual([]);
	});

	/**
	 * The direction that fails, and the whole argument for not defining `aimedPresses` as `!isAoE`.
	 *
	 * 882 of the pull's 1 066 hits carry `isAoE: false` against the list's 496, because the flag is a
	 * fact about the *instant* and not about the button: Xuen's own attacks and the weapon's procs pick
	 * their target the way an area button does not, and land alone.
	 */
	it('is far wider than the list it would be standing in for', () => {
		expect(damage.filter((e) => !isAoE(e))).toHaveLength(882);
	});

	/**
	 * And per body, which is the reading anything downstream actually acts on. The nine Crawler Mine
	 * spawns are units nothing the monk presses can land on — every hit on one returns immune — and
	 * every one of them collects a non-AoE hit. Nine of the pull's ten bodies would read as deliberately
	 * fought, which is the verdict `SIEGE_RANKING_EXCLUSIONS` decides `reach: 'both'` rows on.
	 */
	it('hands nine of the pull’s ten bodies a press they never took', () => {
		const byNonAoE = new Set(damage.filter((e) => !isAoE(e)).map((e) => `${e.targetID}:${e.targetInstance ?? '-'}`));
		const spurious = records.filter((r) => r.aimedPresses === 0 && byNonAoE.has(r.key));
		expect(records).toHaveLength(10);
		expect(spurious).toHaveLength(9);
		expect(new Set(spurious.map((r) => r.name))).toEqual(new Set(['Crawler Mine']));
	});

	/**
	 * The row the record is for, end to end. The boss is the one body with presses on it, it is the one
	 * body worth judging, and its range is the pull — which is the fact `spawnLives` reduced to a
	 * duration and this reading keeps.
	 */
	it('reads the boss as the one body the monk fought', () => {
		const boss = records.find((r) => r.name === 'Iron Juggernaut');
		expect(boss).toMatchObject({ key: '231:-', firstMs: 421, lastMs: 190_156, hits: 1039, judgeable: true });
		// Ticks are not presses: 496 hits on the list, 150 of them Blackout Kick's dot.
		expect(boss?.aimedPresses).toBe(346);
		// No enemy death was fetched for this pull, and the record says so by carrying no answer.
		expect(boss).not.toHaveProperty('deathMs');
	});
});
