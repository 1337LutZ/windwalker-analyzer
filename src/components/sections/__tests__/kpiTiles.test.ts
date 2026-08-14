import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Analysis } from '~/lib/types';

import { scoreAnalysis } from '~/lib/score';

import KpiTiles from '../KpiTiles';

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
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../lib/__fixtures__/${name}.json`), 'utf8'));

const render = (analysis: Analysis) => renderToStaticMarkup(createElement(KpiTiles, { analysis }));

/**
 * One tile's markup, found by its label.
 *
 * Case-insensitive on purpose: the labels are upper-cased by CSS, not in the string, so matching the
 * rendered look rather than the source text is what makes this brittle.
 */
function tile(html: string, label: string): string {
	const parts = html.split('<div class="bg-surface');
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
	 * The colours have to actually separate pulls, or they are decoration. `strong` runs its globals
	 * at 83.6% and `poor` at 90.2% — the recalibrated thresholds put those on opposite sides, which is
	 * the whole point of having recalibrated them.
	 */
	it('does not paint every pull the same colour', () => {
		const tones = ['strong', 'mixed', 'poor'].map((name) => {
			const grade = gradeOf(fixture(name), 'gcdUtilisation');
			return grade === null ? 'none' : grade;
		});
		expect(new Set(tones).size).toBeGreaterThan(1);
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
