// The pull that made Flame Shock's uptime read 100.21%, rebuilt as a synthetic one — and the pulls that
// hold the clock the share is measured against.
//
// The report it was seen on belongs to a named player, so it cannot be committed as a fixture — this is
// the same *shape* with the same clocks, and the numbers are the ones that report produced: the last
// landed hit on the boss at 364.238s, the dot's `removedebuff` at 365.014s, and a 365 155ms fight. The
// dot never fell off, so the numerator ran 365 010ms while the landed-hit clock — built from the
// player's own landed non-tick hits, so it cannot start before the first or run past the last — ran
// 364 234ms. 365 010 / 364 234 is 100.2130%.
//
// Neither committed anonymous fixture tips over, but both carry the shape: `unbroken` sits at 100% with
// the dot covering every millisecond of its clock, and `phased` has 125ms of dot past the last hit which
// the old arithmetic credited against a span that does not contain it.
//
// **The clock is `contact` — the player's — and not `engaged`, the boss's.** On the first three pulls in
// this file the two are the same array: one enemy, and every hit in the stream is the player's own,
// direct, modelled damage on it, so nothing can separate "the boss was there to be hit" from "the player
// was hitting something". That is why those three cannot guard the choice of clock at all, and why the
// two pulls at the end of the file exist: they put a second enemy in, which pulls the two clocks 100
// seconds apart and makes each candidate arithmetic give a different, mid-range answer.
//
// Two pulls for the overrun, and the second is the one that keeps that half honest. The first would pass
// on the clamp inside `uptimePct` alone, because a clamped overflow and a correct share are both 100. The
// second overruns the same clock while also leaving a real gap, so it is under 100 either way and only
// the arithmetic can tell the two answers apart.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { unionMs } from '~/lib/analysis/intervals';
import type { WclEvent } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '../index';

const T0 = 1_000_000;
/** The real pull's length, to the millisecond. */
const DURATION = 365_155;
const ME = 9;
const BOSS = 410;

/** The last landed hit on the boss, and where both landed-hit clocks therefore stop. */
const LAST_HIT = 364_238;
/** The dot's removal, which the boss's death emits after that last hit has landed. */
const DOT_END = 365_014;
/** Both clocks open here: the opening Flame Shock is itself the first landed hit. */
const START = 4;

const FLAME_SHOCK = 8050;
const LAVA_BURST = 51_505;
const LIGHTNING_BOLT = 403;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

const hit = (t: number, id: number): WclEvent =>
	e(t, 'damage', id, { targetID: BOSS, targetInstance: 1, amount: 1000, hitType: 1 });

/**
 * Unbroken contact on the boss from `START` to `LAST_HIT`, and not one hit after it.
 *
 * Every five seconds, well inside the 15s gap that would split either clock in two, so both come back as
 * the single stretch `[START, LAST_HIT]` — the shape of a pull nobody ever left. One enemy and one kind
 * of hit, so `contact` and `engaged` are the same array here by construction. The dot's own initial hit
 * is the first of them, which is why the clocks and the dot start together and the whole disagreement is
 * at the tail.
 */
const contact: WclEvent[] = [
	hit(START, FLAME_SHOCK),
	...Array.from({ length: Math.floor((LAST_HIT - START) / 5000) }, (_, i) =>
		hit(START + (i + 1) * 5000, LIGHTNING_BOLT),
	),
	hit(LAST_HIT, LIGHTNING_BOLT),
];

/** One `applydebuff`/`removedebuff` pair per window, on the one spawn of the boss. */
const dotEvents = (windows: ReadonlyArray<[number, number]>): WclEvent[] =>
	windows.flatMap(([start, end]) => [
		e(start, 'applydebuff', FLAME_SHOCK, { targetID: BOSS, targetInstance: 1 }),
		e(end, 'removedebuff', FLAME_SHOCK, { targetID: BOSS, targetInstance: 1 }),
	]);

