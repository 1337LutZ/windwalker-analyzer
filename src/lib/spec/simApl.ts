// The committed snapshot of wowsims' priority lists, typed, and the one question this repository asks of
// it: which buttons does the simulator press for this spec.
//
// `src/generated/sim-apl.json` is built by `scripts/build-sim-apl.mjs` out of `wowsims/mop@master` and
// committed for the reason `spells.json` is: a build that reached the network could fail for reasons
// having nothing to do with the change being deployed, and committed derived data makes drift reviewable
// in a pull request rather than a silent change of meaning.
//
// **This module exists so nothing else imports the JSON.** A raw import types every field as whatever
// TypeScript infers from today's file, which is right until the first snapshot that contains a spec with
// no APLs at all — and that case is already real, so it is in the type rather than in a comment.

import SNAPSHOT from '~/generated/sim-apl.json';

/** One cast the APL attempts. `other` covers a potion, a racial or a profession use. */
export interface SimCast {
	spellId?: number;
	other?: string;
	/** The named group it came from, or null when it sat directly in the list. */
	via: string | null;
	/** A row the sim's own UI folds away — the elixir and weapon-swap toggles. */
	hidden: boolean;
}

export interface SimAplFile {
	prepull: SimCast[];
	priority: SimCast[];
	groups: string[];
}

export interface SimSpec {
	dir: string;
	files: Record<string, SimAplFile>;
	/** Present only when the spec has no APL directory on the branch, saying which and why. */
	note?: string;
}

export interface SimAplSnapshot {
	source: { repo: string; branch: string; commit: string; committed: string | null };
	specs: Record<string, SimSpec>;
}

const snapshot = SNAPSHOT as unknown as SimAplSnapshot;

/** The whole snapshot, for anything that needs the provenance rather than the spells. */
export function simApl(): SimAplSnapshot {
	return snapshot;
}

/** One spec's APLs, or null when no snapshot covers it. */
export function simSpecFor(specKey: string): SimSpec | null {
	return snapshot.specs[specKey] ?? null;
}

/**
 * Every spell the sim casts for this spec, across all of its APLs, first-seen order.
 *
 * **Hidden rows are dropped and that is the only judgement made here.** They are the elixir and
 * weapon-swap toggles — equipment bookkeeping the sim runs as actions, which no rotation section should
 * ever list. Everything else is returned, cooldowns and racials included, because deciding what counts as
 * rotation is the *caller's* question and different callers answer it differently.
 */
export function simSpellsFor(specKey: string): number[] {
	const spec = simSpecFor(specKey);
	if (spec === null) return [];
	const seen = new Set<number>();
	for (const file of Object.values(spec.files)) {
		for (const cast of [...file.prepull, ...file.priority]) {
			if (cast.hidden || cast.spellId === undefined) continue;
			seen.add(cast.spellId);
		}
	}
	return [...seen];
}
