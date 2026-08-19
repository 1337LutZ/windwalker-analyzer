// What the section says, as opposed to what it measures — `lib/view/__tests__/jadeWind.test.ts`
// holds the arithmetic. Everything here is about a sentence a reader could act on wrongly.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { formatDecimal } from '~/lib/format/number';
import i18n, { initI18n } from '~/lib/i18n/config';
import type { Analysis, TargetMode } from '~/lib/types';

import RushingJadeWind from '../RushingJadeWind';

initI18n();
const t = i18n.getFixedT('en', 'report');

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8'));

const render = (analysis: Analysis, mode: TargetMode | null = null) =>
	renderToStaticMarkup(createElement(RushingJadeWind, { analysis, mode, forcedMode: mode }));

/** React escapes apostrophes in a text node, so copy carrying one has to be escaped to match. */
const escaped = (copy: string) => copy.replace(/'/g, '&#x27;');

describe('Rushing Jade Wind section', () => {
	it('prints target fan-out and priority-list opportunities', () => {
		const analysis = fixture('waves');
		const html = render(analysis, 'multi');
		const targets = analysis.damage.abilities.find((ability) => ability.id === 148_187)?.averageTargetsHit;
		expect(html).toContain(t('jadeWind.kpi.targets'));
		expect(html).toContain(t('jadeWind.kpi.opportunities'));
		expect(html).toContain('>32<');
		// The fan-out sentence, read off the fixture's own number rather than written out here. The
		// section only falls back to `summaryNoTargets` for an analysis captured before the damage table
		// carried per-target counts, which no committed fixture is any more.
		expect(targets).toBeDefined();
		expect(html).toContain(escaped(t('jadeWind.summary', { targets: formatDecimal(targets ?? 0), presses: 32 })));
		expect(html).toContain(t('jadeWind.decisions.caption'));
	});

	/**
	 * The single-target caveat, and the reason it is conditional. At one target the promoted entry is
	 * not in the list at all, so a section that stayed silent would let a reader take the ladder's
	 * verdicts as an endorsement of spinning it on a boss.
	 */
	it('warns that the list does not promote the button at one target', () => {
		const single = render(fixture('strong'), 'single');
		expect(single).toContain(escaped(t('jadeWind.singleTarget')));
		expect(single).toContain(t('jadeWind.choice.value'));
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
		expect(html).not.toContain(t('jadeWind.kpi.targets'));
		expect(html).not.toContain(t('jadeWind.kpi.opportunities'));
	});

	/** And when the log proves nothing either way, it says that instead of guessing in either direction. */
	it('says it cannot tell when the log carries no evidence', () => {
		const analysis = fixture('mixed');
		const silent: Analysis = { ...analysis, casts: analysis.casts.filter((c) => c.id !== 123_904) };
		const html = render(silent, 'single');
		expect(html).toContain(escaped(t('jadeWind.absent', { context: 'unknown' })));
		expect(html).not.toContain(t('jadeWind.kpi.targets'));
	});

	/** The heading renders whatever the pull held, because the nav is built from the same list. */
	it('renders its heading in every state', () => {
		for (const name of ['strong', 'mixed', 'waves', 'weave']) {
			expect(render(fixture(name)), name).toContain('id="jade-wind-heading"');
		}
	});
});
