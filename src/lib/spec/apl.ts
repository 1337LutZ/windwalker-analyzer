import type { CastMark, ResourceCurve, Window } from '~/lib/types';

import { inWindow, remainingIn } from '../analysis/auras';

/**
 * The priority list, run against a pull.
 *
 * Every other section of this report measures one thing in isolation — how many brews, how much
 * uptime, how much energy went nowhere. This one asks the question those cannot: **at the moment you
 * spent that global, was there a better button?** It walks the sim's priority list at each press and
 * compares what the list wanted with what was pressed.
 *
 * ## What this deliberately does not model
 *
 * The list transcribed here is the *filler ladder* — the entries from Rising Sun Kick down, which
 * decide what a global is spent on. The entries above it are excluded on purpose, each for its own
 * reason:
 *
 * - **Touch of Death** (priority 3) tests `spellCanCast`, which in 5.4 means the target is under 10%
 *   health. Health is not in the event stream this report fetches, so the condition is undecidable —
 *   and an undecidable rule at the top of a ladder would poison every press below it into "cannot
 *   say". One press a pull, excluded rather than guessed at.
 * - **Chi Brew, Tigereye Brew, Energizing Brew, Xuen** (10, 12, 13, 15, 16) are cooldown decisions,
 *   not filler decisions, and each already has a section that judges it against the same conditions
 *   with far more room than a per-press verdict would give it. Grading them twice would double-count
 *   one mistake.
 * - **The elixir, weapon-swap, potion and trinket groups** model a sim-only optimisation, exactly as
 *   `components/sections/Rotation.tsx` records when it drops them from the reference table.
 *
 * ## What it refuses to answer
 *
 * The ladder below is the **single-target** list. At two or more enemies the sim's own list changes
 * shape — Spinning Crane Kick, Rushing Jade Wind and the 105-energy Blackout Kick branch switch on
 * with `numberTargets` tests — and this report cannot yet count enemies per moment. So a pull that is
 * not concentrated on one target returns `null` rather than a ladder graded against the wrong list.
 * That gate is `debuff.singleTarget`, the same one that already decides whether Rising Sun Kick
 * uptime is a fault or a fight's doing.
 *
 * The same refusal applies press by press. A rule whose condition cannot be read off this log leaves
 * every press below it `unknown` rather than `followed` — silence, not a plausible guess, because a
 * wrong "you misplayed here" costs a reader more than a missing one.
 *
 * ## Measured, and not yet trustworthy — read this before rendering it
 *
 * Run against the three reference pulls this ladder flags roughly **half of every player's globals**,
 * including the strongest: 208 skips in 400 judged presses on `strong`, 121 in 216 on `poor`. A model
 * that says every player misplays every other global is not measuring what it claims, and the section
 * that draws it is registered but commented out in `components/Report.tsx` until this is fixed.
 *
 * The cause is measured, not guessed. **Chi is sampled far too sparsely to judge a press by.** On
 * `strong` the energy bar carries 1724 readings at a median 193ms apart, while chi carries 178 at a
 * median of 2368ms — because generators report only energy in `classResources`, so chi is stamped
 * only onto spenders. `valueAt` therefore hands a rule the chi the player held a median of *two
 * globals ago*. Of the 41 Jabs flagged as "should have been Rushing Jade Wind", 35 read chi as 3 of 4
 * — no room for Jab's two — when the press two seconds later was almost certainly made at 1 or 2.
 *
 * The fix is the one `chiWasted` in `analysis/energy.ts` already makes for the same reason: walk
 * forward from each reading, applying the known gains and costs of the presses in between, and resync
 * whenever a spender reports the bar. Until the ladder reads a reconstructed chi rather than a sampled
 * one, every chi condition in it — affordability, Jab's headroom, the dump's threshold — is being
 * evaluated against a stale number.
 *
 * Energy conditions are unaffected: at 193ms the energy bar is sampled several times per global.
 *
 * ## Where the numbers come from
 *
 * Conditions are transcribed from `ui/monk/windwalker/apls/default.apl.json` in wowsims-mop, and the
 * `// N` comments give the index into that file's `priorityList`, matching the reference table in
 * `Rotation.tsx`. Costs and cooldowns are read from the Go sim rather than from memory:
 * `sim/monk/tiger_palm.go` (1 chi), `ww_rising_sun_kick.go` (2 chi, 8s), `blackout_kick.go` (2 chi),
 * `ww_fists_of_fury.go` (3 chi, 25s), `jab.go` (40 energy).
 */

