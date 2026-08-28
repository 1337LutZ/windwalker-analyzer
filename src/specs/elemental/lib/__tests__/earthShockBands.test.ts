// Earth Shock is judged against the list the *press's own target count* puts it under — §64 items 1 and 2.
//
// There are three priority lists in `ui/shaman/elemental/apls/` and this audit transcribed one of them
// onto every pull. `cleave.apl.json` rung 13 is the whole two-target rule:
//
//     auraNumStacks(324) >= 6  AND  dotRemainingTime(8050) >= 8s  AND  dotRemainingTime(8050) >= 8s
//
// Six stacks rather than seven, an *eight*-second dot floor rather than six, and neither the Ascendance
// hold nor the two-piece clause the single-target list carries — so it is a different rule and not a
// looser one. `dotRemainingTime >= 8s` really is stated twice in the preset; that is redundancy in the
// source, checked against the file, and it is transcribed once because `x >= 8 AND x >= 8` is `x >= 8`.
//
// **The band is read per press, and `cleave` is why.** That pull runs from one enemy to thirteen: four of
// its twelve shocks land at one target, three at two, three at three and two at four or more. A
// whole-pull verdict — `detectedMode` reads `multi` off a 57% share — would have judged the
// single-target stretches against the two-target list or the reverse, which is the same class of error
// as grading everything against p5 was.
//
// Every band figure below is re-derived from the fixture's own damage events rather than read back off
// the audit that is under test, and the shield's stacks and the two-piece window on the one press that
// changes verdict are read off the log's own `applybuffstack` and `applydebuff` rows.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { rawFixtures } from '~/lib/analysis/fixtures';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '~/specs/elemental/lib';
import { scoreAnalysis } from '~/specs/elemental/lib/score';

const LIGHTNING_SHIELD = 324;
/** The debuff the two-piece leaves on the target — the id the game writes, not the sim's APL handle. */
const T16_2PC_DEBUFF = 144_999;
/** The one press on `cleave` whose verdict the two-target list changes. */
const FLIPPED = 47_322;

