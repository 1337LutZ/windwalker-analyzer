import type { MultiTargetBenefit } from '~/lib/game/model';
import type { CastMark, ResourceCurve, Window } from '~/lib/types';

import { levelAt, type AuraLevel } from '../analysis/auras';
import { inWindow, remainingIn } from '../analysis/auras';
import { valueAtOrBefore } from '../analysis/search';

/**
 * The priority-list audit engine, run against a spec's ladder.
 *
 * Every other section of this report measures one thing in isolation — how many brews, how much
 * uptime, how much energy went nowhere. This one asks the question those cannot: **at the moment you
 * spent that global, was there a better button?** It walks a spec's priority list at each press and
 * compares what the list wanted with what was pressed.
 *
 * The engine owns the walk — the bars, the target count, the three-valued discipline below — and the
 * ladder is a parameter: what the list *is* is declared by the spec in its own module. The
 * Windwalker ladder lives in `spec/windwalker/apl.ts`, which is also where the transcription notes
 * and the choices that list makes (what it excludes, why) are documented.
 *
 * ## The three-valued discipline
 *
 * A condition's answer is `false`, `true`, or `'unknown'`. `false` says the list did not want this
 * button; `unknown` says this log cannot tell, which is a different fact and has to travel
 * separately — collapsing the two is how a report starts inventing faults. An unreadable rule above
 * a press silences the press rather than guessing: a wrong "you misplayed here" costs a reader more
 * than a missing one.
 *
 * ## The target count is read per press, not per pull
 *
 * And "how many targets" is two questions, not one. An immune unit takes no damage but is still a unit
 * that was *hit*, so a rule about damage and a rule about a hit-count trigger have to band on different
 * counts — see `MultiTargetBenefit` in `lib/game/model`. The walk computes both bands and gives each
 * rule the one its own ability calls for; `benefitOf` is how it finds out, and a spec that supplies
 * neither it nor `triggerTargetsAt` bands everything on damage, which is the right default.
 *
 * The sim's lists branch on `numberTargets`, so rules carry `bands` and the walk reads the live
 * count at each press through `targetsAt`. Per press rather than per pull, and that distinction is
 * the whole of it: a pull that opens on four enemies and settles at two never *has* a target count,
 * and picking one number for the pull would mark correct presses as faults through every stretch
 * that did not match it.
 *
 * ## What this deliberately does not model
 *
 * Anything a log cannot say. Rules above the ladder with undecidable conditions (health-gated
 * executes, on-use items) are the ladder's call to exclude; a rule whose condition cannot be read
 * off this log leaves every press below it `unknown` rather than `followed` — silence, not a
 * plausible guess.
 *
 * The bars it reads are the resource curves the spec's config sampled (`AplInputs.energy` and
 * `AplInputs.chi`); the chi reconstruction the Windwalker ladder relies on is documented in
 * `spec/windwalker/apl.ts`, where the model that needs it lives. A spec whose ladder reads no bar
 * sets `barsRequired: false` and lifts the `null` gate the bars feed — the Elemental ladder is one.
 */

/** The rules a ladder can name, as free-form strings — each spec's ladder keys its own. */
export type AplRuleKey = string;

/**
 * How many enemies the player was on, as the APL bands it.
 *
 * Four values because the Windwalker list draws four lines, not because four is a round number: its
 * three named variables split at 2 and 3 (`More than 1`, `More than 2`, `Max 2`), and entry 20 adds
 * a raw `targets >= 4` that those names hide. A three-band model would silently drop the heavy
 * Spinning Crane Kick rule.
 */
export type Band = 1 | 2 | 3 | 4;

/** The band a live target count falls in. Anything past four is still four — the list draws no line above it. */
export function bandOf(targets: number): Band {
	if (targets <= 1) return 1;
	if (targets === 2) return 2;
	if (targets === 3) return 3;
	return 4;
}

/** Every band, for an entry that did not name one. */
export const ALL_BANDS: readonly Band[] = [1, 2, 3, 4];

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
	/**
	 * Not a rotational button — a cooldown, a defensive, a taunt. Never a fault.
	 *
	 * Two ways in, and `reason` is what tells them apart. Null: the walk reached the bottom of the ladder
	 * and nothing there wanted the global, which only a ladder whose last rung can decline can produce.
	 * Non-null: the spec declared the button unarbitrated (`AplInputs.unarbitrated`) and the string names
	 * the section that judges it instead — a pointer at a second verdict rather than the absence of a
	 * first.
	 */
	| 'off-list';

