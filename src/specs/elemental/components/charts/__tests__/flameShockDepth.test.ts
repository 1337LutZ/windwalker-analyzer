// What the Flame Shock band and its siblings are allowed to claim.
//
// The window a refresh is graded against is measured per press off the log's own ticks, and it moves
// inside a single pull: `phased` grades its refreshes against 1 349ms, 1 748ms and 2 275ms as Bloodlust
// and Elemental Mastery fall off, and `unbroken`'s press at 83 852 is a rollover against its own
// 2 246ms tick while the pull's median window is 1 726ms. So no piece of copy may name a number for it,
// and none may call it a window the reader set: the band read "refresh window 1.3s" and the tiles read
// "keep-up window", both of which assert one window for a pull that had three.
//
// These assertions are against literal strings rather than against another `t()` call on purpose — a
// test whose two sides both come out of the locale file passes whatever the locale file says.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import { fmt } from '~/components/format';
import { getSpec } from '~/lib/spec';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';
import type { ChartTheme } from '~/components/charts/apex';
import FlameShock from '../../sections/FlameShock';
import { buildBars } from '../FlameShockDepth';
import EarthShock from '../../sections/EarthShock';

const ELEMENTAL_SPEC = getSpec('elemental')!;

initI18n();
const t = i18n.getFixedT('en', 'report');

type El = Analysis & ElementalAuditResult;

/** `a:xB3kh7v9pF2AHRtq` #16 — one apply, six refreshes, two of them inside their own last tick. */
const unbroken: El = analyse(
	JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../__fixtures__/unbroken.json'), 'utf8')) as FightDataset,
) as El;

const html = renderToStaticMarkup(
	createElement(
		SpecContext.Provider,
		{ value: ELEMENTAL_SPEC },
		createElement(FlameShock, { analysis: unbroken as Analysis }),
	),
);

describe('Flame Shock last-tick copy', () => {
	it('labels the band "last tick" and quotes no window', () => {
		expect(t('flameShock.chart.band')).toBe('last tick');
		// No number, and nothing left of the interpolation: the chart passes no argument now, and an
		// unused one must not resurrect a figure either.
		expect(t('flameShock.chart.band')).not.toMatch(/\d/);
		expect(t('flameShock.chart.band', { window: 1.3 })).toBe('last tick');
	});

	it('names the last tick in the tile, the state and the chart key', () => {
		expect(t('flameShock.kpi.windowed')).toBe('In the last tick');
		expect(t('flameShock.state.windowed')).toBe('Last-tick refresh');
		expect(t('flameShock.chart.key.windowed')).toBe('In the last tick');
	});

	it('renders that wording in the section rather than only holding it in the locale', () => {
		// The tile label, the chart key, and the row state of a press that rolled its last tick — the
		// pull has two, so the state cell is really exercised.
		expect(unbroken.flameShock.windowed).toBe(2);
		expect(html).toContain('In the last tick');
		expect(html).toContain('Last-tick refresh');
	});

	it('never describes the window as one the reader keeps up or sets', () => {
		// The exact retired strings, not the word "keep-up" — `verdict_good_full` legitimately calls a
		// flawless pull "a perfect keep-up", and banning the word would fail on a grade change instead of
		// on this regression.
		expect(html).not.toContain('In keep-up window');
		expect(html).not.toContain('Keep-up refresh');
		expect(html).not.toContain('keep-it-up window');
		expect(html).not.toContain('refresh window');
	});

	it('quotes no tick count for the pull, because the applications did not share one', () => {
		// The same objection as the band's retired "refresh window 1.3s", one field over. A tile read
		// "Ticks per dot" off `round(30000 / median(tickMs))`, and on this pull the six graded presses ran
		// 1 715–2 255ms — 17.5 ticks down to 13.3. The median printed 17, a figure none of the six
		// applications had. The per-press count is real and the pull-wide one is not, so the section states
		// the cadence per press (the tooltip below) and states no count at all.
		expect(html).not.toContain('Ticks per dot');
		// Non-vacuous: the tile row did render, so the string is absent because the tile is gone.
		expect(html).toContain('In the last tick');
	});
});

/**
 * A stand-in palette. `readTheme` reads computed CSS custom properties off a live document, and none of
 * what is asserted below is a colour — the tone is already covered by the copy tests above.
 */
const THEME = { miss: '#m', kick: '#k', brew: '#b' } as unknown as ChartTheme;

describe('the refresh tooltip names the window that judged the press', () => {
	it("carries each press's own last tick, not the pull's median", () => {
		const bars = buildBars(unbroken.flameShock, THEME);
		// Every bar, so a reader hovering any refresh can see what it was judged against.
		expect(bars.every((bar) => bar.meta.rows.some(([label]) => label === 'last tick'))).toBe(true);

		// The press at 83 852 is the case the whole per-press model exists for: it rolled its own 2 246ms
		// tick while this pull's median window is 1 726ms, so the median is not merely imprecise for that
		// bar — it is the wrong number. Located by its own timestamp rather than by index, and the press is
		// read out of the audit so this cannot pass by comparing the tooltip against itself.
		const drawn = unbroken.flameShock.presses.filter((p) => p.remainingMs !== null);
		const i = drawn.findIndex((p) => p.t === 83_852);
		expect(i).toBeGreaterThanOrEqual(0);
		expect(drawn[i]!.tickMs).toBeCloseTo(2245.667, 2);
		expect(unbroken.flameShock.tickMs).toBeCloseTo(1725.667, 2);

		// `buildBars` filters then maps, so bar `i` is `drawn[i]` — asserted rather than assumed by
		// checking the bar's own label carries that press's timestamp.
		const bar = bars[i]!;
		expect(bar.x).toContain(fmt(83_852));
		expect(bar.meta.rows).toContainEqual(['last tick', '2.2s']);
		// The median would have read differently, which is what makes the distinction visible at all.
		expect(bar.meta.rows).not.toContainEqual(['last tick', '1.7s']);
	});
});

describe('the Earth Shock ledger', () => {
	// The dot's remaining time is a Flame Shock fact. An Earth Shock is judged on the shield's stacks and
	// on the rules in its own `state` column, none of which read the dot — so the column was a number the
	// reader had to decide to ignore on every row.
	const shockHtml = renderToStaticMarkup(
		createElement(
			SpecContext.Provider,
			{ value: ELEMENTAL_SPEC },
			createElement(EarthShock, { analysis: unbroken as Analysis }),
		),
	);

	it('has rows to draw, so the header assertions below are not vacuous', () => {
		expect(unbroken.earthShock.presses.filter((p) => !p.good).length).toBeGreaterThan(0);
	});

	it('no longer offers a "dot left" column', () => {
		expect(shockHtml).toContain(t('earthShock.columns.stacks'));
		expect(shockHtml).not.toContain('dot left');
	});
});
