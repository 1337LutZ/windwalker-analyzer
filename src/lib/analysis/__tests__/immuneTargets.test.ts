// Immune and short-lived units, on the pull that produced the bug — both specs, one fix.
//
// The Iron Juggernaut throws Crawler Mines, and every hit on one comes back `Immune`. They were counted
// as enemies anyway, which produced two symptoms that look unrelated and are one bug in shared code:
// the Windwalker's per-moment target count — the band that decides Rushing Jade Wind's three-target chi
// refund and how Rising Sun Kick's cleave is judged — read four targets where there was one, and the
// Elemental measured a second Flame Shock's coverage against a unit no dot could ever stick to.
//
// It lives here rather than in either spec's own test directory on purpose: the fix is one predicate in
// `analysis/targets.ts`, so the test that proves it has to be able to see both symptoms move together.
// A per-spec copy would pass while the other spec silently regressed.
//
// Three anonymous reports of the same encounter, `a:` codes, which is the only kind of log that belongs
// in this repository. All three are raw `FightDataset`s, so `analyse` really runs — the pre-analysed
// `Analysis` fixtures cannot exercise the engine at all.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isDamage, type WclEvent } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse as analyseElemental } from '~/specs/elemental/lib';
import { analyse as analyseWindwalker } from '~/specs/windwalker/lib';

const load = (path: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, path), 'utf8')) as FightDataset;

/**
 * The target-mode block, which every assertion in this file is ultimately about.
 *
 * It is optional on `Analysis` — an analysis captured before it existed carries none — so a test that
 * reached through it with `?.` would pass silently on a pull that had no target reading at all. Absent
 * here is a failure.
 */
const targetsOf = (a: Analysis): NonNullable<Analysis['targets']> => {
	const targets = a.targets;
	if (targets === undefined) throw new Error('analysis carries no target mode');
	return targets;
};

const WW = '../../../specs/windwalker/__fixtures__/dataset-ironJuggernaut.json';
const EL = (name: string): string => `../../../specs/elemental/__fixtures__/${name}.json`;

/**
 * The marker itself, asserted against the raw stream rather than taken on trust.
 *
 * This is the assertion that would catch a wrong `IMMUNE_HIT_TYPE`, and it is the one that matters most:
 * a wrong constant there does not fail, it matches nothing, and every fix built on it silently does
 * nothing at all. So the fixture is read directly and the two facts the rule stands on are counted.
 */
describe('what marks a hit as immune, read off the log', () => {
	const dataset = load(WW);
	const damage = dataset.events.filter(isDamage);
	const CRAWLER_MINE = dataset.actors.find((a) => a.name === 'Crawler Mine')?.id;

	it('finds the Crawler Mines and the boss in the report', () => {
		expect(CRAWLER_MINE).toBe(236);
		expect(dataset.actors.find((a) => a.name === 'Iron Juggernaut')?.id).toBe(231);
	});

	it('has hitType 10 on every hit the mines ever took, and nothing else', () => {
		const onMines = damage.filter((e) => e.targetID === CRAWLER_MINE);
		expect(onMines).toHaveLength(27);
		expect(onMines.every((e) => e.hitType === 10)).toBe(true);
		expect(onMines.every((e) => e.amount === 0)).toBe(true);
		// Nine spawns, so this is every mine on the pull rather than one unlucky one.
		expect(new Set(onMines.map((e) => e.targetInstance)).size).toBe(9);
	});

	/**
	 * The case that makes the rule a rule about the *unit*.
	 *
	 * The boss returns five immune Fists of Fury ticks in the middle of a pull that kills it. An
	 * event-level rule would drop those five hits, punching a hole in the contact clock while the player
	 * was demonstrably attacking — and would still leave the boss counted, so it buys nothing.
	 */
	it('also has hitType 10 on the boss, which was immune for a phase and died anyway', () => {
		const onBoss = damage.filter((e) => e.targetID === 231);
		const immuneOnBoss = onBoss.filter((e) => e.hitType === 10);
		expect(immuneOnBoss).toHaveLength(5);
		expect(onBoss.length).toBe(1039);
		expect(immuneOnBoss.every((e) => e.abilityGameID === 120_086)).toBe(true);
	});

	/** Amount alone cannot stand in for the marker: three other hit types carry a zero too. */
	it('cannot be read off the amount instead', () => {
		const zeroAmount = damage.filter((e) => e.amount === 0);
		expect(new Set(zeroAmount.map((e) => e.hitType))).toEqual(new Set([0, 1, 8, 10]));
	});
});

