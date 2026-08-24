// The summary strip: the pull's own shape, drawn once, carrying nothing else.
//
// Two claims are worth a test here and neither is expressible as a type. The first is the partition —
// `analysis.segments` tiles the pull exactly, and this row is the only place a reader ever sees that
// reading, so a grouping bug that dropped or doubled a stretch would be invisible everywhere else.
// The second is the absence: per-stretch scoring does not exist, and a strip that quietly grew a
// letter would be reporting an answer nothing computed.
//
// It reads the rows out of `WindowTracks` rather than out of the rendered HTML, for the reason
// `charts/__tests__/exemptTrack.test.ts` gives: the chart is a canvas ApexCharts draws in an effect,
// so server-rendered there is nothing in the box to assert on. The mock is the seam.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { rawFixtures } from '~/lib/analysis/fixtures';
import type { FightSegment, SegmentMode } from '~/lib/analysis/segments';
import { initI18n } from '~/lib/i18n/config';
import type { Analysis } from '~/lib/types';

import { EXEMPT } from '~/components/charts/tones';
import type { Track } from '~/components/charts/WindowTracks';
import SegmentStrip from '~/components/sections/SegmentStrip';
import { analyse } from '~/specs/elemental/lib';

const drawn = vi.hoisted(() => ({ calls: [] as Array<{ tracks: readonly Track[]; label: string }> }));

vi.mock('~/components/charts/WindowTracks', () => ({
	default: (props: { tracks: readonly Track[]; label: string }) => {
		drawn.calls.push(props);
		return null;
	},
}));

initI18n();

/** What one render asked to be drawn: the markup around the chart, and the rows inside it. */
function draw(element: ReactElement): { markup: string; tracks: readonly Track[] } {
	drawn.calls.length = 0;
	const markup = renderToStaticMarkup(element);
	expect(drawn.calls.length).toBeLessThan(2);
	return { markup, tracks: drawn.calls[0]?.tracks ?? [] };
}

/**
 * One segment, with only the fields this row reads filled in.
 *
 * The rest of `FightSegment` — `dominance`, `bands`, `medianEnemies`, `msByCount` — is what a *rule*
 * reads, and a strip that needed any of it would be doing more than drawing. Left off deliberately, so
 * that reaching for one is a type error rather than a quiet widening of what this component knows.
 */
const segment = (index: number, startMs: number, endMs: number, mode: SegmentMode): FightSegment => ({
	index,
	startMs,
	endMs,
	mode,
	dominance: 1,
	bands: [],
	medianEnemies: mode === 'idle' ? 0 : 1,
	msByCount: {},
});

const pull = (segments: readonly FightSegment[] | undefined, durationMs = 300_000): Analysis =>
	({
		durationMs,
		segments: segments === undefined ? undefined : { floorMs: 8000, segments },
	}) as unknown as Analysis;

/** The 300s pull the ordering and tone assertions run on: every mode present, once each. */
const EVERY_MODE = [
	segment(0, 0, 60_000, 'single'),
	segment(1, 60_000, 120_000, 'idle'),
	segment(2, 120_000, 180_000, 'aoe'),
	segment(3, 180_000, 240_000, 'mixed'),
	segment(4, 240_000, 300_000, 'cleave'),
];

const spans = (tracks: readonly Track[]): Array<readonly [number, number]> =>
	tracks.flatMap((track) => [...track.windows]).sort((a, b) => a[0] - b[0]);

