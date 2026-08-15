import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis } from '~/lib/types';

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'));

/** The four consumables that get swapped mid-pull, plus the potion that sits beside them. */
const CONSUMABLES = new Set([105689, 105684, 105682, 105688, 105697]);

/**
 * Elixir weaving, measured on a pull that actually does it.
 *
 * The reference player on the other fixtures takes a potion and nothing else, so every claim this
 * report makes about weaving was until now argued from a log nobody could check. This pull swaps
 * three times.
 *
 * What the tests are for is narrow and worth stating: **the weave must stay free, and it must stay
 * named.** Those are the two things that were ever at stake. It was already free — the accounting
 * counts on-GCD presses and these are not — and this pins that against a future change to how
 * globals are counted. It was *not* named: an ability the spec does not list falls back to `#105684`
 * for its lane, and the timeline picks a cast's tier by matching that lane name, so an unnamed weave
 * sank in among the interrupts and defensives.
 */
describe('elixir weaving', () => {
	const weave = fixture('weave');
	// Narrowed once rather than at each use. A fixture with no timeline is a broken capture, not a
	// case these tests are meant to tolerate, so it should fail loudly here.
	const casts = (weave.timeline?.casts ?? []).filter((c) => CONSUMABLES.has(c.id));

	it('sees the swaps', () => {
		const presses = casts;
		// Three elixir swaps and one potion. Fewer would mean the capture drifted onto another pull;
		// this is the only fixture where the number is the point.
		expect(presses.length).toBeGreaterThanOrEqual(6);
		expect(new Set(presses.map((c) => c.id)).size).toBeGreaterThanOrEqual(2);
	});

	it('names them instead of printing an id', () => {
		// The regression this guards is silent: an unlisted ability still draws, still tooltips, and
		// still sorts — it just does all three under `#105684`. Nothing throws, so only an assertion on
		// the name catches it.
		for (const cast of casts) {
			expect(cast.name).not.toMatch(/^#\d+$/);
			expect(cast.name.length).toBeGreaterThan(0);
		}
	});

	it('never charges a global for one', () => {
		// The whole reason the exclusion is correct. If this flips, the report starts docking players
		// for doing the thing its own copy tells them to do.
		for (const cast of casts) {
			expect(cast.onGcd).toBe(false);
		}
	});

	it('keeps them out of the priority ladder', () => {
		// Not `off-list` — absent. `aplAudit` filters on `onGcd` before judging, so an off-GCD press is
		// never a press the ladder saw at all, and a verdict of any kind here would mean that filter had
		// moved.
		const judged = new Set(weave.apl?.presses.map((p) => p.pressed) ?? []);
		for (const id of CONSUMABLES) expect(judged.has(id)).toBe(false);
	});
});
