// Lava Burst and its two resets: the Lava Surge procs, and what makes a press free.
//
// The section answers the one question a cast count cannot — a surge that expired with no Lava Burst
// inside was a free cast thrown away — and the interesting half of that is the exception. A surge that
// runs out while the boss is submerged is the fight taking the cast back, not a cast the player threw
// away, and `a:qHRAFwdGzaB6MPYC` #14 carries exactly one of those: the pull's only unconsumed surge
// expires 14.9 seconds into the Iron Juggernaut's submerge.
//
// The synthetic pull underneath is for the other side of the same guard: an unconsumed surge that
// expired with the boss in reach, which is a real fault and has to be reported as one.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '../index';

const fx = (name: string): Analysis & ElementalAuditResult =>
	analyse(rawDataset(name)) as Analysis & ElementalAuditResult;

describe('a surge that expired while the boss was away', () => {
	const el = fx('phased');
	const { lavaBurst } = el;

	it('reads every proc the log carried', () => {
		expect(lavaBurst.procs).toHaveLength(18);
		expect(lavaBurst.presses).toHaveLength(49);
	});

	it('finds the one surge no Lava Burst was spent inside', () => {
		expect(lavaBurst.procs.filter((p) => !p.consumed)).toEqual([
			{ start: 146_591, end: 157_147, consumed: false, wasted: false },
		]);
	});

	/**
	 * The whole point of this fixture for this section.
	 *
	 * The submerge runs 142.3s to 192.5s off the player's own contact clock, and the surge expires at
	 * 157.1s — inside it, with nothing to cast at. `wasted` is `!consumed` **and** in contact, so the
	 * count is zero; without the contact half this pull would report a thrown-away free cast the player
	 * never had.
	 */
	it('does not charge the player for it', () => {
		expect(lavaBurst.wasted).toBe(0);
		const [before, after] = el.timeline?.contactSegments ?? [];
		expect(before?.[1]).toBe(142_282);
		expect(after?.[0]).toBe(192_534);
		expect(157_147).toBeGreaterThan(before?.[1] ?? 0);
		expect(157_147).toBeLessThan(after?.[0] ?? 0);
	});

	it('says which presses were free and which reset made them free', () => {
		// Seventeen of this pull's eighteen procs were spent, and the eighteenth is the one that expired at
		// 157 147 inside the submerge, forgiven above. The count is bounded by `procs.length` by
		// construction — a press cannot be made free by a reset that never happened — which is what makes
		// this a real assertion rather than a recorded output: it was 23 while the audit read the surge
		// window at the instant the cast *landed*, and 23 is more procs than the pull ever had.
		expect(lavaBurst.presses.filter((p) => p.surge)).toHaveLength(17);
		expect(lavaBurst.procs).toHaveLength(18);
		expect(lavaBurst.presses.filter((p) => p.ascendance)).toHaveLength(24);
	});
});

describe('a pull that consumed every surge it was given', () => {
	const { lavaBurst } = fx('unbroken');

	it('has nothing to report', () => {
		expect(lavaBurst.procs).toHaveLength(20);
		expect(lavaBurst.procs.filter((p) => !p.consumed)).toEqual([]);
		expect(lavaBurst.wasted).toBe(0);
	});

	it('still counts the presses and their resets apart', () => {
		expect(lavaBurst.presses).toHaveLength(41);
		// Every one of this pull's twenty procs was spent, which is why `wasted` is 0 above. Bounded by
		// `procs.length` for the same reason as the phased case.
		expect(lavaBurst.presses.filter((p) => p.surge)).toHaveLength(20);
		expect(lavaBurst.procs).toHaveLength(20);
		expect(lavaBurst.presses.filter((p) => p.ascendance)).toHaveLength(15);
	});
});

// ------------------------------------------------- Flame Shock, off the raw stream

