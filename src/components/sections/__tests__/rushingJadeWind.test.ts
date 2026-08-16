// What the section says, as opposed to what it measures — `lib/view/__tests__/jadeWind.test.ts`
// holds the arithmetic. Everything here is about a sentence a reader could act on wrongly.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import type { Analysis, TargetMode } from '~/lib/types';

import RushingJadeWind from '../RushingJadeWind';

initI18n();
const t = i18n.getFixedT('en', 'report');

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../lib/__fixtures__/${name}.json`), 'utf8'));

const render = (analysis: Analysis, mode: TargetMode | null = null) =>
	renderToStaticMarkup(createElement(RushingJadeWind, { analysis, mode }));

/** React escapes apostrophes in a text node, so copy carrying one has to be escaped to match. */
const escaped = (copy: string) => copy.replace(/'/g, '&#x27;');

describe('Rushing Jade Wind section', () => {
	/**
	 * The section's whole reason for existing. A cooldown equal to the dot's duration makes 100%
	 * always reachable, so the number that means something is what reaching it would have cost — and
	 * the section has to say both, in that order.
	 */
	it('prints the uptime and then prices the ceiling instead of quoting it', () => {
		const html = render(fixture('waves'), 'multi');
		expect(html).toContain(t('jadeWind.kpi.uptime'));
		expect(html).toContain(escaped(t('jadeWind.ceiling')));
		// The measured share, in the currency that is actually scarce. Two decimals, through the shared
		// formatter, so the sentence and the tile above it print the same figure.
		expect(html).toContain('52.46%');
		expect(html).toContain('32.28%');
	});

	/** An unmeasured price is withheld rather than printed as free. */
	it('withholds the price when the pull measured no regen', () => {
		const analysis = fixture('waves');
		const unmeasured: Analysis = { ...analysis, energy: { ...analysis.energy!, regenPerSec: null } };
		const html = render(unmeasured, 'multi');
		expect(html).toContain(escaped(t('jadeWind.priceUnmeasured')));
		expect(html).not.toContain(t('jadeWind.price', { possible: 0 }).slice(0, 30));
	});

	/**
	 * The single-target caveat, and the reason it is conditional. At one target the promoted entry is
	 * not in the list at all, so a section that stayed silent would let a reader take the ladder's
	 * verdicts as an endorsement of spinning it on a boss.
	 */
	it('warns that the list does not promote the button at one target', () => {
		expect(render(fixture('strong'), 'single')).toContain(escaped(t('jadeWind.singleTarget')));
		expect(render(fixture('waves'), 'multi')).not.toContain(escaped(t('jadeWind.singleTarget')));
	});

	/** The verdicts follow the reader's reading, because `PriorityLadder` beside them does too. */
	it('judges the presses at the band it was handed', () => {
		const analysis = fixture('strong');
		const single = render(analysis, 'single');
		const multi = render(analysis, 'multi');
		expect(single).toContain(escaped(t('jadeWind.ladder', { context: 'some', count: 13, followed: 1 })));
		expect(multi).toContain(escaped(t('jadeWind.ladder', { context: 'some', count: 13, followed: 9 })));
	});

	/**
	 * The one thing this section must never do. `mixed` took Invoke Xuen, so it never had the button —
	 * and a heading reading 0% would be an accusation rather than a measurement.
	 */
	it('says the talent was not taken rather than reporting no uptime', () => {
		const html = render(fixture('mixed'), 'single');
		expect(html).toContain(escaped(t('jadeWind.absent', { context: 'invokeXuen' })));
		// No tiles at all: the figures are what would read as the accusation.
		expect(html).not.toContain(t('jadeWind.kpi.uptime'));
		expect(html).not.toContain(t('jadeWind.kpi.presses'));
		expect(html).not.toContain(t('jadeWind.kpi.energy'));
	});

	/** And when the log proves nothing either way, it says that instead of guessing in either direction. */
	it('says it cannot tell when the log carries no evidence', () => {
		const analysis = fixture('mixed');
		const silent: Analysis = { ...analysis, casts: analysis.casts.filter((c) => c.id !== 123_904) };
		const html = render(silent, 'single');
		expect(html).toContain(escaped(t('jadeWind.absent', { context: 'unknown' })));
		expect(html).not.toContain(t('jadeWind.kpi.uptime'));
	});

	/** The heading renders whatever the pull held, because the nav is built from the same list. */
	it('renders its heading in every state', () => {
		for (const name of ['strong', 'mixed', 'waves', 'weave']) {
			expect(render(fixture(name)), name).toContain('id="jade-wind-heading"');
		}
	});
});
