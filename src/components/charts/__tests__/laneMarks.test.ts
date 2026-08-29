// The marks that say when an aura went up, on the bar that says it was up.
//
// `auraWindows` closes a window on a remove and discards every refresh inside a live one, so a lane
// held across a phase is one unbroken bar and the presses that paid for it are nowhere on the chart —
// Elemental Discharge draws 47 seconds of it for a buff that runs fourteen. `AuraLane.applications` is
// the engine's answer, filled for every spec in `analyseCore`, and `applyNodesOf` is what draws it.
//
// `createElement` rather than JSX so this stays a `.ts` file and vitest's include patterns pick it up,
// the same reason the other render tests in this folder are written that way. The marks are plain DOM —
// this chart is the one view here that is not an ApexCharts chart — so a static render carries them,
// and `data-tip-applied` is on the mark and on nothing else, which is what these count.

import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import CastTimeline from '../CastTimeline';
import { refreshesOf } from '../LanesTimeline';
import { SpecContext } from '~/components/report/specContext';
import { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis, AuraLane, CastMark } from '~/lib/types';

initI18n();

const SPEC = getSpec('elemental')!;
const render = (node: ReactNode): string =>
	renderToStaticMarkup(createElement(SpecContext.Provider, { value: SPEC }, node) as ReactElement);

const DURATION_MS = 120_000;

/** Flame Shock, because both the spec model and the icon map answer for it. */
const FS = { key: 'flame-shock', name: 'Flame Shock', id: 8050 } as const;

const analysisWith = (lane: AuraLane, casts: CastMark[] = []): Analysis =>
	({
		durationMs: DURATION_MS,
		casts: [],
		// The chart reads the damage table to tier its press rows, and the resources to draw its bars.
		// Empty is a pull that did nothing, which is all these tests need it to be.
		damage: { abilities: [], totalDamage: 0, dps: 0 },
		resources: {},
		timeline: { casts, lanes: [lane], deaths: [] },
	}) as unknown as Analysis;

/** One mark carries one `data-tip-applied`, and nothing else on the chart carries any. */
const marksIn = (markup: string): number => markup.match(/data-tip-applied/g)?.length ?? 0;

const laneWith = (applications: number[], extra: Partial<AuraLane> = {}): AuraLane => ({
	...FS,
	group: 'debuff',
	windows: [{ start: 0, end: 100_000 }],
	applications,
	...extra,
});

describe('an aura lane marks its applications on the bar', () => {
	it('draws one mark per application on a row with no press of its own', () => {
		expect(
			marksIn(render(createElement(CastTimeline, { analysis: analysisWith(laneWith([0, 20_000, 40_000])) }))),
		).toBe(3);
	});

	/**
	 * The merged row draws the button once, not the button and the buff on one pixel.
	 *
	 * A press and the aura it applies are one row on this chart, and the press is already drawn there in
	 * the button's own art. The buff a cast applies is logged within a couple of milliseconds of the cast,
	 * which is what `SELF_EVENT_MS` is for and what decides the application belongs to that press.
	 */
	it('leaves the application a press on the same row already accounts for', () => {
		const casts: CastMark[] = [{ t: 20_000, id: 51505, name: FS.name, onGcd: true }];
		const markup = render(
			createElement(CastTimeline, { analysis: analysisWith(laneWith([0, 20_000, 40_000]), casts) }),
		);
		expect(marksIn(markup)).toBe(2);
	});

	/**
	 * A counter row is its own record of every load and spend, drawn as steps rather than as windows.
	 * Marks over it would be those same events a second time, in art, on top of the meter they came from
	 * — `capacitance` carries 130 applications on one committed Protection pull.
	 */
	it('draws nothing on a row the engine handed a counter', () => {
		const lane = laneWith([0, 20_000, 40_000], {
			stacks: {
				points: [
					[0, 1],
					[20_000, 2],
				],
				max: 2,
				payoff: 'Lightning Strike',
				payoffId: 8050,
				discharges: [],
			},
		});
		expect(marksIn(render(createElement(CastTimeline, { analysis: analysisWith(lane) })))).toBe(0);
	});

	/**
	 * Only as many as this zoom has room for.
	 *
	 * Ancestral Vigor is re-applied to the whole raid all pull: 314 applications inside one window on the
	 * Protection `garrosh` fixture. A 24px icon every few pixels is a strip of art that says less than the
	 * bare bar did, so a mark is drawn only when it clears the last one drawn by its own width — and the
	 * zoom ladder is what separates the rest.
	 */
	it('thins marks that could not be told apart at this zoom', () => {
		const crowded = Array.from({ length: 60 }, (_, i) => i * 500);
		const drawn = marksIn(render(createElement(CastTimeline, { analysis: analysisWith(laneWith(crowded)) })));
		expect(drawn).toBeGreaterThan(0);
		expect(drawn).toBeLessThan(crowded.length);
	});
});

/**
 * The summary timeline's own cut, which is not the cast log's.
 *
 * `PullTimeline` draws a tick per renewal and nothing at a bar's start: the left edge is that
 * application already, at full height, and a mark on top of it is a second drawing of one event. The
 * cast log keeps both, because a merged row there is read against the presses beside it.
 */
describe('the summary timeline marks renewals and not openings', () => {
	it('drops the application that opened each window', () => {
		const lane = laneWith([0, 20_000, 60_000], {
			windows: [
				{ start: 0, end: 30_000 },
				{ start: 60_000, end: 90_000 },
			],
		});
		expect(refreshesOf(lane)).toEqual([20_000]);
	});

	/** A lane the log carries no applications for is not a lane with an empty one; both draw nothing. */
	it('answers with nothing when the engine wrote no applications', () => {
		const bare: AuraLane = { ...FS, group: 'debuff', windows: [{ start: 0, end: 30_000 }] };
		expect(refreshesOf(bare)).toEqual([]);
	});
});
