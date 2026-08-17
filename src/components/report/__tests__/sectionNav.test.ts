// The nav and the sections must not be able to drift apart.
//
// A contents list is the one piece of a report that fails silently: a renamed section, a reordered
// one or a new one leaves the nav rendering yesterday's report, and nothing throws — the links just
// stop landing anywhere. So this asserts the nav against the rendered report rather than against a
// list written out here, which would only be a third copy to keep in step.
//
// Grouping gives that the same treatment. The groups are not listed here either: they are read back
// out of the rendered nav and checked against the report, so a section filed under a group that was
// deleted, or under none at all, fails here rather than going quietly missing from the sidebar.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Analysis } from '~/lib/types';

import Report from '../../Report';

const analysis: Analysis = JSON.parse(
	readFileSync(resolve(import.meta.dirname, '../../../lib/__fixtures__/strong.json'), 'utf8'),
);

const html = renderToStaticMarkup(createElement(Report, { analysis, targetChoice: 'auto' }));
const xuenTalent = JSON.parse(
	readFileSync(resolve(import.meta.dirname, '../../../lib/__fixtures__/mixed.json'), 'utf8'),
) as Analysis;
const xuenHtml = renderToStaticMarkup(createElement(Report, { analysis: xuenTalent, targetChoice: 'auto' }));
const nav = /<nav[^>]*>[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';

const all = (source: string, pattern: RegExp): string[] => [...source.matchAll(pattern)].map((match) => match[1] ?? '');

/** Every fragment the nav points at, in the order the nav lists them. */
const targets = all(nav, /href="#([^"]+)"/g);
/**
 * Every heading the report rendered, in document order.
 *
 * `h1` as well as `h2`: the summary at the top of the report is a nav entry with no section heading
 * of its own — the report's own title is what it jumps to — so the anchor it offers is that `<h1>`.
 */
const headings = all(html, /<h[12] id="([^"]+)"/g);

/**
 * The nav's groups, in the order they are listed, each with the panel it opens.
 *
 * A group's panel holds only links, so a non-greedy match to the first `</ol>` is exact rather than
 * approximate — there is no nesting inside it to fall foul of.
 */
const groups = [...nav.matchAll(/<ol id="nav-group-([^"]+)"([^>]*)>([\s\S]*?)<\/ol>/g)].map((match) => ({
	key: match[1] ?? '',
	attributes: match[2] ?? '',
	targets: all(match[3] ?? '', /href="#([^"]+)"/g),
}));

const buttons = [...nav.matchAll(/<button([^>]*)>/g)].map((match) => match[1] ?? '');

