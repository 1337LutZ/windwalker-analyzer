import { describe, expect, it } from 'vitest';
import type { WclEvent } from '~/lib/events';
import type { Aura } from '~/lib/game/model';
import type { Window } from '~/lib/types';
import { pairDrainsToWindows, snapshotWindowEnd, trackStackBank } from '../stacks';

const ME = 7;
const T0 = 1000;

/** The stacking counter. Its removals are how a use is read — never the cast. */
const BANK: Aura = {
	key: 'tigereye-brew-bank',
	name: 'Tigereye Brew (bank)',
	ids: [1247279],
	kind: 'buff',
	maxStacks: 20,
	drainsPerUse: 10,
	consumedBy: ['tigereye-brew'],
};

/** The consumed buff. Always 15s, and a re-cast refreshes it rather than opening a second window. */
const BREW: Aura = {
	key: 'tigereye-brew',
	name: 'Tigereye Brew',
	ids: [1247275],
	kind: 'buff',
	durationMs: 15000,
	refreshRestarts: true,
	appliedBy: 'tigereye-brew',
};

/** Fight-relative ms in, report-relative event out — the same offset the engine works in. */
function ev(
	t: number,
	type: string,
	extra: { stack?: number; targetID?: number; abilityGameID?: number } = {},
): WclEvent {
	return {
		timestamp: T0 + t,
		type,
		abilityGameID: BANK.ids[0]!,
		sourceID: ME,
		targetID: ME,
		...extra,
	};
}

describe('trackStackBank', () => {
	it('reads the consumed count off the removal, not off the bank at the cast', () => {
		// The drain is logged ~1 ms before the cast that spent it, so sampling the bank at the cast
		// always reads a bank that has already been emptied.
		const bank = trackStackBank(
			[
				ev(0, 'applybuff'),
				ev(1000, 'applybuffstack', { stack: 10 }),
				ev(4999, 'removebuffstack', { stack: 0 }),
				ev(5000, 'cast', { abilityGameID: 1247275 }),
			],
			BANK,
			ME,
			T0,
		);

		expect(bank.drains).toEqual([{ t: 4999, before: 10, consumed: 10 }]);
		expect(bank.bankAtEnd).toBe(0);
	});

	it('takes the remaining stacks from removebuffstack for a partial drain', () => {
		const bank = trackStackBank(
			[
				ev(0, 'applybuff'),
				ev(100, 'applybuffstack', { stack: 20 }),
				ev(5000, 'removebuffstack', { stack: 10 }),
				ev(9000, 'removebuffstack', { stack: 4 }),
			],
			BANK,
			ME,
			T0,
		);

		expect(bank.drains).toEqual([
			{ t: 5000, before: 20, consumed: 10 },
			{ t: 9000, before: 10, consumed: 6 },
		]);
		expect(bank.maxStacks).toBe(20);
		expect(bank.bankAtEnd).toBe(4);
	});

	it('treats a bare removebuff as the whole bank going', () => {
		const bank = trackStackBank(
			[ev(0, 'applybuff'), ev(100, 'applybuffstack', { stack: 6 }), ev(5000, 'removebuff')],
			BANK,
			ME,
			T0,
		);

		expect(bank.drains).toEqual([{ t: 5000, before: 6, consumed: 6 }]);
		expect(bank.bankAtEnd).toBe(0);
	});

	it('counts a lone refresh at the cap as a wasted stack', () => {
		const bank = trackStackBank(
			[
				ev(0, 'applybuff'),
				ev(100, 'applybuffstack', { stack: BANK.maxStacks }),
				ev(2000, 'refreshbuff'),
				ev(3000, 'refreshbuff'),
			],
			BANK,
			ME,
			T0,
		);

		expect(bank.wastedAtCap).toBe(2);
	});

	it('does not charge a refresh that a stack gain landed alongside', () => {
		// A gain that actually made it into the bank emits its own apply on the same millisecond.
		const bank = trackStackBank(
			[
				ev(0, 'applybuff'),
				ev(100, 'applybuffstack', { stack: BANK.maxStacks }),
				ev(2000, 'removebuffstack', { stack: 10 }),
				ev(3000, 'refreshbuff'),
				ev(3000, 'applybuffstack', { stack: 11 }),
			],
			BANK,
			ME,
			T0,
		);

		expect(bank.wastedAtCap).toBe(0);
		expect(bank.bankAtEnd).toBe(11);
	});

	it('takes the cap from the aura, so a refresh below it is not waste', () => {
		const bank = trackStackBank(
			[ev(0, 'applybuff'), ev(100, 'applybuffstack', { stack: 19 }), ev(2000, 'refreshbuff')],
			BANK,
			ME,
			T0,
		);

		expect(bank.wastedAtCap).toBe(0);
	});

	it('ignores the same aura on somebody else', () => {
		const bank = trackStackBank(
			[
				ev(0, 'applybuff'),
				ev(100, 'applybuffstack', { stack: 5 }),
				ev(200, 'applybuffstack', { stack: 19, targetID: 99 }),
			],
			BANK,
			ME,
			T0,
		);

		expect(bank.bankAtEnd).toBe(5);
		expect(bank.maxStacks).toBe(5);
	});

	it('records the bank after every event that moved it, for the timeline', () => {
		const bank = trackStackBank(
			[ev(0, 'applybuff'), ev(100, 'applybuffstack', { stack: 3 }), ev(150, 'cast'), ev(200, 'removebuff')],
			BANK,
			ME,
			T0,
		);

		expect(bank.timeline).toEqual([
			[0, 1],
			[100, 3],
			[200, 0],
		]);
	});
});

