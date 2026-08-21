// The aura lanes that should draw the window they can prove, and the graded readers that must not.
//
// Plan §6. `auraWindows`' `openAtPull` is opt-in per call site, so a lane that never asks for it starts
// its bar at the first *in-fight* event: an aura already running at the bell reads as applied late, or —
// where its only in-fight trace is the bare removal it left behind — as never applied at all.
//
// Every case here is synthetic, and it has to be. None of the three committed Elemental fixtures carries
// a leading orphan removal for any of these auras, so the change is inert against all three: measured,
// their lane window counts and first windows are identical before and after. A fixture cannot hold a rule
// it does not exercise. The one lane on those pulls that *is* inferred — the pre-pull Fire Elemental, on
// all three — is asserted where it belongs, in `firePrepull.test.ts`.
//
// **The marking is asserted with the window, not beside it.** `preexisting` is what tells the chart the
// bar's left edge is the pull rather than an event, and it survives to `AuraLane.windows` only because
// the lane builder copies it — it used to rebuild each window as `{ start, end }`, which drew an inferred
// bar identically to one the log proved both ends of. So every expectation below is an exact `toEqual`
// including the flag: an assertion that only checked the span would pass on the version of this file
// that threw the flag away.
//
// The pairs are the point. Each aura is tested twice — once where the log proves nothing about the
// opening, and once where it proves the press happened inside the fight — because an inference that
// cannot be *stopped* is not an inference, it is a decoration.
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import type { Analysis, AuraLane, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '../index';

const T0 = 3_000_000;
const DURATION = 200_000;
const ME = 11;
const BOSS = 21;

const LIGHTNING_BOLT = 403;
const LAVA_BURST = 51_505;
/** Ascendance: **114049 is the press and 114050 is the buff**, and the split is what needs the guard. */
const ASCENDANCE_CAST = 114_049;
const ASCENDANCE_BUFF = 114_050;
/** Elemental Mastery books both under one id, which is what makes it the case needing no guard. */
const ELEMENTAL_MASTERY = 16_166;
/** Lava Surge declares no duration, so it is the case the bound cannot be checked for. */
const LAVA_SURGE = 77_762;
/** Flame Shock: **one id for the press and the debuff**, which is what makes its own cast the guard. */
const FLAME_SHOCK = 8050;
/** Elemental Discharge, the T16 two-piece debuff. Declares no duration, and nothing casts it. */
const T16_2PC_DEBUFF = 144_999;
const EARTH_SHOCK = 8042;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

/** The same event aimed at the boss, which is where a dot lives — and where the walk buckets it. */
const onBoss = (t: number, type: string, id: number): WclEvent => e(t, type, id, { targetID: BOSS, targetInstance: 1 });

const fight = {
	id: 6,
	name: 'Iron Qon',
	encounterID: 1662,
	kill: true,
	difficulty: 4,
	size: 25,
	startTime: T0,
	endTime: T0 + DURATION,
};

/** A hit every five seconds, well inside the 15s gap, so the pull is one unbroken contact stretch. */
const contact: WclEvent[] = Array.from({ length: DURATION / 5000 + 1 }, (_, i) =>
	e(i * 5000, 'damage', LIGHTNING_BOLT, { targetID: BOSS, targetInstance: 1, amount: 1000, hitType: 1 }),
);

const run = (extra: readonly WclEvent[]): Analysis & ElementalAuditResult =>
	analyse({
		code: 'ele-prepull-lanes',
		fight,
		actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
		actors: [
			{ id: ME, name: 'Sparkstorm', type: 'Player' },
			{ id: BOSS, name: 'Iron Qon', type: 'NPC', subType: 'Boss' },
		],
		// A Lava Burst so `identify` accepts the pull as Elemental at all.
		events: [...contact, e(1000, 'cast', LAVA_BURST, { targetID: BOSS, targetInstance: 1 }), ...extra],
		table: {
			fight: { ...fight, enemyNPCs: [{ id: BOSS, gameID: 68_078 }] },
			damageDone: {
				entries: [
					{
						name: 'Sparkstorm',
						id: ME,
						type: 'Shaman',
						itemLevel: 553,
						total: 41_000,
						activeTime: DURATION,
						abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 41_000 }],
					},
				],
			},
		},
	} as FightDataset) as Analysis & ElementalAuditResult;

const laneFor = (el: Analysis & ElementalAuditResult, key: string): AuraLane | undefined =>
	el.timeline?.lanes?.find((l) => l.key === key);

/**
 * Ascendance, whose press and buff are two different ids.
 *
 * Fifteen seconds long and pressed to line up with the raid's haste cooldown, which on a lust-on-pull is
 * a reason to press it *before* the bell — so this is not a hypothetical shape.
 */