export interface AplPress {
	/**
	 * Fight-relative ms — the instant the press **landed**, and deliberately still that.
	 *
	 * This field is a join key, not just a label: `view/blackoutKick.ts` finds a press's verdict with
	 * `apl.presses.find((p) => p.t === t)` against a cast list that is landing-stamped. Re-pointing it
	 * to the decision instant would make every such lookup miss for a cast-time spell and quietly
	 * report nothing rather than fail. `decidedAt` is the instant the *judgement* was made at.
	 */
	t: number;
	/**
	 * The instant this press was judged at — its commit, which for a cast-time spell is up to ~2.5s
	 * before `t`.
	 *
	 * Carried so the verdict can be read back against the state it was actually formed from. Equal to
	 * `t` for an instant press.
	 */
	decidedAt: number;
	/** The cast id that was pressed. */
	pressed: number;
	/** What the list wanted instead, when the press was a skip. */
	wanted: AplRuleKey | null;
	/** The concrete reason for the selected rule, when the ladder names one. */
	reason?: string | null;
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
	/**
	 * True when this walk was handed no character sheet — the log carried no `combatantinfo`.
	 *
	 * **One fact about the pull, published once, so the section does not have to infer it from a pile of
	 * per-press `unknown`s.** Both halves of the sim's `auraIsKnown` are answered off that one event:
	 * `equippedItems` from its gear array and `knownTalents` from its talent list. When it is missing,
	 * every rung gated on either is reading a blank, and the presses below them come out unreadable — but
	 * *why* they are unreadable is not a property of any one press, and `priority.unjudged` counting them
	 * is the report declining to say the thing it knows.
	 *
	 * **The size of it, measured on the four committed pulls with the event stripped out.** The gear half
	 * is already three-valued, so this is today's behaviour and not a projection: `aoe.apl.json` rung 1
	 * opens on a trinket, and a pull with no gear array withholds the presses under it — `cleave` goes
	 * from 0 `unknown` to **40** and `addsThenBoss` from 0 to **112 of 408 globals**. `unbroken` and
	 * `phased` never leave band 1, where that rung is not in the list, so they stay at 0. Two of the four
	 * pulls therefore already render a quarter of themselves as "could not be checked" with nothing on
	 * screen naming the cause. That is what this field is for, and it is earned before any further rung
	 * turns strict.
	 *
	 * **What it is not.** It does not say the walk actually withheld anything: `unbroken` and `phased`
	 * would set it and lose nothing, because the rungs that read the sheet are out of their band. Tying
	 * it to a withheld verdict was the tighter design and is the wrong one — the fact a reader needs is
	 * "the report was not told what you brought", which is true of those two pulls as well, and a flag
	 * that vanished on the pulls where it happened to cost nothing would be a flag that only appears when
	 * the reader can already see the damage.
	 *
	 * Set from the inputs the spec wired, so a ladder that reads neither — the Windwalker's — never sets
	 * it, and `undefined` on an audit captured before this existed reads the same way as `false`.
	 */
	characterUnread?: boolean;
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
	 * cancel and what is left is the iteration's total length. The short-pull clause in the
	 * Windwalker ladder is the only rule that reads it, and reads it as a fact about the pull rather
	 * than about the press.
	 *
	 * Passed in rather than inferred from the last cast on the ladder's own list. The threshold is 75
	 * seconds, which is close enough to a real pull length that a pull whose final global lands twenty
	 * seconds before the kill would be measured onto the wrong side of it.
	 */
	pullMs: number;
	/** Aura windows by the spec's own key, so this module never has to know a spell id for a buff. */
	auras: Readonly<Partial<Record<string, readonly Window[]>>>;
	/**
	 * Remaining time for auras a window array cannot describe, keyed the same way and read at the press.
	 *
	 * One case, and it is not a shortcut around `auras`: a dot on *whichever enemy the player is facing*
	 * is not a set of windows over time at all. The Elemental's Flame Shock is that dot — the p5 list
	 * writes `dotRemainingTime(8050)` and the sim evaluates it against the unit the action is aimed at,
	 * while the log's dot lives on several spawns of one actor id at once. Neither shape of window array
	 * says it: clipping each spawn's window at the moment the player left that enemy makes `remainingIn`
	 * read a *future* target swap as the dot expiring, and not clipping it is the union, which credits a
	 * dot sitting on an add across the room. So the audit that knows which spawn the press was on hands
	 * the answer over as a function of `t` instead.
	 *
	 * `remainingMs` only, and deliberately: `present` stays a fact about the pull ("looked for, never
	 * went up"), and no rule in either ladder asks whether such an aura is `active`. When a key is
	 * absent here the window array answers, which is every aura in the Windwalker ladder.
	 */
	auraRemainingAt?: Readonly<Partial<Record<string, (t: number) => number>>>;
	/** How long a Fists of Fury channel ran, measured. The Windwalker APL writes this as four ticks plus input delay. */
	fofChannelSec: number;
	/**
	 * How many enemies the player was engaged with at a moment.
	 *
	 * Read per press, never per pull, because neither of those is the same question. A pull that opens
	 * on four enemies and settles at two never *has* a target count, and grading either against one
	 * number would mark correct presses as faults through every stretch that did not match it. The
	 * sim evaluates `numberTargets` at each action, so this does too.
	 */
	targetsAt: (t: number) => number;
	/**
	 * The same count over every unit the player *hit*, damage or not — what a hit-count trigger fires on.
	 *
	 * Optional, and absent is not a gap: a spec with no hit-count trigger has nothing to read it, and
	 * every rule then bands on `targetsAt` exactly as it did before this existed. Supplying it without
	 * `benefitOf` also changes nothing, because nothing would claim to want it.
	 */
	triggerTargetsAt?: (t: number) => number;
	/**
	 * Which of the two counts a button is banded on, by cast id.
	 *
	 * Resolved by the spec through its own registry — `abilityByCastId(id)?.targeting?.multiTargetBenefit` — rather
	 * than declared per ladder entry. That is deliberate: the fact is a property of the *ability*, so
	 * writing it per rule would let two rules for one button disagree, and would make the next spec with
	 * a hit-count trigger rediscover it in its ladder instead of reading it off its ability model.
	 */
	benefitOf?: (id: number) => MultiTargetBenefit;
	/**
	 * A reader's override, forcing every press to be judged at one band.
	 *
	 * Absent means "read the log", which is what the report does unless asked otherwise. Present, it
	 * answers the one question the measurement cannot: a player who deliberately ignored the adds was
	 * on one target by choice, and no count taken off the log can know that.
	 */
	forceBand?: Band;
	/**
	 * Chi knocked off the chi spenders by the tier-16 four-piece.
	 * Zero when the bonus is not equipped; the sim applies it to the spenders and not to the generators.
	 */
	chiCostReduction?: number;
	/**
	 * False when the spec's ladder decides nothing on a resource bar.
	 *
	 * The Windwalker ladder is written in units of energy and chi, and an add fight used to read as
	 * the ladder having nothing to say whenever a log arrived without resource readings — the `null`
	 * gate below. The Elemental ladder reads no bar at all, so a log without resources is not a log
	 * without a verdict: the gate only applies to a ladder that needs the bars it is named after.
	 */
	barsRequired?: boolean;
	/**
	 * Stacking auras as level-over-time stretches, keyed by the spec's own aura key — what a rule
	 * reading `auraNumStacks` off the sim needs. The same input as `auras`, read through a level
	 * rather than an on/off window: Lightning Shield's counter is what Earth Shock's rule tests.
	 */
	stackLevels?: Readonly<Partial<Record<string, readonly AuraLevel[]>>>;
	/**
	 * The item ids `combatantinfo` says the player had equipped, or **null** when it said nothing.
	 *
	 * Here because a preset list can gate a rung on owning a *thing* rather than on anything happening
	 * in the pull: `aoe.apl.json` rung 1 is `auraIsKnown(138898) AND not(dotIsActive(8050))`, and the
	 * first half is Breath of the Hydra being in the kit. The sim answers it off the unit's registered
	 * auras, which for a trinket means the item is equipped — no proc required — so a design that waited
	 * for a proc window would answer a different question, and answer it wrong on every pull where the
	 * trinket was worn and simply did not fire.
	 *
	 * **A set of ids and not a set of aura keys**, which is the one design decision worth defending. The
	 * sim spells both jobs `auraIsKnown` — a talent (`auraIsKnown(117012)`) and an equipped item
	 * (`auraIsKnown(138898)`) — and the log answers them from two different fields of the same
	 * `combatantinfo`: the talent list and the gear array. Naming a gear question with an aura key would
	 * inherit that conflation into this seam, and `auras` above already means "windows the log carried",
	 * which is exactly what this must not be read as. The talent half has its own field, `knownTalents`
	 * below, for the same reason: two questions, two fields, neither able to be mistaken for the other.
	 *
	 * **Null is not an empty kit.** A log with no `combatantinfo` cannot say what was worn, and a rung
	 * that reads this must answer `'unknown'` there rather than "not owned" — the same three-valued
	 * discipline the nullable bars on `State` keep. Absent here means the spec never wired it, which for
	 * a ladder with no gear-gated rung costs nothing.
	 */
	equippedItems?: ReadonlySet<number> | null;
	/**
	 * The talent ids `combatantinfo` says the player brought, or **null** when it said nothing.
	 *
	 * The other half of the `auraIsKnown` split `equippedItems` above describes. The sim writes a talent
	 * gate as `auraIsKnown(117012)` — the Unleashed Fury row of the Elemental's level-90 tier — and the
	 * log answers it from `combatantinfo`'s **talent list**, which is a different field of the same event
	 * from the gear array. So it is a different input, spelled in the units that field is in: talent row
	 * ids, not aura keys and not item ids. A single "known auras" set would have to hold a talent id and
	 * an item id side by side and would inherit exactly the conflation the sim's own vocabulary made.
	 *
	 * **What it replaces is a proxy, and naming the proxy is the point.** `AplRule.talent` alone gates a
	 * rung on the log showing the button *pressed*, and that fails in one direction: a player who took the
	 * talent and never pressed it inside the pull reads as a player who did not take it, so the rung is
	 * dropped from the list and every press below it is graded against a ladder the player did not have.
	 * On a short pull or a wipe that is routine rather than hypothetical. `readTalents` reads the same
	 * `combatantinfo` the gear comes from, so the real answer costs nothing extra.
	 *
	 * **Null is not an empty tree**, and it is not `'unknown'` either — a departure from `equippedItems`
	 * above, taken on a measurement rather than on taste, and the one thing about this field worth
	 * arguing over.
	 *
	 * The kit has no second witness: a trinket that never procs leaves no trace in an event stream at
	 * all, so a log with no `combatantinfo` genuinely cannot say, and `'unknown'` is the only honest
	 * answer there. A talent does have a second witness — its own button in the cast list — and that is
	 * the evidence the press proxy has always run on. So the two nulls are different facts and get
	 * different disposals: `null` here falls back to the proxy, and the reading replaces it only where
	 * there is a reading to be had.
	 *
	 * The measurement, because "it would be too strict" is not an argument on its own. The `'unknown'`
	 * arm was implemented and run against the four committed pulls with their `combatantinfo` events
	 * stripped out. `unbroken` went from 97 followed / 43 skipped / 0 unknown to **15 / 0 / 125** — 88%
	 * of the pull silenced; `phased` to 24 / 1 / 132, `cleave` to 45 / 21 / 137, `addsThenBoss` to
	 * 94 / 71 / 239. The cause is structural rather than incidental: the Elemental's top rung is a
	 * talent-gated 15s cooldown, an un-pressed cooldown reads as permanently ready, and its band-1
	 * condition is true whenever Ascendance is down — so an unreadable talent there is wanted at very
	 * nearly every global, and one missing event becomes a verdict withheld on all of them.
	 *
	 * And it withholds the wrong thing. "This log carried no `combatantinfo`" is one fact about the pull,
	 * and rendering it as 125 per-press `unknown`s is the report declining to say the thing it knows. That
	 * reading stands, and it is now published — `AplAudit.characterUnread` is the per-pull disposal, and
	 * the gear half had already earned it on its own.
	 *
	 * **The strict arm was re-measured behind that disposal and rejected a second time**, on a finding the
	 * first pass did not have. A note cannot repair the numbers printed above it. At 15 followed / 0
	 * skipped / 125 unknown, `unbroken`'s section renders a "Followed the priority list" tile reading
	 * **100%** and the `priority.clean` sentence — *no higher-priority ability was available on any global
	 * this log could check* — over 15 of its 142 globals. The strict arm's own silence is what produces
	 * that: with almost every press withheld, the handful left are the ones nothing outranked, so the
	 * pull reads as flawless precisely because it could not be read. The proxy's complete reading of the
	 * same pull is 97 / 43 / 0, and the headline it prints is true.
	 *
	 * So the two nulls keep their different disposals, and the reason is unchanged and now has a second
	 * leg under it. The kit has no second witness. The tree's two rungs are a 15s and a 12s cooldown that
	 * a shaman who took either presses on any pull of length, so the proxy is wrong only where all three
	 * of "no `combatantinfo`", "took the row" and "never once pressed it" hold at once — and buying that
	 * corner costs 59% to 88% of every other such pull's verdicts, plus a headline that flatters.
	 *
	 * Absent (rather than null) means the spec never wired the field at all, which reads the same way.
	 */
	knownTalents?: ReadonlySet<number> | null;
	/**
	 * Cooldown clocks for buttons that are not rungs but that a rule reads.
	 *
	 * `readyInSec` is otherwise built from the ladder's own cooldowns and the on-GCD presses this
	 * walk sees, neither of which knows Ascendance — it is off the ladder, off the GCD, and the
	 * Elemental ladder's Earth Shock rule is written in units of when it is coming back.
	 */
	offLadderCooldowns?: Readonly<Partial<Record<number, { cooldownMs: number; casts: readonly number[] }>>>;
	/**
	 * On-GCD buttons this ladder does not arbitrate, keyed by cast id, each naming the section that does.
	 *
	 * The engine already has a verdict for "nothing on this list wanted the global" — `off-list` at the
	 * bottom of `judge`'s walk. But that path is only reachable for a ladder whose **last rung can
	 * decline**: the Windwalker's can, on a bar it cannot pay from, and the Elemental's cannot, because
	 * its `lightning-bolt` rung is unconditional and unbanded. On such a ladder every press matches
	 * something, so a button the spec's own module doc excludes in prose is still walked down the list and
	 * charged to whichever filler rung claimed the global. Measured on the Elemental's three excluded
	 * on-GCD buttons: **9 presses across four committed fixtures**, every one a `skipped`.
	 *
	 * Prose cannot fix that and neither can the registry's `gate`. The walk sees a cast id, and a
	 * cooldown-gated button still costs one of the globals this ladder arbitrates — so being judged by a
	 * clock elsewhere does not stop it being judged by the list here. Only a declaration the walk can read
	 * does, which is this one: checked ahead of the first rung, so the verdict is `off-list` at every band
	 * and cannot depend on which band the press landed in.
	 *
	 * **The value is what keeps this from becoming an amnesty.** It names where the button *is* judged, it
	 * travels out on the press as `reason`, and it is what distinguishes a delegated press from one that
	 * fell off the bottom of a ladder. A button with no rung and no entry here stays a fault — the class
	 * `analysis/__tests__/ladderCoverage.test.ts` sweeps both declarations for.
	 */
	unarbitrated?: Readonly<Partial<Record<number, string>>>;
}

