import { ALL_BANDS, type Band, type AplRule } from '~/lib/spec/apl';

/**
 * The Elemental priority list, declared for the audit engine.
 *
 * The engine (`lib/spec/apl.ts`) walks whatever ladder it is handed; this file is that list — the
 * rules, the buttons they mean, the constants the conditions are cut from — plus everything about
 * the transcription that a future reader needs to check it.
 *
 * ## The list being transcribed
 *
 * `wowsims-mop/ui/shaman/elemental/apls/p5.apl.json` — the tier-16 list, not `default.apl.json`.
 * The `// N` comments give the index into that file's `priorityList`; conditions that the APL
 * writes as `valueVariables` are named in the comments the way the file names them.
 *
 * ## What this deliberately does not model
 *
 * The list transcribed here is the *filler ladder* — the entries that decide what an on-GCD global
 * is spent on. Everything else is excluded on purpose, each for its own reason:
 *
 * - **Skull Banner** (1, 2), **Stormlash Totem** (3, 4), **Bloodlust** (5), **Berserking** (6),
 *   **Blood Fury** (11), **Jade Serpent Potion** (10): raid cooldowns, racials and consumables.
 *   They cost no global this ladder arbitrates (the first two are off-GCD, and the ladder only ever
 *   sees on-GCD presses), and the banner is a raid-coordination call rather than a personal one.
 * - **Ascendance** (14, 15): an off-GCD cooldown with two explicit rules — the opener (`currentTime
 *   <= 5s` with Flame Shock remaining over 15s) and the tier-16 two-piece window (the Elemental
 *   Discharge debuff 144999 with at least 10s left). It is judged by the cooldowns section, which
 *   has the room a per-press verdict would not.
 * - **Elemental Mastery** (9): an off-GCD talent cooldown, synced with Ascendance; the cooldowns
 *   section's business.
 * - **Fire Elemental** (19, prepull), **Earth Elemental** (21): pets. Fire Elemental is the
 *   cooldowns section's business; Earth Elemental's own rule is written almost entirely in
 *   end-of-fight terms (`remainingTime <= 62s` first), so a drift verdict would call the sim's own
 *   plan a fault.
 * - **Flame Shock's snapshot refreshes** (7, 12): the two Flame Shock rules above the filler — the
 *   proc-window reapplies (`Flame Shock Rules`) and the refresh just before Ascendance (`Flame
 *   Shock Refresh Prior to Ascendance`). They are judged by the Flame Shock section, which reads
 *   the proc windows and the reader's own `flameShockRefreshMs` against them; the ladder carries
 *   only the keep-it-up half of the story (see the `flame-shock` rung below).
 * - **The multi-target Flame Shock rule** (16): refreshes on a *secondary* target when its dot has
 *   less than a tick left. The ladder grades the primary target; the multi-target caveat is the
 *   report's own.
 *
 * ## What the ladder reads instead of bars
 *
 * The Windwalker ladder is written in units of energy and chi; this one reads no bar at all — its
 * currency is the Flame Shock dot, Lightning Shield's stack counter, and the buttons' own clocks.
 * The audit passes `barsRequired: false`, so the engine's `null` gate (no resources, no walk)
 * does not apply. The three resources the rules do read are:
 *
 * - the Flame Shock dot's remaining time on the primary target (`dotRemainingTime` in the APL),
 * - Lightning Shield's stack count (`auraNumStacks(324)` — the Earth Shock rule's test),
 * - cooldown clocks for buttons that are not rungs — Ascendance's, which the Earth Shock and
 *   Flame Shock rules read (`spellTimeToReady(114049)`).
 *
 * ## Where the numbers come from
 *
 * Cooldowns and durations are read from the Go sim rather than from memory:
 * `sim/shaman/unleash_elements.go` (15s), `sim/shaman/elemental/lavaburst.go` (8s; Lava Surge and
 * Ascendance reset it), `sim/shaman/elemental_blast.go` (12s), `sim/shaman/ascendance.go` (180s).
 * Lava Burst's cast time is 2s (`elemental/lavaburst.go`), which is the number its condition is
 * written in.
 */

