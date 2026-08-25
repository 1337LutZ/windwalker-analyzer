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

import { capturedAnalyses, rawFixtures } from '~/lib/analysis/fixtures';
import { complementOf, intersect, unionMs, type Interval } from '~/lib/analysis/intervals';
import { intervalsAtLeast } from '~/lib/analysis/targets';
import { initI18n } from '~/lib/i18n/config';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { fmt } from '~/components/format';
import type { ChartTheme } from '~/components/charts/apex';
import { exemptRows } from '~/components/charts/exempt';
import type { LaneSource } from '~/components/charts/TrackLane';
import { EXEMPT, EXEMPT_KIND } from '~/components/charts/tones';
import type { Track } from '~/components/charts/WindowTracks';
import DebuffTimeline from '~/specs/windwalker/components/charts/DebuffTimeline';
import FlameShockUptime from '~/specs/elemental/components/charts/FlameShockUptime';
import { buildBars } from '~/specs/elemental/components/charts/FlameShockDepth';
import SearingTotemUptime from '~/specs/elemental/components/charts/SearingTotemUptime';
import StormlashTotems from '~/specs/elemental/components/charts/StormlashTotems';
import { analyse } from '~/specs/elemental/lib';

/**
 * Both shapes, one list — see the same note in `uptimeRow.test.ts`.
 *
 * `FlameShockUptime` draws a merged lane now and the other charts here still draw rows. Everything
 * below reads `label`, `tone` and `windows`, which `Track` and `LaneSource` both carry, so the harness
 * takes whichever component rendered and the assertions stay one set.
 */
type Drawn = Pick<Track, 'label' | 'tone' | 'windows'> | Pick<LaneSource, 'label' | 'tone' | 'windows'>;

/** Exempt, whichever table the tone came from — one `EXEMPT` on a row chart, a kind on a lane. */
const isExempt = (tone: string): boolean => tone === EXEMPT || tone in EXEMPT_KIND;

const drawn = vi.hoisted(() => ({ calls: [] as Array<{ tracks: readonly unknown[]; label: string }> }));

vi.mock('~/components/charts/TrackLane', () => ({
	default: (props: { sources: readonly unknown[]; label: string }) => {
		drawn.calls.push({ tracks: props.sources, label: props.label });
		return null;
	},
}));

vi.mock('~/components/charts/WindowTracks', () => ({
	default: (props: { tracks: readonly unknown[]; label: string }) => {
		drawn.calls.push(props);
		return null;
	},
}));

initI18n();

/** The rows one chart asked `WindowTracks` for, top to bottom. */
function rowsOf(element: ReactElement): readonly Drawn[] {
	drawn.calls.length = 0;
	renderToStaticMarkup(element);
	expect(drawn.calls).toHaveLength(1);
	return (drawn.calls[0]?.tracks ?? []) as readonly Drawn[];
}

/**
 * Every raw Elemental pull, found rather than listed, and the analysis memoised.
 *
 * Most of this file is deliberately about two named pulls — `phased` for the submerge and `cleave` for
 * the add waves — and those stay named, with the reason on the line. The one grid that meant "every
 * committed pull" was the `buildBars` sweep at the bottom, which spelled `['unbroken', 'cleave',
 * 'phased']`; see the argument there. Memoised because `addsThenBoss.json` is 4.4 MB.
 */
const ELEMENTAL_PULLS: string[] = rawFixtures('elemental').map(({ name }) => name.replace(/\.json$/, ''));

