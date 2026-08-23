// Two claims a Flame Shock press can be graded against, and the one the audit now uses.
//
// `spawnAt(t)` answers "which enemy was the player hitting", which is right for an Earth Shock — a rule
// about the enemy in front of you. A Flame Shock press is the one case where aim and contact diverge by
// *design*: the cleave rule's whole point is a second dot on an add while every hit either side of it
// lands on the boss. Graded against the hit enemy, that deliberate multi-dot reads as a refresh of a dot
// already up, and is charged as a wasted global for doing what the priority list asked.
//
// Neither Iron Juggernaut fixture can hold this fixed: on both, every Flame Shock cast names the boss and
// every dot event is already sourced to the player, so both behaviours are provably inert there. That is
// the right answer and not a demonstration, so the synthetic suites below exist — and every assertion in
// them was checked against the previous reading, with the ones that flip named in their comments.
//
// **The line above used to say "neither committed fixture", and `addsThenBoss` is why it no longer can.**
// That pull aims 23 of its 31 Flame Shocks at an add, so the *timeline* half of this reading — the last
// two blocks in this file — is measurable on a real log, and it is asserted there off the four committed
// fixtures rather than off a fabricated pull. The `sourceID` half still cannot be: not one of the four
// carries a single Flame Shock aura event from another source, and that count is asserted as the premise
// of the synthetic pull that stands in for it.
import { describe, expect, it } from 'vitest';

import { rawFixture } from '~/lib/analysis/fixtures';
import { abilityIdOf } from '~/lib/events/guards';
import type { WclEvent } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import type { Metric } from '~/lib/score';
import { resolveBands } from '~/lib/view/targetMode';
import { analyse } from '../index';
import { scoreAnalysis } from '../score';

const T0 = 700_000;
const DURATION = 120_000;
const ME = 11;
const OTHER_SHAMAN = 12;
const BOSS = 50;
const ADD = 51;

const FLAME_SHOCK = 8050;
const LAVA_BURST = 51_505;
const LIGHTNING_BOLT = 403;
const ASCENDANCE = 114_049;

const at = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

/** Contact on the boss throughout, so nothing here is forgiven as an intermission. */
const contact: WclEvent[] = Array.from({ length: DURATION / 2000 + 1 }, (_, i) =>
	at(i * 2000, 'damage', LIGHTNING_BOLT, { targetID: BOSS, amount: 1000, hitType: 1 }),
);

const dataset = (events: WclEvent[]): FightDataset => {
	const meta = {
		id: 1,
		name: 'Kor’kron Dark Shaman',
		encounterID: 1623,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: T0 + DURATION,
	};
	return {
		code: 'a:aimed',
		fight: meta,
		actor: { id: ME, name: 'Player (11)', type: 'Player' },
		actors: [
			{ id: ME, name: 'Player (11)', type: 'Player' },
			{ id: OTHER_SHAMAN, name: 'Player (12)', type: 'Player' },
			{ id: BOSS, name: 'Haromm', type: 'NPC' },
			{ id: ADD, name: 'Toxic Mist', type: 'NPC' },
		],
		events: [...contact, ...events].sort((a, b) => a.timestamp - b.timestamp),
		table: {
			fight: {
				...meta,
				enemyNPCs: [
					{ id: BOSS, gameID: 71858 },
					{ id: ADD, gameID: 71859 },
				],
			},
			damageDone: {
				entries: [
					{
						name: 'Player (11)',
						id: ME,
						type: 'Shaman',
						itemLevel: 553,
						total: 60_000,
						activeTime: DURATION,
						abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 60_000 }],
					},
				],
			},
		},
	};
};

/**
 * A deliberate multi-dot: the boss carries the dot from the pull, and at 40s the player puts a second one
 * on an add without ever stopping hitting the boss.
 *
 * Graded against the *hit* enemy that add press reads as a refresh of the boss's dot with ~20s left —
 * a wasted global. Graded against the enemy it was aimed at, it is a fresh application on an enemy that
 * had nothing.
 */