/** The rules this ladder models, in priority order. */
export type ELE_AplRuleKey =
	| 'unleash-elements'
	| 'flame-shock'
	| 'lava-burst'
	| 'elemental-blast'
	| 'earth-shock'
	| 'searing-totem'
	| 'lightning-bolt';

/** Cast ids, as the log records them and the cast table keys on them. */
const ID = {
	unleashElements: 73680,
	flameShock: 8050,
	lavaBurst: 51505,
	elementalBlast: 117014,
	earthShock: 8042,
	searingTotem: 3599,
	lightningBolt: 403,
	ascendance: 114049,
} as const;

/**
 * The window in which Flame Shock is pressed to keep the dot from dropping.
 *
 * Not a number the sim names — the p5 list's own Flame Shock rules are the snapshot reapplies
 * (priority 7, `Flame Shock Rules`) and the Ascendance prep (priority 12), both of which this
 * ladder leaves to the Flame Shock section. The keep-it-up reading is this report's, on the same
 * grounds the section argues for its refresh window: Flame Shock is a snapshot dot and an Elemental
 * player never lets it drop, whichever build the p5 list was tuned for.
 */
const FS_KEEP_UP_MS = 3000;

/** Lava Burst's cast time, in the units the sim writes it — 2s (`elemental/lavaburst.go`). */
const LAVA_BURST_CAST_MS = 2000;

/** The `Flame Shock Refresh Prior to Ascendance` rule's own threshold: `dotRemainingTime < 16s`. */
const FS_ASC_PREP_MS = 16000;

/** Ascendance coming back within this — the `spellTimeToReady(114049) >= 6s` of the Earth Shock rule. */
const ES_ASC_HOLD_SEC = 6;

type ELE_AplRule = AplRule & { key: ELE_AplRuleKey };

/**
 * The ladder, in the sim's evaluation order, with the conditions taken off the p5 list.
 *
 * The exclusions above are the reason the ordering looks sparse: entries 1–6, 8–12, 14–16, 19 and
 * 21 fall between these, and every one of them is documented in the module doc.
 */
