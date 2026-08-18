import { describe, expect, it } from 'vitest';
import type { WclEvent } from '~/lib/events';
import { DEFAULT_SETTINGS, TIGER_PALM_REFRESH } from '~/lib/settings';
import type { FightDataset } from '~/lib/types';
import {
	abilityCooldownMs,
	analyse,
	energizingBrewPressable,
	ignoredMultiTargetActorIDs,
	registry,
} from '../windwalker';

const T0 = 100000;
const END = T0 + 120000;
const ME = 5;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

const events: WclEvent[] = [
	// bank fills, then a full drain 1ms before the brew cast, inside a Rune proc
	e(0, 'applybuff', 1247279),
	e(1000, 'applybuffstack', 1247279, { stack: 10 }),
	e(20000, 'applybuff', 139120),
	e(29999, 'removebuffstack', 1247279, { stack: 0 }),
	e(30000, 'cast', 1247275),
	e(30000, 'applybuff', 1247275),
	e(30000, 'removebuff', 139120),
	e(45000, 'removebuff', 1247275),
	// Rising Sun Kick on the boss
	e(1000, 'cast', 107428, { targetID: 20 }),
	e(1000, 'applydebuff', 130320, { targetID: 20 }),
	e(16000, 'removedebuff', 130320, { targetID: 20 }),
	e(1000, 'damage', 107428, { targetID: 20, amount: 50000, hitType: 2 }),
	e(60000, 'damage', 1, { targetID: 20, amount: 10000, hitType: 1 }),
	// Fists of Fury: one channel, four ticks
	e(10000, 'cast', 113656, { targetID: 20 }),
	e(10000, 'cast', 117418, { targetID: 20 }),
	e(11000, 'cast', 117418, { targetID: 20 }),
	e(12000, 'cast', 117418, { targetID: 20 }),
	e(13000, 'cast', 117418, { targetID: 20 }),
	e(11000, 'damage', 117418, { targetID: 20, amount: 20000, hitType: 1 }),
	// Tiger Palm: one refresh (Tiger Power about to drop), one wasted press
	e(2000, 'applybuff', 125359),
	e(21900, 'cast', 100787, { targetID: 20 }),
	e(21901, 'refreshbuff', 125359),
	e(25000, 'cast', 100787, { targetID: 20 }),
	e(25001, 'refreshbuff', 125359),
	// Jab, once under each of its two weapon ids
	e(40000, 'cast', 115687, { targetID: 20 }),
	e(41500, 'cast', 115695, { targetID: 20 }),
];

const dataset: FightDataset = {
	code: 'abc123',
	fight: {
		id: 7,
		name: 'Garrosh Hellscream',
		encounterID: 1623,
		kill: true,
		difficulty: 4,
		size: 10,
		startTime: T0,
		endTime: END,
	},
	actor: { id: ME, name: 'Bigdogmo', type: 'Player' },
	actors: [{ id: ME, name: 'Bigdogmo', type: 'Player' }],
	events,
	table: {
		fight: {
			id: 7,
			name: 'Garrosh Hellscream',
			encounterID: 1623,
			kill: true,
			difficulty: 4,
			size: 10,
			startTime: T0,
			endTime: END,
			enemyNPCs: [{ id: 20, gameID: 71865 }],
		},
		damageDone: {
			entries: [
				{
					name: 'Bigdogmo',
					id: ME,
					type: 'Monk',
					itemLevel: 553,
					total: 80000,
					activeTime: 100000,
					abilities: [{ guid: 107428, name: 'Rising Sun Kick', total: 50000 }],
				},
			],
		},
	},
};

