// The voice the Elemental sections speak in, asserted rather than agreed to.
//
// This is the third time the same complaint has been made about the same strings: the copy describes
// our model instead of the player's pull. `6818cdf` rewrote a batch of them and moved two from one
// abstraction to another — `ascendance.state.plain` went from "No rule" to "…pressed on the clock
// alone", and `elementalMastery.state.plain` to "…pressed while Ascendance was still coming back".
// Both sentences are about the audit's own branch structure. A player reading a red cell needs the
// buttons to press together, not the name of the arm they failed.
//
// Two guards, because they fail in different ways:
//
//   1. A sweep over the locale file, so the next rewrite cannot re-introduce the vocabulary in a
//      string no rendering test happens to cover. Scoped to the Elemental sections' own `state.*`,
//      `kpi.*`, `caption`, `intent`, `read.*` and `verdict_*` keys — the kinds a reader is shown as
//      prose or as a table cell. Method notes (`unreadable`, `notGraded`, `measurable`, `resolution`)
//      are deliberately about our method and are *not* in scope: a hedge has to be allowed to explain
//      itself.
//   2. Literal render assertions on the two strings the complaint named, so the sweep cannot be
//      satisfied by copy that avoids the banned words and still says nothing actionable.
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

// ------------------------------------------------------------------ 1. the locale sweep

/**
 * Words that name the audit rather than the game. `clock` is here because "pressed on the clock alone"
 * is the complaint verbatim; the fight timeline is legitimately called a clock elsewhere in the file,
 * which is why the sweep is scoped to these sections' four reader-facing key kinds rather than run
 * across all 1109 strings.
 */
const MODEL_WORDS = [
	'clock',
	'the list',
	'p5',
	'branch',
	'predicate',
	'verdict',
	'judg',
	'gate',
	'band',
	'satisfied',
	'rule',
	'condition',
	'graded',
	'the section',
	'on offer',
	'opportunit',
];

/** The Elemental sections. Every one of them had at least one string in this shape. */
const SECTIONS = [
	'ascendance',
	'elementalMastery',
	'fireElemental',
	'earthElemental',
	'cooldownDrift',
	'flameShock',
	'flameShockSnapshots',
	'earthShock',
	'lavaBurst',
	'searingTotem',
	'lightningShield',
	'stormlash',
	// The Mana section joins the sweep with the section itself. Its `intent` had to be rewritten to get
	// in — the string this file's own banned list would have caught said mana "refills on a clock", which
	// is our vocabulary for a denominator and not a thing a reader presses.
	'mana',
];

// `read` joins the four when the Ascendance verdict column landed: those sentences are the newest
// reader-facing copy in the spec and the most tempting place to name a rule arm, which is the exact
// mistake this file exists to stop repeating.
//
// **`verdict` is the sixth, and it needed its own alternative rather than a sixth name in the first
// one.** A graded sentence is stored with its grade inside the same path segment — `verdict_good`,
// `verdict_ok_noOvercap` — so `verdict` in the alternation above matches on neither a `.` nor an end of
// string and selects exactly nothing. That is not a small bug in this pattern: it is why the loudest
// remaining instance of the complaint this file was written about survived every green run of the suite.
// `earthShock.verdict_good` told a reader their shocks "matched the rule the list had for them" — our
// own model's vocabulary, in the one sentence a section is judged by — and no guard could see it.
const READER_KEYS = /(^|\.)(state|kpi|caption|intent|read)(\.|$)|(^|\.)verdict(_|\.|$)/;

const copyStrings = (): [string, string][] => {
	const locale = JSON.parse(
		readFileSync(resolve(import.meta.dirname, '../../../../../locales/en/report.json'), 'utf8'),
	) as Record<string, unknown>;
	const out: [string, string][] = [];
	const walk = (node: unknown, path: string[]) => {
		if (typeof node === 'string') out.push([path.join('.'), node]);
		else if (node && typeof node === 'object')
			for (const [key, value] of Object.entries(node)) walk(value, [...path, key]);
	};
	walk(locale, []);
	return out.filter(([key]) => SECTIONS.includes(key.split('.')[0]!) && READER_KEYS.test(key));
};