/** Reads cooldown state at a moment, keyed by cast id — what the bars cannot say on their own. */
export interface CooldownReader {
	/** Seconds until the button is castable again; zero when it is ready or was never pressed. */
	readyInSec: (id: number) => number;
}

/**
 * One entry of a ladder.
 *
 * `castable` and `condition` are kept apart because they fail differently: a button off cooldown with
 * a false condition means the list did not want it, while a button the list wanted and the player
 * could not afford is not a decision at all. Both have to be true for a rule to claim a global.
 */
/**
 * One ladder entry as the reference views read it: the rule with its closures taken off.
 *
 * A component cannot be handed an `AplRule` — the conditions are functions over a live `State`, and a
 * reference list has no pull to evaluate them against. This is the flat projection, and it is generic
 * over the key type so both specs share it: each had written the identical fifteen lines, differing
 * only in the name of its own key union, comments included.
 */
export interface LadderEntry<K extends string> {
	key: K;
	id: number;
	/** Resolved rather than optional: an entry that named no bands exists in all four, so say all four. */
	bands: readonly Band[];
	talent: boolean;
	/** The button that removes this one from the bars, when one does. */
	replacedBy?: number;
}

/** Flattens a spec's ladder into `LadderEntry` rows, resolving the two defaults as it goes. */
export function ladderEntries<K extends string>(
	ladder: ReadonlyArray<AplRule & { key: K }>,
): ReadonlyArray<LadderEntry<K>> {
	return ladder.map((rule) => ({
		key: rule.key,
		id: rule.id,
		bands: rule.bands ?? ALL_BANDS,
		talent: rule.talent === true,
		...(rule.replacedBy === undefined ? {} : { replacedBy: rule.replacedBy }),
	}));
}

