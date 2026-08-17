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
 * - **The elixir, weapon-swap, potion and trinket groups** are off-GCD item presses, and this walk
 *   only ever sees on-GCD ones — `aplAudit` filters on `onGcd` before `judge` runs. They cost none
 *   of the globals the ladder is arbitrating, so there is nothing here to judge them against.
 *
 *   This bullet used to say they "model a sim-only optimisation", which was wrong twice over.
 *   Elixir weaving is real technique a real player does — 33 presses across 15 pulls in one raid
 *   night, executed to the APL's own conditions — and the sim ships it as a user-flippable toggle
 *   rather than a simulator artefact. It is `hide: true` in the default list, which in wowsims
 *   *gates execution* (`proto/apl.proto`: "Causes this item to be ignored"; `sim/core/apl.go`
 *   never parses a hidden item into the priority list), so the feature ships off by default and
 *   opts in — not the same thing as not existing. `spec/windwalker.ts` already documents why the
 *   weave pays: Tigereye Brew snapshots mastery at cast, so an elixir dropped *after* the brew
 *   lifts a different secondary for the next Rune of Re-Origination proc without diluting the
 *   multiplier already frozen in. This report tells the reader to do it.
 *
 * ## The target count is read per press, not per pull
 *
 * The sim's list is one list that branches on `numberTargets`, at 2 and at 3, plus a raw `>= 4` on
 * entry 20. So the rules here carry `bands` and the walk reads the live count at each press through
 * `targetsAt`.
 *
 * Per press rather than per pull, and that distinction is the whole of it. A Kor'kron Dark Shaman
 * pull opens on four enemies and settles at two; a Galakras pull climbs to five and falls to nothing
 * between waves. Neither *has* a target count, and picking one number for the pull would mark correct
 * presses as faults through every stretch that did not match it.
 *
 * This used to return `null` for any pull that was not concentrated on a single target, on the
 * grounds that the ladder was the single-target list. It cost those pulls their priority section
 * entirely — a Galakras kill got no verdict at all rather than a verdict about the waves.
 *
 * What it still refuses, press by press: a rule whose condition cannot be read off this log leaves
 * every press below it `unknown` rather than `followed` — silence, not a plausible guess, because a
 * wrong "you misplayed here" costs a reader more than a missing one.
 *
 * ## The chi it reads is reconstructed, not sampled — and that is load-bearing
 *
 * WarcraftLogs stamps a chi reading onto a *spender* and onto nothing else. On one reference pull 178
 * of 1049 casts carried one, every one of them a Blackout Kick, Rising Sun Kick, Tiger Palm or Fists
 * of Fury. So the raw chi curve has a median gap of 2.4 seconds against energy's 0.19, and reading it
 * with "last value at or before `t`" hands each rule the chi the player held two globals ago. Run that
 * way this ladder flagged roughly half of every player's presses and could not tell a good pull from a
 * bad one — 208 skips in 400 on the strongest pull, against 121 in 216 on the weakest.
 *
 * It is therefore fed `chiAtCasts` from `analysis/energy.ts`, which walks the log forward applying the
 * known gains and costs between readings and resyncs at every spender. Checked against the readings it
 * did not use, that walk predicts the next one exactly **87–95%** of the time across the three
 * reference pulls, and its errors are symmetric ±1 rather than a systematic drift. With it the ladder
 * separates the sample the right way round: 62% of judged presses followed on `strong`, 49% on
 * `mixed`, 47% on `poor`.
 *
 * The residual matters and the section says so: a press judged on a reconstructed bar that is one chi
 * out can be called a skip it was not, or missed as one it was. That is why nothing here is graded.
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
	| 'rushing-jade-wind-open'
	| 'rising-sun-kick'
	| 'tiger-palm-refresh'
	| 'spinning-crane-kick-heavy'
	| 'rising-sun-kick-filler'
	| 'spinning-crane-kick'
	| 'chi-wave'
	| 'combo-breaker-kick'
	| 'fists-of-fury'
	| 'combo-breaker-palm'
	| 'jab'
	| 'rushing-jade-wind'
	| 'blackout-kick';

/**
 * How many enemies the player was on, as the APL bands it.
 *
 * Four values because the file draws four lines, not because four is a round number: its three named
 * variables split at 2 and 3 (`More than 1`, `More than 2`, `Max 2`), and entry 20 adds a raw
 * `targets >= 4` that those names hide. A three-band model would silently drop the heavy Spinning
 * Crane Kick rule.
 */
