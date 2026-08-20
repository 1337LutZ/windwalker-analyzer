// The pull that made Flame Shock's uptime read 100.21%, rebuilt as a synthetic one.
//
// The report it was seen on belongs to a named player, so it cannot be committed as a fixture — this is
// the same *shape* with the same clocks, and the numbers are the ones that report produced: the last
// landed hit on the boss at 364.238s, the dot's `removedebuff` at 365.014s, and a 365 155ms fight. The
// dot never fell off, so the numerator ran 365 010ms while the engaged clock — built from the player's
// own landed non-tick hits on the primary target, so it cannot start before the first or run past the
// last — ran 364 234ms. 365 010 / 364 234 is 100.2130%.
//
// Neither committed anonymous fixture tips over, but both carry the shape: `unbroken` sits at 99.99945%
// with the dot closing 1ms *inside* the engaged clock, and `phased` has 125ms of dot past the last hit
// which the old arithmetic credited against a span that does not contain it.
//
// Two pulls here, and the second is the one that keeps this file honest. The first would pass on the
// clamp inside `uptimePct` alone, because a clamped overflow and a correct share are both 100. The
// second overruns the same clock while also leaving a real gap, so it is under 100 either way and only
// the arithmetic can tell the two answers apart.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { WclEvent } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '../index';

const T0 = 1_000_000;
/** The real pull's length, to the millisecond. */
const DURATION = 365_155;
const ME = 9;
const BOSS = 410;

/** The last landed hit on the boss, and where the engaged clock therefore stops. */
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
 * Every five seconds, well inside the 15s gap that would split the engaged clock in two, so `engaged`
 * comes back as the single stretch `[START, LAST_HIT]` — the shape of a pull nobody ever left. The
 * dot's own initial hit is the first of them, which is why the two clocks start together and the whole
 * disagreement is at the tail.
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

/** The engaged clock this file measures against: first landed hit to last, and nothing beyond. */
const ENGAGED_MS = LAST_HIT - START;

describe('a dot that outlives the last hit on the boss', () => {
	const el = run([[START, DOT_END]]);

	it('is read as Elemental at all', () => {
		expect(el.isSpec).toBe(true);
		expect(el.durationMs).toBe(DURATION);
	});

	/**
	 * The two spans, so a future reader can see they disagree without re-deriving either.
	 *
	 * `engagedMs` is not published on the audit surface — plan step 29 — so the landed-hit clock is read
	 * here off `contactSegments`, which on this pull is the same array: every hit in the stream is the
	 * player's own, direct, and on the boss, so the player's clock and the boss's are built from one set
	 * of stamps and both stop at `LAST_HIT`. The dot's window does not.
	 */
	it('has a dot window that runs past where the landed-hit clock stops', () => {
		expect(el.flameShock.windows).toEqual([{ start: START, end: DOT_END }]);
		expect(el.timeline?.contactSegments).toEqual([[START, LAST_HIT]]);
		expect(DOT_END).toBeGreaterThan(LAST_HIT);
	});

	/**
	 * The regression, and the figure a user reported. 365 010ms of dot against a 364 234ms engaged clock
	 * is 100.2130%, and the 776ms of difference is the dot ticking on a boss that had already taken its
	 * last hit. Clipped to the clock it is scored against, the same pull is exactly 100%: the dot was up
	 * for every millisecond of the fight the denominator can see.
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
 * 0–100s and 200s–365.014s of dot: 265 010ms drawn, of which 264 234ms falls inside the engaged clock,
 * because the tail is clipped at 364.238s. Against 364 234ms that is 72.5451% clipped and 72.7582%
 * unclipped — two answers a hundred milliseconds apart in the middle of the range, where no clamp can
 * step in and make them agree.
 */
describe('a dot that outlives the last hit and dropped once besides', () => {
	const el = run([
		[START, 100_000],
		[200_000, DOT_END],
	]);

	it('scores only the coverage the engaged clock contains', () => {
		expect(el.flameShock.uptimeMs).toBe(100_000 - START + (DOT_END - 200_000));
		expect(+el.flameShock.uptimePct.toFixed(4)).toBe(
			+(((100_000 - START + (LAST_HIT - 200_000)) / ENGAGED_MS) * 100).toFixed(4),
		);
		expect(el.flameShock.uptimePct).toBeLessThan(72.7);
	});
});

/**
 * The ratio is a ratio, on both real pulls.
 *
 * This is the check the audit could not express until `scoredMs` was published. `uptimeMs` and
 * `uptimePct` were both readable and neither could be derived from the other, so a numerator and a
 * denominator measured over different spans produced 100.21% and no test could have noticed.
 *
 * `uptimeMs` is deliberately *not* what the percentage divides — it is the dot's whole life, which the
 * timeline draws and the drop ledger reads, while the share clips it to the engaged clock first. So the
 * assertion is the one that holds either way: recover the numerator from the share and it cannot exceed
 * the dot's whole life.
 *
 * What this catches, precisely: a `scoredMs` naming the wrong span. Wire it to `duration` instead of the
 * engaged clock and all three pulls fail, because the recovered numerator then exceeds `uptimeMs` by the
 * time the boss was away. What it does **not** catch is the numerator and denominator being measured
 * over different spans — the bug that produced 100.21% — because neither committed pull tips over. The
 * synthetic pulls above are what hold that, and they are two rather than one for exactly this reason: a
 * clamped overflow and a correct share are both 100, so the second pull drops the dot as well and lands
 * mid-range where no clamp can make the two readings agree.
 */
const fx = (name: string): Analysis & ElementalAuditResult =>
	analyse(
		JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset,
	) as Analysis & ElementalAuditResult;

describe('the published denominator', () => {
	for (const name of ['phased', 'unbroken', 'cleave'] as const) {
		it(`${name} reports a share of a span it names`, () => {
			const fs = fx(name).flameShock;
			expect(fs.scoredMs).toBeGreaterThan(0);
			expect(fs.uptimePct).toBeLessThanOrEqual(100);
			// The clipped numerator, recovered from the share, cannot exceed the dot's whole life.
			const clippedMs = (fs.uptimePct / 100) * fs.scoredMs;
			expect(clippedMs).toBeLessThanOrEqual(fs.uptimeMs + 1);
		});
	}
});
