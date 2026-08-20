// The two summons the p5 list judges by its own rules rather than by a cooldown clock.
//
// Earth Elemental is pressed almost entirely in end-of-fight terms (`remainingTime <= 62s`), so a drift
// verdict on it would call the list's own plan a fault. Fire Elemental has three branches — the pull's
// last minute, a sync with Ascendance, or early enough to come back before the kill — and the order they
// are tried in is part of the rule, because a press can satisfy two of them at once.
//
// The Earth Elemental is checked on the committed pulls, which happen to carry one press each and one on
// either side of the threshold. The Fire Elemental cannot be: every shaman in the test set summoned it
// *before* the bell, so `presses` is empty on all of them and there is no in-fight press to judge. Its
// branches are synthetic.
//
// That sentence used to end "and `prepull` false on both", which was this file reading back a bug —
// plan step 48. The aura declared only the id the press is cast under and none that a log ever applies
// as a buff, so the pre-pull recovery had nothing to find. All three pulls carry it; see
// `firePrepull.test.ts` for the expiry each one left behind.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '../index';

const fx = (name: string): Analysis & ElementalAuditResult => {
	const dataset = JSON.parse(
		readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'),
	) as FightDataset;
	return analyse(dataset) as Analysis & ElementalAuditResult;
};

describe('the Earth Elemental on two real pulls', () => {
	/** `a:qHRAFwdGzaB6MPYC` #14: pressed at 240.2s of a 258.3s pull, 18.1s left — the list's own rule. */
	it('reads a press inside the last sixty-two seconds as the plan', () => {
		const el = fx('phased');
		expect(el.earthElemental.presses).toEqual([{ t: 240_166, nearEnd: true }]);
		expect(el.durationMs - 240_166).toBeLessThanOrEqual(62_000);
	});

	/** `a:xB3kh7v9pF2AHRtq` #16: pressed at 66.7s of a 184.4s pull, 117.8s left — not that rule. */
	it('reads a press with two minutes of pull left as something else', () => {
		const el = fx('unbroken');
		expect(el.earthElemental.presses).toEqual([{ t: 66_657, nearEnd: false }]);
		expect(el.durationMs - 66_657).toBeGreaterThan(62_000);
	});
});

// ------------------------------------------------------------------ synthetic

const T0 = 2_000_000;
const DURATION = 400_000;
const ME = 7;
const BOSS = 15;

const LIGHTNING_BOLT = 403;
const LAVA_BURST = 51_505;
const ASCENDANCE = 114_049;
const FIRE_ELEMENTAL = 2894;
const EARTH_ELEMENTAL = 2062;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

const contact: WclEvent[] = Array.from({ length: DURATION / 5000 + 1 }, (_, i) =>
	e(i * 5000, 'damage', LIGHTNING_BOLT, { targetID: BOSS, targetInstance: 1, amount: 1000, hitType: 1 }),
);

const fight = {
	id: 5,
	name: 'Iron Qon',
	encounterID: 1662,
	kill: true,
	difficulty: 4,
	size: 25,
	startTime: T0,
	endTime: T0 + DURATION,
};

const make = (extra: readonly WclEvent[]): FightDataset => ({
	code: 'ele-pets',
	fight,
	actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
	actors: [
		{ id: ME, name: 'Sparkstorm', type: 'Player' },
		{ id: BOSS, name: 'Iron Qon', type: 'NPC', subType: 'Boss' },
	],
	// A Lava Burst so `identify` accepts the pull as Elemental at all.
	events: [...contact, e(500, 'cast', LAVA_BURST, { targetID: BOSS, targetInstance: 1 }), ...extra],
	table: {
		fight: { ...fight, enemyNPCs: [{ id: BOSS, gameID: 68_078 }] },
		damageDone: {
			entries: [
				{
					name: 'Sparkstorm',
					id: ME,
					type: 'Shaman',
					itemLevel: 553,
					total: 81_000,
					activeTime: DURATION,
					abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 81_000 }],
				},
			],
		},
	},
});

/**
 * Four Fire Elemental presses on one pull, which no five-minute cooldown allows — and that is the point.
 *
 * `fePresses` never reads the cooldown: each press is judged against the p5 list's rule and nothing
 * else, which is exactly what makes the four branches reachable from one event stream. One Ascendance at
 * 100s sets the sync clock for all of them, since `ascendanceReadyInSec` reads the last press at or
 * before the moment being asked about.
 *
 *   50s    350s of pull left — `early`, the press that will be back before the kill
 *   260s   140s left, Ascendance 20s away — no branch at all
 *   280s   120s left, Ascendance back inside 5s — `sync`
 *   380s   20s left — `near-end`, and *also* inside the sync window, so this is the precedence test
 */
