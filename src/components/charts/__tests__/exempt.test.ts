// One band per stretch, and the precedence that decides which one.
//
// `exemptRows` is the shared answer to a problem `SearingTotemUptime` had already solved by hand for
// two causes: the stretches a section's denominator dropped come in overlapping sets, and two
// translucent washes stack darker than either (step 57a), so a second of pull time has to end up on
// exactly one row. A third cause — an AoE phase — makes that three sets on four charts, which is
// three more chances to draw the same idea a fourth way.
//
// What is asserted here is the partition itself: the rows between them cover exactly what the causes
// covered, no second is on two of them, and the order the causes are *given* decides who wins an
// overlap regardless of the order they are drawn in.
import { describe, expect, it } from 'vitest';

import { mergeIntervals, unionMs } from '~/lib/analysis/intervals';
import { exemptRows } from '~/components/charts/exempt';
import { BAND, EXEMPT, SWATCH } from '~/components/charts/tones';

const PULL = 100_000;

const overlaps = (a: ReadonlyArray<readonly [number, number]>, b: ReadonlyArray<readonly [number, number]>): boolean =>
	a.some(([aStart, aEnd]) => b.some(([bStart, bEnd]) => Math.min(aEnd, bEnd) > Math.max(aStart, bStart)));

describe('exemptRows', () => {
	/**
	 * The case Amendment 2 names: an AoE stretch inside an intermission. The intermission is the
	 * stronger claim — "you could not act at all" outranks "you were acting against a different list" —
	 * so it keeps the whole overlap and the AoE row keeps only what falls outside it.
	 */
	it('gives an overlap to the stronger claim and draws it once', () => {
		const intermission: Array<[number, number]> = [[40_000, 60_000]];
		const aoe: Array<[number, number]> = [
			[50_000, 70_000],
			[10_000, 20_000],
		];

		const [away, phase] = exemptRows(
			[
				{ label: 'Nothing to hit', windows: intermission },
				{ label: 'AoE', windows: aoe },
			],
			PULL,
		);

		expect(away?.windows).toEqual([[40_000, 60_000]]);
		expect(phase?.windows).toEqual([
			[10_000, 20_000],
			[60_000, 70_000],
		]);
		expect(overlaps(away?.windows ?? [], phase?.windows ?? [])).toBe(false);
	});

	/** Nothing is lost by the split: the rows are the causes, redistributed. */
	it('covers exactly what the causes covered between them', () => {
		const causes = [
			{ label: 'Nothing to hit', windows: [[40_000, 60_000]] as Array<[number, number]> },
			{
				label: 'AoE',
				windows: [
					[50_000, 70_000],
					[10_000, 20_000],
				] as Array<[number, number]>,
			},
		];
		const rows = exemptRows(causes, PULL);

		expect(unionMs(rows.flatMap((row) => row.windows))).toBe(unionMs(causes.flatMap((cause) => cause.windows)));
		expect(mergeIntervals(rows.flatMap((row) => row.windows))).toEqual(
			mergeIntervals(causes.flatMap((cause) => cause.windows)),
		);
	});

	/**
	 * Precedence is the argument order and nothing else, which is worth pinning because it is *not* the
	 * drawing order: `SearingTotemUptime` draws the intermission above the Fire Elemental's slot while
	 * the slot wins the overlap. Reversing the arguments has to reverse the winner, or a chart that
	 * reorders its rows for legibility would silently change what it is claiming.
	 */
	it('lets the argument order decide the winner, not the drawing order', () => {
		const a: Array<[number, number]> = [[0, 10_000]];
		const b: Array<[number, number]> = [[5000, 15_000]];

		expect(
			exemptRows(
				[
					{ label: 'first', windows: a },
					{ label: 'second', windows: b },
				],
				PULL,
			),
		).toEqual([
			{ label: 'first', windows: [[0, 10_000]] },
			{ label: 'second', windows: [[10_000, 15_000]] },
		]);
		expect(
			exemptRows(
				[
					{ label: 'second', windows: b },
					{ label: 'first', windows: a },
				],
				PULL,
			),
		).toEqual([
			{ label: 'second', windows: [[5000, 15_000]] },
			{ label: 'first', windows: [[0, 5000]] },
		]);
	});

	/**
	 * A target-count series is padded past the end of the pull — `targetCounts` pads its last point by
	 * a window — so an AoE stretch derived from one can run off the end of the timeline it is drawn on.
	 * That is the bug `complementOf` already carries a note about, and it is clipped here for the same
	 * reason: a band wider than the chart claims a phase that outlasted the fight.
	 */
	it('clips every row to the pull', () => {
		const rows = exemptRows(
			[
				{ label: 'AoE', windows: [[90_000, 130_000]] },
				{ label: 'Nothing to hit', windows: [[-2000, 1000]] },
			],
			PULL,
		);
		expect(rows[0]?.windows).toEqual([[90_000, PULL]]);
		expect(rows[1]?.windows).toEqual([[0, 1000]]);
	});

	/** A cause fully claimed by a stronger one draws nothing — and `WindowTracks` then drops the row. */
	it('empties a cause the stronger one swallowed whole', () => {
		const rows = exemptRows(
			[
				{ label: 'Nothing to hit', windows: [[0, PULL]] },
				{ label: 'AoE', windows: [[10_000, 20_000]] },
			],
			PULL,
		);
		expect(rows[1]?.windows).toEqual([]);
	});

	/** Unsorted, touching and overlapping windows within one cause come back merged. */
	it('merges each cause before and after the split', () => {
		const rows = exemptRows(
			[
				{
					label: 'AoE',
					windows: [
						[30_000, 40_000],
						[10_000, 20_000],
						[20_000, 25_000],
					],
				},
			],
			PULL,
		);
		expect(rows[0]?.windows).toEqual([
			[10_000, 25_000],
			[30_000, 40_000],
		]);
	});
});

describe('the exempt band', () => {
	/**
	 * The chip is the same colour whichever way the stretch was drawn.
	 *
	 * A `WindowTracks` chart gives an exempt stretch a row in `SWATCH[EXEMPT]`; a `ResourceChart` washes
	 * it under the bar in `BAND[EXEMPT]`. If those two ever named different tokens, the same meaning
	 * would carry two greys across one report — which is the failure `EXEMPT` was introduced to end,
	 * one level down.
	 */
	it('names the same grey as the exempt row', () => {
		expect(BAND[EXEMPT].swatch).toBe(SWATCH[EXEMPT]);
		expect(BAND[EXEMPT].fill).toBe('fill-[var(--color-track)]');
	});
});
