import { type AplRule, ladderEntries } from '~/lib/spec/apl';

/**
 * The Windwalker priority list, declared for the audit engine.
 *
 * The engine (`lib/spec/apl.ts`) walks whatever ladder it is handed; this file is that list — the
 * rules, the buttons they mean, the constants the conditions are cut from — plus everything about
 * the transcription that a future reader needs to check it.
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
 * - **The elixir, weapon-swap, potion and trinket groups** are off-GCD item presses, and the audit
 *   only ever sees on-GCD ones — it filters on `onGcd` before judging. They cost none of the globals
 *   the ladder is arbitrating, so there is nothing here to judge them against.
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
export type WW_AplRuleKey =
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

/** The concrete conditions that can make Rushing Jade Wind the selected rule. */
export type AplRuleReason = 'multi-target' | 'short-pull' | 'energy-cap' | 'haste-window';

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

/**
 * One entry of the Windwalker ladder, keyed by this list's own rule names.
 *
 * The engine's `AplRule` is the shape; this narrows the key so the reference table's exhaustive
 * records cannot fall out of step with the list.
 */
type WW_AplRule = AplRule & { key: WW_AplRuleKey };

/**
 * The single-target filler ladder.
 *
 * Ordered exactly as the sim evaluates it. The `// N` comments are indices into the APL's
 * `priorityList`, so a future reader can check any line here against the file it came from.
 */
const LADDER: readonly WW_AplRule[] = [
	{
		// 17 — above Rising Sun Kick the moment there is a second target, and this is the single biggest
		// change the target count makes to the list. At one target the entry does not exist at all.
		key: 'rushing-jade-wind-open',
		id: ID.rushingJadeWind,
		chiCost: 0,
		energyCost: RJW_ENERGY_COST,
		talent: true,
		bands: [2, 3, 4],
		// Six seconds, from `sim/monk/talents.go`, and load-bearing rather than housekeeping.
		//
		// The APL's entry 17 is a bare `Targets: More than 1` with no "not already running" clause, because
		// the sim does not need one: the spell's own cooldown is its duration, and it re-arms the cooldown to
		// whatever is left on the dot. Modelled without it, the list appears to demand Rushing Jade Wind on
		// every global from the second target onwards — which on the Galakras pull invented 95 skips out of
		// 148, all of them for a button that was already spinning.
		cooldownMs: 6000,
		reason: () => 'multi-target',
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
		cooldownMs: 8000,
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
		cooldownMs: 8000,
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
		cooldownMs: 15_000,
		condition: (state) => (state.timeToEnergyCapSec === null ? 'unknown' : state.timeToEnergyCapSec >= 1),
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
		cooldownMs: 25_000,
		condition: (state, auras) => {
			if (state.timeToEnergyCapSec === null) return 'unknown';
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
			// The expiring half is answerable off the aura clock alone, so it is asked first: a proc about
			// to fall off is wanted whatever the bar says, and only the other half needs a reading.
			const expiring = auras.remainingMs('combo-breaker-tiger-palm') <= state.gcdSec * 1000;
			if (expiring) return true;
			if (state.timeToEnergyCapSec === null) return 'unknown';
			return state.timeToEnergyCapSec >= state.gcdSec * 2;
		},
	},
	{
		// 29 — the generator, and the reason it is gated on *room for two chi* rather than on chi being
		// low: Jab returns two, and pressing it with one point of headroom throws one away.
		key: 'jab',
		id: ID.jab,
		chiCost: 0,
		energyCost: 40,
		condition: (state) => (state.chi === null ? 'unknown' : state.chiMax - state.chi >= 2),
	},
	{
		// 31 — `(currentTime + remainingTime) < 75s or energyTimeToCap <= 1s or (Bloodlust active and
		// Energizing Brew active)`. The short-pull half is a fact about the pull, not the press: the two
		// terms sum to the whole fight's length, so on anything longer than 75 seconds it is false from the
		// first global to the last.
		//
		// Entry 17 has already put the wind out at two targets and above; the bottom rung additionally
		// spends it on overflow, short pulls and the haste window. Talent-gated in practice, which `known`
		// handles.
		key: 'rushing-jade-wind',
		id: ID.rushingJadeWind,
		chiCost: 0,
		energyCost: RJW_ENERGY_COST,
		talent: true,
		// The same six-second self-lock as entry 17, for the same reason.
		cooldownMs: 6000,
		reason: (state) => {
			if (state.pullMs < SHORT_PULL_MS) return 'short-pull';
			return state.timeToEnergyCapSec !== null && state.timeToEnergyCapSec <= 1 ? 'energy-cap' : 'haste-window';
		},
		// The two clauses a log can answer without a bar are asked first, so an unread bar only silences
		// the rung on the presses where the overflow clause was the deciding one.
		condition: (state, auras) => {
			if (state.pullMs < SHORT_PULL_MS) return true;
			if (auras.active('bloodlust') && auras.active('energizing-brew')) return true;
			if (state.timeToEnergyCapSec === null) return 'unknown';
			return state.timeToEnergyCapSec <= 1;
		},
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
		condition: (state, _auras, cooldowns) => {
			if (state.energy === null) return 'unknown';
			const banked = state.energy + state.regenPerSec * cooldowns.readyInSec(ID.risingSunKick);
			return banked >= (state.band <= 2 ? DUMP_ENERGY.few : DUMP_ENERGY.many);
		},
	},
];

/**
 * The ladder as a reference reads it, with its conditions taken off.
 *
 * The report renders the priority list twice — once as a verdict on this pull, once as the list
 * itself — and the second of those used to be a hand-maintained copy of this file with `// N`
 * comments pointing back at it. Two lists drift; this one has, in both directions. So the rungs are
 * published from here instead, and a rule added, renamed, reordered or re-banded in `LADDER` moves
 * the reference in the same commit or fails to compile.
 *
 * A projection rather than `LADDER` itself, because a rule carries closures. A view that could reach
 * `condition` would sooner or later call it, and it would have to invent a `State` to do so — a
 * second, fictional pull sitting inside a reference table.
 */
export const LADDER_ENTRIES = ladderEntries(LADDER);

export { LADDER };
