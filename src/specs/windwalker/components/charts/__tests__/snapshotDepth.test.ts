// Where the snapshot-leeway label is allowed to sit, and the arithmetic that says why.
//
// The narrow-viewport sweep flagged one thing at 768px that it flagged at no other width: the proc
// chart's `g.apexcharts-inner` reaching 2.232px past the `snapshots` section, on `poor`, `strong` and
// `weave`. It is not a rounding artefact of ApexCharts' sizing — the element that reaches is the
// leeway annotation's own label box, and it reaches **23.79px past the end of the plot**, of which the
// chart's right margin absorbs all but 2.23px.
//
// The chain, measured in Chrome for Testing at 768px against the built `dist/`, with the label box read
// off `getBoundingClientRect`:
//
//   section         L=32.00  R=736.00  W=704.00
//   plot (grid)     L=143.72 R=714.45  W=570.73     — 21.55px of margin inside the section
//   label box       L=576.51 R=738.23  W=161.72     — the only leaf past the section edge
//
// `XAxisAnnotations.js` draws the label at the band's **opening** (`x1`, not its middle) and gives it no
// clip path, while the band rect beside it is masked to the grid. The band is `lastGcdMs` wide at the far
// end of the axis, so at the default 1s leeway on a 10s proc the anchor has a tenth of the plot to its
// right — 57.07px — and half the label box is 80.86px. 80.86 − 57.07 = 23.79 past the plot; 23.79 − 21.55
// = 2.24 past the section, which is the 2.232 the sweep reported. `mixed` escapes because a near miss
// widens its axis and slides the band left; below 640px the label is not drawn at all; at 1440 there is
// plot enough to absorb it. That is the whole reason 768 was the one width that showed it.
//
// There is no DOM here, so what this file can hold is the geometry the options declare and the pinned
// measurements above. The browser sweep is the proof that the pixels moved; this is the guard that the
// declaration does not drift back.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ApexOptions } from 'apexcharts';

import { initI18n } from '~/lib/i18n/config';
import type { Analysis } from '~/lib/types';

import type { ChartEnv } from '~/components/charts/ApexChart';
import type { ChartTheme } from '~/components/charts/apex';
import SnapshotDepth from '../SnapshotDepth';

/** The seam: `ApexChart` is where the option object is handed to a library that needs a window. */
const drawn = vi.hoisted(() => ({ builds: [] as Array<(env: ChartEnv) => ApexOptions> }));

vi.mock('~/components/charts/ApexChart', () => ({
	default: (props: { build: (env: ChartEnv) => ApexOptions }) => {
		drawn.builds.push(props.build);
		return null;
	},
}));

initI18n();

/** A stand-in palette: `readTheme` reads computed CSS properties, and no colour is asserted here. */
const THEME = { kick: '#k', muted: '#m', raised: '#r', mono: 'mono', line: '#l' } as unknown as ChartTheme;

const analysis = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8')) as Analysis;

/**
 * The options one render of the chart asked for, at the given breakpoint.
 *
 * `leewayMs` re-renders the same pull at another setting — the band is `procs.lastGcdMs` wide and that
 * number is the reader's, between 250 and 3 000ms, so the geometry has to hold across the range and not
 * only at the default the fixtures were captured with.
 */
function optionsFor(name: string, narrow: boolean, leewayMs?: number): ApexOptions {
	const pull = analysis(name);
	const at = leewayMs === undefined ? pull : { ...pull, procs: { ...pull.procs, lastGcdMs: leewayMs } };
	drawn.builds.length = 0;
	renderToStaticMarkup(createElement(SnapshotDepth, { analysis: at }));
	expect(drawn.builds).toHaveLength(1);
	return drawn.builds[0]!({ theme: THEME, narrow, animate: false, touch: false });
}

/** The one x-axis annotation the chart draws — the leeway band. */
const band = (options: ApexOptions) => {
	const bands = options.annotations?.xaxis ?? [];
	expect(bands).toHaveLength(1);
	return bands[0]!;
};

/** The three fixtures the sweep flagged, and the one it did not. */
const FLAGGED = ['poor', 'strong', 'weave'] as const;