describe('a Flame Shock aimed at an add while the player hits the boss', () => {
	const el = analyse(
		dataset([
			at(500, 'cast', LAVA_BURST, { targetID: BOSS }),
			at(1000, 'cast', FLAME_SHOCK, { targetID: BOSS }),
			at(1000, 'applydebuff', FLAME_SHOCK, { targetID: BOSS }),
			// Refreshed at 25s, so the boss's dot is genuinely live when the add press lands at 40s. This
			// refresh is load-bearing: `remainingAtCast` reads the *declared* 30s duration forward from the
			// last event, so without it the boss's dot expires at 31s, both readings agree the add press
			// applied a dot, and the test demonstrates nothing. (It did, until this line was added.)
			at(25_000, 'cast', FLAME_SHOCK, { targetID: BOSS }),
			at(25_000, 'refreshdebuff', FLAME_SHOCK, { targetID: BOSS }),
			at(55_000, 'removedebuff', FLAME_SHOCK, { targetID: BOSS }),
			// The multi-dot. Aimed at the add; every hit around it is on the boss.
			at(40_000, 'cast', FLAME_SHOCK, { targetID: ADD }),
			at(40_000, 'applydebuff', FLAME_SHOCK, { targetID: ADD }),
			at(70_000, 'removedebuff', FLAME_SHOCK, { targetID: ADD }),
		]),
	) as Analysis & ElementalAuditResult;

	it('is read as Elemental', () => {
		expect(el.isSpec).toBe(true);
	});

	/**
	 * The point of the file, and it flips: graded against the hit spawn this press read
	 * `remainingMs: 15_000` — the boss's dot, 15s from expiry — and was counted a refresh.
	 */
	it('reads the add press as a fresh application, not an early refresh', () => {
		const press = el.flameShock.presses.find((p) => p.t === 40_000);
		expect(press?.remainingMs).toBeNull();
		expect(press?.windowed).toBe(false);
		// Two applies (the boss at the pull, the add at 40s) and one refresh (the boss at 25s). Against the
		// hit spawn it was one apply and two refreshes — the add's dot counted as the boss's being renewed.
		expect(el.flameShock.applies).toBe(2);
		expect(el.flameShock.refreshes).toBe(1);
	});

	/** The uptime figure stays on the primary's own union — the add's dot is not the boss's coverage. */
	it('leaves the primary uptime measured on the primary', () => {
		expect(el.flameShock.windows).toEqual([{ start: 1000, end: 55_000 }]);
	});
});

/**
 * A second Elemental shaman keeps their own Flame Shock on the same boss.
 *
 * The walk used to read every source, so the other shaman's apply at 5s and remove at 95s folded into
 * this player's windows and credited them with 90s of coverage they did not provide.
 */
describe('another shaman’s dot on the same boss', () => {
	const foreign = (t: number, type: string): WclEvent => ({
		timestamp: T0 + t,
		type,
		abilityGameID: FLAME_SHOCK,
		sourceID: OTHER_SHAMAN,
		targetID: BOSS,
	});

	const el = analyse(
		dataset([
			at(500, 'cast', LAVA_BURST, { targetID: BOSS }),
			// This player's dot: one short window early on.
			at(1000, 'cast', FLAME_SHOCK, { targetID: BOSS }),
			at(1000, 'applydebuff', FLAME_SHOCK, { targetID: BOSS }),
			at(21_000, 'removedebuff', FLAME_SHOCK, { targetID: BOSS }),
			// The other shaman's dot, and deliberately *after* this player's has ended rather than
			// overlapping it. An overlapping foreign dot interleaves into one window and the walk comes out
			// the same either way — it has to be a stretch that exists only because of them.
			foreign(30_000, 'applydebuff'),
			foreign(95_000, 'removedebuff'),
		]),
	) as Analysis & ElementalAuditResult;

	/**
	 * Against every source this returned two windows — `[1000, 21_000]` plus the other shaman's
	 * `[30_000, 95_000]` — for 85s of "coverage" where this player provided 20s.
	 */
	it('counts only this player’s own coverage', () => {
		expect(el.flameShock.windows).toEqual([{ start: 1000, end: 21_000 }]);
		expect(el.flameShock.uptimeMs).toBe(20_000);
		expect(el.flameShock.applies).toBe(1);
	});
});

/**
 * The same multi-dot, with a **cast time on the Flame Shock press** — which is the one thing that can
 * break the coupling the block above is built on, and the one thing no committed pull contains.
 *
 * `fsAimedAt` is a map from a press instant to the spawn that press was aimed at, and `fsCasts` is the
 * list of instants looked up in it. Both come off `fsPressAt` — one accessor, declared beside them, so
 * that a clock change moves the key and every reader of it together. Written out independently, as they
 * were, moving one alone was a one-character edit whose failure is *silent*: `fsAimedAt.get(t)` misses,
 * the `?? spawnAt(t)` fallback answers with the enemy the player was hitting, and the deliberate
 * multi-dot is charged as a wasted refresh — exactly the misgrade the whole aimed-at reading exists to
 * prevent. `analyseCore`'s `Handles` names this as one of the two traps its ruling does not settle.
 *
 * So the fixture gives the add press a two-second cast, making `begin` (40s) and `t` (42s) different
 * instants for the first time. Two things then have to hold at once, and they fail for different
 * reasons:
 *
 *   - the press is stamped at **42 000**, which pins the clock this block is read on;
 *   - the press still resolves to the **add**, which pins the key and the reader to the *same* clock.
 *     Break either side alone and this one flips to the boss with nothing raised.
 *
 * Two seconds because `measureCastDurations` reads anything under 100 ms as an instant, which would
 * collapse `begin` into `t` and leave the test unable to fail.
 */