describe('SectionNav', () => {
	it('is rendered with the report', () => {
		expect(nav).not.toBe('');
		expect(targets.length).toBeGreaterThan(5);
	});

	/**
	 * A link with no heading is a jump to nowhere and a heading with no link is a section the reader
	 * cannot reach, so this stays an equality — and it is a sequence rather than a set now that
	 * document order follows the sidebar's grouping. The nav reaches the sections in exactly the order
	 * the report renders them, so the two lists differing anywhere, in membership or in order, is the
	 * bug this catches. It used to be compared unordered because the two deliberately disagreed about
	 * one section; they no longer disagree about any.
	 */
	it('lists every section that rendered, in the order the report renders them', () => {
		expect(targets).toEqual(headings);
	});

	/** Nothing is listed twice — a section folded into two groups would still pass the set above. */
	it('lists each section exactly once', () => {
		expect(new Set(targets).size).toBe(targets.length);
	});

	/**
	 * Every section is filed, and the summary is the only entry standing outside the groups: it is the
	 * way back to the top of the report, so it must never be behind a disclosure. A section added
	 * without a group fails the type check first — this is what catches one filed under `null` to get
	 * past it.
	 */
	it('puts every section in a group, and only the summary outside one', () => {
		const grouped = new Set(groups.flatMap((group) => group.targets));
		expect(targets.filter((target) => !grouped.has(target))).toEqual(['summary-heading']);
	});

	/** Reading down a group is still reading down the report. */
	it('keeps each group in document order', () => {
		for (const group of groups) {
			const positions = group.targets.map((target) => headings.indexOf(target));
			expect(positions, group.key).toEqual([...positions].sort((a, b) => a - b));
		}
	});

	/** And the groups themselves are ordered by where each one starts in the report. */
	it('lists the groups in the order the report reaches them', () => {
		const starts = groups.map((group) => Math.min(...group.targets.map((target) => headings.indexOf(target))));
		expect(starts).toEqual([...starts].sort((a, b) => a - b));
	});

	/**
	 * Each group is one unbroken run of the report, which is the invariant the two above only imply
	 * halves of: a group could be in document order and start in the right place while still having
	 * another group's sections printed through the middle of it. `foldIntoGroups` copes with that
	 * silently — it lists the scattered group once, at its first section — so nothing else would fail,
	 * and the page and the sidebar would quietly stop reading in the same order.
	 */
	it('keeps each group contiguous in the report', () => {
		for (const group of groups) {
			const positions = group.targets.map((target) => headings.indexOf(target));
			const first = Math.min(...positions);
			expect(positions, group.key).toEqual(positions.map((_, index) => first + index));
		}
	});

	/**
	 * The nav asks for the section's own title key, so this catches the key drifting off the section
	 * it names — which would otherwise render a plausible-looking list of the wrong titles. Matched by
	 * id rather than by position, so it says which section is misnamed rather than that something is.
	 */
	it('calls each section what the section calls itself', () => {
		const titles = new Map(
			[...html.matchAll(/<h2 id="([^"]+)"[^>]*>([^<]*)<\/h2>/g)].map((match) => [match[1] ?? '', match[2] ?? '']),
		);
		const links = [...nav.matchAll(/<a href="#([^"]+)"[^>]*>([^<]*)<\/a>/g)].map((match) => [
			match[1] ?? '',
			match[2] ?? '',
		]);
		// The summary is the exception and the only one: its link reads "Summary" while the heading it
		// points at is the report's title — the encounter and the player.
		const wrong = links.filter(([id, text]) => id !== 'summary-heading' && titles.get(id ?? '') !== text);
		expect(wrong).toEqual([]);
	});

	/** The summary leads, because it is the top of the report and the thing a reader returns to. */
	it('offers the summary first', () => {
		expect(targets[0]).toBe('summary-heading');
		expect(all(nav, /<a [^>]*>([^<]*)<\/a>/g)[0]).toBe('Summary');
	});

	/**
	 * Each group is a real disclosure: a `<button>` that says whether it is open and names the panel it
	 * opens, rather than a div with a click handler. `aria-controls` is checked against the panels that
	 * actually rendered, so a button pointing at nothing fails here.
	 */
	it('opens each group with a button wired to its panel', () => {
		expect(buttons.length).toBe(groups.length);
		expect(buttons.every((button) => /\btype="button"/.test(button))).toBe(true);
		expect(buttons.map((button) => /aria-controls="([^"]+)"/.exec(button)?.[1])).toEqual(
			groups.map((group) => `nav-group-${group.key}`),
		);
		expect(buttons.map((button) => /aria-expanded="([^"]+)"/.exec(button)?.[1])).toEqual(
			groups.map((group) => String(!/\bhidden\b/.test(group.attributes))),
		);
	});

	/**
	 * A shut group is `hidden`, which is what keeps its links out of the tab order and out of the
	 * accessibility tree at the same time. Without the attribute they would still be tabbable while
	 * invisible, which is the classic disclosure bug.
	 */
	it('hides every group but the first before anyone opens one', () => {
		expect(groups.map((group) => /\bhidden\b/.test(group.attributes))).toEqual(groups.map((_, index) => index > 0));
	});

	/** No group renders as a heading with nothing under it. */
	it('renders no empty group', () => {
		expect(groups.filter((group) => group.targets.length === 0)).toEqual([]);
	});

	it('hides the level-90 section whose talent was not taken', () => {
		expect(targets).toContain('jade-wind-heading');
		expect(targets).not.toContain('xuen-heading');

		const xuenTargets = all(xuenHtml, /<h[12] id="([^"]+)"/g);
		expect(xuenTargets).toContain('xuen-heading');
		expect(xuenTargets).not.toContain('jade-wind-heading');
	});

	/**
	 * Desktop only. `display: none` rather than a conditional render is what keeps it out of the
	 * accessibility tree as well as off the screen, so a phone gets no phantom tab stops.
	 */
	it('does not render below lg', () => {
		expect(nav).toMatch(/class="[^"]*\bhidden\b/);
	});
});