export interface AplRule {
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
	 * A talent the player did not choose is not a mistake. Deliberately *not* applied to the baseline
	 * buttons: inferring those the same way would mean a player who never pressed the spec's core
	 * spender at all was never told, which is the single worst thing this ladder exists to catch.
	 *
	 * **How the gate is answered depends on what the spec supplied.** With `talentId` below and
	 * `AplInputs.knownTalents`, it is answered off the log's own talent list — in both directions. Without
	 * either, it falls back to "was this button ever pressed in the pull", which is a proxy and is
	 * described as one at `knowsTalent`.
	 */
	talent?: true;
	/**
	 * This rung's row in `combatantinfo`'s talent list, when the spec can name it.
	 *
	 * Separate from `id` because they are separate facts that only sometimes agree: Elemental Blast casts
	 * under 117014 and occupies talent row 117014, while Unleash Elements casts under 73680 and is gated
	 * on the **Unleashed Fury** row, 117012. Reading the gate off `id` would silently ask about the wrong
	 * number for the second of those, and a talent with no button of its own could not be asked about at
	 * all.
	 *
	 * Only meaningful alongside `talent: true`, and only consulted when `AplInputs.knownTalents` is
	 * supplied. A spec that declares neither keeps the press proxy it always had.
	 */
	talentId?: number;
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
	 * Not a priority relationship — an existence one. Without this the ladder would hand an add fight a
	 * column of skips for a button that was never on the bar, which is the worst kind of wrong:
	 * confident, specific, and impossible to act on.
	 */
	replacedBy?: number;
	/** Free presses: an aura that waives the cost, which changes what "could afford it" means. */
	freeWhen?: (state: State, auras: AuraReader) => boolean;
	/** How long the button locks itself, in ms. A rule with none is always ready. */
	cooldownMs?: number;
	/**
	 * Cooldown resets this button's own clock cannot see.
	 *
	 * The generic clock is `last cast + cooldownMs`, which is right for every button whose cooldown
	 * only recharges with time. Lava Burst is not one of them — Lava Surge and Ascendance each put it
	 * back on the button, so on a log where one of them just went up the press the player makes is not
	 * the skip a bare clock would call it.
	 */
	readyWhen?: (auras: AuraReader) => boolean;
	/** The concrete reason the list chose this rule, for the section's copy. A rule that names none has none. */
	reason?: (state: State) => string | null;
	condition: (state: State, auras: AuraReader, cooldowns: CooldownReader) => Truth;
}

