// Vengeance on the cast timeline, and the three things that have to hold for it to draw there.
//
// The lane is not a component: `CastTimeline` derives its rows from `analysis.resources`, so putting
// Vengeance on the chart means putting it in that map, in the right shape and in the right place.
// `SpecConfig.extraResources` is the seam and `vengeanceBar` is the conversion; what is asserted here
// is that the two produce something the generic chart can draw, and that the fields which would be a
// claim about regeneration stay refused.

import { describe, expect, it } from 'vitest';

import { rawFixture } from '~/lib/analysis/fixtures';
import { analyse } from '~/specs/protection/lib';
import type { Analysis, ProtectionAudit } from '~/lib/types';

type Pull = Analysis & ProtectionAudit;

const PULLS = ['garrosh.json', 'paragons.json', 'fallenProtectors.json', 'galakras.json', 'spoils.json'] as const;
const pull = (name: string): Pull => analyse(rawFixture('protection', name)) as Pull;

describe('the Vengeance lane', () => {
	/**
	 * Above the holy power bar, because key order *is* row order.
	 *
	 * `resourceLanesOf` maps `Object.keys(resources)`, so the merge in `analyseCore` spreading the
	 * spec's own bars ahead of the declared ones is the whole mechanism — there is no sort anywhere to
	 * express the intent instead, and a merge written the other way round would silently reverse the
	 * chart with nothing else failing.
	 */
	it.each(PULLS)('%s draws Vengeance above the declared bars', (name) => {
		expect(Object.keys(pull(name).resources ?? {})).toEqual(['vengeance', 'holyPower']);
	});

	/**
	 * A pool by its drawing rather than by its mechanic, and the fields that would lie are left empty.
	 *
	 * Vengeance decays rather than regenerating, so `regenPerSec` is null — which is also what makes
	 * `CastTimeline` label a stretch at the ceiling with its duration instead of pricing it, the same
	 * treatment chi gets. The contact split is nought on purpose: it asks whether there was something
	 * to hit, and this bar is filled by being hit.
	 */
	it.each(PULLS)('%s refuses the figures a decaying bar cannot support', (name) => {
		const bar = pull(name).resources?.['vengeance'];
		expect(bar?.kind).toBe('pool');
		if (bar?.kind !== 'pool') return;
		expect(bar.regenPerSec).toBeNull();
		expect(bar.total.wasted).toBeNull();
		expect(bar.engaged).toEqual({ cappedMs: 0, pct: 0, wasted: null });
		expect(bar.downtime).toEqual({ cappedMs: 0, pct: 0, wasted: null });
		// A ceiling is a number off a character sheet, and it is printed beside the lane's own label.
		expect(Number.isInteger(bar.max)).toBe(true);
		expect(bar.curve.max).toBe(bar.max);
	});

	/**
	 * The lane carries the same reading the section does, rather than a second measurement of it.
	 *
	 * `extraResources` is handed the audit so the pull is not walked twice, and this is what would fail
	 * if it ever started recomputing: the two would drift apart on the pulls that sit against the
	 * ceiling, which are exactly the pulls anybody would look at.
	 */
	it.each(PULLS)('%s agrees with the section it was read from', (name) => {
		const analysis = pull(name);
		const bar = analysis.resources?.['vengeance'];
		if (bar?.kind !== 'pool') throw new Error('not a pool');
		expect(bar.curve.points).toEqual(analysis.vengeance.curve.points);
		expect(bar.curve.ceiling).toEqual(analysis.vengeance.curve.ceiling);
		expect(bar.total.cappedMs).toBe(analysis.vengeance.nearCapMs);
		expect(bar.capped).toHaveLength(analysis.vengeance.nearCap.length);
	});

	/**
	 * And the two pulls that reach the ceiling are the two that shade it, which is the point of drawing
	 * it beside the presses at all: a reader can look up from a stretch of buttons to a bar that had
	 * stopped paying for them.
	 */
	it('shades the ceiling only where the pull reached it', () => {
		const shaded = (name: string) => {
			const bar = pull(name).resources?.['vengeance'];
			return bar?.kind === 'pool' ? bar.capped.length : -1;
		};
		expect(shaded('garrosh.json')).toBeGreaterThan(0);
		expect(shaded('paragons.json')).toBeGreaterThan(0);
		expect(shaded('galakras.json')).toBe(0);
		expect(shaded('spoils.json')).toBe(0);
	});
});
