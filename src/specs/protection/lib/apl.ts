import { type AplRule, ladderEntries } from '~/lib/spec/apl';

/**
 * The Protection priority list, declared for the audit engine.
 *
 * The engine (`lib/spec/apl.ts`) walks whatever ladder it is handed; this file is that list — the
 * rules, the buttons they mean, the constants the conditions are cut from — plus everything about the
 * transcription a future reader needs in order to check it.
 *
 * ## The list being transcribed
 *
 * The reader's own multi-target list, which is `ui/paladin/protection/apls/iron_juggernaut.apl.json`
 * with two substitutions. The `// N` comments are indices into that file's `priorityList`, so any line
 * here can be checked against the file it came from. Diffed rather than eyeballed, and it is exactly
 * two changes:
 *
 *  - **Crusader Strike (35395) becomes Hammer of the Righteous (53595)** at both builder rungs and both
 *    of the waits that name them. The two share one cooldown (`paladin.BuilderCooldown()`), so this is
 *    the same rung pointed at the cleave half of one button.
 *  - **Consecration moves from rung 25 to rung 17** — from under Hammer of Wrath and the Sacred Shield
 *    refresh to above Holy Wrath, the builders and Execution Sentence. It is the spec's only ground
 *    area effect, and promoting it above four single-target buttons is what a second body is worth.
 *
 * Those two changes *are* the multi-target list, and both are expressible as band gates, so this file
 * holds one ordered ladder with `bands` on four rungs rather than two ladders. See **The band split**.
 *
 * ## What this deliberately does not model
 *
 * The ladder is the *filler chain* — the rungs that decide what an on-GCD global is spent on. The list
 * has twenty-nine entries and eleven of them are on the GCD. Everything else is excluded for a reason
 * that is the same reason in every case but one: **it costs no global this ladder arbitrates.**
 *
 *  - **Avenging Wrath** (0), **Divine Protection** (1), **Guardian of Ancient Kings** (2), **Ardent
 *    Defender** (3), **the on-use trinkets** (4), **the Healthstone** (7), `autocastOtherCooldowns` (8)
 *    and **Holy Avenger** (9): off the GCD, every one, and the ladder only ever sees on-GCD presses.
 *  - **Vigilance** (5) and **Rallying Cry** (6): not the player's buttons at all. The sim lets a raid
 *    cooldown be scripted from the unit that benefits; the log records it on the warrior who pressed
 *    it. `lib/analysis/externals.ts` is where this report answers what the raid brought.
 *  - **Shield of the Righteous** (11) and **Eternal Flame** (10): the two spenders, and **both are off
 *    the GCD for this spec** — `sim/paladin/protection/shield_of_the_righteous.go:94-97` declares a
 *    `DefaultCast` with no `GCD` field, and `sim/paladin/word_of_glory.go:55` is
 *    `GCD: core.TernaryDuration(isProt, 0, core.GCDDefault)`. That is the single most consequential
 *    fact about this ladder and it is what makes it a ladder of *generators*: nothing on it spends holy
 *    power, so no rung here reads the bar, and `barsRequired` is false.
 *  - **The four `wait` actions** (13, 22, 23 in the shipped file): a wait is not a press. The engine
 *    judges presses, and a global the player held for half a second to line a builder up is a global
 *    the log records as a gap rather than as a cast. `globals` measures those gaps; this file cannot.
 *
 * ## The band split
 *
 * `bandOf` puts one target in band 1 and two, three, four-or-more in bands 2, 3, 4. Four rungs carry a
 * gate and they are two pairs, each pair being one of the two substitutions above:
 *
 *  - `crusader-strike*` is `[1]` and `hammer-of-the-righteous*` is `[2, 3, 4]`, at the same two
 *    positions. One button, one cooldown, two halves — the shipped file presses the single-target half
 *    and the reader's list the cleave half, and a band gate is exactly that sentence.
 *  - `consecration` is `[1]` low in the list and `consecration-multi` is `[2, 3, 4]` high in it. **Two
 *    rungs for one button, because a band gate can move a rung out of a list and cannot move it up
 *    one.** The engine supports it — a rung's key is the rule's name and not the button's — and it is
 *    the only shape that holds both orders.
 *
 * **A band gate removes a rung rather than falsifying it**, which is what makes this an honest
 * transcription instead of a guess: at one target Hammer of the Righteous is not *in* the list, so it
 * can never be the button a press skipped, and a single-target pull that presses it falls through to
 * whatever the list does want. The reverse holds at two targets for Crusader Strike.
 *
 * ## The other two presets, and where they disagree with this one
 *
 * The sim ships three Protection lists and all three are encounter scripts rather than target-count
 * variants — `sha.apl.json`, `horridon.apl.json`, `iron_juggernaut.apl.json`. That is a different
 * situation from the Elemental's three, where the file names are the counts, and it is why this module
 * transcribes one list and bands it rather than treating the three as a band series:
 *
 *  - **`sha.apl.json`** (29 rungs) orders its fillers Crusader Strike → Judgment → Avenger's Shield →
 *    Sacred Shield refresh → Holy Wrath → Execution Sentence → Light's Hammer → Hammer of Wrath →
 *    Consecration → Holy Prism → Sacred Shield. So Holy Wrath sits *below* the Sacred Shield refresh
 *    there and above it here, and it has no Avenger's Shield-on-Grand-Crusader rung at all. **Not
 *    modelled**: one list has one order, and the nine rungs above it are scripted to that encounter's
 *    own aura (120669, Sha of Fear's `Dread Spray`), which no other pull carries.
 *  - **`horridon.apl.json`** (22 rungs) is the same chain with the level-90 talents, Eternal Flame and
 *    the Grand Crusader rung dropped, and Avenging Wrath gated on `currentTime > 36s`. Every rung it
 *    has, this ladder has; what it drops, a player who did not talent it drops too, and `talent` is how
 *    that is already said. **Nothing to model.**
 *
 * ## What the log has to answer, and the two windows it is asked for
 *
 * Every condition below reads an aura the registry declares, with two exceptions that are windows
 * measured off the stream and handed over under keys of their own:
 *
 *  - **`consecration-dot`** — `NOT dotIsActive(26573)`. Consecration's cooldown is haste-scaled and its
 *    dot is not: nine ticks of one second (`sim/paladin/protection/consecration.go:44-45`) against a
 *    cooldown that reaches six seconds at the haste this spec targets. So "off cooldown" and "not
 *    running" stop being the same question exactly where it matters, and the rung has to read the ticks.
 *  - **`execute-window`** — Hammer of Wrath's own `ExtraCastCondition` is `sim.IsExecutePhase20()`
 *    (`sim/paladin/hammer_of_wrath.go:49-50`) and nothing else. The list writes the rung unconditionally
 *    because the *spell* carries the gate, so a transcription that dropped it would demand the button
 *    through the whole pull. Measured off the health readings WarcraftLogs staples to damage events.
 *
 * Both are absent rather than empty on a log that cannot answer them, so the rung reads `'unknown'` and
 * says nothing — the three-valued discipline the engine's own doc argues for.
 *
 * ## `includeReactionTime`, and why it is named rather than modelled
 *
 * Six of the list's conditions carry the flag, and it means the aura has to have been up for at least
 * the player's reaction time before the rule will look at it — `sim/core/apl_values_aura.go:43`,
 * `aura.IsActive() && aura.TimeActive(sim) >= value.reactionTime`. **Five of the six are on off-GCD
 * rungs this ladder never sees**, so exactly one rung here carries it: Avenger's Shield on Grand
 * Crusader.
 *
 * Not modelled, and the reason is what the number is rather than how small it is. `ReactionTime` is a
 * *player setting* — `sim/core/character.go:108` reads it off `player.ReactionTimeMs` with a floor of
 * ten, and the sim's own test harness uses 100 where its UI offers something else. It is a preference
 * about how fast the person at the keyboard is, not a fact about the game, and a report that baked one
 * in would be grading every reader against whatever number this file happened to pick.
 *
 * The direction, so it is not a surprise: the log says the proc was up from the moment it landed, so
 * this ladder wants the shield a fraction of a second earlier than the sim would. Grand Crusader's
 * windows on the five committed pulls run a median of about two seconds — they close when the shield
 * consumes them — so a hundred-millisecond sliver is a twentieth of a window, and it can only reach a
 * press that landed inside it.
 */

