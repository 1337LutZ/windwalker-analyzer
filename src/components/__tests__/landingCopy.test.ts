// What each page says about which spec it is — the splash naming all of them, a route naming one.
//
// The bug this exists to catch shipped: under `PUBLIC_SPEC=elemental` the page's eyebrow read "Mists of
// Pandaria · Windwalker", its heading read "Windwalker analyzer" and its intro paragraph described
// Tigereye Brew and Re-Origination procs — four strings hard-coded to one spec in a build serving
// another. Nothing caught it, because nothing rendered `Analyzer` at all.
//
// **The suite used to hold one claim and now holds two, because the site went from one page to two
// kinds of page.** The retired case was `names no spec this build does not serve`: it rendered `App`
// and asserted that no other registered spec's name appeared anywhere in the markup. That is still
// exactly right for a report page and it is the opposite of right for the splash, whose whole job is
// to list every spec there is. A single case could not hold both, so the split is by page:
//
//   - **The splash** names every registered spec and links each to a route that resolves. What it must
//     not do is claim one: no eyebrow, no intro paragraph, and a `--spec-primary` that is nobody's
//     class colour.
//   - **Each route** names its own spec in the eyebrow, the heading and the intro, and names no other.
//     The cross-spec half is the retired case, kept verbatim in substance and now run once per spec
//     rather than once per build pin — which is stronger, because it no longer depends on which spec
//     the build happened to be pinned to.
//
// Each page is rendered from its **island root** — `App` for a route, `Splash` for the other two —
// which is not incidental: that is the same tree Astro prerenders into the `.astro` file, providers
// and all. Rendering `Analyzer` or `SpecPicker` in isolation would need a fake session above it and
// would stop being a test of what the page says.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import App from '~/components/App';
import Splash from '~/components/Splash';
import { specRoute } from '~/components/SpecPicker';
import { spellIconUrl } from '~/components/primitives/spellIcon';
import { CLASS_COLOR } from '~/lib/game/classes';
import { getSpec, SPECS } from '~/lib/spec';
import { NEUTRAL_PRIMARY } from '~/lib/view/specColors';

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

const PAGES = resolve(import.meta.dirname, '../../pages');

describe('landing page copy', () => {
	it('has a filed intro marker for every registered spec', () => {
		expect(Object.keys(INTRO_MARKER).sort()).toEqual(SPECS.map((spec) => spec.key).sort());
	});
});

describe('the splash', () => {
	const html = renderToStaticMarkup(createElement(Splash));

	it('names every registered spec and links each to a route the registry answers', () => {
		expect(SPECS.length, 'only one spec registered — this case proves nothing').toBeGreaterThan(1);
		for (const spec of SPECS) {
			// Both halves of `displayName`, which the card sets on two lines — the spec large and the class
			// under it, because a reader choosing between two specs of one class needs the half that
			// differs to be the one they read first. Asserted as the pair rather than as the joined string,
			// so the layout can move without this going quiet about whether the spec is named at all.
			expect(html, `${spec.key}: specName`).toContain(spec.specName);
			expect(html, `${spec.key}: classKey`).toContain(spec.classKey);
			expect(spec.displayName, `${spec.key}: displayName is those two`).toBe(`${spec.specName} ${spec.classKey}`);
			// The card's icon, off the same spell map every other icon on the page comes from. `null` here
			// would render no image at all, which is a card that says less than the row it replaced.
			expect(spellIconUrl(spec.iconSpellId), `${spec.key}: icon`).not.toBeNull();
			expect(html, `${spec.key}: icon drawn`).toContain(spellIconUrl(spec.iconSpellId)!);
			expect(html, `${spec.key}: route`).toContain(`href="${specRoute(spec)}"`);
			// The other half of "the route resolves": the link is built out of the same two fields the
			// page is built from, so a link that is not `<classSlug>/<key>` is a link to a 404.
			expect(specRoute(spec).endsWith(`/${spec.classSlug}/${spec.key}`), `${spec.key}: route shape`).toBe(true);
			expect(getSpec(spec.key), `${spec.key}: registry`).toBeDefined();
		}
	});

	/**
	 * The half the retired case was right about, kept for the one page it still applies to.
	 *
	 * Listing the specs is the splash's job; *claiming* one is not. The eyebrow and the intro paragraph
	 * are the two strings that say "this page is about a spec", and neither belongs here — a splash
	 * carrying the Windwalker's Tigereye Brew paragraph is a monk page with a shaman link on it.
	 */
	it('claims no spec of its own, in the eyebrow or the intro', () => {
		for (const spec of SPECS) {
			expect(html, `${spec.key}: intro`).not.toContain(INTRO_MARKER[spec.key]);
			expect(html, `${spec.key}: eyebrow`).not.toContain(`Mists of Pandaria · ${spec.specName}`);
		}
	});

	/**
	 * And says nothing with its colour either.
	 *
	 * `global.css` derives eleven colours from `--spec-primary` and defaults it to the monk's green, so
	 * a page that does not set it is a monk-branded page. Both spec-neutral pages set it to
	 * `NEUTRAL_PRIMARY` instead, and the assertions run in both directions: the value is nobody's class
	 * colour, and neither page has a class colour written into it by hand.
	 */
	it('paints both spec-neutral pages a colour no class in the registry uses', () => {
		expect(Object.values(CLASS_COLOR)).not.toContain(NEUTRAL_PRIMARY);
		for (const page of ['index.astro', '404.astro']) {
			const source = readFileSync(resolve(PAGES, page), 'utf8');
			expect(source, `${page}: neutral`).toContain('NEUTRAL_PRIMARY');
			for (const spec of SPECS) expect(source, `${page}: ${spec.key}`).not.toContain(spec.colors.primary);
		}
	});
});

describe('a spec route', () => {
	for (const spec of SPECS) {
		const html = renderToStaticMarkup(createElement(App, { specKey: spec.key }));

		it(`names ${spec.key} in the eyebrow, the heading and the intro`, () => {
			expect(html).toContain(`Mists of Pandaria · ${spec.specName}`);
			expect(html).toContain(`${spec.displayName} analyzer`);
			expect(html).toContain(INTRO_MARKER[spec.key]);
		});

		it(`names no other spec on the ${spec.key} page`, () => {
			const others = SPECS.filter((candidate) => candidate.key !== spec.key);
			expect(others.length, 'only one spec registered — this case proves nothing').toBeGreaterThan(0);
			for (const other of others) {
				expect(html, `${other.key}: specName`).not.toContain(other.specName);
				expect(html, `${other.key}: displayName`).not.toContain(other.displayName);
				expect(html, `${other.key}: intro`).not.toContain(INTRO_MARKER[other.key]);
			}
		});
	}

	/**
	 * The route never falls back, and this is the case that says so out loud.
	 *
	 * A default would be the tempting shape — every other lookup in this app has one — and it is the
	 * one place a default is dangerous: a pull scored against a spec the address did not name is a
	 * report that is confidently wrong at every heading. `getStaticPaths` builds the routes from the
	 * registry so this cannot happen from a link, which is exactly why nothing else would notice if the
	 * fallback came back.
	 */
	it('refuses a key the registry does not answer rather than picking one', () => {
		expect(() => renderToStaticMarkup(createElement(App, { specKey: 'brewmaster' }))).toThrow(/brewmaster/);
	});
});
