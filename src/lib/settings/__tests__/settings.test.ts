import { describe, expect, it } from 'vitest';

import { clampSetting, defaultSettings, isDefault, normaliseSettings } from '../model';
import { WW_SETTINGS } from '~/specs/windwalker/lib';

const leeway = WW_SETTINGS.find((s) => s.key === 'snapshotLeewayMs')!;
const tigerPalm = WW_SETTINGS.find((s) => s.key === 'tigerPalmRefreshMs')!;
const cooldown = WW_SETTINGS.find((s) => s.key === 'cooldownLeewayMs')!;

describe('snapshot leeway', () => {
	it('defaults to one global', () => {
		expect(defaultSettings(WW_SETTINGS).snapshotLeewayMs).toBe(1000);
	});

	/**
	 * The value arrives from a number input and from `localStorage`, which is to say from anywhere.
	 * The engine must never be handed a `NaN` window, so this is total rather than refusable.
	 */
	it('forces anything into range rather than refusing it', () => {
		expect(clampSetting('2000', leeway)).toBe(2000);
		expect(clampSetting(50, leeway)).toBe(leeway.min);
		expect(clampSetting(99_999, leeway)).toBe(leeway.max);
		expect(clampSetting('nonsense', leeway)).toBe(leeway.default);
		expect(clampSetting(Number.NaN, leeway)).toBe(leeway.default);
		// Absent means "use the default", never "use the minimum" — `Number(null)` and `Number('')` are
		// both 0, so an emptied field would otherwise save as 250ms without saying so.
		expect(clampSetting(null, leeway)).toBe(leeway.default);
		expect(clampSetting(undefined, leeway)).toBe(leeway.default);
		expect(clampSetting('', leeway)).toBe(leeway.default);
	});

	/**
	 * The ceiling is where `LATE_MS` begins. Past it the two bands overlap and every snapshot lands in
	 * the best one — not a generous setting but a broken scale.
	 */
	it('never lets the window swallow the band above it', () => {
		expect(leeway.max).toBeLessThanOrEqual(3000);
	});

	it('survives a stale or hand-edited stored value', () => {
		expect(normaliseSettings(null, WW_SETTINGS)).toEqual(defaultSettings(WW_SETTINGS));
		expect(normaliseSettings('nope', WW_SETTINGS)).toEqual(defaultSettings(WW_SETTINGS));
		expect(normaliseSettings({}, WW_SETTINGS)).toEqual(defaultSettings(WW_SETTINGS));
		expect(normaliseSettings({ snapshotLeewayMs: 2500, removedSetting: true }, WW_SETTINGS)).toEqual({
			...defaultSettings(WW_SETTINGS),
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
		expect(normaliseSettings(stale, WW_SETTINGS)).toEqual({
			...defaultSettings(WW_SETTINGS),
			snapshotLeewayMs: 1500,
		});
		expect(normaliseSettings(stale, WW_SETTINGS)).not.toHaveProperty('maxHealth');
		// And one stored alone still reads as untouched defaults rather than as a customised report.
		expect(isDefault(normaliseSettings({ maxHealth: 750_000 }, WW_SETTINGS), WW_SETTINGS)).toBe(true);
	});

	it('knows when nothing has been changed', () => {
		expect(isDefault(defaultSettings(WW_SETTINGS), WW_SETTINGS)).toBe(true);
		expect(isDefault({ ...defaultSettings(WW_SETTINGS), snapshotLeewayMs: 2000 }, WW_SETTINGS)).toBe(false);
	});
});

describe('Tiger Palm refresh window', () => {
	/**
	 * Two globals, not the one the APL uses. The sim presses on the tick it decides to and a person
	 * cannot, so the report's default is deliberately wider than `auraRemainingTime(Tiger Power) <= 1s`
	 * — and the APL's own number is still reachable, at the floor.
	 */
	it('defaults a global wider than the APL, which stays reachable', () => {
		expect(defaultSettings(WW_SETTINGS).tigerPalmRefreshMs).toBe(2000);
		expect(tigerPalm.min).toBe(1000);
		expect(clampSetting(1000, tigerPalm)).toBe(1000);
	});

	it('forces anything into range rather than refusing it', () => {
		expect(clampSetting('3000', tigerPalm)).toBe(3000);
		expect(clampSetting(50, tigerPalm)).toBe(tigerPalm.min);
		expect(clampSetting(99_999, tigerPalm)).toBe(tigerPalm.max);
		expect(clampSetting('nonsense', tigerPalm)).toBe(tigerPalm.default);
		expect(clampSetting(Number.NaN, tigerPalm)).toBe(tigerPalm.default);
		// The same trap the leeway fell into: `Number(null)` and `Number('')` are both 0, which is
		// finite and clamps to the floor, so an emptied field would silently grade against the APL's
		// 1000ms instead of falling back to the 2000ms default.
		expect(clampSetting(null, tigerPalm)).toBe(tigerPalm.default);
		expect(clampSetting(undefined, tigerPalm)).toBe(tigerPalm.default);
		expect(clampSetting('', tigerPalm)).toBe(tigerPalm.default);
	});

	/**
	 * A quarter of Tiger Power's 20s. Wider than this and a press throws away more of the buff than it
	 * renews, so every clip would be graded a refresh and the "wasted" count — the whole point of the
	 * section — would read zero for everyone.
	 */
	it('never lets the window swallow the buff it is meant to protect', () => {
		expect(tigerPalm.max).toBeLessThanOrEqual(5000);
	});

	it('is stored and restored like the rest', () => {
		expect(normaliseSettings({ tigerPalmRefreshMs: 3500 }, WW_SETTINGS)).toEqual({
			...defaultSettings(WW_SETTINGS),
			tigerPalmRefreshMs: 3500,
		});
		// A settings blob written before this field existed reads back as the default, not as 0.
		expect(normaliseSettings({ snapshotLeewayMs: 1000, maxHealth: null }, WW_SETTINGS).tigerPalmRefreshMs).toBe(
			tigerPalm.default,
		);
		expect(isDefault({ ...defaultSettings(WW_SETTINGS), tigerPalmRefreshMs: 3000 }, WW_SETTINGS)).toBe(false);
	});
});

describe('cooldown leeway', () => {
	/**
	 * A global and a half, and the floor is the one global it replaces. A cooldown that comes back
	 * inside a global cannot be pressed until that global ends however well the pull is played, so
	 * anything under 1000ms charges a press that could not have been made — and the report's old
	 * reading stays reachable at the floor, as the APL's number does for the Tiger Palm window.
	 */
	it('defaults half a global wider than the press the player was already committed to', () => {
		expect(defaultSettings(WW_SETTINGS).cooldownLeewayMs).toBe(1500);
		expect(cooldown.min).toBe(1000);
		expect(clampSetting(1000, cooldown)).toBe(1000);
	});

	it('forces anything into range rather than refusing it', () => {
		expect(clampSetting('1750', cooldown)).toBe(1750);
		expect(clampSetting(50, cooldown)).toBe(cooldown.min);
		expect(clampSetting(99_999, cooldown)).toBe(cooldown.max);
		expect(clampSetting('nonsense', cooldown)).toBe(cooldown.default);
		expect(clampSetting(Number.NaN, cooldown)).toBe(cooldown.default);
		// The trap both the others fall into: `Number(null)` and `Number('')` are both 0, which is finite
		// and clamps to the floor, so an emptied field would put the report back on the one-global window
		// this setting exists to widen without ever saying so.
		expect(clampSetting(null, cooldown)).toBe(cooldown.default);
		expect(clampSetting(undefined, cooldown)).toBe(cooldown.default);
		expect(clampSetting('', cooldown)).toBe(cooldown.default);
	});

	/**
	 * A quarter of Rising Sun Kick's 8s, the shortest cooldown the drift audit covers. Each wait is
	 * forgiven in full and a pull can hold any number of them, so at a quarter of the cooldown four
	 * late presses are a lost cast that has stopped being counted — and a player a beat late on every
	 * kick, which is exactly what the drift row exists to show, would read as flawless.
	 */
	it('never lets the window forgive a whole cast', () => {
		expect(cooldown.max * 4).toBeLessThanOrEqual(8000);
	});

	it('is stored and restored like the rest', () => {
		expect(normaliseSettings({ cooldownLeewayMs: 2000 }, WW_SETTINGS)).toEqual({
			...defaultSettings(WW_SETTINGS),
			cooldownLeewayMs: 2000,
		});
		// A settings blob written before this field existed reads back as the default, not as 0 — which
		// is every reader who saved a threshold under the build before this one.
		expect(normaliseSettings({ snapshotLeewayMs: 1000, tigerPalmRefreshMs: 2000 }, WW_SETTINGS).cooldownLeewayMs).toBe(
			cooldown.default,
		);
		expect(
			isDefault(normaliseSettings({ snapshotLeewayMs: 1000, tigerPalmRefreshMs: 2000 }, WW_SETTINGS), WW_SETTINGS),
		).toBe(true);
		expect(isDefault({ ...defaultSettings(WW_SETTINGS), cooldownLeewayMs: 2000 }, WW_SETTINGS)).toBe(false);
	});
});

/**
 * That the setting actually moves the analysis is verified against a live pull rather than here: it
 * needs a whole `FightDataset`, and committing megabytes of raw events to exercise one threshold is
 * a bad trade. `src/specs/windwalker/__fixtures__/leeway.test.ts` does it when a token is present.
 */