const el = analyse(
	make([
		e(100_000, 'cast', ASCENDANCE),
		e(50_000, 'cast', FIRE_ELEMENTAL),
		e(260_000, 'cast', FIRE_ELEMENTAL),
		e(280_000, 'cast', FIRE_ELEMENTAL),
		e(380_000, 'cast', FIRE_ELEMENTAL),
		e(200_000, 'cast', EARTH_ELEMENTAL),
		e(338_000, 'cast', EARTH_ELEMENTAL),
	]),
) as Analysis & ElementalAuditResult;

describe('which of the list’s branches each Fire Elemental press hit', () => {
	it('reads the pull the way it was built', () => {
		expect(el.isSpec).toBe(true);
		expect(el.durationMs).toBe(DURATION);
	});

	it('names a branch for every press, and null where the list would not have pressed', () => {
		expect(el.fireElemental.presses).toEqual([
			{ t: 50_000, reason: 'early' },
			{ t: 260_000, reason: null },
			{ t: 280_000, reason: 'sync' },
			{ t: 380_000, reason: 'near-end' },
		]);
	});

	/**
	 * The press at 380s satisfies `near-end` (20s left) and `sync` (Ascendance is long back) at once, and
	 * the rule is tried near-end first. Reported as `sync` it would read as a cooldown pairing rather
	 * than as the end-of-fight dump it is.
	 */
	it('tries near-end before sync where a press satisfies both', () => {
		expect(el.fireElemental.presses.find((p) => p.t === 380_000)?.reason).toBe('near-end');
		expect(DURATION - 380_000).toBeLessThan(60_000);
	});

	/** A press with no branch is not a press the audit refuses to see: it is a press the list would not make. */
	it('still counts a press that matched nothing', () => {
		expect(el.fireElemental.presses).toHaveLength(4);
	});
});

describe('the Earth Elemental’s threshold', () => {
	/** `remainingTime <= 62s`, so a press with exactly 62 seconds left is inside the rule, not outside it. */
	it('includes a press at exactly sixty-two seconds left', () => {
		expect(DURATION - 338_000).toBe(62_000);
		expect(el.earthElemental.presses).toEqual([
			{ t: 200_000, nearEnd: false },
			{ t: 338_000, nearEnd: true },
		]);
	});
});

/**
 * Whether the elemental was already out when the bell went — the prepull press the list makes when
 * Heroism is going up on the pull.
 *
 * A fight-scoped event query returns nothing of a summon made before the pull but its expiry, so this is
 * `auraWindows`' pre-pull inference: a bare `removebuff` of 2894 inside the aura's own sixty seconds,
 * with nothing in the stream having opened it. Both guards matter, and both are checked here.
 */
describe('a Fire Elemental that was already out at the pull', () => {
	it('reads a bare expiry inside its own duration as a prepull press', () => {
		const prepull = analyse(make([e(40_000, 'removebuff', FIRE_ELEMENTAL)])) as Analysis & ElementalAuditResult;
		expect(prepull.fireElemental.prepull).toBe(true);
		// And it is not counted as a press: nothing was pressed inside the pull.
		expect(prepull.fireElemental.presses).toEqual([]);
	});

	it('refuses the inference once the stream has shown the summon being made', () => {
		const cast = analyse(
			make([e(10_000, 'cast', FIRE_ELEMENTAL), e(70_000, 'removebuff', FIRE_ELEMENTAL)]),
		) as Analysis & ElementalAuditResult;
		expect(cast.fireElemental.prepull).toBe(false);
		expect(cast.fireElemental.presses).toEqual([{ t: 10_000, reason: 'early' }]);
	});

	/** An expiry past the summon's own minute cannot be a prepull one — it would have run out already. */
	it('refuses an expiry that arrives too late to be a prepull one', () => {
		const late = analyse(make([e(90_000, 'removebuff', FIRE_ELEMENTAL)])) as Analysis & ElementalAuditResult;
		expect(late.fireElemental.prepull).toBe(false);
	});

	/**
	 * A window is not the same claim as a *preexisting* window.
	 *
	 * The question is whether the elemental was out **at the bell**, so a paired apply and remove inside
	 * the pull — a log that books the summon as a buff on the shaman rather than only as a cast — is a
	 * window `auraWindows` returns and `prepull` must still read false for. Reading the window count
	 * instead of the flag would call any pull that summoned it a prepull one.
	 */
	it('does not read a window opened inside the pull as a prepull press', () => {
		const inside = analyse(
			make([e(10_000, 'applybuff', FIRE_ELEMENTAL), e(70_000, 'removebuff', FIRE_ELEMENTAL)]),
		) as Analysis & ElementalAuditResult;
		expect(inside.fireElemental.prepull).toBe(false);
	});
});