describe('the Windwalker registry', () => {
	it('refuses to read a channel tick as a press', () => {
		expect(registry.isChannelTick(117418)).toBe(true);
		expect(registry.abilityByCastId(117418)).toBeUndefined();
		expect(registry.abilityByDamageId(117418)?.key).toBe('fists-of-fury');
	});

	it("resolves both of Jab's weapon ids to one button", () => {
		expect(registry.abilityByCastId(115687)?.key).toBe('jab');
		expect(registry.abilityByCastId(115695)?.key).toBe('jab');
	});

	it('reads the stat a Re-Origination id encodes', () => {
		expect(registry.variantOf(139117)).toBe('Crit');
		expect(registry.variantOf(139120)).toBe('Mastery');
		expect(registry.variantOf(139121)).toBe('Haste');
	});

	it('carries the relationships that used to live in constant names', () => {
		expect(registry.appliedBy('rising-sun-kick').map((a) => a.key)).toEqual(['rising-sun-kick-debuff']);
		expect(registry.appliedBy('tiger-palm').map((a) => a.key)).toEqual(['tiger-power']);
		expect(registry.consumedBy('tiger-palm').map((a) => a.key)).toEqual(['combo-breaker-tiger-palm']);
		expect(registry.consumedBy('blackout-kick').map((a) => a.key)).toEqual(['combo-breaker-blackout-kick']);
		expect(registry.aura('tigereye-brew-bank').maxStacks).toBe(20);
		expect(registry.aura('tigereye-brew').refreshRestarts).toBe(true);
	});

	it('derives the shared cooldowns from the ability definitions', () => {
		expect(abilityCooldownMs('rising-sun-kick')).toBe(8000);
		expect(abilityCooldownMs('rushing-jade-wind')).toBe(6000);
		expect(abilityCooldownMs('energizing-brew')).toBe(60000);
	});

	it('finds the ability behind a damage id that is not its cast id', () => {
		expect(registry.abilityByDamageId(128531)?.key).toBe('blackout-kick');
		expect(registry.abilityByDamageId(148187)?.key).toBe('rushing-jade-wind');
		// Autoattacks are claimed by nothing, which is what marks their damage passive.
		expect(registry.abilityByDamageId(1)).toBeUndefined();
	});
});

/**
 * A chance that never existed is not a chance declined, and this is the button that was getting away
 * without it: the Bloodlust pairing card read `hasteWindows.length > 0` and never asked the cooldown.
 */
describe('whether Energizing Brew could have been pressed at all', () => {
	it('refuses a window the brew was still on cooldown for', () => {
		// The Galakras kill in `a:6MhZgjyAknFWrYfK`, to the millisecond. The brew goes at 6:11.7, Primal
		// Rage opens 2.6 seconds later and closes forty seconds after that, and the 60-second cooldown
		// does not return until seventeen seconds past the end of the window. The card said "Missed".
		expect(energizingBrewPressable({ start: 374_300, end: 414_298 }, [{ t: 371_714 }])).toBe(false);
	});

	it('accepts a window the cooldown returns inside', () => {
		expect(energizingBrewPressable({ start: 374_300, end: 414_298 }, [{ t: 340_000 }])).toBe(true);
	});

	/** A use inside the window is its own proof that the button was there to press. */
	it('accepts a window the brew was actually used in', () => {
		expect(energizingBrewPressable({ start: 0, end: 40_000 }, [{ t: 8199 }, { t: 69_227 }])).toBe(true);
	});

	/**
	 * No use before the window means ready from the pull. The log cannot see a pre-pull press, and
	 * inventing one would take this back to refusing chances that did exist.
	 */
	it('treats a brew never pressed before the window as ready from the pull', () => {
		expect(energizingBrewPressable({ start: 88, end: 40_074 }, [{ t: 63_954 }])).toBe(true);
	});
});

/**
 * The ignore list resolved once, for both readers of it. `analyse` used to inline this filter beside
 * the target count, and the damage table's fan-out never got a copy — see `analysis/damage.test.ts`.
 */