describe('an aimed Flame Shock with a cast time', () => {
	const el = analyse(
		dataset([
			at(500, 'cast', LAVA_BURST, { targetID: BOSS }),
			at(1000, 'cast', FLAME_SHOCK, { targetID: BOSS }),
			at(1000, 'applydebuff', FLAME_SHOCK, { targetID: BOSS }),
			// The boss's dot kept live across the add press, for the reason the sibling suite above gives:
			// without it both readings agree that the add press applied a fresh dot and nothing is shown.
			at(25_000, 'cast', FLAME_SHOCK, { targetID: BOSS }),
			at(25_000, 'refreshdebuff', FLAME_SHOCK, { targetID: BOSS }),
			at(55_000, 'removedebuff', FLAME_SHOCK, { targetID: BOSS }),
			// The multi-dot, committed at 40s and landing at 42s. Aimed at the add; every hit either side
			// of it is on the boss.
			at(40_000, 'begincast', FLAME_SHOCK, { targetID: ADD }),
			at(42_000, 'cast', FLAME_SHOCK, { targetID: ADD }),
			at(42_000, 'applydebuff', FLAME_SHOCK, { targetID: ADD }),
			at(70_000, 'removedebuff', FLAME_SHOCK, { targetID: ADD }),
		]),
	) as Analysis & ElementalAuditResult;

	it('is read as Elemental', () => {
		expect(el.isSpec).toBe(true);
	});

	/**
	 * The clock. Every reader in the Flame Shock block joins against an event stream — the dot's aura
	 * timeline, its ticks, its `refreshdebuff` stamps — and all of those exist on the `cast`, so the press
	 * list is the landing. Read at the commit this row would be stamped 40 000.
	 */
	it('stamps the press at the landing, where the dot events are', () => {
		expect(el.flameShock.presses.map((p) => p.t)).toEqual([1000, 25_000, 42_000]);
	});

	/**
	 * The coupling, and it is the assertion that goes quiet rather than loud when it breaks. A missed
	 * lookup is indistinguishable from a press whose target the log omitted: both take the fallback, and
	 * the fallback's answer here is the boss, whose dot has 13s left at 42s. So the failure mode is
	 * `remainingMs: 13_000` and a third refresh — a correct cleave press reported as a wasted global.
	 */
	it('still resolves the press to the enemy it was aimed at', () => {
		const press = el.flameShock.presses.find((p) => p.t === 42_000);
		expect(press?.remainingMs).toBeNull();
		expect(press?.windowed).toBe(false);
		expect(el.flameShock.applies).toBe(2);
		expect(el.flameShock.refreshes).toBe(1);
	});
});

// ---------------------------------------------------------------------------------------------------
// The third map in this family, and the last: `fsTimelines`, which is the only thing `remainingAtCast`
// walks.
//
// `4b63f99` fixed two closures that keyed a spawn into a map built only from the *primary's* events —
// `fsRemainingAt` and `downBefore` — and named this one in its own message as the instance it was
// leaving standing. It is the same defect with a third fallback value: `fsTimelines` was bucketed under
// `if (e.targetID !== primaryID) continue`, so for a press aimed at an add the lookup missed,
// `remainingAtCast([], …)` returned **0**, and `remaining > 0` was false. A press at an add could not be
// a refresh — not because the log said the dot was down, but because the map had nothing in it to say
// otherwise. `remainingMs: null` then means "no dot was up", which is exactly what a reader cannot tell
// it apart from.
//
// The fix is the filter's removal, which makes this block shape-identical to `fsDotAnywhere` /
// `dotWindowsBySpawn` sixty lines above it — both of which already bucket every spawn and already argue
// for it at length. **Plus one addition that changes no committed figure**: `auraTimeline` filters by
// aura id alone, so widening the target scope widens exposure to a second shaman's dot on the same
// enemy, and `e.sourceID !== actor.id` is the same guard `dotWindowsBySpawn` spells out. The last suite
// in this file is the only thing that holds it.

const PRIMARY_OPENS_AT = 442_020;

const pull = (name: string): Analysis & ElementalAuditResult =>
	analyse(rawFixture('elemental', `${name}.json`)) as Analysis & ElementalAuditResult;

const addsThenBoss = pull('addsThenBoss');
const cleavePull = pull('cleave');
const phasedPull = pull('phased');
const unbrokenPull = pull('unbroken');

/** Every press this reading can move, in the shape the movement is legible in. */
const refreshRows = (el: ElementalAuditResult): unknown[] =>
	el.flameShock.presses.filter((p) => p.remainingMs !== null).map((p) => [p.t, p.kind, p.remainingMs]);

const kindsOf = (el: ElementalAuditResult): Record<string, number> => {
	const out: Record<string, number> = {};
	for (const p of el.flameShock.presses) out[p.kind] = (out[p.kind] ?? 0) + 1;
	return out;
};

const graded = (el: Analysis & ElementalAuditResult, key: string): Metric | undefined =>
	Object.values(scoreAnalysis(el, resolveBands(el.targets, 'auto')).sections)
		.flatMap((s) => s.metrics)
		.find((m) => m.key === key);

