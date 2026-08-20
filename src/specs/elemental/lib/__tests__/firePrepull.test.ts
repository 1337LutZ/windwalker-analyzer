// The Fire Elemental that was summoned before the bell: the slot it holds, and the one thing the
// report is willing to say about a pull that did not have it out.
//
// Two halves, and they are one file because the second is a grade on the first. A pre-pull summon logs
// no cast inside the fight window — its only trace is the bare `removebuff` where it expired — so the
// Fire totem slot walk, built from cast lists alone, used to see an empty slot for the elemental's whole
// stretch and left it inside the Searing Totem denominator. The grade sits on top of that same
// inference, which is why it could not be added while the inference was one function short.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '../index';
import { scoreAnalysis, THRESHOLDS } from '../score';

const fx = (name: string): Analysis & ElementalAuditResult => {
	const dataset = JSON.parse(
		readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'),
	) as FightDataset;
	return analyse(dataset) as Analysis & ElementalAuditResult;
};

const T0 = 2_000_000;
const ME = 7;
const BOSS = 15;

const LIGHTNING_BOLT = 403;
const LAVA_BURST = 51_505;
const FIRE_ELEMENTAL = 2894;
/**
 * The buff a Fire Elemental press applies, which is **not** the id it is cast under.
 *
 * One press emits `applybuff 118291` + `summon 118291` (the Primal Fire Elemental) alongside
 * `cast 2894` + `summon 2894` (the totem object), so a summon made before the bell leaves exactly one
 * thing inside the fight window: a bare `removebuff` of 118291. Every synthetic pre-pull below is
 * written in that shape rather than in 2894's, because 2894 is a shape no log emits as a buff.
 */
const FIRE_ELEMENTAL_BUFF = 118_291;
const SEARING_TOTEM = 3599;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

const hit = (t: number): WclEvent =>
	e(t, 'damage', LIGHTNING_BOLT, { targetID: BOSS, targetInstance: 1, amount: 1000, hitType: 1 });

/**
 * A pull with a hit every five seconds, so the engaged clock is the whole fight.
 *
 * `from` is where the player joins it: every case here that turns on the pull's opening needs a stream
 * that starts somewhere other than the bell, and the engaged clock is built from landed hits.
 */
const make = (durationMs: number, extra: readonly WclEvent[], from = 0): FightDataset => {
	const fight = {
		id: 5,
		name: 'Iron Qon',
		encounterID: 1662,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: T0 + durationMs,
	};
	const contact: WclEvent[] = [];
	for (let t = from; t <= durationMs; t += 5000) contact.push(hit(t));
	return {
		code: 'ele-fe-prepull',
		fight,
		actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
		actors: [
			{ id: ME, name: 'Sparkstorm', type: 'Player' },
			{ id: BOSS, name: 'Iron Qon', type: 'NPC', subType: 'Boss' },
		],
		// A Lava Burst so `identify` accepts the pull as Elemental at all.
		events: [...contact, e(from, 'cast', LAVA_BURST, { targetID: BOSS, targetInstance: 1 }), ...extra],
		table: {
			fight: { ...fight, enemyNPCs: [{ id: BOSS, gameID: 68_078 }] },
			damageDone: {
				entries: [
					{
						name: 'Sparkstorm',
						id: ME,
						type: 'Shaman',
						itemLevel: 553,
						total: 81_000,
						activeTime: durationMs,
						abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 81_000 }],
					},
				],
			},
		},
	};
};

const run = (dataset: FightDataset): Analysis & ElementalAuditResult =>
	analyse(dataset) as Analysis & ElementalAuditResult;

/** The bare expiry a pre-pull summon leaves behind, 40s into a 200s pull. */
const PREPULL_EXPIRY = e(40_000, 'removebuff', FIRE_ELEMENTAL_BUFF);

