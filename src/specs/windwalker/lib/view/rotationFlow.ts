// The priority list as a reader sees it, rather than as a verdict on a pull.
//
// `lib/spec/apl.ts` is the list. This module is what a reference table is allowed to know about it:
// the order, the button on each rung, the bands a rung exists in, and which buttons cannot be on a
// bar together. Everything structural is read from `LADDER_ENTRIES`; what is written out here is
// only what the ladder deliberately does not model, and each of those is named below with the reason
// `apl.ts` gives for excluding it.
//
// It is a module rather than a constant inside `Rotation.tsx` for one reason: the whole value of
// deriving the rungs is that the two lists cannot drift, and "cannot drift" is a property a test has
// to assert. A component cannot be asked what it would render at three targets for a monk who took
// Rushing Jade Wind without mounting it.
//
// The *shape* it hands back is no longer its own. `FlowSlot`, `FlowEntry` and the `rotation.entry.*`
// convention they are read through live in `lib/view/rotationFlow`, because all three specs' reference
// sections are drawn by one chart now and a shape declared under one of them would be a shape the
// other two import across a spec root. What stays here is everything that is actually about the
// Windwalker: the prelude the ladder refuses to model, the talent rows, the Rune, and the four counts
// at which this list changes button.

import { SHARED_ITEM_SOURCES } from '~/lib/game/shared';
import { LADDER_ENTRIES } from '~/specs/windwalker/lib/apl';
import type { WW_AplRuleKey } from '~/specs/windwalker/lib/apl';
import type { Band } from '~/lib/spec/apl';
import type { CastRow, GearSlot } from '~/lib/types';
import type { FlowSlot } from '~/lib/view/rotationFlow';

/**
 * A branch before filtering.
 *
 * `gate` separates the two kinds of chip a rung can carry, because only one of them survives a
 * reader fixing the target count. A `targets` chip says "this rung is read from three enemies up",
 * which is worth printing while the flow shows every band and is noise once the flow has been
 * filtered to one — the note above it already says which count is being read. An `always` chip says
 * something the target count has nothing to do with, like whether the Rune of Re-Origination is
 * equipped, and stays whatever the reader picks.
 */
interface Branch {
	key: string;
	id: number;
	gate?: 'targets' | 'always';
	/** Whether this branch requires the Rune of Re-Origination. */
	rune?: boolean;
	/** The bands this branch is the one that fires in. Omitted means all four. */
	bands?: readonly Band[];
}

type Rung = { entry: Branch } | { fork: string; branches: readonly Branch[] };

const ALL_BANDS: readonly Band[] = [1, 2, 3, 4];

/**
 * The rungs above the modelled ladder, which is the one part of this list that stays hand-written.
 *
 * They are hand-written because `apl.ts` refuses to model them, and its opening docstring gives the
 * reason for each: Chi Brew, Tigereye Brew, Energizing Brew and Xuen (10, 12, 13, 15, 16) are cooldown
 * decisions rather than decisions about a filler global, each already judged by a section of its own.
 * Storm, Earth and Fire (5) is not on that list because it never reached the ladder at all, and it
 * belongs with the cooldowns for the same reason — `StormEarthAndFire` grades its placement with far
 * more room than a per-press verdict would give it.
 *
 * Touch of Death (3) is up here for a different reason, and this comment used to give the wrong one: that
 * it "tests a health threshold no event in this report carries" and that a ladder guessing at it "would
 * poison every press below it into cannot say". Neither holds. Priority 3's condition is chi and how much
 * of the pull is left (`sim/monk/touch_of_death.go:40-42`), both of which the ladder already reads, and it
 * is false rather than unknown everywhere outside the final second — so nothing below it is poisoned. What
 * keeps it up here is that the sim's remaining-duration term is a stand-in for execute range, and the walk
 * cannot tell a kill from a wipe. `apl.ts` carries the argument, the measured cost, and the one input that
 * would let the rung move down into the modelled half.
 *
 * The seam is held by `rotationFlow.test.ts`, which writes out the whole expected rung order with its
 * APL index beside each. That is a second reader rather than a derivation: a test computing its
 * expectation from the same arrays this file walks would pass whatever they said, and the failure
 * being guarded against is precisely the two halves drifting apart unnoticed.
 *
 * Storm, Earth and Fire carries the only band gate up here; the rest are read at any target count.
 *
 * Four kinds of APL entry are dropped from both halves and stay dropped. None of them is a decision
 * about how to spend a *global*, which is what this flow is a list of:
 *
 * - The elixir and weapon-swap groups (1, 2, 7, 8) and the potion, trinket and racial group (6) are
 *   off-GCD item presses. They are dropped because they cost none of the globals this list
 *   arbitrates, and for no other reason — see the corrected bullet in `apl.ts`. The elixir weave in
 *   particular is real technique that a real player executes to the APL's own conditions, the sim
 *   ships it as a `hide: true` opt-in rather than as a simulator artefact, and `notes.snapshot` below
 *   tells the reader to do it. Dropping it from a list of globals is not calling it fake.
 * - The Chi Sphere pickup and the Arcane Torrent chi return (9, 11), and the tier-15 energy sphere
 *   (14), are resource pickups rather than presses.
 *
 * Nothing here enumerates `ABILITIES` in `spec/windwalker.ts`, deliberately: the flow is the priority
 * list, not the spellbook, so a consumable or a trinket added to the registry cannot appear as a rung.
 * The rungs come from `LADDER_ENTRIES` and from this array, and from nowhere else.
 */
