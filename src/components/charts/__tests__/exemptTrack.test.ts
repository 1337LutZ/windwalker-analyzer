// The exempt row: one tone, one place it comes from, one position in the stack.
//
// Three charts draw a stretch that was left out of their own denominator, and until this test they did
// not agree about it — the Rising Sun Kick debuff painted its "nothing to hit" row in `muted` while the
// Searing Totem chart painted the Fire Elemental's slot in `track`, and the Flame Shock chart drew no
// such row at all, so a submerge came out of the percentage and stayed in the picture as an
// unexplained gap. What is asserted here is the agreement, which no type can express: the tone, the
// order, `widen`, and — the part that matters most — that the row is the *same* array the denominator
// dropped rather than a second guess at it.
//
// It lives here rather than beside each chart because the claim is about all three at once, and it
// reads the rows out of `WindowTracks` rather than out of the rendered HTML because the chart is a
// canvas ApexCharts draws in an effect: server-rendered there is nothing in the box to assert on. The
// mock is the seam — it records what each chart asked to be drawn.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { complementOf, intersect, unionMs, type Interval } from '~/lib/analysis/intervals';
import { intervalsAtLeast } from '~/lib/analysis/targets';
import { initI18n } from '~/lib/i18n/config';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';

import { fmt } from '~/components/format';
import type { ChartTheme } from '~/components/charts/apex';
import { exemptRows } from '~/components/charts/exempt';
import { EXEMPT } from '~/components/charts/tones';
import type { Track } from '~/components/charts/WindowTracks';
import DebuffTimeline from '~/specs/windwalker/components/charts/DebuffTimeline';
import FlameShockUptime from '~/specs/elemental/components/charts/FlameShockUptime';
import { buildBars } from '~/specs/elemental/components/charts/FlameShockDepth';
import SearingTotemUptime from '~/specs/elemental/components/charts/SearingTotemUptime';
import { analyse } from '~/specs/elemental/lib';

const drawn = vi.hoisted(() => ({ calls: [] as Array<{ tracks: readonly Track[]; label: string }> }));

vi.mock('~/components/charts/WindowTracks', () => ({
	default: (props: { tracks: readonly Track[]; label: string }) => {
		drawn.calls.push(props);
		return null;
	},
}));

initI18n();

/** The rows one chart asked `WindowTracks` for, top to bottom. */
function rowsOf(element: ReactElement): readonly Track[] {
	drawn.calls.length = 0;
	renderToStaticMarkup(element);
	expect(drawn.calls).toHaveLength(1);
	return drawn.calls[0]?.tracks ?? [];
}

const elemental = (name: string): Analysis & ElementalAuditResult =>
	analyse(
		JSON.parse(
			readFileSync(resolve(import.meta.dirname, `../../../specs/elemental/__fixtures__/${name}.json`), 'utf8'),
		) as FightDataset,
	) as Analysis & ElementalAuditResult;

const windwalker = (name: string): Analysis =>
	JSON.parse(
		readFileSync(resolve(import.meta.dirname, `../../../specs/windwalker/__fixtures__/${name}.json`), 'utf8'),
	) as Analysis;

/**
 * `a:qHRAFwdGzaB6MPYC` #14 — Iron Juggernaut 25H, the same fixture `elemental/lib/__tests__/pulls.test.ts`
 * reads. The boss submerges from 142.3s to 192.5s: `contactSegments` is `[[1012, 142282], [192534, 257821]]`
 * against a 258 304ms pull, so the exempt row's windows are arithmetic anyone can check by hand rather
 * than whatever the code happens to produce.
 */
const phased = elemental('phased');
const SUBMERGE: Array<[number, number]> = [
	[0, 1012],
	[142_282, 192_534],
	[257_821, 258_304],
];

/**
 * `a:5R2WhbtHK1AM3Vgn` #19 — the one committed Elemental pull that ever exceeds two enemies, and so the
 * only one that can show an AoE exempt row at all.
 *
 * **The reason the tests below are on this fixture and not on `phased`.** Everything above runs on
 * `phased`, which never leaves one enemy: `lightningShield.aoeWindows` is empty there, so a chart that
 * drew the AoE stretches into its *red* row — fault time its own percentage had stopped charging — would
 * pass every assertion in this file. The guard was blind to the disagreement by fixture choice, which is
 * exactly the shape of bug this file exists to catch. 82 858ms of `cleave`'s 263 233 are above two enemies,
 * across seven stretches.
 */
