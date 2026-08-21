// The sweep behind both specs' `drawnAuras.test.ts`: every aura the log put on the player, by
// registry key, so a guard can ask which of them nothing draws.
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
