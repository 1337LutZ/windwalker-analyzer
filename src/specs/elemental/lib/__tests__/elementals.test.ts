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

const load = (name: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;

const fx = (name: string): Analysis & ElementalAuditResult => analyse(load(name)) as Analysis & ElementalAuditResult;

describe('the Earth Elemental on two real pulls', () => {
	/** `a:qHRAFwdGzaB6MPYC` #14: pressed at 240.2s of a 258.3s pull, 18.1s left — the list's own rule. */
	it('reads a press inside the last sixty-two seconds as the plan', () => {
		const el = fx('phased');
		expect(el.earthElemental.presses).toEqual([{ t: 240_166, nearEnd: true, inferred: false }]);
		expect(el.durationMs - 240_166).toBeLessThanOrEqual(62_000);
		expect(el.earthElemental.prepull).toBe(false);
	});

	/** `a:xB3kh7v9pF2AHRtq` #16: pressed at 66.7s of a 184.4s pull, 117.8s left — not that rule. */
	it('reads a press with two minutes of pull left as something else', () => {
		const el = fx('unbroken');
		expect(el.earthElemental.presses).toEqual([{ t: 66_657, nearEnd: false, inferred: false }]);
		expect(el.durationMs - 66_657).toBeGreaterThan(62_000);
		expect(el.earthElemental.prepull).toBe(false);
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
/** The Earth Elemental's *aura* id — the buff on the shaman, not the press. See the aura's own note. */
const EARTH_ELEMENTAL_BUFF = 118_323;

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
 * The same pull cut short, for the one branch a 400-second fight cannot reach.
 *
 * A wipe or an early kill is a real pull, and the end-of-fight window is 62 seconds, so a fight shorter
 * than that is the only place `nearEnd` can be true of a summon made before the bell. Built by trimming
 * `make` rather than by a second dataset literal, so the two cannot drift apart in anything but length.
 */
const shortPull = (ms: number, extra: readonly WclEvent[]): FightDataset => {
	const base = make(extra);
	const endTime = T0 + ms;
	return {
		...base,
		fight: { ...base.fight, endTime },
		events: base.events.filter((ev) => ev.timestamp <= endTime),
		table: { ...base.table, fight: { ...base.table.fight, endTime } },
	};
};

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
			{ t: 50_000, reason: 'early', inferred: false },
			{ t: 260_000, reason: null, inferred: false },
			{ t: 280_000, reason: 'sync', inferred: false },
			{ t: 380_000, reason: 'near-end', inferred: false },
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
			{ t: 200_000, nearEnd: false, inferred: false },
			{ t: 338_000, nearEnd: true, inferred: false },
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
		// **And it is counted as a use.** This assertion used to read `toEqual([])` — "nothing was pressed
		// inside the pull", which is true of the *cast stream* and was the whole of §68: the section's
		// "Summons" tile printed that zero under a note saying the elemental was already out. A use with
		// no cast event still used the cooldown, so it is a row, stamped 0 and marked `inferred`.
		expect(prepull.fireElemental.presses).toEqual([{ t: 0, reason: 'prepull', inferred: true }]);
	});

	it('refuses the inference once the stream has shown the summon being made', () => {
		const cast = analyse(
			make([e(10_000, 'cast', FIRE_ELEMENTAL), e(70_000, 'removebuff', FIRE_ELEMENTAL)]),
		) as Analysis & ElementalAuditResult;
		expect(cast.fireElemental.prepull).toBe(false);
		expect(cast.fireElemental.presses).toEqual([{ t: 10_000, reason: 'early', inferred: false }]);
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

/**
 * The same recovery for the Earth Elemental, which had none at all until §68.
 *
 * **No committed fixture exercises any of this, and that asymmetry is why it sat.** `phased` and
 * `unbroken` summon it inside the pull; `cleave` carries neither 2062 nor 118323 and no pet of its own,
 * which is a cooldown genuinely never pressed. So a pull with no press read the same whether the button
 * was unused or spent before the bell, and there was no fixture in which that looked wrong.
 *
 * The events are the shape the fixtures prove: 118323 is the buff on the shaman and 2062 is the press,
 * a millisecond apart on both real summons (`phased` 240.166s, `unbroken` 66.657s). A pre-pull summon
 * leaves only the `removebuff`, which is what these pulls are built from.
 */
describe('an Earth Elemental that was already out at the pull', () => {
	it('reads a bare expiry inside its own minute as a use with no press', () => {
		const el2 = analyse(make([e(40_000, 'removebuff', EARTH_ELEMENTAL_BUFF)])) as Analysis & ElementalAuditResult;
		expect(el2.earthElemental.prepull).toBe(true);
		// `nearEnd` false because this pull is 400s long, so the summon was nowhere near the kill — the
		// same expression a real press gets, not a hardcoded verdict.
		expect(el2.earthElemental.presses).toEqual([{ t: 0, nearEnd: false, inferred: true }]);
	});

	it('counts a pre-pull summon as inside the window on a pull shorter than the window', () => {
		// The reason `nearEnd` is *computed* for an inferred use rather than pinned to false. A 50s pull is
		// shorter than the list's own 62s end-window, so a summon that predates the bell really was inside
		// it — and a hardcoded `false` would say the opposite on exactly the pull where it matters.
		const el2 = analyse(shortPull(50_000, [e(20_000, 'removebuff', EARTH_ELEMENTAL_BUFF)])) as Analysis &
			ElementalAuditResult;
		expect(el2.durationMs).toBe(50_000);
		expect(el2.earthElemental.presses).toEqual([{ t: 0, nearEnd: true, inferred: true }]);
	});

	it('refuses the inference once the stream has shown the summon being made', () => {
		// The press guard, which matters here for the same reason it does for the Fire Elemental: the
		// press (2062) and the buff (118323) are different ids, so `auraWindows`' per-id "was this opening
		// logged" test cannot let one vouch for the other.
		const el2 = analyse(
			make([e(10_000, 'cast', EARTH_ELEMENTAL), e(70_000, 'removebuff', EARTH_ELEMENTAL_BUFF)]),
		) as Analysis & ElementalAuditResult;
		expect(el2.earthElemental.prepull).toBe(false);
		expect(el2.earthElemental.presses).toEqual([{ t: 10_000, nearEnd: false, inferred: false }]);
	});

	it('refuses an expiry that arrives too late to be a pre-pull one', () => {
		// Past the summon's own minute it would have run out already, so the bare removal is evidence of
		// something else. 70s against a 60s duration.
		const el2 = analyse(make([e(70_000, 'removebuff', EARTH_ELEMENTAL_BUFF)])) as Analysis & ElementalAuditResult;
		expect(el2.earthElemental.prepull).toBe(false);
		expect(el2.earthElemental.presses).toEqual([]);
	});

	it('does not read a window opened inside the pull as a pre-pull one', () => {
		const el2 = analyse(
			make([e(10_000, 'applybuff', EARTH_ELEMENTAL_BUFF), e(70_000, 'removebuff', EARTH_ELEMENTAL_BUFF)]),
		) as Analysis & ElementalAuditResult;
		expect(el2.earthElemental.prepull).toBe(false);
	});

	it('reports every committed fixture as not pre-pulled, which is why this suite is synthetic', () => {
		for (const name of ['phased', 'unbroken', 'cleave'] as const) {
			expect(fx(name).earthElemental.prepull, name).toBe(false);
		}
		// And `cleave` is the pull the flag exists for: no press, no evidence either way before now.
		expect(fx('cleave').earthElemental.presses).toEqual([]);
	});
});

/**
 * The Fire Elemental tile counts the pre-pull use, on the real pulls — §68's headline.
 *
 * All three committed pulls summon it before the bell, so all three had `prepull: true` beside a
 * "Summons" tile reading **0**. The count and the table now come off one list, which is what stops them
 * disagreeing again in the other direction.
 */
describe('the pre-pull Fire Elemental is counted as a use on every committed pull', () => {
	for (const name of ['phased', 'unbroken', 'cleave'] as const) {
		it(`${name} publishes one inferred use and no cast press`, () => {
			const el2 = fx(name);
			expect(el2.fireElemental.prepull).toBe(true);
			expect(el2.fireElemental.presses).toEqual([{ t: 0, reason: 'prepull', inferred: true }]);
			// The independent half: the pull really carries no 2894 cast event, which is why the tile could
			// not have seen this use.
			const casts = load(name).events.filter(
				(ev) => (ev as { type: string; abilityGameID?: number }).abilityGameID === FIRE_ELEMENTAL,
			);
			expect(casts.filter((ev) => (ev as { type: string }).type === 'cast')).toEqual([]);
		});
	}
});