export type Band = 1 | 2 | 3 | 4;

/** The band a live target count falls in. Anything past four is still four — the list draws no line above it. */
export function bandOf(targets: number): Band {
	if (targets <= 1) return 1;
	if (targets === 2) return 2;
	if (targets === 3) return 3;
	return 4;
}

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
	/**
	 * How long the whole pull ran.
	 *
	 * The list's `currentTime + remainingTime`, which is not a clock reading despite looking like one:
	 * `GetRemainingDuration` in `sim/core/sim.go` returns `Duration - CurrentTime`, so the two terms
	 * cancel and what is left is the iteration's total length. Entry 31 is the only rule that reads it,
	 * and reads it as a fact about the pull rather than about the press.
	 *
	 * Passed in rather than inferred from the last cast on the ladder's own list. The threshold is 75
	 * seconds, which is close enough to a real pull length that a pull whose final global lands twenty
	 * seconds before the kill would be measured onto the wrong side of it.
	 */
	pullMs: number;
	/** Aura windows by the spec's own key, so this module never has to know a spell id for a buff. */
	auras: Readonly<Partial<Record<string, readonly Window[]>>>;
	/** How long a Fists of Fury channel ran, measured. The APL writes this as four ticks plus input delay. */
	fofChannelSec: number;
	/**
	 * How many enemies the player was engaged with at a moment.
	 *
	 * Read per press, never per pull, because neither of those is the same question. A Dark Shaman pull
	 * opens on four and settles at two; a Galakras pull climbs to five and falls to nothing between
	 * waves. Neither *has* a target count, and grading either against one number would mark correct
	 * presses as faults through every stretch that did not match it. The sim evaluates `numberTargets`
	 * at each action, so this does too.
	 */
	targetsAt: (t: number) => number;
	/**
	 * A reader's override, forcing every press to be judged at one band.
	 *
	 * Absent means "read the log", which is what the report does unless asked otherwise. Present, it
	 * answers the one question the measurement cannot: a player who deliberately ignored the adds was
	 * on one target by choice, and no count taken off the log can know that.
	 */
	forceBand?: Band;
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
	spinningCraneKick: 101546,
} as const;

/**
 * Rushing Jade Wind's cooldown, which is also its dot's duration — the two are the same six seconds
 * and that identity is the whole of why the button behaves as it does.
 *
 * Exported for the same reason `RSK_COOLDOWN_MS` in `spec/windwalker.ts` is: a section prints a
 * ceiling built from it, and a component restating `6000` would be a second copy free to drift from
 * the ladder that judges the same button against it.
 */
export const RJW_COOLDOWN_MS = 6000;

/**
 * What one press costs, from `registerRushingJadeWind` in `sim/monk/talents.go`.
 *
 * Exported alongside the cooldown because the two only mean anything together: 40 energy every six
 * seconds is a *rate*, and it is the rate rather than either number that decides how much of a
 * Windwalker's bar this button can take.
 */
export const RJW_ENERGY_COST = 40;

/**
 * What the two kicks cost in chi, from `sim/monk/ww_rising_sun_kick.go` and `sim/monk/blackout_kick.go`.
 *
 * The same number twice, and that identity is the point rather than a coincidence: one Blackout Kick
 * is exactly one Rising Sun Kick's worth of chi, which is why the dump can starve the kick at all and
 * why a single held press always covers the shortfall. Exported because the Blackout Kick section
 * measures one starving the other, and a section restating `2` would be a copy free to drift from the
 * ladder that spends every press judging against it.
 */
export const CHI_COST = { risingSunKick: 2, blackoutKick: 2 } as const;

