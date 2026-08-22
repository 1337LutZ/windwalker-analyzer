// The stretches the aoe priority list applied to, which a single-target clock may not count.
//
// Two choices in one line, and both are the kind that get "simplified" later by someone reading only the
// call: the **series** and the **threshold**.
//
// `aplTargetPoints`, not `targetPoints`. They are different counts and plan §41 found them disagreeing with
// nothing saying why — the APL series excludes the spec's own area damage, so a spec that cleaves with its
// filler would otherwise read as fighting a pack it produced itself. A band question has to read the ladder's
// series or it is not a band question.
//
// Three, not two. At two targets the *cleave* list still spends Lightning Shield and still multi-dots Flame
// Shock, so those stretches stay graded; it is only from three that the aoe list stops asking for either.
// Exempting band 2 would excuse a pull from a list that is *stricter* about the dot, not looser.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis, FightDataset } from '~/lib/types';
import { analyse } from '~/specs/elemental/lib';

const load = (name: string): Analysis =>
	analyse(
		JSON.parse(
			readFileSync(resolve(import.meta.dirname, `../../../specs/elemental/__fixtures__/${name}.json`), 'utf8'),
		) as FightDataset,
	) as Analysis;

/** `Handles.aoeWindows` is internal to the pass; what a reader can see is the published count series. */
const bandAtLeast = (analysis: Analysis, floor: number): number => {
	const points = analysis.targets?.counts?.points ?? [];
	let total = 0;
	for (const [i, point] of points.entries()) {
		const next = points[i + 1]?.[0] ?? analysis.durationMs;
		if ((point[1] ?? 0) >= floor) total += next - point[0];
	}
	return total;
};

describe('the aoe stretches', () => {
	it('are absent from the two single-target pulls, so they cannot move a figure there', () => {
		for (const name of ['phased', 'unbroken'] as const) {
			const analysis = load(name);
			// Not vacuous: both pulls have plenty of one-enemy time, they simply never reach three.
			expect(analysis.targets?.counts?.max).toBe(1);
			expect(bandAtLeast(analysis, 3)).toBe(0);
		}
	});

	it('are most of the multi-target pull, which is why its overcap figure moves', () => {
		const cleave = load('cleave');
		expect(cleave.targets?.counts?.max).toBe(13);
		// Band 3 or more covers the great majority of what band 2 or more covers, which is the shape that
		// makes the distinction worth drawing: this pull is not "sometimes two adds", it is add waves.
		const three = bandAtLeast(cleave, 3);
		const two = bandAtLeast(cleave, 2);
		expect(three).toBeGreaterThan(90_000);
		expect(two).toBeGreaterThan(three);
	});

	it('leave band 2 graded, because the cleave list still spends the shield', () => {
		// The threshold's whole justification, asserted rather than left in a comment: there is real band-2
		// time on this pull, and it is *not* in the exempt set.
		const cleave = load('cleave');
		const twoOnly = bandAtLeast(cleave, 2) - bandAtLeast(cleave, 3);
		expect(twoOnly).toBeGreaterThan(0);
	});
});
