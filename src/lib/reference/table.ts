// The committed reference table, typed, and the two questions a reader asks of it.
//
// `src/generated/reference.json` is derived data, built by `scripts/build-reference-tables.mjs` out of
// real Warcraft Logs kills and committed for the reason `spells.json` is: `npm run build` must never
// reach the network, and a derived file in the repository makes drift reviewable in a pull request
// rather than a silent re-grading of every report.
//
// **This module exists so nothing else has to import the JSON.** A raw `import table from
// '~/generated/reference.json'` types every cell as whatever TypeScript infers from the current file's
// contents — which happens to be right today and stops being right the first time a sweep writes a cell
// with a null in it. One typed reader, and callers get a shape rather than a snapshot.

import TABLE from '~/generated/reference.json';
import { baseEncounterID } from '~/lib/game/rankingExclusions';

/** One encounter's distribution for one spec, and the sample it was drawn from. */
export interface ReferenceCell {
	n: number;
	p50: number;
	p90: number;
	/**
	 * The encounter's name, as WarcraftLogs gave it.
	 *
	 * Carried in the cell rather than looked up, because the only other list of Siege names in the tree
	 * is `enforced.ts` and that one is deliberately partial — it holds the fights somebody has measured a
	 * mechanic on, which is a different question from what a fight is called, and it is missing three of
	 * the fourteen.
	 */
	name: string;
}

export interface SpecReference {
	encounters: Readonly<Record<string, ReferenceCell>>;
	/** The spec-wide distribution, for an encounter with no row of its own. */
	fallback: ReferenceCell | null;
	sourcePulls: number;
}

export interface ReferenceTable {
	metric: string;
	/** `YYYY-MM-DD`, the day the sweep that produced this table ran. */
	builtAt: string | null;
	sourcePulls?: number;
	specs: Readonly<Record<string, SpecReference>>;
}

const table = TABLE as unknown as ReferenceTable;

/** What the whole table knows, for the Method section's summary. */
export function referenceTable(): ReferenceTable {
	return table;
}

/** One spec's rows, or null when no sweep has covered it yet. */
export function referenceFor(specKey: string): SpecReference | null {
	return table.specs[specKey] ?? null;
}

/**
 * The row a pull is graded against, reduced through `baseEncounterID` exactly as the app does.
 *
 * **The reduction is the trap worth naming.** WarcraftLogs numbers a Classic encounter 50 000 above its
 * retail id — heroic Immerseus is 51 602, base 1 602 — and a table keyed on the raw id would miss on
 * every single pull while looking perfectly populated. Every grade would quietly fall back to the
 * spec-wide distribution, which is a plausible number, so nothing would look broken.
 */
export function cellFor(specKey: string, encounterID: number | undefined): ReferenceCell | null {
	if (encounterID === undefined) return null;
	return referenceFor(specKey)?.encounters[String(baseEncounterID(encounterID))] ?? null;
}

/** Every row this spec has, encounter id and cell, in ascending id order. */
export function rowsFor(specKey: string): Array<{ encounterID: number; cell: ReferenceCell }> {
	const spec = referenceFor(specKey);
	if (spec === null) return [];
	return Object.entries(spec.encounters)
		.map(([encounterID, cell]) => ({ encounterID: Number(encounterID), cell }))
		.sort((a, b) => a.encounterID - b.encounterID);
}

/**
 * The base encounter id a pull's own name resolves to, or null when nothing matches.
 *
 * **The app knows the encounter by name, not by id.** `AnalysisCore` carries `encounter: string` and no
 * id at all, so a grading path that wanted the id would need a new field on `lib/types.ts` — the most
 * contended file in the tree — and every captured fixture predating it would grade against the fallback
 * while every raw one graded against its row. Two conventions in one test suite is worse than a join.
 *
 * The join is safe because both sides come from WarcraftLogs: the table's names are what `rankings`
 * returned, and `analysis.encounter` is what the report's fight data said. Verified rather than assumed
 * — all nineteen committed fixtures across the three specs resolve, raw and captured alike, and
 * `referenceJoin.test.ts` keeps it that way.
 */
export function encounterIdForName(name: string | null | undefined): number | null {
	if (name === null || name === undefined) return null;
	for (const spec of Object.values(table.specs)) {
		for (const [encounterID, cell] of Object.entries(spec.encounters)) {
			if (cell.name === name) return Number(encounterID);
		}
	}
	return null;
}