/** Cooldowns, in ms, from the sim's spell configs. */
const COOLDOWN_MS: Partial<Record<AplRuleKey, number>> = {
	'rising-sun-kick': 8000,
	// The same button and the same cooldown, listed twice because the APL lists it twice. Keyed by rule
	// rather than by id, so both entries have to carry it or the lower one reads as always ready.
	'rising-sun-kick-filler': 8000,
	'fists-of-fury': 25_000,
	'chi-wave': 15_000,
	/**
	 * Six seconds, from `sim/monk/talents.go`, and load-bearing rather than housekeeping.
	 *
	 * The APL's entry 17 is a bare `Targets: More than 1` with no "not already running" clause, because
	 * the sim does not need one: the spell's own cooldown is its duration, and it re-arms the cooldown to
	 * whatever is left on the dot. Modelled without it, the list appears to demand Rushing Jade Wind on
	 * every global from the second target onwards — which on the Galakras pull invented 95 skips out of
	 * 148, all of them for a button that was already spinning.
	 */
	'rushing-jade-wind-open': RJW_COOLDOWN_MS,
	'rushing-jade-wind': RJW_COOLDOWN_MS,
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

/**
 * The energy the dump branch needs banked by the time Rising Sun Kick comes back.
 *
 * Two numbers, and the gap between them is the whole point: at three or more targets the list wants
 * the bar nearly full before it spends chi on a Blackout Kick, because that chi is worth more through
 * Spinning Crane Kick. Grading an add fight against the 35 would call a correct hold a skipped dump.
 */
const DUMP_ENERGY = { few: 35, many: 105 } as const;

/** Debuff a heavy Spinning Crane Kick needs left on the target, from APL 20. */
const SCK_DEBUFF_MS = 2250;

/**
 * The pull length under which the list still wants Rushing Jade Wind from the bottom rung.
 *
 * APL 31's `(currentTime + remainingTime) < 75s`. Both terms are the sim's and they cancel to the
 * whole fight's length, so this is a switch thrown once per pull rather than a condition that comes
 * and goes: under 75 seconds the rung is effectively unconditional, over it the rung is left with
 * nothing but its energy-cap clause for every global of the pull.
 */
const SHORT_PULL_MS = 75_000;

interface State {
	t: number;
	chi: number;
	chiMax: number;
	energy: number;
	energyMax: number;
	/** Seconds until the energy bar is full. The unit almost every condition in this list is written in. */
	timeToEnergyCapSec: number;
	/** How long the whole pull ran. The same number at every press — entry 31's short-fight clause reads it. */
	pullMs: number;
	gcdSec: number;
	/** Seconds until Rising Sun Kick is castable again; zero when it is ready now. */
	rskReadyInSec: number;
	/** Carried on the state rather than closed over, so a rule reads every number it needs from one place. */
	fofChannelSec: number;
	regenPerSec: number;
	/** Enemies engaged at this press, banded as the list bands them. */
	band: Band;
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
	/**
	 * The bands this entry exists in. Omitted means every band, which is what most of the list wants.
	 *
	 * A band gate is not the same as a false condition and is kept separate from one: an entry outside
	 * its band is not *in* the list at this press, so it can never be the thing a press skipped. Writing
	 * these as conditions instead would leave `wanted` pointing at a button the list was not offering.
	 */
	bands?: readonly Band[];
	/**
	 * A button that removes this one from the character's bars entirely.
	 *
	 * Not a priority relationship — an existence one. `registerSpinningCraneKick` in the sim opens with
	 * `if monk.Talents.RushingJadeWind && monk.Level >= 90 { return }`, so a monk who took Rushing Jade
	 * Wind has no Spinning Crane Kick at all. Without this the ladder would hand an add fight a column
	 * of skips for a button that was never on the bar, which is the worst kind of wrong: confident,
	 * specific, and impossible to act on.
	 */
	replacedBy?: number;
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
		// 17 — above Rising Sun Kick the moment there is a second target, and this is the single biggest
		// change the target count makes to the list. At one target the entry does not exist at all.
		key: 'rushing-jade-wind-open',
		id: ID.rushingJadeWind,
		chiCost: 0,
		energyCost: RJW_ENERGY_COST,
		talent: true,
		bands: [2, 3, 4],
		condition: () => true,
	},
	{
		// 18 — `targets >= 2 and (auraRemainingTime(RSK debuff) <= GCD or not(Targets: More than 2))`.
		//
		// The target gate is the load-bearing half at low counts, because it removes the rung rather than
		// falsifying it: at one target this entry does not exist, and Rising Sun Kick is claimed instead
		// by entry 21 below — which sits *under* Tiger Palm's refresh and the heavy Spinning Crane Kick.
		// A single-target pull therefore spends its kick two rungs lower than it used to, and a global
		// that once read as a skipped kick now reads as a followed refresh.
		//
		// At exactly two targets the second half is true (`not(targets >= 3)`) and the kick goes on
		// cooldown; at three and up the list only wants this global to hold the debuff, and the
		// unconditional kick further down catches the rest.
		key: 'rising-sun-kick',
		id: ID.risingSunKick,
		chiCost: CHI_COST.risingSunKick,
		energyCost: 0,
		bands: [2, 3, 4],
		condition: (state, auras) => {
			if (state.band <= 2) return true;
			// Rising Sun Kick's own debuff, not Tiger Power. The APL reads
			// `auraRemainingTime(CurrentTarget, 130320)` here, and 130320 is the kick's debuff
			// (`ww_rising_sun_kick.go`); Tiger Power is 125359 and belongs to entry 19 below. Above two
			// targets the list only wants this global to keep the debuff alive, so reading the wrong aura
			// made the rule fire on an unrelated clock.
			if (!auras.present('rising-sun-kick-debuff')) return 'unknown';
			return auras.remainingMs('rising-sun-kick-debuff') <= state.gcdSec * 1000;
		},
	},
	{
		// 19 — the refresh press. Tiger Power is what makes every other button hit harder, so the list
		// spends a global on keeping it up before it spends one on damage.
		key: 'tiger-palm-refresh',
		id: ID.tigerPalm,
		chiCost: 1,
		energyCost: 0,
		freeWhen: (_state, auras) => auras.active('combo-breaker-tiger-palm'),
		// Underscored for the same reason as `freeWhen` above it: this rule reads the aura clock and
		// nothing off the bars, and `Rule.condition` hands both to every entry whether it wants them or
		// not. Kept in the signature rather than dropped so the shape stays uniform across the ladder.
		condition: (_state, auras) => {
			// A log that never carried the buff cannot say when it was about to fall off. Rather than
			// reading "never up" as "always needs refreshing", the rule stands down and says so.
			if (!auras.present('tiger-power')) return 'unknown';
			return auras.remainingMs('tiger-power') <= TIGER_POWER_REFRESH_MS;
		},
	},
	{
		// 20 — `targets >= 4 and auraRemainingTime(TigerPower) >= 2.25s`. A raw count rather than one of
		// the three named variables, which is why this ladder bands at four and not at three: read
		// through the variables alone this rule is invisible.
		key: 'spinning-crane-kick-heavy',
		id: ID.spinningCraneKick,
		replacedBy: ID.rushingJadeWind,
		chiCost: 0,
		energyCost: 40,
		bands: [4],
		condition: (_state, auras) => {
			// Also the kick's debuff, for the same reason as entry 18 — and the direction of the error
			// matters here. The windows are merged across every enemy, so above one target they answer
			// "up on something" rather than "up on the one you are hitting", which is optimistic. For
			// entry 18 that is the safe direction (it under-demands the kick and cannot invent a skip);
			// here it is not, so this rule stands down instead of guessing when the log cannot answer.
			if (!auras.present('rising-sun-kick-debuff')) return 'unknown';
			return auras.remainingMs('rising-sun-kick-debuff') >= SCK_DEBUFF_MS;
		},
	},
	{
		// 21 — the unconditional kick. No target gate of its own, so with entry 18 above now demanding a
		// second target this is the *only* rung Rising Sun Kick has at one; from three up it is what puts
		// the kick back on cooldown once the list has spent the higher globals on the adds.
		//
		// The one missing band is 2, and it says out loud what "unreachable" means rather than changing
		// anything: at exactly two targets entry 18 is the same button at the same cost with the same
		// cooldown and a condition that is unconditionally true, so the only ways past it are `!ready`
		// and `!affordable` — both of which this entry fails identically. Declared rather than left
		// implicit because the reference table renders off these bands, and a rung that can never fire is
		// a rung that should not be drawn: without this, a two-target reader is shown Rising Sun Kick
		// twice.
		key: 'rising-sun-kick-filler',
		id: ID.risingSunKick,
		chiCost: CHI_COST.risingSunKick,
		energyCost: 0,
		bands: [1, 3, 4],
		condition: () => true,
	},
	{
		// 22 — the three-target filler, and the button this whole exercise exists to stop calling a
		// mistake.
		key: 'spinning-crane-kick',
		id: ID.spinningCraneKick,
		replacedBy: ID.rushingJadeWind,
		chiCost: 0,
		energyCost: 40,
		bands: [3, 4],
		condition: () => true,
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
		// 31 — `(currentTime + remainingTime) < 75s or energyTimeToCap <= 1s`, and it is a gate now rather
		// than the unconditional press it used to be. The first half is a fact about the pull, not the
		// press: the two terms sum to the whole fight's length, so on anything longer than 75 seconds it
		// is false from the first global to the last and this rung is left with the energy clause alone.
		//
		// Which is what the rung is for down here. Entry 17 has already put the wind out at two targets
		// and above; by the time the walk reaches the bottom of the ladder the only reason left to spend
		// a global on it is a bar about to overflow anyway. Talent-gated in practice, which `known`
		// handles.
		key: 'rushing-jade-wind',
		id: ID.rushingJadeWind,
		chiCost: 0,
		energyCost: RJW_ENERGY_COST,
		talent: true,
		condition: (state) => state.pullMs < SHORT_PULL_MS || state.timeToEnergyCapSec <= 1,
	},
	{
		// 32 — the dump. Spend chi on a Blackout Kick only when the energy banked by the time Rising Sun
		// Kick returns still clears the generator's cost, so the dump never starves the next kick. The
		// bar it has to clear is three times higher above two targets, because that chi is worth more
		// through Spinning Crane Kick than through a single-target dump.
		key: 'blackout-kick',
		id: ID.blackoutKick,
		chiCost: CHI_COST.blackoutKick,
		energyCost: 0,
		condition: (state) => {
			const banked = state.energy + state.regenPerSec * state.rskReadyInSec;
			return banked >= (state.band <= 2 ? DUMP_ENERGY.few : DUMP_ENERGY.many);
		},
	},
];

