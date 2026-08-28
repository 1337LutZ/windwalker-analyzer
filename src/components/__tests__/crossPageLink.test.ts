// Each spec's two pages, and the link between them.
//
// The routes are the half worth asserting. Both are built from `import.meta.env.BASE_URL`, and the whole
// reason that constant is read at all is that GitHub Pages serves this project under `/<repo>/` — a link
// written as `/shaman/elemental` there is a link to somebody else's site. `SpecPicker`'s own docstring
// records that nothing in `src/` read the base until the routes existed, which is exactly the mistake a
// new pair of links is placed to repeat.
//
// The other half is the ternary that picks which sibling a page offers, and the failure it has is the
// report page linking to the report page. That is asserted against `siblingPage` rather than against a
// render: `Analyzer` reaches for a session on its first line, so `renderToStaticMarkup` throws before it
// emits the anchor — the first version of this file rendered it inside a `try` and swallowed the throw,
// which made every assertion below run over an empty string and pass without looking at anything.

import { describe, expect, it } from 'vitest';

import { siblingHref } from '~/components/Analyzer';
import { compareRoute, specRoute } from '~/components/SpecPicker';
import i18n, { initI18n } from '~/lib/i18n/config';
import { SPECS } from '~/lib/spec';

initI18n();
const t = i18n.getFixedT('en', 'ui');

describe('the compare route', () => {
	it('is the report route with `compare` on the end, for every spec', () => {
		for (const spec of SPECS) {
			expect(compareRoute(spec), spec.key).toBe(`${specRoute(spec)}/compare`);
			expect(compareRoute(spec).endsWith(`/${spec.classSlug}/${spec.key}/compare`), spec.key).toBe(true);
		}
	});

	it('carries the deployment base, which is the whole reason it is not a literal', () => {
		for (const spec of SPECS) {
			expect(compareRoute(spec).startsWith(import.meta.env.BASE_URL), spec.key).toBe(true);
		}
	});
});

describe('the header link between a spec’s two pages', () => {
	it('points each page at the other, and never at itself', () => {
		for (const spec of SPECS) {
			const fromReport = siblingHref(spec, 'report');
			const fromCompare = siblingHref(spec, 'compare');
			expect(fromReport, spec.key).toBe(compareRoute(spec));
			expect(fromCompare, spec.key).toBe(specRoute(spec));
			// The backwards ternary, named. Either arm pointing at its own page is a working link to
			// nowhere new, and it is the only way this pair actually breaks.
			expect(fromReport, spec.key).not.toBe(specRoute(spec));
			expect(fromCompare, spec.key).not.toBe(compareRoute(spec));
		}
	});

	it('names each destination with copy that exists', () => {
		// Spelled out rather than read off the seam, which is the same constraint the seam's own docstring
		// records: i18next hands back the key itself when nothing is registered, so an unregistered key
		// renders as `app.toCompare` on the page instead of as a missing link.
		for (const key of ['app.toCompare', 'app.toReport'] as const) {
			expect(t(key), key).not.toBe(key);
			expect(t(key).length, key).toBeGreaterThan(0);
		}
	});
});