/** Reads aura state at a moment, by the spec's key. An aura the log never carried is simply never up. */
export interface AuraReader {
	active: (key: string) => boolean;
	remainingMs: (key: string) => number;
	/** The stack count of a stacking aura at this moment; null when the log never carried a level. */
	stacks: (key: string) => number | null;
	/** Whether the log carried this aura at all — the difference between "not up" and "cannot say". */
	present: (key: string) => boolean;
}

/**
 * The bars and the clock at one press, where `null` on a bar means the log did not say.
 *
 * Three fields here are nullable, and it is the same three-valued discipline `Truth` above exists for.
 * A curve opens at its first reading, and a press before that reading has no bar behind it — the
 * reader used to answer `0` there, which is not a cautious guess but a specific and usually wrong one:
 * zero chi makes every spender on this list unaffordable, so the walk falls past six rungs and names
 * whatever it lands on as the button the list wanted. On the six reference pulls that is between one
 * and four presses each, every one given a confident verdict built on a bar nobody read.
 *
 * So a rule that needs a bar this log cannot supply returns `'unknown'` and the press says nothing,
 * exactly as a rule that needs an aura the log never carried already does.
 */
export interface State {
	t: number;
	chi: number | null;
	chiMax: number;
	energy: number | null;
	energyMax: number;
	/**
	 * Seconds until the energy bar is full. The unit almost every condition in this list is written in.
	 *
	 * Null when the bar is unread, and null when the regen rate is. An unmeasured rate used to read as
	 * zero seconds to cap, which is not "no data" — it is "the bar is overflowing right now", and it
	 * made the overflow rule want its button at every global of the pull.
	 */
	timeToEnergyCapSec: number | null;
	/** How long the whole pull ran. The same number at every press — the short-fight clause reads it. */
	pullMs: number;
	gcdSec: number;
	/** Carried on the state rather than closed over, so a rule reads every number it needs from one place. */
	fofChannelSec: number;
	regenPerSec: number;
	/**
	 * The kit, as item ids — the same set at every press, and null when the log carried no gear at all.
	 *
	 * On the state for the reason `pullMs` is: a rule reads every fact it needs from one place, and this
	 * one is a fact about the pull rather than about the moment. See `AplInputs.equippedItems` for why it
	 * is ids rather than an aura key, and for why null has to stay distinguishable from an empty kit.
	 */
	equippedItems: ReadonlySet<number> | null;
	/**
	 * Enemies engaged at this press, banded as the list bands them.
	 *
	 * **The band for the rule being evaluated**, which is not the same number for every rule at one
	 * press: a rule whose ability's benefit is a hit-count trigger is banded on the units it hit, and
	 * every other rule on the units that took damage. A condition reading `state.band` therefore reads
	 * its own rule's count, which is the only one it could mean.
	 */
	band: Band;
}

/**
 * The bar's value at a moment.
 *
 * The last reading at or before `t`, never an interpolation. That is not a shortcut: a cast reads its
 * bar *before* paying for itself — the same fact `cappedIntervals` in `analysis/energy.ts` is built
 * on — so the reading carried by a press is exactly the resource the player had when they chose it.
 * Interpolating between two readings would invent a value nobody held and, at a press, would blend in
 * the cost of the press being judged.
 *
 * Null before the first reading, and that is the whole of the difference from `countAt` in
 * `analysis/targets.ts`, which returns zero there. Zero is the *right* answer for a target count —
 * before the first landed hit the player was demonstrably fighting nothing — and the wrong one for a
 * bar, where "no reading yet" and "empty" are different facts about the pull.
 */
const valueAt = (curve: ResourceCurve, t: number): number | null => valueAtOrBefore(curve.points, t);

/** Aura state frozen at one moment, so a rule cannot accidentally read a different `t` than its neighbours. */
function readerAt(t: number, inputs: AplInputs): AuraReader {
	return {
		// Length, not existence: the engine hands over an empty array for an aura it looked for and did
		// not find, and "looked for, never went up" is a different fact from "never looked".
		present: (key) => (inputs.auras[key]?.length ?? 0) > 0,
		active: (key) => {
			const windows = inputs.auras[key];
			return windows === undefined ? false : inWindow(t, windows);
		},
		remainingMs: (key) => {
			// The audit's own reading first, where it has one — see `auraRemainingAt`.
			const reading = inputs.auraRemainingAt?.[key];
			if (reading !== undefined) return reading(t);
			const windows = inputs.auras[key];
			return windows === undefined ? 0 : remainingIn(t, windows);
		},
		// The last stretch that opened before `t`, and the level it held across the stretch. The
		// before-boundary reading matters for the same reason it does in `levelAt`: a press that spends
		// the counter (Earth Shock draining Lightning Shield) is stamped at the same moment as the
		// spend, so the level the press saw is the one before it. Null before the first stretch and
		// null across a gap, on the same terms as a bar: "no reading yet" and "zero stacks" are
		// different facts about the pull, and zero is the wrong answer for Lightning Shield at the
		// pull.
		stacks: (key) => {
			const levels = inputs.stackLevels?.[key];
			if (levels === undefined || levels.length === 0) return null;
			return levelAt(levels, t);
		},
	};
}

/**
 * The bars and the clock at one press, reconstructed from the curves and the presses that came before.
 *
 * Two instants, because the honest answer needs both. `decidedAt` is when the player committed and is
 * what everything about the *choice* is read at — the target band here, and the auras and cooldowns in
 * `readerAt` and `cooldownsAt` beside it. `landedAt` is when the press completed, and the bars are read
 * there for a mechanical reason rather than a principled one: a resource reading exists only on the
 * `cast` event, so the pre-spend value this function's own doc relies on is stamped at the landing. A
 * bar probed at `decidedAt` would return the *previous* press's post-spend reading instead, which is a
 * different press's number and worse than the one it replaced.
 *
 * The two are equal for every instant press, and Elemental — the only spec with cast times — declares
 * `barsRequired: false` and hands over empty curves, so no shipped figure depends on the split today.
 * It is written down because the next cast-time spec that reads a bar will, and interpolating a
 * reading that nobody held is not the answer.
 */
