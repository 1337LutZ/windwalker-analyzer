// Elemental Discharge is a per-target damage amp, and the enemy carrying it is whichever one the shock
// hit — not whichever one the player damaged most over the pull.
//
// The metric was read off `primaryID` alone, which is the same array on a single-target pull and a very
// different one on an add wave. `WZPFBcJ6bxXmph9r` fight 17 is the case that found it: a Galakras kill
// where this player's twenty-one Discharge events land on **seven** different enemies and none of them is
// the enemy they damaged most. The debuff they had kept up all fight was invisible to the metric, and the
// uptime came out near nought for a player doing exactly the right thing.
//
// All four committed fixtures are single-target enough that the two readings agree, which is why the
// fault survived them. This is the pull they do not contain: a shaman who opens on the boss and then
// spends the rest of the pull on an add, keeping the debuff on the add.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';

import { analyse } from '../index';

const T0 = 900_000;
const DURATION = 60_000;
const ME = 5;
/** The enemy the player damages most, and therefore the one `primaryID` resolves to. */
const BOSS = 12;
/** The add the player moves to, and the only enemy that ever carries the debuff. */
const ADD = 13;
/** When the player leaves the boss for the add and stays there. */
const SWITCH = 20_000;

const LIGHTNING_SHIELD = 324;
const LIGHTNING_BOLT = 403;
const FLAME_SHOCK = 8050;
const EARTH_SHOCK = 8042;
const ASCENDANCE = 114_049;
const LAVA_BURST = 51_505;
const T16_2PC = 144_999;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

const on = (target: number, t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent =>
	e(t, type, id, { targetID: target, targetInstance: 1, ...extra });

/**
 * Contact throughout, boss then add, with the boss taking the larger share so it stays the primary.
 *
 * Every two seconds, so the engaged clock is the whole pull and `landedHits` hands each hit the stretch
 * until the next — which is the ownership the metric's numerator is clipped by.
 */
const contact: WclEvent[] = Array.from({ length: DURATION / 2000 + 1 }, (_, i) => {
	const t = i * 2000;
	return on(t < SWITCH ? BOSS : ADD, t, 'damage', LIGHTNING_BOLT, { amount: t < SWITCH ? 9000 : 1000, hitType: 1 });
});

const shield: WclEvent[] = [
	e(0, 'applybuff', LIGHTNING_SHIELD),
	...Array.from({ length: 6 }, (_, i) => e(1000 + i * 1000, 'applybuffstack', LIGHTNING_SHIELD, { stack: 2 + i })),
];

/** The dot on whatever the player is standing on, so no dot floor confounds the shock's verdict. */
const dot: WclEvent[] = [
	on(BOSS, 0, 'applydebuff', FLAME_SHOCK),
	on(BOSS, SWITCH, 'removedebuff', FLAME_SHOCK),
	on(ADD, SWITCH, 'applydebuff', FLAME_SHOCK),
	on(ADD, DURATION, 'removedebuff', FLAME_SHOCK),
];

/** Kept up on the add for the whole stretch the player spends on it, and never on the boss. */
const discharge: WclEvent[] = [
	on(ADD, SWITCH + 100, 'applydebuff', T16_2PC),
	on(ADD, SWITCH + 100 + 13_000, 'refreshdebuff', T16_2PC),
	on(ADD, SWITCH + 100 + 26_000, 'refreshdebuff', T16_2PC),
	on(ADD, DURATION, 'removedebuff', T16_2PC),
];

const presses: WclEvent[] = [
	e(1000, 'cast', ASCENDANCE),
	on(BOSS, 3000, 'cast', LAVA_BURST),
	on(ADD, SWITCH + 100, 'cast', EARTH_SHOCK),
	on(ADD, SWITCH + 100 + 13_000, 'cast', EARTH_SHOCK),
	on(ADD, SWITCH + 100 + 26_000, 'cast', EARTH_SHOCK),
];

const fight = {
	id: 1,
	name: 'Galakras',
	encounterID: 1662,
	kill: true,
	difficulty: 4,
	size: 25,
	startTime: T0,
	endTime: T0 + DURATION,
};

const dataset: FightDataset = {
	code: 'ele999',
	fight,
	actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
	actors: [{ id: ME, name: 'Sparkstorm', type: 'Player' }],
	events: [...contact, ...shield, ...dot, ...discharge, ...presses],
	table: {
		fight: {
			...fight,
			enemyNPCs: [
				{ id: BOSS, gameID: 72_249 },
				{ id: ADD, gameID: 72_945 },
			],
		},
		damageDone: {
			entries: [
				{
					name: 'Sparkstorm',
					id: ME,
					type: 'Shaman',
					itemLevel: 553,
					total: 111_000,
					activeTime: DURATION,
					abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 111_000 }],
				},
			],
		},
	},
};