/**
 * The player's own Flame Shock **down** stretches on one enemy, walked out of the dataset's events and
 * nothing else.
 *
 * Deliberately a second implementation. The thing under test is `lavaBurst.presses[].flameShock`, which
 * is built from `dotWindowsBySpawn` and `CastPress.begin`; checking it against a window list produced by
 * the same two functions would assert that the audit agrees with itself. This walk reads
 * `applydebuff` / `refreshdebuff` / `removedebuff` straight off the fixture, so a change to either of
 * those helpers moves one side of the comparison and not the other.
 */
function fsDownStretches(dataset: FightDataset, target: number): Array<[number, number]> {
	const t0 = dataset.fight.startTime;
	const fightEnd = dataset.fight.endTime - t0;
	const out: Array<[number, number]> = [];
	let down: number | null = 0;
	for (const e of dataset.events) {
		if (e.abilityGameID !== 8050 || e.sourceID !== dataset.actor.id || e.targetID !== target) continue;
		const t = e.timestamp - t0;
		if (e.type === 'removedebuff') down ??= t;
		else if ((e.type === 'applydebuff' || e.type === 'refreshdebuff') && down !== null) {
			if (t > down) out.push([down, t]);
			down = null;
		}
	}
	if (down !== null && fightEnd > down) out.push([down, fightEnd]);
	return out;
}

function rawDataset(name: string): FightDataset {
	return JSON.parse(
		readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'),
	) as FightDataset;
}

/**
 * **No committed fixture has a Lava Burst committed with the dot down — and none of them is vacuous.**
 *
 * The point of pinning this rather than only testing the synthetic pull below: a reader who sees "zero
 * faults on every real pull" should be able to tell "the check never fires" apart from "the check had
 * no chance to fire". `cleave` and `phased` give it plenty of chance — walked off their own event
 * streams the dot is absent from the primary for eight and six stretches, the longest 11.5s and 41.9s
 * (the submerge) — and `unbroken` gives it almost none, which is what its name says: 1553ms of pre-pull
 * ramp and one 49ms seam, and no Lava Burst within either.
 *
 * The tightest near-miss anywhere is `cleave`'s press at 118 136, committed 264ms before the dot fell
 * at 118 400. That is one of the three hits §67a measured, and it reads as buffed here for the reason
 * §67a settled: the multiplier is decided at the cast and not at the impact.
 *
 * So the whole ledger of dot-less presses is empty on committed data, which is why the field is
 * published and not graded, and why the case is covered synthetically below.
 */
describe('Flame Shock under every Lava Burst the fixtures carry', () => {
	/** Per fixture: the primary's id, the press count, and the dot's down stretches read off the log. */
	const pulls = {
		cleave: { primary: 470, presses: 43, stretches: 8, longest: 11_496 },
		phased: { primary: 216, presses: 49, stretches: 6, longest: 41_914 },
		unbroken: { primary: 308, presses: 41, stretches: 2, longest: 1553 },
	} as const;

	for (const name of ['cleave', 'phased', 'unbroken'] as const) {
		it(`${name}: every press committed inside a dot window`, () => {
			const dataset = rawDataset(name);
			const down = fsDownStretches(dataset, pulls[name].primary);
			const { lavaBurst } = analyse(dataset) as Analysis & ElementalAuditResult;

			// How much chance the check had on this pull, stated rather than left implicit.
			expect(down).toHaveLength(pulls[name].stretches);
			expect(Math.max(...down.map(([s, e]) => e - s))).toBe(pulls[name].longest);

			expect(lavaBurst.presses).toHaveLength(pulls[name].presses);
			// The independent side of the comparison: no commit instant lies inside a down stretch.
			const insideAGap = lavaBurst.presses.filter((p) => down.some(([s, e]) => p.t > s && p.t < e));
			expect(insideAGap).toEqual([]);
			// And the audit says the same thing in its own terms, with nothing unreadable.
			expect(lavaBurst.presses.filter((p) => p.flameShock === false)).toEqual([]);
			expect(lavaBurst.presses.filter((p) => p.flameShock === null)).toEqual([]);
		});
	}

	/** The near-miss named above, asserted rather than only described. */
	it('credits the press that committed 264ms before the dot fell', () => {
		const dataset = rawDataset('cleave');
		expect(fsDownStretches(dataset, 470)).toContainEqual([118_400, 120_417]);
		const { lavaBurst } = analyse(dataset) as Analysis & ElementalAuditResult;
		expect(lavaBurst.presses.find((p) => p.t === 118_136)?.flameShock).toBe(true);
	});
});

