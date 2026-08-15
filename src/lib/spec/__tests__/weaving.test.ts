import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import { scoreAnalysis } from '~/lib/score';
import type { Analysis, FightDataset } from '~/lib/types';

import { analyse } from '../windwalker';

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'));

/** The four consumables that get swapped mid-pull, plus the potion that sits beside them. */
const CONSUMABLES = new Set([105689, 105684, 105682, 105688, 105697]);

/**
 * Elixir weaving, measured on a pull that actually does it.
 *
 * The reference player on the other fixtures takes a potion and nothing else, so every claim this
 * report makes about weaving was until now argued from a log nobody could check. This pull swaps
 * three times.
 *
 * What the tests are for is narrow and worth stating: **the weave must stay free, and it must stay
 * named.** Those are the two things that were ever at stake. It was already free — the accounting
 * counts on-GCD presses and these are not — and this pins that against a future change to how
 * globals are counted. It was *not* named: an ability the spec does not list falls back to `#105684`
 * for its lane, and the timeline picks a cast's tier by matching that lane name, so an unnamed weave
 * sank in among the interrupts and defensives.
 */
describe('elixir weaving', () => {
	const weave = fixture('weave');
	// Narrowed once rather than at each use. A fixture with no timeline is a broken capture, not a
	// case these tests are meant to tolerate, so it should fail loudly here.
	const casts = (weave.timeline?.casts ?? []).filter((c) => CONSUMABLES.has(c.id));

	it('sees the swaps', () => {
		const presses = casts;
		// Three elixir swaps and one potion. Fewer would mean the capture drifted onto another pull;
		// this is the only fixture where the number is the point.
		expect(presses.length).toBeGreaterThanOrEqual(6);
		expect(new Set(presses.map((c) => c.id)).size).toBeGreaterThanOrEqual(2);
	});

	it('names them instead of printing an id', () => {
		// The regression this guards is silent: an unlisted ability still draws, still tooltips, and
		// still sorts — it just does all three under `#105684`. Nothing throws, so only an assertion on
		// the name catches it.
		for (const cast of casts) {
			expect(cast.name).not.toMatch(/^#\d+$/);
			expect(cast.name.length).toBeGreaterThan(0);
		}
	});

	it('never charges a global for one', () => {
		// The whole reason the exclusion is correct. If this flips, the report starts docking players
		// for doing the thing its own copy tells them to do.
		for (const cast of casts) {
			expect(cast.onGcd).toBe(false);
		}
	});

	it('keeps them out of the priority ladder', () => {
		// Not `off-list` — absent. `aplAudit` filters on `onGcd` before judging, so an off-GCD press is
		// never a press the ladder saw at all, and a verdict of any kind here would mean that filter had
		// moved.
		const judged = new Set(weave.apl?.presses.map((p) => p.pressed) ?? []);
		for (const id of CONSUMABLES) expect(judged.has(id)).toBe(false);
	});
});

// ---------------------------------------------------------------------------------------------
// The proc the weave is *for*, and why it is not a missed snapshot.
//
// `weave.json` contains exactly one of these, and the fixture is a captured `Analysis` rather than a
// replayed log — so it cannot demonstrate a change to the engine that produced it. The events below
// are that pull's own timings, to the millisecond, replayed through `analyse` so the before and the
// after are both measurable here:
//
//     procs    5      four Mastery, one Haste
//     brews    5      at 10.229 / 57.190 / 85.851 / 110.249 / 125.620
//     swaps    3      Elixir of the Rapids 1ms after a brew, Monk's Elixir ~9.5s later
//
// The Haste proc at 111.328 is the one under test. It exists *because* of the swap at 110.250, and
// a second brew during it could not have held anything — Tigereye Brew freezes
// `0.05 + masteryPercent` and the Rune had just stopped returning mastery.

const T0 = 100_000;
const ME = 5;
const BOSS = 20;

const RE_ORIGINATION = { Mastery: 139120, Haste: 139121 } as const;
const BANK = 1247279;
const BREW = 1247275;
/** +750 haste. Cancels the flask, and is what makes the next proc a Haste proc. */
const RAPIDS = 105684;
/** +750 *mastery*, which is why swapping to it is how a weave ends rather than how one begins. */
const MONKS = 105688;
/** A combat potion: its own exclusive category, so it cancels nothing and opens no weave. */
const VIRMENS = 105697;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

const proc = (stat: keyof typeof RE_ORIGINATION, start: number, end: number): WclEvent[] => [
	e(start, 'applybuff', RE_ORIGINATION[stat]),
	e(end, 'removebuff', RE_ORIGINATION[stat]),
];

/** The bank drain that pays for a brew, and the fifteen seconds it opens a millisecond later. */
const brew = (drain: number, leaving: number): WclEvent[] => [
	e(drain, 'removebuffstack', BANK, { stack: leaving }),
	e(drain + 1, 'applybuff', BREW),
	e(drain + 1 + 15_000, 'removebuff', BREW),
];

/** The bank climbing one stack a second, which is faster than a real rotation and does not need not to be. */
const gains = (t: number, from: number, count: number): WclEvent[] =>
	Array.from({ length: count }, (_, i) => e(t + i * 1000, 'applybuffstack', BANK, { stack: from + i + 1 }));

const DURATION = 129_531;

const dataset = (events: WclEvent[]): FightDataset => ({
	code: 'abc123',
	fight: {
		id: 11,
		name: 'Iron Juggernaut',
		encounterID: 1616,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: T0 + DURATION,
	},
	actor: { id: ME, name: 'Player (25)', type: 'Player' },
	actors: [{ id: ME, name: 'Player (25)', type: 'Player' }],
	events: [
		e(500, 'damage', 1, { targetID: BOSS, amount: 10_000, hitType: 1 }),
		{ timestamp: T0, type: 'combatantinfo', sourceID: ME, gear: [] } as unknown as WclEvent,
		...events,
	],
	table: {
		fight: {
			id: 11,
			name: 'Iron Juggernaut',
			encounterID: 1616,
			kill: true,
			difficulty: 4,
			size: 25,
			startTime: T0,
			endTime: T0 + DURATION,
			enemyNPCs: [{ id: BOSS, gameID: 71466 }],
		},
		damageDone: { entries: [{ name: 'Player (25)', id: ME, type: 'Monk', total: 10_000, activeTime: DURATION }] },
	},
});

/**
 * The pull, with the swap timings as a parameter so the ordering test has something to fail on.
 *
 * `swapAt` is when Elixir of the Rapids goes out relative to the brew's bank drain at 110.249. The
 * log says +1ms on all three of its swaps; anything meaningfully earlier is a swap made *before* the
 * multiplier was frozen, which lowers it.
 */
const pull = (swapAt: number, closeAt = 119_912): FightDataset =>
	dataset([
		e(0, 'applybuff', BANK),
		...gains(100, 0, 8),
		...proc('Mastery', 926, 10_925),
		...brew(10_229, 0),
		e(10_230, 'cast', RAPIDS),
		e(19_531, 'cast', MONKS),
		...gains(11_000, 0, 15),
		...brew(57_190, 5),
		...gains(58_000, 5, 10),
		...proc('Mastery', 77_011, 87_018),
		...brew(85_851, 5),
		e(85_852, 'cast', RAPIDS),
		e(90_541, 'cast', VIRMENS),
		e(95_368, 'cast', MONKS),
		...gains(87_000, 5, 9),
		...proc('Mastery', 101_134, 111_131),
		...brew(110_249, 4),
		e(swapAt, 'cast', RAPIDS),
		// The Haste proc the swap bought, arriving 1.079s later — inside the elixir's window and while
		// the brew that froze Mastery is still running.
		...proc('Haste', 111_328, 121_317),
		e(closeAt, 'cast', MONKS),
		...gains(111_500, 4, 4),
		...proc('Mastery', 121_584, 129_531),
		...brew(125_620, 0),
	]);

describe('a proc weaved past on purpose', () => {
	const a = analyse(pull(110_250));
	const w = a.procs.windows[3];

	it('is the Haste proc the swap produced', () => {
		// The whole reading in one assertion: the elixir live at a proc's start predicts its stat. Four
		// procs under the flask or Monk's Elixir come back Mastery; the one under Elixir of the Rapids
		// comes back Haste.
		expect(a.procs.windows.map((p) => p.stat)).toEqual(['Mastery', 'Mastery', 'Mastery', 'Haste', 'Mastery']);
		expect(w?.start).toBe(111_328);
		expect(w?.snapshotAt).toBeNull();
		expect(w?.brewAlreadyUp).toBe(true);
		expect(w?.heldStat).toBe('Mastery');
	});

	it('is marked as weaved rather than missed', () => {
		expect(w?.weaved).toBe(true);
		expect(a.procs.weaved).toBe(1);
		// And it is the only one: a rule that fires on four Mastery procs under a mastery elixir would
		// forgive the whole pull.
		expect(a.procs.windows.filter((p) => p.weaved === true)).toHaveLength(1);
	});

	it('leaves the denominator instead of being counted as caught', () => {
		// Not moved into the numerator — no brew was cast, and claiming one would put a bar on the depth
		// chart for a snapshot that never happened. It leaves `opportunities`, which is the same exit
		// `unaffordable` already uses for a proc there was no chance to take.
		expect(a.procs.snapshotted).toBe(4);
		expect(a.procs.opportunities).toBe(4);
		expect(a.procs.procs).toBe(5);
		// And it is not laundered through the count that says "too few stacks banked", which would be
		// the wrong reason printed under the right number.
		expect(a.procs.unaffordable).toBe(0);
	});

	it('lifts the heaviest metric on the card off a fault that was not one', () => {
		const rate = scoreAnalysis(a).sections.snapshots?.metrics.find((m) => m.key === 'snapshotRate');
		expect(rate?.value).toBe(100);
	});

	it('stops appearing on the ledger and in the time given away', () => {
		expect(a.misses.some((m) => m.kind === 'Rune proc unsnapshotted (Haste)')).toBe(false);
		expect(a.procs.unsnapshotted).toBe(0);
		// 16.6s in the captured fixture, of which the weaved proc's whole 9.989s window was its largest
		// single contributor. What is left is the four caught procs' tails.
		expect(a.procs.secondsGivenAway).toBe(6.7);
	});
});

describe('what the rule refuses to forgive', () => {
	/**
	 * The ordering, which is mechanical. Monk's Elixir is +750 mastery, so dropping it before the brew
	 * lowers the multiplier the brew is about to freeze — a real cost, and one the report has to keep
	 * charging or the rule becomes "press an elixir near a brew and stop being graded".
	 */
	it('does not forgive a swap made before the brew froze the multiplier', () => {
		const a = analyse(pull(110_240));
		expect(a.procs.windows[3]?.weaved).toBeUndefined();
		expect(a.procs.opportunities).toBe(5);
		expect(a.misses.some((m) => m.kind === 'Rune proc unsnapshotted (Haste)')).toBe(true);
	});

	/** One millisecond either side of the drain is the log's own stamp spread, and is allowed. */
	it('allows the millisecond of slop the log actually shows', () => {
		expect(analyse(pull(110_249)).procs.windows[3]?.weaved).toBe(true);
		expect(analyse(pull(110_248)).procs.windows[3]?.weaved).toBeUndefined();
	});

	/**
	 * A swap already reversed by the time the proc lands explains nothing about it. Closing the weave
	 * at 111.0s puts Monk's Elixir — mastery — back on top before the proc at 111.328, so whatever that
	 * proc returned, this player did not engineer it.
	 */
	it('does not forgive a proc that landed after the swap was reversed', () => {
		const a = analyse(pull(110_250, 111_000));
		expect(a.procs.windows[3]?.weaved).toBeUndefined();
		expect(a.procs.opportunities).toBe(5);
	});

	/** Every other fixture takes a potion and nothing else, so none of them may acquire a free pass. */
	it('fires on no other pull in the sample', () => {
		for (const name of ['strong', 'mixed', 'poor', 'waves', 'cleave']) {
			expect(fixture(name).procs.windows.some((p) => p.weaved === true)).toBe(false);
		}
	});
});