describe('the Fire totem slot a pre-pull elemental was standing in', () => {
	/**
	 * The case plan step 31b was written from, with the numbers it predicted.
	 *
	 * One Fire totem slot, and the elemental held it for the first forty seconds — a stretch the player
	 * *could not* have put a Searing Totem in. Built from the cast lists alone the walk saw nothing
	 * there, so all 200s stayed in the denominator and a totem covering 60s of it read 30%.
	 */
	it('keeps the recovered pre-pull stretch out of the Searing Totem denominator', () => {
		const el = run(make(200_000, [PREPULL_EXPIRY, e(40_000, 'cast', SEARING_TOTEM, { targetID: BOSS })]));
		expect(el.fireElemental.prepull).toBe(true);
		expect(el.searingTotem.feWindows).toEqual([{ start: 0, end: 40_000 }]);
		expect(el.searingTotem.scoredMs).toBe(160_000);
		expect(el.searingTotem.uptimeMs).toBe(60_000);
		expect(el.searingTotem.uptimePct).toBe(37.5);
	});

	/** And with no totem at all, the same forty seconds still come out of the clock being scored. */
	it('drops the stretch from the clock even when nothing else was placed', () => {
		const el = run(make(200_000, [PREPULL_EXPIRY]));
		expect(el.searingTotem.feWindows).toEqual([{ start: 0, end: 40_000 }]);
		expect(el.searingTotem.scoredMs).toBe(160_000);
	});

	/**
	 * The other half of the seed: the slot walk's per-press reads see it too.
	 *
	 * A totem placed at 20s went under an elemental that was standing there, which is the one placement
	 * the priority list forbids outright. Off an empty slot the press read as clean, and the elemental's
	 * window ended at the expiry rather than where the totem took the slot from it.
	 */
	it('charges a totem placed under the recovered elemental as an overlap', () => {
		const el = run(make(200_000, [PREPULL_EXPIRY, e(20_000, 'cast', SEARING_TOTEM, { targetID: BOSS })]));
		expect(el.searingTotem.presses).toEqual([
			{ t: 20_000, remainingMs: null, clipped: false, feOverlap: true, late: false },
		]);
		expect(el.searingTotem.feOverlaps).toBe(1);
		expect(el.searingTotem.feWindows).toEqual([{ start: 0, end: 20_000 }]);
	});

	/** A pull that summoned nothing keeps the slot empty, and the walk is unchanged by the seed. */
	it('leaves the slot empty on a pull with no elemental at all', () => {
		const el = run(make(200_000, [e(40_000, 'cast', SEARING_TOTEM, { targetID: BOSS })]));
		expect(el.fireElemental.prepull).toBe(false);
		expect(el.searingTotem.feWindows).toEqual([]);
		expect(el.searingTotem.scoredMs).toBe(200_000);
	});
});

