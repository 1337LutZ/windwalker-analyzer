// The sweep behind both specs' `drawnAuras.test.ts`: every aura the log put on the player, by
// registry key, so a guard can ask which of them nothing draws.
//
// **And by raw id, which is a different question.** The key reading resolves through
// `registry.auraById` and drops what it cannot resolve, so it can only see auras the model declares.
// `auraIdsPutOnPlayer` and the three ledger checks below it drop that filter, which is what closes the
// third failure mode — see `game/__tests__/undeclaredAuras.test.ts` for the ledger and the argument.
//
// **Two halves of the stream, and the second one was missing.** `selfAuraEvents` scopes to the auras the
// log put *on* the player. An aura the player puts on an **enemy** is not in that stream at all, so two
// of the three guards in the family were structurally blind to the whole class — only the coverage
// ledger, which reads every `abilityGameID` in the file with no scope at all, could see one.
// `essence-of-yulon` is what that cost: 13, 18 and 16 applications across the three Elemental pulls,
// with no lane and no ledger entry, and no guard in the family able to say so. `enemyAuraEvents` is the
// other half, and it is filtered by **source as well as target** — see its own doc for why a
// target-only reading hands the ledger other people's spells and miscounts the ones it keeps.
//
// **Why it is one function and not two.** The two guards were written days apart and diverged in a
// way that mattered rather than a way that looked like style. The Windwalker's counted removals as
// evidence; the Elemental's counted applications and refreshes only. On the Windwalker's own fixture
// the difference was the whole finding — the raid's Time Warp went up before the pull, so its only
// event on the pull is a bare `removebuff` of 80353 at 39 971 ms, and the missing `bloodlust` row and
// the guard's inability to see it were the same fact. A guard that shares its blind spot with the bug
// it guards against is a poor guard, and two copies of one sweep is how that blind spot survived.
// `docs/conventions.md` is explicit about the shape of that mistake: copies carry the numbers and drop
// the reasoning, and two of them re-introduced the bug the original's comment existed to prevent.
//
// **Why it lives in `src/lib/analysis/` rather than under a `__tests__` folder.** `vitest.config.ts`
// collects `src/**/__tests__/**/*.ts` as suites — its own comment says a helper `.ts` with no suite in
// it fails the run — so a shared helper cannot go there at all. Here is where `conventions.md` sends a
// reader looking for spec-agnostic machinery before writing a second version of it, and the reading is
// genuinely spec-agnostic: it takes the `Registry` as an argument and names no spec, no ability and no
// id. It is not exported from `index.ts`, because the guards are its only callers and a barrel entry
// would advertise it to the engine.
//
// **Which fixtures the guards sweep is shared too, and separately.** `./fixtures.ts` is the neighbouring
// half: it walks both `__fixtures__` directories and classifies each `.json` as a raw `FightDataset` or a
// captured `Analysis`, because two of the three guards used to name their pulls as literals while the
// third walked the directory — so a newly committed fixture was swept by one of them and by the other two
// never. This file answers "what does the pull say"; that one answers "which pulls are there".
//
// **Evidence, not application.** "The log put this aura on the player" is the question, and every
// event that *moves* an aura answers it. An application is one kind of answer; a removal with no
// application in front of it is another, and is the ordinary signature of a raid cooldown, a pre-pull
// consumable or a pre-pull summon. A stack event is a third, and is not a rounding error: on the
// Elemental's `phased` and `unbroken` pulls `lightning-shield` reaches this sweep through
// `applybuffstack` and through nothing else. Narrowing the sweep is therefore a parameter rather than
// a rewrite, which is how the guards demonstrate what the narrow reading loses.

import {
	abilityIdOf,
	eventsFrom,
	eventsOn,
	isAuraApply,
	isAuraRefresh,
	isAuraRemove,
	isStackChange,
	type WclEvent,
} from '~/lib/events';
import type { Registry } from '~/lib/game/registry';
import type { Analysis, FightDataset } from '~/lib/types';

/** The kinds of event that count as the log putting an aura on somebody. */
export type AuraEvidence = 'applied' | 'refreshed' | 'removed' | 'stacked';

/** Every kind of evidence, which is what a guard wants unless it is demonstrating a blind spot. */
export const ALL_EVIDENCE: readonly AuraEvidence[] = ['applied', 'refreshed', 'removed', 'stacked'];

/**
 * Read through the `~/lib/events` guards rather than a regex on `type`.
 *
 * The regexes these guards used to carry — `/^(apply|refreshbuff|remove)/` and
 * `startsWith('apply') || type === 'refreshbuff'` — restated the event vocabulary and disagreed with
 * each other about it. `^apply` silently swept in `applybuffstack` and `applydebuffstack` while
 * `^remove` swept in only two of the four stack events, and `refreshbuff` alone missed
 * `refreshdebuff`, so which stack events counted was an accident of which prefix each guard chose.
 * Naming `'stacked'` makes that a decision instead.
 */
