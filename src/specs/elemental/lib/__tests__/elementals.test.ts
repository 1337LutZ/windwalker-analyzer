// The two summons the p5 list judges by its own rules rather than by a cooldown clock.
//
// Earth Elemental is pressed almost entirely in end-of-fight terms (`remainingTime <= 62s`), so a drift
// verdict on it would call the list's own plan a fault. Fire Elemental has three branches — the pull's
// last minute, a sync with Ascendance, or early enough to come back before the kill — and the order they
// are tried in is part of the rule, because a press can satisfy two of them at once.
//
// The Earth Elemental is checked on the committed pulls, which happen to carry one press each and one on
// either side of the threshold. The Fire Elemental cannot be: every shaman in the test set summoned it
// *before* the pull, so `presses` is empty on all of them and there is no in-fight press to judge. Its
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
import { rawFixtures } from '~/lib/analysis/fixtures';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse, registry } from '../index';

const load = (name: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;

/** Memoised: the sweep below walks every committed pull and `addsThenBoss.json` is 4.4 MB. */
const analysed = new Map<string, Analysis & ElementalAuditResult>();
const fx = (name: string): Analysis & ElementalAuditResult => {
	const hit = analysed.get(name);
	if (hit !== undefined) return hit;
	const el = analyse(load(name)) as Analysis & ElementalAuditResult;
	analysed.set(name, el);
	return el;
};

/** Every raw Elemental pull, found rather than listed. */
const FIXTURES = rawFixtures('elemental').map(({ name }) => name.replace(/\.json$/, ''));

describe('the Earth Elemental on two real pulls', () => {
	/** `a:qHRAFwdGzaB6MPYC` #14: pressed at 240.2s of a 258.3s pull, 18.1s left — branch A of the rule. */
	it('reads a press inside the last sixty-two seconds as the plan', () => {
		const el = fx('phased');
		expect(el.earthElemental.presses).toEqual([{ t: 240_166, verdict: 'near-end', inferred: false }]);
		expect(el.durationMs - 240_166).toBeLessThanOrEqual(62_000);
		expect(el.earthElemental.prepull).toBe(false);
		// Branch A is the only one a log reads to true, so a `near-end` press is the graded numerator and
		// its own denominator.
		expect([el.earthElemental.good, el.earthElemental.graded]).toEqual([1, 1]);
	});

	/**
	 * `a:xB3kh7v9pF2AHRtq` #16: pressed at 66.7s of a 184.4s pull, 117.8s left — and **every** branch of
	 * the rule refuses it, which is what makes it a fault rather than a "cannot say".
	 *
	 * Each refutation is asserted from the log's own facts below rather than taken on trust, because the
	 * whole point of the three-valued verdict is that `off-rule` and `unknown` are different claims.
	 */
	it('refutes a press with two minutes of pull left on every branch of the rule', () => {
		const el = fx('unbroken');
		expect(el.earthElemental.presses).toEqual([{ t: 66_657, verdict: 'off-rule', inferred: false }]);
		expect(el.earthElemental.prepull).toBe(false);
		expect([el.earthElemental.good, el.earthElemental.graded]).toEqual([0, 1]);

		// A: 117.8s left, and the branch wants 62 or less.
		expect(el.durationMs - 66_657).toBeGreaterThan(62_000);
		// B: `spellTimeToReady(114049) <= 20s`. Ascendance was pressed at 3.7s and its cooldown is 180s,
		// so it is 117.0 seconds away at the press. Read off the cast stream, not off the audit.
		const ascCasts = (el.timeline?.casts ?? []).filter((c) => c.id === 114_049).map((c) => c.t);
		expect(ascCasts[0]).toBe(3676);
		expect((ascCasts[0]! + 180_000 - 66_657) / 1000).toBeGreaterThan(20);
		// C: `shamanFireElementalDuration < 60s` is Glyph of Fire Elemental Totem, and this shaman's
		// summon was up for 58.0 seconds — which no thirty-second summon can be. Off the aura lane.
		const fe = (el.timeline?.lanes ?? []).find((l) => l.key === 'fire-elemental')?.windows ?? [];
		expect(fe).toHaveLength(1);
		expect(fe[0]!.end - fe[0]!.start).toBeGreaterThan(30_000);
	});

	/**
	 * `cleave` never presses it, so it has nothing to grade — and `graded` says zero rather than the
	 * section quietly reading a perfect share off an empty list.
	 */
	it('grades nothing on the pull that never pressed it', () => {
		const el = fx('cleave');
		expect(el.earthElemental.presses).toEqual([]);
		expect([el.earthElemental.good, el.earthElemental.graded]).toEqual([0, 0]);
	});

	/**
	 * Its cooldown is the sim's `CD.Duration`, and that is the same five minutes the Fire Elemental has.
	 *
	 * Asserted as the *pairing* rather than as the literal, because the pairing is the fact:
	 * `earth_elemental_totem.go` and `fire_elemental_totem.go` carry the identical `CD.Duration:
	 * time.Minute * 5` and the identical one-minute `SharedCD`, so the two summons cannot disagree here.
	 * The field read 120 000 — neither of the sim's two numbers.
	 *
	 * The second half is why the correction was safe to make: `gate: 'other'` keeps it out of `lostCasts`
	 * entirely, so no drift, no lost cast and no grade reads the number on the pull that presses it.
	 */
	it("carries the sim's five minutes, and no scored figure reads it", () => {
		expect(registry.ability('earth-elemental').cooldownMs).toBe(registry.ability('fire-elemental').cooldownMs);
		expect(registry.ability('earth-elemental').gate).toBe('other');
		const el = fx('phased');
		expect(el.earthElemental.presses).toHaveLength(1);
		expect(el.lostCasts.map((row) => row.name)).not.toContain('Earth Elemental');
	});
});

describe('the Earth Elemental has a timeline row', () => {
	const laneOn = (name: string) =>
		((fx(name) as Analysis).timeline?.lanes ?? []).find((l) => l.key === 'earth-elemental');

	/**
	 * The bar is the log's own `applybuff`→`removebuff` pair, so its length is the elemental's minute —
	 * which is the thing the press mark alone cannot show, and the reason this earns a row: the summon
	 * held the earth totem slot for sixty of the pull's seconds.
	 */
	it('draws the whole minute on the pull that logged both ends', () => {
		const lane = laneOn('unbroken');
		// The press is at 66 657 (above); the `applybuff` is the millisecond before it, as the aura's own
		// note records for both fixtures that carry it.
		expect(lane?.windows).toEqual([{ start: 66_656, end: 126_657 }]);
		const [window] = lane?.windows ?? [];
		expect((window?.end ?? 0) - (window?.start ?? 0)).toBeCloseTo(60_000, -1);
	});

	/** And a summon the kill cut short is drawn short, marked as truncated rather than as a full minute. */
	it('clips the bar at the kill and says so', () => {
		const el = fx('phased');
		expect(laneOn('phased')?.windows).toEqual([{ start: 240_166, end: el.durationMs, truncated: true }]);
	});

	/** `cleave` carries neither 2062 nor 118323, so there is nothing to draw and no empty row drawn. */
	it('draws no row on the pull that never summoned it', () => {
		expect(laneOn('cleave')).toBeUndefined();
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
 * than that is the only place branch A can be true of a summon made before the pull. Built by trimming
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
const FOUR_SUMMONS: readonly WclEvent[] = [
	e(100_000, 'cast', ASCENDANCE),
	e(50_000, 'cast', FIRE_ELEMENTAL),
	e(260_000, 'cast', FIRE_ELEMENTAL),
	e(280_000, 'cast', FIRE_ELEMENTAL),
	e(380_000, 'cast', FIRE_ELEMENTAL),
	e(200_000, 'cast', EARTH_ELEMENTAL),
	e(338_000, 'cast', EARTH_ELEMENTAL),
];
const fourSummons = make(FOUR_SUMMONS);
const el = analyse(fourSummons) as Analysis & ElementalAuditResult;

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
			{ t: 200_000, verdict: 'unknown', inferred: false },
			{ t: 338_000, verdict: 'near-end', inferred: false },
		]);
		// One graded press, one `unknown` out of the denominator entirely.
		expect([el.earthElemental.good, el.earthElemental.graded]).toEqual([1, 1]);
	});

	/**
	 * *** The 200s press reads `unknown` even though branch B is plainly refuted, and that is the
	 * inference refusing to prove itself. ***
	 *
	 * B is refuted here: Ascendance is pressed once at 100s against a 180-second cooldown, so it is
	 * eighty seconds away at 200s and B's `spellTimeToReady(114049) <= 20s` is false off the log. But the
	 * verdict is an **or**, so branch C has to be refuted too, and C opens on
	 * `shamanFireElementalDuration < 60s` — Glyph of Fire Elemental Totem.
	 *
	 * This pull carries four Fire Elemental **casts** and no Fire Elemental buff events at all. The
	 * timeline still draws four sixty-second bars, because the fire-slot walk gives a cast-derived
	 * placement the duration this module *declares* — so reading the glyph out of that lane would be
	 * `FIRE_ELEMENTAL_DURATION_MS` proving `FIRE_ELEMENTAL_DURATION_MS`. The inference reads the aura's
	 * own `applybuff`→`removebuff` windows instead, this stream has none, and the honest answer is that
	 * the glyph is unreadable and so is C.
	 *
	 * Asserted as the pair — the drawn lane long, the aura windows absent — because the two agreeing
	 * would be the bug, and a future change that repointed the inference at `feWindows` would turn this
	 * `unknown` into a fault nobody measured.
	 */
	it('refuses a cast-derived window as evidence about the glyph', () => {
		expect(el.earthElemental.presses.find((p) => p.t === 200_000)?.verdict).toBe('unknown');
		// Ascendance, off the cast stream: one press at 100s, 180s cooldown, so 80s away at the press —
		// branch B really is refutable here, and the `unknown` is C's doing rather than B's.
		const ascCasts = (el.timeline?.casts ?? []).filter((c) => c.id === ASCENDANCE).map((c) => c.t);
		expect(ascCasts).toEqual([100_000]);
		expect((100_000 + 180_000 - 200_000) / 1000).toBeGreaterThan(20);
		// The drawn lane is long, and it is drawn from casts.
		const drawn = (el.timeline?.lanes ?? []).find((l) => l.key === 'fire-elemental')?.windows ?? [];
		expect(drawn.some((w) => w.end - w.start > 30_000)).toBe(true);
		expect((el.timeline?.casts ?? []).filter((c) => c.id === FIRE_ELEMENTAL)).toHaveLength(4);
		// And the stream carries no Fire Elemental aura event for any of them, which is why the glyph is
		// unreadable — the events this pull is built from are casts only. Read off the dataset itself.
		expect(
			fourSummons.events.filter(
				(ev) =>
					(ev as { abilityGameID?: number }).abilityGameID === FIRE_ELEMENTAL &&
					(ev as { type: string }).type !== 'cast',
			),
		).toEqual([]);
	});
});

