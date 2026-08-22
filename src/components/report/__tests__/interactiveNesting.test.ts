// The server's markup has to survive being parsed back, or hydration has nothing to match against.
//
// `/preview` hydrated with a React #418 — "the server rendered HTML didn't match the client" — in dev
// and in the production build, at every viewport. It was not a server/client branch, and it was not the
// `matchMedia` reads `useNarrow.test.ts` now bounds: it was one composition. `CastsPerMinute`'s name
// cell wrapped `SpellIcon` in an anchor to the ability's own section, and `SpellIcon` is *itself* an
// anchor, to Wowhead. React renders `<a><a></a></a>` without complaint; **the HTML parser closes the
// open anchor instead of nesting it**. So the DOM the browser handed back had two sibling anchors where
// the client tree had one inside the other, React threw on the first child it could not line up, and it
// discarded the whole island and re-rendered it — which is most of the value of prerendering, on every
// viewport rather than only the narrow one.
//
// **Nothing about either component is wrong on its own**, which is why no unit test of either could
// have caught it and why this is a sweep rather than an assertion. `ItemIcon` already carries the rule
// as a comment — "an anchor cannot be nested inside another one", which is why its gems are siblings of
// the item link rather than children of it — and a comment is exactly as strong as the next person who
// reads it. This is that comment as a test: every committed pull, rendered through the same
// `PreviewSwitcher` the page hands to the island, scanned for the nestings a parser will not keep.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import PreviewSwitcher from '~/components/PreviewSwitcher';
import { initI18n } from '~/lib/i18n/config';
import type { Analysis, FightDataset } from '~/lib/types';
import { analyse as analyseElemental } from '~/specs/elemental';
import { analyse as analyseWindwalker } from '~/specs/windwalker';

initI18n();

/**
 * The tags a parser closes on sight of themselves, so a tree that nests one is a tree no browser can
 * reproduce.
 *
 * **This is a hydration rule, not an HTML-validity one, and the difference is the whole reason the set
 * is three tags long.** An anchor inside a *button* is also invalid HTML — interactive content inside
 * interactive content — but the parser keeps that tree exactly as written, so React hydrates it without
 * complaint and it costs nothing at hydration time. It is an accessibility fault to be argued about
 * where the markup lives; it is not this file's business, and a sweep that conflated the two would fail
 * on markup that hydrates perfectly and teach the next reader to widen the ledger rather than fix the
 * bug. What is in here is only what the parser *rewrites*: those, and only those, make the served HTML
 * a different tree from the one React built.
 *
 * `\b` after each name is what keeps `<article>`, `<aside>` and `<abbr>` out of the anchor case.
 */
const SELF_CLOSING_ON_SIGHT = ['a', 'button', 'form'] as const;
const TAGS = new RegExp(`<(/?)(${SELF_CLOSING_ON_SIGHT.join('|')})\\b`, 'g');

/** Where the offending tag sits, with enough of its surroundings to name the component. */
const around = (html: string, at: number): string => html.slice(Math.max(0, at - 240), at + 160);

/**
 * Every one of those tags this markup opens while one of the same name is still open.
 *
 * A stack rather than a regex over the whole string, because "inside" is the claim and depth is the
 * only way to see it. React's serialiser always closes what it opens, so popping on a close tag is
 * enough — there is no parser recovery to reproduce here, only the tree as written.
 */
function reparsedNesting(html: string): string[] {
	const found: string[] = [];
	const open: string[] = [];
	for (const match of html.matchAll(TAGS)) {
		const tag = match[2] ?? '';
		if (match[1] === '/') {
			const at = open.lastIndexOf(tag);
			if (at !== -1) open.splice(at, 1);
		} else {
			if (open.includes(tag)) found.push(`<${tag}> inside <${tag}>: …${around(html, match.index)}…`);
			open.push(tag);
		}
	}
	return found;
}

/**
 * The pulls, taken from the fixture directories rather than listed.
 *
 * A list would be the thing that goes stale: the next captured pull would be swept by nothing, and the
 * omission would look exactly like a pull that passes. Discriminated by shape rather than by filename
 * — a stored `Analysis` carries `specName` and a raw `FightDataset` does not — so a capture committed
 * in either form is covered without this file having to know which form it is in.
 */
function pulls(): Array<[string, Analysis]> {
	const specs = [
		{ dir: 'windwalker', analyse: analyseWindwalker },
		{ dir: 'elemental', analyse: analyseElemental },
	] as const;
	return specs.flatMap(({ dir, analyse }) => {
		const root = resolve(import.meta.dirname, '../../../specs', dir, '__fixtures__');
		return readdirSync(root)
			.filter((file) => file.endsWith('.json'))
			.map((file): [string, Analysis] => {
				const raw = JSON.parse(readFileSync(resolve(root, file), 'utf8')) as Record<string, unknown>;
				const analysis = 'specName' in raw ? (raw as unknown as Analysis) : analyse(raw as unknown as FightDataset);
				return [`${dir}/${file.replace(/\.json$/, '')}`, analysis];
			});
	});
}

const PULLS = pulls();

/** Exactly what `preview.astro` hands the island, one pull at a time — `PreviewSwitcher` shows the first. */
const markup = (name: string, analysis: Analysis): string =>
	renderToStaticMarkup(createElement(PreviewSwitcher, { fixtures: { [name]: analysis } }));

describe('the served report is the tree a browser parses back', () => {
	it.each(PULLS)('%s', (name, analysis) => {
		expect(reparsedNesting(markup(name, analysis)), name).toEqual([]);
	});
});

describe('the sweep above is not vacuous', () => {
	it('sees the nesting it is looking for, and does not see siblings', () => {
		expect(reparsedNesting('<a href="#x"><a href="#y"></a></a>')).toHaveLength(1);
		expect(reparsedNesting('<a href="#x"></a><a href="#y"></a>')).toEqual([]);
		expect(reparsedNesting('<button><button></button></button>')).toHaveLength(1);
		// The tags a bare `<a` would swallow, and the ones this sweep deliberately leaves alone: an
		// anchor inside a button survives the parse, so it is not a hydration fault. See the note above.
		expect(reparsedNesting('<a href="#x"><article><aside><abbr></abbr></aside></article></a>')).toEqual([]);
		expect(reparsedNesting('<button><a href="#x"></a></button>')).toEqual([]);
	});

	it('renders every committed pull, and each one really does draw anchors', () => {
		// A pull that rendered nothing would satisfy the sweep, and so would a fixture directory this
		// file failed to find. Both fixture dirs are covered, and every pull draws the links the report
		// is built from — the contents list alone is a dozen of them.
		expect(PULLS.length).toBeGreaterThan(6);
		expect(new Set(PULLS.map(([name]) => name.split('/')[0]))).toEqual(new Set(['windwalker', 'elemental']));
		for (const [name, analysis] of PULLS) {
			expect(markup(name, analysis).match(/<a\b/g)?.length ?? 0, name).toBeGreaterThan(5);
		}
	});
});