/**
 * The Windwalker symptom: the per-moment target count, which is what the priority ladder reads at each
 * press and what decides whether the wind earned its chi back.
 *
 * Before the fix this pull reported a peak of four targets and 20 135ms of multi-target time. Every one
 * of those enemies past the first was a mine — the monk landed ten hits on six mine spawns, all immune —
 * so the honest reading is a single-target pull throughout.
 */
describe('the Windwalker target count on Iron Juggernaut', () => {
	const a = analyseWindwalker(load(WW));

	it('never counts more than the one enemy that could be damaged', () => {
		expect(targetsOf(a).counts.max).toBe(1);
		expect(targetsOf(a).multiTargetMs).toBe(0);
		expect(targetsOf(a).multiTargetPct).toBe(0);
	});

	/**
	 * And the fan-out figure agrees with it, which is the half that is easy to leave behind: it is a
	 * second number about "how many enemies was this" over the same events, and the two disagreeing on
	 * one pull is a bug this seam has already had once.
	 */
	it('keeps the damage table fan-out in step with it', () => {
		const padded = a.damage.abilities.filter((x) => (x.averageTargetsHit ?? 0) > 1);
		expect(padded.map((x) => x.name)).toEqual([]);
	});

	/**
	 * The Rising Sun Kick coverage walk, which hands each landed hit the time until the next one and asks
	 * whether *that* enemy carried the debuff. A swing at a mine used to own a slice of the pull and
	 * could never have carried anything, so the stretch was charged as uncovered — a fault the player
	 * could not have avoided. 96.00% before, 98.12% after.
	 */
	it('stops charging a swing at a mine as debuff coverage the monk lost', () => {
		expect(+a.debuff.engagedUptimePct.toFixed(2)).toBe(98.12);
	});
});

/**
 * The Elemental symptom, and the two reasons a second target can fail to deserve a verdict.
 *
 * Both are the same question — does this unit deserve to be judged — and both come out of the same
 * predicate. `unbroken` is the immunity case: its only other enemies are seven wholly-immune mine
 * spawns. `phased` is the lifetime case: after the mines are gone it still has one other unit, hit
 * eight times across five seconds, which is not a target a dot could ever have paid for.
 *
 * "Disregarded" and not "0%": a zero denominator is the gate both readers of this figure already use —
 * `score.ts` grades nothing below it and the section hides the tile — so the pull is left unjudged
 * rather than handed a score it had no way to beat.
 */
describe('the Elemental second Flame Shock on Iron Juggernaut', () => {
	const el = (name: string): Analysis & ElementalAuditResult =>
		analyseElemental(load(EL(name))) as Analysis & ElementalAuditResult;

	it('disregards the multi-dot rule on a pull whose only other enemies were immune', () => {
		const a = el('unbroken');
		expect(targetsOf(a).counts.max).toBe(1);
		expect(a.flameShock.multiTargetMs).toBe(0);
		expect(a.flameShock.multiDotUptimeMs).toBe(0);
	});

	it('disregards it again when the only other target did not live long enough to be worth a global', () => {
		const a = el('phased');
		// The mines are out of the count, but a real second unit remains — so this is the lifetime clause
		// doing the work and not the immunity one.
		expect(targetsOf(a).counts.max).toBe(2);
		expect(targetsOf(a).multiTargetMs).toBe(5000);
		expect(a.flameShock.multiTargetMs).toBe(0);
	});

	/**
	 * And the primary dot is untouched by all of it, which is the control on this change.
	 *
	 * `flameShock.uptimePct` is measured against the boss's own engaged clock, so no reading of it ever
	 * involved a mine. If this moves, the fix has reached somewhere it had no business reaching.
	 *
	 * `phased` reads 88.6226 and not the 88.6748 this pinned when it was written, and the target set is
	 * not why. The numerator is now intersected with the engaged windows before the division — see
	 * `uptimeSpan.test.ts` — and 125ms of that fixture's dot ran on past the last landed hit on the
	 * boss, so it was being credited against a span not containing it. Same 5 windows, same
	 * `uptimeMs`; only the share moved. `unbroken` is unchanged to every digit, because its dot closes
	 * 1ms *inside* its engaged clock and there was nothing to clip.
	 */
	it('leaves the dot on the boss exactly where it was', () => {
		expect(+el('phased').flameShock.uptimePct.toFixed(4)).toBe(88.6226);
		expect(+el('unbroken').flameShock.uptimePct.toFixed(4)).toBe(99.9995);
	});
});

