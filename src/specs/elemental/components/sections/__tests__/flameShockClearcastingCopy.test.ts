// What a credited early Flame Shock refresh says it was worth, and which term it credits — plan §87.
//
// The row used to read "Refreshed early into a dot over 10% stronger — worth the tick" under a section
// whose opening sentence said the dot "keeps whatever spellpower you applied it with". On two of the three
// presses this report credits, spellpower is not what did it: Clearcasting is +20% on the school, the dot
// freezes it at application, and the proc alone is twice the ten per cent the press is credited against.
// A right number with the wrong reason under it is still a reader misled, so the row now names the term.
//
// Three cases, because the wording has three forms and each is a different claim about the pull:
//
//   - **froze it** — this dot carries the proc and the dot it replaced did not, so part of the gain is the
//     proc. `unbroken` at 0:28 and 1:23.
//   - **gave it up** — the dot it replaced carried the proc and this one does not, so the gain is *larger*
//     than it looks on everything else. `unbroken` at 2:20, and the case that proves the figure is not an
//     artefact of the proc.
//   - **neither** — the proc is not a term at all and the sentence stays the one it always was, with the
//     measured size in it. No committed fixture produces this on a credited press, so it is built here
//     rather than left untested: an unreachable-today form still renders the day a pull reaches it, and a
//     missing i18next key renders as its own dotted path in the cell.
//
// The expected sentences are spelled out rather than fetched with a second `t()`, for the reason the
// sibling copy tests give: a test whose two sides both come out of the locale file passes whatever the
// locale file happens to say.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis, ElementalAuditResult, FightDataset, FlameShockPress } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';

import FlameShock from '../FlameShock';

const ELEMENTAL_SPEC = getSpec('elemental')!;

initI18n();

type El = Analysis & ElementalAuditResult;

const unbroken: El = analyse(
	JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../__fixtures__/unbroken.json'), 'utf8')) as FightDataset,
) as El;

const render = (analysis: Analysis) =>
	renderToStaticMarkup(
		createElement(SpecContext.Provider, { value: ELEMENTAL_SPEC }, createElement(FlameShock, { analysis })),
	);

/** The pull's own table, unaltered — every case below that can be read off the log is read off it. */
const html = render(unbroken);

const pressAt = (t: number): FlameShockPress => {
	const press = unbroken.flameShock.presses.find((p) => p.t === t);
	if (press === undefined) throw new Error(`no Flame Shock press at ${t}`);
	return press;
};

/** One press on its own, so a form no committed pull reaches can still be rendered. */
const withOnePress = (press: FlameShockPress): Analysis =>
	({ ...unbroken, flameShock: { ...unbroken.flameShock, presses: [press] } }) as Analysis;

describe('a credited early refresh names the term that made the dot stronger', () => {
	/**
	 * `unbroken` at 28 628: +42.44% as measured, and +18.70% with the proc's +20% divided back out. Both
	 * numbers are in the sentence because only the second one is what the player's timing bought — and
	 * because the first alone, beside a section talking about gear, is the sentence that misled.
	 */
	it('says so where this dot froze the proc and the dot it replaced had not', () => {
		expect(pressAt(28_628).kind).toBe('snapshot');
		expect(html).toContain(
			'Refreshed early into a dot 42.44% stronger, with Clearcasting’s +20% frozen into it — 18.7% stronger without the proc',
		);
		// The second credited press of the same shape, so the case is not one row.
		expect(html).toContain(
			'Refreshed early into a dot 56.15% stronger, with Clearcasting’s +20% frozen into it — 30.13% stronger without the proc',
		);
	});

	/**
	 * `unbroken` at 140 025, the press that gained by giving the proc up: +32.67% as measured while
	 * *losing* +20%, so +59.21% on everything else. Worded as its own sentence because the neutral one
	 * would leave a reader to conclude the proc had helped, when it had been paid for.
	 */
	it('says so the other way round where the dot it replaced was the one with the proc', () => {
		expect(pressAt(140_025).kind).toBe('snapshot');
		expect(pressAt(140_025).snapshotClearcasting).toBe(false);
		expect(html).toContain(
			'Refreshed early into a dot 32.67% stronger even though Clearcasting was up on the dot you replaced and not on this one — 59.21% stronger on everything but the proc',
		);
	});

	/**
	 * And the form for a press the proc explains nothing about: the sentence the row always had, now with
	 * the gain measured instead of described as "over 10%".
	 *
	 * Built rather than found. All three of this repository's credited presses have the proc on one side of
	 * the comparison and not the other, so nothing committed renders this — which is exactly why it is
	 * asserted: an i18next key with no string behind it renders as `flameShock.state.snapshot` in the cell.
	 */
	it('keeps the plain sentence where the proc is not a term either way', () => {
		const neutral: FlameShockPress = {
			...pressAt(28_628),
			snapshotClearcasting: true,
			snapshotDeltaPct: 0.2,
			snapshotDeltaWithoutClearcastingPct: 0.2,
		};
		const cell = render(withOnePress(neutral));
		expect(cell).toContain('Refreshed early into a dot 20% stronger — worth the tick');
		// Neither of the attributing forms, scoped to their own wording: the proc is named in the section's
		// opening sentence and in the note below the table on every pull, so a bare search for the word is
		// no test at all.
		expect(cell).not.toContain('frozen into it');
		expect(cell).not.toContain('even though Clearcasting was up');
		expect(cell).not.toContain('flameShock.state.');
	});

	/**
	 * The section's opening sentence, which is where the wrong reason started: it named spellpower and
	 * nothing else as what a dot freezes.
	 */
	it('opens by naming everything the dot freezes, the proc included', () => {
		expect(html).toContain(
			'the dot freezes everything you had up at the instant you applied it — spellpower, your haste, and Clearcasting’s +20%',
		);
	});

	/**
	 * A press the snapshot rule did not credit keeps its own wording, and this is the guard against the
	 * new interpolation leaking sideways. `unbroken`'s refresh at 112 878 landed on the dot's last tick,
	 * carries a +6.26% reading, and is a `windowed` press — it is excused by the tick that rolled over and
	 * not by a snapshot, so a row claiming a snapshot excuse would be claiming an excuse never used.
	 */
	it('leaves a last-tick refresh saying what it was, not what its snapshot measured — no-change guard', () => {
		expect(pressAt(112_878).kind).toBe('windowed');
		expect(pressAt(112_878).snapshotDeltaPct).toBeCloseTo(0.0626, 3);
		expect(html).toContain('Last-tick refresh');
		expect(html).not.toContain('6.26% stronger');
	});
});