const PRELUDE: readonly Rung[] = [
	{ entry: { key: 'touchOfDeath', id: 115080 } }, // 3
	{ entry: { key: 'stormEarthAndFire', id: 138228, gate: 'targets', bands: [2, 3, 4] } }, // 5
	{ entry: { key: 'chiBrew', id: 115399 } }, // 10
	{
		// 12 and 13: the same button under two rule sets that share almost no condition, chosen by
		// `RoRo: Equipped` — a variable the sim declares at the bottom of the file precisely so it can
		// branch on it. The one fork on this page the whole report turns on.
		fork: 'tigereyeBrew',
		branches: [
			{ key: 'tigereyeBrewRune', id: 1247275, gate: 'always', rune: true },
			{ key: 'tigereyeBrewBank', id: 1247275, gate: 'always', rune: false },
		],
	},
	{ entry: { key: 'energizingBrew', id: 115288 } }, // 15
	{ entry: { key: 'invokeXuen', id: 123904 } }, // 16, via the unconditional autocast
];

/**
 * What each modelled rung looks like on the page, keyed by the ladder's own rule key.
 *
 * A `Record<WW_AplRuleKey, …>` and not a lookup with a fallback: a rule added to `LADDER` fails to
 * compile until it has a rung here, and a rule renamed there is a compile error rather than a rung
 * that quietly stops rendering. That exhaustiveness is the whole reason the map is keyed this way.
 *
 * No order and no bands in here. Both come from `LADDER_ENTRIES`, which is the point — the order is
 * the sim's evaluation order and the bands are its `numberTargets` branches, and neither is a
 * decision this file gets to make. Branch-level `bands` appear only where one APL entry holds two
 * conditions that the target count picks between, and they are subsetted against the ladder's.
 */
