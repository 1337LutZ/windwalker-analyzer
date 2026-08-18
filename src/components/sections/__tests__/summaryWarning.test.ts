import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Analysis } from '~/lib/types';

import SummaryWarning from '../SummaryWarning';

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../lib/__fixtures__/${name}.json`), 'utf8'));

const render = (analysis: Analysis) => renderToStaticMarkup(createElement(SummaryWarning, { analysis }));

describe('summary Rune warnings', () => {
	it('warns when reported gear does not contain the Rune', () => {
		const analysis = fixture('strong');
		const withoutRune = {
			...analysis,
			gear: {
				...analysis.gear,
				slots: analysis.gear.slots.map((slot) => (slot.id === 96546 ? { ...slot, id: 0 } : slot)),
			},
		};

		const html = render(withoutRune);
		expect(html).toContain('Rune of Re-Origination not detected');
		expect(html).toContain('non-Rune Tigereye Brew rules');
	});

	it('warns when every observed proc was non-Mastery', () => {
		const analysis = fixture('strong');
		const nonMastery = {
			...analysis,
			procs: { ...analysis.procs, statMix: { Crit: analysis.procs.procs } },
		};

		const html = render(nonMastery);
		expect(html).toContain('Check your gems and reforges');
		expect(html).toContain('converted into Crit instead of Mastery');
	});

	it('names both non-Mastery proc stats when both were observed', () => {
		const analysis = fixture('strong');
		const nonMastery = {
			...analysis,
			procs: { ...analysis.procs, statMix: { Haste: 8, Crit: 8 } },
		};

		const html = render(nonMastery);
		expect(html).toContain('converted into Haste and Crit instead of Mastery');
	});

	it('does not warn when at least one proc was Mastery', () => {
		expect(render(fixture('strong'))).toBe('');
	});
});