function stateAt(decidedAt: number, landedAt: number, inputs: AplInputs): State {
	const energy = valueAt(inputs.energy, landedAt);
	const energyMax = inputs.energy.max;
	return {
		// The state's own clock is the decision instant, so every rule reading `state.t` — `bandFor`,
		// `ready`, each rule's own `condition` — is judged at the commit without having to know it.
		t: decidedAt,
		chi: valueAt(inputs.chi, landedAt),
		chiMax: inputs.chi.max,
		energy,
		energyMax,
		// Null rather than zero for a log that reported no regen at all, and null rather than zero for a
		// press ahead of the first reading. Zero seconds to cap is not the absence of an answer, it is
		// the specific claim that the bar is overflowing — it silently satisfied the overflow clause at
		// every press of a pull whose regen could not be measured, and falsified every "there is room in
		// the bar" condition above it.
		timeToEnergyCapSec:
			energy === null || !(inputs.regenPerSec > 0) ? null : Math.max(0, energyMax - energy) / inputs.regenPerSec,
		pullMs: inputs.pullMs,
		gcdSec: inputs.gcdMs / 1000,
		fofChannelSec: inputs.fofChannelSec,
		regenPerSec: inputs.regenPerSec,
		// `?? null` and not `?? new Set()`: a spec that wired no gear has said nothing about the kit, which
		// is the same answer as a log with no `combatantinfo` and not the same as a player wearing nothing.
		equippedItems: inputs.equippedItems ?? null,
		// The reader's override wins outright when there is one: it answers a question the log cannot,
		// namely that ignoring the adds was a decision rather than an oversight.
		//
		// The damage band. `bandFor` below swaps in the trigger band for the rules that want it — this is
		// the base state, so a spec that declares no hit-count trigger never sees a second number.
		band: inputs.forceBand ?? bandOf(inputs.targetsAt(decidedAt)),
	};
}

/**
 * The band a single rule is judged at.
 *
 * Damage unless the rule's own ability says its benefit is a hit-count trigger, in which case the count
 * of units *hit* is the one that decides whether the list wanted the button. The reader's forced band
 * still wins over both: it is an answer about the player's intent, and intent does not split by ability.
 *
 * Falls through to the damage band whenever the spec supplied no trigger count, so the two-count split
 * costs a spec that has no such ability nothing at all — not a branch, not a second series.
 */
function bandFor(rule: AplRule, state: State, inputs: AplInputs): Band {
	if (inputs.forceBand !== undefined) return state.band;
	const triggerTargetsAt = inputs.triggerTargetsAt;
	if (triggerTargetsAt === undefined) return state.band;
	if (inputs.benefitOf?.(rule.id) !== 'trigger') return state.band;
	return bandOf(triggerTargetsAt(state.t));
}

/**
 * Whether a rule's button was off cooldown at this moment. A rule with no cooldown is always ready.
 *
 * `readyWhen` answers first: it is the button's own clock being reset from outside, and a reset
 * cannot be late — the press the player just made is the reset having landed.
 */
// `t` is the decision instant and `lastCast` holds landing instants, and the asymmetry is deliberate:
// the question is "was it off cooldown when I chose", and a spell's cooldown starts when the cast
// *completes*. Reading both off the same clock would be wrong in one direction or the other.
//
// That premise is the simulator's, not this file's opinion, and it is worth citing outward because
// three sites in this repo assert it and until now each cited the other two. In `wowsims-mop`, a spell
// with a cast time takes the hardcast branch at `sim/core/cast.go:178` and is handed a `Hardcast` whose
// `OnComplete` (`:187`) is what calls `spell.triggerCooldown(sim)` (`:205`); `triggerCooldown` sets
// `spell.CD` to `sim.CurrentTime + cd` (`:258-268`), and that callback is fired by a pending action
// scheduled at `Hardcast.Expires` — `begincast + castTime` (`sim/core/gcd.go:8-24`). So `sim.CurrentTime`
// there *is* the landing, and the cooldown is armed at the landing. An instant press runs the same two
// statements inline at `:241`, where the two instants coincide anyway.
function ready(rule: AplRule, t: number, lastCast: ReadonlyMap<number, number>, auras: AuraReader): boolean {
	if (rule.cooldownMs === undefined) return true;
	if (rule.readyWhen !== undefined && rule.readyWhen(auras)) return true;
	const last = lastCast.get(rule.id);
	return last === undefined || t - last >= rule.cooldownMs;
}

/** Cooldown state at a moment, read off the presses that came before. */
function cooldownsAt(
	t: number,
	ladder: readonly AplRule[],
	lastCast: ReadonlyMap<number, number>,
	offLadder?: AplInputs['offLadderCooldowns'],
): CooldownReader {
	const cooldownBy = new Map<number, number>();
	for (const rule of ladder) {
		if (rule.cooldownMs !== undefined && !cooldownBy.has(rule.id)) cooldownBy.set(rule.id, rule.cooldownMs);
	}
	if (offLadder !== undefined) {
		for (const [id, cfg] of Object.entries(offLadder)) {
			if (cfg !== undefined) cooldownBy.set(Number(id), cfg.cooldownMs);
		}
	}
	return {
		readyInSec: (id) => {
			const cooldownMs = cooldownBy.get(id);
			if (cooldownMs === undefined) return 0;
			const off = offLadder?.[id];
			let last: number | undefined;
			if (off !== undefined) {
				// An off-GCD button's presses are not in the walk's `lastCast` — that is built from
				// on-GCD casts — so the latest press is read off the clock the spec provided.
				let lo = 0;
				let hi = off.casts.length - 1;
				while (lo <= hi) {
					const mid = (lo + hi) >> 1;
					const at = off.casts[mid];
					if (at === undefined) break;
					if (at <= t) {
						last = at;
						lo = mid + 1;
					} else hi = mid - 1;
				}
			} else {
				last = lastCast.get(id);
			}
			if (last === undefined) return 0;
			return Math.max(0, last + cooldownMs - t) / 1000;
		},
	};
}

