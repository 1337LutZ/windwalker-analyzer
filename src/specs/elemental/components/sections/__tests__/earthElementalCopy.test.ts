// What the Earth Elemental section says to a reader, which is not what the rule says to the audit.
//
// The verdicts were transcribed straight out of the sim's rule structure: `near-end` printed "Near the
// end — branch A", a refuted press printed "No branch wanted it", and the note under the table quoted
// `spellTimeToReady(114206 Skull Banner)` at a reader. The rule genuinely is an or of three, so that
// was accurate — and still wrong, because a reader does not have branches. They have a button they
// pressed at a moment, and what they need from a red cell is what to do differently.
//
// So this pins two things per verdict: the sentence a reader gets, and the absence of our own
// vocabulary from the rendered section. Literals rather than a second `t()` call, because a test whose
// two sides both come out of the locale file passes whatever the locale file happens to say — which is
// exactly how the branch wording survived a rewrite of this section.
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
import type { Analysis, EarthElementalVerdict, ElementalAuditResult, FightDataset } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';

import EarthElemental from '../EarthElemental';

const ELEMENTAL_SPEC = getSpec('elemental')!;

initI18n();

type El = Analysis & ElementalAuditResult;

const unbroken: El = analyse(
	JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../__fixtures__/unbroken.json'), 'utf8')) as FightDataset,
) as El;

/** One press, at one verdict — the section's own arithmetic is asserted in `lib/__tests__/elementals.test.ts`. */
const withVerdict = (verdict: EarthElementalVerdict): string =>
	renderToStaticMarkup(
		createElement(
			SpecContext.Provider,
			{ value: ELEMENTAL_SPEC },
			createElement(EarthElemental, {
				analysis: {
					...unbroken,
					earthElemental: {
						...unbroken.earthElemental,
						presses: [{ t: 120_000, verdict, inferred: false }],
						graded: verdict === 'unknown' ? 0 : 1,
						good: verdict === 'near-end' ? 1 : 0,
					},
				} as Analysis,
			}),
		),
	);

describe('the Earth Elemental verdicts, in a reader’s words', () => {
	it('says where a good press landed rather than which branch it answered', () => {
		const html = withVerdict('near-end');
		expect(html).toContain('Pressed in the fight&#x27;s last minute, where it belongs');
	});

	/**
	 * The complaint itself. "No branch wanted it" names our implementation; a reader needs the thing to
	 * do differently, which is to hold the summon for the end of the pull.
	 */
	it('tells a refuted press what to do instead', () => {
		const html = withVerdict('off-rule');
		expect(html).toContain('Too early. Hold it for the fight&#x27;s last minute');
	});

	/**
	 * And the hedge stays a hedge. This press is not a fault: the one thing that could have justified it
	 * is another player's Skull Banner cooldown, which no combat log carries. The sentence has to say
	 * what could not be read rather than print "unknown" and leave a reader to guess whether that means
	 * they got away with something.
	 */
	it('says what could not be read, rather than "cannot say"', () => {
		const html = withVerdict('unknown');
		expect(html).toContain(
			'Early, only right if you were standing in for a Fire Elemental that could not be up, and your log does not show the Skull Banner cooldown that call waits on',
		);
		expect(html).toContain('another player&#x27;s button, which your combat log does not record');
		expect(html).not.toContain('Cannot say');
	});

	it('has no implementation vocabulary left in it at all', () => {
		for (const verdict of ['near-end', 'off-rule', 'unknown'] as const) {
			const html = withVerdict(verdict);
			for (const word of ['branch', 'spellTimeToReady', 'predicate', 'or of three']) {
				expect(html, `${verdict}: ${word}`).not.toContain(word);
			}
		}
	});
});
