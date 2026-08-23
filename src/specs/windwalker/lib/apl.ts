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
 * - **Touch of Death** (priority 3) is the one entry here that is a gap *in* the ladder rather than a
 *   button off it, and the reason it has no rung is not the one this bullet used to give.
 *
 *   It used to say the condition is "the target is under 10% health", that health is not in the event
 *   stream, and that the rule is therefore undecidable. That was wrong twice. **Target health is not
 *   what the sim tests.** Priority 3's condition is `spellCanCast(115080)`, and what that resolves to is
 *   `ExtraCastCondition` in `sim/monk/touch_of_death.go:40-42`:
 *
 *       (hasGlyph || monk.GetChi() >= 3) && sim.GetRemainingDuration() <= time.Second*1
 *
 *   Chi, and how much of the pull is left. Both are already in this ladder's vocabulary: chi is on
 *   `State` and is the bar every spender below is judged against, and the remaining duration is
 *   `state.pullMs - state.t`, from the same `pullMs` the short-pull rung at the bottom of this file
 *   already reads. There is no missing reader and no undecidable term. **The rung is arithmetically
 *   expressible today**, and a reader who checks only whether the condition can be written will
 *   conclude it should be written.
 *
 *   What stops it is what `GetRemainingDuration` *means*. A wowsims boss has no health pool at all, so
 *   the sim cannot ask "is the target executable" and asks "is the iteration nearly over" instead. The
 *   two coincide on a kill — on all six captured pulls the final global lands 185ms to 699ms before the
 *   end — and they have nothing to do with each other on a **wipe**, where `pullMs` is the instant the
 *   raid died and the boss was nowhere near execute range. A rung reading `pullMs - t <= 1s` would
 *   therefore tell every wiping raid to press a button that was not castable, once per pull, whenever
 *   chi was 3 or more at the final global — a systematic false fault on a whole class of pull, traded
 *   for a false fault on a press that is nearly never made. The report's own standard is that a wrong
 *   "you misplayed here" costs a reader more than a missing one, so the trade is the wrong way round.
 *
 *   **The missing predicate is whether the pull was a kill, and that is the whole of what is missing.**
 *   `fight.kill` is fetched (`wcl/reportFights.graphql`) and carried onto the analysis
 *   (`analysis/analyseCore.ts:1357`), and nothing gates the report on it — wipes are analysed. It is
 *   simply not on `AplInputs`, so a rung cannot see it. Put it there and this rung becomes writable.
 *
 *   Measured before deciding, so the next reader does not re-open this blind. Touch of Death is pressed
 *   **zero times across all six captured pulls** — `115080` does not appear anywhere in any of the six
 *   fixture files, nor in the raw `dataset-ironJuggernaut.json` — so the rung would remove no false
 *   fault at all on the reference sample. What it would add is measurable: it claims the final global of
 *   `cleave` (Rushing Jade Wind at 208130 with 3 chi and 241ms left, today `followed`) and re-points the
 *   final global of `weave`, and changes nothing on `poor`, `strong` or `waves`, all three of which end
 *   on 2 chi — below the 3 the press costs, so the walk steps over the rung without charging anything.
 *   One new fault and one re-point in 1351 presses, against zero removed.
 *
 *   Two residuals worth recording, because both look like the blocker and neither is. The *game's*
 *   condition — target current health below the monk's own maximum health — really is unreadable here:
 *   0 of the 3181 events in `dataset-ironJuggernaut.json` carry `hitPoints` or `maxHitPoints`, because
 *   `includeResources: true` puts `classResources` on the player's own events and says nothing about the
 *   enemy, and an enemy-side reading would need a query `wcl/fightEvents.graphql` does not make. That is
 *   true and it is beside the point: it is not the predicate a faithful transcription would read. And
 *   Glyph of Touch of Death waives the chi entirely while adding two minutes to the 90-second cooldown
 *   (`touch_of_death.go:11,14`), which the log cannot report either way — so even a kill-gated rung
 *   would have to assume the unglyphed cost and clock.
 *
 *   So it stays charged, and `specs/windwalker/lib/__tests__/unarbitrated.test.ts` presses it 500ms
 *   before the end of its synthetic pull, on 3 chi and a full bar — the exact state the sim's condition
 *   asks for — and pins the verdict the ladder gives it today.
 * - **Chi Brew, Tigereye Brew, Energizing Brew, Xuen** (10, 12, 13, 15, 16) are cooldown decisions,
 *   not filler decisions, and each already has a section that judges it against the same conditions
 *   with far more room than a per-press verdict would give it. Grading them twice would double-count
 *   one mistake.
 * - **Storm, Earth and Fire** and **Touch of Karma** are the same call, and they are named here
 *   because they used to fall under the bullet above's *category* without appearing in its list —
 *   which is a citation the next reader cannot check. `lib/analysis/__tests__/ladderCoverage.test.ts`
 *   sweeps every on-GCD button for a rung and points at these lines, so both have to actually be here.
 *
 *   **These two are the only exclusions in this doc that the walk itself can see**, and they are
 *   therefore the only two declared in `UNARBITRATED` below. Prose excludes a button from this file; it
 *   does not exclude it from the walk, which sees a cast id and charges every on-GCD press to some rung.
 *   The rest of this doc's exclusions are off-GCD, where the audit never offers a verdict at all, so
 *   prose was enough for them. Touch of Death above is the exception and stays a fault on purpose: it is
 *   *on* the list, so what it wants is a rung, and `off-list` would say the opposite of that.
 *
 * - **Expel Harm, Flying Serpent Kick and Leg Sweep** are on the GCD, are pressed on real pulls, and
 *   appear nowhere in the sim's Windwalker list — no priority entry and no group. So there is no rule
 *   here to transcribe, and nothing else in this report judges them either: no section, no clock. Their
 *   presses stay charged to the rung the list would have spent that global on, which is the sim's own
 *   answer to what the global should have been. `ladderCoverage.test.ts` carries the argument.
 *
 *   Storm, Earth and Fire is priority 4 in the sim's list (the `SEF: Use` group), and its condition
 *   there is a target count — `numberTargets == 2`, or `Targets: More than 2`, plus a spirit-stack
 *   check. That much *is* a band and a rung could hold it. What a rung could not hold is the sharper
 *   question `analysis.sef` asks: `SEF_SECOND_TARGET_MS` tests whether the second target lived long
 *   enough to repay the spirit, and no band expresses a duration. So a rung here would restate the
 *   easy half of the question and lose the half that decides the answer.
 *
 *   Touch of Karma is a stronger case still: **`122470` appears nowhere in the sim's Windwalker list
 *   at all**, not in the priority list and not in any group. It is a mitigation press, and
 *   `analysis.karma` scores it on what it reflected and absorbed against the cap the log reveals — a
 *   press is right or wrong by the damage that was incoming, which is not a rotational condition and
 *   not a thing a filler rung can read.
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
	// Not rungs and never will be — the two on-GCD buttons `UNARBITRATED` below declares off this ladder.
	// Here rather than as literals down there for the reason this map exists: one place in this module
	// knows a cast id.
	stormEarthAndFire: 137639,
	touchOfKarma: 122470,
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

