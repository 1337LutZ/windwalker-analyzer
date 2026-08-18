// Analysis settings: the handful of thresholds a reader is entitled to disagree with.
//
// Everything else in `lib/score` is a judgement this report makes and defends in a comment. These
// are different: they depend on the person, not on the spec. How late someone can react to a proc is
// a fact about their latency and their hands, and a number picked here would be wrong for somebody.

/** The reaction window a snapshot is judged against, and what it is allowed to be. */
export const SNAPSHOT_LEEWAY = {
	/**
	 * One global. Windwalker's abilities cost energy and chi, so the global is a flat 1.0s that haste
	 * does not shorten — the rotation's own target is a brew inside the proc's final global.
	 */
	default: 1000,
	/** Below this there is no window left to react in; it would grade reflexes, not play. */
	min: 250,
	/**
	 * Three seconds is where `LATE_MS` starts. Past it the two bands would overlap and every snapshot
	 * would land in the best one, which is not a generous setting but a broken scale.
	 */
	max: 3000,
	step: 50,
} as const;

/** How much Tiger Power may be left for a Tiger Palm to count as refreshing it, and its range. */
export const TIGER_PALM_REFRESH = {
	/**
	 * Two globals — a deliberate departure from the APL.
	 *
	 * wowsims-mop's Windwalker APL refreshes on `auraRemainingTime(Tiger Power) <= 1s`, and this
	 * report used to grade against that number directly. A sim presses on the tick it decides to; a
	 * person has to see the buff, finish the global they are in and then press, so a press with 1.4s
	 * left is the same decision the APL makes, taken by someone who cannot act inside a single frame.
	 * Grading them apart marked correct play as a clipped buff, so the default is one global wider
	 * than the APL and the APL's own value sits at the floor for anyone who wants it back.
	 */
	default: 2000,
	/**
	 * The APL threshold itself: `auraRemainingTime(Tiger Power) <= 1s`, one Windwalker global. Nothing
	 * below it is worth offering — inside a single global there is no moment left to aim at, so a
	 * tighter window would grade reaction time rather than the decision to refresh.
	 */
	min: 1000,
	/**
	 * A quarter of Tiger Power's 20s. Past this a press throws away more of the buff than it renews,
	 * which is the definition of the clip the "wasted" count exists to find — a wider window would
	 * empty that bucket and leave the section reporting that everyone plays perfectly.
	 */
	max: 5000,
	/** A quarter of a global, which is finer than anyone can actually press. */
	step: 250,
} as const;

/** How late a press may land after a cooldown returns before the wait is charged, and its range. */
export const COOLDOWN_LEEWAY = {
	/**
	 * A global and a half, and it is the *whole* of a wait this long that is forgiven rather than a
	 * slice off a longer one — the shape `cooldownDrift` already had, kept deliberately.
	 *
	 * A cooldown comes back at a moment of its own choosing, and a Windwalker global is a flat 1.0s
	 * that haste does not shorten. A button that returns just after a press has begun cannot be used
	 * for the rest of that global however well the pull is played, and the press that follows it is
	 * aimed by a person watching a bar rather than scheduled on a tick — so the first global is owed to
	 * the rotation and the half after it is the aim. Below that the report was charging idle time to a
	 * player who was already pressing something.
	 */
	default: 1500,
	/**
	 * One Windwalker global, and the number this setting replaces.
	 *
	 * The global the cooldown returned inside was already committed; charging any part of it grades a
	 * press that could not have been made, which is not a threshold anybody should be able to tighten
	 * past. The old reading stays reachable at the floor, exactly as the APL's own number does for the
	 * Tiger Palm window above.
	 */
	min: 1000,
	/**
	 * A quarter of Rising Sun Kick's 8s cooldown, which is the shortest in the audited set — the others
	 * are Chi Wave at 15s, the potion, and Xuen at three minutes.
	 *
	 * The ceiling is a quarter and not a half because each wait is forgiven **in full and separately**,
	 * and there is no limit on how many of them a pull can hold. At 2000ms four late presses are a lost
	 * cast that has stopped being counted; at 4000ms two are, and a player who is consistently a beat
	 * late on every kick — the exact habit the drift row exists to show — would read as flawless.
	 */
	max: 2000,
	/** A quarter of a global, as the Tiger Palm window uses — finer than anyone can actually press. */
	step: 250,
} as const;

// There was a fourth setting here, `maxHealth`, and it is gone rather than defaulted.
//
// It existed so the Touch of Karma section could state a ceiling, on the conclusion that these logs
// carry no health pool. That conclusion still holds for the *health bar* — `maxHitPoints` is 100 on
// every player-describing event, because player health here is a percentage — but the pool was
// never only readable there. Touch of Karma absorbs at most a full health pool, so a use that
// drained its own states the pool exactly; see `karmaCap` in `spec/windwalker`. A setting that asks
// a reader for a number the log already contains is a setting that can only be wrong, so it went.
//
// A blob written by an older build still carries the key. `normaliseSettings` reads named fields
// only, so it is dropped on the next read and never reaches the engine — the behaviour the
// `removedSetting` case in `settings.test` has always pinned.

