// Analysis settings: the handful of thresholds a reader is entitled to disagree with.
//
// Everything else this report grades is a judgement it makes and defends in a comment. These are
// different: they depend on the person, not on the spec. How late someone can react to a proc is a
// fact about their latency and their hands, and a number picked here would be wrong for somebody.
//
// What those thresholds *are* is declared by each spec in its own module — see `WW_SETTINGS` in
// `spec/windwalker`. This file is the machinery: the shape a declaration takes, and the total
// functions that turn whatever arrived into a settings object the engine can trust.

export interface AnalysisSettings {
	/**
	 * How much of a proc's tail still counts as snapshotting on the last global. Windwalker.
	 *
	 * The rotation wants the brew inside the proc's final global, and a strict reading of that is one
	 * global — 1000ms. But a player on 200ms latency who presses at exactly the right moment is
	 * logged 200ms later than they acted, and someone who deliberately gives themselves a two-second
	 * cushion is playing a considered game rather than a sloppy one. Both were being marked down by a
	 * threshold that described neither.
	 */
	snapshotLeewayMs: number;
	/**
	 * How much Tiger Power may still be running for a Tiger Palm to be read as refreshing it. Windwalker.
	 *
	 * Below it a press is a refresh; above it the press clipped a healthy buff and burned a global
	 * that Jab or Blackout Kick wanted. The APL's number is 1000ms and this defaults wider, for the
	 * same reason the leeway does: a person cannot press on the instant they decide to, and a report
	 * that grades to the sim's frame is grading latency.
	 */
	tigerPalmRefreshMs: number;
	/**
	 * How late a press may land after a cooldown came back before the wait counts against the player.
	 * Shared by every spec with cooldowns to grade.
	 *
	 * A wait shorter than this is dropped whole; a longer one is charged whole, which is the rule
	 * `cooldownDrift` has always applied and this only widens. It was one global, and one global is the
	 * press the player was already committed to when the button returned — so a press that went out
	 * 1.1s late put the whole 1.1s on the ledger as a cooldown held, while one 0.9s late put nothing
	 * there at all. The same reasoning as the two above: the sim presses on the tick a cooldown
	 * returns and a person cannot, and a report that grades to the sim's frame is grading latency.
	 */
	cooldownLeewayMs: number;
	/**
	 * How much Flame Shock may still be running for a press to be read as refreshing it. Elemental.
	 *
	 * Below it a press is a refresh; above it the press clipped a healthy dot and burned a cast that
	 * Lava Burst or Lightning Bolt wanted. The APL's number is one Lightning Bolt cast time — it
	 * stops casting the moment the dot has less than a cast left, and refreshes when the dot has less
	 * than one tick left — and this defaults wider, for the same reason the others do: a person
	 * cannot press on the instant they decide to, and a report that grades to the sim's frame is
	 * grading latency.
	 */
	flameShockRefreshMs: number;
	/**
	 * How long Lightning Shield may sit at its ceiling before the time past that counts as
	 * overcapping. Elemental.
	 *
	 * The shield is spent by Earth Shock's Fulmination, so a shield at seven stacks is a shock not
	 * taken — and every Lightning Bolt after that is Rolling Thunder with nowhere to put its charge.
	 * One press's worth of grace is forgiven, like the cooldown leeway; past it, each second at seven
	 * is a second of overcapping.
	 */
	lightningShieldOvercapMs: number;
	/**
	 * How much Searing Totem may still be running for a re-press to be read as a plain refresh.
	 * Elemental.
	 *
	 * The totem lasts a minute, so re-pressing it with half of that left throws the other half away.
	 * But a re-press with a second and a half left is just placing the next totem early, and grading it
	 * as a clip is grading the reaction time, not the decision. Same reasoning as the cooldown leeway.
	 */
	searingTotemRefreshMs: number;
}

// There was a fourth setting here, `maxHealth`, and it is gone rather than defaulted.
//
// It existed so the Touch of Karma section could state a ceiling, on the conclusion that these logs
// carry no health pool. That conclusion still holds for the *health bar* — `maxHitPoints` is 100 on
// every player-describing event, because player health here is a percentage — but the pool was
// never only readable there. Touch of Karma absorbs at most a full health pool, so a use that
// drained its own states the pool exactly; see `karmaCap` in `spec/windwalker`. A setting that asks
// a reader for a number the log already contains is a setting that can only be wrong, so it went.
//
// A blob written by an older build still carries the key. `normaliseSettings` reads only the fields
// the schema names, so it is dropped on the next read and never reaches the engine — the behaviour
// the `removedSetting` case in `settings.test` has always pinned.

/**
 * How a setting is declared: where it lives on the settings object, what it may be, and the UI copy
 * that describes it.
 *
 * Each spec declares its own — the settings panel renders whatever schema it is handed, so a second
 * spec's thresholds need no new UI. The reasoning that used to live beside each constant in this
 * file now lives beside its schema entry, in the spec module.
 */
export interface SettingSchema {
	/** The property name on the settings object. */
	key: keyof AnalysisSettings;
	/** The i18n path under `ui.settings` — the `label`, `hint` and `unit` keys hang off it. */
	tKey: string;
	min: number;
	max: number;
	step: number;
	default: number;
}

/** The settings object a schema describes, every value at its default. */
export function defaultSettings(schema: SettingSchema[]): AnalysisSettings {
	return Object.fromEntries(schema.map((s) => [s.key, s.default])) as unknown as AnalysisSettings;
}

/**
 * Forces one value into a setting's allowed range, whatever arrives.
 *
 * Settings come from a text field and from `localStorage`, which is to say from anywhere: a stale
 * key from an older build, a hand-edited value, an empty string. The analysis engine must never be
 * handed a `NaN` window, so this is total rather than a validator that can refuse.
 *
 * Absent is not zero. `Number(null)` and `Number('')` are both `0`, which is finite and would clamp
 * to the minimum — so clearing the field and saving would quietly set the floor instead of falling
 * back to the default the reader was expecting.
 */
export function clampSetting(value: unknown, schema: SettingSchema): number {
	if (value === null || value === undefined || value === '') return schema.default;
	const ms = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(ms)) return schema.default;
	return Math.min(schema.max, Math.max(schema.min, Math.round(ms)));
}

/**
 * The same total treatment for a whole settings object.
 *
 * Reads only the fields the schema names, clamping each against its own entry. That is what makes
 * removing a setting safe: a blob still carrying `maxHealth` from an older build loses it here
 * rather than carrying an unread key into the engine. A named field that is absent becomes its
 * schema default, for the reason `clampSetting` gives.
 */
export function clampSettings(
	raw: AnalysisSettings | Record<string, unknown>,
	schema: SettingSchema[],
): AnalysisSettings {
	return Object.fromEntries(schema.map((s) => [s.key, clampSetting(raw[s.key], s)])) as unknown as AnalysisSettings;
}

/**
 * Reads whatever was stored into a settings object that is always safe to use.
 *
 * Anything that is not an object is replaced wholesale by the defaults; an object's shape is
 * decided by the schema, exactly as it is when the values were fresh.
 */
export function normaliseSettings(raw: unknown, schema: SettingSchema[]): AnalysisSettings {
	if (typeof raw !== 'object' || raw === null) return defaultSettings(schema);
	return clampSettings(raw as Record<string, unknown>, schema);
}

/** True when nothing has been changed from the defaults, so the UI can say "default" rather than repeat it. */
export function isDefault(settings: AnalysisSettings, schema: SettingSchema[]): boolean {
	return schema.every((s) => settings[s.key] === s.default);
}