const datasetWith = (windows: ReadonlyArray<[number, number]>): FightDataset => ({
	code: 'ele998',
	fight: {
		id: 1,
		name: 'Thok the Bloodthirsty',
		encounterID: 1667,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: T0 + DURATION,
	},
	actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
	actors: [
		{ id: ME, name: 'Sparkstorm', type: 'Player' },
		{ id: BOSS, name: 'Thok the Bloodthirsty', type: 'NPC', subType: 'Boss' },
	],
	// A Lava Burst so `identify` accepts the pull as Elemental at all.
	events: [...contact, ...dotEvents(windows), e(2000, 'cast', LAVA_BURST, { targetID: BOSS, targetInstance: 1 })],
	table: {
		fight: {
			id: 1,
			name: 'Thok the Bloodthirsty',
			encounterID: 1667,
			kill: true,
			difficulty: 4,
			size: 25,
			startTime: T0,
			endTime: T0 + DURATION,
			enemyNPCs: [{ id: BOSS, gameID: 71_529 }],
		},
		damageDone: {
			entries: [
				{
					name: 'Sparkstorm',
					id: ME,
					type: 'Shaman',
					itemLevel: 553,
					total: 74_000,
					activeTime: DURATION,
					abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 74_000 }],
				},
			],
		},
	},
});

const run = (windows: ReadonlyArray<[number, number]>): Analysis & ElementalAuditResult =>
	analyse(datasetWith(windows)) as Analysis & ElementalAuditResult;

/**
 * The clock these three pulls are scored against: first landed hit to last, and nothing beyond.
 *
 * Named for the role rather than for either clock, because on these pulls it is both — see the header.
 * The two pulls at the end of the file are the ones that can tell them apart.
 */
const SCORED_MS = LAST_HIT - START;

describe('a dot that outlives the last hit on the boss', () => {
	const el = run([[START, DOT_END]]);

	it('is read as Elemental at all', () => {
		expect(el.isSpec).toBe(true);
		expect(el.durationMs).toBe(DURATION);
	});

	/**
	 * The two spans, so a future reader can see they disagree without re-deriving either.
	 *
	 * The clock is read off `contactSegments`, which is the array the share now divides by. On this pull it
	 * is also the boss's own clock: every hit in the stream is the player's own, direct, modelled damage on
	 * the boss, so both are built from one set of stamps and both stop at `LAST_HIT`. The dot's window
	 * does not.
	 */
	it('has a dot window that runs past where the landed-hit clock stops', () => {
		expect(el.flameShock.windows).toEqual([{ start: START, end: DOT_END }]);
		expect(el.timeline?.contactSegments).toEqual([[START, LAST_HIT]]);
		expect(DOT_END).toBeGreaterThan(LAST_HIT);
	});

	/**
	 * The regression, and the figure a user reported. 365 010ms of dot against a 364 234ms landed-hit
	 * clock is 100.2130%, and the 776ms of difference is the dot ticking on a boss that had already taken
	 * its last hit. Clipped to the clock it is scored against, the same pull is exactly 100%: the dot was
	 * up for every millisecond of the fight the denominator can see.
	 *
	 * The `console.warn` spy is the half that stops this passing for the wrong reason. `uptimePct`'s
	 * backstop clamps an out-of-range ratio to 100 and says so out loud, so "100" alone cannot tell a
	 * share that is right from an overflow that was rounded down. Silence is the claim being made here.
	 */
	it('reports 100% by arithmetic and not by clamp', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		try {
			expect(run([[START, DOT_END]]).flameShock.uptimePct).toBe(100);
			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});

	/**
	 * The deliberate half of the split: what the timeline draws is still the dot's whole life, so the
	 * lane does not grow a seam where the boss merely stopped being hit. `uptimeMs` and `uptimePct` are
	 * two different questions, and 365 010 / 365 155 is not what the tile prints.
	 */
	it('keeps the drawn window whole', () => {
		expect(el.flameShock.uptimeMs).toBe(DOT_END - START);
	});
});

