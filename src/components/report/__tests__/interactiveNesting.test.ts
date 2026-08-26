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
import { SPECS } from '~/lib/spec';
import type { Analysis, FightDataset } from '~/lib/types';

initI18n();

/**
 * The tags a parser closes on sight of themselves, so a tree that nests one is a tree no browser can
 * reproduce.
 *
 * **This is a hydration rule, and it is deliberately not the same rule as the one below.** What is in
 * here is only what the parser *rewrites*: those, and only those, make the served HTML a different tree
 * from the one React built, which is the fault that discards a hydrated island. An anchor inside a
 * *button* is invalid HTML too, but the parser keeps that tree exactly as written and React hydrates it
 * without complaint — so it is a real fault of a different kind, swept separately and reported in its
 * own words rather than folded in here. Two rules, two failures, because a reader who sees one of them
 * needs to know which one they are looking at.
 *
 * `\b` after each name is what keeps `<article>`, `<aside>` and `<abbr>` out of the anchor case.
 */
const SELF_CLOSING_ON_SIGHT = ['a', 'button', 'form'] as const;
const TAGS = new RegExp(`<(/?)(${SELF_CLOSING_ON_SIGHT.join('|')})\\b`, 'g');

/**
 * The tags that are interactive content, which may not contain each other however the parser feels
 * about it.
 *
 * A link inside a button is not a hydration fault — that is the whole point of the note above — but it
 * is still a control the reader cannot use. The anchor is unreachable as a link, and a pointer press
 * lands on both: the browser follows the href *and* the click bubbles to the button, so one press does
 * two things and nothing on screen said it would.
 *
 * `rotation/FlowNode.tsx` had twelve of these per pull, from a `SpellIcon` — an anchor to Wowhead —
 * sitting inside a disclosure's `<button>`. **This sweep was added after that was fixed and not
 * before**, which is the only order that works: a guard landed over known-failing markup is a guard
 * somebody skips.
 *
 * `form` is not in here. It cannot legally contain another form and the sweep above already says so;
 * it is not interactive content, so it has no business in this rule. Void tags stay out for a
 * mechanical reason as well as a semantic one — `<input>` never emits a close tag, so a stack would
 * never pop it.
 */
const INTERACTIVE = ['a', 'button'] as const;
const INTERACTIVE_TAGS = new RegExp(`<(/?)(${INTERACTIVE.join('|')})\\b`, 'g');

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
 * Every interactive element this markup opens while another one is still open, whichever tags they are.
 *
 * The same stack as above, over one set rather than one tag at a time: "inside" is again the claim and
 * depth is again the only way to see it. The innermost still-open ancestor is the one named, because it
 * is the one that makes the press ambiguous.
 */
function interactiveNesting(html: string): string[] {
	const found: string[] = [];
	const open: string[] = [];
	for (const match of html.matchAll(INTERACTIVE_TAGS)) {
		const tag = match[2] ?? '';
		if (match[1] === '/') {
			const at = open.lastIndexOf(tag);
			if (at !== -1) open.splice(at, 1);
		} else {
			const inside = open.at(-1);
			if (inside !== undefined) found.push(`<${tag}> inside <${inside}>: …${around(html, match.index)}…`);
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
	// **The specs come off the registry rather than out of a literal here**, which is the same argument
	// this function already makes about fixture files one level down. A list of two spec names was
	// exactly the thing that goes stale: the Protection Paladin shipped a whole report — five captures,
	// a cast log, a pull timeline with a per-enemy picker in it — and every anchor and button on it was
	// swept by nothing, while the omission looked identical to a spec that passes. `specVocabulary.test.ts`
	// reads `SPECS` for the same reason and its header says so. The claim about *which* specs is not lost;
	// it moves to an assertion in the non-vacuity block below, where a reader can see it.
	return SPECS.flatMap((spec) => {
		const root = resolve(import.meta.dirname, '../../../specs', spec.key, '__fixtures__');
		return readdirSync(root)
			.filter((file) => file.endsWith('.json'))
			.map((file): [string, Analysis] => {
				const raw = JSON.parse(readFileSync(resolve(root, file), 'utf8')) as Record<string, unknown>;
				const analysis =
					'specName' in raw ? (raw as unknown as Analysis) : spec.analyse(raw as unknown as FightDataset);
				return [`${spec.key}/${file.replace(/\.json$/, '')}`, analysis];
			});
	});
}

const PULLS = pulls();

/** Exactly what `preview.astro` hands the island, one pull at a time — `PreviewSwitcher` shows the first. */
/**
 * The whole report as a browser would receive it, rendered once per pull and kept.
 *
 * Memoised because it is not cheap and this file asks for it three times per pull: twice in the sweep
 * below and once in each of the two `it.each` blocks. Rendering fifteen committed pulls three times over
 * had the sweep at 4.6s against vitest's 5s default with the machine to itself, so it was one added
 * section away from a timeout that would read as a hydration fault rather than as a slow test — and the
 * Protection report gaining its priority ladder was that section.
 */
const rendered = new Map<string, string>();
const markup = (name: string, analysis: Analysis): string => {
	const had = rendered.get(name);
	if (had !== undefined) return had;
	const html = renderToStaticMarkup(createElement(PreviewSwitcher, { fixtures: { [name]: analysis } }));
	rendered.set(name, html);
	return html;
};

describe('the served report is the tree a browser parses back', () => {
	it.each(PULLS)('%s', (name, analysis) => {
		expect(reparsedNesting(markup(name, analysis)), name).toEqual([]);
	});
});

describe('no control in the served report contains another one', () => {
	it.each(PULLS)('%s', (name, analysis) => {
		expect(interactiveNesting(markup(name, analysis)), name).toEqual([]);
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

	it('sees a control inside a control, at any depth, and does not see siblings', () => {
		expect(interactiveNesting('<button><a href="#x"></a></button>')).toHaveLength(1);
		// The shape `FlowNode` actually had: the icon's anchor a couple of spans down inside the button.
		expect(interactiveNesting('<button><span><span><a href="#x"></a></span></span></button>')).toHaveLength(1);
		expect(interactiveNesting('<a href="#x"><button></button></a>')).toHaveLength(1);
		expect(interactiveNesting('<button></button><a href="#x"></a>')).toEqual([]);
		expect(interactiveNesting('<a href="#x"><article><abbr></abbr></article></a>')).toEqual([]);
	});

	it('renders every committed pull, and each one really does draw anchors', () => {
		// A pull that rendered nothing would satisfy the sweep, and so would a fixture directory this
		// file failed to find. All three fixture dirs are covered, and every pull draws the links the
		// report is built from — the contents list alone is a dozen of them.
		expect(PULLS.length).toBeGreaterThan(6);
		expect(new Set(PULLS.map(([name]) => name.split('/')[0]))).toEqual(
			new Set(['windwalker', 'elemental', 'protection']),
		);
		for (const [name, analysis] of PULLS) {
			expect(markup(name, analysis).match(/<a\b/g)?.length ?? 0, name).toBeGreaterThan(5);
			// And the buttons, for the same reason: a sweep for a link inside a button has said nothing at
			// all about a page that rendered no buttons. Every pull draws the section nav and the chart's
			// own controls.
			expect(markup(name, analysis).match(/<button\b/g)?.length ?? 0, name).toBeGreaterThan(5);
		}
	});
});