// ---------------------------------------------------------------------------------------------------
// The positive half.
//
// Both committed Iron Juggernaut fixtures now report the multi-dot metric as disregarded, which is the
// right answer for both and leaves the suite unable to tell a fix that correctly silences the metric
// from one that silences it for everybody. Neither fixture can supply the other side: the encounter's
// only other units are Crawler Mines. So a synthetic pull does, and the three cases are the same pull
// with one thing changed about the second enemy — it lives, it dies early, it is immune.

const T0 = 400_000;
const DURATION = 120_000;
const ME = 9;
const BOSS = 20;
const ADD = 40;

const FLAME_SHOCK = 8050;
const LAVA_BURST = 51_505;
const EARTH_SHOCK = 8042;
const LIGHTNING_BOLT = 403;

const ev = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

const landed = (t: number, target: number, hitType = 1): WclEvent =>
	ev(t, 'damage', LIGHTNING_BOLT, { targetID: target, amount: hitType === 10 ? 0 : 1000, hitType });

/** Every two seconds, so the contact clock is one unbroken segment and nothing is forgiven as a gap. */
const every2s = (fromMs: number, toMs: number, target: number, hitType = 1): WclEvent[] =>
	Array.from({ length: Math.floor((toMs - fromMs) / 2000) + 1 }, (_, i) => landed(fromMs + i * 2000, target, hitType));

/** The dot held on one unit from `fromMs` to `toMs` through refreshes, the way a real one is. */
const dotOn = (target: number, fromMs: number, toMs: number): WclEvent[] => [
	ev(fromMs, 'applydebuff', FLAME_SHOCK, { targetID: target }),
	ev(fromMs + 20_000, 'refreshdebuff', FLAME_SHOCK, { targetID: target }),
	ev(fromMs + 40_000, 'refreshdebuff', FLAME_SHOCK, { targetID: target }),
	ev(toMs, 'removedebuff', FLAME_SHOCK, { targetID: target }),
];

const fightHeader = {
	id: 1,
	name: 'Iron Qon',
	encounterID: 1662,
	kill: true,
	difficulty: 4,
	size: 25,
	startTime: T0,
	endTime: T0 + DURATION,
};

const synthetic = (events: WclEvent[]): FightDataset => ({
	code: 'ele-immune',
	fight: fightHeader,
	actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
	actors: [
		{ id: ME, name: 'Sparkstorm', type: 'Player' },
		// `subType: 'Boss'` is what makes this the primary rather than the most-damaged unit — the
		// secondary pick is "the busiest enemy that is not the primary", so the primary has to be pinned.
		{ id: BOSS, name: 'Iron Qon', type: 'NPC', subType: 'Boss' },
		{ id: ADD, name: 'Quilen Guardian', type: 'NPC', subType: 'NPC' },
	],
	events,
	table: {
		fight: {
			...fightHeader,
			enemyNPCs: [
				{ id: BOSS, gameID: 68_078 },
				{ id: ADD, gameID: 68_079 },
			],
		},
		damageDone: {
			entries: [
				{
					name: 'Sparkstorm',
					id: ME,
					type: 'Shaman',
					itemLevel: 553,
					total: 100_000,
					activeTime: DURATION,
					abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 100_000 }],
				},
			],
		},
	},
});

/** Enough presses for the audit to have something to grade, and to read the player as Elemental. */
const presses: WclEvent[] = [
	ev(1000, 'cast', LAVA_BURST, { targetID: BOSS }),
	ev(2000, 'cast', FLAME_SHOCK, { targetID: BOSS }),
	ev(10_000, 'cast', FLAME_SHOCK, { targetID: ADD }),
	ev(30_000, 'cast', EARTH_SHOCK, { targetID: BOSS }),
];