/**
 * How many of a pull's Flame Shock presses were aimed somewhere other than the primary — read off the
 * raw cast events, which is the one place the aim is recorded.
 *
 * This is what decides whether a pull is evidence or a tautology here, so it is measured rather than
 * inferred from the target counts: a pull with no add-aimed press cannot move whatever the old filter
 * did, and saying so is the difference between a control and a coincidence.
 */
const aimedElsewhere = (name: string): number[] => {
	const ds = rawFixture('elemental', `${name}.json`);
	const primary = (analyse(ds) as Analysis).primaryTarget?.id ?? null;
	return ds.events
		.filter((e) => e.type === 'cast' && e.sourceID === ds.actor.id && abilityIdOf(e) === 8050)
		.filter((e) => e.targetID !== primary)
		.map((e) => e.timestamp - ds.fight.startTime);
};

/** Flame Shock aura events from anybody but the audited player — zero on all four, which is the point. */
const foreignDotEvents = (name: string): number => {
	const ds = rawFixture('elemental', `${name}.json`);
	return ds.events.filter(
		(e) => abilityIdOf(e) === 8050 && e.sourceID !== ds.actor.id && (e.type ?? '').endsWith('debuff'),
	).length;
};

describe('the dot’s own timeline, off the spawn the press was aimed at', () => {
	/**
	 * The premise, and every figure below rests on it: on `addsThenBoss` the primary is on a tower and
	 * carries the dot for the first time at 442.0s of 560.3s. So for the first 442 seconds the
	 * primary-scoped timeline map was **provably empty**, and every one of the 23 add-aimed presses in
	 * that stretch was answered from it.
	 */
	it('is a pull whose primary cannot answer for the first 442 seconds', () => {
		expect(addsThenBoss.flameShock.windows[0]?.start).toBe(PRIMARY_OPENS_AT);
		expect(addsThenBoss.flameShock.presses).toHaveLength(31);
		// 23 aimed at an add, 8 at the primary — and not one of the 8 lands before the primary opens.
		expect(aimedElsewhere('addsThenBoss')).toHaveLength(23);
		expect(Math.min(...aimedElsewhere('addsThenBoss'))).toBeLessThan(PRIMARY_OPENS_AT);
	});

	/**
	 * **The structural reading, and it is the assertion this change exists for.** Under the old filter
	 * every refresh this pull recorded fell at or after 442 020ms — all seven of them, in the 118s
	 * boss-only tail where the primary-scoped map finally had something in it. Not one of the 23
	 * add-aimed presses could be a refresh, and that was arithmetic rather than measurement.
	 *
	 * It is now six in the add phase and the same seven in the tail. Six of the "24 add-phase Flame
	 * Shocks read as applications" were genuine refreshes of a dot the log records as running.
	 */
	it('finds refreshes in the stretch the primary-scoped map had nothing in it', () => {
		const rows = addsThenBoss.flameShock.presses.filter((p) => p.remainingMs !== null);
		const addPhase = rows.filter((p) => p.t < PRIMARY_OPENS_AT);
		const tail = rows.filter((p) => p.t >= PRIMARY_OPENS_AT);
		// Zero before this change, by construction. This is the line that goes red against the old filter.
		expect(addPhase).toHaveLength(6);
		expect(tail).toHaveLength(7);
		// The six, exactly — four early refreshes, one inside the last tick, one snapshot gain.
		expect(addPhase.map((p) => [p.t, p.kind, p.remainingMs])).toEqual([
			[36_139, 'windowed', 865],
			[159_410, 'early', 17_835],
			[189_394, 'early', 24_640],
			[200_291, 'snapshot', 8753],
			[247_114, 'early', 17_184],
			[282_921, 'early', 14_480],
		]);
		// **The tail is the in-pull control and it is byte-identical.** 118 seconds of single-target play by
		// the same player in the same log, where the two maps were already the same map.
		expect(tail.map((p) => [p.t, p.kind, p.remainingMs])).toEqual([
			[468_214, 'early', 3806],
			[480_931, 'early', 17_286],
			[486_145, 'early', 24_787],
			[498_056, 'early', 18_090],
			[511_072, 'early', 17_009],
			[532_772, 'snapshot', 8320],
			[540_568, 'early', 22_207],
		]);
	});

	/**
	 * Which presses moved, said as a property rather than as six timestamps: **every one of them came out
	 * of the `reapply` set the previous fix created, and that set is now empty on this pull.**
	 *
	 * `reapply` is "the dot went up, and it had lapsed for less than a global" — the reading a press gets
	 * when `remainingMs` is null and `downBefore` says the spawn had carried the dot. Six presses read
	 * that way because the timeline map could not see the dot the window map could. Nothing else moved:
	 * the 17 `apply` rows and the one `late` are the same rows either side.
	 */
	it('empties the reapply set the window-map fix created, and moves nothing else', () => {
		expect(kindsOf(addsThenBoss)).toEqual({ apply: 17, late: 1, windowed: 1, early: 10, snapshot: 2 });
		// Was `{ apply: 17, reapply: 6, late: 1, early: 6, snapshot: 1 }` — the six `reapply` and only them.
		expect(addsThenBoss.flameShock.presses.filter((p) => p.kind === 'reapply')).toHaveLength(0);
		expect(addsThenBoss.flameShock.applies).toBe(18);
		expect(addsThenBoss.flameShock.refreshes).toBe(13);
		expect(addsThenBoss.flameShock.windowed).toBe(1);
		expect(addsThenBoss.flameShock.snapshotGain).toBe(2);
		expect(addsThenBoss.flameShock.unjudgedRefreshes).toBe(4);
		expect(addsThenBoss.flameShock.unjudgedWaste).toBe(3);
	});

	/**
	 * The two graded figures, **and the direction each of them actually moves**, which is not the same
	 * sentence for both and is the reason this is landable.
	 *
	 * `gcdUtilisation` was not predicted to move at all, and it does, because `wastedGcds` filters on
	 * `p.remainingMs !== null` — the exact predicate this change flips. Four more globals are charged, so
	 * it reads **83.722% → 82.898%**: strictly worse.
	 *
	 * `flameShockWaste` is the one that needs stating carefully. Its *count* of wasted refreshes goes
	 * **4 → 7** and its denominator **5 → 9**, so as a share it reads 80.000% → 77.778% — 2.2 points
	 * *lower* on a metric where lower is better, while the fault behind it nearly doubles. It is a wash
	 * inside a band whose `ok` edge is 30%, not a pull being flattered: nothing moved from a worse grade
	 * to a better one anywhere, which is the property asserted below.
	 */
	it('charges four more globals and seven wasted refreshes instead of four', () => {
		expect(addsThenBoss.cpm.wastedGcds).toBe(10);
		expect(graded(addsThenBoss, 'gcdUtilisation')?.value).toBeCloseTo(82.897_795, 5);
		expect(graded(addsThenBoss, 'gcdUtilisation')?.grade).toBe('good');
		const waste = graded(addsThenBoss, 'flameShockWaste');
		expect(waste?.value).toBeCloseTo(77.777_778, 5);
		expect(waste?.sampleSize).toBe(9);
		expect(waste?.grade).toBe('bad');
		// The count the share is of, reconstructed the way `score.ts` says the audit tests should — so the
		// "more fault" claim is made on the numerator and not on the ratio that hides it.
		const fs = addsThenBoss.flameShock;
		expect(fs.refreshes - fs.windowed - fs.ascPrep - fs.snapshotGain - fs.unjudgedWaste).toBe(7);
	});

	/**
	 * **`cleave` is the control that carries weight**, and the reason is one press.
	 *
	 * `phased` and `unbroken` are `counts.max === 1` — they never exceed one enemy, so every press is at
	 * the primary and the two maps are the same map: a no-op there is structural and proves nothing about
	 * this change. `cleave` reaches **13** enemies and aims one Flame Shock at an add, at 40 269ms. That
	 * press is the shape this change is about, and it does not move: the add genuinely had nothing on it,
	 * so the widened map *confirms* the reading the narrow one guessed. That is the difference between a
	 * fabricated zero and a measured one, on a real log, and it is the whole safety argument.
	 */
	it('moves nothing on the other three pulls, and cleave is the one that says so', () => {
		expect(cleavePull.targets?.counts.max).toBe(13);
		expect(aimedElsewhere('cleave')).toEqual([40_269]);
		expect(cleavePull.flameShock.presses.find((p) => p.t === 40_269)).toMatchObject({
			kind: 'apply',
			remainingMs: null,
		});
		expect(refreshRows(cleavePull)).toEqual([
			[29_777, 'windowed', 1784],
			[57_499, 'early', 2279],
		]);
		expect(kindsOf(cleavePull)).toEqual({ apply: 2, windowed: 1, early: 1, late: 4, reapply: 2 });
		expect(cleavePull.cpm.wastedGcds).toBe(2);

		// The two single-target pulls, with the `counts.max` that makes their no-op structural on the same
		// line as their figures — the pattern this file's neighbours already use.
		expect([phasedPull.targets?.counts.max, aimedElsewhere('phased'), phasedPull.cpm.wastedGcds]).toEqual([1, [], 1]);
		expect([unbrokenPull.targets?.counts.max, aimedElsewhere('unbroken'), unbrokenPull.cpm.wastedGcds]).toEqual([
			1,
			[],
			2,
		]);
		expect(kindsOf(phasedPull)).toEqual({ apply: 1, windowed: 3, early: 1, reapply: 3 });
		expect(kindsOf(unbrokenPull)).toEqual({ apply: 1, snapshot: 3, early: 2, windowed: 1 });
	});

	/**
	 * All three grade levels on all four pulls, because the claim being made is that none of them moves.
	 *
	 * A metric grade, a section grade and the overall verdict are three separate readings and a change
	 * that moved only the last would still be a change to what a reader is told. The two graded metrics
	 * above both stay in the band they were in, so nothing above them moves either — asserted rather
	 * than assumed.
	 */
	it('leaves every metric, section and overall grade where it was on all four pulls', () => {
		const card = (el: Analysis & ElementalAuditResult) => {
			const scored = scoreAnalysis(el, resolveBands(el.targets, 'auto'));
			return {
				overall: scored.overall,
				judged: scored.judged,
				sections: Object.fromEntries(Object.entries(scored.sections).map(([k, s]) => [k, s.grade])),
				flameShockWaste: graded(el, 'flameShockWaste')?.grade,
				gcdUtilisation: graded(el, 'gcdUtilisation')?.grade,
			};
		};
		const sections = {
			flameShock: 'bad',
			earthShock: 'bad',
			searingTotem: 'ok',
			fireElemental: 'ok',
			flameShockSnapshots: 'ok',
			lightningShield: 'bad',
			mana: 'ok',
			casts: 'good',
		};
		expect(card(addsThenBoss)).toEqual({
			overall: 'bad',
			judged: { measured: 14, total: 23, unmeasurable: false },
			sections,
			flameShockWaste: 'bad',
			gcdUtilisation: 'good',
		});
		expect(card(cleavePull)).toEqual({
			overall: 'ok',
			judged: { measured: 14, total: 23, unmeasurable: false },
			sections: { ...sections, searingTotem: 'good', fireElemental: 'good' },
			flameShockWaste: 'ok',
			gcdUtilisation: 'good',
		});
		expect(card(phasedPull)).toEqual({
			overall: 'good',
			judged: { measured: 14, total: 23, unmeasurable: false },
			sections: { ...sections, flameShock: 'ok', fireElemental: 'good' },
			flameShockWaste: 'ok',
			gcdUtilisation: 'good',
		});
		expect(card(unbrokenPull)).toEqual({
			overall: 'ok',
			judged: { measured: 14, total: 23, unmeasurable: false },
			sections: { ...sections, searingTotem: 'bad', fireElemental: 'good' },
			flameShockWaste: 'bad',
			gcdUtilisation: 'good',
		});
	});

	/**
	 * The third graded consumer of the same predicate, looked for rather than assumed absent.
	 *
	 * `remainingMs !== null` has five readers: `fsUnjudgedRefreshes` and `wastedGcds` (both moved above),
	 * `fsRefreshWindows` (the reported median tick window, 1762.7ms → 1755.3ms, graded by nothing), the
	 * snapshot miss ledger, and `snapRefreshed`/`snapMissed` — which **is** graded, as
	 * `flameShockSnapshots`' catch rate. It does not move, and the reason is the pull rather than the
	 * mechanism: `addsThenBoss` has exactly one proc window and it was already caught, and the other
	 * three pulls have none at all. So this is the metric to watch on the next fixture, not a metric this
	 * change is provably clear of.
	 */
	it('does not move the snapshot catch rate on these four, and says why', () => {
		expect([addsThenBoss.snapshots.refreshed, addsThenBoss.snapshots.missed]).toEqual([1, 0]);
		for (const el of [cleavePull, phasedPull, unbrokenPull]) {
			expect([el.snapshots.refreshed, el.snapshots.missed]).toEqual([0, 0]);
		}
		expect(addsThenBoss.flameShock.tickMs).toBeCloseTo(1755.333, 3);
	});
});

