// The sweep behind both specs' `drawnAuras.test.ts`: every aura the log put on the player, by
// registry key, so a guard can ask which of them nothing draws.
//
// **And by raw id, which is a different question.** The key reading resolves through
// `registry.auraById` and drops what it cannot resolve, so it can only see auras the model declares.
// `auraIdsPutOnPlayer` and the three ledger checks below it drop that filter, which is what closes the
// third failure mode — see `game/__tests__/undeclaredAuras.test.ts` for the ledger and the argument.
//
// **Why it is one function and not two.** The two guards were written days apart and diverged in a
// way that mattered rather than a way that looked like style. The Windwalker's counted removals as
// evidence; the Elemental's counted applications and refreshes only. On the Windwalker's own fixture
// the difference was the whole finding — the raid's Time Warp went up before the bell, so its only
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
// **Evidence, not application.** "The log put this aura on the player" is the question, and every
// event that *moves* an aura answers it. An application is one kind of answer; a removal with no
// application in front of it is another, and is the ordinary signature of a raid cooldown, a pre-pull
// consumable or a pre-pull summon. A stack event is a third, and is not a rounding error: on the
// Elemental's `phased` and `unbroken` pulls `lightning-shield` reaches this sweep through
// `applybuffstack` and through nothing else. Narrowing the sweep is therefore a parameter rather than
// a rewrite, which is how the guards demonstrate what the narrow reading loses.

import {
	abilityIdOf,
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
 * Every *declared* aura the log put on the player, by key, with how many events say so.
 *
 * Undeclared ids are dropped, not counted: this asks what the spec models and fails to draw, which is
 * the opposite question to the coverage ledger's "which declared aura never fires".
 */
export function aurasPutOnPlayer(
	dataset: FightDataset,
	registry: Registry,
	kinds: readonly AuraEvidence[] = ALL_EVIDENCE,
): Map<string, number> {
	const out = new Map<string, number>();
	for (const event of selfAuraEvents(dataset, kinds)) {
		const aura = registry.auraById(abilityIdOf(event) ?? -1);
		if (aura === undefined) continue;
		out.set(aura.key, (out.get(aura.key) ?? 0) + 1);
	}
	return out;
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
	const out = new Map<number, number>();
	for (const event of selfAuraEvents(dataset, kinds)) {
		const id = abilityIdOf(event);
		if (id === null) continue;
		out.set(id, (out.get(id) ?? 0) + 1);
	}
	return out;
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