/**
 * The same overrun on a pull that also dropped the dot, so the ratio is nowhere near the clamp.
 *
 * 0–100s and 200s–365.014s of dot: 265 010ms drawn, of which 264 234ms falls inside the scored clock,
 * because the tail is clipped at 364.238s. Against 364 234ms that is 72.5451% clipped and 72.7582%
 * unclipped — two answers a hundred milliseconds apart in the middle of the range, where no clamp can
 * step in and make them agree.
 */
describe('a dot that outlives the last hit and dropped once besides', () => {
	const el = run([
		[START, 100_000],
		[200_000, DOT_END],
	]);

	it('scores only the coverage the scored clock contains', () => {
		expect(el.flameShock.uptimeMs).toBe(100_000 - START + (DOT_END - 200_000));
		expect(+el.flameShock.uptimePct.toFixed(4)).toBe(
			+(((100_000 - START + (LAST_HIT - 200_000)) / SCORED_MS) * 100).toFixed(4),
		);
		expect(el.flameShock.uptimePct).toBeLessThan(72.7);
	});
});

/**
 * The ratio is a ratio, on all three real pulls, and it is a ratio of the span it names.
 *
 * This is the check the audit could not express until `scoredMs` was published. `uptimeMs` and
 * `uptimePct` were both readable and neither could be derived from the other, so a numerator and a
 * denominator measured over different spans produced 100.21% and no test could have noticed.
 *
 * **The assertion changed shape when the clock did, and the reason is worth writing down.** It used to
 * recover the numerator from the share and check it against `uptimeMs`, the dot's whole life on the
 * primary target. That worked while the numerator was a subset of the primary's dot. It is no longer: the
 * numerator is now the dot on whichever spawn the player was hitting, so a pull whose player kept the dot
 * on the *adds* has a numerator with milliseconds in it that the primary's lane never carried, and the
 * old inequality would be a rule that happens to hold on three committed fixtures. It holds on all three
 * of them today, and it is still not an invariant, so it is gone rather than pinned.
 *
 * What replaces it is stronger and exact: `scoredMs` must be the union of the contact segments the same
 * analysis published. That is the whole content of "a share of a span it names" — wire the denominator to
 * `duration`, to `engagedMs`, or to anything else, and all three pulls fail on the identity rather than on
 * a bound. `engagedMs` is not published, but it does not have to be: it is a different number on every one
 * of these three pulls (239 246 against 206 557 on `phased` alone), so equality with the contact clock
 * excludes it.
 *
 * What this still does **not** catch is the numerator being measured over a different span from the
 * denominator — the bug that produced 100.21% — because a clamped 100% satisfies every assertion here.
 * The synthetic pulls hold that: the two above for the overrun, and the two below for the choice of clock.
 */
const fx = (name: string): Analysis & ElementalAuditResult =>
	analyse(
		JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset,
	) as Analysis & ElementalAuditResult;

describe('the published denominator', () => {
	for (const name of ['phased', 'unbroken', 'cleave'] as const) {
		it(`${name} reports a share of a span it names`, () => {
			const el = fx(name);
			const fs = el.flameShock;
			expect(fs.scoredMs).toBeGreaterThan(0);
			expect(fs.uptimePct).toBeLessThanOrEqual(100);
			// The clock `scoredMs` names, read off the array the same analysis published for the chart.
			expect(fs.scoredMs).toBe(unionMs(el.timeline?.contactSegments ?? []));
		});
	}
});