const isEvidence = (e: WclEvent, kinds: readonly AuraEvidence[]): boolean =>
	(kinds.includes('applied') && isAuraApply(e)) ||
	(kinds.includes('refreshed') && isAuraRefresh(e)) ||
	(kinds.includes('removed') && isAuraRemove(e)) ||
	(kinds.includes('stacked') && isStackChange(e));

/** Every aura event of the given kinds that landed on the audited player, in log order. */
export function selfAuraEvents(dataset: FightDataset, kinds: readonly AuraEvidence[] = ALL_EVIDENCE): WclEvent[] {
	return eventsOn(dataset.events, dataset.actor.id).filter((e) => isEvidence(e, kinds));
}

/**
 * Every aura event of the given kinds the audited player put on something **not known to be friendly**,
 * in log order — the other half of the sweep, and the half two of the three guards could not see.
 *
 * **Why the class needs a second reading at all.** `selfAuraEvents` scopes to `targetID === actor.id`,
 * so an aura the player puts on an *enemy* is not merely absent from it, it is unreachable by it. That
 * blind spot cost `essence-of-yulon` (146198), the caster legendary cloak's proc: 13, 18 and 16
 * applications on the three Elemental pulls, no lane and no ledger entry, and no guard in the family
 * able to flag it. The `NOT_LANES` ledger could not even excuse it, because `staleExcuses` rejects a
 * reason written for a key that fires on no sweep. Both specs' guards recorded the hole as a test rather
 * than closing it, and this is the closing half.
 *
 * **Filtered by source and not only by target, which is the decision.** The question is what the
 * *player's rotation* put on the enemy. A pull puts a great many auras on enemies that have nothing to
 * do with it — every other raider's debuffs, the encounter's own mechanics on its adds — and a
 * target-only reading would hand the undeclared-id ledger a list of other people's spells to classify.
 * It also gets the *counts* wrong for what it does keep: a second shaman with the tier set writes 144999
 * on the same boss, and an unsourced sweep would report their applications as this player's.
 *
 * **"Not known to be friendly", not "known to be an enemy"**, which is the same reading and the same
 * argument as `analyseCore`'s `friendlyIDs`: an id absent from the actor list is *unknown*, and
 * requiring proof of enemyhood would silently drop every real target on a report whose actor list came
 * back short — a guard sweeping nothing is the failure this family exists to catch. Players and their
 * pets are what the log positively declares friendly, so those are what is excluded; the player's own
 * pet is a pet. That also settles the summons: the Fire Elemental's Immolate (118297) on `cleave` is
 * *sourced* by the pet, so the source filter drops it without the target filter having to have an
 * opinion about whose spellbook a guardian's is.
 */
export function enemyAuraEvents(dataset: FightDataset, kinds: readonly AuraEvidence[] = ALL_EVIDENCE): WclEvent[] {
	const friendly = new Set(dataset.actors.filter((a) => a.type === 'Player' || a.type === 'Pet').map((a) => a.id));
	return eventsFrom(dataset.events, dataset.actor.id).filter(
		(e) => e.targetID !== undefined && !friendly.has(e.targetID) && isEvidence(e, kinds),
	);
}

/** Declared auras among a stream of aura events, by key. Undeclared ids are dropped, not counted. */
const countKeys = (events: readonly WclEvent[], registry: Registry): Map<string, number> => {
	const out = new Map<string, number>();
	for (const event of events) {
		const aura = registry.auraById(abilityIdOf(event) ?? -1);
		if (aura === undefined) continue;
		out.set(aura.key, (out.get(aura.key) ?? 0) + 1);
	}
	return out;
};

/** Every id in a stream of aura events, declared or not. */
const countIds = (events: readonly WclEvent[]): Map<number, number> => {
	const out = new Map<number, number>();
	for (const event of events) {
		const id = abilityIdOf(event);
		if (id === null) continue;
		out.set(id, (out.get(id) ?? 0) + 1);
	}
	return out;
};

/**
 * Two counts of the same kind, added — how a guard asks about both halves of the sweep at once.
 *
 * Generic over the key so the id reading and the key reading share it, because they must not disagree
 * about what "both halves" means. Summed rather than unioned: a count is evidence, and an aura the
 * player both takes and applies has both kinds of it.
 */
