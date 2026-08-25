// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { initI18n } from '~/lib/i18n/config';
import type { Analysis } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { getSpec } from '~/lib/spec';

import TouchOfKarma from '../TouchOfKarma';

// Every fixture below is a Windwalker pull, so the section is rendered under the Windwalker's own
// scorer and copy. Named rather than left to `SpecContext`'s default, which is the build's pinned
// `DEFAULT_SPEC` — under `PUBLIC_SPEC=elemental` that scored these monk fixtures with the Shaman's
// thresholds.
const WINDWALKER_SPEC = getSpec('windwalker')!;
const asWindwalker = (node: ReactNode): ReactElement =>
	createElement(SpecContext.Provider, { value: WINDWALKER_SPEC }, node);

const i18n = initI18n();
// The label is read from the copy rather than restated, so a rename cannot break an assertion
// whose subject is the tile existing, not the words on it.
const t = i18n.getFixedT('en', 'report');

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8'));

const render = (analysis: Analysis) => renderToStaticMarkup(asWindwalker(createElement(TouchOfKarma, { analysis })));

/**
 * The Iron Juggernaut reference pull with its pool filled in, which the committed fixture predates.
 *
 * Verbatim from `../../../__fixtures__/karmacap.test.ts`, which measures these against the live log:
 * a 677,899 pool off 37,964 stamina, three presses, and the middle one taken between a resto shaman's
 * heals so it had no Ancestral Vigor on it — hence a ceiling of the bare pool where the other two get
 * a tenth more. Written out rather than derived, so a change to how `analyse` computes them shows up
 * as a disagreement between two files instead of moving both at once.
 */
function measured(): Analysis {
	const analysis = structuredClone(fixture('mixed'));
	const absorbed = [382_715, 629_585, 203_636];
	const cap = [745_689, 677_899, 745_689];
	const capPct = [51.3, 92.9, 27.3];
	analysis.karma.capPerUse = 677_899;
	analysis.karma.absorbed = absorbed.reduce((sum, n) => sum + n, 0);
	analysis.karma.exhausted = 0;
	analysis.karma.uses = analysis.karma.uses.map((use, i) => ({
		...use,
		absorbed: absorbed[i] ?? 0,
		cap: cap[i] ?? 0,
		exhausted: false,
		capPct: capPct[i] ?? 0,
	}));
	return analysis;
}

/**
 * The same pull with its last press drained, which no reference pull happens to do at three presses.
 *
 * Needed because "(capped)" and the drained sentence are reachable only from a use that returned
 * everything its pool held, and the one committed pull that does — Garrosh, `strong` — has two
 * presses rather than three. Built off `measured` so only the drained flag differs.
 */
function drained(): Analysis {
	const analysis = measured();
	const uses = analysis.karma.uses.map((use, i) =>
		i === 1 ? { ...use, absorbed: 677_899, exhausted: true, capPct: 100 } : use,
	);
	analysis.karma = {
		...analysis.karma,
		uses,
		exhausted: 1,
		absorbed: uses.reduce((sum, use) => sum + (use.absorbed ?? 0), 0),
	};
	return analysis;
}

/**
 * `a:YBQzrcgVJnAj7NMP` #15, Kor'kron Dark Shaman — the pull the tile was reported wrong on.
 *
 * Two presses in a 245s pull, so three charges the cooldown allowed, and both landed. Neither drained
 * its pool, which used to make the ceiling unknowable and now makes it merely unreached. Figures
 * verbatim from the live assertions in `../../../__fixtures__/karmacap.test.ts`.
 */