/** Every band, for an entry that did not name one. */
const ALL_BANDS: readonly Band[] = [1, 2, 3, 4];

/**
 * One rung of the ladder with its conditions taken off: what a *reference* needs and nothing more.
 *
 * The report renders the priority list twice — once as a verdict on this pull, once as the list
 * itself — and the second of those used to be a hand-maintained copy of this file with `// N`
 * comments pointing back at it. Two lists drift; this one has, in both directions. So the rungs are
 * published from here instead, and a rule added, renamed, reordered or re-banded in `LADDER` moves
 * the reference in the same commit or fails to compile.
 *
 * A projection rather than `LADDER` itself, because a `Rule` carries closures. A view that could
 * reach `condition` would sooner or later call it, and it would have to invent a `State` to do so —
 * a second, fictional pull sitting inside a reference table.
 */
export interface LadderEntry {
	key: AplRuleKey;
	id: number;
	/** Resolved rather than optional: an entry that named no bands exists in all four, so say all four. */
	bands: readonly Band[];
	talent: boolean;
	/** The button that removes this one from the bars, when one does. */
	replacedBy?: number;
}

/** The ladder as a reference reads it, in the order the sim evaluates it. */
export const LADDER_ENTRIES: readonly LadderEntry[] = LADDER.map((rule) => ({
	key: rule.key,
	id: rule.id,
	bands: rule.bands ?? ALL_BANDS,
	talent: rule.talent === true,
	...(rule.replacedBy === undefined ? {} : { replacedBy: rule.replacedBy }),
}));

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
		pullMs: inputs.pullMs,
		gcdSec: inputs.gcdMs / 1000,
		rskReadyInSec: lastRsk === undefined ? 0 : Math.max(0, lastRsk + rskCooldown - t) / 1000,
		fofChannelSec: inputs.fofChannelSec,
		regenPerSec: inputs.regenPerSec,
		// The reader's override wins outright when there is one: it answers a question the log cannot,
		// namely that ignoring the adds was a decision rather than an oversight.
		band: inputs.forceBand ?? bandOf(inputs.targetsAt(t)),
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
		// Not in the list at this target count, so it is not a button the press passed over. Checked
		// before the talent gate and before the cooldown, because an entry outside its band is absent
		// rather than unavailable.
		if (rule.bands !== undefined && !rule.bands.includes(state.band)) continue;
		// Replaced on the character's bars, so it is not a button that could have been pressed.
		if (rule.replacedBy !== undefined && seen.has(rule.replacedBy)) continue;
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
 * Returns `null` — not an empty audit — only when the log carried no resource readings to walk. An
 * add fight used to return `null` here too, on the grounds that the ladder was the single-target
 * list; it is not any more. The list bands on target count and this walk reads the band at each
 * press, so a wave fight is judged against what the list actually wanted during the waves.
 */
export function aplAudit(inputs: AplInputs): AplAudit | null {
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
