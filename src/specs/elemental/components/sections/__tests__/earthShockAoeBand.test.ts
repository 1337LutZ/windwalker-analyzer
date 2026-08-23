// What the Earth Shock section shows once the aoe presses leave its denominator.
//
// The grading change is measured in `lib/__tests__/earthShockAoeBand.test.ts`; this is the reader's half
// of it, and it exists because a fraction that quietly shrinks is worse than the wrong fraction. A reader
// who counts twelve shocks on the timeline and reads "4 / 7" in the tile has been handed a number they
// cannot reconstruct, so the pulls with exempt presses say how many there were and why nothing judged
// them.
//
// The other half is negative and matters as much: the ledger below the tile is a fault table, and an
// unjudged press must not appear in it. `good` is nullable now, so the old `!press.good` filter would have
// put all five of `cleave`'s exempt presses in the table with an empty reason cell — a row accusing the
// player of nothing in particular.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { formatClock } from '~/lib/format';
import { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';

import EarthShock from '../EarthShock';

const ELEMENTAL_SPEC = getSpec('elemental')!;

initI18n();

type El = Analysis & ElementalAuditResult;

const analysed = (name: string): El =>
	analyse(
		JSON.parse(
			readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8'),
		) as FightDataset,
	) as El;

const render = (analysis: Analysis) =>
	renderToStaticMarkup(
		createElement(SpecContext.Provider, { value: ELEMENTAL_SPEC }, createElement(EarthShock, { analysis })),
	);

const cleave = analysed('cleave');
const unbroken = analysed('unbroken');

describe('the section counts only the presses a list had a rule for', () => {
	/**
	 * `cleave`: twelve shocks, seven of them under a list with an Earth Shock rule, four of those seven
	 * the rule wanted. The tile reads the judged fraction, and the verdict sentence beside it has to read
	 * the same denominator or the section disagrees with itself in two adjacent paragraphs.
	 */
	it('shows the judged fraction in the tile and the same one in the verdict', () => {
		expect([cleave.earthShock.presses.length, cleave.earthShock.judged, cleave.earthShock.good]).toEqual([12, 7, 4]);
		const html = render(cleave);
		// The tile's own markup: the value and its suffix, so this cannot pass on a `/7` appearing anywhere
		// else in the section.
		expect(html).toContain('>4<em class="text-sm not-italic text-muted sm:text-base">/7</em>');
		expect(html).not.toContain('/12');
		// Reworded when `readerVoice.test.ts`'s sweep grew to see `verdict_*` keys: "matched the rule the list
		// had for them" named our own model at a reader. The fraction is what this case is about and is
		// unchanged.
		expect(html).toContain('4 of 7 shocks were spent with the shield charged up');
	});

	/** And the five it is not counting, named as a count with the reason nothing judged them. */
	it('says how many shocks it is not judging, and why', () => {
		expect(render(cleave)).toContain(
			'5 more shocks went out while three or more enemies were up, and they are not in the count above. At that many targets the priority list has no Earth Shock in it at all',
		);
	});

	/**
	 * The negative half: an unjudged press is not a row in the fault ledger. Every row the table draws has
	 * a reason in it, and `cleave` is the pull that can fail this — its five exempt presses would all have
	 * landed in the table under a truthiness filter.
	 */
	it('keeps the unjudged presses out of the fault table', () => {
		const html = render(cleave);
		// The table draws one row per faulted press and no more: three of `cleave`'s seven judged presses.
		expect(cleave.earthShock.presses.filter((p) => p.good === false)).toHaveLength(3);
		expect(html.split('<tr><th scope="row"').length - 1).toBe(3);
		// And none of the five exempt presses is one of those rows, checked by the clock the row would
		// print. `1:24` and the rest are absent from the whole section, not merely from the table.
		for (const press of cleave.earthShock.presses.filter((p) => p.good === null))
			expect(html, `${press.t}`).not.toContain(`>${formatClock(press.t)}<`);
		// The clocks of the three that *are* faulted, so the check above is not passing on a formatting
		// mismatch that would hide every press equally.
		for (const press of cleave.earthShock.presses.filter((p) => p.good === false))
			expect(html, `${press.t}`).toContain(`>${formatClock(press.t)}<`);
	});

	/**
	 * A pull that never leaves single target has nothing exempt, so it must not carry the sentence at all
	 * — a note that appears on every pull tells a reader nothing about this one.
	 */
	it('says nothing about aoe presses on a pull that had none', () => {
		expect(unbroken.earthShock.presses.length).toBe(unbroken.earthShock.judged);
		const html = render(unbroken);
		expect(html).not.toContain('three or more enemies were up');
		expect(html).not.toContain('earthShock.aoeUnjudged');
		// And its own fraction is still over every press it made, because every one of them was judged.
		expect(html).toContain('>5<em class="text-sm not-italic text-muted sm:text-base">/13</em>');
	});
});
