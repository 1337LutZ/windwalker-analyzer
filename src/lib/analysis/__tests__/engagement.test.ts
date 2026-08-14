import { describe, expect, it } from 'vitest';

import { engagedWindows } from '../engagement';

/**
 * Engaged time decides two published numbers — Rising Sun Kick uptime, and the seconds the report
 * says were lost — so what counts as "the boss was reachable" is worth pinning precisely.
 *
 * The measurements quoted here come from a comparison against three real pulls, with the true
 * intermissions established independently from boss casts and raid-wide debuff applications rather
 * than from this function's own output.
 */
describe('engagedWindows', () => {
	it('splits on a gap longer than the threshold and ends each window at its last hit', () => {
		// Two bursts either side of a 20s hole, with the hole excluded from both ends rather than
		// charged to whichever window it touches.
		const windows = engagedWindows([0, 1000, 2000, 22_000, 23_000], 15_000);
		expect(windows).toEqual([
			[0, 2000],
			[22_000, 23_000],
		]);
	});

	it('keeps a gap at the threshold in one piece', () => {
		expect(engagedWindows([0, 15_000], 15_000)).toEqual([[0, 15_000]]);
	});

	it('has nothing to say about a pull with no hits', () => {
		expect(engagedWindows([], 15_000)).toEqual([]);
	});

	it('does not care what order the hits arrive in', () => {
		expect(engagedWindows([23_000, 0, 22_000, 2000, 1000], 15_000)).toEqual([
			[0, 2000],
			[22_000, 23_000],
		]);
	});

	/**
	 * The regression this exists for, reproduced at the shape that caused it.
	 *
	 * On a real pull the player was incapacitated for 17.8s while a Blackout Kick damage-over-time
	 * kept ticking on the boss. Three ticks inside the hole cut the longest gap to 13.9s — under the
	 * 15s threshold — so the intermission was never detected, and the player was charged with the
	 * debuff dropping during it. Ticks are now filtered out before this function is called; here that
	 * is the difference between one window and two.
	 */
	it('finds the intermission once ticks are not counted as contact', () => {
		const hits = [0, 1000, 2000];
		const afterwards = [19_800, 20_800];
		const ticksInsideTheHole = [3600, 4800, 5800];

		expect(engagedWindows([...hits, ...ticksInsideTheHole, ...afterwards], 15_000)).toEqual([[0, 20_800]]);
		expect(engagedWindows([...hits, ...afterwards], 15_000)).toEqual([
			[0, 2000],
			[19_800, 20_800],
		]);
	});
});