const cleave = elemental('cleave');

const toIntervals = (windows: ReadonlyArray<{ start: number; end: number }>): Interval[] =>
	windows.map((w): Interval => [w.start, w.end]);
const spans = (windows: ReadonlyArray<readonly [number, number]>): Interval[] =>
	windows.map((w): Interval => [w[0], w[1]]);

describe('the exempt row', () => {
	it('is drawn last, behind the up and down rows it is the ground for', () => {
		// The third row is the dot's own life outside the graded clock, drawn since the up row was clipped to
		// that clock — a claim about the dot rather than a ground, so it sits with the claims and above them.
		// `phased` has 9 309ms of it, which is why it is here on a pull with no add wave at all; see
		// `elemental/components/charts/__tests__/uptimeRow.test.ts`.
		expect(rowsOf(createElement(FlameShockUptime, { analysis: phased })).map((row) => row.label)).toEqual([
			'Dot up',
			'Dot down',
			'Dot up, not measured',
			'Nothing to hit',
		]);
		expect(rowsOf(createElement(SearingTotemUptime, { analysis: phased })).map((row) => row.label)).toEqual([
			'Totem up',
			'Totem down',
			'Nothing to hit',
			'Fire Elemental out',
		]);
	});

	it('draws the seconds the Flame Shock denominator dropped, and not a re-derivation of them', () => {
		const away = rowsOf(createElement(FlameShockUptime, { analysis: phased })).at(-1);
		expect(away?.windows).toEqual(SUBMERGE);
		expect(away?.windows).toEqual(complementOf(phased.timeline?.contactSegments ?? [], phased.durationMs));
	});

	it('splits the Searing Totem exemption by cause without counting a second twice', () => {
		const rows = rowsOf(createElement(SearingTotemUptime, { analysis: phased }));
		const away = rows.find((row) => row.label === 'Nothing to hit')?.windows ?? [];
		const slot = rows.find((row) => row.label === 'Fire Elemental out')?.windows ?? [];

		// The submerge, less whatever the elemental was already holding. The two rows between them are
		// the whole of what the denominator forgave, and no second of it is on both.
		expect(away).toEqual(intersect(SUBMERGE, complementOf(slot, phased.durationMs)));
		expect(intersects(away, slot)).toBe(false);
	});

	/**
	 * The split above, from `exemptRows` instead of by hand — and identical.
	 *
	 * This is the seam a **third** exempt cause arrives through. Amendment 2 adds an AoE band beside the
	 * intermission and the Fire Elemental's slot, and the causes overlap: an AoE stretch can sit inside
	 * an intermission or straddle its edge, and step 57a settled that such an overlap is drawn as one
	 * band rather than two washes. Hand-rolling that a third time across four charts is how this file
	 * came to exist in the first place, so the rule is one function and this test is the proof that the
	 * function *is* the rule the committed charts already follow — not a second opinion beside them.
	 *
	 * Precedence order, strongest claim first: the Fire Elemental's slot wins over the intermission
	 * here, exactly as `SearingTotemUptime` decided it. Note that this is not the order the rows are
	 * drawn in — the intermission is drawn above the slot — which is why the two orders are separate
	 * facts and why passing them the wrong way round is worth pinning against.
	 */
	it('is the split `exemptRows` produces from the same two causes', () => {
		const rows = rowsOf(createElement(SearingTotemUptime, { analysis: phased }));
		const away = rows.find((row) => row.label === 'Nothing to hit')?.windows ?? [];
		const slot = rows.find((row) => row.label === 'Fire Elemental out')?.windows ?? [];

		// Neither row is empty on this fixture, so nothing below passes for want of data.
		expect(slot).not.toHaveLength(0);
		expect(away).not.toHaveLength(0);

		// What the denominator dropped, whole: everything outside the stretches a totem was placeable in.
		const placeable = intersect(phased.timeline?.contactSegments ?? [], complementOf(slot, phased.durationMs));
		const dropped = complementOf(placeable, phased.durationMs);

		expect(
			exemptRows(
				[
					{ label: 'Fire Elemental out', windows: slot },
					{ label: 'Nothing to hit', windows: dropped },
				],
				phased.durationMs,
			),
		).toEqual([
			{ label: 'Fire Elemental out', windows: slot },
			{ label: 'Nothing to hit', windows: away },
		]);
	});

	/**
	 * The AoE row, and the red row it came out of — one claim per stretch of pull.
	 *
	 * `8d8b1f0` cut both dot clocks with `gradedSpans`, so `flameShock.scoredMs` and
	 * `searingTotem.scoredMs` stopped charging add-wave time and the two tiles moved (72.30% → 83.90% and
	 * 78.72% → 88.50%). Until this landed the charts' red rows still spanned those stretches, so the
	 * picture charged the reader for time the percentage beside it had already forgiven. Both halves are
	 * asserted here: the grey row exists, and the red row is out of the same milliseconds.
	 */
	it('shades the add waves both dot clocks now drop, and stops calling them a fault', () => {
		const aoe = toIntervals(cleave.lightningShield.aoeWindows);
		expect(unionMs(aoe)).toBe(82_858); // the fixture fact the rest of this rests on

		for (const [name, chart] of [
			['Flame Shock', FlameShockUptime],
			['Searing Totem', SearingTotemUptime],
		] as const) {
			const rows = rowsOf(createElement(chart, { analysis: cleave }));
			const grey = rows.find((row) => row.label === 'Three or more enemies');
			expect(grey, name).toBeDefined();
			expect(unionMs(spans(grey?.windows ?? [])), name).toBeGreaterThan(0);

			// Not one millisecond of the add waves is drawn as a dropped dot or a dropped totem.
			const red = rows.find((row) => row.tone === 'miss');
			expect(unionMs(intersect(spans(red?.windows ?? []), aoe)), name).toBe(0);
		}
	});

	/**
	 * And the arithmetic behind those rows, to the millisecond: the exempt rows are the pull less the clock
	 * the tile's percentage was taken over.
	 *
	 * This is the identity the whole exempt-row idea rests on, checkable here for the first time because
	 * the audit now publishes the graded length. It is also what settles the sliver question — a length
	 * floor on any of these rows would move one side of this equality and nothing else, which is a chart
	 * telling a different story from its own tile.
	 */
	it('draws exactly the pull the two dot clocks did not measure', () => {
		for (const [name, chart, scoredMs] of [
			['Flame Shock', FlameShockUptime, cleave.flameShock.scoredMs],
			['Searing Totem', SearingTotemUptime, cleave.searingTotem.scoredMs],
		] as const) {
			const rows = rowsOf(createElement(chart, { analysis: cleave }));
			const exempt = rows.filter((row) => row.tone === EXEMPT).flatMap((row) => spans(row.windows));
			expect(unionMs(exempt), name).toBe(cleave.durationMs - scoredMs);
		}
		// The two figures the equality is against, so a fixture recapture that moved them says so here.
		expect(cleave.flameShock.scoredMs).toBe(178_814);
		expect(cleave.searingTotem.scoredMs).toBe(127_378);
	});

	/**
	 * Why the equality above survived the up row being clipped, asserted rather than left to luck.
	 *
	 * The clip put a fourth row on each chart — the aura's own life outside the graded clock — and it takes
	 * the exempt tone, so it is inside the filter the test above runs. It adds nothing to that union only
	 * because it is a *subset* of the two grounds, and a subset relation nobody checks is a subset relation
	 * that stops holding. If it ever escaped the grounds, `durationMs - scoredMs` would grow and the tile
	 * would be the thing that moved.
	 */
	it('draws the unmeasured half of each aura inside the grounds and not beside them', () => {
		for (const [name, chart, uncounted] of [
			['Flame Shock', FlameShockUptime, 'Dot up, not measured'],
			['Searing Totem', SearingTotemUptime, 'Totem up, not measured'],
		] as const) {
			const rows = rowsOf(createElement(chart, { analysis: cleave }));
			const row = spans(rows.find((r) => r.label === uncounted)?.windows ?? []);
			const grounds = rows.filter((r) => r.tone === EXEMPT && r.label !== uncounted).flatMap((r) => spans(r.windows));

			expect(unionMs(row), name).toBeGreaterThan(0); // so nothing below passes for want of data
			expect(unionMs(intersect(row, grounds)), name).toBe(unionMs(row));
		}
	});

	/**
	 * A no-change guard, labelled: `phased` never leaves one enemy, so neither chart may grow a row.
	 *
	 * Which is the point about fixture choice made at `cleave` above, from the other side — the absence of
	 * the row is the answer on a pull with no add wave, and a row that appeared empty would read as a
	 * rendering fault.
	 */
	it('draws no AoE row on a pull that never left one enemy', () => {
		expect(phased.lightningShield.aoeWindows).toEqual([]); // no-change guard
		for (const chart of [FlameShockUptime, SearingTotemUptime]) {
			const labels = rowsOf(createElement(chart, { analysis: phased })).map((row) => row.label);
			expect(labels).not.toContain('Three or more enemies'); // no-change guard
		}
	});

	/**
	 * **The third graded clock, which has no chart and cannot have one.** `flameShock.multiTargetMs` is band
	 * 2 *alone* — the only clock in the audit cut at both ends — so the seconds it drops are the add waves
	 * the charts above shade **plus** every stretch at one enemy. Neither existing chart may shade that
	 * floor: band 1 is fully graded for the primary dot and for the totem, so a grey band there would say
	 * the opposite of the truth about the row it sat under. And a chart of its own would have no up row to
	 * draw, because the secondary target's dot is published as the scalar `multiDotUptimeMs` and never as an
	 * array.
	 *
	 * So the identity is asserted here without a picture, from the same two published sets a chart would
	 * have used: `targets.counts` for the floor and `aoeWindows` for the ceiling. Through `exemptRows`, so
	 * that the day the floor does get drawn it is partitioned by the rule every other exempt row follows
	 * rather than by a fourth complement written out beside it.
	 */
	it('accounts for the second dot’s clock too, which no chart draws', () => {
		const aoe = toIntervals(cleave.lightningShield.aoeWindows);
		const atLeastTwo = intervalsAtLeast(cleave.targets?.counts.points ?? [], 2, cleave.durationMs);
		expect(unionMs(atLeastTwo)).toBe(148_865); // the fixture fact the rest of this rests on

		const exempt = exemptRows(
			[
				{ label: 'Fewer than two enemies', windows: complementOf(atLeastTwo, cleave.durationMs) },
				{ label: 'Three or more enemies', windows: aoe },
			],
			cleave.durationMs,
		);

		// Both causes are real on this pull, so neither half of the equality is carried by the other.
		for (const row of exempt) expect(unionMs(spans(row.windows)), row.label).toBeGreaterThan(0);
		expect(unionMs(exempt.flatMap((row) => spans(row.windows)))).toBe(
			cleave.durationMs - cleave.flameShock.multiTargetMs,
		);
		expect(cleave.flameShock.multiTargetMs).toBe(66_007);
	});

	/**
	 * **The fourth chart, which has no exempt row and needs none — the one shape of answer this file did
	 * not yet hold.** `FlameShockDepth` was the last chart with zero exempt shading, and the reason is not
	 * an omission.
	 *
	 * Two grounds, and the first alone settles it. Its `x` is milliseconds since **each application**, so
	 * one instant of the fight lands at a different `x` on every row and most instants land on none;
	 * `exemptRows` returns fight-time intervals and there is no coordinate on that axis to put one at. A
	 * band there would say "this far into a dot", which is not a statement about the pull.
	 *
	 * The second is the one worth asserting, because it is the check the other three charts failed: the
	 * drawn set and the counted set are the same set. The rows are the presses made into a live dot, which
	 * is `flameShock.refreshes` exactly, which is the denominator of `flameShockWaste` — so nothing came
	 * out of the figure for a grey row to be honest about. Asserted on `cleave` above all, the only
	 * committed fixture with band-3+ time: its refresh at 57 499 is inside the add wave `[52 997, 83 587]`
	 * and is drawn in the fault tone, and the tile counts it in the same breath. Greying that row would put
	 * the picture at odds with the number beside it — the `SearingTotemUptime` defect pointing the other
	 * way.
	 *
	 * What would change this is a per-press `judged` flag on `FlameShockPress`, which the audit does not
	 * publish; `score.ts` names it at `flameShockWaste`'s threshold as "a numerator per band in the audit,
	 * not a wider declaration here". The day it lands, the equality below is what has to move first.
	 */
	it('draws no exempt row on the refresh chart, whose rows are the presses its share counts', () => {
		const THEME = { miss: '#m', kick: '#k', brew: '#b', rune: '#r' } as unknown as ChartTheme;
		const unbroken = elemental('unbroken');

		for (const [name, el] of [
			['unbroken', unbroken],
			['cleave', cleave],
			['phased', phased],
		] as const) {
			const audit = el.flameShock;
			const series = buildBars(audit, THEME);
			// The drawn set is the counted set: one row per press the share divides by.
			expect(series.held, name).toHaveLength(audit.refreshes);
			// And no row of it is drawn as unmeasured, at either target count. // no-change guard
			expect(
				series.held.every((bar) => bar.meta.tone !== EXEMPT),
				name,
			).toBe(true);
			expect(
				series.lastTick.every((bar) => bar.meta.tone !== EXEMPT),
				name,
			).toBe(true);
		}
		// The counts the equality is against, so a fixture recapture that moved them says so here.
		expect([unbroken.flameShock.refreshes, cleave.flameShock.refreshes, phased.flameShock.refreshes]).toEqual([
			6, 2, 4,
		]);

		// `cleave`'s band-4 refresh: inside an add wave, drawn, and charged by the tile in the same breath.
		const aoe = toIntervals(cleave.lightningShield.aoeWindows);
		const press = cleave.flameShock.presses.find((p) => p.t === 57_499)!;
		expect(press.remainingMs).not.toBeNull();
		expect(unionMs(intersect([[press.t, press.t + 1]], aoe))).toBe(1);
		const drawn = buildBars(cleave.flameShock, THEME);
		expect(drawn.held.some((bar) => bar.x.includes(fmt(press.t)))).toBe(true);
		// The `wasted` figure the section prints under it — one press, and this is the one.
		const audit = cleave.flameShock;
		expect(audit.refreshes - audit.windowed - audit.ascPrep - audit.snapshotGain).toBe(1);
		expect(audit.presses.filter((p) => p.remainingMs !== null && p.kind === 'early').map((p) => p.t)).toEqual([57_499]);
	});

	/**
	 * The Rising Sun Kick row, against the array its own denominator dropped — the assertion this file
	 * made about Flame Shock and never about this chart.
	 *
	 * `gapsBetween` used to filter the complement to gaps over a second, so the row was the seconds the
	 * denominator dropped *less the slivers* while the two Elemental charts drew theirs whole. Three
	 * charts of one pull, three answers to "which slivers count", and `debuff.chartLabel` printing an
	 * `away` total that no denominator matched.
	 *
	 * `weave` is the pull that makes the difference unarguable rather than pedantic: its only stretches
	 * out of contact are 862ms at the front and 57ms at the back, so under the old filter the row was
	 * empty, the key entry vanished and the label stated 0ms of a 919ms drop.
	 */
	it.each([
		['weave', 919],
		['strong', 19_812],
		['waves', 117_004],
	])('draws the seconds the Rising Sun Kick denominator dropped on %s', (name, awayMs) => {
		const analysis = windwalker(name);
		const contact = analysis.debuff.contactSegments ?? [];
		expect(contact.length).toBeGreaterThan(0);
		const away = rowsOf(createElement(DebuffTimeline, { analysis, target: 'the boss' })).find(
			(row) => row.tone === EXEMPT,
		);
		expect(spans(away?.windows ?? [])).toEqual(complementOf([...contact], analysis.durationMs));
		expect(unionMs(spans(away?.windows ?? []))).toBe(awayMs);
	});

	it('is one tone across every chart that has one', () => {
		const exempt = [
			...rowsOf(createElement(FlameShockUptime, { analysis: phased })).slice(2),
			...rowsOf(createElement(SearingTotemUptime, { analysis: phased })).slice(2),
			...rowsOf(createElement(DebuffTimeline, { analysis: windwalker('waves'), target: 'the boss' })).slice(2),
		];

		expect(exempt).not.toHaveLength(0);
		expect([...new Set(exempt.map((row) => row.tone))]).toEqual([EXEMPT]);
	});

	/**
	 * A ground, not a mark — with the one exception the concept allows: a row the tiles above also
	 * *count* must stay visible however short it is, and the Fire Elemental overlap tile does exactly
	 * that. See `Track.widen`.
	 */
	it('is never widened, unless a tile above counts its spans one by one', () => {
		const rows = [
			...rowsOf(createElement(FlameShockUptime, { analysis: phased })).slice(2),
			...rowsOf(createElement(SearingTotemUptime, { analysis: phased })).slice(2),
			...rowsOf(createElement(DebuffTimeline, { analysis: windwalker('waves'), target: 'the boss' })).slice(2),
		];

		for (const row of rows) {
			expect(row.widen ?? true).toBe(row.label === 'Fire Elemental out');
		}
	});
});

function intersects(a: ReadonlyArray<readonly [number, number]>, b: ReadonlyArray<readonly [number, number]>): boolean {
	return a.some(([aStart, aEnd]) => b.some(([bStart, bEnd]) => Math.min(aEnd, bEnd) > Math.max(aStart, bStart)));
}