/** The rules this ladder models, in priority order. */
export type AplRuleKey =
	| 'rising-sun-kick'
	| 'tiger-palm-refresh'
	| 'chi-wave'
	| 'combo-breaker-kick'
	| 'fists-of-fury'
	| 'combo-breaker-palm'
	| 'jab'
	| 'rushing-jade-wind'
	| 'blackout-kick';

/**
 * A condition's answer.
 *
 * Three-valued on purpose. `false` says the list did not want this button; `unknown` says this log
 * cannot tell, which is a different fact and has to travel separately — collapsing the two is how a
 * report starts inventing faults.
 */
type Truth = boolean | 'unknown';

export type AplVerdict =
	/** The list wanted this button, and it was pressed. */
	| 'followed'
	/** A button higher up the list was castable and its condition true, and a lower one was pressed. */
	| 'skipped'
	/** A rule above the press could not be read off this log, so nothing can be said about it. */
	| 'unknown'
	/** Not a rotational button — a cooldown, a defensive, a taunt. Never a fault. */
	| 'off-list';

export interface AplPress {
	/** Fight-relative ms, like every other timestamp in this report. */
	t: number;
	/** The cast id that was pressed. */
	pressed: number;
	/** What the list wanted instead, when the press was a skip. */
	wanted: AplRuleKey | null;
	verdict: AplVerdict;
}

export interface AplAudit {
	presses: AplPress[];
	followed: number;
	skipped: number;
	unknown: number;
	offList: number;
	/**
	 * Skips per rule, so the section can say *which* button kept being passed over.
	 *
	 * Carries the cast id as well as the key, because the section draws the ability's icon beside its
	 * name and the alternative — a second lookup table mapping rule keys back to spells — would be a
	 * copy of the ladder that could disagree with it.
	 */
	skippedBy: Array<{ key: AplRuleKey; id: number; count: number }>;
}

export interface AplInputs {
	/** Every press on the clock. Off-GCD presses are ignored: they cost nothing the ladder competes for. */
	casts: readonly CastMark[];
	energy: ResourceCurve;
	chi: ResourceCurve;
	/** Energy per second, measured off the log rather than assumed — talents and haste both move it. */
	regenPerSec: number;
	/** The player's actual global, measured. Several conditions are written in units of it. */
	gcdMs: number;
	/** Aura windows by the spec's own key, so this module never has to know a spell id for a buff. */
	auras: Readonly<Partial<Record<string, readonly Window[]>>>;
	/** How long a Fists of Fury channel ran, measured. The APL writes this as four ticks plus input delay. */
	fofChannelSec: number;
	/**
	 * False on an add fight. The ladder below is the single-target list, and grading a multi-target
	 * pull against it would mark correct Spinning Crane Kicks as mistakes.
	 */
	singleTarget: boolean;
	/**
	 * Chi knocked off Rising Sun Kick, Blackout Kick and Fists of Fury by the tier-16 four-piece.
	 * Zero when the bonus is not equipped; the sim applies it to those three and not to Tiger Palm.
	 */
	chiCostReduction?: number;
}

/** Cast ids, as the log records them and the cast table keys on them. */
const ID = {
	risingSunKick: 107428,
	tigerPalm: 100787,
	blackoutKick: 100784,
	jab: 100780,
	chiWave: 115098,
	fistsOfFury: 113656,
	rushingJadeWind: 116847,
} as const;

