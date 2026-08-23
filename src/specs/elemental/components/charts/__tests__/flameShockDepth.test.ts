// What the Flame Shock depth chart is allowed to claim, and the geometry it has to claim it with.
//
// The window a refresh is graded against is measured per press off the log's own ticks, and it moves
// inside a single pull: `phased` grades its refreshes against 1 349ms, 1 748ms and 2 275ms as Bloodlust
// and Elemental Mastery fall off, and `unbroken`'s press at 83 852 is judged against its own 2 246ms
// tick while the pull's median window is 1 726ms. So no piece of copy may name a number for it,
// and none may call it a window the reader set: the band read "refresh window 1.3s" and the tiles read
// "keep-up window", both of which assert one window for a pull that had three.
//
// **The band itself then went the same way, and the last suite here is what replaced it.** It shaded
// `durationMs − median(tickMs)` to `durationMs`, anchored to a declared 30s duration no application
// ever runs for, so it sat later than every real last tick — reported live against two credited
// presses whose bars ended 69ms and 343ms short of a band they belonged inside. The report was
// crediting a press its own chart drew outside the window. The last tick is now the tail of each bar,
// and `a credited press's bar reaches into its own tail` is asserted as an invariant over every press
// of all three fixtures, against tick timestamps read out of the raw event stream.
//
// The copy assertions are against literal strings rather than against another `t()` call on purpose —
// a test whose two sides both come out of the locale file passes whatever the locale file says.

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

