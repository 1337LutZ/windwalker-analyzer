// The green row: which of the two numerators it is, and the arithmetic that says so.
//
// Both Elemental uptime charts drew their up row from the audit's raw window array while the tile beside
// them divided something narrower. `FlameShockAudit.uptimeMs` is documented as the primary target's whole
// dot, *deliberately* unclipped so an untargetable stretch does not put a seam in the timeline lane — and
// `uptimePct` is `contactUptimeMs / scoredMs`, both halves cut to the graded clock. Two different spans,
// one row, one percentage under it. The totem's version is starker: `searingTotem.uptimeMs` is already the
// clipped figure and the chart was drawing `searingTotem.windows`, so the audit held the right array's
// length and the chart reached past it.
//
// **This is not the add-wave cut.** The gap is 9 309ms on `phased` and 1 071ms on `unbroken`, and neither
// pull ever leaves one enemy, so `aoeWindows` is empty on both: what has always been outside the row is
// the *contact* clock. `8d8b1f0` enlarged the gap on `cleave` and did not create it.
//
// So the up row is clipped to the graded clock and what falls outside it becomes a row of its own rather
// than vanishing — the rule `8e011ac` set for this exact shape, that an unmeasured figure is not a deleted
// one. What is asserted below is that the clip closed the gap it can close, that it left the pull's
// arithmetic whole, and — on `cleave` — exactly how much of the Flame Shock gap a chart cannot close from
// published data at all.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own vitest
// include patterns; the `WindowTracks` mock is the seam, as in `charts/__tests__/exemptTrack.test.ts`.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { intersect, unionMs, type Interval } from '~/lib/analysis/intervals';
import { initI18n } from '~/lib/i18n/config';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';

import { EXEMPT } from '~/components/charts/tones';
import type { Track } from '~/components/charts/WindowTracks';
import { analyse } from '~/specs/elemental/lib';
import FlameShockUptime from '../FlameShockUptime';
import SearingTotemUptime from '../SearingTotemUptime';

const drawn = vi.hoisted(() => ({ calls: [] as Array<{ tracks: readonly Track[] }> }));

vi.mock('~/components/charts/WindowTracks', () => ({
	default: (props: { tracks: readonly Track[] }) => {
		drawn.calls.push(props);
		return null;
	},
}));

initI18n();

type El = Analysis & ElementalAuditResult;

const elemental = (name: string): El =>
	analyse(
		JSON.parse(
			readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8'),
		) as FightDataset,
	) as El;

function rowsOf(element: ReactElement): readonly Track[] {
	drawn.calls.length = 0;
	renderToStaticMarkup(element);
	expect(drawn.calls).toHaveLength(1);
	return drawn.calls[0]?.tracks ?? [];
}

const spans = (windows: ReadonlyArray<readonly [number, number]>): Interval[] => windows.map((w) => [w[0], w[1]]);
const rowOf = (rows: readonly Track[], label: string): Interval[] =>
	spans(rows.find((r) => r.label === label)?.windows ?? []);
const exemptOf = (rows: readonly Track[], uncountedLabel: string): Interval[] =>
	rows.filter((r) => r.tone === EXEMPT && r.label !== uncountedLabel).flatMap((r) => spans(r.windows));

const fixtures = { phased: elemental('phased'), unbroken: elemental('unbroken'), cleave: elemental('cleave') };
const names = ['phased', 'unbroken', 'cleave'] as const;

/** The two charts, described by the four things this file needs to know about each of them. */
const charts = [
	{
		name: 'Flame Shock',
		chart: FlameShockUptime,
		up: 'Dot up',
		down: 'Dot down',
		uncounted: 'Dot up, not measured',
		/** The array the row is cut from, and the length of the clock it is cut to. */
		drawnMs: (a: El) => unionMs(a.flameShock.windows.map((w): Interval => [w.start, w.end])),
		scoredMs: (a: El) => a.flameShock.scoredMs,
	},
	{
		name: 'Searing Totem',
		chart: SearingTotemUptime,
		up: 'Totem up',
		down: 'Totem down',
		uncounted: 'Totem up, not measured',
		drawnMs: (a: El) => unionMs(a.searingTotem.windows.map((w): Interval => [w.start, w.end])),
		scoredMs: (a: El) => a.searingTotem.scoredMs,
	},
] as const;

