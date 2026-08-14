// What a chart looks like before ApexCharts has arrived — which is what a reader on a cold cache
// actually sees, and where every one of this page's layout jumps used to come from.
//
// The server render *is* the loading state, and not by approximation: ApexCharts is imported inside
// an effect, effects do not run under `renderToStaticMarkup`, so what comes out of it here is
// byte-for-byte the placeholder the browser puts up on first paint.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';

import ApexChart from '../ApexChart';

initI18n();
const t = i18n.getFixedT('en', 'ui');

const LABEL = 'Damage by ability, nine rows';

const render = (height: number) =>
	renderToStaticMarkup(createElement(ApexChart, { build: () => ({}), height, label: LABEL }));

describe('ApexChart before it has drawn', () => {
	/**
	 * The whole point of the exercise. Charts derive their height from their row count — nine
	 * abilities at 38px plus chrome, three debuff tracks at 34, a fixed 240 for the brew bank — and
	 * every one of those numbers has to be standing in the layout before the library resolves, or the
	 * section below shifts by exactly that much when it does.
	 */
	it('reserves the height the chart will draw at', () => {
		expect(render(9 * 38 + 56)).toMatch(/style="height:\s*398px"/);
		expect(render(240)).toMatch(/style="height:\s*240px"/);
	});

	/** The placeholder fills the reserved box rather than sitting inside part of it. */
	it('fills the box it reserved', () => {
		expect(render(240)).toMatch(/class="absolute inset-0\b/);
	});

	/**
	 * The caption is app-shell copy and lives in `ui.json` like the rest of it. It was hardcoded here
	 * for a while *and* present in the locale, unused — two copies of one string, which is how a
	 * translation quietly stops applying to the one place it was written for.
	 */
	it('takes its caption from the locale', () => {
		expect(render(240)).toContain(t('chart.drawing'));
	});

	/**
	 * A placeholder must not pass itself off as content. `role="img"` with the chart's summary on it
	 * describes a picture that is not on the page yet; the box stays silent until the draw lands, and
	 * what a reader hears in the meantime is the fetch's own progress, announced once for the page.
	 */
	it('does not announce itself as the chart it is standing in for', () => {
		const html = render(240);
		expect(html).not.toContain('role="img"');
		expect(html).not.toContain(LABEL);
		expect(html).toContain('aria-hidden="true"');
	});

	/**
	 * Motion is opt-in per reader, not opt-out. The blanket reduced-motion rule in global.css only
	 * collapses a running animation's duration, so the guard has to be on the class itself.
	 */
	it('only breathes for a reader who has not asked it to stop', () => {
		// Every occurrence, listed, so an unguarded `animate-pulse` cannot hide behind a guarded one —
		// and exactly one of them, because a bar-per-animation placeholder is the slot machine this
		// replaced.
		expect(render(240).match(/(?:motion-safe:)?animate-pulse/g)).toEqual(['motion-safe:animate-pulse']);
	});
});