/**
 * Whether the player could pay for a rule's button, counting the aura that sometimes waives the cost.
 *
 * Three-valued for the same reason a condition is: a cost this log cannot check is not a cost the
 * player failed to meet. Only a cost that is actually charged consults its bar, so a free button stays
 * decidable on a pull whose bars open late.
 */
function affordable(rule: AplRule, state: State, auras: AuraReader, reduction: number): Truth {
	if (rule.freeWhen?.(state, auras) === true) return true;
	// The tier reduction applies to the chi spenders the sim applies it to, and never takes a
	// cost below zero.
	const chi = Math.max(0, rule.chiCost - (rule.chiCost > 0 ? reduction : 0));
	if (chi > 0 && state.chi === null) return 'unknown';
	if (rule.energyCost > 0 && state.energy === null) return 'unknown';
	return (state.chi ?? 0) >= chi && (state.energy ?? 0) >= rule.energyCost;
}

/**
 * Whether the player brought the talent a rung sits on — the gate `talent: true` opens.
 *
 * **The reading first, the inference only where there is nothing to read.** A log carrying a talent list
 * answers this outright, in both directions: the row is in it or it is not, and "not in it" is a fact
 * about the player's build rather than about their pull. That second direction is what the old gate could
 * never say. It ran on `seen.has(rule.id)` alone — the log showing the button *pressed* — which is sound
 * one way round and not the other: a press proves the talent, silence proves nothing, and reading silence
 * as "did not take it" deletes the rung from the list for a player who simply never got round to the
 * button. Every rung below is then walked against a ladder that is not theirs.
 *
 * **A log with no talent list is left on the proxy rather than answered `'unknown'`**, which is the one
 * place this departs from the kit's three-valued discipline and the reason it is not `Truth`. The
 * argument and the numbers are at `AplInputs.knownTalents`; the short of it is that a talent has a second
 * witness in the cast stream where a trinket has none, that the strict arm was measured to silence up to
 * 88% of a pull's globals off one missing event, and that at that silence the section's own headline
 * turns into a 100% and a "nothing was passed over" — so the per-pull note the strict arm was waiting on
 * (`AplAudit.characterUnread`) does not rescue it. The note landed; this did not.
 *
 * A spec that supplied no `knownTalents`, or a rung that named no `talentId`, is on the proxy too, so
 * nothing about such a ladder moves — the Windwalker's three talent rungs included.
 */
function knowsTalent(rule: AplRule, inputs: AplInputs, seen: ReadonlySet<number>): boolean {
	if (rule.talent !== true) return true;
	const known = inputs.knownTalents;
	if (rule.talentId === undefined || known === undefined || known === null) return seen.has(rule.id);
	return known.has(rule.talentId);
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
	cooldowns: CooldownReader,
	seen: ReadonlySet<number>,
	reduction: number,
	lastCast: ReadonlyMap<number, number>,
	ladder: readonly AplRule[],
	inputs: AplInputs,
): AplPress {
	// Declared off this ladder's business, so the walk never starts: there is no rung to measure the press
	// against, and the section named here is the one that answers for it. Ahead of every gate below on
	// purpose — which section judges a button is a fact about the button, not about how many enemies were
	// up when it was pressed, so this verdict has to be the same at all four bands.
	const delegatedTo = inputs.unarbitrated?.[cast.id];
	if (delegatedTo !== undefined)
		return {
			t: cast.t,
			decidedAt: state.t,
			pressed: cast.id,
			wanted: null,
			reason: delegatedTo,
			verdict: 'off-list',
		};

	for (const rule of ladder) {
		// The band *this rule* is judged at, which is not one number per press: a hit-count trigger bands
		// on the units hit and everything else on the units damaged. Resolved per rule and substituted
		// into the state the rule then reads, so a condition testing `state.band` cannot pick up the
		// other count by accident. Identity-checked so the common case allocates nothing.
		const band = bandFor(rule, state, inputs);
		const ruleState: State = band === state.band ? state : { ...state, band };
		// Not in the list at this target count, so it is not a button the press passed over. Checked
		// before the talent gate and before the cooldown, because an entry outside its band is absent
		// rather than unavailable.
		if (rule.bands !== undefined && !rule.bands.includes(band)) continue;
		// Replaced on the character's bars, so it is not a button that could have been pressed.
		if (rule.replacedBy !== undefined && seen.has(rule.replacedBy)) continue;
		// A talent row is only demanded of a player who took it. Baseline buttons carry no such gate, so
		// never pressing one is a fault this ladder can still name. Two-valued, and where it always was:
		// see `knowsTalent` for why the third answer is not taken and what it was measured to cost.
		if (!knowsTalent(rule, inputs, seen)) continue;
		if (!ready(rule, state.t, lastCast, auras)) continue;

		// A rule the press itself satisfies is not worth stopping for: pressing the button the list might
		// have wanted cannot be the mistake the unknown is hiding.
		const unreadable = (): AplPress =>
			rule.id === cast.id
				? {
						t: cast.t,
						decidedAt: state.t,
						pressed: cast.id,
						wanted: rule.key,
						reason: rule.reason?.(ruleState) ?? null,
						verdict: 'followed',
					}
				: { t: cast.t, decidedAt: state.t, pressed: cast.id, wanted: null, reason: null, verdict: 'unknown' };

		const wants = rule.condition(ruleState, auras, cooldowns);
		if (wants === 'unknown') return unreadable();
		if (!wants) continue;
		// The same short-circuit as an unreadable condition, because it is the same failure: a bar the
		// log never carried cannot say whether the player could pay, and a rung that might have been
		// wanted and might have been affordable is not one a lower press can be graded against.
		const canPay = affordable(rule, ruleState, auras, reduction);
		if (canPay === 'unknown') return unreadable();
		if (!canPay) continue;

		return rule.id === cast.id
			? {
					t: cast.t,
					decidedAt: state.t,
					pressed: cast.id,
					wanted: rule.key,
					reason: rule.reason?.(ruleState) ?? null,
					verdict: 'followed',
				}
			: {
					t: cast.t,
					decidedAt: state.t,
					pressed: cast.id,
					wanted: rule.key,
					reason: rule.reason?.(ruleState) ?? null,
					verdict: 'skipped',
				};
	}

	// Nothing on the ladder wanted the global. A cooldown, a defensive, a taunt — or a rotational
	// button the player could not afford, which is a resource problem the energy and chi sections
	// already argue about rather than a priority mistake.
	//
	// `reason: null`, and that is the difference from the declared case at the top of this function: this
	// arm is the *list* having nothing to say, and it is only reachable at all for a ladder whose bottom
	// rung can refuse. A ladder ending in an unconditional filler never gets here.
	return { t: cast.t, decidedAt: state.t, pressed: cast.id, wanted: null, reason: null, verdict: 'off-list' };
}

