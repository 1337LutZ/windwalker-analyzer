// What the frozen test reference still has to agree with the live one about.
//
// `vitest.config.ts` aliases `~/generated/reference.json` to a deliberately stale snapshot, so that a
// weekly refresh of the real table cannot move a committed fixture's letters and arrive as eighteen
// failing tests nobody will re-type. That is the right trade, and it has a cost worth naming: **no test
// proves the live table grades a committed fixture any particular way.**
//
// This is what replaces it. Values are allowed to drift — that is the entire point of the refresh — but
// *shape* is not. A spec that vanishes, an encounter that stops being covered, or a cell that loses a
// field is a structural change that would reach production ungraded, and it fails here instead.
//
// The live table is imported by a relative path on purpose: the alias matches the `~/generated/...`
// specifier exactly, so a relative import is how a test reaches the real file.

import { describe, expect, it } from 'vitest';

import FROZEN from '../__fixtures__/reference.frozen.json';
import LIVE from '../../../generated/reference.json';

interface Cell {
	n: number;
	p50: number;
	p90: number;
	name: string;
}
interface Table {
	metric: string;
	builtAt: string | null;
	specs: Record<string, { encounters: Record<string, Cell>; fallback: Cell | null; sourcePulls: number }>;
}

const frozen = FROZEN as unknown as Table;
const live = LIVE as unknown as Table;

describe('the frozen reference against the live one', () => {
	/** A spec losing its rows would silently fall every one of its grades back to the spec-wide curve. */
	it('covers the same specs', () => {
		expect(Object.keys(live.specs).sort()).toEqual(Object.keys(frozen.specs).sort());
	});

	/**
	 * An encounter dropping out of the table is not a value change — it is a fight that stops being
	 * graded against itself and starts being graded against the whole spec, which is the exact failure
	 * the reference was built to end.
	 */
	it('covers the same encounters for every spec', () => {
		for (const [key, spec] of Object.entries(frozen.specs)) {
			expect(Object.keys(live.specs[key]?.encounters ?? {}).sort(), `${key} encounters`).toEqual(
				Object.keys(spec.encounters).sort(),
			);
		}
	});

	/** A cell missing a field reads as `undefined` in the resolver and grades as a number nobody chose. */
	it('gives every cell the same fields', () => {
		for (const [key, spec] of Object.entries(live.specs)) {
			for (const [encounterID, cell] of Object.entries(spec.encounters)) {
				expect(Object.keys(cell).sort(), `${key} ${encounterID}`).toEqual(['n', 'name', 'p50', 'p90']);
			}
		}
	});

	it('measures the same metric', () => {
		expect(live.metric).toBe(frozen.metric);
	});

	/**
	 * **Values are free to move and the fixture is expected to fall behind.** Asserted so that a future
	 * reader who finds the two disagreeing does not "fix" it by copying the live table over the fixture —
	 * which would re-couple the suite to the weekly refresh and undo all of this.
	 *
	 * Refresh the fixture only when a *structural* change above demands it, and re-pin the grade
	 * expectations in the same commit.
	 */
	it('is allowed to be stale, and says so', () => {
		const cells = Object.values(frozen.specs).flatMap((spec) => Object.values(spec.encounters));
		expect(cells.length, 'a fixture with no cells would pass every test above vacuously').toBeGreaterThan(0);
		expect(frozen.builtAt).not.toBeNull();
	});
});