/**
 * The on-GCD buttons this ladder does not arbitrate, each naming the section that judges the press.
 *
 * Two of the six exclusions argued in this module's doc above, and only two — which is the whole of what
 * this declaration decides. Six on-GCD buttons this spec models have no rung; before this existed every
 * press of all six was walked down the list like any other and charged to whichever rung the target band
 * left standing. Measured on the six committed pulls, that is 20 presses on `waves`, 11 on `cleave`, 9 on
 * `mixed`, 5 on `strong`, 4 on `poor` and 1 on `weave`. **Declaring all six would fix the arithmetic and
 * lose the argument**: `off-list` means the list has no opinion, and a button nothing else has an opinion
 * about either is a button this report would then be silent on. So the test each one had to pass is not
 * "would a rung be unfair" — it would be, for all six — but "is there a second verdict to point at".
 *
 * **Two pass.** Both name a section this report really has, both are per-press verdicts, and both travel
 * out on the press as `AplPress.reason` so a reader following the pointer arrives somewhere:
 *
 *  - **Storm, Earth and Fire** — `components/sections/StormEarthAndFire.tsx`, section id `sef`. It is
 *    priority 4 of the sim's own list and a band could hold its target count, so this is the one entry
 *    here that a rung could half-express; what a rung could not hold is `SEF_SECOND_TARGET_MS`, which
 *    asks whether the second target lived long enough to repay the spirit. No band expresses a duration.
 *    The section renders whenever a spirit went out, so a press always has the verdict this points at.
 *  - **Touch of Karma** — `components/sections/TouchOfKarma.tsx`, section id `karma`. `122470` appears
 *    nowhere in the sim's Windwalker list, in the priority list or in any group, so there is no rule to
 *    transcribe at all — and the section that judges it does not merely report on it, it *grades* it, on
 *    `karmaEmpty` and `karmaCapShare`. Of the six this is the press with the least to lose by leaving
 *    this ladder and the most waiting for it elsewhere.
 *
 * **Four stay faults, and that is deliberate rather than unfinished.**
 * `analysis/__tests__/ladderCoverage.test.ts` carries each argument on its ledger; in one line each:
 * Touch of Death is *on* the sim list and wants a rung it cannot have (its condition is the target's
 * health, which this event stream does not carry), so `off-list` would be the wrong shape of answer as
 * well as an amnesty; and Expel Harm, Flying Serpent Kick and Leg Sweep are off the sim list entirely
 * with no section and no clock anywhere in this report — the Magma Totem case in the Elemental ladder.
 * Charging those globals to the rung the list would have spent them on is the sim's own answer to what
 * the global should have been, and it is a better answer than silence.
 *
 * **This ladder can already reach `off-list` without any of this, which makes the column harder to read
 * rather than easier.** Its rungs are written in units of energy and chi, so a rung it cannot pay for
 * declines and the walk falls off the bottom — Blackout Kicks, Tiger Palms and kicks off an empty bar.
 * That arm returns `reason: null`; this one returns a section name, and the two are the same column and
 * different facts. `cleave` shows both at once, 6 delegated presses against 7 fall-throughs on one pull.
 *
 * So the six committed pulls read, `followed`/`skipped`/`unknown`/`offList`, with `offList` split
 * delegated + fall-through:
 *
 *   waves   126 · 92 · 0 · 29 (16+13)    strong  252 · 143 · 0 · 14 (2+12)
 *   cleave   73 · 72 · 3 · 13 ( 6+ 7)    poor    101 · 110 · 2 ·  4 (3+ 1)
 *   mixed    95 · 95 · 1 ·  9 ( 3+ 6)    weave    77 ·  38 · 1 ·  1 (1+ 0)
 *
 * All 19 Storm, Earth and Fire presses (15 on `waves`, 4 on `cleave`) and all 12 Touch of Karma presses
 * (on all six, which makes Karma the delegation a reader is most likely to meet) are `off-list` carrying
 * a section name; no press of the other four charged buttons is.
 *
 * **Those figures are asserted in `__tests__/aplLedger.test.ts` and are not owned here**, because the
 * paragraph they replaced was a prediction and it was wrong. It was written while the captures still
 * predated the declaration, as a before→after diff worked out by hand, and it closed "`followed` is
 * untouched on all six". `ba04cbe` re-captured the six and made it checkable: it lands on four pulls and
 * misses `mixed` (predicted 97 skipped / 12 off-list, actual 95 / 9) and `strong` (predicted 148 skipped,
 * actual 143) — and on exactly those two, `followed` moves by +5.
 *
 * **The declaration is not what moved it, and neither is the `resources` restructure that shipped
 * alongside it** — the explanation this figure was last given, and the third wrong one it has had. That
 * restructure reshaped `resources.chi` and `resources.energy` (`points` → `curve.points`) and moved no
 * bar at all: the sampled curves are byte-identical across `ba04cbe` on both pulls, 92 and 178 chi points
 * and 803 and 1724 energy points, the same values. Nothing became affordable that was not affordable
 * before.
 *
 * What moved is the **band**. The same commit re-pointed `AplInputs.targetsAt` at `targets.aplCounts` —
 * the ladder's own live count, fed as `aplTargetCountAt` in `lib/index.ts` — instead of the display
 * counts the target-count section draws, and on those two pulls the two disagree hard: `mixed`'s count
 * collapses from a max of 4 to band 1 for the whole pull, and `strong`'s stretches that read 2 to 4 now
 * read 1. Band 1 *deletes* the banded rungs (`rushing-jade-wind-open`, `rising-sun-kick`, and both
 * Spinning Crane Kicks), so globals that were faulted against a rung an over-count had invented now land
 * on the rung the player actually pressed: 3 Jabs and 2 Blackout Kicks turn `followed` on `mixed`, and on
 * `strong` 3 Jabs, 2 Chi Waves and 2 Rising Sun Kicks do, against one Rising Sun Kick and one Rushing
 * Jade Wind lost.
 *
 * Measured across all six rather than argued from those two: **of the 25 presses whose verdict or wanted
 * rung moved and are not one of the two declared buttons, all 25 are presses whose band changed, and none
 * is a press whose band did not.** So the declaration's own reach is what it always was — a rule read
 * before the first rung can only take presses of the buttons it names — and it is
 * `__tests__/unarbitrated.test.ts`, running `analyse` end to end on a synthetic pull, that fails when it
 * stops being wired. These captures are frozen `Analysis` output and no engine change can move them.
 */
export const UNARBITRATED: Readonly<Partial<Record<number, string>>> = {
	// Judged by `analysis.sef` and rendered by the section of the same id. 15 presses on `waves` alone,
	// 14 of them charged to a rung — and the rung named moved with the band, which is the clearest sign
	// the fault was an artefact: the same button read as a skipped Tiger Palm refresh, a skipped Rising
	// Sun Kick, a skipped Jab and a skipped Rushing Jade Wind across one pull.
	[ID.stormEarthAndFire]: 'sef',
	// Judged by `analysis.karma`, on absorbed and reflected damage against the cap the log reveals. A
	// press is right or wrong by the damage that was incoming, which is not a rotational condition and
	// not a thing a filler rung can read.
	[ID.touchOfKarma]: 'karma',
};

export { LADDER };
