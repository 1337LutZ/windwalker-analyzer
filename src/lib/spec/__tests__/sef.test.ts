// Storm, Earth and Fire.
//
// Synthetic events rather than a fixture, for the reason the Rising Sun Kick lane suite gives: every
// committed fixture is a single-target pull, and this cooldown is only ever pressed on the fights
// none of them are. The three reference pulls the report was built against — Garrosh, Iron
// Juggernaut and Malkorok — contain no press of it at all.
//
// The cases that matter are the ones where the report could invent something. A spirit sharing the
// player's target is the fault this section exists to name, so the test that must not be removed is
// the one where the player stays off the spirit's enemy and the answer comes back zero — and beside
// it, the one where the spirits left no actor to follow and the answer comes back null rather than
// zero. "You never doubled up" and "this cannot be measured" are different sentences, and only one
// of them is true on a log that carried no pet.

import { describe, expect, it } from 'vitest';

import type { Actor, FightDataset, WclEvent } from '~/lib/types';

import { SEF_SECOND_TARGET_MS, analyse } from '../windwalker';

const T0 = 100_000;
const END = T0 + 120_000;
const ME = 5;
/** The spirits' actor. In a real report they are `Pet` rows owned by the monk; here, one of them. */
const SPIRIT = 6;
/** Xuen's actor, which must never be mistaken for a spirit — it is a pet of the monk too. */
const TIGER = 7;
const BOSS = 20;
const ADD = 21;

/** The press and the aura share this id. 138228 is the simulator's and appears in no Classic log. */
const SEF_ID = 137_639;
const SIM_SEF_ID = 138_228;
const XUEN_NUKE = 123_996;
const MELEE = 1;
const BLACKOUT_KICK = 100_784;
/** Rushing Jade Wind: an area effect, so it must not be read as evidence of where anyone stood. */
const RJW = 148_187;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

/** A hit landing on `target`, from `source`. */
const hit = (t: number, source: number, target: number, id = MELEE): WclEvent =>
	e(t, 'damage', id, { sourceID: source, targetID: target, amount: 1000, hitType: 1 });

/** A run of hits on one enemy, one a second, which is what "the player was stood here" looks like. */
const stand = (from: number, to: number, source: number, target: number, id = MELEE): WclEvent[] =>
	Array.from({ length: Math.max(0, Math.floor((to - from) / 1000)) }, (_, i) =>
		hit(from + i * 1000, source, target, id),
	);

/** A press, and the spirit window it opens: the cast, then the aura the log carries while it is out. */
const sefWindow = (from: number, to: number, target: number): WclEvent[] => [
	e(from, 'cast', SEF_ID, { targetID: target }),
	e(from, 'applybuff', SEF_ID),
	e(to, 'removebuff', SEF_ID),
];

const actors: Actor[] = [
	{ id: ME, name: 'Bigdogmo', type: 'Player' },
	{ id: SPIRIT, name: 'Storm Spirit', type: 'Pet', petOwner: ME },
	{ id: TIGER, name: 'Xuen', type: 'Pet', petOwner: ME },
	{ id: BOSS, name: 'Galakras', type: 'NPC', subType: 'Boss' },
	{ id: ADD, name: "Kor'kron Demolisher", type: 'NPC' },
];

const datasetOf = (events: WclEvent[], roster: Actor[] = actors): FightDataset => ({
	code: 'abc123',
	fight: {
		id: 7,
		name: 'Galakras',
		encounterID: 1620,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: END,
	},
	actor: { id: ME, name: 'Bigdogmo', type: 'Player' },
	actors: roster,
	events,
	table: {
		fight: {
			id: 7,
			name: 'Galakras',
			encounterID: 1620,
			kill: true,
			difficulty: 4,
			size: 25,
			startTime: T0,
			endTime: END,
			enemyNPCs: [BOSS, ADD].map((id) => ({ id, gameID: 70_000 + id })),
		},
		damageDone: {
			entries: [
				{
					name: 'Bigdogmo',
					id: ME,
					type: 'Monk',
					itemLevel: 553,
					total: 1_000_000,
					activeTime: 110_000,
					abilities: [{ guid: MELEE, name: 'Melee', total: 1_000_000 }],
				},
			],
		},
	},
});

/** The tell that this player was Windwalker at all; without it `analyse` refuses the spec. */
const brewBank: WclEvent[] = [e(0, 'applybuff', 1_247_279), e(500, 'applybuffstack', 1_247_279, { stack: 10 })];