/**
 * Walk the pull, press by press, and ask the list what it wanted.
 *
 * Returns `null` — not an empty audit — only when the log carried no resource readings to walk. An
 * add fight used to return `null` here too, on the grounds that the ladder was the single-target
 * list; it is not any more. The list bands on target count and this walk reads the band at each
 * press, so a wave fight is judged against what the list actually wanted during the waves.
 */
export function aplAudit(inputs: AplInputs, ladder: readonly AplRule[]): AplAudit | null {
	if (inputs.barsRequired !== false && (inputs.energy.points.length === 0 || inputs.chi.points.length === 0))
		return null;

	const reduction = inputs.chiCostReduction ?? 0;
	/**
	 * The presses that cost a global, in the order they were **decided**.
	 *
	 * Re-sorted, and it has to be. `marks` arrives sorted by landing, and once cast times differ the two
	 * orders are different permutations: an instant pressed 200ms after a 2.5s Lightning Bolt landed was
	 * committed 2.3s *before* it. This walk builds `lastCast` forward as it goes, so a walk in landing
	 * order judging at the commit instant would check a cooldown against a press that had not been made
	 * yet.
	 *
	 * The re-sort itself is tiny, and it used to be recorded here as the size of the whole change — "1-2
	 * presses per pull", which read as though the clock hardly mattered. Measured position by position it
	 * is smaller still: **`phased` and `cleave` do not reorder at all, and `unbroken` reorders one
	 * adjacent pair.** What the clock is actually worth is the *re-reading*, not the reordering, and that
	 * is two orders of magnitude larger — judging at the landing instead moves **32 of 204** verdicts on
	 * `cleave`, 18 of 159 on `phased` and 12 of 142 on `unbroken`, with 39/23/16 presses changing which
	 * rung they are measured against. Followed counts go 99→95, 107→93 and 97→85 — so the landing clock is
	 * also the *harsher* one on all three pulls, which is worth knowing before anyone reads the move as
	 * grade inflation.
	 *
	 * One movement is common to all three pulls, and it is the cooldown case this walk's `lastCast`
	 * asymmetry is about: 5 presses on `cleave`, 8 on `phased` and 9 on `unbroken` where the landing clock
	 * demanded Lava Burst and the commit clock finds the pressed Lightning Bolt correct, because Lava
	 * Burst's cooldown was still running when the player chose and back up by the time their bolt arrived.
	 * The single largest group is `cleave`-only and runs the other way: 10 presses the landing clock called
	 * a followed Chain Lightning and the commit clock calls a skipped Flame Shock. The two directions
	 * partly cancel, which is why the followed count on that pull moves by only 4 while 32 verdicts do: 18
	 * presses gain `followed` under the commit clock and 14 lose it. Reading either column alone
	 * understates the change by most of an order of magnitude.
	 *
	 * On the Windwalker none of it applies and that is a fact rather than an expectation: 0 of 394 presses
	 * on `dataset-ironJuggernaut` have `begin < t`, because that spec declares no `castTimeMs` and even
	 * Fists of Fury logs its `cast` at the start of the channel. `__tests__/apl.test.ts`' clock guard is
	 * therefore hand-built — no committed Windwalker pull can exercise this walk's clock at all.
	 */
	const onGcd = inputs.casts
		.filter((c) => c.onGcd)
		.map((c) => ({ ...c, decidedAt: c.begin ?? c.t }))
		.sort((a, b) => a.decidedAt - b.decidedAt || a.t - b.t);
	const seen = new Set(onGcd.map((c) => c.id));

	// When each rule's button was last pressed, walked forward with the casts so a cooldown check is a
	// subtraction rather than a scan.
	const lastCast = new Map<number, number>();

	const presses: AplPress[] = [];
	const skips = new Map<AplRuleKey, number>();

	for (const cast of onGcd) {
		// Judged at the commit throughout — the auras, the cooldown queries and the target band are all
		// read at the moment the player chose, which is the thing the priority list decides. The bars are
		// the one exception and `stateAt` explains why.
		const state = stateAt(cast.decidedAt, cast.t, inputs);
		const auras = readerAt(cast.decidedAt, inputs);
		const cooldowns = cooldownsAt(cast.decidedAt, ladder, lastCast, inputs.offLadderCooldowns);
		const verdict = judge(cast, state, auras, cooldowns, seen, reduction, lastCast, ladder, inputs);
		presses.push(verdict);
		if (verdict.verdict === 'skipped' && verdict.wanted !== null) {
			skips.set(verdict.wanted, (skips.get(verdict.wanted) ?? 0) + 1);
		}
		// The landing, not the commit: a cooldown starts when the cast completes, so this is what a later
		// `ready()` has to subtract from. See the note on `ready`.
		lastCast.set(cast.id, cast.t);
	}

	return {
		presses,
		followed: presses.filter((p) => p.verdict === 'followed').length,
		skipped: presses.filter((p) => p.verdict === 'skipped').length,
		unknown: presses.filter((p) => p.verdict === 'unknown').length,
		offList: presses.filter((p) => p.verdict === 'off-list').length,
		skippedBy: [...skips]
			.map(([key, count]) => ({ key, id: ladder.find((r) => r.key === key)?.id ?? 0, count }))
			.sort((a, b) => b.count - a.count),
		// Wired-and-null, on either half. `undefined` is the spec never having asked the question, which is
		// not the log declining to answer it — the Windwalker ladder gates no rung on the sheet and must
		// not start claiming its logs are missing one.
		characterUnread: inputs.equippedItems === null || inputs.knownTalents === null,
	};
}
