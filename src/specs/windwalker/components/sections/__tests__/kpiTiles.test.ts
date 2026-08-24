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

const TONE = { good: 'text-good', ok: 'text-brew', bad: 'text-miss' } as const;

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

/** Every committed Windwalker capture, so a tile's colour is read against the whole calibration set. */
const PULLS = ['strong', 'mixed', 'cleave', 'waves', 'weave', 'poor'] as const;

/**
 * What colour a tile's number is drawn in, in words rather than as a class name.
 *
 * The failure of a colour assertion has to be readable as the page, or the diff is two Tailwind classes
 * and the reader has to go and look up which one meant which verdict.
 */
const HUE: Record<string, string> = {
	'text-good': 'the good colour',
	'text-brew': 'the middling colour',
	'text-miss': 'the bad colour',
	'text-ink': 'plain ink',
};

/**
 * Better is larger, so a contradiction is a bigger number wearing a smaller rank.
 *
 * Plain ink is deliberately absent rather than ranked between the two verdicts it is not. An
 * uncoloured tile makes no claim, so it cannot contradict one, and giving it a rank would invent
 * comparisons in both directions against tiles that do. What stops that from hollowing the assertion
 * out is the test above, which pins every one of these six tiles as ink in the first place.
 */
const RANK: Record<string, number> = {
	'the bad colour': 0,
	'the middling colour': 1,
	'the good colour': 2,
};

/** The rank of a tile that is not claiming anything, and the one value the comparison drops. */
const NO_CLAIM = -1;

const hue = (html: string): string =>
	Object.entries(HUE).find(([cls]) => html.includes(cls))?.[1] ?? 'no colour at all';

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
			expect(dps, `${name} DPS`).not.toContain('text-good');
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

	/**
	 * The snapshot tile draws a number no rule in the spec grades, so it has to stay ordinary ink.
	 *
	 * **What the tile shows is neither of the two figures the snapshots section grades.** The value is
	 * `procs.lastGcd` over `procs.procs` — the procs held inside the leeway window, against every proc
	 * that fired. `snapshotRate` divides `snapshotted` by `opportunities` and `snapshotDepth` averages a
	 * depth over `snapshotted`, so on `poor` the three read 1/9, 2/8 and 86.13% and no two of them are
	 * the same question. A grade from either metric is therefore the RSK tile's old fault in a second
	 * place: a tile wearing the verdict of a number it is not displaying.
	 *
	 * It wore `snapshotDepth`'s, which is the one that also runs backwards — the mean is taken over the
	 * procs that were caught, so the sibling metric selects its denominator. The lines below are what
	 * that put on the page.
	 */
	/**
	 * The denominator, read off the page rather than rebuilt from the same field.
	 *
	 * The case below pins the tile's hue and states the fraction in its message — but both sides of that
	 * comparison come from `procs.procs`, so it cannot see the denominator change and did not: this tile
	 * divided by every proc that fired while the section beneath it divides by `opportunities`, and the
	 * page carried `/16` directly above a sentence reading "12 of 14 catchable". On all six pulls: 9v8,
	 * 16v14, 7v6, 6v5, 8v6, 5v4.
	 *
	 * So this reads the rendered fraction out of the HTML and holds it against the figure the section
	 * argues for, which is the only way the two can be shown to agree. The subset that makes it sound is
	 * asserted beside it: `couldSnapshot` is true whenever a proc was snapshotted, and a proc graded
	 * `last-gcd` was snapshotted, so the numerator is always inside the denominator.
	 */
	it('divides by the procs the section says are buyable, not by every proc that fired', () => {
		const drawn = PULLS.map((name) => {
			const { procs } = fixture(name);
			const html = tile(render(fixture(name)), 'RoRo snapshots');
			const shown = /(\d+)\s*<[^>]*>\s*\/(\d+)/.exec(html.replaceAll(/<\/?b[^>]*>/g, ''));
			const fraction =
				shown === null
					? html
							.replaceAll(/<[^>]+>/g, ' ')
							.replaceAll(/\s+/g, ' ')
							.trim()
					: `${shown[1]}/${shown[2]}`;
			return { name, fraction, procs };
		});
		// Every pull's drawn fraction is the leeway count over the buyable procs — never over `procs`.
		expect(drawn.map((d) => `${d.name} ${d.fraction}`)).toEqual(
			drawn.map((d) => `${d.name} ${d.procs.lastGcd}/${d.procs.opportunities}`),
		);
		// And the denominators really do differ, so the line above is not two names for one number.
		expect(drawn.filter((d) => d.procs.opportunities !== d.procs.procs).length).toBeGreaterThan(3);
		// Sound by construction, not only on these six.
		for (const d of drawn) expect(d.procs.lastGcd, d.name).toBeLessThanOrEqual(d.procs.opportunities);
	});

	it('leaves the snapshot tile ungraded on every committed pull', () => {
		const painted = PULLS.map((name) => {
			const analysis = fixture(name);
			const html = tile(render(analysis), 'RoRo snapshots');
			return `${name}: ${analysis.procs.lastGcd}/${analysis.procs.procs} held to the last global, drawn in ${hue(html)}`;
		});
		expect(painted.join('\n')).toBe(
			PULLS.map((name) => {
				const { procs } = fixture(name);
				return `${name}: ${procs.lastGcd}/${procs.procs} held to the last global, drawn in plain ink`;
			}).join('\n'),
		);
	});

	/**
	 * The property the tint failed, stated over the number the tile actually draws.
	 *
	 * A tile's colour is the report's verdict vocabulary, so a larger share of procs held to the last
	 * global must never be painted worse than a smaller one. Plain ink passes this trivially and that is
	 * the point of leaving it: the assertion is here to refuse the next tint as much as the last one.
	 *
	 * It refuses more than `snapshotDepth`. `snapshotRate` is the obvious substitute — it orders `poor`
	 * and `strong` the right way round, which is exactly why it looks like the answer — and it fails
	 * here too, because it is a share over `opportunities` rather than over what is drawn: `waves` holds
	 * 1 of 8 and grades `good` on the rate, `mixed` holds 1 of 7, the larger share, and grades `ok`. The
	 * section letter is `snapshotRate`'s alone, depth being secondary, so it fails as the same tint.
	 */
	it('never paints a larger share of procs held to the last global worse than a smaller one', () => {
		const claims = PULLS.map((name) => {
			const { procs } = fixture(name);
			return {
				line: `${name} held ${procs.lastGcd} of ${procs.procs}`,
				share: procs.procs > 0 ? procs.lastGcd / procs.procs : 0,
				rank: RANK[hue(tile(render(fixture(name)), 'RoRo snapshots'))] ?? NO_CLAIM,
			};
		}).filter((claim) => claim.rank !== NO_CLAIM);
		const contradictions = claims.flatMap((a) =>
			claims
				.filter((b) => a.share > b.share && a.rank < b.rank)
				.map((b) => `${a.line} and is painted worse than ${b.line}`),
		);
		expect(contradictions).toEqual([]);
	});

	/** The cast-rate tile carries its own ceiling, the way the brew tile carries `/10`. */
	it('shows a target beside the cast rate', () => {
		const html = render(fixture('strong'));
		expect(tile(html, 'Casts per minute')).toMatch(/\/\d/);
	});
});