describe('a pre-pull Ascendance', () => {
	/** The whole of what a pre-pull summon leaves inside the fight window: where it ran out. */
	const EXPIRY = 8000;

	it('draws the stretch the log proves it was up for', () => {
		const lane = laneFor(run([e(EXPIRY, 'removebuff', ASCENDANCE_BUFF)]), 'ascendance');
		// `[0, expiry]` and not `[expiry, expiry]`, and not a missing lane: the removal is proof the buff
		// was up, and the pull is the earliest the window can honestly be said to have opened — and
		// `preexisting`, because that is the difference the reader is owed.
		expect(lane?.windows).toEqual([{ start: 0, end: EXPIRY, preexisting: true }]);
	});

	/**
	 * And the press stops it, which is the half that matters — because `auraWindows`' own "a cast proves
	 * the opening was logged in-fight" test is *per id*, and this aura's press is on the other id, so that
	 * walk never sees it. A stream carrying `cast 114049` at 3s with its `applybuff 114050` paged out
	 * would otherwise have an ordinary in-fight press recovered as a pre-pull one, which is a claim the
	 * log does not support.
	 */
	it('is not inferred when the pull carried the press', () => {
		const lane = laneFor(
			run([e(3000, 'cast', ASCENDANCE_CAST, { targetID: BOSS }), e(EXPIRY, 'removebuff', ASCENDANCE_BUFF)]),
			'ascendance',
		);
		expect(lane).toBeUndefined();
	});

	/**
	 * And again with the press arriving *after* the removal in the stream, so the guard cannot be passing
	 * by accident of iteration order.
	 *
	 * Both of these fail without `laneWindows`' filter — measured, by deleting it. The walk does not merely
	 * miss a press it has not reached yet: it never sees this press at all, because `ASCENDANCE_AURA.ids`
	 * is `[114050]` and the cast is 114049, so `auraWindows` skips the event before any guard of its own
	 * could read it. That is what "the guard is per id" means in practice, and why the caller has to hold
	 * the press list where the ids split.
	 */
	it('is not inferred when the press arrives out of order either', () => {
		const lane = laneFor(
			run([e(EXPIRY, 'removebuff', ASCENDANCE_BUFF), e(3000, 'cast', ASCENDANCE_CAST, { targetID: BOSS })]),
			'ascendance',
		);
		expect(lane).toBeUndefined();
	});
});

/** Elemental Mastery books its press and its buff under one id, so the walk's own guard is enough. */
describe('a pre-pull Elemental Mastery', () => {
	const EXPIRY = 12_000;

	it('draws the stretch the log proves it was up for', () => {
		const lane = laneFor(run([e(EXPIRY, 'removebuff', ELEMENTAL_MASTERY)]), 'elemental-mastery');
		expect(lane?.windows).toEqual([{ start: 0, end: EXPIRY, preexisting: true }]);
	});

	it('is not inferred when the pull carried the press, with no guard list needed', () => {
		const lane = laneFor(
			run([e(4000, 'cast', ELEMENTAL_MASTERY), e(EXPIRY, 'removebuff', ELEMENTAL_MASTERY)]),
			'elemental-mastery',
		);
		expect(lane).toBeUndefined();
	});

	/**
	 * And the duration bound still holds: a removal 20s past the bell cannot be a buff that was already
	 * running, because the buff only lasts twenty seconds.
	 */
	it('refuses a removal that lands past the buff’s own duration', () => {
		expect(laneFor(run([e(20_001, 'removebuff', ELEMENTAL_MASTERY)]), 'elemental-mastery')).toBeUndefined();
	});
});

/**
 * Lava Surge, which declares no `durationMs` — so this is the case the bound cannot be checked for, and
 * the one that would have been thrown away before the shared walk stopped refusing them.
 *
 * It is also the case that proves the split: these windows are drawn *and* they are what `lavaBurst.procs`
 * grades. The lane gains the inferred bar and the graded count does not, which is the whole reason the
 * lane walk is a second walk rather than a switch on the memo the graders share.
 */
describe('a pre-pull Lava Surge', () => {
	const EXPIRY = 30_000;
	const el = run([e(EXPIRY, 'removebuff', LAVA_SURGE)]);

	it('draws the stretch the log proves it was up for, with no duration to check against', () => {
		expect(laneFor(el, 'lava-surge')?.windows).toEqual([{ start: 0, end: EXPIRY, preexisting: true }]);
	});

	it('does not hand the inferred window to the rule that grades the proc', () => {
		// A bar the reader can see and a proc the report refuses to judge: `combatantinfo`-grade evidence
		// about the pull is not evidence about a press, and this proc was never pressed at all.
		expect(el.lavaBurst.procs).toEqual([]);
		expect(el.lavaBurst.wasted).toBe(0);
	});
});

