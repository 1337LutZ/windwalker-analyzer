// The split between the two readings of the Flame Shock dot: the union across an enemy's spawns,
// which is what a figure or a lane labelled with one name means, and the one spawn the player was
// actually hitting, which is the only thing a graded press can honestly be measured against.
//
// Neither committed fixture can hold this fixed. Both are Iron Juggernaut pulls where the boss is one
// spawn and every one of the 22 graded presses resolves to it — the six Crawler Mine splashes are each
// followed by a boss hit inside 40ms — so the split is provably inert there, which is the right answer
// but not a demonstration. A synthetic two-spawn pull is.
//
// Written the same way `flameShockDot.test.ts` was, and verified the same way: every assertion below
// was checked against the union reading this replaced, and the two marked as the point of the file
// fail against it with the numbers named in their comments.
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '../index';

const T0 = 500_000;
const DURATION = 110_000;
const ME = 9;
/** One actor id, two spawns — the shape WarcraftLogs gives every add in a pack. */
const ADD = 40;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

const FLAME_SHOCK = 8050;
const LAVA_BURST = 51_505;
const EARTH_SHOCK = 8042;
const ASCENDANCE = 114_049;
const LIGHTNING_BOLT = 403;

const hit = (t: number, instance: number): WclEvent =>
	e(t, 'damage', LIGHTNING_BOLT, { targetID: ADD, targetInstance: instance, amount: 1000, hitType: 1 });

/**
 * The player hits the first spawn for fifty seconds, then swaps to the second for the rest.
 *
 * Every two seconds, so the contact clock is one unbroken segment across the swap and nothing here is
 * forgiven as an intermission. The swap is the whole point: after 50s the enemy in front of the player
 * is a spawn that never carried the dot, and `spawnAt` is what notices.
 */
const contact: WclEvent[] = [
	...Array.from({ length: 26 }, (_, i) => hit(i * 2000, 1)),
	...Array.from({ length: 25 }, (_, i) => hit(52_000 + i * 2000, 2)),
];

/**
 * The dot, on spawn 1 only, held from the start to 100s through refreshes.
 *
 * Spawn 2 never gets one. So the union across the add's spawns says "this enemy had the dot for 100
 * seconds", which is true and is what the uptime figure and the lane should say; and the press-level
 * question "did the enemy in front of me have it" is answered `no` from 52s onwards.
 */
const dotEvents: WclEvent[] = [
	e(0, 'applydebuff', FLAME_SHOCK, { targetID: ADD, targetInstance: 1 }),
	e(20_000, 'refreshdebuff', FLAME_SHOCK, { targetID: ADD, targetInstance: 1 }),
	e(40_000, 'refreshdebuff', FLAME_SHOCK, { targetID: ADD, targetInstance: 1 }),
	e(60_000, 'refreshdebuff', FLAME_SHOCK, { targetID: ADD, targetInstance: 1 }),
	e(80_000, 'refreshdebuff', FLAME_SHOCK, { targetID: ADD, targetInstance: 1 }),
	e(100_000, 'removedebuff', FLAME_SHOCK, { targetID: ADD, targetInstance: 1 }),
];

/**
 * The presses being graded.
 *
 * Two Earth Shocks, one on each side of the swap, and a Flame Shock after it. Ascendance goes at 1s so
 * its 180s clock keeps `ascReady` out of every Earth Shock's reason list — without it the button reads
 * as never pressed, which the audit scores as "ready now" and pushes onto every shock.
 */
const presses: WclEvent[] = [
	e(1000, 'cast', ASCENDANCE),
	e(2000, 'cast', LAVA_BURST, { targetID: ADD, targetInstance: 1 }),
	e(30_000, 'cast', EARTH_SHOCK, { targetID: ADD, targetInstance: 1 }),
	e(70_000, 'cast', EARTH_SHOCK, { targetID: ADD, targetInstance: 2 }),
	e(74_000, 'cast', FLAME_SHOCK, { targetID: ADD, targetInstance: 2 }),
];