export function mergeCounts<K>(...counts: readonly ReadonlyMap<K, number>[]): Map<K, number> {
	const out = new Map<K, number>();
	for (const count of counts) for (const [key, n] of count) out.set(key, (out.get(key) ?? 0) + n);
	return out;
}

/**
 * Every *declared* aura the log put on the player, by key, with how many events say so.
 *
 * Undeclared ids are dropped, not counted: this asks what the spec models and fails to draw, which is
 * the opposite question to the coverage ledger's "which declared aura never fires".
 *
 * **The player only.** `aurasPutOnEnemies` is the other half and a guard wants both — see
 * `enemyAuraEvents` for why they are two functions rather than one widened target filter.
 */
export function aurasPutOnPlayer(
	dataset: FightDataset,
	registry: Registry,
	kinds: readonly AuraEvidence[] = ALL_EVIDENCE,
): Map<string, number> {
	return countKeys(selfAuraEvents(dataset, kinds), registry);
}

/**
 * Every *declared* aura the player put on an enemy, by key, with how many events say so.
 *
 * The same question as `aurasPutOnPlayer` asked of the other half of the stream, and it stays the same
 * question on purpose: **is this aura's key drawn by some lane**. A debuff is already drawn per enemy —
 * several `AuraLane`s share one `key` and differ by `target` — so `drawnLaneKeys` collapses them to the
 * one key and a debuff on an add nobody selected cannot demand a row of its own. What the guard still
 * catches is an aura drawn on **no** enemy at all, which is `blackout-kick-dot`: 71 events on the
 * Windwalker's pull and no lane anywhere.
 */
export function aurasPutOnEnemies(
	dataset: FightDataset,
	registry: Registry,
	kinds: readonly AuraEvidence[] = ALL_EVIDENCE,
): Map<string, number> {
	return countKeys(enemyAuraEvents(dataset, kinds), registry);
}

/**
 * Every aura **id** the log put on the player, declared or not, with how many events say so.
 *
 * The counterpart of `aurasPutOnPlayer` and the reason both exist. That one resolves through
 * `registry.auraById` and drops what it cannot resolve, so it can only ever ask about auras the model
 * *declares* — which makes it structurally blind to the third failure mode: an id the log puts on the
 * player that nothing declares at all. Skull Banner (114206) fires on all four committed pulls, was
 * named in the Elemental's `EXTRA_NAMES` so the cast-coverage ledger was satisfied, and was drawn
 * nowhere; it passed every guard in the repository. So did 146046 before a reader found it in their own
 * log.
 *
 * The same evidence rule as the key sweep, for the same reason — see `selfAuraEvents`. An apply-only
 * reading of this would have missed the Fire Elemental on all three Elemental pulls, and the ids that
 * only ever *stack* on the player (324 reaches the sweep through `applybuffstack` and nothing else)
 * would be absent from a sweep that read applications alone.
 */
export function auraIdsPutOnPlayer(
	dataset: FightDataset,
	kinds: readonly AuraEvidence[] = ALL_EVIDENCE,
): Map<number, number> {
	return countIds(selfAuraEvents(dataset, kinds));
}

/**
 * Every aura **id** the player put on an enemy, declared or not, with how many events say so.
 *
 * The id counterpart of `aurasPutOnEnemies`, and the half of the third failure mode that was
 * unreachable: `auraIdsPutOnPlayer` reads the player-scoped stream, so an id the player writes onto a
 * boss and nothing declares passed every guard in the repository exactly as Skull Banner did. Three do
 * on the committed pulls — 115798 Weakened Blows on all three Elemental pulls, 115804 Mortal Wounds and
 * 124280 Touch of Karma on the Windwalker's — and the ledger in `game/__tests__/undeclaredAuras.test.ts`
 * now has to say which kind each is.
 *
 * Small, and measured rather than hoped: source-filtered, this adds one id per Elemental pull and two on
 * the Windwalker's. Unfiltered by source it would add one more (118297, the player's own Fire Elemental's
 * Immolate) on today's fixtures and an unbounded list on any raid-wide fetch — see `enemyAuraEvents`.
 */
export function auraIdsPutOnEnemies(
	dataset: FightDataset,
	kinds: readonly AuraEvidence[] = ALL_EVIDENCE,
): Map<number, number> {
	return countIds(enemyAuraEvents(dataset, kinds));
}

/**
 * One pull's ids and the question "does the spec that analyses this pull declare them".
 *
 * Paired rather than passed separately because the answer is a property of the *pair*: 120676 is
 * declared by the Elemental and not by the Windwalker, so "is this id declared" has no answer until a
 * pull is named. Keeping them together is what lets one ledger cover both specs without claiming that
 * either spec's model is the other's.
 */
