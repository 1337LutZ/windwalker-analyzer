// The nav and the sections must not be able to drift apart.
//
// A contents list is the one piece of a report that fails silently: a renamed section, a reordered
// one or a new one leaves the nav rendering yesterday's report, and nothing throws — the links just
// stop landing anywhere. So this asserts the nav against the rendered report rather than against a
// list written out here, which would only be a third copy to keep in step.
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

const html = renderToStaticMarkup(createElement(Report, { analysis }));
const nav = /<nav[^>]*>[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';

const all = (source: string, pattern: RegExp): string[] => [...source.matchAll(pattern)].map((match) => match[1] ?? '');

/** Every fragment the nav points at, in the order the nav lists them. */
const targets = all(nav, /href="#([^"]+)"/g);
/** Every section heading the report rendered, in document order. */
const headings = all(html, /<h2 id="([^"]+)"/g);

describe('SectionNav', () => {
	it('is rendered with the report', () => {
		expect(nav).not.toBe('');
		expect(targets.length).toBeGreaterThan(5);
	});

	/**
	 * Both halves in one assertion, and deliberately an equality rather than a subset: a link with no
	 * heading is a jump to nowhere, a heading with no link is a section the reader cannot reach, and
	 * the same order is what makes the list describe the report's argument instead of scrambling it.
	 */
	it('lists every section that rendered, in document order, and nothing else', () => {
		expect(targets).toEqual(headings);
	});

	/**
	 * The nav asks for the section's own title key, so this catches the key drifting off the section
	 * it names — which would otherwise render a plausible-looking list of the wrong titles.
	 */
	it('calls each section what the section calls itself', () => {
		expect(all(nav, /<a [^>]*>([^<]*)<\/a>/g)).toEqual(all(html, /<h2 id="[^"]+"[^>]*>([^<]*)<\/h2>/g));
	});

	/**
	 * Desktop only. `display: none` rather than a conditional render is what keeps it out of the
	 * accessibility tree as well as off the screen, so a phone gets no phantom tab stops.
	 */
	it('does not render below lg', () => {
		expect(nav).toMatch(/class="[^"]*\bhidden\b/);
	});
});