describe('the summary strip', () => {
	it('draws nothing at all on a pull that never changed shape', () => {
		// Iron Juggernaut and Malkorok, for the Windwalker: one stretch is a whole-pull reading, and the
		// whole-pull reading is already the headline above it.
		expect(draw(createElement(SegmentStrip, { analysis: pull([segment(0, 0, 300_000, 'single')]) }))).toEqual({
			markup: '',
			tracks: [],
		});
	});

	it('draws nothing on an analysis captured before the timeline existed', () => {
		// Every committed capture is one of these. `segments` is optional for exactly this reason, so the
		// absent case is the ordinary one rather than a defensive check.
		expect(draw(createElement(SegmentStrip, { analysis: pull(undefined) }))).toEqual({ markup: '', tracks: [] });
	});

	it('gives every mode a row, in count order, with the row that is not a count at the foot', () => {
		const { tracks } = draw(createElement(SegmentStrip, { analysis: pull(EVERY_MODE) }));
		expect(tracks.map((track) => track.label)).toEqual([
			'One enemy',
			'Two enemies',
			'Three or more enemies',
			'Coming and going',
			'Nothing to hit',
		]);
	});

	it('paints the stretches with nothing up in the tone every other chart leaves out of its figures', () => {
		const { tracks } = draw(createElement(SegmentStrip, { analysis: pull(EVERY_MODE) }));
		// One tone for the four rows that are time the player could act in, and the exempt grey for the
		// one that is not — which is the whole of what the colour on this chart claims. A row painted in
		// a judgement tone would be grading a stretch, and nothing here grades one.
		expect(tracks.map((track) => track.tone)).toEqual(['kick', 'kick', 'kick', 'kick', EXEMPT]);
		expect(tracks.at(-1)?.tone).toBe(EXEMPT);
	});

	it('hands the whole pull to the rows exactly once', () => {
		// The partition invariant `analysis/__tests__/segments.test.ts` asserts of the timeline, asserted
		// again of the *drawn* rows: this is the only place a reader sees it, so a filter that dropped a
		// mode or a grouping that duplicated one would show up nowhere else.
		const { tracks } = draw(createElement(SegmentStrip, { analysis: pull(EVERY_MODE) }));
		expect(spans(tracks)).toEqual([
			[0, 60_000],
			[60_000, 120_000],
			[120_000, 180_000],
			[180_000, 240_000],
			[240_000, 300_000],
		]);
	});

	it('names the grey in the key only where the pull has some', () => {
		const withIdle = draw(createElement(SegmentStrip, { analysis: pull(EVERY_MODE) }));
		expect(withIdle.markup).toContain('Nothing to hit');
		const fought = [segment(0, 0, 150_000, 'single'), segment(1, 150_000, 300_000, 'aoe')];
		const withoutIdle = draw(createElement(SegmentStrip, { analysis: pull(fought) }));
		expect(withoutIdle.markup).not.toContain('Nothing to hit');
		// And it still drew: the assertion above has to be about the key rather than about an empty render.
		expect(withoutIdle.markup).toContain('What you were fighting');
	});

	it('draws a real pull as the rows the analysis cut it into', () => {
		// `phased` is Iron Juggernaut 25H, the fixture `charts/__tests__/exemptTrack.test.ts` uses for the
		// same reason: the boss submerges for fifty seconds, so this pull is the one that exercises both an
		// idle row and the partition on data nobody wrote by hand.
		const found = rawFixtures('elemental').find((fixture) => fixture.name === 'phased.json');
		if (found === undefined) throw new Error('no raw Elemental fixture phased');
		const analysis = analyse(found.dataset);
		const cut = analysis.segments?.segments ?? [];
		expect(cut.length).toBeGreaterThan(1);

		const { tracks } = draw(createElement(SegmentStrip, { analysis }));
		expect(spans(tracks)).toEqual(cut.map((one) => [one.startMs, one.endMs]));
		expect(spans(tracks)[0]?.[0]).toBe(0);
		expect(spans(tracks).at(-1)?.[1]).toBe(analysis.durationMs);
		expect(tracks.find((track) => track.tone === EXEMPT)?.windows.length).toBeGreaterThan(0);
	});

	it('reads nothing but the timeline, so no letter can reach the strip', () => {
		// Grep-shaped, and about the *code* rather than a render, because the failure it guards against is
		// a later lane wiring the scorecard in — per-stretch scoring does not exist, and a strip showing a
		// letter it invented is worse than a strip showing none. Comments are stripped first: this file's
		// own argument is written in the words it is banning, the same way `keys.test.ts` reads a
		// declaration with its prose taken out.
		const source = readFileSync(resolve(import.meta.dirname, '../sections/SegmentStrip.tsx'), 'utf8').replaceAll(
			/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
			'',
		);
		for (const word of ['grade', 'score', 'Score', 'useReportCopy', 'verdict']) expect(source).not.toContain(word);
	});
});