const dataset: FightDataset = {
	code: 'ele998',
	fight: {
		id: 1,
		name: 'Iron Qon',
		encounterID: 1662,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: T0 + DURATION,
	},
	actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
	actors: [{ id: ME, name: 'Sparkstorm', type: 'Player' }],
	events: [...contact, ...dotEvents, ...presses],
	table: {
		fight: {
			id: 1,
			name: 'Iron Qon',
			encounterID: 1662,
			kill: true,
			difficulty: 4,
			size: 25,
			startTime: T0,
			endTime: T0 + DURATION,
			enemyNPCs: [{ id: ADD, gameID: 68_078 }],
		},
		damageDone: {
			entries: [
				{
					name: 'Sparkstorm',
					id: ME,
					type: 'Shaman',
					itemLevel: 553,
					total: 51_000,
					activeTime: DURATION,
					abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 51_000 }],
				},
			],
		},
	},
};

const el = analyse(dataset) as Analysis & ElementalAuditResult;

describe('the Flame Shock dot, per spawn and merged', () => {
	it('is read as Elemental at all', () => {
		expect(el.isSpec).toBe(true);
	});

	/** The union, unchanged: the figure and the lane are still claims about the enemy, not about a spawn. */
	it('still reports the union across spawns as the uptime for the enemy', () => {
		expect(el.flameShock.windows).toEqual([{ start: 0, end: 100_000 }]);
		expect(el.flameShock.uptimeMs).toBe(100_000);
	});

	/**
	 * The point of the file. The shock at 30s is on the spawn carrying the dot and sees the rest of that
	 * spawn's window; the shock at 70s is on a spawn with nothing on it and is charged `fsLow`.
	 *
	 * Against the union the 70s press read `fsRemainingMs: 30_000` and carried no reason at all — a
	 * shock fired at a bare add graded as a good one because a different copy of that add, across the
	 * room and not being hit, still had the dot ticking on it.
	 */
	it('grades an Earth Shock against the spawn it was fired at', () => {
		expect(el.earthShock.presses.map((p) => [p.t, p.fsRemainingMs, p.reasons, p.good])).toEqual([
			[30_000, 70_000, [], true],
			[70_000, 0, ['fsLow'], false],
		]);
		expect(el.earthShock.good).toBe(1);
	});

	/**
	 * The other half of the same reading. The Flame Shock at 74s lands on a spawn that never had the
	 * dot, so it is an apply and not a refresh — `remainingMs: null`, and no wasted global.
	 *
	 * Against the union its timeline was the whole enemy's, so the press read the *other* spawn's last
	 * refresh: `remainingMs: 16_000`, counted as a refresh rather than an apply, and charged as a wasted
	 * global for being neither the reader's keep-it-up window nor the sim's Ascendance prep.
	 */
	it('reads a Flame Shock onto a bare spawn as an apply, not a refresh', () => {
		expect(el.flameShock.presses.map((p) => [p.t, p.remainingMs])).toEqual([[74_000, null]]);
		expect(el.flameShock.applies).toBe(1);
		expect(el.flameShock.refreshes).toBe(0);
		expect(el.cpm.wastedGcds).toBe(0);
	});

	/**
	 * The ladder reads the same per-spawn answer, through `auraRemainingAt` rather than through a window
	 * array — no set of windows can say "on whichever enemy I am facing" (see `AplInputs`).
	 *
	 * At 70s the dot on the enemy being hit is gone, so the list wants Flame Shock and not Earth Shock,
	 * and the press is a skip attributed to that rung. Against the union the dot read as 30s up, which
	 * satisfied the Earth Shock rung's own `dotRemainingTime >= 6s` and left the skip attributed to
	 * Lava Burst instead — the same press called a fault for the wrong missing button.
	 */
	it('moves the ladder verdict on the press it moved the reason for', () => {
		const at70 = el.apl?.presses.find((p) => p.t === 70_000);
		expect(at70?.verdict).toBe('skipped');
		expect(at70?.wanted).toBe('flame-shock');
	});
});