const bossHits = every2s(0, 118_000, BOSS);
const bossDot = dotOn(BOSS, 0, 118_000);

const run = (events: WclEvent[]): Analysis & ElementalAuditResult =>
	analyseElemental(synthetic(events)) as Analysis & ElementalAuditResult;

describe('a second target that does deserve to be judged', () => {
	/**
	 * The add is hit every two seconds from 10s to 60s, so it lives fifty seconds — comfortably past the
	 * twenty the dot needs to pay for its global — and carries the dot for all of it.
	 *
	 * This is the case that proves the metric can still say something. Without it, "correctly
	 * disregarded" and "accidentally zeroed for everyone" are the same observation.
	 */
	const scored = run([
		...bossHits,
		...bossDot,
		...every2s(10_000, 60_000, ADD),
		...dotOn(ADD, 10_000, 60_000),
		...presses,
	]);

	it('is Elemental, with the boss as the primary and the add as the second enemy', () => {
		expect(scored.isSpec).toBe(true);
		expect(scored.primaryTarget?.id).toBe(BOSS);
	});

	it('counts the add and scores the second dot against it', () => {
		expect(targetsOf(scored).counts.max).toBe(2);
		// Both hit every 2s from 10s; the add's last hit at 60s ages out of the 5s window at 65s.
		expect(targetsOf(scored).multiTargetMs).toBe(55_000);
		expect(scored.flameShock.multiTargetMs).toBe(55_000);
		expect(scored.flameShock.multiDotUptimeMs).toBe(50_000);
		expect(+scored.flameShock.multiDotUptimePct.toFixed(2)).toBe(90.91);
	});

	/**
	 * The same pull with the add hit at 10s, 12s and 14s and never again — four seconds of observed life,
	 * which is the plan's own example. It was a real enemy and it was really dotted, and it still must not
	 * be scored: four seconds of dot did not pay for the global that applied it, so neither the
	 * application nor its absence is a fault the report can name.
	 */
	it('refuses to score the same add when it only lived four seconds', () => {
		const short = run([
			...bossHits,
			...bossDot,
			...every2s(10_000, 15_000, ADD),
			...dotOn(ADD, 10_000, 15_000),
			...presses,
		]);
		// Still a target, so the pull really did go multi-target — this is the lifetime clause and not
		// the immunity one. Last hit 14s, ageing out of the 5s window at 19s.
		expect(targetsOf(short).counts.max).toBe(2);
		expect(targetsOf(short).multiTargetMs).toBe(9000);
		expect(short.flameShock.multiTargetMs).toBe(0);
	});

	/** And the same pull again with the add immune throughout: not a target at all, so never counted. */
	it('does not count the same add at all when every hit on it came back immune', () => {
		const immune = run([...bossHits, ...bossDot, ...every2s(10_000, 60_000, ADD, 10), ...presses]);
		expect(targetsOf(immune).counts.max).toBe(1);
		expect(targetsOf(immune).multiTargetMs).toBe(0);
		expect(immune.flameShock.multiTargetMs).toBe(0);
	});
});

/**
 * The counterexample the unit-level rule exists for, pinned so it cannot be "simplified" to an
 * event-level check.
 *
 * The Iron Juggernaut returns five immune Fists of Fury ticks at 71.3s–74.3s. It is still the enemy the
 * monk is fighting through that stretch and it dies at the end of the pull, so the count must read one
 * across it — not zero, and not a hole in the series. An event-level rule would drop those five hits and
 * open exactly that hole.
 */
describe('a unit that was immune for one phase stays a target', () => {
	const a = analyseWindwalker(load(WW));
	const countAtMs = (t: number): number => {
		let count = 0;
		for (const [at, n] of targetsOf(a).counts.points) if (at <= t) count = n;
		return count;
	};

	it('counts the boss right through its immune stretch', () => {
		expect(countAtMs(71_000)).toBe(1);
		expect(countAtMs(72_500)).toBe(1);
		expect(countAtMs(74_500)).toBe(1);
	});

	it('opens no gap in the count across it', () => {
		const inside = targetsOf(a).counts.points.filter(([at]) => at > 60_000 && at < 90_000);
		expect(inside).toEqual([]);
	});
});

