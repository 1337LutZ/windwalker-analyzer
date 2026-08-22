// The cooldowns, one section per button, and the talent gate that decides whether a section exists.
//
// One heading used to hold an Ascendance table, an Elemental Mastery table and the leftover ledger,
// and nothing in the Elemental components read a talent at all. So every reader was shown an Elemental
// Mastery table whether or not they had taken Elemental Mastery — and all three committed fixtures
// carry a `combatantinfo` talent list without 16166 in it, which is a table for a button the player
// never had.
//
// Three answers are asserted separately here, because the whole reason `readTalents` exists rather
// than inferring a talent from whether its button was cast is that they are different claims:
//
//   taken       — the section appears, and an empty table is a cooldown left on the bar all pull
//   not taken   — the section does not appear at all
//   cannot say  — the section appears, and says which of the two it cannot tell apart
//
// The strings are asserted as literals rather than through a second `t()` call: a test whose two sides
// both come out of the locale file passes whatever the locale file happens to say.
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
import type { Analysis, ElementalAuditResult, FightDataset, LostCastRow } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { SPEC_SECTIONS } from '~/components/report/specSections';
import { analyse } from '~/specs/elemental/lib';

import Ascendance from '../Ascendance';
import CooldownDrift from '../CooldownDrift';
import ElementalMastery from '../ElementalMastery';

const ELEMENTAL_SPEC = getSpec('elemental')!;

initI18n();

type El = Analysis & ElementalAuditResult;

/** `a:xB3kh7v9pF2AHRtq` #16 — two Ascendance presses, no Elemental Mastery, and no other held button. */
const unbroken: El = analyse(
	JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../__fixtures__/unbroken.json'), 'utf8')) as FightDataset,
) as El;

/**
 * The audit with the talent answer overridden, which is the field `elemental/lib/index.ts` has still
 * to publish — see the pending hunk in `gates.ts`. `undefined` is a fourth case rather than a fourth
 * answer: it is the field being absent, and it has to read as `null`.
 */
type Mastery = El['elementalMastery'] & { talented?: boolean | null };

const withTalent = (talented: boolean | null | undefined): El => {
	const elementalMastery: Mastery = talented === undefined ? { presses: [] } : { presses: [], talented };
	return { ...unbroken, elementalMastery };
};

const sections = SPEC_SECTIONS.elemental ?? [];
const section = (id: string) => sections.find((entry) => entry.id === id);

const render = (Component: (props: { analysis: Analysis }) => unknown, analysis: Analysis) =>
	renderToStaticMarkup(
		createElement(SpecContext.Provider, { value: ELEMENTAL_SPEC }, createElement(Component as never, { analysis })),
	);

describe('the cooldowns are one section per button', () => {
	it('gives Ascendance, Elemental Mastery and the leftovers their own headings', () => {
		expect(section('cooldowns')).toBeUndefined();
		expect(section('ascendance')).toBeDefined();
		expect(section('elemental-mastery')).toBeDefined();
		expect(section('cooldown-drift')).toBeDefined();
		// All three in the sidebar's cooldowns group, beside the two elementals and Stormlash rather
		// than at the end of the list.
		expect(['ascendance', 'elemental-mastery', 'cooldown-drift'].map((id) => section(id)?.group)).toEqual([
			'cooldowns',
			'cooldowns',
			'cooldowns',
		]);
	});

	/**
	 * Ascendance is **not** a talent — absent from `ui/core/talents/trees/shaman.json` and registered
	 * unconditionally at `sim/shaman/shaman.go:245` — so its section may never decline. Getting this
	 * backwards would hide the pull's biggest cooldown behind a talent nobody has to take.
	 */
	it('never gates Ascendance, which every Elemental has', () => {
		expect(section('ascendance')?.when).toBeUndefined();
		const html = render(Ascendance, withTalent(false));
		expect(html).toContain('Ascendance');
		expect(html).toContain('In the opener');
	});
});

describe('the Elemental Mastery talent gate', () => {
	const when = () => section('elemental-mastery')?.when;

	it('removes the section for a player who did not take the talent', () => {
		expect(when()?.(withTalent(false))).toBe(false);
	});

	it('keeps the section for a player who did, and calls an empty table what it is', () => {
		expect(when()?.(withTalent(true))).toBe(true);
		const html = render(ElementalMastery, withTalent(true));
		expect(html).toContain('You took Elemental Mastery and never pressed it');
		expect(html).not.toContain('This log carries no talent list for you');
	});

	it('keeps the section when the log cannot say, and says so instead of accusing anyone', () => {
		expect(when()?.(withTalent(null))).toBe(true);
		const html = render(ElementalMastery, withTalent(null));
		expect(html).toContain('This log carries no talent list for you');
		expect(html).not.toContain('You took Elemental Mastery and never pressed it');
	});

	/**
	 * The field is not published yet, and an absent field is "cannot say" rather than "not taken". A
	 * gate that read absence as `false` would delete the section from every report the moment the audit
	 * hunk was late — which is the opposite of the failure this whole section is about.
	 */
	it('reads an unpublished talent field as cannot-say, not as not-taken', () => {
		expect(when()?.(withTalent(undefined))).toBe(true);
		expect(render(ElementalMastery, withTalent(undefined))).toContain('This log carries no talent list for you');
	});
});

describe('the held-cooldown ledger', () => {
	/** Every committed fixture: `lostCasts` holds Ascendance alone, and Ascendance is judged on placement. */
	it('declines on a pull with no button left to report', () => {
		expect(unbroken.lostCasts.map((row) => row.id)).toEqual([114_049]);
		expect(section('cooldown-drift')?.when?.(unbroken)).toBe(false);
	});

	it('appears, with a row, as soon as there is one', () => {
		const unleash: LostCastRow = {
			id: 73_680,
			name: 'Unleash Elements',
			casts: 4,
			lostCasts: 3,
			cooldownSec: 15,
			driftSec: 41.5,
			openerSec: 0,
			tailSec: 0,
			worst: [],
		};
		const analysis: El = { ...unbroken, lostCasts: [...unbroken.lostCasts, unleash] };
		expect(section('cooldown-drift')?.when?.(analysis)).toBe(true);
		const html = render(CooldownDrift, analysis);
		expect(html).toContain('Unleash Elements');
		expect(html).toContain('Presses missed');
		// And Ascendance is not in it: it is judged on where the press landed, in its own section.
		expect(html).not.toContain('114049');
	});
});