const dataset = (name: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;

/**
 * Memoised, because the ledger loop below now walks every committed pull and one of them is 4.4 MB.
 *
 * `bands.test.ts` made the same change for the same reason and got *faster* doing it. Nothing here mutates
 * an analysis, so one instance per pull is safe; a guard family sharing a mutable dataset would not be.
 */
const analysed = new Map<string, Analysis & ElementalAuditResult>();
const fx = (name: string): Analysis & ElementalAuditResult => {
	const hit = analysed.get(name);
	if (hit !== undefined) return hit;
	const el = analyse(dataset(name)) as Analysis & ElementalAuditResult;
	analysed.set(name, el);
	return el;
};

/** Every raw Elemental pull, found rather than listed — see the ledger test below for why it matters. */
const FIXTURES = rawFixtures('elemental').map(({ name }) => name.replace(/\.json$/, ''));

const cleave = fx('cleave');
const cleaveData = dataset('cleave');

/**
 * The target count at a moment, re-derived from the fixture's raw damage rows.
 *
 * Distinct enemy **spawns** the player damaged in the trailing window, keyed on the target id plus its
 * instance, which is the pairing `targetCounts` keys on and the reason an add wave of one npc type is
 * not one enemy. Written out here rather than imported so this is a second derivation and not the audit
 * quoting itself: if `targetCounts`, the immunity filter or the window ever move, these numbers stop
 * agreeing and say so.
 */
const targetsAtFromEvents = (data: FightDataset, at: number, windowMs: number): number => {
	const t0 = data.fight.startTime;
	const me = data.actor.id;
	const seen = new Set<string>();
	for (const ev of data.events as ReadonlyArray<Record<string, unknown>>) {
		if (ev['type'] !== 'damage' || ev['sourceID'] !== me) continue;
		const t = (ev['timestamp'] as number) - t0;
		if (t <= at - windowMs || t > at) continue;
		seen.add(`${ev['targetID'] as number}:${(ev['targetInstance'] as number | undefined) ?? '-'}`);
	}
	return seen.size;
};
const bandFromEvents = (data: FightDataset, at: number, windowMs: number): number =>
	Math.min(4, Math.max(1, targetsAtFromEvents(data, at, windowMs)));

/** `earthShockWaste` as the report grades it, in percent. */
const wastePct = (el: Analysis): number | null => {
	const metric = scoreAnalysis(el).sections['earthShock']?.metrics.find((m) => m.key === 'earthShockWaste');
	if (metric === undefined) throw new Error('earthShockWaste is not on the scorecard');
	return metric.value;
};

describe('the band on each shock comes off the log, per press', () => {
	/**
	 * The audit's band and a second derivation off the raw damage rows agree on all twelve presses.
	 *
	 * The window is `targets.windowMs`, published by the core, so the two readings share the calibration
	 * and nothing else. This is the assertion the rest of the file stands on: every claim below about
	 * "the press at two targets" is only as good as the count behind it.
	 */
	it('agrees with a count re-derived from the fixture’s own damage events', () => {
		const windowMs = cleave.targets?.windowMs ?? 0;
		expect(windowMs).toBe(5000);
		for (const press of cleave.earthShock.presses) {
			expect(press.band, `press at ${press.t}`).toBe(bandFromEvents(cleaveData, press.t, windowMs));
		}
	});

	/**
	 * The distribution, pinned — this is the number §64 asked for and the reason one band per pull could
	 * not have served.
	 *
	 * Four presses at one enemy, three at two, three at three, two at four or more, on a pull the
	 * whole-pull reading calls `multi`. Both facts asserted together, because the second is what makes
	 * the first matter.
	 */
	it('spreads cleave’s twelve shocks across all four bands', () => {
		const spread = new Map<number, number>();
		for (const press of cleave.earthShock.presses) spread.set(press.band, (spread.get(press.band) ?? 0) + 1);
		expect([...spread.entries()].sort()).toEqual([
			[1, 4],
			[2, 3],
			[3, 3],
			[4, 2],
		]);
		expect(cleave.targets?.detected).toBe('multi');
		expect(cleave.targets?.counts?.max).toBe(13);
	});

	/** And the two single-target fixtures have no band but 1, which is why neither can move below. */
	it.each(['phased', 'unbroken'] as const)('%s is band 1 throughout', (name) => {
		const el = fx(name);
		expect(el.targets?.counts?.max).toBe(1);
		expect(el.earthShock.presses.map((p) => p.band)).toEqual(el.earthShock.presses.map(() => 1));
	});
});

describe('the two-target list judges the two-target presses', () => {
	/**
	 * *** The press the change is about, with every fact behind it read off the log rather than the audit. ***
	 *
	 * `cleave` 47.3s. Two enemies in the window. The shield's last `applybuffstack` before it says
	 * **seven** and the press's own `removebuffstack` drains it. A two-piece debuff was applied at 34.8s
	 * and removed at 61.4s, so at the press it had **14.0 seconds** left — far outside the four-second
	 * tail the single-target proc branch wants the shock inside, which is exactly why that branch called
	 * this a shock spent early.
	 *
	 * The two-target list asks nothing about the debuff. Seven stacks clears its floor of six and 39.4
	 * seconds of dot clears its floor of eight, so the list wanted this press and the section now says so.
	 */
	it('reads the press at two targets as the list’s own, where the single-target branch faulted it', () => {
		const press = cleave.earthShock.presses.find((p) => p.t === FLIPPED);
		expect(press?.band).toBe(2);
		expect(press?.reasons).toEqual([]);
		expect(press?.good).toBe(true);
		// Still inside a two-piece window — the press was not forgiven by the window closing.
		expect(press?.twoPiece).toBe(true);

		const t0 = cleaveData.fight.startTime;
		const me = cleaveData.actor.id;
		const rows = (cleaveData.events as ReadonlyArray<Record<string, unknown>>).map((ev) => ({
			t: (ev['timestamp'] as number) - t0,
			type: ev['type'] as string,
			id: ev['abilityGameID'] as number | undefined,
			target: ev['targetID'] as number | undefined,
			stack: ev['stack'] as number | undefined,
		}));

		// The shield, off its own stack rows on **this** shaman — a raid interleaves two shields under one
		// id. The press's own drain is the row at 47 321; the reading it drained is the one before it.
		const shield = rows.filter((r) => r.id === LIGHTNING_SHIELD && r.target === me);
		expect(shield.filter((r) => r.t <= FLIPPED).at(-1)).toMatchObject({
			t: FLIPPED - 1,
			type: 'removebuffstack',
		});
		expect(shield.filter((r) => r.t < FLIPPED - 1).at(-1)).toMatchObject({
			t: 39_706,
			type: 'applybuffstack',
			stack: 7,
		});
		expect(press?.lsStacks).toBe(7);

		// The debuff, off its own rows: applied at 34.8s, removed at 61.4s, so 14.0s left at the press —
		// nowhere near the four-second tail the proc branch asks for.
		const debuff = rows.filter((r) => r.id === T16_2PC_DEBUFF);
		expect(debuff.length).toBeGreaterThan(0);
		expect(debuff.some((r) => r.t === 34_840 && r.type === 'applydebuff')).toBe(true);
		const removal = debuff.find((r) => r.t > FLIPPED && r.type === 'removedebuff');
		expect(removal?.t).toBe(61_355);
		expect(removal!.t - FLIPPED).toBeGreaterThan(4000);

		// And the dot clears the two-target floor of eight seconds with room to spare.
		expect(press?.fsRemainingMs).toBe(39_439);
	});

	/** All three of cleave's two-target shocks are the list's own; none of them carries a Cleave reason. */
	it('faults none of cleave’s three two-target shocks', () => {
		const atTwo = cleave.earthShock.presses.filter((p) => p.band === 2);
		expect(atTwo).toHaveLength(3);
		expect(atTwo.every((p) => p.good)).toBe(true);
		const reasons = cleave.earthShock.presses.flatMap((p) => p.reasons);
		expect(reasons).not.toContain('cleaveStacks');
		expect(reasons).not.toContain('cleaveDot');
	});

	/**
	 * The graded figure moves on `cleave` alone, and upward by exactly the one press above.
	 *
	 * `phased` and `unbroken` are band 1 from end to end, so they cannot move and are pinned as the guard
	 * for that. All three stay `bad`: the `ok` boundary is 65.
	 *
	 * **`cleave`'s figure moved again afterwards, for a different reason, and both are stated here.** When
	 * this was written it read 6 of 12 = 50%. It now reads 4 of 7 = **57.14%**, because the band-3 and
	 * band-4 presses left the denominator: `aoe.apl.json` has no Earth Shock rung, so nothing judges a
	 * shock at three or more enemies (`EarthShockPress.good` is null there, and
	 * `earthShockAoeBand.test.ts` measures the whole of it). The two other pulls are unaffected, which is
	 * what makes them still the guard they were written to be.
	 */
	it('moves earthShockWaste on cleave alone', () => {
		// **Every figure here has moved, and one defect explains all three.** The tier-16 `remaining` check
		// read `remainingIn(t, twoPieceWindows)`, and `auraWindows` does not split a window on a refresh —
		// so a debuff kept up across a phase was one window from its first apply to its last remove, and the
		// check answered the distance to the end of that *run*. `unbroken`'s is 36.1 seconds against an aura
		// that cannot hold fourteen. Every shock inside it read far too much time left and every one was
		// charged, including the ones taken with under a second on the debuff. The remaining is modelled
		// from the charges the previous shock spent now — see `dischargeExpiry` — and `twoPiece` reaches no
		// committed pull at all, the same place `ascReady` has always been.
		expect(wastePct(cleave)).toBeCloseTo(21.4286, 3);
		expect(cleave.earthShock.good).toBe(5);
		expect(cleave.earthShock.ok).toBe(1);
		expect(cleave.earthShock.judged).toBe(7);
		// 16.6667 since the Ascendance rule: `phased` presses one shock inside the cooldown, at 204 259.
		expect(wastePct(fx('phased'))).toBeCloseTo(16.6667, 3);
		expect(wastePct(fx('unbroken'))).toBeCloseTo(19.2308, 3);
		expect(scoreAnalysis(cleave).sections['earthShock']?.grade).toBe('ok');
	});
});

describe('the bad-spend ledger reads the press’s own verdict', () => {
	/**
	 * `lightningShield.badSpends` used to test `lsStacks < maxStacks` over this same array — the aura's
	 * ceiling of seven, at every target count. It now filters the reasons the press was judged with, so
	 * the two cannot say different things about one shock, and a spend at six on a two-target stretch is
	 * no longer a fault the rotation asked for.
	 *
	 * On the committed fixtures the ledger does not move, and that is worth pinning rather than glossing:
	 * `cleave`'s one bad spend is at **band 1** with **five** stacks, which is under both floors, so the
	 * fix does not forgive it. The measurement was the point — the plan asked which band that press was
	 * at, and it is the single-target one.
	 */
	it('keeps cleave’s one bad spend, because it is a band-1 press at five stacks', () => {
		expect(cleave.lightningShield.badSpends).toEqual([{ t: 24_757, stacks: 5 }]);
		const press = cleave.earthShock.presses.find((p) => p.t === 24_757);
		expect(press?.band).toBe(1);
		expect(press?.lsStacks).toBe(5);
		expect(press?.reasons).toEqual(['belowFull']);
		// Under the two-target floor as well, so no band could have excused it.
		expect(press!.lsStacks!).toBeLessThan(6);
	});

	/**
	 * The ledger and the reasons are one list, on every fixture — the drift this change closes.
	 *
	 * **"On every fixture" is now what the loop does rather than what the sentence says.** It read
	 * `['phased', 'unbroken', 'cleave']`, which stopped being every fixture when `addsThenBoss.json`
	 * landed, and the pull it left out is the only one that exercises the `cleaveStacks` half of the filter
	 * on real data: its four faults are charged across both reasons, where the other three carry
	 * `belowFull` alone. So the fourth pull is the first evidence that the two-reason union and the
	 * single-number `belowFull` count agree when both reasons are actually in play — which is the claim,
	 * and it was previously checked only where half of it was vacuous.
	 */
	it.each(FIXTURES)('%s: the ledger is exactly the stack faults', (name) => {
		const el = fx(name);
		const faulted = el.earthShock.presses.filter((p) =>
			p.reasons.some((r) => r === 'belowFull' || r === 'cleaveStacks'),
		);
		expect(el.lightningShield.badSpends.map((s) => s.t)).toEqual(faulted.map((p) => p.t));
		expect(el.earthShock.belowFull).toBe(faulted.length);
	});
});

describe('the ladder rung carries the same two-target form', () => {
	/**
	 * *** §72 measured that all four forced walks collapse to identical verdicts. Band 2 no longer does. ***
	 *
	 * `aplForced` runs the whole ladder at one target count, which is the reading the Rotation section
	 * offers. Counting the presses the walk says wanted Earth Shock is the cleanest read on the rung's
	 * condition: at band 2 it drops the Ascendance hold and the two-piece clause and lowers the stack
	 * floor, so it claims globals the single-target form refused.
	 *
	 * **Bands 3 and 4 used to be asserted equal to band 1, and that pin has now been redeemed.** It said
	 * out loud that the rung was deliberately not band-gated out of them although `aoe.apl.json` has no
	 * Earth Shock at all, because taking it out moves every verdict below it and belonged with §64's item
	 * 3. Item 3 landed: the rung is `bands: [1, 2]`, so the columns are 0 and the third question this rung
	 * answers is now "which list is this press even under" rather than only "how strict is it".
	 */
	it.each([
		['phased', 8, 28],
		['unbroken', 5, 30],
		['cleave', 13, 25],
	] as const)('%s wants Earth Shock at two targets, more than at one and not at all above', (name, single, two) => {
		const el = fx(name);
		const wanted = (band: 1 | 2 | 3 | 4): number =>
			(el.aplForced?.[band]?.presses ?? []).filter((p) => p.wanted === 'earth-shock').length;
		expect(wanted(1)).toBe(single);
		expect(wanted(2)).toBe(two);
		// `aoe.apl.json` has no Earth Shock rung, so above two targets the walk cannot want the button —
		// and a press of it is charged against Chain Lightning, which that list does press.
		expect(wanted(3)).toBe(0);
		expect(wanted(4)).toBe(0);
	});

	/**
	 * And the *two-target rule* moves the live walk on no fixture, which is a fact about the ladder's
	 * shape rather than a sign the rung is unwired. (The **band gate** does move it, by exactly one press
	 * on `cleave` — asserted below and attributed there, so the two changes are not read as one.)
	 *
	 * Earth Shock sits below Flame Shock and Lava Burst, so the walk only reaches it where neither of
	 * those wanted the global. `cleave`'s flipped press is the case: at 47.3s the live walk names
	 * **Lava Burst** as the button the list wanted, so the rung is never asked and the looser two-target
	 * condition cannot change the verdict. The section's own reading of that press does move — see above —
	 * because it judges the shock that was pressed rather than the rung above it.
	 */
	it('leaves the live walk’s two-target Earth Shock verdicts alone, and names why', () => {
		const live = (cleave.apl?.presses ?? []).filter((p) => p.pressed === 8042);
		expect(live).toHaveLength(12);
		// 4 until the rung left bands 3 and 4. The press at 208.4s was credited against the single-target
		// rung at a moment the pull was on three targets or more, where the sim's list has no Earth Shock
		// at all; it now reads as a skip against Chain Lightning. **That flip is the band gate and not this
		// describe block's two-target rule**, which is why it is named here rather than folded into the
		// count — the two-target form still moves nothing on the live walk.
		expect(live.filter((p) => p.verdict === 'followed')).toHaveLength(3);
		expect(live.find((p) => p.t === 208_430)?.wanted).toBe('chain-lightning');
		const flipped = live.find((p) => p.t === FLIPPED);
		expect(flipped?.wanted).toBe('lava-burst');
		expect(flipped?.verdict).toBe('skipped');
	});
});

// ------------------------------------------------------------------ synthetic
//
// The committed fixtures cannot show the two-target rule biting in both directions.
// `cleave` is the only multi-target pull in the repository and every one of its three two-target shocks
// happens to be taken at the ceiling with a long dot, so the fixture can show a press the Cleave list
// *allows* and nothing it *refuses*. The rule is two thresholds and one of them is **stricter** than the
// single-target list's, so a pull that only ever demonstrated the looser half would be evidence for
// exactly the reading this change must not have: a blanket excuse at two targets.
//
// So: one pull, four shocks, the target count moved under them on purpose.
//
//   10s  two enemies, seven charges, 20s of dot  — wanted by both lists. The control.
//   16s  two enemies, **six** charges, 14s of dot — wanted by the Cleave list, and the press §64 was
//        raised about. The single-target list calls this Fulmination thrown away.
//   24s  two enemies, seven charges, **6s** of dot — the Cleave list refuses it at its eight-second
//        floor while the single-target list, whose floor is six, would have allowed it.
//   40s  **one** enemy, six charges — still `belowFull`, because at one target the list really does want
//        seven. The guard against the band leaking out of its own stretch.
//
// Ascendance is pressed at 1s for the reason `earthShockTwoPiece.test.ts` presses it: an unpressed
// cooldown reads as "ready now" and would push `ascReady` onto every single-target press.

const S_T0 = 500_000;
const S_DURATION = 60_000;
const S_ME = 3;
const S_BOSS = 9;
const S_ADD = 11;

const LIGHTNING_BOLT = 403;
const FLAME_SHOCK = 8050;
const EARTH_SHOCK = 8042;
const ASCENDANCE = 114_049;
const LAVA_BURST = 51_505;
const TICK_MS = 1500;

const ev = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
	timestamp: S_T0 + t,
	type,
	abilityGameID: id,
	sourceID: S_ME,
	targetID: S_ME,
	...extra,
});
const onBoss = (t: number, type: string, id: number, extra: Record<string, unknown> = {}) =>
	ev(t, type, id, { targetID: S_BOSS, targetInstance: 1, ...extra });