/** `a:xB3kh7v9pF2AHRtq` #16 — one apply, six refreshes, one of them inside its own last tick. */
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
	/**
	 * The band's copy key is gone, not merely unused.
	 *
	 * `report.json` has no orphan guard — the reverse locale-key check is scoped to the `ui` namespace —
	 * so a key nothing renders survives indefinitely and the next reader takes it for a live string.
	 *
	 * Read off the loaded bundle rather than by asking `t` for the retired key: the *forward* key check
	 * scans every source file for literal `t(...)` keys, this file included, so writing that call here
	 * fails that check instead — which is the guard working, and is why the key is named as a string
	 * below rather than passed to a lookup.
	 */
	it('has no band copy left to draw a band with', () => {
		const chart = (i18n.getResourceBundle('en', 'report') as { flameShock: { chart: Record<string, unknown> } })
			.flameShock.chart;
		expect(Object.keys(chart)).not.toContain('band');
		// The tail that replaced it does have copy, so the assertion above is about a removal rather than
		// about a locale file that failed to load.
		expect(t('flameShock.chart.key.lastTick')).toBe('The dot’s own last tick');
	});

	it('names the last tick in the tile, the state and the chart key', () => {
		expect(t('flameShock.kpi.windowed')).toBe('In the last tick');
		expect(t('flameShock.state.windowed')).toBe('Last-tick refresh');
		expect(t('flameShock.chart.key.windowed')).toBe('In the last tick');
	});

	it('renders that wording in the section rather than only holding it in the locale', () => {
		// The tile label, the chart key, and the row state of a press that rolled its last tick. One press
		// on this pull, not two: 83 852 counted two ticks still owed where its declared remaining time read
		// one, and moved to `snapshot`. One is still a rendered state cell, which is what this asserts.
		expect(unbroken.flameShock.windowed).toBe(1);
		expect(unbroken.flameShock.presses.filter((p) => p.kind === 'windowed').map((p) => p.t)).toEqual([112_878]);
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
const THEME = { miss: '#m', kick: '#k', brew: '#b', rune: '#r' } as unknown as ChartTheme;

describe('the refresh tooltip names the window that judged the press', () => {
	it("carries each press's own last tick, not the pull's median", () => {
		const bars = buildBars(unbroken.flameShock, THEME).held;
		// Every bar, so a reader hovering any refresh can see what it was judged against.
		expect(bars.every((bar) => bar.meta.rows.some(([label]) => label === 'last tick'))).toBe(true);
		// And the count that tone was actually decided on, beside it.
		expect(bars.every((bar) => bar.meta.rows.some(([label]) => label === 'ticks left'))).toBe(true);

		// The press at 83 852 is the case the whole per-press model exists for: its own tick is 2 246ms
		// while this pull's median window is 1 726ms, so the median is not merely imprecise for that bar —
		// it is the wrong number. Located by its own timestamp rather than by index, and the press is read
		// out of the audit so this cannot pass by comparing the tooltip against itself.
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

/**
 * The invariant the retired band violated: a credited press's bar must reach into its own last tick.
 *
 * Anchored on the fixtures' **raw tick timestamps** rather than on the arithmetic the audit just did.
 * For a press with exactly one tick still owed the last tick window opened when that application's last
 * delivered tick landed, so the tail the chart draws must be `press − that tick`, to the millisecond,
 * and the tick is read straight off the event stream. Nothing in that comparison comes from
 * `intoLastTickMs`.
 */
describe('the geometry agrees with the verdict', () => {
	const fixtures = ['unbroken', 'cleave', 'phased'] as const;
	const analysed = (name: string): El =>
		analyse(
			JSON.parse(
				readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8'),
			) as FightDataset,
		) as El;
	const el = { unbroken, cleave: analysed('cleave'), phased: analysed('phased') };
	/** Every Flame Shock tick this player landed, fight-relative, whatever spawn took it. */
	const tickTimes = (name: string): number[] => {
		const d = JSON.parse(
			readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8'),
		) as FightDataset;
		return d.events
			.filter((e) => e.type === 'damage' && e.abilityGameID === 8050 && e.tick === true && e.sourceID === d.actor.id)
			.map((e) => e.timestamp - d.fight.startTime)
			.sort((a, b) => a - b);
	};

	it('gives every credited press a tail and every early press none', () => {
		let credited = 0;
		let early = 0;
		for (const name of fixtures) {
			const audit = el[name].flameShock;
			const series = buildBars(audit, THEME);
			const drawn = audit.presses.filter((p) => p.remainingMs !== null);
			expect(series.held).toHaveLength(drawn.length);
			expect(series.lastTick).toHaveLength(drawn.length);
			drawn.forEach((press, i) => {
				const tail = series.lastTick[i]!.y;
				const total = series.held[i]!.y + tail;
				// The bar's total length is unchanged by the split: still the elapsed time since the
				// application, which is what the axis says it is.
				expect(total).toBeCloseTo((audit.durationMs - (press.remainingMs ?? 0)) / 1000, 6);
				if (press.ticksLeft !== null && press.ticksLeft <= 1) {
					credited += 1;
					expect(tail).toBeGreaterThan(0);
				} else {
					early += 1;
					expect(tail).toBe(0);
				}
			});
		}
		// Non-vacuous on both arms: five credited presses across the three pulls and seven early ones.
		expect([credited, early]).toEqual([5, 7]);
	});

	/**
	 * The split is a **partition** of the bar, not merely two numbers that add up to it.
	 *
	 * `held + tail === elapsed` is asserted above and it is not enough on its own: an overlong tail and a
	 * negative segment beneath it are equal and opposite, so the sum survives the one drawing fault the
	 * split can have. A stacked bar with a negative segment draws backwards past zero.
	 *
	 * The floor is what could do it — `rawTailMs` is clamped to the bar, `durationMs / 400` is not — and no
	 * committed fixture reaches it, because their presses are 27-31s apart and the floor is 75ms on a 30s
	 * dot. So the fixtures carry the invariant and one synthetic press carries the case, built by
	 * overriding two fields of a real one so nothing else about it is invented.
	 */
	it('splits each bar into two lengths that are both real, and not merely into two that sum', () => {
		for (const name of fixtures) {
			const audit = el[name].flameShock;
			const series = buildBars(audit, THEME);
			series.held.forEach((bar, i) => {
				expect(bar.y, `${name} held ${i}`).toBeGreaterThanOrEqual(0);
				expect(series.lastTick[i]!.y, `${name} tail ${i}`).toBeGreaterThanOrEqual(0);
			});
		}

		// 50ms into the dot with 20ms of last tick behind it: under the 75ms floor, so the floor is the only
		// thing that can decide the tail's length here.
		const real = unbroken.flameShock.presses.find((p) => p.ticksLeft === 1)!;
		const audit = {
			...unbroken.flameShock,
			presses: [{ ...real, remainingMs: unbroken.flameShock.durationMs - 50, intoLastTickMs: 20 }],
		};
		expect(audit.durationMs).toBe(30_000);
		const short = buildBars(audit, THEME);
		expect(short.held[0]!.y + short.lastTick[0]!.y).toBeCloseTo(0.05, 6);
		// Both halves of the partition. The floor wanted 75ms of tail out of a 50ms bar; it gets the bar.
		expect(short.held[0]!.y).toBe(0);
		expect(short.lastTick[0]!.y).toBeCloseTo(0.05, 6);
	});

	it("measures the tail off the log's own last tick, to the millisecond", () => {
		const seen: Array<[string, number, number]> = [];
		for (const name of fixtures) {
			const ticks = tickTimes(name);
			const audit = el[name].flameShock;
			const series = buildBars(audit, THEME);
			audit.presses
				.filter((p) => p.remainingMs !== null)
				.forEach((press, i) => {
					// Only the one-tick-owed case has a tail this identity applies to: at nothing owed the window
					// opened a period *before* the final tick, and at two or more it had not opened at all.
					if (press.ticksLeft !== 1) return;
					const lastTick = ticks.filter((x) => x < press.t).at(-1);
					expect(lastTick).toBeDefined();
					const tailMs = series.lastTick[i]!.y * 1000;
					expect(tailMs).toBeCloseTo(press.t - (lastTick ?? 0), 6);
					seen.push([name, press.t, Math.round(tailMs)]);
				});
		}
		// The four presses that identity covers, with the tail each one got. Literals so that a change in
		// the derivation shows up as a number that moved rather than as a loop that iterated nothing:
		// `cleave`'s 581ms is the press the whole count exists for — faulted by 59ms under the old duration
		// test, and 581ms into its own last tick.
		expect(seen).toEqual([
			['unbroken', 112_878, 1294],
			['cleave', 29_777, 581],
			['phased', 222_607, 2207],
			['phased', 251_605, 1557],
		]);
	});

	/**
	 * What the band would have drawn, so the defect is on the record as a number rather than as a story.
	 *
	 * `cleave`'s credited press ends at 28.216s; the retired band began at `30 000 − 1 724.7` = 28.275s.
	 * The bar stopped 59ms short of a band it belonged inside, on the very press the tick count exists to
	 * credit — and 59ms is also exactly what the old duration test faulted it by. The same shape as the
	 * two live readings that raised this, 69ms and 343ms.
	 */
	it('would have drawn the credited cleave press outside the retired band', () => {
		const audit = el.cleave.flameShock;
		const press = audit.presses.find((p) => p.t === 29_777)!;
		expect(press.ticksLeft).toBe(1);
		const elapsedSec = (audit.durationMs - (press.remainingMs ?? 0)) / 1000;
		const retiredBandStartSec = (audit.durationMs - audit.tickMs) / 1000;
		expect(elapsedSec).toBeLessThan(retiredBandStartSec);
		expect(retiredBandStartSec - elapsedSec).toBeCloseTo(0.059, 3);
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