/**
 * Whether the elemental was already out when the pull started — the prepull press the list makes when
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
	 * The question is whether the elemental was out **at the pull**, so a paired apply and remove inside
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
 * was unused or spent before the pull, and there was no fixture in which that looked wrong.
 *
 * The events are the shape the fixtures prove: 118323 is the buff on the shaman and 2062 is the press,
 * a millisecond apart on both real summons (`phased` 240.166s, `unbroken` 66.657s). A pre-pull summon
 * leaves only the `removebuff`, which is what these pulls are built from.
 */
describe('an Earth Elemental that was already out at the pull', () => {
	it('reads a bare expiry inside its own minute as a use with no press', () => {
		const el2 = analyse(make([e(40_000, 'removebuff', EARTH_ELEMENTAL_BUFF)])) as Analysis & ElementalAuditResult;
		expect(el2.earthElemental.prepull).toBe(true);
		// Not `near-end`, because this pull is 400s long and the summon was nowhere near the kill — the
		// same expression a real press gets, not a hardcoded verdict.
		//
		// **And `unknown` rather than `off-rule`, which is this pull earning its keep.** There is no Fire
		// Elemental anywhere in this event stream, so `shamanFireElementalDuration` has no observed window
		// to be read off and branch B's `== 60s` term cannot be answered — nor can branch C's `< 60s`. With
		// nothing left to refute either branch, the honest verdict is silence. It is the only place in the
		// suite the third value is reached, because every real pull in the fixtures summons the elemental.
		expect(el2.earthElemental.presses).toEqual([{ t: 0, verdict: 'unknown', inferred: true }]);
		// Inferred, so it is graded neither way: the list has no pre-pull Earth Elemental play (§75).
		expect([el2.earthElemental.good, el2.earthElemental.graded]).toEqual([0, 0]);
	});

	it('counts a pre-pull summon as inside the window on a pull shorter than the window', () => {
		// The reason the verdict is *computed* for an inferred use rather than pinned. A 50s pull is
		// shorter than the list's own 62s end-window, so a summon that predates the pull really was inside
		// it — and a hardcoded `false` would say the opposite on exactly the pull where it matters.
		const el2 = analyse(shortPull(50_000, [e(20_000, 'removebuff', EARTH_ELEMENTAL_BUFF)])) as Analysis &
			ElementalAuditResult;
		expect(el2.durationMs).toBe(50_000);
		expect(el2.earthElemental.presses).toEqual([{ t: 0, verdict: 'near-end', inferred: true }]);
		// Read as branch A and still not graded — the reading and the grading are separate decisions, and
		// only the second one excludes a pre-pull use.
		expect([el2.earthElemental.good, el2.earthElemental.graded]).toEqual([0, 0]);
	});

	it('refuses the inference once the stream has shown the summon being made', () => {
		// The press guard, which matters here for the same reason it does for the Fire Elemental: the
		// press (2062) and the buff (118323) are different ids, so `auraWindows`' per-id "was this opening
		// logged" test cannot let one vouch for the other.
		const el2 = analyse(
			make([e(10_000, 'cast', EARTH_ELEMENTAL), e(70_000, 'removebuff', EARTH_ELEMENTAL_BUFF)]),
		) as Analysis & ElementalAuditResult;
		expect(el2.earthElemental.prepull).toBe(false);
		// `unknown` for the same reason as the pre-pull case above: this stream carries no Fire Elemental,
		// so neither branch B nor branch C can be refuted, and a press at 10s of a 400-second pull is
		// nowhere near branch A.
		expect(el2.earthElemental.presses).toEqual([{ t: 10_000, verdict: 'unknown', inferred: false }]);
		// And an `unknown` is out of the denominator, not into it — the press is neither good nor graded.
		expect([el2.earthElemental.good, el2.earthElemental.graded]).toEqual([0, 0]);
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

	/**
	 * **"Every committed fixture" is now the fixture directory rather than a list of three.** It read
	 * `['phased', 'unbroken', 'cleave']`; `addsThenBoss.json` landed and reads `false` too, so the fourth
	 * log widens the evidence without moving the claim — and the sweep no longer has to be re-edited by
	 * whoever commits the fifth.
	 */
	it('reports every committed fixture as not pre-pulled, which is why this suite is synthetic', () => {
		for (const name of FIXTURES) {
			expect(fx(name).earthElemental.prepull, name).toBe(false);
		}
		// And two pulls are the ones the flag exists for: no press, no evidence either way before now.
		// `cleave` was the only one when this was written; `addsThenBoss` is the second, and it is a
		// nine-minute pull rather than a four-minute one, so silence there is a stronger reading.
		expect(fx('cleave').earthElemental.presses).toEqual([]);
		expect(fx('addsThenBoss').earthElemental.presses).toEqual([]);
	});
});

/**
 * The Fire Elemental tile counts the pre-pull use, on the real pulls — §68's headline.
 *
 * Three of the four committed pulls summon it before the pull, so all three had `prepull: true` beside a
 * "Summons" tile reading **0**. The count and the table now come off one list, which is what stops them
 * disagreeing again in the other direction.
 *
 * **The three are named rather than discovered, and this is the one list in this file that stays a
 * literal.** `addsThenBoss` is the control for the other half: it summons the elemental *in* the fight, at
 * 173 290 and 479 923 ms, with two real 2894 `cast` events, so `prepull` is `false` and `presses` carries
 * two uninferred rows. Sweeping it into this block would assert the pre-pull shape on the one pull that
 * proves the non-pre-pull shape, and the assertion under `also reads the in-fight summons` is what keeps
 * the pair honest — a fifth fixture has to be classified into one of the two rather than silently landing
 * in neither.
 */
describe('the pre-pull Fire Elemental is counted as a use on every committed pull that pre-pulled it', () => {
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

	/**
	 * *** The half the literal above cannot cover, and the reason the pair is a partition rather than a
	 * list. ***
	 *
	 * `addsThenBoss` is the first committed pull that does **not** pre-pull the Fire Elemental, and it is
	 * the exact case a hardcoded three hides: the block above would have gone on asserting the pre-pull
	 * shape on the pulls it names and never noticed that the committed set had grown a counter-example.
	 * So the classification is derived from `rawFixtures` and every pull has to fall on one side of it —
	 * a fifth fixture fails here by name rather than being swept by neither block.
	 *
	 * The two in-fight presses are read off the pull's own 2894 `cast` events as well as off the audit, so
	 * the row and the log are two readings rather than one.
	 */
	it('also reads the in-fight summons, and every committed pull is on one side or the other', () => {
		const prepulled: string[] = [];
		const inFight: string[] = [];
		for (const name of FIXTURES) (fx(name).fireElemental.prepull ? prepulled : inFight).push(name);
		expect([prepulled, inFight]).toEqual([['cleave', 'phased', 'unbroken'], ['addsThenBoss']]);

		const el2 = fx('addsThenBoss');
		expect(el2.fireElemental.presses).toEqual([
			{ t: 173_290, reason: 'early', inferred: false },
			{ t: 479_923, reason: null, inferred: false },
		]);
		// The independent half, the other way round from the block above: this pull really does carry the
		// `cast` events, which is why nothing had to be inferred for it.
		const casts = load('addsThenBoss').events.filter(
			(ev) =>
				(ev as { type: string; abilityGameID?: number }).abilityGameID === FIRE_ELEMENTAL &&
				(ev as { type: string }).type === 'cast',
		);
		expect(casts.length).toBe(2);
	});
});
