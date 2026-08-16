import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Analysis } from '~/lib/types';

import Report from '../Report';

const fx = (n: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../lib/__fixtures__/${n}.json`), 'utf8'));

/**
 * The reported bug, end to end: a 10 Heroic pull was labelled "25 Normal".
 *
 * These fixtures were captured through the real pipeline after the fix, so they carry the API's own
 * `size` and difficulty name — which makes this a check on the whole chain (query → client → analysis
 * → header) rather than on the formatter alone, which `components/__tests__/format.test.ts` covers.
 */
describe('report header difficulty', () => {
	it('labels a 10 Heroic pull as 10 Heroic', () => {
		const html = renderToStaticMarkup(createElement(Report, { analysis: fx('poor'), targetChoice: 'auto' }));
		expect(html).toContain('10 Heroic');
		expect(html).not.toContain('25 Normal');
	});
	it('labels a 25 Heroic pull as 25 Heroic', () => {
		const html = renderToStaticMarkup(createElement(Report, { analysis: fx('strong'), targetChoice: 'auto' }));
		expect(html).toContain('25 Heroic');
	});
});

/**
 * The reading still reaches the top of the report.
 *
 * The control that sets it is on the sticky toolbar now, which is a sibling of the report rather than
 * a child, so the state lifted to `ReportFlow` and arrives here as a prop. The thing that must not
 * have changed in the move is that the choice re-grades everything: the summary tiles and the
 * takeaways read the same scorecard the detail below them does, and the scorecard is a function of
 * this value. Prop drilling looks equivalent to local state right up until a provider ends up on the
 * wrong side of it, so this is asserted rather than assumed.
 *
 * **`strong`, and the fixture matters — this used to be `waves` and passed by accident.** What reaches
 * the summary from the reading is the mode's weights, and they arrive two ways. One is the headline
 * verdict, a weighted mean, which only moves the markup when a pull's mean happens to straddle a band
 * edge; `waves` did, at 73.1% read single and exactly 75.0% read multi, so the two renders differed by
 * one word and the guarantee rested on that coincidence. Adding a single measurable metric anywhere in
 * the model moved both readings into the same band and the test went out — with nothing broken.
 *
 * The other way is the short list's own ranking, which is structural: `MULTI_TARGET_WEIGHTS` drops
 * Rising Sun Kick uptime from 2 to 1, so a pull whose cards are separated by weight rather than by
 * grade deals them in a different order under the two readings. `strong` is that pull — three cards,
 * all `ok`, and the kick trades places with the globals — so this now fails only if the chain actually
 * breaks. It is detected `single`, which is why `auto` agrees with `single` here rather than `multi`.
 */
describe('target mode reaches the summary', () => {
	/**
	 * The summary section itself: from the `<section>` that names it down to the first heading under
	 * it. Matched on the attributes rather than on the bare ids, which the contents list also carries
	 * — a slice taken from those would be two nav links and would compare equal whatever the reading.
	 */
	const summary = (analysis: Analysis, targetChoice: 'auto' | 'single' | 'multi'): string => {
		const html = renderToStaticMarkup(createElement(Report, { analysis, targetChoice }));
		const from = html.indexOf('aria-labelledby="summary-heading"');
		const to = html.indexOf('id="cast-log-heading"');
		expect(from, 'no summary section in the report').toBeGreaterThan(-1);
		expect(to, 'no section after the summary').toBeGreaterThan(from);
		return html.slice(from, to);
	};

	it('re-grades the summary when the reader forces the other reading', () => {
		const strong = fx('strong');
		expect(summary(strong, 'single')).not.toBe(summary(strong, 'multi'));
	});

	it('leaves auto reading the pull the way the pull was detected', () => {
		const strong = fx('strong');
		expect(strong.targets?.detected).toBe('single');
		expect(summary(strong, 'auto')).toBe(summary(strong, 'single'));
		expect(summary(strong, 'auto')).not.toBe(summary(strong, 'multi'));
	});

	/** And the report no longer renders the control, which is the half of the move that could rot. */
	it('does not render the control it used to own', () => {
		const html = renderToStaticMarkup(createElement(Report, { analysis: fx('waves'), targetChoice: 'auto' }));
		expect(html).not.toContain('radiogroup');
	});
});
