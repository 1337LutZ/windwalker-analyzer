// A pull can begin with Lightning Shield already stacked, and the log does not say so.
//
// `auraLevels` builds the shield's count out of the log's own stack events, so charges built before the
// pull are invisible: on `XJ83wN9h1GQqP4tY` fight 16 the first Lightning Shield event of the fight is a
// `removebuffstack` to 1 at 21 815ms with nothing in front of it. The seven charges that shock spent were
// bought before the pull started, the press read two, and the report told a player who had played it
// perfectly that they had unloaded the shield at two stacks.
//
// The tier-16 debuff knows what the shield does not. Fulmination applies Elemental Discharge for two
// seconds per charge consumed, so the window's length *is* the count — that same log applies it at 21 869
// and refreshes at 35 135, a span of 13 266ms that cannot be bought with fewer than seven charges.
//
// **A fallback and not a replacement, which is the whole of what makes inferring a number defensible.**
// It is `Math.max` against the shield's own reading, so it can only raise a count the log under-states;
// and it is gated on the set, so a shaman without the two-piece is read exactly as they were. Both halves
// are asserted here, and the no-set control is the more important of the two.
//
// Synthetic rather than captured: the fixture directory carries no pull with a pre-stacked shield, and a
// named player's log is not something this repository stores.
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';

import { analyse } from '../index';

const T0 = 900_000;
const DURATION = 60_000;
const ME = 5;
const BOSS = 12;

const LIGHTNING_SHIELD = 324;
const LIGHTNING_BOLT = 403;
const FLAME_SHOCK = 8050;
const EARTH_SHOCK = 8042;
const ASCENDANCE = 114_049;
const LAVA_BURST = 51_505;
const T16_2PC = 144_999;
const TICK_MS = 1500;

/** The two shocks, and the second is the one that refreshes what the first put up. */
const FIRST = 20_000;
const SECOND = 33_266;
/** 13 266ms, the span the real log carries between an application and its refresh. */
const SPAN = SECOND + 50 - (FIRST + 50);

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

const onBoss = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent =>
	e(t, type, id, { targetID: BOSS, targetInstance: 1, ...extra });

const contact: WclEvent[] = Array.from({ length: DURATION / 2000 + 1 }, (_, i) =>
	onBoss(i * 2000, 'damage', LIGHTNING_BOLT, { amount: 1000, hitType: 1 }),
);

/**
 * The shield as a log that began mid-stack carries it: a fall to one charge at the shock, and nothing
 * whatsoever before it. This is the shape the whole file is about.
 */
const shield: WclEvent[] = [
	e(FIRST, 'removebuffstack', LIGHTNING_SHIELD, { stack: 1 }),
	...Array.from({ length: 6 }, (_, i) =>
		e(FIRST + 1000 + i * 1000, 'applybuffstack', LIGHTNING_SHIELD, { stack: 2 + i }),
	),
	e(SECOND, 'removebuffstack', LIGHTNING_SHIELD, { stack: 1 }),
];

/** The dot up throughout, so neither branch's dot floor can confound the shield reading. */
const dot: WclEvent[] = [
	onBoss(0, 'applydebuff', FLAME_SHOCK),
	...Array.from({ length: 45_000 / TICK_MS - 1 }, (_, i) =>
		onBoss((i + 1) * TICK_MS, 'damage', FLAME_SHOCK, { tick: true, amount: 1000, unmitigatedAmount: 900, hitType: 1 }),
	),
	onBoss(45_000, 'removedebuff', FLAME_SHOCK),
];

/** Applied by the first shock, refreshed by the second, and removed a full seven charges later. */
const discharge: WclEvent[] = [
	onBoss(FIRST + 50, 'applydebuff', T16_2PC),
	onBoss(SECOND + 50, 'refreshdebuff', T16_2PC),
	onBoss(SECOND + 50 + 14_000, 'removedebuff', T16_2PC),
];

const presses: WclEvent[] = [
	e(1000, 'cast', ASCENDANCE),
	onBoss(3000, 'cast', LAVA_BURST),
	onBoss(FIRST, 'cast', EARTH_SHOCK),
	onBoss(SECOND, 'cast', EARTH_SHOCK),
];

const fight = {
	id: 1,
	name: 'Iron Juggernaut',
	encounterID: 1704,
	kill: true,
	difficulty: 4,
	size: 25,
	startTime: T0,
	endTime: T0 + DURATION,
};