/** A hit on the boss every two seconds, so the engaged clock is the whole pull. */
const bossContact = Array.from({ length: S_DURATION / 2000 + 1 }, (_, i) =>
	onBoss(i * 2000, 'damage', LIGHTNING_BOLT, { amount: 1000, hitType: 1 }),
);
/**
 * And a second enemy from 8s to 26s, which is what makes the middle three presses band 2.
 *
 * The count is a five-second trailing window, so the second target is in it from 8.5s until 31.5s. The
 * fourth press at 40s is well clear of that, and the band assertions below re-derive all four from these
 * same rows rather than trusting the arithmetic in this comment.
 */
const addContact = Array.from({ length: 10 }, (_, i) =>
	// Offset half a second off the boss's cadence on purpose: `spawnAt` resolves the enemy a press was
	// aimed at as the last landed hit at or before it, and a tie inside one millisecond goes to the later
	// row in the stream. Sharing a stamp with the boss would hand every press the add as its target and
	// read the dot on it as absent — a fabricated `cleaveDot` on all four.
	ev(8500 + i * 2000, 'damage', LIGHTNING_BOLT, {
		targetID: S_ADD,
		targetInstance: 1,
		amount: 500,
		hitType: 1,
	}),
);

/**
 * The shield, rebuilt between shocks so each press lands on the count it needs.
 *
 * Every Earth Shock drains it to one — the `removebuffstack` a millisecond before the press, which is
 * the shape both real fixtures carry — and the ladder of `applybuffstack` rows after it is the rebuild.
 */