export interface IdSweep {
	/** What `auraIdsPutOnPlayer` read off this pull. */
	ids: ReadonlyMap<number, number>;
	/** `registry.auraById(id) !== undefined` for the spec that analyses it. */
	declares: (id: number) => boolean;
}

/** Ledger ids, numerically. `Object.keys` on a numeric-keyed record hands back strings. */
const ledgerIds = (ledger: Readonly<Record<number, string>>): number[] => Object.keys(ledger).map(Number);

/**
 * Ids the log put on the player that nothing declares and no ledger entry excuses.
 *
 * Sorted numerically, because a failure here is read as a list of spell ids and `[...].sort()` would
 * order them as text — 1126 before 17.
 */
export function unmodelledAuraIds(sweeps: readonly IdSweep[], ledger: Readonly<Record<number, string>>): number[] {
	const missing = new Set<number>();
	for (const sweep of sweeps) {
		for (const id of sweep.ids.keys()) {
			if (!sweep.declares(id) && ledger[id] === undefined) missing.add(id);
		}
	}
	return [...missing].sort((a, b) => a - b);
}

/**
 * Ledger ids that fired on no pull at all — the id counterpart of `staleExcuses`, and the same
 * argument: a reason written for an id that stopped appearing is a reason nobody will ever check.
 */
export function staleLedgerIds(ledger: Readonly<Record<number, string>>, sweeps: readonly IdSweep[]): number[] {
	const fired = new Set(sweeps.flatMap((sweep) => [...sweep.ids.keys()]));
	return ledgerIds(ledger)
		.filter((id) => !fired.has(id))
		.sort((a, b) => a - b);
}

/**
 * Ledger ids that every pull carrying them now declares, so the entry has been overtaken.
 *
 * The id counterpart of `redundantExcuses`, and the check that makes an entry reading "nothing declares
 * this yet" safe to write: the moment a spec declares it, the entry that told the next reader not to
 * look becomes a failure naming itself. Nothing else here notices — a declared id satisfies
 * `unmodelledAuraIds` and a firing id satisfies `staleLedgerIds`.
 *
 * **Every** pull, not any: 120676 is declared by the Elemental and not by the Windwalker, and an entry
 * that is still the only thing accounting for it on one spec's pull is not redundant.
 */
export function declaredLedgerIds(ledger: Readonly<Record<number, string>>, sweeps: readonly IdSweep[]): number[] {
	return ledgerIds(ledger)
		.filter((id) => {
			const carrying = sweeps.filter((sweep) => sweep.ids.has(id));
			return carrying.length > 0 && carrying.every((sweep) => sweep.declares(id));
		})
		.sort((a, b) => a - b);
}

/** The lane keys an analysis actually drew — the set the sweep is measured against. */
export function drawnLaneKeys(analysis: Analysis): Set<string> {
	return new Set(analysis.timeline?.lanes.map((lane) => lane.key) ?? []);
}

/**
 * Auras that fired, are drawn nowhere, and carry no ledger entry excusing that.
 *
 * Sorted so a failure reads as a list rather than as whatever order the log happened to be in.
 */
export function undrawnAuras(
	putOn: ReadonlyMap<string, number>,
	drawn: ReadonlySet<string>,
	excused: Readonly<Record<string, string>>,
): string[] {
	return [...putOn.keys()].filter((key) => !drawn.has(key) && excused[key] === undefined).sort();
}

/**
 * Ledger entries whose aura no longer fires anywhere in `sweeps`.
 *
 * A reason written for an aura that stopped appearing is a reason nobody will ever check again. Takes
 * every pull's sweep at once rather than one, because a defensive is not pressed on every pull.
 */
export function staleExcuses(
	excused: Readonly<Record<string, string>>,
	sweeps: readonly ReadonlyMap<string, number>[],
): string[] {
	const fired = new Set(sweeps.flatMap((sweep) => [...sweep.keys()]));
	return Object.keys(excused)
		.filter((key) => !fired.has(key))
		.sort();
}

/**
 * Ledger entries whose aura is now drawn after all, so the reason has been overtaken.
 *
 * The other direction of `staleExcuses`, and the one that bites during concurrent work: an entry
 * reading "no timeline row yet" beside a lane that draws the row is worse than absent, because it tells
 * the next reader not to look. Nothing else catches it — an excused key that is drawn satisfies
 * `undrawnAuras` because the lane exists and satisfies `staleExcuses` because the aura still fires — so
 * a lane landing under a ledger entry is silent in every other assertion here.
 */
export function redundantExcuses(excused: Readonly<Record<string, string>>, drawn: ReadonlySet<string>): string[] {
	return Object.keys(excused)
		.filter((key) => drawn.has(key))
		.sort();
}
