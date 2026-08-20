import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Analysis } from '~/lib/types';

import { scoreAnalysis } from '~/specs/windwalker/lib/score';

import { SpecContext } from '~/components/report/specContext';
import { getSpec } from '~/lib/spec';

import KpiTiles from '../KpiTiles';

// Every fixture below is a Windwalker pull, so the section is rendered under the Windwalker's own
// scorer and copy. Named rather than left to `SpecContext`'s default, which is the build's pinned
// `DEFAULT_SPEC` — under `PUBLIC_SPEC=elemental` that scored these monk fixtures with the Shaman's
// thresholds.
const WINDWALKER_SPEC = getSpec('windwalker')!;
const asWindwalker = (node: ReactNode): ReactElement =>
	createElement(SpecContext.Provider, { value: WINDWALKER_SPEC }, node);

const TONE = { good: 'text-kick', ok: 'text-brew', bad: 'text-miss' } as const;

/** The grade the scorecard gives a metric, so the expectation cannot drift from the thresholds. */
function gradeOf(analysis: Analysis, key: string) {
	for (const section of Object.values(scoreAnalysis(analysis).sections)) {
		const metric = section.metrics.find((m) => m.key === key);
		if (metric) return metric.unmeasurable ? null : metric.grade;
	}
	return null;
}

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8'));

const render = (analysis: Analysis) => renderToStaticMarkup(asWindwalker(createElement(KpiTiles, { analysis })));

/**
 * One tile's markup, found by its label.
 *
 * Case-insensitive on purpose: the labels are upper-cased by CSS, not in the string, so matching the
 * rendered look rather than the source text is what makes this brittle.
 */
function tile(html: string, label: string): string {
	// Split on the tile's opening tag, not on one class inside it: the class list changed when the
	// tiles gained a grade stripe, and a helper keyed to a substring of it silently returned nothing
	// rather than failing, which made every assertion below pass against an empty string.
	const parts = html.split('<div class="border-l-2');
	const needle = label.toLowerCase();
	return parts.find((part) => part.toLowerCase().includes(needle)) ?? '';
}

describe('KPI tiles', () => {
	it('paints each tile with the grade its own metric was given', () => {
		for (const name of ['strong', 'mixed', 'poor']) {
			const analysis = fixture(name);
			const html = render(analysis);
			for (const [label, key] of [
				['GCD used', 'gcdUtilisation'],
				['Casts per minute', 'gcdUtilisation'],
				['Avg brew stacks', 'brewStacks'],
			] as const) {
				const grade = gradeOf(analysis, key);
				expect(tile(html, label), `${name} / ${label}`).toContain(grade === null ? 'text-ink' : TONE[grade]);
			}
		}
	});

	/**
	 * The colours have to actually separate pulls, or they are decoration.
	 *
	 * Asserted across the tiles rather than on one metric, and that is a correction rather than a
	 * loosening. It used to pin `gcdUtilisation` alone, on the strength of `strong` running its globals
	 * at 83.6% against `poor` at 90.2% — opposite sides of the recalibrated bands. Deducting wasted
	 * Tiger Palms from the figure moved `poor` to 78.3% and `mixed` to 79.9%, so all three now sit in
	 * `ok` and that one metric separates nothing. The thresholds were deliberately not re-cut with it:
	 * they came from a 25-kill sample taken before the deduction existed, and re-deriving quartiles
	 * from three fixtures would be worse than an honest stale number.
	 *
	 * The property worth holding is the one the tiles are for — that a reader can tell these three
	 * pulls apart at a glance — and they still can, on the snapshot rate and the brew.
	 */
	it('does not paint every pull the same colour', () => {
		const shapes = ['strong', 'mixed', 'poor'].map((name) => {
			const analysis = fixture(name);
			return (['gcdUtilisation', 'brewStacks', 'snapshotRate', 'rskUptime'] as const)
				.map((key) => gradeOf(analysis, key) ?? 'none')
				.join('/');
		});
		expect(new Set(shapes).size).toBe(3);
	});

	/**
	 * The overall verdict is the one number a reader takes away, so it has to separate the sample even
	 * when an individual metric stops doing so.
	 */
	it('keeps the three reference pulls on three different verdicts', () => {
		const overall = ['strong', 'mixed', 'poor'].map((name) => scoreAnalysis(fixture(name)).overall);
		expect(overall).toEqual(['good', 'ok', 'bad']);
	});

	/**
	 * There is no target DPS, so colouring it would invent a verdict the report never makes. It has
	 * to stay ordinary ink however well the pull went.
	 */
	it('leaves DPS ungraded', () => {
		for (const name of ['strong', 'mixed', 'poor']) {
			const dps = tile(render(fixture(name)), 'DPS');
			expect(dps, `${name} DPS`).toContain('text-ink');
			expect(dps, `${name} DPS`).not.toContain('text-kick');
			expect(dps, `${name} DPS`).not.toContain('text-miss');
		}
	});

	/**
	 * A figure the report cannot measure must not be painted as though it had been.
	 *
	 * The case used to be an add fight, where uptime against a single target was refused rather than
	 * graded. It is not refused any more — uptime follows the enemy being hit, which is fair on an add
	 * fight — so the remaining unmeasurable case is the honest one: a pull Rising Sun Kick was never
	 * pressed in has no uptime to show, and a tile that painted 0% red would be inventing the fault.
	 */
	it('leaves an unmeasurable figure ungraded', () => {
		const analysis = fixture('poor');
		const never: Analysis = { ...analysis, debuff: { ...analysis.debuff, casts: 0 } };
		const rsk = tile(render(never), 'RSK uptime');
		expect(rsk).toContain('text-ink');
		expect(rsk).not.toContain('text-miss');
	});

	/** The cast-rate tile carries its own ceiling, the way the brew tile carries `/10`. */
	it('shows a target beside the cast rate', () => {
		const html = render(fixture('strong'));
		expect(tile(html, 'Casts per minute')).toMatch(/\/\d/);
	});
});
