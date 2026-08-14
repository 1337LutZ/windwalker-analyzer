import { describe, expect, it } from 'vitest';
import type { WclEvent } from '~/lib/events';
import type { Aura } from '~/lib/game/model';
import { SELF_EVENT_MS, auraTimeline, auraWindows, remainingAtCast, remainingIn, uptimePct } from '../auras';

const T0 = 500;

/** One id, one meaning: the plain case. */
const TIGER_POWER: Aura = {
	key: 'tiger-power',
	name: 'Tiger Power',
	ids: [125359],
	kind: 'buff',
	durationMs: 20000,
	refreshRestarts: true,
	appliedBy: 'tiger-palm',
};

/**
 * Three ids for one trinket, because the id says which stat was handed back. Reading only one of
 * them is what undercounted a monk's 15 procs as 12.
 */
const RE_ORIGINATION: Aura = {
	key: 're-origination',
	name: 'Re-Origination',
	ids: [139117, 139120, 139121],
	kind: 'buff',
	durationMs: 10000,
	variants: { 139117: 'Crit', 139120: 'Mastery', 139121: 'Haste' },
};

const RSK_DEBUFF: Aura = {
	key: 'rising-sun-kick-debuff',
	name: 'Rising Sun Kick',
	ids: [130320],
	kind: 'debuff',
	durationMs: 15000,
	appliedBy: 'rising-sun-kick',
};

/** Fight-relative ms in, report-relative event out — the offset the engine works in. */
function ev(t: number, type: string, id = TIGER_POWER.ids[0]!): WclEvent {
	return { timestamp: T0 + t, type, abilityGameID: id, targetID: 1 };
}

describe('auraWindows', () => {
	it('pairs apply with remove and reports fight-relative times', () => {
		expect(auraWindows([ev(1000, 'applybuff'), ev(11000, 'removebuff')], TIGER_POWER, T0, T0 + 60000)).toEqual([
			{ start: 1000, end: 11000, id: 125359, variant: undefined },
		]);
	});

	it('ignores auras this one does not claim', () => {
		const events = [ev(0, 'applybuff', 139117), ev(1000, 'applybuff'), ev(2000, 'removebuff')];
		expect(auraWindows(events, TIGER_POWER, T0, T0 + 60000).map((w) => [w.start, w.end])).toEqual([[1000, 2000]]);
	});

	it('does not open a second window for a re-application', () => {
		// WarcraftLogs emits refreshbuff for a re-cast, so one pair can span two applications.
		const events = [ev(0, 'applybuff'), ev(5000, 'refreshbuff'), ev(28700, 'removebuff')];
		expect(auraWindows(events, TIGER_POWER, T0, T0 + 60000).map((w) => [w.start, w.end])).toEqual([[0, 28700]]);
	});

	it('closes a window still open at the end of the fight and says so', () => {
		const [window] = auraWindows([ev(50000, 'applybuff')], TIGER_POWER, T0, T0 + 60000);
		expect(window).toMatchObject({
			start: 50000,
			end: 60000,
			truncated: true,
		});
	});

	it('handles a debuff falling off with no apply in the fetched range', () => {
		expect(auraWindows([ev(1000, 'removedebuff', 130320)], RSK_DEBUFF, T0, T0 + 60000)).toEqual([]);
	});

	it('reads applydebuff/removedebuff the same way as the buff pair', () => {
		const events = [ev(1000, 'applydebuff', 130320), ev(9000, 'removedebuff', 130320)];
		expect(auraWindows(events, RSK_DEBUFF, T0, T0 + 60000).map((w) => [w.start, w.end])).toEqual([[1000, 9000]]);
	});

	describe('an aura whose id encodes a variant', () => {
		it('reports one window per id, labelled with the variant', () => {
			const events = [
				ev(1000, 'applybuff', 139120),
				ev(11000, 'removebuff', 139120),
				ev(30000, 'applybuff', 139117),
				ev(40000, 'removebuff', 139117),
			];
			expect(auraWindows(events, RE_ORIGINATION, T0, T0 + 60000)).toEqual([
				{ start: 1000, end: 11000, id: 139120, variant: 'Mastery' },
				{ start: 30000, end: 40000, id: 139117, variant: 'Crit' },
			]);
		});

		it("does not let one variant close another variant's window", () => {
			// Tracked with a single open-state, the Crit removal at 10s would close the Mastery
			// window opened at 0s and the Haste proc would vanish entirely.
			const events = [
				ev(0, 'applybuff', 139120),
				ev(1000, 'applybuff', 139117),
				ev(10000, 'removebuff', 139117),
				ev(11000, 'removebuff', 139120),
			];
			expect(auraWindows(events, RE_ORIGINATION, T0, T0 + 60000)).toEqual([
				{ start: 0, end: 11000, id: 139120, variant: 'Mastery' },
				{ start: 1000, end: 10000, id: 139117, variant: 'Crit' },
			]);
		});

		it('returns the windows in time order however the ids interleave', () => {
			const events = [
				ev(20000, 'applybuff', 139121),
				ev(30000, 'removebuff', 139121),
				ev(1000, 'applybuff', 139120),
				ev(11000, 'removebuff', 139120),
			];
			expect(auraWindows(events, RE_ORIGINATION, T0, T0 + 60000).map((w) => w.variant)).toEqual(['Mastery', 'Haste']);
		});
	});
});

