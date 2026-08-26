// The one button in this tree the log never emits a cast for.
//
// Execution Sentence is a talent, and on the three committed captures that took it the debuff goes up
// 9, 6 and 1 times with **zero** `cast` events under any id. `Ability.pressSeenAsAura` exists to read
// the press off the debuff instead — and it was declared, asserted by `data.test.ts`, and read by
// nothing in `lib/analysis` until a downtime investigation went looking for four missing globals.
//
// Pinned against the fixtures rather than only synthetically, because the fixtures can carry it: this
// is the assertion that would have failed on the day the field was written.

import { describe, expect, it } from 'vitest';

import { rawFixture } from '~/lib/analysis/fixtures';
import { analyse } from '~/specs/protection/lib';
import { abilityIdOf, isAuraApply } from '~/lib/events';
import type { Analysis, ProtectionAudit } from '~/lib/types';

const EXECUTION_SENTENCE_DEBUFF = 114_916;

/** What the log carries: applications by the player, and casts of any kind. */
function evidence(name: string): { applies: number; casts: number } {
	const dataset = rawFixture('protection', name);
	const me = dataset.actor.id;
	let applies = 0;
	let casts = 0;
	for (const event of dataset.events) {
		if (abilityIdOf(event) !== EXECUTION_SENTENCE_DEBUFF) continue;
		if (isAuraApply(event) && event.sourceID === me) applies += 1;
		if (event.type === 'cast') casts += 1;
	}
	return { applies, casts };
}

/**
 * The press count the cast table reports, which is where a reader sees it.
 *
 * The table is keyed by the ability's *name* rather than its key — `CastRow.name` is what the section
 * groups and prints — so this looks it up the way the page does.
 */
const pressesFor = (name: string): number => {
	const analysis = analyse(rawFixture('protection', name)) as Analysis & ProtectionAudit;
	return analysis.casts.find((row) => row.name === 'Execution Sentence')?.count ?? 0;
};

describe('Execution Sentence, which logs no cast at all', () => {
	it.each([
		['garrosh.json', 9],
		['paragons.json', 6],
		['galakras.json', 1],
	] as const)('%s presses it %i times, every one read off the debuff', (name, presses) => {
		const { applies, casts } = evidence(name);
		// The premise first: if the log ever starts emitting a cast for this, the reader below is
		// double-counting and this is where that shows up.
		expect(casts, `${name} cast events`).toBe(0);
		expect(applies, `${name} applications`).toBe(presses);
		expect(pressesFor(name), `${name} presses in the cast table`).toBe(presses);
	});

	/** And the two pulls that never took the talent gain nothing, which is what says it is not inventing. */
	it.each(['fallenProtectors.json', 'spoils.json'])('%s carries none of it and draws none', (name) => {
		expect(evidence(name).applies).toBe(0);
		expect(pressesFor(name)).toBe(0);
	});
});