const shieldRows = [
	ev(0, 'applybuff', 324),
	...[2, 3, 4, 5, 6, 7].map((stack, i) => ev(1000 + i * 500, 'applybuffstack', 324, { stack })),
	// Press 1 at 10s drains it; back to six by 15s, which is one short of the ceiling.
	ev(9999, 'removebuffstack', 324, { stack: 1 }),
	...[2, 3, 4, 5, 6].map((stack, i) => ev(11_000 + i * 800, 'applybuffstack', 324, { stack })),
	// Press 2 at 16s drains it; back to seven by 22s.
	ev(15_999, 'removebuffstack', 324, { stack: 1 }),
	...[2, 3, 4, 5, 6, 7].map((stack, i) => ev(17_000 + i * 800, 'applybuffstack', 324, { stack })),
	// Press 3 at 24s drains it; back to six by 29s and left there.
	ev(23_999, 'removebuffstack', 324, { stack: 1 }),
	...[2, 3, 4, 5, 6].map((stack, i) => ev(25_000 + i * 800, 'applybuffstack', 324, { stack })),
];

/** The dot, in two applications, so its remaining time can be aimed at each press. */
const dotRows = [
	onBoss(0, 'applydebuff', FLAME_SHOCK),
	...Array.from({ length: 30_000 / TICK_MS - 1 }, (_, i) =>
		onBoss((i + 1) * TICK_MS, 'damage', FLAME_SHOCK, {
			tick: true,
			amount: 1000,
			unmitigatedAmount: 900,
			hitType: 1,
		}),
	),
	onBoss(30_000, 'removedebuff', FLAME_SHOCK),
	onBoss(30_001, 'applydebuff', FLAME_SHOCK),
	...Array.from({ length: 25_000 / TICK_MS - 1 }, (_, i) =>
		onBoss(30_001 + (i + 1) * TICK_MS, 'damage', FLAME_SHOCK, {
			tick: true,
			amount: 1000,
			unmitigatedAmount: 900,
			hitType: 1,
		}),
	),
	onBoss(55_000, 'removedebuff', FLAME_SHOCK),
];

