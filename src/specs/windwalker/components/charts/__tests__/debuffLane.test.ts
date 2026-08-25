// The precondition `TrackLane` is drawable under, asserted on the chart that took the longest to
// qualify for one.
//
// A lane's bars are flex children laid end to end, so a gap between two sources does not leave a hole
// in the picture — it slides every bar after it left of the clock the reader is reading against, and
// the chart quietly stops being about the pull it is drawn over. `TrackLane`'s own docblock states
// that as the rule; this is the measurement behind the one line of it that names this chart.
//
// **It named this chart as *disqualified* until now, and on evidence that turned out not to be about a
// fixture.** The claim was that the pre-contact-scoping fallback derives its down track from drop
// durations rather than as a complement, so the sources gap on a captured pull. The first half was
// true; the second was not. Every capture in `__fixtures__` already carried `contactSegments` and
// `contactUpSegments`, so not one of them takes that branch, and all six tile. The gap was a property
// of the branch, and it is fixed at the branch — which is what the legacy suite at the bottom is for.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns, the same reason the other render tests here are written that way. The rows
// are read out of the mock rather than out of rendered markup because the lane is a set of percentage
// widths: server-rendered, a gap and a tile look identical in the HTML, which is precisely the failure
// mode being guarded against.

import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { capturedAnalyses, rawFixtures } from '~/lib/analysis/fixtures';
import { intersect, unionMs, type Interval } from '~/lib/analysis/intervals';
import { initI18n } from '~/lib/i18n/config';
import type { Analysis } from '~/lib/types';

import type { LaneSource } from '~/components/charts/TrackLane';
import { analyse } from '~/specs/windwalker/lib';

import DebuffTimeline from '../DebuffTimeline';

const drawn = vi.hoisted(() => ({ calls: [] as Array<readonly unknown[]> }));

vi.mock('~/components/charts/TrackLane', () => ({
	default: (props: { sources: readonly unknown[] }) => {
		drawn.calls.push(props.sources);
		return null;
	},
}));

initI18n();

type Drawn = Pick<LaneSource, 'label' | 'tone' | 'windows'>;

function sourcesOf(analysis: Analysis): readonly Drawn[] {
	drawn.calls.length = 0;
	renderToStaticMarkup(createElement(DebuffTimeline, { analysis, target: 'the boss' }) as ReactElement);
	expect(drawn.calls).toHaveLength(1);
	return (drawn.calls[0] ?? []) as readonly Drawn[];
}

const spans = (windows: ReadonlyArray<readonly [number, number]>): Interval[] => windows.map((w) => [w[0], w[1]]);
const byTone = (rows: readonly Drawn[], tone: string): Interval[] =>
	rows.filter((row) => row.tone === tone).flatMap((row) => spans(row.windows));

/**
 * Every committed Windwalker pull, found rather than listed, and both shapes of it.
 *
 * `__fixtures__` holds four raw `FightDataset`s and six captured `analyse()` outputs, which is an
 * accident of when each was committed rather than a distinction this claim cares about: what is
 * asserted is what the chart draws, and the chart cannot tell the two apart. So the raw ones are
 * analysed here and both halves go through one grid. A literal list of six would have covered the
 * captures and silently skipped the datasets, which is the mechanism `analysis/fixtures.ts` exists to
 * remove.
 */
const PULLS: Array<[string, Analysis]> = [
	...capturedAnalyses('windwalker').map(({ name, analysis }): [string, Analysis] => [
		name.replace(/\.json$/, ''),
		analysis,
	]),
	...rawFixtures('windwalker').map(({ name, dataset }): [string, Analysis] => [
		name.replace(/\.json$/, ''),
		analyse(dataset),
	]),
];

/**
 * What each pull draws, written down rather than only checked for closure.
 *
 * The identity below would hold on a chart that drew one bar across the whole pull and called it up,
 * so a sweep asserting only the closure asserts very little. These are the three figures a reader is
 * actually shown, and the two that matter most are the tiles': `up` is `unionMs(contactUpSegments)`,
 * which is the uptime numerator, and `away` is the array `exemptTrack.test.ts` pins against the
 * denominator's own complement. An eleventh fixture has to be read and written down here rather than
 * looped past, which is the same rule that file's `AWAY_MS` grid states.
 */
const DRAWN_MS: Record<string, { up: number; down: number; away: number }> = {
	cleave: { up: 178_968, down: 26_704, away: 2699 },
	mixed: { up: 229_067, down: 9999, away: 40_583 },
	poor: { up: 251_370, down: 1260, away: 2566 },
	strong: { up: 473_223, down: 41_955, away: 20_013 },
	waves: { up: 254_115, down: 56_502, away: 123_575 },
	weave: { up: 126_883, down: 1041, away: 1607 },
	'dataset-ironJuggernaut': { up: 186_048, down: 3570, away: 691 },
	idle: { up: 95_167, down: 64_361, away: 95_431 },
	sections: { up: 295_921, down: 89_925, away: 51_382 },
	uncounted: { up: 203_933, down: 6002, away: 1339 },
};

