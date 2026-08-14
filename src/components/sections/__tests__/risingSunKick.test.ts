import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import type { Analysis } from '~/lib/types';

import RisingSunKick from '../RisingSunKick';

initI18n();
const t = i18n.getFixedT('en', 'report');

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../lib/__fixtures__/${name}.json`), 'utf8'));

const render = (analysis: Analysis) => renderToStaticMarkup(createElement(RisingSunKick, { analysis }));

describe('Rising Sun Kick section', () => {
	it('reports uptime against engaged time, not pull length', () => {
		const analysis = fixture('poor');
		const html = render(analysis);
		// Engaged uptime is the one that does not charge a player for a phase they could not hit.
		expect(html).toContain(t('debuff.kpi.uptime'));
		expect(analysis.debuff.engagedUptimePct).not.toBe(analysis.debuff.uptimePct);
	});

	/**
	 * Drops are plotted, not listed. A column of timestamps cannot show that three of them were one
	 * phase transition; the timeline can, and its tooltip carries each one's length.
	 */
	it('plots the drops rather than tabulating them', () => {
		const analysis = fixture('strong');
		expect(analysis.debuff.drops.length).toBeGreaterThan(0);
		const html = render(analysis);
		expect(html).toContain(t('debuff.track.dropped'));
		// No table of drops, and no per-drop links duplicating the miss ledger.
		expect(html).not.toContain('<table');
		expect(html).not.toContain('warcraftlogs.com/reports');
	});

	/**
	 * On an add fight the debuff is spread across targets by design, and the number above is measured
	 * against whichever enemy the player was hitting — so the section says so rather than leaving a
	 * reader to assume it was measured on the boss and drew the wrong conclusion from a high figure.
	 *
	 * It is graded now: the refusal this used to assert belonged to the old measurement, which watched
	 * one target and read a spread pull as a fault.
	 */
	it('explains what a multi-target pull was measured against', () => {
		const analysis = fixture('poor');
		const spread: Analysis = {
			...analysis,
			debuff: { ...analysis.debuff, singleTarget: false, primaryDamageShare: 23 },
		};
		const html = render(spread);
		expect(html).toContain(t('debuff.multiTarget', { share: 23 }));
	});

	it('says nothing was cast rather than reporting 0% uptime', () => {
		const analysis = fixture('poor');
		const never: Analysis = { ...analysis, debuff: { ...analysis.debuff, casts: 0 } };
		expect(render(never)).toContain(t('debuff.verdict', { context: 'none' }));
	});
});

/**
 * The restructure: Rising Sun Kick argues for itself, Chi Wave is covered by the cast table's own
 * target column, and the Lost Casts section that used to hold both is gone.
 */
describe('report shape after the restructure', () => {
	it('has a Rising Sun Kick section and no Lost Casts section', async () => {
		const Report = (await import('../../Report')).default;
		const html = renderToStaticMarkup(createElement(Report, { analysis: fixture('strong') }));
		expect(html).toContain('id="debuff-heading"');
		expect(html).not.toContain('id="lost-heading"');
	});

	/** The cast table links here, so the anchor it points at has to exist. */
	it('provides the anchor the cast table links to', () => {
		expect(render(fixture('strong'))).toContain('id="debuff-heading"');
	});
});