describe('the snapshot-leeway label', () => {
	/**
	 * Anchored at its right edge, so its width is spent over plot that exists.
	 *
	 * The default is `middle`, and ApexCharts anchors at the band's opening rather than its centre, so
	 * `middle` spends half the label on plot past the axis maximum — which does not exist.
	 */
	it('is anchored so it cannot run past the end of the plot', () => {
		for (const name of [...FLAGGED, 'mixed'] as const) {
			const label = band(optionsFor(name, false)).label;
			expect(label?.text, name).toContain('snapshot leeway');
			expect(label?.textAnchor, name).toBe('end');
		}
	});

	/**
	 * Why `middle` could not fit at 768px, from the numbers the options themselves declare.
	 *
	 * The label box is 161.72px whatever the viewport — it is text, not plot — while the plot to the
	 * right of the anchor is a share of a grid that shrinks with the section. So the two measured
	 * constants and the axis the chart asks for are enough to reproduce the 2.23px the sweep reported,
	 * without a browser.
	 */
	it('reproduces the 2.23px the sweep measured, from the axis the chart asks for', () => {
		// Read off the built `dist/` in Chrome for Testing at 768px; see the header.
		const LABEL_BOX_PX = 161.72;
		const GRID_PX = 570.73;
		const PLOT_MARGIN_PX = 21.55;

		for (const name of FLAGGED) {
			const options = optionsFor(name, false);
			const anno = band(options);
			const axisMax = Number(options.xaxis?.max);
			// The band runs from its opening to the axis maximum on these three, because none of them has
			// a near miss to widen the axis past the proc — which is the fixture fact the rest rests on.
			expect(Number(anno.x2), name).toBeCloseTo(axisMax, 6);
			// The plot left to the right of the anchor, in pixels of a 768px render.
			const roomPx = (GRID_PX * (axisMax - Number(anno.x))) / axisMax;
			expect(roomPx, name).toBeCloseTo(57.07, 1);
			// Centred, the label would have hung this far past the plot, and this far past the section.
			expect(LABEL_BOX_PX / 2 - roomPx, name).toBeCloseTo(23.79, 1);
			expect(LABEL_BOX_PX / 2 - roomPx - PLOT_MARGIN_PX, name).toBeCloseTo(2.23, 1);
			// And anchored at its right edge it is inside the plot at both ends.
			expect(GRID_PX - roomPx - LABEL_BOX_PX, name).toBeGreaterThan(0);
		}

		// `mixed` is the control: its near miss widens the axis past the proc, so the band's opening sits
		// further from the end and the centred label had room. It is why three fixtures flagged and not
		// four, and it is why the fix cannot be read off one pull.
		const mixed = optionsFor('mixed', false);
		const mixedBand = band(mixed);
		expect(Number(mixedBand.x2)).toBeLessThan(Number(mixed.xaxis?.max));
		const mixedRoom = (GRID_PX * (Number(mixed.xaxis?.max) - Number(mixedBand.x))) / Number(mixed.xaxis?.max);
		expect(LABEL_BOX_PX / 2 - mixedRoom).toBeLessThan(0);
	});

	/**
	 * The reader's own setting is what makes this a defect rather than a two-pixel curiosity.
	 *
	 * `WW_SETTINGS` puts the leeway between 250 and 3 000ms, and the band **is** that number, so the
	 * anchor's distance from the end of the plot is the setting. At the floor it is 11.41px of a 570.73px
	 * grid, against 80.86px of label to its right — so centred, the label ran 47.90px past the section,
	 * far enough that its glyphs and not merely its background box went into the clip. The 2.23px the
	 * sweep found is the default setting's corner of that, and nothing in the committed fixtures could
	 * have shown the rest of it.
	 *
	 * Anchored at its right edge it is inside the plot at **both** ends across the whole range: the
	 * label's own 161.72px against the plot left of the anchor, which is smallest at the ceiling.
	 */
	it('keeps the label inside the plot across the whole leeway setting, and would not have centred', () => {
		const LABEL_BOX_PX = 161.72;
		const GRID_PX = 570.73;
		const PLOT_MARGIN_PX = 21.55;
		// The setting's own floor, default and ceiling — `WW_SETTINGS.snapshotLeewayMs`.
		for (const leewayMs of [250, 1000, 3000]) {
			const options = optionsFor('poor', false, leewayMs);
			const anno = band(options);
			const axisMax = Number(options.xaxis?.max);
			// The band still ends at the axis maximum and still opens earlier as the setting grows. Not
			// asserted as `leewayMs / 1000`: both edges pass through `r1` independently, so at the floor a
			// 0.25s setting draws a 0.2s band — the annotation's own rounding, and not this label's
			// business.
			expect(Number(anno.x2), `${leewayMs} end`).toBeCloseTo(axisMax, 6);
			expect(axisMax - Number(anno.x), `${leewayMs} opening`).toBeGreaterThan(0);
			const roomPx = (GRID_PX * (axisMax - Number(anno.x))) / axisMax;
			// Anchored at its right edge: inside the plot to the right by construction, and inside it to
			// the left because the label is narrower than the plot that remains.
			expect(GRID_PX - roomPx - LABEL_BOX_PX, `${leewayMs} left`).toBeGreaterThan(0);
		}
		// And the floor is where centring was worst, which is the reachable case no fixture holds.
		const floor = optionsFor('poor', false, 250);
		const floorRoom = (GRID_PX * (Number(floor.xaxis?.max) - Number(band(floor).x))) / Number(floor.xaxis?.max);
		expect(floorRoom).toBeCloseTo(11.41, 1);
		expect(LABEL_BOX_PX / 2 - floorRoom - PLOT_MARGIN_PX).toBeCloseTo(47.9, 1);
	});

	/**
	 * A no-change guard, labelled: below 640px there is no label to anchor.
	 *
	 * `narrow` drops it entirely, which is why the sweep is clean at 320, 360, 375 and 390 — and why a
	 * fix aimed at the narrow widths would have been aimed at nothing.
	 */
	it('is not drawn at all on a phone', () => {
		for (const name of [...FLAGGED, 'mixed'] as const) {
			expect(band(optionsFor(name, true)).label, name).toBeUndefined(); // no-change guard
		}
	});
});
