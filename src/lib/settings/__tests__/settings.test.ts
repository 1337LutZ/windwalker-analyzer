import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, SNAPSHOT_LEEWAY, clampLeeway, isDefault, normaliseSettings } from '../model';

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
			snapshotLeewayMs: 2500,
			maxHealth: null,
		});
	});

	it('knows when nothing has been changed', () => {
		expect(isDefault(DEFAULT_SETTINGS)).toBe(true);
		expect(isDefault({ snapshotLeewayMs: 2000, maxHealth: null })).toBe(false);
		expect(isDefault({ snapshotLeewayMs: 1000, maxHealth: 750_000 })).toBe(false);
	});
});

/**
 * That the setting actually moves the analysis is verified against a live pull rather than here: it
 * needs a whole `FightDataset`, and committing megabytes of raw events to exercise one threshold is
 * a bad trade. `src/lib/__fixtures__/leeway.test.ts` does it when a token is present.
 */