/** Cooldowns, in ms, from the sim's spell configs. */
const COOLDOWN_MS: Partial<Record<AplRuleKey, number>> = {
	'rising-sun-kick': 8000,
	'fists-of-fury': 25_000,
	'chi-wave': 15_000,
};

/**
 * The window in which Tiger Palm is pressed to keep Tiger Power up.
 *
 * The APL tests `auraRemainingTime(125359) <= 1s`. Not a threshold anyone tuned here — it is the
 * list's own number, and changing it would be changing the rotation rather than measuring it.
 */
const TIGER_POWER_REFRESH_MS = 1000;

/**
 * How long into a pull the Combo Breaker Tiger Palm rule starts firing.
 *
 * The APL's `currentTime > 23s`. It exists so the opener is not interrupted to spend a proc, and it
 * is a real part of the condition: applied a second early, this rule flags correct opener presses.
 */
const COMBO_BREAKER_PALM_AFTER_MS = 23_000;

/** The energy the dump branch needs to have banked by the time Rising Sun Kick comes back, at ≤2 targets. */
const DUMP_ENERGY = 35;

interface State {
	t: number;
	chi: number;
	chiMax: number;
	energy: number;
	energyMax: number;
	/** Seconds until the energy bar is full. The unit almost every condition in this list is written in. */
	timeToEnergyCapSec: number;
	gcdSec: number;
	/** Seconds until Rising Sun Kick is castable again; zero when it is ready now. */
	rskReadyInSec: number;
	/** Carried on the state rather than closed over, so a rule reads every number it needs from one place. */
	fofChannelSec: number;
	regenPerSec: number;
}

/**
 * One entry of the ladder.
 *
 * `castable` and `condition` are kept apart because they fail differently: a button off cooldown with
 * a false condition means the list did not want it, while a button the list wanted and the player
 * could not afford is not a decision at all. Both have to be true for a rule to claim a global.
 */
interface Rule {
	key: AplRuleKey;
	/** The cast id a press has to match to count as following this rule. */
	id: number;
	/** Chi the press costs, before the tier reduction. */
	chiCost: number;
	/** Energy the press costs. */
	energyCost: number;
	/**
	 * True when the button sits on a talent row, and is therefore only demanded of a player who has it.
	 *
	 * Taken from the log — a talent the player did not choose is not a mistake, and this report cannot
	 * read a talent tree out of the event stream, so "was it ever pressed" is the only evidence there
	 * is. Deliberately *not* applied to the baseline buttons: inferring those the same way would mean a
	 * player who never pressed Rising Sun Kick at all was never told, which is the single worst thing
	 * this ladder exists to catch.
	 */
	talent?: true;
	/** Free presses: an aura that waives the cost, which changes what "could afford it" means. */
	freeWhen?: (state: State, auras: AuraReader) => boolean;
	condition: (state: State, auras: AuraReader) => Truth;
}

/** Reads aura state at a moment, by the spec's key. An aura the log never carried is simply never up. */
interface AuraReader {
	active: (key: string) => boolean;
	remainingMs: (key: string) => number;
	/** Whether the log carried this aura at all — the difference between "not up" and "cannot say". */
	present: (key: string) => boolean;
}

/**
 * The single-target filler ladder.
 *
 * Ordered exactly as the sim evaluates it. The `// N` comments are indices into the APL's
 * `priorityList`, so a future reader can check any line here against the file it came from.
 */