describe('what the summary is willing to say about the pre-pull', () => {
	const metricOn = (el: Analysis & ElementalAuditResult) => scoreAnalysis(el).sections['fireElemental']?.metrics[0];

	it('gives the pull that had it out at the bell full marks', () => {
		const el = run(make(200_000, [PREPULL_EXPIRY]));
		expect(metricOn(el)).toMatchObject({ key: 'fireElementalPrepull', value: 1, grade: 'good', unmeasurable: false });
	});

	/**
	 * The refusal this metric exists to make, pinned so it cannot be tightened by accident.
	 *
	 * A pull that did not have the elemental out is graded `ok` and never `bad`. `bad` would be the claim
	 * that the player *could* have pressed it, and the log cannot support it: a five-minute cooldown
	 * spent on the attempt before this one leaves nothing in this fight's events, so a wipe recovery and
	 * a player who simply did not bother read identically. Moving the `ok` band to 1 turns every one of
	 * those into a fault and fails here.
	 */
	it('does not call the absence a fault', () => {
		const el = run(make(200_000, []));
		expect(el.fireElemental.prepull).toBe(false);
		expect(metricOn(el)).toMatchObject({ value: 0, grade: 'ok', unmeasurable: false });
		expect(scoreAnalysis(el).sections['fireElemental']?.grade).toBe('ok');
		expect(THRESHOLDS.fireElementalPrepull.ok).toBe(0);
	});

	/**
	 * A pull shorter than the summon's own minute cannot answer the question.
	 *
	 * The inference behind `prepull` is the expiry, and an elemental summoned a second before a 45s pull
	 * would still have been standing at the last event — so "not pre-pulled" and "cannot tell" are the
	 * same event stream, and the second is the truth. The same refusal the pre-pull potion slot makes.
	 */
	it('says nothing at all about a pull too short to leave the expiry behind', () => {
		const el = run(make(45_000, []));
		expect(el.fireElemental.prepull).toBe(false);
		expect(metricOn(el)).toMatchObject({ unmeasurable: true });
	});

	/** And nothing about a pull whose opening minute this player was not in. */
	it('says nothing about the opening of a fight the player joined late', () => {
		const el = run(make(200_000, [], 70_000));
		expect(el.timeline?.contactSegments?.[0]?.[0]).toBe(70_000);
		expect(metricOn(el)).toMatchObject({ unmeasurable: true });
	});

	/**
	 * All three committed pulls, and every one of them is the opposite of what this file first claimed.
	 *
	 * It asserted that neither shaman summoned the elemental at all and that both were therefore graded
	 * `ok` — and so did plan step 24's note, and so did `elementals.test.ts`'s header. All of it was
	 * this bug reading back its own output: the aura declared only 2894, no log applies 2894 as a buff,
	 * so the recovery had nothing to find and every pre-pull in the test set read as an absence. Plan
	 * step 48. Each pull carries one bare `removebuff` of 118291 on the audited player and no apply of
	 * it anywhere, at the millisecond below, and the window recovered from it is `[0, that]`.
	 */
	it.each([
		['phased', 57_259],
		['unbroken', 58_014],
		['cleave', 58_298],
	])('reads the pre-pull summon %s left behind at %d', (name, expiry) => {
		const el = fx(name);
		expect(el.fireElemental.prepull).toBe(true);
		// No press inside the pull: the summon happened before the bell, which is what the window says.
		expect(el.fireElemental.presses).toEqual([]);
		expect(el.searingTotem.feWindows).toEqual([{ start: 0, end: expiry }]);
		expect(metricOn(el)).toMatchObject({ value: 1, grade: 'good', unmeasurable: false });
	});

	/**
	 * The other side of that, and the guard that matters more than the grade.
	 *
	 * Handing the slot walk a longer window than the elemental really held would charge a totem placed
	 * after it as a placement made *under* the elemental — a fault the player did not commit. On the
	 * reported pull the trap is concrete: the elemental's buff came off at 57.204s, its Immolate went on
	 * ticking until 68.361s, and the player placed a Searing Totem at 59.256s. A window drawn to the
	 * last event the pet appears in rather than to the expiry would have invented an overlap there. So
	 * every placement on all three pulls has to sit clear of the recovered window, and the overlap count
	 * has to stay at zero.
	 */
	it.each(['phased', 'unbroken', 'cleave'])('charges %s no overlap for the slot the elemental held', (name) => {
		const el = fx(name);
		const held = el.searingTotem.feWindows[0]!.end;
		expect(el.searingTotem.presses.map((p) => p.t).every((t) => t > held)).toBe(true);
		expect(el.searingTotem.feOverlaps).toBe(0);
	});

	/**
	 * A press the stream witnessed is not a pre-pull, even when its `applybuff` is missing.
	 *
	 * `auraWindows` refuses a recovery once it has seen the aura opened, but that test is per id, and
	 * this aura's press is a different id from its buff — so the cast cannot vouch for the buff. A page
	 * boundary between two events sharing a millisecond is enough to produce this stream, and without
	 * the guard beside the recovery the pull would be credited with a pre-pull summon it actually made
	 * five seconds late, and the elemental's stretch would be drawn from `00:00`.
	 *
	 * **The removal has to land inside the summon's own minute for any of this to be reachable**, and
	 * the first version of this test missed that: it put the press at 10s and the removal at 65s, where
	 * `auraWindows`' own duration bound refuses the recovery whatever the guard does, so dropping the
	 * guard left it green. An elemental that dies early is the shape that gets past the bound — killed
	 * by the fight, or dropped when its owner did — so this is a press at 5s and an expiry at 30s.
	 */
	it('does not read an in-fight press with no applybuff as a pre-pull one', () => {
		const el = run(
			make(200_000, [e(5000, 'cast', FIRE_ELEMENTAL, { targetID: -1 }), e(30_000, 'removebuff', FIRE_ELEMENTAL_BUFF)]),
		);
		expect(el.fireElemental.presses).toEqual([{ t: 5000, reason: 'early' }]);
		expect(el.fireElemental.prepull).toBe(false);
		// The press's own window off the slot walk, and nothing before it.
		expect(el.searingTotem.feWindows).toEqual([{ start: 5000, end: 65_000 }]);
	});
});