describe('the ignored multi-target actors', () => {
	const npcs = [
		{ id: 40, gameID: 71591 },
		{ id: 41, gameID: 71591 },
		{ id: 42, gameID: 71504 },
	];

	it('resolves the listed NPC to every actor id carrying its game id', () => {
		expect([...ignoredMultiTargetActorIDs(51601, npcs)]).toEqual([40, 41]);
	});

	it('ignores nothing on an encounter the list does not name', () => {
		expect(ignoredMultiTargetActorIDs(51600, npcs).size).toBe(0);
		expect(ignoredMultiTargetActorIDs(undefined, npcs).size).toBe(0);
		expect(ignoredMultiTargetActorIDs(51601, undefined).size).toBe(0);
	});
});

describe('analyse', () => {
	const a = analyse(dataset);

	it('recognises the spec from the brew bank', () => {
		expect(a.isSpec).toBe(true);
	});

	it('reads the full drain off the removal even though it precedes the cast', () => {
		expect(a.brew.uses).toBe(1);
		expect(a.brew.totalConsumed).toBe(10);
		expect(a.brew.fullUses).toBe(1);
	});

	it('grades the snapshot by the proc left at the cast', () => {
		expect(a.procs.procs).toBe(1);
		expect(a.procs.windows[0]?.stat).toBe('Mastery');
		expect(a.procs.windows[0]?.grade).toBe('last-gcd');
		expect(a.procs.secondsGivenAway).toBe(0);
	});

	it('measures the channel from the tick stream', () => {
		expect(a.channel.casts).toBe(1);
		expect(a.channel.channelSec).toBe(4);
		expect(a.casts.find((c) => c.id === 113656)?.count).toBe(1);
	});

	it('merges the two Jab ids into one row', () => {
		const jab = a.casts.filter((c) => c.name === 'Jab');
		expect(jab).toHaveLength(1);
		expect(jab[0]?.count).toBe(2);
		// Energy, not chi. Jab pays 40 energy and hands back 2 chi, so it is the generator the chi
		// spenders run on; gating it on chi described the economy backwards.
		expect(jab[0]?.gate).toBe('energy');
	});

	it('separates damage that was pressed from damage that was worn', () => {
		const melee = a.damage.abilities.find((d) => d.id === 1);
		expect(melee?.name).toBe('Melee');
		expect(melee?.passive).toBe(true);
		// The tick id belongs to the channel, so its damage is credited to a button that was pressed.
		const fof = a.damage.abilities.find((d) => d.id === 117418);
		expect(fof?.name).toBe('Fists of Fury');
		expect(fof?.passive).toBe(false);
	});

	it('ignores the buff a cast applied to itself when auditing Tiger Palm', () => {
		expect(a.filler.casts).toBe(2);
		expect(a.filler.refresh).toBe(1);
		expect(a.filler.wasted).toBe(1);
	});

	/**
	 * The window is the reader's, not the APL's. A press with 1.5s of Tiger Power left is a refresh
	 * under the report's default and a clipped buff under the sim's `auraRemainingTime <= 1s`, and
	 * both readings have to be available or the setting is decoration.
	 */
	it('reads the Tiger Palm refresh window from the settings', () => {
		const late: FightDataset = {
			...dataset,
			events: [...events, e(20500, 'cast', 100787, { targetID: 20 }), e(20501, 'refreshbuff', 125359)],
		};
		const reasonAt = (ms: number): string | undefined =>
			analyse(late, { ...DEFAULT_SETTINGS, tigerPalmRefreshMs: ms }).filler.castList.find((c) => c.t === 20500)?.reason;

		expect(reasonAt(TIGER_PALM_REFRESH.default)).toBe('refresh');
		expect(reasonAt(TIGER_PALM_REFRESH.min)).toBe('wasted');
		// And the number the report prints follows the setting, or the section would explain itself
		// against a threshold it did not use.
		expect(analyse(late, { ...DEFAULT_SETTINGS, tigerPalmRefreshMs: 3000 }).filler.refreshWindowSec).toBe(3);
	});

	it('links every miss back into the report', () => {
		expect(a.misses.length).toBeGreaterThan(0);
		expect(a.misses[0]?.link).toContain(
			'https://classic.warcraftlogs.com/reports/abc123#fight=7&type=damage-done&view=events&source=5',
		);
	});
});