const analysedEl = new Map<string, Analysis & ElementalAuditResult>();
const elemental = (name: string): Analysis & ElementalAuditResult => {
	const hit = analysedEl.get(name);
	if (hit !== undefined) return hit;
	const found = rawFixtures('elemental').find((fixture) => fixture.name === `${name}.json`);
	if (found === undefined) throw new Error(`no raw Elemental fixture ${name}`);
	const el = analyse(found.dataset) as Analysis & ElementalAuditResult;
	analysedEl.set(name, el);
	return el;
};

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
	 *
	 * **As a grid this is now redundant, and deliberately not grown into one.**
	 * `specs/elemental/components/charts/__tests__/uptimeRow.test.ts` asserts, over `rawFixtures` and for
	 * both of these charts, that `up + elsewhere + down === scoredMs` and that the same three rows plus the
	 * grounds sum to `durationMs`. Subtract the one from the other and the grounds **are**
	 * `durationMs - scoredMs`; it further asserts the unmeasured row lies inside the grounds, so its
	 * `exempt` and this file's "every row wearing the exempt tone" are the same union. That is this exact
	 * identity, on four pulls where this has one. Running it again over four pulls here would be four
	 * renders buying nothing.
	 *
	 * What is *not* redundant is the pair of `scoredMs` literals below — `uptimeRow` reads that figure off
	 * the audit on both sides of its own equalities and never pins it — so this stays as a one-pull pin
	 * with the identity as its scaffolding, rather than being deleted or duplicated.
	 */
	it('draws exactly the pull the two dot clocks did not measure', () => {
		for (const [name, chart, scoredMs] of [
			['Flame Shock', FlameShockUptime, cleave.flameShock.scoredMs],
			['Searing Totem', SearingTotemUptime, cleave.searingTotem.scoredMs],
		] as const) {
			const rows = rowsOf(createElement(chart, { analysis: cleave }));
			const exempt = rows.filter((row) => isExempt(row.tone)).flatMap((row) => spans(row.windows));
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
	 *
	 * Redundant for the same reason and kept for the same reason as the test above: `uptimeRow.test.ts`
	 * makes this containment claim over every raw fixture and both charts. `cleave` is kept here because it
	 * is where the row is largest and because this file is where a reader looking for the exempt tone's
	 * rules will come.
	 */
	it('draws the unmeasured half of each aura inside the grounds and not beside them', () => {
		for (const [name, chart, uncounted] of [
			['Flame Shock', FlameShockUptime, 'Dot up, not measured'],
			['Searing Totem', SearingTotemUptime, 'Totem up, not measured'],
		] as const) {
			const rows = rowsOf(createElement(chart, { analysis: cleave }));
			const row = spans(rows.find((r) => r.label === uncounted)?.windows ?? []);
			const grounds = rows.filter((r) => isExempt(r.tone) && r.label !== uncounted).flatMap((r) => spans(r.windows));

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
	 * **The fourth chart, whose exempt treatment is a row and not a region — and the assertion that was
	 * passing while its own comment described something else.**
	 *
	 * `FlameShockDepth` still draws no `exemptRows` band, and that part was never an omission. Its `x` is
	 * milliseconds since **each application**, so one instant of the fight lands at a different `x` on
	 * every row and most instants land on none; `exemptRows` returns fight-time intervals and there is no
	 * coordinate on that axis to put one at. A band there would say "this far into a dot", which is not a
	 * statement about the pull. What it draws instead is the individual **bar** in `EXEMPT`, which is the
	 * same grey and the same meaning at the only granularity this axis has.
	 *
	 * **What this test used to assert, and why it passed while being wrong.** It read
	 * `series.held.length === audit.refreshes` and the prose beside it called that the denominator of
	 * `flameShockWaste`. That was true when it was written, and `c93b866` ended it: the share now divides
	 * by `refreshes − unjudgedRefreshes`. `refreshes` is still the drawn row count, so the assertion went
	 * on passing — against the raw field, not the derived one it claimed — and on `cleave` the two are 2
	 * and 1. One committed fixture, one drawn row the figure no longer counted, and a green guard over the
	 * top of it. That is the failure this file exists to catch, caught in this file.
	 *
	 * The old text also said the fix was "a per-press `judged` flag on `FlameShockPress`, which the audit
	 * does not publish". It publishes two now: `judged`, which `unjudgedRefreshes` is counted out of, and
	 * `band`, the target count `judged` is read off (`judged` is `band === 1`).
	 *
	 * **Three counts, and the middle one is the point.** Rows drawn is `refreshes`; rows greyed is
	 * `unjudgedRefreshes`; rows left in a verdict colour is the share's denominator. All three are checked
	 * below over the discovered fixture set.
	 *
	 * **`cleave` was described here as "the only committed fixture where they are not the same number",
	 * and it is not.** That sentence, and the three-name loop under it, were written when the directory
	 * held three pulls; `addsThenBoss` greys **4 of its 13** refresh rows against `cleave`'s 1 of 2, so the
	 * pull that exercises this hardest is the one the sweep never ran. `cleave` keeps its named block below
	 * because the band-4 press at 57 499 is a specific press with specific tooltip copy.
	 */
	it('greys the refresh rows the share stopped counting, and leaves the denominator drawn', () => {
		const THEME = { miss: '#m', kick: '#k', brew: '#b', rune: '#r', track: '#t' } as unknown as ChartTheme;

		for (const name of ELEMENTAL_PULLS) {
			const audit = elemental(name).flameShock;
			const series = buildBars(audit, THEME);
			// Every press made into a live dot still gets a row — greying one does not remove it.
			expect(series.held, name).toHaveLength(audit.refreshes);
			// The greyed rows are the ones the audit says the share dropped, counted the same way.
			const greyed = series.held.filter((bar) => bar.meta.tone === EXEMPT);
			expect(greyed, `${name} greyed`).toHaveLength(audit.unjudgedRefreshes);
			// And what is left in a verdict colour is the denominator of `flameShockWaste` — the equality
			// this test used to make against `refreshes` alone.
			expect(series.held.length - greyed.length, `${name} counted`).toBe(audit.refreshes - audit.unjudgedRefreshes);
			// The tail is one bar with the row it sits in, so a hover on either half reads the same.
			expect(
				series.lastTick.filter((bar) => bar.meta.tone === EXEMPT),
				`${name} tails`,
			).toHaveLength(audit.unjudgedRefreshes);
		}
		// The counts the equality is against, so a fixture recapture that moved them says so here. Written
		// out per fixture rather than as one number, because the whole defect was `cleave` differing from
		// the other two and nobody looking — and keyed by name rather than positional, so a fifth pull
		// fails here instead of joining a loop that never reaches it.
		expect(
			Object.fromEntries(
				ELEMENTAL_PULLS.map((name) => {
					const audit = elemental(name).flameShock;
					return [name, [audit.refreshes, audit.unjudgedRefreshes, audit.refreshes - audit.unjudgedRefreshes]];
				}),
			),
		).toEqual({
			addsThenBoss: [13, 4, 9],
			cleave: [2, 1, 1],
			phased: [4, 0, 4],
			unbroken: [6, 0, 6],
		});

		// `cleave`'s band-4 refresh: inside an add wave, drawn, and now drawn grey rather than amber.
		const aoe = toIntervals(cleave.lightningShield.aoeWindows);
		const press = cleave.flameShock.presses.find((p) => p.t === 57_499)!;
		expect(press.remainingMs).not.toBeNull();
		expect(press.judged).toBe(false);
		expect(unionMs(intersect([[press.t, press.t + 1]], aoe))).toBe(1);
		const drawn = buildBars(cleave.flameShock, THEME);
		const row = drawn.held.find((bar) => bar.x.includes(fmt(press.t)));
		expect(row).toBeDefined();
		expect(row?.meta.tone).toBe(EXEMPT);
		// The tooltip names the count off `band`, not the flag: "three or more enemies" would be a lie on
		// this pull's two band-2 presses, so the row says the number it was actually made at.
		expect(press.band).toBe(4);
		expect(row?.meta.rows).toContainEqual(['reason', 'not measured — 4 enemies up']);
		// Non-vacuous in the other direction: this pull's other refresh is judged and keeps its verdict.
		expect(drawn.held.filter((bar) => bar.meta.tone !== EXEMPT)).toHaveLength(1);
		// And the section's own waste figure is now taken over that one row rather than over both. The
		// pull-wide count is unchanged and still 1 — the correction is `unjudgedWaste`.
		const audit = cleave.flameShock;
		expect(audit.refreshes - audit.windowed - audit.ascPrep - audit.snapshotGain).toBe(1);
		expect(audit.unjudgedWaste).toBe(1);
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
	 * out of contact are 908ms at the front and 699ms at the back, so under the old filter the row was
	 * empty, the key entry vanished and the label stated 0ms of a 1 607ms drop.
	 *
	 * **Three of the Windwalker's six captures were being asked, and the omission was not deliberate.**
	 * The list was `['weave', 'strong', 'waves']` — the three that made the argument — while `cleave`,
	 * `mixed` and `poor` sat in the same directory carrying the same row and answering to nobody. This is
	 * the Elemental fourth-fixture mechanism on the other spec: a literal that meant "every pull with this
	 * row" and stopped meaning it. Discovered from `capturedAnalyses`, with the figure per pull kept as a
	 * pinned map so the sweep still says what it measured rather than only that it did not throw — and so
	 * a seventh capture has to be read and written down rather than looping past.
	 *
	 * The three that were missing carry 2 699ms, 40 583ms and 2 566ms of this row between them, and the
	 * identity holds on all six — so nothing was broken, but 45 848ms of drawn exempt row had never been
	 * compared to the denominator it is supposed to be the complement of.
	 */
	const AWAY_MS: Record<string, number> = {
		cleave: 2699,
		mixed: 40_583,
		poor: 2566,
		strong: 20_013,
		waves: 123_575,
		weave: 1607,
	};

	it.each(capturedAnalyses('windwalker').map(({ name }) => name.replace(/\.json$/, '')))(
		'draws the seconds the Rising Sun Kick denominator dropped on %s',
		(name) => {
			const analysis = windwalker(name);
			const contact = analysis.debuff.contactSegments ?? [];
			expect(contact.length).toBeGreaterThan(0);
			const away = rowsOf(createElement(DebuffTimeline, { analysis, target: 'the boss' })).find((row) =>
				isExempt(row.tone),
			);
			// The identity, which is the claim: the ground **is** the complement of the denominator's own
			// contact segments, not a filtered version of it.
			expect(spans(away?.windows ?? [])).toEqual(complementOf([...contact], analysis.durationMs));
			expect(unionMs(spans(away?.windows ?? [])), name).toBe(AWAY_MS[name]);
		},
	);

	/**
	 * One ramp per chart that draws a lane, and never the single tone a row chart would have used.
	 *
	 * **This has narrowed twice, and the second narrowing is the one worth writing down.** It began as
	 * "one tone across every chart", which was right while every exempt stretch had a row of its own: the
	 * row's label said which cause it was, so the colour only had to say "not graded", and two greys
	 * would have been two meanings for one concept. A merged lane has no labels, so `FlameShockUptime`
	 * separates its three causes by `EXEMPT_KIND` instead — see that table for why, and for the red the
	 * lightest step has to clear — and the claim became one tone on a row chart, one ramp on a lane.
	 *
	 * **`DebuffTimeline` was the row half of that pair, and it draws a lane too now, so the row half has
	 * no chart left to point at.** Said out loud rather than quietly dropped: the two charts still built
	 * on `WindowTracks` are `StormlashTotems` and `SpiritLanes`, whose rows are *instances* — one
	 * shaman's totem, one spirit's target — and an instance is never a stretch a denominator dropped.
	 * Stormlash is rendered below so that is measured rather than assumed, because a guard whose subject
	 * quietly emptied is the failure `analysis/fixtures.ts` carries its own non-vacuity note about.
	 * `EXEMPT` does not go dead with it: `LightningShield`, `Mana`, `FlameShockDepth` and the segment
	 * strip all still reach for it, none of them through a row.
	 *
	 * What survives is the part that was load-bearing: a reader never has two greys to tell apart
	 * *without being told which is which*. On a lane the step does it, with the key naming every one
	 * drawn.
	 */
	it('names every exempt ground with a kind, and never with a row chart’s tone', () => {
		const lane = [
			...rowsOf(createElement(FlameShockUptime, { analysis: phased })).slice(2),
			...rowsOf(createElement(SearingTotemUptime, { analysis: phased })).slice(2),
			...rowsOf(createElement(DebuffTimeline, { analysis: windwalker('waves'), target: 'the boss' })).slice(2),
		];

		expect(lane).not.toHaveLength(0);
		expect(lane.every((row) => row.tone in EXEMPT_KIND)).toBe(true);
		expect(lane.some((row) => row.tone === EXEMPT)).toBe(false);

		// The chart that kept its rows, and the half of the claim that is now about an absence: it draws
		// no exempt stretch at all, on the one committed pull that has Stormlash totems in it.
		const rows = rowsOf(createElement(StormlashTotems, { analysis: elemental('addsThenBoss') }));
		expect(rows).not.toHaveLength(0);
		expect(rows.some((row) => isExempt(row.tone))).toBe(false);
	});

	/**
	 * A ground, not a mark — and the flag that used to enforce it has nothing left to sit on.
	 *
	 * `widen` exists so a row's own bars stay visible when they are all the row has to show. A lane is
	 * continuous, so a bar too small to see costs a reader nothing and its neighbours already say what
	 * that instant was; `TrackLane` states that where the floor used to be decided. `DebuffTimeline` was
	 * the last chart drawing an exempt stretch as a row, and it needed the flag hardest — its up source
	 * is contact-scoped, 75 spans at a 0.44s median on `strong`, and widening those inflated the green
	 * from 467s to 524s of a 535s pull. Merged, there is no floor to turn off, so what is left to assert
	 * is that none of the three carries the flag at all.
	 *
	 * **The one exception this used to carry went with the chart that needed it**, and the worry behind
	 * it was theoretical anyway. A row the tiles above also *count* had to stay visible however short it
	 * was, and the Fire Elemental overlap row was that row — but measured across the four Elemental
	 * fixtures the elemental holds the totem slot for 10.7%, 22.2%, 22.2% and 31.5% of the pull, in one
	 * or two spans. Nothing near a sliver.
	 */
	it('carries no widening flag on a chart that merged its rows', () => {
		const sources = [
			...rowsOf(createElement(FlameShockUptime, { analysis: phased })),
			...rowsOf(createElement(SearingTotemUptime, { analysis: phased })),
			...rowsOf(createElement(DebuffTimeline, { analysis: windwalker('waves'), target: 'the boss' })),
		];

		expect(sources).not.toHaveLength(0);
		for (const source of sources) expect(source).not.toHaveProperty('widen');
	});
});

function intersects(a: ReadonlyArray<readonly [number, number]>, b: ReadonlyArray<readonly [number, number]>): boolean {
	return a.some(([aStart, aEnd]) => b.some(([bStart, bEnd]) => Math.min(aEnd, bEnd) > Math.max(aStart, bStart)));
}
