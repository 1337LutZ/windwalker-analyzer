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

/**
 * Bounds on a health pool, used only to reject nonsense.
 *
 * Wide on purpose: this is a Mists-era number today, but the field exists because the log cannot
 * supply it, and a range tuned to one patch would start refusing correct values the moment gear
 * changed. Anything inside these is accepted as given.
 */
export const MAX_HEALTH = {
	min: 10_000,
	max: 10_000_000,
	step: 1000,
} as const;

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
	 * The player's maximum health, or null when they have not said.
	 *
	 * Touch of Karma redirects up to a full health pool per use, so this is the only way to say what a
	 * use *could* have returned.
	 *
	 * The conclusion — MoP Classic logs do not carry a player's health pool — still holds, but the
	 * reason previously given here was wrong twice over and is worth correcting rather than deleting.
	 * It claimed the search covered "the resources graph"; in fact `Report.graph(dataType: Resources)`
	 * had been called without its `abilityID` argument, which is `100 + powerType` (103 energy, 112
	 * chi, 1000 health) and returns nothing without one. And nothing had been checked with
	 * `includeResources: true` at all — the flag that turned out to carry the whole energy curve.
	 *
	 * Both were then checked properly. `classResources` carries energy and chi and no health entry,
	 * and `maxHitPoints` is 100 on every player-side event, because player health on these reports is
	 * a percentage and not a pool. So null stays: the report shows what each use returned and claims
	 * no ceiling, which is the honest default.
	 */
	maxHealth: number | null;
}

export const DEFAULT_SETTINGS: AnalysisSettings = {
	snapshotLeewayMs: SNAPSHOT_LEEWAY.default,
	tigerPalmRefreshMs: TIGER_PALM_REFRESH.default,
	maxHealth: null,
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

/** Null for anything that is not a usable health pool, so "unset" and "nonsense" behave alike. */
export function clampHealth(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const hp = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(hp) || hp <= 0) return null;
	return Math.min(MAX_HEALTH.max, Math.max(MAX_HEALTH.min, Math.round(hp)));
}

/** Reads whatever was stored into a settings object that is always safe to use. */
export function normaliseSettings(raw: unknown): AnalysisSettings {
	if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS;
	const record = raw as Record<string, unknown>;
	return {
		snapshotLeewayMs: clampLeeway(record['snapshotLeewayMs']),
		tigerPalmRefreshMs: clampRefreshWindow(record['tigerPalmRefreshMs']),
		maxHealth: clampHealth(record['maxHealth']),
	};
}

/** True when nothing has been changed from the defaults, so the UI can say "default" rather than repeat it. */
export function isDefault(settings: AnalysisSettings): boolean {
	return (
		settings.snapshotLeewayMs === DEFAULT_SETTINGS.snapshotLeewayMs &&
		settings.tigerPalmRefreshMs === DEFAULT_SETTINGS.tigerPalmRefreshMs &&
		settings.maxHealth === DEFAULT_SETTINGS.maxHealth
	);
}