const DISPLAY: Record<WW_AplRuleKey, Rung> = {
	'rushing-jade-wind-open': { entry: { key: 'rushingJadeWindMulti', id: 116847, gate: 'targets' } },
	// 18: `Targets: More than 1 and (auraRemainingTime(CurrentTarget, 130320) <= GCD or
	// not(Targets: More than 2))`, read out of `default.apl.json`. 130320 is Rising Sun Kick's own
	// debuff, not Tiger Power (125359), which belongs to entry 19 below.
	//
	// The leading `Targets: More than 1` takes the entry off the list altogether at one enemy, where the
	// kick now falls through to the unconditional entry 21 — below Tiger Palm's refresh. What is left is
	// one entry with two rule sets and the target count picking between them: at exactly two the second
	// half of the `or` is true and the kick simply goes on cooldown, and from three only the expiring
	// debuff claims this rung. Drawn as a fork for the same reason entry 32 is — a single rung cannot
	// say both without saying neither.
	//
	// The cooldown branch is `[2]` and not `[1, 2]` for that reason. It is intersected with the ladder's
	// own bands either way and neither list can widen the other, so writing it here is a second reader
	// of the gate rather than the authority on it.
	'rising-sun-kick': {
		fork: 'risingSunKick',
		branches: [
			{ key: 'risingSunKickCooldown', id: 107428, gate: 'targets', bands: [2] },
			{ key: 'risingSunKickHold', id: 107428, gate: 'targets', bands: [3, 4] },
		],
	},
	'tiger-palm-refresh': { entry: { key: 'tigerPalmRefresh', id: 100787 } },
	'spinning-crane-kick-heavy': { entry: { key: 'craneOverKick', id: 101546, gate: 'targets' } },
	'rising-sun-kick-filler': { entry: { key: 'risingSunKickMulti', id: 107428 } },
	'spinning-crane-kick': { entry: { key: 'spinningCraneKick', id: 101546, gate: 'targets' } },
	// 23, then 26 and 30, then 28. One talent row, so the three are never on a bar together and their
	// order against each other is unobservable — which is the licence to draw them level. Only Chi Wave
	// is on the ladder: the other two are excluded there for the same reason the cooldowns are, and are
	// carried here because a reader who took one of them still needs to find their rung.
	'chi-wave': {
		fork: 'talent',
		branches: [
			{ key: 'chiWave', id: 115098 },
			{ key: 'zenSphere', id: 124081 },
			{ key: 'chiBurst', id: 123986 },
		],
	},
	'combo-breaker-kick': { entry: { key: 'comboBreakerKick', id: 100784 } },
	'fists-of-fury': { entry: { key: 'fistsOfFury', id: 113656 } },
	'combo-breaker-palm': { entry: { key: 'tigerPalmProc', id: 100787 } },
	jab: { entry: { key: 'jab', id: 100780 } },
	// 31: no longer the free fallthrough it was — `(currentTime + remainingTime) < 75s or
	// Energy: Time to Cap <= 1s`. The first half is the whole fight's length rather than the time
	// elapsed, so on a pull over 75 seconds it is false throughout and only the overflow check is left.
	// Neither half is a target count, so there is nothing here for a band or a gate chip to carry and
	// the condition lives entirely in this rung's copy.
	'rushing-jade-wind': { entry: { key: 'rushingJadeWind', id: 116847 } },
	// 32: a single entry whose condition is one energy reserve or the other, with the target count
	// picking between them. Two branches of one `or`, drawn as two branches.
	'blackout-kick': {
		fork: 'blackoutKick',
		branches: [
			{ key: 'blackoutKick', id: 100784, gate: 'targets', bands: [1, 2] },
			{ key: 'blackoutKickDump', id: 100784, gate: 'targets', bands: [3, 4] },
		],
	},
};

/** A branch's bands narrowed by the bands its ladder entry exists in. Neither list gets to widen the other. */
function narrow(branch: Branch, bands: readonly Band[]): Branch {
	const own = branch.bands ?? ALL_BANDS;
	return { ...branch, bands: own.filter((b) => bands.includes(b)) };
}

function rungAt(entry: (typeof LADDER_ENTRIES)[number]): Rung {
	const rung = DISPLAY[entry.key];
	return 'entry' in rung
		? { entry: narrow(rung.entry, entry.bands) }
		: { fork: rung.fork, branches: rung.branches.map((b) => narrow(b, entry.bands)) };
}

/** The whole list: the entries the ladder refuses to model, then the ladder, in the ladder's order. */
const RUNGS: readonly Rung[] = [...PRELUDE, ...LADDER_ENTRIES.map(rungAt)];

/**
 * The two talent rows this list draws from, as `proto/monk.proto` declares them.
 *
 * Rows rather than "buttons that are talents", and that distinction is the whole safety argument
 * below: a row is a set of buttons of which exactly one can exist, so pressing any one of them is
 * evidence *about the others*. A talent read in isolation has no such evidence behind it.
 *
 * Chi Torpedo is the third member of the level-90 row and is deliberately absent. `registerChiTorpedo`
 * in `sim/monk/talents.go` is an empty function — the sim does not model it, so this project has no
 * verified cast id for it, and an id guessed from memory that happened to collide with something else
 * would hide a rung on evidence that was never there. Its absence costs only that a monk who took it
 * is shown both of the other two rungs, which is the safe direction.
 */
const TALENT_ROWS: readonly (readonly number[])[] = [
	[115098, 124081, 123986], // 30: Chi Wave / Zen Sphere / Chi Burst
	[116847, 123904], // 90: Rushing Jade Wind / Invoke Xuen
];

