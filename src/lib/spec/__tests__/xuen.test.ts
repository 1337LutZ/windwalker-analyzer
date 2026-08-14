import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import type { Actor, FightDataset } from '~/lib/types';

import { analyse } from '../windwalker';

// Synthetic throughout rather than fixture-driven. Every committed fixture is a real pull that
// pressed Xuen twice and pressed it on time, so the cases this section exists to separate — a
// summon cut short by the pull ending, a cooldown held long enough to lose one, a Windwalker whose
// other pet must not be mistaken for the tiger — appear in none of them.

const T0 = 100000;
const ME = 5;
const TIGER = 6;
/** A second pet-typed actor. Storm, Earth and Fire is the real case; what matters is that it is not Xuen. */
const SPIRIT = 7;
const BOSS = 20;

const SUMMON = 123904;
/** Crackling Tiger Lightning — the pet's own nuke, and the only id unique to it. */
const NUKE = 123996;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: BOSS,
	...extra,
});

const summon = (t: number): WclEvent => e(t, 'cast', SUMMON, { targetID: ME });
/** Damage from the tiger's own actor, which is how the log reports it: a pet is a separate source. */
const tigerHit = (t: number, amount: number, sourceID = TIGER): WclEvent =>
	e(t, 'damage', NUKE, { sourceID, amount, hitType: 1 });

const ACTORS: Actor[] = [
	{ id: ME, name: 'Bigdogmo', type: 'Player' },
	{ id: TIGER, name: 'Xuen, the White Tiger', type: 'Pet', petOwner: ME },
	{ id: SPIRIT, name: 'Earth Spirit', type: 'Pet', petOwner: ME },
];

const fight = (durationMs: number) => ({
	id: 7,
	name: 'Garrosh Hellscream',
	encounterID: 1623,
	kill: true,
	difficulty: 4,
	size: 10,
	startTime: T0,
	endTime: T0 + durationMs,
});

const dataset = (events: WclEvent[], durationMs = 300000): FightDataset => ({
	code: 'abc123',
	fight: fight(durationMs),
	actor: { id: ME, name: 'Bigdogmo', type: 'Player' },
	actors: ACTORS,
	events,
	table: {
		fight: { ...fight(durationMs), enemyNPCs: [{ id: BOSS, gameID: 71865 }] },
		// No entry for the player, so `activeMs` falls back to the fight length. Nothing here reads it.
		damageDone: { entries: [] },
	},
});

const xuenOf = (events: WclEvent[], durationMs = 300000) => analyse(dataset(events, durationMs)).xuen;

describe('Invoke Xuen', () => {
	/**
	 * 45 seconds per summon, from `sim/monk/talents.go:1075`. Two of them inside a five-minute pull is
	 * 90 of 300 seconds, and the 180s cooldown means two windows can never overlap.
	 */
	it('measures the window forward from the cast, not off an aura', () => {
		const xuen = xuenOf([summon(0), summon(180000)]);

		expect(xuen?.casts).toBe(2);
		expect(xuen?.uptimeMs).toBe(90000);
		expect(xuen?.uptimePct).toBeCloseTo(30);
		expect(xuen?.durationSec).toBe(45);
		expect(xuen?.cooldownSec).toBe(180);
	});

	/**
	 * The tiger cannot be out after the boss is down. Counting the full 45s would claim more uptime
	 * than the pull had room for, which is the one direction this number must never err in.
	 */
	it('clips a summon to the end of the pull and says it did so', () => {
		const xuen = xuenOf([summon(0), summon(280000)]);
		const last = xuen?.uses.at(-1);

		expect(last?.windowMs).toBe(20000);
		expect(last?.truncated).toBe(true);
		expect(xuen?.uses[0]?.truncated).toBe(false);
		expect(xuen?.uptimeMs).toBe(65000);
	});

	/**
	 * The presses the pull allowed come from `cooldownDrift`, so they inherit its two exclusions: the
	 * run-up to the first press is not charged, nor is the tail after the last. Here the cooldown was
	 * ready at 3:00 and unused until 6:40 — one whole extra summon.
	 */
	it('counts the presses the pull had room for from the drift between them', () => {
		const xuen = xuenOf([summon(0), summon(400000)], 600000);

		expect(xuen?.casts).toBe(2);
		expect(xuen?.available).toBe(3);
		expect(xuen?.driftSec).toBe(220);
	});

	/** A cooldown pressed the moment it came back has lost nothing, and must not be told otherwise. */
	it('charges nothing to a pull that pressed it on cooldown', () => {
		const xuen = xuenOf([summon(0), summon(180000)]);

		expect(xuen?.available).toBe(2);
		expect(xuen?.driftSec).toBe(0);
	});

	it('attributes the pet damage inside each summon to that summon', () => {
		const xuen = xuenOf([
			summon(0),
			tigerHit(10000, 30000),
			tigerHit(20000, 20000),
			summon(180000),
			tigerHit(200000, 40000),
			// Player damage under the player's own id: the tiger's total must not swallow the monk's.
			e(50000, 'damage', 107428, { amount: 999999, hitType: 1 }),
		]);

		expect(xuen?.petDamage).toBe(90000);
		expect(xuen?.uses[0]?.damage).toBe(50000);
		expect(xuen?.uses[0]?.hits).toBe(2);
		expect(xuen?.uses[1]?.damage).toBe(40000);
	});

	/**
	 * The guard the whole attribution turns on. A Windwalker fields more than one pet-typed actor, and
	 * `petOwner` alone cannot tell them apart — only Crackling Tiger Lightning can. A spirit's damage
	 * still counts towards the player's total, as it always did; it is just not the tiger's.
	 */
	it("does not read another pet's damage as the tiger's", () => {
		const xuen = xuenOf([
			summon(0),
			tigerHit(10000, 30000),
			e(12000, 'damage', 1, { sourceID: SPIRIT, amount: 77777 }),
		]);

		expect(xuen?.petDamage).toBe(30000);
		expect(xuen?.uses[0]?.hits).toBe(1);
	});

	/**
	 * If the nuke ever arrived under the monk's own id, taking that id as the pet's actor would report
	 * the entire pull's damage as the tiger's. Better to claim none than to claim all of it.
	 */
	it('claims no pet damage rather than the player’s own when the nuke is not a pet’s', () => {
		const xuen = xuenOf([summon(0), tigerHit(10000, 30000, ME), e(12000, 'damage', 1, { amount: 500000 })]);

		expect(xuen?.petDamage).toBe(0);
		expect(xuen?.uses[0]?.damage).toBe(0);
	});

	/**
	 * Invoke Xuen is a tier-90 talent, and a log cannot tell "took a different talent" from "never
	 * pressed it". Reporting a shortfall would invent a fault out of the first.
	 */
	it('reports no shortfall for a pull that never summoned at all', () => {
		const xuen = xuenOf([e(1000, 'damage', 107428, { amount: 50000, hitType: 1 })]);

		expect(xuen?.casts).toBe(0);
		expect(xuen?.available).toBe(0);
		expect(xuen?.uptimeMs).toBe(0);
		expect(xuen?.uses).toEqual([]);
	});
});