// ------------------------------------------------------------------ synthetic

const T0 = 400_000;
const DURATION = 120_000;
const ME = 2;
const BOSS = 12;

const LAVA_SURGE = 77_762;
const LAVA_BURST = 51_505;
const LIGHTNING_BOLT = 403;
const ASCENDANCE_CAST = 114_049;
const ASCENDANCE_BUFF = 114_050;

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
 * Contact in two segments, with a forty-second hole in the middle.
 *
 * A hit every five seconds is well inside the 15s gap that splits one contact stretch from the next, so
 * the pull reads as `[0, 40s]` and `[80s, 120s]` — an intermission the player could not cast into.
 */
const contact: WclEvent[] = [
	...Array.from({ length: 9 }, (_, i) => hit(i * 5000)),
	...Array.from({ length: 9 }, (_, i) => hit(80_000 + i * 5000)),
];

/**
 * Three surges, one for each answer the section can give.
 *
 *   10-20s   a Lava Burst at 15s inside it — consumed
 *   25-35s   nothing inside it, and the boss in reach — wasted
 *   50-60s   nothing inside it, and the boss away — not the player's fault
 */
const surgeEvents: WclEvent[] = [
	e(10_000, 'applybuff', LAVA_SURGE),
	e(20_000, 'removebuff', LAVA_SURGE),
	e(25_000, 'applybuff', LAVA_SURGE),
	e(35_000, 'removebuff', LAVA_SURGE),
	e(50_000, 'applybuff', LAVA_SURGE),
	e(60_000, 'removebuff', LAVA_SURGE),
];

/** Ascendance, so a press inside its fifteen seconds can be told from a press inside a surge. */
const ascendanceEvents: WclEvent[] = [
	e(90_000, 'cast', ASCENDANCE_CAST),
	e(90_000, 'applybuff', ASCENDANCE_BUFF),
	e(105_000, 'removebuff', ASCENDANCE_BUFF),
];

const lavaBursts: WclEvent[] = [
	e(5000, 'cast', LAVA_BURST, { targetID: BOSS, targetInstance: 1 }),
	e(15_000, 'cast', LAVA_BURST, { targetID: BOSS, targetInstance: 1 }),
	e(95_000, 'cast', LAVA_BURST, { targetID: BOSS, targetInstance: 1 }),
];

const synthetic: FightDataset = {
	code: 'ele-lvb',
	fight: {
		id: 4,
		name: 'Iron Qon',
		encounterID: 1662,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: T0 + DURATION,
	},
	actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
	actors: [
		{ id: ME, name: 'Sparkstorm', type: 'Player' },
		{ id: BOSS, name: 'Iron Qon', type: 'NPC', subType: 'Boss' },
	],
	events: [...contact, ...surgeEvents, ...ascendanceEvents, ...lavaBursts],
	table: {
		fight: {
			id: 4,
			name: 'Iron Qon',
			encounterID: 1662,
			kill: true,
			difficulty: 4,
			size: 25,
			startTime: T0,
			endTime: T0 + DURATION,
			enemyNPCs: [{ id: BOSS, gameID: 68_078 }],
		},
		damageDone: {
			entries: [
				{
					name: 'Sparkstorm',
					id: ME,
					type: 'Shaman',
					itemLevel: 553,
					total: 18_000,
					activeTime: DURATION,
					abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 18_000 }],
				},
			],
		},
	},
};

const el = analyse(synthetic) as Analysis & ElementalAuditResult;

