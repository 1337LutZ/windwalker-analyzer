// The Stormlash table the user asked for, and the two things it must not say.
//
// Plan §80 rule 6: *"Stormlash should ideally not be cast during Ascendance (can add as improvement in
// the Stormlash section as a row in the table (doesnt exist yet, similar to Flame Shock usage label))"*.
// The table did not exist, so it is part of the work; the reading it asks and why is argued in
// `lib/__tests__/stormlash.test.ts` and on the audit field itself.
//
// This file is the rendered half, and it exists because of what §93 found: the section's own tiles and
// chart read `stormlash.shamans`, which comes off a separate raid-wide placement fetch. §93 recorded it
// as **empty on every committed fixture** — true of the three then committed, and false since
// `addsThenBoss.json` landed carrying 5 shamans and 10 placements. A table built off that source would
// still have rendered nothing on three pulls in four while looking finished, so the table reads
// `received` instead and the section says out loud that the two are different questions. All of it is
// pinned below over the discovered fixture set: rows in the table on every pull, the tile agreeing with
// the fetch's presence rather than with a file name, and the sentence that stops a reader reconciling a
// zero tile with a populated table appearing on exactly the pulls whose tile is zero.
//
// Two negatives are asserted as well, because they are the ways this row could mislead:
//
//   1. **No row claims a press that was not made.** On every committed pull the answer is "not during
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

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { rawFixtures } from '~/lib/analysis/fixtures';
import { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';

import Stormlash from '../Stormlash';

const ELEMENTAL_SPEC = getSpec('elemental')!;

initI18n();

type El = Analysis & ElementalAuditResult;

/**
 * Every raw Elemental pull, found rather than listed, and the analysis memoised.
 *
 * The two negatives below were each written "on all three pulls" and each spelled
 * `['phased', 'unbroken', 'cleave']`, so neither had been asked of `addsThenBoss` — the one committed
 * pull with other shamans' Stormlash on it, which is the source the header says every fixture lacks.
 */
const FIXTURES: string[] = rawFixtures('elemental').map(({ name }) => name.replace(/\.json$/, ''));

const analysed = new Map<string, El>();
const fx = (name: string): El => {
	const hit = analysed.get(name);
	if (hit !== undefined) return hit;
	const found = rawFixtures('elemental').find((fixture) => fixture.name === `${name}.json`);
	if (found === undefined) throw new Error(`no raw Elemental fixture ${name}`);
	const el = analyse(found.dataset) as El;
	analysed.set(name, el);
	return el;
};

const render = (analysis: Analysis): string =>
	renderToStaticMarkup(
		createElement(SpecContext.Provider, { value: ELEMENTAL_SPEC }, createElement(Stormlash, { analysis })),
	);

describe('the table, on the pulls whose placement fetch is missing', () => {
	const html = render(fx('cleave'));

	/**
	 * **The premise the whole file rests on — and it is no longer true of every pull.**
	 *
	 * The header says `stormlash.shamans` is "empty on every committed fixture", and that that is why the
	 * table reads `received` instead. It was a sentence about three files, nothing checked it, and
	 * `addsThenBoss.json` broke it: that pull *does* carry the raid-wide placement fetch — **5 shamans, 10
	 * placements** — so `stormlash.totems` reads 10 there where it reads 0 on the other three.
	 *
	 * The component is right about it, which is the good half: it prints the "separate fetch this pull does
	 * not carry" line only where the fetch really is missing, and `addsThenBoss` gets no such sentence. But
	 * nothing asserted either branch, so the report had been silently exercising a code path no test had
	 * ever rendered. Both are pinned below and the partition is derived, so a fifth pull picks a side.
	 *
	 * `received` must be populated on every pull either way, or the table the negatives further down are
	 * asserted against is empty and they pass for want of rows.
	 */
	it('reads the placement fetch where there is one and says so only where there is not', () => {
		expect(Object.fromEntries(FIXTURES.map((name) => [name, fx(name).stormlash.shamans.length]))).toEqual({
			addsThenBoss: 5,
			cleave: 0,
			phased: 0,
			unbroken: 0,
		});
		// The tiles' own source agrees with the fetch's presence rather than with a file name.
		for (const name of FIXTURES) {
			const { stormlash } = fx(name);
			expect(stormlash.totems > 0, `${name} totems`).toBe(stormlash.shamans.length > 0);
		}
		expect(Object.fromEntries(FIXTURES.map((name) => [name, fx(name).stormlash.totems]))).toEqual({
			addsThenBoss: 10,
			cleave: 0,
			phased: 0,
			unbroken: 0,
		});

		// Rows to draw on every pull, so nothing below is vacuous.
		expect(Object.fromEntries(FIXTURES.map((name) => [name, (fx(name).stormlash.received ?? []).length]))).toEqual({
			addsThenBoss: 10,
			cleave: 4,
			phased: 2,
			unbroken: 4,
		});
		for (const name of FIXTURES) expect(render(fx(name)), `${name} rows`).toContain('laid by');

		// And the sentence that reconciles a zero tile with a populated table appears on exactly the pulls
		// whose tile is zero — gated on the fetch, not on a list of names.
		for (const name of FIXTURES) {
			const missing = fx(name).stormlash.shamans.length === 0;
			expect(
				render(fx(name)).includes(
					'where the raid laid its totems, which comes from a separate fetch this pull does not carry',
				),
				`${name} explains the zero`,
			).toBe(missing);
		}
	});

	it('draws a row per totem that reached the player, off the populated source', () => {
		// Four totems on `cleave`, and the player's own is one of them. `stormlash.totems` is 0 on this
		// pull — the tiles above are reading the placements — so a table built off that would be empty
		// here, which is the whole reason `received` exists.
		expect(fx('cleave').stormlash.totems).toBe(0);
		expect(html).toContain('laid by');
		expect(html).toContain('Yours, outside Ascendance');
		// The player named in the first person and the raid-mates by whatever the actor list could give,
		// which on an anonymous report is `Player (n)`.
		expect(html).toContain('>You<');
		expect(html).toContain('Player (3)');
	});

	it('explains why the tiles above read zero while the table has rows', () => {
		// `placements` was a nominalization inside a sentence, which `docs/conventions.md` rules out where a
		// verb will do — the label exemption covers a table cell and a tile, not this. The clause is quoted
		// from its verb on, which also keeps the assertion clear of the escaped apostrophe it used to dodge.
		expect(html).toContain(
			'where the raid laid its totems, which comes from a separate fetch this pull does not carry',
		);
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
		for (const name of FIXTURES) {
			const html = render(fx(name));
			expect(html, name).toContain('Yours, outside Ascendance');
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
		for (const name of FIXTURES) {
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
		expect(html).toContain('Laid during Ascendance, Lava Beam wants that global');
		expect(html).not.toContain('Yours, outside Ascendance');
	});

	// Also not a red — the second and last of them, for the same reason as the guard above.
	it('still paints no band, so it cannot be read as a fault', () => {
		expect(forced()).not.toContain('bg-band-warn');
	});
});
