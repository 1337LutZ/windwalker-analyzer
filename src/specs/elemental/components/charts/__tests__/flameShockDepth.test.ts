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
import { getSpec } from '~/lib/spec';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';
import FlameShock from '../../sections/FlameShock';

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
});