/**
 * The failure the section exists to name: the player leaves the boss and walks onto the add their
 * own spirit is already standing on.
 *
 * The spirit holds the add for the whole 40s window. The player spends the first twenty seconds on
 * the boss and the second twenty on the add, so exactly half of the window is doubled up.
 *
 * The Rushing Jade Wind ticks on top are not decoration. `targetCounts` — which is what decides
 * whether the press was called for — reads *every* hit the player landed, so a monk who walks from
 * one enemy to the next and single-targets each of them in turn genuinely reads as one target at a
 * time: the count only rises where two enemies fall inside the same five seconds. What puts a real
 * add pull above the line is the cleave, and this is what that looks like. The ticks say nothing
 * about the overlap below, because an area effect is not evidence of where anyone stood.
 */
const doubledUp: WclEvent[] = [
	...brewBank,
	...sefWindow(10_000, 50_000, ADD),
	...stand(12_000, 50_000, SPIRIT, ADD),
	...stand(10_000, 30_000, ME, BOSS),
	...stand(30_000, 50_000, ME, ADD),
	...stand(10_000, 50_000, ME, BOSS, RJW),
	...stand(10_000, 50_000, ME, ADD, RJW),
	// Enough contact after the window to keep the pull looking like a pull rather than 40 seconds.
	...stand(50_000, 110_000, ME, BOSS),
];

/** The same pull played correctly: the player stays on the boss the whole time the spirit is out. */
const spread: WclEvent[] = [
	...brewBank,
	...sefWindow(10_000, 50_000, ADD),
	...stand(12_000, 50_000, SPIRIT, ADD),
	...stand(10_000, 110_000, ME, BOSS),
];

describe('the spell ids', () => {
	/**
	 * The whole reason this section had to be rebuilt. wowsims registers both the spell and its aura
	 * under 138228 and the Windwalker APL casts that id, so it is the obvious constant to copy — and it
	 * appears nowhere in a Mists Classic log. A pull whose every press logs under the sim's id has to
	 * come back with no presses at all, because that is what such a log would really mean.
	 */
	it('reads the press under 137639 and never under the simulator’s 138228', () => {
		const real = analyse(datasetOf(doubledUp));
		expect(real.sef?.casts).toBe(1);

		const simIds = doubledUp.map((ev) => (ev.abilityGameID === SEF_ID ? { ...ev, abilityGameID: SIM_SEF_ID } : ev));
		expect(analyse(datasetOf(simIds)).sef?.casts).toBe(0);
	});

	/** The press carries the enemy the spirit was sent to, and the report names it from the roster. */
	it('carries the enemy each press was aimed at', () => {
		const { sef } = analyse(datasetOf(doubledUp));
		expect(sef?.uses).toHaveLength(1);
		expect(sef?.uses[0]?.target).toBe(ADD);
		expect(sef?.uses[0]?.name).toBe("Kor'kron Demolisher");
	});

	/** The window is the aura's own, never a duration measured forward from the press. */
	it('takes the window from the aura rather than from the cast', () => {
		const { sef } = analyse(datasetOf(doubledUp));
		expect(sef?.windows).toEqual([{ start: 10_000, end: 50_000 }]);
		expect(sef?.uptimeMs).toBe(40_000);
	});
});

describe('the spirits', () => {
	/**
	 * The spirits arrive in the fetched stream as pets of the monk, which is the same route Xuen's
	 * damage already takes — so the tiger has to be kept out of their damage by name of the one spell
	 * only it casts, not by being a pet.
	 */
	it('counts the spirits’ damage and not the tiger’s', () => {
		const withTiger = [
			...doubledUp,
			e(60_000, 'cast', 123_904),
			hit(61_000, TIGER, BOSS, XUEN_NUKE),
			hit(62_000, TIGER, BOSS),
		];
		const { sef } = analyse(datasetOf(withTiger));
		expect(sef?.clones).toBe(1);
		// 38 swings of 1000 from the spirit, and nothing from the tiger.
		expect(sef?.cloneDamage).toBe(38_000);
	});

	/**
	 * A pull whose spirits left no actor behind cannot be asked whether the player doubled up, and the
	 * answer to that is null — not zero. Zero would read as "you never shared a target", which is a
	 * compliment the log did not pay.
	 */
	it('says it cannot tell when the spirits left no actor', () => {
		const noPet = doubledUp.filter((ev) => ev.sourceID !== SPIRIT);
		const { sef } = analyse(datasetOf(noPet));
		expect(sef?.casts).toBe(1);
		expect(sef?.clones).toBe(0);
		expect(sef?.overlapMs).toBeNull();
		expect(sef?.overlapPct).toBeNull();
	});
});

