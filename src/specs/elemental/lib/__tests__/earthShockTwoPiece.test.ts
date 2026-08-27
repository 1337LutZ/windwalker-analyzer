// The sim's Earth Shock rule has two branches, and the tier-16 two-piece proc picks which one applies.
//
// `Earth Shock Rules` in `ui/shaman/elemental/apls/p5.apl.json` is `OR(A, B)`. A opens with
// `NOT auraIsActive(144998)` and B opens with `auraIsActive(144998)`, so the branches are mutually
// exclusive on that one proc and a press is judged against exactly one of them:
//
//   A (proc down) — dot >= 6s, shield stacks >= 7, Ascendance >= 6s away.
//   B (proc up)   — shield stacks >= 7, `auraRemainingTime(144999) <= 4s`,
//                   dot >= 2 x `dotTickFrequency(8050)`.
//
// Only A was implemented, with the proc's window pushed as a fault reason full stop — so a shock fired
// exactly as B asks for it was reported as a shock spent early.
//
// **Which branch applies is a fact about the player's gear, not about the pull**, and getting that wrong
// was the first attempt at this test's subject. 144998 is the two-piece's *set bonus aura* exposed to the
// rotation language (`sim/shaman/items_mop.go:126-140`), so it is active exactly while the set is worn:
// A is "no set", B is "set". Selecting the branch per press off the debuff instead sent a set owner whose
// debuff happened to be *down* into branch A, charging them `fsLow` and `ascReady` — two conditions their
// rotation does not contain. And B's debuff clause is genuinely satisfied when the debuff is down, because
// `auraRemainingTime` returns 0 for an inactive aura (`sim/core/apl_values_aura.go:108-111`) and `0 <= 4s`.
//
// **What the committed fixtures can and cannot show.** Three of the four carry the debuff (144999,
// Elemental Discharge) and therefore own the set. `earthShockWaste` moves on `phased` alone
// (41.6667 → 41.6667, still `bad`), because that pull's five other faults were `fsLow` and `ascReady` on
// presses whose debuff was down. None of those three has a shock in the last four seconds of a window
// *with the shield full*: `unbroken`'s press at 180 744 is the only one inside a tail and it spent two
// stacks, so it stays a fault on `belowFull`. The press B rescues outright is synthetic, and that is stated
// rather than dressed up as a real-log finding.
//
// *** This block used to say "branch A is unexercised by real data in this repository" and "`fsLow` and
// `ascReady` now appear on no fixture at all". Half of that is false. *** `addsThenBoss.json` is the
// fourth committed pull and its shaman writes 144999 **zero** times, so it does not own the set and its
// presses are judged by branch A — `fsLow` is charged on it for real. `ascReady` still reaches no press on
// any pull, so the synthetic remains that half's only cover. The two are separated in `charges branch A's
// conditions on exactly the pulls that lack the set`, which sweeps the fixture directory rather than a
// list of three; the old list is the reason this correction is arriving now rather than when the fixture
// landed.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import { rawFixtures } from '~/lib/analysis/fixtures';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';

import { analyse } from '../index';
import { scoreAnalysis } from '../score';