const pressRows = [
	ev(1000, 'cast', ASCENDANCE),
	onBoss(3000, 'cast', LAVA_BURST),
	onBoss(10_000, 'cast', EARTH_SHOCK),
	onBoss(16_000, 'cast', EARTH_SHOCK),
	onBoss(24_000, 'cast', EARTH_SHOCK),
	onBoss(40_000, 'cast', EARTH_SHOCK),
];

const sFight = {
	id: 2,
	name: 'Iron Qon',
	encounterID: 1662,
	kill: true,
	difficulty: 4,
	size: 25,
	startTime: S_T0,
	endTime: S_T0 + S_DURATION,
};

const banded = {
	code: 'ele-bands',
	fight: sFight,
	actor: { id: S_ME, name: 'Sparkstorm', type: 'Player' },
	actors: [
		{ id: S_ME, name: 'Sparkstorm', type: 'Player' },
		{ id: S_BOSS, name: 'Iron Qon', type: 'NPC', subType: 'Boss' },
		{ id: S_ADD, name: 'Quilen', type: 'NPC' },
	],
	events: [...bossContact, ...addContact, ...shieldRows, ...dotRows, ...pressRows],
	table: {
		fight: {
			...sFight,
			enemyNPCs: [
				{ id: S_BOSS, gameID: 68_078 },
				{ id: S_ADD, gameID: 68_079 },
			],
		},
		damageDone: {
			entries: [
				{
					name: 'Sparkstorm',
					id: S_ME,
					type: 'Shaman',
					itemLevel: 553,
					total: 31_000,
					activeTime: S_DURATION,
					abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 31_000 }],
				},
			],
		},
	},
} as unknown as FightDataset;

