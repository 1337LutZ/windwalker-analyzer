// The two Elemental strings the reader-voice complaint named, asserted rather than agreed to.
//
// This is the third time the same complaint has been made about the same strings: the copy describes
// our model instead of the player's pull. `6818cdf` rewrote a batch of them and moved two from one
// abstraction to another — `ascendance.state.plain` went from "No rule" to "…pressed on the clock
// alone", and `elementalMastery.state.plain` to "…pressed while Ascendance was still coming back".
// Both sentences are about the audit's own branch structure. A player reading a red cell needs the
// buttons to press together, not the name of the arm they failed.
//
// It took two guards, because they fail in different ways, and **the first of them no longer lives
// here**: the locale sweep moved to `src/specs/__tests__/readerVoice.test.ts` when it was extended to
// the Windwalker's fifteen sections. Being filed under `specs/elemental` was not incidental to that
// sweep — its section list named Elemental roots and nothing else, so every Windwalker string in
// `report.json` went unread. One list of banned words, two spec scopes, above both.
//
// What stays is the second guard: literal render assertions on the two strings the complaint named, so
// the sweep cannot be satisfied by copy that avoids the banned words and still says nothing actionable.
//
// The literals are spelled out here rather than fetched with a second `t()` call, for the reason the
// sibling copy tests give: a test whose two sides both come out of the locale file passes whatever the
// locale file happens to say.
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

import Ascendance from '../Ascendance';
import ElementalMastery from '../ElementalMastery';

const ELEMENTAL_SPEC = getSpec('elemental')!;

initI18n();

type El = Analysis & ElementalAuditResult;

const unbroken: El = analyse(
	JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../__fixtures__/unbroken.json'), 'utf8')) as FightDataset,
) as El;

const render = (Component: (props: { analysis: Analysis }) => unknown, analysis: Analysis) =>
	renderToStaticMarkup(
		createElement(SpecContext.Provider, { value: ELEMENTAL_SPEC }, createElement(Component as never, { analysis })),
	);

describe('the two cooldown states the complaint named', () => {
	/** A press that is neither the opener nor a two-piece press — the cell that said "on the clock alone". */
	it('tells an unpaired Ascendance which buttons to line it up with', () => {
		const press = unbroken.ascendance.presses[0]!;
		const html = render(Ascendance, {
			...unbroken,
			ascendance: { ...unbroken.ascendance, presses: [{ ...press, opener: false, twoPiece: false }] },
		} as Analysis);
		expect(html).toContain('Pressed outside the opener with no tier-16 proc up, save it for one of those');
	});

	/** `reason: null` — the cell that said "pressed while Ascendance was still coming back". */
	it('tells an unpaired Elemental Mastery to hold the haste for Ascendance', () => {
		const html = render(ElementalMastery, {
			...unbroken,
			elementalMastery: { presses: [{ t: 60_000, reason: null }], talented: true },
		} as Analysis);
		expect(html).toContain(
			'Pressed with Ascendance on cooldown and not far enough out to spend on its own. Hold the haste for Ascendance',
		);
	});

	/**
	 * The permissive arm, and it is now **two** arms because one label could not be honest.
	 *
	 * `off` was `!t15Active && (ascReady >= 85 || ascReady < 4)`: Ascendance a minute and a half away, or
	 * Ascendance about to come up. Both are allowed and for opposite reasons, so a single sentence had to
	 * be vague to stay true — the neutral wording this file shipped in `51acbc6` was the symptom rather
	 * than the fix. Each arm now names the gap, off `ascReadySec`, which is the same number the branch
	 * classified on and so cannot disagree with it.
	 */
	it('tells a press near Ascendance why it is fine, with the gap in the sentence', () => {
		const html = render(ElementalMastery, {
			...unbroken,
			elementalMastery: { presses: [{ t: 60_000, reason: 'off-near', ascReadySec: 3 }], talented: true },
		} as Analysis);
		expect(html).toContain('Pressed with Ascendance 3s out, it comes back inside the haste, so the two overlap anyway');
	});

	it('tells a press far from Ascendance the opposite reason, and neither reads as a fault', () => {
		const html = render(ElementalMastery, {
			...unbroken,
			elementalMastery: { presses: [{ t: 60_000, reason: 'off-far', ascReadySec: 120 }], talented: true },
		} as Analysis);
		expect(html).toContain(
			'Pressed with Ascendance 120s away, far too long to hold a ninety-second cooldown for, so spending it now is right',
		);
	});

	/**
	 * The stranded-key check `report.json` has no guard for. i18next renders a missing key as the key
	 * itself, so a `state.off` left behind — or an arm whose copy was never written — shows up here as
	 * literal dotted text in the table rather than as a blank nobody would notice. This caught the real
	 * thing: the rename went red with `elementalMastery.state.off` printed in the cell.
	 */
	it('has copy for every Elemental Mastery arm, none falling through to its key', () => {
		for (const reason of ['opener', 'sync', 't15', 'off-near', 'off-far'] as const) {
			const html = render(ElementalMastery, {
				...unbroken,
				elementalMastery: { presses: [{ t: 60_000, reason, ascReadySec: 12 }], talented: true },
			} as Analysis);
			expect(html, reason).not.toContain(`elementalMastery.state.${reason}`);
		}
	});
});
