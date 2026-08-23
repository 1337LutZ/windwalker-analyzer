import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Analysis } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { getSpec } from '~/lib/spec';

import SummaryWarning from '../SummaryWarning';

// Every fixture below is a Windwalker pull, so the section is rendered under the Windwalker's own
// scorer and copy. Named rather than left to `SpecContext`'s default, which is the build's pinned
// `DEFAULT_SPEC` — under `PUBLIC_SPEC=elemental` that scored these monk fixtures with the Shaman's
// thresholds.
const WINDWALKER_SPEC = getSpec('windwalker')!;
const asWindwalker = (node: ReactNode): ReactElement =>
	createElement(SpecContext.Provider, { value: WINDWALKER_SPEC }, node);

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8'));

const render = (analysis: Analysis) => renderToStaticMarkup(asWindwalker(createElement(SummaryWarning, { analysis })));

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
		expect(html).toContain('how Tigereye Brew is pressed without it');
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