/**
 * The same defect on a synthetic pull, for the one thing the fixture cannot show: what the press *reads*
 * rather than only what it is labelled.
 *
 * The add carries this player's own dot from 40s to 90s and is pressed again at 60s with 10s left. Under
 * the primary-scoped filter `fsTimelines` held only the boss — which is never dotted here, so its
 * timeline is empty — the lookup for the add missed, and the press read `remainingMs: null`,
 * `kind: 'reapply'`, `exposedMs: 0`, no wasted global. An early refresh of a live dot reported as a
 * reapplication of a dot that had just lapsed.
 *
 * Ascendance at 500ms for the reason `flameShockPerSpawn.test.ts` gives: a button never pressed reads as
 * ready now, and `ascPrep` would then excuse any refresh under 16s remaining.
 */
describe('a Flame Shock aimed at an add whose own dot is still running', () => {
	const el = analyse(
		dataset([
			at(500, 'cast', ASCENDANCE),
			at(600, 'cast', LAVA_BURST, { targetID: BOSS }),
			at(40_000, 'cast', FLAME_SHOCK, { targetID: ADD }),
			at(40_000, 'applydebuff', FLAME_SHOCK, { targetID: ADD }),
			at(60_000, 'cast', FLAME_SHOCK, { targetID: ADD }),
			at(60_000, 'refreshdebuff', FLAME_SHOCK, { targetID: ADD }),
			at(90_000, 'removedebuff', FLAME_SHOCK, { targetID: ADD }),
		]),
	) as Analysis & ElementalAuditResult;

	it('is the pull it claims to be: the primary is never dotted at all', () => {
		expect(el.isSpec).toBe(true);
		expect(el.primaryTarget?.id).toBe(BOSS);
		expect(el.flameShock.windows).toEqual([]);
	});

	it('reads the refresh off the add’s own timeline instead of an empty map', () => {
		expect(el.flameShock.presses.map((p) => [p.t, p.kind, p.remainingMs, p.exposedMs])).toEqual([
			[40_000, 'apply', null, 0],
			[60_000, 'early', 10_000, null],
		]);
		expect([el.flameShock.applies, el.flameShock.refreshes]).toEqual([1, 1]);
		// The graded consequence, and the one the fixture measures at scale: a global charged that was not.
		expect(el.cpm.wastedGcds).toBe(1);
	});
});