describe('the three things a surge can come to', () => {
	it('reads the pull the way it was built', () => {
		expect(el.isSpec).toBe(true);
		expect(el.timeline?.contactSegments).toEqual([
			[0, 40_000],
			[80_000, 120_000],
		]);
	});

	it('tells consumed, wasted and forgiven apart', () => {
		expect(el.lavaBurst.procs).toEqual([
			{ start: 10_000, end: 20_000, consumed: true, wasted: false },
			{ start: 25_000, end: 35_000, consumed: false, wasted: true },
			{ start: 50_000, end: 60_000, consumed: false, wasted: false },
		]);
	});

	/** One fault out of two unconsumed procs: the count is the faults, not the misses. */
	it('charges only the one the player could have taken', () => {
		expect(el.lavaBurst.wasted).toBe(1);
	});
});

describe('what made each press free', () => {
	it('names the reset behind every Lava Burst', () => {
		// `flameShock: false` on all three because this pull contains no Flame Shock at all — the events
		// above are surges, Ascendance and Lightning Bolt. Not an incidental default: it is the field
		// answering the question, and the pull it answers about is a shaman who never dotted anything.
		expect(el.lavaBurst.presses).toEqual([
			{ t: 5000, surge: false, ascendance: false, flameShock: false },
			{ t: 15_000, surge: true, ascendance: false, flameShock: false },
			{ t: 95_000, surge: false, ascendance: true, flameShock: false },
		]);
	});
});

// -------------------------------------------- synthetic: Flame Shock under the press

/**
 * The dot-less Lava Burst, and the three edges around it — none of which any committed fixture has.
 *
 * Built rather than found because the search came up empty: `cleave`, `phased` and `unbroken` commit 133
 * Lava Bursts between them and every single one of them inside a dot window (see the fixture suite
 * above). So the fault this field exists to name has no real example in the repo, and the only way to
 * hold the behaviour still is a pull constructed to contain one.
 *
 * Four things it pins, in the order the presses fall:
 *
 *   5s   no dot yet — the plain fault, `false`.
 *   20s  dot up, `true`.
 *   39s  dot up at the **commit** and gone by the time the two-second cast completes at 41s. Reads
 *        `true`, and that is the whole §67/§67a argument in one row: the ×1.5 is decided when the
 *        button goes down, so a dot that ends mid-flight — or here, mid-cast — was already paid for.
 *        The player is not let off, either: the ladder refuses that press and charges it as a lost cast.
 *   70s  aimed at the **add**, which is dotted while the boss is not. Reads `true`, which is why the
 *        audit reads the dot per spawn rather than off the primary — a primary-scoped map would call a
 *        correct cleave Lava Burst a fault.
 *   75s  aimed at the boss while only the add is dotted. The same instant, the other answer: `false`.
 *   100s the cast event names **no target**, so the press falls back to the enemy the player was
 *        demonstrably hitting. The boss is dotted again by then, so `true` — the fallback resolving,
 *        not a silent `false`.
 */
const T0B = 900_000;
const ADD = 13;
const FLAME_SHOCK = 8050;

const eb = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0B + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

/** One hit every three seconds on the boss: unbroken contact, and the fallback's answer at 100s. */
const dotContact: WclEvent[] = Array.from({ length: 40 }, (_, i) =>
	eb(i * 3000, 'damage', LIGHTNING_BOLT, { targetID: BOSS, targetInstance: 1, amount: 1000, hitType: 1 }),
);

/** The boss dotted twice with a hole in the middle, and the add dotted across that hole. */
const dotEvents: WclEvent[] = [
	eb(10_000, 'applydebuff', FLAME_SHOCK, { targetID: BOSS, targetInstance: 1 }),
	eb(40_000, 'removedebuff', FLAME_SHOCK, { targetID: BOSS, targetInstance: 1 }),
	eb(60_000, 'applydebuff', FLAME_SHOCK, { targetID: ADD, targetInstance: 1 }),
	eb(90_000, 'removedebuff', FLAME_SHOCK, { targetID: ADD, targetInstance: 1 }),
	eb(95_000, 'applydebuff', FLAME_SHOCK, { targetID: BOSS, targetInstance: 1 }),
	eb(119_000, 'removedebuff', FLAME_SHOCK, { targetID: BOSS, targetInstance: 1 }),
];

