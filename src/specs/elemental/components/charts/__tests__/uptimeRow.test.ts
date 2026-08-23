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
// one.
//
// **The clip closed the clock half and left the subject half, and that half is now a row too.** Clipped,
// the dot's row was still the *primary target's* while the tile's numerator is the dot on whichever spawn
// was being hit, so on `cleave` it read 160 293ms against 150 023. Sourcing green from `contactWindows`
// instead was measured and refused: that array sits wholly inside the clipped row, so the swap would have
// deleted 10 270ms of real primary-target dot time inside the graded clock. Green is now that array and
// the difference is a fifth row of its own — the dot up, graded, on an enemy the player had left.
//
// What is asserted below is that the four rows partition the pull with no pair overlapping, that the aura
// survives the split whole, that the up row **is** its tile's numerator to the millisecond on both charts,
// and that the 0 / 0 / 10 270 the residual used to be is now the size of the row that carries it.
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
		/**
		 * The fifth row, and `null` on the chart that cannot have one.
		 *
		 * The totem is a ground effect with no target at all, so "up on something you had left" is not a
		 * state it has: `searingTotem.uptimeMs` is already the clipped figure over one subject. Only the dot
		 * is measured per spawn, so only the dot splits its counted half in two.
		 */
		elsewhere: 'Dot up on an enemy you left' as string | null,
		uncounted: 'Dot up, not measured',
		/** The array the row is cut from, and the length of the clock it is cut to. */
		drawnMs: (a: El) => unionMs(a.flameShock.windows.map((w): Interval => [w.start, w.end])),
		scoredMs: (a: El) => a.flameShock.scoredMs,
		/** The tile's own numerator — the figure the up row must now equal to the millisecond. */
		numeratorMs: (a: El) => a.flameShock.contactUptimeMs,
		pct: (a: El) => a.flameShock.uptimePct,
	},
	{
		name: 'Searing Totem',
		chart: SearingTotemUptime,
		up: 'Totem up',
		down: 'Totem down',
		elsewhere: null as string | null,
		uncounted: 'Totem up, not measured',
		drawnMs: (a: El) => unionMs(a.searingTotem.windows.map((w): Interval => [w.start, w.end])),
		scoredMs: (a: El) => a.searingTotem.scoredMs,
		numeratorMs: (a: El) => a.searingTotem.uptimeMs,
		pct: (a: El) => a.searingTotem.uptimePct,
	},
] as const;

