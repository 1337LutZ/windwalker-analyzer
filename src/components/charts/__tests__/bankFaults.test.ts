// The cast log's counter row draws the same faults the section that argues it does.
//
// This test exists because the first attempt at it landed in the wrong chart. The request was for the
// Lightning Shield row in the cast log — the "Timeline" section — and the fault marking was built on
// `timelineCounters`, which only the *summary* timeline reads. Both drawings were verified against
// hand-built objects, which is exactly the check that cannot tell one chart from the other. So the
// claim here is nailed to the rendered markup of `CastTimeline` and to a real pull.
//
// `createElement` rather than JSX so this stays a `.ts` file and vitest's own include patterns pick it
// up (see `vitest.config.ts` — only `.ts` is collected).
//
// **Why the markup is readable here at all**, where the other chart tests have to mock a seam:
// `ResourceTrack` is hand-written SVG rather than an ApexCharts canvas, precisely so it stretches with
// its container — so its `<rect>`s are in the server-rendered HTML and can be counted.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '~/specs/elemental/lib';
import { timelineBanks } from '~/specs/elemental/lib/view/timelineBanks';

import CastTimeline from '../CastTimeline';
import { cappedOf } from '../capped';
import { BAND } from '../tones';
import { SpecContext } from '~/components/report/specContext';

initI18n();

const ELEMENTAL = getSpec('elemental')!;

/**
 * The one committed Elemental pull that carries all three of the shield's faults: it lost the shield
 * once, sat at seven past the leeway nine times, and spent one shock below full.
 *
 * A raw dataset run through `analyse`, not a stored `Analysis` — the audit fields these windows come
 * from are computed, and the pre-analysed fixtures predate several of them.
 */
const cleave = analyse(
	JSON.parse(
		readFileSync(resolve(import.meta.dirname, '../../../specs/elemental/__fixtures__/cleave.json'), 'utf8'),
	) as FightDataset,
) as Analysis & ElementalAuditResult;

describe("the Lightning Shield bank's faults", () => {
	it("are the section's three, passed through rather than re-derived", () => {
		const shield = cleave.lightningShield;
		// Pinned so the fixture cannot quietly stop covering a fault and leave the rest of this suite
		// asserting over an empty list.
		// Nine overcap windows, and this figure has now moved twice in opposite directions: nine until the
		// clock learned to drop this pull's AoE stretches, eight after that, and nine again now those
		// stretches no longer carry a full 5 000ms window of lag past the last hit that made them — the
		// trailing-edge trim on `analyseCore`'s `aoeWindows`, derived in `analysis/targetTails.test.ts`.
		// Each time the bank moved with the section rather than against it, which is the point of the
		// pass-through and not a drift: the two drawings of one aura cannot disagree about the pull.
		expect([shield.downWindows.length, shield.overcapWindows.length, shield.badSpends.length]).toEqual([1, 9, 1]);

		const bank = timelineBanks(cleave)[0]!;
		expect(bank.faultWindows).toEqual([
			...shield.downWindows,
			...shield.overcapWindows,
			...shield.badSpends.map((spend) => ({ start: spend.t, end: spend.t, text: `${spend.stacks}` })),
		]);
		// The note is on the instant faults and only on them: a stretch is wide enough to read as itself,
		// and a number on every overcap window would be a row of figures over the curve.
		expect(bank.faultWindows!.filter((w) => w.text !== undefined)).toEqual([
			{ start: shield.badSpends[0]!.t, end: shield.badSpends[0]!.t, text: '5' },
		]);
	});

	it('cannot be derived from the curve, which is why they are handed over', () => {
		const bank = timelineBanks(cleave)[0]!;
		// `cappedOf` is what `ceilingIsWaste: true` would have used, and on this series it finds **nothing**
		// — not merely less, nothing at all. It reads a stretch at the ceiling off two adjacent readings
		// both at the ceiling, and this curve has no such pair: `lsPoints` carries one point per stack
		// change stamped at its start, so the shield sitting at seven for forty seconds is a single point
		// followed by whatever spent it.
		//
		// So the two mechanisms are not interchangeable in either direction. The audit works from
		// `lsLevels`, which are stretches with their own ends — the same reason `atCapWindows` is passed
		// those rather than the points, so that a window at the ceiling cannot be run across an absence.
		expect(cappedOf(bank.curve)).toEqual([]);
		// 119 313ms before the overcap clock dropped the stretches the AoE list applied to, 28 625ms while
		// those stretches still ran a full window past the last hit that made them, and 42 157ms now the
		// trailing edge is cut to one global. The comparison this test makes is unaffected by any of it —
		// `cappedOf` still finds *nothing* on this series, whatever the audit's figure is, because a stretch
		// at the ceiling is a single point in `lsPoints`. The number is here only so the two mechanisms are
		// compared against a stated figure rather than against each other.
		expect(cleave.lightningShield.overcapMs).toBe(42_157);
	});

	it('reach the cast log as shaded rects, one per fault', () => {
		const html = renderToStaticMarkup(
			createElement(SpecContext.Provider, { value: ELEMENTAL }, createElement(CastTimeline, { analysis: cleave })),
		);
		const faults = html.split(BAND.miss.fill).length - 1;
		expect(faults).toBe(timelineBanks(cleave)[0]!.faultWindows!.length);
		// And not through the ceiling wash, which this bank deliberately does not use: sitting at seven is
		// the state the rotation is trying to be in.
		expect(html).not.toContain('fill-miss/25');
		// The bad spend's level, in the fault colour rather than the track's muted default — the same red
		// number the section writes over that shock. Matched as the note's own span so this cannot pass on
		// a `4` that happens to appear somewhere else in a chart full of figures.
		expect(html).toMatch(new RegExp(`<span class="[^"]*${BAND.miss.text}[^"]*"[^>]*>5</span>`));
	});
});