/** Cast ids, named once so a rung and its comment cannot drift apart. */
const ID = {
	judgment: 20271,
	avengersShield: 31935,
	consecration: 26573,
	holyWrath: 119072,
	crusaderStrike: 35395,
	hammerOfTheRighteous: 53595,
	executionSentence: 114916,
	hammerOfWrath: 24275,
	sacredShield: 20925,
	lightsHammer: 114158,
	holyPrism: 114852,
} as const;

/**
 * Talent rows, which are not the same numbers as the buttons above them.
 *
 * Three of the five are: Execution Sentence, Light's Hammer and Holy Prism each occupy the level-90 row
 * they cast under. Two are not, and they are the reason this table exists rather than a cast id being
 * reused. **Sanctified Wrath** (114232) gates a rung whose button is Judgment, which every Paladin has;
 * reading the gate off the cast id would ask whether the player talented *Judgment*. **Sacred Shield**
 * shares the level-45 row with Eternal Flame and Selfless Healer, so a player carrying the ladder's two
 * Sacred Shield rungs is a player who did not take the spender rung this ladder excludes.
 */
const TALENT = {
	sanctifiedWrath: 114232,
	executionSentence: 114916,
	sacredShield: 20925,
	lightsHammer: 114158,
	holyPrism: 114852,
} as const;