// --------------------------------------------------------------------------------------------------
// The same split one scope wider: two **different enemies**, not two spawns of one.
//
// Everything above holds a single actor id with two spawns, and on that shape the primary-scoped map
// `dotWindowsOnTarget(..., primaryID, ...)` builds already covers both — the add *is* the primary — so
// the two per-spawn readings this file was written for are the same map. That hid a second defect for as
// long as this file was the only demonstration of them.
//
// `fsRemainingAt` and `downBefore` both keyed into `fsDot.byInstance`, which is that primary-scoped map.
// So when the enemy in front of the player was a *different actor id* the lookup missed and both closures
// answered from an empty array: `remainingIn(t, [])` is **0** and `downBefore`'s walk finds no previous
// window and returns **null**. Neither is a measurement. The zero is indistinguishable from "the enemy
// being hit had no dot" and charged `fsLow` on a shock fired into a dot with 29.5s left; the null is
// indistinguishable from "this spawn never had one" and read a Flame Shock ten seconds late as an opener.
//
// Both now read `fsDotAnywhere`, the every-spawn map the graded uptime numerator already used. This pull
// is the minimum shape that can tell the two maps apart: a boss the player is mostly hitting and never
// dots, and one add that carries the dot for forty seconds. It is `addsThenBoss` in miniature — see
// `addsThenBossLadder.test.ts`, where the primary is untargetable for the first 442 of 560 seconds and
// the same missing map cost 166 verdicts.
const BOSS = 30;

const bossHit = (t: number): WclEvent =>
	e(t, 'damage', LIGHTNING_BOLT, { targetID: BOSS, targetInstance: 1, amount: 1000, hitType: 1 });
const addHit = (t: number): WclEvent =>
	e(t, 'damage', LIGHTNING_BOLT, { targetID: ADD, targetInstance: 1, amount: 1000, hitType: 1 });

/**
 * The player is on the boss every two seconds all pull, and steps to the add for the three globals it
 * matters for.
 *
 * The boss therefore takes 55 hits to the add's 3 and is unambiguously `primaryID`, which is the whole
 * point — and the contact clock is one unbroken segment, so `downBefore` charges the full gap rather than
 * forgiving part of it as time away. Each add hit is stamped 400ms before the press it belongs to, so
 * `spawnAt` resolves that press to the add and not to the boss hit two seconds earlier.
 */
const crossContact: WclEvent[] = [
	...Array.from({ length: 55 }, (_, i) => bossHit(i * 2000)),
	addHit(30_100),
	addHit(70_100),
	addHit(74_100),
];

/**
 * The dot, on the **add** and never on the boss, from 20s to 60s.
 *
 * So the primary-scoped map is empty for the whole pull — `flameShock.windows` is `[]` — which is the
 * shape `addsThenBoss` has for its first 442 seconds and the reason a primary-keyed lookup there could
 * only ever answer zero.
 */
const crossDot: WclEvent[] = [
	e(20_000, 'applydebuff', FLAME_SHOCK, { targetID: ADD, targetInstance: 1 }),
	e(40_000, 'refreshdebuff', FLAME_SHOCK, { targetID: ADD, targetInstance: 1 }),
	e(60_000, 'removedebuff', FLAME_SHOCK, { targetID: ADD, targetInstance: 1 }),
];

/**
 * One shock into the live dot, one Flame Shock ten seconds after it lapsed.
 *
 * Ascendance at 1s for the reason the pull above states — without it `ascReady` lands on every shock.
 */
const crossPresses: WclEvent[] = [
	e(1000, 'cast', ASCENDANCE),
	e(2000, 'cast', LAVA_BURST, { targetID: BOSS, targetInstance: 1 }),
	e(30_500, 'cast', EARTH_SHOCK, { targetID: ADD, targetInstance: 1 }),
	e(70_500, 'cast', FLAME_SHOCK, { targetID: ADD, targetInstance: 1 }),
];