describe('remainingIn / uptimePct', () => {
	const windows = [
		{ start: 0, end: 10000 },
		{ start: 20000, end: 25000 },
	];

	it('reports the time left on the covering window', () => {
		expect(remainingIn(6000, windows)).toBe(4000);
		expect(remainingIn(15000, windows)).toBe(0);
	});

	it('measures uptime against the whole fight', () => {
		expect(uptimePct(windows, 30000)).toBe(50);
		expect(uptimePct(windows, 0)).toBe(0);
	});
});

describe('auraTimeline', () => {
	it('keeps applies, refreshes and removals, in order, and nothing else', () => {
		const events = [
			ev(0, 'applybuff'),
			ev(500, 'cast'),
			ev(5000, 'refreshbuff'),
			ev(9000, 'damage'),
			ev(12000, 'removebuff'),
		];
		expect(auraTimeline(events, TIGER_POWER, T0)).toEqual([
			{ t: 0, up: true },
			{ t: 5000, up: true },
			{ t: 12000, up: false },
		]);
	});
});

describe('remainingAtCast', () => {
	// The trap: a cast that refreshes a buff logs that refresh 0–2 ms *before* its own cast event, so
	// reading the buff clock at the cast returns the answer the cast itself just wrote.
	const events = [ev(0, 'applybuff'), ev(19998, 'refreshbuff')];
	const timeline = auraTimeline(events, TIGER_POWER, T0);
	const castAt = 20000;

	it('ignores the aura event the cast itself produced', () => {
		// The buff was two milliseconds from dropping, which is exactly when the press is correct.
		expect(remainingAtCast(timeline, castAt, TIGER_POWER)).toBe(0);
	});

	it('reads a full duration without the guard — which is the bug it exists to stop', () => {
		// 15 of 33 presses were reported wasted this way before the guard went in; the real answer
		// was 0.
		expect(remainingAtCast(timeline, castAt, TIGER_POWER, 0)).toBe(19998);
	});

	it('still ignores an event right at the edge of the guard', () => {
		const edge = auraTimeline([ev(0, 'applybuff'), ev(castAt - SELF_EVENT_MS, 'refreshbuff')], TIGER_POWER, T0);
		expect(remainingAtCast(edge, castAt, TIGER_POWER)).toBe(0);
	});

	it('counts a refresh that happened well before the cast', () => {
		const earlier = auraTimeline([ev(0, 'applybuff'), ev(5000, 'refreshbuff')], TIGER_POWER, T0);
		// Refreshed at 5s for 20s, so a press at 10s clipped 15s of a healthy buff.
		expect(remainingAtCast(earlier, 10000, TIGER_POWER)).toBe(15000);
	});

	it('reports nothing left once the aura came off', () => {
		const dropped = auraTimeline([ev(0, 'applybuff'), ev(8000, 'removebuff')], TIGER_POWER, T0);
		expect(remainingAtCast(dropped, 10000, TIGER_POWER)).toBe(0);
	});

	it('reports nothing before the aura was ever applied', () => {
		expect(remainingAtCast(timeline, 0, TIGER_POWER)).toBe(0);
	});

	it('invents no remaining time for an aura with no declared duration', () => {
		const undated: Aura = { key: 'x', name: 'X', ids: [1], kind: 'buff' };
		const line = auraTimeline(
			[
				{
					timestamp: T0,
					type: 'applybuff',
					abilityGameID: 1,
					targetID: 1,
				},
			],
			undated,
			T0,
		);
		expect(remainingAtCast(line, 5000, undated)).toBe(0);
	});
});
