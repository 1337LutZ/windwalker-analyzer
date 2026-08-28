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
// instead was measured and refused *on the three pulls then committed*: on each of them that array sits
// wholly inside the clipped row, so the swap would have deleted 10 270ms of real primary-target dot time
// inside the graded clock. Green is now that array and the difference is a fifth row of its own — the dot
// up, graded, on an enemy the player had left.
//
// **And then the containment turned round, which is the defect this file most recently carried.** Green
// became `contactWindows` and the *red* row stayed the complement of `flameShock.windows` — the primary
// target's dot. On `addsThenBoss` the primary is on a tower for seven minutes and cannot be dotted, so
// `windows` is one late 118 198ms span while the numerator is 71 spans totalling 240 421ms, and **146 615ms
// of green was painted red underneath itself**: the up and down rows overlapped by that much, the three
// claim rows summed to 472 922ms of a 326 307ms clock, and the chart drew under half the uptime its own
// tile reported. Red is now the complement of *both* series, and `up + elsewhere + dropped` is the graded
// clock again on all four pulls.
//
// **That is why the grid below is discovered and not listed.** The three assertions this file makes were
// each written "on every pull" and each spelled `['phased', 'unbroken', 'cleave']`, and `addsThenBoss.json`
// landed without any of them being re-asked — the same mechanism, and the same fixture, that
// `uptimeSpan.test.ts` documents at its own `FIXTURES`. The pull that broke the partition is the one pull
// the grid never ran.
//
// What is asserted below is that the four rows partition the pull with no pair overlapping, that the aura
// survives the split whole — restated as the union of *both* dot series, because on a multi-spawn pull it
// is no longer `uptimeMs` — that the up row **is** its tile's numerator to the millisecond on both charts,
// and that the 0 / 0 / 10 270 / 9 150 the residual used to be is now the size of the row that carries it.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own vitest
// include patterns; the `WindowTracks` mock is the seam, as in `charts/__tests__/exemptTrack.test.ts`.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { rawFixtures } from '~/lib/analysis/fixtures';
import { intersect, unionMs, type Interval } from '~/lib/analysis/intervals';
import { initI18n } from '~/lib/i18n/config';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';

import type { LaneSource } from '~/components/charts/TrackLane';
import { EXEMPT, EXEMPT_KIND } from '~/components/charts/tones';
import type { Track } from '~/components/charts/WindowTracks';
import { analyse } from '~/specs/elemental/lib';
import FlameShockUptime from '../FlameShockUptime';
import SearingTotemUptime from '../SearingTotemUptime';

/**
 * Both shapes, one list — the two charts here no longer draw with the same component.
 *
 * `FlameShockUptime` merged its rows into one lane and `SearingTotemUptime` has not, because a lane
 * needs one grey step per exempt cause and that chart has four causes to three steps. What every
 * assertion below reads is `label`, `tone` and `windows`, which `Track` and `LaneSource` both carry
 * under those names, so the harness takes whichever component was rendered and the tests stay one set.
 */
type Drawn = Pick<Track, 'label' | 'tone' | 'windows'> | Pick<LaneSource, 'label' | 'tone' | 'windows'>;

const drawn = vi.hoisted(() => ({ calls: [] as Array<readonly unknown[]> }));

vi.mock('~/components/charts/WindowTracks', () => ({
	default: (props: { tracks: readonly unknown[] }) => {
		drawn.calls.push(props.tracks);
		return null;
	},
}));

vi.mock('~/components/charts/TrackLane', () => ({
	default: (props: { sources: readonly unknown[] }) => {
		drawn.calls.push(props.sources);
		return null;
	},
}));

/** Exempt, whichever table the tone came from — one `EXEMPT` on a row chart, a kind on a lane. */
const isExempt = (tone: string): boolean => tone === EXEMPT || tone in EXEMPT_KIND;

initI18n();

type El = Analysis & ElementalAuditResult;