/**
 * How long may be left on Sacred Shield when the list wants it re-applied.
 *
 * `remain(20925) < 5s`, rung 24 of the shipped file and 25 of the reader's. The aura runs thirty
 * seconds, so this is the last sixth of it — a refresh window rather than a maintenance rule, which is
 * why the unconditional Sacred Shield rung at the bottom of the ladder is a different rung and not this
 * one with the clause dropped.
 */
const SACRED_SHIELD_REFRESH_MS = 5000;

/**
 * How long Consecration burns after the press, in ms.
 *
 * Nine ticks of one second — `sim/paladin/protection/consecration.go:44-45`, `NumberOfTicks: 9` and
 * `TickLength: time.Second * 1`. **Not haste-scaled, while the cooldown beside it is**, which is the
 * entire reason the rung reads a dot rather than a clock: the two numbers are both nine seconds on paper
 * and stop agreeing the moment the player has any haste at all.
 *
 * Exported because the audit is what turns it into windows — a press and the nine seconds after it,
 * clipped by the next press, since a re-cast replaces the ground effect rather than stacking with it.
 */
export const CONSECRATION_DOT_MS = 9000;

/**
 * The share of an enemy's health Hammer of Wrath needs them under.
 *
 * `sim.IsExecutePhase20()` — `sim/paladin/hammer_of_wrath.go:49-50` — and the twenty is in the name of
 * the helper rather than in the Paladin's own file, which is why it is written here as a number with a
 * citation rather than inferred from a spell field. The tooltip's "or during Avenging Wrath" belongs to
 * Sword of Light, the Retribution passive, so for this spec there is no second clause.
 */
export const EXECUTE_HEALTH_PCT = 20;

/** The keys this ladder's rules are named by, so the copy table cannot fall out of step with the list. */
export type ProtAplRuleKey =
	| 'judgment-sanctified-wrath'
	| 'avengers-shield-grand-crusader'
	| 'judgment'
	| 'avengers-shield'
	| 'consecration-multi'
	| 'holy-wrath'
	| 'hammer-of-the-righteous-holy-avenger'
	| 'crusader-strike-holy-avenger'
	| 'execution-sentence'
	| 'hammer-of-the-righteous'
	| 'crusader-strike'
	| 'hammer-of-wrath'
	| 'sacred-shield-refresh'
	| 'consecration'
	| 'lights-hammer'
	| 'holy-prism'
	| 'sacred-shield';

type ProtAplRule = AplRule & { key: ProtAplRuleKey };

