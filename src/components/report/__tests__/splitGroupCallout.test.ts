// The sentence a split actually puts in front of a reader.
//
// `lib/game/__tests__/splitGroups.test.ts` holds the detection — which pull is a split and on what
// evidence — and this holds the half a detection cannot assert about itself: that each of the three
// findings reaches a page as English, with its numbers in it and the right arm of its plural chosen.
//
// Rendered rather than inspected, because both failures here are visible only in the output. A key
// with no copy behind it renders as its own key, and an interpolation the copy does not name renders
// as nothing at all — a callout that says "You went up the towers times" is a green test away.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { initI18n } from '~/lib/i18n/config';
import type { SplitGroup } from '~/lib/game/splitGroups';

import SplitGroupCallout from '../SplitGroupCallout';

initI18n();

/** The visible text of one rendering, with the tags taken out and the entities put back. */
const text = (split: SplitGroup | null): string =>
	renderToStaticMarkup(createElement(SplitGroupCallout, { split }))
		.replaceAll(/<[^>]*>/g, ' ')
		.replaceAll('&#x27;', "'")
		.replaceAll('&amp;', '&')
		.replaceAll(/\s+/g, ' ')
		.trim();

describe('the callout', () => {
	it('draws nothing at all on a pull the raid fought together', () => {
		expect(renderToStaticMarkup(createElement(SplitGroupCallout, { split: null }))).toBe('');
		expect(renderToStaticMarkup(createElement(SplitGroupCallout, { split: undefined }))).toBe('');
	});

	// The Windwalker of `a:6MhZgjyAknFWrYfK` fight 10, to the numbers the engine reports for that pull.
	it('counts the tower runs and clocks them', () => {
		const said = text({
			kind: 'towerRuns',
			share: 0.013,
			windows: [
				[160_315, 178_648],
				[310_535, 335_950],
			],
			awayMs: 43_748,
			partedYards: null,
			name: null,
		});
		expect(said).toContain('Tower duty');
		expect(said).toContain('You went up the towers 2 times');
		expect(said).toContain('43.7s');
		// The sentence points at a word the reader can see on their own timeline, which is the whole
		// job of it: the tower stretch is the pull's least coherent segment and is not a fumbled one.
		expect(said).toContain('stretches that read as mixed');
	});

	// One run reads as one run, which is the arm the Protection Paladin of `protection/galakras.json`
	// gets. A count of 1 through the plural arm above would render "the towers 1 times".
	it('speaks of one tower in the singular', () => {
		const said = text({
			kind: 'towerRuns',
			share: 0.044,
			windows: [[280_000, 291_400]],
			awayMs: 11_400,
			partedYards: null,
			name: null,
		});
		expect(said).toContain('You went up a tower for 11.4s');
		expect(said).toContain('stretch that reads as mixed');
		expect(said).not.toContain('times');
	});

	it('names belt duty and says the report is the wrong tool for it', () => {
		const said = text({
			kind: 'belt',
			share: 1,
			windows: [
				[13_000, 23_000],
				[54_000, 74_000],
			],
			awayMs: 30_000,
			partedYards: null,
			name: null,
		});
		expect(said).toContain('Belt duty');
		expect(said).toContain('nothing below is a fair read of how you played');
		expect(said).toContain('the analyzer is not optimised for this');
	});

	/**
	 * The measured arm, which is the one the damage share cannot reach.
	 *
	 * It leads with the distance and names no boss, so there is no `unnamed` twin of it to keep.
	 */
	it('leads with the yards when the pair was measured standing apart', () => {
		const said = text({
			kind: 'splitPair',
			share: 0.593,
			windows: [],
			awayMs: 0,
			partedYards: 170,
			name: 'Earthbreaker Haromm',
		});
		expect(said).toContain('Split bosses');
		expect(said).toContain('You spent this pull on Earthbreaker Haromm');
		expect(said).toContain('tanked 170 yards away');
		expect(said).not.toContain('59%');
	});

	it('names the boss a split group held, and holds the sentence up without one', () => {
		const held: SplitGroup = {
			kind: 'splitPair',
			share: 0.99,
			windows: [],
			awayMs: 0,
			partedYards: null,
			name: 'Earthbreaker Haromm',
		};
		expect(text(held)).toContain('Earthbreaker Haromm took 99% of your damage');
		// The report's actor list names every enemy in its own stream, so the unnamed arm is a guard
		// rather than an observed case — and a guard that rendered `{{name}}` empty would read as a
		// sentence with a word missing.
		const unnamed = text({ ...held, name: null });
		expect(unnamed).toContain('One of the two bosses took 99%');
		expect(unnamed).not.toContain('took 99% of your damage to the two bosses');
	});
});
