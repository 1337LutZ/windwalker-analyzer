// The aura lanes that should draw the window they can prove, and the graded readers that must not.
//
// Plan §6. `auraWindows`' `openAtPull` is opt-in per call site, so a lane that never asks for it starts
// its bar at the first *in-fight* event: an aura already running at the bell reads as applied late, or —
// where its only in-fight trace is the bare removal it left behind — as never applied at all.
//
// Every case here is synthetic, and it has to be. None of the three committed Elemental fixtures carries
// a leading orphan removal for any of these auras, so the change is inert against all three: measured,
// their lane window counts and first windows are identical before and after. A fixture cannot hold a rule
// it does not exercise.
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

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

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
		// was up, and the pull is the earliest the window can honestly be said to have opened.
		expect(lane?.windows).toEqual([{ start: 0, end: EXPIRY }]);
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
		expect(lane?.windows).toEqual([{ start: 0, end: EXPIRY }]);
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
		expect(laneFor(el, 'lava-surge')?.windows).toEqual([{ start: 0, end: EXPIRY }]);
	});

	it('does not hand the inferred window to the rule that grades the proc', () => {
		// A bar the reader can see and a proc the report refuses to judge: `combatantinfo`-grade evidence
		// about the pull is not evidence about a press, and this proc was never pressed at all.
		expect(el.lavaBurst.procs).toEqual([]);
		expect(el.lavaBurst.wasted).toBe(0);
	});
});