const crossDataset: FightDataset = {
	...dataset,
	code: 'ele997',
	// **Both enemies declared as actors, and that is load-bearing here rather than tidy.** `analyseCore`
	// builds the contact clock from hits whose target is in the NPC set it takes off this list, so a pull
	// that names no NPC has an empty `contact` — and `downBefore` charges only the part of a gap the player
	// was present for, which would then be none of it. The pull above never reads that clock; this one
	// grades an `exposedMs` off it.
	actors: [
		{ id: ME, name: 'Sparkstorm', type: 'Player' },
		{ id: BOSS, name: 'Galakras', type: 'NPC' },
		{ id: ADD, name: "Kor'kron Reaver", type: 'NPC' },
	],
	events: [...crossContact, ...crossDot, ...crossPresses],
	table: {
		...dataset.table,
		fight: {
			...dataset.table.fight,
			enemyNPCs: [
				{ id: BOSS, gameID: 68_078 },
				{ id: ADD, gameID: 68_079 },
			],
		},
	},
};

const cross = analyse(crossDataset) as Analysis & ElementalAuditResult;

describe('the Flame Shock dot on an enemy that is not the primary', () => {
	it('is the pull this file claims: the primary never carries the dot at all', () => {
		// The premise every assertion below rests on, so a drifting fixture has to fail here first. An
		// empty `windows` is the primary-scoped reading, and it is empty because the boss was never dotted.
		expect(cross.isSpec).toBe(true);
		expect(cross.primaryTarget?.id).toBe(BOSS);
		expect(cross.flameShock.windows).toEqual([]);
		expect(cross.flameShock.uptimeMs).toBe(0);
	});

	it('grades an Earth Shock against the dot on the add it was fired at', () => {
		// `fsRemainingAt`'s half. The shock at 30.5s is aimed at the add, whose dot runs to 60s, so it sees
		// 29.5s and is a good shock. Against `fsDot.byInstance` the lookup missed the add entirely and
		// `remainingIn(t, [])` answered 0 — `fsRemainingMs: 0`, `reasons: ['fsLow']`, `good: false`, and
		// `earthShock.good` 0 of 1. A fault invented by a map that could not see the enemy being hit.
		expect(cross.earthShock.presses.map((p) => [p.t, p.fsRemainingMs, p.reasons, p.good])).toEqual([
			[30_500, 29_500, [], true],
		]);
		expect(cross.earthShock.good).toBe(1);
	});

	it('charges a Flame Shock ten seconds late as late, not as an opener', () => {
		// `downBefore`'s half, and it is the same defect with the other fallback value. The add's dot fell
		// off at 60s and the press is at 70.5s with the player in contact throughout, so 10 500ms of it was
		// exposed and `DROP_MS` is 1 000. Against `fsDot.byInstance` the walk found no window before the
		// press, returned `null`, and `null` means "this spawn never had the dot" — so the press was graded
		// `apply` with `exposedMs: 0`, an opener, on an add that had been carrying the dot for forty seconds.
		expect(cross.flameShock.presses.map((p) => [p.t, p.kind, p.remainingMs, p.exposedMs])).toEqual([
			[70_500, 'late', null, 10_500],
		]);
	});

	it('moves the ladder verdict on the shock, since the rung above it no longer claims the global', () => {
		// The consequence for the report. With the dot read off the add the Flame Shock rung has nothing to
		// ask for at 30.5s; against the primary-scoped map it read the dot as down and took the global,
		// which is the 152-of-268 mechanism `addsThenBossLadder.test.ts` measures at scale.
		const shock = cross.apl?.presses.find((p) => p.t === 30_500);
		expect(shock?.wanted).not.toBe('flame-shock');
	});
});
