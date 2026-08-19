import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis } from '~/lib/types';

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../specs/windwalker/__fixtures__/${name}.json`), 'utf8'));

/** What share of the presses it was willing to judge the ladder found in the list's order. */
function adherence(analysis: Analysis): number {
	const apl = analysis.apl;
	if (apl == null) return Number.NaN;
	const judged = apl.followed + apl.skipped;
	return judged === 0 ? Number.NaN : (apl.followed / judged) * 100;
}

/**
 * The ladder's unit tests pin what each rule does. These pin the thing those cannot: whether the
 * model, run end to end on three real pulls, actually measures play.
 *
 * It exists because the first working version did not. Reading chi off the sampled curve, it flagged
 * roughly half of every player's globals and ranked the best pull no better than the worst — a model
 * that says everyone misplays everything is not a strict one, it is a broken one, and nothing in the
 * per-rule tests could have caught it. So the property under test is separation, and the direction of
 * it.
 */
describe('the priority ladder on real pulls', () => {
	it('ranks the three reference pulls in the order the rest of the report does', () => {
		const [strong, mixed, poor] = [
			adherence(fixture('strong')),
			adherence(fixture('mixed')),
			adherence(fixture('poor')),
		];
		expect(strong).toBeGreaterThan(mixed);
		expect(mixed).toBeGreaterThan(poor);
	});

	it('finds a majority of the strongest pull in the list order', () => {
		// Not a high bar, and deliberately not a tight one: a real player is not a simulator, and the
		// number that matters is whether the ladder can tell pulls apart. This is a floor against the
		// regression that prompted it, where `strong` came out at 48%.
		expect(adherence(fixture('strong'))).toBeGreaterThan(55);
	});

	it('judges nearly every global rather than declining to', () => {
		// A ladder that answers "cannot say" to most presses is as useless as one that cries wolf, and
		// the unknown path is the one that would quietly swallow them.
		for (const name of ['strong', 'mixed', 'poor']) {
			const apl = fixture(name).apl;
			expect(apl, name).toBeTruthy();
			if (apl == null) continue;
			const total = apl.followed + apl.skipped + apl.unknown + apl.offList;
			expect(apl.unknown / total, name).toBeLessThan(0.1);
		}
	});

	/**
	 * Every skip names a rule that exists, and the count adds up to the total. Cheap, and it is what
	 * would catch a rule key drifting away from the copy that renders it.
	 */
	it('accounts for every skip against a named rule', () => {
		for (const name of ['strong', 'mixed', 'poor']) {
			const apl = fixture(name).apl;
			if (apl == null) continue;
			const summed = apl.skippedBy.reduce((n, s) => n + s.count, 0);
			expect(summed, name).toBe(apl.skipped);
			for (const skip of apl.skippedBy) expect(skip.id, `${name} / ${skip.key}`).toBeGreaterThan(0);
		}
	});
});