/** Each press a `begincast`/`cast` pair two seconds apart, so `begin` and `t` are visibly different. */
const dotBursts: WclEvent[] = [
	[5000, BOSS],
	[20_000, BOSS],
	[39_000, BOSS],
	[70_000, ADD],
	[75_000, BOSS],
].flatMap(([begin, target]) => [
	eb(begin as number, 'begincast', LAVA_BURST, { targetID: target, targetInstance: 1 }),
	eb((begin as number) + 2000, 'cast', LAVA_BURST, { targetID: target, targetInstance: 1 }),
]);

/** The press the log gave no target for — `targetID` explicitly absent, not pointed at the player. */
const untargetedBurst: WclEvent[] = [
	eb(100_000, 'begincast', LAVA_BURST, { targetID: undefined }),
	eb(102_000, 'cast', LAVA_BURST, { targetID: undefined }),
];

const dotPull: FightDataset = {
	...synthetic,
	code: 'ele-lvb-fs',
	fight: { ...synthetic.fight, startTime: T0B, endTime: T0B + DURATION },
	actors: [...synthetic.actors, { id: ADD, name: 'Molten Add', type: 'NPC' }],
	events: [...dotContact, ...dotEvents, ...dotBursts, ...untargetedBurst],
	table: {
		...synthetic.table,
		fight: {
			...synthetic.table.fight,
			startTime: T0B,
			endTime: T0B + DURATION,
			enemyNPCs: [
				{ id: BOSS, gameID: 68_078 },
				{ id: ADD, gameID: 68_079 },
			],
		},
	},
};

describe('Flame Shock under the press', () => {
	const { lavaBurst } = analyse(dotPull) as Analysis & ElementalAuditResult;

	it('reads the completion instant, so a dot that expires inside the cast is not credited', () => {
		// Every row's `t` is the `begincast`, two seconds before the cast it opened — so the stamps below
		// are commits while `flameShock` is read two seconds later. That split is the point, not an
		// oversight: the row says when the player pressed, the field says whether the game paid.
		expect(lavaBurst.presses.map((p) => p.t)).toEqual([5000, 20_000, 39_000, 70_000, 75_000, 100_000]);
		// **The third row is the whole reason this test exists.** The boss carries the dot over [10s, 40s].
		// That press commits at 39s — inside — and completes at 41s, outside. Read at the commit it would
		// say `true`, and the sim would have given it no multiplier: `ApplyEffects` tests the dot when the
		// cast completes. So the honest answer is `false`, and the press is charged as a *choice* by the
		// ladder's own rung instead, which refuses a press whose dot will not outlive the cast.
		expect(lavaBurst.presses.map((p) => p.flameShock)).toEqual([false, true, false, true, false, true]);
	});

	it('names the dot-less presses and nothing else', () => {
		// Three, not two: 39s joins them for the reason above.
		expect(lavaBurst.presses.filter((p) => p.flameShock === false).map((p) => p.t)).toEqual([5000, 39_000, 75_000]);
		// Nothing unreadable: every press resolved to an enemy, the last one through the hit fallback.
		expect(lavaBurst.presses.filter((p) => p.flameShock === null)).toEqual([]);
	});

	/**
	 * The independent read of the same two answers, off the constructed stream rather than off the field.
	 *
	 * The boss carries the dot over [10s, 40s] and [95s, 119s], so 5s and 75s are outside both and 20s,
	 * 39s and 100s are inside one — which is exactly the split above, arrived at without the audit.
	 */
	it('agrees with the dot windows the pull was built from', () => {
		const bossDown = fsDownStretches(dotPull, BOSS);
		expect(bossDown).toEqual([
			[0, 10_000],
			[40_000, 95_000],
			[119_000, DURATION],
		]);
		const aimedAtBoss = [5000, 20_000, 39_000, 75_000, 100_000];
		expect(aimedAtBoss.filter((t) => bossDown.some(([s, e]) => t > s && t < e))).toEqual([5000, 75_000]);
	});
});
