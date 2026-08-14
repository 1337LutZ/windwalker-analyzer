// The player's own deaths, off the event stream the report already fetched.
//
// Synthetic events rather than a fixture, for the reason the Rising Sun Kick suite gives: all three
// committed fixtures are clean single-target pulls and (as far as anything here can tell) nobody
// dies in them, so the case this exists for does not appear in any of them.
//
// The shape asserted here is the one a live anonymous report returned. A death event carries
// `sourceID: -1` — the game credits the kill to nobody — and names the victim in `targetID`, and
// WarcraftLogs hands it back for a `sourceID` filter that matches the victim all the same. That is
// why these arrive without a second query, and why filtering on the field whose name suggests it
// would drop every one of them.

import { describe, expect, it } from 'vitest';

import type { Actor, FightDataset, WclEvent } from '~/lib/types';

import { analyse } from '../windwalker';

const T0 = 100_000;
const END = T0 + 120_000;
const ME = 5;
const SOMEONE_ELSE = 6;
const BOSS = 20;

/** The one on the report's damage table below, so the name resolver has something to answer with. */
const NAMED_KILLER = 146_743;
/** In no table and in no residual list: the id every fallback here is about. */
const UNKNOWN_KILLER = 143_919;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

/**
 * A death, in the shape WarcraftLogs sends one: no `abilityGameID` at all, the killer in `sourceID`
 * or `-1`, and the victim in `targetID`.
 */
const death = (t: number, victim: number, killingAbilityGameID?: number): WclEvent => ({
	timestamp: T0 + t,
	type: 'death',
	sourceID: -1,
	targetID: victim,
	killerID: 228,
	...(killingAbilityGameID === undefined ? {} : { killingAbilityGameID }),
});

const actors: Actor[] = [
	{ id: ME, name: 'Bigdogmo', type: 'Player' },
	{ id: SOMEONE_ELSE, name: 'Someoneelse', type: 'Player' },
	{ id: BOSS, name: 'Garrosh Hellscream', type: 'NPC' },
];

/** The tell that this player was Windwalker at all; without it `analyse` refuses the spec. */
const brewBank: WclEvent[] = [e(0, 'applybuff', 1_247_279), e(500, 'applybuffstack', 1_247_279, { stack: 10 })];

const datasetOf = (events: WclEvent[]): FightDataset => ({
	code: 'abc123',
	fight: {
		id: 7,
		name: 'Garrosh Hellscream',
		encounterID: 1623,
		kill: false,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: END,
	},
	actor: { id: ME, name: 'Bigdogmo', type: 'Player' },
	actors,
	events,
	table: {
		fight: {
			id: 7,
			name: 'Garrosh Hellscream',
			encounterID: 1623,
			kill: false,
			difficulty: 4,
			size: 25,
			startTime: T0,
			endTime: END,
			enemyNPCs: [{ id: BOSS, gameID: 71_865 }],
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
					abilities: [
						{ guid: 107_428, name: 'Rising Sun Kick', total: 1_000_000 },
						// The report's own name table, which is the only thing on a fight payload that can name
						// a spell id. A boss ability usually is not in it — the table is damage *done* — which is
						// exactly why the fallback below matters as much as the resolution does.
						{ guid: NAMED_KILLER, name: 'Iron Star', total: 0 },
					],
				},
			],
		},
	},
});

const deathsIn = (events: WclEvent[]) => analyse(datasetOf([...brewBank, ...events])).timeline?.deaths ?? [];

describe('the player’s deaths', () => {
	it('are carried on the timeline, on the pull’s own clock', () => {
		const deaths = deathsIn([death(30_000, ME, NAMED_KILLER)]);
		expect(deaths).toHaveLength(1);
		expect(deaths[0]?.t).toBe(30_000);
	});

	/**
	 * The filter that has to be on `targetID`. A death names the victim there and credits the kill to
	 * `sourceID`, so filtering the way the field is named would keep every death in the raid and none
	 * of the player's own.
	 */
	it('are only the player’s, whoever else died on the pull', () => {
		const deaths = deathsIn([death(10_000, SOMEONE_ELSE, NAMED_KILLER), death(20_000, ME, NAMED_KILLER)]);
		expect(deaths.map((d) => d.t)).toEqual([20_000]);
	});

	it('come back in time order', () => {
		const deaths = deathsIn([death(60_000, ME, NAMED_KILLER), death(20_000, ME, NAMED_KILLER)]);
		expect(deaths.map((d) => d.t)).toEqual([20_000, 60_000]);
	});

	/** The marker names what killed them, resolved through the same table every other id goes through. */
	it('name the killing blow when the report can name it', () => {
		expect(deathsIn([death(30_000, ME, NAMED_KILLER)])[0]).toEqual({
			t: 30_000,
			abilityId: NAMED_KILLER,
			ability: 'Iron Star',
		});
	});

	/**
	 * `#<id>` is this report's standing answer for a spell id nothing answers for — the cast table and
	 * the damage table both print it — and it is the honest one. A plausible-looking name here would be
	 * some other boss's ability.
	 */
	it('fall back to the id rather than inventing a name for it', () => {
		expect(deathsIn([death(30_000, ME, UNKNOWN_KILLER)])[0]?.ability).toBe(`#${UNKNOWN_KILLER}`);
	});

	/**
	 * Zero is the log saying nothing with a spell id did it — a fall, an enrage, the raid wiping — and
	 * resolving it would ask the icon map for spell 0 and the name table for `#0`. Both halves come
	 * back null so the chart can say so in its own words.
	 */
	it('carry no ability at all when the log named none', () => {
		expect(deathsIn([death(30_000, ME, 0)])[0]).toEqual({ t: 30_000, abilityId: null, ability: null });
		expect(deathsIn([death(30_000, ME)])[0]).toEqual({ t: 30_000, abilityId: null, ability: null });
	});

	/** The common case, and it has to be an empty list rather than an absent field. */
	it('are an empty list on a pull nobody died on', () => {
		expect(deathsIn([])).toEqual([]);
	});
});