describe('the Elemental copy is about the pull, not about the audit', () => {
	it('has reader-facing strings in every section, so the sweep is not vacuous', () => {
		const found = new Set(copyStrings().map(([key]) => key.split('.')[0]!));
		expect([...found].sort()).toEqual([...SECTIONS].sort());
		expect(copyStrings().length).toBeGreaterThan(60);
		// Each key kind the pattern claims to cover has to actually match something, or widening it is a
		// no-op that reads as coverage. `read` is the one this caught: the Ascendance verdict sentences are
		// the newest copy in the spec and were outside the sweep until the pattern named them.
		const kinds = new Set(copyStrings().flatMap(([key]) => key.split('.')));
		for (const kind of ['state', 'kpi', 'caption', 'intent', 'read']) expect(kinds, kind).toContain(kind);
		expect(copyStrings().filter(([key]) => key.startsWith('ascendance.read.')).length).toBe(14);
		// The graded sentences, counted separately because they cannot be counted the same way: the grade is
		// part of the segment, so `verdict` never appears in `kinds` and the loop above would pass whether
		// or not a single one of them was selected.
		//
		// Six of the thirteen sections carry one — the six whose section is graded as a whole. The other
		// seven grade per press and speak through a `state.*` cell on each row instead, which is why the
		// list is written out: a section that grows a verdict and is left off this line would be swept
		// anyway, but a section that *loses* its arms to a refactor would quietly leave the sweep with the
		// count still passing.
		const verdicts = copyStrings().filter(([key]) => key.split('.')[1]?.startsWith('verdict'));
		expect(verdicts.length).toBeGreaterThan(30);
		expect([...new Set(verdicts.map(([key]) => key.split('.')[0]!))].sort()).toEqual([
			'earthShock',
			'flameShock',
			'flameShockSnapshots',
			'lightningShield',
			'mana',
			'searingTotem',
		]);
	});

	it('names no part of our own model in a state, tile, caption or intent', () => {
		for (const [key, value] of copyStrings())
			for (const word of MODEL_WORDS) expect(value.toLowerCase(), `${key}: "${value}"`).not.toContain(word);
	});
});

// ------------------------------------------------------------------ 2. the two named strings

describe('the two cooldown states the complaint named', () => {
	/** A press that is neither the opener nor a two-piece press — the cell that said "on the clock alone". */
	it('tells an unpaired Ascendance which buttons to line it up with', () => {
		const press = unbroken.ascendance.presses[0]!;
		const html = render(Ascendance, {
			...unbroken,
			ascendance: { ...unbroken.ascendance, presses: [{ ...press, opener: false, twoPiece: false }] },
		} as Analysis);
		expect(html).toContain('Pressed outside the opener with no tier-16 proc up — save it for one of those');
	});

	/** `reason: null` — the cell that said "pressed while Ascendance was still coming back". */
	it('tells an unpaired Elemental Mastery to hold the haste for Ascendance', () => {
		const html = render(ElementalMastery, {
			...unbroken,
			elementalMastery: { presses: [{ t: 60_000, reason: null }], talented: true },
		} as Analysis);
		expect(html).toContain(
			'Pressed with Ascendance on cooldown and not far enough out to spend on its own — hold the haste for Ascendance',
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
		expect(html).toContain(
			'Pressed with Ascendance 3s out — it comes back inside the haste, so the two overlap anyway',
		);
	});

	it('tells a press far from Ascendance the opposite reason, and neither reads as a fault', () => {
		const html = render(ElementalMastery, {
			...unbroken,
			elementalMastery: { presses: [{ t: 60_000, reason: 'off-far', ascReadySec: 120 }], talented: true },
		} as Analysis);
		expect(html).toContain(
			'Pressed with Ascendance 120s away — far too long to hold a ninety-second cooldown for, so spending it now is right',
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