describe('the two-target rule cuts both ways', () => {
	const el = analyse(banded) as Analysis & ElementalAuditResult;

	it('sets the pull up the way the two lists need it', () => {
		expect(el.isSpec).toBe(true);
		// No two-piece anywhere, so the single-target comparison is against branch A of its rule.
		expect(el.earthShock.presses.map((p) => p.twoPiece)).toEqual([false, false, false, false]);
		expect(el.earthShock.presses.map((p) => p.t)).toEqual([10_000, 16_000, 24_000, 40_000]);
		// The bands, re-derived from the pull's own damage rows rather than read off the audit.
		const windowMs = el.targets?.windowMs ?? 0;
		expect(el.earthShock.presses.map((p) => p.band)).toEqual(
			el.earthShock.presses.map((p) => bandFromEvents(banded, p.t, windowMs)),
		);
		expect(el.earthShock.presses.map((p) => p.band)).toEqual([2, 2, 2, 1]);
		expect(el.earthShock.presses.map((p) => p.lsStacks)).toEqual([7, 6, 7, 6]);
		// Ascendance is long away under every press, so nothing below is the hold clause.
		expect(el.earthShock.presses.every((p) => p.ascReadyInSec > 6)).toBe(true);
	});

	/**
	 * *** The press §64 was raised about: six charges at two targets, and the list asked for six. ***
	 *
	 * `cleave.apl.json` rung 13 spends the shield at six. The audit tested the aura's ceiling of seven at
	 * every target count, so this press was reported as Fulmination thrown away *and* listed in
	 * `lightningShield.badSpends`, for following the rotation. Both halves are asserted, because the
	 * ledger and the verdict used to be two copies of one rule.
	 */
	it('wants the shock at six charges at two targets, and keeps it out of the bad-spend ledger', () => {
		const press = el.earthShock.presses.find((p) => p.t === 16_000);
		expect(press?.band).toBe(2);
		expect(press?.lsStacks).toBe(6);
		expect(press?.fsRemainingMs).toBeGreaterThanOrEqual(8000);
		expect(press?.reasons).toEqual([]);
		expect(press?.good).toBe(true);
		expect(el.lightningShield.badSpends.map((s) => s.t)).not.toContain(16_000);
	});

	/**
	 * And the stricter half, which is the reason this is not a blanket excuse.
	 *
	 * Six seconds of dot clears the single-target floor exactly and fails the two-target one, so this
	 * press is a fault it would not have been at one enemy — the Cleave list demands *more* of the dot,
	 * not less. `cleaveDot` rather than `fsLow` because the row has to name the threshold it failed: the
	 * two are two seconds apart.
	 */
	it('refuses a shock the single-target floor would have allowed', () => {
		const press = el.earthShock.presses.find((p) => p.t === 24_000);
		expect(press?.band).toBe(2);
		expect(press?.lsStacks).toBe(7);
		expect(press?.fsRemainingMs).toBe(6000);
		expect(press?.reasons).toEqual(['cleaveDot']);
		expect(press?.good).toBe(false);
	});

	/**
	 * The band does not leak out of its own stretch: at one enemy six charges is still a shock spent
	 * early, and the ledger still carries it.
	 */
	it('still wants seven charges once the second enemy is gone', () => {
		const press = el.earthShock.presses.find((p) => p.t === 40_000);
		expect(press?.band).toBe(1);
		expect(press?.lsStacks).toBe(6);
		expect(press?.reasons).toEqual(['belowFull']);
		expect(el.lightningShield.badSpends).toEqual([{ t: 40_000, stacks: 6 }]);
	});

	/** And the control: seven charges with a long dot is wanted at two targets as it is at one. */
	it('leaves a shock both lists wanted alone', () => {
		const press = el.earthShock.presses.find((p) => p.t === 10_000);
		expect(press?.band).toBe(2);
		expect(press?.reasons).toEqual([]);
	});
});