/**
 * Every item version that supplies the Rune of Re-Origination in Mists Classic.
 *
 * The five ids are `game/shared.ts`' rather than this module's, on the same argument the `replacedBy`
 * pairs above are read off the ladder for: a second copy of a fact is the drift this module exists to
 * prevent, and it had one — `game/__tests__/sharedFixtures.test.ts`' gear census carried the identical
 * five with no way for either list to see the other. Which ilvl variants an item has is not a fact
 * about this reference table, and narrowing the set here would silently stop the warning firing for a
 * monk wearing any step but the one the fixture happens to wear.
 */
const RUNE_OF_REORIGINATION_ITEMS = new Set<number>(SHARED_ITEM_SOURCES['re-origination']);

/** Whether the reported gear contains the Rune, or null when gear was not reported at all. */
export function runeOfReOriginationEquipped(slots: readonly Pick<GearSlot, 'id'>[]): boolean | null {
	if (slots.length === 0) return null;
	return slots.some((slot) => RUNE_OF_REORIGINATION_ITEMS.has(slot.id));
}

/**
 * Buttons that cannot be on one bar, and therefore the only evidence this section will act on.
 *
 * The replacement pairs are read off the ladder rather than written out again. `apl.ts` already
 * carries `replacedBy` because its walk needs it — `registerSpinningCraneKick` opens with
 * `if monk.Talents.RushingJadeWind && monk.Level >= 90 { return }`, so a monk with the wind has no
 * Spinning Crane Kick at all — and a second copy of that fact here is exactly the drift this module
 * exists to prevent. The relation is symmetric for a reference even though the walk only ever needs
 * one direction of it: a single Spinning Crane Kick in the log proves the wind was not talented.
 */
const EXCLUSIVE: readonly (readonly number[])[] = [
	...TALENT_ROWS,
	// Through a `Map` because the ladder names the same replacement twice — both Spinning Crane Kick
	// rungs carry it — and the pair only needs stating once.
	...new Map(
		LADDER_ENTRIES.flatMap((e) =>
			e.replacedBy === undefined ? [] : [[`${String(e.id)}:${String(e.replacedBy)}`, [e.id, e.replacedBy]] as const],
		),
	).values(),
];

/**
 * Which buttons this log shows were never on the player's bar.
 *
 * **The rule: a rung is dropped only on positive evidence that a mutually-exclusive sibling was
 * taken. Never because the button itself was not pressed.** A log carries no talent tree, so "never
 * pressed" is the only signal available and it is the wrong one — it is indistinguishable from the
 * button a player forgot, and hiding that button is the single worst thing this section could do,
 * exactly as the `talent` docstring in `apl.ts` says. So absence proves nothing here and is never
 * read. Presence proves something about the *rest of the row*, and that is all this reads.
 *
 * "Exactly one" and not "at least one": two members of one talent row cannot both have been pressed,
 * so a log that shows both is a log this rule cannot make sense of, and it says nothing rather than
 * hiding one of them on a coin toss.
 *
 * The failure mode, stated: this is wrong only when the log records a press that was impossible —
 * a Spinning Crane Kick logged for a monk who has Rushing Jade Wind, or a level-89 character. Then a
 * rung the player does have is hidden. That is a narrower and rarer failure than the one the naive
 * rule guarantees, and unlike it, it cannot be caused by playing badly.
 *
 * Exported because the flow is no longer its only reader. A section about a talented button has the
 * same three states this answers — taken, proven absent, cannot say — and the middle one is the
 * dangerous one: printing "0% uptime" against a monk who never had the button on their bar is the
 * fabricated fault this rule exists to refuse. A second copy of it would be free to disagree with the
 * reference list about whether the button existed at all.
 */
export function excludedButtons(pressed: ReadonlySet<number>): ReadonlySet<number> {
	const out = new Set<number>();
	for (const row of EXCLUSIVE) {
		const taken = row.filter((id) => pressed.has(id));
		const only = taken.length === 1 ? taken[0] : undefined;
		if (only === undefined) continue;
		for (const id of row) if (id !== only) out.add(id);
	}
	return out;
}

/**
 * Every button this log saw pressed at least once.
 *
 * `CastRow.id` is the first id the log used for an ability rather than the spec's canonical one, which
 * matters for Jab — it logs a different id per weapon type — and for nothing in `EXCLUSIVE`, where
 * every button has exactly one id. Jab is baseline and can never be excluded, so the difference cannot
 * reach this rule.
 */
