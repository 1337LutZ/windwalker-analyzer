// The three pieces of the segment tool that are not somebody else's code.
//
// The page reuses the session, the fetch, the analysis and `SegmentStrip` wholesale, so what is worth
// testing is the join: the codes a person pastes, the enemy roster the page derives because the analysis
// does not carry it, and the tooltip that roster ends up in.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import SegmentStrip from '~/components/sections/SegmentStrip';
import { nextHref, parseCodes, readParams, targetsInSegments } from '~/components/FightSegments';
import { initI18n } from '~/lib/i18n/config';
import type { Analysis, FightDataset } from '~/lib/types';
import { analyse } from '~/specs/elemental/lib';

initI18n();

const dataset = JSON.parse(
	readFileSync(resolve(import.meta.dirname, '../../specs/elemental/__fixtures__/cleave.json'), 'utf8'),
) as FightDataset;
const analysis = analyse(dataset) as Analysis;

describe('the codes a person pastes', () => {
	it('takes commas, whitespace and pasted URLs alike', () => {
		expect(parseCodes('abc, def')).toEqual(['abc', 'def']);
		expect(parseCodes(' abc \n def\tghi ')).toEqual(['abc', 'def', 'ghi']);
		expect(parseCodes('https://classic.warcraftlogs.com/reports/XJ83wN9h1GQqP4tY?fight=16')).toEqual([
			'XJ83wN9h1GQqP4tY',
		]);
	});

	/** A list pasted twice is one report, not two fetches of it. */
	it('drops duplicates and empties', () => {
		expect(parseCodes('abc,,abc, ,abc')).toEqual(['abc']);
		expect(parseCodes('   ')).toEqual([]);
	});
});

describe('the enemies a segment was spent on', () => {
	const segments = analysis.segments?.segments ?? [];

	/** The premise: this is a pull with segments and more than one enemy in it. */
	it('is derived for a pull that has enemies to name', () => {
		expect(segments.length).toBeGreaterThan(1);
		const roster = targetsInSegments(dataset, segments);
		expect(roster.size).toBeGreaterThan(0);
	});

	/**
	 * Every name is a real actor and every count is a real count.
	 *
	 * The guard against the join drifting: an id the report does not name would print as `#123`, which is
	 * the shape a wrong actor map produces and the one thing a roster must never do silently.
	 */
	it('names actors rather than printing ids', () => {
		const roster = targetsInSegments(dataset, segments);
		for (const [index, text] of roster) {
			expect(text, `segment ${index}`).not.toMatch(/#\d/);
			expect(text, `segment ${index}`).toMatch(/\(\d+\)/);
		}
	});

	/** A segment nobody hit anything in has no entry, rather than an empty string. */
	it('says nothing about a segment with no damage in it', () => {
		const idle = segments.filter((segment) => segment.mode === 'idle');
		const roster = targetsInSegments(dataset, segments);
		for (const segment of idle) expect(roster.get(segment.index)).toBeUndefined();
	});
});

describe('the roster reaching the strip', () => {
	/**
	 * `detailOf` is optional, and the report page does not pass it — so the tooltip has to be unchanged
	 * without one and carry the third line with one. Both are asserted, because a default that quietly
	 * appended an empty line would pass a test that only looked at the second case.
	 */
	it('adds the roster as a third tooltip line, and only when asked', () => {
		const plain = renderToStaticMarkup(createElement(SegmentStrip, { analysis }));
		expect(plain).not.toContain('Kor&#x27;kron');

		const marked = renderToStaticMarkup(
			createElement(SegmentStrip, { analysis, detailOf: () => 'Automated Shredder (12)' }),
		);
		expect(marked).toContain('Automated Shredder (12)');
		// The first two lines survive: the detail is added to the tooltip, not substituted for it.
		expect(marked).toMatch(/title="[^"]*\n[^"]*\nAutomated Shredder \(12\)"/);
	});
});

describe('the form in the address bar', () => {
	it('reads both fields back, and tolerates neither being there', () => {
		expect(readParams('?reports=abc,def&player=Sparkstorm')).toEqual({ reports: 'abc,def', player: 'Sparkstorm' });
		expect(readParams('')).toEqual({ reports: '', player: '' });
		expect(readParams('?player=Sparkstorm')).toEqual({ reports: '', player: 'Sparkstorm' });
	});

	it('writes what was typed, trimmed', () => {
		const href = nextHref('https://x.test/fight-segments', { reports: ' abc , def ', player: ' Sparkstorm ' });
		expect(readParams(new URL(href).search)).toEqual({ reports: 'abc , def', player: 'Sparkstorm' });
	});

	/**
	 * An empty field is removed rather than written blank. A parameter carrying nothing survives a
	 * copy-paste and looks like an answer, which is worse than its absence.
	 */
	it('drops an empty field instead of writing it blank', () => {
		const href = nextHref('https://x.test/fight-segments?reports=abc&player=Old', { reports: 'abc', player: '   ' });
		expect(new URL(href).searchParams.has('player')).toBe(false);
		expect(new URL(href).searchParams.get('reports')).toBe('abc');
	});

	/** Anything else in the query survives a run — a future flag, or an anchor. */
	it('leaves the rest of the URL alone', () => {
		const href = nextHref('https://x.test/fight-segments?keep=1#somewhere', { reports: 'abc', player: 'S' });
		expect(new URL(href).searchParams.get('keep')).toBe('1');
		expect(new URL(href).hash).toBe('#somewhere');
	});
});