const elemental = (name: string): El =>
	analyse(
		JSON.parse(
			readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8'),
		) as FightDataset,
	) as El;

function rowsOf(element: ReactElement): readonly Drawn[] {
	drawn.calls.length = 0;
	renderToStaticMarkup(element);
	expect(drawn.calls).toHaveLength(1);
	return (drawn.calls[0] ?? []) as readonly Drawn[];
}

const spans = (windows: ReadonlyArray<readonly [number, number]>): Interval[] => windows.map((w) => [w[0], w[1]]);
const rowOf = (rows: readonly Drawn[], label: string): Interval[] =>
	spans(rows.find((r) => r.label === label)?.windows ?? []);
const exemptOf = (rows: readonly Drawn[], uncountedLabel: string): Interval[] =>
	rows.filter((r) => isExempt(r.tone) && r.label !== uncountedLabel).flatMap((r) => spans(r.windows));

/**
 * Every raw Elemental pull, found rather than listed — and the analysis memoised, the way
 * `specs/elemental/lib/__tests__/uptimeSpan.test.ts` does it for the same two reasons.
 *
 * The literal this replaced (`['phased', 'unbroken', 'cleave']`) stopped being the committed set when
 * `addsThenBoss.json` landed, and every claim in this file is of the form "on every pull". Two of the three
 * loops were true of the fourth pull anyway; the partition was not, and a list is a claim nobody re-asks
 * when the directory grows. The cache is not tidiness either: `addsThenBoss.json` is 4.4 MB and the loops
 * below render both charts several times over.
 */
const names = rawFixtures('elemental').map(({ name }) => name.replace(/\.json$/, ''));

const analysed = new Map<string, El>();
const fx = (name: string): El => {
	const hit = analysed.get(name);
	if (hit !== undefined) return hit;
	const el = elemental(name);
	analysed.set(name, el);
	return el;
};

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
		/**
		 * **Every second either published series says the aura was up**, and the length of the clock the rows
		 * are cut to.
		 *
		 * The union of two arrays and not one, because the dot has two: `flameShock.windows` is the primary
		 * target's and `contactWindows` is the numerator's, and neither contains the other across the committed
		 * set — `cleave`'s numerator sits inside the primary's dot, `addsThenBoss`' overruns it by 146 615ms.
		 * `uptimeMs` was the right-hand side of the aura identity while green was cut from `windows`; the moment
		 * green became the numerator it stopped being, and the three up-ish rows sum to this instead.
		 */
		auraMs: (a: El) =>
			unionMs([
				...a.flameShock.windows.map((w): Interval => [w.start, w.end]),
				...a.flameShock.contactWindows.map((w): Interval => [w.start, w.end]),
			]),
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
		// One series, so the union of "every series" is that array — and the identity is the one it always was.
		auraMs: (a: El) => unionMs(a.searingTotem.windows.map((w): Interval => [w.start, w.end])),
		scoredMs: (a: El) => a.searingTotem.scoredMs,
		numeratorMs: (a: El) => a.searingTotem.uptimeMs,
		pct: (a: El) => a.searingTotem.uptimePct,
	},
] as const;

