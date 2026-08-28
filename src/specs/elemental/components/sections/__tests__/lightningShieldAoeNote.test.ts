// The sentence beside the shield chart's grey band.
//
// The band and its key entry landed first: `lightningShield.key.aoe` reads "AoE — not graded", which is
// what stops the grey being read as the same thing as an intermission on another chart. `aoeNote` — the
// sentence that says *why* those seconds left the overcap figure, and that two enemies is still graded —
// was written in the same breath and then referenced by nothing, so the chart shaded a stretch and the
// tile printed a duration with no text anywhere saying the second was measured over the complement of
// the first.
//
// Which is the failure this file pins, in both directions. A key alone cannot carry a reason, and a note
// printed on every pull carries no information about the pull in front of the reader — so it has to
// appear exactly on the pulls with a band and nowhere else.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';

import LightningShield from '../LightningShield';

const ELEMENTAL_SPEC = getSpec('elemental')!;

initI18n();
const t = i18n.getFixedT('en', 'report');

type El = Analysis & ElementalAuditResult;

const analysed = (name: string): El =>
	analyse(
		JSON.parse(
			readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8'),
		) as FightDataset,
	) as El;

const render = (analysis: Analysis) =>
	renderToStaticMarkup(
		createElement(SpecContext.Provider, { value: ELEMENTAL_SPEC }, createElement(LightningShield, { analysis })),
	);

/** The one committed fixture with band-3+ time, so the one that can carry the band at all. */
const cleave = analysed('cleave');

describe('the shield chart says what its grey band means', () => {
	/**
	 * The band, its key entry, and the sentence — all three on the pull that has exempt stretches.
	 *
	 * The three are asserted together rather than in three cases because the claim is that they agree: a
	 * band with a key and no reason is the state this file was written against, and a reason with no band
	 * would be a note about a pull that had none.
	 */
	it('prints the reason on a pull with exempt stretches', () => {
		expect(cleave.lightningShield.exemptWindows.length).toBeGreaterThan(0);
		const html = render(cleave);
		expect(html).toContain(t('lightningShield.key.aoe'));
		expect(html).toContain('The AoE priority list has no Earth Shock in it at all');
	});

	/**
	 * And the half of the sentence that keeps the band from over-claiming. Only three or more enemies is
	 * exempt; a two-target stretch is graded and is not shaded, so a reader who reads the grey as "adds
	 * were forgiven" has to be corrected in the same paragraph.
	 */
	it('says out loud that the figure still holds you at two enemies', () => {
		expect(render(cleave)).toContain('At two enemies the figure still holds you to it');
	});

	/**
	 * The negative half, on the two fixtures that cannot have a band: `phased` and `unbroken` never
	 * exceed one enemy, so `aoeWindows` is empty on both and every assertion here is a no-change guard —
	 * this is what the section looked like before the note existed and what it must still look like.
	 *
	 * **The grey is no longer one cause, which is what makes the negative worth keeping.** Both pulls do
	 * have exempt stretches now — the ones with no enemy in range — so a single sentence keyed on "is
	 * anything greyed" would print the AoE reason on a pull that never saw three enemies. Each cause
	 * carries its own note, and this is the guard that they did not get merged back into one.
	 */
	it.each(['phased', 'unbroken'])('says nothing about AoE on %s, which never left one enemy', (name) => {
		const single = analysed(name);
		expect(single.lightningShield.exemptWindows).toEqual([]); // no-change guard
		const html = render(single);
		expect(html).not.toContain(t('lightningShield.key.aoe')); // no-change guard
		expect(html).not.toContain('The AoE priority list has no Earth Shock in it at all'); // no-change guard
		// The other note in the same stack is still there, so the two above are not passing on a section
		// that failed to render its notes at all.
		expect(html).toContain('Overcap is measured past a');
	});

	/**
	 * The second cause, and the sentence that belongs to it.
	 *
	 * The shield's clock was the last in the audit still measured over the whole pull: Flame Shock's and
	 * the totem's were both cut to contact and this one was not, so a shaman with no enemy in range was
	 * charged for a full shield they had nothing to spend. On the Galakras kill it was found on, that was
	 * between 7.5% and 65.1% of four shamans' overcap.
	 *
	 * Asserted on `phased`, which has the away stretches and none of the AoE ones, so the two causes are
	 * told apart by the pull rather than by reading them off one render.
	 */
	it('prints the away reason, and only it, on a pull that never left one enemy', () => {
		const single = analysed('phased');
		expect(single.lightningShield.awayWindows.length).toBeGreaterThan(0);
		const html = render(single);
		expect(html).toContain(t('lightningShield.key.away'));
		expect(html).toContain('Earth Shock needs a target');
	});
});
