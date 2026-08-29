// Every drawn lane carries the applications that paid for its windows, on every spec.
//
// **The premise.** `auraWindows` opens on an apply and closes on a remove, and a refresh landing on a
// live aura is discarded outright — deliberately, because a window is a coverage claim and counting
// refreshes would break it. The cost is a bar that says nothing about how often the aura was bought:
// Elemental Discharge draws 47 seconds of one blue bar on `B79VQfyxk8an312v` fight 43 for a buff that
// runs fourteen seconds, and `AuraLane.applications` is what puts the renewals back on the page.
//
// **Why the guard is here rather than in a spec's folder.** It shipped as a closure inside the Elemental
// audit, so the Elemental report drew its renewals and the other two specs drew none — the exact shape
// `docs/conventions.md` warns about, where one spec's fix is invisible to the next. The walk now runs
// once for every spec in `analyseCore`, so the guard sweeps every spec's raw fixtures rather than one's.
//
// This asserts the data path only — that the timestamps reach the lane, sourced and scoped to the row
// that draws them. Where `CastTimeline` puts the icon is CSS and is not something a unit test can stand
// behind; `applyNodesOf` owns the rule that a merged row draws the press instead.
import { describe, expect, it } from 'vitest';

import { rawFixtures } from '~/lib/analysis/fixtures';
import { SPECS } from '~/lib/spec/registry';
import type { Analysis } from '~/lib/types';

/** Every committed raw pull of every spec, analysed once. */
const PULLS: { spec: string; name: string; analysis: Analysis }[] = SPECS.flatMap((spec) =>
	rawFixtures(spec.key).map(({ name, dataset }) => ({
		spec: spec.key,
		name,
		analysis: spec.analyse(dataset),
	})),
);

/** Both halves of the chart's lane set: the rows it draws, and the ones the enemy picker may ask for. */
const lanesOf = (analysis: Analysis) => [
	...(analysis.timeline?.lanes ?? []),
	...(analysis.timeline?.hiddenLanes ?? []),
];

describe('a lane carries the applications that paid for its windows', () => {
	// A sweep with nothing in it passes, which is the failure this repository has been bitten by before —
	// see the non-vacuity test in `game/__tests__/undeclaredAuras.test.ts`.
	it('has pulls to sweep, on every spec', () => {
		expect(PULLS.length).toBeGreaterThan(0);
		for (const spec of SPECS)
			expect(
				PULLS.some((pull) => pull.spec === spec.key),
				spec.key,
			).toBe(true);
	});

	/**
	 * The point of the field, stated as a count: an aura renewed before it drops is more applications
	 * than windows. If no lane on a spec's pulls managed that, the marks would be telling a reader
	 * nothing they could not already read off the bars.
	 */
	it('finds a lane renewed inside its own window, on every spec', () => {
		for (const spec of SPECS) {
			const renewed = PULLS.filter((pull) => pull.spec === spec.key).flatMap((pull) =>
				lanesOf(pull.analysis).filter((lane) => (lane.applications ?? []).length > lane.windows.length),
			);
			expect(renewed.length, spec.key).toBeGreaterThan(0);
		}
	});

	/** Sorted, unique, inside the pull, and inside the row's own bars — what the chart may assume. */
	it('hands the chart clean timestamps on every committed pull', () => {
		for (const { spec, name, analysis } of PULLS) {
			for (const lane of lanesOf(analysis)) {
				const applications = lane.applications;
				if (applications === undefined) continue;
				const label = `${spec}/${name} ${lane.key}`;
				expect(
					[...applications].sort((a, b) => a - b),
					label,
				).toEqual(applications);
				expect(new Set(applications).size, label).toBe(applications.length);
				for (const at of applications) {
					expect(at, label).toBeGreaterThanOrEqual(0);
					expect(at, label).toBeLessThanOrEqual(analysis.durationMs);
					// A mark outside every bar on its own row is an icon a reader cannot attach to anything —
					// the per-spawn case `auraApplications` clips for.
					expect(
						lane.windows.some((w) => at >= w.start && at <= w.end),
						`${label} @${at}`,
					).toBe(true);
				}
			}
		}
	});
});
