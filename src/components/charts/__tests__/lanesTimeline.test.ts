// The summary timeline's one job that only a spec can answer: which counter row it draws.
//
// `createElement` rather than JSX so this stays a `.ts` file and vitest's own include patterns pick it
// up (see `vitest.config.ts` — only `.ts` is collected).
//
// **What is observable in a node render, and why the assertions look like this.** `ApexChart` mounts
// the library inside an effect, because ApexCharts reads `window` on import and this site is
// prerendered — so on the server there are no bars to count and no `aria-label` to read (it is set
// only once the draw lands). `TrackLabels` is `hidden` until it has measured the grid, so the row names
// are not in the markup either. What *is* in the markup is the box the chart reserved, and its height
// is `rows.length * ROW_HEIGHT + CHROME` — so the row count is readable, exactly, from one inline
// style. That is what these tests count rows with.
//
// The bar-level detail — one bar per spend, carrying what the spend unloaded — is asserted against the
// seam itself rather than the render, because the seam is where that cut is made now.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis } from '~/lib/types';
import { SpecContext } from '~/components/report/specContext';
import LanesTimeline from '../LanesTimeline';

initI18n();

const ELEMENTAL = getSpec('elemental')!;
const WINDWALKER = getSpec('windwalker')!;

/** `rows * ROW_HEIGHT + CHROME`, restated from `LanesTimeline` — the two must agree or this lies. */
const heightFor = (rows: number) => rows * 36 + 92;

const DURATION_MS = 60_000;

/**
 * Four full loads of a counter and nothing else: 1 → 7, spend back to 1, four times over.
 *
 * The shape the fragmenting regression was reported on. The counter never reaches zero, because the
 * spend leaves a charge behind — which is exactly why a load has to close on a *decrease*.
 */
const FOUR_SPENDS_AT_SEVEN: Array<[number, number]> = [
	[0, 1],
	[1000, 4],
	[2000, 7],
	[3000, 1],
	[4000, 4],
	[5000, 7],
	[6000, 1],
	[7000, 4],
	[8000, 7],
	[9000, 1],
	[10_000, 4],
	[11_000, 7],
	[12_000, 1],
];

/**
 * One aura lane and an Elemental audit's charge readings, and nothing else the chart reads.
 *
 * Hand-built rather than lifted from a fixture, and cast at this one boundary: the point of these
 * tests is *which spec* is asked about the counter, so the analysis has to be one both specs can be
 * handed. `flame-shock` because it is in the Elemental's summary lane set — the Windwalker names no
 * set and draws every lane — so the aura row is one row under either spec and the counter row is the
 * only difference between the two renders.
 */
const analysisWith = (points: Array<[number, number]>): Analysis =>
	({
		durationMs: DURATION_MS,
		timeline: {
			lanes: [
				{
					key: 'flame-shock',
					name: 'Flame Shock',
					id: 8050,
					group: 'debuff',
					windows: [{ start: 0, end: 30_000 }],
				},
			],
			casts: [],
		},
		lightningShield: { points, maxStacks: 7 },
	}) as unknown as Analysis;

const renderUnder = (spec: typeof ELEMENTAL, analysis: Analysis): string =>
	renderToStaticMarkup(
		createElement(SpecContext.Provider, { value: spec }, createElement(LanesTimeline, { analysis })),
	);

/** The single inline height in this subtree is the chart's reserved box — see the module note. */
const rowsIn = (html: string): number => {
	const heights = [...html.matchAll(/height:(\d+)px/g)].map((match) => Number(match[1]));
	expect(heights).toHaveLength(1);
	return (heights[0]! - 92) / 36;
};