export const LADDER: readonly ELE_AplRule[] = [
	{
		// 0 — `Unleashed Fury Talented and not(auraIsActive(114049))`. A talent-gated 15s cooldown
		// pressed whenever it is back, with Ascendance the one thing that waits. On the GCD, so it is
		// a filler-slot press and a ladder rung rather than a cooldown-section ability.
		key: 'unleash-elements',
		id: ID.unleashElements,
		chiCost: 0,
		energyCost: 0,
		talent: true,
		cooldownMs: 15000,
		condition: (_state, auras) => !auras.active('ascendance'),
	},
	{
		// 7 and 12 are the snapshot half of Flame Shock and belong to the Flame Shock section; the
		// keep-it-up half is the rung below — the dot is the list's currency and is never allowed to
		// drop. The Ascendance prep (12, first branch: no Elemental Mastery, `spellTimeToReady(114049)
		// < 2s`, `dotRemainingTime < 16s`) is transcribed because it is pure clock reading; the second
		// branch's Elemental Mastery condition is a talent check and stays with the section.
		key: 'flame-shock',
		id: ID.flameShock,
		chiCost: 0,
		energyCost: 0,
		condition: (_state, auras, cooldowns) =>
			auras.remainingMs('flame-shock') <= FS_KEEP_UP_MS ||
			(cooldowns.readyInSec(ID.ascendance) <= 2 && auras.remainingMs('flame-shock') < FS_ASC_PREP_MS),
	},
	{
		// 13 — `dotRemainingTime(8050) > spellCastTime(51505)`: Lava Burst only while the dot it is
		// gated on still outlives its cast. Its 8s cooldown is not a bare clock: Lava Surge (77762)
		// and Ascendance each reset it, and the ladder reads those resets off the auras rather than
		// calling the player's press a skip.
		key: 'lava-burst',
		id: ID.lavaBurst,
		chiCost: 0,
		energyCost: 0,
		cooldownMs: 8000,
		readyWhen: (auras) => auras.active('lava-surge') || auras.active('ascendance'),
		condition: (_state, auras) => auras.remainingMs('flame-shock') > LAVA_BURST_CAST_MS,
	},
	{
		// 17 — `Elemental Blast Talented`, and nothing else: a talent-gated 12s cooldown pressed
		// whenever it is back.
		key: 'elemental-blast',
		id: ID.elementalBlast,
		chiCost: 0,
		energyCost: 0,
		talent: true,
		cooldownMs: 12000,
		condition: () => true,
	},
	{
		// 18 — `Earth Shock Rules`, first branch (the tier-16 two-piece branch is excluded and
		// documented at the top): `dotRemainingTime(8050) >= 6s`, `auraNumStacks(324) >= 7`,
		// `spellTimeToReady(114049) >= 6s`, `not(auraIsActive(144998))`.
		//
		// The Ascendance hold is why Earth Shock waits: the shock timer is shared with Flame Shock
		// (`shocks.go`), so an Earth Shock in the six seconds before Ascendance's prep refresh would
		// leave the timer busy when the list wants the refresh to land. The 144998 clause excludes the
		// two-piece play entirely — under the proc the list spends Earth Shock on the debuff's tail
		// instead, and this ladder grades neither branch of that trade.
		//
		// The stack reading defaults to the ceiling when the log never carried the aura: the sim
		// opens the fight with the shield at seven stacks (`sim/shaman/lightning_shield.go`), so a
		// silent log is read at the sim's own opening state rather than as an unreadable bar.
		key: 'earth-shock',
		id: ID.earthShock,
		chiCost: 0,
		energyCost: 0,
		condition: (_state, auras, cooldowns) => {
			const stacks = auras.stacks('lightning-shield');
			if (stacks !== null && stacks < 7) return false;
			if (auras.remainingMs('flame-shock') < 6000) return false;
			if (cooldowns.readyInSec(ID.ascendance) < ES_ASC_HOLD_SEC) return false;
			if (auras.active('t16-2pc-proc')) return false;
			return true;
		},
	},
	{
		// 20 — `Fire Elemental is not active`: Searing Totem only while no Fire Elemental is up and
		// no totem is already ticking. Both halves are read off windows the audit builds from casts,
		// because neither is an aura a log is guaranteed to carry.
		key: 'searing-totem',
		id: ID.searingTotem,
		chiCost: 0,
		energyCost: 0,
		condition: (_state, auras) => !auras.active('fire-elemental') && !auras.active('searing-totem'),
	},
	{
		// 22 — the unconditional filler. Everything above it wanted nothing.
		key: 'lightning-bolt',
		id: ID.lightningBolt,
		chiCost: 0,
		energyCost: 0,
		condition: () => true,
	},
];

/**
 * The ladder as a reference reads it, with its conditions taken off.
 *
 * The report renders the priority list twice — once as a verdict on this pull, once as the list
 * itself — and the second of those used to be a hand-maintained copy of the ladder file. Two lists
 * drift; this one has, in both directions. So the rungs are published from here instead, and a rule
 * added, renamed, reordered or re-banded in `LADDER` moves the reference in the same commit or
 * fails to compile.
 *
 * A projection rather than `LADDER` itself, because a rule carries closures. A view that could reach
 * `condition` would sooner or later call it, and it would have to invent a `State` to do so — a
 * second, fictional pull sitting inside a reference table.
 */
export const LADDER_ENTRIES: ReadonlyArray<{
	key: ELE_AplRuleKey;
	id: number;
	/** Resolved rather than optional: an entry that named no bands exists in all four, so say all four. */
	bands: readonly Band[];
	talent: boolean;
	/** The button that removes this one from the bars, when one does. */
	replacedBy?: number;
}> = LADDER.map((rule) => ({
	key: rule.key,
	id: rule.id,
	bands: rule.bands ?? ALL_BANDS,
	talent: rule.talent === true,
	...(rule.replacedBy === undefined ? {} : { replacedBy: rule.replacedBy }),
}));