const LADDER: readonly Rule[] = [
	{
		// 18 — cast on cooldown at one target: the `not(Targets: More than 2)` half of the condition is
		// always true here, so the only gate that matters is affording it.
		key: 'rising-sun-kick',
		id: ID.risingSunKick,
		chiCost: 2,
		energyCost: 0,
		condition: () => true,
	},
	{
		// 19 — the refresh press. Tiger Power is what makes every other button hit harder, so the list
		// spends a global on keeping it up before it spends one on damage.
		key: 'tiger-palm-refresh',
		id: ID.tigerPalm,
		chiCost: 1,
		energyCost: 0,
		freeWhen: (_state, auras) => auras.active('combo-breaker-tiger-palm'),
		condition: (state, auras) => {
			// A log that never carried the buff cannot say when it was about to fall off. Rather than
			// reading "never up" as "always needs refreshing", the rule stands down and says so.
			if (!auras.present('tiger-power')) return 'unknown';
			return auras.remainingMs('tiger-power') <= TIGER_POWER_REFRESH_MS;
		},
	},
	{
		// 23 — only while there is room in the bar for the global it costs.
		key: 'chi-wave',
		id: ID.chiWave,
		chiCost: 0,
		energyCost: 0,
		talent: true,
		condition: (state) => state.timeToEnergyCapSec >= 1,
	},
	{
		// 24 — a free Blackout Kick. No cost, no cooldown, and the proc is short: the list takes it the
		// moment it appears.
		key: 'combo-breaker-kick',
		id: ID.blackoutKick,
		chiCost: 0,
		energyCost: 0,
		condition: (_state, auras) => auras.active('combo-breaker-blackout-kick'),
	},
	{
		// 25 — three conditions, and each protects a different thing. The first keeps the channel from
		// running while the energy bar overflows behind it; the second stops it eating an Energizing
		// Brew, unless Rushing Jade Wind is up to spend that energy anyway; the third holds it for a
		// Re-Origination window that a brew is already snapshotting.
		key: 'fists-of-fury',
		id: ID.fistsOfFury,
		chiCost: 3,
		energyCost: 0,
		condition: (state, auras) => {
			if (state.timeToEnergyCapSec <= state.fofChannelSec) return false;
			const energizing = auras.active('energizing-brew');
			const jadeWind = auras.remainingMs('rushing-jade-wind') >= state.fofChannelSec * 1000;
			if (energizing && !jadeWind) return false;
			if (!auras.active('re-origination')) return true;
			// Under Re-Origination the channel is only worth starting if the trinket's window outlasts it
			// and a brew is live to snapshot what it is worth.
			const roro = auras.remainingMs('re-origination') + state.gcdSec * 1000;
			return roro >= state.fofChannelSec * 1000 && auras.active('tigereye-brew');
		},
	},
	{
		// 27 — the proc press, and the one entry here with a clock on it. Held out of the opener, held
		// under Energizing Brew, and otherwise taken either because the proc is about to expire or
		// because there is room in the bar for it.
		key: 'combo-breaker-palm',
		id: ID.tigerPalm,
		chiCost: 1,
		energyCost: 0,
		freeWhen: () => true,
		condition: (state, auras) => {
			if (state.t <= COMBO_BREAKER_PALM_AFTER_MS) return false;
			if (auras.active('energizing-brew')) return false;
			if (!auras.active('combo-breaker-tiger-palm')) return false;
			const expiring = auras.remainingMs('combo-breaker-tiger-palm') <= state.gcdSec * 1000;
			return expiring || state.timeToEnergyCapSec >= state.gcdSec * 2;
		},
	},
	{
		// 29 — the generator, and the reason it is gated on *room for two chi* rather than on chi being
		// low: Jab returns two, and pressing it with one point of headroom throws one away.
		key: 'jab',
		id: ID.jab,
		chiCost: 0,
		energyCost: 40,
		condition: (state) => state.chiMax - state.chi >= 2,
	},
	{
		// 31 — unconditional in the list. Talent-gated in practice, which `known` handles.
		key: 'rushing-jade-wind',
		id: ID.rushingJadeWind,
		chiCost: 0,
		energyCost: 40,
		talent: true,
		condition: () => true,
	},
	{
		// 32 — the dump. Spend chi on a Blackout Kick only when the energy banked by the time Rising Sun
		// Kick returns still clears the generator's cost, so the dump never starves the next kick.
		key: 'blackout-kick',
		id: ID.blackoutKick,
		chiCost: 2,
		energyCost: 0,
		condition: (state) => state.energy + state.regenPerSec * state.rskReadyInSec >= DUMP_ENERGY,
	},
];

