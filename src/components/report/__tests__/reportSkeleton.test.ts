// The shape the report is held open in while its events are being fetched.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ReportSkeleton from '../ReportSkeleton';

const html = renderToStaticMarkup(createElement(ReportSkeleton));

describe('ReportSkeleton', () => {
	/**
	 * The one assertion the whole thing exists for: real, named heights. A skeleton that collapses to
	 * nothing reserves nothing, and the report still lands on the page as one several-thousand-pixel
	 * jump — which is the bug, not the fix.
	 */
	it('holds the page open at real heights', () => {
		const heights = [...html.matchAll(/h-\[(\d+)px\]/g)].map((match) => Number(match[1]));
		expect(heights.length).toBeGreaterThan(3);
		// Chart-sized, not text-sized: a section of the report is a chart, and 200px is the shortest
		// any of them draws at.
		expect(Math.min(...heights)).toBeGreaterThanOrEqual(200);
	});

	/**
	 * Decorative, and hidden as a whole rather than a piece at a time. A screen reader is told a fetch
	 * is running once, by `FetchProgress`'s live region; a second voice describing grey rectangles
	 * would only talk over it.
	 */
	it('is hidden from the accessibility tree', () => {
		expect(html).toMatch(/^<div [^>]*aria-hidden="true"/);
	});

	/**
	 * No headings, and this is load-bearing rather than tidiness: `SectionNav` finds the report's
	 * sections by the id on each heading, so a skeleton growing headings would seed the contents list
	 * of the report that is about to replace it with entries pointing at nothing.
	 */
	it('carries no headings for the contents list to find', () => {
		expect(html).not.toMatch(/<h[1-6][\s>]/);
		expect(html).not.toContain('-heading');
	});

	/** And no copy at all, so there is nothing here to translate and nothing to read out. */
	it('says nothing, because the fetch already does', () => {
		expect(html.replaceAll(/<[^>]*>/g, '').trim()).toBe('');
	});

	/** One pulse for the whole skeleton, guarded — the same rule the chart placeholder follows. */
	it('only breathes for a reader who has not asked it to stop', () => {
		expect(html.match(/(?:motion-safe:)?animate-pulse/g)).toEqual(['motion-safe:animate-pulse']);
	});
});
