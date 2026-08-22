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

import { complementOf, intersect } from '~/lib/analysis/intervals';
import { initI18n } from '~/lib/i18n/config';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';

import { exemptRows } from '~/components/charts/exempt';
import { EXEMPT } from '~/components/charts/tones';
import type { Track } from '~/components/charts/WindowTracks';
import DebuffTimeline from '~/specs/windwalker/components/charts/DebuffTimeline';
import FlameShockUptime from '~/specs/elemental/components/charts/FlameShockUptime';
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

describe('the exempt row', () => {
	it('is drawn last, behind the up and down rows it is the ground for', () => {
		expect(rowsOf(createElement(FlameShockUptime, { analysis: phased })).map((row) => row.label)).toEqual([
			'Dot up',
			'Dot down',
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