// ---------------------------------------------------------------------------------------------------
// The two clocks pulled apart, which is what none of the pulls above can do.
//
// Every pull in this file so far has one enemy, so `engaged` (the primary target's own clock) and
// `contact` (the player's) are built from one set of stamps and are the same array. A swap of one for the
// other is invisible against them.
//
// These two pulls put a second enemy in. The boss takes a hit every five seconds from 0 to 100s and never
// again; an add takes one every five seconds from 105s to 200s. The 5s seam is far inside the 15s gap that
// splits a clock, so `contact` is the single stretch [0, 200 000] while `engaged` closes at 100 000 — a
// hundred seconds of difference, and every candidate arithmetic lands somewhere different in the middle of
// the range:
//
//     the dot on the enemy being hit / contact      52.5%   (i)      95.0%   (ii)   <- what ships
//     the dot on the primary / the primary's clock  100%             100%           <- what shipped before
//     the dot on the primary, over contact          50.0%            50.0%          <- the half-swap
//     the dot on the primary's spawns / contact     52.5%            52.5%          <- numerator left behind
//
// The last row is the one that needed a pull of its own. It is the mistake of moving the denominator to the
// player's clock and leaving the numerator scoped to the primary's spawns, which produces no clamp and no
// warning — it silently charges every second spent on a dotted add as a dot the player dropped.

const ADD = 411;
/** Long enough that the add's stretch and the boss's are both several dot lengths. */
const TWO_DURATION = 240_000;
/** The boss's last hit, so `engaged` closes here. */
const BOSS_LAST = 100_000;
/** The add's first and last hits. The seam at 105s is 5s wide, so `contact` does not split. */
const ADD_FIRST = 105_000;
const ADD_LAST = 200_000;

const hitOn = (t: number, target: number): WclEvent =>
	e(t, 'damage', LIGHTNING_BOLT, { targetID: target, targetInstance: 1, amount: 1000, hitType: 1 });

const every5s = (fromMs: number, toMs: number, target: number): WclEvent[] =>
	Array.from({ length: (toMs - fromMs) / 5000 + 1 }, (_, i) => hitOn(fromMs + i * 5000, target));

/** The dot held on one unit across `[fromMs, toMs]`, opened and closed explicitly. */
const dotOn = (target: number, fromMs: number, toMs: number): WclEvent[] => [
	e(fromMs, 'applydebuff', FLAME_SHOCK, { targetID: target, targetInstance: 1 }),
	e(toMs, 'removedebuff', FLAME_SHOCK, { targetID: target, targetInstance: 1 }),
];

const twoEnemyFight = {
	id: 2,
	name: 'Iron Qon',
	encounterID: 1662,
	kill: true,
	difficulty: 4,
	size: 25,
	startTime: T0,
	endTime: T0 + TWO_DURATION,
};

const twoEnemyPull = (extra: WclEvent[]): Analysis & ElementalAuditResult =>
	analyse({
		code: 'ele997',
		fight: twoEnemyFight,
		actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
		actors: [
			{ id: ME, name: 'Sparkstorm', type: 'Player' },
			// `subType: 'Boss'` pins the primary. Without it the busiest enemy wins the pick, and the whole
			// point of this pull is that the primary is the one the player *left*.
			{ id: BOSS, name: 'Iron Qon', type: 'NPC', subType: 'Boss' },
			{ id: ADD, name: 'Quilen Guardian', type: 'NPC', subType: 'NPC' },
		],
		events: [
			...every5s(0, BOSS_LAST, BOSS),
			...every5s(ADD_FIRST, ADD_LAST, ADD),
			// The dot goes on the boss at the bell and stays there for the whole of both stretches, so the
			// primary's lane is one unbroken window and nothing about the *dot* differs between the two pulls.
			...dotOn(BOSS, 0, ADD_LAST),
			...extra,
			e(2000, 'cast', LAVA_BURST, { targetID: BOSS, targetInstance: 1 }),
		],
		table: {
			fight: {
				...twoEnemyFight,
				enemyNPCs: [
					{ id: BOSS, gameID: 71_529 },
					{ id: ADD, gameID: 68_078 },
				],
			},
			damageDone: {
				entries: [
					{
						name: 'Sparkstorm',
						id: ME,
						type: 'Shaman',
						itemLevel: 553,
						total: 41_000,
						activeTime: TWO_DURATION,
						abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 41_000 }],
					},
				],
			},
		},
	}) as Analysis & ElementalAuditResult;