export interface AnalysisSettings {
	/**
	 * How much of a proc's tail still counts as snapshotting on the last global.
	 *
	 * The rotation wants the brew inside the proc's final global, and a strict reading of that is one
	 * global — 1000ms. But a player on 200ms latency who presses at exactly the right moment is
	 * logged 200ms later than they acted, and someone who deliberately gives themselves a two-second
	 * cushion is playing a considered game rather than a sloppy one. Both were being marked down by a
	 * threshold that described neither.
	 */
	snapshotLeewayMs: number;
	/**
	 * How much Tiger Power may still be running for a Tiger Palm to be read as refreshing it.
	 *
	 * Below it a press is a refresh; above it the press clipped a healthy buff and burned a global
	 * that Jab or Blackout Kick wanted. The APL's number is 1000ms and this defaults wider, for the
	 * same reason the leeway does: a person cannot press on the instant they decide to, and a report
	 * that grades to the sim's frame is grading latency.
	 */
	tigerPalmRefreshMs: number;
	/**
	 * How late a press may land after a cooldown came back before the wait counts against the player.
	 *
	 * A wait shorter than this is dropped whole; a longer one is charged whole, which is the rule
	 * `cooldownDrift` has always applied and this only widens. It was one global, and one global is the
	 * press the player was already committed to when the button returned — so a Rising Sun Kick that
	 * went out 1.1s late put the whole 1.1s on the ledger as a cooldown held, while one 0.9s late put
	 * nothing there at all. The same reasoning as the two above: the sim presses on the tick a cooldown
	 * returns and a person cannot, and a report that grades to the sim's frame is grading latency.
	 */
	cooldownLeewayMs: number;
}

export const DEFAULT_SETTINGS: AnalysisSettings = {
	snapshotLeewayMs: SNAPSHOT_LEEWAY.default,
	tigerPalmRefreshMs: TIGER_PALM_REFRESH.default,
	cooldownLeewayMs: COOLDOWN_LEEWAY.default,
};

/**
 * Forces a value into the allowed range, whatever arrives.
 *
 * Settings come from a text field and from `localStorage`, which is to say from anywhere: a stale
 * key from an older build, a hand-edited value, an empty string. The analysis engine must never be
 * handed a `NaN` window, so this is total rather than a validator that can refuse.
 */
export function clampLeeway(value: unknown): number {
	// Absent is not zero. `Number(null)` and `Number('')` are both `0`, which is finite and would
	// clamp to the minimum — so clearing the field and saving would quietly set 250ms instead of
	// falling back to the default the reader was expecting.
	if (value === null || value === undefined || value === '') return SNAPSHOT_LEEWAY.default;
	const ms = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(ms)) return SNAPSHOT_LEEWAY.default;
	return Math.min(SNAPSHOT_LEEWAY.max, Math.max(SNAPSHOT_LEEWAY.min, Math.round(ms)));
}

/**
 * The same total treatment for the Tiger Palm window, and the same trap.
 *
 * `Number(null)` and `Number('')` are `0`, which is finite and would clamp to `min` — clearing the
 * field would quietly grade every press against a one-second window instead of falling back to the
 * default. Absent means "use the default" here exactly as it does above.
 */
export function clampRefreshWindow(value: unknown): number {
	if (value === null || value === undefined || value === '') return TIGER_PALM_REFRESH.default;
	const ms = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(ms)) return TIGER_PALM_REFRESH.default;
	return Math.min(TIGER_PALM_REFRESH.max, Math.max(TIGER_PALM_REFRESH.min, Math.round(ms)));
}

/**
 * The same total treatment for the cooldown window, and the same trap a third time.
 *
 * `Number(null)` and `Number('')` are `0`, which is finite and clamps to `min` — an emptied field
 * would quietly put the report back on the one-global window this setting exists to widen, without
 * saying so. Absent means "use the default" here as it does above.
 */
export function clampCooldownLeeway(value: unknown): number {
	if (value === null || value === undefined || value === '') return COOLDOWN_LEEWAY.default;
	const ms = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(ms)) return COOLDOWN_LEEWAY.default;
	return Math.min(COOLDOWN_LEEWAY.max, Math.max(COOLDOWN_LEEWAY.min, Math.round(ms)));
}

/**
 * Reads whatever was stored into a settings object that is always safe to use.
 *
 * Named fields only, which is what makes removing a setting safe: a blob still carrying `maxHealth`
 * from an older build loses it here rather than carrying an unread key into the engine.
 */
export function normaliseSettings(raw: unknown): AnalysisSettings {
	if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS;
	const record = raw as Record<string, unknown>;
	return {
		snapshotLeewayMs: clampLeeway(record['snapshotLeewayMs']),
		tigerPalmRefreshMs: clampRefreshWindow(record['tigerPalmRefreshMs']),
		cooldownLeewayMs: clampCooldownLeeway(record['cooldownLeewayMs']),
	};
}

/** True when nothing has been changed from the defaults, so the UI can say "default" rather than repeat it. */
export function isDefault(settings: AnalysisSettings): boolean {
	return (
		settings.snapshotLeewayMs === DEFAULT_SETTINGS.snapshotLeewayMs &&
		settings.tigerPalmRefreshMs === DEFAULT_SETTINGS.tigerPalmRefreshMs &&
		settings.cooldownLeewayMs === DEFAULT_SETTINGS.cooldownLeewayMs
	);
}