const load = (name: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;

/** Memoised: the branch-A sweep below walks every committed pull and `addsThenBoss.json` is 4.4 MB. */
const cache = new Map<string, Analysis & ElementalAuditResult>();
const analysed = (name: string): Analysis & ElementalAuditResult => {
	const hit = cache.get(name);
	if (hit !== undefined) return hit;
	const el = analyse(load(name)) as Analysis & ElementalAuditResult;
	cache.set(name, el);
	return el;
};

/** Every raw Elemental pull, found rather than listed. See the branch-A test for why that matters here. */
const FIXTURES = rawFixtures('elemental').map(({ name }) => name.replace(/\.json$/, ''));

/** `earthShockWaste` as the report grades it, in percent. */
const wastePct = (el: Analysis & ElementalAuditResult): number | null => {
	const metric = scoreAnalysis(el).sections['earthShock']?.metrics.find((m) => m.key === 'earthShockWaste');
	if (metric === undefined) throw new Error('earthShockWaste is not on the scorecard');
	return metric.value;
};

describe('the branch on the committed pulls', () => {
	const unbroken = analysed('unbroken');

	/**
	 * The window this rests on, read out of the fixture's own events rather than out of the audit.
	 *
	 * `unbroken` puts 144999 on the boss five times. The last window opens with `applydebuff` at 148 301
	 * and closes with `removedebuff` at 184 398 — the fight ends at 184 448, so that close is the boss
	 * dying rather than the proc expiring, and the press below is inside the tail for that reason and not
	 * because the player read the debuff. Which is exactly why nothing is credited on it.
	 */
	it('has one Earth Shock inside the last four seconds of a two-piece window, and no more', () => {
		const raw = load('unbroken');
		const t0 = raw.fight.startTime;
		const debuff = raw.events
			.filter((e: WclEvent) => e.abilityGameID === 144_999 && (e.type === 'applydebuff' || e.type === 'removedebuff'))
			.map((e: WclEvent) => [e.type, e.timestamp - t0]);
		expect(debuff).toContainEqual(['applydebuff', 148_301]);
		expect(debuff).toContainEqual(['removedebuff', 184_398]);
		expect(unbroken.durationMs).toBe(184_448);

		const inTail = unbroken.earthShock.presses.filter((p) => p.twoPiece && 184_398 - p.t <= 4000);
		expect(inTail.map((p) => p.t)).toEqual([180_744]);
	});

	/**
	 * The press's reason list, which is the whole of the real-data change.
	 *
	 * It used to read `belowFull, fsLow, ascReady, twoPiece` — four faults, three of them conditions of
	 * the branch that does not apply to it. The proc was up, so B is the branch: B does not ask about
	 * Ascendance at all, its dot floor is two tick periods rather than six seconds (the dot had 3 655ms
	 * against a measured cadence of about 1 730), and the proc's own window is a reason only outside its
	 * last four seconds. What is left is the one thing that was actually wrong — the shock spent two
	 * stacks of a seven-stack shield.
	 */
	it('faults that press on the shield alone, not on three conditions of the other branch', () => {
		const press = unbroken.earthShock.presses.find((p) => p.t === 180_744);
		expect(press?.lsStacks).toBe(2);
		expect(press?.fsRemainingMs).toBe(3655);
		expect(press?.twoPiece).toBe(true);
		expect(press?.reasons).toEqual(['belowFull']);
		expect(press?.good).toBe(false);
	});

	/**
	 * The graded figure, and it moves on exactly one pull — upward, which is the only direction this
	 * change can move it: B drops one of A's conditions and loosens another.
	 *
	 * `phased` gains two good shocks because five of its faults were `fsLow` and `ascReady`, charged
	 * against a player whose rotation contains neither. `unbroken` and `cleave` did not move for the
	 * two-piece change: their faults were already `belowFull` and `twoPiece`, and every other in-window
	 * press sits 9 to 26 seconds from its window's end, so `twoPiece` is still right for all of them.
	 *
	 * **`cleave` has since moved 41.6667 → 50 for a different reason**, and this test is where the two
	 * changes meet, which is why the number is restated rather than relaxed. Earth Shock is now judged
	 * against the list the *press's own target count* puts it under (§64), and three of `cleave`'s twelve
	 * shocks land at two enemies, where `cleave.apl.json` rung 13 asks for six stacks and eight seconds
	 * of dot and asks nothing at all about the two-piece debuff. One of those three had been charged
	 * `twoPiece` under a branch that is not in its list. `phased` and `unbroken` are single-target
	 * throughout — `targets.counts.max` is 1 on both — so neither can move, and both are pinned here as
	 * the guard for that.
	 *
	 * **And `cleave` has moved once more, 50 → 42.8571**, for a third reason that belongs in the same
	 * ledger: its band-3 and band-4 presses have left the denominator entirely, because `aoe.apl.json`
	 * carries no Earth Shock rung and so nothing judges a shock at three or more enemies. Five of its
	 * twelve presses, three of which this branch had been charging with `twoPiece` or `fsTail` under a
	 * list that does not contain either. Measured in `earthShockAoeBand.test.ts`.
	 *
	 * All three stay `bad` — the `ok` boundary is 65 (`score.ts`'s `earthShockWaste` threshold).
	 */
	it('moves earthShockWaste on phased alone, and upward', () => {
		// **Every figure here has moved, and one defect explains all three.** The tier-16 `remaining` check
		// read `remainingIn(t, twoPieceWindows)`, and `auraWindows` does not split a window on a refresh —
		// so a debuff kept up across a phase was one window from its first apply to its last remove, and the
		// check answered the distance to the end of that *run*. `unbroken`'s is 36.1 seconds against an aura
		// that cannot hold fourteen. Every shock inside it read far too much time left and every one was
		// charged, including the ones taken with under a second on the debuff. The remaining is modelled
		// from the charges the previous shock spent now — see `dischargeExpiry` — and `twoPiece` reaches no
		// committed pull at all, the same place `ascReady` has always been.
		expect(wastePct(unbroken)).toBeCloseTo(19.2308, 3);
		expect(wastePct(analysed('cleave'))).toBeCloseTo(21.4286, 3);
		expect(wastePct(analysed('phased'))).toBeCloseTo(8.3333, 3);
	});

	/**
	 * *** The prediction in this block came true and the block could not see it. ***
	 *
	 * It used to read "Branch A's two conditions reach no press on any committed pull, because all three
	 * own the set", and it ended: *"if a future fixture arrives without the set this goes red and says
	 * so."* A future fixture arrived without the set — `addsThenBoss.json`, whose shaman writes 144999 zero
	 * times — and **nothing went red**, because the pull list under that sentence was the literal
	 * `['phased', 'unbroken', 'cleave']`. The guard was correct about what it would find and wrong about
	 * where it would look.
	 *
	 * **What the fourth pull actually charges.** `fsLow` **fires**, on a real press: `addsThenBoss`'
	 * Earth Shock reasons are `cleaveDot`, `cleaveStacks`, `fsLow` and `belowFull`. `ascReady` still
	 * reaches no press on any pull. So half the old claim is false and half of it survives, and they are
	 * separated here rather than averaged into a weaker sentence.
	 *
	 * That is the *right* outcome and not a defect in the audit: branch A is the no-two-piece branch, and
	 * `addsThenBoss` is a pull with no two-piece, so a rotation judged by it *should* see branch A's
	 * conditions. What was defective was the evidence — the synthetic pull below spent this whole time
	 * being "the only cover branch A has" while a captured log had been covering half of it in silence.
	 *
	 * The set is discovered now, so the fifth fixture is asked the same question automatically.
	 */
	it('charges branch A’s conditions on exactly the pulls that lack the set', () => {
		const withFsLow: string[] = [];
		for (const name of FIXTURES) {
			const el = analysed(name);
			const reasons = el.earthShock.presses.flatMap((p) => p.reasons);
			// `ascReady` is the half that is still true of every committed pull — branch A's other condition
			// reaches no press anywhere, so the synthetic below remains its only cover.
			expect(reasons, name).not.toContain('ascReady');
			// And the pull really does have presses to charge, so this is not vacuous.
			expect(el.earthShock.presses.length, name).toBeGreaterThan(0);
			if (reasons.includes('fsLow')) withFsLow.push(name);
		}
		// The one pull whose log carries no 144999 at all is the one pull branch A speaks on, and it is the
		// pull the old literal did not name. Asserted as the whole list rather than as a membership test, so
		// a fifth fixture without the set has to be added here deliberately.
		expect(withFsLow).toEqual(['addsThenBoss']);
		const dischargeEvents = (name: string) =>
			load(name).events.filter((e) => (e as { abilityGameID?: number }).abilityGameID === 144_999).length;
		expect(dischargeEvents('addsThenBoss')).toBe(0);
		for (const name of ['cleave', 'phased', 'unbroken']) expect(dischargeEvents(name), name).toBeGreaterThan(0);
	});
});

// ------------------------------------------------------------------ synthetic
//
// The pull no real log in this repository holds: a shock taken in the last four seconds of a two-piece
// window with the shield at its ceiling, which is the press branch B exists to allow.
//
// The shield is charged to seven and left there — no drain is emitted — so every press below sees the
// same seven charges and `belowFull` cannot confound the branch under test. Ascendance goes down at 1s
// so its 180s clock keeps `ascReady` off every press: without a cast the button reads as never pressed,
// which the audit scores as "ready now" and would push onto all of them.

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
/** Elemental Discharge — the debuff the tier-16 two-piece proc leaves, and the id a log actually writes. */
const T16_2PC = 144_999;
/** The cadence the ticks below are emitted at, so `2 x tickMs` is 3 000ms and can be aimed at. */
const TICK_MS = 1500;

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

/** A hit every two seconds, so the engaged clock is the whole pull with no forgiven gap in it. */
const contact: WclEvent[] = Array.from({ length: DURATION / 2000 + 1 }, (_, i) =>
	onBoss(i * 2000, 'damage', LIGHTNING_BOLT, { amount: 1000, hitType: 1 }),
);

/** Seven charges by 6s, and nothing takes them away again. */
const shield: WclEvent[] = [
	e(0, 'applybuff', LIGHTNING_SHIELD),
	...Array.from({ length: 6 }, (_, i) => e(1000 + i * 1000, 'applybuffstack', LIGHTNING_SHIELD, { stack: 2 + i })),
];

/**
 * The dot up from the start to 45s, ticking every 1 500ms — then down for the rest of the pull.
 *
 * The tail matters: the press at 53s lands with the dot off the target, which is what makes `fsTail`
 * reachable while the proc's own four-second condition is satisfied.
 */
const dot: WclEvent[] = [
	onBoss(0, 'applydebuff', FLAME_SHOCK),
	...Array.from({ length: 45_000 / TICK_MS - 1 }, (_, i) =>
		onBoss((i + 1) * TICK_MS, 'damage', FLAME_SHOCK, { tick: true, amount: 1000, unmitigatedAmount: 900, hitType: 1 }),
	),
	onBoss(45_000, 'removedebuff', FLAME_SHOCK),
];

/** Two proc windows: a fourteen-second one while the dot is up, and a six-second one after it drops. */
const twoPiece: WclEvent[] = [
	onBoss(10_000, 'applydebuff', T16_2PC),
	onBoss(24_000, 'removedebuff', T16_2PC),
	onBoss(50_000, 'applydebuff', T16_2PC),
	onBoss(56_000, 'removedebuff', T16_2PC),
];

/**
 * Four shocks, one per case.
 *
 *   14s  proc up with 10s left on it — too soon, `twoPiece`.
 *   21s  proc up with 3s left, shield full, dot 24s — **the press branch B allows**.
 *   30s  proc down, dot 15s, Ascendance far away — branch A, and good.
 *   53s  proc up with 3s left, but the dot is off the target — `fsTail`.
 */
const presses: WclEvent[] = [
	e(1000, 'cast', ASCENDANCE),
	// One Lava Burst so the pull is recognised as Elemental at all — the spec test looks for the rotation
	// and a stream of Lightning Bolts alone is not one.
	onBoss(3000, 'cast', LAVA_BURST),
	onBoss(14_000, 'cast', EARTH_SHOCK),
	onBoss(21_000, 'cast', EARTH_SHOCK),
	onBoss(30_000, 'cast', EARTH_SHOCK),
	onBoss(53_000, 'cast', EARTH_SHOCK),
];

const fight = {
	id: 1,
	name: 'Iron Qon',
	encounterID: 1662,
	kill: true,
	difficulty: 4,
	size: 25,
	startTime: T0,
	endTime: T0 + DURATION,
};

const dataset: FightDataset = {
	code: 'ele997',
	fight,
	actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
	actors: [{ id: ME, name: 'Sparkstorm', type: 'Player' }],
	events: [...contact, ...shield, ...dot, ...twoPiece, ...presses],
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
};

describe('a shock taken in the tail of a two-piece window', () => {
	const el = analyse(dataset) as Analysis & ElementalAuditResult;

	it('sets the pull up the way the branch needs it', () => {
		expect(el.isSpec).toBe(true);
		expect(el.earthShock.presses.map((p) => p.t)).toEqual([14_000, 21_000, 30_000, 53_000]);
		// Seven charges under every press, so nothing below can be explained by the shield.
		expect(el.earthShock.presses.map((p) => p.lsStacks)).toEqual([7, 7, 7, 7]);
		expect(el.earthShock.presses.map((p) => p.twoPiece)).toEqual([true, true, false, true]);
	});

	/**
	 * The press the change exists for: proc up, 3 000ms left on it, shield full, dot 24s.
	 *
	 * Under the old rule this read `twoPiece` and was charged against `earthShockWaste` — a shock fired
	 * exactly as the list's second branch asks for it, reported as a shock spent early.
	 */
	it('is the press the list asked for, and carries no reason', () => {
		const press = el.earthShock.presses.find((p) => p.t === 21_000);
		expect(press?.fsRemainingMs).toBe(24_000);
		expect(press?.reasons).toEqual([]);
		expect(press?.good).toBe(true);
	});

	/** Ten seconds from the window's end is still too soon, which is the half of the rule that stands. */
	it('still faults a shock taken too early in the same window', () => {
		const press = el.earthShock.presses.find((p) => p.t === 14_000);
		expect(press?.reasons).toEqual(['twoPiece']);
		expect(press?.good).toBe(false);
	});

	/** The other branch is untouched: proc down, dot up, Ascendance held. */
	it('leaves a press outside every window on the first branch', () => {
		const press = el.earthShock.presses.find((p) => p.t === 30_000);
		expect(press?.twoPiece).toBe(false);
		expect(press?.fsRemainingMs).toBe(15_000);
		expect(press?.reasons).toEqual([]);
	});

	/**
	 * The branch's own dot floor, which is two of the press's *measured* tick periods and not six seconds.
	 *
	 * The dot is emitted at 1 500ms, so the floor is 3 000ms — a number `ES_FS_MIN_MS` could not produce.
	 * This press has nothing on the target at all, so it fails the floor and reports `fsTail` rather than
	 * `fsLow`: the row has to say which test it failed, because the two are 3 000ms apart.
	 */
	it('names the two-tick floor rather than the six-second one', () => {
		const press = el.earthShock.presses.find((p) => p.t === 53_000);
		const tickMs = el.flameShock.presses.length > 0 ? el.flameShock.tickMs : TICK_MS;
		expect(tickMs).toBeCloseTo(TICK_MS, 0);
		expect(press?.fsRemainingMs).toBe(0);
		expect(press?.reasons).toEqual(['fsTail']);
	});

	/** Two of the four, and the two that pass are one from each branch. */
	it('grades two of the four good', () => {
		expect(el.earthShock.good).toBe(2);
		expect(wastePct(el)).toBeCloseTo(50, 3);
	});
});