const dataset = (events: WclEvent[]): FightDataset => ({
	code: 'ele998',
	fight,
	actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
	actors: [{ id: ME, name: 'Sparkstorm', type: 'Player' }],
	events,
	table: {
		fight: { ...fight, enemyNPCs: [{ id: BOSS, gameID: 68_078 }] },
		damageDone: {
			entries: [
				{
					name: 'Sparkstorm',
					id: ME,
					type: 'Shaman',
					itemLevel: 553,
					total: 31_000,
					activeTime: DURATION,
					abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 31_000 }],
				},
			],
		},
	},
});

const analysed = (events: WclEvent[]): Analysis & ElementalAuditResult =>
	analyse(dataset(events)) as Analysis & ElementalAuditResult;

const withSet = analysed([...contact, ...shield, ...dot, ...discharge, ...presses]);
/** The same pull with the two-piece taken off. Nothing else differs. */
const withoutSet = analysed([...contact, ...shield, ...dot, ...presses]);

const pressAt = (el: Analysis & ElementalAuditResult, t: number) => el.earthShock.presses.find((p) => p.t === t);

describe('a shield the log never saw stacked', () => {
	it('sets the pull up the way the defect needs it', () => {
		expect(withSet.isSpec).toBe(true);
		expect(withSet.earthShock.presses.map((p) => p.t)).toEqual([FIRST, SECOND]);
		// The premise in one line: nothing puts the shield up, so its own events cannot reach seven.
		expect(shield.some((event) => event.type === 'applybuff')).toBe(false);
		// And the span the inference reads is the one the real log carries.
		expect(SPAN).toBe(13_266);
	});

	/**
	 * The correction. Two seconds a charge means 13 266ms cannot have been bought with six, so the press
	 * reads seven and the fault it was being charged disappears.
	 */
	it('reads the charges back out of the debuff the shock applied', () => {
		expect(pressAt(withSet, FIRST)?.lsStacks).toBe(7);
		expect(pressAt(withSet, FIRST)?.reasons).not.toContain('belowFull');
		expect(pressAt(withSet, FIRST)?.good).toBe(true);
	});

	/** The second shock's own window ran its full length, which is the exact reading rather than a bound. */
	it('reads a window that was removed rather than refreshed', () => {
		expect(pressAt(withSet, SECOND)?.lsStacks).toBe(7);
		expect(pressAt(withSet, SECOND)?.reasons).not.toContain('belowFull');
	});

	/**
	 * **The control, and the more important half.** No two-piece, no debuff, nothing to infer from — so the
	 * shield's own reading stands and the press is charged exactly as it was before any of this existed. An
	 * inference that fired here would be rewriting the log rather than filling a gap in it.
	 */
	it('says nothing at all about a shaman without the set', () => {
		expect(withoutSet.earthShock.presses.map((p) => p.t)).toEqual([FIRST, SECOND]);
		expect(pressAt(withoutSet, FIRST)?.lsStacks).not.toBe(7);
		expect(pressAt(withoutSet, FIRST)?.reasons).toContain('belowFull');
	});

	/**
	 * A span longer than the aura can hold is a missing `removedebuff`, not a full window.
	 *
	 * Seven charges is fourteen seconds and there is no eighth, so a thirty-second gap between one
	 * application and the next says the remove never reached the log — it does not say the shield was full.
	 * Capping it at seven would read the ceiling off an absence, and `Math.max` would then make that guess
	 * permanent. It declines, and the shield's own reading stands.
	 */
	it('declines to read a span the aura cannot hold', () => {
		const orphaned = analysed([
			...contact,
			...shield,
			...dot,
			// The application the first shock makes, and then nothing until the second shock's refresh
			// thirteen seconds later — no remove in between, and the window left to run past its ceiling.
			onBoss(FIRST + 50, 'applydebuff', T16_2PC),
			onBoss(FIRST + 50 + 30_000, 'refreshdebuff', T16_2PC),
			...presses,
		]);
		const press = pressAt(orphaned, FIRST);
		expect(press?.lsStacks).not.toBe(7);
		expect(press?.lsStacks).toBe(pressAt(withoutSet, FIRST)?.lsStacks);
	});

	/**
	 * And it never lowers a reading the log gets right.
	 *
	 * `Math.max` is what guarantees it, and the case that would otherwise bite is a shock taken *early*:
	 * the refresh interrupts the window, the observed span under-states the charges, and a bare division
	 * would report fewer than the shield plainly had.
	 */
	it('never argues the shield down', () => {
		for (const press of withSet.earthShock.presses) {
			const logged = withoutSet.earthShock.presses.find((p) => p.t === press.t)?.lsStacks ?? 0;
			expect(press.lsStacks ?? 0, `${press.t}`).toBeGreaterThanOrEqual(logged);
		}
	});
});