describe('the up row is the clock the percentage is taken over', () => {
	/**
	 * The identity, and the strongest guard in this file: the **four** rows — up and counted, up on an enemy
	 * the player had left, down, and the grounds — partition the pull. Nothing overlaps and nothing is
	 * missing, on either chart, on every committed pull.
	 *
	 * Before the clip this was false by exactly the size of the gap — the up row overlapped the grounds, so
	 * the rows summed to more than the pull (337 947ms of a 263 233ms `cleave` on the dot chart). It was
	 * true again after the clip and *at three rows*, which is why the fourth had to be added here rather
	 * than beside it: sourcing green from `contactWindows` without giving the difference a row of its own
	 * leaves this sum 10 270ms short of the graded clock on `cleave` — 168 544 against 178 814 — and short
	 * of the pull by the same amount. Measured, not asserted from the shape: that substitution fails five
	 * of the fifteen cases in this file, and this one first.
	 *
	 * **And it was false again the moment green stopped being cut from `flameShock.windows`, on the one pull
	 * this grid did not run.** Green became the numerator and red stayed the primary dot's complement, so on
	 * `addsThenBoss` the two rows overlapped by 146 615ms and the three claim rows summed to 472 922ms of a
	 * 326 307ms clock — 145% of its own denominator, and 706 876ms of a 560 261ms pull. `cleave` cannot see
	 * it: its numerator sits inside its primary dot, so red is the same array either way and all fifteen of
	 * the old cases stayed green. That is why this grid is `rawFixtures` and not a literal.
	 *
	 * Every pair is checked, all six of them, because the sums alone survive an equal-and-opposite overlap —
	 * and `up`/`down` is the pair that caught this one.
	 */
	it.each(names)('draws up, elsewhere, down and the grounds as a partition of %s', (name) => {
		const analysis = fx(name);
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
	 * row is the tile's percentage's own numerator, to the millisecond, on both charts and every committed
	 * pull.**
	 *
	 * The dot's used to be 10 270ms over on `cleave`, and the fix was not to clip it — on that pull
	 * `contactWindows` sits wholly inside the old row, so clipping would have deleted real primary-target dot
	 * time inside the graded clock. Green is now the published numerator array itself and the difference is
	 * the `elsewhere` row, so the two claims are one claim. This assertion held on `addsThenBoss` throughout
	 * the overlap defect and is exactly why the defect was invisible from here: green was already right, and
	 * it was red that had been left behind on the other series.
	 *
	 * The ratio is asserted as well as the length, because a numerator that matches over a denominator the
	 * chart cut differently is the mismatched-halves defect this section has produced twice.
	 */
	it.each(names)('draws the tile’s own numerator as its up row on %s', (name) => {
		const analysis = fx(name);
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
	 *
	 * **The right-hand side is the union of both dot series and not `uptimeMs`.** It used to be the latter,
	 * and it was right while green was cut from `windows`; once green became the numerator the three rows
	 * cover `windows ∪ contactWindows`, which is `uptimeMs` only where the numerator is inside the primary's
	 * dot. On `addsThenBoss` it is 118 198 + 146 615 = 264 813ms, and pinning `uptimeMs` there would fail a
	 * correct chart — the second remainder of the re-partition, restated as an identity rather than dropped.
	 */
	it.each(names)('keeps the unmeasured half of the aura as a row of its own on %s', (name) => {
		const analysis = fx(name);
		for (const c of charts) {
			const rows = rowsOf(createElement(c.chart, { analysis }));
			const up = rowOf(rows, c.up);
			const elsewhere = c.elsewhere === null ? [] : rowOf(rows, c.elsewhere);
			const uncounted = rowOf(rows, c.uncounted);
			const exempt = exemptOf(rows, c.uncounted);
			const label = `${c.name} on ${name}`;

			// Nothing about the aura is lost: the rows together are every second either published series says it
			// was up. Equality, not containment — a bound here would have passed a row that drew half of it.
			expect(unionMs(up) + unionMs(elsewhere) + unionMs(uncounted), label).toBe(c.auraMs(analysis));
			// It is time the denominator dropped, so it sits inside the grounds and adds nothing to their union
			// — which is why the `durationMs - scoredMs` identity in `exemptTrack.test.ts` is untouched by it.
			expect(unionMs(intersect(uncounted, exempt)), label).toBe(unionMs(uncounted));
			// Never `miss`: the aura was up, and painting that as a drop is the disagreement this file is about.
			const row = rows.find((r) => r.label === c.uncounted);
			// `EXEMPT` on the chart that kept its rows, the `unmeasured` step on the one that merged: both
			// mean "this was up and the clock did not count it", drawn by whichever table its chart reads.
			if (uncounted.length > 0) expect(isExempt(row?.tone ?? ''), label).toBe(true);
		}
	});

	/**
	 * **The 0 / 0 / 10 270 pin, kept and turned the right way round — and grown to 9 150 on the fourth pull.**
	 * It used to measure how far the green row overshot the tile's numerator; it now measures the row that
	 * difference became. The numbers are the same numbers, which is the point of not letting them go to zero:
	 * they are the guard that made this findable, and a guard reading `0` on every fixture guards nothing.
	 *
	 * What the row *is*, verified from the audit's own walk rather than inferred from the subtraction: on
	 * `cleave` all 10 270ms of it lie inside `contactSegments` and inside the graded clock, and every
	 * millisecond is owned by a landed hit on a **non-primary** spawn — never the boss, and never the
	 * stretch before the first hit. So the dot was up on the primary target while the player was hitting
	 * something that did not have it, which is what the row is named.
	 *
	 * `addsThenBoss` is the same state on a pull whose primary spends seven minutes untargetable: 20 spans,
	 * 9 150ms, the primary's late dot overlapping contact with a spawn that had none. **It is the small half
	 * of that pull's disagreement and always was** — the large half runs the other way, 146 615ms of numerator
	 * on spawns the primary-keyed array never sees, and it is pinned below rather than here because it is not
	 * this row. Sizing the re-partition off this figure alone would have missed it by a factor of sixteen.
	 *
	 * Both zeroes are load-bearing rather than inert. `phased` and `unbroken` have one spawn each, so "the
	 * enemy being hit" and "the primary target" are the same enemy and this row *cannot* exist — while their
	 * 9 309 / 1 071 ms of unmeasured dot sit in the row above. That is what separates the two causes: one is
	 * the clock, this one is the subject. A non-zero here on either pull would mean the split had stopped
	 * being about contact.
	 */
	it.each([
		['addsThenBoss', 9_150],
		['cleave', 3_560],
		['phased', 0],
		['unbroken', 0],
	] as const)('draws the per-spawn residual as its own row on %s', (name, residualMs) => {
		const analysis = fx(name);
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
		const cleave = fx('cleave');
		expect(cleave.flameShock.uptimeMs).toBe(235_007); // the whole dot on the primary target, unclipped
		expect(cleave.flameShock.contactUptimeMs).toBe(114_755); // the tile's numerator
		const dot = rowsOf(createElement(FlameShockUptime, { analysis: cleave }));
		// The old single green row, now the two rows it split into — stated as the sum so the 160 293 the
		// chart used to draw stays visible as the thing that was re-partitioned rather than reduced.
		expect(unionMs(rowOf(dot, 'Dot up'))).toBe(114_755);
		expect(unionMs(rowOf(dot, 'Dot up on an enemy you left'))).toBe(3_560);
		expect(unionMs(rowOf(dot, 'Dot up')) + unionMs(rowOf(dot, 'Dot up on an enemy you left'))).toBe(118_315);
		expect(unionMs(rowOf(rowsOf(createElement(SearingTotemUptime, { analysis: cleave })), 'Totem up'))).toBe(72_106);
	});

	/**
	 * **Both remainders, per pull, and the row each one ends up in.**
	 *
	 * The two published dot series disagree in two directions and the re-partition has to place both, which
	 * is the thing the old three-name grid could not say because on all three of its pulls one direction was
	 * empty:
	 *
	 *   - **`outsideMs`** — numerator the primary-keyed array never sees, `contactWindows` less its overlap
	 *     with `flameShock.windows`. Zero on three pulls and **146 615ms** on `addsThenBoss`. It belongs to
	 *     green, because it is the tile's own numerator; the defect was that red claimed it as well.
	 *   - **`elsewhereMs`** — the primary's dot inside the graded clock that the numerator does not count.
	 *     **10 270ms** on `cleave`, **9 150ms** on `addsThenBoss`, zero on the two single-spawn pulls. It
	 *     belongs to the `missSoft` row.
	 *
	 * Red is then the graded clock less both of the up-ish claims, and that subtraction is asserted here as
	 * the closing identity rather than as a pinned literal per pull — `226 113` and friends move with a
	 * fixture recapture, the identity does not. The one literal is `addsThenBoss`' red row, pinned because
	 * the number the chart used to draw there (223 351ms) is exactly this plus `outsideMs`, and keeping both
	 * visible is what stops the fix reading as a renumbering.
	 *
	 * **The negative remainder is sixteen times the positive one on the pull that has both**, which is the
	 * argument against sizing any of this off `cleave`.
	 */
	it.each([
		['addsThenBoss', 81_056, 9_150],
		['cleave', 0, 3_560],
		['phased', 0, 0],
		['unbroken', 0, 0],
	] as const)('places both remainders between the up rows on %s', (name, outsideMs, elsewhereMs) => {
		const analysis = fx(name);
		const fs = analysis.flameShock;
		const drawnSpans = spans(fs.windows.map((w): Interval => [w.start, w.end]));
		const numerator = spans(fs.contactWindows.map((w): Interval => [w.start, w.end]));
		const rows = rowsOf(createElement(FlameShockUptime, { analysis }));
		const up = rowOf(rows, 'Dot up');
		const elsewhere = rowOf(rows, 'Dot up on an enemy you left');
		const down = rowOf(rows, 'Dot down');
		const uncounted = rowOf(rows, 'Dot up, not measured');

		// The two remainders, measured off the published arrays and not off the rows they end up in.
		expect(unionMs(numerator) - unionMs(intersect(numerator, drawnSpans)), name).toBe(outsideMs);
		expect(unionMs(elsewhere), name).toBe(elsewhereMs);

		// Where the negative one goes: wholly inside green, and nowhere near red. The second line is the whole
		// defect as an identity — red used to hold all 146 615ms of it, and a `toBeGreaterThan` would not care.
		expect(unionMs(intersect(up, numerator)), name).toBe(unionMs(numerator));
		expect(unionMs(intersect(down, numerator)), name).toBe(0);
		// Non-vacuity: every pull keeps the dot up for minutes, so neither side of those two is an empty set.
		expect(unionMs(numerator), name).toBeGreaterThan(0);
		expect(unionMs(drawnSpans), name).toBeGreaterThan(0);

		// And the closing identity: red is the graded clock less both up-ish claims, so the three claim rows
		// are that clock exactly. Stated as a subtraction rather than a literal so a recapture moves with it.
		expect(unionMs(down), name).toBe(fs.scoredMs - unionMs(up) - unionMs(elsewhere));
		// The aura's own total, which is where `outsideMs` shows up a second time: `uptimeMs` plus it.
		expect(unionMs(up) + unionMs(elsewhere) + unionMs(uncounted), name).toBe(fs.uptimeMs + outsideMs);
	});

	/**
	 * The fourth pull's own numbers, pinned — the pull the defect was found on, and the only one that moves.
	 *
	 * `flameShock.windows` is **one** span of 118 198ms because the primary target is on a tower and cannot be
	 * dotted for seven minutes, while the numerator is 71 spans of 240 421ms taken on whichever spawn was
	 * being hit. Red drawn as that one span's complement came to 223 351ms, of which 146 615ms was green
	 * repainted underneath itself; drawn as the complement of both series it is 76 736ms. The two figures are
	 * pinned together because their difference *is* the defect, and a single number would read as a recapture.
	 *
	 * Nothing else on this pull moves, which is the other half of the pin: the tile's numerator, the graded
	 * clock, the published percentage and the two grounds rows are all what they were.
	 */
	it('pins the re-partitioned rows on addsThenBoss', () => {
		const analysis = fx('addsThenBoss');
		const fs = analysis.flameShock;
		expect(fs.windows).toHaveLength(1);
		expect(fs.uptimeMs).toBe(118_198); // the whole dot on the primary target, unclipped
		expect(fs.contactWindows).toHaveLength(56);
		expect(fs.contactUptimeMs).toBe(174_862); // the tile's numerator
		expect(fs.scoredMs).toBe(232_001);

		const rows = rowsOf(createElement(FlameShockUptime, { analysis }));
		expect(unionMs(rowOf(rows, 'Dot up'))).toBe(174_862);
		expect(unionMs(rowOf(rows, 'Dot up on an enemy you left'))).toBe(9_150);
		// 129 045 in total, and the 81 056ms difference is the green row it was drawn over.
		expect(unionMs(rowOf(rows, 'Dot down'))).toBe(47_989);
		expect(47_989 + 81_056).toBe(129_045);
		expect(unionMs(rowOf(rows, 'Dot up, not measured'))).toBe(15_242);
		// The grounds, unmoved: this was never an arithmetic defect.
		expect(unionMs(rowOf(rows, 'Nothing to hit'))).toBe(7_841);
		expect(unionMs(rowOf(rows, 'Fought as AoE'))).toBe(320_419);
		expect(fs.uptimePct).toBeCloseTo(75.371_226_848_160_13, 9);
	});

	/**
	 * A no-change guard, labelled: `phased`'s totem never ticks outside its own clock, so that chart may not
	 * grow a row there. The dot chart *does* grow one on every committed pull, which is the point about the
	 * gap predating the add-wave cut, stated from the other side.
	 */
	it('grows no unmeasured row where the aura never left the clock', () => {
		const phased = fx('phased');
		const totem = rowsOf(createElement(SearingTotemUptime, { analysis: phased })).map((r) => r.label);
		expect(totem).not.toContain('Totem up, not measured'); // no-change guard
		for (const name of names) {
			const dot = rowsOf(createElement(FlameShockUptime, { analysis: fx(name) })).map((r) => r.label);
			expect(dot, name).toContain('Dot up, not measured');
		}
	});

	/**
	 * And the mirror of it for the fifth row: it is drawn only where the pull had another enemy to be on, so
	 * it appears on the two multi-spawn pulls and never on a chart that cannot have it.
	 *
	 * The condition is `targets.counts.max`, re-read per pull rather than the fixture's name. It used to be
	 * `name === 'cleave'` on a three-name literal, and `addsThenBoss` has nine enemies at its peak: written
	 * as a name this would have asserted the row *absent* on a pull that draws 9 150ms of it, so the grid
	 * growing would have turned a stale premise into a false one rather than into a red test.
	 *
	 * Gated rather than drawn empty for the reason `exemptTrack.test.ts` gives about the AoE row: an empty
	 * row reads as a rendering fault, and it is also what keeps that file's pinned row list for `phased`
	 * unchanged. Its tone is checked here too — `missSoft` and not `miss`, because the dot was up, and not
	 * `EXEMPT`, because these seconds are inside the denominator and do cost the percentage.
	 */
	it('draws the per-spawn row only where another enemy was being hit', () => {
		for (const name of names) {
			const analysis = fx(name);
			const rows = rowsOf(createElement(FlameShockUptime, { analysis }));
			const row = rows.find((r) => r.label === 'Dot up on an enemy you left');
			if ((analysis.targets?.counts.max ?? 1) > 1) {
				expect(row?.tone, name).toBe('missSoft');
				// `widen` was asserted here while this chart drew rows: the flag turns off a row's
				// minimum-span floor, and this row fragments on every refresh the log stamped early. A lane
				// has no such flag and needs none — it is continuous, so a bar too small to see costs a
				// reader nothing, and `TrackLane` states that where the floor used to be decided.
				expect(row, name).not.toHaveProperty('widen');
			} else {
				expect(row, name).toBeUndefined(); // no-change guard: one spawn, so no other enemy to be on
			}
		}
		// Never the exempt tone on any pull: the grounds are time the denominator dropped and this is not.
		for (const name of names) {
			const rows = rowsOf(createElement(FlameShockUptime, { analysis: fx(name) }));
			expect(
				rows.filter((r) => r.tone === EXEMPT).map((r) => r.label),
				name,
			).not.toContain('Dot up on an enemy you left');
		}
	});
});
