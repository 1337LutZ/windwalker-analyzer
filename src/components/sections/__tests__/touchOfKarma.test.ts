// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { initI18n } from '~/lib/i18n/config';
import type { Analysis } from '~/lib/types';

import TouchOfKarma from '../TouchOfKarma';

initI18n();

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../lib/__fixtures__/${name}.json`), 'utf8'));

const render = (analysis: Analysis) => renderToStaticMarkup(createElement(TouchOfKarma, { analysis }));

/**
 * The Iron Juggernaut reference pull with its absorbs filled in, which the committed fixture predates.
 *
 * Verbatim from `lib/__fixtures__/karmacap.test.ts`, which measures these against the live log: three
 * presses, the middle one drained its pool at 629,585, and the other two returned 60.8% and 32.3% of
 * that. Written out rather than derived, so a change to how `analyse` computes them shows up as a
 * disagreement between two files instead of moving both at once.
 */
function measured(): Analysis {
	const analysis = structuredClone(fixture('mixed'));
	const absorbed = [382_715, 629_585, 203_636];
	const exhausted = [false, true, false];
	const capPct = [60.8, 100, 32.3];
	analysis.karma.capPerUse = 629_585;
	analysis.karma.absorbed = absorbed.reduce((sum, n) => sum + n, 0);
	analysis.karma.exhausted = 1;
	analysis.karma.uses = analysis.karma.uses.map((use, i) => ({
		...use,
		absorbed: absorbed[i] ?? 0,
		exhausted: exhausted[i] ?? false,
		capPct: capPct[i] ?? 0,
	}));
	return analysis;
}

describe('the Touch of Karma section', () => {
	/**
	 * The case the section exists to handle honestly: no use drained its pool, so the ceiling is
	 * unknown and has to be said to be unknown. A dash, a zero or an estimate would each imply the
	 * report knows something it does not.
	 */
	it('says it cannot tell what a use was worth when no use measured the pool', () => {
		const html = render(fixture('mixed'));

		expect(html).toContain('cannot be said on this pull');
		// The column is absent rather than empty, and no share of any ceiling is printed.
		expect(html).not.toContain('of cap');
		expect(html).not.toContain('Of what it could');
	});

	/** And the case where it can: the pool is named, and named as measured rather than as supplied. */
	it('states the pool a use demonstrated, and what the presses left in them', () => {
		const html = render(measured());

		expect(html).toContain('drained its pool dry');
		expect(html).toContain('629.6k health');
		expect(html).toContain('of cap');
		expect(html).toContain('Of what it could');
	});

	/**
	 * The actionable half, and the half that needs no arithmetic: a use that drained its pool returned
	 * everything it could and cannot be faulted, whatever the number beside it.
	 */
	it('marks the use that reached its ceiling', () => {
		const html = render(measured());

		// Twice for one row: `DataGrid` renders the table and the stacked phone cards side by side and
		// hides one of them in CSS, so every cell is in the markup exactly twice.
		expect(html.match(/\(capped\)/g)).toHaveLength(2);
		// Exactly 100%, never 105% — the bug this replaced divided the redirect, which is 1.05× the
		// absorb, by the pool. Nothing in the table may read above its own ceiling.
		expect(html).toContain('100%');
		expect(html).not.toContain('105%');
	});

	/** A press that returned nothing is counted in words, not only banded in the table. */
	it('names the presses that redirected nothing', () => {
		expect(render(fixture('strong'))).toContain('One press redirected nothing at all');
		expect(render(fixture('poor'))).not.toContain('redirected nothing at all');
	});
});
