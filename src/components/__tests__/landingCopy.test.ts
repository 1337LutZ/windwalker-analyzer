// The landing page says which spec this build analyses, and says nothing about any other.
//
// The bug this exists to catch shipped: under `PUBLIC_SPEC=elemental` the page's eyebrow read "Mists of
// Pandaria · Windwalker", its heading read "Windwalker analyzer" and its intro paragraph described
// Tigereye Brew and Re-Origination procs — four strings hard-coded to one spec in a build serving
// another. Nothing caught it, because nothing rendered `Analyzer` at all.
//
// `App` rather than `Analyzer`, which is not incidental: it is the island root, so this is the same
// tree Astro prerenders into `index.astro`, providers and all. Rendering the header in isolation would
// need a fake session above it and would stop being a test of what the page says.
//
// The suite is meaningful under both spec pins and says something different under each. The positive
// assertions read `DEFAULT_SPEC`, which is the value under test — so on their own they would pass on
// the old copy under the Windwalker pin. The cross-spec assertions are what carry the claim: no name
// and no paragraph belonging to a spec this build is not may appear anywhere in the markup.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import App from '~/components/App';
import { DEFAULT_SPEC, SPECS } from '~/lib/spec';

/**
 * A phrase only this spec's own intro paragraph can carry, so a spec rendering another's prose fails.
 *
 * Hand-written, because "which mechanic this paragraph is about" is not something a test can read off
 * the copy — and not free to drift either: the first case below holds this table against the registry,
 * so a third spec cannot be added without deciding what its landing paragraph claims.
 */
const INTRO_MARKER: Record<string, string> = {
	windwalker: 'Tigereye Brew',
	elemental: 'Flame Shock',
};

const html = renderToStaticMarkup(createElement(App));

describe('landing page copy', () => {
	it('has a filed intro marker for every registered spec', () => {
		expect(Object.keys(INTRO_MARKER).sort()).toEqual(SPECS.map((spec) => spec.key).sort());
	});

	it('names the build’s own spec in the eyebrow, the heading and the intro', () => {
		expect(html).toContain(`Mists of Pandaria · ${DEFAULT_SPEC.specName}`);
		expect(html).toContain(`${DEFAULT_SPEC.displayName} analyzer`);
		expect(html).toContain(INTRO_MARKER[DEFAULT_SPEC.key]);
	});

	it('names no spec this build does not serve', () => {
		const others = SPECS.filter((spec) => spec.key !== DEFAULT_SPEC.key);
		expect(others.length, 'only one spec registered — this case proves nothing').toBeGreaterThan(0);
		for (const other of others) {
			expect(html, `${other.key}: specName`).not.toContain(other.specName);
			expect(html, `${other.key}: displayName`).not.toContain(other.displayName);
			expect(html, `${other.key}: intro`).not.toContain(INTRO_MARKER[other.key]);
		}
	});
});
