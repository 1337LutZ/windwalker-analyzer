import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Analysis } from '~/lib/types';

import CastsPerMinute from '../CastsPerMinute';

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8'));

const COMBO_BREAKER_TIGER_PALM = 118864;

/** The Tiger Palm row's `found / target` count cell, as rendered. */
function tigerPalmCounts(analysis: Analysis): { found: number; target: number } {
	const html = renderToStaticMarkup(createElement(CastsPerMinute, { analysis }));
	// The row is keyed by cast id; its count cell is the `found / target` pair.
	const row = /Tiger Palm[\s\S]*?<b[^>]*>(\d+)<\/b><span[^>]*> \/ (\d+)<\/span>/.exec(html);
	if (row === null) throw new Error('no Tiger Palm count cell in the rendered table');
	return { found: Number(row[1]), target: Number(row[2]) };
}

/**
 * The target must be built from the procs that *happened*, not the ones that were taken.
 *
 * The bug this pins: `filler.onProc` counts presses that landed on a Combo Breaker proc, so a player
 * who ignored procs had a smaller numerator, a smaller target, and a better-looking row — the table
 * advised them to keep ignoring them. A proc is a free global whether anyone reached for it or not.
 */
describe('the Tiger Palm target', () => {
	it('does not shrink when procs are left to expire', () => {
		const took = fixture('poor');
		const ignored = structuredClone(took);

		const cb = ignored.comboBreaker.find((entry) => entry.id === COMBO_BREAKER_TIGER_PALM);
		expect(cb, 'fixture has no Combo Breaker: Tiger Palm entry').toBeDefined();
		if (cb === undefined) return;

		// Same pull, same number of procs — the player just took five fewer of them and pressed the
		// button five fewer times, spending those globals on nothing.
		//
		// The press count has to move everywhere it is recorded, or the test is not describing a real
		// pull: the cast row's rate is what the target is scaled by, so leaving it at the old value
		// while shrinking `filler.casts` inflates the target for a reason no player could cause.
		const skipped = 5;
		expect(ignored.filler.onProc).toBeGreaterThanOrEqual(skipped);
		cb.wasted += skipped;
		ignored.filler.onProc -= skipped;
		ignored.filler.casts -= skipped;

		const row = ignored.casts.find((c) => c.id === 100787);
		expect(row, 'fixture has no Tiger Palm cast row').toBeDefined();
		if (row === undefined) return;
		row.cpm = (row.cpm * (row.count - skipped)) / row.count;
		row.count -= skipped;

		expect(tigerPalmCounts(ignored).target).toBe(tigerPalmCounts(took).target);
	});

	/** Every proc counts toward the budget, whether it was consumed or expired. */
	it('counts procs that expired unused', () => {
		const analysis = fixture('poor');
		const cb = analysis.comboBreaker.find((entry) => entry.id === COMBO_BREAKER_TIGER_PALM);
		if (cb === undefined) return;

		const before = tigerPalmCounts(analysis).target;

		const more = structuredClone(analysis);
		const moreCb = more.comboBreaker.find((entry) => entry.id === COMBO_BREAKER_TIGER_PALM);
		if (moreCb === undefined) return;
		// Four extra procs nobody pressed. They were still four free globals on offer.
		moreCb.procs += 4;
		moreCb.wasted += 4;

		expect(tigerPalmCounts(more).target).toBeGreaterThan(before);
	});

	/**
	 * A log with no proc aura at all falls back to the presses. Not ideal, but it is the only honest
	 * answer available, and it must not render a target of zero or crash.
	 */
	it('falls back to the presses when the proc aura is absent', () => {
		const analysis = fixture('poor');
		const without = structuredClone(analysis);
		without.comboBreaker = without.comboBreaker.filter((entry) => entry.id !== COMBO_BREAKER_TIGER_PALM);

		expect(tigerPalmCounts(without).target).toBeGreaterThan(0);
	});
});