describe('the up row is the clock the percentage is taken over', () => {
	/**
	 * The identity, and the strongest guard in this file: the three claim rows and the grounds partition
	 * the pull. Nothing overlaps and nothing is missing, on either chart, on all three fixtures.
	 *
	 * Before the clip this was false by exactly the size of the gap — the up row overlapped the grounds, so
	 * the four rows summed to more than the pull (337 947ms of a 263 233ms `cleave` on the dot chart).
	 */
	it.each(names)('draws up, down and the grounds as a partition of %s', (name) => {
		const analysis = fixtures[name];
		for (const c of charts) {
			const rows = rowsOf(createElement(c.chart, { analysis }));
			const up = rowOf(rows, c.up);
			const down = rowOf(rows, c.down);
			const exempt = exemptOf(rows, c.uncounted);
			const label = `${c.name} on ${name}`;

			// The two claim rows are the graded clock, exactly — the figure the audit publishes as its length.
			expect(unionMs(up) + unionMs(down), label).toBe(c.scoredMs(analysis));
			// And the clock plus its complement is the pull.
			expect(unionMs(up) + unionMs(down) + unionMs(exempt), label).toBe(analysis.durationMs);
			// Asserted separately because the sums above would also hold if the rows overlapped by equal and
			// opposite amounts, which is the failure the clip is here to remove.
			expect(unionMs(intersect(up, down)), label).toBe(0);
			expect(unionMs(intersect(up, exempt)), label).toBe(0);
			expect(unionMs(intersect(down, exempt)), label).toBe(0);
		}
	});

	/**
	 * And the row the clip creates rather than deletes: it is the rest of the drawn aura, it lies wholly
	 * inside the grounds, and it is not a fault.
	 */
	it.each(names)('keeps the unmeasured half of the aura as a row of its own on %s', (name) => {
		const analysis = fixtures[name];
		for (const c of charts) {
			const rows = rowsOf(createElement(c.chart, { analysis }));
			const up = rowOf(rows, c.up);
			const uncounted = rowOf(rows, c.uncounted);
			const exempt = exemptOf(rows, c.uncounted);
			const label = `${c.name} on ${name}`;

			// Nothing about the aura is lost: the two rows together are the array the audit published.
			expect(unionMs(up) + unionMs(uncounted), label).toBe(c.drawnMs(analysis));
			// It is time the denominator dropped, so it sits inside the grounds and adds nothing to their union
			// — which is why the `durationMs - scoredMs` identity in `exemptTrack.test.ts` is untouched by it.
			expect(unionMs(intersect(uncounted, exempt)), label).toBe(unionMs(uncounted));
			// Never `miss`: the aura was up, and painting that as a drop is the disagreement this file is about.
			const row = rows.find((r) => r.label === c.uncounted);
			if (uncounted.length > 0) expect(row?.tone, label).toBe(EXEMPT);
		}
	});

	/**
	 * The up row against the tile's own numerator — the question the clip was supposed to answer.
	 *
	 * The totem's is exact on every fixture, because `searingTotem.uptimeMs` is already the clipped figure
	 * and the chart is now cut to the same clock the audit cut it to.
	 */
	it.each(names)('draws the totem tile’s own numerator on %s', (name) => {
		const analysis = fixtures[name];
		const rows = rowsOf(createElement(SearingTotemUptime, { analysis }));
		expect(unionMs(rowOf(rows, 'Totem up'))).toBe(analysis.searingTotem.uptimeMs);
		// The ratio, from the row and the published clock: the row *is* the percentage's numerator.
		expect((unionMs(rowOf(rows, 'Totem up')) / analysis.searingTotem.scoredMs) * 100).toBeCloseTo(
			analysis.searingTotem.uptimePct,
			9,
		);
	});

	/**
	 * The dot's is exact on the two single-target pulls and 10 270ms short on `cleave`, and that residual is
	 * the honest limit of what a chart can do here rather than a rounding slip.
	 *
	 * `contactUptimeMs` is the dot on **whichever spawn was being hit**; `flameShock.windows` is the dot on
	 * the **primary target**. The clip makes the two spans agree about *time*; it cannot make them agree
	 * about *subject*, because the secondary's dot is published only as the scalar `multiDotUptimeMs`. On a
	 * pull that never had a second target the two subjects are one, which is why `phased` and `unbroken`
	 * come out at zero — and that is what identifies the residual as the per-spawn gap and nothing else.
	 *
	 * A contact-clipped window array beside the unclipped one would close it, and the day one arrives this
	 * expectation goes to zero on all three fixtures. Until then the number is stated rather than implied.
	 */
	it.each([
		['phased', 0],
		['unbroken', 0],
		['cleave', 10_270],
	] as const)('is the dot tile’s numerator on %s, up to the per-spawn residual', (name, residualMs) => {
		const analysis = fixtures[name];
		const rows = rowsOf(createElement(FlameShockUptime, { analysis }));
		const up = unionMs(rowOf(rows, 'Dot up'));
		expect(up - analysis.flameShock.contactUptimeMs).toBe(residualMs);
		// The row is never *below* the numerator: whatever the clip left in is a superset of what was counted,
		// so the chart may overstate the dot's subject and can no longer overstate its clock.
		expect(up).toBeGreaterThanOrEqual(analysis.flameShock.contactUptimeMs);
	});

	/**
	 * The three figures the whole argument rests on, pinned so a fixture recapture that moved them says so
	 * here rather than in a percentage nobody rechecked. `cleave` is the only committed pull with band-3+
	 * time, so it is the only one where the clock half of the gap is visible at all.
	 */
	it('pins the sizes of the gap on cleave', () => {
		const { cleave } = fixtures;
		expect(cleave.flameShock.uptimeMs).toBe(235_007); // the whole dot on the primary target, unclipped
		expect(cleave.flameShock.contactUptimeMs).toBe(150_023); // the tile's numerator
		expect(unionMs(rowOf(rowsOf(createElement(FlameShockUptime, { analysis: cleave })), 'Dot up'))).toBe(160_293);
		expect(unionMs(rowOf(rowsOf(createElement(SearingTotemUptime, { analysis: cleave })), 'Totem up'))).toBe(112_728);
	});

	/**
	 * A no-change guard, labelled: `phased`'s totem never ticks outside its own clock, so that chart may not
	 * grow a row there. The dot chart *does* grow one on all three fixtures, which is the point about the
	 * gap predating the add-wave cut, stated from the other side.
	 */
	it('grows no unmeasured row where the aura never left the clock', () => {
		const { phased } = fixtures;
		const totem = rowsOf(createElement(SearingTotemUptime, { analysis: phased })).map((r) => r.label);
		expect(totem).not.toContain('Totem up, not measured'); // no-change guard
		for (const name of names) {
			const dot = rowsOf(createElement(FlameShockUptime, { analysis: fixtures[name] })).map((r) => r.label);
			expect(dot, name).toContain('Dot up, not measured');
		}
	});
});
