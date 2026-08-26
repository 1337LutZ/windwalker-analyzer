// The summary strip: the pull's own shape, drawn once, carrying nothing else.
//
// Three claims are worth a test here and none is expressible as a type. The first is the partition —
// `analysis.segments` tiles the pull exactly, and this lane is the only place a reader ever sees that
// reading, so a mapping bug that dropped or reordered a stretch would be invisible everywhere else.
// The second is the absence: per-stretch scoring does not exist, and a lane that quietly grew a letter
// would be reporting an answer nothing computed. The third arrived with the colours — the count is
// written on every bar wide enough to hold it, so a reader who cannot separate two steps of one violet
// ramp still reads the chart, and a lane that stopped saying it would fail nobody visibly.
//
// It reads the spans out of `SegmentLane` rather than out of the rendered HTML, for the reason
// `charts/__tests__/exemptTrack.test.ts` gives about its own chart: what the component decides is which
// spans to hand over, and asserting on the markup would be testing Tailwind. The mock is the seam.
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

import type { LaneSpan } from '~/components/charts/SegmentLane';
import { COUNT, EXEMPT, SWATCH } from '~/components/charts/tones';
import SegmentStrip from '~/components/sections/SegmentStrip';
import { analyse } from '~/specs/elemental/lib';

const drawn = vi.hoisted(() => ({ calls: [] as Array<{ spans: readonly LaneSpan[]; label: string }> }));

vi.mock('~/components/charts/SegmentLane', () => ({
	default: (props: { spans: readonly LaneSpan[]; label: string }) => {
		drawn.calls.push(props);
		return null;
	},
}));

initI18n();

/** What one render asked to be drawn: the markup around the chart, and the bars inside it. */
function draw(element: ReactElement): { markup: string; spans: readonly LaneSpan[] } {
	drawn.calls.length = 0;
	const markup = renderToStaticMarkup(element);
	expect(drawn.calls.length).toBeLessThan(2);
	return { markup, spans: drawn.calls[0]?.spans ?? [] };
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

describe('the summary strip', () => {
	it('draws nothing at all on a pull that never changed shape', () => {
		// Iron Juggernaut and Malkorok, for the Windwalker: one stretch is a whole-pull reading, and the
		// whole-pull reading is already the headline above it.
		expect(draw(createElement(SegmentStrip, { analysis: pull([segment(0, 0, 300_000, 'single')]) }))).toEqual({
			markup: '',
			spans: [],
		});
	});

	it('draws nothing on an analysis captured before the timeline existed', () => {
		// Every committed capture is one of these. `segments` is optional for exactly this reason, so the
		// absent case is the ordinary one rather than a defensive check.
		expect(draw(createElement(SegmentStrip, { analysis: pull(undefined) }))).toEqual({ markup: '', spans: [] });
	});

	it('hands the whole pull to the lane exactly once, in the order it happened', () => {
		// The partition invariant `analysis/__tests__/segments.test.ts` asserts of the timeline, asserted
		// again of the *drawn* bars: this is the only place a reader sees it. Order is half the assertion
		// and it is the half the lane exists for — five rows grouped the stretches by mode and lost it.
		const { spans } = draw(createElement(SegmentStrip, { analysis: pull(EVERY_MODE) }));
		expect(spans.map((span) => [span.startMs, span.endMs])).toEqual([
			[0, 60_000],
			[60_000, 120_000],
			[120_000, 180_000],
			[180_000, 240_000],
			[240_000, 300_000],
		]);
		expect(spans.map((span) => span.tone)).toEqual(['single', 'idle', 'aoe', 'mixed', 'cleave']);
	});

	it('paints the stretches with nothing up in the tone every other chart leaves out of its figures', () => {
		const { spans } = draw(createElement(SegmentStrip, { analysis: pull(EVERY_MODE) }));
		// The ramp means a quantity and only a quantity, so the one stretch that is not a quantity takes
		// the same grey the exempt row takes everywhere else. A bar painted in a judgement tone would be
		// grading a stretch, and nothing here grades one.
		const idle = spans.find((span) => span.tone === 'idle');
		expect(idle).toBeDefined();
		expect(COUNT.idle.swatch).toBe(SWATCH[EXEMPT]);
	});

	it('writes the count on the bar as well as colouring it', () => {
		// The condition for a ramp being usable here at all. Two of the five bars are middle steps of one
		// violet, and a reader who cannot separate them has to be able to read the lane anyway — so every
		// bar carries its own count, and every bar carries its full name in a tooltip whatever its width.
		const { spans } = draw(createElement(SegmentStrip, { analysis: pull(EVERY_MODE) }));
		// **The mixed bar carries a number too, and used not to.** A bare `~` said only "it moved", which
		// is what the bar's own hatch already says — so the longest stretch of some pulls was the least
		// informative bar on the chart. `~1` is the segment's own median with the "it moved" kept, which
		// is both halves of what mixed means.
		expect(spans.map((span) => span.short)).toEqual(['1', '—', '3+', '~1', '2']);
		expect(spans.map((span) => span.label)).toEqual([
			'One enemy',
			'Nothing hit',
			'Three or more enemies',
			'Coming and going',
			'Two enemies',
		]);
		expect(spans.every((span) => span.lengthLabel.length > 0)).toBe(true);
	});

	it('names in the key only the modes the pull actually held, in the order the ramp rises', () => {
		const withIdle = draw(createElement(SegmentStrip, { analysis: pull(EVERY_MODE) }));
		expect(withIdle.markup).toContain('Nothing hit');
		const fought = [segment(0, 0, 150_000, 'single'), segment(1, 150_000, 300_000, 'aoe')];
		const withoutIdle = draw(createElement(SegmentStrip, { analysis: pull(fought) }));
		// A swatch for a bar the reader cannot find is a swatch they will go looking for.
		expect(withoutIdle.markup).not.toContain('Nothing hit');
		expect(withoutIdle.markup).not.toContain('Two enemies');
		expect(withoutIdle.markup.indexOf('One enemy')).toBeLessThan(withoutIdle.markup.indexOf('Three or more'));
		// And it still drew: the assertions above have to be about the key rather than an empty render.
		expect(withoutIdle.markup).toContain('What you were fighting');
		expect(withoutIdle.spans).toHaveLength(2);
	});

	it('draws a real pull as the bars the analysis cut it into', () => {
		// `phased` is Iron Juggernaut 25H, the fixture `charts/__tests__/exemptTrack.test.ts` uses for the
		// same reason: the boss submerges for fifty seconds, so this pull is the one that exercises both an
		// idle stretch and the partition on data nobody wrote by hand.
		const found = rawFixtures('elemental').find((fixture) => fixture.name === 'phased.json');
		if (found === undefined) throw new Error('no raw Elemental fixture phased');
		const analysis = analyse(found.dataset);
		const cut = analysis.segments?.segments ?? [];
		expect(cut.length).toBeGreaterThan(1);

		const { spans } = draw(createElement(SegmentStrip, { analysis }));
		expect(spans.map((span) => [span.startMs, span.endMs, span.tone])).toEqual(
			cut.map((one) => [one.startMs, one.endMs, one.mode]),
		);
		expect(spans[0]?.startMs).toBe(0);
		expect(spans.at(-1)?.endMs).toBe(analysis.durationMs);
		expect(spans.some((span) => span.tone === 'idle')).toBe(true);
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