describe('the same-target overlap', () => {
	it('measures the time the player stood on an enemy their own spirit was on', () => {
		const { sef } = analyse(datasetOf(doubledUp));
		// The player's hits on the add run 30s→49s and each owns the second until the next; the last one
		// owns the rest of the window. So the doubled-up stretch is 30s to the window's close at 50s.
		expect(sef?.overlapMs).toBe(20_000);
		expect(sef?.overlaps.map((o) => o.target)).toEqual([ADD]);
		expect(sef?.overlaps[0]?.name).toBe("Kor'kron Demolisher");
	});

	/** Against the time the player was demonstrably on something with the spirits out, not the window. */
	it('takes its share against the player’s own contact time', () => {
		const { sef } = analyse(datasetOf(doubledUp));
		expect(sef?.measuredMs).toBe(40_000);
		expect(sef?.overlapPct).toBeCloseTo(50, 5);
	});

	/** Played correctly, the answer is zero — and zero is only ever printed when it was measured. */
	it('reports nothing when the player stayed off the spirit’s enemy', () => {
		const { sef } = analyse(datasetOf(spread));
		expect(sef?.overlapMs).toBe(0);
		expect(sef?.overlaps).toEqual([]);
	});

	/**
	 * The trap that would have made this metric fire on every add fight. Rushing Jade Wind hits every
	 * enemy in range, so if area damage counted as evidence of where an actor stood, a player and a
	 * spirit both spinning would share every target in the room. Only the five single-target ids count.
	 */
	it('never reads an area effect as standing on an enemy', () => {
		const spinning = [
			...spread,
			// Both of them spinning, both ticking on both enemies, right through the spirit's window.
			...stand(12_000, 50_000, ME, ADD, RJW),
			...stand(12_000, 50_000, SPIRIT, BOSS, RJW),
		];
		expect(analyse(datasetOf(spinning)).sef?.overlapMs).toBe(0);
	});

	/** A damage-over-time tick keeps landing on an enemy the actor walked away from, so it is not contact. */
	it('never reads a tick as standing on an enemy', () => {
		const ticking = [...spread, ...stand(12_000, 50_000, ME, ADD, BLACKOUT_KICK).map((ev) => ({ ...ev, tick: true }))];
		expect(analyse(datasetOf(ticking)).sef?.overlapMs).toBe(0);
	});
});

describe('whether the press was called for', () => {
	/**
	 * The reader's rule, as a measurement: a stretch of two or more enemies lasting longer than
	 * `SEF_SECOND_TARGET_MS`. On this pull the player is on the add for twenty seconds with the boss
	 * still inside the five-second counting window, which is comfortably over it.
	 */
	it('calls a sustained second target justification', () => {
		const { sef } = analyse(datasetOf(doubledUp));
		expect(sef?.justified).toBe(true);
		expect(sef?.longestSecondTargetMs).toBeGreaterThan(SEF_SECOND_TARGET_MS);
		expect(sef?.secondTargetMs).toBe(SEF_SECOND_TARGET_MS);
	});

	/**
	 * A momentary second target is not a second target. One stray swing at the add puts the count at
	 * two for the five seconds of the counting window and no longer, which is under the rule — so a
	 * pull that pressed the button here is told the pull did not call for it, and a pull that did not
	 * press it is told nothing at all.
	 */
	it('refuses a momentary second target', () => {
		const glance = [...brewBank, ...stand(0, 110_000, ME, BOSS), hit(40_000, ME, ADD)];
		const { sef } = analyse(datasetOf(glance));
		expect(sef?.justified).toBe(false);
		expect(sef?.longestSecondTargetMs).toBeLessThanOrEqual(SEF_SECOND_TARGET_MS);
		expect(sef?.justifiedMs).toBe(0);
	});

	/** A pull that never pressed it and never needed to is the ordinary single-target case. */
	it('says a single-target pull neither pressed it nor needed it', () => {
		const { sef } = analyse(datasetOf([...brewBank, ...stand(0, 110_000, ME, BOSS)]));
		expect(sef?.casts).toBe(0);
		expect(sef?.justified).toBe(false);
		expect(sef?.uptimeMs).toBe(0);
	});
});