describe('LanesTimeline counter rows come from the spec, not from the analysis', () => {
	/**
	 * The leak this test exists for. The chart used to find the Elemental's counter by casting the
	 * analysis to a shape with an optional `lightningShield` on it, so it drew that row for *any* pull
	 * carrying the field — including a Windwalker report rendered under the Windwalker's own definition.
	 * A cast is not an import, so the convention grep in `docs/conventions.md` could not see it.
	 *
	 * Same analysis, two definitions, and the row count is the answer: the spec that declares a counter
	 * gets it, the spec that declares none does not.
	 */
	it('draws the counter for the spec that declares one and not for the spec that does not', () => {
		const analysis = analysisWith(FOUR_SPENDS_AT_SEVEN);

		const ele = renderUnder(ELEMENTAL, analysis);
		const ww = renderUnder(WINDWALKER, analysis);

		// The aura lane, plus Lightning Shield.
		expect(rowsIn(ele)).toBe(2);
		// The aura lane alone — the Windwalker declares no counter row, and the field on the analysis is
		// not an invitation to read it.
		expect(rowsIn(ww)).toBe(1);
		expect(heightFor(2) - heightFor(1)).toBe(36);
	});

	/**
	 * And the other spec's definition is not merely quiet about the counter — it renders its own pull
	 * without throwing and draws the lane that pull has. `SpecContext`'s fallback is the deployment's
	 * pinned spec, so this pairing happens for real whenever a chart renders without a provider.
	 */
	it('renders the other spec’s definition without throwing, and still draws its lane', () => {
		const ww = renderUnder(WINDWALKER, analysisWith(FOUR_SPENDS_AT_SEVEN));
		expect(rowsIn(ww)).toBe(1);
		// Not the empty state: a chart with no rows renders `ChartEmpty` and reserves no box at all.
		expect(ww).toContain('height:');
	});

	/** A pull whose report has no counter readings draws no counter row, under either spec. */
	it('draws no counter row when the pull has no readings', () => {
		expect(rowsIn(renderUnder(ELEMENTAL, analysisWith([])))).toBe(1);
	});
});

describe('the counter is cut one bar per spend', () => {
	/**
	 * The regression `cef1001` fixed, asserted at the seam that now makes the cut.
	 *
	 * A load closes on a **decrease**, not at zero. Closing at zero closed nothing on a real pull —
	 * Fulmination leaves one charge behind, so the counter goes 7 → 1 and never reaches zero while the
	 * shield is up — and the whole fight came out as one wide bar carrying the only peak it reached.
	 * Four unloads at seven must be four bars each labelled 7, not one bar labelled 7.
	 */
	it('turns four unloads at seven into four loads of seven, not one', () => {
		const counters = ELEMENTAL.timelineCounters(analysisWith(FOUR_SPENDS_AT_SEVEN));
		expect(counters).toHaveLength(1);
		const loads = counters[0]!.loads;

		// Four spends, and the charge the last one left behind, still on the shield when the log stopped.
		expect(loads).toHaveLength(5);
		const spends = loads.filter((load) => load.spent);
		expect(spends).toHaveLength(4);
		expect(spends.map((load) => load.held)).toEqual([7, 7, 7, 7]);
		// They tile the pull rather than overlapping: each load starts where the last one was spent.
		expect(spends.map((load) => [load.start, load.end])).toEqual([
			[0, 3000],
			[3000, 6000],
			[6000, 9000],
			[9000, 12_000],
		]);
		// The tail carries no figure — a number there would claim a fifth press the pull never got to.
		expect(loads[4]).toEqual({ start: 12_000, end: DURATION_MS, held: 1, spent: false });
	});

	/**
	 * A counter that fell all the way off is absent rather than spent: the load that was lost carries no
	 * figure, and the stretch until it comes back is not a load at all.
	 */
	it('closes a lost load unlabelled and starts nothing until the counter returns', () => {
		const loads = ELEMENTAL.timelineCounters(
			analysisWith([
				[0, 1],
				[1000, 5],
				[2000, 0],
				[8000, 1],
				[9000, 3],
			]),
		)[0]!.loads;

		expect(loads).toHaveLength(2);
		expect(loads[0]).toEqual({ start: 0, end: 2000, held: 5, spent: false });
		// Still charging when the log stopped: drawn to the end of the pull, and unlabelled, because no
		// press unloaded it.
		expect(loads[1]).toEqual({ start: 8000, end: DURATION_MS, held: 3, spent: false });
	});

	/** The row is named and iconed from the spec's game model, never from a literal in the chart. */
	it('names the counter row from the game model', () => {
		const counter = ELEMENTAL.timelineCounters(analysisWith(FOUR_SPENDS_AT_SEVEN))[0]!;
		const aura = ELEMENTAL.registry.aura('lightning-shield');
		expect(counter.name).toBe(aura.name);
		expect(counter.id).toBe(aura.ids[0]);
		// And the name is the one `timelineOrder.ts` places the row by, which is what keeps it in place.
		expect(counter.name).toBe('Lightning Shield');
	});

	/** The Windwalker declares none, and says so the same way every time. */
	it('answers with a stable nothing for a spec with no counter row', () => {
		const analysis = analysisWith(FOUR_SPENDS_AT_SEVEN);
		expect(WINDWALKER.timelineCounters(analysis)).toEqual([]);
		expect(WINDWALKER.timelineCounters(analysis)).toBe(WINDWALKER.timelineCounters(analysis));
	});
});