/**
 * **The guard on the addition, and the only thing in the repository that holds it.**
 *
 * Widening the target scope widens what `auraTimeline` can see, and `auraTimeline` filters by aura id
 * alone — it has no source filter of its own. So a second Elemental shaman keeping Flame Shock on the
 * same add folds their apply and their remove into this player's timeline, and `remainingAtCast` takes
 * *the last point before the press and nothing else*: their `removedebuff` at 59s zeroes a dot of this
 * player's that runs to 70s, and the press at 60s reads as a reapplication of nothing.
 *
 * That is the two-shaman bug `dotWindowsBySpawn` documents at length, arriving at a second site the
 * moment the target filter comes off. Scoped to the primary it was mostly hidden, because a foreign dot
 * on the primary is the case that walk had already been fixed for. It changes no figure on any committed
 * pull — asserted below, all four carry zero foreign Flame Shock aura events — so nothing but this suite
 * can fail if `e.sourceID !== actor.id` is dropped.
 *
 * The foreign windows are deliberately arranged to *straddle* this player's press rather than to overlap
 * it harmlessly: an apply before this player's and a remove 1s before the press, which is the only
 * arrangement `remainingAtCast` can be fooled by.
 */
describe('another shaman’s dot on the add this player is dotting', () => {
	const foreignOnAdd = (t: number, type: string): WclEvent => ({
		timestamp: T0 + t,
		type,
		abilityGameID: FLAME_SHOCK,
		sourceID: OTHER_SHAMAN,
		targetID: ADD,
	});

	const el = analyse(
		dataset([
			at(500, 'cast', ASCENDANCE),
			at(600, 'cast', LAVA_BURST, { targetID: BOSS }),
			// This player's dot on the add: up at 40s, refreshed at 60s, gone at 90s.
			at(40_000, 'cast', FLAME_SHOCK, { targetID: ADD }),
			at(40_000, 'applydebuff', FLAME_SHOCK, { targetID: ADD }),
			at(60_000, 'cast', FLAME_SHOCK, { targetID: ADD }),
			at(60_000, 'refreshdebuff', FLAME_SHOCK, { targetID: ADD }),
			at(90_000, 'removedebuff', FLAME_SHOCK, { targetID: ADD }),
			// The other shaman's, straddling the press at 60s.
			foreignOnAdd(35_000, 'applydebuff'),
			foreignOnAdd(59_000, 'removedebuff'),
		]),
	) as Analysis & ElementalAuditResult;

	it('is the premise: no committed pull carries a foreign Flame Shock aura event', () => {
		for (const name of ['addsThenBoss', 'cleave', 'phased', 'unbroken']) {
			expect(foreignDotEvents(name), name).toBe(0);
		}
	});

	/**
	 * Identical to the suite above, which is the assertion: the other shaman's dot changes nothing about
	 * this player's press. Without the source filter the press at 60s reads `null` / `reapply` — the
	 * foreign remove at 59s is the last point before it — and the wasted global goes back to zero.
	 */
	it('reads the press against this player’s own dot and not the other shaman’s', () => {
		expect(el.flameShock.presses.map((p) => [p.t, p.kind, p.remainingMs, p.exposedMs])).toEqual([
			[40_000, 'apply', null, 0],
			[60_000, 'early', 10_000, null],
		]);
		expect([el.flameShock.applies, el.flameShock.refreshes]).toEqual([1, 1]);
		expect(el.cpm.wastedGcds).toBe(1);
	});
});