function darkShaman(): Analysis {
	const analysis = structuredClone(fixture('mixed'));
	analysis.karma = {
		...analysis.karma,
		casts: 2,
		available: 3,
		reflected: 936_608,
		absorbed: 892_008,
		capPerUse: 677_899,
		exhausted: 0,
		uses: [
			{ t: 20_432, reflected: 198_901, absorbed: 189_430, cap: 677_899, exhausted: false, hits: 6, capPct: 27.9 },
			{ t: 133_923, reflected: 737_707, absorbed: 702_578, cap: 745_689, exhausted: false, hits: 6, capPct: 94.2 },
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

const TONE = { good: 'text-good', ok: 'text-brew', bad: 'text-miss', none: 'text-ink' } as const;

/**
 * The paragraphs the section prints, tags stripped, so a failure quotes the sentence a reader gets
 * rather than four kilobytes of markup. The ceiling summary is always the last of them.
 */
const prose = (html: string): string[] =>
	[...html.matchAll(/<p [^>]*>(.*?)<\/p>/g)].map((match) =>
		(match[1] ?? '')
			.replaceAll(/<[^>]*>/g, '')
			.replaceAll('&#x27;', "'")
			.replaceAll('&amp;', '&')
			.trim(),
	);
const capLine = (html: string): string => prose(html).at(-1) ?? '';

/**
 * `poor`'s three presses with the last one emptied, and nothing else touched.
 *
 * Synthetic, and it has to be: `karmaEmpty` carries a sample floor of three presses now, and no
 * committed capture has three presses *and* an empty one — `strong` and `cleave` have an empty press
 * each and only two presses to put it among. So the pull that colours the tile red is built here,
 * from the one committed pull that clears the floor, by taking the redirect off its last press.
 * One of three is 33%, which is past the metric's `ok` line of 25.
 */
function oneEmptyOfThree(): Analysis {
	const analysis = structuredClone(fixture('poor'));
	const uses = analysis.karma.uses.map((use, i) =>
		i === 2 ? { ...use, reflected: 0, absorbed: 0, exhausted: false, hits: 0, capPct: 0 } : use,
	);
	analysis.karma = { ...analysis.karma, uses, reflected: uses.reduce((sum, use) => sum + use.reflected, 0) };
	return analysis;
}

describe('the Touch of Karma section', () => {
	/**
	 * The case the section still has to handle honestly, and the one that has become rare.
	 *
	 * The pool is computed from `combatantinfo`'s stamina, so a log that reports none can state
	 * nothing — a Mists report old enough to carry no character sheet at all. A dash, a zero or an
	 * estimate would each imply the report knows something it does not.
	 */
	it('says it cannot tell what a use was worth when the log reports no stamina', () => {
		// The pool is stripped rather than a fixture trusted not to have one. Every reference pull states
		// one now, and a test that reached this branch through a capture would be pinning its age.
		const captured = fixture('mixed');
		const unmeasured: Analysis = {
			...captured,
			karma: {
				...captured.karma,
				capPerUse: null,
				uses: captured.karma.uses.map((use) => ({ ...use, cap: null, exhausted: false, capPct: null })),
			},
		};
		const html = render(unmeasured);

		expect(html).toContain('cannot be said on this pull');
		// The column is absent rather than empty, and no share of any ceiling is printed.
		expect(html).not.toContain(t('karma.kpi.ofCap'));
	});

	/** And the ordinary case: the pool is named, and named off the character rather than off the pull. */
	it('states the pool and what the presses left in it', () => {
		const html = render(measured());

		expect(capLine(html)).toContain('677.9k');
		// Each press against its own ceiling, so the total is not one pool times three: two of these three
		// had Ancestral Vigor on them and one did not.
		expect(capLine(html)).toContain('2.2M');
		expect(html).toContain(t('karma.columns.capPct'));
	});

	/**
	 * A press that redirected nothing is a press with a ceiling it never approached, and the arithmetic
	 * has to be able to say so — which is what the old, pull-measured ceiling could not do.
	 */
	it('reads a press well short of its pool as well short of it', () => {
		const html = render(measured());

		// 203,636 of a 745,689 ceiling. Under the old ceiling — the pull's largest absorb, 629,585 — the
		// same press printed 32.3%.
		expect(html).toContain('27.3%');
		expect(html).not.toContain('32.3%');
	});

	/**
	 * The actionable half, and the half that needs no arithmetic: a use that drained its pool returned
	 * everything it could and cannot be faulted, whatever the number beside it.
	 */
	it('marks the use that reached its ceiling', () => {
		const html = render(drained());

		// Twice for one row: `DataGrid` renders the table and the stacked phone cards side by side and
		// hides one of them in CSS, so every cell is in the markup exactly twice.
		expect(html.match(/\(capped\)/g)).toHaveLength(2);
		// Exactly 100%, never 105% — an older reading divided the redirect, which is 1.05× the absorb, by
		// the pool. Nothing in the table may read above its own ceiling.
		expect(html).toContain('100%');
		expect(html).not.toContain('105%');
		expect(capLine(html)).toContain('drained its pool completely');
	});

	/**
	 * The trap the scorer sets for this sentence, and the reason the component does its own arithmetic.
	 *
	 * `metricOf` parks a refused metric's value at nought, and this sentence used to interpolate
	 * `capShare?.value ?? 0` — so a refusal printed the pool, then the damage the presses actually
	 * returned, and then "0% of it". The percentage is a fact about the pull and survives the refusal,
	 * so the component computes it off the presses' own ceilings and never reads the scorer.
	 *
	 * Reached by hand now rather than by a fixture, and that is the shape of the fix rather than a
	 * weakening of the test: every committed capture states a pool, so nothing in the tree refuses this
	 * metric any more. A log reporting no stamina still does.
	 */
	it('still says what the presses returned on a pull whose share the scorer refuses', () => {
		const captured = fixture('strong');
		const noStamina: Analysis = {
			...captured,
			karma: {
				...captured.karma,
				capPerUse: null,
				uses: captured.karma.uses.map((use) => ({ ...use, cap: null, capPct: null, exhausted: false })),
			},
		};

		const html = render(noStamina);

		expect(capLine(html)).toContain('cannot be said on this pull');
		expect(capLine(html)).not.toContain('— 0% of it');
		expect(tile(html, t('karma.kpi.ofCap'))).toBe('');
	});

	/**
	 * One press, and the sentence that stops before a share of the pull.
	 *
	 * A lone press has no pull-level total worth stating — "your 1 uses could have absorbed X between
	 * them" reads as arithmetic performed on nothing — so the pool is named, the press's own share of
	 * it is given, and the row above carries the rest.
	 */
	it('does not spread one press across a pull-level total', () => {
		const captured = fixture('weave');
		expect(captured.karma.casts).toBe(1);
		const analysis: Analysis = {
			...captured,
			karma: {
				...captured.karma,
				capPerUse: 742_145,
				uses: captured.karma.uses.map((use) => ({ ...use, cap: 890_574, capPct: 100 })),
			},
		};

		const html = render(analysis);

		expect(capLine(html)).not.toContain('could have absorbed');
		expect(capLine(html)).toContain('742.1k');
		expect(capLine(html)).toContain('the whole of what happened here');
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
		// The old label is gone entirely; a tile must never be headed by the name of a mistake.
		expect(html).not.toContain('Returned nothing');
		// Uncoloured, and that is the second half of the same fix rather than a loss. This pull took two
		// presses, and `karmaEmpty` is a share over the presses taken, so it is under `MIN_GRADED_SAMPLE`
		// and refused — the tile reads its own metric, so it goes neutral with it. It used to be painted
		// green off a denominator of two.
		expect(landed).toContain(TONE.none);
		expect(landed).not.toContain(TONE.good);

		// And the green half of the claim, on the committed pull that has a sample worth colouring: three
		// presses, all of them landed.
		const clean = tile(render(fixture('poor')), 'Presses that landed');
		expect(clean).toContain('3');
		expect(clean).toContain('/3');
		expect(clean).toContain(TONE.good);
	});

	/**
	 * And the same tile when presses really were empty, so the flip did not just paint everything green.
	 *
	 * On a synthetic pull, and the reason is the finding rather than a convenience: `strong` used to be
	 * the witness here at one empty press of two, and two presses is exactly the sample `karmaEmpty` now
	 * refuses. No committed capture clears the floor with an empty press among its three, so the red half
	 * of this tile is reachable only from a hand edit — see `oneEmptyOfThree`.
	 */
	it('grades the landed count down when a press returned nothing', () => {
		const landed = tile(render(oneEmptyOfThree()), 'Presses that landed');

		expect(landed).toContain('2');
		expect(landed).toContain('/3');
		expect(landed).toContain(TONE.bad);

		// And `strong`, which used to reach it off two presses, no longer does.
		const thin = tile(render(fixture('strong')), 'Presses that landed');
		expect(thin).toContain('1');
		expect(thin).toContain('/2');
		expect(thin).toContain(TONE.none);
	});

	/**
	 * Uses taken carries a tone of its own, on `defensiveUseTone`'s wide bands.
	 *
	 * Two of three is the ordinary shape of a Dark Shaman pull rather than a fault — the charges the
	 * cooldown allows are not all charges the fight offers something to redirect — so it reads amber
	 * and not red. `usageTone`'s 90/70, which the Chi Brew tile uses, would call it a failure.
	 */
	it('tones the uses taken by how many the pull offered', () => {
		expect(tile(render(darkShaman()), 'Uses')).toContain(TONE.ok);
		// Three of three the pull allowed, and two of six.
		expect(tile(render(fixture('poor')), 'Uses')).toContain(TONE.good);
		expect(tile(render(fixture('strong')), 'Uses')).toContain(TONE.bad);
	});
});