export function pressedButtons(casts: readonly CastRow[]): ReadonlySet<number> {
	return new Set(casts.filter((c) => c.count > 0).map((c) => c.id));
}

/**
 * A target count at which the button changes, and the rung that change lands on.
 *
 * The four chips above the chart are a contents page for the four crossovers, and they are printed
 * unfiltered on purpose — a reader whose list has just lost a rung needs the count that would bring it
 * back, which is the one thing a filtered index could not tell them. That is also how the index
 * acquired a way to lie: read at three enemies, `4+ · Crane Kick over Rising Sun Kick` names a rung
 * that the reading has taken off the page, and the reader goes looking for something that is not
 * there.
 *
 * So each chip carries the rung it names, and the section asks the drawn flow whether that rung
 * survived. A chip whose rung did not is drawn as what it is — a crossover outside this reading —
 * rather than as one of the three the reader can go and find.
 *
 * `key` is a `rotation.entry.<key>` and `copy` a `rotation.crossover.<copy>`; the pairing is asserted
 * against the unfiltered flow in `rotationFlow.test.ts`, so a renamed rung fails there rather than
 * silently marking a live crossover as absent.
 */
export interface Crossover {
	copy: string;
	key: string;
}

/** The four counts at which the list changes shape, in the order the index prints them. */
export const CROSSOVERS: readonly Crossover[] = [
	{ copy: 'rjw', key: 'rushingJadeWindMulti' },
	{ copy: 'sef', key: 'stormEarthAndFire' },
	{ copy: 'sck', key: 'spinningCraneKick' },
	{ copy: 'sckOverRsk', key: 'craneOverKick' },
];

/**
 * The four rungs whose chip the chart draws across the line rather than inside the box.
 *
 * They are exactly the crossovers, and the target count is the only thing that puts them there: in a
 * decision tree a count that takes the rung below off the page is a boundary the line crosses rather
 * than a label on a box. Everything else the Windwalker gates — the Rune branch, the two halves of a
 * split rung — is a chip on a lane, saying which of two alternatives this one is.
 *
 * Derived from `CROSSOVERS` rather than written out again, so a renamed rung cannot leave a band
 * pointing at copy no rung asks for.
 */
export const CROSSOVER_GATES: ReadonlyMap<string, string> = new Map(
	CROSSOVERS.map(({ key }) => [key, `rotation.gate.${key}`]),
);

export interface RotationFlowInput {
	/**
	 * The target count the flow is read at, or null to show every band.
	 *
	 * Null is not a default standing in for one target. A report captured before the counts existed
	 * genuinely has no answer, and picking one would hide rungs on the strength of a guess.
	 */
	band: Band | null;
	pressed: ReadonlySet<number>;
	/** Whether the Rune is equipped; null or omitted keeps both branches when gear cannot say. */
	rune?: boolean | null;
}

/**
 * The rungs to draw, in the sim's evaluation order.
 *
 * A fork left holding one branch is emitted as a plain rung rather than as a fork with one child:
 * once the band or the talent row has decided between the alternatives there is no longer a choice to
 * frame, and "which of the three you took" above a single answer reads as a bug.
 */
export function rotationFlow({ band, pressed, rune = null }: RotationFlowInput): readonly FlowSlot[] {
	const hidden = excludedButtons(pressed);
	const slots: FlowSlot[] = [];

	for (const rung of RUNGS) {
		const branches = 'entry' in rung ? [rung.entry] : rung.branches;
		const live = branches.filter(
			(b) =>
				!hidden.has(b.id) &&
				(band === null || (b.bands ?? ALL_BANDS).includes(band)) &&
				(b.rune === undefined || rune === null || b.rune === rune),
		);
		// A `targets` chip is dropped once the reader has fixed a count: the note above the flow already
		// says which one, and repeating it on nine rungs buries the two chips that still mean something.
		const entries = live.map((b) => ({
			key: b.key,
			id: b.id,
			gated: b.gate === 'always' || (b.gate !== undefined && band === null),
		}));
		const [first] = entries;
		if (first === undefined) continue;
		slots.push(entries.length === 1 || !('fork' in rung) ? { entry: first } : { fork: rung.fork, branches: entries });
	}

	return slots;
}