/**
 * **The fourth site of the same exposure, and the only thing that holds it.**
 *
 * `beganAsRefresh` was already source-filtered when this suite was written — `fsRefreshedAt` carries
 * `e.sourceID !== actor.id` — so this is a guard on a correct line rather than a fix. It exists because
 * the line was **provably unheld**: deleting that clause leaves all 2 309 tests green, which is exactly
 * how the first three members of this family were introduced in the first place.
 *
 * The mechanism is not the one the suite above holds, and that is why it needs its own pull.
 * `remainingAtCast` is fooled by a foreign *window*; this is fooled by a foreign **stamp**.
 * `beganAsRefresh(spawn, bounds.previous)` asks whether a `refreshdebuff` sits within `SELF_EVENT_MS`
 * of the press that *opened* the application being graded, and the answer is worth a whole scheduled
 * tick (`dot.remainingTicks++`, `dotTickBudgetIn`'s `refreshed ? 1 : 0`). So a second shaman refreshing
 * their own dot on the same add within 250ms of this player's apply inflates `scheduled` from 10 to 11,
 * `ticksLeft` from 1 to 2, and `inLastTick` flips false.
 *
 * **The direction matters: it invents fault rather than flattering the pull.** The press at 38s is a
 * textbook last-tick refresh — the one press that throws nothing away — and the foreign stamp turns it
 * into an `early` one and charges a wasted global. Ascendance is spent at 0.4s deliberately, so
 * `ascPrep` cannot absorb the verdict and the charge reaches `cpm.wastedGcds`; without that line the
 * press merely lands on the other excuse and the graded consequence is masked.
 *
 * **The vector reaches this site and no other, which is what makes the test surgical.** Every other
 * reader of a Flame Shock aura event in `index.ts` is independently sourced to the player —
 * `fsTimelines` by its own pre-filtered bucket, `fsTicks` and `fsTickSnapshots` and `fsDotAnywhere` and
 * `fsDot` by the `sourceID` argument they are handed. A foreign `refreshdebuff` is therefore invisible
 * to all of them, so a difference between the two pulls below can only have come through
 * `fsRefreshedAt`.
 *
 * Nine ticks at a flat 3 000ms cadence rather than a measured one: `applicationCadence` keeps a gap of
 * exactly `dot.tickMs` and drops anything longer, so the period is 3 000ms, `roundToEven(30 000/3 000)`
 * is 10, and nine delivered leaves exactly one owed. One tick of margin is the whole width of the rule
 * being tested, so the arithmetic is stated rather than measured off a fixture.
 */
