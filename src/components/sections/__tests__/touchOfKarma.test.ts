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

const i18n = initI18n();
// The label is read from the copy rather than restated, so a rename cannot break an assertion
// whose subject is the tile existing, not the words on it.
const t = i18n.getFixedT('en', 'report');

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

/**
 * `a:YBQzrcgVJnAj7NMP` #15, Kor'kron Dark Shaman — the pull the tile was reported wrong on.
 *
 * Two presses in a 245s pull, so three charges the cooldown allowed; both landed, and neither absorb
 * came up short of its blow, so the ceiling is unknowable. Figures verbatim from the live assertions
 * in `lib/__fixtures__/karmacap.test.ts`.
 */
function darkShaman(): Analysis {
	const analysis = structuredClone(fixture('mixed'));
	analysis.karma = {
		...analysis.karma,
		casts: 2,
		available: 3,
		reflected: 936_608,
		absorbed: 892_008,
		capPerUse: null,
		exhausted: 0,
		uses: [
			{ t: 20_432, reflected: 198_901, absorbed: 189_430, exhausted: false, hits: 6, capPct: null },
			{ t: 133_923, reflected: 737_707, absorbed: 702_578, exhausted: false, hits: 6, capPct: null },
		],
	};
	return analysis;
}

/** One tile's markup, found by its label — the same shape `kpiTiles.test.ts` uses. */
function tile(html: string, label: string): string {
	const parts = html.split('<div class="border-l-2');
	const needle = label.toLowerCase();
	return parts.find((part) => part.toLowerCase().includes(needle)) ?? '';
}

const TONE = { good: 'text-kick', ok: 'text-brew', bad: 'text-miss' } as const;

describe('the Touch of Karma section', () => {
	/**
	 * The case the section exists to handle honestly: no use drained its pool, so the ceiling is
	 * unknown and has to be said to be unknown. A dash, a zero or an estimate would each imply the
	 * report knows something it does not.
	 */
	it('says it cannot tell what a use was worth when no use measured the pool', () => {
		// The measurement is stripped rather than a fixture trusted not to have one. Every reference
		// pull now drains a pool on at least one use, which is what re-capturing revealed — and a test
		// that reached this branch only because the captures were old was pinning their age.
		const captured = fixture('mixed');
		const unmeasured: Analysis = {
			...captured,
			karma: {
				...captured.karma,
				capPerUse: null,
				uses: captured.karma.uses.map((use) => ({ ...use, exhausted: false, capPct: null })),
			},
		};
		const html = render(unmeasured);

		expect(html).toContain('cannot be said on this pull');
		// The column is absent rather than empty, and no share of any ceiling is printed.
		expect(html).not.toContain('of cap');
		expect(html).not.toContain(t('karma.kpi.ofCap'));
	});

	/** And the case where it can: the pool is named, and named as measured rather than as supplied. */
	it('states the pool a use demonstrated, and what the presses left in them', () => {
		const html = render(measured());

		expect(html).toContain('drained its pool dry');
		expect(html).toContain('629.6k health');
		expect(html).toContain('of cap');
		expect(html).toContain(t('karma.kpi.ofCap'));
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

	/**
	 * The tile that was reported wrong, on the pull it was reported from.
	 *
	 * It read "0/2 Returned nothing" in green: a label naming a fault, a zero a reader cannot place on
	 * either side of it, and a colour agreeing with neither. The arithmetic was right — neither press
	 * on that pull was empty — so the fix is the tile, which now counts the presses that landed.
	 */
	it('states the presses that landed rather than a zero count of a fault', () => {
		const html = render(darkShaman());
		const landed = tile(html, 'Presses that landed');

		expect(landed).toContain('2');
		expect(landed).toContain('/2');
		expect(landed).toContain(TONE.good);
		// The old label is gone entirely; a green tile must never be headed by the name of a mistake.
		expect(html).not.toContain('Returned nothing');
	});

	/**
	 * And the same tile when presses really were empty, so the flip did not just paint everything green.
	 */
	it('grades the landed count down when a press returned nothing', () => {
		const landed = tile(render(fixture('strong')), 'Presses that landed');

		expect(landed).toContain('1');
		expect(landed).toContain('/2');
		expect(landed).toContain(TONE.bad);
	});

	/**
	 * Uses taken carries a tone of its own, on `defensiveUseTone`'s wide bands.
	 *
	 * Two of three is the ordinary shape of a Dark Shaman pull rather than a fault — the charges the
	 * cooldown allows are not all charges the fight offers something to redirect — so it reads amber
	 * and not red. `usageTone`'s 90/70, which the Chi Brew tile uses, would call it a failure.
	 */
	it('tones the uses taken by how many the pull offered', () => {
		expect(tile(render(darkShaman()), 'Uses taken')).toContain(TONE.ok);
		// Three of three the pull allowed, and two of six.
		expect(tile(render(fixture('poor')), 'Uses taken')).toContain(TONE.good);
		expect(tile(render(fixture('strong')), 'Uses taken')).toContain(TONE.bad);
	});
});
