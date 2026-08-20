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
	/** Not a rotational button — a cooldown, a defensive, a taunt. Never a fault. */
	| 'off-list';

export interface AplPress {
	/** Fight-relative ms, like every other timestamp in this report. */
	t: number;
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
	 * Resolved by the spec through its own registry — `abilityByCastId(id)?.multiTargetBenefit` — rather
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
	 * Cooldown clocks for buttons that are not rungs but that a rule reads.
	 *
	 * `readyInSec` is otherwise built from the ladder's own cooldowns and the on-GCD presses this
	 * walk sees, neither of which knows Ascendance — it is off the ladder, off the GCD, and the
	 * Elemental ladder's Earth Shock rule is written in units of when it is coming back.
	 */
	offLadderCooldowns?: Readonly<Partial<Record<number, { cooldownMs: number; casts: readonly number[] }>>>;
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
	 * Taken from the log — a talent the player did not choose is not a mistake, and this report cannot
	 * read a talent tree out of the event stream, so "was it ever pressed" is the only evidence there
	 * is. Deliberately *not* applied to the baseline buttons: inferring those the same way would mean a
	 * player who never pressed the spec's core spender at all was never told, which is the single worst
	 * thing this ladder exists to catch.
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
		// bell.
		stacks: (key) => {
			const levels = inputs.stackLevels?.[key];
			if (levels === undefined || levels.length === 0) return null;
			return levelAt(levels, t);
		},
	};
}

/** The bars and the clock at one press, reconstructed from the curves and the presses that came before. */
function stateAt(t: number, inputs: AplInputs): State {
	const energy = valueAt(inputs.energy, t);
	const energyMax = inputs.energy.max;
	return {
		t,
		chi: valueAt(inputs.chi, t),
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
		// The reader's override wins outright when there is one: it answers a question the log cannot,
		// namely that ignoring the adds was a decision rather than an oversight.
		//
		// The damage band. `bandFor` below swaps in the trigger band for the rules that want it — this is
		// the base state, so a spec that declares no hit-count trigger never sees a second number.
		band: inputs.forceBand ?? bandOf(inputs.targetsAt(t)),
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
		// A talent row is only demanded of a player the log shows chose it. Baseline buttons carry no
		// such gate, so never pressing one is a fault this ladder can still name.
		if (rule.talent === true && !seen.has(rule.id)) continue;
		if (!ready(rule, state.t, lastCast, auras)) continue;

		// A rule the press itself satisfies is not worth stopping for: pressing the button the list might
		// have wanted cannot be the mistake the unknown is hiding.
		const unreadable = (): AplPress =>
			rule.id === cast.id
				? {
						t: state.t,
						pressed: cast.id,
						wanted: rule.key,
						reason: rule.reason?.(ruleState) ?? null,
						verdict: 'followed',
					}
				: { t: state.t, pressed: cast.id, wanted: null, reason: null, verdict: 'unknown' };

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
					t: state.t,
					pressed: cast.id,
					wanted: rule.key,
					reason: rule.reason?.(ruleState) ?? null,
					verdict: 'followed',
				}
			: {
					t: state.t,
					pressed: cast.id,
					wanted: rule.key,
					reason: rule.reason?.(ruleState) ?? null,
					verdict: 'skipped',
				};
	}

	// Nothing on the ladder wanted the global. A cooldown, a defensive, a taunt — or a rotational
	// button the player could not afford, which is a resource problem the energy and chi sections
	// already argue about rather than a priority mistake.
	return { t: state.t, pressed: cast.id, wanted: null, reason: null, verdict: 'off-list' };
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
	const onGcd = inputs.casts.filter((c) => c.onGcd);
	const seen = new Set(onGcd.map((c) => c.id));

	// When each rule's button was last pressed, walked forward with the casts so a cooldown check is a
	// subtraction rather than a scan.
	const lastCast = new Map<number, number>();

	const presses: AplPress[] = [];
	const skips = new Map<AplRuleKey, number>();

	for (const cast of onGcd) {
		const state = stateAt(cast.t, inputs);
		const auras = readerAt(cast.t, inputs);
		const cooldowns = cooldownsAt(cast.t, ladder, lastCast, inputs.offLadderCooldowns);
		const verdict = judge(cast, state, auras, cooldowns, seen, reduction, lastCast, ladder, inputs);
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
			.map(([key, count]) => ({ key, id: ladder.find((r) => r.key === key)?.id ?? 0, count }))
			.sort((a, b) => b.count - a.count),
	};
}