describe('another shaman’s Flame Shock refresh beside this player’s apply', () => {
	const dotTick = (t: number): WclEvent =>
		at(t, 'damage', FLAME_SHOCK, { targetID: ADD, amount: 5000, unmitigatedAmount: 5000, tick: true, hitType: 1 });

	/** Nine of the ten ticks the application was scheduled, so exactly one is still owed at 38s. */
	const ticks = Array.from({ length: 9 }, (_, i) => dotTick(13_000 + i * 3000));

	const pull = (extra: WclEvent[]) =>
		analyse(
			dataset([
				// Spent, so `ascReadyInSec` is past the fight and `ascPrep` cannot excuse the press at 38s.
				at(400, 'cast', ASCENDANCE),
				at(500, 'cast', LAVA_BURST, { targetID: BOSS }),
				// This player's application on the add: applied at 10s, refreshed in its last tick at 38s.
				at(10_000, 'cast', FLAME_SHOCK, { targetID: ADD }),
				at(10_000, 'applydebuff', FLAME_SHOCK, { targetID: ADD }),
				...ticks,
				at(38_000, 'cast', FLAME_SHOCK, { targetID: ADD }),
				at(38_000, 'refreshdebuff', FLAME_SHOCK, { targetID: ADD }),
				at(68_000, 'removedebuff', FLAME_SHOCK, { targetID: ADD }),
				...extra,
			]),
		) as Analysis & ElementalAuditResult;

	/**
	 * The other shaman's refresh of *their* dot on the same add, stamped on this player's apply. Inside
	 * `SELF_EVENT_MS` of 10s, which is the only arrangement `beganAsRefresh` can be fooled by.
	 */
	const foreignRefresh: WclEvent = {
		timestamp: T0 + 10_000,
		type: 'refreshdebuff',
		abilityGameID: FLAME_SHOCK,
		sourceID: OTHER_SHAMAN,
		targetID: ADD,
	};

	const alone = pull([]);
	const withOther = pull([foreignRefresh]);

	/** The premise this pull stands in for, restated at this site: no committed pull can show it. */
	it('is a case no committed pull carries', () => {
		for (const name of ['addsThenBoss', 'cleave', 'phased', 'unbroken']) {
			expect(foreignDotEvents(name), name).toBe(0);
		}
	});

	/**
	 * The reading the pull is built to produce, asserted on its own so that a change breaking the
	 * *arrangement* fails here rather than silently making the comparison below vacuous — two pulls that
	 * agree because neither has anything to say would pass it.
	 */
	it('is a last-tick refresh with exactly one tick owed', () => {
		expect(alone.flameShock.presses.map((p) => [p.t, p.kind, p.windowed, p.ticksLeft])).toEqual([
			[10_000, 'apply', false, null],
			[38_000, 'windowed', true, 1],
		]);
		expect(alone.cpm.wastedGcds).toBe(0);
	});

	/**
	 * The guard. Drop `e.sourceID !== actor.id` from `fsRefreshedAt` and this is the only failure in the
	 * suite: the press at 38s reads `early` / `ticksLeft: 2` and a global is charged.
	 */
	it('grades the press against this player’s own apply and not the other shaman’s refresh', () => {
		expect(withOther.flameShock.presses.map((p) => [p.t, p.kind, p.windowed, p.ticksLeft])).toEqual(
			alone.flameShock.presses.map((p) => [p.t, p.kind, p.windowed, p.ticksLeft]),
		);
		expect(withOther.cpm.wastedGcds).toBe(0);
	});
});