// ---------------------------------------------------------------------------------------------------
// The other half of the answer: an immune unit IS a target for a trigger.
//
// Rushing Jade Wind's chi refund fires on the number of units it *hit*, and it does not ask whether any
// damage landed — so a wind spinning through a pack of Crawler Mines pays its chi back, and that chi is
// the whole reason the wind beats Jab into a pack. The damage readings above and this one are two
// questions about the same moment, and the ability model is what says which a given button is asking.
//
// The Iron Juggernaut fixture cannot show this: the monk on that pull did not talent the wind, which is
// exactly why collapsing the two counts did not surface as a failing test. So a synthetic pull does.

const WW_T0 = 300_000;
const WW_DURATION = 60_000;
const MONK = 5;
const WW_BOSS = 20;
const MINE = 30;

const RJW_CAST = 116_847;
const RJW_DAMAGE = 148_187;
const SCK_CAST = 101_546;
const SCK_DAMAGE = 107_270;
const RSK_CAST = 107_428;
const TEB_BANK = 1_247_279;

/**
 * Energy and chi on every event, which is what makes the priority ladder run at all.
 *
 * `aplAudit` returns null rather than an empty audit for a log with no resource readings — "no mistakes"
 * and "could not tell" being different answers — so a synthetic pull that wants a verdict has to carry
 * the bars. WarcraftLogs' own power-type numbering: energy 3, chi 12.
 *
 * `resourceActor: 1` means "the source's bars" and is **not** an actor id — 1 is the source, 2 is the
 * target, and anything else is dropped as a shape the reader does not understand. Writing the monk's own
 * id there silently produced a pull with zero samples and a null priority audit.
 */
const bars = (energy: number, chi: number): Record<string, unknown> => ({
	resourceActor: 1,
	classResources: [
		{ amount: energy, max: 100, type: 3 },
		{ amount: chi, max: 4, type: 12 },
	],
});

const wwEvent = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: WW_T0 + t,
	type,
	abilityGameID: id,
	sourceID: MONK,
	targetID: MONK,
	...extra,
});

/** One area tick landing on the boss and on three mines at a single instant, as an area hit does. */
const areaTick = (t: number, damageID: number): WclEvent[] => [
	wwEvent(t, 'damage', damageID, { targetID: WW_BOSS, amount: 5000, hitType: 1 }),
	...[1, 2, 3].map((instance) =>
		wwEvent(t, 'damage', damageID, { targetID: MINE, targetInstance: instance, amount: 0, hitType: 10 }),
	),
];

/**
 * The wind pressed at `t`, with the bars it was pressed on.
 *
 * Full energy and three chi, so entry 17 is affordable and nothing above it on the ladder — there is
 * nothing above it — can claim the global instead.
 */
const windPress = (t: number): WclEvent => wwEvent(t, 'cast', RJW_CAST, bars(100, 3));

const wwFight = {
	id: 3,
	name: 'Iron Juggernaut',
	encounterID: 51_600,
	kill: true,
	difficulty: 4,
	size: 25,
	startTime: WW_T0,
	endTime: WW_T0 + WW_DURATION,
};