describe('the Rising Sun Kick lane tiles the pull', () => {
	/**
	 * The whole precondition, on every committed pull: up, dropped and away partition the fight.
	 *
	 * Both halves are asserted, because either alone is satisfiable by a wrong chart. A sum equal to
	 * `durationMs` survives a gap paid for by an equal overlap somewhere else, which is not hypothetical
	 * here — the two sources this chart derives are a complement and the complement of *that*, and a
	 * clock read one segment wide at one end moves both. So the three pairwise intersections are checked
	 * as well, and they are checked at zero rather than under a tolerance: the arrays are integers off
	 * `complementOf`, and a millisecond of slack is a millisecond of the pull attributed to two things.
	 */
	it.each(PULLS)('draws up, dropped and away as a partition of %s', (name, analysis) => {
		const rows = sourcesOf(analysis);
		const up = byTone(rows, 'kick');
		const down = byTone(rows, 'miss');
		const away = byTone(rows, 'nothing');

		expect(unionMs(up) + unionMs(down) + unionMs(away), name).toBe(analysis.durationMs);
		expect(unionMs(intersect(up, down)), name).toBe(0);
		expect(unionMs(intersect(up, away)), name).toBe(0);
		expect(unionMs(intersect(down, away)), name).toBe(0);
	});

	it.each(PULLS)('draws the figures its own tiles are made of on %s', (name, analysis) => {
		const rows = sourcesOf(analysis);

		expect(
			{
				up: unionMs(byTone(rows, 'kick')),
				down: unionMs(byTone(rows, 'miss')),
				away: unionMs(byTone(rows, 'nothing')),
			},
			name,
		).toEqual(DRAWN_MS[name]);
		// The up source is the uptime numerator itself and not something that happens to sum to it, which
		// is the claim that stops the picture and the tile above it drifting apart.
		expect(unionMs(byTone(rows, 'kick')), name).toBe(unionMs(spans(analysis.debuff.contactUpSegments ?? [])));
	});
});

/**
 * The same closure on the branch that used to break it.
 *
 * `scoped` is false on an `Analysis` captured before the contact-scoped arrays existed. Nothing
 * committed is one, so the pull is built by stripping the three fields — the construction
 * `risingSunKick.test.ts` already uses to pin the copy this branch switches to, and the only honest way
 * to test a branch whose data no longer exists on disk.
 *
 * It gapped by 1 093 to 10 712ms on the six captures, because `debuff.drops` is the primary target's
 * gaps with the longest one excluded and every length rounded to a tenth of a second, so it was never
 * the remainder of anything. Three rows could carry that and a lane cannot, which is the whole of why
 * the fallback now takes its complement the same way the scoped branch does.
 *
 * **What it may still have is an overlap, and that is asserted rather than tolerated.** `debuff.windows`
 * can run outside `engagedSegments` — the debuff ticking on the primary target while the player was off
 * it, 21 296ms on a stripped `strong` — and a lane resolves that by precedence rather than by dropping
 * time. So the closure below is over the *union* of the three, and the up source is checked to be the
 * one that overlaps: an overlap anywhere else would mean the down source had stopped being a complement
 * again.
 */
describe('the fallback branch tiles too', () => {
	const legacy = (analysis: Analysis): Analysis => {
		const older: Analysis = { ...analysis, debuff: { ...analysis.debuff } };
		delete older.debuff.contactUpSegments;
		delete older.debuff.contactSegments;
		delete older.debuff.contactMs;
		return older;
	};

	it.each(capturedAnalyses('windwalker').map(({ name, analysis }): [string, Analysis] => [name, analysis]))(
		'leaves no gap on a %s stripped of its contact arrays',
		(name, captured) => {
			const analysis = legacy(captured);
			const rows = sourcesOf(analysis);
			const up = byTone(rows, 'kick');
			const down = byTone(rows, 'miss');
			const away = byTone(rows, 'nothing');

			expect(unionMs([...up, ...down, ...away]), name).toBe(analysis.durationMs);
			// The two derived sources stay disjoint from each other and from the ground they are cut
			// against; only the primary target's own aura may escape, and only into the ground.
			expect(unionMs(intersect(up, down)), name).toBe(0);
			expect(unionMs(intersect(down, away)), name).toBe(0);
		},
	);

	// Non-vacuous in the other direction: the overlap the paragraph above describes is really there on
	// the pull it names, so the union closure is doing work a plain sum would not.
	it('paints the primary target’s aura over the ground where the two disagree', () => {
		const strong = capturedAnalyses('windwalker').find(({ name }) => name === 'strong.json');
		expect(strong).toBeDefined();
		const rows = sourcesOf(legacy(strong!.analysis));

		expect(unionMs(intersect(byTone(rows, 'kick'), byTone(rows, 'nothing')))).toBe(21_296);
		expect(rows.findIndex((row) => row.tone === 'kick')).toBeLessThan(rows.findIndex((row) => row.tone === 'nothing'));
	});
});
