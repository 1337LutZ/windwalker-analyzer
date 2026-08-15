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
	 * Drops are listed in the miss ledger, not tabulated here — and no longer plotted here either: the
	 * chart draws the measurement the tiles print, which is about every enemy, and the drops are one
	 * enemy's gaps.
	 */
	it('neither tabulates the drops nor duplicates the ledger’s links', () => {
		const analysis = fixture('strong');
		expect(analysis.debuff.drops.length).toBeGreaterThan(0);
		const html = render(analysis);
		expect(html).toContain(t('debuff.track.dropped'));
		expect(html).not.toContain('<table');
		expect(html).not.toContain('warcraftlogs.com/reports');
	});

	/**
	 * The chart says which measurement it is drawing, and the two answers are not interchangeable.
	 *
	 * A pull carrying the contact arrays gets the three tracks the tiles are fractions of; a fixture
	 * captured before they existed falls back to the primary target's window model and says so, naming
	 * that enemy. The failure this pins is the one a reader reported: tracks scoped to the boss under
	 * tiles scoped to the player, which drew 380 seconds of a Galakras pull as "out of reach".
	 */
	it('tells the reader which measurement the chart is drawing', () => {
		/** React escapes apostrophes in a text node, so copy carrying one has to be escaped to match. */
		const escaped = (copy: string) => copy.replace(/'/g, '&#x27;');

		const legacy = fixture('strong');
		expect(legacy.debuff.contactUpSegments).toBeUndefined();
		const legacyHtml = render(legacy);
		expect(legacyHtml).toContain(
			escaped(t('debuff.chartCaption', { context: 'primary', target: t('debuff.target_boss') })),
		);
		expect(legacyHtml).not.toContain(escaped(t('debuff.chartCaption')));

		const scoped: Analysis = {
			...legacy,
			debuff: { ...legacy.debuff, contactSegments: [[0, 100_000]], contactUpSegments: [[0, 90_000]] },
		};
		const scopedHtml = render(scoped);
		expect(scopedHtml).toContain(escaped(t('debuff.chartCaption')));
		expect(scopedHtml).not.toContain(escaped(t('debuff.chartCaption', { context: 'primary', target: 'x' })));
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