/**
 * Flame Shock, which is the case §6 could not reach at all until two separate things were fixed.
 *
 * The lane comes off `dotWindowsBySpawn` rather than off the player's own stream, and that walk filtered
 * its buckets to *aura* events before `auraWindows` saw them — so the "a cast proves the opening was
 * logged in-fight" guard was blind by construction, even though this dot's press and debuff are both
 * 8050. And these windows are the **graded** ones: the uptime figure, the drop ledger, the snapshot check
 * and the APL's `present` all read them, so an inferred bar could not be drawn until the lane could say
 * it was inferred.
 *
 * Both halves are asserted here, and the second is the one that matters more: **the picture gains twenty
 * seconds and the grader gains nothing.**
 */
describe('a pre-pull Flame Shock', () => {
	/** Inside the dot's own thirty seconds, so `auraWindows`' duration bound admits the removal. */
	const EXPIRY = 20_000;

	it('draws the stretch the log proves the dot was up for', () => {
		const lane = laneFor(run([onBoss(EXPIRY, 'removedebuff', FLAME_SHOCK)]), 'flame-shock');
		expect(lane?.windows).toEqual([{ start: 0, end: EXPIRY, preexisting: true }]);
	});

	/**
	 * And not one millisecond of it reaches anything that grades a press.
	 *
	 * `combatantinfo`-grade evidence about the pull is not evidence about a press: a shaman who dotted
	 * before the bell did nothing wrong, and neither did the log record them doing anything, so a figure
	 * that credited the stretch would be scoring an inference. The two readings are separate arrays for
	 * exactly this reason, and the assertion is against the control pull rather than against a literal —
	 * a hard-coded zero would still pass if the graded walk started answering with the same array the
	 * lane does.
	 */
	it('hands none of the inferred stretch to the graded uptime', () => {
		const control = run([]);
		const inferred = run([onBoss(EXPIRY, 'removedebuff', FLAME_SHOCK)]);
		expect(laneFor(inferred, 'flame-shock')?.windows).toHaveLength(1);
		expect(laneFor(control, 'flame-shock')).toBeUndefined();
		expect(inferred.flameShock.windows).toEqual(control.flameShock.windows);
		expect(inferred.flameShock.uptimeMs).toBe(control.flameShock.uptimeMs);
		expect(inferred.flameShock.uptimePct).toBe(control.flameShock.uptimePct);
	});

	/**
	 * The guard, and it is the whole of why the bucket filter had to change.
	 *
	 * A press inside the fight is proof the dot went up inside it, so the removal that follows is that
	 * press's dot running out and not a pre-pull application. `auraWindows` already refuses the inference
	 * for an id whose opening it witnessed and counts a `cast` as a witness — but the cast never reached
	 * it, because `isAuraEvent` had filtered it out of the bucket. Restore that filter and this goes red:
	 * the lane comes back with `[0, 20000]` on a pull that plainly pressed the button at 3s.
	 */
	it('is not inferred when the pull carried the press', () => {
		const lane = laneFor(
			run([onBoss(3000, 'cast', FLAME_SHOCK), onBoss(EXPIRY, 'removedebuff', FLAME_SHOCK)]),
			'flame-shock',
		);
		expect(lane).toBeUndefined();
	});

	/** And the duration bound still holds: the dot cannot have been running for thirty-one seconds. */
	it('refuses a removal that lands past the dot’s own duration', () => {
		expect(laneFor(run([onBoss(30_001, 'removedebuff', FLAME_SHOCK)]), 'flame-shock')).toBeUndefined();
	});
});

/**
 * The T16 two-piece debuff, which shares that walk and is the other half of the same gap.
 *
 * Nothing casts it — it is left on the target by the proc — so there is no press for a guard to find,
 * and it declares no duration, which makes it the unbounded case as well. What holds it in is the
 * leading-orphan rule: a pull cannot start twice, so at most one window per id can come from that branch.
 */
describe('a pre-pull two-piece debuff', () => {
	const EXPIRY = 25_000;
	const el = run([onBoss(EXPIRY, 'removedebuff', T16_2PC_DEBUFF), e(2000, 'cast', EARTH_SHOCK, { targetID: BOSS })]);

	it('draws the stretch the log proves it was up for, with no duration to check against', () => {
		expect(laneFor(el, 't16-2pc-debuff')?.windows).toEqual([{ start: 0, end: EXPIRY, preexisting: true }]);
	});

	it('does not let the inferred window satisfy Earth Shock’s two-piece condition', () => {
		// The press sits inside the drawn bar and still reads as having had no two-piece window, because
		// `twoPieceWindows` is the graded array and the inference never touches it.
		expect(el.earthShock.presses.map((p) => p.t)).toEqual([2000]);
		expect(el.earthShock.presses.every((p) => p.twoPiece === false)).toBe(true);
	});
});