/** Each hit owns the time until the next, so the boss's last hit owns the 5s seam up to the add's first. */
const BOSS_SLICE_MS = ADD_FIRST;
const CONTACT_MS = ADD_LAST;

describe('a pull the player spent half of on something other than the boss', () => {
	const el = twoEnemyPull([]);

	it('is read as Elemental, with the boss as the primary', () => {
		expect(el.isSpec).toBe(true);
		expect(el.primaryTarget?.id).toBe(BOSS);
	});

	/**
	 * The two clocks, as far as the published surface can show them: `contact` runs the whole 200s, and the
	 * dot's own lane runs the whole 200s with it, while the boss took its last hit at 100s. `engaged` is
	 * not published, but it is built from landed hits on the primary alone, so 100 000 is what it can be.
	 */
	it('has a contact clock twice the length of the boss’s own', () => {
		expect(el.timeline?.contactSegments).toEqual([[0, CONTACT_MS]]);
		expect(el.flameShock.windows).toEqual([{ start: 0, end: ADD_LAST }]);
		expect(el.flameShock.uptimeMs).toBe(ADD_LAST);
	});

	/**
	 * 52.5%, and the number is the guard.
	 *
	 * The dot was on the boss for all 200s and the boss is the only thing carrying it, so the numerator is
	 * the 105 000ms the player was demonstrably on the boss — the twenty-one boss hits, the last of which
	 * owns the 5s seam — and the 95s spent on an undotted add scores nothing. Against the 200 000ms contact
	 * clock that is 52.5%.
	 *
	 * Against the arithmetic that shipped before this — the primary's dot over the primary's clock — the
	 * same pull reads 100%, because both halves stopped at 100s together. Against the half-swap that moves
	 * only the denominator it reads 50%. Three answers, none of them within rounding of another, and no
	 * clamp involved in any of them.
	 */
	it('scores the dot over the player’s clock and not the boss’s', () => {
		expect(el.flameShock.scoredMs).toBe(CONTACT_MS);
		expect(el.flameShock.uptimePct).toBeCloseTo((BOSS_SLICE_MS / CONTACT_MS) * 100, 10);
		expect(+el.flameShock.uptimePct.toFixed(1)).toBe(52.5);
	});
});

/**
 * The same pull with the add dotted too, ten seconds after the player arrived on it.
 *
 * This is the pull that holds the *numerator*, and it is the one case a primary-scoped numerator over a
 * contact denominator cannot get right: it would still read 52.5% here, charging 85 seconds of a dot the
 * player really did keep on the enemy in front of them as time the dot was down. The honest reading adds
 * that 85 000ms to the boss's 105 000ms and comes to 95.0%.
 *
 * Ten seconds late rather than immediate, so the answer is not 100% — a share pinned at 100 cannot tell a
 * correct numerator from a clamped one, which is the lesson the first pull in this file records.
 */
describe('the same pull with the add dotted as well', () => {
	const ADD_DOT_START = 115_000;
	const el = twoEnemyPull(dotOn(ADD, ADD_DOT_START, ADD_LAST));

	it('credits the dot on the enemy the player had actually moved to', () => {
		expect(el.flameShock.scoredMs).toBe(CONTACT_MS);
		expect(el.flameShock.uptimePct).toBeCloseTo(((BOSS_SLICE_MS + (ADD_LAST - ADD_DOT_START)) / CONTACT_MS) * 100, 10);
		expect(+el.flameShock.uptimePct.toFixed(1)).toBe(95);
	});

	/**
	 * And the primary's lane is untouched by the add's dot, which is the other half of the split: the drawn
	 * window is still one 200s stretch on the boss, because that is what the lane is labelled with.
	 */
	it('leaves the primary’s drawn lane alone', () => {
		expect(el.flameShock.windows).toEqual([{ start: 0, end: ADD_LAST }]);
		expect(el.flameShock.uptimeMs).toBe(ADD_LAST);
	});
});