describe('the up row is the clock the percentage is taken over', () => {
	/**
	 * The identity, and the strongest guard in this file: the **four** rows — up and counted, up on an enemy
	 * the player had left, down, and the grounds — partition the pull. Nothing overlaps and nothing is
	 * missing, on either chart, on all three fixtures.
	 *
	 * Before the clip this was false by exactly the size of the gap — the up row overlapped the grounds, so
	 * the rows summed to more than the pull (337 947ms of a 263 233ms `cleave` on the dot chart). It was
	 * true again after the clip and *at three rows*, which is why the fourth had to be added here rather
	 * than beside it: sourcing green from `contactWindows` without giving the difference a row of its own
	 * leaves this sum 10 270ms short of the graded clock on `cleave` — 168 544 against 178 814 — and short
	 * of the pull by the same amount. Measured, not asserted from the shape: that substitution fails five
	 * of the fifteen cases in this file, and this one first.
	 *
	 * Every pair is checked, all six of them, because the sums alone survive an equal-and-opposite overlap.
	 */
	it.each(names)('draws up, elsewhere, down and the grounds as a partition of %s', (name) => {
		const analysis = fixtures[name];
		for (const c of charts) {
			const rows = rowsOf(createElement(c.chart, { analysis }));
			const up = rowOf(rows, c.up);
			const elsewhere = c.elsewhere === null ? [] : rowOf(rows, c.elsewhere);
			const down = rowOf(rows, c.down);
			const exempt = exemptOf(rows, c.uncounted);
			const label = `${c.name} on ${name}`;

			// The three claim rows are the graded clock, exactly — the figure the audit publishes as its length.
			expect(unionMs(up) + unionMs(elsewhere) + unionMs(down), label).toBe(c.scoredMs(analysis));
			// And the clock plus its complement is the pull.
			expect(unionMs(up) + unionMs(elsewhere) + unionMs(down) + unionMs(exempt), label).toBe(analysis.durationMs);
			// Asserted pair by pair because the sums above would also hold if two rows overlapped by equal and
			// opposite amounts — which is not hypothetical on this chart.
			expect(unionMs(intersect(up, elsewhere)), label).toBe(0);
			expect(unionMs(intersect(up, down)), label).toBe(0);
			expect(unionMs(intersect(up, exempt)), label).toBe(0);
			expect(unionMs(intersect(elsewhere, down)), label).toBe(0);
			expect(unionMs(intersect(elsewhere, exempt)), label).toBe(0);
			expect(unionMs(intersect(down, exempt)), label).toBe(0);
		}
	});

	/**
	 * The question the whole file exists for, and the answer the Searing Totem chart already gave: **the up
	 * row is the tile's percentage's own numerator, to the millisecond, on both charts and all three
	 * fixtures.**
	 *
	 * The dot's used to be 10 270ms over on `cleave`, and the fix was not to clip it — `contactWindows` sits
	 * wholly inside the old row, so clipping would have deleted real primary-target dot time inside the
	 * graded clock. Green is now the published numerator array itself and the difference is the `elsewhere`
	 * row, so the two claims are one claim.
	 *
	 * The ratio is asserted as well as the length, because a numerator that matches over a denominator the
	 * chart cut differently is the mismatched-halves defect this section has produced twice.
	 */
	it.each(names)('draws the tile’s own numerator as its up row on %s', (name) => {
		const analysis = fixtures[name];
		for (const c of charts) {
			const rows = rowsOf(createElement(c.chart, { analysis }));
			const up = unionMs(rowOf(rows, c.up));
			const label = `${c.name} on ${name}`;

			expect(up, label).toBe(c.numeratorMs(analysis));
			expect((up / c.scoredMs(analysis)) * 100, label).toBeCloseTo(c.pct(analysis), 9);
		}
	});

	/**
	 * And the rows the split creates rather than deletes: between them they are the whole drawn aura, the
	 * unmeasured one lies wholly inside the grounds, and neither is a fault.
	 *
	 * Three rows on the dot chart now, not two — up and counted, up on an enemy the player had left, and up
	 * outside the clock — and this is the assertion that catches a re-partition that lost a millisecond
	 * somewhere in the middle. On the totem chart the middle row does not exist and the sum is the same.
	 */
	it.each(names)('keeps the unmeasured half of the aura as a row of its own on %s', (name) => {
		const analysis = fixtures[name];
		for (const c of charts) {
			const rows = rowsOf(createElement(c.chart, { analysis }));
			const up = rowOf(rows, c.up);
			const elsewhere = c.elsewhere === null ? [] : rowOf(rows, c.elsewhere);
			const uncounted = rowOf(rows, c.uncounted);
			const exempt = exemptOf(rows, c.uncounted);
			const label = `${c.name} on ${name}`;

			// Nothing about the aura is lost: the rows together are the array the audit published.
			expect(unionMs(up) + unionMs(elsewhere) + unionMs(uncounted), label).toBe(c.drawnMs(analysis));
			// It is time the denominator dropped, so it sits inside the grounds and adds nothing to their union
			// — which is why the `durationMs - scoredMs` identity in `exemptTrack.test.ts` is untouched by it.
			expect(unionMs(intersect(uncounted, exempt)), label).toBe(unionMs(uncounted));
			// Never `miss`: the aura was up, and painting that as a drop is the disagreement this file is about.
			const row = rows.find((r) => r.label === c.uncounted);
			if (uncounted.length > 0) expect(row?.tone, label).toBe(EXEMPT);
		}
	});

	/**
	 * **The 0 / 0 / 10 270 pin, kept and turned the right way round.** It used to measure how far the green
	 * row overshot the tile's numerator; it now measures the row that difference became. The three numbers
	 * are the same three numbers, which is the point of not letting them go to zero: they are the guard that
	 * made this findable, and a guard reading `0` on every fixture guards nothing.
	 *
	 * What the row *is*, verified from the audit's own walk rather than inferred from the subtraction: on
	 * `cleave` all 10 270ms of it lie inside `contactSegments` and inside the graded clock, and every
	 * millisecond is owned by a landed hit on a **non-primary** spawn — never the boss, and never the
	 * stretch before the first hit. So the dot was up on the primary target while the player was hitting
	 * something that did not have it, which is what the row is named.
	 *
	 * Both zeroes are load-bearing rather than inert. `phased` and `unbroken` have one spawn each, so "the
	 * enemy being hit" and "the primary target" are the same enemy and this row *cannot* exist — while their
	 * 9 309 / 1 071 ms of unmeasured dot sit in the row above. That is what separates the two causes: one is
	 * the clock, this one is the subject. A non-zero here on either pull would mean the split had stopped
	 * being about contact.
	 */
	it.each([
		['phased', 0],
		['unbroken', 0],
		['cleave', 10_270],
	] as const)('draws the per-spawn residual as its own row on %s', (name, residualMs) => {
		const analysis = fixtures[name];
		const rows = rowsOf(createElement(FlameShockUptime, { analysis }));
		const up = rowOf(rows, 'Dot up');
		const elsewhere = rowOf(rows, 'Dot up on an enemy you left');

		// The row that closed the gap, at the size the gap was.
		expect(unionMs(elsewhere), name).toBe(residualMs);
		// And the gap itself, now zero on every fixture — the green row *is* the numerator.
		expect(unionMs(up) - analysis.flameShock.contactUptimeMs, name).toBe(0);

		// Green is the published array and not a re-derivation that happens to sum to it, so the identity the
		// field's own contract states holds of the row a reader looks at.
		const contact = spans(analysis.flameShock.contactWindows.map((w): Interval => [w.start, w.end]));
		expect(unionMs(contact), name).toBe(analysis.flameShock.contactUptimeMs);
		expect(unionMs(intersect(contact, up)), name).toBe(unionMs(contact));

		// The label, as far as published data can carry it: every millisecond of the row is the dot up on the
		// primary target, inside contact, and outside the numerator. What is left over is contact with an
		// enemy that had no dot on it — which is the sentence the row's name makes.
		const drawn = spans(analysis.flameShock.windows.map((w): Interval => [w.start, w.end]));
		const contactClock = spans(analysis.timeline?.contactSegments ?? []);
		expect(contactClock.length, name).toBeGreaterThan(0);
		expect(unionMs(intersect(elsewhere, drawn)), name).toBe(residualMs);
		expect(unionMs(intersect(elsewhere, contactClock)), name).toBe(residualMs);
		expect(unionMs(intersect(elsewhere, contact)), name).toBe(0);
		// One direction only, because that is the only one that holds: a row this size needs another enemy to
		// have been worth hitting, so a non-empty row with no secondary would mean the split had found
		// something else. The converse is not asserted — a pull may have a secondary and still never leave the
		// boss, which is a pull with a subject and an empty row.
		if (residualMs > 0) expect(analysis.flameShock.secondaryID, name).not.toBeNull();
		else expect(analysis.flameShock.secondaryID, name).toBeNull(); // no-change guard: single-target pulls
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
		const dot = rowsOf(createElement(FlameShockUptime, { analysis: cleave }));
		// The old single green row, now the two rows it split into — stated as the sum so the 160 293 the
		// chart used to draw stays visible as the thing that was re-partitioned rather than reduced.
		expect(unionMs(rowOf(dot, 'Dot up'))).toBe(150_023);
		expect(unionMs(rowOf(dot, 'Dot up on an enemy you left'))).toBe(10_270);
		expect(unionMs(rowOf(dot, 'Dot up')) + unionMs(rowOf(dot, 'Dot up on an enemy you left'))).toBe(160_293);
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

	/**
	 * And the mirror of it for the fifth row: it is drawn only where the pull had another enemy to be on,
	 * so it appears on `cleave` alone and never on a chart that cannot have it.
	 *
	 * Gated rather than drawn empty for the reason `exemptTrack.test.ts` gives about the AoE row: an empty
	 * row reads as a rendering fault, and it is also what keeps that file's pinned row list for `phased`
	 * unchanged. Its tone is checked here too — `missSoft` and not `miss`, because the dot was up, and not
	 * `EXEMPT`, because these seconds are inside the denominator and do cost the percentage.
	 */
	it('draws the per-spawn row only where another enemy was being hit', () => {
		for (const name of names) {
			const rows = rowsOf(createElement(FlameShockUptime, { analysis: fixtures[name] }));
			const row = rows.find((r) => r.label === 'Dot up on an enemy you left');
			if (name === 'cleave') {
				expect(row?.tone, name).toBe('missSoft');
				expect(row?.widen, name).toBe(false);
			} else {
				expect(row, name).toBeUndefined(); // no-change guard: one spawn, so no other enemy to be on
			}
		}
		// Never the exempt tone on any pull: the grounds are time the denominator dropped and this is not.
		for (const name of names) {
			const rows = rowsOf(createElement(FlameShockUptime, { analysis: fixtures[name] }));
			expect(
				rows.filter((r) => r.tone === EXEMPT).map((r) => r.label),
				name,
			).not.toContain('Dot up on an enemy you left');
		}
	});
});