const el = analyse(dataset) as Analysis & ElementalAuditResult;

describe('the debuff on an enemy that is not the primary', () => {
	/** The premise: the boss is the most-damaged enemy and never carries the debuff. */
	it('puts the whole debuff on an enemy the pull does not call primary', () => {
		expect(el.isSpec).toBe(true);
		// Every Discharge event in the log is on the add, and none is on the boss.
		expect(discharge.every((event) => (event as { targetID?: number }).targetID === ADD)).toBe(true);
		// And the boss is the enemy this player damaged most, so it is the one `primaryID` resolves to —
		// which is what made the old primary-scoped walk come back empty.
		const damage = new Map<number, number>();
		for (const hit of contact) {
			const to = (hit as { targetID?: number }).targetID ?? 0;
			damage.set(to, (damage.get(to) ?? 0) + ((hit as { amount?: number }).amount ?? 0));
		}
		expect((damage.get(BOSS) ?? 0) > (damage.get(ADD) ?? 0)).toBe(true);
	});

	/**
	 * The walk that used to find nothing.
	 *
	 * `dotWindowsOnTarget(..., primaryID, ...)` looked only at the boss, which never carries the debuff
	 * here, so the audit saw no two-piece at all: no windows, `twoPieceOwned` false, and a shaman plainly
	 * wearing the set read as one who was not. Walked across every spawn, the add's windows are there.
	 */
	it('sees the debuff the primary never carried', () => {
		expect(el.earthShock.presses.map((p) => p.t)).toEqual([SWITCH + 100, SWITCH + 100 + 13_000, SWITCH + 100 + 26_000]);
		// Every one of these shocks went out inside a window on the add. Under the primary-scoped walk each
		// read false, because the boss had no debuff to be inside.
		expect(el.earthShock.presses.map((p) => p.twoPiece)).toEqual([true, true, true]);
	});

	/**
	 * And the charge inference reads the add's windows too, which is the same primary-scoping bug in the
	 * other reader. Thirteen seconds between applications cannot be bought with fewer than seven charges.
	 */
	it('reads charges off a window on the add', () => {
		expect(el.earthShock.presses[0]?.lsStacks).toBe(7);
	});
});

/**
 * The other half of the fix, on real pulls rather than a synthetic: the numerator is *clipped* to the
 * enemy the player was on, so debuff time on an enemy they had walked away from stops counting.
 *
 * `cleave` is the only committed pull the clipping reaches, and it moves down — the honest direction.
 * The two single-target pulls are the control: with one enemy, "the debuff anywhere" and "the debuff on
 * the enemy I am hitting" are the same array, so neither may move at all.
 */
describe('the committed pulls under the clipped numerator', () => {
	const fx = (name: string): Analysis & ElementalAuditResult =>
		analyse(
			JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset,
		) as Analysis & ElementalAuditResult;

	it('clips cleave and leaves the single-target pulls where they were', () => {
		// 66.27% before the clipping, 65.57% after: the difference is debuff time on an enemy this player
		// was not hitting at the moment, which the amp was not paying out on.
		expect(fx('cleave').earthShock.dischargeUptimePct).toBeCloseTo(65.57, 1);
		expect(fx('phased').earthShock.dischargeUptimePct).toBeCloseTo(65.8, 1);
		expect(fx('unbroken').earthShock.dischargeUptimePct).toBeCloseTo(83.51, 1);
	});

	/** And the pull with no set is still refused rather than scored nought. */
	it('still refuses a pull without the two-piece', () => {
		expect(fx('addsThenBoss').earthShock.dischargeScoredMs).toBe(0);
	});
});