describe('pairDrainsToWindows', () => {
	const windows: Window[] = [
		{ start: 5000, end: 20000 },
		{ start: 40000, end: 55000 },
	];

	it('pairs a drain with the window it opened, even though it is stamped first', () => {
		const [use] = pairDrainsToWindows([{ t: 4999, before: 10, consumed: 10 }], windows);
		expect(use?.window).toEqual(windows[0]);
		expect(use?.refresh).toBe(false);
	});

	it('treats a drain inside a running window as a re-cast', () => {
		// Re-casting emits refreshbuff, so WarcraftLogs never opens a second window for it.
		const [use] = pairDrainsToWindows([{ t: 12000, before: 10, consumed: 10 }], windows);
		expect(use?.window).toEqual(windows[0]);
		expect(use?.refresh).toBe(true);
	});

	it('leaves a drain with no window at all unpaired', () => {
		const [use] = pairDrainsToWindows([{ t: 30000, before: 4, consumed: 4 }], windows);
		expect(use?.window).toBeNull();
		expect(use?.refresh).toBe(false);
	});
});

describe('snapshotWindowEnd', () => {
	// One apply→remove pair spanning two applications: the aura was up for 28.7s, the snapshot was
	// not. This is the window every one of these cases is measured against.
	const extended: Window = { start: 0, end: 28700 };

	it('ends a snapshot at the next cast, which discards what the first one held', () => {
		expect(snapshotWindowEnd(0, extended, BREW, 13700)).toBe(13700);
	});

	it('caps an un-recast snapshot at the aura duration, not at the aura window', () => {
		expect(snapshotWindowEnd(0, extended, BREW, null)).toBe(15000);
	});

	it('ends it early when the aura dropped first', () => {
		expect(snapshotWindowEnd(0, { start: 0, end: 9000 }, BREW, null)).toBe(9000);
	});

	it('takes the soonest of the three when all of them apply', () => {
		// Duration would say 15s, the aura dropped at 12s, and the re-cast at 9s beat both.
		expect(snapshotWindowEnd(0, { start: 0, end: 12000 }, BREW, 9000)).toBe(9000);
		expect(snapshotWindowEnd(0, { start: 0, end: 12000 }, BREW, 14000)).toBe(12000);
	});

	it('never credits a snapshot with more than the buff can hold', () => {
		// Reading the raw window instead credited one proc with 19.6s of overlap against a 15s buff.
		const end = snapshotWindowEnd(0, extended, BREW, null);
		expect(end).toBeLessThan(extended.end);
		expect(end - 0).toBe(BREW.durationMs);
	});

	it('measures the duration from the snapshot, not from the start of the window', () => {
		// A brew cast 6s into a running window still holds its own stats for a full 15s.
		expect(snapshotWindowEnd(6000, { start: 0, end: 28700 }, BREW, null)).toBe(21000);
	});

	it('falls back to the window and the next cast for an aura with no declared duration', () => {
		const undated: Aura = { key: 'x', name: 'X', ids: [1], kind: 'buff' };
		expect(snapshotWindowEnd(0, extended, undated, null)).toBe(28700);
		expect(snapshotWindowEnd(0, extended, undated, 5000)).toBe(5000);
	});
});