/**
 * The filler chain, ordered exactly as the sim evaluates it.
 *
 * Every rung is `chiCost: 0, energyCost: 0`, and that is a fact about the spec rather than a stub: both
 * holy power spenders are off the GCD, so nothing this ladder arbitrates is paid for from a bar. The
 * engine's `affordable` therefore never consults one, which is also why `barsRequired` is false where
 * these inputs are built.
 */
export const LADDER: readonly ProtAplRule[] = [
	{
		// 12 — `known(114232) AND active(31884)`. Sanctified Wrath makes Judgment generate two holy power
		// inside Avenging Wrath, so the window is worth spending a global to feed it and the list says so
		// with a rung above every other filler.
		//
		// **The talent gate is the button's, not the rung's**, which is what `talentId` is for: the press
		// is a Judgment and every Paladin has one. Gated on the cast id this rung would be asking whether
		// the player talented Judgment, which is always true and would leave the rung standing for a
		// player who cannot get the benefit — demanding Judgment inside every Wrath on the pull.
		key: 'judgment-sanctified-wrath',
		id: ID.judgment,
		chiCost: 0,
		energyCost: 0,
		talent: true,
		talentId: TALENT.sanctifiedWrath,
		cooldownMs: 6000,
		condition: (_state, auras) => {
			// A pull that never carried Avenging Wrath cannot say whether this rung's window was open. The
			// aura is a two-minute cooldown a tank sometimes never presses, so "never up" is a real answer
			// and `present` is what separates it from "the log did not carry the stream".
			if (!auras.present('avenging-wrath')) return 'unknown';
			return auras.active('avenging-wrath');
		},
	},
	{
		// 14 — `active(85416)`, and the only rung on this ladder carrying `includeReactionTime`; the module
		// doc says why that flag is named rather than modelled. Grand Crusader resets Avenger's Shield's
		// cooldown outright
		// (`sim/paladin/protection/grand_crusader.go:25`, `prot.AvengersShield.CD.Reset()`), so the proc is
		// a free shield rather than a shield brought forward, and the list spends the global on it the
		// moment it lands.
		//
		// A separate rung from the plain Avenger's Shield two lines down and not the same rung with a
		// clause: the sim writes two, and the difference is what a reader is owed. Passing this one over
		// wastes a proc; passing the other one over is ordinary drift.
		key: 'avengers-shield-grand-crusader',
		id: ID.avengersShield,
		chiCost: 0,
		energyCost: 0,
		// No cooldown on this rung, deliberately: the proc *is* the cooldown being gone. Declaring 15s here
		// would have the rung refuse the very press the proc exists to allow.
		condition: (_state, auras) => {
			if (!auras.present('grand-crusader')) return 'unknown';
			return auras.active('grand-crusader');
		},
	},
	{
		// 15 — unconditional. The generator with the longest cooldown of the three that are always wanted,
		// so it leads them.
		key: 'judgment',
		id: ID.judgment,
		chiCost: 0,
		energyCost: 0,
		cooldownMs: 6000,
		condition: () => true,
	},
	{
		// 16 — unconditional.
		key: 'avengers-shield',
		id: ID.avengersShield,
		chiCost: 0,
		energyCost: 0,
		cooldownMs: 15_000,
		// The proc resets the clock, and a reset cannot be late — see the engine's `ready`. Without this
		// the rung reads a shield pressed inside a proc as still on cooldown and stops wanting it, which
		// hands the global to whatever rung is next and mis-names every skip below.
		readyWhen: (auras) => auras.active('grand-crusader'),
		condition: () => true,
	},
	{
		// 17 in the reader's list — `NOT dot(26573)`, and the whole of the multi-target promotion. Nine
		// seconds of ticks on the ground under a boss and every add beside it, above four buttons that hit
		// one body.
		key: 'consecration-multi',
		id: ID.consecration,
		chiCost: 0,
		energyCost: 0,
		bands: [2, 3, 4],
		cooldownMs: 9000,
		condition: (_state, auras) => {
			// The dot rather than the cooldown, because at this spec's haste they are different clocks —
			// see the module doc. A pull with no Consecration ticks at all has nothing to read, and a rung
			// that answered "not running, press it" there would demand the button at every global of a pull
			// the player may simply not have used it on.
			if (!auras.present('consecration-dot')) return 'unknown';
			return !auras.active('consecration-dot');
		},
	},
	{
		// 18 — unconditional.
		key: 'holy-wrath',
		id: ID.holyWrath,
		chiCost: 0,
		energyCost: 0,
		cooldownMs: 9000,
		condition: () => true,
	},
	{
		// 19 — `active(105809)`. Holy Avenger makes each builder generate three holy power instead of one,
		// so the list spends its builders inside the window before it spends anything else.
		//
		// The cleave half of the shared button; the single-target half is the rung directly below, at the
		// same index and with the opposite band gate.
		key: 'hammer-of-the-righteous-holy-avenger',
		id: ID.hammerOfTheRighteous,
		chiCost: 0,
		energyCost: 0,
		bands: [2, 3, 4],
		cooldownMs: 4500,
		condition: (_state, auras) => {
			if (!auras.present('holy-avenger')) return 'unknown';
			return auras.active('holy-avenger');
		},
	},
	{
		// 18 of the shipped file — the same rung with the single-target half of the shared button, which is
		// what `iron_juggernaut.apl.json` presses and the reader's list replaced.
		key: 'crusader-strike-holy-avenger',
		id: ID.crusaderStrike,
		chiCost: 0,
		energyCost: 0,
		bands: [1],
		cooldownMs: 4500,
		condition: (_state, auras) => {
			if (!auras.present('holy-avenger')) return 'unknown';
			return auras.active('holy-avenger');
		},
	},
	{
		// 20 — unconditional, and talent-gated on its own row. The damage is decided at the press and
		// arrives ten seconds later, which is why it sits above the builders that feed it rather than
		// among them.
		key: 'execution-sentence',
		id: ID.executionSentence,
		chiCost: 0,
		energyCost: 0,
		talent: true,
		talentId: TALENT.executionSentence,
		cooldownMs: 60_000,
		condition: () => true,
	},
	{
		// 21 — unconditional. The builder, and the button most of a Protection pull's globals go to.
		key: 'hammer-of-the-righteous',
		id: ID.hammerOfTheRighteous,
		chiCost: 0,
		energyCost: 0,
		bands: [2, 3, 4],
		cooldownMs: 4500,
		condition: () => true,
	},
	{
		// 20 of the shipped file — the single-target half, band 1.
		key: 'crusader-strike',
		id: ID.crusaderStrike,
		chiCost: 0,
		energyCost: 0,
		bands: [1],
		cooldownMs: 4500,
		condition: () => true,
	},
	{
		// 22 — written unconditionally, because **the spell carries the gate rather than the rule**:
		// `hammer_of_wrath.go:49-50` is `ExtraCastCondition: sim.IsExecutePhase20()`. Transcribed as
		// written, the rung would demand the button from the pull's first global.
		key: 'hammer-of-wrath',
		id: ID.hammerOfWrath,
		chiCost: 0,
		energyCost: 0,
		cooldownMs: 6000,
		condition: (_state, auras) => {
			// The window is measured off the enemy's own health readings and handed over as a window set —
			// see the module doc. A pull whose damage events carry no health cannot say, which is the honest
			// answer and not "the execute never opened": the rungs below this one are the two Sacred Shield
			// rules and the level-90 talents, so a wrong `false` here would silently claim the list wanted
			// one of those at every global of the pull's last fifth.
			if (!auras.present('execute-window')) return 'unknown';
			return auras.active('execute-window');
		},
	},
	{
		// 25 — `remain(20925) < 5s`. The refresh window, above the level-90 talents because a shield that
		// falls off is worth more than a cooldown pressed on time.
		key: 'sacred-shield-refresh',
		id: ID.sacredShield,
		chiCost: 0,
		energyCost: 0,
		talent: true,
		talentId: TALENT.sacredShield,
		cooldownMs: 6000,
		condition: (_state, auras) => {
			if (!auras.present('sacred-shield')) return 'unknown';
			return auras.remainingMs('sacred-shield') < SACRED_SHIELD_REFRESH_MS;
		},
	},
	{
		// 25 of the shipped file — Consecration where the single-target list puts it, under the Sacred
		// Shield refresh and above the level-90 talents. The same button and the same condition as
		// `consecration-multi` eight rungs up; only the position and the band differ, which is the whole
		// content of the reader's second substitution.
		key: 'consecration',
		id: ID.consecration,
		chiCost: 0,
		energyCost: 0,
		bands: [1],
		cooldownMs: 9000,
		condition: (_state, auras) => {
			if (!auras.present('consecration-dot')) return 'unknown';
			return !auras.active('consecration-dot');
		},
	},
	{
		// 26 — unconditional, talent-gated. Ticks every two seconds and recomputes each tick, so unlike
		// Execution Sentence every second of its window counts.
		key: 'lights-hammer',
		id: ID.lightsHammer,
		chiCost: 0,
		energyCost: 0,
		talent: true,
		talentId: TALENT.lightsHammer,
		cooldownMs: 60_000,
		condition: () => true,
	},
	{
		// 27 — unconditional, talent-gated, `tag: 1` in the file. The tag selects the damage split rather
		// than a different spell, so it is the same cast id and there is nothing to model.
		key: 'holy-prism',
		id: ID.holyPrism,
		chiCost: 0,
		energyCost: 0,
		talent: true,
		talentId: TALENT.holyPrism,
		cooldownMs: 20_000,
		condition: () => true,
	},
	{
		// 28 — the bottom rung, unconditional, and it is what makes this ladder able to say `off-list` at
		// all: a walk whose last rung can decline is a walk that can reach the engine's fall-through. This
		// one declines on its cooldown and on its talent, so a player who took Eternal Flame instead has a
		// ladder with a floor that opens.
		key: 'sacred-shield',
		id: ID.sacredShield,
		chiCost: 0,
		energyCost: 0,
		talent: true,
		talentId: TALENT.sacredShield,
		cooldownMs: 6000,
		condition: () => true,
	},
];

