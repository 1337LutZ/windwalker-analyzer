// The Stormlash table the user asked for, and the two things it must not say.
//
// Plan §80 rule 6: *"Stormlash should ideally not be cast during Ascendance (can add as improvement in
// the Stormlash section as a row in the table (doesnt exist yet, similar to Flame Shock usage label))"*.
// The table did not exist, so it is part of the work; the reading it asks and why is argued in
// `lib/__tests__/stormlash.test.ts` and on the audit field itself.
//
// This file is the rendered half, and it exists because of what §93 found: the section's own tiles and
// chart read `stormlash.shamans`, which is **empty on every committed fixture** — it comes off a
// separate raid-wide placement fetch none of them carries. A table built off that source would have
// rendered nothing on every pull we hold while looking finished, so the table reads `received` instead
// and the section says out loud that the two are different questions. Both halves are pinned here:
// four rows in the table, and the sentence that stops a reader trying to reconcile them with a tile
// reading zero.
//
// Two negatives are asserted as well, because they are the ways this row could mislead:
//
//   1. **No row claims a press that was not made.** On all three pulls the answer is "not during
//      Ascendance", and the rendered cell has to say that rather than the overlap the totem really did
//      have — `phased`s own totem ran for 7 136ms inside the opener.
//   2. **No warn band anywhere.** §80's own box says a reader cannot tell a hard rule from a preference
//      by looking at a red cell, and this one is a preference. `Flame Shock`s table paints `bg-band-warn`
//      on a faulted row; this table paints it on none.
//
// Literals rather than a second `t()` call, for the reason every copy test here gives: a test whose two
// sides both come out of the locale file passes whatever the locale file happens to say.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';

import Stormlash from '../Stormlash';

const ELEMENTAL_SPEC = getSpec('elemental')!;

initI18n();

type El = Analysis & ElementalAuditResult;

const fx = (name: string): El =>
	analyse(
		JSON.parse(
			readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8'),
		) as FightDataset,
	) as El;

const render = (analysis: Analysis): string =>
	renderToStaticMarkup(
		createElement(SpecContext.Provider, { value: ELEMENTAL_SPEC }, createElement(Stormlash, { analysis })),
	);

describe('the table, on the pulls whose placement fetch is missing', () => {
	const html = render(fx('cleave'));

	it('draws a row per totem that reached the player, off the populated source', () => {
		// Four totems on `cleave`, and the player's own is one of them. `stormlash.totems` is 0 on this
		// pull — the tiles above are reading the placements — so a table built off that would be empty
		// here, which is the whole reason `received` exists.
		expect(fx('cleave').stormlash.totems).toBe(0);
		expect(html).toContain('laid by');
		expect(html).toContain('Yours, laid outside Ascendance');
		// The player named in the first person and the raid-mates by whatever the actor list could give,
		// which on an anonymous report is `Player (n)`.
		expect(html).toContain('>You<');
		expect(html).toContain('Player (3)');
	});

	it('explains why the tiles above read zero while the table has rows', () => {
		// The apostrophe in "the raid's" renders escaped, so the assertion starts after it rather than
		// pinning an HTML entity.
		expect(html).toContain('totem placements, which come from a separate fetch this pull does not carry');
	});

	it('says the preference is a preference, not a requirement', () => {
		expect(html).toContain('Treat this as a preference rather than a requirement');
	});
});

describe('what the rendered rows refuse to say', () => {
	/**
	 * `phased`s own totem overlaps the opener by 7 136 of its 9 714ms, and the press was 3 385ms before
	 * the Ascendance press. So the cell says the press was outside the window, and nothing in the
	 * rendered section claims otherwise.
	 */
	it('never claims a press was made during Ascendance on a pull where none was', () => {
		for (const name of ['phased', 'unbroken', 'cleave']) {
			const html = render(fx(name));
			expect(html, name).toContain('Yours, laid outside Ascendance');
			expect(html, name).not.toContain('laid during Ascendance');
		}
	});

	/**
	 * No band on any row of any committed pull — see the header.
	 *
	 * **Deliberately not a red against the old section**, and one of only two here: the old section had
	 * no table, so it painted no band either. Its value is as a guard on the next change — the obvious
	 * way to make this row visible is `band: 'warn'`, and §80's box says that is exactly what a
	 * preference must not be given.
	 */
	it('paints no fault band', () => {
		for (const name of ['phased', 'unbroken', 'cleave']) {
			expect(render(fx(name)), name).not.toContain('bg-band-warn');
		}
	});
});

describe('the row rule 6 can fire, rendered', () => {
	/**
	 * The audit field forced to `true` on one row, which is the only thing the component branches on.
	 * The arithmetic that decides it is `lib/__tests__/stormlash.test.ts`; what is asserted here is that
	 * a `true` reaches the reader as the user's own hedge and not as a fault.
	 */
	const forced = (): string => {
		const cleave = fx('cleave');
		const received = (cleave.stormlash.received ?? []).map((row) =>
			row.source.own ? { ...row, duringAscendance: true } : row,
		);
		return render({ ...cleave, stormlash: { ...cleave.stormlash, received } } as Analysis);
	};

	it('prints the hedge and names the button the global was wanted on', () => {
		const html = forced();
		expect(html).toContain('Yours, and laid during Ascendance — ideally that global goes to Lava Beam instead');
		expect(html).not.toContain('Yours, laid outside Ascendance');
	});

	// Also not a red — the second and last of them, for the same reason as the guard above.
	it('still paints no band, so it cannot be read as a fault', () => {
		expect(forced()).not.toContain('bg-band-warn');
	});
});
