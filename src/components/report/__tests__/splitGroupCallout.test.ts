// The sentence a split actually puts in front of a reader.
//
// `lib/game/__tests__/splitGroups.test.ts` holds the detection, which pull is a split and on what
// evidence, and this holds the half a detection cannot assert about itself: that each of the three
// findings reaches a page as English, under its own title, saying the one thing it is there to say.
//
// Rendered rather than inspected, because the failure is visible only in the output: a key with no
// copy behind it renders as its own key, and `t('splitGroup.belt')` on a page is not a green test
// away from `t(COPY[split.kind])` on a page.

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

	/**
	 * One title and one sentence per kind, and no figure in either.
	 *
	 * The three findings carry run counts, seconds away, damage shares and the yards between two bosses;
	 * none of it reaches the reader. `SplitGroupCallout`'s own docblock argues why. What this pins is the
	 * consequence: the rendering depends on `kind` and on nothing else, so a finding whose measurements
	 * differ wildly still says the same thing.
	 */
	it('says one thing per kind, whatever the finding measured', () => {
		const heavy: SplitGroup = {
			kind: 'towerRuns',
			share: 0.13,
			windows: [
				[160_000, 178_000],
				[310_000, 335_000],
			],
			awayMs: 43_748,
			partedYards: null,
			name: null,
		};
		const light: SplitGroup = { ...heavy, share: 0.003, windows: [[0, 8000]], awayMs: 8000 };
		expect(text(heavy)).toContain('Tower duty');
		expect(text(heavy)).toContain('You were assigned tower duty');
		expect(text(heavy)).toBe(text(light));
		// And nothing the finding measured leaks into the sentence.
		expect(text(heavy)).not.toMatch(/\d/);
	});

	it('names belt duty and says the analyzer is the wrong tool for it', () => {
		const said = text({
			kind: 'belt',
			share: 1,
			windows: [[13_000, 23_000]],
			awayMs: 10_000,
			partedYards: null,
			name: null,
		});
		expect(said).toContain('Belt duty');
		expect(said).toContain('improve your belt play');
		expect(said).toContain('the analyzer is not optimised for this');
	});

	/**
	 * Both arms of the pair reach the same sentence, which is the point of collapsing them.
	 *
	 * One was found by the damage share and one by measuring the two bosses a hundred and seventy yards
	 * apart. They are different evidence about the same pull-shape, and a reader who cannot be graded
	 * does not need to know which of the two caught them.
	 */
	it('says the same thing however the split was found', () => {
		const byShare: SplitGroup = {
			kind: 'splitPair',
			share: 0.99,
			windows: [],
			awayMs: 0,
			partedYards: null,
			name: 'Earthbreaker Haromm',
		};
		const byDistance: SplitGroup = { ...byShare, share: 0.593, partedYards: 170 };
		expect(text(byShare)).toContain('Split bosses');
		expect(text(byShare)).toContain('You fought one of the two bosses');
		expect(text(byShare)).toBe(text(byDistance));
		// The boss it could name is not named: the sentence is about the pull, not the target.
		expect(text(byShare)).not.toContain('Haromm');
	});

	/**
	 * The one sentence all three share, asserted once rather than three times over.
	 *
	 * The three findings are different facts about a pull and their opening clauses say so, but every one
	 * of them ends on the same offer: the findings are still worth reading, and here is the limit. A
	 * drift in one arm is the failure this catches: the family reads as one voice or it reads as three.
	 */
	it('closes every arm on the same offer to the reader', () => {
		const kinds: SplitGroup[] = (['towerRuns', 'belt', 'splitPair'] as const).map((kind) => ({
			kind,
			share: 1,
			windows: [],
			awayMs: 0,
			partedYards: null,
			name: null,
		}));
		for (const arm of kinds) {
			expect(text(arm)).toContain("so the analysis can't score you properly for optimal performance");
			expect(text(arm)).toContain('but the analyzer is not optimised for this');
		}
	});
});