/**
 * The bar's value at a moment.
 *
 * The last reading at or before `t`, never an interpolation. That is not a shortcut: a cast reads its
 * bar *before* paying for itself — the same fact `cappedIntervals` in `analysis/energy.ts` is built
 * on — so the reading carried by a press is exactly the resource the player had when they chose it.
 * Interpolating between two readings would invent a value nobody held and, at a press, would blend in
 * the cost of the press being judged.
 */
function valueAt(curve: ResourceCurve, t: number): number {
	const points = curve.points;
	let lo = 0;
	let hi = points.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const point = points[mid];
		if (point === undefined) break;
		if (point[0] <= t) {
			found = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return points[found]?.[1] ?? 0;
}

/** Aura state frozen at one moment, so a rule cannot accidentally read a different `t` than its neighbours. */
function readerAt(t: number, auras: AplInputs['auras']): AuraReader {
	return {
		// Length, not existence: the engine hands over an empty array for an aura it looked for and did
		// not find, and "looked for, never went up" is a different fact from "never looked".
		present: (key) => (auras[key]?.length ?? 0) > 0,
		active: (key) => {
			const windows = auras[key];
			return windows === undefined ? false : inWindow(t, windows);
		},
		remainingMs: (key) => {
			const windows = auras[key];
			return windows === undefined ? 0 : remainingIn(t, windows);
		},
	};
}

/** The bars and the clock at one press, reconstructed from the curves and the presses that came before. */
function stateAt(t: number, inputs: AplInputs, lastCast: ReadonlyMap<number, number>): State {
	const energy = valueAt(inputs.energy, t);
	const energyMax = inputs.energy.max;
	const lastRsk = lastCast.get(ID.risingSunKick);
	const rskCooldown = COOLDOWN_MS['rising-sun-kick'] ?? 0;
	return {
		t,
		chi: valueAt(inputs.chi, t),
		chiMax: inputs.chi.max,
		energy,
		energyMax,
		// Guarded against a log that reported no regen at all: an infinite time-to-cap would silently
		// satisfy every "there is room in the bar" condition on the ladder.
		timeToEnergyCapSec: inputs.regenPerSec > 0 ? Math.max(0, energyMax - energy) / inputs.regenPerSec : 0,
		gcdSec: inputs.gcdMs / 1000,
		rskReadyInSec: lastRsk === undefined ? 0 : Math.max(0, lastRsk + rskCooldown - t) / 1000,
		fofChannelSec: inputs.fofChannelSec,
		regenPerSec: inputs.regenPerSec,
	};
}

/** Whether a rule's button was off cooldown at this moment. A rule with no cooldown is always ready. */
function ready(rule: Rule, t: number, lastCast: ReadonlyMap<number, number>): boolean {
	const cooldown = COOLDOWN_MS[rule.key];
	if (cooldown === undefined) return true;
	const last = lastCast.get(rule.id);
	return last === undefined || t - last >= cooldown;
}

/** Whether the player could pay for a rule's button, counting the aura that sometimes waives the cost. */
function affordable(rule: Rule, state: State, auras: AuraReader, reduction: number): boolean {
	if (rule.freeWhen?.(state, auras) === true) return true;
	// The tier reduction applies to the three chi spenders the sim applies it to, and never takes a
	// cost below zero.
	const chi = Math.max(0, rule.chiCost - (rule.chiCost > 0 ? reduction : 0));
	return state.chi >= chi && state.energy >= rule.energyCost;
}

/**
 * What the list wanted at this press, and whether the press was it.
 *
 * Walks the ladder from the top and stops at the first rule that both wants the global and can be
 * paid for. The `unknown` short-circuit is the important part: the moment a rule *above* the pressed
 * button cannot be read off this log, the walk stops and says so, because whether the press was a
 * mistake depends on an answer this report does not have.
 */
function judge(
	cast: CastMark,
	state: State,
	auras: AuraReader,
	seen: ReadonlySet<number>,
	reduction: number,
	lastCast: ReadonlyMap<number, number>,
): AplPress {
	for (const rule of LADDER) {
		// A talent row is only demanded of a player the log shows chose it. Baseline buttons carry no
		// such gate, so never pressing one is a fault this ladder can still name.
		if (rule.talent === true && !seen.has(rule.id)) continue;
		if (!ready(rule, state.t, lastCast)) continue;

		const wants = rule.condition(state, auras);
		if (wants === 'unknown') {
			// A rule the press itself satisfies is not worth stopping for: pressing the button the list
			// might have wanted cannot be the mistake the unknown is hiding.
			if (rule.id === cast.id) return { t: state.t, pressed: cast.id, wanted: rule.key, verdict: 'followed' };
			return { t: state.t, pressed: cast.id, wanted: null, verdict: 'unknown' };
		}
		if (!wants) continue;
		if (!affordable(rule, state, auras, reduction)) continue;

		return rule.id === cast.id
			? { t: state.t, pressed: cast.id, wanted: rule.key, verdict: 'followed' }
			: { t: state.t, pressed: cast.id, wanted: rule.key, verdict: 'skipped' };
	}

	// Nothing on the ladder wanted the global. A cooldown, a defensive, a taunt — or a rotational
	// button the player could not afford, which is a resource problem the energy and chi sections
	// already argue about rather than a priority mistake.
	return { t: state.t, pressed: cast.id, wanted: null, verdict: 'off-list' };
}

/**
 * Walk the pull, press by press, and ask the list what it wanted.
 *
 * Returns `null` — not an empty audit — when the pull cannot be judged: an add fight, or a log with
 * no resource readings. Those are different from "no mistakes", and the section has to be able to
 * tell them apart.
 */
export function aplAudit(inputs: AplInputs): AplAudit | null {
	if (!inputs.singleTarget) return null;
	if (inputs.energy.points.length === 0 || inputs.chi.points.length === 0) return null;

	const reduction = inputs.chiCostReduction ?? 0;
	const onGcd = inputs.casts.filter((c) => c.onGcd);
	const seen = new Set(onGcd.map((c) => c.id));

	// When each rule's button was last pressed, walked forward with the casts so a cooldown check is a
	// subtraction rather than a scan.
	const lastCast = new Map<number, number>();

	const presses: AplPress[] = [];
	const skips = new Map<AplRuleKey, number>();

	for (const cast of onGcd) {
		const state = stateAt(cast.t, inputs, lastCast);
		const auras = readerAt(cast.t, inputs.auras);
		const verdict = judge(cast, state, auras, seen, reduction, lastCast);
		presses.push(verdict);
		if (verdict.verdict === 'skipped' && verdict.wanted !== null) {
			skips.set(verdict.wanted, (skips.get(verdict.wanted) ?? 0) + 1);
		}
		lastCast.set(cast.id, cast.t);
	}

	return {
		presses,
		followed: presses.filter((p) => p.verdict === 'followed').length,
		skipped: presses.filter((p) => p.verdict === 'skipped').length,
		unknown: presses.filter((p) => p.verdict === 'unknown').length,
		offList: presses.filter((p) => p.verdict === 'off-list').length,
		skippedBy: [...skips]
			.map(([key, count]) => ({ key, id: LADDER.find((r) => r.key === key)?.id ?? 0, count }))
			.sort((a, b) => b.count - a.count),
	};
}