export const LADDER_ENTRIES = ladderEntries(LADDER);

/**
 * On-GCD buttons this ladder does not arbitrate, each naming what the report says about the press instead.
 *
 * The engine walks every on-GCD press down the list and charges it to whichever rung claims the global,
 * whether or not something else also judges it. A button that belongs to no simulator list at any count
 * is therefore a fault this ladder cannot name — so the four below say where they are accounted for, and
 * a fifth arriving with nowhere to point would be a ledger entry in
 * `analysis/__tests__/ladderCoverage.test.ts` rather than an exemption here.
 *
 * **Four buttons, two kinds, and neither kind is a damage decision.**
 *
 * The three seals are one thing three times: a stance the player sets once and leaves.
 * `sim/paladin/seal_of_truth.go` and its two neighbours register an aura and no cooldown, no Protection
 * list mentions any of them, and the press that sets one happens before the pull — **zero seal casts in
 * all five committed captures**, which is what "set once" looks like in a log. They point at `timeline`
 * because that is where the report answers the only question there is about a seal: which one was up.
 *
 * The taunt and the stun are the encounter's business rather than the rotation's, and unlike the seals
 * they are pressed often — Hand of Reckoning 2, 10, 18 and 4 times on four of the five pulls, Fist of
 * Justice 3 times on one. They point at `globals` because the true and complete thing this report can
 * say about them is that each cost one, which is the heading that counts exactly that. Charging them to
 * a filler rung instead would tell a tank they should have pressed Judgment while an add was walking
 * into the raid — confident, specific, and impossible to act on.
 */
export const UNARBITRATED: Readonly<Partial<Record<number, string>>> = {
	// Seal of Truth, Seal of Righteousness, Seal of Insight.
	[31801]: 'timeline',
	[20154]: 'timeline',
	[20165]: 'timeline',
	// Hand of Reckoning, the taunt.
	[62124]: 'globals',
	// Fist of Justice, the stun — a level-60 talent row and a raid mechanic, not a rotational press.
	[105593]: 'globals',
};
