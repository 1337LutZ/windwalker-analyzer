import { describe, expect, it } from 'vitest';

import {
	DEFAULT_SETTINGS,
	SNAPSHOT_LEEWAY,
	TIGER_PALM_REFRESH,
	clampLeeway,
	clampRefreshWindow,
	isDefault,
	normaliseSettings,
} from '../model';

describe('snapshot leeway', () => {
	it('defaults to one global', () => {
		expect(DEFAULT_SETTINGS.snapshotLeewayMs).toBe(1000);
	});

	/**
	 * The value arrives from a number input and from `localStorage`, which is to say from anywhere.
	 * The engine must never be handed a `NaN` window, so this is total rather than refusable.
	 */
	it('forces anything into range rather than refusing it', () => {
		expect(clampLeeway('2000')).toBe(2000);
		expect(clampLeeway(50)).toBe(SNAPSHOT_LEEWAY.min);
		expect(clampLeeway(99_999)).toBe(SNAPSHOT_LEEWAY.max);
		expect(clampLeeway('nonsense')).toBe(SNAPSHOT_LEEWAY.default);
		expect(clampLeeway(Number.NaN)).toBe(SNAPSHOT_LEEWAY.default);
		// Absent means "use the default", never "use the minimum" — `Number(null)` and `Number('')` are
		// both 0, so an emptied field would otherwise save as 250ms without saying so.
		expect(clampLeeway(null)).toBe(SNAPSHOT_LEEWAY.default);
		expect(clampLeeway(undefined)).toBe(SNAPSHOT_LEEWAY.default);
		expect(clampLeeway('')).toBe(SNAPSHOT_LEEWAY.default);
	});

	/**
	 * The ceiling is where `LATE_MS` begins. Past it the two bands overlap and every snapshot lands in
	 * the best one — not a generous setting but a broken scale.
	 */
	it('never lets the window swallow the band above it', () => {
		expect(SNAPSHOT_LEEWAY.max).toBeLessThanOrEqual(3000);
	});

	it('survives a stale or hand-edited stored value', () => {
		expect(normaliseSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normaliseSettings('nope')).toEqual(DEFAULT_SETTINGS);
		expect(normaliseSettings({})).toEqual(DEFAULT_SETTINGS);
		expect(normaliseSettings({ snapshotLeewayMs: 2500, removedSetting: true })).toEqual({
			...DEFAULT_SETTINGS,
			snapshotLeewayMs: 2500,
		});
	});

	/**
	 * The concrete case of the above, and the reason it is worth its own test: `maxHealth` was a real
	 * setting, and a reader who used it still has it in `localStorage`. Touch of Karma now measures the
	 * pool from a use that drained it, so the field is gone — and a stored one has to be dropped on
	 * read rather than reaching the engine, or throwing on the way past.
	 */
	it('drops a setting that no longer exists', () => {
		const stale = { snapshotLeewayMs: 1500, tigerPalmRefreshMs: 2000, maxHealth: 750_000 };
		expect(normaliseSettings(stale)).toEqual({ ...DEFAULT_SETTINGS, snapshotLeewayMs: 1500 });
		expect(normaliseSettings(stale)).not.toHaveProperty('maxHealth');
		// And one stored alone still reads as untouched defaults rather than as a customised report.
		expect(isDefault(normaliseSettings({ maxHealth: 750_000 }))).toBe(true);
	});

	it('knows when nothing has been changed', () => {
		expect(isDefault(DEFAULT_SETTINGS)).toBe(true);
		expect(isDefault({ ...DEFAULT_SETTINGS, snapshotLeewayMs: 2000 })).toBe(false);
	});
});

describe('Tiger Palm refresh window', () => {
	/**
	 * Two globals, not the one the APL uses. The sim presses on the tick it decides to and a person
	 * cannot, so the report's default is deliberately wider than `auraRemainingTime(Tiger Power) <= 1s`
	 * — and the APL's own number is still reachable, at the floor.
	 */
	it('defaults a global wider than the APL, which stays reachable', () => {
		expect(DEFAULT_SETTINGS.tigerPalmRefreshMs).toBe(2000);
		expect(TIGER_PALM_REFRESH.min).toBe(1000);
		expect(clampRefreshWindow(1000)).toBe(1000);
	});

	it('forces anything into range rather than refusing it', () => {
		expect(clampRefreshWindow('3000')).toBe(3000);
		expect(clampRefreshWindow(50)).toBe(TIGER_PALM_REFRESH.min);
		expect(clampRefreshWindow(99_999)).toBe(TIGER_PALM_REFRESH.max);
		expect(clampRefreshWindow('nonsense')).toBe(TIGER_PALM_REFRESH.default);
		expect(clampRefreshWindow(Number.NaN)).toBe(TIGER_PALM_REFRESH.default);
		// The same trap the leeway fell into: `Number(null)` and `Number('')` are both 0, which is
		// finite and clamps to the floor, so an emptied field would silently grade against the APL's
		// 1000ms instead of falling back to the 2000ms default.
		expect(clampRefreshWindow(null)).toBe(TIGER_PALM_REFRESH.default);
		expect(clampRefreshWindow(undefined)).toBe(TIGER_PALM_REFRESH.default);
		expect(clampRefreshWindow('')).toBe(TIGER_PALM_REFRESH.default);
	});

	/**
	 * A quarter of Tiger Power's 20s. Wider than this and a press throws away more of the buff than it
	 * renews, so every clip would be graded a refresh and the "wasted" count — the whole point of the
	 * section — would read zero for everyone.
	 */
	it('never lets the window swallow the buff it is meant to protect', () => {
		expect(TIGER_PALM_REFRESH.max).toBeLessThanOrEqual(5000);
	});

	it('is stored and restored like the rest', () => {
		expect(normaliseSettings({ tigerPalmRefreshMs: 3500 })).toEqual({
			...DEFAULT_SETTINGS,
			tigerPalmRefreshMs: 3500,
		});
		// A settings blob written before this field existed reads back as the default, not as 0.
		expect(normaliseSettings({ snapshotLeewayMs: 1000, maxHealth: null }).tigerPalmRefreshMs).toBe(
			TIGER_PALM_REFRESH.default,
		);
		expect(isDefault({ ...DEFAULT_SETTINGS, tigerPalmRefreshMs: 3000 })).toBe(false);
	});
});

/**
 * That the setting actually moves the analysis is verified against a live pull rather than here: it
 * needs a whole `FightDataset`, and committing megabytes of raw events to exercise one threshold is
 * a bad trade. `src/lib/__fixtures__/leeway.test.ts` does it when a token is present.
 */