const wwDataset: FightDataset = {
	code: 'ww-trigger',
	fight: wwFight,
	actor: { id: MONK, name: 'Bigdogmo', type: 'Player' },
	actors: [
		{ id: MONK, name: 'Bigdogmo', type: 'Player' },
		{ id: WW_BOSS, name: 'Iron Juggernaut', type: 'NPC', subType: 'Boss' },
		{ id: MINE, name: 'Crawler Mine', type: 'NPC', subType: 'NPC' },
	],
	events: [
		// The Tigereye Brew bank, which is what `identify` reads to call this a Windwalker at all — the
		// buff is earned by spending chi and no other spec has it.
		wwEvent(500, 'applybuffstack', TEB_BANK, { stack: 1 }),
		wwEvent(1500, 'applybuffstack', TEB_BANK, { stack: 2 }),
		wwEvent(1000, 'cast', RSK_CAST, { targetID: WW_BOSS, ...bars(100, 2) }),
		wwEvent(1000, 'damage', RSK_CAST, { targetID: WW_BOSS, amount: 9000, hitType: 1, ...bars(100, 2) }),
		// Spinning Crane Kick, into the boss and three immune mines: a damage ability with the same
		// fan-out as the wind, so the two rows sit side by side over identical events.
		//
		// It is also what puts the mines into the trailing count window *before* the wind is pressed. The
		// wind's own ticks cannot do that job: `aplTargetCountExclude` keeps a spec's own area damage from
		// establishing its own multi-target evidence, so both counts drop RJW's 148187 and a pull whose
		// only fan-out is the wind reads as one target at every press of it.
		wwEvent(2000, 'cast', SCK_CAST, bars(100, 2)),
		...areaTick(2000, SCK_DAMAGE),
		// The press under test: the wind, one global later, with three immune mines in the window.
		windPress(3000),
		...areaTick(3000, RJW_DAMAGE),
		...areaTick(4000, RJW_DAMAGE),
		...areaTick(7000, SCK_DAMAGE),
		...areaTick(8000, SCK_DAMAGE),
		// A late press, so the energy curve has more than one reading and a regen rate can be measured.
		wwEvent(30_000, 'cast', RSK_CAST, { targetID: WW_BOSS, ...bars(100, 2) }),
		wwEvent(30_000, 'damage', RSK_CAST, { targetID: WW_BOSS, amount: 9000, hitType: 1, ...bars(100, 2) }),
	],
	table: {
		fight: {
			...wwFight,
			enemyNPCs: [
				{ id: WW_BOSS, gameID: 71_466 },
				{ id: MINE, gameID: 72_050 },
			],
		},
		damageDone: {
			entries: [
				{
					name: 'Bigdogmo',
					id: MONK,
					type: 'Monk',
					itemLevel: 553,
					total: 29_000,
					activeTime: WW_DURATION,
					abilities: [{ guid: RJW_DAMAGE, name: 'Rushing Jade Wind', total: 10_000 }],
				},
			],
		},
	},
};

describe('an immune unit is a target for a trigger', () => {
	const a = analyseWindwalker(wwDataset);
	const rowFor = (id: number): number | undefined => a.damage.abilities.find((x) => x.id === id)?.averageTargetsHit;

	it('is read as a Windwalker pull at all', () => {
		expect(a.isSpec).toBe(true);
	});

	/**
	 * Four units hit, one of them able to take damage. The wind counts all four because its refund does;
	 * the kick counts one because its benefit is the damage it dealt. Same events, same instants, same
	 * pull — the only thing that differs is which question the ability is asking.
	 */
	it('counts every unit the wind hit and only the one the kick damaged', () => {
		expect(rowFor(RJW_DAMAGE)).toBe(4);
		expect(rowFor(SCK_DAMAGE)).toBe(1);
	});

	/**
	 * And the pull's own damage character is unmoved by the mines, which is the reading step 26 fixed.
	 * The two numbers sitting side by side — a fan-out of four and a damage count of one — are the whole
	 * point: neither is wrong, and one series could not have said both.
	 */
	it('still reads the pull as one damage target', () => {
		expect(targetsOf(a).counts.max).toBe(1);
		expect(targetsOf(a).multiTargetMs).toBe(0);
	});
});

/**
 * The whole chain, end to end: immune hits → the trigger count → the ladder's band → a correct verdict.
 *
 * This is the assertion that closes the gap the engine-level test in `lib/spec/__tests__/apl.test.ts`
 * cannot: that one supplies `triggerTargetsAt` directly, so it proves the *engine* reads the second
 * count and says nothing about whether the core ever builds one. Rebuilding the trigger series off the
 * damage-filtered hit list leaves every other test in this repository green.
 */
describe('the trigger count reaches the ladder', () => {
	const a = analyseWindwalker(wwDataset);

	it('grades the wind into a pack of immune mines as the multi-target rung followed', () => {
		const press = a.apl?.presses.find((p) => p.pressed === RJW_CAST);
		expect(press).toMatchObject({ verdict: 'followed', wanted: 'rushing-jade-wind-open' });
	});
});
